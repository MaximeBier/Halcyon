// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cssVariables } from '../styles/ui-tokens';

const src = join(dirname(fileURLToPath(import.meta.url)), '..');
const controls = readFileSync(join(src, 'styles', 'controls.css'), 'utf-8');

function components(dir: string): { name: string; style: string }[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return components(path);
    if (!name.endsWith('.svelte')) return [];
    const style = /<style>([\s\S]*?)<\/style>/.exec(readFileSync(path, 'utf-8'))?.[1] ?? '';
    return [{ name: basename(path), style }];
  });
}

const withoutComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');

/** Every selector of a stylesheet that answers the pointer. */
function hoverSelectors(css: string): string[] {
  return withoutComments(css)
    .split('}')
    .flatMap((rule) => (rule.split('{').at(-2) ?? '').split(','))
    .map((selector) => selector.replace(/\s+/g, ' ').trim())
    .filter((selector) => selector.includes(':hover'));
}

/**
 * The pointer-driven rules that are not a state of a family (spec §16.13) and
 * so stay with their component, each for its reason.
 */
const OWN_HOVER: Record<string, string[]> = {
  // The brand's wordmark lights up: a link home, not a control.
  // And Resume setup, the amber pitch of an unfinished setup (board
  // Editor-HeaderNarrow): Link OBS scenes' gauge, in amber.
  'App.svelte': ['a.brand:hover .wordmark', '.resume:hover'],
  // A row's actions appear under the pointer: a reveal, not a colour.
  'KeyList.svelte': ['.keys li:hover .actions'],
  // Add key while it listens: the primary turned inside out, its own state.
  'KeyLearner.svelte': ['.add.listening:hover:not(:disabled)'],
  // A key on the stage: drawn by its own style, outside every family.
  'LayoutEditor.svelte': ['.handle:hover'],
  // The header's accent-bordered pitch, which no family of the board covers.
  'SceneLinks.svelte': ['.trigger:not(.he-btn-quiet):hover'],
  'StartupPopover.svelte': ['.trigger:not(.he-btn-quiet):hover'],
};

describe('states, one rule per family (spec §16.13)', () => {
  it('answers the pointer from the shared sheet, never from a component', () => {
    const strays = components(src).flatMap(({ name, style }) =>
      hoverSelectors(style)
        .filter((selector) => !(OWN_HOVER[name] ?? []).includes(selector))
        .map((selector) => `${name}: ${selector}`),
    );
    expect(strays).toEqual([]);
  });

  it('underlines nothing, anywhere', () => {
    const underlined = [
      ...components(src).map(({ name, style }) => ({ name, css: style })),
      { name: 'controls.css', css: controls },
    ]
      .filter(({ css }) => /text-decoration:\s*underline/.test(withoutComments(css)))
      .map(({ name }) => name);
    expect(underlined).toEqual([]);
  });

  it('gives every family a hover state', () => {
    for (const family of [
      '.he-btn-primary',
      '.he-btn-secondary',
      '.he-btn-tertiary',
      '.he-btn-danger',
      '.he-icon-btn',
      '.he-icon-btn--bare',
      '.he-btn-quiet',
      '.he-menu-item',
      '.he-segment',
      '.he-text-btn',
      '.he-tile',
      '.he-slot',
      '.he-list-row',
    ]) {
      expect(
        hoverSelectors(controls).some((selector) => selector.startsWith(family + ':')),
        family,
      ).toBe(true);
    }
  });

  it('eases every change of state over the one duration', () => {
    expect(cssVariables()['--he-state-transition']).toBe('120ms');
    expect(withoutComments(controls)).toMatch(
      /transition:\s*background-color var\(--he-state-transition\),\s*color var\(--he-state-transition\),\s*border-color var\(--he-state-transition\)/,
    );
  });

  it('fills the destructive button with its own red, a tenth of it', () => {
    expect(withoutComments(controls)).toContain(
      'color-mix(in srgb, var(--he-danger) 10%, transparent)',
    );
  });
});
