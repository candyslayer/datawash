import crypto from 'node:crypto';
import fs from 'node:fs';

/**
 * Compute SHA-256 hex digest of a UTF-8 string.
 * @param {string} text
 * @returns {string}
 */
export function sha256Text(text) {
  return crypto.createHash('sha256').update(text ?? '', 'utf8').digest('hex');
}

/**
 * Compute short deterministic ID hash (first 12 hex chars).
 * @param {string} input
 * @returns {string}
 */
export function shortHash(input) {
  return sha256Text(input).slice(0, 12);
}

/**
 * Streamingly compute SHA-256 hex digest of a file without loading it all into memory.
 * @param {string} filePath
 * @returns {Promise<string>}
 */
export function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}
