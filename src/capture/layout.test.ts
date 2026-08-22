import { describe, it, expect } from 'vitest';
import {
  GRID,
  keysOutside,
  keysWithin,
  moveKey,
  moveKeysBy,
  normalizeRect,
  ontoSurface,
  pixelsToUnits,
  resizeKeys,
  resizeKeyTo,
  setMode,
  snap,
  surfaceOf,
  type Edge,
} from './layout';
import { DEFAULT_STYLE, defaultConfig, type OverlayConfig } from '../config/schema';

/** A stage of 1440 × 720 at the default unit: 20 × 10 key units. */
const SURFACE = surfaceOf({ width: 1440, height: 720 }, DEFAULT_STYLE.unit);

/**
 * A stage whose edges land nowhere near the grid — which is the ordinary case.
 *
 * The surface is a pixel measurement divided by the unit, so its edges are on
 * no grid at all; `SURFACE` above is the exception, not the rule. 1002 px at
 * the default unit puts them at ±6.958333333333333.
 */
const ODD = surfaceOf({ width: 1002, height: 562 }, DEFAULT_STYLE.unit);

/** Whether a coordinate is one the quarter-key grid can express. */
const onGrid = (value: number) => snap(value) === value;

function config(): OverlayConfig {
  const base = defaultConfig();
  base.keys.push({ id: 1, usage: 0x14, mode: 'key', label: 'A', x: 0, y: 0, w: 1, h: 1 });
  return base;
}

function pair(): OverlayConfig {
  const base = config();
  base.keys.push({ id: 2, usage: 0x16, mode: 'key', label: 'S', x: 1.75, y: 2, w: 1, h: 1 });
  return base;
}

const origins = (c: OverlayConfig, ...ids: number[]) =>
  new Map(c.keys.filter((k) => ids.includes(k.id)).map((k) => [k.id, { x: k.x, y: k.y }]));

describe('snap', () => {
  it('snaps to the quarter key', () => {
    expect(snap(0.31)).toBe(0.25);
    expect(snap(0.4)).toBe(0.5);
    expect(snap(1.13)).toBe(1.25);
    expect(GRID).toBe(0.25);
  });

  it('accepts a custom grid', () => {
    expect(snap(0.4, 0.5)).toBe(0.5);
  });
});

describe('surfaceOf', () => {
  it('is the stage, in key units, with the origin at its centre', () => {
    // The two halves of what the surface is for: a key at 0,0 lands in the
    // middle of the screen, and it has somewhere to go in all four
    // directions.
    expect(SURFACE).toEqual({ x: -10, y: -5, w: 20, h: 10 });
  });

  it('shrinks and grows with the window', () => {
    // Not a constant, and it must not be: the promise is that the edge of the
    // work surface is the edge of the screen, whatever size the screen is.
    const narrow = surfaceOf({ width: 1000, height: 720 }, DEFAULT_STYLE.unit);

    expect(narrow.w).toBeLessThan(SURFACE.w);
    expect(narrow.x).toBe(-narrow.w / 2);
  });

  it('holds more keys as the keys get smaller', () => {
    // The answer to "my keyboard does not fit": the surface is measured in
    // key units, so halving the unit doubles the room.
    const small = surfaceOf({ width: 1440, height: 720 }, DEFAULT_STYLE.unit / 2);

    expect(small.w).toBe(SURFACE.w * 2);
  });

  it('never collapses to nothing before the stage has been measured', () => {
    // jsdom lays nothing out, and neither does a browser before the first
    // paint. A surface of zero would clamp every key onto a single point.
    const unmeasured = surfaceOf({ width: 0, height: 0 }, DEFAULT_STYLE.unit);

    expect(unmeasured.w).toBeGreaterThan(0);
    expect(unmeasured.h).toBeGreaterThan(0);
  });

  it('refuses to make the surface infinite over a unit of zero', () => {
    // The style validator already refuses it; what makes it worth a line here
    // is that the consequence — every clamp comparing against Infinity — is
    // completely silent.
    expect(Number.isFinite(surfaceOf({ width: 1440, height: 720 }, 0).w)).toBe(true);
  });
});

describe('moveKey', () => {
  it('moves while snapping to the grid', () => {
    expect(moveKey(config(), 1, 2.13, 1.4, SURFACE).keys[0]).toMatchObject({ x: 2.25, y: 1.5 });
  });

  it('accepts a position left of and above the origin', () => {
    expect(moveKey(config(), 1, -3, -1, SURFACE).keys[0]).toMatchObject({ x: -3, y: -1 });
  });

  it('stops at the edge of the work surface rather than off it', () => {
    // Not a matter of taste: a key dropped off the surface is drawn at a
    // pixel outside the stage, so it can be neither seen nor
    // clicked — and the only trace of it is a line in the sidebar list.
    const far = moveKey(config(), 1, -1000, -1000, SURFACE).keys[0];
    const beyond = moveKey(config(), 1, 1000, 1000, SURFACE).keys[0];

    expect(far).toMatchObject({ x: SURFACE.x, y: SURFACE.y });
    // The key is one unit wide, and it is its far edge that has to stay in.
    expect(beyond).toMatchObject({ x: SURFACE.x + SURFACE.w - 1, y: SURFACE.y + SURFACE.h - 1 });
  });

  it('puts a key too big for the surface against the near edge', () => {
    // The two bounds cross once the key is wider than the surface, and only
    // one of them can be honoured. Honouring the far one slides the key off
    // to the left — further out than where it started, which is the failure
    // the clamp exists to prevent.
    const wide = config();
    wide.keys[0]!.w = SURFACE.w + 10;

    expect(moveKey(wide, 1, 0, 0, SURFACE).keys[0]?.x).toBe(SURFACE.x);
  });

  it('leaves a key clamped against an edge on the grid', () => {
    // The bug behind `217.00000000000003 × 146.00000000000006 px` in the
    // footer. The surface is a pixel measurement divided by the unit, so its
    // edges sit on no grid: a key pushed against one took a coordinate like
    // -6.958333333333333, and every size and position derived from it carried
    // the dust. The grid is the set of positions a key may hold — the boundary
    // does not get to invent one outside it.
    const far = moveKey(config(), 1, 1000, 1000, ODD).keys[0]!;
    const near = moveKey(config(), 1, -1000, -1000, ODD).keys[0]!;

    expect([far.x, far.y, near.x, near.y].every(onGrid)).toBe(true);
    // Rounded *inwards*, both ends: the whole point of the clamp is that the
    // key stays on the surface, and a quarter key the wrong way undoes it.
    expect(far.x + 1).toBeLessThanOrEqual(ODD.x + ODD.w);
    expect(near.x).toBeGreaterThanOrEqual(ODD.x);
    expect(far.y + 1).toBeLessThanOrEqual(ODD.y + ODD.h);
    expect(near.y).toBeGreaterThanOrEqual(ODD.y);
  });

  it('ignores an unknown id', () => {
    const before = config();

    expect(moveKey(before, 99, 5, 5, SURFACE)).toEqual(before);
  });

  it('refuses a value that is not a number', () => {
    // The numeric fields hand over whatever was typed; an empty one is NaN,
    // and NaN reaches the SVG as an attribute the browser discards.
    expect(moveKey(config(), 1, Number.NaN, 2, SURFACE).keys[0]).toMatchObject({ x: 0, y: 2 });
  });

  it('leaves the configuration it was given untouched', () => {
    const before = config();

    moveKey(before, 1, 5, 5, SURFACE);

    expect(before.keys[0]).toMatchObject({ x: 0, y: 0 });
  });
});

describe('moveKeysBy', () => {
  it('moves the whole group by the same offset, snapped to the grid', () => {
    const before = pair();

    const after = moveKeysBy(before, origins(before, 1, 2), 1.13, 0.9, SURFACE);

    expect(after.keys[0]).toMatchObject({ x: 1.25, y: 1 });
    expect(after.keys[1]).toMatchObject({ x: 3, y: 3 });
  });

  it('snaps the offset, not the positions: relative alignments survive', () => {
    const before = pair();
    before.keys[1]!.x = 1.6; // deliberately off-grid key

    const after = moveKeysBy(before, origins(before, 1, 2), 1, 0, SURFACE);

    expect(after.keys[1]?.x).toBeCloseTo(2.6, 10);
  });

  it('does not move the keys outside the group', () => {
    const before = pair();

    const after = moveKeysBy(before, origins(before, 1), 1, 1, SURFACE);

    expect(after.keys[1]).toMatchObject({ x: 1.75, y: 2 });
  });

  it('stops the whole group at the edge of the surface instead of crushing it', () => {
    const before = pair();

    const after = moveKeysBy(before, origins(before, 1, 2), -1000, 0, SURFACE);

    // The gap of 1.75 between them survives: it is the offset that is
    // clamped, once, and not each key against the edge on its own.
    expect(after.keys[0]?.x).toBe(SURFACE.x);
    expect(after.keys[1]?.x).toBe(SURFACE.x + 1.75);
  });

  it('measures the far edge from the widest key, not from its corner', () => {
    const before = pair();

    const after = moveKeysBy(before, origins(before, 1, 2), 1000, 1000, SURFACE);

    // Key 2 sits at 1.75 and is one unit wide, so 2.75 is what has to land on
    // the edge. Clamping the corner instead would push its right half off.
    expect(after.keys[1]?.x).toBe(SURFACE.x + SURFACE.w - 1);
    expect(after.keys[0]?.x).toBe(SURFACE.x + SURFACE.w - 2.75);
  });

  it('leaves a whole group clamped against an edge on the grid', () => {
    // Worse than the single key, and the same cause: the clamped offset is
    // itself off the grid, so pushing a group against an edge took *every*
    // key with it — one gesture, and nothing in the layout is expressible any
    // more.
    const before = pair();

    const after = moveKeysBy(before, origins(before, 1, 2), 1000, -1000, ODD);

    expect(after.keys.every((key) => onGrid(key.x) && onGrid(key.y))).toBe(true);
    expect(Math.max(...after.keys.map((key) => key.x + key.w))).toBeLessThanOrEqual(ODD.x + ODD.w);
    expect(Math.min(...after.keys.map((key) => key.y))).toBeGreaterThanOrEqual(ODD.y);
  });

  it('holds a group wider than the surface against the near edge', () => {
    const before = pair();
    before.keys[1]!.x = SURFACE.w + 5;

    const after = moveKeysBy(before, origins(before, 1, 2), 0, 0, SURFACE);

    // Same crossing of bounds as a single oversized key, and the same answer:
    // the left edge wins, so what is on screen stays on screen.
    expect(after.keys[0]?.x).toBe(SURFACE.x);
  });

  it('always starts again from the origin positions, with no accumulation', () => {
    const before = pair();
    const memo = origins(before, 1, 2);

    const dragged = moveKeysBy(moveKeysBy(before, memo, 1, 0, SURFACE), memo, 2, 0, SURFACE);

    expect(dragged.keys[0]?.x).toBe(2);
  });

  it('does nothing when the drag carries no key', () => {
    const before = pair();

    expect(moveKeysBy(before, new Map(), 3, 3, SURFACE)).toBe(before);
  });
});

describe('resizeKeys', () => {
  it('resizes while snapping to the grid', () => {
    expect(resizeKeys(config(), [1], 6.2, 1.9).keys[0]).toMatchObject({ w: 6.25, h: 2 });
  });

  it('enforces a minimum size of a quarter key', () => {
    expect(resizeKeys(config(), [1], 0, -2).keys[0]).toMatchObject({ w: GRID, h: GRID });
  });

  it('applies the same size to the whole group', () => {
    const after = resizeKeys(pair(), [1, 2], 1.5, 1);

    expect(after.keys[0]?.w).toBe(1.5);
    expect(after.keys[1]?.w).toBe(1.5);
  });

  it('ignores an unknown id without touching the others', () => {
    const after = resizeKeys(pair(), [99], 2, 2);

    expect(after.keys[0]?.w).toBe(1);
  });

  it('refuses a size that is not a number', () => {
    expect(resizeKeys(config(), [1], Number.NaN, 2).keys[0]).toMatchObject({ w: GRID, h: 2 });
  });
});

describe('pixelsToUnits', () => {
  it('converts a screen movement into key units', () => {
    expect(pixelsToUnits(112, 56)).toBe(2);
  });
});

describe('setMode', () => {
  it('switches a key to axis mode', () => {
    expect(setMode(config(), [1], 'axis').keys[0]?.mode).toBe('axis');
  });

  it('switches the whole selection at once', () => {
    const after = setMode(pair(), [1, 2], 'axis');

    expect(after.keys.map((k) => k.mode)).toEqual(['axis', 'axis']);
  });

  it('leaves the keys outside the selection alone', () => {
    const after = setMode(pair(), [1], 'axis');

    expect(after.keys[1]?.mode).toBe('key');
  });

  it('changes nothing else about the key', () => {
    const before = config();

    const after = setMode(before, [1], 'axis');

    expect(after.keys[0]).toMatchObject({ id: 1, label: 'A', x: 0, y: 0, w: 1, h: 1 });
    expect(before.keys[0]?.mode).toBe('key');
  });
});

describe('keysWithin', () => {
  // A row of three unit keys with a one-unit hole where the second would be.
  const row = (): OverlayConfig => {
    const config = defaultConfig();
    config.keys.push(
      { id: 1, usage: 0x14, mode: 'key', label: 'A', x: 0, y: 0, w: 1, h: 1 },
      { id: 2, usage: 0x16, mode: 'key', label: 'S', x: 2, y: 0, w: 1, h: 1 },
      { id: 3, usage: 0x07, mode: 'key', label: 'D', x: 0, y: 2, w: 2, h: 1 },
    );
    return config;
  };

  it('takes the keys the rectangle covers whole', () => {
    expect(keysWithin(row(), { x: -1, y: -1, w: 5, h: 2 })).toEqual([1, 2]);
  });

  it('takes a key the rectangle merely clips', () => {
    // Requiring full containment means a lasso has to be drawn around the
    // outside of everything, which cannot be done against the edge of the
    // stage. Clipping one corner is enough.
    expect(keysWithin(row(), { x: 0.75, y: 0.75, w: 0.5, h: 0.5 })).toEqual([1]);
  });

  it('leaves alone what it does not reach', () => {
    expect(keysWithin(row(), { x: 1.1, y: 0, w: 0.5, h: 1 })).toEqual([]);
  });

  it('does not take a key it only runs alongside', () => {
    // Edge to edge is not overlap. Otherwise a lasso stopped cleanly against a
    // key takes it, and the gesture cannot be aimed.
    expect(keysWithin(row(), { x: -1, y: 0, w: 1, h: 1 })).toEqual([]);
  });

  it('takes nothing from a rectangle with no area', () => {
    // A click on bare stage is a drag of zero size — and "bare stage" includes
    // the gap between two keys, which is inside a key's cell. Without this,
    // clicking to clear the selection would select the key next to the gap.
    expect(keysWithin(row(), { x: 0.5, y: 0.5, w: 0, h: 0 })).toEqual([]);
    expect(keysWithin(row(), { x: 0.5, y: 0.5, w: 0.4, h: 0 })).toEqual([]);
  });

  it('returns ids in configuration order, whatever the rectangle', () => {
    expect(keysWithin(row(), { x: -1, y: -1, w: 9, h: 9 })).toEqual([1, 2, 3]);
  });
});

describe('normalizeRect', () => {
  it('leaves a rectangle drawn down and right alone', () => {
    expect(normalizeRect({ x: 1, y: 2 }, { x: 4, y: 6 })).toEqual({ x: 1, y: 2, w: 3, h: 4 });
  });

  it('turns a rectangle drawn up and left the right way round', () => {
    // Half of all lassos are drawn backwards, and a negative width selects
    // nothing at all — the gesture would work in two directions out of four.
    expect(normalizeRect({ x: 4, y: 6 }, { x: 1, y: 2 })).toEqual({ x: 1, y: 2, w: 3, h: 4 });
  });

  it('handles the two mixed directions too', () => {
    expect(normalizeRect({ x: 4, y: 2 }, { x: 1, y: 6 })).toEqual({ x: 1, y: 2, w: 3, h: 4 });
  });
});

describe('keysOutside', () => {
  it('says nothing while every key is on the surface', () => {
    expect(keysOutside(pair(), SURFACE)).toEqual([]);
  });

  it('names a key whose far edge hangs over, not only one whose corner does', () => {
    // "Outside" is a box that is not *entirely* in: a key left half over the
    // edge is half unreachable, and a sliver of it is not something one grabs
    // with a mouse.
    const base = config();
    base.keys.push({ id: 2, usage: 0x16, mode: 'key', label: 'S', x: 9.5, y: 0, w: 1, h: 1 });

    expect(keysOutside(base, SURFACE)).toEqual([2]);
  });

  it('counts a key flush against the edge as in', () => {
    // Not pedantry: `ontoSurface` puts a clamped key exactly here, so the
    // stricter reading would report every dragged key as lost the moment it
    // touched an edge.
    const base = config();
    base.keys.push({ id: 2, usage: 0x16, mode: 'key', label: 'S', x: 9, y: 4, w: 1, h: 1 });

    expect(keysOutside(base, SURFACE)).toEqual([]);
  });

  it('agrees with the clamp, whatever the size of the key', () => {
    // The two have to answer the same question the same way, or the editor
    // reports a key as lost in the very spot it just placed it.
    const base = config();
    const wide = ontoSurface({ x: 999, y: -999 }, 4, 2, SURFACE);
    base.keys.push({ id: 2, usage: 0x16, mode: 'key', label: 'S', ...wide, w: 4, h: 2 });

    expect(keysOutside(base, SURFACE)).toEqual([]);
  });

  it('looks at both axes', () => {
    const base = config();
    base.keys.push({ id: 2, usage: 0x16, mode: 'key', label: 'S', x: 0, y: -8, w: 1, h: 1 });

    expect(keysOutside(base, SURFACE)).toEqual([2]);
  });

  it('ignores an overhang far below a pixel', () => {
    // A key a millionth of a unit over the edge is not a key anyone lost, and
    // marking it would send someone hunting for a difference they cannot see.
    // It is also where the arithmetic lands: the clamp writes `edge - w`, and
    // adding `w` back is not obliged to return `edge` exactly.
    const base = config();
    base.keys.push({ id: 2, usage: 0x16, mode: 'key', label: 'S', x: 9 + 1e-12, y: 0, w: 1, h: 1 });

    expect(keysOutside(base, SURFACE)).toEqual([]);
  });
});

describe('resizeKeyTo', () => {
  /** The geometry recorded when the gesture starts: one key, one unit square. */
  const ORIGIN = { x: 0, y: 0, w: 1, h: 1 };
  const sized = (edge: Edge, dx: number, dy: number, surface = SURFACE) =>
    resizeKeyTo(config(), 1, edge, ORIGIN, dx, dy, surface).keys[0]!;

  it('grows a far edge without moving the key', () => {
    expect(sized('e', 2, 0)).toMatchObject({ x: 0, w: 3 });
  });

  it('moves a near edge and the position together', () => {
    // `x` and `w` are two properties and one gesture: pulling the left edge
    // left must widen the key *and* start it further left, or the edge under
    // the pointer is the one that does not move.
    expect(sized('w', -1, 0)).toMatchObject({ x: -1, w: 2 });
  });

  it('snaps the offset, not the result', () => {
    // The same rule as a drag, and for the same reason: a key deliberately
    // off-grid keeps its alignment, since what lands on the grid is the amount
    // it moved.
    expect(sized('e', 0.13, 0)).toMatchObject({ w: 1.25 });
  });

  it('touches only the axis its edge names', () => {
    // Eight handles, and the diagonal ones are the only two-axis gesture. A
    // side handle that quietly changed the other axis would make a wide key
    // impossible to keep.
    expect(sized('e', 2, 5)).toMatchObject({ y: 0, h: 1 });
    expect(sized('n', 5, -2)).toMatchObject({ x: 0, w: 1, y: -2, h: 3 });
  });

  it('moves both axes from a corner', () => {
    expect(sized('se', 1, 1)).toMatchObject({ x: 0, y: 0, w: 2, h: 2 });
  });

  it('never shrinks a key below a quarter of a key', () => {
    // A width of zero is an invisible key, and a negative one is an SVG error
    // rather than a small key.
    expect(sized('se', -10, -10)).toMatchObject({ x: 0, y: 0, w: GRID, h: GRID });
  });

  it('collapses a near edge against the far one, never past it', () => {
    // Dragging the left edge rightwards past the right edge would invert the
    // key: the position would end up beyond its own far side.
    expect(sized('w', 10, 0)).toMatchObject({ x: 1 - GRID, w: GRID });
  });

  it('stops a far edge at the work surface', () => {
    // Resizing was the one way left to put a key off the screen: `resizeKeys`
    // has no bound, so a key grown at the edge came back marked "off screen"
    // by a gesture that had done nothing wrong.
    const key = sized('e', 1000, 0);

    expect(key.x + key.w).toBe(SURFACE.x + SURFACE.w);
  });

  it('stops a near edge at the work surface', () => {
    expect(sized('w', -1000, 0)).toMatchObject({ x: SURFACE.x, w: 1 - SURFACE.x });
  });

  it('leaves the key on the grid against an edge that is not on it', () => {
    // 1002 px at the default unit puts the far edge at 6.958333333333333, and
    // a key grown into it would take the dust with it — the defect of task 36,
    // by a new route.
    const key = sized('se', 1000, 1000, ODD);

    expect([key.x, key.y, key.w, key.h].every(onGrid)).toBe(true);
    expect(key.x + key.w).toBeLessThanOrEqual(ODD.x + ODD.w);
    expect(key.y + key.h).toBeLessThanOrEqual(ODD.y + ODD.h);
  });

  it('ignores an unknown id', () => {
    const before = config();

    expect(resizeKeyTo(before, 99, 'e', ORIGIN, 2, 0, SURFACE)).toEqual(before);
  });
});
