import type { ActiveBorder, FillDirection, RestVisibility } from '../config/schema';

/**
 * The labels the two style editors offer, and the order they offer them in.
 *
 * A module of its own rather than a copy in each component, on the reasoning
 * `profile-file.ts` states for its own existence: a list of labels read by two
 * readers is one fact, and two copies of one fact drift.
 *
 * They **were** two copies until 2026-08-26, deliberately and for a reason that
 * has since gone: the popover is 284 px wide and its choices were groups of
 * buttons, so it wore `↑` where the panel wrote `↑ Up`, and `Hidden` where the
 * panel wrote `Hidden until pressed`. The day those groups became `<select>`s,
 * the constraint that justified the short forms went with them — and two lists
 * saying the same thing in two ways became two lists saying the same thing.
 */

/** An arrow ← reads better filled right to left than bottom to top. */
export const FILL_DIRECTIONS: readonly [FillDirection, string][] = [
  ['up', '↑ Up'],
  ['down', '↓ Down'],
  ['left', '← Left'],
  ['right', '→ Right'],
];

/**
 * In the order of how much each one shows, which is the order they were
 * invented in — and the only order in which the list reads as a scale rather
 * than as three unrelated looks.
 *
 * The labels say what happens on screen, not what the field is called:
 * "Hidden" alone invites the question the mode exists to answer.
 */
export const REST_STATES: readonly [RestVisibility, string][] = [
  ['filled', 'Filled'],
  ['outline', 'Outline only'],
  ['hidden', 'Hidden until pressed'],
];

/**
 * Named for what the border does, not for what the field is called: "Takes the
 * active colour" answers "what happens when I press it", which is the question
 * somebody arriving at that row is asking.
 */
export const BORDER_STATES: readonly [ActiveBorder, string][] = [
  ['fixed', 'Always the same'],
  ['active', 'Takes the active colour'],
];
