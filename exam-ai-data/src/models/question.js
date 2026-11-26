import { shortHash } from '../utils/hash.js';

/**
 * Build a deterministic, globally unique Question ID per paper occurrence.
 * Preserves source_qid for traceability while disambiguating cross-paper reuse (e.g. 联考/国考多卷).
 */
export function buildQuestionId({ year, source_qid, paper_id, module, question_number, anchor }) {
  const y = year || '0000';
  const paperTag = shortHash(`${paper_id}::${module}::${question_number}`).slice(0, 6);
  if (source_qid) {
    return `Q-${y}-${source_qid}-${paperTag}`;
  }
  return `Q-${y}-${shortHash(`${paper_id}::${module}::${question_number}::${anchor}`)}`;
}

export function createQuestion({
  question_id,
  source_qid = null,
  paper_id,
  year = null,
  exam_type = 'unknown',
  province = null,
  module,
  question_number = null,
  question_type = 'unknown',
  stem = '',
  options = {},
  official_answer = null,
  official_explanation = null,
  material_id = null,
  image_refs = [],
  source = { file: '', anchor: '' },
  quality = {
    parse_status: 'success',
    validation_status: 'pending',
    answer_status: 'unverified',
  },
}) {
  return {
    question_id,
    source_qid,
    paper_id,
    year,
    exam_type,
    province,
    module,
    question_number,
    question_type,
    stem,
    options,
    official_answer,
    official_explanation,
    material_id,
    image_refs,
    source,
    quality,
  };
}
