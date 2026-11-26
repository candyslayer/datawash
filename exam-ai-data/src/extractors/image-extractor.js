import { resolveImageRelativePath } from '../utils/path-resolver.js';
import { buildImageId } from '../models/image.js';

/**
 * Classify image type from context and path.
 * @param {{ context: 'stem'|'option'|'material'|'explanation', isFormula: boolean, resolvedPath: string, moduleId: string }} params
 * @returns {'question_image'|'option_image'|'material_image'|'formula_image'|'chart_image'|'unknown'}
 */
export function classifyImageType({ context, isFormula, resolvedPath, moduleId }) {
  if (isFormula || resolvedPath.includes('公式图')) {
    return 'formula_image';
  }
  if (context === 'option') {
    return 'option_image';
  }
  if (context === 'material') {
    if (moduleId === 'data_analysis') return 'chart_image';
    return 'material_image';
  }
  if (context === 'stem' || context === 'explanation') {
    return 'question_image';
  }
  return 'unknown';
}

/**
 * Resolve extracted image tags into structured ImageRef objects.
 */
export function resolveEntityImages({
  sourceRoot,
  relPath,
  tags,
  context,
  moduleId,
  questionId = null,
  materialId = null,
}) {
  const refs = [];
  for (const tag of tags) {
    const resolvedPath = resolveImageRelativePath(sourceRoot, relPath, tag.src);
    const imageId = buildImageId(resolvedPath);
    const imageType = classifyImageType({
      context,
      isFormula: tag.isFormula,
      resolvedPath,
      moduleId,
    });
    refs.push({
      image_id: imageId,
      original_path: resolvedPath,
      raw_src: tag.src,
      image_type: imageType,
      question_id: questionId,
      material_id: materialId,
    });
  }
  return refs;
}
