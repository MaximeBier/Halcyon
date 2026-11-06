// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const src = join(dirname(fileURLToPath(import.meta.url)), '..');
const withoutComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const app = withoutComments(readFileSync(join(src, 'styles', 'app.css'), 'utf-8'));
const controls = withoutComments(readFileSync(join(src, 'styles', 'controls.css'), 'utf-8'));

function components(dir: string): { name: string; source: string; style: string }[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return components(path);
    if (!name.endsWith('.svelte')) return [];
    const source = readFileSync(path, 'utf-8');
    const style = /<style>([\s\S]*?)<\/style>/.exec(source)?.[1] ?? '';
    return [{ name: basename(path), source, style: withoutComments(style) }];
  });
}

/** The selectors of every rule that sets `cursor: <value>`. */
function cursorSelectors(css: string, value: string): string[] {
  return css
    .split('}')
    .filter((rule) => new RegExp(`cursor:\\s*${value}\\b`).test(rule))
    .map((rule) => (rule.split('{').at(-2) ?? '').replace(/\s+/g, ' ').trim());
}

describe('cursors (spec §16.13)', () => {
  it('shows the arrow over the whole interface', () => {
    expect(cursorSelectors(app, 'default')).toContain('body');
  });

  it('shows the text cursor in a field that can be typed into, and only there', () => {
    const [editable] = cursorSelectors(app, 'text');
    expect(editable).toBeDefined();
    for (const part of ['input', 'textarea', '[contenteditable', ':disabled', '[readonly]']) {
      expect(editable).toContain(part);
    }
    // Not typed into: a slider, a swatch, a box to tick.
    for (const type of ['range', 'color', 'checkbox']) {
      expect(editable).toMatch(new RegExp(`\\[type=['"]?${type}`));
    }
  });

  it('sets the text cursor by hand nowhere but on the well of a number field', () => {
    // The well is the field: a click anywhere in it puts the caret in.
    const byHand = [
      ...components(src).flatMap(({ name, style }) =>
        [...cursorSelectors(style, 'text'), ...cursorSelectors(style, 'auto')].map(
          (selector) => `${name}: ${selector}`,
        ),
      ),
      ...[...cursorSelectors(controls, 'text'), ...cursorSelectors(controls, 'auto')].map(
        (selector) => `controls.css: ${selector}`,
      ),
    ];
    // And on a value to copy (the overlay URL): one click selects it all.
    expect(byHand).toEqual(['controls.css: .he-field', 'controls.css: .he-copy-value']);
  });

  it('takes the arrow back on the well of a field that is disabled', () => {
    expect(cursorSelectors(controls, 'default')).toContain(
      '.he-field:has(.he-field-input:disabled)',
    );
  });
});

describe('a number field takes the focus wherever it is clicked', () => {
  it('draws every well as the label of its input', () => {
    // A span around a content-sized input only answered a click on the figure.
    const wells = components(src).flatMap(({ name, source }) =>
      [...source.matchAll(/<(\w+)\s+class="he-field[\s"]/g)].map((m) => `${name}: <${m[1]}>`),
    );
    expect(wells.length).toBeGreaterThan(0);
    expect(wells.filter((well) => !well.endsWith('<label>'))).toEqual([]);
  });
});
