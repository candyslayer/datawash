import { shortHash } from '../utils/hash.js';

/**
 * Build a deterministic Paper ID from year and paper name.
 * @param {number|null} year
 * @param {string} paperName
 * @returns {string}
 */
export function buildPaperId(year, paperName) {
  const y = year || '0000';
  return `P-${y}-${shortHash(paperName).slice(0, 8)}`;
}

export function createPaper({
  paper_id,
  year = null,
  exam_type = 'unknown',
  province = null,
  paper_name,
  source_file,
  source_files = [],
  modules = [],
  source_metadata = {},
}) {
  return {
    paper_id,
    year,
    exam_type,
    province,
    paper_name,
    source_file,
    source_files: source_files.length ? source_files : [source_file],
    modules,
    source_metadata,
  };
}
