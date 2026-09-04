/**
 * How often the overlay announces itself to OBS, and the window `App.svelte`
 * re-reads its rate over. Lives here rather than in `App.svelte` — where it
 * used to sit alone — because `FRAME_TIMEOUT_MS` below is defined in terms of
 * it: the two must change together, and a constant that only one file can see
 * cannot be depended on by the other.
 */
export const BEAT_MS = 2000;

/**
 * Three missed refreshes: the capture answers every beat this page sends,
 * throttled to one answer a second — so any frame older than this means the
 * capture itself is gone, not merely quiet. The same allowance the capture
 * extends to an overlay (`capture/overlays.ts`). Derived from `BEAT_MS`
 * rather than a restated `6000`, so the "three" stays true if the beat
 * interval ever changes instead of silently becoming a different number of
 * missed beats.
 */
export const FRAME_TIMEOUT_MS = 3 * BEAT_MS;

export interface FrameWatch {
  /** A frame arrived. */
  seen(now: number): void;
  /** Whether the last frame is too old to be trusted as the present. */
  stale(now: number): boolean;
}

/**
 * Whether the frame on screen still describes the present.
 *
 * A frame is not a fact about the keyboard — it is the last thing a capture
 * said, and the capture may since have crashed, lost its tab, or been closed
 * with a key half-pressed. Nothing follows that frame, ever, and OBS keeps
 * rendering it: spec §6.2's frozen key, with nobody left to release it. The
 * capture cannot fix this from its side once it is dead; only the overlay can
 * notice the silence and fall back to rest.
 */
export function createFrameWatch(timeoutMs: number = FRAME_TIMEOUT_MS): FrameWatch {
  // Stale from birth, deliberately: before the first frame there is nothing
  // on screen worth protecting, and "fresh" would be a claim about a capture
  // this page has never heard from.
  let lastAt = Number.NEGATIVE_INFINITY;

  return {
    seen(now) {
      lastAt = now;
    },
    stale(now) {
      return now - lastAt > timeoutMs;
    },
  };
}
