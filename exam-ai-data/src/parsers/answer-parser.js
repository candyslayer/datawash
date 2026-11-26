const MISSING_TOKENS = new Set(['（缺）', '(缺)', '缺', '暂无', '无', '']);

/**
 * Parse an answer paragraph raw text like "**答案**：D" or "**答案**：（缺）".
 * @param {string} rawParagraph
 * @returns {{ matched: boolean, answer: string|null, status: 'present'|'missing' }}
 */
export function parseAnswerParagraph(rawParagraph) {
  if (!rawParagraph) return { matched: false, answer: null, status: 'missing' };
  const trimmed = rawParagraph.trim();
  const m = trimmed.match(/^\*\*答案\*\*\s*[：:]\s*([\s\S]*)$/);
  if (!m) {
    return { matched: false, answer: null, status: 'missing' };
  }
  const ansRaw = m[1].trim();
  if (MISSING_TOKENS.has(ansRaw)) {
    return { matched: true, answer: null, status: 'missing' };
  }
  return { matched: true, answer: ansRaw, status: 'present' };
}
