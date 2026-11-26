import { createSeededRng } from '../dataset-builder/dataset-splitter.js';

/**
 * Filter candidate papers that are completely isolated from training & validation,
 * and stratified-sample complete papers up to ~targetSize.
 *
 * @param {{
 *   questions: Array<any>,
 *   excludedPaperIds: Set<string>,
 *   excludedMaterialIds: Set<string>,
 *   duplicateOverlappingQids: Set<string>,
 *   excludeDuplicateOverlappingPapers?: boolean,
 *   targetSize?: number,
 *   seed?: number,
 * }} params
 */
export function selectEvaluationPapers({
  questions,
  excludedPaperIds,
  excludedMaterialIds,
  duplicateOverlappingQids,
  excludeDuplicateOverlappingPapers = true,
  targetSize = 2000,
  seed = 20261126,
}) {
  const rng = createSeededRng(seed);

  // Group all candidate questions by paper_id
  const paperGroups = new Map();
  const dirtyPapers = new Set();

  for (const q of questions) {
    if (excludedPaperIds.has(q.paper_id)) {
      dirtyPapers.add(q.paper_id);
      continue;
    }
    if (q.material_id && excludedMaterialIds.has(q.material_id)) {
      dirtyPapers.add(q.paper_id);
      continue;
    }
    if (excludeDuplicateOverlappingPapers && duplicateOverlappingQids.has(q.question_id)) {
      dirtyPapers.add(q.paper_id);
      continue;
    }
    let grp = paperGroups.get(q.paper_id);
    if (!grp) {
      grp = {
        paper_id: q.paper_id,
        year: q.year || 0,
        province: q.province || 'none',
        exam_type: q.exam_type || 'unknown',
        modules: new Set(),
        questions: [],
        rand: rng(),
      };
      paperGroups.set(q.paper_id, grp);
    }
    grp.modules.add(q.module);
    grp.questions.push(q);
  }

  // Remove any paper that was marked dirty by another question in the same paper
  const cleanPapers = [];
  for (const [pid, grp] of paperGroups.entries()) {
    if (dirtyPapers.has(pid)) continue;
    cleanPapers.push(grp);
  }

  // Sort candidates: prefer papers with more distinct modules, newer years, then seeded random
  cleanPapers.sort((a, b) => {
    if (b.modules.size !== a.modules.size) return b.modules.size - a.modules.size;
    if (b.year !== a.year) return b.year - a.year;
    return a.rand - b.rand;
  });

  const selectedPapers = [];
  const selectedQuestions = [];
  const coveredModules = new Set();
  const coveredProvinces = new Set();

  // First pass: greedily pick papers that maximize module/province diversity without exceeding targetSize + 150
  const maxCeiling = targetSize + 150;
  const remaining = [];

  for (const p of cleanPapers) {
    if (selectedQuestions.length >= targetSize) {
      remaining.push(p);
      continue;
    }
    const addsNewModule = [...p.modules].some((m) => !coveredModules.has(m));
    const addsNewProvince = !coveredProvinces.has(p.province);
    if (
      (addsNewModule || addsNewProvince) &&
      selectedQuestions.length + p.questions.length <= maxCeiling
    ) {
      selectedPapers.push(p);
      selectedQuestions.push(...p.questions);
      for (const m of p.modules) coveredModules.add(m);
      coveredProvinces.add(p.province);
    } else {
      remaining.push(p);
    }
  }

  // Second pass: fill up to ~targetSize with remaining clean papers (preferring newer years)
  for (const p of remaining) {
    if (selectedQuestions.length >= targetSize) break;
    if (selectedQuestions.length + p.questions.length <= maxCeiling) {
      selectedPapers.push(p);
      selectedQuestions.push(...p.questions);
    }
  }

  // Sort selectedQuestions deterministically by paper_id, module, question_number
  selectedQuestions.sort((a, b) => {
    if (a.paper_id !== b.paper_id) return a.paper_id.localeCompare(b.paper_id);
    if (a.module !== b.module) return a.module.localeCompare(b.module);
    return (a.question_number || 0) - (b.question_number || 0);
  });

  return {
    totalCleanPapers: cleanPapers.length,
    totalCleanQuestions: cleanPapers.reduce((acc, p) => acc + p.questions.length, 0),
    selectedPapers,
    selectedQuestions,
  };
}
