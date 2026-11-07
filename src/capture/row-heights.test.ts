// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { UI_TOKENS } from '../styles/ui-tokens';

/**
 * The header and the tab row are exactly their tokens, their bottom border
 * included: a row in content-box adds its border — one pixel, and the page
 * scrolled by it at full screen. Stacked, the stage keeps its floor and leaves
 * the panel in sight. jsdom lays nothing out, so the declarations are what is
 * held.
 */
const dir = dirname(fileURLToPath(import.meta.url));
const styleOf = (file: string) =>
  (/<style>([\s\S]*?)<\/style>/.exec(readFileSync(join(dir, file), 'utf-8'))?.[1] ?? '').replace(
    /\/\*[\s\S]*?\*\//g,
    '',
  );
const rule = (css: string, selector: string) => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return (new RegExp(`(?:^|\\n)\\s*${escaped}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? '').replace(
    /\s+/g,
    ' ',
  );
};

describe('the rows above the stage', () => {
  const app = styleOf('App.svelte');
  const bar = styleOf('ProfileBar.svelte');

  it('takes their heights from the tokens', () => {
    expect(UI_TOKENS.headerHeight).toBe('54px');
    expect(UI_TOKENS.tabRowHeight).toBe('50px');
    expect(rule(app, '.bar')).toMatch(/min-block-size:\s*var\(--he-header-height\)/);
    expect(rule(bar, '.tabs')).toMatch(/block-size:\s*var\(--he-tab-row-height\)/);
  });

  it('leaves the panel in sight under a stacked stage: 560 high, never the window', () => {
    // The board: under 940 px the panel goes below the stage and shows there
    // at once, Global style readable without scrolling. A stage as tall as
    // the window pushed the whole panel out of sight.
    expect(UI_TOKENS.stageMinSize).toBe('560px');
    expect(rule(app, '.stage')).toMatch(/min-block-size:\s*var\(--he-stage-min-size\);/);
    expect(app).not.toMatch(/100vh\s*-/);
    // Nothing left measuring the header for a sum no one does any more.
    const source = readFileSync(join(dir, 'App.svelte'), 'utf-8');
    expect(source).not.toMatch(/--header-size|headerBox|headerSize/);
  });

  it('counts their bottom border inside that height', () => {
    // The header of the editor and of the wizard: one rule, `.bar`.
    expect(rule(app, '.bar')).toMatch(/box-sizing:\s*border-box/);
    expect(rule(bar, '.tabs')).toMatch(/box-sizing:\s*border-box/);
  });

  it('never lets the profile row scroll up and down', () => {
    // `overflow-x: auto` alone computes `overflow-y: auto`: anything a pixel
    // taller — a focus ring, a positioned tooltip — made the row scroll.
    expect(rule(bar, '.strip')).toMatch(/overflow-x:\s*auto/);
    expect(rule(bar, '.strip')).toMatch(/overflow-y:\s*hidden/);
  });

  it('draws its tooltips in the top layer, never in the strip that scrolls', () => {
    const tooltip = readFileSync(join(dir, 'Tooltip.svelte'), 'utf-8');
    expect(tooltip).toMatch(/popover="manual"/);
    expect(rule(styleOf('Tooltip.svelte'), '.tip')).toMatch(/position:\s*fixed/);
  });
});

describe('the header, on one line at every width (board Editor-HeaderNarrow)', () => {
  const source = readFileSync(join(dir, 'App.svelte'), 'utf-8');
  const app = styleOf('App.svelte');
  // The editor's header: the second one, after the setup's.
  const markup = source.slice(source.lastIndexOf('<header class="bar"'));
  const header = markup.slice(0, markup.indexOf('</header>'));

  it('never wraps: two blocks on one line, the left one giving way', () => {
    expect(rule(app, '.bar')).toMatch(/flex-wrap:\s*nowrap/);
    const lead = rule(app, '.lead');
    expect(lead).toMatch(/flex:\s*1 1 auto/);
    expect(lead).toMatch(/min-inline-size:\s*0/);
    const tools = rule(app, '.tools');
    expect(tools).toMatch(/flex:\s*none/);
    expect(tools).toMatch(/margin-inline-start:\s*auto/);
    // Flex rows that never wrap — and no inherited `nowrap`, which would
    // reach every popover hanging from them and stop their sentences wrapping.
    for (const block of [lead, tools]) {
      expect(block).toMatch(/display:\s*flex/);
      expect(block).not.toMatch(/flex-wrap:\s*wrap/);
      expect(block).not.toMatch(/white-space/);
    }
    expect(rule(app, '.resume')).toMatch(/white-space:\s*nowrap/);
  });

  it('keeps the mark, the pills and Resume setup on the left, the actions on the right', () => {
    const lead = header.slice(header.indexOf('class="lead"'), header.indexOf('class="tools"'));
    const tools = header.slice(header.indexOf('class="tools"'));
    for (const part of ['brand(', '<StatusBar', 'class="resume"']) expect(lead).toContain(part);
    for (const part of ['aria-label="Undo"', '<SceneLinks', '<StartupPopover', '<SettingsMenu']) {
      expect(tools).toContain(part);
    }
  });

  it('tells the shortcuts undo and redo answer to, on their tooltips (board OBS-5e-Header)', () => {
    // The keys the page binds, and the ones the tooltips name: never apart.
    expect(source).toContain("const wantsUndo = key === 'z' && !event.shiftKey;");
    expect(source).toContain("const wantsRedo = key === 'y' ||");
    expect(source).toContain('<Tooltip text="Undo · Ctrl+Z">');
    expect(source).toContain('<Tooltip text="Redo · Ctrl+Y">');
  });

  it('measures the header again once its fonts arrive, which no resize announces', () => {
    // Measured in the fallback face, then Archivo lands wider or narrower:
    // the bar keeps its width, so the observer stays silent and the header
    // stayed folded for nothing, or spilled, until the window moved.
    expect(source).toContain("document.fonts?.addEventListener('loadingdone', onFonts)");
    expect(source).toContain("document.fonts?.removeEventListener('loadingdone', onFonts)");
    expect(source).toMatch(/const onFonts = \(\) => void refit\(\);/);
  });

  it('opens the one OBS popover from the pill and from Settings › OBS connection', () => {
    // The same component under the pill, never a copy: the page holds whether
    // it is open, and the Settings row only ever opens it — no retry.
    const element = (name: string) => {
      const at = header.indexOf(`<${name}`);
      return header.slice(at, header.indexOf('/>', at));
    };
    expect(source).toContain("let obsOpen = $state<'pill' | 'settings' | null>(null)");
    expect(element('StatusBar')).toContain('bind:obsOpen');
    expect(element('SettingsMenu')).toContain("obsConnected={obsStatus === 'identified'}");
    expect(element('SettingsMenu')).toContain("onObs={() => (obsOpen = 'settings')}");
    expect(element('SettingsMenu')).toContain("obsOpen={obsOpen === 'settings'}");
    // Under the gear, the very component the pill hangs, aligned on its right.
    const panel = header.slice(header.indexOf('{#snippet obsPanel('));
    expect(panel.slice(0, panel.indexOf('{/snippet}'))).toMatch(/<ObsPopover[\s\S]*align="end"/);
  });

  it('folds by the measured steps: the word, then the two names, then the keyboard name', () => {
    expect(source).toContain("from './header-fold'");
    expect(source).toMatch(/fitHeader\(/);
    expect(header).toMatch(/data-fold=\{fold\}/);
    // The pills can shrink (to be cut at 5 and 7), so they could spill under
    // Resume inside the left block without the block itself overflowing: a
    // child spilling out of its own box counts as an overflow too.
    expect(source).toMatch(/\[\.\.\.lead\.children\]\.some\(/);
    expect(header).toMatch(/brand\(fold === 1\)/);
    const element = (name: string) => {
      const at = header.indexOf(`<${name}`);
      return header.slice(at, header.indexOf('/>', at));
    };
    expect(element('SceneLinks')).toContain('compact={fold >= 3}');
    expect(element('StartupPopover')).toContain('compact={fold >= 3}');
    expect(element('StatusBar')).toContain('squeeze={fold >= 5}');
    // Both names give way together, little by little: OBS's too, not at once at the end.
    expect(element('StatusBar')).toContain('squeezeObs={fold >= 5}');
    // Last resort: the keyboard and OBS down to their dot, the alert keeping its words.
    expect(element('StatusBar')).toContain('dots={fold >= 7}');
    // The setup's header keeps its word: it has the page to itself.
    expect(source.slice(0, source.lastIndexOf('<header class="bar"'))).toContain('brand(true)');
  });

  it('folds Resume setup with the header: shorter at 4, an icon at 6 (board Editor-HeaderNarrow)', () => {
    const resume = header.slice(
      header.indexOf('{#if canResume}'),
      header.indexOf('{/if}', header.indexOf('{#if canResume}')),
    );
    expect(resume).toContain('Resume setup · {stepNumber(step)}/3');
    expect(resume).toContain('Setup · {stepNumber(step)}/3');
    expect(resume).toMatch(/fold >= 6/);
    expect(resume).toMatch(/fold >= 4/);
    expect(resume).toContain('<ListChecks');
    expect(resume).not.toContain('class="dot"');
    const look = rule(app, '.resume');
    for (const declaration of [
      /flex:\s*none/,
      /block-size:\s*28px/,
      /padding:\s*0 11px/,
      /border:\s*1px solid var\(--he-warn\)/,
      /color:\s*var\(--he-warn\)/,
      /font-weight:\s*600/,
      /font-size:\s*var\(--he-size-xs\)/,
    ]) {
      expect(look).toMatch(declaration);
    }
    const icon = rule(app, '.resume.compact');
    expect(icon).toMatch(/inline-size:\s*28px/);
    expect(icon).toMatch(/padding:\s*0/);
    // The mark never gives way.
    expect(rule(app, '.mark')).toMatch(/flex:\s*none/);
  });

  it('never folds a pill, and cuts only the keyboard name, from the right, at the last step', () => {
    const bar = styleOf('StatusBar.svelte');
    expect(rule(bar, 'header')).toMatch(/flex-wrap:\s*nowrap/);
    expect(rule(bar, '.pill')).toMatch(/flex:\s*none/);
    expect(rule(bar, '.pill')).toMatch(/white-space:\s*nowrap/);
    expect(rule(bar, '.pill')).toMatch(/font-weight:\s*400/);
    expect(rule(bar, '.dot')).toMatch(/flex:\s*none/);
    expect(rule(bar, 'button.pill')).toMatch(/justify-content:\s*flex-start/);
    const name = rule(bar, '.squeeze .device');
    for (const declaration of [
      /display:\s*block/,
      /min-inline-size:\s*40px/,
      /overflow:\s*hidden/,
      /text-overflow:\s*ellipsis/,
      /white-space:\s*nowrap/,
      /text-align:\s*left/,
    ]) {
      expect(name).toMatch(declaration);
    }
  });
});

describe('the + of the profile row (board prototype, noteFluid)', () => {
  const source = readFileSync(join(dir, 'ProfileBar.svelte'), 'utf-8');
  const bar = styleOf('ProfileBar.svelte');

  it('stays the last thing in the strip that scrolls, after the last tab', () => {
    const strip = source.slice(source.indexOf('class="strip"'), source.indexOf('{#if menu'));
    const pinned = strip.indexOf('class="slot pinned"');
    expect(pinned).toBeGreaterThan(strip.lastIndexOf('{/each}'));
    expect(strip.slice(pinned)).toContain('data-add');
  });

  it('pins itself to the right edge of the strip once the tabs overflow, the tabs fading under it', () => {
    const pinned = rule(bar, '.pinned');
    expect(pinned).toMatch(/position:\s*sticky/);
    expect(pinned).toMatch(/inset-inline-end:\s*0/);
    expect(pinned).toMatch(/align-self:\s*stretch/);
    expect(pinned).toMatch(/background:\s*var\(--he-bg\)/);
    expect(pinned).toMatch(/padding-inline-start:\s*6px/);
    expect(pinned).toMatch(/box-shadow:\s*-14px 0 12px -6px var\(--he-bg\)/);
    // The 6 px it keeps from the last tab is the wrapper's now, not the button's.
    expect(rule(bar, '.add')).not.toMatch(/margin-inline-start/);
  });
});

describe('the profile tabs', () => {
  it('never wrap inside a tab: the row scrolls instead', () => {
    const bar = styleOf('ProfileBar.svelte');
    for (const selector of ['.slot', '.tab']) {
      expect(rule(bar, selector)).toMatch(/flex:\s*none/);
      expect(rule(bar, selector)).toMatch(/white-space:\s*nowrap/);
    }
  });
});
