import { shortHash } from '../utils/hash.js';

/**
 * Build a deterministic Material ID from paper_id, module, and anchor.
 * @param {string} paperId
 * @param {string} moduleName
 * @param {string} anchor
 * @returns {string}
 */
export function buildMaterialId(paperId, moduleName, anchor) {
  return `MAT-${shortHash(`${paperId}::${moduleName}::${anchor}`)}`;
}

export function createMaterial({
  material_id,
  paper_id,
  module,
  content,
  raw_content,
  images = [],
  source_file,
  source_anchor,
}) {
  return {
    material_id,
    paper_id,
    module,
    content,
    raw_content,
    images,
    source_file,
    source_anchor,
  };
}
