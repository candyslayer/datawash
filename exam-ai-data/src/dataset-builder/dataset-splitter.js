/**
 * Deterministic seeded PRNG (Mulberry32).
 */
export function createSeededRng(seed = 20261126) {
  let a = seed >>> 0;
  return function rng() {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class DisjointSet {
  constructor(n) {
    this.parent = Array.from({ length: n }, (_, i) => i);
    this.size = Array(n).fill(1);
  }
  find(x) {
    while (this.parent[x] !== x) {
      this.parent[x] = this.parent[this.parent[x]];
      x = this.parent[x];
    }
    return x;
  }
  union(a, b) {
    let ra = this.find(a);
    let rb = this.find(b);
    if (ra === rb) return;
    if (this.size[ra] < this.size[rb]) [ra, rb] = [rb, ra];
    this.parent[rb] = ra;
    this.size[ra] += this.size[rb];
  }
}

/**
 * Group questions by paper_id, material_id, and (optionally) duplicate pairs
 * so no paper or material ever leaks across train/validation/test.
 *
 * @param {Array<any>} questions
 * @param {{ ratios?: { train: number, validation: number, test: number }, seed?: number, duplicatePairs?: Array<[string, string]> }} opts
 */
export function splitQuestionsGrouped(questions, opts = {}) {
  const ratios = opts.ratios || { train: 0.8, validation: 0.1, test: 0.1 };
  const seed = opts.seed ?? 20261126;
  const rng = createSeededRng(seed);

  const n = questions.length;
  if (n === 0) {
    return {
      assignments: new Map(),
      splitPaperIds: { train: [], validation: [], test: [] },
      actualRatios: { train: 0, validation: 0, test: 0 },
    };
  }

  const dsu = new DisjointSet(n);
  const qidToIdx = new Map();
  const paperFirstIdx = new Map();
  const matFirstIdx = new Map();

  for (let i = 0; i < n; i += 1) {
    const q = questions[i];
    qidToIdx.set(q.question_id, i);

    if (paperFirstIdx.has(q.paper_id)) {
      dsu.union(i, paperFirstIdx.get(q.paper_id));
    } else {
      paperFirstIdx.set(q.paper_id, i);
    }

    if (q.material_id) {
      if (matFirstIdx.has(q.material_id)) {
        dsu.union(i, matFirstIdx.get(q.material_id));
      } else {
        matFirstIdx.set(q.material_id, i);
      }
    }
  }

  // Merge duplicate pairs only if resulting group stays under 8% of total dataset
  // (prevents giant cross-province 联考 chains from collapsing all papers into 1 split)
  const maxMergedGroupSize = Math.max(50, Math.floor(n * 0.08));
  if (Array.isArray(opts.duplicatePairs)) {
    for (const [idA, idB] of opts.duplicatePairs) {
      const idxA = qidToIdx.get(idA);
      const idxB = qidToIdx.get(idB);
      if (idxA === undefined || idxB === undefined) continue;
      const ra = dsu.find(idxA);
      const rb = dsu.find(idxB);
      if (ra !== rb && dsu.size[ra] + dsu.size[rb] <= maxMergedGroupSize) {
        dsu.union(ra, rb);
      }
    }
  }

  // Collect groups
  const groupsMap = new Map();
  for (let i = 0; i < n; i += 1) {
    const r = dsu.find(i);
    let grp = groupsMap.get(r);
    if (!grp) {
      grp = { root: r, indices: [], paperIds: new Set(), rand: rng() };
      groupsMap.set(r, grp);
    }
    grp.indices.push(i);
    grp.paperIds.add(questions[i].paper_id);
  }

  // Sort deterministically by size desc then seeded random tie-breaker
  const groups = [...groupsMap.values()].sort((a, b) => {
    if (b.indices.length !== a.indices.length) return b.indices.length - a.indices.length;
    return a.rand - b.rand;
  });

  const target = {
    train: n * ratios.train,
    validation: n * ratios.validation,
    test: n * ratios.test,
  };
  const counts = { train: 0, validation: 0, test: 0 };
  const splitPaperIds = { train: new Set(), validation: new Set(), test: new Set() };
  const assignments = new Map();

  for (const grp of groups) {
    // Pick split with largest relative deficit (target - current) / target
    let bestSplit = 'train';
    let bestScore = -Infinity;
    for (const splitName of ['train', 'validation', 'test']) {
      const t = target[splitName] || 1;
      const score = (t - counts[splitName]) / t;
      if (score > bestScore) {
        bestScore = score;
        bestSplit = splitName;
      }
    }

    counts[bestSplit] += grp.indices.length;
    for (const pid of grp.paperIds) splitPaperIds[bestSplit].add(pid);
    for (const idx of grp.indices) {
      assignments.set(questions[idx].question_id, bestSplit);
    }
  }

  return {
    assignments,
    splitPaperIds: {
      train: [...splitPaperIds.train].sort(),
      validation: [...splitPaperIds.validation].sort(),
      test: [...splitPaperIds.test].sort(),
    },
    actualRatios: {
      train: Number((counts.train / n).toFixed(4)),
      validation: Number((counts.validation / n).toFixed(4)),
      test: Number((counts.test / n).toFixed(4)),
    },
  };
}
