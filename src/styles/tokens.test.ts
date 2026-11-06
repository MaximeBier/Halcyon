// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { OVERLAY_TOKENS } from './tokens';
import { UI_TOKENS, applyTokens, cssVariables } from './ui-tokens';
import { DEFAULT_STYLE } from '../config/schema';

describe('tokens', () => {
  it('separates by name what goes to the broadcast from what stays in the interface', () => {
    const overlay = Object.keys(OVERLAY_TOKENS);
    const ui = Object.keys(UI_TOKENS);

    // Both palettes share values — #151823 for surfaces, #7C9EFF for the
    // accent — and that is deliberate: the product must look like one object.
    // What we forbid is one name serving both sides: retouching the interface
    // must never change what the viewers see.
    expect(overlay.some((name) => ui.includes(name))).toBe(false);
  });

  it('feeds the configuration default values', () => {
    expect(DEFAULT_STYLE.restColor).toBe(OVERLAY_TOKENS.keyRest);
    expect(DEFAULT_STYLE.activeColor).toBe(OVERLAY_TOKENS.keyActive);
    expect(DEFAULT_STYLE.fillColor).toBe(OVERLAY_TOKENS.keyFill);
    expect(DEFAULT_STYLE.radius).toBe(OVERLAY_TOKENS.keyRadius);
    expect(DEFAULT_STYLE.opacity).toBe(OVERLAY_TOKENS.keyOpacity);
    expect(DEFAULT_STYLE.fontFamily).toBe(OVERLAY_TOKENS.keyFontFamily);
    expect(DEFAULT_STYLE.fontWeight).toBe(OVERLAY_TOKENS.keyFontWeight);
    // Sizes come from the mockup like the colours do, so they are read from
    // here rather than written a second time in the schema. They were 56 and 6
    // until the handoff of 2026-08-20 fixed the tile at 72 with an 8 px gap.
    expect(DEFAULT_STYLE.unit).toBe(OVERLAY_TOKENS.keyUnit);
    expect(DEFAULT_STYLE.gap).toBe(OVERLAY_TOKENS.keyGap);
  });

  it('clearly distinguishes rest from actuation', () => {
    // Both states must read at a glance on a compressed video feed: a subtle
    // shade does not survive a stream's bitrate.
    expect(OVERLAY_TOKENS.keyRest).not.toBe(OVERLAY_TOKENS.keyActive);
    expect(OVERLAY_TOKENS.keyFill).not.toBe(OVERLAY_TOKENS.keyActive);
  });

  it('exposes the interface tokens as prefixed CSS variables', () => {
    const variables = cssVariables();

    expect(Object.keys(variables).every((name) => name.startsWith('--he-'))).toBe(true);
    expect(variables['--he-text']).toBe(UI_TOKENS.text);
    expect(variables['--he-border-popover']).toBe(UI_TOKENS.borderPopover);
  });

  it('gives the shared dropdown stylesheet the variables it reads', () => {
    // controls.css is plain CSS: a token it names and nobody sets fails
    // silently, as a menu with no background. The contract is the names.
    const names = Object.keys(cssVariables());

    for (const name of [
      '--he-highlight',
      '--he-shadow-menu',
      '--he-dropdown-offset',
      '--he-dropdown-min-width',
      '--he-dropdown-scene-min-width',
    ]) {
      expect(names).toContain(name);
    }
  });

  it('sets the stage apart from the page, and the fields apart from the stage', () => {
    // The stage is the darkest surface (spec §16.13): a field drawn in the
    // stage's colour would sink into it, so fields have a well of their own.
    const luminance = (hex: string) =>
      [1, 3, 5]
        .map((at) => parseInt(hex.slice(at, at + 2), 16))
        .reduce((sum, channel) => sum + channel, 0);

    expect(luminance(UI_TOKENS.stage)).toBeLessThan(luminance(UI_TOKENS.bg));
    expect(luminance(UI_TOKENS.stage)).toBeLessThan(luminance(UI_TOKENS.well));
  });

  it('names amber for what it means now: something to look at', () => {
    // It used to be the colour of a customized key as well, so a key someone
    // styled on purpose wore the same mark as a font the PC running OBS lacks.
    // Own style is the accent's now (spec §16.13).
    expect(UI_TOKENS.warn).toBe('#D9A05B');
    expect(Object.keys(UI_TOKENS)).not.toContain('override');
  });

  it('keeps three radii: controls, surfaces, the setup card', () => {
    // Spec §16.13: 4 for anything one presses or types in, 6 for what floats
    // or groups, 10 for the one card the setup sits on. The 5 between them read
    // as an accident next to the 4.
    expect(UI_TOKENS.radius).toBe('4px');
    expect(UI_TOKENS.radiusPanel).toBe('6px');
    expect(UI_TOKENS.radiusCard).toBe('10px');
    expect(Object.keys(UI_TOKENS)).not.toContain('radiusControl');
  });

  it('keeps no text colour under the muted floor', () => {
    // #4A4F60 read at 2.2:1; nothing legible goes under muted any more.
    expect(Object.keys(UI_TOKENS)).not.toContain('textGhost');
  });

  it('derives no CSS variable from the broadcast tokens', () => {
    const names = Object.keys(cssVariables());

    expect(names.some((name) => name.startsWith('--he-key'))).toBe(false);
  });

  it('sets the variables on the document root', () => {
    const set: [string, string][] = [];
    applyTokens({ style: { setProperty: (name, value) => void set.push([name, value]) } });

    expect(set).toContainEqual(['--he-text', UI_TOKENS.text]);
    expect(set).toHaveLength(Object.keys(cssVariables()).length);
  });

  it('gives every interface token a variable, and each a distinct name', () => {
    // camelCase collapses to kebab-case, so two tokens could quietly map onto
    // the same variable and one would win at random.
    const names = Object.keys(cssVariables());

    expect(names).toHaveLength(Object.keys(UI_TOKENS).length);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe('the two palettes live in separate modules', () => {
  // Not merely separate objects. The overlay imports the configuration schema,
  // which imports the broadcast tokens: sharing one module drags the whole
  // interface palette into the chunk OBS keeps loaded (spec §5.1). Bundlers
  // split by module, so the separation has to be physical to hold.
  it('exports nothing but the broadcast tokens from tokens.ts', async () => {
    const broadcast = await import('./tokens');

    expect(Object.keys(broadcast)).toEqual(['OVERLAY_TOKENS']);
  });
});
