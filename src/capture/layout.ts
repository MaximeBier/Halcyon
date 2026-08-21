import type { KeyConfig, KeyMode, OverlayConfig, ResolvedConfig } from '../config/schema';

/** A quarter key: enough for a ZQSD cross block (spec §8.7). */
export const GRID = 0.25;

/**
 * Snaps to the grid, and refuses anything that is not a number.
 *
 * Not for the numeric fields — `<input type="number">` reports `''` when it is
 * empty, and `+''` is zero, so the editor guards that itself. This is for the
 * values that reach here without passing through a field: an imported profile,
 * a config message off the wire. `NaN` survives every clamp and lands in the
 * SVG as an attribute the browser discards, taking the key off the screen with
 * no error anywhere.
 */
export function snap(value: number, grid: number = GRID): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value / grid) * grid;
}

export function pixelsToUnits(pixels: number, unit: number): number {
  return pixels / unit;
}

function patchKey(
  config: OverlayConfig,
  id: number,
  patch: (key: KeyConfig) => KeyConfig,
): OverlayConfig {
  if (!config.keys.some((key) => key.id === id)) return config;
  return { ...config, keys: config.keys.map((key) => (key.id === id ? patch(key) : key)) };
}

/**
 * The smallest work surface, in key units.
 *
 * Only ever reached before the stage has been laid out — under a test, or
 * before the first paint — where a surface of nothing would clamp every key
 * onto a single point. Smaller than any real stage, so it never wins on a
 * screen.
 */
const MIN_SURFACE = { w: 12, h: 8 };

/**
 * The work surface, in key units: **what the stage can show, and nothing
 * more**, with the origin at its centre.
 *
 * Two properties, and the whole design of the editor rests on them.
 *
 * *It does not depend on the content.* Two attempts at centring the layout
 * failed the same way: a reference frame sized by what it measures moves with
 * it, so dragging a key right widened the box, its left edge receded by half
 * of that, and the key followed the pointer at half speed. The stage's size is
 * not something a drag can change, which is what buys the 1:1 movement.
 *
 * *It is exactly what is visible.* A surface larger than the window would need
 * scrollbars to reach, and a key pushed into the part nobody scrolled to is a
 * key nobody finds. Here the edge of the work surface is the edge of the
 * screen: there is nowhere to lose a key.
 *
 * Where the layout ends up on it changes nothing downstream — the broadcast
 * packs, and only the positions of the keys relative to each other ever reach
 * the overlay (spec §5.4).
 */
export function surfaceOf(box: { width: number; height: number }, unit: number): Rect {
  // A unit of zero would make the surface infinite, which is the one answer
  // that cannot be clamped against. The style validator already refuses it;
  // this is here because the consequence is silent.
  const across = unit > 0 ? unit : 1;
  const w = Math.max(MIN_SURFACE.w, box.width / across);
  const h = Math.max(MIN_SURFACE.h, box.height / across);

  return { x: -w / 2, y: -h / 2, w, h };
}

/**
 * Keeps a span of `extent` inside `[from, from + span]`.
 *
 * `Math.max` last, deliberately: a key wider than the surface makes the two
 * bounds cross, and the one to honour then is the near edge. The other order
 * pushes it off the surface on the left, which is the failure this whole
 * function exists to prevent.
 */
function clamp(value: number, extent: number, from: number, span: number): number {
  return Math.max(from, Math.min(value, from + span - extent));
}

/**
 * A position brought back onto the work surface, for a key of that size.
 *
 * The one boundary, and it applies to every way a key gets a position —
 * dragged, typed into the fields, or placed by learning. Off the surface, a
 * key is off the screen: neither visible nor clickable, its only trace a line
 * in the sidebar list.
 */
export function ontoSurface(at: Point, w: number, h: number, surface: Rect): Point {
  return {
    x: clamp(at.x, w, surface.x, surface.w),
    y: clamp(at.y, h, surface.y, surface.h),
  };
}

/**
 * The same scene, expressed in stage coordinates.
 *
 * The drawing has to be translated rather than merely offset in CSS: an SVG
 * draws its `viewBox` from zero, so a key at `x: -1` would be painted outside
 * the frame and never appear — which is the very thing the old rule guarded
 * against, and the reason it takes a translation to be rid of it.
 */
export function onSurface(config: ResolvedConfig, surface: Rect): ResolvedConfig {
  return {
    ...config,
    keys: config.keys.map((key) => ({ ...key, x: key.x - surface.x, y: key.y - surface.y })),
  };
}

export function moveKey(
  config: OverlayConfig,
  id: number,
  x: number,
  y: number,
  surface: Rect,
): OverlayConfig {
  return patchKey(config, id, (key) => ({
    ...key,
    ...ontoSurface({ x: snap(x), y: snap(y) }, key.w, key.h, surface),
  }));
}

/**
 * The most of `shift` that keeps a group spanning `[low, high]` on the
 * surface — clamped once, for the whole group, so the alignments inside it
 * survive being pushed against an edge.
 */
function clampShift(shift: number, low: number, high: number, from: number, span: number): number {
  return Math.max(from - low, Math.min(shift, from + span - high));
}

/**
 * Moves a group. It is the **offset** that gets snapped, not the final
 * positions: snapping each key separately would destroy the relative
 * alignments of any group laid out off-grid.
 *
 * `origins` is recorded when the drag starts: starting again from the origin
 * positions rather than accumulating offsets avoids any floating-point drift.
 */
export function moveKeysBy(
  config: OverlayConfig,
  origins: ReadonlyMap<number, { x: number; y: number }>,
  dx: number,
  dy: number,
  surface: Rect,
): OverlayConfig {
  if (origins.size === 0) return config;

  // Origins for where the group started, the live keys for how big it is: the
  // offset is bounded by the group's *edges*, and a key clamped by its corner
  // hangs half of itself off the surface.
  const boxes = config.keys
    .filter((key) => origins.has(key.id))
    .map((key) => ({ ...origins.get(key.id)!, w: key.w, h: key.h }));
  if (boxes.length === 0) return config;

  const shiftX = clampShift(
    snap(dx),
    Math.min(...boxes.map((box) => box.x)),
    Math.max(...boxes.map((box) => box.x + box.w)),
    surface.x,
    surface.w,
  );
  const shiftY = clampShift(
    snap(dy),
    Math.min(...boxes.map((box) => box.y)),
    Math.max(...boxes.map((box) => box.y + box.h)),
    surface.y,
    surface.h,
  );

  return {
    ...config,
    keys: config.keys.map((key) => {
      const origin = origins.get(key.id);
      return origin ? { ...key, x: origin.x + shiftX, y: origin.y + shiftY } : key;
    }),
  };
}

export function resizeKeys(
  config: OverlayConfig,
  ids: readonly number[],
  w: number,
  h: number,
): OverlayConfig {
  const width = Math.max(GRID, snap(w));
  const height = Math.max(GRID, snap(h));

  return {
    ...config,
    keys: config.keys.map((key) => (ids.includes(key.id) ? { ...key, w: width, h: height } : key)),
  };
}

/**
 * Switches the display mode of the selection.
 *
 * The mode changes nothing about how the key is read — the actuation bit
 * arrives either way — only how it is drawn (spec §7.4). Task 23 adds the
 * suggestion that goes with it; this is the manual switch, without which the
 * axis mode exists in the renderer and nowhere else.
 */
export function setMode(
  config: OverlayConfig,
  ids: readonly number[],
  mode: KeyMode,
): OverlayConfig {
  return {
    ...config,
    keys: config.keys.map((key) => (ids.includes(key.id) ? { ...key, mode } : key)),
  };
}

export interface Point {
  x: number;
  y: number;
}

/** A rectangle in key units, with a non-negative extent. */
export interface Rect extends Point {
  w: number;
  h: number;
}

/**
 * The rectangle between two corners, whichever way round they were drawn.
 *
 * Half of all lassos are drawn up and to the left. Left as a negative extent,
 * those overlap nothing and the gesture would work in two directions out of
 * four — which reads as the feature being broken at random.
 */
export function normalizeRect(from: Point, to: Point): Rect {
  return {
    x: Math.min(from.x, to.x),
    y: Math.min(from.y, to.y),
    w: Math.abs(to.x - from.x),
    h: Math.abs(to.y - from.y),
  };
}

/**
 * The keys a lasso touches, in configuration order (spec §8.7).
 *
 * Overlap, not containment: requiring a key to sit entirely inside means
 * drawing around the outside of everything, which cannot be done against the
 * edge of the stage. Strict comparisons, so edge-to-edge is not overlap — a
 * lasso stopped cleanly against a key leaves it alone — and a rectangle of no
 * area, which is what a click on bare stage produces, takes nothing.
 */
export function keysWithin(config: OverlayConfig, rect: Rect): number[] {
  // A lasso with no area is not a lasso, it is a click — and a click on bare
  // stage lands in the gap between two keys, which belongs to a key's cell.
  // Overlap alone would select the neighbour of every gap ever clicked.
  if (rect.w === 0 || rect.h === 0) return [];

  return config.keys
    .filter(
      (key) =>
        key.x < rect.x + rect.w &&
        rect.x < key.x + key.w &&
        key.y < rect.y + rect.h &&
        rect.y < key.y + key.h,
    )
    .map((key) => key.id);
}
