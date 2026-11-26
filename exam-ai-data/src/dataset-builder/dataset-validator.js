import fs from 'node:fs/promises';
import path from 'node:path';
import { createLogger } from '../utils/logger.js';
import { readJsonlStream } from '../utils/jsonl-writer.js';
import { resolveProjectPath } from '../utils/path-resolver.js';

const log = createLogger('dataset-validator');

const IMG_TAG_RE = /<img\b|!\[[^\]]*\]\([^)]+\)|!\[\[[^\]]+\]\]/i;

export async function runDatasetAndSftValidation({ dryRun = false } = {}) {
  log.info('Starting classification, SFT, and data leakage validation');

  const textOnlyDir = resolveProjectPath('data', 'datasets', 'text-only');
  const multimodalDir = resolveProjectPath('data', 'datasets', 'multimodal');
  const sftDir = resolveProjectPath('data', 'training', 'text-only', 'sft');

  const errors = [];
  const warnings = [];

  // 1. Classification validation
  const textOnlyQids = new Set();
  const multimodalQids = new Set();
  const textOnlyMatIds = new Set();

  for await (const m of readJsonlStream(path.join(textOnlyDir, 'materials.jsonl'))) {
    textOnlyMatIds.add(m.material_id);
  }

  for await (const q of readJsonlStream(path.join(textOnlyDir, 'questions.jsonl'))) {
    textOnlyQids.add(q.question_id);
    if (
      IMG_TAG_RE.test(q.stem || '') ||
      Object.values(q.options || {}).some((v) => IMG_TAG_RE.test(v || '')) ||
      IMG_TAG_RE.test(q.official_explanation || '')
    ) {
      errors.push({ scope: 'classification', type: 'image_tag_in_text_only', question_id: q.question_id });
    }
    if (q.material_id && !textOnlyMatIds.has(q.material_id)) {
      errors.push({ scope: 'classification', type: 'dangling_material_id', question_id: q.question_id });
    }
  }

  try {
    for await (const q of readJsonlStream(path.join(multimodalDir, 'questions.jsonl'))) {
      multimodalQids.add(q.question_id);
      if (textOnlyQids.has(q.question_id)) {
        errors.push({ scope: 'classification', type: 'overlap_text_only_multimodal', question_id: q.question_id });
      }
    }
  } catch {
    warnings.push({ scope: 'classification', type: 'multimodal_not_found' });
  }

  // 2. SFT validation & Leakage check
  const splitPapers = { train: new Set(), validation: new Set(), test: new Set() };
  const splitMaterials = { train: new Set(), validation: new Set(), test: new Set() };
  const splitQids = { train: new Set(), validation: new Set(), test: new Set() };
  const sftCounts = {};

  for (const task of ['answer', 'explanation']) {
    sftCounts[task] = {};
    for (const split of ['train', 'validation', 'test']) {
      const filePath = path.join(sftDir, task, `${split}.jsonl`);
      let count = 0;
      try {
        for await (const row of readJsonlStream(filePath)) {
          count += 1;
          if (!Array.isArray(row.messages) || row.messages.length !== 3) {
            errors.push({ scope: 'sft', type: 'invalid_messages_length', task, split, line: count });
            continue;
          }
          const [sys, usr, ast] = row.messages;
          if (sys.role !== 'system' || usr.role !== 'user' || ast.role !== 'assistant') {
            errors.push({ scope: 'sft', type: 'invalid_message_roles', task, split, line: count });
          }
          if (!ast.content || !String(ast.content).trim()) {
            errors.push({ scope: 'sft', type: 'empty_assistant', task, split, line: count });
          }
          if (!usr.content || IMG_TAG_RE.test(usr.content)) {
            errors.push({ scope: 'sft', type: 'image_in_user_prompt', task, split, line: count });
          }
          if (/【正确答案】|\*\*官方解析\*\*/.test(usr.content)) {
            errors.push({ scope: 'sft', type: 'answer_leak_in_user_prompt', task, split, line: count });
          }
          if (row.metadata) {
            if (row.metadata.task_type !== task) {
              errors.push({ scope: 'sft', type: 'wrong_task_type', task, split, line: count });
            }
            if (row.metadata.paper_id) splitPapers[split].add(row.metadata.paper_id);
            if (row.metadata.material_id) splitMaterials[split].add(row.metadata.material_id);
            if (row.metadata.question_id) splitQids[split].add(row.metadata.question_id);
          }
        }
      } catch (err) {
        errors.push({ scope: 'sft', type: 'file_read_or_json_error', task, split, message: err.message });
      }
      sftCounts[task][split] = count;
    }
  }

  // Cross-split leakage checks
  const intersect = (a, b) => [...a].filter((x) => b.has(x));
  const leakage = {
    paper_train_test: intersect(splitPapers.train, splitPapers.test).length,
    paper_train_val: intersect(splitPapers.train, splitPapers.validation).length,
    paper_val_test: intersect(splitPapers.validation, splitPapers.test).length,
    material_train_test: intersect(splitMaterials.train, splitMaterials.test).length,
    material_train_val: intersect(splitMaterials.train, splitMaterials.validation).length,
    material_val_test: intersect(splitMaterials.validation, splitMaterials.test).length,
    qid_train_test: intersect(splitQids.train, splitQids.test).length,
    qid_train_val: intersect(splitQids.train, splitQids.validation).length,
    qid_val_test: intersect(splitQids.validation, splitQids.test).length,
  };

  for (const [k, v] of Object.entries(leakage)) {
    if (v > 0) {
      errors.push({ scope: 'leakage', type: k, count: v });
    }
  }

  const report = {
    validated_at: new Date().toISOString(),
    status: errors.length === 0 ? 'PASS' : 'FAIL',
    classification_counts: {
      text_only: textOnlyQids.size,
      multimodal: multimodalQids.size,
    },
    sft_counts: sftCounts,
    leakage_check: leakage,
    error_count: errors.length,
    warning_count: warnings.length,
    errors: errors.slice(0, 100),
    warnings,
  };

  if (!dryRun) {
    const outPath = resolveProjectPath('data', 'training', 'text-only', 'validation_report.json');
    await fs.mkdir(path.dirname(outPath), { recursive: true });
    await fs.writeFile(outPath, JSON.stringify(report, null, 2), 'utf8');
  }

  log.info({ status: report.status, error_count: errors.length, leakage }, 'Dataset & SFT validation finished');
  return report;
}
