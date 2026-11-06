// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as icons from './icons';

const src = join(dirname(fileURLToPath(import.meta.url)), '..');

function sources(dir: string): { name: string; source: string }[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.(ts|svelte)$/.test(name) ? [{ name: path, source: readFileSync(path, 'utf-8') }] : [];
  });
}

describe('the interface icons', () => {
  it('offers every icon of the visual system (spec §16.13)', () => {
    expect(Object.keys(icons).sort()).toEqual(
      [
        'ArrowDown',
        'ArrowLeft',
        'ArrowRightLeft',
        'ArrowRight',
        'ArrowUp',
        'Check',
        'ChevronDown',
        'ChevronRight',
        'ChevronUp',
        'Copy',
        'Ellipsis',
        'Gamepad2',
        'Link',
        'ListChecks',
        'Pencil',
        'Plus',
        'Power',
        'Redo2',
        'RotateCcw',
        'Settings',
        'Square',
        'Trash2',
        'Undo2',
        'X',
      ].sort(),
    );
  });

  it('imports each icon by its own path, never the whole set', () => {
    // The package's root re-exports some 1,600 components. One import from it
    // and the bundle — and every test file that renders a component — pays for
    // all of them.
    const all = sources(src);
    expect(all.length).toBeGreaterThan(50);
    for (const { name, source } of all) {
      expect(source, name).not.toMatch(/from\s+['"]@lucide\/svelte['"]/);
    }
  });

  it('keeps Lucide out of everything the overlay imports', () => {
    // The overlay draws no interface; an icon pulled in by a shared module
    // would ride along into the chunk OBS keeps loaded (spec §5.1).
    for (const dir of ['view', 'config', 'overlay', 'protocol', 'transport', 'keyboard']) {
      for (const { name, source } of sources(join(src, dir))) {
        expect(source, name).not.toMatch(/@lucide\//);
      }
    }
  });
});

describe('no glyph stands in for an icon', () => {
  // Comments may name the old glyphs; markup and strings may not.
  const strip = (source: string) =>
    source
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
  const capture = sources(join(src, 'capture')).filter(({ name }) => !/\.test\.ts$/.test(name));

  it('draws undo, redo, settings, menus, close, ticks and chevrons as icons', () => {
    // The key labels' own symbols (ICON_SET, Label › Icon) live in
    // keyboard/labels.ts and are out of this: they go on air.
    for (const { name, source } of capture) {
      expect(strip(source), name).not.toMatch(/[↶↷⚙⋯✕✓✔■▾▸🗑]/u);
    }
  });

  it('draws the fill directions as arrows, not as characters', () => {
    const choices = capture.find(({ name }) => name.endsWith('style-choices.ts'))!;
    expect(strip(choices.source)).not.toMatch(/[↑↓←→]/u);
  });

  it('never writes a bare + as a button', () => {
    for (const { name, source } of capture) {
      expect(strip(source), name).not.toMatch(/>\s*\+\s*</);
    }
  });
});
