import fs from 'node:fs/promises';
import path from 'node:path';
import pLimit from 'p-limit';
import { createLogger } from '../utils/logger.js';
import { sha256Text } from '../utils/hash.js';
import { JsonlWriter, readJsonlMap } from '../utils/jsonl-writer.js';
import { resolveProjectPath, toPosixPath } from '../utils/path-resolver.js';
import { loadConfig } from '../utils/config-loader.js';
import { isExamMarkdown, classifyModuleFromPath } from '../discovery/file-classifier.js';
import { extractFileEntities } from '../extractors/file-extractor.js';

const log = createLogger('parse-runner');

async function collectExamMarkdownFiles(sourceRoot, filters = {}) {
  const files = [];
  async function walk(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const ent of entries) {
      const fullPath = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (ent.name === '90-图片') continue;
        await walk(fullPath);
      } else if (ent.isFile() && ent.name.endsWith('.md')) {
        const relPath = toPosixPath(path.relative(sourceRoot, fullPath));
        if (!isExamMarkdown(relPath, null)) continue;
        if (filters.module) {
          const mod = classifyModuleFromPath(relPath);
          if (mod !== filters.module) continue;
        }
        if (filters.year && !relPath.includes(String(filters.year))) {
          continue;
        }
        files.push({ fullPath, relPath });
      }
    }
  }
  await walk(sourceRoot);
  files.sort((a, b) => a.relPath.localeCompare(b.relPath));
  return files;
}

export async function runParse({
  sourceRoot,
  year = null,
  module = null,
  paper = null,
  limitFiles = null,
  concurrency = 8,
  resume = false,
  force = false,
  dryRun = false,
}) {
  const parserCfg = await loadConfig('parser');
  const parserVersion = parserCfg?.parser_version || '1.0.0';

  const parsedDir = resolveProjectPath('data', 'parsed');
  const manifestsDir = resolveProjectPath('data', 'manifests');
  const manifestPath = path.join(manifestsDir, 'parse_manifest.jsonl');

  const files = await collectExamMarkdownFiles(sourceRoot, { year, module });
  const targetFiles = limitFiles ? files.slice(0, limitFiles) : files;

  log.info({ totalFiles: targetFiles.length, resume, force, dryRun }, 'Starting Markdown parsing');

  const prevManifest =
    resume && !force ? await readJsonlMap(manifestPath, (m) => m.rel_path) : new Map();

  const papersMap =
    resume && !force
      ? await readJsonlMap(path.join(parsedDir, 'papers.jsonl'), (p) => p.paper_id)
      : new Map();
  let materialWriter = null;
  let questionWriter = null;
  let imageRefWriter = null;
  let manifestWriter = null;

  if (!dryRun) {
    const appendMode = resume && !force && prevManifest.size > 0;
    materialWriter = await new JsonlWriter(path.join(parsedDir, 'materials.jsonl'), { append: appendMode }).open();
    questionWriter = await new JsonlWriter(path.join(parsedDir, 'questions.jsonl'), { append: appendMode }).open();
    imageRefWriter = await new JsonlWriter(path.join(parsedDir, 'image_refs.jsonl'), { append: appendMode }).open();
    manifestWriter = await new JsonlWriter(manifestPath, { append: appendMode }).open();
  }

  const limit = pLimit(concurrency);
  const stats = {
    processed_files: 0,
    skipped_files: 0,
    failed_files: 0,
    papers_count: 0,
    materials_count: 0,
    questions_count: 0,
    image_refs_count: 0,
  };

  // Serialize writes cleanly while parsing concurrently
  let writeChain = Promise.resolve();

  await Promise.all(
    targetFiles.map((f) =>
      limit(async () => {
        try {
          const rawText = await fs.readFile(f.fullPath, 'utf8');
          const fileHash = sha256Text(rawText);

          const prev = prevManifest.get(f.relPath);
          if (prev && prev.file_hash === fileHash && prev.parser_version === parserVersion) {
            stats.skipped_files += 1;
            return;
          }

          const result = extractFileEntities({
            sourceRoot,
            relPath: f.relPath,
            rawText,
          });

          if (paper && result.paper.paper_id !== paper) {
            return;
          }

          writeChain = writeChain.then(async () => {
            const existingPaper = papersMap.get(result.paper.paper_id);
            if (existingPaper) {
              for (const m of result.paper.modules) {
                if (!existingPaper.modules.includes(m)) existingPaper.modules.push(m);
              }
              if (!existingPaper.source_files.includes(f.relPath)) {
                existingPaper.source_files.push(f.relPath);
              }
            } else {
              papersMap.set(result.paper.paper_id, result.paper);
            }

            if (!dryRun) {
              for (const mat of result.materials) {
                await materialWriter.write(mat);
              }
              for (const q of result.questions) {
                await questionWriter.write(q);
              }
              for (const ref of result.imageRefs) {
                await imageRefWriter.write(ref);
              }
              await manifestWriter.write({
                rel_path: f.relPath,
                file_hash: fileHash,
                parser_version: parserVersion,
                questions: result.questions.length,
                materials: result.materials.length,
                parsed_at: new Date().toISOString(),
              });
            }

            stats.processed_files += 1;
            stats.materials_count += result.materials.length;
            stats.questions_count += result.questions.length;
            stats.image_refs_count += result.imageRefs.length;
          });
          await writeChain;
        } catch (err) {
          stats.failed_files += 1;
          log.error({ file: f.relPath, err: err.message }, 'Failed to parse file');
        }
      })
    )
  );

  if (!dryRun) {
    await materialWriter.close();
    await questionWriter.close();
    await imageRefWriter.close();
    await manifestWriter.close();

    // Write merged papers.jsonl
    const paperWriter = await new JsonlWriter(path.join(parsedDir, 'papers.jsonl')).open();
    for (const p of papersMap.values()) {
      await paperWriter.write(p);
    }
    await paperWriter.close();
  }

  stats.papers_count = papersMap.size;
  log.info(stats, 'Markdown parsing finished');
  return stats;
}
