const IMG_TAG_RE = /<img\b|!\[[^\]]*\]\([^)]+\)|!\[\[[^\]]+\]\]/i;
const FORMULA_IMG_RE = /flag=["']tex["']|公式图/i;

/**
 * Strip HTML <p> wrappers from pure text if needed? No, only detect image tags here.
 */
export function classifyQuestion(question, material, imageMap, cfg = {}) {
  const version = cfg.classification_version || '1.0.0';
  const rules = cfg.rules || {};

  const stem = question.stem || '';
  const options = question.options || {};
  const explanation = question.official_explanation || '';
  const matContent = material?.content || '';

  const relatedIdsSet = new Set([
    ...(question.image_refs || []),
    ...(material?.images || []),
  ]);

  let hasQuestionImage = IMG_TAG_RE.test(stem);
  let hasOptionImage = Object.values(options).some((v) => IMG_TAG_RE.test(v || ''));
  let hasMaterialImage = Boolean(
    (material?.images && material.images.length > 0) || IMG_TAG_RE.test(matContent)
  );
  let hasFormulaImage =
    FORMULA_IMG_RE.test(stem) ||
    Object.values(options).some((v) => FORMULA_IMG_RE.test(v || '')) ||
    FORMULA_IMG_RE.test(matContent) ||
    FORMULA_IMG_RE.test(explanation);

  let missingImageFile = false;
  for (const imgId of relatedIdsSet) {
    const img = imageMap.get(imgId);
    if (!img || img.exists === false) {
      missingImageFile = true;
    } else {
      if (img.image_type === 'formula_image') hasFormulaImage = true;
      else if (img.image_type === 'option_image') hasOptionImage = true;
      else if (img.image_type === 'material_image' || img.image_type === 'chart_image') {
        hasMaterialImage = true;
      } else if (img.image_type === 'question_image') {
        hasQuestionImage = true;
      }
    }
  }

  const relatedImageIds = [...relatedIdsSet];
  const baseMeta = {
    has_question_image: hasQuestionImage,
    has_option_image: hasOptionImage,
    has_material_image: hasMaterialImage,
    has_formula_image: hasFormulaImage,
    related_image_ids: relatedImageIds,
    classification_version: version,
  };

  // 1. Hard quality rejections
  if (!stem.trim()) {
    return {
      ...baseMeta,
      dataset_type: 'rejected',
      classification_status: 'rejected',
      classification_reason: 'empty_stem',
    };
  }
  if (rules.reject_masked_stem !== false && /\*{4,}/.test(stem)) {
    return {
      ...baseMeta,
      dataset_type: 'review',
      classification_status: 'review',
      classification_reason: 'masked_or_truncated_stem',
    };
  }

  // 2. Material integrity check
  if (question.material_id && (!material || !matContent.trim())) {
    return {
      ...baseMeta,
      dataset_type: 'review',
      classification_status: 'review',
      classification_reason: 'missing_or_empty_material',
    };
  }

  // 3. Options & Answer integrity check
  const optKeys = Object.keys(options);
  if (rules.require_non_empty_options !== false && optKeys.length === 0) {
    return {
      ...baseMeta,
      dataset_type: 'review',
      classification_status: 'review',
      classification_reason: 'empty_options',
    };
  }
  if (rules.require_valid_answer !== false) {
    if (!question.official_answer) {
      return {
        ...baseMeta,
        dataset_type: 'review',
        classification_status: 'review',
        classification_reason: 'missing_answer',
      };
    }
    if (optKeys.length > 0) {
      const optSet = new Set(optKeys);
      const allValid = question.official_answer.split('').every((c) => optSet.has(c));
      if (!allValid) {
        return {
          ...baseMeta,
          dataset_type: 'review',
          classification_status: 'review',
          classification_reason: 'answer_not_in_options',
        };
      }
    }
  }

  // 4. Missing image file check
  if (missingImageFile) {
    return {
      ...baseMeta,
      dataset_type: 'review',
      classification_status: 'review',
      classification_reason: 'missing_image_file',
    };
  }

  // 5. Multimodal rules
  const graphicalTypes = rules.graphical_question_types || ['图形推理'];
  if (graphicalTypes.some((t) => (question.question_type || '').includes(t))) {
    return {
      ...baseMeta,
      dataset_type: 'multimodal',
      classification_status: 'classified',
      classification_reason: 'graphical_reasoning_question',
    };
  }
  if (hasOptionImage && !rules.allow_option_images_in_text_only) {
    return {
      ...baseMeta,
      dataset_type: 'multimodal',
      classification_status: 'classified',
      classification_reason: 'contains_option_image',
    };
  }
  if (hasMaterialImage && !rules.allow_material_images_in_text_only) {
    return {
      ...baseMeta,
      dataset_type: 'multimodal',
      classification_status: 'classified',
      classification_reason: 'contains_material_image',
    };
  }
  if (hasQuestionImage && !rules.allow_question_images_in_text_only) {
    return {
      ...baseMeta,
      dataset_type: 'multimodal',
      classification_status: 'classified',
      classification_reason: 'contains_question_image',
    };
  }
  if (hasFormulaImage && !rules.allow_formula_images_in_text_only) {
    return {
      ...baseMeta,
      dataset_type: 'multimodal',
      classification_status: 'classified',
      classification_reason: 'contains_formula_image',
    };
  }

  // 6. Clean text-only
  const reason = question.material_id
    ? 'text_only_with_complete_text_material'
    : 'text_only_complete';

  return {
    ...baseMeta,
    dataset_type: 'text-only',
    classification_status: 'classified',
    classification_reason: reason,
  };
}
