import { describe, it, expect } from 'vitest';
import { formatEvalQuestion } from '../../src/evaluation/evaluation-builder.js';

describe('Material Isolation & Completeness', () => {
  it('embeds full material text into evaluation question without splitting material', () => {
    const mat = {
      material_id: 'MAT-2026-1',
      content: '<p>2025年全国粮食总产量70650万吨，比上年增长1.6%。</p>',
    };
    const q = {
      question_id: 'Q-2026-201',
      module: 'data_analysis',
      year: 2026,
      exam_type: 'national',
      province: null,
      question_type: '增长',
      material_id: 'MAT-2026-1',
      stem: '2024年全国粮食总产量约为多少万吨？',
      options: { A: '68500', B: '69537', C: '70100', D: '71200' },
    };

    const evalQ = formatEvalQuestion(q, mat);
    expect(evalQ.material_id).toBe('MAT-2026-1');
    expect(evalQ.material).toContain('70650万吨');
    expect(evalQ.material).toContain('1.6%');
  });
});
