import { describe, it, expect } from 'vitest';
import { tooltipPlacement } from './tooltip-placement';

const VIEW = { width: 1200, height: 800 };
const TIP = { width: 120, height: 30 };

describe('where a tooltip goes (board Editor-Tooltip)', () => {
  it('sits above its element, centred, 8 px away', () => {
    const at = tooltipPlacement({ x: 500, y: 400, w: 40, h: 28 }, TIP, VIEW);
    expect(at).toMatchObject({ below: false, top: 400 - 8 - 30, left: 520 - 60 });
    expect(at.arrow).toBe(60);
  });

  it('goes under when there is no room above — the header', () => {
    const at = tooltipPlacement({ x: 500, y: 10, w: 28, h: 28 }, TIP, VIEW);
    expect(at).toMatchObject({ below: true, top: 10 + 28 + 8 });
  });

  it('near the right edge, puts its right edge on the element’s, the arrow 14 px in', () => {
    // "Add key", at the end of the tab row, under a sentence wider than it.
    const host = { x: 1080, y: 400, w: 100, h: 32 };
    const wide = { width: 220, height: 30 };
    const at = tooltipPlacement(host, wide, VIEW);
    expect(at.left + wide.width).toBe(host.x + host.w);
    expect(at.arrow).toBe(wide.width - 14);
  });

  it('keeps the arrow on the middle of a small element at the right edge', () => {
    // The gear: 28 px, its middle 14 px from its right edge.
    const host = { x: 1160, y: 400, w: 28, h: 28 };
    const at = tooltipPlacement(host, TIP, VIEW);
    expect(at.left + TIP.width).toBe(host.x + host.w);
    expect(at.left + at.arrow).toBe(host.x + host.w / 2);
  });

  it('aligns on the right of a whole row, over its field, wherever the row sits', () => {
    // A disabled row of the panel (Background in "Outline only"): the row is the host.
    const row = { x: 300, y: 400, w: 330, h: 26 };
    const at = tooltipPlacement(row, TIP, VIEW, { row: true });
    expect(at.left + TIP.width).toBe(row.x + row.w);
    expect(at.arrow).toBe(TIP.width - 14);
    expect(at.below).toBe(false);
  });

  it('centres on an element with room on both sides, whatever its size', () => {
    const at = tooltipPlacement({ x: 300, y: 400, w: 330, h: 26 }, TIP, VIEW);
    expect(at.left + TIP.width / 2).toBe(300 + 330 / 2);
  });

  it('never leaves the left edge either', () => {
    const at = tooltipPlacement({ x: 2, y: 400, w: 20, h: 20 }, TIP, VIEW);
    expect(at.left).toBeGreaterThanOrEqual(0);
    expect(at.left + at.arrow).toBe(12);
  });

  it('never leaves the window, even right-aligned on a row wider than it', () => {
    const at = tooltipPlacement({ x: 0, y: 400, w: 1250, h: 26 }, TIP, VIEW, { row: true });
    expect(at.left).toBeGreaterThanOrEqual(0);
    expect(at.left + TIP.width).toBeLessThanOrEqual(VIEW.width);
  });
});
