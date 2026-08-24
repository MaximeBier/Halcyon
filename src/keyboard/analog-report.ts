/**
 * Shape of the Wooting analog report (spec §3.1, §3.2).
 *
 * Constants only, and no code at all — which is the point. `scene.ts` needs
 * `MAX_TRAVEL` to turn a travel into a ratio, and importing it from `decode.ts`
 * pulled the whole decoder into the chunk shared by both entry points: the
 * overlay was carrying a HID decoder it can never call. Bundlers split by
 * module, so a constant kept next to code travels with that code.
 */

/** Usage page of the Wooting Two HE ARM analog interfaces (spec §3.2). */
export const ANALOG_USAGE_PAGE = 0xff53;
/** Exact size of an analog report. Used as a sanity check. */
export const ANALOG_REPORT_BYTES = 64;
export const ENTRY_BYTES = 4;
/** 64 / 4: a full report carries no end sentinel. */
export const MAX_ENTRIES = ANALOG_REPORT_BYTES / ENTRY_BYTES;
/** Maximum travel, bounded by construction: a uint16 shifted right by 6 bits. */
export const MAX_TRAVEL = 1023;
/**
 * Travel at or below which a key is resting, whatever the number says.
 *
 * A key sitting on the bottom of its travel flickers 1↔0. The sensors
 * themselves are silent — spec §7.3 measured sixty seconds without contact and
 * not one report — so this is a switch at rest under its own weight, not noise
 * to filter: the value is real, and it means *released*.
 *
 * Two levels out of 1023, well under the 1.4 % that §7.3 measured as the
 * smallest travel ever produced by a finger. It cannot eat a real press.
 *
 * **Here rather than in `protocol/emit.ts`**, which owned it until 2026-08-24
 * and still holds the emission policy built on it. Two modules need the same
 * answer to "is this key resting" — the emitter, deciding whether a release is
 * worth breaking the frame cap for, and the scene, deciding whether to draw a
 * key at all — and the day they disagree is the day the overlay draws a key
 * the emitter is sending as released. It moved *here* and not the other way
 * because this module is constants with no code, deliberately: importing the
 * floor from the emitter would pull the emitter, the rate counter and the
 * decoder into the overlay's chunk, which is the very mistake the note at the
 * top of this file records.
 */
export const REST_TRAVEL_FLOOR = 2;
/** Bits 1..5: entry type tags. A primary entry has all of them clear. */
export const LOW_BITS_MASK = 0x3e;
/** Only bits 3 and 4 have ever been observed set. Anything else is unexpected. */
export const KNOWN_LOW_BITS = 0x18;
