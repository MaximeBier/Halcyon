import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/svelte';
import KeyList from './KeyList.svelte';
import type { OverlayConfig } from '../config/schema';

afterEach(cleanup);

type Key = OverlayConfig['keys'][number];
const KEYS: Key[] = [
  {
    id: 1,
    usage: 0x1d,
    mode: 'key',
    label: 'Z',
    x: 0,
    y: 0,
    w: 1,
    h: 1,
    style: { fillColor: '#E4907A' },
  },
  { id: 2, usage: 0x14, mode: 'key', label: 'Q', x: 1, y: 0, w: 1, h: 1 },
  { id: 3, usage: 0xe1, mode: 'axis', label: '⇧', x: 2, y: 0, w: 1, h: 1 },
];

function list(overrides: Record<string, unknown> = {}) {
  const handlers = {
    onPick: vi.fn(),
    onEdit: vi.fn(),
    onDelete: vi.fn(),
    onDeleteSelected: vi.fn(),
  };
  const view = render(KeyList, {
    props: { keys: KEYS, selectedIds: [], offscreen: [], ...handlers, ...overrides },
  });
  return { ...view, ...handlers };
}
const row = (c: HTMLElement, id: number) => c.querySelector<HTMLElement>(`[data-key-row="${id}"]`)!;
/** The page's tooltip around an element (board Editor-Tooltip), never a native title. */
const tipOf = (el: Element | null) =>
  el?.closest('[data-tooltip-host]')?.querySelector('[role="tooltip"]')?.textContent;

describe('KeyList', () => {
  it('says nothing yet when there is nothing to list', () => {
    const { container } = list({ keys: [] });
    expect(container.textContent).toContain('No keys yet.');
  });

  it('marks a key with a style of its own with the accent dot, and only that key', () => {
    const { container } = list();

    expect(tipOf(row(container, 1).querySelector('[data-own-style]'))).toBe('Own style');
    expect(row(container, 2).querySelector('[data-own-style]')).toBeNull();
  });

  it('names the gamepad keys, and says nothing of keyboard ones', () => {
    // Spec §16.14: "gamepad" for `mode: 'axis'`; no tag at all for a key.
    const { container } = list();

    expect(row(container, 3).textContent).toContain('gamepad');
    expect(row(container, 2).querySelector('[data-pick]')!.textContent!.trim()).toBe('Q');
  });

  it('carries no override or renamed tag any more', () => {
    const { container } = list();

    expect(container.textContent).not.toMatch(/override|renamed|\baxis\b/);
  });

  it('opens the popover of its own key from the pencil', () => {
    const { container, onEdit } = list();

    row(container, 2).querySelector<HTMLButtonElement>('[data-edit]')!.click();

    expect(onEdit).toHaveBeenCalledWith(2);
  });

  it('deletes its own key from the bin', () => {
    const { container, onDelete } = list();

    row(container, 3).querySelector<HTMLButtonElement>('[data-delete]')!.click();

    expect(onDelete).toHaveBeenCalledWith(3);
  });

  it('names both actions for whoever cannot see the icons', () => {
    const { container } = list();
    const actions = row(container, 1);

    expect(actions.querySelector('[data-edit]')!.getAttribute('aria-label')).toBe('Edit Z');
    expect(actions.querySelector('[data-delete]')!.getAttribute('aria-label')).toBe('Delete Z');
  });

  it('hands a click and a double click on the row to the page', () => {
    const { container, onPick, onEdit } = list();
    const pick = row(container, 1).querySelector<HTMLButtonElement>('[data-pick]')!;

    pick.click();
    pick.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));

    expect(onPick.mock.calls[0]![0]).toBe(1);
    expect(onEdit).toHaveBeenCalledWith(1);
  });

  it('says which rows are chosen', () => {
    const { container } = list({ selectedIds: [2] });

    expect(row(container, 2).classList.contains('selected')).toBe(true);
    expect(row(container, 1).classList.contains('selected')).toBe(false);
  });

  it('says when a key is off the work surface', () => {
    const { container } = list({ offscreen: [3] });

    expect(row(container, 3).textContent).toContain('off screen');
    expect(tipOf(row(container, 3).querySelector('[data-offscreen]'))).toBe(
      'Not on the work surface: widen the window, or lower “Key size” in “Global style”',
    );
  });

  it('names its two buttons on the page’s tooltip, and for a screen reader by the key', () => {
    const { container } = list();
    const edit = row(container, 2).querySelector('[data-edit]')!;
    const del = row(container, 2).querySelector('[data-delete]')!;

    expect(tipOf(edit)).toBe('Edit');
    expect(tipOf(del)).toBe('Delete');
    expect(edit.getAttribute('aria-label')).toBe('Edit Q');
    expect(container.querySelector('[title]')).toBeNull();
  });

  it('offers to delete a multiple selection at once', () => {
    const { container, onDeleteSelected } = list({ selectedIds: [1, 2] });
    const button = container.querySelector<HTMLButtonElement>('[data-delete-selected]')!;

    expect(button.textContent!.trim()).toBe('Delete 2 selected keys');
    button.click();
    expect(onDeleteSelected).toHaveBeenCalled();
  });
});
