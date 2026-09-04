<script lang="ts">
  import type { KeyboardStatus } from '../keyboard/device';

  /**
   * The one failure that disguises itself as working (spec §11).
   *
   * Without WebHID the keyboard section already says so, and `Gated` already
   * offers no button. But that is a line inside one section, phrased as a
   * keyboard problem — and it is not a section that is out, it is the page.
   * Everything else works: one can create a profile, reach OBS, lay out keys,
   * read the source size to paste into OBS, and never get a single frame.
   *
   * **One sentence, and it names what is needed.** Why the browser cannot do
   * it is diagnosis, and diagnosis has two homes already — the keyboard pill
   * and the journal. A first-level banner has one job: send someone somewhere.
   *
   * **The overlay page is unaffected** and must not gain a warning of its own:
   * it reads no keyboard at all — obs-websocket and an SVG, nothing more.
   */
  let { keyboard }: { keyboard: KeyboardStatus } = $props();

  /**
   * The capability, never the browser. `navigator.hid === undefined` is what
   * this status already means, and it is the only honest test: Firefox is the
   * case at hand, but Safari lands here too, so does a Chromium in an insecure
   * context or under an enterprise policy — and a Chromium that gains WebHID
   * stops being accused the day it does. Task 26 already learned this the hard
   * way with `isOrdinaryBrowser`.
   *
   * Every other status is reached *through* `navigator.hid`, so each of them is
   * proof it exists — including `disconnected`, the status at load, before
   * `resume()` has looked for anything. A banner that flashed there would
   * accuse every Chrome user for a tick.
   */
  const missing = $derived(keyboard === 'unsupported');
</script>

{#if missing}
  <!-- `alert`, not `status`: it is present from the first paint and never
       changes afterwards, so an assertive announcement is the only one that
       will be heard, and someone who cannot see the banner needs it most. -->
  <div class="wall" role="alert">
    <span class="dot" aria-hidden="true"></span>
    <span>Halcyon needs a Chromium browser, such as Chrome or Edge.</span>
  </div>
{/if}

<style>
  /* Full width under the header and above the setup card: what is out is the
     page, so the warning cannot sit inside one of its panels. */
  .wall {
    flex: none;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 11px 22px;

    font: var(--he-font);
    font-size: var(--he-size-md);
    font-weight: 600;
    color: var(--he-danger);
    background: var(--he-popover);
    border-block-end: 1px solid var(--he-border-danger);
  }
  .dot {
    inline-size: 7px;
    block-size: 7px;
    border-radius: 50%;
    background: var(--he-danger);
    flex: none;
  }
</style>
