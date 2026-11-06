import { describe, it, expect } from 'vitest';
import { popoverPlacement, type PopoverPlacement } from './popover-placement';
import type { PixelBox, Size } from './selection-bar';

const STAGE: Size = { width: 1200, height: 700 };
const PANEL_WIDTH = 380;
const GAP = 8;

const place = (box: PixelBox, height: number, locked: PopoverPlacement['side'] | null = null) =>
  popoverPlacement(box, { width: PANEL_WIDTH, height }, STAGE, GAP, locked);

/** Whether the panel, at the height it is drawn, covers any of the box. */
function covers(box: PixelBox, at: PopoverPlacement, height: number): boolean {
  const drawn = at.maxHeight === null ? height : Math.min(height, at.maxHeight);
  return (
    at.left < box.x + box.w &&
    at.left + PANEL_WIDTH > box.x &&
    at.top < box.y + box.h &&
    at.top + drawn > box.y
  );
}

describe('where the key popover goes (spec §16.5)', () => {
  it('opens under the selection when it fits there', () => {
    const box = { x: 100, y: 100, w: 56, h: 56 };
    expect(place(box, 300)).toMatchObject({ side: 'below', left: 100, top: 164 });
  });

  it('opens above when it does not fit under, its bottom edge on the key', () => {
    const box = { x: 100, y: 500, w: 56, h: 56 };
    expect(place(box, 300)).toMatchObject({ side: 'above', top: 500 - GAP - 300 });
  });

  it('opens beside the selection when it fits neither under nor above', () => {
    const box = { x: 100, y: 300, w: 56, h: 56 };
    const at = place(box, 500);
    expect(at).toMatchObject({ side: 'right', left: 100 + 56 + GAP });
    expect(covers(box, at, 500)).toBe(false);
  });

  it('takes the left side when the right one has no room', () => {
    const box = { x: 1000, y: 300, w: 56, h: 56 };
    expect(place(box, 500)).toMatchObject({ side: 'left', left: 1000 - GAP - PANEL_WIDTH });
  });

  it('keeps a panel beside the selection inside the stage', () => {
    const box = { x: 100, y: 600, w: 56, h: 56 };
    expect(place(box, 650).top).toBe(STAGE.height - 650);
  });

  it('keeps the side it opened on while its height changes', () => {
    // Text to Icon, or the Style fold opening: the panel grows. It does not
    // jump to the other side of the key, and it never comes over the key.
    const below = { x: 100, y: 300, w: 56, h: 56 };
    const grown = place(below, 500, 'below');
    expect(grown).toMatchObject({ side: 'below', top: 300 + 56 + GAP });
    expect(grown.maxHeight).toBe(STAGE.height - (300 + 56 + GAP));
    expect(covers(below, grown, 500)).toBe(false);

    const above = { x: 100, y: 400, w: 56, h: 56 };
    const short = place(above, 200, 'above');
    const tall = place(above, 450, 'above');
    expect(short.top + 200).toBe(above.y - GAP);
    expect(tall.top).toBe(0);
    expect(tall.maxHeight).toBe(above.y - GAP);
    expect(covers(above, tall, 450)).toBe(false);
  });

  it('caps nothing while the panel fits', () => {
    expect(place({ x: 100, y: 100, w: 56, h: 56 }, 300).maxHeight).toBeNull();
  });

  it('never covers the selection, wherever it is and however tall the panel', () => {
    for (let x = 0; x <= 1140; x += 60) {
      for (let y = 0; y <= 640; y += 40) {
        for (const height of [150, 350, 520, 680, 900]) {
          const box = { x, y, w: 60, h: 60 };
          const at = place(box, height);
          expect(covers(box, at, height), `${x},${y} at ${height}`).toBe(false);
          for (const side of ['below', 'above', 'right', 'left'] as const) {
            const locked = place(box, height, side);
            expect(covers(box, locked, height), `${side} ${x},${y} at ${height}`).toBe(false);
          }
        }
      }
    }
  });

  it('stays under the key while the panel has not been measured', () => {
    const box = { x: 100, y: 600, w: 56, h: 56 };
    expect(place(box, 0)).toMatchObject({ side: 'below', top: 664, measured: false });
  });
});
