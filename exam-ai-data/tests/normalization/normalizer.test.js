import { describe, it, expect } from 'vitest';
import { normalizeText } from '../../src/normalization/text-normalizer.js';
import { normalizeOptions } from '../../src/normalization/option-normalizer.js';

describe('Normalization', () => {
  it('preserves math symbols, percentages, negative signs, units, and negations', () => {
    const s1 = normalizeText('  增长 10.5%，下降 -3.2%  \r\n  下列说法不正确的是：  ');
    expect(s1).toBe('增长 10.5%，下降 -3.2%\n  下列说法不正确的是：');
    expect(s1).toContain('%');
    expect(s1).toContain('-3.2%');
    expect(s1).toContain('不正确');
  });

  it('normalizes option keys without dropping extra options', () => {
    const opts = normalizeOptions({ a: '  选项一 ', b: '选项二', e: '选项五' });
    expect(opts).toEqual({ A: '选项一', B: '选项二', E: '选项五' });
  });
});
