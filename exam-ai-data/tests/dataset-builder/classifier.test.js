import { describe, it, expect } from 'vitest';
import { classifyQuestion } from '../../src/dataset-builder/dataset-classifier.js';

const baseCfg = {
  classification_version: '1.0.0',
  rules: {
    graphical_question_types: ['图形推理'],
    require_non_empty_stem: true,
    require_non_empty_options: true,
    require_valid_answer: true,
    reject_masked_stem: true,
    allow_formula_images_in_text_only: false,
    allow_material_images_in_text_only: false,
    allow_option_images_in_text_only: false,
    allow_question_images_in_text_only: false,
  },
};

const imgMap = new Map([
  ['IMG-Q1', { image_id: 'IMG-Q1', image_type: 'question_image', exists: true }],
  ['IMG-OPT1', { image_id: 'IMG-OPT1', image_type: 'option_image', exists: true }],
  ['IMG-MAT1', { image_id: 'IMG-MAT1', image_type: 'chart_image', exists: true }],
  ['IMG-TEX1', { image_id: 'IMG-TEX1', image_type: 'formula_image', exists: true }],
  ['IMG-MISS', { image_id: 'IMG-MISS', image_type: 'question_image', exists: false }],
]);

const baseQ = {
  question_id: 'Q-1',
  paper_id: 'P-1',
  module: 'quantitative_reasoning',
  question_type: '数学运算',
  stem: '某商品原价100元，先涨价20%，再降价20%，现价是多少？',
  options: { A: '96元', B: '98元', C: '100元', D: '102元' },
  official_answer: 'A',
  official_explanation: '100×1.2×0.8=96元。',
  material_id: null,
  image_refs: [],
};

describe('Dataset Classifier', () => {
  it('classifies clean text-only and LaTeX questions as text-only', () => {
    const res = classifyQuestion(baseQ, null, imgMap, baseCfg);
    expect(res.dataset_type).toBe('text-only');
    expect(res.classification_status).toBe('classified');

    const latexQ = { ...baseQ, stem: '已知 $x^2 + y^2 = 25$，求最大值：' };
    expect(classifyQuestion(latexQ, null, imgMap, baseCfg).dataset_type).toBe('text-only');
  });

  it('classifies data_analysis with pure text material as text-only, and material image as multimodal', () => {
    const textMat = { material_id: 'MAT-1', content: '2022年全国GDP为121万亿元。', images: [] };
    const qMatText = { ...baseQ, module: 'data_analysis', material_id: 'MAT-1' };
    expect(classifyQuestion(qMatText, textMat, imgMap, baseCfg).dataset_type).toBe('text-only');

    const imgMat = { material_id: 'MAT-2', content: '<p>见下图</p>', images: ['IMG-MAT1'] };
    const qMatImg = { ...baseQ, module: 'data_analysis', material_id: 'MAT-2' };
    const resImg = classifyQuestion(qMatImg, imgMat, imgMap, baseCfg);
    expect(resImg.dataset_type).toBe('multimodal');
    expect(resImg.has_material_image).toBe(true);
  });

  it('classifies stem image, option image, formula image, and graphical reasoning as multimodal', () => {
    expect(
      classifyQuestion({ ...baseQ, image_refs: ['IMG-Q1'] }, null, imgMap, baseCfg).dataset_type
    ).toBe('multimodal');
    expect(
      classifyQuestion({ ...baseQ, image_refs: ['IMG-OPT1'] }, null, imgMap, baseCfg).dataset_type
    ).toBe('multimodal');
    expect(
      classifyQuestion(
        { ...baseQ, official_explanation: '<p><img flag="tex" src="x.png"/></p>', image_refs: ['IMG-TEX1'] },
        null,
        imgMap,
        baseCfg
      ).dataset_type
    ).toBe('multimodal');
    expect(
      classifyQuestion({ ...baseQ, question_type: '图形推理' }, null, imgMap, baseCfg).dataset_type
    ).toBe('multimodal');
  });

  it('sends missing answer, empty options, masked stem, or missing image file to review', () => {
    expect(classifyQuestion({ ...baseQ, official_answer: null }, null, imgMap, baseCfg).dataset_type).toBe('review');
    expect(classifyQuestion({ ...baseQ, options: {} }, null, imgMap, baseCfg).dataset_type).toBe('review');
    expect(classifyQuestion({ ...baseQ, stem: '****题干残缺' }, null, imgMap, baseCfg).dataset_type).toBe('review');
    expect(classifyQuestion({ ...baseQ, image_refs: ['IMG-MISS'] }, null, imgMap, baseCfg).dataset_type).toBe('review');
  });
});
