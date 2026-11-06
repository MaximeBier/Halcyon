import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/svelte';
import { tick } from 'svelte';
import NumberField from './NumberField.svelte';

afterEach(cleanup);

type Props = Partial<{
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  prefix: string;
  variant: 'px' | 'axis' | 'percent';
}>;

function field(props: Props = {}) {
  const committed: number[] = [];
  const onchange = vi.fn((input: HTMLInputElement) => committed.push(Number(input.value)));
  const view = render(NumberField, {
    props: { name: 'radius', label: 'Radius', value: 5, min: 0, max: 20, onchange, ...props },
  });
  const input = view.container.querySelector<HTMLInputElement>('input')!;
  const up = view.container.querySelector<HTMLButtonElement>('button[aria-label="Increase"]')!;
  const down = view.container.querySelector<HTMLButtonElement>('button[aria-label="Decrease"]')!;
  return { ...view, input, up, down, onchange, committed };
}

const press = async (button: HTMLButtonElement) => {
  button.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));
  await tick();
};
const release = async (button: HTMLButtonElement) => {
  button.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0 }));
  await tick();
};

describe('a number field with its own arrows (board Editor-NumberStepper)', () => {
  it('stays a number field, its bounds and step on the input for the keyboard’s ↑ ↓', () => {
    const { input } = field({ step: 0.25, min: -4, max: 4 });
    expect(input.type).toBe('number');
    expect(input.min).toBe('-4');
    expect(input.max).toBe('4');
    expect(input.step).toBe('0.25');
    expect(input.getAttribute('aria-label')).toBe('Radius');
  });

  it('draws two arrows in the frame, after the unit, that never take the focus', () => {
    const { container, up, down } = field({ unit: 'px' });
    const frame = container.querySelector('label.he-field')!;
    const parts = [...frame.children].map((el) => el.className);
    expect(parts.findIndex((c) => c.includes('he-field-unit'))).toBeLessThan(
      parts.findIndex((c) => c.includes('he-steps')),
    );
    for (const button of [up, down]) {
      expect(button.tabIndex).toBe(-1);
      expect(button.type).toBe('button');
      expect(button.querySelector('svg')).not.toBeNull();
    }
  });

  it('puts a prefix before the figure, the arrows still at the end', () => {
    const { container } = field({ prefix: 'X', variant: 'axis', min: undefined, max: undefined });
    const frame = container.querySelector('label.he-field')!;
    expect(frame.firstElementChild!.textContent).toBe('X');
    expect(frame.lastElementChild!.className).toContain('he-steps');
  });

  it('takes one step per press and commits it the way a typed value is', async () => {
    const { up, down, committed } = field({ value: 5 });
    await press(up);
    await release(up);
    expect(committed).toEqual([6]);
    await press(down);
    await release(down);
    expect(committed).toEqual([6, 5]);
  });

  it('steps by the field’s own step: a grid for position and size', async () => {
    const { up, committed } = field({ value: 1, step: 0.25, min: undefined, max: undefined });
    await press(up);
    expect(committed).toEqual([1.25]);
  });

  it('keeps the focus where it was', async () => {
    const { input, up } = field();
    input.focus();
    const pointer = new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 });
    up.dispatchEvent(pointer);
    expect(pointer.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(input);
  });

  it('repeats while held, on the stylesheet’s beat — 400 ms, then every 60 — and stops on release', async () => {
    // No timer on this page (spec §2): an animation's own events are the beat.
    const { up, committed } = field({ value: 5 });
    await press(up);
    expect(up.classList).toContain('held');
    up.dispatchEvent(new Event('animationstart'));
    up.dispatchEvent(new Event('animationiteration'));
    up.dispatchEvent(new Event('animationiteration'));
    await tick();
    expect(committed).toEqual([6, 7, 8, 9]);

    await release(up);
    expect(up.classList).not.toContain('held');
  });

  it('stops repeating when the pointer leaves the arrow', async () => {
    const { up } = field();
    await press(up);
    up.dispatchEvent(new PointerEvent('pointerleave'));
    await tick();
    expect(up.classList).not.toContain('held');
  });

  it('greys out and holds still the arrow whose bound is reached', async () => {
    const top = field({ value: 20 });
    expect(top.up.disabled).toBe(true);
    expect(top.down.disabled).toBe(false);
    cleanup();
    const bottom = field({ value: 0 });
    expect(bottom.down.disabled).toBe(true);
    expect(bottom.up.disabled).toBe(false);
  });

  it('holds nothing when the press itself reaches the bound', async () => {
    // One step from the max: the press lands on it, and the hold it would
    // have started fired once more on a disabled arrow — a change that
    // changed nothing, an undo step that undid nothing.
    const { up, committed } = field({ value: 19 });
    await press(up);
    expect(committed).toEqual([20]);
    expect(up.classList).not.toContain('held');
    up.dispatchEvent(new Event('animationstart'));
    await tick();
    expect(committed).toEqual([20]);
  });

  it('still steps for a click that came without a pointer (a screen reader)', async () => {
    const { up, committed } = field({ value: 5 });
    up.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 }));
    await tick();
    expect(committed).toEqual([6]);
  });
});
