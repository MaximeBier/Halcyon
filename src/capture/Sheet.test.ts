import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/svelte';
import SheetHarness from './Sheet.harness.svelte';

afterEach(cleanup);

function sheet() {
  const onClose = vi.fn();
  return { ...render(SheetHarness, { props: { onClose } }), onClose };
}

const panel = (c: HTMLElement) => c.querySelector<HTMLElement>('[data-sheet]')!;

describe('the sheet', () => {
  it('names itself, takes the focus, and renders what it is given', () => {
    const { container } = sheet();

    expect(panel(container).getAttribute('aria-label')).toBe('Diagnostics');
    expect(document.activeElement).toBe(panel(container));
    expect(panel(container).textContent).toContain('the contents');
  });

  it('asks to close on the cross, on Escape, and on a pointer outside', async () => {
    const { container, onClose } = sheet();

    await fireEvent.click(panel(container).querySelector('[data-close]')!);
    expect(onClose).toHaveBeenCalledTimes(1);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(onClose).toHaveBeenCalledTimes(2);

    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it('stays on a pointer inside', () => {
    // Not a modal: the page behind stays live, but a click on the sheet's own
    // controls must not be the click that closes it.
    const { container, onClose } = sheet();

    panel(container).dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));

    expect(onClose).not.toHaveBeenCalled();
  });
});
