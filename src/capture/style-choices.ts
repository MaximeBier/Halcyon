import type {
  ActiveBorder,
  FillDirection,
  LabelOutline,
  LabelSize,
  RestVisibility,
} from '../config/schema';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp } from './icons';

/**
 * The labels the two style editors offer, and the order they offer them in.
 *
 * A module of its own rather than a copy in each component, on the reasoning
 * `profile-file.ts` states for its own existence: a list of labels read by two
 * readers is one fact, and two copies of one fact drift.
 *
 * They **were** two copies until 2026-08-26, deliberately and for a reason that
 * has since gone: the popover is 284 px wide and its choices were groups of
 * buttons, so it wore an arrow where the panel wrote "Up", and `Hidden` where the
 * panel wrote `Hidden until pressed`. The day those groups became `<select>`s,
 * the constraint that justified the short forms went with them — and two lists
 * saying the same thing in two ways became two lists saying the same thing.
 */

/**
 * The arrow alone, for the segmented control of board 3a — four icons in a
 * row, where a word each would not fit and the arrow says it all. Lucide's
 * arrows (spec §16.13), not characters: a character is drawn by whatever face
 * the system falls back to, and four of them never lined up.
 */
export const FILL_ICONS: Readonly<Record<FillDirection, typeof ArrowUp>> = {
  up: ArrowUp,
  down: ArrowDown,
  left: ArrowLeft,
  right: ArrowRight,
};

/** The word each arrow stands for, for whoever hears the button or hovers it. */
export const FILL_DIRECTIONS: readonly [FillDirection, string][] = [
  ['up', 'Up'],
  ['down', 'Down'],
  ['left', 'Left'],
  ['right', 'Right'],
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
 * Named for what the border does, not for what the field is called:
 * "Triggered color" under a row called "Pressed border" answers "what happens
 * when I press it", which is the question somebody arriving at that row is
 * asking. One name per setting since 2026-11-06 (spec §16.15): the colour it
 * takes is the one the panel calls Triggered.
 */
export const BORDER_STATES: readonly [ActiveBorder, string][] = [
  ['fixed', 'Unchanged'],
  ['active', 'Triggered color'],
];

/**
 * A letter on the button and the word for whoever hears it: three words would
 * not fit beside "Text size" in a 380 px panel, and S / M / L needs no reading.
 */
export const LABEL_SIZES: readonly [LabelSize, string, string][] = [
  ['s', 'S', 'Small'],
  ['m', 'M', 'Medium'],
  ['l', 'L', 'Large'],
];

export const LABEL_OUTLINES: readonly [LabelOutline, string][] = [
  ['none', 'None'],
  ['thin', 'Thin'],
  ['normal', 'Normal'],
  ['thick', 'Thick'],
];
