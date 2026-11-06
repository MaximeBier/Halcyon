// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * `applyTokens` runs before `mount` in `capture/main.ts`, so every
 * `--he-*` variable is already declared by the time a capture component's
 * styles are ever evaluated. A `var(--he-x, literal)` fallback in one of
 * these files can therefore never take effect — it is pure drift risk: one
 * had already drifted (a mono font fallback said 14px where the token says
 * 15px) before this test was written to make that impossible again.
 *
 * `app.css` is deliberately exempt: it paints before `applyTokens` runs at
 * all (the anti-flash it documents at its own head), so its fallbacks are
 * load-bearing rather than dead weight.
 */
const captureDir = dirname(fileURLToPath(import.meta.url));

const captureSources = readdirSync(captureDir)
  .filter((name) => name.endsWith('.svelte'))
  .map((name) => ({ name, source: readFileSync(join(captureDir, name), 'utf-8') }));

describe('capture components trust the tokens', () => {
  it('really did read more than one component', () => {
    // Guards the guard: an empty or misfiled directory would make the
    // assertion below pass for ever.
    expect(captureSources.length).toBeGreaterThan(10);
  });

  it('carries no var(--he-*, fallback) in any capture component', () => {
    for (const { name, source } of captureSources) {
      const fallbacks = [...source.matchAll(/var\(--he-[a-z-]+,\s*[^)]*\)/g)].map((m) => m[0]);
      expect(fallbacks, `${name} still second-guesses the tokens`).toEqual([]);
    }
  });
});

describe('the scrollbars keep their own rules', () => {
  it('never sets scrollbar-color or scrollbar-width, which switch them off', () => {
    // Since Chrome 121 either standard property disables every
    // ::-webkit-scrollbar rule on the element it reaches (spec §16.12) — a
    // one-line "tidy-up" would quietly bring the grey bars back.
    const styles = join(captureDir, '..', 'styles');
    const sheets = readdirSync(styles)
      .filter((name) => name.endsWith('.css'))
      .map((name) => readFileSync(join(styles, name), 'utf-8').replace(/\/\*[\s\S]*?\*\//g, ''));

    for (const { source } of captureSources) {
      expect(source).not.toMatch(/scrollbar-(color|width)\s*:/);
    }
    for (const sheet of sheets) {
      expect(sheet).not.toMatch(/scrollbar-(color|width)\s*:/);
    }
  });
});

describe('the text floor', () => {
  it('leaves no ghost text in any component', () => {
    for (const { name, source } of captureSources) {
      expect(source, name).not.toMatch(/--he-text-ghost|#4a4f60/i);
    }
  });
});

describe('the capture page keeps no timer', () => {
  /** The page's code beyond its components: its modules and the OBS client it runs. */
  const modules = [captureDir, join(captureDir, '..', 'transport')].flatMap((dir) =>
    readdirSync(dir)
      .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
      .map((name) => ({ name, source: readFileSync(join(dir, name), 'utf-8') })),
  );

  it('uses neither setTimeout nor setInterval, in a component or a module', () => {
    // Spec §2: a background tab throttles timers to a minute; anything the
    // page shows for a while rides a CSS animation instead.
    const code = (source: string) =>
      source
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
    expect(modules.length).toBeGreaterThan(10);
    for (const { name, source } of [...captureSources, ...modules]) {
      expect(code(source), name).not.toMatch(/\bset(Timeout|Interval)\(/);
    }
  });
});
