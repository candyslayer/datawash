import { describe, it, expect } from 'vitest';
import { buildSftSample, isValidExplanation } from '../../src/dataset-builder/conversation-builder.js';

describe('SFT Conversation Builder', () => {
  const q = {
    question_id: 'Q-2025-1',
    source_qid: '1',
    paper_id: 'P-2025-1',
    material_id: 'MAT-1',
    module: 'data_analysis',
    year: 2025,
    province: null,
    stem: '2024年同比增长率为多少？',
    options: { A: '10%', B: '12%', C: '15%', D: '20%' },
    official_answer: 'B',
    official_explanation: '根据公式计算可得 12%。',
    source: { file: '06-资料分析/2025国考.md' },
  };
  const mat = { material_id: 'MAT-1', content: '<p>2024年产值112亿元，上年100亿元。</p>' };

  it('assembles material into user.content for data_analysis without leaking answer', () => {
    const sample = buildSftSample({ taskType: 'answer', question: q, material: mat });
    expect(sample.messages).toHaveLength(3);
    expect(sample.messages[1].content).toContain('【材料】');
    expect(sample.messages[1].content).toContain('112亿元');
    expect(sample.messages[1].content).not.toContain('【正确答案】');
    expect(sample.messages[2].content).toBe('B');
    expect(sample.metadata.task_type).toBe('answer');
  });

  it('builds explanation sample and rejects placeholder explanations like 略。', () => {
    const expSample = buildSftSample({ taskType: 'explanation', question: q, material: mat });
    expect(expSample.messages[2].content).toContain('【正确答案】B');
    expect(expSample.messages[2].content).toContain('【解析】根据公式计算可得 12%。');

    expect(isValidExplanation('略。')).toBe(false);
    expect(isValidExplanation('根据公式计算可得 12%。')).toBe(true);
  });
});
