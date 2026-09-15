// `defineConfig` comes from `vitest/config`, not from `vite`: that is what
// types the `test` key below. The Vite configuration itself is unchanged.
import { defineConfig, type Plugin } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { svelteTesting } from '@testing-library/svelte/vite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * What the diagnostics panel calls itself (spec §11).
 *
 * A bug report that cannot name its build is a report about an unknown
 * program. `package.json`'s version is bumped by hand at release time, so it
 * can still lag the tag between a version bump and its release commit; the
 * image passes the git tag in as a build argument to close that gap, and a
 * local build says `dev`, truthfully.
 */
// `||`, not `??`: Docker turns `--build-arg VITE_BUILD=` into the empty
// string rather than leaving it unset, and `??` lets that through. The panel
// would then render "Halcyon " with nothing after it — the anonymous build
// this whole mechanism exists to prevent.
const BUILD = process.env.VITE_BUILD || 'dev';

/**
 * The home page names the same build in its footer, and it is the one page
 * with no script to read `__BUILD__` from. Vite lets the HTML carry a
 * placeholder instead: `%BUILD%` is replaced here, at build time and in the
 * dev server alike, so the footer costs the page no bundle. A tag gets its
 * `v`; a build that is not one — `dev`, a bare sha — is shown as it is.
 */
const BUILD_STAMP = /^\d/.test(BUILD) ? `v${BUILD}` : BUILD;

/**
 * The home page's stylesheet, inlined into each language version of the page.
 *
 * Inline rather than linked, as it has been since the page was transcribed
 * from the canvas: the first paint waits for no second request. One file
 * rather than a copy per language, since the French page arrived on
 * 2026-09-16 and eight hundred lines of CSS maintained twice would drift by
 * the second edit. `%HOME_STYLE%` marks where each page wants it.
 */
const HOME_STYLE = resolve(import.meta.dirname, 'src/styles/home.css');

function stampHomePage(): Plugin {
  return {
    name: 'halcyon:build-stamp',
    transformIndexHtml(html) {
      // Read on every transform, so the dev server picks up an edit to the
      // stylesheet on the next reload of the page. A function, not a string,
      // as the replacement: `$` sequences in CSS would otherwise be read as
      // replacement patterns.
      const style = () => `<style>\n${readFileSync(HOME_STYLE, 'utf8')}    </style>`;
      return html.replaceAll('%BUILD%', BUILD_STAMP).replaceAll('%HOME_STYLE%', style);
    },
  };
}

export default defineConfig({
  plugins: [svelte(), svelteTesting(), stampHomePage()],
  define: { __BUILD__: JSON.stringify(BUILD) },
  build: {
    rollupOptions: {
      // Two application entries, compiled separately: the editor code never
      // reaches the bundle OBS keeps loaded (spec §5.1). `home` joins them as a
      // scriptless static page — it produces no bundle and weighs on neither —
      // and `homeFr` is the same page in French, served under `/fr/`.
      input: {
        home: resolve(import.meta.dirname, 'index.html'),
        homeFr: resolve(import.meta.dirname, 'fr/index.html'),
        capture: resolve(import.meta.dirname, 'capture.html'),
        overlay: resolve(import.meta.dirname, 'overlay.html'),
      },
      output: {
        // Rollup names a shared chunk after one of the modules inside it, and
        // that name is chosen by the bundler, not by meaning: importing a
        // stylesheet from both entry points was enough to make the 47 kB
        // Svelte runtime appear as `fonts-broadcast.js`. Anyone reading a
        // network tab would have concluded the fonts weighed 47 kB.
        chunkFileNames: 'assets/shared-[hash].js',
      },
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
    setupFiles: ['src/test/setup.ts'],
    coverage: {
      provider: 'v8',
      // Everything coverage would otherwise count against itself: the tests,
      // their shared fixtures, component harnesses that exist only to be
      // rendered by a test, and ambient type declarations with no runtime body.
      exclude: ['src/**/*.test.ts', 'src/test/**', 'src/**/*.harness.svelte', 'src/**/*.d.ts'],
    },
  },
});
