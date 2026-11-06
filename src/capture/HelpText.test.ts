import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/svelte';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Harness from './HelpText.harness.svelte';

afterEach(cleanup);

const here = dirname(fileURLToPath(import.meta.url));

describe('a help sentence (spec §16.13, board System › Contrôles)', () => {
  it('is the words alone, no icon in front to push them off the setting’s edge', () => {
    const { container } = render(Harness, { props: { text: 'Shown once you press a key' } });
    const help = container.querySelector('.he-help')!;

    expect(help.querySelector('svg')).toBeNull();
    expect(help.children).toHaveLength(0);
    expect(help.textContent!.trim()).toBe('Shown once you press a key');
  });

  it('can sit inside a label: nothing in it is a block element', () => {
    const { container } = render(Harness, { props: { text: 'x' } });
    const help = container.querySelector('.he-help')!;
    expect(help.tagName.toLowerCase()).toBe('span');
    expect(help.querySelector('p, div')).toBeNull();
  });

  it('is drawn by one shared class: a block, 14 px, muted, italic', () => {
    const controls = readFileSync(join(here, '..', 'styles', 'controls.css'), 'utf-8').replace(
      /\/\*[\s\S]*?\*\//g,
      '',
    );
    const rule = (/\.he-help\s*\{([^}]*)\}/.exec(controls)?.[1] ?? '').replace(/\s+/g, ' ');
    for (const declaration of [
      /display:\s*block/,
      /font-size:\s*var\(--he-size-xs\)/,
      /font-style:\s*italic/,
      /font-weight:\s*400/,
      /line-height:\s*1\.45/,
      /color:\s*var\(--he-text-muted\)/,
    ]) {
      expect(rule).toMatch(declaration);
    }
    // Not repeated per component: the component only names the class.
    expect(readFileSync(join(here, 'HelpText.svelte'), 'utf-8')).not.toMatch(/<style>/);
  });
});

/**
 * Every sentence that explains a setting, and the component it lives in. One
 * component draws them all; a sentence written as a bare paragraph again would
 * read like the name of a setting, which is what the rule is against.
 */
const HELP: [string, string][] = [
  ['StylePanel.svelte', 'The editor keeps showing every key'],
  ['InstalledFontsMenu.svelte', 'Must also be installed on the PC running OBS.'],
  ['ObsPopover.svelte', 'Stored in this browser and carried in the URL above.'],
  ['Wizard.svelte', 'The password never leaves your computer.'],
  ['Diagnostics.svelte', 'Start it, switch to the game, and keep typing.'],
  ['Diagnostics.svelte', 'Opens a second, temporary connection with the port and password'],
];

describe('the help sentences of the page', () => {
  const blocks = (source: string) =>
    [...source.matchAll(/<HelpText\b[^>]*>([\s\S]*?)<\/HelpText>/g)].map((m) =>
      m[1]!.replace(/\s+/g, ' '),
    );

  it.each(HELP)('%s draws "%s" with the help component', (file, sentence) => {
    const source = readFileSync(join(here, file), 'utf-8');
    expect(blocks(source).some((block) => block.includes(sentence))).toBe(true);
  });

  it('leaves no help sentence under the icon grid', () => {
    const source = readFileSync(join(here, 'KeyPopover.svelte'), 'utf-8');
    expect(source).not.toContain('Special keys pick their icon on capture');
  });

  it('draws the info icon nowhere any more', () => {
    const users = readdirSync(here)
      .filter((name) => name.endsWith('.svelte'))
      .filter((name) =>
        /import\s*\{[^}]*\bInfo\b[^}]*\}\s*from '\.\/icons'/.test(
          readFileSync(join(here, name), 'utf-8'),
        ),
      );
    expect(users).toEqual([]);
  });
});

describe('the italic it is drawn in', () => {
  const fonts = readFileSync(join(here, '..', 'styles', 'fonts-ui.css'), 'utf-8');

  it('is Archivo’s own italic, shipped with the page, never a slanted roman', () => {
    const face = [...fonts.matchAll(/@font-face\s*\{([^}]*)\}/g)]
      .map((m) => m[1]!)
      .find((body) => /font-family:\s*'Archivo'/.test(body) && /font-style:\s*italic/.test(body));
    expect(face).toBeDefined();
    expect(face).toMatch(/font-weight:\s*400/);
    expect(face).toMatch(/archivo-latin-400-italic\.woff2/);
    const file = join(here, '..', 'assets', 'fonts', 'archivo-latin-400-italic.woff2');
    expect(readFileSync(file).length).toBeGreaterThan(1000);
  });
});
