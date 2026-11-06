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

  it('aligns on the right near the right edge, its arrow still on the element', () => {
    const host = { x: 1150, y: 400, w: 40, h: 28 };
    const at = tooltipPlacement(host, TIP, VIEW);
    expect(at.left + TIP.width).toBeLessThanOrEqual(VIEW.width);
    expect(at.left + at.arrow).toBe(host.x + host.w / 2);
  });

  it('never leaves the left edge either', () => {
    const at = tooltipPlacement({ x: 2, y: 400, w: 20, h: 20 }, TIP, VIEW);
    expect(at.left).toBeGreaterThanOrEqual(0);
    expect(at.left + at.arrow).toBe(12);
  });
});
