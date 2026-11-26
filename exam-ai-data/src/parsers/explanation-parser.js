import { sliceNodesSpan, extractImageTags } from './markdown-parser.js';

/**
 * Check if a node is the "**官方解析**" header paragraph.
 * @param {string} rawParagraph
 */
export function isExplanationHeader(rawParagraph) {
  return /^\*\*官方解析\*\*\s*$/.test((rawParagraph || '').trim());
}

/**
 * Parse explanation AST nodes into raw preserved explanation text + image refs.
 * @param {Array<any>} nodes
 * @param {string} rawText
 */
export function parseExplanationNodes(nodes, rawText) {
  if (!nodes || nodes.length === 0) {
    return { explanation: null, images: [] };
  }
  const text = sliceNodesSpan(rawText, nodes);
  const images = extractImageTags(text);
  return {
    explanation: text || null,
    images,
  };
}
