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
 * The two ways onto the grid, and which one a boundary needs.
 *
 * **A boundary rounds inwards**, always. The surface is a pixel measurement
 * divided by the unit, so its edges land on no grid: left alone, a key pushed
 * against one takes a coordinate like `-6.958333333333333`, and every size and
 * position derived from it carries the dust — which is how the footer came to
 * quote `217.00000000000003 × 146.00000000000006 px`.
 *
 * Rounding the other way would put the key a quarter of a key *past* the edge,
 * which is the one thing the clamp exists to prevent. The price is a margin of
 * up to a quarter key against each edge, unreachable: the grid is the set of
 * positions a key may hold, and the edge of the screen is not one of them.
 */
const gridUp = (value: number) => Math.ceil(value / GRID) * GRID;
const gridDown = (value: number) => Math.floor(value / GRID) * GRID;

/**
 * Keeps a span of `extent` inside `[from, from + span]`, on the grid.
 *
 * `Math.max` last, deliberately: a key wider than the surface makes the two
 * bounds cross, and the one to honour then is the near edge. The other order
 * pushes it off the surface on the left, which is the failure this whole
 * function exists to prevent.
 */
function clamp(value: number, extent: number, from: number, span: number): number {
  return Math.max(gridUp(from), Math.min(value, gridDown(from + span - extent)));
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

/**
 * How far a span may hang over an edge before anyone is told about it.
 *
 * A millionth of a key unit is some seven millionths of a pixel: not a key
 * anyone lost. It is also where the arithmetic lands — `ontoSurface` writes
 * `edge - w`, and adding `w` back is not obliged to return `edge` exactly.
 * Grid-aligned sizes never trip it, but an imported profile is under no
 * obligation to be grid-aligned, and the consequence would be a key marked as
 * lost in the very spot the editor just placed it.
 */
const SLACK = 1e-9;

const within = (at: number, extent: number, from: number, span: number) =>
  at >= from - SLACK && at + extent <= from + span + SLACK;

/**
 * The keys that are not on the work surface, in configuration order.
 *
 * **Not entirely in** is the test, not "its corner is out": a key half over
 * the edge is half unreachable, and a two-pixel sliver is not something one
 * grabs with a mouse.
 *
 * `ontoSurface` prevents a key from being *placed* out here, and says nothing
 * about what happens next. Three ways in need no mistake at all: shrinking the
 * window, raising `unit` — the surface is measured in key units, so it shrinks
 * too — and importing a profile with distant coordinates. The stage does not
 * scroll, so a key out here is not merely awkward to reach: it is invisible,
 * and the sidebar list is the only thing that can say it exists.
 */
export function keysOutside(config: OverlayConfig, surface: Rect): number[] {
  return config.keys
    .filter(
      (key) =>
        !within(key.x, key.w, surface.x, surface.w) || !within(key.y, key.h, surface.y, surface.h),
    )
    .map((key) => key.id);
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
 *
 * The two bounds are rounded inwards for the same reason as `clamp`'s, and it
 * matters more here: an off-grid offset takes **every** key in the group with
 * it, so one push against an edge left nothing in the layout expressible on
 * the grid. A group that was off-grid to begin with stays that way — that is
 * `moveKeysBy`'s deliberate tolerance, and the offset being on the grid is
 * what preserves it.
 */
function clampShift(shift: number, low: number, high: number, from: number, span: number): number {
  return Math.max(gridUp(from - low), Math.min(shift, gridDown(from + span - high)));
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

/**
 * Which sides a resize gesture moves, by compass point.
 *
 * Compass rather than `left` / `top`, because the diagonals need a name too and
 * `bottom-right` eight times over reads worse than `se`. The four letters never
 * collide, so a side is tested by asking whether the name contains it.
 */
export type Edge = 'n' | 'e' | 's' | 'w' | 'ne' | 'se' | 'sw' | 'nw';

/**
 * One axis of a resize: where the span starts, and how long it is.
 *
 * The two edges are not symmetrical. A **far** edge only changes the extent,
 * which is why it is the easy half. A **near** edge changes *both* — `x` and
 * `w` are two properties and one gesture — and getting that wrong leaves the
 * edge under the pointer standing still while the opposite one moves.
 *
 * Both bounds round towards the inside of the surface (task 36) and, when they
 * cross, **the minimum size wins**: a span of zero is an invisible key and a
 * negative one is an SVG error, whereas a key slightly off the surface is
 * merely marked as such in the sidebar list.
 */
function sizeAxis(
  at: number,
  extent: number,
  delta: number,
  near: boolean,
  far: boolean,
  from: number,
  span: number,
): { at: number; extent: number } {
  if (far) {
    const edge = Math.max(at + GRID, Math.min(at + extent + delta, gridDown(from + span)));
    return { at, extent: edge - at };
  }
  if (near) {
    const edge = Math.min(at + extent - GRID, Math.max(at + delta, gridUp(from)));
    return { at: edge, extent: at + extent - edge };
  }
  return { at, extent };
}

/**
 * A key resized by one of its edges, from the geometry the gesture started on.
 *
 * `origin` is recorded on press, like a drag's, so the answer never depends on
 * the path taken to get there — and it is the **offset** that is snapped, not
 * the result, so a key deliberately off the grid keeps its alignment.
 *
 * This is also the bound `resizeKeys` never had: growing a key at the edge of
 * the surface used to push it off the screen, which a gesture that did nothing
 * wrong has no business doing.
 */
export function resizeKeyTo(
  config: OverlayConfig,
  id: number,
  edge: Edge,
  origin: { x: number; y: number; w: number; h: number },
  dx: number,
  dy: number,
  surface: Rect,
): OverlayConfig {
  const across = sizeAxis(
    origin.x,
    origin.w,
    snap(dx),
    edge.includes('w'),
    edge.includes('e'),
    surface.x,
    surface.w,
  );
  const down = sizeAxis(
    origin.y,
    origin.h,
    snap(dy),
    edge.includes('n'),
    edge.includes('s'),
    surface.y,
    surface.h,
  );

  return patchKey(config, id, (key) => ({
    ...key,
    x: across.at,
    w: across.extent,
    y: down.at,
    h: down.extent,
  }));
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

export function removeKey(config: OverlayConfig, id: number): OverlayConfig {
  return removeKeys(config, [id]);
}

export function removeKeys(config: OverlayConfig, ids: readonly number[]): OverlayConfig {
  return { ...config, keys: config.keys.filter((key) => !ids.includes(key.id)) };
}

/** The selection with `id` toggled — shift+press and keyboard share it. */
export function toggled(ids: readonly number[], id: number): number[] {
  return ids.includes(id) ? ids.filter((other) => other !== id) : [...ids, id];
}

/** What a pick in the sidebar list settles on: the selection, and where the
 * next shift-range reaches from. */
export interface ListPick {
  ids: number[];
  anchor: number;
}

/**
 * A pick on a row of the keys list (spec §16.5): plain selects the row alone,
 * ctrl toggles it, shift takes the contiguous range from the anchor.
 *
 * The anchor is the last row picked without shift — including a ctrl-toggle,
 * so a range extends from the row someone just added, the way every file
 * manager reads it. It names a key rather than an index: rows move when keys
 * are deleted, and a range measured from a stale index would grab keys nobody
 * pointed at. An anchor whose key is gone falls back to a plain pick instead
 * of throwing or selecting to one end.
 */
export function pickedFromList(
  order: readonly number[],
  selected: readonly number[],
  anchor: number | null,
  id: number,
  modifiers: { ctrl?: boolean; shift?: boolean },
): ListPick {
  if (modifiers.shift && anchor !== null) {
    const from = order.indexOf(anchor);
    const to = order.indexOf(id);
    if (from !== -1 && to !== -1) {
      const [lo, hi] = from <= to ? [from, to] : [to, from];
      return { ids: order.slice(lo, hi + 1), anchor };
    }
  }
  if (modifiers.ctrl) return { ids: toggled(selected, id), anchor: id };
  return { ids: [id], anchor: id };
}
