import { sliceNodesSpan, extractImageTags } from './markdown-parser.js';

/**
 * Parse material AST nodes (between `## 材料 N` and the first `### 第 M 题`).
 * Preserves full text, numbers, units, percentages, tables, and image refs.
 * @param {Array<any>} nodes
 * @param {string} rawText
 */
export function parseMaterialNodes(nodes, rawText) {
  const rawContent = sliceNodesSpan(rawText, nodes);
  const images = extractImageTags(rawContent);
  return {
    rawContent,
    images,
  };
}
