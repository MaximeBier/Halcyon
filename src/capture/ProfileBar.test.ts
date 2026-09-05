import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/svelte';
import ProfileBar from './ProfileBar.svelte';

afterEach(cleanup);

const COUNTS: Record<string, number> = { Apex: 6, 'ZQSD minimal': 4, Default: 0 };

function bar(overrides: Record<string, unknown> = {}) {
  const handlers = {
    onSelect: vi.fn(),
    onCreate: vi.fn(),
    onDuplicate: vi.fn(),
    onRename: vi.fn(),
    onRemove: vi.fn(),
    onExport: vi.fn(),
    onImport: vi.fn(),
  };
  const props = {
    names: ['Apex', 'ZQSD minimal'],
    active: 'Apex',
    keyCount: (name: string) => COUNTS[name] ?? 0,
    ...handlers,
    ...overrides,
  };
  return { ...render(ProfileBar, { props }), ...handlers };
}

const tab = (c: HTMLElement, name: string) =>
  c.querySelector<HTMLButtonElement>(`[data-tab="${name}"]`)!;
const more = (c: HTMLElement) => c.querySelector<HTMLButtonElement>('[data-more]');
const add = (c: HTMLElement) => c.querySelector<HTMLButtonElement>('[data-add]')!;
const menu = (c: HTMLElement) => c.querySelector<HTMLElement>('[data-menu]');
const action = (c: HTMLElement, name: string) =>
  c.querySelector<HTMLButtonElement>(`[data-action="${name}"]`);
const field = (c: HTMLElement) => c.querySelector<HTMLInputElement>('[data-name-field]');

async function openMore(c: HTMLElement) {
  more(c)!.click();
  await Promise.resolve();
}

async function openAdd(c: HTMLElement) {
  add(c).click();
  await Promise.resolve();
}

function submit(input: HTMLInputElement, value: string) {
  input.value = value;
  input.form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  return Promise.resolve();
}

describe('the tab row', () => {
  it('shows every profile with its key count, the active one marked', () => {
    // The whole point of the row over the dropdown it replaced: nothing to
    // open, every profile and its size in view (board 3a).
    const { container } = bar();

    expect(tab(container, 'Apex').getAttribute('aria-current')).toBe('true');
    expect(tab(container, 'ZQSD minimal').getAttribute('aria-current')).toBeNull();
    expect(tab(container, 'Apex').textContent).toContain('6');
    expect(tab(container, 'ZQSD minimal').textContent).toContain('4');
    expect(menu(container)).toBeNull();
  });

  it('switches on a click, and does not reload the profile already open', () => {
    // Switching reloads from storage and broadcasts to OBS. On the active
    // profile that is a no-op at best; a stray reload is invisible until
    // something is missing.
    const { container, onSelect } = bar();

    tab(container, 'ZQSD minimal').click();
    expect(onSelect).toHaveBeenCalledWith('ZQSD minimal');

    onSelect.mockClear();
    tab(container, 'Apex').click();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('offers the options only on the active tab', () => {
    // Every action behind `⋯` acts on the open profile: on another tab it
    // would promise what a click there cannot keep.
    const { container } = bar();

    const slot = more(container)!.parentElement!;
    expect(slot.contains(tab(container, 'Apex'))).toBe(true);
    expect(container.querySelectorAll('[data-more]')).toHaveLength(1);
  });

  it('promises no more than plain buttons: no tablist, tab, menu or menuitem role', async () => {
    // `tablist` commits to arrow-key navigation, `menu` too — nothing here
    // delivers either, only Tab does. Buttons with `aria-current` are honest.
    const { container } = bar();
    await openMore(container);

    expect(
      container.querySelectorAll(
        '[role="tablist"], [role="tab"], [role="menu"], [role="menuitem"], [role="menuitemradio"]',
      ),
    ).toHaveLength(0);
    expect(menu(container)!.getAttribute('aria-label')).toBeTruthy();
    expect(more(container)!.getAttribute('aria-haspopup')).not.toBe('menu');
  });
});

describe('the active tab menu', () => {
  it('opens and closes on its own trigger', async () => {
    const { container } = bar();

    await openMore(container);
    expect(menu(container)).not.toBeNull();
    expect(more(container)!.getAttribute('aria-expanded')).toBe('true');

    await openMore(container);
    expect(menu(container)).toBeNull();
    expect(more(container)!.getAttribute('aria-expanded')).toBe('false');
  });

  it('opens on a right click too', async () => {
    const { container, onSelect } = bar();

    tab(container, 'Apex').dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, cancelable: true }),
    );
    await Promise.resolve();

    expect(menu(container)).not.toBeNull();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('switches first when the right click lands on another tab', async () => {
    // The menu acts on the open profile, so "act on this one" has to start by
    // opening it — the honest route rather than a menu that lies about its
    // target.
    const { container, onSelect } = bar();

    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    tab(container, 'ZQSD minimal').dispatchEvent(event);
    await Promise.resolve();

    expect(event.defaultPrevented).toBe(true);
    expect(onSelect).toHaveBeenCalledWith('ZQSD minimal');
  });

  it('closes on Escape, handing the focus back to the trigger', async () => {
    const { container } = bar();
    await openMore(container);
    expect(menu(container)!.contains(document.activeElement)).toBe(true);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await Promise.resolve();

    expect(menu(container)).toBeNull();
    expect(document.activeElement).toBe(more(container));
  });

  it('closes when another tab is clicked', async () => {
    const { container, onSelect } = bar();
    await openMore(container);

    tab(container, 'ZQSD minimal').click();
    await Promise.resolve();

    expect(menu(container)).toBeNull();
    expect(onSelect).toHaveBeenCalledWith('ZQSD minimal');
  });

  it('duplicates the profile it names', async () => {
    const { container, onDuplicate } = bar();
    await openMore(container);

    expect(action(container, 'duplicate')!.textContent).toContain('Apex');
    action(container, 'duplicate')!.click();
    await Promise.resolve();

    expect(onDuplicate).toHaveBeenCalledTimes(1);
    expect(menu(container)).toBeNull();
  });

  it('exports under the name of the profile', async () => {
    const { container, onExport } = bar();
    await openMore(container);

    expect(action(container, 'export')!.textContent).toContain('Apex');
    action(container, 'export')!.click();

    expect(onExport).toHaveBeenCalledTimes(1);
  });
});

describe('renaming a profile', () => {
  it('starts from the name it already has', async () => {
    // Renaming is almost always a correction, not a fresh idea: an empty field
    // makes someone retype what they can see on the tab.
    const { container } = bar();
    await openMore(container);

    action(container, 'rename')!.click();
    await Promise.resolve();

    expect(field(container)!.value).toBe('Apex');
    // The field stands in for the rows: nothing else to click while typing.
    expect(action(container, 'duplicate')).toBeNull();
  });

  it('renames on Enter and closes', async () => {
    const { container, onRename } = bar();
    await openMore(container);
    action(container, 'rename')!.click();
    await Promise.resolve();

    await submit(field(container)!, '  Apex Legends  ');

    expect(onRename).toHaveBeenCalledWith('Apex Legends');
    expect(menu(container)).toBeNull();
  });

  it('renames nothing from an empty field', async () => {
    const { container, onRename } = bar();
    await openMore(container);
    action(container, 'rename')!.click();
    await Promise.resolve();

    await submit(field(container)!, '   ');

    expect(onRename).not.toHaveBeenCalled();
    expect(field(container)).not.toBeNull();
  });

  it('opens the field straight from a double click on the tab', async () => {
    const { container } = bar();

    tab(container, 'Apex').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    await Promise.resolve();

    expect(field(container)!.value).toBe('Apex');
  });

  it('gives up on Escape without renaming', async () => {
    const { container, onRename } = bar();
    await openMore(container);
    action(container, 'rename')!.click();
    await Promise.resolve();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await Promise.resolve();

    expect(onRename).not.toHaveBeenCalled();
    expect(menu(container)).toBeNull();
  });
});

describe('deleting a profile', () => {
  it('takes two clicks, because the first one destroys a layout', async () => {
    // A confirmation step in the row itself is the smallest thing that keeps
    // a misclick from costing an evening of work.
    const { container, onRemove } = bar();
    await openMore(container);

    action(container, 'remove')!.click();
    await Promise.resolve();
    expect(onRemove).not.toHaveBeenCalled();
    expect(action(container, 'remove')!.textContent).toContain('Really delete');

    action(container, 'remove')!.click();
    await Promise.resolve();
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it('forgets the confirmation when the menu closes', async () => {
    const { container } = bar();
    await openMore(container);
    action(container, 'remove')!.click();
    await Promise.resolve();

    await openMore(container);
    await openMore(container);

    expect(action(container, 'remove')!.textContent).not.toContain('Really delete');
  });

  it('offers nothing to delete when a single profile is left', async () => {
    const { container } = bar({ names: ['Apex'] });
    await openMore(container);

    expect(action(container, 'remove')).toBeNull();
  });
});

describe('the + menu', () => {
  it('opens under the plus, with the focus inside', async () => {
    const { container } = bar();
    await openAdd(container);

    expect(menu(container)).not.toBeNull();
    expect(add(container).getAttribute('aria-expanded')).toBe('true');
    expect(menu(container)!.contains(document.activeElement)).toBe(true);
  });

  it('asks for a name before creating anything', async () => {
    const { container, onCreate } = bar();
    await openAdd(container);

    action(container, 'new')!.click();
    await Promise.resolve();
    expect(onCreate).not.toHaveBeenCalled();
    expect(field(container)!.value).toBe('');

    await submit(field(container)!, 'Valorant');

    expect(onCreate).toHaveBeenCalledWith('Valorant');
    expect(menu(container)).toBeNull();
  });

  it('creates nothing from an empty name', async () => {
    const { container, onCreate } = bar();
    await openAdd(container);
    action(container, 'new')!.click();
    await Promise.resolve();

    await submit(field(container)!, '   ');

    expect(onCreate).not.toHaveBeenCalled();
  });

  it('hands the chosen file over, clears the input, and closes', async () => {
    // Left uncleared, picking the same file twice fires nothing at all — which
    // is exactly what one does after fixing it by hand.
    const { container, onImport } = bar();
    await openAdd(container);

    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    const file = new File(['{}'], 'apex.json', { type: 'application/json' });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });

    // The assignment is watched, not the property: jsdom holds a file input's
    // value at '' whatever happens to it, so `expect(input.value).toBe('')`
    // passes before the component has done anything at all.
    const assigned: string[] = [];
    Object.defineProperty(input, 'value', {
      configurable: true,
      get: () => 'C:\\fakepath\\apex.json',
      set: (written: string) => void assigned.push(written),
    });

    input.dispatchEvent(new Event('change', { bubbles: true }));
    await Promise.resolve();

    expect(onImport).toHaveBeenCalledWith(file);
    expect(assigned).toEqual(['']);
    expect(menu(container)).toBeNull();
  });

  it('keeps import out of the per-profile menu', async () => {
    // `importFrom` always lands the file in a profile of its own, beside the
    // others — never in the open one, which is what a row under the active
    // tab would suggest.
    const { container } = bar();
    await openMore(container);

    expect(container.querySelector('input[type="file"]')).toBeNull();
  });

  it('opens one popover at a time', async () => {
    const { container } = bar();
    await openMore(container);
    await openAdd(container);

    expect(container.querySelectorAll('[data-menu]')).toHaveLength(1);
    expect(add(container).getAttribute('aria-expanded')).toBe('true');
    expect(more(container)!.getAttribute('aria-expanded')).toBe('false');
  });
});
