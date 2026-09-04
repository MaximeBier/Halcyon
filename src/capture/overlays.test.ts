// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { createOverlayRegistry, OVERLAY_TIMEOUT_MS } from './overlays';

describe('createOverlayRegistry', () => {
  it('counts an overlay that just reported in', () => {
    const registry = createOverlayRegistry();
    registry.seen('a', 1000, false);

    expect(registry.counts(1000).inObs).toBe(1);
  });

  it('counts two distinct overlays', () => {
    const registry = createOverlayRegistry();
    registry.seen('a', 1000, false);
    registry.seen('b', 1000, false);

    expect(registry.counts(1000).inObs).toBe(2);
  });

  it('does not count the same overlay twice', () => {
    const registry = createOverlayRegistry();
    registry.seen('a', 1000, false);
    registry.seen('a', 2000, false);

    expect(registry.counts(2000).inObs).toBe(1);
  });

  // Expiry is computed on read: no timer on the capture side, where it would
  // be throttled to one tick per minute in the background (spec §2.2).
  it('forgets an overlay that has been silent for too long', () => {
    const registry = createOverlayRegistry();
    registry.seen('a', 1000, false);

    expect(registry.counts(1000 + OVERLAY_TIMEOUT_MS + 1).inObs).toBe(0);
  });

  it('keeps the overlays that are still beating when one expires', () => {
    // Deleting while iterating is the obvious way to write this, and the one
    // place it could silently skip the entry that follows.
    const registry = createOverlayRegistry();
    registry.seen('a', 1000, false);
    registry.seen('b', 1000, false);
    registry.seen('c', 1000, false);
    registry.seen('b', 9000, false);
    registry.seen('c', 9000, false);

    expect(registry.counts(9000).inObs).toBe(2);
  });

  it('picks up an overlay that starts beating again', () => {
    const registry = createOverlayRegistry();
    registry.seen('a', 1000, false);
    registry.counts(1000 + OVERLAY_TIMEOUT_MS + 1);
    registry.seen('a', 20000, false);

    expect(registry.counts(20000).inObs).toBe(1);
  });

  it('reports none before anything has reported in', () => {
    expect(createOverlayRegistry().counts(0).inObs).toBe(0);
  });
});

describe('createOverlayRegistry — announced departures', () => {
  // Without this, reloading a browser source counts twice: the reloaded page
  // draws a fresh id while the old one sits out its six seconds. Ten reloads in
  // a row — which is what setting up an overlay looks like — read as eleven
  // listeners, and the count is at its most wrong exactly while it is watched.
  it('drops an overlay that said goodbye, without waiting for it to expire', () => {
    const registry = createOverlayRegistry();
    registry.seen('a', 1000, false);

    registry.forget('a');

    expect(registry.counts(1000).inObs).toBe(0);
  });

  it('leaves the other overlays alone', () => {
    const registry = createOverlayRegistry();
    registry.seen('a', 1000, false);
    registry.seen('b', 1000, false);

    registry.forget('a');

    expect(registry.counts(1000).inObs).toBe(1);
  });

  it('ignores a goodbye from an overlay it never saw', () => {
    const registry = createOverlayRegistry();
    registry.seen('a', 1000, false);

    expect(() => registry.forget('never-seen')).not.toThrow();
    expect(registry.counts(1000).inObs).toBe(1);
  });

  it('drops everyone at once when the connection is lost', () => {
    // Expiry is computed on read, and reads only happen on a message or a
    // keyboard report. Kill OBS with two overlays live, then stop typing, and
    // the status bar announces "2 overlays" for good — next to a dot saying the
    // connection is dead.
    const registry = createOverlayRegistry();
    registry.seen('a', 1000, false);
    registry.seen('b', 1000, false);

    registry.clear();

    expect(registry.counts(1000).inObs).toBe(0);
  });

  it('counts an overlay that comes back after saying goodbye', () => {
    // A reload is a goodbye followed by a hello under a new name. Nothing must
    // make the registry refuse an id it has already buried.
    const registry = createOverlayRegistry();
    registry.seen('a', 1000, false);
    registry.forget('a');
    registry.seen('a', 2000, false);

    expect(registry.counts(2000).inObs).toBe(1);
  });
});

describe('createOverlayRegistry - where each overlay is', () => {
  it('counts the one in OBS apart from the one in a browser', () => {
    // Opening overlay.html to check it works took the count from 1 to 2, and
    // the figure was not wrong — that page *is* an overlay. It became useless
    // the instant anyone used it: no way left to tell whether the one in OBS
    // was among them. The diagnostic tool broke the diagnostic.
    const registry = createOverlayRegistry();

    registry.seen('obs', 1000, false);
    registry.seen('tab', 1000, true);

    expect(registry.counts(1000)).toEqual({ inObs: 1, inBrowser: 1 });
  });

  it('follows an overlay that moved, rather than counting it twice', () => {
    // The same id reporting a different place: one page, one entry. It cannot
    // really happen — the host is decided before the first paint and never
    // revisited — which is exactly why the registry must not invent a second
    // listener if it ever does.
    const registry = createOverlayRegistry();

    registry.seen('a', 1000, false);
    registry.seen('a', 1100, true);

    expect(registry.counts(1100)).toEqual({ inObs: 0, inBrowser: 1 });
  });

  it('forgets both kinds on the way out', () => {
    const registry = createOverlayRegistry();
    registry.seen('obs', 1000, false);
    registry.seen('tab', 1000, true);

    registry.forget('tab');

    expect(registry.counts(1000)).toEqual({ inObs: 1, inBrowser: 0 });
  });

  it('lets each kind expire on its own', () => {
    const registry = createOverlayRegistry();
    registry.seen('obs', 1000, false);
    registry.seen('tab', 5000, true);

    expect(registry.counts(5000 + OVERLAY_TIMEOUT_MS)).toEqual({ inObs: 0, inBrowser: 1 });
  });
});
