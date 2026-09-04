<script lang="ts">
  import type { KeyboardStatus } from '../keyboard/device';
  import type { ObsStatus } from '../transport/obs';
  import {
    canPickDevice,
    canRetryObs,
    captureWarning,
    keyboardHint,
    obsHint,
    overlayTally,
    rateLabel,
  } from './settings';
  import { UI_TOKENS } from '../styles/ui-tokens';

  let {
    keyboard,
    obs,
    rate,
    overlays,
    otherCapture,
    onPickDevice,
    onRetryObs,
  }: {
    keyboard: KeyboardStatus;
    obs: ObsStatus;
    rate: number;
    overlays: { inObs: number; inBrowser: number };
    /** Whether another capture page has been heard on the bus. */
    otherCapture: boolean;
    /**
     * Opens Chrome's HID picker. Called straight from the click, never through
     * an await or a timer: WebHID grants the picker to a user gesture and to
     * nothing else, and a gesture does not survive being handed to a task.
     */
    onPickDevice: () => void;
    /** One fresh attempt at the OBS socket. */
    onRetryObs: () => void;
  } = $props();

  let rivals = $derived(captureWarning(otherCapture));
  // Both null when OBS is down and their figure is zero: neither number is
  // measured then — the count only travels through OBS and the rate is reset
  // when the socket goes, so both would just repeat the OBS pill in red.
  let obsConnected = $derived(obs === 'identified');
  let tally = $derived(overlayTally(overlays, obsConnected));
  let throughput = $derived(rateLabel(rate, obsConnected));

  // Permanent, never modal (spec §11): a dialog would have to be dismissed,
  // and what is wrong is exactly what one needs to keep seeing.
  const dot = (ok: boolean) => (ok ? UI_TOKENS.ok : UI_TOKENS.danger);
</script>

<header>
  <!-- A pill that can fix what it reports is the button for it, whole: dot and
       sentence in one target. The gesture it takes is the one someone makes
       anyway — the cursor goes to the line that says something is wrong — and
       the panel's own button stays where it is for anyone who looks there
       instead. A `<button>` only when there is something to do, because a
       control that answers a click with silence is worse than plain text. -->
  {#if canPickDevice(keyboard)}
    <button type="button" class="pill act" data-pill="keyboard" onclick={onPickDevice}>
      <span class="dot" style:background={UI_TOKENS.danger}></span>
      {keyboardHint(keyboard)}
    </button>
  {:else}
    <span class="pill" data-pill="keyboard">
      <span class="dot" style:background={dot(keyboard === 'connected')}></span>
      {keyboardHint(keyboard)}
    </span>
  {/if}
  {#if canRetryObs(obs)}
    <button type="button" class="pill act" data-pill="obs" onclick={onRetryObs}>
      <span class="dot" style:background={UI_TOKENS.danger}></span>
      {obsHint(obs)}
    </button>
  {:else}
    <span class="pill" data-pill="obs">
      <span class="dot" style:background={dot(obs === 'identified')}></span>
      {obsHint(obs)}
    </span>
  {/if}
  {#if throughput}
    <span class="pill" data-pill="rate">{throughput}</span>
  {/if}
  {#if tally}
    <span class="pill" data-pill="overlays">
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
    /* Fills the rest of App's `.bar` row, leaving the undo/redo buttons their
       own width instead of splitting the row evenly with them. */
    flex: 1;
    gap: 0.75rem;
    align-items: center;
    flex-wrap: wrap;
    font: var(--he-font);
    /* `.bar` already frames this header with its own padding and background
       (spec §11's run of pills reads as part of the bar, not a panel inside
       it) — a second one here would double both. */
    padding: 0;
    background: none;
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
  /* An actionable pill is drawn exactly like the others at rest: same face,
     same weight, no border, no underline. Nothing advertises the click, and
     nothing needs to — the pills that answer one are the pills wearing a red
     dot and an instruction, which is where the cursor goes on its own. The
     button's own chrome is stripped rather than restyled, `font: inherit`
     included: a bare <button> would otherwise arrive at 13px in its own face
     and break the run. */
  button.pill {
    appearance: none;
    background: none;
    border: 0;
    margin: 0;
    padding: 0;
    font: inherit;
    color: inherit;
    text-align: left;
  }
  /* The reward for arriving, not a signal to look for: the cursor changes and
     the sentence underlines once the pointer is on it. */
  .act {
    cursor: pointer;
  }
  .act:hover {
    text-decoration: underline;
  }
  /* Keyboard users get the one mark the mouse never needs. Without it a pill
     that became a button is a trap: focusable, and invisible while focused. */
  .act:focus-visible {
    outline: 2px solid currentColor;
    outline-offset: 3px;
    border-radius: 2px;
  }
  /* The only pill that colours its text: the others report a state, this one
     reports a fault, and a red dot alone reads as one status among four.
     A whole line of its own, too — a sentence that asks for two actions cannot
     wrap through a run of pills and still read as one instruction. */
  .rival {
    flex-basis: 100%;
    align-items: flex-start;
    color: var(--he-danger);
    font-weight: 600;
  }
  /* On the first line of the sentence, not in the middle of the block: the text
     wraps on a narrow window, and a centred dot would drift down with it. */
  .rival .dot {
    flex: 0 0 auto;
    margin-top: 0.35em;
  }
</style>
