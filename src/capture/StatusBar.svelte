<script lang="ts">
  import type { KeyboardStatus } from '../keyboard/device';
  import type { ObsStatus } from '../transport/obs';
  import {
    canPickDevice,
    canRetryObs,
    captureWarning,
    keyboardHint,
    obsPill,
    type ConnectionSettings,
  } from './settings';
  import { UI_TOKENS } from '../styles/ui-tokens';
  import ObsPopover from './ObsPopover.svelte';

  let {
    keyboard,
    obs,
    rate,
    overlays,
    otherCapture,
    url,
    size,
    settings,
    onPickDevice,
    onRetryObs,
    onCopyUrl,
  }: {
    keyboard: KeyboardStatus;
    obs: ObsStatus;
    rate: number;
    overlays: { inObs: number; inBrowser: number };
    /** Whether another capture page has been heard on the bus. */
    otherCapture: boolean;
    /** The three things the OBS popover shows and edits — see `ObsPopover`. */
    url: string;
    size: { width: number; height: number } | null;
    settings: ConnectionSettings;
    /**
     * Opens Chrome's HID picker. Called straight from the click, never through
     * an await or a timer: WebHID grants the picker to a user gesture and to
     * nothing else, and a gesture does not survive being handed to a task.
     */
    onPickDevice: () => void;
    /** One fresh attempt at the OBS socket — also what a changed credential triggers. */
    onRetryObs: () => void;
    onCopyUrl: () => Promise<boolean>;
  } = $props();

  let rivals = $derived(captureWarning(otherCapture));
  let obsLabel = $derived(obsPill(obs, overlays, rate));
  /** The OBS pill's popover, which is the whole OBS interface since board 3a. */
  let obsOpen = $state(false);
  let obsPillEl = $state<HTMLButtonElement | null>(null);

  /**
   * One click, two meanings, decided by the state the pill shows. Down, the
   * click is the retry — the gesture someone makes anyway, at the line that
   * says something is wrong. Otherwise it opens the popover, which is where
   * the URL, the size and the credentials live now. A right click always
   * opens it, so the credentials stay one gesture away while OBS is down —
   * which is exactly when a wrong port needs fixing.
   */
  function onObsClick() {
    if (canRetryObs(obs)) onRetryObs();
    else obsOpen = !obsOpen;
  }

  function onObsContext(event: MouseEvent) {
    event.preventDefault();
    obsOpen = !obsOpen;
  }

  function closeObs() {
    obsOpen = false;
    // Whatever closed it — Escape, a click outside — the focus lands back on
    // the pill rather than on `<body>`, where the next Tab starts from the top.
    obsPillEl?.focus();
  }

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

  <!-- Always a button: connected it opens the popover, down it retries. The
       slot is what the popover hangs from and what its outside-click test
       reads, so the pill's own click keeps reaching `onObsClick`. -->
  <div class="slot">
    <button
      type="button"
      class="pill act"
      class:down={obs !== 'identified'}
      data-pill="obs"
      aria-expanded={obsOpen}
      aria-haspopup="dialog"
      bind:this={obsPillEl}
      onclick={onObsClick}
      oncontextmenu={onObsContext}
    >
      <span class="dot" style:background={dot(obs === 'identified')}></span>
      {obsLabel}
    </button>

    {#if obsOpen}
      <ObsPopover
        {obs}
        {overlays}
        {url}
        {size}
        {settings}
        onReconnect={onRetryObs}
        onCopy={onCopyUrl}
        onClose={closeObs}
      />
    {/if}
  </div>

  <!-- Shown only when it is true, and then on a line of its own under the
       pills: an overlay obeying two masters is a failure in which both pages
       look entirely correct, so it has to be visible without being looked for —
       and it is the one line here that asks for something to be done, which a
       third pill in the run would not say. `role="alert"` because it appears
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
    gap: 16px;
    align-items: center;
    flex-wrap: wrap;
    font: var(--he-font);
    font-size: var(--he-size-xs);
    /* `.bar` already frames this header with its own padding and background
       (spec §11's run of pills reads as part of the bar, not a panel inside
       it) — a second one here would double both. */
    padding: 0;
    background: none;
    color: var(--he-text-muted);
  }
  .slot {
    position: relative;
    display: inline-flex;
  }
  .pill {
    display: inline-flex;
    align-items: center;
    gap: 7px;
  }
  .dot {
    flex: none;
    width: 8px;
    height: 8px;
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
     the text lifts once the pointer is on it. */
  .act {
    cursor: pointer;
  }
  .act:hover,
  .act[aria-expanded='true'] {
    color: var(--he-text);
  }
  /* Keyboard users get the one mark the mouse never needs. Without it a pill
     that became a button is a trap: focusable, and invisible while focused. */
  .act:focus-visible {
    outline: 2px solid currentColor;
    outline-offset: 3px;
    border-radius: 2px;
  }
  /* Red text with the red dot for OBS down (board 3a): it is the one pill
     that asks for a click, and a dot alone reads as one status among several. */
  .down {
    color: var(--he-danger);
  }
  .down:hover {
    color: var(--he-danger);
    text-decoration: underline;
  }
  /* The only other pill that colours its text: it reports a fault, and asks
     for two actions — a whole line of its own, because a sentence like that
     cannot wrap through a run of pills and still read as one instruction. */
  .rival {
    flex-basis: 100%;
    align-items: flex-start;
    color: var(--he-danger);
    font-weight: 600;
  }
  /* On the first line of the sentence, not in the middle of the block: the text
     wraps on a narrow window, and a centred dot would drift down with it. */
  .rival .dot {
    margin-top: 0.35em;
  }
</style>
