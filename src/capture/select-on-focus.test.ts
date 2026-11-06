import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { selectOnFocus } from './select-on-focus';

const here = dirname(fileURLToPath(import.meta.url));

function field(value = 'A') {
  const input = document.createElement('input');
  input.type = 'text';
  input.value = value;
  document.body.append(input);
  const action = selectOnFocus(input);
  return { input, action };
}

const selectedAll = (input: HTMLInputElement) =>
  input.selectionStart === 0 && input.selectionEnd === input.value.length;

const mouseup = (input: HTMLInputElement) => {
  const event = new MouseEvent('mouseup', { bubbles: true, cancelable: true });
  input.dispatchEvent(event);
  return event;
};

afterEach(() => {
  document.body.innerHTML = '';
});

describe('a field that selects what it holds on focus (spec §16.13)', () => {
  it('selects everything when it takes the focus, from the keyboard', () => {
    const { input } = field('#7C9EFF');
    input.focus();
    expect(selectedAll(input)).toBe(true);
  });

  it('keeps the selection through the click that focused it', () => {
    const { input } = field('4455');
    input.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    input.focus();
    // Left alone, the release would drop a caret where the pointer is.
    expect(mouseup(input).defaultPrevented).toBe(true);
    expect(selectedAll(input)).toBe(true);
  });

  it('lets a second click place the caret', () => {
    const { input } = field('4455');
    input.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    input.focus();
    mouseup(input);

    input.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(mouseup(input).defaultPrevented).toBe(false);
  });

  it('never swallows a click on a field focused from the keyboard', () => {
    const { input } = field('4455');
    input.focus();
    input.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(mouseup(input).defaultPrevented).toBe(false);
  });

  it('lets go of the field when the component does', () => {
    const { input, action } = field('A');
    action.destroy();
    input.value = 'AB';
    input.setSelectionRange(1, 1);
    input.focus();
    expect(selectedAll(input)).toBe(false);
  });
});

/**
 * Where it applies: every field of the page, for one behaviour throughout —
 * figures, colour codes, a key's label, a profile's name, the URL to copy, the
 * passwords and the font search (decided 2026-11-06).
 */
describe('the fields that select on focus', () => {
  const source = (name: string) => readFileSync(join(here, name), 'utf-8');
  const inputs = (name: string) =>
    [...source(name).matchAll(/<input\b[\s\S]*?\/>/g)].map((m) => m[0]);
  const selects = (input: string) => input.includes('use:selectOnFocus');

  it.each([
    ['NumberField.svelte', 'he-field-input'],
    ['ObsPopover.svelte', 'class="port"'],
    ['Wizard.svelte', 'type="number"'],
    ['StylePanel.svelte', 'class="hex"'],
    ['KeyPopover.svelte', 'class="hex"'],
    ['KeyPopover.svelte', 'class="label-text"'],
    ['ProfileBar.svelte', 'data-name-field'],
    ['InstalledFontsMenu.svelte', 'type="search"'],
    ['ObsPopover.svelte', "'password'"],
    ['Wizard.svelte', "'password'"],
  ])('%s selects on focus: %s', (file, marker) => {
    const input = inputs(file).find((i) => i.includes(marker));
    expect(input, marker).toBeDefined();
    expect(selects(input!)).toBe(true);
  });
});
