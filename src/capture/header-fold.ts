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
