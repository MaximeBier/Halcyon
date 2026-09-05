// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { isResolvedConfig, normalizeHex } from './validate';
import { resolve } from './resolve';
import {
  defaultConfig,
  DEFAULT_STYLE,
  RADIUS_BOUNDS,
  BORDER_WIDTH_BOUNDS,
  OPACITY_BOUNDS,
  FONT_WEIGHT_BOUNDS,
  type KeyConfig,
} from './schema';

const aKey: KeyConfig = {
  id: 174,
  usage: 0x50,
  mode: 'key',
  label: 'Q',
  x: 0,
  y: 0,
  w: 1,
  h: 1,
};

function resolved() {
  const config = defaultConfig();
  config.keys.push(aKey);
  return resolve(config) as unknown as Record<string, unknown>;
}

describe('isResolvedConfig', () => {
  it('accepts what resolve produces', () => {
    expect(isResolvedConfig(resolved())).toBe(true);
    expect(isResolvedConfig(resolve(defaultConfig()))).toBe(true);
  });

  it('refuses anything that is not an object with a key list', () => {
    expect(isResolvedConfig(null)).toBe(false);
    expect(isResolvedConfig('nope')).toBe(false);
    expect(isResolvedConfig({ ...resolved(), keys: 'nope' })).toBe(false);
  });

  it('refuses the sizes that collapse or invert the scene', () => {
    expect(isResolvedConfig({ ...resolved(), unit: 0 })).toBe(false);
    expect(isResolvedConfig({ ...resolved(), unit: -56 })).toBe(false);
    // A gap is a distance, not a position: the two shared one rule until
    // task 31 widened positions, and this is what keeps them apart.
    expect(isResolvedConfig({ ...resolved(), gap: -1 })).toBe(false);
    expect(isResolvedConfig({ ...resolved(), unit: Number.NaN })).toBe(false);
  });

  it('refuses a key whose geometry cannot be drawn', () => {
    const bad = (over: Record<string, unknown>) => {
      const config = resolved();
      const keys = config.keys as Record<string, unknown>[];
      return isResolvedConfig({ ...config, keys: [{ ...keys[0]!, ...over }] });
    };

    expect(bad({ x: Number.NaN })).toBe(false);
    expect(bad({ y: Number.POSITIVE_INFINITY })).toBe(false);
    expect(bad({ w: 0 })).toBe(false);
    expect(bad({ h: Number.POSITIVE_INFINITY })).toBe(false);
    expect(bad({ id: 'q' })).toBe(false);
    expect(bad({ mode: 'sideways' })).toBe(false);
    expect(bad({ label: 42 })).toBe(false);
  });

  it('accepts a key left of and above the origin', () => {
    // The work surface has an origin with room on every side of it (task 31),
    // and the broadcast packs — the leftmost key *becomes* the left edge — so
    // a negative coordinate is a position like any other. The rule that used
    // to refuse them guarded a renderer that stopped existing at task 23b.
    const config = resolved();
    const keys = config.keys as Record<string, unknown>[];

    expect(isResolvedConfig({ ...config, keys: [{ ...keys[0]!, x: -4, y: -2.5 }] })).toBe(true);
  });

  it('refuses a key whose style is incomplete', () => {
    // The scene reads every property without a fallback: one missing border
    // colour renders `stroke="undefined"` and the outline stops being drawn.
    const config = resolved();
    const keys = config.keys as Record<string, unknown>[];
    const { borderColor: _dropped, ...partial } = keys[0]!.style as Record<string, unknown>;

    expect(isResolvedConfig({ ...config, keys: [{ ...keys[0]!, style: partial }] })).toBe(false);
  });

  it('refuses a style property of the wrong type', () => {
    const config = resolved();
    const keys = config.keys as Record<string, unknown>[];
    const style = { ...(keys[0]!.style as Record<string, unknown>), restColor: 42 };

    expect(isResolvedConfig({ ...config, keys: [{ ...keys[0]!, style }] })).toBe(false);
  });

  it('refuses a fill direction outside the four', () => {
    const config = resolved();
    const keys = config.keys as Record<string, unknown>[];
    const style = { ...(keys[0]!.style as Record<string, unknown>), fillDirection: 'diagonal' };

    expect(isResolvedConfig({ ...config, keys: [{ ...keys[0]!, style }] })).toBe(false);
  });

  it('refuses a border behaviour the scene cannot switch on', () => {
    // An unknown keyword would fall through the border's ternary and leave the
    // outline its resting colour for ever: a setting stored and never applied.
    const config = resolved();
    const keys = config.keys as Record<string, unknown>[];
    const style = { ...(keys[0]!.style as Record<string, unknown>), activeBorder: 'sometimes' };

    expect(isResolvedConfig({ ...config, keys: [{ ...keys[0]!, style }] })).toBe(false);
  });

  it('accepts every default style property as resolve emits it', () => {
    const config = resolved();
    const keys = config.keys as Record<string, unknown>[];

    expect(keys[0]!.style).toMatchObject({ borderColor: DEFAULT_STYLE.borderColor });
    expect(isResolvedConfig(config)).toBe(true);
  });
});

describe('isResolvedConfig - rules that must match the import side', () => {
  const styled = (over: Record<string, unknown>) => {
    const config = resolved();
    const keys = config.keys as Record<string, unknown>[];
    const style = { ...(keys[0]!.style as Record<string, unknown>), ...over };
    return isResolvedConfig({ ...config, keys: [{ ...keys[0]!, style }] });
  };

  it('refuses a colour the renderer cannot read', () => {
    // Hex only, because "whatever the browser accepts" is not a rule this side
    // of the wire can check: a named colour one engine knows and another does
    // not would arrive as a key painted black on half the machines. migrate
    // refuses these; the wire has to refuse them too, or the rule holds on one
    // side only.
    //
    // (This comment used to explain the rule through `luminance` and
    // `contrastingLabel`, gone since the label took a fixed colour and an
    // outline. The rule outlived its first reason.)
    expect(styled({ restColor: 'white' })).toBe(false);
    expect(styled({ activeColor: 'rgb(255,0,0)' })).toBe(false);
    expect(styled({ fillColor: '#f0a' })).toBe(true);
    expect(styled({ restColor: '#FF00AA' })).toBe(true);
  });

  it('refuses a negative corner radius', () => {
    // `rx="-5"` is an SVG error, not a square corner, and what survives is up
    // to the browser. On the config root since 2026-09-05, beside unit and
    // gap, which are bounded the same way.
    const config = resolved();

    expect(isResolvedConfig({ ...config, radius: -5 })).toBe(false);
    expect(isResolvedConfig({ ...config, radius: 0 })).toBe(true);
  });

  it('refuses a radius past what any key could ever show', () => {
    // Past `RADIUS_BOUNDS.max`, SVG clamps `rx` to half the shorter side on
    // its own: nothing past it changes what the key draws, and a value there
    // is either a typo or a file built for a renderer that has no such cap.
    const config = resolved();

    expect(isResolvedConfig({ ...config, radius: RADIUS_BOUNDS.max })).toBe(true);
    expect(isResolvedConfig({ ...config, radius: RADIUS_BOUNDS.max + 1 })).toBe(false);
  });

  it('refuses a border colour the renderer cannot read, on the key it now sits on', () => {
    expect(styled({ borderColor: 'grey' })).toBe(false);
    expect(styled({ borderColor: '#ff00aa' })).toBe(true);
  });

  it('refuses a border width outside what a border can be', () => {
    // `borderWidth` sits on the config root, not on a key's style — unlike
    // the border's colour, it never goes through `styled`.
    const config = resolved();

    expect(isResolvedConfig({ ...config, borderWidth: BORDER_WIDTH_BOUNDS.max })).toBe(true);
    expect(isResolvedConfig({ ...config, borderWidth: BORDER_WIDTH_BOUNDS.max + 1 })).toBe(false);
  });

  it('refuses an opacity outside what CSS can paint', () => {
    // Values past `[0, 1]` are clamped by CSS itself, silently — the renderer
    // never errors, so a `1.5` that slipped through import would sit in the
    // profile and in every export of it, looking chosen on purpose.
    expect(styled({ opacity: OPACITY_BOUNDS.min })).toBe(true);
    expect(styled({ opacity: OPACITY_BOUNDS.max })).toBe(true);
    expect(styled({ opacity: OPACITY_BOUNDS.max + 0.5 })).toBe(false);
    expect(styled({ opacity: OPACITY_BOUNDS.min - 0.1 })).toBe(false);
  });

  it('refuses a font weight outside the numeric CSS scale', () => {
    expect(styled({ fontWeight: FONT_WEIGHT_BOUNDS.min })).toBe(true);
    expect(styled({ fontWeight: FONT_WEIGHT_BOUNDS.max })).toBe(true);
    expect(styled({ fontWeight: FONT_WEIGHT_BOUNDS.min - 1 })).toBe(false);
    expect(styled({ fontWeight: FONT_WEIGHT_BOUNDS.max + 9000 })).toBe(false);
  });
});

describe('normalizeHex', () => {
  it('takes a hex colour with or without its hash, and lowercases it', () => {
    // `<input type="color">` reports lowercase; one colour written two ways
    // would defeat every equality the presets rely on.
    expect(normalizeHex('#FF00AA')).toBe('#ff00aa');
    expect(normalizeHex('ff00aa')).toBe('#ff00aa');
    expect(normalizeHex(' #f0a ')).toBe('#f0a');
  });

  it('refuses what the renderer could not check', () => {
    expect(normalizeHex('grey')).toBeNull();
    expect(normalizeHex('#ff00a')).toBeNull();
    expect(normalizeHex('')).toBeNull();
  });
});
