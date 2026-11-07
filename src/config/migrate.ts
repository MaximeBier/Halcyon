import {
  CONFIG_VERSION,
  DEFAULT_STYLE,
  GLOBAL_STYLE_KEYS,
  STYLE_KEYS,
  type GlobalStyle,
  type KeyConfig,
  type KeyStyle,
  type LayoutOverride,
  type OverlayConfig,
} from './schema';
import { hasKeyShape, isStyleValue } from './validate';
import { firstFamily } from './fonts';

export type MigrationResult =
  /**
   * `dropped` counts the keys the file lost on the way in — malformed, or a
   * duplicate of one already kept. Losing a key beats breaking the render, but
   * the user has to be told: importing a profile and quietly getting an
   * amputated keyboard is the silent failure spec §11 rules out.
   */
  | { ok: true; config: OverlayConfig; dropped: number }
  | { ok: false; reason: 'unreadable' | 'too-new' };

type Loose = Record<string, unknown>;

function isLoose(value: unknown): value is Loose {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Version 1 is every shape written from v0.3 on: they all say `version: 1`,
 * so what a file carries is the only witness of when it was written. Three of
 * those shapes drew something today's fields read differently, and this gives
 * each back the look it was saved with — recognised by content, so it leaves
 * every shape written since v3.0 exactly as it is.
 *
 * - **`restFilled`** (v0.7 to v1.0, global). `false` drew a transparent
 *   resting key with its border, which is `restVisibility: 'outline'`.
 * - **The border that followed the key** (v0.4 to v0.6). Those files carry
 *   `borderColor`, `radius` and `fontFamily` on their style, and none of the
 *   fields v0.7 added. A key's border took its active colour when it fired,
 *   which is `activeBorder: 'active'`; an axis key's border never moved, so
 *   each axis key keeps `'fixed'` of its own. v0.3 drew a fixed border for
 *   one day in the same shape, and cannot be told apart.
 * - **A corner radius of its own** (up to v2.7, per key). The radius is
 *   global now, and a per-key one has no field to land in. The global takes
 *   the radius most keys were drawn with, so the most keys keep their corners;
 *   on a tie the global stays. The keys drawn with another radius cannot keep
 *   it.
 */
function fromLegacyShapes(config: Loose): Loose {
  if (!isLoose(config.style)) return config;

  const style: Loose = { ...config.style };
  let keys = config.keys;

  if (typeof style.restFilled === 'boolean' && style.restVisibility === undefined) {
    style.restVisibility = style.restFilled ? 'filled' : 'outline';
  }

  const beforeBorderWidth =
    'borderColor' in style &&
    'radius' in style &&
    'fontFamily' in style &&
    !('borderWidth' in style) &&
    !('restFilled' in style) &&
    !('restVisibility' in style) &&
    !('activeBorder' in style);
  if (beforeBorderWidth && Array.isArray(keys)) {
    style.activeBorder = 'active';
    keys = keys.map((key: unknown) =>
      isKeyConfig(key) && key.mode === 'axis'
        ? { ...key, style: { ...(isLoose(key.style) ? key.style : {}), activeBorder: 'fixed' } }
        : key,
    );
  }

  if (Array.isArray(keys)) {
    const global = isStyleValue('radius', style.radius)
      ? (style.radius as number)
      : DEFAULT_STYLE.radius;
    // A key's own radius is no field of today's `KeyStyle`: read loosely.
    const drawn = keys.filter(isKeyConfig).map((key) => {
      const own: unknown = (key.style as Loose | undefined)?.radius;
      return isStyleValue('radius', own) ? (own as number) : global;
    });
    const counts = new Map<number, number>();
    for (const radius of drawn) counts.set(radius, (counts.get(radius) ?? 0) + 1);
    let chosen = global;
    for (const [radius, count] of counts) {
      if (count > (counts.get(chosen) ?? 0)) chosen = radius;
    }
    if (chosen !== global) style.radius = chosen;
  }

  return { ...config, style, keys };
}

/**
 * One entry per source version. Version 0 is the one for configurations
 * written before the `version` field existed.
 */
const MIGRATIONS: Record<number, (config: Loose) => Loose> = {
  0: (config) => ({ ...config, version: 1, layout: config.layout ?? 'iso' }),
};

const LAYOUT_OVERRIDES: readonly string[] = ['auto', 'azerty', 'qwerty', 'qwertz'];

/**
 * Keeps the style properties we know, at the type we expect.
 *
 * Import is a trust boundary — the file may come from a forum post — and a
 * `unit` of `"wide"` propagates as `NaN` through every coordinate of the scene.
 * Comparing against the defaults covers the whole style in one rule: unknown
 * properties are dropped, wrong types are dropped, and so is any number JSON
 * managed to make infinite.
 *
 * `properties` is what separates a global style from a per-key one. The keys
 * inherit `unit` and `gap` from nobody: they are layout sizes, and letting one
 * through would be a setting the editor stores and the renderer ignores.
 */
function pickStyle(raw: unknown, properties: readonly (keyof GlobalStyle)[]): Loose {
  if (typeof raw !== 'object' || raw === null) return {};

  const source = raw as Loose;
  const style: Loose = {};
  for (const property of properties) {
    const value = source[property];
    if (!isStyleValue(property, value)) continue;
    style[property] = value;
  }
  return style;
}

function knownStyle(raw: unknown): Partial<GlobalStyle> {
  return pickStyle(withFamilyName(raw), GLOBAL_STYLE_KEYS) as Partial<GlobalStyle>;
}

/**
 * Every profile written before 2026-11-04 stored the default stack itself as
 * its family. Brought down to its first name before the check, or the stack's
 * quotes would have it refused and a chosen face silently reset to the default.
 * A key's own font gets the same treatment: one imported before that date
 * holds a stack just the same.
 */
function withFamilyName(raw: unknown): unknown {
  if (typeof raw !== 'object' || raw === null) return raw;

  const style = raw as Loose;
  if (typeof style.fontFamily !== 'string') return raw;
  return { ...style, fontFamily: firstFamily(style.fontFamily) };
}

/**
 * The per-key style, which the review found crossing the boundary untouched.
 * A `restColor` of `42` reaches `contrastingLabel`, which calls `trim()` on it:
 * the overlay throws inside a `$derived` and stops rendering for good.
 */
function knownKeyStyle(raw: unknown): Partial<KeyStyle> {
  // `STYLE_KEYS` and nothing else. The list used to be built by subtracting a
  // hand-kept `['unit', 'gap']`, which was right until three global-only
  // settings arrived on 2026-08-22 — `restVisibility`, `borderColor`, `borderWidth`
  // then rode through on a key, were stored, were re-exported, and were ignored
  // by `resolve()`. Invisible to `overriddenKeys`, so no reset could remove
  // them: precisely the "stored by the editor, ignored by the renderer" the
  // comment above says this exists to prevent. Derived from the inheritable set
  // itself, the mistake has nowhere left to happen. A key's own `radius` is
  // dropped here since 2026-09-05, when it went global; `fromLegacyShapes` has
  // already moved what it could of it onto the global style.
  return pickStyle(withFamilyName(raw), STYLE_KEYS) as Partial<KeyStyle>;
}

/**
 * The eight fields `hasKeyShape` checks, with no opinion on `style`: a
 * malformed or absent one is fine here, since `knownKeyStyle` filters it
 * property by property right after this gate, whatever shape it arrives in.
 */
function isKeyConfig(value: unknown): value is KeyConfig {
  return hasKeyShape(value, () => true);
}

/**
 * Keeps the first key of any duplicated id, the same rule the decoder applies
 * to the report. The id keys the overlay's SVG nodes, and a duplicate there
 * kills the render — mid-stream, on the one surface nobody is watching.
 */
function byUniqueId(keys: KeyConfig[]): KeyConfig[] {
  const seen = new Set<number>();
  return keys.filter((key) => {
    if (seen.has(key.id)) return false;
    seen.add(key.id);
    return true;
  });
}

export function migrate(raw: unknown): MigrationResult {
  if (typeof raw !== 'object' || raw === null) return { ok: false, reason: 'unreadable' };

  let config = { ...(raw as Loose) };
  const version = typeof config.version === 'number' ? config.version : 0;

  if (version > CONFIG_VERSION) return { ok: false, reason: 'too-new' };

  // Before the chain: the shapes it repairs all say version 1 or nothing, and
  // a later step must receive them already in today's version-1 shape.
  if (version <= 1) config = fromLegacyShapes(config);

  for (let from = version; from < CONFIG_VERSION; from++) {
    const step = MIGRATIONS[from];
    if (!step) return { ok: false, reason: 'unreadable' };
    config = step(config);
  }

  // After the chain, not before: checked ahead of it, no future migration
  // could ever create or rename this field — the step would run and its own
  // result be refused.
  if (!Array.isArray(config.keys)) return { ok: false, reason: 'unreadable' };

  const override = config.layoutOverride;
  const submitted = config.keys as unknown[];
  // A malformed key is dropped: better to lose one key than to break the
  // rendering of all the others.
  const keys = byUniqueId(
    submitted.filter(isKeyConfig).map((key) => {
      const style = knownKeyStyle(key.style);
      // Built from its known fields rather than spread, exactly as the style
      // is: an unknown property spread in here survives into storage and out
      // of the next export, leaving profiles that are not canonical and a
      // saveConfig that can hit the quota it swallows in silence.
      //
      // Absent rather than empty style: a key with no override should come
      // back out of an export exactly as it went in, and `{}` on every key is
      // noise in a file people open and read.
      return {
        id: key.id,
        usage: key.usage,
        mode: key.mode,
        label: key.label,
        x: key.x,
        y: key.y,
        w: key.w,
        h: key.h,
        style: Object.keys(style).length > 0 ? style : undefined,
      };
    }),
  );

  return {
    ok: true,
    dropped: submitted.length - keys.length,
    config: {
      version: CONFIG_VERSION,
      layout: config.layout === 'ansi' ? 'ansi' : 'iso',
      layoutOverride: LAYOUT_OVERRIDES.includes(override as string)
        ? (override as LayoutOverride)
        : 'auto',
      style: { ...DEFAULT_STYLE, ...knownStyle(config.style) },
      keys,
    },
  };
}
