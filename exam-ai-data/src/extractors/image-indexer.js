import fs from 'node:fs/promises';
import path from 'node:path';
import pLimit from 'p-limit';
import { createLogger } from '../utils/logger.js';
import { sha256File } from '../utils/hash.js';
import { JsonlWriter, readJsonlStream } from '../utils/jsonl-writer.js';
import { resolveProjectPath, toPosixPath } from '../utils/path-resolver.js';
import { buildImageId, createImage } from '../models/image.js';

const log = createLogger('image-indexer');

const MIME_MAP = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.jfif': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
};

const IMAGE_EXTS = new Set(Object.keys(MIME_MAP));

/**
 * Lightweight header-only dimension reader for PNG/GIF/JPEG/SVG.
 * Never throws; returns { width: null, height: null } if unknown.
 */
async function readImageDimensions(filePath, ext) {
  try {
    const fh = await fs.open(filePath, 'r');
    try {
      if (ext === '.png') {
        const buf = Buffer.alloc(24);
        const { bytesRead } = await fh.read(buf, 0, 24, 0);
        if (bytesRead >= 24 && buf.toString('ascii', 12, 16) === 'IHDR') {
          return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
        }
      } else if (ext === '.gif') {
        const buf = Buffer.alloc(10);
        const { bytesRead } = await fh.read(buf, 0, 10, 0);
        if (bytesRead >= 10 && buf.toString('ascii', 0, 3) === 'GIF') {
          return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
        }
      } else if (ext === '.svg') {
        const buf = Buffer.alloc(1024);
        const { bytesRead } = await fh.read(buf, 0, 1024, 0);
        const head = buf.toString('utf8', 0, bytesRead);
        const w = head.match(/\bwidth=["'](\d+(?:\.\d+)?)/i);
        const h = head.match(/\bheight=["'](\d+(?:\.\d+)?)/i);
        if (w && h) {
          return { width: Math.round(Number(w[1])), height: Math.round(Number(h[1])) };
        }
      } else if (ext === '.jpg' || ext === '.jpeg' || ext === '.jfif') {
        const buf = Buffer.alloc(65536);
        const { bytesRead } = await fh.read(buf, 0, 65536, 0);
        let i = 2;
        while (i + 8 < bytesRead) {
          if (buf[i] !== 0xff) break;
          const marker = buf[i + 1];
          if (marker >= 0xc0 && marker <= 0xc3) {
            return { width: buf.readUInt16BE(i + 7), height: buf.readUInt16BE(i + 5) };
          }
          const len = buf.readUInt16BE(i + 2);
          if (len < 2) break;
          i += 2 + len;
        }
      }
    } finally {
      await fh.close();
    }
  } catch {
    // ignore dimension errors
  }
  return { width: null, height: null };
}

async function scanDiskImages(sourceRoot) {
  const imgRoot = path.join(sourceRoot, '90-图片');
  const results = [];
  async function walk(dir) {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      const fullPath = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        await walk(fullPath);
      } else if (ent.isFile()) {
        const ext = path.extname(ent.name).toLowerCase();
        if (IMAGE_EXTS.has(ext)) {
          results.push(toPosixPath(path.relative(sourceRoot, fullPath)));
        }
      }
    }
  }
  await walk(imgRoot);
  return results;
}

export async function runImageIndexing({
  sourceRoot,
  copyImages = true,
  concurrency = 12,
  dryRun = false,
}) {
  log.info({ sourceRoot, copyImages }, 'Starting image indexing');
  const refsPath = resolveProjectPath('data', 'parsed', 'image_refs.jsonl');
  const imageMap = new Map();

  // 1. Aggregate references from parsed image_refs.jsonl
  try {
    await fs.access(refsPath);
    for await (const ref of readJsonlStream(refsPath)) {
      let entry = imageMap.get(ref.original_path);
      if (!entry) {
        entry = {
          image_id: ref.image_id || buildImageId(ref.original_path),
          original_path: ref.original_path,
          image_type: ref.image_type || 'unknown',
          related_question_ids: new Set(),
          related_material_ids: new Set(),
        };
        imageMap.set(ref.original_path, entry);
      }
      if (entry.image_type === 'unknown' && ref.image_type && ref.image_type !== 'unknown') {
        entry.image_type = ref.image_type;
      }
      if (ref.question_id) entry.related_question_ids.add(ref.question_id);
      if (ref.material_id) entry.related_material_ids.add(ref.material_id);
    }
  } catch {
    log.warn('No parsed image_refs.jsonl found; indexing disk images only');
  }

  // 2. Include unreferenced disk images
  const diskImages = await scanDiskImages(sourceRoot);
  for (const relPath of diskImages) {
    if (!imageMap.has(relPath)) {
      imageMap.set(relPath, {
        image_id: buildImageId(relPath),
        original_path: relPath,
        image_type: relPath.includes('公式图') ? 'formula_image' : 'unknown',
        related_question_ids: new Set(),
        related_material_ids: new Set(),
      });
    }
  }

  const normImagesRoot = resolveProjectPath('data', 'normalized', 'images');
  const normJsonlPath = resolveProjectPath('data', 'normalized', 'images.jsonl');
  const manifestPath = resolveProjectPath('data', 'manifests', 'image_manifest.jsonl');

  let imageWriter = null;
  let manifestWriter = null;
  if (!dryRun) {
    imageWriter = await new JsonlWriter(normJsonlPath).open();
    manifestWriter = await new JsonlWriter(manifestPath).open();
  }

  const limit = pLimit(concurrency);
  const stats = {
    total_images: imageMap.size,
    existing_images: 0,
    missing_images: 0,
    copied_images: 0,
    unreferenced_images: 0,
  };

  let writeChain = Promise.resolve();
  const entries = [...imageMap.values()];

  await Promise.all(
    entries.map((entry) =>
      limit(async () => {
        const fullSrcPath = path.resolve(sourceRoot, entry.original_path);
        const ext = path.extname(entry.original_path).toLowerCase();
        const mimeType = MIME_MAP[ext] || 'application/octet-stream';

        let exists = false;
        let fileHash = null;
        let width = null;
        let height = null;
        let normalizedPath = null;

        try {
          await fs.access(fullSrcPath);
          exists = true;
          fileHash = await sha256File(fullSrcPath);
          const dims = await readImageDimensions(fullSrcPath, ext);
          width = dims.width;
          height = dims.height;

          const subDir = fileHash.slice(0, 2);
          const destRel = `images/${subDir}/${fileHash}${ext}`;
          normalizedPath = destRel;

          if (copyImages && !dryRun) {
            const destFull = path.join(normImagesRoot, subDir, `${fileHash}${ext}`);
            await fs.mkdir(path.dirname(destFull), { recursive: true });
            try {
              await fs.access(destFull);
            } catch {
              await fs.copyFile(fullSrcPath, destFull);
              stats.copied_images += 1;
            }
          }
        } catch {
          exists = false;
        }

        const record = createImage({
          image_id: entry.image_id,
          original_path: entry.original_path,
          normalized_path: normalizedPath,
          image_type: entry.image_type,
          related_question_ids: [...entry.related_question_ids],
          related_material_ids: [...entry.related_material_ids],
          file_hash: fileHash,
          exists,
          mime_type: mimeType,
          width,
          height,
        });

        writeChain = writeChain.then(async () => {
          if (exists) stats.existing_images += 1;
          else stats.missing_images += 1;
          if (record.related_question_ids.length === 0 && record.related_material_ids.length === 0) {
            stats.unreferenced_images += 1;
          }
          if (!dryRun) {
            await imageWriter.write(record);
            await manifestWriter.write({
              image_id: record.image_id,
              original_path: record.original_path,
              normalized_path: record.normalized_path,
              file_hash: record.file_hash,
              exists: record.exists,
            });
          }
        });
        await writeChain;
      })
    )
  );

  if (!dryRun) {
    await imageWriter.close();
    await manifestWriter.close();
  }

  log.info(stats, 'Image indexing finished');
  return stats;
}
