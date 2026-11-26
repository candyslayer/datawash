import { normalizeText } from './text-normalizer.js';

/**
 * Normalize question options object: uppercase keys (A, B, C, ...), clean whitespace.
 * Preserves arbitrary option counts (0, 2, 4, 5, 8, etc.).
 * @param {Record<string, string>} options
 * @returns {Record<string, string>}
 */
export function normalizeOptions(options) {
  if (!options || typeof options !== 'object') return {};
  const out = {};
  for (const [k, v] of Object.entries(options)) {
    const cleanKey = String(k).trim().toUpperCase();
    out[cleanKey] = normalizeText(v);
  }
  return out;
}
