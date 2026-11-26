import { sliceNodeRaw, sliceNodesSpan, extractImageTags } from './markdown-parser.js';
import { parseOptionsList } from './option-parser.js';
import { parseAnswerParagraph } from './answer-parser.js';
import { isExplanationHeader, parseExplanationNodes } from './explanation-parser.js';

/**
 * Parse the AST nodes belonging to a single question (after its heading, before next heading/thematicBreak).
 * @param {Array<any>} nodes
 * @param {string} rawText
 */
export function parseQuestionNodes(nodes, rawText) {
  const stemNodes = [];
  let optionsResult = null;
  let answerResult = { matched: false, answer: null, status: 'missing' };
  let explanationStartIdx = -1;

  for (let i = 0; i < nodes.length; i += 1) {
    const node = nodes[i];
    const nodeRaw = sliceNodeRaw(rawText, node);

    if (node.type === 'paragraph') {
      if (isExplanationHeader(nodeRaw)) {
        explanationStartIdx = i + 1;
        break;
      }
      const ans = parseAnswerParagraph(nodeRaw);
      if (ans.matched) {
        answerResult = ans;
        continue;
      }
    }

    // Only treat a list before **答案** as options if it matches option syntax
    if (node.type === 'list' && !answerResult.matched && !optionsResult) {
      const parsedOpts = parseOptionsList(node, rawText);
      if (parsedOpts) {
        optionsResult = parsedOpts;
        continue;
      }
    }

    if (!answerResult.matched && !optionsResult) {
      stemNodes.push(node);
    } else if (!answerResult.matched && optionsResult) {
      // Unexpected node between options and answer; keep in stem or ignore?
      // Usually there's nothing between options and answer, but if there is, don't lose it.
      stemNodes.push(node);
    }
  }

  const stemRaw = sliceNodesSpan(rawText, stemNodes);
  const stemImages = extractImageTags(stemRaw);

  const expNodes = explanationStartIdx >= 0 ? nodes.slice(explanationStartIdx) : [];
  const { explanation, images: explanationImages } = parseExplanationNodes(expNodes, rawText);

  const officialAnswer =
    answerResult.answer || optionsResult?.correctKeyFromCheckmark || null;
  const answerStatus = officialAnswer ? 'present' : 'missing';

  return {
    stem: stemRaw,
    stemImages,
    options: optionsResult ? optionsResult.options : {},
    optionImages: optionsResult ? optionsResult.optionImages : [],
    officialAnswer,
    answerStatus,
    officialExplanation: explanation,
    explanationImages,
  };
}
