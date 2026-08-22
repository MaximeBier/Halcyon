/** Three missed beats: the overlay beats every 2 s. */
export const OVERLAY_TIMEOUT_MS = 6000;

/** How many overlays are listening, and from where. */
export interface OverlayCounts {
  inObs: number;
  inBrowser: number;
}

export interface OverlayRegistry {
  /**
   * `browser` is the overlay saying where it is (spec §16.7), not a guess made
   * here: only the page itself can tell, and it decides once before its first
   * paint.
   */
  seen(id: string, now: number, browser: boolean): void;
  /**
   * Drops an overlay that announced it was leaving, rather than waiting out
   * its timeout. A reload draws a new id, so an overlay that leaves silently
   * is still counted alongside the page that replaced it — and ten reloads in
   * a row, which is what setting an overlay up looks like, read as eleven
   * listeners.
   */
  forget(id: string): void;
  /**
   * Drops everyone. Sent when the connection to OBS goes away: nobody is
   * reachable through a dead socket, and since expiry is only computed on read,
   * a count left standing there would never come down on its own.
   */
  clear(): void;
  /**
   * Live overlays, split by host and computed lazily on read.
   *
   * Split because one figure stopped answering the question the moment anyone
   * used the tool: opening `overlay.html` to check it works takes the count
   * from one to two, and the total can no longer say whether the one in OBS is
   * among them. **A diagnostic that its own use invalidates is not one.**
   */
  counts(now: number): OverlayCounts;
}

/**
 * Who is listening, worked out from the heartbeats.
 *
 * BroadcastCustomEvent never says whether anyone is on the other end: a capture
 * page talking to nobody looks exactly like one feeding four scenes. This is
 * the only thing that tells them apart (spec §11).
 */
export function createOverlayRegistry(timeoutMs: number = OVERLAY_TIMEOUT_MS): OverlayRegistry {
  const lastSeen = new Map<string, { at: number; browser: boolean }>();

  return {
    seen(id, now, browser) {
      // Keyed by id, so a page that somehow reported a different host replaces
      // its own entry rather than adding a second listener.
      lastSeen.set(id, { at: now, browser });
    },
    forget(id) {
      lastSeen.delete(id);
    },
    clear() {
      lastSeen.clear();
    },
    counts(now) {
      const live = { inObs: 0, inBrowser: 0 };
      for (const [id, entry] of lastSeen) {
        if (now - entry.at > timeoutMs) lastSeen.delete(id);
        else if (entry.browser) live.inBrowser++;
        else live.inObs++;
      }
      return live;
    },
  };
}
