import { describe, it, expect } from 'vitest';
import { splitQuestionsGrouped } from '../../src/dataset-builder/dataset-splitter.js';

describe('Grouped Dataset Splitter', () => {
  it('never splits the same paper_id or material_id across train/validation/test and is reproducible', () => {
    const questions = [];
    for (let p = 1; p <= 20; p += 1) {
      for (let i = 1; i <= 5; i += 1) {
        questions.push({
          question_id: `Q-${p}-${i}`,
          paper_id: `P-${p}`,
          material_id: i <= 3 ? `MAT-${p}` : null,
        });
      }
    }

    const res1 = splitQuestionsGrouped(questions, { seed: 42 });
    const res2 = splitQuestionsGrouped(questions, { seed: 42 });

    expect([...res1.assignments.entries()]).toEqual([...res2.assignments.entries()]);

    const trainSet = new Set(res1.splitPaperIds.train);
    const valSet = new Set(res1.splitPaperIds.validation);
    const testSet = new Set(res1.splitPaperIds.test);

    for (const pid of trainSet) {
      expect(valSet.has(pid)).toBe(false);
      expect(testSet.has(pid)).toBe(false);
    }
    for (const pid of valSet) {
      expect(testSet.has(pid)).toBe(false);
    }
  });
});
