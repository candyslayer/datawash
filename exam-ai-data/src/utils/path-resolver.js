import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

/**
 * Normalize path separators to POSIX forward slashes for portable traceability.
 * @param {string} p
 * @returns {string}
 */
export function toPosixPath(p) {
  return String(p || '').replace(/\\/g, '/');
}

/**
 * Resolve an image reference relative to a Markdown file's directory inside sourceRoot.
 * @param {string} sourceRoot
 * @param {string} mdRelativePath
 * @param {string} imgRef
 * @returns {string} POSIX relative path from sourceRoot
 */
export function resolveImageRelativePath(sourceRoot, mdRelativePath, imgRef) {
  const cleanRef = imgRef.trim().replace(/^<|>$/g, '');
  const mdDir = path.dirname(path.resolve(sourceRoot, mdRelativePath));
  const resolved = path.resolve(mdDir, cleanRef);
  return toPosixPath(path.relative(sourceRoot, resolved));
}

export function resolveProjectPath(...segments) {
  return path.resolve(PROJECT_ROOT, ...segments);
}
