import { describe, it, expect } from 'vitest';
import { cleanTextForPrompt } from '../../src/dataset-builder/conversation-builder.js';

describe('Dataset Validator Helpers', () => {
  it('cleans HTML paragraph wrappers while preserving math and units', () => {
    const cleaned = cleanTextForPrompt('<p>增长率 -5.2%，同比增加 10%</p><p>第二段</p>');
    expect(cleaned).toBe('增长率 -5.2%，同比增加 10%\n第二段');
  });
});
