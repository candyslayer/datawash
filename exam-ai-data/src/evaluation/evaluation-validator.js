import fs from 'node:fs/promises';
import path from 'node:path';
import { createLogger } from '../utils/logger.js';
import { readJsonlStream } from '../utils/jsonl-writer.js';
import { resolveProjectPath } from '../utils/path-resolver.js';
import { loadConfig } from '../utils/config-loader.js';

const log = createLogger('evaluation-validator');
const IMG_TAG_RE = /<img\b|!\[[^\]]*\]\([^)]+\)|!\[\[[^\]]+\]\]|\.\.\/90-图片/i;

export async function runEvaluationValidation({ version = null, dryRun = false } = {}) {
  const cfg = await loadConfig('evaluation');
  const evalVersion = version || cfg.dataset_version || 'baseline-v1';
  const evalDir = resolveProjectPath(cfg.output_root || 'data/evaluation/text-only', evalVersion);
  const trainManifestPath = resolveProjectPath(
    cfg.training_manifest || 'data/training/text-only/source_manifest.json'
  );
  const textOnlyDir = resolveProjectPath(cfg.input_dir || 'data/datasets/text-only');
  const dupCsvPath = resolveProjectPath(cfg.duplicate_report || 'reports/duplicate_questions.csv');

  log.info({ evalVersion }, 'Validating evaluation dataset isolation, completeness, and answer leakage');

  const errors = [];
  const trainManifest = JSON.parse(await fs.readFile(trainManifestPath, 'utf8'));
  const trainPapers = new Set(trainManifest.split_paper_ids?.train || []);
  const valPapers = new Set(trainManifest.split_paper_ids?.validation || []);

  // Index train/val question_ids and material_ids
  const trainValQids = new Set();
  const trainValMatIds = new Set();
  for await (const q of readJsonlStream(path.join(textOnlyDir, 'questions.jsonl'))) {
    if (trainPapers.has(q.paper_id) || valPapers.has(q.paper_id)) {
      trainValQids.add(q.question_id);
      if (q.material_id) trainValMatIds.add(q.material_id);
    }
  }

  // Index duplicate neighbors of train/val
  const dupWithTrainVal = new Set();
  try {
    const raw = await fs.readFile(dupCsvPath, 'utf8');
    for (const line of raw.split(/\r?\n/).slice(1)) {
      const [a, b] = line.split(',');
      if (!a || !b) continue;
      if (trainValQids.has(a) && !trainValQids.has(b)) dupWithTrainVal.add(b);
      if (trainValQids.has(b) && !trainValQids.has(a)) dupWithTrainVal.add(a);
    }
  } catch {
    // ignore
  }

  // Validate questions.jsonl (completeness + answer leakage + image refs)
  const evalQuestions = new Map();
  let qCount = 0;
  for await (const q of readJsonlStream(path.join(evalDir, 'questions.jsonl'))) {
    qCount += 1;
    if (evalQuestions.has(q.question_id)) {
      errors.push({ type: 'duplicate_question_id', question_id: q.question_id });
    }
    evalQuestions.set(q.question_id, q);

    if ('official_answer' in q || 'official_explanation' in q || 'correct_answer' in q) {
      errors.push({ type: 'answer_field_leak_in_questions', question_id: q.question_id });
    }
    if (!q.stem || !String(q.stem).trim()) {
      errors.push({ type: 'empty_stem', question_id: q.question_id });
    }
    if (!Array.isArray(q.options) || q.options.length === 0) {
      errors.push({ type: 'empty_options', question_id: q.question_id });
    } else {
      for (const opt of q.options) {
        if (/✅/.test(opt.content || '') || IMG_TAG_RE.test(opt.content || '')) {
          errors.push({ type: 'option_leak_or_image', question_id: q.question_id });
        }
      }
    }
    if (/【正确答案】|\*\*官方解析\*\*|✅/.test(q.stem || '')) {
      errors.push({ type: 'answer_marker_in_stem', question_id: q.question_id });
    }
    if (IMG_TAG_RE.test(q.stem || '') || IMG_TAG_RE.test(q.material || '')) {
      errors.push({ type: 'image_dependency_in_eval', question_id: q.question_id });
    }
    if (q.material_id && (!q.material || !String(q.material).trim())) {
      errors.push({ type: 'missing_material_text', question_id: q.question_id });
    }
    if (trainValQids.has(q.question_id)) {
      errors.push({ type: 'train_val_qid_leakage', question_id: q.question_id });
    }
    if (q.material_id && trainValMatIds.has(q.material_id)) {
      errors.push({ type: 'train_val_material_leakage', question_id: q.question_id });
    }
    if (dupWithTrainVal.has(q.question_id)) {
      errors.push({ type: 'train_val_duplicate_leakage', question_id: q.question_id });
    }
  }

  // Validate answer-key.jsonl
  let aCount = 0;
  const evalPaperIds = new Set();
  for await (const ak of readJsonlStream(path.join(evalDir, 'answer-key.jsonl'))) {
    aCount += 1;
    evalPaperIds.add(ak.paper_id);
    if (trainPapers.has(ak.paper_id) || valPapers.has(ak.paper_id)) {
      errors.push({ type: 'train_val_paper_leakage', paper_id: ak.paper_id, question_id: ak.question_id });
    }
    const q = evalQuestions.get(ak.question_id);
    if (!q) {
      errors.push({ type: 'answer_key_missing_question', question_id: ak.question_id });
      continue;
    }
    if (!ak.official_answer) {
      errors.push({ type: 'missing_official_answer', question_id: ak.question_id });
    } else {
      const optLabels = new Set((q.options || []).map((o) => o.label));
      if (!ak.official_answer.split('').every((c) => optLabels.has(c))) {
        errors.push({ type: 'answer_not_in_options', question_id: ak.question_id });
      }
    }
  }

  if (qCount !== aCount) {
    errors.push({ type: 'count_mismatch_questions_vs_answer_key', qCount, aCount });
  }

  const report = {
    validated_at: new Date().toISOString(),
    dataset_version: evalVersion,
    status: errors.length === 0 ? 'PASS' : 'FAIL',
    questions_count: qCount,
    answer_key_count: aCount,
    papers_count: evalPaperIds.size,
    isolation_checks: {
      paper_overlap_with_train_val: errors.filter((e) => e.type === 'train_val_paper_leakage').length,
      qid_overlap_with_train_val: errors.filter((e) => e.type === 'train_val_qid_leakage').length,
      material_overlap_with_train_val: errors.filter((e) => e.type === 'train_val_material_leakage').length,
      duplicate_overlap_with_train_val: errors.filter((e) => e.type === 'train_val_duplicate_leakage').length,
    },
    answer_leakage_errors: errors.filter((e) =>
      ['answer_field_leak_in_questions', 'option_leak_or_image', 'answer_marker_in_stem'].includes(e.type)
    ).length,
    image_dependency_errors: errors.filter((e) => e.type === 'image_dependency_in_eval').length,
    error_count: errors.length,
    errors: errors.slice(0, 100),
  };

  if (!dryRun) {
    await fs.writeFile(path.join(evalDir, 'quality-report.json'), JSON.stringify(report, null, 2), 'utf8');
  }

  log.info({ status: report.status, error_count: errors.length }, 'Evaluation validation finished');
  return report;
}
