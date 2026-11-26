const MODULE_CN_LABELS = {
  political_theory: '政治理论',
  general_knowledge: '常识判断',
  verbal_comprehension: '言语理解与表达',
  quantitative_reasoning: '数量关系',
  logical_reasoning: '判断推理',
  data_analysis: '资料分析',
};

/**
 * Clean simple HTML <p> wrappers from pure-text fields without altering
 * math symbols, numbers, units, percentages, or negation words.
 */
export function cleanTextForPrompt(text) {
  if (!text) return '';
  return String(text)
    .replace(/<\/p>\s*<p>/gi, '\n')
    .replace(/<\/?p[^>]*>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/\u00A0/g, ' ')
    .trim();
}

export function formatOptionsText(options = {}) {
  const keys = Object.keys(options).sort();
  return keys.map((k) => `${k}. ${cleanTextForPrompt(options[k])}`).join('\n');
}

export function buildUserContent(question, material) {
  const modLabel = MODULE_CN_LABELS[question.module] || question.module;
  const stemText = cleanTextForPrompt(question.stem);
  const optionsText = formatOptionsText(question.options);

  if (material && material.content) {
    const matText = cleanTextForPrompt(material.content);
    return [
      `【模块】${modLabel}`,
      '',
      '【材料】',
      matText,
      '',
      '【题目】',
      stemText,
      '',
      '【选项】',
      optionsText,
    ].join('\n');
  }

  return [
    `【模块】${modLabel}`,
    `【题目】${stemText}`,
    `【选项】\n${optionsText}`,
  ].join('\n');
}

export function isValidExplanation(explanation, cfg = {}) {
  if (!explanation) return false;
  const cleaned = cleanTextForPrompt(explanation);
  const minLen = cfg.quality?.min_explanation_length ?? 5;
  if (cleaned.length < minLen) return false;
  const patterns = cfg.quality?.invalid_explanation_patterns || ['^略[。.]?$'];
  for (const pat of patterns) {
    if (new RegExp(pat).test(cleaned)) return false;
  }
  return true;
}

export function buildSftSample({ taskType, question, material, cfg = {} }) {
  const prompts = cfg.prompts || {};
  const systemPrompt =
    taskType === 'answer'
      ? prompts.answer_system || '你是一名专业的中国公务员行测考试辅导老师。请认真分析题目，选择正确答案。'
      : prompts.explanation_system || '你是一名专业的中国公务员行测考试辅导老师。请给出正确答案，并依据题目解析清晰说明解题过程。';

  const userContent = buildUserContent(question, material);
  const assistantContent =
    taskType === 'answer'
      ? question.official_answer
      : `【正确答案】${question.official_answer}\n【解析】${cleanTextForPrompt(question.official_explanation)}`;

  const sample = {
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent },
      { role: 'assistant', content: assistantContent },
    ],
  };

  if (cfg.quality?.include_metadata !== false) {
    sample.metadata = {
      task_type: taskType,
      question_id: question.question_id,
      source_qid: question.source_qid,
      paper_id: question.paper_id,
      material_id: question.material_id || null,
      module: question.module,
      year: question.year,
      province: question.province,
      source_file: question.source?.file || null,
    };
  }

  return sample;
}
