/**
 * Where a menu drawn in the top layer hangs from what opened it, in viewport
 * pixels (the installed-fonts menu, spec §16.13).
 *
 * In the top layer it is clipped by nothing — the side panel's scrolling
 * section once cut it off under Keys — so it is the window it has to fit:
 * under its anchor, its right edge on the anchor's; above when there is more
 * room there and not enough below; slid sideways to stay on screen; never
 * taller than the room on its side, the list inside scrolling instead.
 */
import { UI_TOKENS } from '../styles/ui-tokens';
import type { PixelBox, Size } from './selection-bar';

export interface MenuPlacement {
  left: number;
  top: number;
  /** The room on the chosen side: the menu is capped to it. */
  maxHeight: number;
  above: boolean;
}

/** From the anchor: the dropdowns' own offset (6 px), read from the token so the two never part. */
const GAP = Number.parseFloat(UI_TOKENS.dropdownOffset);
/** From every edge of the window. */
const MARGIN = 8;

export function menuPlacement(anchor: PixelBox, menu: Size, view: Size): MenuPlacement {
  const left = Math.max(
    MARGIN,
    Math.min(anchor.x + anchor.w - menu.width, view.width - MARGIN - menu.width),
  );
  const below = view.height - MARGIN - (anchor.y + anchor.h + GAP);
  const aboveRoom = anchor.y - GAP - MARGIN;
  const above = menu.height > below && aboveRoom > below;

  if (above) {
    const height = Math.min(menu.height, aboveRoom);
    return { left, top: anchor.y - GAP - height, maxHeight: aboveRoom, above: true };
  }
  return { left, top: anchor.y + anchor.h + GAP, maxHeight: Math.max(0, below), above: false };
}
