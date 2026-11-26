/**
 * Normalize text without destroying math symbols, percentages, units, numbers,
 * negation words, or punctuation.
 * @param {string|null} text
 * @returns {string}
 */
export function normalizeText(text) {
  if (text == null) return '';
  return String(text)
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\u00A0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
