/**
 * Where a tooltip sits around the element it explains (board Editor-Tooltip),
 * in viewport pixels — the tooltip lives in the top layer, positioned fixed.
 *
 * Above by default, 8 px away; under when the top of the window would cut it
 * (the header). Centred on the element, slid to stay on screen — which near
 * the right edge aligns it on the right — with the arrow kept on the
 * element's centre whatever the slide.
 */
import type { PixelBox, Size } from './selection-bar';

export interface TooltipPlacement {
  left: number;
  top: number;
  below: boolean;
  /** The arrow's centre, from the tooltip's left edge. */
  arrow: number;
}

export const TOOLTIP_GAP = 8;
/** The arrow is 8 px wide: it never comes closer than this to a corner. */
const ARROW_INSET = 10;

export function tooltipPlacement(
  host: PixelBox,
  tip: Size,
  view: Size,
  gap: number = TOOLTIP_GAP,
): TooltipPlacement {
  const centre = host.x + host.w / 2;
  const left = Math.max(0, Math.min(centre - tip.width / 2, view.width - tip.width));
  const above = host.y - gap - tip.height;
  const below = above < 0;
  const arrow = Math.max(ARROW_INSET, Math.min(centre - left, tip.width - ARROW_INSET));
  return { left, top: below ? host.y + host.h + gap : above, below, arrow };
}
