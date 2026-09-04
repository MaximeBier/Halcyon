import {
  STYLE_KEYS,
  DEFAULT_STYLE,
  RADIUS_BOUNDS,
  BORDER_WIDTH_BOUNDS,
  OPACITY_BOUNDS,
  FONT_WEIGHT_BOUNDS,
  type ResolvedConfig,
} from './schema';

type Loose = Record<string, unknown>;

/** A number inside a `{ min, max }` pair, both ends included. */
function inBounds(value: number, bounds: { readonly min: number; readonly max: number }): boolean {
  return value >= bounds.min && value <= bounds.max;
}

/**
 * The style rules both sides share.
 *
 * They live here, and `migrate` imports them, because a rule kept in two
 * literal lists is a rule that will hold on one side only. The wire and the
 * imported file must agree on what a colour is; they differ solely on whether
 * a style may be partial.
 */
export const FILL_DIRECTIONS: readonly string[] = ['up', 'down', 'left', 'right'];

/**
 * The three states of a resting key (`GlobalStyle.restVisibility`).
 *
 * Beside `FILL_DIRECTIONS` and for its reason: a keyword the renderer switches
 * on is a keyword both boundaries have to agree about, and an unknown one falls
 * through every branch of that switch. Where a bad direction cost one key its
 * travel, a bad visibility would cost the overlay its keys.
 */
export const REST_VISIBILITIES: readonly string[] = ['filled', 'outline', 'hidden'];

/**
 * What the border of an engaged key may do (`KeyStyle.activeBorder`).
 *
 * Beside `REST_VISIBILITIES` and for its reason: an unknown keyword falls
 * through the ternary the scene builds its border colour with, which would
 * leave the border its resting colour for ever — a setting the editor stores
 * and the renderer ignores.
 */
export const ACTIVE_BORDERS: readonly string[] = ['fixed', 'active'];

/**
 * The one colour syntax accepted.
 *
 * Not because the renderer could not paint `rebeccapurple` — it hands the
 * string straight to an SVG `fill` — but because "whatever the browser accepts"
 * is not a rule this side of the wire can check. A named colour one engine
 * knows and another does not would arrive as a key painted black on half the
 * machines, with nothing here able to say so.
 *
 * *This used to read "the only syntax the scene's `luminance` knows how to
 * read". That function computed the label colour from the background, and has
 * been gone since the label took a fixed colour and an outline: the rule
 * outlived its first reason. Found on 2026-08-22, while adding an exception
 * beside it that was then dropped.*
 */
export const HEX_COLOR = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

/** Property names ending in `Color`, resolved once against the style shape. */
export const COLOR_KEYS: readonly string[] = Object.keys(DEFAULT_STYLE).filter((name) =>
  name.endsWith('Color'),
);

/**
 * Checks one style property against what the renderer can actually draw.
 *
 * Shared by both boundaries. `radius` sits with the sizes rather than with the
 * free numbers: `rx="-5"` is an SVG error, not a square corner, and what
 * survives it is up to the browser.
 */
export function isStyleValue(property: string, value: unknown): boolean {
  const fallback = DEFAULT_STYLE[property as keyof typeof DEFAULT_STYLE];
  if (typeof value !== typeof fallback) return false;
  if (typeof value === 'number' && !Number.isFinite(value)) return false;
  if (property === 'fillDirection') return FILL_DIRECTIONS.includes(value as string);
  if (property === 'restVisibility') return REST_VISIBILITIES.includes(value as string);
  if (property === 'activeBorder') return ACTIVE_BORDERS.includes(value as string);
  if (COLOR_KEYS.includes(property)) return HEX_COLOR.test(value as string);
  // A unit of zero collapses the scene, a negative one produces an invalid SVG
  // width that browsers discard: a blank overlay, on air, in silence.
  if (property === 'unit') return (value as number) > 0;
  if (property === 'gap') return (value as number) >= 0;
  // These four had a floor and no ceiling until the 2026-09-04 review: a
  // `radius` or `borderWidth` past what any key could show, or an `opacity`
  // or `fontWeight` outside what CSS can paint, survived import untouched and
  // came back out of every export looking chosen on purpose. The bounds
  // themselves live on `schema.ts`, not here, so the global field and the
  // per-key override can never drift from each other.
  if (property === 'radius') return inBounds(value as number, RADIUS_BOUNDS);
  if (property === 'borderWidth') return inBounds(value as number, BORDER_WIDTH_BOUNDS);
  if (property === 'opacity') return inBounds(value as number, OPACITY_BOUNDS);
  if (property === 'fontWeight') return inBounds(value as number, FONT_WEIGHT_BOUNDS);
  return true;
}

/** Geometry has to be drawable, and JSON is happy to hand over Infinity. */
export function isExtent(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

/**
 * A position is any finite number, negative included.
 *
 * It used to be non-negative, for a reason that expired: the scene drew its
 * viewBox from the origin, so a key at `x: -1` fell outside the frame and
 * never appeared. Since task 23b the broadcast renders with `pack`, whose
 * origin is `min(x)` — the leftmost key *becomes* the left edge, wherever it
 * sits — and the editor draws on a surface whose origin is a constant with
 * room on every side of it (task 31).
 *
 * What is left is the rule that never expires: JSON is happy to hand over
 * `NaN`, which survives every clamp and reaches the SVG as an attribute the
 * browser discards, taking the key off the screen with no error anywhere.
 */
export function isPosition(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * A distance, which may be nothing but never less than nothing.
 *
 * Positions and gaps shared `isPosition` until task 31 widened it. They are
 * not the same quantity: a key at `-1` is a key one unit to the left, while a
 * gap of `-1` is keys drawn over each other and an SVG rect the browser
 * discards.
 */
export function isNonNegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isCompleteStyle(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;

  const style = value as Loose;
  return STYLE_KEYS.every((property) => isStyleValue(property, style[property]));
}

/**
 * The eight fields every key carries, on either side of the boundary.
 *
 * `isKeyConfig` (migrate, the import boundary) and `isResolvedKey` (below,
 * the wire boundary) checked these eight identically and disagreed only on a
 * ninth: whether `style` has to be complete. Two hand-kept copies of eight
 * fields is a rule that drifts the day one side changes and the other does
 * not — found in the 2026-09-04 review. `styleOk` is a parameter rather than
 * a ninth field here, so each caller states its own rule instead of this
 * function guessing which boundary it is being asked from.
 *
 * Lives here rather than in `migrate`, which already imports `isExtent` and
 * `isPosition` from this module: the dependency runs one way, and a shared
 * shape check has to sit on the side already being imported from, or it
 * would draw the arrow back the other way and close a cycle.
 */
export function hasKeyShape(value: unknown, styleOk: (style: unknown) => boolean): boolean {
  if (typeof value !== 'object' || value === null) return false;

  const key = value as Loose;
  return (
    Number.isInteger(key.id) &&
    Number.isInteger(key.usage) &&
    (key.mode === 'key' || key.mode === 'axis') &&
    typeof key.label === 'string' &&
    isPosition(key.x) &&
    isPosition(key.y) &&
    isExtent(key.w) &&
    isExtent(key.h) &&
    styleOk(key.style)
  );
}

function isResolvedKey(value: unknown): boolean {
  return hasKeyShape(value, isCompleteStyle);
}

/**
 * Guards the configuration arriving over obs-websocket.
 *
 * The plan reasoned that the overlay receives what the capture sends and both
 * are built from the same repository. That holds for the sender we intend;
 * it says nothing about the channel. Any client authenticated on the same
 * obs-websocket can emit under our key, and `buildScene` reads `keys.filter`
 * and `style.radius` without a fallback — a config message shaped wrong takes
 * the overlay down for the rest of the stream.
 *
 * A style has to be **complete** here, unlike on import: this shape has already
 * been through inheritance resolution, so a missing property is not something
 * to inherit, it is something that will render as `undefined`.
 */
export function isResolvedConfig(value: unknown): value is ResolvedConfig {
  if (typeof value !== 'object' || value === null) return false;

  const config = value as Loose;
  return (
    typeof config.version === 'number' &&
    Number.isFinite(config.version) &&
    isExtent(config.unit) &&
    isNonNegative(config.gap) &&
    // `restVisibility` is checked on each key instead, by `isResolvedKey`
    // through `STYLE_KEYS`: it became inheritable on 2026-08-25 and left this
    // shape's root, where it would now be a second, disagreeing truth.
    HEX_COLOR.test(config.borderColor as string) &&
    // Bounded rather than merely non-negative, since 2026-09-04: `borderWidth`
    // sits on the config root and never goes through `isStyleValue` the way a
    // key's own properties do, so the schema's ceiling had to be repeated here
    // by hand or the wire would accept what import already refuses.
    isNonNegative(config.borderWidth) &&
    inBounds(config.borderWidth as number, BORDER_WIDTH_BOUNDS) &&
    Array.isArray(config.keys) &&
    config.keys.every(isResolvedKey)
  );
}
