import type { AnalogEntry } from '../keyboard/decode';
import { geometryFor, placeNewKey } from '../keyboard/geometry';
import { learnedLabelFor, type LayoutMapLike } from '../keyboard/labels';
import { ontoSurface, type Rect } from './layout';
import type { KeyConfig, OverlayConfig } from '../config/schema';

/**
 * Roughly 20 % of travel: past a brush, short of actuation.
 *
 * Below the firmware's actuation point on purpose — configuring a key should
 * not type it. The smallest travel ever measured in use is 1.4 % (spec §7.3),
 * so this is nowhere near sensor noise either.
 */
export const LEARN_TRAVEL_THRESHOLD = 200;

/**
 * Adds every key a report shows pressed on purpose (spec §8.4).
 *
 * All of them, not the deepest one: capture stays armed until it is stopped,
 * so there is no single key to elect, and a chord pressed together would
 * otherwise be added one report at a time — the key that never happens to be
 * the deepest never being added at all.
 *
 * Reports arrive by the thousand while a key is held down, and every one of
 * them repeats it. `addLearnedKey` ignores a key already on the layout, so the
 * argument comes straight back out: handing the same reference back is what
 * keeps a held key from reaching `updateConfig`, which would persist,
 * broadcast and stack an undo step for each report. It is what replaces the
 * mode closing itself after one key.
 */
export function learnKeys(
  config: OverlayConfig,
  entries: readonly AnalogEntry[],
  layout: LayoutMapLike | null,
  surface: Rect,
): OverlayConfig {
  let next = config;
  for (const entry of entries) {
    if (entry.travel < LEARN_TRAVEL_THRESHOLD) continue;
    next = addLearnedKey(next, entry, layout, surface);
  }
  return next;
}

/**
 * What learning may read of a report, given whether the capture is armed.
 * Fed every report, armed or not: it has to know what is down at the moment
 * the capture is armed.
 */
export interface ArmingGate {
  pass(entries: readonly AnalogEntry[], armed: boolean): readonly AnalogEntry[];
}

/** Down at all, as far as the gate is concerned: any travel, or typing. */
function touched(entry: AnalogEntry): boolean {
  return entry.travel > 0 || entry.active;
}

/**
 * Keeps out of learning the keys already down when the capture is armed
 * (spec §8.4), until each has been let go once.
 *
 * Arming from the keyboard is the case: Tab to "Add key", Enter — the click
 * fires on the keydown, Enter still pressed, and the next report learned it.
 * Space clicks on its keyup, but the key is still on its way up, above the
 * learning depth. One gate for every way of arming (the header button, the
 * empty stage's, the wizard handing over), since it reads the stream, not
 * the button.
 *
 * Down means any travel at all, not the learning depth: with rapid trigger a
 * key can actuate long before that depth, and the report showing it active can come
 * a beat after the keydown that armed — read against the threshold, that
 * Enter slipped through on its way down. Let go means gone from the report or
 * back to zero. The cost is a finger resting on a key when arming from the
 * mouse: that key has to be lifted once.
 *
 * The keys down are those of the report before the first armed one: a
 * keyboard at rest sends nothing, so the last report is the keyboard's state
 * at the moment of arming.
 */
/** What the gate hands back unarmed, most reports: one array, never a fresh one. */
const NOTHING: readonly AnalogEntry[] = [];

export function createArmingGate(): ArmingGate {
  let previous: readonly AnalogEntry[] = [];
  let wasArmed = false;
  const held = new Set<number>();
  return {
    pass(entries, armed) {
      if (armed && !wasArmed) {
        for (const entry of previous) if (touched(entry)) held.add(entry.index);
      }
      wasArmed = armed;
      previous = entries;
      if (!armed) {
        held.clear();
        return NOTHING;
      }
      if (held.size === 0) return entries;
      for (const index of held) {
        const now = entries.find((entry) => entry.index === index);
        if (!now || !touched(now)) held.delete(index);
      }
      return entries.filter((entry) => !held.has(entry.index));
    },
  };
}

/**
 * Adds a key learned by pressing it (spec §8.4).
 *
 * Deduplicated on the matrix index rather than the usage: the index is what
 * identifies a key in the configuration, and what keys the overlay's SVG
 * nodes. Returns a new configuration — the caller hands it to `updateConfig`,
 * which persists and broadcasts it, so mutating the argument would let a
 * change reach the preview without doing either.
 */
export function addLearnedKey(
  config: OverlayConfig,
  entry: AnalogEntry,
  layout: LayoutMapLike | null,
  surface: Rect,
): OverlayConfig {
  if (config.keys.some((key) => key.id === entry.index)) return config;

  const geometry = geometryFor(entry.usage);
  const w = geometry?.w ?? 1;
  const h = geometry?.h ?? 1;
  // Keys already placed never move (spec §8.5). The new one is brought back
  // onto the surface if its reference position falls off it — which is what
  // happens as soon as the board being rebuilt is wider than the stage.
  const placed = ontoSurface(placeNewKey(config.keys, entry.usage), w, h, surface);

  const key: KeyConfig = {
    id: entry.index,
    usage: entry.usage,
    mode: 'key',
    // The glyph wins where there is one (board 6e). Learning is the one moment
    // when nobody has yet decided anything about this key's name, so it is the
    // only moment a default may be chosen without overruling somebody.
    label: learnedLabelFor(entry.usage, layout),
    x: placed.x,
    y: placed.y,
    w,
    h,
  };

  return { ...config, keys: [...config.keys, key] };
}

/** HID usage of Escape — the key that stops the capture. */
export const ESCAPE_USAGE = 0x29;

/**
 * How long after learning a key its press may still turn out to be the one
 * that stopped the capture. One second covers a slow, deliberate press from
 * the depth this module learns at down to the depth the firmware fires at.
 */
export const STOP_PRESS_GRACE_MS = 1000;

/**
 * Whether the key just learned was the Escape that stopped the capture.
 *
 * Learning fires at `LEARN_TRAVEL_THRESHOLD`, below the firmware's actuation
 * on purpose (see above) — so the *same* press of Escape is learned first, on
 * the analog stream, and only then stops the capture, through the `keydown`
 * the firmware sends at actuation. The key added by that press was never
 * asked for: the hand went to Escape to stop, not to add. The caller takes it
 * back when this answers true.
 *
 * Judged on the usage and the clock, not on the mode alone: an Escape learned
 * earlier in the session — the capture then stopped from the button — was
 * asked for, and stays.
 */
export function learnedByStopPress(
  learned: { usage: number; at: number } | null,
  now: number,
): boolean {
  return (
    learned !== null && learned.usage === ESCAPE_USAGE && now - learned.at < STOP_PRESS_GRACE_MS
  );
}
