// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { migrate } from './migrate';
import { resolve } from './resolve';
import { CONFIG_VERSION, type OverlayConfig, type ResolvedConfig } from './schema';
import { buildScene } from '../view/scene';

/**
 * Every shape a released version stored, loaded by today's code.
 *
 * The rule: a profile must never be lost nor change appearance at an update.
 * Each fixture is what that release wrote, as a literal: the colours are
 * written out rather than read off the tokens, so that a token changing
 * moves the expected look and never the fixture with it. What is checked is
 * the resolved appearance, the shape the overlay draws from.
 */

const Q = { id: 1, usage: 0x14, mode: 'key', label: 'Q', x: 0, y: 0, w: 1, h: 1 };
const W = { id: 2, usage: 0x1a, mode: 'key', label: 'W', x: 1, y: 0, w: 1, h: 1 };
const E = { id: 3, usage: 0x08, mode: 'key', label: 'E', x: 2, y: 0, w: 1, h: 1 };

function load(stored: unknown): ResolvedConfig {
  const result = migrate(structuredClone(stored));
  if (!result.ok) throw new Error(`refused: ${result.reason}`);
  expect(result.dropped).toBe(0);
  expect(result.config.version).toBe(CONFIG_VERSION);
  return resolve(result.config);
}

const styleOf = (config: ResolvedConfig, id: number) =>
  config.keys.find((key) => key.id === id)!.style;

describe('v0.4 to v0.6: the border followed the key, a key had its own radius', () => {
  const stored = {
    version: 1,
    layout: 'iso',
    layoutOverride: 'auto',
    style: {
      restColor: '#151823',
      borderColor: '#232838',
      activeColor: '#7C9EFF',
      fillColor: '#3D4A78',
      fillDirection: 'up',
      opacity: 1,
      radius: 5,
      fontFamily: "'Archivo', system-ui, sans-serif",
      fontWeight: 700,
      unit: 72,
      gap: 8,
    },
    keys: [
      {
        ...Q,
        style: { borderColor: '#ff0000', fontFamily: "'Chakra Petch', system-ui, sans-serif" },
      },
      { ...W, mode: 'axis' },
      E,
    ],
  };

  it('keeps the sizes, the colours, the fonts and the one-pixel border', () => {
    const config = load(stored);

    expect(config).toMatchObject({
      unit: 72,
      gap: 8,
      radius: 5,
      borderWidth: 1,
      labelSize: 'm',
      labelOutline: 'normal',
    });
    expect(styleOf(config, 1)).toEqual({
      restColor: '#151823',
      activeColor: '#7C9EFF',
      fillColor: '#3D4A78',
      fillDirection: 'up',
      opacity: 1,
      borderColor: '#ff0000',
      restVisibility: 'filled',
      activeBorder: 'active',
      fontFamily: 'Chakra Petch',
      fontWeight: 700,
    });
  });

  it("turns a firing key's border to its active colour, and leaves an axis border still", () => {
    const scene = buildScene(load(stored), [
      [1, 1023, 1],
      [2, 1023, 0],
      [3, 0, 0],
    ]);
    const border = (id: number) => scene.keys.find((key) => key.id === id)!.border.color;

    expect(border(1)).toBe('#7C9EFF');
    expect(border(2)).toBe('#232838');
    expect(border(3)).toBe('#232838');
  });
});

describe('v0.7 to v1.0: a resting key with no background', () => {
  const style = {
    restColor: '#151823',
    restFilled: false,
    borderColor: '#232838',
    borderWidth: 2,
    activeColor: '#7C9EFF',
    fillColor: '#3D4A78',
    fillDirection: 'up',
    opacity: 1,
    radius: 5,
    fontFamily: "'Archivo', system-ui, sans-serif",
    fontWeight: 700,
    unit: 72,
    gap: 8,
  };

  it('stays an outline, with a fixed border', () => {
    const config = load({ version: 1, layout: 'iso', layoutOverride: 'auto', style, keys: [Q] });

    expect(config.borderWidth).toBe(2);
    expect(styleOf(config, 1)).toMatchObject({ restVisibility: 'outline', activeBorder: 'fixed' });
  });

  it('stays filled when it was filled', () => {
    const config = load({
      version: 1,
      layout: 'iso',
      layoutOverride: 'auto',
      style: { ...style, restFilled: true },
      keys: [Q],
    });

    expect(styleOf(config, 1).restVisibility).toBe('filled');
  });

  it('gives the global radius the corners most keys were drawn with', () => {
    const config = load({
      version: 1,
      layout: 'iso',
      layoutOverride: 'auto',
      style,
      keys: [{ ...Q, style: { radius: 12 } }, { ...W, style: { radius: 12 } }, E],
    });

    expect(config.radius).toBe(12);
  });

  it('keeps the global radius when most keys were drawn with it', () => {
    const config = load({
      version: 1,
      layout: 'iso',
      layoutOverride: 'auto',
      style,
      keys: [{ ...Q, style: { radius: 12 } }, W, E],
    });

    expect(config.radius).toBe(5);
  });

  it('keeps the global radius on a tie', () => {
    const config = load({
      version: 1,
      layout: 'iso',
      layoutOverride: 'auto',
      style,
      keys: [{ ...Q, style: { radius: 12 } }, W],
    });

    expect(config.radius).toBe(5);
  });
});

describe('v1.1 to v2.7: the resting mode, global then per key, and the active border', () => {
  const style = {
    restColor: '#151823',
    restVisibility: 'hidden',
    borderColor: '#232838',
    borderWidth: 1,
    activeColor: '#7C9EFF',
    fillColor: '#3D4A78',
    fillDirection: 'up',
    opacity: 1,
    radius: 5,
    fontFamily: "'Archivo', system-ui, sans-serif",
    fontWeight: 700,
    unit: 72,
    gap: 8,
  };

  it('hides every key of a hidden overlay (v1.1)', () => {
    const config = load({ version: 1, layout: 'iso', layoutOverride: 'auto', style, keys: [Q, W] });

    expect(config.keys.map((key) => key.style.restVisibility)).toEqual(['hidden', 'hidden']);
    expect(config.keys.map((key) => key.style.activeBorder)).toEqual(['fixed', 'fixed']);
  });

  it('keeps the key that stayed on screen (v2.3)', () => {
    const config = load({
      version: 1,
      layout: 'iso',
      layoutOverride: 'auto',
      style,
      keys: [{ ...Q, style: { restVisibility: 'filled' } }, W],
    });

    expect(config.keys.map((key) => key.style.restVisibility)).toEqual(['filled', 'hidden']);
  });

  it('keeps a border that follows the key, and the key that does not (v2.4)', () => {
    const config = load({
      version: 1,
      layout: 'iso',
      layoutOverride: 'auto',
      style: { ...style, activeBorder: 'active' },
      keys: [{ ...Q, style: { activeBorder: 'fixed' } }, W],
    });

    expect(config.keys.map((key) => key.style.activeBorder)).toEqual(['fixed', 'active']);
  });
});

describe('v3.0 to v3.5: the radius global, the border colour per key', () => {
  it('keeps both, and the font of a key', () => {
    const config = load({
      version: 1,
      layout: 'iso',
      layoutOverride: 'auto',
      style: {
        restColor: '#151823',
        restVisibility: 'filled',
        activeBorder: 'fixed',
        borderColor: '#232838',
        borderWidth: 1,
        activeColor: '#7C9EFF',
        fillColor: '#3D4A78',
        fillDirection: 'up',
        opacity: 1,
        radius: 8,
        fontFamily: "'Archivo', system-ui, sans-serif",
        fontWeight: 700,
        unit: 72,
        gap: 8,
      },
      keys: [{ ...Q, style: { borderColor: '#00ff00', fontFamily: 'Fredoka', fontWeight: 400 } }],
    });

    expect(config.radius).toBe(8);
    expect(styleOf(config, 1)).toMatchObject({
      borderColor: '#00ff00',
      fontFamily: 'Fredoka',
      fontWeight: 400,
    });
  });
});

describe('v3.6: the font global, the label size and outline', () => {
  it('keeps them all', () => {
    const config = load({
      version: 1,
      layout: 'iso',
      layoutOverride: 'auto',
      style: {
        restColor: '#151823',
        restVisibility: 'filled',
        activeBorder: 'fixed',
        borderColor: '#232838',
        borderWidth: 1,
        activeColor: '#7C9EFF',
        fillColor: '#3D4A78',
        fillDirection: 'up',
        opacity: 1,
        radius: 5,
        fontFamily: 'Bahnschrift',
        fontWeight: 600,
        labelSize: 'l',
        labelOutline: 'thin',
        unit: 72,
        gap: 8,
      },
      keys: [Q],
    });

    expect(config).toMatchObject({ labelSize: 'l', labelOutline: 'thin' });
    expect(styleOf(config, 1)).toMatchObject({ fontFamily: 'Bahnschrift', fontWeight: 600 });
  });
});

describe('v3.7 to v3.8.0: the shape every real profile has', () => {
  const stored = {
    version: 1,
    layout: 'iso',
    layoutOverride: 'azerty',
    style: {
      restColor: '#151823',
      restVisibility: 'outline',
      activeBorder: 'active',
      borderColor: '#232838',
      borderWidth: 2,
      activeColor: '#7C9EFF',
      fillColor: '#3D4A78',
      fillDirection: 'up',
      opacity: 1,
      radius: 7,
      fontFamily: 'Archivo',
      fontWeight: 700,
      labelSize: 's',
      labelOutline: 'thick',
      unit: 64,
      gap: 6,
    },
    keys: [
      { ...Q, style: { fontFamily: 'Fredoka', fontWeight: 400, restVisibility: 'hidden' } },
      { ...W, mode: 'axis', style: { borderColor: '#ff00aa', fillDirection: 'left' } },
      E,
    ],
  };

  it('comes back exactly as it was stored, its version aside', () => {
    const result = migrate(structuredClone(stored));

    expect(result).toEqual({
      ok: true,
      dropped: 0,
      config: { ...stored, version: CONFIG_VERSION } as unknown as OverlayConfig,
    });
  });
});
