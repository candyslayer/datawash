import path from 'node:path';
import { createLogger } from '../utils/logger.js';
import { JsonlWriter, readJsonlStream } from '../utils/jsonl-writer.js';
import { resolveProjectPath } from '../utils/path-resolver.js';
import { normalizeText } from './text-normalizer.js';
import { normalizeOptions } from './option-normalizer.js';

const log = createLogger('normalizer');

export async function runNormalization({ dryRun = false } = {}) {
  log.info({ dryRun }, 'Starting data normalization');
  const parsedDir = resolveProjectPath('data', 'parsed');
  const normDir = resolveProjectPath('data', 'normalized');

  const stats = { papers: 0, materials: 0, questions: 0 };

  // 1. Papers
  const paperWriter = dryRun ? null : await new JsonlWriter(path.join(normDir, 'papers.jsonl')).open();
  for await (const paper of readJsonlStream(path.join(parsedDir, 'papers.jsonl'))) {
    const normalized = {
      ...paper,
      paper_name: normalizeText(paper.paper_name),
      year: paper.year ? Number(paper.year) : null,
      exam_type: paper.exam_type || 'unknown',
      province: paper.province || null,
      modules: Array.isArray(paper.modules) ? [...new Set(paper.modules)].sort() : [],
    };
    if (paperWriter) await paperWriter.write(normalized);
    stats.papers += 1;
  }
  if (paperWriter) await paperWriter.close();

  // 2. Materials
  const matWriter = dryRun ? null : await new JsonlWriter(path.join(normDir, 'materials.jsonl')).open();
  for await (const mat of readJsonlStream(path.join(parsedDir, 'materials.jsonl'))) {
    const normalized = {
      ...mat,
      content: normalizeText(mat.content),
    };
    if (matWriter) await matWriter.write(normalized);
    stats.materials += 1;
  }
  if (matWriter) await matWriter.close();

  // 3. Questions
  const qWriter = dryRun ? null : await new JsonlWriter(path.join(normDir, 'questions.jsonl')).open();
  for await (const q of readJsonlStream(path.join(parsedDir, 'questions.jsonl'))) {
    const cleanAnswer = q.official_answer
      ? normalizeText(q.official_answer).toUpperCase()
      : null;

    const normalized = {
      ...q,
      stem: normalizeText(q.stem),
      options: normalizeOptions(q.options),
      official_answer: cleanAnswer,
      official_explanation: q.official_explanation ? normalizeText(q.official_explanation) : null,
      quality: {
        ...q.quality,
        answer_status: cleanAnswer ? 'present' : 'missing',
      },
    };
    if (qWriter) await qWriter.write(normalized);
    stats.questions += 1;
  }
  if (qWriter) await qWriter.close();

  log.info(stats, 'Data normalization finished');
  return stats;
}
