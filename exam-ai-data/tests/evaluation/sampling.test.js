import { describe, it, expect } from 'vitest';
import { selectEvaluationPapers } from '../../src/evaluation/evaluation-sampler.js';

describe('Evaluation Paper Sampler', () => {
  const questions = [];
  for (let p = 1; p <= 10; p += 1) {
    for (let i = 1; i <= 5; i += 1) {
      questions.push({
        question_id: `Q-${p}-${i}`,
        paper_id: `P-${p}`,
        year: 2020 + (p % 6),
        province: p % 2 === 0 ? '云南' : '四川',
        module: i % 2 === 0 ? 'data_analysis' : 'verbal_comprehension',
        material_id: i <= 2 ? `MAT-${p}` : null,
      });
    }
  }

  it('excludes training papers, material overlaps, and duplicate-overlapping papers', () => {
    const res = selectEvaluationPapers({
      questions,
      excludedPaperIds: new Set(['P-1', 'P-2']),
      excludedMaterialIds: new Set(['MAT-3']),
      duplicateOverlappingQids: new Set(['Q-4-3']),
      targetSize: 20,
      seed: 123,
    });

    const selectedPids = new Set(res.selectedPapers.map((p) => p.paper_id));
    expect(selectedPids.has('P-1')).toBe(false);
    expect(selectedPids.has('P-2')).toBe(false);
    expect(selectedPids.has('P-3')).toBe(false);
    expect(selectedPids.has('P-4')).toBe(false);
    expect(res.totalCleanPapers).toBe(6);
  });

  it('is deterministic for the same seed and keeps whole papers intact', () => {
    const opts = {
      questions,
      excludedPaperIds: new Set(['P-1']),
      excludedMaterialIds: new Set(),
      duplicateOverlappingQids: new Set(),
      targetSize: 15,
      seed: 999,
    };
    const r1 = selectEvaluationPapers(opts);
    const r2 = selectEvaluationPapers(opts);
    expect(r1.selectedQuestions.map((q) => q.question_id)).toEqual(
      r2.selectedQuestions.map((q) => q.question_id)
    );
    // Whole papers: each selected paper has all 5 questions
    for (const p of r1.selectedPapers) {
      const countInQ = r1.selectedQuestions.filter((q) => q.paper_id === p.paper_id).length;
      expect(countInQ).toBe(5);
    }
  });
});
