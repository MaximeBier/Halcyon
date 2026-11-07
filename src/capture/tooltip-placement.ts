/**
 * Where a tooltip sits around the element it explains (board Editor-Tooltip),
 * in viewport pixels — the tooltip lives in the top layer, positioned fixed.
 *
 * Above by default, 8 px away; under when the top of the window would cut it
 * (the header). Centred on the element — unless the element ends near the
 * window's right edge, closer than the tooltip is wide: then the tooltip's
 * right edge sits on the element's, the arrow 14 px in ("Add key", the gear, a
 * disabled row of the panel, over its field). A row anywhere else — a menu
 * opened under a tab on the left — keeps its tooltip centred. Never off screen
 * either way.
 */
import type { PixelBox, Size } from './selection-bar';

export interface TooltipPlacement {
  left: number;
  top: number;
  below: boolean;
  /** The arrow's centre, from the tooltip's left edge. */
  arrow: number;
}

export interface TooltipOptions {
  gap?: number;
}

export const TOOLTIP_GAP = 8;
/** The arrow is 8 px wide: it never comes closer than this to a corner. */
const ARROW_INSET = 10;
/** Right-aligned, the arrow's centre from the right edge (board: `right: 10px` on an 8 px arrow). */
const ARROW_END = 14;

export function tooltipPlacement(
  host: PixelBox,
  tip: Size,
  view: Size,
  { gap = TOOLTIP_GAP }: TooltipOptions = {},
): TooltipPlacement {
  const centre = host.x + host.w / 2;
  const end = host.x + host.w;
  const centred = centre - tip.width / 2;
  const rightAligned = end > view.width - tip.width;
  const wanted = rightAligned ? end - tip.width : centred;
  const left = Math.max(0, Math.min(wanted, view.width - tip.width));
  // Right-aligned, the arrow points at the row's end — or at a small
  // element's middle, which is never further left than that.
  const target = rightAligned ? Math.max(centre, end - ARROW_END) : centre;
  const arrow = Math.max(ARROW_INSET, Math.min(target - left, tip.width - ARROW_INSET));
  const above = host.y - gap - tip.height;
  const below = above < 0;
  return { left, top: below ? host.y + host.h + gap : above, below, arrow };
}
