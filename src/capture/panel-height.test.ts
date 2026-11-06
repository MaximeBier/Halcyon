// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { UI_TOKENS } from '../styles/ui-tokens';

/**
 * jsdom lays nothing out, so the height of the stage-and-panel row is held
 * by its declarations (spec §16.12). Side by side, the row is exactly the
 * window under the header and the tabs: the panel scrolls inside it, never
 * the page, and the stage never grows with an unfolded Global style.
 */
const app = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'App.svelte'), 'utf-8');
const style = (/<style>([\s\S]*?)<\/style>/.exec(app)?.[1] ?? '').replace(/\/\*[\s\S]*?\*\//g, '');

/** Every side-by-side query's body, each cut at its own closing brace. */
const queries = style
  .split('@container app (min-width: 940px)')
  .slice(1)
  .map((rest) => {
    let depth = 0;
    for (let i = 0; i < rest.length; i++) {
      if (rest[i] === '{') depth++;
      if (rest[i] === '}' && --depth === 0) return rest.slice(0, i);
    }
    return rest;
  })
  .join('\n');

/** The declarations of `selector` inside the side-by-side container query. */
function sideBySide(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const rule = new RegExp(`(?:^|[\\s}])${escaped}\\s*\\{([^}]*)\\}`).exec(queries);
  expect(rule, `${selector} side by side`).not.toBeNull();
  return rule![1]!.replace(/\s+/g, ' ');
}

describe('the stage-and-panel row, side by side', () => {
  it('takes what the window leaves under the header and the tabs, whatever their height', () => {
    // The page is exactly the window, and the row its rest: a header on two
    // lines takes its share from the row, never from a sum written down
    // (`100vh − 104px` was wrong the moment the header wrapped).
    expect(sideBySide('.app.workspace')).toMatch(/block-size:\s*100vh/);
    const split = sideBySide('.split');
    expect(split).toMatch(/flex:\s*1 1 0/);
    expect(split).toMatch(/min-block-size:\s*var\(--he-stage-min-size\)/);
  });

  it('comes after the rules it overrides, which a container query does not outrank', () => {
    // Same specificity, so the later rule wins: placed before the row's own
    // rule, the side-by-side floor of 560 lost to the stacked `min-block-size: 0`.
    const base = style.indexOf('\n  .split {');
    expect(base).toBeGreaterThan(-1);
    const sideBySideSplit = style.indexOf('.split {', base + '\n  .split {'.length);
    const query = style.lastIndexOf('@container app (min-width: 940px)', sideBySideSplit);
    expect(sideBySideSplit).toBeGreaterThan(base);
    expect(query).toBeGreaterThan(base);
    expect(query).toBeLessThan(sideBySideSplit);
  });

  it('subtracts no header height anywhere side by side', () => {
    expect(queries).not.toMatch(/--he-header-height/);
    expect(queries).not.toMatch(/100vh\s*-/);
  });

  it('measures the window on the element around the app, so the app can be styled by it', () => {
    // A container query styles descendants only: for `.app` itself to take
    // the window's height, the container is its parent, the mount point.
    const css = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '..', 'styles', 'app.css'),
      'utf-8',
    );
    expect(css).toMatch(/#app\s*\{[^}]*container:\s*app\s*\/\s*inline-size/);
    expect(style).not.toMatch(/container:\s*app/);
  });

  it('bounds the panel by the row, so Global style and Keys scroll under their titles', () => {
    expect(style).toMatch(/\.panel\s*\{[^}]*max-block-size:\s*100%/);
    expect(sideBySide('.style-block')).toMatch(/min-block-size:\s*0/);
    expect(sideBySide('.keys-block')).toMatch(/min-block-size:\s*var\(--he-panel-list-min-size\)/);
    expect(UI_TOKENS.panelListMinSize).toBe('200px');
  });

  it('goes side by side at the stage floor plus the panel width, the token, in every query', () => {
    // A container query takes no var(): the figure is written out, and held
    // here to the token — and the token to the two widths it adds up.
    const px = (value: string) => Number.parseInt(value, 10);
    expect(px(UI_TOKENS.splitBreakpoint)).toBe(
      px(UI_TOKENS.stageMinSize) + px(UI_TOKENS.panelWidth),
    );
    const widths = [...style.matchAll(/@container app \(min-width: ([^)]+)\)/g)].map((m) => m[1]);
    expect(widths.length).toBeGreaterThan(0);
    for (const width of widths) expect(width).toBe(UI_TOKENS.splitBreakpoint);
  });

  it('never lets the drawing size the stage', () => {
    // The layout is an <svg> as wide as the keys reach: an `auto` track of
    // the stage's grid would not shrink below it, so on a narrowing window
    // the stage spilled over the panel instead of clipping its keys.
    const stage = /\n {2}\.stage\s*\{([^}]*)\}/.exec(style)?.[1]?.replace(/\s+/g, ' ') ?? '';
    expect(stage).toMatch(/display:\s*grid/);
    expect(stage).toMatch(/grid-template:\s*minmax\(0,\s*1fr\)\s*\/\s*minmax\(0,\s*1fr\)/);
  });

  it('keeps the panel at its width, the stage taking what the window adds', () => {
    expect(sideBySide('.panel')).toMatch(/max-inline-size:\s*var\(--he-panel-width\)/);
  });
});
