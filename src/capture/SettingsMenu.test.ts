import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import { openPicker } from '../test/picker';
import SettingsMenu from './SettingsMenu.svelte';
import type { OverlayConfig } from '../config/schema';

afterEach(cleanup);

function menu(
  overrides: {
    layout?: OverlayConfig['layoutOverride'];
    toCheck?: number;
    copies?: boolean;
    obsConnected?: boolean;
  } = {},
) {
  const handlers = {
    onLayout: vi.fn(),
    onPickDevice: vi.fn(),
    onDiagnostics: vi.fn(),
    onCopyUrl: vi.fn(() => Promise.resolve(overrides.copies ?? true)),
    onObs: vi.fn(),
  };
  const props = {
    layout: overrides.layout ?? ('auto' as const),
    toCheck: overrides.toCheck ?? 0,
    obsConnected: overrides.obsConnected ?? true,
    ...handlers,
  };
  return { ...render(SettingsMenu, { props }), ...handlers };
}

const trigger = (c: HTMLElement) => c.querySelector<HTMLButtonElement>('[data-settings-trigger]')!;
/** The page's tooltip around the gear (board Editor-Tooltip), never a native title. */
const tip = (c: HTMLElement) =>
  trigger(c).closest('[data-tooltip-host]')?.querySelector(':scope > [role="tooltip"]')
    ?.textContent;
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

  it('stays open when Escape closes a dropdown', async () => {
    const { container } = menu();
    await open(container);
    const picker = openPicker();

    picker.escape();
    await Promise.resolve();

    expect(panel(container)).not.toBeNull();
    picker.remove();
  });

  it('wears no dot while everything behind it is at its default', () => {
    const { container } = menu();

    expect(container.querySelector('[data-flagged]')).toBeNull();
  });

  it('wears the dot for what Diagnostics asks to look at, and for nothing else', () => {
    // Spec §11: only the Needs attention lines light it — a forced layout is
    // one of them, counted by the page, not guessed here.
    expect(menu({ layout: 'azerty' }).container.querySelector('[data-flagged]')).toBeNull();
    cleanup();
    expect(menu({ toCheck: 2 }).container.querySelector('[data-flagged]')).not.toBeNull();
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

  it('lists its rows in the board’s order, OBS connection between the device and the URL', async () => {
    const { container } = menu();
    await open(container);

    const rows = [...panel(container)!.querySelectorAll<HTMLElement>('[data-action]')].map(
      (row) => row.dataset.action,
    );
    expect(rows).toEqual(['device', 'obs', 'copy-url', 'diagnostics']);
  });

  it('opens the OBS popover from OBS connection, and closes itself', async () => {
    // A second way in: down, the OBS pill's click retries, and the popover —
    // port, password — was a right click away, when it is needed most.
    for (const obsConnected of [true, false]) {
      const { container, onObs } = menu({ obsConnected });
      await open(container);

      await fireEvent.click(action(container, 'obs'));

      expect(onObs).toHaveBeenCalledTimes(1);
      expect(panel(container)).toBeNull();
      cleanup();
    }
  });

  it('hangs the OBS popover under the gear when it opened it, in the menu’s place', async () => {
    // The App hands over the very popover the pill hangs; the gear gives it
    // its corner. Its click closes it there, like the pill's does under the pill.
    const onObsClose = vi.fn();
    const obsPanel = createRawSnippet((close: () => () => void) => ({
      render: () => '<div data-test-obs-panel></div>',
      setup: (element: Element) => {
        element.addEventListener('click', () => close()());
      },
    }));
    const { container } = render(SettingsMenu, {
      props: {
        layout: 'auto' as const,
        toCheck: 0,
        onLayout: vi.fn(),
        onPickDevice: vi.fn(),
        onDiagnostics: vi.fn(),
        onCopyUrl: vi.fn(() => Promise.resolve(true)),
        obsConnected: false,
        onObs: vi.fn(),
        obsOpen: true,
        onObsClose,
        obsPanel,
      },
    });

    const hung = container.querySelector('[data-test-obs-panel]')!;
    expect(hung).not.toBeNull();
    expect(hung.parentElement).toBe(container.querySelector('.settings'));

    await fireEvent.click(trigger(container));
    expect(onObsClose).toHaveBeenCalledTimes(1);
    expect(panel(container)).toBeNull();
  });

  it('says on OBS connection whether OBS is connected', async () => {
    const up = menu({ obsConnected: true });
    await open(up.container);
    const state = action(up.container, 'obs').querySelector<HTMLElement>('[data-obs-state]')!;
    expect(state.textContent!.trim()).toBe('Connected');
    expect(state.classList).not.toContain('down');
    expect(state.querySelector('.state-dot')).toBeNull();
    cleanup();

    const down = menu({ obsConnected: false });
    await open(down.container);
    const off = action(down.container, 'obs').querySelector<HTMLElement>('[data-obs-state]')!;
    expect(off.textContent!.trim()).toBe('Disconnected');
    expect(off.classList).toContain('down');
    expect(off.querySelector('.state-dot')).not.toBeNull();
  });

  it('counts what is ours to fix on the Diagnostics row', async () => {
    const { container } = menu({ toCheck: 3 });
    await open(container);

    expect(action(container, 'diagnostics').textContent).toContain('3 to check');
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

describe('the layout dropdown', () => {
  it("opens the page's own menu", async () => {
    const { container } = menu();
    await open(container);

    const select = container.querySelector('select[aria-label="Keyboard layout"]')!;
    expect(select.classList.contains('he-select')).toBe(true);
  });
});

describe('the gear button', () => {
  it('is a framed icon button, like undo and redo beside it', () => {
    const { container } = menu();
    expect(trigger(container).classList.contains('he-icon-btn')).toBe(true);
  });
});

describe('the gear says how much there is to check', () => {
  it('names the count on its tooltip and its label, and stays plain with nothing to check', () => {
    expect(tip(menu().container)).toBe('Settings');
    cleanup();
    const one = menu({ toCheck: 1 }).container;
    expect(tip(one)).toBe('Settings · 1 thing to check');
    expect(trigger(one).getAttribute('aria-label')).toBe('Settings · 1 thing to check');
    expect(trigger(one).hasAttribute('title')).toBe(false);
    cleanup();
    expect(tip(menu({ toCheck: 2 }).container)).toBe('Settings · 2 things to check');
  });

  it('keeps its tooltip out of the way of its own menu', async () => {
    const { container } = menu();
    await open(container);
    expect(tip(container)).toBeUndefined();
  });
});

describe('Copy overlay URL', () => {
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  it('copies the URL from the menu, says so, then goes back when its two seconds run out', async () => {
    // The two seconds are a CSS animation, never a timer: spec §2 bars
    // timers from the capture page (the Toast recipe).
    const { container, onCopyUrl } = menu();
    await open(container);

    action(container, 'copy-url').click();
    await settle();
    expect(onCopyUrl).toHaveBeenCalledTimes(1);
    expect(action(container, 'copy-url').textContent).toContain('Overlay URL copied');

    container.querySelector('[data-copy-label]')!.dispatchEvent(new Event('animationend'));
    await settle();
    expect(action(container, 'copy-url').textContent).toContain('Copy overlay URL');
  });

  it('starts over when the menu is reopened', async () => {
    const { container } = menu();
    await open(container);
    action(container, 'copy-url').click();
    await settle();

    await open(container);
    await open(container);

    expect(action(container, 'copy-url').textContent).toContain('Copy overlay URL');
  });

  it('forgets a copy that answers after the menu closed', async () => {
    // Escape before the clipboard answered: the late answer reopened the menu
    // on "Overlay URL copied", for a copy no one had just made.
    let answer!: (done: boolean) => void;
    const { container, onCopyUrl } = menu();
    onCopyUrl.mockImplementation(() => new Promise<boolean>((resolve) => (answer = resolve)));
    await open(container);
    action(container, 'copy-url').click();

    await open(container);
    answer(true);
    await settle();
    await open(container);

    expect(action(container, 'copy-url').textContent).toContain('Copy overlay URL');
  });

  it('says when the browser refused', async () => {
    const { container } = menu({ copies: false });
    await open(container);

    action(container, 'copy-url').click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const label = action(container, 'copy-url').querySelector('[data-copy-label]')!;
    expect(label.textContent!.trim()).toBe('Copy failed');
    // The way out, on the page's tooltip rather than a native title.
    expect(
      label.closest('[data-tooltip-host]')!.querySelector(':scope > [role="tooltip"]')!.textContent,
    ).toBe('Select the URL in the OBS pill’s popover instead');
    expect(label.hasAttribute('title')).toBe(false);
  });
});
