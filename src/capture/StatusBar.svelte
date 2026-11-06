<script lang="ts">
  import type { KeyboardStatus } from '../keyboard/device';
  import type { ObsStatus } from '../transport/obs';
  import {
    canPickDevice,
    canRetryObs,
    captureWarning,
    keyboardPill,
    keyboardTip,
    obsPill,
    obsTip,
    type ConnectionSettings,
  } from './settings';
  import { UI_TOKENS } from '../styles/ui-tokens';
  import ObsPopover from './ObsPopover.svelte';
  import Tooltip from './Tooltip.svelte';

  let {
    keyboard,
    device,
    obs,
    overlays,
    otherCapture,
    url,
    size,
    settings,
    sources,
    onPickDevice,
    onRetryObs,
    onCopyUrl,
    onReloadSources,
    squeeze = false,
    squeezeObs = false,
    dots = false,
    obsOpen = $bindable(null),
  }: {
    keyboard: KeyboardStatus;
    /** WebHID's `productName` for the keyboard that answered, or `null`. */
    device: string | null;
    obs: ObsStatus;
    overlays: { inObs: number; inBrowser: number };
    /** Whether another capture page has been heard on the bus. */
    otherCapture: boolean;
    /** The three things the OBS popover shows and edits — see `ObsPopover`. */
    url: string;
    size: { width: number; height: number } | null;
    settings: ConnectionSettings;
    /** Our browser sources found in OBS, or null while nobody has looked. */
    sources: number | null;
    /**
     * Opens Chrome's HID picker. Called straight from the click, never through
     * an await or a timer: WebHID grants the picker to a user gesture and to
     * nothing else, and a gesture does not survive being handed to a task.
     */
    onPickDevice: () => void;
    /** One fresh attempt at the OBS socket — also what a changed credential triggers. */
    onRetryObs: () => void;
    onCopyUrl: () => Promise<boolean>;
    /** Presses Refresh on each of our sources in OBS; resolves with how many took. */
    onReloadSources: () => Promise<number>;
    /**
     * The header's fifth step (board Editor-HeaderNarrow): the keyboard's name
     * may be cut, "…", from the right, never under 40 px. Before it, no pill
     * gives an inch — the header drops what it can first.
     */
    squeeze?: boolean;
    /**
     * The OBS pill cut the same way, at the same step as the keyboard's name:
     * the two give way together, little by little.
     */
    squeezeObs?: boolean;
    /**
     * The header's last step: the keyboard and OBS pills keep only their dot,
     * the state read by its colour, the name on hover and in the label. An
     * alert keeps its words.
     */
    dots?: boolean;
    /**
     * Whether the OBS popover is open, and what opened it — held by the page.
     * It hangs from what was clicked: under the pill from the pill, under the
     * ⚙ from Settings › OBS connection (board Editor-Settings), which the
     * page renders there. The same component either way.
     */
    obsOpen?: 'pill' | 'settings' | null;
  } = $props();

  /** A pill's tooltip once it is a dot: its name first, then what the click does. */
  const named = (label: string, tip: string | null) => (tip ? `${label}. ${tip}` : label);

  let rivals = $derived(captureWarning(otherCapture));
  let keyboardLabel = $derived(keyboardPill(keyboard, device));
  /** Red, and worth a click: something a picker could fix. */
  let keyboardDown = $derived(canPickDevice(keyboard));
  let obsLabel = $derived(obsPill(obs));
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
    else togglePill();
  }

  /** Under the pill, or closed if it already hangs there — taken from the ⚙ otherwise. */
  function togglePill() {
    obsOpen = obsOpen === 'pill' ? null : 'pill';
  }

  function onObsContext(event: MouseEvent) {
    event.preventDefault();
    togglePill();
  }

  function closeObs() {
    obsOpen = null;
    // Whatever closed it — Escape, a click outside — the focus lands back on
    // the pill rather than on `<body>`, where the next Tab starts from the top.
    obsPillEl?.focus();
  }

  // Permanent, never modal (spec §11): a dialog would have to be dismissed,
  // and what is wrong is exactly what one needs to keep seeing.
  const dot = (ok: boolean) => (ok ? UI_TOKENS.ok : UI_TOKENS.danger);
</script>

<header>
  <!-- One form for every pill (board Editor-StatusPills): 14 px, normal
       weight, an 8 px dot; muted when all is well, red when it is not. The
       pill says the state in a few words; what its click does is the page's
       tooltip, never a title. A pill that can fix what it reports is the
       button for it, whole: the gesture someone makes anyway — the cursor
       goes to the line that says something is wrong. Connected, the same
       click reopens the picker: that is how one swaps to the other keyboard
       on the desk (board 3a). Plain text only where there is nothing to open
       (no WebHID at all). -->
  {#if keyboard !== 'unsupported'}
    <Tooltip
      text={dots ? named(keyboardLabel, keyboardTip(keyboard)) : keyboardTip(keyboard)}
      shrink={squeeze && !dots}
    >
      {#snippet children()}
        <button
          type="button"
          class="pill keyboard act he-text-btn"
          class:down={keyboardDown}
          class:squeeze={squeeze && !dots}
          class:dots
          aria-label={dots ? keyboardLabel : undefined}
          data-pill="keyboard"
          onclick={onPickDevice}
        >
          <span class="dot" style:background={dot(!keyboardDown)}></span>
          <span class="device">{keyboardLabel}</span>
        </button>
      {/snippet}
    </Tooltip>
  {:else}
    <Tooltip text={keyboardTip(keyboard)}>
      {#snippet children()}
        <span class="pill down" data-pill="keyboard">
          <span class="dot" style:background={UI_TOKENS.danger}></span>
          <span class="device">{keyboardLabel}</span>
        </span>
      {/snippet}
    </Tooltip>
  {/if}

  <!-- Always a button: connected it opens the popover, down it retries. The
       slot is what the popover hangs from and what its outside-click test
       reads, so the pill's own click keeps reaching `onObsClick`. Never cut:
       "OBS disconnected" is the news. -->
  <div class="slot" class:squeeze={squeezeObs && !dots}>
    <Tooltip text={dots ? named(obsLabel, obsTip(obs)) : obsTip(obs)} shrink={squeezeObs && !dots}>
      {#snippet children()}
        <button
          type="button"
          class="pill act he-text-btn"
          class:down={obs !== 'identified'}
          class:squeeze={squeezeObs && !dots}
          class:dots
          aria-label={dots ? obsLabel : undefined}
          data-pill="obs"
          aria-expanded={obsOpen === 'pill'}
          aria-haspopup="dialog"
          bind:this={obsPillEl}
          onclick={onObsClick}
          oncontextmenu={onObsContext}
        >
          <span class="dot" style:background={dot(obs === 'identified')}></span>
          <span class="device">{obsLabel}</span>
        </button>
      {/snippet}
    </Tooltip>

    {#if obsOpen === 'pill'}
      <ObsPopover
        {obs}
        {overlays}
        {url}
        {size}
        {settings}
        {sources}
        onReconnect={onRetryObs}
        onCopy={onCopyUrl}
        onReload={onReloadSources}
        onClose={closeObs}
      />
    {/if}
  </div>

  <!-- Shown only when it is true, and then as the last pill of the run, in
       the same form: an overlay obeying two masters is a failure in which
       both pages look entirely correct, so it has to be visible without being
       looked for. `role="alert"` because it appears mid-session, long after
       anyone last read this bar. Text, not a button, and no tooltip: there is
       nothing to click, and closing the other pages is the whole of it — this
       one lifts the warning by itself once they are gone. -->
  {#if rivals}
    <span class="pill down" data-pill="rival" role="alert">
      <span class="dot" style:background={UI_TOKENS.danger}></span>
      {rivals}
    </span>
  {/if}
</header>

<style>
  header {
    display: flex;
    /* As wide as its pills; it gives way only at the header's last step, when
       the keyboard's name is cut (`squeeze`). */
    flex: 0 1 auto;
    min-inline-size: 0;
    gap: 16px;
    align-items: center;
    /* One line, always (board Editor-HeaderNarrow): the header folds by
       steps instead, never inside the run of pills. */
    flex-wrap: nowrap;
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
  /* The OBS pill's slot gives way with it at the last step. */
  .slot.squeeze {
    flex: 0 1 auto;
    min-inline-size: var(--pill-floor);
  }
  .pill {
    flex: none;
    display: inline-flex;
    align-items: center;
    gap: 7px;
    font-weight: 400;
    white-space: nowrap;
  }
  /* The last step, and the keyboard's name only: cut from the right, text
     held to the left, never under 40 px; the dot never squeezed. Before it,
     the name is whole. */
  /* A cut pill never goes below its dot, its gap and 40 px of name — nor do
     the boxes around it, or it runs under the next pill. */
  header {
    --pill-floor: calc(8px + 7px + 40px);
  }
  .pill.squeeze {
    flex: 0 1 auto;
    min-inline-size: var(--pill-floor);
  }
  header :global([data-tooltip-host]:has(> .pill.squeeze)) {
    min-inline-size: var(--pill-floor);
  }
  /* The last step: the dot alone. */
  .pill.dots .device {
    display: none;
  }
  .squeeze .device {
    display: block;
    min-inline-size: 40px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    text-align: left;
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
    justify-content: flex-start;
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
     the text lifts once the pointer is on it — `he-text-btn`, the family of
     clickable words (spec §16.13), which also gives the keyboard its ring. */
  .act {
    cursor: pointer;
  }
  /* Red text with the red dot for a pill reporting a fault (board 3a): those
     are the pills that ask for a click, and a dot alone reads as one status
     among several. */
  .down {
    color: var(--he-danger);
  }
</style>
