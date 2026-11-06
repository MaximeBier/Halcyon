/**
 * Where the key popover sits around the selection it edits (spec §16.5). Pure,
 * like `selectionBarPlacement`, and in the same stage pixels.
 *
 * Two promises, and every rule below serves one of them:
 *
 * - **The panel never covers the keys it edits.** Under the selection, else
 *   above it, else beside it — never pinned over it because it fitted nowhere.
 * - **It does not jump while it is open.** Its height changes under the hand
 *   (Text to Icon, the Style fold), so the side it opened on is kept for as
 *   long as it stays open: under, it grows downwards; above, its bottom edge
 *   stays on the key and it grows upwards. Past the room on that side it
 *   scrolls inside, rather than leaping to the other side of the key.
 */
import type { PixelBox, Size } from './selection-bar';

export type PopoverSide = 'below' | 'above' | 'right' | 'left';

export interface PopoverPlacement {
  left: number;
  top: number;
  side: PopoverSide;
  /** The height it may take on that side, or `null` while it fits whole. */
  maxHeight: number | null;
  /** False until the panel has a height: nothing can be decided before. */
  measured: boolean;
}

export function popoverPlacement(
  box: PixelBox,
  panel: Size,
  stage: Size,
  gap: number,
  locked: PopoverSide | null = null,
): PopoverPlacement {
  const under = box.y + box.h + gap;
  const room: Record<PopoverSide, number> = {
    below: stage.height - under,
    above: box.y - gap,
    right: stage.width - (box.x + box.w + gap),
    left: box.x - gap,
  };
  // Under or above, the panel slides along to stay on the stage: sliding
  // sideways costs nothing, the rows of keys are above and below.
  const slid = Math.min(box.x, Math.max(0, stage.width - panel.width - gap));

  if (panel.height === 0 || stage.height === 0) {
    return { left: slid, top: under, side: 'below', maxHeight: null, measured: false };
  }

  const beside = (side: 'right' | 'left') => room[side] >= panel.width;
  const usable = (side: PopoverSide) =>
    side === 'right' || side === 'left' ? beside(side) : room[side] > 0;

  const side = locked !== null && usable(locked) ? locked : choose(room, panel, stage, beside);

  if (side === 'below' || side === 'above') {
    const capped = panel.height > room[side];
    const drawn = capped ? room[side] : panel.height;
    return {
      left: slid,
      top: side === 'below' ? under : box.y - gap - drawn,
      side,
      maxHeight: capped ? room[side] : null,
      measured: true,
    };
  }

  const capped = panel.height > stage.height;
  return {
    left: side === 'right' ? box.x + box.w + gap : box.x - gap - panel.width,
    // Level with the selection, slid up as far as the stage requires.
    top: Math.max(0, Math.min(box.y, stage.height - panel.height)),
    side,
    maxHeight: capped ? stage.height : null,
    measured: true,
  };
}

/**
 * The side a panel opens on: the first where it fits whole, in the order a
 * reader expects — under, above, then beside. Where it fits nowhere whole,
 * beside with the stage's full height if it fits sideways, or else the roomier
 * of under and above, scrolling inside.
 */
function choose(
  room: Record<PopoverSide, number>,
  panel: Size,
  stage: Size,
  beside: (side: 'right' | 'left') => boolean,
): PopoverSide {
  if (panel.height <= room.below) return 'below';
  if (panel.height <= room.above) return 'above';
  const sideways = (['right', 'left'] as const).filter(beside);
  const whole = sideways.find(() => panel.height <= stage.height);
  if (whole) return whole;
  if (sideways[0]) return sideways[0];
  return room.below >= room.above ? 'below' : 'above';
}
