import { describe, it, expect } from 'vitest';
import { createFrameWatch, BEAT_MS, FRAME_TIMEOUT_MS } from './freshness';

describe('FRAME_TIMEOUT_MS', () => {
  // Pins the relation the two constants used to lack: BEAT_MS lived in
  // App.svelte, FRAME_TIMEOUT_MS here, and nothing tied them together — so
  // changing the beat changed how many refreshes the timeout actually
  // tolerated without anyone noticing. This test breaks the moment that
  // silent coupling breaks, instead of the margin quietly shrinking.
  it('is exactly three beats', () => {
    expect(FRAME_TIMEOUT_MS).toBe(3 * BEAT_MS);
  });
});

describe('createFrameWatch', () => {
  it('is stale before anything was seen: there is no frame worth keeping', () => {
    const watch = createFrameWatch();

    expect(watch.stale(0)).toBe(true);
  });

  it('is fresh right after a frame', () => {
    const watch = createFrameWatch();

    watch.seen(1000);

    expect(watch.stale(1000)).toBe(false);
  });

  it('tolerates exactly the timeout, like the overlay registry it mirrors', () => {
    const watch = createFrameWatch();
    watch.seen(0);

    expect(watch.stale(FRAME_TIMEOUT_MS)).toBe(false);
    expect(watch.stale(FRAME_TIMEOUT_MS + 1)).toBe(true);
  });

  it('measures from the latest frame, not the first', () => {
    const watch = createFrameWatch();
    watch.seen(0);
    watch.seen(5000);

    expect(watch.stale(FRAME_TIMEOUT_MS + 1)).toBe(false);
  });
});
