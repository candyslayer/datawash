import { shortHash } from '../utils/hash.js';

export function buildImageId(originalPath) {
  return `IMG-${shortHash(originalPath)}`;
}

export function createImage({
  image_id,
  original_path,
  normalized_path = null,
  image_type = 'unknown',
  related_question_ids = [],
  related_material_ids = [],
  file_hash = null,
  exists = false,
  mime_type = null,
  width = null,
  height = null,
}) {
  return {
    image_id,
    original_path,
    normalized_path,
    image_type,
    related_question_ids,
    related_material_ids,
    file_hash,
    exists,
    mime_type,
    width,
    height,
  };
}
