import { describe, it, expect } from 'vitest';
import { miniRing } from './mini-ring';

// The mini key of Colors: 56 px, radius 5, a border of 1 (board Editor-GlobalStyle).
const key = (fill: { x: number; y: number; w: number; h: number }, width = 1) => ({
  size: 56,
  radius: 5,
  border: { width },
  fill,
});
const HALF_UP = { x: 0, y: 30.8, w: 56, h: 25.2 };

describe('the ring on the mini key (board Editor-GlobalStyle)', () => {
  it('rings Press depth inside the border, clipped by the corners of the key', () => {
    // The board's fill sits inside the 1 px border, square-cornered, and the
    // key's rounding trims its bottom corners — never a radius of its own
    // standing in the middle of the key.
    const ring = miniRing('depth', key(HALF_UP))!;
    expect(ring.clip).toEqual({ inset: 1, radius: 4 });
    // Cut to the inside: the bottom pixel is the border's.
    expect(ring.box.x).toBe(0);
    expect(ring.box.y).toBeCloseTo(29.8);
    expect(ring.box.w).toBe(54);
    expect(ring.box.h).toBeCloseTo(24.2);
  });

  it('follows the fill whichever way it grows', () => {
    const right = { x: 0, y: 0, w: 20, h: 56 };
    expect(miniRing('depth', key(right))?.box).toEqual({ x: 0, y: 0, w: 19, h: 54 });
  });

  it('rings only the face left visible for Background: above a fill that rises', () => {
    const ring = miniRing('face', key(HALF_UP))!;
    expect(ring.clip).toEqual({ inset: 1, radius: 4 });
    expect(ring.box.x).toBe(0);
    expect(ring.box.y).toBe(0);
    expect(ring.box.w).toBe(54);
    expect(ring.box.h).toBeCloseTo(29.8);
  });

  it('finds the visible face on whichever side the fill leaves it', () => {
    // Down: the fill hangs from the top, the face shows below it.
    const down = miniRing('face', key({ x: 0, y: 0, w: 56, h: 20 }))!.box;
    expect(down).toEqual({ x: 0, y: 19, w: 54, h: 35 });
    // Right: the fill grows from the left, the face shows on the right.
    const right = miniRing('face', key({ x: 0, y: 0, w: 20, h: 56 }))!.box;
    expect(right).toEqual({ x: 19, y: 0, w: 35, h: 54 });
    // Left: the fill grows from the right, the face shows on the left.
    const left = miniRing('face', key({ x: 36, y: 0, w: 20, h: 56 }))!.box;
    expect(left).toEqual({ x: 0, y: 0, w: 35, h: 54 });
  });

  it('rounds the ring at the corners it shares with the key, and only there', () => {
    // Order: top left, top right, bottom right, bottom left — CSS's.
    expect(miniRing('face', key(HALF_UP))!.radii).toEqual([4, 4, 0, 0]);
    expect(miniRing('depth', key(HALF_UP))!.radii).toEqual([0, 0, 4, 4]);
    expect(miniRing('depth', key({ x: 0, y: 0, w: 20, h: 56 }))!.radii).toEqual([4, 0, 0, 4]);
    expect(miniRing('face', key({ x: 0, y: 56, w: 56, h: 0 }))!.radii).toEqual([4, 4, 4, 4]);
  });

  it('rings the whole face when nothing is filled', () => {
    const none = miniRing('face', key({ x: 0, y: 56, w: 56, h: 0 }))!.box;
    expect(none).toEqual({ x: 0, y: 0, w: 54, h: 54 });
  });

  it('keeps the corners square under a border thicker than the radius', () => {
    expect(miniRing('face', key(HALF_UP, 8))?.clip).toEqual({ inset: 8, radius: 0 });
  });

  it('leaves the border to be ringed on the key itself', () => {
    expect(miniRing('border', key(HALF_UP))).toBeNull();
  });
});
