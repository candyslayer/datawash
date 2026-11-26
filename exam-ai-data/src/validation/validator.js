import fs from 'node:fs/promises';
import path from 'node:path';
import Ajv from 'ajv';
import { createLogger } from '../utils/logger.js';
import { JsonlWriter, readJsonlStream } from '../utils/jsonl-writer.js';
import { resolveProjectPath } from '../utils/path-resolver.js';

const log = createLogger('validator');

const VALID_MODULES = new Set([
  'political_theory',
  'general_knowledge',
  'verbal_comprehension',
  'quantitative_reasoning',
  'logical_reasoning',
  'data_analysis',
]);

function csvEscape(val) {
  const s = val == null ? '' : String(val);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

async function loadSchemas() {
  const ajv = new Ajv({ allErrors: false });
  const names = ['paper', 'material', 'question', 'image'];
  const validators = {};
  for (const name of names) {
    const schemaPath = resolveProjectPath('schemas', `${name}.schema.json`);
    const schema = JSON.parse(await fs.readFile(schemaPath, 'utf8'));
    validators[name] = ajv.compile(schema);
  }
  return validators;
}

export async function runValidation({ dryRun = false } = {}) {
  log.info({ dryRun }, 'Starting dataset quality validation');
  const validators = await loadSchemas();
  const normDir = resolveProjectPath('data', 'normalized');

  // 1. Index papers, materials, images
  const paperIds = new Set();
  let paperSchemaErrors = 0;
  for await (const p of readJsonlStream(path.join(normDir, 'papers.jsonl'))) {
    if (!validators.paper(p)) paperSchemaErrors += 1;
    paperIds.add(p.paper_id);
  }

  const materialIds = new Set();
  let materialSchemaErrors = 0;
  for await (const m of readJsonlStream(path.join(normDir, 'materials.jsonl'))) {
    if (!validators.material(m)) materialSchemaErrors += 1;
    materialIds.add(m.material_id);
  }

  const imageMap = new Map();
  let imageSchemaErrors = 0;
  const imageErrors = [];
  for await (const img of readJsonlStream(path.join(normDir, 'images.jsonl'))) {
    if (!validators.image(img)) imageSchemaErrors += 1;
    imageMap.set(img.image_id, img);
    if (!img.exists) {
      imageErrors.push({
        image_id: img.image_id,
        original_path: img.original_path,
        error: 'missing_on_disk',
        related_questions: (img.related_question_ids || []).join(';'),
      });
    }
  }

  // 2. Validate questions streamingly
  const seenQids = new Set();
  const missingFieldsRows = [];
  const reviewRows = [];
  const rejectedRows = [];

  const summary = {
    validated_at: new Date().toISOString(),
    papers_count: paperIds.size,
    materials_count: materialIds.size,
    images_count: imageMap.size,
    schema_errors: {
      papers: paperSchemaErrors,
      materials: materialSchemaErrors,
      images: imageSchemaErrors,
      questions: 0,
    },
    questions_total: 0,
    status_counts: { PASS: 0, REVIEW: 0, REJECT: 0 },
    issue_counts: {},
    by_module: {},
  };

  let reviewWriter = null;
  let rejectedWriter = null;
  if (!dryRun) {
    reviewWriter = await new JsonlWriter(resolveProjectPath('data', 'review', 'review_questions.jsonl')).open();
    rejectedWriter = await new JsonlWriter(resolveProjectPath('data', 'rejected', 'rejected_questions.jsonl')).open();
  }

  function recordIssue(issue) {
    summary.issue_counts[issue] = (summary.issue_counts[issue] || 0) + 1;
  }

  for await (const q of readJsonlStream(path.join(normDir, 'questions.jsonl'))) {
    summary.questions_total += 1;
    summary.by_module[q.module] = (summary.by_module[q.module] || 0) + 1;

    const rejectReasons = [];
    const reviewReasons = [];

    if (!validators.question(q)) {
      summary.schema_errors.questions += 1;
      rejectReasons.push('schema_invalid');
      recordIssue('schema_invalid');
    }
    if (!paperIds.has(q.paper_id)) {
      rejectReasons.push('missing_paper_id');
      recordIssue('missing_paper_id');
    }
    if (!VALID_MODULES.has(q.module)) {
      rejectReasons.push('invalid_module');
      recordIssue('invalid_module');
    }
    if (!q.stem || q.stem.trim().length < 2) {
      rejectReasons.push('empty_stem');
      recordIssue('empty_stem');
    }
    if (q.material_id && !materialIds.has(q.material_id)) {
      rejectReasons.push('dangling_material_id');
      recordIssue('dangling_material_id');
    }

    // Review-level checks
    if (seenQids.has(q.question_id)) {
      reviewReasons.push('duplicate_question_id');
      recordIssue('duplicate_question_id');
    }
    seenQids.add(q.question_id);

    if (/\*{4,}/.test(q.stem || '')) {
      reviewReasons.push('suspected_masked_or_truncated_stem');
      recordIssue('suspected_masked_or_truncated_stem');
    }
    if (!q.official_answer) {
      reviewReasons.push('missing_answer');
      recordIssue('missing_answer');
      missingFieldsRows.push({ question_id: q.question_id, field: 'official_answer', source_file: q.source?.file });
    } else if (Object.keys(q.options || {}).length > 0) {
      const optKeys = new Set(Object.keys(q.options));
      const ansChars = q.official_answer.split('');
      const allInOpts = ansChars.every((c) => optKeys.has(c));
      if (!allInOpts) {
        reviewReasons.push('answer_not_in_options');
        recordIssue('answer_not_in_options');
      }
    }
    if (!q.official_explanation) {
      // Missing explanation is tracked in missing_fields, not a hard reject
      recordIssue('missing_explanation');
    }
    for (const imgId of q.image_refs || []) {
      const img = imageMap.get(imgId);
      if (!img || !img.exists) {
        reviewReasons.push(`missing_image:${imgId}`);
        recordIssue('missing_image_ref');
      }
    }

    let status = 'PASS';
    if (rejectReasons.length > 0) {
      status = 'REJECT';
      summary.status_counts.REJECT += 1;
      rejectedRows.push({
        question_id: q.question_id,
        source_qid: q.source_qid,
        module: q.module,
        reasons: rejectReasons.join(';'),
        source_file: q.source?.file,
      });
      if (rejectedWriter) await rejectedWriter.write({ ...q, validation_reasons: rejectReasons });
    } else if (reviewReasons.length > 0) {
      status = 'REVIEW';
      summary.status_counts.REVIEW += 1;
      reviewRows.push({
        question_id: q.question_id,
        source_qid: q.source_qid,
        module: q.module,
        reasons: reviewReasons.join(';'),
        source_file: q.source?.file,
      });
      if (reviewWriter) await reviewWriter.write({ ...q, validation_reasons: reviewReasons });
    } else {
      summary.status_counts.PASS += 1;
    }
  }

  if (!dryRun) {
    await reviewWriter.close();
    await rejectedWriter.close();

    const reportsDir = resolveProjectPath('reports');
    await fs.mkdir(reportsDir, { recursive: true });

    await fs.writeFile(
      path.join(reportsDir, 'validation_summary.json'),
      JSON.stringify(summary, null, 2),
      'utf8'
    );

    const writeCsv = async (filename, header, rows, mapper) => {
      const lines = [header, ...rows.map(mapper)];
      await fs.writeFile(path.join(reportsDir, filename), lines.join('\n'), 'utf8');
    };

    await writeCsv(
      'missing_fields.csv',
      'question_id,field,source_file',
      missingFieldsRows,
      (r) => [csvEscape(r.question_id), csvEscape(r.field), csvEscape(r.source_file)].join(',')
    );
    await writeCsv(
      'image_errors.csv',
      'image_id,original_path,error,related_questions',
      imageErrors,
      (r) => [csvEscape(r.image_id), csvEscape(r.original_path), csvEscape(r.error), csvEscape(r.related_questions)].join(',')
    );
    await writeCsv(
      'review_questions.csv',
      'question_id,source_qid,module,reasons,source_file',
      reviewRows,
      (r) => [csvEscape(r.question_id), csvEscape(r.source_qid), csvEscape(r.module), csvEscape(r.reasons), csvEscape(r.source_file)].join(',')
    );
    await writeCsv(
      'rejected_questions.csv',
      'question_id,source_qid,module,reasons,source_file',
      rejectedRows,
      (r) => [csvEscape(r.question_id), csvEscape(r.source_qid), csvEscape(r.module), csvEscape(r.reasons), csvEscape(r.source_file)].join(',')
    );
  }

  log.info(
    {
      total: summary.questions_total,
      PASS: summary.status_counts.PASS,
      REVIEW: summary.status_counts.REVIEW,
      REJECT: summary.status_counts.REJECT,
    },
    'Validation finished'
  );
  return summary;
}
