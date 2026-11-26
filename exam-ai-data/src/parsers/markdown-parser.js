import yaml from 'js-yaml';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkFrontmatter from 'remark-frontmatter';

const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkFrontmatter, ['yaml']);

/**
 * Parse a Markdown string into an mdast tree and extract YAML frontmatter.
 * @param {string} rawText
 */
export function parseMarkdownAst(rawText) {
  const tree = processor.parse(rawText);
  let frontmatter = {};
  const children = tree.children || [];
  if (children.length > 0 && children[0].type === 'yaml') {
    try {
      frontmatter = yaml.load(children[0].value) || {};
    } catch {
      frontmatter = {};
    }
  }
  return { tree, frontmatter };
}

/**
 * Slice the exact original Markdown substring for an AST node.
 * @param {string} rawText
 * @param {import('unist').Node} node
 * @returns {string}
 */
export function sliceNodeRaw(rawText, node) {
  if (!node?.position?.start || !node?.position?.end) return '';
  const start = node.position.start.offset;
  const end = node.position.end.offset;
  if (typeof start === 'number' && typeof end === 'number') {
    return rawText.slice(start, end);
  }
  return '';
}

/**
 * Slice raw text spanning an array of consecutive AST nodes.
 * @param {string} rawText
 * @param {Array<import('unist').Node>} nodes
 * @returns {string}
 */
export function sliceNodesSpan(rawText, nodes) {
  if (!nodes || nodes.length === 0) return '';
  const first = nodes[0];
  const last = nodes[nodes.length - 1];
  const start = first?.position?.start?.offset;
  const end = last?.position?.end?.offset;
  if (typeof start === 'number' && typeof end === 'number') {
    return rawText.slice(start, end).trim();
  }
  return nodes.map((n) => sliceNodeRaw(rawText, n)).join('\n\n').trim();
}

/**
 * Extract plain text recursively from an mdast node (preserving inline text).
 * @param {any} node
 * @returns {string}
 */
export function nodeToPlainText(node) {
  if (!node) return '';
  if (typeof node.value === 'string') return node.value;
  if (Array.isArray(node.children)) {
    return node.children.map(nodeToPlainText).join('');
  }
  return '';
}

/**
 * Extract all image references from raw Markdown/HTML snippet.
 * @param {string} snippet
 * @returns {Array<{ src: string, isFormula: boolean, syntax: 'html'|'markdown'|'obsidian' }>}
 */
export function extractImageTags(snippet) {
  const results = [];
  if (!snippet) return results;

  for (const m of snippet.matchAll(/<img\b([^>]*)>/gi)) {
    const attrs = m[1];
    const srcMatch = attrs.match(/\bsrc=["']([^"']+)["']/i);
    if (srcMatch) {
      const isFormula = /\bflag=["']tex["']/i.test(attrs) || srcMatch[1].includes('公式图');
      results.push({ src: srcMatch[1].trim(), isFormula, syntax: 'html' });
    }
  }
  for (const m of snippet.matchAll(/!\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
    results.push({ src: m[1].trim(), isFormula: m[1].includes('公式图'), syntax: 'markdown' });
  }
  for (const m of snippet.matchAll(/!\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g)) {
    results.push({ src: m[1].trim(), isFormula: m[1].includes('公式图'), syntax: 'obsidian' });
  }
  return results;
}
