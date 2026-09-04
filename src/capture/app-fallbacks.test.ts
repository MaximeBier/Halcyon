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
