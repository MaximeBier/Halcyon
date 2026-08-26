import { describe, it, expect } from 'vitest';
import { isResolvedConfig } from './validate';
import { resolve } from './resolve';
import { defaultConfig, DEFAULT_STYLE, type KeyConfig } from './schema';

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
    // The scene reads every property without a fallback: one missing radius
    // renders `rx="undefined"` and the key stops being drawn.
    const config = resolved();
    const keys = config.keys as Record<string, unknown>[];
    const { radius: _dropped, ...partial } = keys[0]!.style as Record<string, unknown>;

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

    expect(keys[0]!.style).toMatchObject({ radius: DEFAULT_STYLE.radius });
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
    // to the browser. It sits right next to unit and gap, which are bounded.
    expect(styled({ radius: -5 })).toBe(false);
    expect(styled({ radius: 0 })).toBe(true);
  });
});
