import { sliceNodeRaw, extractImageTags } from './markdown-parser.js';

const CHECKMARK_RE = /[\s\u3000]*✅\s*$/;

/**
 * Attempt to parse a list AST node as multiple-choice options.
 * Returns null if the list does not look like question options (e.g. A., B., C., D.).
 * @param {any} listNode
 * @param {string} rawText
 */
export function parseOptionsList(listNode, rawText) {
  if (!listNode || listNode.type !== 'list' || !Array.isArray(listNode.children)) {
    return null;
  }

  const options = {};
  const optionImages = [];
  let correctKeyFromCheckmark = null;
  let matchedCount = 0;

  for (const item of listNode.children) {
    let itemRaw = sliceNodeRaw(rawText, item).trim();
    // Strip leading list marker (- , * , + )
    itemRaw = itemRaw.replace(/^[-*+]\s+/, '');

    // Match **A**. content  OR  A. content  OR  **A**、content
    const optMatch = itemRaw.match(/^(?:\*\*([A-Z])\*\*|([A-Z]))\s*[.、．:：]\s*([\s\S]*)$/);
    if (!optMatch) {
      continue;
    }

    matchedCount += 1;
    const key = optMatch[1] || optMatch[2];
    let val = optMatch[3].trim();

    if (CHECKMARK_RE.test(val)) {
      correctKeyFromCheckmark = key;
      val = val.replace(CHECKMARK_RE, '').trim();
    }

    options[key] = val;
    const imgs = extractImageTags(val);
    for (const img of imgs) {
      optionImages.push({ key, ...img });
    }
  }

  if (matchedCount === 0 || matchedCount < listNode.children.length * 0.5) {
    return null;
  }

  return {
    options,
    optionImages,
    correctKeyFromCheckmark,
  };
}
