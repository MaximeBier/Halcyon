import {
  keysWithin,
  moveKeysBy,
  normalizeRect,
  pixelsToUnits,
  resizeKeyTo,
  type Edge,
  type Point,
  type Rect,
} from './layout';
import type { OverlayConfig } from '../config/schema';

/** A pointer position in client pixels, straight off the event. */
export interface ClientPoint {
  x: number;
  y: number;
}

/**
 * What every gesture decision is made against, read fresh on each event.
 *
 * A function rather than values, because the gesture outlives the values: the
 * selection changes under a lasso on every move, and a snapshot taken when the
 * press landed would rewrite it from stale grounds.
 */
export interface GestureContext {
  config: OverlayConfig;
  surface: Rect;
  unit: number;
  selectedIds: readonly number[];
}

/**
 * Where the machine's decisions land. The component owns the reactive state
 * and the persistence; the machine only ever announces.
 */
export interface GestureOutputs {
  /**
   * The configuration under gesture, or `null` when none is.
   *
   * A drag emits a position on every pointer move — up to 120 a second — and
   * committing persists and broadcasts. Doing that per move would stringify
   * the whole configuration into local storage and push it over obs-websocket
   * at that rate, competing with the frames. So the gesture works on a draft
   * and commits once, on release: the broadcast lags the preview by the length
   * of a drag, which nobody can perceive while adjusting a key.
   */
  preview(draft: OverlayConfig | null): void;
  /** The marquee to draw, in key units and the right way round, or `null`. */
  marquee(rect: Rect | null): void;
  /** The selection, rewritten on press and live under a lasso. */
  select(ids: number[]): void;
  /** The one write of a gesture that changed something. */
  commit(next: OverlayConfig): void;
}

export interface GestureMachine {
  /**
   * A press on a key handle. Returns whether a drag was armed, so the caller
   * knows to capture the pointer — a shift press composes the selection
   * instead, and capturing there would swallow the click that follows.
   */
  pressKey(id: number, at: ClientPoint, shift: boolean): boolean;
  /** A press on a resize grip, for the key the grips belong to. */
  pressGrip(
    key: { id: number; x: number; y: number; w: number; h: number },
    edge: Edge,
    at: ClientPoint,
  ): void;
  /** A press on bare stage, in key units: arms the marquee. */
  pressStage(at: Point, shift: boolean): void;
  /**
   * A pointer move. `onStage` converts to key units only when the lasso needs
   * it — the conversion reads the stage's bounding box, which the two
   * pixel-delta gestures never require.
   */
  move(at: ClientPoint, buttons: number, onStage: () => Point): void;
  /** The release, where a gesture that changed something commits. */
  release(): void;
  /** Drops the gesture without writing anything. */
  cancel(): void;
}

/** The selection with `id` toggled — shift+press and keyboard share it. */
export function toggled(ids: readonly number[], id: number): number[] {
  return ids.includes(id) ? ids.filter((other) => other !== id) : [...ids, id];
}

/**
 * The drag / resize / lasso state machine, kept apart from the DOM.
 *
 * The component translates events — buttons, client coordinates, shift — and
 * this decides what they mean. The split is the same one `session.ts` draws:
 * everything in here runs on plain values, so the gesture rules are tested
 * without mounting a stage.
 *
 * Drag, resize and lasso are three internal states rather than one tagged
 * variable: the three gestures start from different presses, and one variable
 * holding any of them would need a tag to say which — at which point they are
 * three variables with extra steps. The *draft* is shared, so everything
 * downstream of it follows a resize exactly as it follows a move.
 */
export function createGestures(read: () => GestureContext, out: GestureOutputs): GestureMachine {
  let draft: OverlayConfig | null = null;
  let drag: { start: ClientPoint; origins: Map<number, { x: number; y: number }> } | null = null;
  let sizing: {
    id: number;
    edge: Edge;
    start: ClientPoint;
    origin: { x: number; y: number; w: number; h: number };
  } | null = null;
  /**
   * `base` is the selection the lasso adds to — empty unless Shift was held
   * when it started. Recorded once rather than read back from the context,
   * which the gesture rewrites on every move.
   */
  let lasso: { from: Point; to: Point; base: number[] } | null = null;

  function show(next: OverlayConfig) {
    draft = next;
    out.preview(next);
  }

  function reset() {
    drag = null;
    sizing = null;
    draft = null;
    // The selection the marquee built is kept: it is what one was aiming at,
    // and Escape clears it on the next press anyway.
    lasso = null;
    out.preview(null);
    out.marquee(null);
  }

  return {
    pressKey(id, at, shift) {
      const ctx = read();

      if (shift) {
        // Composing a selection, not moving one: no drag starts from here, or
        // a twitch of the hand would displace the group being assembled.
        out.select(toggled(ctx.selectedIds, id));
        return false;
      }

      // Pressing a key outside the selection takes it alone; pressing one
      // inside keeps the group, so the whole group can be dragged.
      const ids = ctx.selectedIds.includes(id) ? ctx.selectedIds : [id];
      if (!ctx.selectedIds.includes(id)) out.select([id]);

      show(ctx.config);
      drag = {
        start: at,
        origins: new Map(
          ctx.config.keys
            .filter((key) => ids.includes(key.id))
            .map((key) => [key.id, { x: key.x, y: key.y }]),
        ),
      };
      return true;
    },

    pressGrip(key, edge, at) {
      const ctx = read();
      show(ctx.config);
      sizing = {
        id: key.id,
        edge,
        start: at,
        origin: { x: key.x, y: key.y, w: key.w, h: key.h },
      };
    },

    pressStage(at, shift) {
      const ctx = read();
      // Shift adds, matching Shift+click. Without it the press clears, which
      // is the behaviour bare stage had before the lasso existed — a marquee
      // that selects nothing still ends with an empty selection.
      const base = shift ? [...ctx.selectedIds] : [];
      out.select(base);
      lasso = { from: at, to: at, base };
      out.marquee(normalizeRect(at, at));
    },

    move(at, buttons, onStage) {
      if (sizing && draft !== null) {
        // Same guard as the drag: a release we never saw would leave the edge
        // following the pointer with nothing held down.
        if (buttons === 0) {
          reset();
          return;
        }

        const ctx = read();
        show(
          resizeKeyTo(
            ctx.config,
            sizing.id,
            sizing.edge,
            sizing.origin,
            pixelsToUnits(at.x - sizing.start.x, ctx.unit),
            pixelsToUnits(at.y - sizing.start.y, ctx.unit),
            ctx.surface,
          ),
        );
        return;
      }

      if (lasso) {
        // Same guard again: a release we never saw would leave the marquee
        // following the pointer with nothing held down.
        if (buttons === 0) {
          lasso = null;
          out.marquee(null);
          return;
        }

        lasso = { ...lasso, to: onStage() };
        const rect = normalizeRect(lasso.from, lasso.to);
        out.marquee(rect);
        // Live, because a marquee that only reports on release is a rectangle
        // one has to aim blind. Nothing is persisted or broadcast by a
        // selection, so the cost is a filter over a handful of keys.
        out.select([...new Set([...lasso.base, ...keysWithin(read().config, rect)])]);
        return;
      }

      if (!drag || draft === null) return;
      // No button held means the release happened somewhere we never saw it —
      // outside the window, or after the handle was removed from the DOM and
      // took the pointer capture with it. Without this the key follows the
      // mouse for good.
      if (buttons === 0) {
        reset();
        return;
      }

      const ctx = read();
      show(
        moveKeysBy(
          ctx.config,
          drag.origins,
          pixelsToUnits(at.x - drag.start.x, ctx.unit),
          pixelsToUnits(at.y - drag.start.y, ctx.unit),
          ctx.surface,
        ),
      );
    },

    release() {
      if (sizing && draft !== null) {
        // Compared against the origin, like the drag: a press that wobbles by
        // a pixel lands back on the same grid cell, and writing there costs a
        // stringify into local storage and a broadcast for nothing.
        const key = draft.keys.find((other) => other.id === sizing!.id);
        const origin = sizing.origin;
        const resized = key ? key.w !== origin.w || key.h !== origin.h : false;
        const next = draft;

        reset();
        if (resized) out.commit(next);
        return;
      }

      if (lasso) {
        lasso = null;
        out.marquee(null);
        return;
      }

      if (!drag || draft === null) return;

      // Compared against the origins rather than "a pointermove happened": a
      // one-pixel twitch during a click snaps back to the same grid cell, and
      // writing there costs a synchronous stringify and a broadcast for a
      // configuration identical to the stored one.
      const moved = draft.keys.some((key) => {
        const origin = drag!.origins.get(key.id);
        return origin ? origin.x !== key.x || origin.y !== key.y : false;
      });
      const next = draft;

      reset();
      if (moved) out.commit(next);
    },

    cancel() {
      reset();
    },
  };
}
