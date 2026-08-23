/**
 * Three missed refreshes: the capture answers every beat this page sends,
 * every two seconds, throttled to one answer a second — so any frame older
 * than this means the capture itself is gone, not merely quiet. The same
 * allowance the capture extends to an overlay (`capture/overlays.ts`).
 */
export const FRAME_TIMEOUT_MS = 6000;

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
