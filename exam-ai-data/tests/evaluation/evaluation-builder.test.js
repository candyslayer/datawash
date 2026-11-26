import { describe, it, expect } from 'vitest';
import { formatEvalQuestion, formatAnswerKey } from '../../src/evaluation/evaluation-builder.js';

describe('Evaluation Builder Formatting', () => {
  const q = {
    question_id: 'Q-2026-100',
    paper_id: 'P-2026-1',
    module: 'quantitative_reasoning',
    year: 2026,
    exam_type: 'national',
    province: null,
    question_type: '数学运算',
    material_id: null,
    stem: '某商品原价100元，先涨价20%，再降价20%，现价是多少？',
    options: { A: '96元', B: '98元', C: '100元', D: '102元' },
    official_answer: 'A',
    official_explanation: '100×1.2×0.8=96元。',
  };

  it('strips official_answer and official_explanation from questions.jsonl', () => {
    const evalQ = formatEvalQuestion(q, null);
    expect(evalQ).not.toHaveProperty('official_answer');
    expect(evalQ).not.toHaveProperty('official_explanation');
    expect(evalQ.options).toEqual([
      { label: 'A', content: '96元' },
      { label: 'B', content: '98元' },
      { label: 'C', content: '100元' },
      { label: 'D', content: '102元' },
    ]);
  });

  it('retains answer and explanation in answer-key.jsonl', () => {
    const ak = formatAnswerKey(q);
    expect(ak.question_id).toBe('Q-2026-100');
    expect(ak.official_answer).toBe('A');
    expect(ak.official_explanation).toContain('96元');
    expect(ak.paper_id).toBe('P-2026-1');
  });
});
