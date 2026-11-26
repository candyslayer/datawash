import fs from 'node:fs/promises';
import path from 'node:path';
import { createLogger } from '../utils/logger.js';
import { sha256Text } from '../utils/hash.js';
import { readJsonlStream } from '../utils/jsonl-writer.js';
import { resolveProjectPath } from '../utils/path-resolver.js';
import { loadConfig } from '../utils/config-loader.js';

const log = createLogger('deduplicator');

function csvEscape(val) {
  const s = val == null ? '' : String(val);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function normalizeForHash(stem) {
  return String(stem || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripHtmlForFuzzy(stem) {
  return String(stem || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, '')
    .trim();
}

function buildNgrams(text, n = 4) {
  const grams = new Set();
  if (text.length < n) {
    if (text.length > 0) grams.add(text);
    return grams;
  }
  for (let i = 0; i <= text.length - n; i += 1) {
    grams.add(text.slice(i, i + n));
  }
  return grams;
}

function jaccard(setA, setB) {
  if (setA.size === 0 && setB.size === 0) return 0;
  let inter = 0;
  const [small, large] = setA.size <= setB.size ? [setA, setB] : [setB, setA];
  for (const g of small) {
    if (large.has(g)) inter += 1;
  }
  const union = setA.size + setB.size - inter;
  return union === 0 ? 0 : inter / union;
}

export async function runDeduplication({ dryRun = false } = {}) {
  const cfg = await loadConfig('deduplication');
  const ngramSize = cfg?.ngram_size || 4;
  const minSim = cfg?.min_similarity || 0.85;
  const maxBucket = cfg?.max_bucket_size || 200;

  log.info({ ngramSize, minSim }, 'Starting multi-layer deduplication');

  const questionsPath = resolveProjectPath('data', 'normalized', 'questions.jsonl');
  const imagesPath = resolveProjectPath('data', 'normalized', 'images.jsonl');

  const qidSeen = new Map();
  const sourceQidSeen = new Map();
  const exactStemSeen = new Map();

  // For fuzzy detection: store compact records only (not full explanation)
  const fuzzyItems = [];
  const duplicates = [];
  const seenPairs = new Set();

  function addDuplicate(qId, dupQId, type, similarity, sourceFile) {
    const pairKey = qId < dupQId ? `${qId}::${dupQId}::${type}` : `${dupQId}::${qId}::${type}`;
    if (seenPairs.has(pairKey)) return;
    seenPairs.add(pairKey);
    duplicates.push({
      question_id: qId,
      duplicate_question_id: dupQId,
      duplicate_type: type,
      similarity: Number(similarity.toFixed(4)),
      source_file: sourceFile,
      review_status: 'pending',
    });
  }

  for await (const q of readJsonlStream(questionsPath)) {
    // Layer 1: question_id & source_qid
    if (qidSeen.has(q.question_id)) {
      addDuplicate(q.question_id, qidSeen.get(q.question_id), 'question_id', 1.0, q.source?.file);
    } else {
      qidSeen.set(q.question_id, q.question_id);
    }

    if (q.source_qid) {
      if (sourceQidSeen.has(q.source_qid)) {
        addDuplicate(q.question_id, sourceQidSeen.get(q.source_qid), 'source_qid', 1.0, q.source?.file);
      } else {
        sourceQidSeen.set(q.source_qid, q.question_id);
      }
    }

    // Layer 2: Exact stem hash (include image_refs so image-only questions aren't falsely merged)
    const stemNorm = normalizeForHash(q.stem);
    const exactKey = sha256Text(`${stemNorm}::${(q.image_refs || []).join(',')}`);
    if (exactStemSeen.has(exactKey)) {
      addDuplicate(q.question_id, exactStemSeen.get(exactKey), 'exact_stem', 1.0, q.source?.file);
    } else {
      exactStemSeen.set(exactKey, q.question_id);
    }

    // Layer 3 prep: skip short boilerplate image questions for text-only fuzzy matching
    const plain = stripHtmlForFuzzy(q.stem);
    if (plain.length >= 20 && (!q.image_refs || q.image_refs.length === 0)) {
      fuzzyItems.push({
        question_id: q.question_id,
        source_file: q.source?.file || '',
        grams: buildNgrams(plain, ngramSize),
      });
    }
  }

  // Layer 3: Bucketed n-gram similarity
  const buckets = new Map();
  for (let i = 0; i < fuzzyItems.length; i += 1) {
    const item = fuzzyItems[i];
    // Pick up to 4 anchor n-grams deterministically
    const anchors = [];
    let step = Math.max(1, Math.floor(item.grams.size / 4));
    let idx = 0;
    for (const g of item.grams) {
      if (idx % step === 0 && anchors.length < 4) anchors.push(g);
      idx += 1;
    }
    for (const a of anchors) {
      let arr = buckets.get(a);
      if (!arr) {
        arr = [];
        buckets.set(a, arr);
      }
      if (arr.length < maxBucket) {
        arr.push(i);
      }
    }
  }

  const comparedPairs = new Set();
  for (const indices of buckets.values()) {
    if (indices.length < 2) continue;
    for (let a = 0; a < indices.length; a += 1) {
      for (let b = a + 1; b < indices.length; b += 1) {
        const i = indices[a];
        const j = indices[b];
        const key = i < j ? `${i}:${j}` : `${j}:${i}`;
        if (comparedPairs.has(key)) continue;
        comparedPairs.add(key);

        const itemA = fuzzyItems[i];
        const itemB = fuzzyItems[j];
        if (itemA.question_id === itemB.question_id) continue;
        // Quick size bound for Jaccard
        const minLen = Math.min(itemA.grams.size, itemB.grams.size);
        const maxLen = Math.max(itemA.grams.size, itemB.grams.size);
        if (maxLen > 0 && minLen / maxLen < minSim) continue;

        const sim = jaccard(itemA.grams, itemB.grams);
        if (sim >= minSim) {
          addDuplicate(itemA.question_id, itemB.question_id, 'fuzzy_stem', sim, itemA.source_file);
        }
      }
    }
  }

  // Layer 4: Image SHA256 duplicates
  const imgHashGroups = new Map();
  try {
    await fs.access(imagesPath);
    for await (const img of readJsonlStream(imagesPath)) {
      if (!img.file_hash) continue;
      let list = imgHashGroups.get(img.file_hash);
      if (!list) {
        list = [];
        imgHashGroups.set(img.file_hash, list);
      }
      list.push(img);
    }
  } catch {
    // ignore if images.jsonl missing
  }

  const dupImages = [];
  for (const [hash, list] of imgHashGroups.entries()) {
    if (list.length > 1) {
      dupImages.push({ file_hash: hash, count: list.length, paths: list.map((x) => x.original_path) });
    }
  }

  if (!dryRun) {
    const reportsDir = resolveProjectPath('reports');
    await fs.mkdir(reportsDir, { recursive: true });
    const header = 'question_id,duplicate_question_id,duplicate_type,similarity,source_file,review_status';
    const lines = [header];
    for (const d of duplicates) {
      lines.push(
        [
          csvEscape(d.question_id),
          csvEscape(d.duplicate_question_id),
          csvEscape(d.duplicate_type),
          d.similarity,
          csvEscape(d.source_file),
          csvEscape(d.review_status),
        ].join(',')
      );
    }
    await fs.writeFile(path.join(reportsDir, 'duplicate_questions.csv'), lines.join('\n'), 'utf8');
  }

  const summary = {
    total_duplicate_question_pairs: duplicates.length,
    duplicate_image_hashes: dupImages.length,
    by_type: duplicates.reduce((acc, d) => {
      acc[d.duplicate_type] = (acc[d.duplicate_type] || 0) + 1;
      return acc;
    }, {}),
  };
  log.info(summary, 'Deduplication finished');
  return summary;
}
