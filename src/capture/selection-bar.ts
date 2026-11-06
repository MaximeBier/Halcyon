/**
 * Where the Edit · Delete bar sits over a selection, and when it shows
 * (spec §16.14). Pure, so the three rules can be read and tested apart from
 * the stage that applies them: centred over the selection's box, 8 px above;
 * under it when the top of the stage would cut it; slid along to stay inside
 * the stage on either side.
 *
 * Everything is in the stage's own pixels, the frame the key handles and the
 * popover anchor are already placed in.
 */

export interface PixelBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface BarPlacement {
  left: number;
  top: number;
  /** Flipped under the selection, the top of the stage being too close. */
  below: boolean;
}

/** The gap between the selection and the bar, and the popover's own. */
export const BAR_GAP = 8;

export function selectionBarPlacement(
  box: PixelBox,
  bar: Size,
  stage: Size,
  gap: number = BAR_GAP,
): BarPlacement {
  const centred = box.x + box.w / 2 - bar.width / 2;
  // `max` last: on a stage narrower than the bar, its left edge wins over the
  // right one — the start of "Edit" is what someone reads first.
  const left = Math.max(0, Math.min(centred, stage.width - bar.width));

  const above = box.y - gap - bar.height;
  if (above >= 0) return { left, top: above, below: false };
  return { left, top: box.y + box.h + gap, below: true };
}

export interface BarState {
  selected: number;
  /** A drag or a resize under way: the bar would ride along, under the hand. */
  gesturing: boolean;
  lasso: boolean;
  /** The popover offers Edit's whole content and its own Delete already. */
  popover: boolean;
  /** Capturing: every key pressed is a key added, not a key acted on. */
  learning: boolean;
}

export function selectionBarShown(state: BarState): boolean {
  return (
    state.selected > 0 && !state.gesturing && !state.lasso && !state.popover && !state.learning
  );
}
