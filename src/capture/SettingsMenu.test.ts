import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/svelte';
import SettingsMenu from './SettingsMenu.svelte';
import type { OverlayConfig } from '../config/schema';

afterEach(cleanup);

function menu(overrides: { layout?: OverlayConfig['layoutOverride']; toReport?: number } = {}) {
  const handlers = { onLayout: vi.fn(), onPickDevice: vi.fn(), onDiagnostics: vi.fn() };
  const props = {
    layout: overrides.layout ?? ('auto' as const),
    toReport: overrides.toReport ?? 0,
    ...handlers,
  };
  return { ...render(SettingsMenu, { props }), ...handlers };
}

const trigger = (c: HTMLElement) => c.querySelector<HTMLButtonElement>('[data-settings-trigger]')!;
const panel = (c: HTMLElement) => c.querySelector<HTMLElement>('[data-settings-menu]');
const action = (c: HTMLElement, name: string) =>
  c.querySelector<HTMLButtonElement>(`[data-action="${name}"]`)!;

async function open(c: HTMLElement) {
  await fireEvent.click(trigger(c));
}

describe('the gear', () => {
  it('opens and closes the menu on its own click, moving the focus in and back', async () => {
    const { container } = menu();
    expect(panel(container)).toBeNull();

    await open(container);
    expect(panel(container)).not.toBeNull();
    expect(trigger(container).getAttribute('aria-expanded')).toBe('true');
    expect(panel(container)!.contains(document.activeElement)).toBe(true);

    await open(container);
    expect(panel(container)).toBeNull();
    expect(document.activeElement).toBe(trigger(container));
  });

  it('closes on Escape', async () => {
    const { container } = menu();
    await open(container);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await Promise.resolve();

    expect(panel(container)).toBeNull();
  });

  it('wears no dot while everything behind it is at its default', () => {
    const { container } = menu();

    expect(container.querySelector('[data-flagged]')).toBeNull();
  });

  it('wears the dot for a layout set by hand, and for something to report', () => {
    // §9.3 on a trigger: what the gear hides departs from the defaults, or is
    // ours to fix. Hiding either behind an unmarked icon is how it stays
    // hidden.
    expect(menu({ layout: 'azerty' }).container.querySelector('[data-flagged]')).not.toBeNull();
    cleanup();
    expect(menu({ toReport: 2 }).container.querySelector('[data-flagged]')).not.toBeNull();
  });

  it('promises no more than a popover: no menu or menuitem role', async () => {
    const { container } = menu();
    await open(container);

    expect(container.querySelectorAll('[role="menu"], [role="menuitem"]')).toHaveLength(0);
    expect(trigger(container).getAttribute('aria-haspopup')).not.toBe('menu');
  });
});

describe('what the menu holds', () => {
  it('lets the keyboard layout be forced, and shows the one in force', async () => {
    const { container, onLayout } = menu({ layout: 'qwerty' });
    await open(container);

    const select = panel(container)!.querySelector<HTMLSelectElement>('select')!;
    expect(select.value).toBe('qwerty');

    select.value = 'azerty';
    await fireEvent.change(select);

    expect(onLayout).toHaveBeenCalledWith('azerty');
    // Forcing a layout is not the end of a visit: the menu stays for the
    // next row.
    expect(panel(container)).not.toBeNull();
  });

  it('opens the device picker, and says so honestly', async () => {
    // Not "Rescan devices": nothing here looks on its own, the click opens
    // Chrome's picker and that is all it promises.
    const { container, onPickDevice } = menu();
    await open(container);

    expect(action(container, 'device').textContent).toMatch(/choose device/i);
    await fireEvent.click(action(container, 'device'));

    expect(onPickDevice).toHaveBeenCalledTimes(1);
    expect(panel(container)).toBeNull();
  });

  it('opens Diagnostics and closes itself', async () => {
    const { container, onDiagnostics } = menu();
    await open(container);

    await fireEvent.click(action(container, 'diagnostics'));

    expect(onDiagnostics).toHaveBeenCalledTimes(1);
    expect(panel(container)).toBeNull();
  });

  it('counts what is ours to fix on the Diagnostics row', async () => {
    const { container } = menu({ toReport: 3 });
    await open(container);

    expect(action(container, 'diagnostics').textContent).toContain('3 to report');
  });

  it('names the build, so a report can without opening Diagnostics', async () => {
    const { container } = menu();
    await open(container);

    expect(panel(container)!.querySelector('[data-build]')!.textContent).toMatch(/^Halcyon \S+/);
  });

  it('keeps Start with Windows out of it', async () => {
    // The one feature that changes how the product is used stays a header
    // control of its own (board 3a), never a row in the rare-settings menu.
    const { container } = menu();
    await open(container);

    expect(panel(container)!.textContent).not.toMatch(/start with windows/i);
  });
});
