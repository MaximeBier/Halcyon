<script lang="ts">
  import type { KeyboardStatus } from '../keyboard/device';
  import type { ObsStatus } from '../transport/obs';
  import { captureWarning, keyboardHint, obsHint, overlayTally } from './settings';
  import { UI_TOKENS } from '../styles/ui-tokens';

  let {
    keyboard,
    obs,
    rate,
    overlays,
    otherCapture,
  }: {
    keyboard: KeyboardStatus;
    obs: ObsStatus;
    rate: number;
    overlays: { inObs: number; inBrowser: number };
    /** Whether another capture page has been heard on the bus. */
    otherCapture: boolean;
  } = $props();

  let rivals = $derived(captureWarning(otherCapture));
  // Null when OBS is down and nothing is listening: the count only travels
  // through OBS, so there it repeats the pill beside it (see `overlayTally`).
  let tally = $derived(overlayTally(overlays, obs === 'identified'));

  // Permanent, never modal (spec §11): a dialog would have to be dismissed,
  // and what is wrong is exactly what one needs to keep seeing.
  const dot = (ok: boolean) => (ok ? UI_TOKENS.ok : UI_TOKENS.danger);
</script>

<header>
  <span class="pill">
    <span class="dot" style:background={dot(keyboard === 'connected')}></span>
    {keyboardHint(keyboard)}
  </span>
  <span class="pill">
    <span class="dot" style:background={dot(obs === 'identified')}></span>
    {obsHint(obs)}
  </span>
  <span class="pill">{rate} fps</span>
  {#if tally}
    <span class="pill">
      <span class="dot" style:background={dot(overlays.inObs > 0)}></span>
      {tally}
    </span>
  {/if}
  <!-- Shown only when it is true, and then on a line of its own under the four
       states: an overlay obeying two masters is a failure in which both pages
       look entirely correct, so it has to be visible without being looked for —
       and it is the one line here that asks for something to be done, which a
       fifth pill in the run would not say. `role="alert"` because it appears
       mid-session, long after anyone last read this bar. -->
  {#if rivals}
    <span class="pill rival" role="alert">
      <span class="dot" style:background={UI_TOKENS.danger}></span>
      {rivals}
    </span>
  {/if}
</header>

<style>
  header {
    display: flex;
    gap: 0.75rem;
    align-items: center;
    flex-wrap: wrap;
    font: var(--he-font, 400 16px system-ui, sans-serif);
    padding: 0.5rem 0.75rem;
    background: var(--he-surface);
    color: var(--he-text);
  }
  .pill {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
  }
  .dot {
    width: 0.6rem;
    height: 0.6rem;
    border-radius: 50%;
  }
  /* The only pill that colours its text: the others report a state, this one
     reports a fault, and a red dot alone reads as one status among four.
     A whole line of its own, too — a sentence that asks for two actions cannot
     wrap through a run of pills and still read as one instruction. */
  .rival {
    flex-basis: 100%;
    align-items: flex-start;
    color: var(--he-danger, #e06c5b);
    font-weight: 600;
  }
  /* On the first line of the sentence, not in the middle of the block: the text
     wraps on a narrow window, and a centred dot would drift down with it. */
  .rival .dot {
    flex: 0 0 auto;
    margin-top: 0.35em;
  }
</style>
