/**
 * How far the header folds to stay on one line (board Editor-HeaderNarrow,
 * spec §16.9). Seven steps, each given up only when the one before still
 * overflows:
 *
 * 1. everything shown;
 * 2. the word HALCYON goes, the mark stays;
 * 3. Link OBS scenes and Start with Windows keep only their icon;
 * 4. "Resume setup · N/3" becomes "Setup · N/3";
 * 5. the keyboard's name and the OBS pill's give way together, little by
 *    little, "…", 40 px of each kept — the OBS pill waiting for a step of its
 *    own went from whole to cut at once;
 * 6. Resume setup keeps only its icon;
 * 7. as a last resort, the keyboard and OBS pills keep only their dot, the
 *    name on hover — an alert ("Other capture pages open") keeps its words:
 *    it is the one message that has to be read.
 *
 * Decided by measuring, never by a width written down: the error pills
 * ("OBS disconnected", "Other capture pages open") and Resume setup widen the
 * left block, and fold the header sooner — which a threshold could not know.
 */
export type Fold = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export const LAST_FOLD: Fold = 7;

/**
 * Starts from everything, every time, so a window that widens gets back what
 * a narrower one took. `apply` renders a fold and resolves once the DOM shows
 * it (Svelte's `tick`); `overflows` reads the header as it now stands.
 *
 * Run from a ResizeObserver, the whole climb happens before the next paint —
 * a `tick` is a microtask — so the steps are never seen going by. No timer:
 * spec §2 keeps them off this page.
 */
export async function fitHeader(
  apply: (fold: Fold) => Promise<void>,
  overflows: () => boolean,
): Promise<Fold> {
  let fold: Fold = 1;
  await apply(fold);
  while (fold < LAST_FOLD && overflows()) {
    fold = (fold + 1) as Fold;
    await apply(fold);
  }
  return fold;
}

/**
 * An element as the fold reads it. Only what sits on the header's line
 * counts: a popover hanging from a pill (the OBS popover, absolute, wider
 * than the run of pills it hangs from) is not part of the line, and `scrollWidth`
 * — which counts it — folded the whole header to its dots the moment the
 * pills changed under an open popover (a wrong OBS password).
 */
export interface Laid {
  /** Its right edge, in viewport pixels. */
  right: number;
  /** Where its own content has to stop: the right edge, less end border and padding. */
  end: number;
  /** Absolute or fixed: a popover, a tooltip, a screen-reader line — off the line. */
  floating: boolean;
  /** Cuts what overflows it (a name cut with "…"): its own box is all that shows. */
  clips: boolean;
  children: Laid[];
}

/** How far right the content on the line reaches, inside `box`. */
function reach(box: Laid): number {
  let far = -Infinity;
  for (const child of box.children) {
    if (child.floating) continue;
    far = Math.max(far, child.right, child.clips ? -Infinity : reach(child));
  }
  return far;
}

/**
 * Whether what `box` holds on the line runs past it. A pixel of slack: the
 * boxes are fractional, and a run that fits exactly must not read as spilling.
 */
export function spills(box: Laid): boolean {
  return reach(box) > box.end + 1;
}

/** Reads an element and what it holds, as `spills` needs them. */
export function laidOut(el: Element): Laid {
  const style = getComputedStyle(el);
  const right = el.getBoundingClientRect().right;
  const floating = style.position === 'absolute' || style.position === 'fixed';
  const clips = style.overflowX !== '' && style.overflowX !== 'visible';
  const inset = (parseFloat(style.paddingRight) || 0) + (parseFloat(style.borderRightWidth) || 0);
  return {
    right,
    end: right - inset,
    floating,
    clips,
    children: floating || clips ? [] : [...el.children].map(laidOut),
  };
}

/**
 * The header's overflow, from its own items alone: the bar, its left block,
 * and each item of that block (the run of pills, squeezed, spilled under
 * Resume inside a left block that itself did not overflow).
 */
export function headerSpills(bar: Element, lead: Element): boolean {
  return [bar, lead, ...lead.children].some((el) => spills(laidOut(el)));
}
