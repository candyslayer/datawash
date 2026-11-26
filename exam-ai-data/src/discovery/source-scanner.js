import fs from 'node:fs/promises';
import path from 'node:path';
import yaml from 'js-yaml';
import pLimit from 'p-limit';
import { createLogger } from '../utils/logger.js';
import { resolveProjectPath, resolveImageRelativePath, toPosixPath } from '../utils/path-resolver.js';
import {
  classifyModuleFromPath,
  classifyExamType,
  extractProvince,
  isExamMarkdown,
} from './file-classifier.js';

const log = createLogger('source-scanner');

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg', '.jfif', '.bmp']);

function parseFrontmatterQuick(content) {
  if (!content.startsWith('---')) return null;
  const endIdx = content.indexOf('\n---', 3);
  if (endIdx === -1) return null;
  try {
    return yaml.load(content.slice(3, endIdx));
  } catch {
    return null;
  }
}

function extractImageRefsQuick(content) {
  const refs = [];
  for (const m of content.matchAll(/<img\b[^>]*\bsrc=["']([^"']+)["']/gi)) {
    refs.push(m[1]);
  }
  for (const m of content.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)) {
    refs.push(m[1]);
  }
  for (const m of content.matchAll(/!\[\[([^\]]+)\]\]/g)) {
    refs.push(m[1].split('|')[0]);
  }
  return refs;
}

function csvEscape(val) {
  const s = val == null ? '' : String(val);
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

async function walkFiles(rootDir) {
  const mdFiles = [];
  const imageFiles = [];
  const otherFiles = [];

  async function walk(currentDir) {
    const entries = await fs.readdir(currentDir, { withFileTypes: true });
    for (const ent of entries) {
      const fullPath = path.join(currentDir, ent.name);
      if (ent.isDirectory()) {
        await walk(fullPath);
      } else if (ent.isFile()) {
        const rel = toPosixPath(path.relative(rootDir, fullPath));
        const ext = path.extname(ent.name).toLowerCase();
        if (ext === '.md') {
          mdFiles.push({ fullPath, relPath: rel, ext });
        } else if (IMAGE_EXTS.has(ext)) {
          imageFiles.push({ fullPath, relPath: rel, ext });
        } else {
          otherFiles.push({ fullPath, relPath: rel, ext });
        }
      }
    }
  }

  await walk(rootDir);
  return { mdFiles, imageFiles, otherFiles };
}

export async function runScan({ sourceRoot, concurrency = 8, writeReports = true }) {
  log.info({ sourceRoot }, 'Starting source repository scan');
  const { mdFiles, imageFiles, otherFiles } = await walkFiles(sourceRoot);

  const imageSet = new Set(imageFiles.map((f) => f.relPath));
  const referencedImageSet = new Set();
  const missingImageRefs = [];

  const limit = pLimit(concurrency);
  const mdRecords = await Promise.all(
    mdFiles.map((f) =>
      limit(async () => {
        const [stat, content] = await Promise.all([
          fs.stat(f.fullPath),
          fs.readFile(f.fullPath, 'utf8'),
        ]);
        const fm = parseFrontmatterQuick(content);
        const isExam = isExamMarkdown(f.relPath, fm);
        const mod = classifyModuleFromPath(f.relPath);
        const year = fm?.['年份'] ? parseInt(fm['年份'], 10) : null;
        const region = fm?.['地区'] || null;
        const paperName = fm?.['试卷'] || path.basename(f.relPath, '.md');
        const examType = isExam ? classifyExamType(region, paperName) : null;
        const province = isExam ? extractProvince(region, paperName) : null;

        const qMatches = content.match(/^#{2,3}\s+第\s*\d+\s*题/gm);
        const questionCount = qMatches ? qMatches.length : 0;

        const rawRefs = extractImageRefsQuick(content);
        const resolvedRefs = rawRefs.map((ref) => resolveImageRelativePath(sourceRoot, f.relPath, ref));
        for (const r of resolvedRefs) {
          referencedImageSet.add(r);
          if (!imageSet.has(r)) {
            missingImageRefs.push({ source_file: f.relPath, image_path: r });
          }
        }

        return {
          rel_path: f.relPath,
          is_exam: isExam,
          module: mod,
          year: Number.isFinite(year) ? year : null,
          exam_type: examType,
          province,
          paper_name: paperName,
          size_bytes: stat.size,
          mtime: stat.mtime.toISOString(),
          question_count: questionCount,
          image_ref_count: resolvedRefs.length,
        };
      })
    )
  );

  const imgRecords = await Promise.all(
    imageFiles.map((f) =>
      limit(async () => {
        const stat = await fs.stat(f.fullPath);
        return {
          rel_path: f.relPath,
          ext: f.ext,
          size_bytes: stat.size,
          mtime: stat.mtime.toISOString(),
          referenced: referencedImageSet.has(f.relPath),
        };
      })
    )
  );

  const examMds = mdRecords.filter((r) => r.is_exam);
  const byYear = {};
  const byExamType = {};
  const byProvince = {};
  const byModule = {};
  const byModuleQuestions = {};
  const uniquePapers = new Set();

  for (const r of examMds) {
    uniquePapers.add(r.paper_name);
    const yKey = r.year ? String(r.year) : 'unknown';
    byYear[yKey] = (byYear[yKey] || 0) + 1;
    const etKey = r.exam_type || 'unknown';
    byExamType[etKey] = (byExamType[etKey] || 0) + 1;
    const pKey = r.province || 'none';
    byProvince[pKey] = (byProvince[pKey] || 0) + 1;
    const mKey = r.module || 'unknown';
    byModule[mKey] = (byModule[mKey] || 0) + 1;
    byModuleQuestions[mKey] = (byModuleQuestions[mKey] || 0) + r.question_count;
  }

  const imageFormatDist = {};
  let unreferencedImageCount = 0;
  for (const img of imgRecords) {
    imageFormatDist[img.ext] = (imageFormatDist[img.ext] || 0) + 1;
    if (!img.referenced) unreferencedImageCount += 1;
  }

  const totalQuestions = examMds.reduce((acc, r) => acc + r.question_count, 0);

  const summary = {
    scanned_at: new Date().toISOString(),
    source_root: toPosixPath(sourceRoot),
    total_markdown_files: mdRecords.length,
    exam_markdown_files: examMds.length,
    non_exam_markdown_files: mdRecords.length - examMds.length,
    unique_papers_estimated: uniquePapers.size,
    total_questions_detected: totalQuestions,
    total_image_files: imgRecords.length,
    other_files_count: otherFiles.length,
    referenced_unique_images: referencedImageSet.size,
    unreferenced_image_count: unreferencedImageCount,
    missing_image_refs_count: missingImageRefs.length,
    by_year: byYear,
    by_exam_type: byExamType,
    by_province: byProvince,
    by_module_files: byModule,
    by_module_questions: byModuleQuestions,
    image_format_distribution: imageFormatDist,
  };

  if (writeReports) {
    const reportsDir = resolveProjectPath('reports');
    await fs.mkdir(reportsDir, { recursive: true });

    await fs.writeFile(
      path.join(reportsDir, 'source_inventory.json'),
      JSON.stringify({ summary, missing_image_refs: missingImageRefs }, null, 2),
      'utf8'
    );

    const csvHeader = [
      'rel_path',
      'is_exam',
      'module',
      'year',
      'exam_type',
      'province',
      'question_count',
      'image_ref_count',
      'size_bytes',
      'mtime',
    ].join(',');
    const csvLines = [csvHeader];
    for (const r of mdRecords) {
      csvLines.push(
        [
          csvEscape(r.rel_path),
          r.is_exam,
          csvEscape(r.module),
          csvEscape(r.year),
          csvEscape(r.exam_type),
          csvEscape(r.province),
          r.question_count,
          r.image_ref_count,
          r.size_bytes,
          csvEscape(r.mtime),
        ].join(',')
      );
    }
    await fs.writeFile(path.join(reportsDir, 'source_files.csv'), csvLines.join('\n'), 'utf8');

    const mdReport = buildSourceAnalysisMarkdown(summary, missingImageRefs);
    await fs.writeFile(path.join(reportsDir, 'source_analysis.md'), mdReport, 'utf8');
    log.info('Wrote source_inventory.json, source_files.csv, and source_analysis.md');
  }

  return { summary, mdRecords, imgRecords, missingImageRefs };
}

function buildSourceAnalysisMarkdown(summary, missingImageRefs) {
  const lines = [
    '# 原始题库仓库扫描分析报告 (Source Analysis)',
    '',
    `- **扫描时间**: ${summary.scanned_at}`,
    `- **原始路径**: \`${summary.source_root}\``,
    `- **Markdown 文件总数**: ${summary.total_markdown_files} (真题文件: ${summary.exam_markdown_files}, 索引/说明文件: ${summary.non_exam_markdown_files})`,
    `- **识别试卷数 (按卷名去重)**: ${summary.unique_papers_estimated}`,
    `- **检测题目总数**: ${summary.total_questions_detected}`,
    `- **本地图片总数**: ${summary.total_image_files}`,
    `- **未引用图片数**: ${summary.unreferenced_image_count}`,
    `- **引用缺失图片数**: ${summary.missing_image_refs_count}`,
    '',
    '## 按六大模块统计',
    '',
    '| 模块 (英文标识) | 文件数 | 题目数 |',
    '|---|---:|---:|',
  ];

  for (const [mod, cnt] of Object.entries(summary.by_module_files)) {
    lines.push(`| ${mod} | ${cnt} | ${summary.by_module_questions[mod] || 0} |`);
  }

  lines.push('', '## 按年份统计 (文件数)', '', '| 年份 | 文件数 |', '|---|---:|');
  for (const y of Object.keys(summary.by_year).sort()) {
    lines.push(`| ${y} | ${summary.by_year[y]} |`);
  }

  lines.push('', '## 按考试类型统计 (文件数)', '', '| 考试类型 | 文件数 |', '|---|---:|');
  for (const [t, cnt] of Object.entries(summary.by_exam_type)) {
    lines.push(`| ${t} | ${cnt} |`);
  }

  lines.push('', '## 按省份统计 (文件数)', '', '| 省份 | 文件数 |', '|---|---:|');
  for (const [p, cnt] of Object.entries(summary.by_province).sort((a, b) => b[1] - a[1])) {
    lines.push(`| ${p} | ${cnt} |`);
  }

  lines.push('', '## 图片格式分布', '', '| 格式 | 数量 |', '|---|---:|');
  for (const [ext, cnt] of Object.entries(summary.image_format_distribution)) {
    lines.push(`| ${ext} | ${cnt} |`);
  }

  if (missingImageRefs.length > 0) {
    lines.push('', '## 引用缺失图片明细 (前 50 条)', '', '| 来源文件 | 缺失图片路径 |', '|---|---|');
    for (const m of missingImageRefs.slice(0, 50)) {
      lines.push(`| ${m.source_file} | ${m.image_path} |`);
    }
  }

  return lines.join('\n') + '\n';
}
