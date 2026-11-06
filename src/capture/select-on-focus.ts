/**
 * Selects what a field holds as it takes the focus (spec §16.13), so a value
 * meant to be replaced whole — a figure, a colour code, a key's label, the URL
 * to copy — is replaced by typing over it.
 *
 * The click is the delicate part. The focus lands on `mousedown` and the
 * release then drops a caret where the pointer is, undoing the selection: the
 * release that follows a focusing press is cancelled, that one only. A second
 * click places the caret as usual, so one character can still be corrected;
 * a field focused from the keyboard never has a click swallowed.
 *
 * A Svelte action: `<input use:selectOnFocus />`.
 */
export function selectOnFocus(node: HTMLInputElement): { destroy(): void } {
  /** A press on the field while it did not have the focus yet. */
  let focusingPress = false;

  const onPointerDown = () => {
    focusingPress = document.activeElement !== node;
  };
  const onFocus = () => node.select();
  const onMouseUp = (event: MouseEvent) => {
    if (!focusingPress) return;
    focusingPress = false;
    event.preventDefault();
  };
  const onBlur = () => {
    focusingPress = false;
  };

  node.addEventListener('pointerdown', onPointerDown);
  node.addEventListener('focus', onFocus);
  node.addEventListener('mouseup', onMouseUp);
  node.addEventListener('blur', onBlur);
  return {
    destroy() {
      node.removeEventListener('pointerdown', onPointerDown);
      node.removeEventListener('focus', onFocus);
      node.removeEventListener('mouseup', onMouseUp);
      node.removeEventListener('blur', onBlur);
    },
  };
}
