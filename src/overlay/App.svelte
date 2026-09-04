<script lang="ts">
  import { PROTOCOL_VERSION } from '../protocol/messages';
  import { createObsClient } from '../transport/obs';
  import { readOverlayParams } from './params';
  import { createRateCounter } from '../protocol/rate';
  import { createFrameWatch, BEAT_MS } from './freshness';
  import { newPageId } from '../protocol/identity';
  import KeyboardView from '../view/KeyboardView.svelte';
  import BrowserChrome from './BrowserChrome.svelte';
  import type { FrameKey } from '../protocol/messages';
  import type { ResolvedConfig } from '../config/schema';

  // The hash matters: the password is read from the fragment only, so that it
  // never reaches the access log of whoever hosts this page.
  const { port, password } = readOverlayParams(location.search, location.hash);
  const id = newPageId('overlay');

  let config = $state<ResolvedConfig | null>(null);
  let frame = $state<readonly FrameKey[]>([]);

  /**
   * Decided in `main.ts`, before the first render, and never revisited.
   *
   * Nothing about the host changes while the page lives, and a value that
   * cannot change must not be able to. The failure this forecloses is the one
   * that matters: decoration appearing on air, halfway through a stream,
   * because something re-evaluated.
   */
  let { decorated }: { decorated: boolean } = $props();

  let connected = $state(false);
  let rate = $state(0);

  /**
   * The same counter the capture page measures itself with (`protocol/rate`).
   *
   * It used to be frames-since-the-last-beat, divided by two — a tumbling
   * window, inherited from the beat's interval rather than chosen. It split a
   * burst across two windows, understated the peak, and made the figure depend
   * on when it happened to be asked. The two pills are read side by side; they
   * have to be counting the same thing.
   */
  const frames = createRateCounter();

  // Fed on every frame, consulted on every beat: the only witness this page
  // has that the capture is still alive (`freshness.ts` says why it matters).
  const freshness = createFrameWatch();

  const obs = createObsClient({
    url: `ws://localhost:${port}`,
    password,
    onStatus: (status) => {
      // Announced on identification, not right after connect(): broadcast
      // sends nothing until the handshake is through, so a hello posted any
      // earlier is simply dropped. This also re-announces the overlay after
      // OBS has been restarted under it.
      connected = status === 'identified';
      if (status === 'identified')
        obs.broadcast({ v: PROTOCOL_VERSION, t: 'hello', id, browser: decorated });
    },
    onMessage: (message) => {
      // The overlay discards hello, beat and bye: those are its own messages
      // (spec §6).
      if (message.t === 'config') config = message.config;
      else if (message.t === 'frame') {
        frame = message.k;
        // Counted and read on the frame itself: no interval decides how fresh
        // the figure is, which is what "instantly" means here.
        const now = performance.now();
        freshness.seen(now);
        frames.tick(now);
        rate = frames.read(now);
      }
    },
  });

  obs.connect();

  // A timer is allowed here: OBS renders the overlay continuously (spec §2.2).
  // The beat doubles as a presence signal for the capture page, which counts
  // the connected overlays.
  setInterval(() => {
    // Same clock as the WebHID report timestamps the capture page feeds in:
    // both are measured from `performance.timeOrigin`.
    obs.ensureConnected(performance.now());
    obs.broadcast({ v: PROTOCOL_VERSION, t: 'beat', id, browser: decorated });
    // The beat no longer measures anything — it only lets the figure fall.
    // Without this re-read the count would freeze at its last value the moment
    // frames stopped, printing 58/s beside a link that had gone quiet.
    rate = frames.read(performance.now());
    // The capture answers every beat with a frame while it lives, so a stale
    // frame means the capture is gone — and a dead capture can never release
    // the key it left pressed. Rest is the only honest thing to draw. The
    // length guard keeps an already-empty frame from being reassigned, and
    // re-rendered, every two seconds forever.
    if (frame.length > 0 && freshness.stale(performance.now())) frame = [];
  }, BEAT_MS);

  // A reload draws a new id, so leaving in silence has the departed page
  // counted next to the one replacing it — ten reloads while adjusting an
  // overlay read as eleven listeners. `pagehide` rather than `beforeunload`:
  // it also fires when the page is frozen into the back/forward cache, and it
  // is the event browsers actually guarantee.
  addEventListener('pagehide', () => obs.broadcast({ v: PROTOCOL_VERSION, t: 'bye', id }));
</script>

<!--
  Nothing is drawn until the capture has sent a configuration (spec §14). That
  is a choice, not an oversight: it removes any cache on the overlay side, and
  with it the question of when to invalidate one.
-->
<BrowserChrome {decorated} {connected} {rate}>
  {#if config}
    <KeyboardView {config} {frame} pack />
  {/if}
</BrowserChrome>
