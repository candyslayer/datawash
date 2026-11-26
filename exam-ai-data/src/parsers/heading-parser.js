import { nodeToPlainText } from './markdown-parser.js';

/**
 * Parse a heading AST node to determine if it is a Paper title, Material heading, or Question heading.
 * @param {any} headingNode
 * @param {string} rawHeading
 */
export function parseHeading(headingNode, rawHeading = '') {
  const plain = nodeToPlainText(headingNode).replace(/<[^>]+>/g, ' ').trim();
  const depth = headingNode.depth;

  // Material heading: ## 材料 1
  const matMatch = plain.match(/^材料\s*(\d+)?\s*(.*)$/);
  if (depth === 2 && matMatch) {
    return {
      kind: 'material',
      materialIndex: matMatch[1] ? parseInt(matMatch[1], 10) : null,
      anchor: plain,
    };
  }

  // Question heading: ## 第 1 题　<sub>qid 19526238 · 新思想</sub>
  const qMatch = plain.match(/^第\s*(\d+)\s*题/);
  if ((depth === 2 || depth === 3) && qMatch) {
    const questionNumber = parseInt(qMatch[1], 10);
    const qidMatch = rawHeading.match(/\bqid\s+(\d+)\b/i);
    const subMatch = rawHeading.match(/<sub>([^<]+)<\/sub>/i);
    let subTopic = null;
    if (subMatch) {
      const parts = subMatch[1].split('·').map((s) => s.trim());
      if (parts.length > 1) subTopic = parts.slice(1).join(' · ');
    }
    return {
      kind: 'question',
      questionNumber,
      sourceQid: qidMatch ? qidMatch[1] : null,
      subTopic,
      anchor: `第 ${questionNumber} 题`,
    };
  }

  if (depth === 1) {
    return { kind: 'paper_title', title: plain };
  }

  return { kind: 'other', depth, text: plain };
}
