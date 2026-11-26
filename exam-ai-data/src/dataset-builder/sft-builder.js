import fs from 'node:fs/promises';
import path from 'node:path';
import { createLogger } from '../utils/logger.js';
import { JsonlWriter, readJsonlStream } from '../utils/jsonl-writer.js';
import { resolveProjectPath } from '../utils/path-resolver.js';
import { loadConfig } from '../utils/config-loader.js';
import { buildSftSample, isValidExplanation } from './conversation-builder.js';
import { splitQuestionsGrouped } from './dataset-splitter.js';

const log = createLogger('sft-builder');

async function loadDuplicatePairs(csvPath) {
  const pairs = [];
  try {
    const raw = await fs.readFile(csvPath, 'utf8');
    const lines = raw.split(/\r?\n/);
    for (let i = 1; i < lines.length; i += 1) {
      const line = lines[i].trim();
      if (!line) continue;
      const parts = line.split(',');
      if (parts.length >= 2) {
        pairs.push([parts[0], parts[1]]);
      }
    }
  } catch {
    // ignore if duplicate_questions.csv not present
  }
  return pairs;
}

export async function runSftBuild({ taskType = 'all', dryRun = false } = {}) {
  const cfg = await loadConfig('training');
  const datasetCfg = await loadConfig('dataset');

  const textOnlyDir = resolveProjectPath(cfg.input_dir || 'data/datasets/text-only');
  const outRoot = resolveProjectPath(cfg.output_dir || 'data/training/text-only');
  const sftRoot = resolveProjectPath(cfg.sft_dir || 'data/training/text-only/sft');

  log.info({ textOnlyDir, taskType, dryRun }, 'Building text-only SFT datasets');

  const materialMap = new Map();
  for await (const m of readJsonlStream(path.join(textOnlyDir, 'materials.jsonl'))) {
    materialMap.set(m.material_id, m);
  }

  const questions = [];
  for await (const q of readJsonlStream(path.join(textOnlyDir, 'questions.jsonl'))) {
    questions.push(q);
  }

  const dupPairs = await loadDuplicatePairs(resolveProjectPath('reports', 'duplicate_questions.csv'));
  const { assignments, splitPaperIds, actualRatios } = splitQuestionsGrouped(questions, {
    ratios: cfg.split?.ratios || { train: 0.8, validation: 0.1, test: 0.1 },
    seed: cfg.split?.seed ?? 20261126,
    duplicatePairs: dupPairs,
  });

  const tasksToBuild = taskType === 'all' ? ['answer', 'explanation'] : [taskType];

  const writers = {};
  if (!dryRun) {
    for (const t of tasksToBuild) {
      writers[t] = {
        train: await new JsonlWriter(path.join(sftRoot, t, 'train.jsonl')).open(),
        validation: await new JsonlWriter(path.join(sftRoot, t, 'validation.jsonl')).open(),
        test: await new JsonlWriter(path.join(sftRoot, t, 'test.jsonl')).open(),
      };
    }
  }

  const stats = {
    dataset_version: cfg.dataset_version || '1.0.0',
    generated_at: new Date().toISOString(),
    text_only_questions_total: questions.length,
    material_linked_questions: 0,
    tasks: {
      answer: { total: 0, train: 0, validation: 0, test: 0, excluded_reasons: {} },
      explanation: { total: 0, train: 0, validation: 0, test: 0, excluded_reasons: {} },
    },
    by_module: {},
    by_year: {},
    by_province: {},
    actual_split_ratios: actualRatios,
  };

  for (const q of questions) {
    const split = assignments.get(q.question_id);
    const mat = q.material_id ? materialMap.get(q.material_id) : null;
    if (q.material_id) stats.material_linked_questions += 1;

    stats.by_module[q.module] = (stats.by_module[q.module] || 0) + 1;
    const yKey = q.year ? String(q.year) : 'unknown';
    stats.by_year[yKey] = (stats.by_year[yKey] || 0) + 1;
    const pKey = q.province || 'none';
    stats.by_province[pKey] = (stats.by_province[pKey] || 0) + 1;

    if (tasksToBuild.includes('answer')) {
      if (!q.official_answer) {
        stats.tasks.answer.excluded_reasons.missing_answer =
          (stats.tasks.answer.excluded_reasons.missing_answer || 0) + 1;
      } else {
        const sample = buildSftSample({ taskType: 'answer', question: q, material: mat, cfg });
        if (!dryRun) await writers.answer[split].write(sample);
        stats.tasks.answer.total += 1;
        stats.tasks.answer[split] += 1;
      }
    }

    if (tasksToBuild.includes('explanation')) {
      if (!q.official_answer) {
        stats.tasks.explanation.excluded_reasons.missing_answer =
          (stats.tasks.explanation.excluded_reasons.missing_answer || 0) + 1;
      } else if (!isValidExplanation(q.official_explanation, cfg)) {
        stats.tasks.explanation.excluded_reasons.missing_or_invalid_explanation =
          (stats.tasks.explanation.excluded_reasons.missing_or_invalid_explanation || 0) + 1;
      } else {
        const sample = buildSftSample({ taskType: 'explanation', question: q, material: mat, cfg });
        if (!dryRun) await writers.explanation[split].write(sample);
        stats.tasks.explanation.total += 1;
        stats.tasks.explanation[split] += 1;
      }
    }
  }

  if (!dryRun) {
    for (const t of tasksToBuild) {
      await writers[t].train.close();
      await writers[t].validation.close();
      await writers[t].test.close();
    }

    await fs.mkdir(outRoot, { recursive: true });
    const sourceManifest = {
      dataset_version: stats.dataset_version,
      generated_at: stats.generated_at,
      seed: cfg.split?.seed ?? 20261126,
      configured_ratios: cfg.split?.ratios,
      actual_ratios: actualRatios,
      split_paper_counts: {
        train: splitPaperIds.train.length,
        validation: splitPaperIds.validation.length,
        test: splitPaperIds.test.length,
      },
      split_paper_ids: splitPaperIds,
    };

    // Merge classification counts from text-only / multimodal / review reports if available
    const readReportCount = async (p) => {
      try {
        const r = JSON.parse(await fs.readFile(p, 'utf8'));
        return r.questions_count || 0;
      } catch {
        return null;
      }
    };
    const mmCount = await readReportCount(
      resolveProjectPath(datasetCfg.multimodal_dir || 'data/datasets/multimodal', 'report.json')
    );

    const fullStats = {
      ...stats,
      multimodal_questions_total: mmCount,
    };

    await fs.writeFile(
      path.join(outRoot, 'source_manifest.json'),
      JSON.stringify(sourceManifest, null, 2),
      'utf8'
    );
    await fs.writeFile(
      path.join(outRoot, 'dataset_statistics.json'),
      JSON.stringify(fullStats, null, 2),
      'utf8'
    );
    await fs.writeFile(
      path.join(outRoot, 'generation_report.json'),
      JSON.stringify(
        {
          status: 'success',
          tasks_built: tasksToBuild,
          counts: stats.tasks,
          generated_at: stats.generated_at,
        },
        null,
        2
      ),
      'utf8'
    );
  }

  log.info({ answer: stats.tasks.answer.total, explanation: stats.tasks.explanation.total }, 'SFT build finished');
  return stats;
}
