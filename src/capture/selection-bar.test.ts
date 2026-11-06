// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { selectionBarPlacement, selectionBarShown } from './selection-bar';

const STAGE = { width: 800, height: 600 };
const BAR = { width: 150, height: 34 };

describe('selectionBarPlacement', () => {
  it('centres the bar over the selection, 8 px above it', () => {
    const at = selectionBarPlacement({ x: 100, y: 100, w: 72, h: 72 }, BAR, STAGE);

    expect(at).toEqual({ left: 136 - 75, top: 100 - 8 - 34, below: false });
  });

  it('centres over the whole box of a multiple selection', () => {
    const at = selectionBarPlacement({ x: 60, y: 130, w: 234, h: 72 }, BAR, STAGE);

    expect(at.left).toBe(60 + 117 - 75);
  });

  it('goes 8 px under the selection when the top of the stage would cut it', () => {
    const at = selectionBarPlacement({ x: 100, y: 20, w: 72, h: 72 }, BAR, STAGE);

    expect(at).toEqual({ left: 61, top: 20 + 72 + 8, below: true });
  });

  it('stays above when it fits exactly', () => {
    const at = selectionBarPlacement({ x: 100, y: 42, w: 72, h: 72 }, BAR, STAGE);

    expect(at.top).toBe(0);
    expect(at.below).toBe(false);
  });

  it('slides right to stay inside the left edge', () => {
    expect(selectionBarPlacement({ x: 0, y: 100, w: 40, h: 40 }, BAR, STAGE).left).toBe(0);
  });

  it('slides left to stay inside the right edge', () => {
    const at = selectionBarPlacement({ x: 780, y: 100, w: 20, h: 40 }, BAR, STAGE);

    expect(at.left).toBe(800 - 150);
  });

  it('keeps to the left edge on a stage narrower than itself', () => {
    const at = selectionBarPlacement({ x: 40, y: 100, w: 20, h: 40 }, BAR, {
      width: 100,
      height: 600,
    });

    expect(at.left).toBe(0);
  });
});

describe('selectionBarShown', () => {
  const quiet = { selected: 1, gesturing: false, lasso: false, popover: false, learning: false };

  it('shows over a selection when nothing else is going on', () => {
    expect(selectionBarShown(quiet)).toBe(true);
  });

  it('hides without a selection', () => {
    expect(selectionBarShown({ ...quiet, selected: 0 })).toBe(false);
  });

  it('hides during a drag, a resize or a lasso', () => {
    expect(selectionBarShown({ ...quiet, gesturing: true })).toBe(false);
    expect(selectionBarShown({ ...quiet, lasso: true })).toBe(false);
  });

  it('hides while the popover is open, which already offers both', () => {
    expect(selectionBarShown({ ...quiet, popover: true })).toBe(false);
  });

  it('hides while the capture listens', () => {
    expect(selectionBarShown({ ...quiet, learning: true })).toBe(false);
  });
});
