import path from 'node:path';
import fs from 'node:fs/promises';
import { createLogger } from '../utils/logger.js';
import { JsonlWriter, readJsonlStream } from '../utils/jsonl-writer.js';
import { resolveProjectPath } from '../utils/path-resolver.js';
import { loadConfig } from '../utils/config-loader.js';
import { classifyQuestion } from './dataset-classifier.js';
import { loadNormalizedMaps, writeDatasetSubset } from './text-only-builder.js';

const log = createLogger('dataset-classifier-runner');

export async function runDatasetClassification({
  targetType = 'all',
  limit = null,
  dryRun = false,
} = {}) {
  const cfg = await loadConfig('dataset');
  const inputDir = resolveProjectPath(cfg.input_dir || 'data/normalized');
  const version = cfg.classification_version || '1.0.0';

  log.info({ inputDir, targetType, dryRun }, 'Loading normalized maps for dataset classification');
  const { paperMap, materialMap, imageMap } = await loadNormalizedMaps(inputDir);

  const textOnlyQuestions = [];
  const multimodalQuestions = [];
  const reviewQuestions = [];
  const rejectedQuestions = [];

  let count = 0;
  for await (const q of readJsonlStream(path.join(inputDir, 'questions.jsonl'))) {
    if (limit && count >= limit) break;
    count += 1;

    const material = q.material_id ? materialMap.get(q.material_id) : null;
    const cls = classifyQuestion(q, material, imageMap, cfg);
    const enriched = { ...q, ...cls };

    if (cls.dataset_type === 'text-only') {
      textOnlyQuestions.push(enriched);
    } else if (cls.dataset_type === 'multimodal') {
      multimodalQuestions.push(enriched);
    } else if (cls.dataset_type === 'review') {
      reviewQuestions.push(enriched);
    } else {
      rejectedQuestions.push(enriched);
    }
  }

  const results = {
    classification_version: version,
    total_evaluated: count,
    counts: {
      'text-only': textOnlyQuestions.length,
      multimodal: multimodalQuestions.length,
      review: reviewQuestions.length,
      rejected: rejectedQuestions.length,
    },
    reports: {},
  };

  if (targetType === 'all' || targetType === 'text-only') {
    results.reports['text-only'] = await writeDatasetSubset({
      type: 'text-only',
      outDir: resolveProjectPath(cfg.text_only_dir || 'data/datasets/text-only'),
      paperMap,
      materialMap,
      imageMap,
      questionRecords: textOnlyQuestions,
      classificationVersion: version,
      includeImageManifest: false,
      dryRun,
    });
  }

  if (targetType === 'all' || targetType === 'multimodal') {
    results.reports.multimodal = await writeDatasetSubset({
      type: 'multimodal',
      outDir: resolveProjectPath(cfg.multimodal_dir || 'data/datasets/multimodal'),
      paperMap,
      materialMap,
      imageMap,
      questionRecords: multimodalQuestions,
      classificationVersion: version,
      includeImageManifest: true,
      dryRun,
    });
  }

  if (!dryRun && targetType === 'all') {
    const reviewDir = resolveProjectPath(cfg.review_dir || 'data/datasets/review');
    await fs.mkdir(reviewDir, { recursive: true });
    const rw = await new JsonlWriter(path.join(reviewDir, 'questions.jsonl')).open();
    for (const q of [...reviewQuestions, ...rejectedQuestions]) {
      await rw.write(q);
    }
    await rw.close();
  }

  log.info(results.counts, 'Dataset classification finished');
  return results;
}
