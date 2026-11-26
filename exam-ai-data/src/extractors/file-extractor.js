import { parseMarkdownAst, sliceNodeRaw } from '../parsers/markdown-parser.js';
import { parseHeading } from '../parsers/heading-parser.js';
import { parseMaterialNodes } from '../parsers/material-parser.js';
import { parseQuestionNodes } from '../parsers/question-parser.js';
import { extractPaper } from './paper-extractor.js';
import { resolveEntityImages } from './image-extractor.js';
import { buildMaterialId, createMaterial } from '../models/material.js';
import { buildQuestionId, createQuestion } from '../models/question.js';

/**
 * Parse a single exam Markdown file into Paper, Materials, Questions, and ImageRefs.
 * @param {{ sourceRoot: string, relPath: string, rawText: string }} params
 */
export function extractFileEntities({ sourceRoot, relPath, rawText }) {
  const { tree, frontmatter } = parseMarkdownAst(rawText);
  const { paper, moduleId } = extractPaper({ relPath, frontmatter });

  const materials = [];
  const questions = [];
  const imageRefs = [];

  const children = tree.children || [];
  let currentMaterialId = null;

  // Segment AST into blocks starting at H2/H3 headings
  const blocks = [];
  let currentBlock = null;

  for (const node of children) {
    if (node.type === 'yaml') continue;
    if (node.type === 'heading' && (node.depth === 2 || node.depth === 3)) {
      if (currentBlock) blocks.push(currentBlock);
      const rawHeading = sliceNodeRaw(rawText, node);
      const parsedHeading = parseHeading(node, rawHeading);
      currentBlock = { heading: parsedHeading, nodes: [] };
      continue;
    }
    if (node.type === 'thematicBreak') {
      if (currentBlock && currentBlock.heading.kind === 'question') {
        blocks.push(currentBlock);
        currentBlock = null;
      }
      continue;
    }
    if (currentBlock) {
      currentBlock.nodes.push(node);
    }
  }
  if (currentBlock) blocks.push(currentBlock);

  for (const block of blocks) {
    const h = block.heading;

    if (h.kind === 'material') {
      const matId = buildMaterialId(paper.paper_id, moduleId, h.anchor);
      currentMaterialId = matId;
      const parsedMat = parseMaterialNodes(block.nodes, rawText);
      const matImgRefs = resolveEntityImages({
        sourceRoot,
        relPath,
        tags: parsedMat.images,
        context: 'material',
        moduleId,
        materialId: matId,
      });
      imageRefs.push(...matImgRefs);

      materials.push(
        createMaterial({
          material_id: matId,
          paper_id: paper.paper_id,
          module: moduleId,
          content: parsedMat.rawContent,
          raw_content: parsedMat.rawContent,
          images: [...new Set(matImgRefs.map((r) => r.image_id))],
          source_file: relPath,
          source_anchor: h.anchor,
        })
      );
    } else if (h.kind === 'question') {
      const parsedQ = parseQuestionNodes(block.nodes, rawText);
      const questionId = buildQuestionId({
        year: paper.year,
        source_qid: h.sourceQid,
        paper_id: paper.paper_id,
        module: moduleId,
        question_number: h.questionNumber,
        anchor: h.anchor,
      });

      const stemRefs = resolveEntityImages({
        sourceRoot,
        relPath,
        tags: parsedQ.stemImages,
        context: 'stem',
        moduleId,
        questionId,
      });
      const optRefs = resolveEntityImages({
        sourceRoot,
        relPath,
        tags: parsedQ.optionImages,
        context: 'option',
        moduleId,
        questionId,
      });
      const expRefs = resolveEntityImages({
        sourceRoot,
        relPath,
        tags: parsedQ.explanationImages,
        context: 'explanation',
        moduleId,
        questionId,
      });
      const allQRefs = [...stemRefs, ...optRefs, ...expRefs];
      imageRefs.push(...allQRefs);

      const parseStatus = parsedQ.stem ? 'success' : 'partial';

      questions.push(
        createQuestion({
          question_id: questionId,
          source_qid: h.sourceQid,
          paper_id: paper.paper_id,
          year: paper.year,
          exam_type: paper.exam_type,
          province: paper.province,
          module: moduleId,
          question_number: h.questionNumber,
          question_type: h.subTopic || 'unknown',
          stem: parsedQ.stem,
          options: parsedQ.options,
          official_answer: parsedQ.officialAnswer,
          official_explanation: parsedQ.officialExplanation,
          material_id: currentMaterialId,
          image_refs: [...new Set(allQRefs.map((r) => r.image_id))],
          source: {
            file: relPath,
            anchor: h.anchor,
          },
          quality: {
            parse_status: parseStatus,
            validation_status: 'pending',
            answer_status: parsedQ.answerStatus,
          },
        })
      );
    }
  }

  return { paper, materials, questions, imageRefs };
}
