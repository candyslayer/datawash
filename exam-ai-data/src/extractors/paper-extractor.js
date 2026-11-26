import path from 'node:path';
import {
  classifyModuleFromPath,
  classifyExamType,
  extractProvince,
  MODULE_CN_MAP,
} from '../discovery/file-classifier.js';
import { buildPaperId, createPaper } from '../models/paper.js';

export function extractPaper({ relPath, frontmatter }) {
  const paperName =
    frontmatter['试卷'] || path.basename(relPath, path.extname(relPath));
  const yearRaw = frontmatter['年份'];
  const year = yearRaw ? parseInt(String(yearRaw), 10) : extractYearFromName(paperName);
  const region = frontmatter['地区'] || null;
  const modCn = frontmatter['模块'] || null;
  const moduleId =
    (modCn && MODULE_CN_MAP[modCn]) || classifyModuleFromPath(relPath) || 'general_knowledge';

  const examType = classifyExamType(region, paperName);
  const province = extractProvince(region, paperName);
  const paperId = buildPaperId(Number.isFinite(year) ? year : null, paperName);

  const paper = createPaper({
    paper_id: paperId,
    year: Number.isFinite(year) ? year : null,
    exam_type: examType,
    province,
    paper_name: paperName,
    source_file: relPath,
    source_files: [relPath],
    modules: [moduleId],
    source_metadata: {
      frontmatter,
    },
  });

  return { paper, moduleId };
}

function extractYearFromName(name) {
  const m = String(name || '').match(/(20\d{2}|19\d{2})/);
  return m ? parseInt(m[1], 10) : null;
}
