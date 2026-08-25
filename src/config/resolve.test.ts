import { describe, it, expect } from 'vitest';
import {
  resolve,
  effectiveStyle,
  hasGlobalOverrides,
  hasOverrides,
  overriddenInAny,
  overriddenKeys,
} from './resolve';
import { COLOR_KEYS, isStyleValue } from './validate';
import {
  defaultConfig,
  DEFAULT_STYLE,
  STYLE_KEYS,
  GLOBAL_STYLE_KEYS,
  type GlobalStyle,
  type KeyConfig,
  type OverlayConfig,
} from './schema';

function withKeys(...keys: KeyConfig[]): OverlayConfig {
  return { ...defaultConfig(), keys };
}

const key = (over: Partial<KeyConfig> = {}): KeyConfig => ({
  id: 174,
  usage: 0x50,
  mode: 'key',
  label: 'Q',
  x: 0,
  y: 0,
  w: 1,
  h: 1,
  ...over,
});

describe('resolve', () => {
  it('flattens the global style onto every key', () => {
    const { keys } = resolve(withKeys(key()));

    expect(keys[0]?.style).toEqual({
      restColor: DEFAULT_STYLE.restColor,
      activeColor: DEFAULT_STYLE.activeColor,
      fillColor: DEFAULT_STYLE.fillColor,
      fillDirection: DEFAULT_STYLE.fillDirection,
      opacity: DEFAULT_STYLE.opacity,
      radius: DEFAULT_STYLE.radius,
      restVisibility: DEFAULT_STYLE.restVisibility,
      fontFamily: DEFAULT_STYLE.fontFamily,
      fontWeight: DEFAULT_STYLE.fontWeight,
    });
  });

  it('inherits the fill direction like any other style property', () => {
    const config = withKeys(key(), key({ id: 9, style: { fillDirection: 'left' } }));
    config.style.fillDirection = 'down';

    const { keys } = resolve(config);

    expect(keys[0]?.style.fillDirection).toBe('down');
    expect(keys[1]?.style.fillDirection).toBe('left');
  });

  it('lets a key keep itself on screen while the overlay hides at rest', () => {
    // The case the whole change exists for: nothing showing until a finger
    // moves, except the handful of keys worth keeping on the stream.
    const config = withKeys(key(), key({ id: 9, style: { restVisibility: 'filled' } }));
    config.style.restVisibility = 'hidden';

    const { keys } = resolve(config);

    expect(keys[0]?.style.restVisibility).toBe('hidden');
    expect(keys[1]?.style.restVisibility).toBe('filled');
  });

  it('lets a key hide while the overlay stays visible', () => {
    const config = withKeys(key({ style: { restVisibility: 'hidden' } }));

    expect(config.style.restVisibility).toBe('filled');
    expect(resolve(config).keys[0]?.style.restVisibility).toBe('hidden');
  });

  it('no longer lifts the resting visibility above the keys', () => {
    // It is resolved per key now, and a flattened shape carrying it twice is
    // two truths — the type promises no inheritance left to resolve.
    const resolved = resolve(withKeys(key()));

    expect('restVisibility' in resolved).toBe(false);
  });

  it('lets the key override win, property by property', () => {
    const { keys } = resolve(withKeys(key({ style: { activeColor: '#ff0000' } })));

    expect(keys[0]?.style.activeColor).toBe('#ff0000');
    expect(keys[0]?.style.restColor).toBe(DEFAULT_STYLE.restColor);
  });

  it('lifts up the unit and the gap, which no key can override', () => {
    const config = withKeys(key());
    config.style.unit = 72;
    config.style.gap = 2;

    const resolved = resolve(config);

    expect(resolved.unit).toBe(72);
    expect(resolved.gap).toBe(2);
    expect('unit' in resolved.keys[0]!.style).toBe(false);
  });

  it('preserves id, usage, mode, label and geometry', () => {
    const { keys } = resolve(withKeys(key({ mode: 'axis', label: 'Left', x: 2, y: 1, w: 1.25 })));

    expect(keys[0]).toMatchObject({
      id: 174,
      usage: 0x50,
      mode: 'axis',
      label: 'Left',
      x: 2,
      y: 1,
      w: 1.25,
      h: 1,
    });
  });

  it('does not mutate the editing configuration', () => {
    const config = withKeys(key({ style: { opacity: 0.2 } }));
    resolve(config);

    expect(config.keys[0]?.style).toEqual({ opacity: 0.2 });
  });

  it('accepts a zero-valued override without mistaking it for an absent one', () => {
    const config = withKeys(key({ style: { opacity: 0 } }));
    config.style.opacity = 1;

    expect(resolve(config).keys[0]?.style.opacity).toBe(0);
  });

  // The resolved style is built by iterating STYLE_KEYS and then asserted to be
  // a KeyStyle. That assertion is only honest while the two agree, and this is
  // what says so at runtime.
  it('produces exactly the inheritable properties, no more and no less', () => {
    const { keys } = resolve(withKeys(key()));

    expect(Object.keys(keys[0]!.style).sort()).toEqual([...STYLE_KEYS].sort());
  });
});

describe('override detection', () => {
  it('flags a customized key', () => {
    expect(hasOverrides(key())).toBe(false);
    expect(hasOverrides(key({ style: {} }))).toBe(false);
    expect(hasOverrides(key({ style: { fillColor: '#000' } }))).toBe(true);
  });

  it('lists the overridden properties, so the editor can mark them', () => {
    expect(overriddenKeys(key({ style: { fillColor: '#000', opacity: 0.5 } })).sort()).toEqual([
      'fillColor',
      'opacity',
    ]);
  });

  it('ignores a property explicitly set back to undefined', () => {
    expect(overriddenKeys(key({ style: { fillColor: undefined } }))).toEqual([]);
  });

  it('counts a zero-valued override, which is a choice like any other', () => {
    expect(overriddenKeys(key({ style: { opacity: 0 } }))).toEqual(['opacity']);
  });
});

describe('effectiveStyle', () => {
  it('also serves to show the inherited value greyed out in the editor', () => {
    expect(effectiveStyle(DEFAULT_STYLE, key()).restColor).toBe(DEFAULT_STYLE.restColor);
  });
});

describe('overrides that came from imported JSON', () => {
  // `null` cannot be typed into a Partial<KeyStyle>, but it survives a JSON
  // round trip. Resolution and the editor's markers must read it the same way,
  // or a key shows as customized while rendering the inherited value.
  const withNull = () => key({ style: { opacity: null } as never });

  it('treats a null override as absent, on both sides', () => {
    expect(overriddenKeys(withNull())).toEqual([]);
    expect(effectiveStyle(DEFAULT_STYLE, withNull()).opacity).toBe(DEFAULT_STYLE.opacity);
  });
});

/**
 * Any value that is not the default one **and that the product would accept**.
 *
 * The second half was missing until 2026-08-24, and the fallback quietly
 * supplied nonsense for five of the twelve properties: `'#e7e9ee-changed'` for
 * each colour, and `'filled-changed'` once `restVisibility` arrived. The test
 * still passed, because `hasGlobalOverrides` only asks whether a value differs
 * from the default — so it was proving the fold marker notices a change nobody
 * can make.
 *
 * `isStyleValue` is the real rule, and asserting against it here is what keeps
 * the next property added from landing in the same fallback unnoticed.
 */
function other(property: keyof GlobalStyle): unknown {
  const value = DEFAULT_STYLE[property];
  const alternative = ((): unknown => {
    if (typeof value === 'number') return value + 1;
    if (property === 'fillDirection') return 'down';
    if (property === 'restVisibility') return 'hidden';
    if (COLOR_KEYS.includes(property)) return '#abcdef';
    return `${value}-changed`;
  })();

  if (!isStyleValue(property, alternative)) {
    throw new Error(`${property}: ${String(alternative)} is not a value the product accepts`);
  }
  return alternative;
}

describe('whether the global style has been touched', () => {
  // The §9.3 marker on the "Global style" fold. It used to read `STYLE_KEYS`,
  // which is the *inheritable* set — so the five properties a key cannot
  // override were invisible to it: unit, gap, restVisibility, borderColor,
  // borderWidth. Turning the resting background off repaints every key on air
  // and lit nothing at all; changing the border colour did light the dot until
  // `borderColor` left `KeyStyle` on 2026-08-22, then quietly stopped.
  it('says nothing has been touched on a fresh style', () => {
    expect(hasGlobalOverrides(DEFAULT_STYLE)).toBe(false);
  });

  it('notices every property of the global style, inheritable or not', () => {
    for (const property of GLOBAL_STYLE_KEYS) {
      const changed = { ...DEFAULT_STYLE, [property]: other(property) } as GlobalStyle;

      expect(hasGlobalOverrides(changed), `${property} went unnoticed`).toBe(true);
    }
  });

  // The list is `Object.keys(DEFAULT_STYLE)`, and `DEFAULT_STYLE` is typed
  // `GlobalStyle`, so TypeScript refuses to compile it incomplete. This holds
  // the count as a second guard against someone replacing it with a literal.
  it('covers the whole of GlobalStyle, and is kept honest by the type', () => {
    expect(GLOBAL_STYLE_KEYS).toHaveLength(13);
    expect(GLOBAL_STYLE_KEYS).toEqual(expect.arrayContaining([...STYLE_KEYS]));
  });
});

describe('what a whole selection overrides', () => {
  it('says nothing about an empty selection', () => {
    expect(overriddenInAny([])).toEqual([]);
  });

  it('agrees with the single-key answer on a single key', () => {
    const one = key({ style: { fillColor: '#000', opacity: 0.5 } });

    expect(overriddenInAny([one])).toEqual(overriddenKeys(one));
  });

  // The popover writes to the whole selection while it used to read the lead
  // key alone. Reset then cleared the lead's properties everywhere and left
  // the others' in place — the button promising the opposite in its comment.
  it('unions what the keys override, rather than trusting the first', () => {
    const selection = [key({ style: { radius: 4 } }), key({ id: 9, style: { opacity: 0.5 } })];

    expect(overriddenInAny(selection)).toEqual(['opacity', 'radius']);
  });

  // The other half of the same defect, and the worse one: the reset button is
  // only rendered when this list is non-empty, so a group whose first key was
  // untouched offered no way at all to clear the one that was.
  it('reports an override carried by a key that is not the first', () => {
    const selection = [key(), key({ id: 9, style: { activeColor: '#ff0000' } })];

    expect(overriddenInAny(selection)).toEqual(['activeColor']);
  });

  it('reports a property once, however many keys carry it', () => {
    const selection = [key({ style: { radius: 4 } }), key({ id: 9, style: { radius: 8 } })];

    expect(overriddenInAny(selection)).toEqual(['radius']);
  });
});
