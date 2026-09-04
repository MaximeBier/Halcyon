// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { createGestures, pickedFromList, toggled, type GestureContext } from './gestures';
import { surfaceOf } from './layout';
import { DEFAULT_STYLE, defaultConfig, type OverlayConfig } from '../config/schema';

const UNIT = DEFAULT_STYLE.unit;
const SURFACE = surfaceOf({ width: 1440, height: 720 }, UNIT);

function twoKeys(): OverlayConfig {
  const config = defaultConfig();
  config.keys.push(
    { id: 1, usage: 0x14, mode: 'key', label: 'A', x: 0, y: 0, w: 1, h: 1 },
    { id: 2, usage: 0x16, mode: 'key', label: 'S', x: 1, y: 0, w: 1, h: 1 },
  );
  return config;
}

/**
 * A machine over a mutable context, with the component's side played by spies.
 *
 * `select` writes back into the context, as the bound `selectedIds` does in
 * the editor: the lasso reads the selection it just rewrote, and a harness
 * that kept the two apart would never catch a machine relying on that.
 */
function machine(config = twoKeys(), selectedIds: number[] = []) {
  const ctx: GestureContext = { config, surface: SURFACE, unit: UNIT, selectedIds };
  const out = {
    preview: vi.fn(),
    marquee: vi.fn(),
    select: vi.fn((ids: number[]) => (ctx.selectedIds = ids)),
    commit: vi.fn(),
  };
  return { gestures: createGestures(() => ctx, out), out, ctx };
}

/** The last configuration a spy was handed, for reading positions out of. */
const last = (spy: ReturnType<typeof vi.fn>) => spy.mock.calls.at(-1)?.[0];

const px = (units: number) => units * UNIT;

describe('dragging keys', () => {
  it('moves the pressed key and commits once on release', () => {
    const { gestures, out } = machine();

    expect(gestures.pressKey(1, { x: 0, y: 0 }, false)).toBe(true);
    expect(out.select).toHaveBeenCalledWith([1]);

    gestures.move({ x: px(2), y: px(1) }, 1, () => ({ x: 0, y: 0 }));
    const draft = last(out.preview);
    expect(draft.keys.find((key: { id: number }) => key.id === 1)).toMatchObject({ x: 2, y: 1 });

    gestures.release();
    expect(out.commit).toHaveBeenCalledTimes(1);
    expect(last(out.commit).keys.find((key: { id: number }) => key.id === 1)).toMatchObject({
      x: 2,
      y: 1,
    });
    // The gesture is over: the editor goes back to rendering the real config.
    expect(last(out.preview)).toBeNull();
  });

  it('keeps the group when the press lands inside the selection', () => {
    const { gestures, out } = machine(twoKeys(), [1, 2]);

    gestures.pressKey(1, { x: 0, y: 0 }, false);
    // The selection survives — a press inside it is how the group is dragged.
    expect(out.select).not.toHaveBeenCalled();

    gestures.move({ x: 0, y: px(2) }, 1, () => ({ x: 0, y: 0 }));
    const keys = last(out.preview).keys;
    expect(keys.find((key: { id: number }) => key.id === 1).y).toBe(2);
    expect(keys.find((key: { id: number }) => key.id === 2).y).toBe(2);
  });

  it('clamps the drag to the work surface', () => {
    const { gestures, out } = machine();

    gestures.pressKey(1, { x: 0, y: 0 }, false);
    // Ten surfaces to the right: however far the pointer goes, the key stops
    // at the edge instead of leaving the screen.
    gestures.move({ x: px(SURFACE.w * 10), y: 0 }, 1, () => ({ x: 0, y: 0 }));

    const key = last(out.preview).keys.find((other: { id: number }) => other.id === 1);
    expect(key.x + key.w).toBeLessThanOrEqual(SURFACE.x + SURFACE.w);
    expect(key.x).toBeGreaterThan(0);
  });

  it('commits nothing when the press wobbles back to the same cell', () => {
    const { gestures, out } = machine();

    gestures.pressKey(1, { x: 0, y: 0 }, false);
    // One pixel: far below the quarter-key grid, so the draft snaps back to
    // where the key started and writing it would persist an identical config.
    gestures.move({ x: 1, y: 0 }, 1, () => ({ x: 0, y: 0 }));
    gestures.release();

    expect(out.commit).not.toHaveBeenCalled();
  });

  it('abandons the drag when the buttons are already up', () => {
    const { gestures, out } = machine();

    gestures.pressKey(1, { x: 0, y: 0 }, false);
    gestures.move({ x: px(2), y: 0 }, 0, () => ({ x: 0, y: 0 }));

    expect(last(out.preview)).toBeNull();
    gestures.release();
    expect(out.commit).not.toHaveBeenCalled();
  });

  it('toggles instead of dragging when shift is held', () => {
    const { gestures, out } = machine(twoKeys(), [1]);

    expect(gestures.pressKey(2, { x: 0, y: 0 }, true)).toBe(false);
    expect(out.select).toHaveBeenCalledWith([1, 2]);
    // No draft was armed: a twitch of the hand must not displace the group
    // being assembled.
    expect(out.preview).not.toHaveBeenCalled();
  });
});

describe('resizing by a grip', () => {
  const KEY = { id: 1, x: 0, y: 0, w: 1, h: 1 };

  it('pulls the east edge and commits the new size', () => {
    const { gestures, out } = machine();

    gestures.pressGrip(KEY, 'e', { x: 0, y: 0 });
    gestures.move({ x: px(1), y: 0 }, 1, () => ({ x: 0, y: 0 }));

    expect(last(out.preview).keys.find((key: { id: number }) => key.id === 1)).toMatchObject({
      x: 0,
      w: 2,
    });

    gestures.release();
    expect(last(out.commit).keys.find((key: { id: number }) => key.id === 1).w).toBe(2);
  });

  it('moves the origin when a near edge is pulled', () => {
    const { gestures, out } = machine();

    gestures.pressGrip(KEY, 'nw', { x: 0, y: 0 });
    gestures.move({ x: -px(1), y: -px(0.5) }, 1, () => ({ x: 0, y: 0 }));

    // The near edge writes position and size both: x and w are two properties
    // and one gesture.
    expect(last(out.preview).keys.find((key: { id: number }) => key.id === 1)).toMatchObject({
      x: -1,
      w: 2,
      y: -0.5,
      h: 1.5,
    });
  });

  it('commits nothing when the size comes back unchanged', () => {
    const { gestures, out } = machine();

    gestures.pressGrip(KEY, 'e', { x: 0, y: 0 });
    gestures.move({ x: 1, y: 0 }, 1, () => ({ x: 0, y: 0 }));
    gestures.release();

    expect(out.commit).not.toHaveBeenCalled();
  });
});

describe('the lasso', () => {
  it('selects by intersection, live, and never commits', () => {
    const { gestures, out } = machine();

    gestures.pressStage({ x: -0.5, y: -0.5 }, false);
    expect(out.select).toHaveBeenCalledWith([]);

    gestures.move({ x: 0, y: 0 }, 1, () => ({ x: 1.5, y: 0.5 }));
    // Overlap, not containment: the rectangle grazes both keys.
    expect(out.select).toHaveBeenLastCalledWith([1, 2]);
    expect(last(out.marquee)).toMatchObject({ x: -0.5, y: -0.5, w: 2, h: 1 });

    gestures.release();
    expect(out.commit).not.toHaveBeenCalled();
    expect(last(out.marquee)).toBeNull();
  });

  it('normalizes a marquee drawn up and to the left', () => {
    const { gestures, out } = machine();

    gestures.pressStage({ x: 1.5, y: 0.5 }, false);
    gestures.move({ x: 0, y: 0 }, 1, () => ({ x: -0.5, y: -0.5 }));

    expect(last(out.marquee)).toMatchObject({ x: -0.5, y: -0.5, w: 2, h: 1 });
    expect(out.select).toHaveBeenLastCalledWith([1, 2]);
  });

  it('adds to the base selection when shift started it', () => {
    const { gestures, out } = machine(twoKeys(), [2]);

    gestures.pressStage({ x: -0.5, y: -0.5 }, true);
    // The base survives the arming press…
    expect(out.select).toHaveBeenCalledWith([2]);

    gestures.move({ x: 0, y: 0 }, 1, () => ({ x: 0.5, y: 0.5 }));
    // …and the lasso adds to it without duplicating what it crosses.
    expect(out.select).toHaveBeenLastCalledWith([2, 1]);
  });

  it('keeps the selection it built when the buttons are already up', () => {
    const { gestures, out } = machine();

    gestures.pressStage({ x: -0.5, y: -0.5 }, false);
    gestures.move({ x: 0, y: 0 }, 1, () => ({ x: 1.5, y: 0.5 }));
    const chosen = out.select.mock.calls.length;

    gestures.move({ x: 0, y: 0 }, 0, () => ({ x: 0, y: 0 }));
    expect(last(out.marquee)).toBeNull();
    // The marquee goes, the selection stays: it is what one was aiming at.
    expect(out.select).toHaveBeenCalledTimes(chosen);
  });
});

describe('cancelling', () => {
  it('drops the draft and the marquee without writing anything', () => {
    const { gestures, out } = machine();

    gestures.pressKey(1, { x: 0, y: 0 }, false);
    gestures.move({ x: px(3), y: 0 }, 1, () => ({ x: 0, y: 0 }));
    gestures.cancel();

    expect(last(out.preview)).toBeNull();
    expect(last(out.marquee)).toBeNull();
    gestures.release();
    expect(out.commit).not.toHaveBeenCalled();
  });
});

describe('toggled', () => {
  it('adds an absent id and removes a present one', () => {
    expect(toggled([1], 2)).toEqual([1, 2]);
    expect(toggled([1, 2], 2)).toEqual([1]);
  });
});

describe('pickedFromList', () => {
  const ORDER = [10, 20, 30, 40];

  it('selects the row alone on a plain pick and anchors there', () => {
    expect(pickedFromList(ORDER, [10, 30], null, 20, {})).toEqual({ ids: [20], anchor: 20 });
  });

  it('toggles the row on ctrl and moves the anchor to it', () => {
    expect(pickedFromList(ORDER, [10], null, 30, { ctrl: true })).toEqual({
      ids: [10, 30],
      anchor: 30,
    });
    expect(pickedFromList(ORDER, [10, 30], null, 30, { ctrl: true })).toEqual({
      ids: [10],
      anchor: 30,
    });
  });

  it('takes the contiguous range from the anchor on shift, either way round', () => {
    expect(pickedFromList(ORDER, [20], 20, 40, { shift: true })).toEqual({
      ids: [20, 30, 40],
      anchor: 20,
    });
    // Upward too: the range is between the two rows, not "downward from".
    expect(pickedFromList(ORDER, [30], 30, 10, { shift: true })).toEqual({
      ids: [10, 20, 30],
      anchor: 30,
    });
  });

  it('falls back to a plain pick when shift has no anchor to reach from', () => {
    expect(pickedFromList(ORDER, [], null, 30, { shift: true })).toEqual({
      ids: [30],
      anchor: 30,
    });
  });

  it('forgets an anchor whose key has been deleted', () => {
    // The anchor names a key, and keys get deleted: a range reaching for a
    // row that no longer exists must not throw or select everything.
    expect(pickedFromList(ORDER, [], 99, 30, { shift: true })).toEqual({
      ids: [30],
      anchor: 30,
    });
  });
});
