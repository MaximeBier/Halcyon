/**
 * Whether an element ends with its icon: the last child that shows anything —
 * an element, or text that is not blank — is an `<svg>`. Svelte's comment
 * anchors and the whitespace around the words do not count.
 */
export function lastChildIsIcon(element: Element): boolean {
  const shown = [...element.childNodes].filter(
    (node) =>
      node.nodeType === Node.ELEMENT_NODE ||
      (node.nodeType === Node.TEXT_NODE && node.textContent!.trim() !== ''),
  );
  const last = shown[shown.length - 1];
  return last instanceof Element && last.tagName.toLowerCase() === 'svg';
}
