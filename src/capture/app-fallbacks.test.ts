// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { cssVariables } from '../styles/ui-tokens';
// Vite hands the file over as a string; `import.meta.url` is not a file URL
// under the test transform, so reading it from disk is not an option — same
// arrangement as chrome-tokens.test.ts, for the same reason.
import appSource from './App.svelte?raw';

/**
 * The fonts are the one sanctioned drift: the fallback is what renders in the
 * instant before `applyTokens` runs, when the packaged families may not be
 * registered yet — so it is the token minus its named family, nothing more.
 */
const FONT_FAMILY: Record<string, string> = {
  '--he-font': "'Archivo', ",
  '--he-font-mono': "'IBM Plex Mono', ",
};

describe('the fallbacks that are not allowed to drift', () => {
  const tokens = cssVariables();
  const uses = [...appSource.matchAll(/var\((--he-[a-z-]+), ([^)]+)\)/g)];

  it('really did read a component that uses them', () => {
    // Guards the guard: a source that failed to load, or a regex that matched
    // nothing, would make the assertion below pass for ever.
    expect(uses.length).toBeGreaterThan(20);
  });

  it('matches every fallback in App.svelte against UI_TOKENS', () => {
    // The fallback is the anti-flash (app.css says so at its head): it is on
    // screen for the frame before `applyTokens` runs, so a fallback that has
    // drifted from its token is a layout that jumps — or, previewed anywhere
    // the script never runs, a layout that is silently wrong. Two of them had
    // drifted for real (50px against 62px, 300px against 380px) before this
    // test pinned the lot.
    for (const use of uses) {
      // Both groups always capture; the regex has no optional part.
      const name = use[1]!;
      const fallback = use[2]!;
      const token = tokens[name];
      // A variable the palette does not carry is declared elsewhere on
      // purpose; this test only pins the copies.
      if (token === undefined) continue;
      const expected = token.replace(FONT_FAMILY[name] ?? '', '');
      expect(fallback.toLowerCase(), `${name} fallback has drifted`).toBe(expected.toLowerCase());
    }
  });
});
