import { describe, it, expect } from 'vitest';
import { menuPlacement } from './menu-placement';

// The board's 6 px (note on the installed-fonts menu), which is the dropdowns' token.
const GAP = 6;

const VIEW = { width: 1280, height: 800 };
const MENU = { width: 280, height: 400 };

describe('where a menu hangs from what opened it (top layer, spec §16.13)', () => {
  it('hangs under its anchor, its right edge on the anchor’s', () => {
    const anchor = { x: 900, y: 100, w: 170, h: 120 };
    expect(menuPlacement(anchor, MENU, VIEW)).toEqual({
      left: 900 + 170 - 280,
      top: 100 + 120 + GAP,
      maxHeight: 800 - 8 - (100 + 120 + GAP),
      above: false,
    });
  });

  it('opens upward when the room is above, never past the top of the window', () => {
    // A key low on the stage: 120 px left below, 600 above.
    const anchor = { x: 600, y: 650, w: 120, h: 26 };
    const at = menuPlacement(anchor, MENU, VIEW);
    expect(at.above).toBe(true);
    expect(at.top).toBe(650 - GAP - 400);
    expect(at.top).toBeGreaterThanOrEqual(8);
    expect(at.maxHeight).toBe(650 - GAP - 8);
  });

  it('caps its height to the room it has, so the list scrolls inside it', () => {
    // The panel's Label group low in the window: less room than the menu needs either way.
    const anchor = { x: 900, y: 380, w: 170, h: 120 };
    const at = menuPlacement(anchor, { width: 280, height: 700 }, VIEW);
    const room = at.above ? 380 - GAP - 8 : 800 - 8 - (380 + 120 + GAP);
    expect(at.maxHeight).toBe(room);
    expect(at.above ? at.top : at.top + at.maxHeight).toBeGreaterThanOrEqual(8);
    expect(at.top + Math.min(700, at.maxHeight)).toBeLessThanOrEqual(800 - 8);
  });

  it('stays on screen sideways', () => {
    const leftEdge = menuPlacement({ x: 10, y: 100, w: 100, h: 26 }, MENU, VIEW);
    expect(leftEdge.left).toBe(8);
    const rightEdge = menuPlacement({ x: 1250, y: 100, w: 60, h: 26 }, MENU, VIEW);
    expect(rightEdge.left).toBe(1280 - 8 - 280);
  });

  it('prefers below when both sides hold it', () => {
    const at = menuPlacement({ x: 600, y: 300, w: 120, h: 26 }, { width: 280, height: 200 }, VIEW);
    expect(at.above).toBe(false);
  });
});
