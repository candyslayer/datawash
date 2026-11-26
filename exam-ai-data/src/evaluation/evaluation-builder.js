import fs from 'node:fs/promises';
import path from 'node:path';
import { createLogger } from '../utils/logger.js';
import { JsonlWriter, readJsonlStream } from '../utils/jsonl-writer.js';
import { resolveProjectPath } from '../utils/path-resolver.js';
import { loadConfig } from '../utils/config-loader.js';
import { cleanTextForPrompt } from '../dataset-builder/conversation-builder.js';
import { selectEvaluationPapers } from './evaluation-sampler.js';
import { runEvaluationValidation } from './evaluation-validator.js';

const log = createLogger('evaluation-builder');

async function loadDuplicateMap(csvPath) {
  const adj = new Map();
  try {
    const raw = await fs.readFile(csvPath, 'utf8');
    const lines = raw.split(/\r?\n/);
    for (let i = 1; i < lines.length; i += 1) {
      const line = lines[i].trim();
      if (!line) continue;
      const parts = line.split(',');
      if (parts.length < 2) continue;
      const [a, b] = parts;
      if (!adj.has(a)) adj.set(a, new Set());
      if (!adj.has(b)) adj.set(b, new Set());
      adj.get(a).add(b);
      adj.get(b).add(a);
    }
  } catch {
    // ignore if missing
  }
  return adj;
}

export function formatEvalQuestion(q, material) {
  const optionsArr = Object.keys(q.options || {})
    .sort()
    .map((label) => ({
      label,
      content: cleanTextForPrompt(q.options[label]),
    }));

  return {
    question_id: q.question_id,
    module: q.module,
    year: q.year,
    exam_type: q.exam_type,
    province: q.province,
    question_type: q.question_type || 'unknown',
    material_id: q.material_id || null,
    material: material ? cleanTextForPrompt(material.content) : null,
    stem: cleanTextForPrompt(q.stem),
    options: optionsArr,
  };
}

export function formatAnswerKey(q) {
  return {
    question_id: q.question_id,
    official_answer: q.official_answer,
    official_explanation: q.official_explanation ? cleanTextForPrompt(q.official_explanation) : null,
    paper_id: q.paper_id,
    material_id: q.material_id || null,
    module: q.module,
  };
}

export async function runEvaluationBuild({
  version = null,
  targetSize = null,
  seed = null,
  dryRun = false,
} = {}) {
  const cfg = await loadConfig('evaluation');
  const evalVersion = version || cfg.dataset_version || 'baseline-v1';
  const size = targetSize ?? cfg.target_size ?? 2000;
  const rngSeed = seed ?? cfg.seed ?? 20261126;

  const inputDir = resolveProjectPath(cfg.input_dir || 'data/datasets/text-only');
  const manifestPath = resolveProjectPath(cfg.training_manifest || 'data/training/text-only/source_manifest.json');
  const dupCsvPath = resolveProjectPath(cfg.duplicate_report || 'reports/duplicate_questions.csv');
  const outDir = resolveProjectPath(cfg.output_root || 'data/evaluation/text-only', evalVersion);
  const resultsDir = resolveProjectPath(cfg.output_root || 'data/evaluation/text-only', 'baseline-results');

  log.info({ evalVersion, size, rngSeed, dryRun }, 'Building independent baseline evaluation dataset');

  const trainManifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  const excludedPaperIds = new Set([
    ...(trainManifest.split_paper_ids?.train || []),
    ...(trainManifest.split_paper_ids?.validation || []),
  ]);

  const materialMap = new Map();
  for await (const m of readJsonlStream(path.join(inputDir, 'materials.jsonl'))) {
    materialMap.set(m.material_id, m);
  }

  const allQuestions = [];
  const excludedQids = new Set();
  const excludedMaterialIds = new Set();

  for await (const q of readJsonlStream(path.join(inputDir, 'questions.jsonl'))) {
    allQuestions.push(q);
    if (excludedPaperIds.has(q.paper_id)) {
      excludedQids.add(q.question_id);
      if (q.material_id) excludedMaterialIds.add(q.material_id);
    }
  }

  const dupAdj = await loadDuplicateMap(dupCsvPath);
  const duplicateOverlappingQids = new Set();
  for (const eqid of excludedQids) {
    const neighbors = dupAdj.get(eqid);
    if (neighbors) {
      for (const n of neighbors) duplicateOverlappingQids.add(n);
    }
  }

  const selection = selectEvaluationPapers({
    questions: allQuestions,
    excludedPaperIds,
    excludedMaterialIds,
    duplicateOverlappingQids,
    excludeDuplicateOverlappingPapers: cfg.exclude_duplicate_overlapping_papers !== false,
    targetSize: size,
    seed: rngSeed,
  });

  // Compute statistics
  const byModule = {};
  const byYear = {};
  const byProvince = {};
  const byExamType = {};
  const byQuestionType = {};
  const perPaperCounts = {};
  const materialIdsUsed = new Set();
  let materialLinkedCount = 0;
  let answerPresentCount = 0;
  let explanationValidCount = 0;

  for (const q of selection.selectedQuestions) {
    byModule[q.module] = (byModule[q.module] || 0) + 1;
    byYear[String(q.year || 'unknown')] = (byYear[String(q.year || 'unknown')] || 0) + 1;
    byProvince[q.province || 'none'] = (byProvince[q.province || 'none'] || 0) + 1;
    byExamType[q.exam_type || 'unknown'] = (byExamType[q.exam_type || 'unknown'] || 0) + 1;
    byQuestionType[q.question_type || 'unknown'] = (byQuestionType[q.question_type || 'unknown'] || 0) + 1;
    perPaperCounts[q.paper_id] = (perPaperCounts[q.paper_id] || 0) + 1;
    if (q.material_id) {
      materialIdsUsed.add(q.material_id);
      materialLinkedCount += 1;
    }
    if (q.official_answer) answerPresentCount += 1;
    if (q.official_explanation && !/^略[。.]?$/.test(q.official_explanation.trim())) {
      explanationValidCount += 1;
    }
  }

  const statistics = {
    dataset_version: evalVersion,
    generated_at: new Date().toISOString(),
    seed: rngSeed,
    target_size: size,
    total_text_only_questions: allQuestions.length,
    training_and_val_papers_count: excludedPaperIds.size,
    available_clean_papers_count: selection.totalCleanPapers,
    available_clean_questions_count: selection.totalCleanQuestions,
    selected_papers_count: selection.selectedPapers.length,
    selected_questions_count: selection.selectedQuestions.length,
    by_module: byModule,
    by_year: byYear,
    by_province: byProvince,
    by_exam_type: byExamType,
    by_question_type: byQuestionType,
    per_paper_question_counts: perPaperCounts,
    materials_count: materialIdsUsed.size,
    material_linked_questions_count: materialLinkedCount,
    answer_completeness_rate: selection.selectedQuestions.length
      ? Number((answerPresentCount / selection.selectedQuestions.length).toFixed(4))
      : 0,
    explanation_coverage_rate: selection.selectedQuestions.length
      ? Number((explanationValidCount / selection.selectedQuestions.length).toFixed(4))
      : 0,
  };

  if (dryRun) {
    return { dry_run: true, statistics };
  }

  await fs.mkdir(outDir, { recursive: true });
  await fs.mkdir(resultsDir, { recursive: true });

  const qWriter = await new JsonlWriter(path.join(outDir, 'questions.jsonl')).open();
  const aWriter = await new JsonlWriter(path.join(outDir, 'answer-key.jsonl')).open();

  for (const q of selection.selectedQuestions) {
    const mat = q.material_id ? materialMap.get(q.material_id) : null;
    await qWriter.write(formatEvalQuestion(q, mat));
    await aWriter.write(formatAnswerKey(q));
  }
  await qWriter.close();
  await aWriter.close();

  const manifest = {
    dataset_version: evalVersion,
    generated_at: statistics.generated_at,
    seed: rngSeed,
    selected_paper_ids: selection.selectedPapers.map((p) => p.paper_id).sort(),
    selected_questions_count: selection.selectedQuestions.length,
    files: {
      questions: 'questions.jsonl',
      answer_key: 'answer-key.jsonl',
      statistics: 'statistics.json',
      quality_report: 'quality-report.json',
    },
  };

  await fs.writeFile(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
  await fs.writeFile(path.join(outDir, 'statistics.json'), JSON.stringify(statistics, null, 2), 'utf8');
  await fs.writeFile(path.join(outDir, 'README.md'), buildEvalReadme(evalVersion, statistics), 'utf8');
  await fs.writeFile(path.join(resultsDir, 'README.md'), buildResultsReadme(), 'utf8');

  const qualityReport = await runEvaluationValidation({ version: evalVersion });
  return { dry_run: false, statistics, quality_report: qualityReport };
}

function buildEvalReadme(version, stats) {
  return `# Baseline Evaluation Dataset (${version})

- **Generated**: ${stats.generated_at}
- **Seed**: ${stats.seed}
- **Selected Papers**: ${stats.selected_papers_count} (out of ${stats.available_clean_papers_count} clean isolated papers)
- **Total Questions**: ${stats.selected_questions_count}

## Files

- \`questions.jsonl\`: Model inference input (contains \`question_id\`, \`module\`, \`year\`, \`exam_type\`, \`province\`, \`question_type\`, \`material\`, \`stem\`, \`options\`; strictly NO answers, explanations, or image paths).
- \`answer-key.jsonl\`: Ground-truth answer key for offline scoring ONLY. Never pass to models.
- \`manifest.json\`: Selected \`paper_id\` inventory and seed metadata.
- \`statistics.json\`: Module, year, province, and material statistics.
- \`quality-report.json\`: Isolation, leakage, and completeness verification report.
`;
}

function buildResultsReadme() {
  return `# Baseline Evaluation Results Directory

Store model inference predictions and evaluation reports here without modifying \`../baseline-v1/\`.

## Recommended Prediction Record Schema (\`predictions.jsonl\`)

\`\`\`json
{
  "evaluation_id": "baseline-2026-001",
  "model_name": "Qwen-SEA-LION-v4.5-27B-IT",
  "model_version": "base-or-lora-v1",
  "dataset_version": "baseline-v1",
  "question_id": "Q-2026-...",
  "predicted_answer": "A",
  "correct": true,
  "raw_response": "...",
  "inference_timestamp": "2026-11-26T10:55:00.000Z"
}
\`\`\`
`;
}
