// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Focus, one rule per family (board Editor-FocusStates, note noteFocus, spec
 * §16.13), held in the shared sheet; components keep only what places it.
 */
const here = dirname(fileURLToPath(import.meta.url));
const strip = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const controls = strip(readFileSync(join(here, '..', 'styles', 'controls.css'), 'utf-8'));
const components = readdirSync(here)
  .filter((name) => name.endsWith('.svelte'))
  .map((name) => {
    const source = readFileSync(join(here, name), 'utf-8');
    return { name, source, style: strip(/<style>([\s\S]*?)<\/style>/.exec(source)?.[1] ?? '') };
  });
const style = (name: string) => components.find((c) => c.name === name)!.style;

/** Every rule as [selectors, declarations], whitespace folded. */
const rules = (css: string) =>
  [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(
    (m) => [m[1]!.replace(/\s+/g, ' ').trim(), m[2]!.replace(/\s+/g, ' ')] as const,
  );
/** The last rule naming the selector: the one the cascade lets win. */
const ruleFor = (css: string, selector: string) =>
  [...rules(css)].reverse().find(([selectors]) =>
    selectors
      .split(',')
      .map((s) => s.trim())
      .includes(selector),
  )?.[1] ?? '';

describe('1. a field: the accent border, from the mouse as from the keyboard', () => {
  it('is one rule in the shared sheet, on :focus, no outline', () => {
    const field = rules(controls).find(
      ([selectors]) =>
        selectors.includes('input:not(') &&
        selectors.includes(':focus') &&
        !selectors.includes(':focus-visible'),
    );
    expect(field).toBeDefined();
    expect(field![1]).toMatch(/outline:\s*none/);
    expect(field![1]).toMatch(/border-color:\s*var\(--he-accent\)/);
  });

  it('is not redrawn by a component: no input focus rule of their own', () => {
    const local = components.flatMap(({ name, style: css }) =>
      rules(css)
        .filter(([selectors]) => /input[^,]*:focus/.test(selectors))
        .map(([selectors]) => `${name}: ${selectors}`),
    );
    expect(local).toEqual([]);
  });

  it('lights a composed field’s frame whatever inside has the focus', () => {
    expect(ruleFor(controls, '.he-field:focus-within')).toMatch(
      /border-color:\s*var\(--he-accent\)/,
    );
  });

  it('gives the profile name its rest border, the accent only with the focus', () => {
    expect(ruleFor(style('ProfileBar.svelte'), '.edit input')).toMatch(
      /border:\s*1px solid var\(--he-border-control\)/,
    );
  });
});

describe('2. a control: the accent ring, keyboard only', () => {
  it('draws 2 px, 2 px out, on :focus-visible', () => {
    const ring = ruleFor(controls, '.he-btn-primary:focus-visible');
    expect(ring).toMatch(/outline:\s*2px solid var\(--he-accent\)/);
    expect(ring).toMatch(/outline-offset:\s*2px/);
  });

  it('rings fonts, presets and icons 4 px out, their choice a ring of its own', () => {
    expect(ruleFor(controls, '.he-choice:focus-visible')).toMatch(/outline-offset:\s*4px/);
    const chosen = ruleFor(controls, ".he-choice[aria-pressed='true']");
    expect(chosen).toMatch(/box-shadow:/);
    expect(chosen).toMatch(/outline:\s*none/);
    // No component draws the choice as an outline any more: it took the ring's place.
    for (const name of ['StylePanel.svelte', 'KeyPopover.svelte']) {
      expect(style(name)).not.toMatch(/\.on\s*\{[^}]*outline:\s*2px/);
    }
  });

  it('never sets a ring 1 px out', () => {
    const odd = components.filter(({ style: css }) => /outline-offset:\s*1px/.test(css));
    expect(odd.map(({ name }) => name)).toEqual([]);
  });
});

describe('3. inside, where a ring outside would be cut or touch a neighbour', () => {
  it('draws segments, profile tabs and Keys rows 2 px in', () => {
    expect(ruleFor(controls, '.he-segment:focus-visible')).toMatch(/outline-offset:\s*-2px/);
    expect(ruleFor(style('ProfileBar.svelte'), '.tab:focus-visible')).toMatch(
      /outline-offset:\s*-2px/,
    );
    expect(ruleFor(style('KeyList.svelte'), '.pick:focus-visible')).toMatch(
      /outline-offset:\s*-2px/,
    );
  });
});

describe('4. an option walked with the arrows: the hover’s highlight, no ring', () => {
  it('highlights menu items and the settings rows', () => {
    expect(ruleFor(controls, '.he-menu-item:focus-visible')).toMatch(
      /background:\s*var\(--he-highlight\)/,
    );
    // The keyboard layout list sits in a row that already lights up.
    expect(ruleFor(style('SettingsMenu.svelte'), '.row select:focus-visible')).toMatch(
      /outline:\s*none/,
    );
  });
});

describe('a value to copy (the overlay URL): the well, never a field', () => {
  it('has no border, selects whole on a click, and is not a field', () => {
    const value = ruleFor(controls, '.he-copy-value');
    expect(value).toMatch(/background:\s*var\(--he-well\)/);
    expect(value).toMatch(/border:\s*none/);
    expect(value).toMatch(/user-select:\s*all/);
    expect(value).toMatch(/text-overflow:\s*ellipsis/);
    expect(value).toMatch(/white-space:\s*nowrap/);
  });
});

describe('5. a container focused by script: nothing to see', () => {
  it('is one rule in the shared sheet', () => {
    expect(ruleFor(controls, "[tabindex='-1']:focus")).toMatch(/outline:\s*none/);
  });
});
