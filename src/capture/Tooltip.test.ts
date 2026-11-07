import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/svelte';
import { tick } from 'svelte';
import Harness from './Tooltip.harness.svelte';

afterEach(cleanup);

const host = (c: Element) => c.querySelector<HTMLElement>('[data-tooltip-host]')!;
const tip = (c: Element) => c.querySelector<HTMLElement>('[role="tooltip"]');

describe('the tooltip (board Editor-Tooltip)', () => {
  it('opens on hover with its sentence, and closes as soon as the pointer leaves', async () => {
    const { container } = render(Harness, { props: { text: 'Connect a keyboard to add keys' } });

    host(container).dispatchEvent(new PointerEvent('pointerenter'));
    await tick();
    expect(tip(container)!.dataset.open).toBe('true');
    expect(tip(container)!.textContent).toBe('Connect a keyboard to add keys');
    // The 400 ms wait is the stylesheet's, never a timer (spec §2).
    expect(tip(container)!.classList.contains('instant')).toBe(false);

    host(container).dispatchEvent(new PointerEvent('pointerleave'));
    await tick();
    expect(tip(container)!.dataset.open).toBe('false');
  });

  it('is placed again when its sentence changes while it shows', async () => {
    // "Copy overlay URL" → "Overlay URL copied": wider, so centred anew.
    const { container, rerender } = render(Harness, { props: { text: 'Copy overlay URL' } });
    host(container).getBoundingClientRect = () =>
      ({ left: 400, top: 300, width: 24, height: 24 }) as DOMRect;
    tip(container)!.getBoundingClientRect = () => ({ width: 120, height: 30 }) as DOMRect;
    host(container).dispatchEvent(new PointerEvent('pointerenter'));
    await tick();
    expect(tip(container)!.style.left).toBe('352px');

    tip(container)!.getBoundingClientRect = () => ({ width: 160, height: 30 }) as DOMRect;
    await rerender({ text: 'Overlay URL copied' });
    await tick();

    expect(tip(container)!.textContent).toBe('Overlay URL copied');
    expect(tip(container)!.style.left).toBe('332px');
  });

  it('opens at once for the keyboard', async () => {
    const { container } = render(Harness, { props: { text: 'Undo' } });

    container.querySelector('button')!.focus();
    await tick();

    expect(tip(container)!.dataset.open).toBe('true');
    expect(tip(container)!.classList.contains('instant')).toBe(true);
  });

  it('draws nothing when there is nothing to clarify', async () => {
    const { container } = render(Harness, { props: { text: null } });
    host(container).dispatchEvent(new PointerEvent('pointerenter'));
    await tick();
    expect(tip(container)).toBeNull();
  });

  it('shows a sentence that arrives while the pointer is already there', async () => {
    // A copy that fails under the pointer: the reason appears with the failure,
    // as a native title set mid-hover would.
    const { container, rerender } = render(Harness, { props: { text: null } });
    host(container).dispatchEvent(new PointerEvent('pointerenter'));
    await tick();
    expect(tip(container)).toBeNull();

    await rerender({ text: 'Select the URL and copy it by hand' });
    await tick();
    expect(tip(container)!.dataset.open).toBe('true');
  });

  it('stays shut for a sentence that arrives once the pointer has left', async () => {
    const { container, rerender } = render(Harness, { props: { text: null } });
    host(container).dispatchEvent(new PointerEvent('pointerenter'));
    host(container).dispatchEvent(new PointerEvent('pointerleave'));
    await rerender({ text: 'Select the URL and copy it by hand' });
    await tick();
    expect(tip(container)!.dataset.open).toBe('false');
  });

  it('describes the element it explains, for a screen reader', () => {
    const { container } = render(Harness, { props: { text: 'Undo' } });
    const id = container.querySelector('button')!.getAttribute('aria-describedby');
    expect(id).toBe(tip(container)!.id);
  });
});
