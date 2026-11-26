import fs from 'node:fs/promises';
import path from 'node:path';
import { JsonlWriter, readJsonlStream } from '../utils/jsonl-writer.js';
import { resolveProjectPath } from '../utils/path-resolver.js';

/**
 * Write a subset dataset (text-only or multimodal) from classified records.
 */
export async function writeDatasetSubset({
  type,
  outDir,
  paperMap,
  materialMap,
  imageMap,
  questionRecords,
  classificationVersion,
  includeImageManifest = false,
  dryRun = false,
}) {
  const usedPaperIds = new Set();
  const usedMaterialIds = new Set();
  const usedImageIds = new Set();
  const byModule = {};
  const byReason = {};

  for (const q of questionRecords) {
    usedPaperIds.add(q.paper_id);
    if (q.material_id) usedMaterialIds.add(q.material_id);
    for (const imgId of q.related_image_ids || []) {
      usedImageIds.add(imgId);
    }
    byModule[q.module] = (byModule[q.module] || 0) + 1;
    byReason[q.classification_reason] = (byReason[q.classification_reason] || 0) + 1;
  }

  const report = {
    dataset_type: type,
    classification_version: classificationVersion,
    generated_at: new Date().toISOString(),
    questions_count: questionRecords.length,
    papers_count: usedPaperIds.size,
    materials_count: usedMaterialIds.size,
    images_count: usedImageIds.size,
    by_module: byModule,
    by_reason: byReason,
  };

  if (dryRun) {
    return report;
  }

  await fs.mkdir(outDir, { recursive: true });

  const qWriter = await new JsonlWriter(path.join(outDir, 'questions.jsonl')).open();
  for (const q of questionRecords) await qWriter.write(q);
  await qWriter.close();

  const pWriter = await new JsonlWriter(path.join(outDir, 'papers.jsonl')).open();
  for (const pid of usedPaperIds) {
    const p = paperMap.get(pid);
    if (p) await pWriter.write(p);
  }
  await pWriter.close();

  const mWriter = await new JsonlWriter(path.join(outDir, 'materials.jsonl')).open();
  for (const mid of usedMaterialIds) {
    const m = materialMap.get(mid);
    if (m) await mWriter.write(m);
  }
  await mWriter.close();

  if (includeImageManifest) {
    const imgWriter = await new JsonlWriter(path.join(outDir, 'image_manifest.jsonl')).open();
    for (const imgId of usedImageIds) {
      const img = imageMap.get(imgId);
      if (img) await imgWriter.write(img);
    }
    await imgWriter.close();
  }

  const manifest = {
    dataset_type: type,
    classification_version: classificationVersion,
    generated_at: report.generated_at,
    files: {
      questions: 'questions.jsonl',
      papers: 'papers.jsonl',
      materials: 'materials.jsonl',
      ...(includeImageManifest ? { image_manifest: 'image_manifest.jsonl' } : {}),
    },
    counts: {
      questions: questionRecords.length,
      papers: usedPaperIds.size,
      materials: usedMaterialIds.size,
      images: usedImageIds.size,
    },
  };

  await fs.writeFile(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
  await fs.writeFile(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2), 'utf8');

  return report;
}

export async function loadNormalizedMaps(inputDir) {
  const paperMap = new Map();
  for await (const p of readJsonlStream(path.join(inputDir, 'papers.jsonl'))) {
    paperMap.set(p.paper_id, p);
  }
  const materialMap = new Map();
  for await (const m of readJsonlStream(path.join(inputDir, 'materials.jsonl'))) {
    materialMap.set(m.material_id, m);
  }
  const imageMap = new Map();
  for await (const img of readJsonlStream(path.join(inputDir, 'images.jsonl'))) {
    imageMap.set(img.image_id, img);
  }
  return { paperMap, materialMap, imageMap };
}
