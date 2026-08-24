import { OVERLAY_TOKENS } from '../styles/tokens';
import type { LayoutOverride } from '../keyboard/labels';

/**
 * Bumped when the stored shape changes in a way a migration has to repair —
 * and **not** otherwise.
 *
 * Task 31 widened what a coordinate may be, which was very nearly a bump: an
 * older build handed a negative coordinate drops the key as malformed and
 * reports only a count, where a version it did not know would have told it the
 * truth (spec §8.8). It stayed at 1 all the same, under global constraint 18 —
 * there are no older builds in anyone's hands, so the message had no reader,
 * and the only thing shipped would have been a migration that rewrites a
 * number into itself.
 *
 * The 2026-08-24 rename of `restFilled` to `restVisibility` is the same call
 * made a second time, and this one is not a no-op: a stored profile carrying
 * the old field loses it in `pickStyle`, `{ ...DEFAULT_STYLE }` fills the new
 * one with `'filled'`, and an outline overlay comes back solid without a word
 * — `dropped` counts keys, never settings. A `MIGRATIONS[1]` mapping the
 * boolean onto the keyword would cost three lines and would spare exactly the
 * profiles that do not exist. It stays at 1, deliberately, and the cost is
 * written here so that it is a decision rather than an oversight.
 *
 * Re-read at the first user. Until then, structure wins over compatibility.
 */
export const CONFIG_VERSION = 1;

export type KeyMode = 'key' | 'axis';

/**
 * **Physical** geometry of the keyboard: this is what gives keys their size
 * and position (spec §8.5). Not to be confused with `LayoutOverride`.
 */
export type KeyboardLayout = 'iso' | 'ansi';

/**
 * **Logical** layout, re-exported from `keyboard/labels` where it is defined
 * next to the fallback tables that consume it. The re-export keeps the stored
 * shape naming all of its fields from one place; the definition stays on the
 * keyboard side so the dependency between the two modules flows
 * config → keyboard (spec §5.3), never the other way.
 */
export type { LayoutOverride };

/** Direction the fill progresses in. `up` = from the bottom upward. */
export type FillDirection = 'up' | 'down' | 'left' | 'right';

/**
 * How much of a key shows while it is resting.
 *
 * - `filled` — a background in `restColor`, the default and the whole keyboard
 *   permanently readable on the stream.
 * - `outline` — the border alone: the keys appear as the fingers travel and
 *   leave nothing behind.
 * - `hidden` — nothing at all. The layout keeps its shape and every key its
 *   place, and a key is drawn only while it is being pressed.
 */
export type RestVisibility = 'filled' | 'outline' | 'hidden';

/** Appearance properties, the only ones subject to inheritance (spec §8.2). */
export interface KeyStyle {
  restColor: string;
  activeColor: string;
  /**
   * Color of the progressive fill in "key" mode. Has no effect in "axis"
   * mode, which fills with `activeColor` — see "Deliberate deviations".
   */
  fillColor: string;
  /** An arrow ← reads better filled right to left, not bottom to top. */
  fillDirection: FillDirection;
  opacity: number;
  /** Corner radius, in pixels. */
  radius: number;
  /**
   * Family and weight only: the label size is computed from the key height
   * (spec §16.3), so it is never set here.
   */
  fontFamily: string;
  fontWeight: number;
}

export interface GlobalStyle extends KeyStyle {
  /**
   * The outline of a resting key: its colour, and how thick it is.
   *
   * `borderColor` **left `KeyStyle` on 2026-08-22** and comes back here a day
   * later, and the two decisions do not contradict each other. It went because
   * a border around a filled key is a detail nobody needs to set. It is back
   * because a key with no background at all *is* its border, and one pixel of
   * `#232838` over an arbitrary video is a key nobody can see.
   *
   * Here rather than in `KeyStyle`, so it is the outline of the overlay and not
   * an argument each key has with the theme. The **actuated** border stays
   * `activeColor`, which is per key: that asymmetry is §7.4 asking for it — the
   * second actuation signal has to follow the key that fired.
   */
  borderColor: string;
  /** In pixels. Zero draws no border at all, which is a choice. */
  borderWidth: number;
  /**
   * How much of a key is drawn while nothing is happening to it.
   *
   * Three states and not two booleans: `restFilled` was a switch until
   * 2026-08-24, and the third state does not fit beside it — a pair of flags
   * would offer four combinations of which "hidden, but with a background" and
   * "hidden, but outlined" mean nothing, and the panel would then have to
   * explain which pairs are real.
   *
   * A keyword and never a colour value, which is what the switch was for and
   * what the enum keeps: `restColor` is untouched in every state, so leaving
   * `outline` returns the colour that was there rather than a default nobody
   * chose — and a colour stays a hex colour, never `'transparent'`.
   *
   * Global only, deliberately. "How much of a resting key shows" is a decision
   * about the whole overlay; a single hidden key among visible ones is a look
   * nobody has asked for, and adding it later costs one field.
   */
  restVisibility: RestVisibility;
  /** Pixels per key unit. */
  unit: number;
  /** Gap between keys, in pixels. */
  gap: number;
}

export interface KeyConfig {
  /** Matrix index: the configuration key (spec §3.4). */
  id: number;
  /** HID usage, kept so the label can be recomputed (spec §8.6). */
  usage: number;
  mode: KeyMode;
  label: string;
  /** Position and size in key units. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Appearance overrides. Any missing property is inherited from the global. */
  style?: Partial<KeyStyle>;
}

export interface OverlayConfig {
  version: number;
  layout: KeyboardLayout;
  layoutOverride: LayoutOverride;
  style: GlobalStyle;
  keys: KeyConfig[];
}

export interface ResolvedKey {
  id: number;
  usage: number;
  mode: KeyMode;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  style: KeyStyle;
}

/** Flattened shape sent to the overlay: no inheritance left to resolve. */
export interface ResolvedConfig {
  version: number;
  unit: number;
  gap: number;
  /** Global only, like the two above: see `GlobalStyle.restVisibility`. */
  restVisibility: RestVisibility;
  borderColor: string;
  borderWidth: number;
  keys: ResolvedKey[];
}

/**
 * Exhaustiveness is enforced by the compiler, not by care.
 *
 * `STYLE_KEYS` drives inheritance resolution in task 13, so a property added to
 * `KeyStyle` and forgotten here would quietly stop being inheritable — an
 * override the editor accepts and the renderer never applies. A plain array
 * annotated `keyof KeyStyle` would check that each entry is valid, which is the
 * opposite of what matters; `Record<keyof KeyStyle, true>` refuses to compile
 * until every key is listed.
 */
const INHERITABLE: Record<keyof KeyStyle, true> = {
  restColor: true,
  activeColor: true,
  fillColor: true,
  fillDirection: true,
  opacity: true,
  radius: true,
  fontFamily: true,
  fontWeight: true,
};

export const STYLE_KEYS = Object.keys(INHERITABLE) as readonly (keyof KeyStyle)[];

/**
 * What a corner radius may be, in pixels — here rather than in one of the two
 * panels that offer it, so the global field and the per-key field cannot drift.
 *
 * The floor is what matters: `rx="-5"` is an SVG error, not a square corner,
 * and what survives it is up to the browser. Zero is a legitimate choice.
 * The ceiling is derived — SVG clamps `rx` to half the shorter side, so half
 * of the largest key a unit can be is the point past which no radius changes
 * anything on any key.
 */
export const RADIUS_BOUNDS = { min: 0, max: 100 } as const;

/**
 * What a border width may be, in pixels.
 *
 * The floor matters and is exact: a negative stroke width is an SVG error, and
 * zero is the legitimate “no border”. The ceiling is a practical cap and not a
 * derived one — past a dozen pixels a border is a frame, and the geometry
 * clamps on its own anyway, since a rect cannot be narrower than nothing.
 */
export const BORDER_WIDTH_BOUNDS = { min: 0, max: 16 } as const;

/**
 * Values from the mockup (spec §16.2). They live in `src/styles/tokens.ts`;
 * they are the same values, not placeholders.
 */
export const DEFAULT_STYLE: GlobalStyle = {
  restColor: OVERLAY_TOKENS.keyRest,
  restVisibility: 'filled',
  borderColor: OVERLAY_TOKENS.keyBorder,
  borderWidth: OVERLAY_TOKENS.keyBorderWidth,
  activeColor: OVERLAY_TOKENS.keyActive,
  fillColor: OVERLAY_TOKENS.keyFill,
  fillDirection: 'up',
  opacity: OVERLAY_TOKENS.keyOpacity,
  radius: OVERLAY_TOKENS.keyRadius,
  fontFamily: OVERLAY_TOKENS.keyFontFamily,
  fontWeight: OVERLAY_TOKENS.keyFontWeight,
  // Layout dimensions, and the user still sets them — but their starting
  // point comes from the mockup like every other value here.
  unit: OVERLAY_TOKENS.keyUnit,
  gap: OVERLAY_TOKENS.keyGap,
};

/**
 * Every property of the global style, inheritable or not.
 *
 * Read off `DEFAULT_STYLE`, which is typed `GlobalStyle` — so TypeScript
 * refuses to compile a default missing, and this list cannot fall behind the
 * interface. That is the whole reason it is derived rather than written out:
 * the hand-kept version of it went stale twice on 2026-08-22, once in the
 * fold's marker and once in the import filter, both times silently.
 *
 * `STYLE_KEYS` is the inheritable subset. The difference between the two is
 * exactly what a key may not carry, and nothing needs to list that separately.
 */
export const GLOBAL_STYLE_KEYS = Object.keys(DEFAULT_STYLE) as readonly (keyof GlobalStyle)[];

export function defaultConfig(): OverlayConfig {
  return {
    version: CONFIG_VERSION,
    layout: 'iso',
    layoutOverride: 'auto',
    style: { ...DEFAULT_STYLE },
    keys: [],
  };
}
