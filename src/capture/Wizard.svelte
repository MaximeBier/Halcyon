<script lang="ts">
  import { untrack } from 'svelte';
  import { selectOnFocus } from './select-on-focus';
  import { Check } from './icons';
  import HelpText from './HelpText.svelte';
  import Tooltip from './Tooltip.svelte';
  import { obsNote, stepNumber, type WizardStep } from './wizard';
  import { keyboardHint, obsHint, type ConnectionSettings } from './settings';
  import type { KeyboardStatus } from '../keyboard/device';
  import { MAX_PORT, type ObsStatus } from '../transport/obs';
  import { copyToClipboard } from './clipboard';

  /**
   * The first-run setup, as board `4a` draws it: a card with the step thread
   * on its left and the current step's content on its right, alone on the
   * page — the editor waits behind it.
   *
   * **It orchestrates, it does not duplicate** (spec §9.1). Nothing here
   * configures anything the editor cannot: the device button opens the same
   * picker the keyboard pill does, the port and password are the same two
   * fields the OBS popover carries. What the wizard adds is an order, and the
   * refusal to move on before each step has proved itself.
   *
   * Two steps are drawn. The third, "Add your keys", stays on the rail as the
   * destination, and reaching it closes the wizard: the editor opens with the
   * capture armed and an empty stage that says what to do (`LayoutEditor`).
   */
  let {
    step,
    keyboard,
    device,
    obs,
    overlaysInObs,
    settings,
    url,
    size = null,
    searching = false,
    onAllowKeyboard,
    onReconnect,
    onSkip,
  }: {
    step: WizardStep;
    keyboard: KeyboardStatus;
    /** The product name of the keyboard that answered, for the step 1 tick. */
    device: string | null;
    /** For the step 2 note: which half of the step is missing, and why. */
    obs: ObsStatus;
    overlaysInObs: number;
    /** The live settings object: the same two fields the OBS popover writes to. */
    settings: ConnectionSettings;
    url: string;
    /**
     * What the stage's foot gives as the browser source size, or `null` while
     * there is no key to size: an empty layout is 0 × 0, which nobody can type
     * into OBS.
     */
    size?: { width: number; height: number } | null;
    /**
     * The first look for an allowed keyboard (`getDevices()`) has not answered
     * yet. `keyboard` reads `disconnected` meanwhile, which is where the
     * status starts, not something that was found.
     */
    searching?: boolean;
    /**
     * Opens Chrome's HID picker. Called straight from the click, never through
     * an await or a timer: WebHID grants the picker to a user gesture and to
     * nothing else.
     */
    onAllowKeyboard: () => void;
    onReconnect: () => void;
    onSkip: () => void;
  } = $props();

  const ROWS: { step: WizardStep; label: string }[] = [
    { step: 'keyboard', label: 'Keyboard' },
    { step: 'obs', label: 'Connect OBS' },
    { step: 'keys', label: 'Add your keys' },
  ];

  const at = $derived(stepNumber(step));

  /**
   * Never named `state`: a local binding of that name turns every `$state`
   * in the file into a store subscription on it — silently, with no compiler
   * error, and the component fails at render with "state is not a store".
   */
  function rowState(row: WizardStep): 'done' | 'current' | 'pending' {
    const index = stepNumber(row);
    if (index < at) return 'done';
    return index === at ? 'current' : 'pending';
  }

  /**
   * The keyboard's own failures, which never resolve into a device on their
   * own: old firmware, nothing plugged in, or something else already holding
   * it. `no-permission` is left out — nothing has failed yet there — and so
   * is `disconnected` before the first search has answered: the box opens on
   * the search the board draws (noteStep1), not on "plug it in".
   */
  const keyboardFailed = $derived(
    keyboard === 'no-analog-interface' ||
      (keyboard === 'disconnected' && !searching) ||
      keyboard === 'open-failed',
  );

  /**
   * The failures that turn the whole box red (board Wizard-Step1): a keyboard
   * that is there and refused to open. Not `disconnected`, which is also where
   * the status starts until `getDevices()` answers: the box flashed red at
   * every opening, and an unplugged keyboard is a step to take, not a fault.
   */
  const keyboardRefused = $derived(
    keyboard === 'no-analog-interface' || keyboard === 'open-failed',
  );

  /**
   * Whether a password has been tried: one was there already (saved from a
   * session before), or something was typed. On a first arrival the socket
   * tries an empty one and OBS refuses it — "Wrong password" before anyone
   * wrote anything is a verdict on nothing, so the refusal reads as waiting
   * until then.
   */
  let passwordTried = $state(untrack(() => settings.password !== ''));
  /** The OBS state as the card tells it. */
  const told = $derived<ObsStatus>(obs === 'auth-failed' && !passwordTried ? 'idle' : obs);

  /** What a row says under its name: the summary of a step behind, the state of the one at hand. */
  function note(row: WizardStep): string | null {
    const where = rowState(row);
    if (row === 'keyboard') {
      if (where === 'done') return device ? `${device} detected` : 'connected';
      // "searching…" was a lie that never expired on the three failures;
      // `keyboardHint` names each one, and this row is the one a beginner is
      // actually looking at (spec's first documented Wooting user hit exactly
      // this wall on the firmware one).
      return keyboardFailed ? keyboardHint(keyboard) : 'searching…';
    }
    if (row === 'obs') {
      if (where === 'done') return 'connected';
      return where === 'current' ? obsNote(told, overlaysInObs) : 'not connected yet';
    }
    return 'in the editor';
  }

  /**
   * The line at the foot of step 2, which is the one place the full sentence
   * fits: the rail's note is a fragment, this can say what to do. `unreachable`
   * gets `obsHint`'s paragraph — the WebSocket server, and Chrome's local
   * network permission, which nothing else on the page names.
   */
  const obsLine = $derived(
    told === 'idle'
      ? 'Waiting for OBS'
      : told === 'unreachable'
        ? obsHint(told)
        : obsNote(told, overlaysInObs).replace(/^\w/, (first) => first.toUpperCase()),
  );

  let revealed = $state(false);
  /** Tri-state and blur-reset, for the reasons in `clipboard.ts`. */
  let copyState = $state<'idle' | 'done' | 'failed'>('idle');

  async function copy() {
    copyState = (await copyToClipboard(navigator, url)) ? 'done' : 'failed';
  }
</script>

<div class="card" data-card>
  <aside class="rail">
    <span class="eyebrow">SETUP</span>

    <ol class="steps">
      {#each ROWS as row, index (row.step)}
        <li data-row={row.step} data-state={rowState(row.step)}>
          <!-- A thread, not numbered discs (board Wizard 4a): a check behind us,
               a dot with a halo where one stands, a hollow dot ahead; a line
               from each step to the next, green once it is done. -->
          <span class="track" aria-hidden="true">
            <span class="mark">
              {#if rowState(row.step) === 'done'}
                <Check size={16} strokeWidth={2.5} />
              {:else}
                <span class="pip"></span>
              {/if}
            </span>
            {#if index < ROWS.length - 1}<span class="wire"></span>{/if}
          </span>
          <span class="text">
            <span class="label">{row.label}</span>
            <span class="note">{note(row.step)}</span>
          </span>
        </li>
      {/each}
    </ol>

    <!-- Quiet, and at the foot of the rail on both steps: the way out is
         always in the same place, and never dressed as the way forward. -->
    <button class="skip he-text-btn" data-action="skip" type="button" onclick={onSkip}
      >Skip setup →</button
    >
  </aside>

  <section class="content">
    {#if step === 'keyboard'}
      <h2>Plug in your keyboard</h2>
      <!-- Wooting and nothing else, because that is what the device chooser
           will show: `requestDevice` filters on their vendor id. Offering "any
           analog HE keyboard" sent people to a picker that had nothing in it. -->
      <p class="lede">
        Halcyon looks for a Wooting keyboard over WebHID. Plug it in, or pick it by hand if nothing
        shows up. Other analog keyboards are not supported yet.
      </p>

      <p class="status" data-status data-failed={keyboardFailed} data-refused={keyboardRefused}>
        <span class="dot" class:he-pulse={!keyboardFailed} aria-hidden="true"></span>
        <!-- The automatic look is `navigator.hid.getDevices()`, which only
             returns a keyboard this site was already allowed: on a first visit
             it finds nothing, and the button below is the way forward. -->
        {keyboardFailed ? keyboardHint(keyboard) : 'Looking for a keyboard you’ve already allowed…'}
      </p>

      <!-- One label for every status this button is shown in: it always calls
           `requestPermission()`, which always opens the same HID picker —
           potentially empty. "Rescan devices" used to promise an automatic
           look that the code never performs. -->
      <!-- The primary button: on a first visit it is the only gesture that
           moves the setup on (board Wizard-Step1). -->
      <button
        class="he-btn-primary choose"
        data-action="keyboard"
        type="button"
        onclick={onAllowKeyboard}
      >
        Choose device…
      </button>
    {:else}
      <h2>Connect OBS</h2>
      <!-- Three things to do, in the order OBS asks for them (board 4a). -->
      <ol class="todo" data-obs-steps>
        <li>
          <span class="num" aria-hidden="true">1.</span>
          <span
            >In OBS, open “Tools → WebSocket Server Settings”, then tick “Enable WebSocket server”
            and “Enable Authentication”.</span
          >
        </li>
        <li>
          <span class="num" aria-hidden="true">2.</span>
          <span>Click “Show Connect Info” and paste the password below.</span>
        </li>
        <li>
          <span class="num" aria-hidden="true">3.</span>
          <span>Add a “Browser” source to your scene with the URL below.</span>
        </li>
      </ol>

      <div class="fields">
        <label class="port">
          Port
          <input
            use:selectOnFocus
            type="number"
            min="1"
            max={MAX_PORT}
            bind:value={settings.port}
            onchange={onReconnect}
          />
        </label>
        <label class="password">
          Password
          <!-- The field and what it is worth knowing about it, 4 px under it,
               whatever happens (board Wizard 4a). A refusal is the status
               line's to say, below: the field only turns red and points to it. -->
          <span class="he-with-help">
            <span class="secret" class:refused={told === 'auth-failed'}>
              <input
                use:selectOnFocus
                aria-invalid={told === 'auth-failed' ? 'true' : undefined}
                aria-describedby={told === 'auth-failed' ? 'wizard-obs-line' : undefined}
                type={revealed ? 'text' : 'password'}
                bind:value={settings.password}
                oninput={() => (passwordTried = true)}
                onchange={onReconnect}
              />
              <button type="button" class="he-btn-tertiary" onclick={() => (revealed = !revealed)}>
                {revealed ? 'Hide' : 'Show'}
              </button>
            </span>
            <HelpText>The password never leaves your computer.</HelpText>
          </span>
        </label>
      </div>

      <div class="source">
        <span class="caption">Browser source URL</span>
        <div class="url">
          <!-- A value to copy, not a field (he-copy-value): one click selects it all. -->
          <output class="he-copy-value" data-url aria-label="Overlay URL for OBS">{url}</output>
          <Tooltip
            text={copyState === 'failed' ? 'Select the URL field above and copy it by hand' : null}
          >
            {#snippet children(describedBy)}
              <button
                class="he-btn-primary"
                data-action="copy"
                type="button"
                aria-describedby={describedBy}
                onclick={copy}
                onblur={() => (copyState = 'idle')}
              >
                {copyState === 'done'
                  ? 'Copied'
                  : copyState === 'failed'
                    ? 'Copy failed'
                    : 'Copy URL'}
              </button>
            {/snippet}
          </Tooltip>
        </div>
        {#if size}
          <!-- The stage foot's own figure, so the two never disagree. -->
          <span class="caption" data-source-size>
            Width <code>{size.width}</code> · Height <code>{size.height}</code>
          </span>
        {/if}
      </div>

      <div class="spacer"></div>

      <p class="foot" data-obs-line>
        <span
          class="dot"
          class:live={told === 'identified'}
          class:he-pulse={told === 'idle' || told === 'connecting'}
          aria-hidden="true"
        ></span>
        <!-- Red for "Wrong password", muted for the longer explanations (board
             System): the verdict short enough to read at a glance. -->
        <span class="line" id="wizard-obs-line" class:wrong={told === 'auth-failed'}>{obsLine}</span
        >
      </p>
    {/if}
  </section>
</div>

<style>
  /* On a narrow window the rail goes above the step rather than squeezing it
     (spec §16.9): the bases are the breakpoint, no media query. */
  .card {
    display: flex;
    flex-wrap: wrap;
    inline-size: 960px;
    max-inline-size: 100%;
    box-sizing: border-box;
    overflow: hidden;
    font: var(--he-font);
    color: var(--he-text);
    background: var(--he-surface-low);
    border: 1px solid var(--he-border-control);
    border-radius: var(--he-radius-card);
  }

  .rail {
    flex: 1 1 300px;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    gap: 24px;
    padding: 30px 26px;
    background: var(--he-surface-low);
    border-inline-end: 1px solid var(--he-border);
  }
  .eyebrow {
    font: var(--he-font-mono);
    font-size: var(--he-size-xs);
    letter-spacing: 0.1em;
    color: var(--he-accent);
  }
  /* The rail as a thread (board Wizard 4a): no gap between the steps, each
     tall enough for its line to show; the marker 16 px wide, centred on the
     title's line, the line under it to the next step. */
  .steps {
    display: flex;
    flex-direction: column;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .steps li {
    display: flex;
    align-items: stretch;
    gap: 14px;
  }
  .steps li:not(:last-child) {
    min-block-size: 62px;
  }
  .track {
    flex: none;
    inline-size: 16px;
    display: flex;
    flex-direction: column;
    align-items: center;
  }
  .mark {
    flex: none;
    block-size: 20px;
    display: grid;
    place-items: center;
  }
  /* Not `.dot`: that is the status line's, amber, further down — sharing
     its name painted the step ahead amber. */
  .pip {
    box-sizing: border-box;
    inline-size: 10px;
    block-size: 10px;
    border-radius: 50%;
  }
  .wire {
    flex: 1;
    inline-size: 1px;
    margin-block: 6px;
    background: var(--he-border-popover);
  }
  .text {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .label {
    font-size: var(--he-size-sm);
    line-height: 20px;
    font-weight: 600;
    color: var(--he-text-muted);
  }
  .note {
    font-size: var(--he-size-xs);
    color: var(--he-text-muted);
  }
  li[data-state='current'] .label {
    color: var(--he-text);
  }
  li[data-state='current'] .note {
    color: var(--he-text-muted);
  }
  li[data-state='current'] .pip {
    background: var(--he-accent);
    box-shadow: 0 0 0 4px color-mix(in srgb, var(--he-accent) 18%, transparent);
  }
  li[data-state='pending'] .pip {
    border: 1.5px solid var(--he-border-hover);
  }
  li[data-state='done'] .label {
    color: var(--he-text-muted);
  }
  li[data-state='done'] .note {
    color: var(--he-ok);
  }
  li[data-state='done'] .mark {
    color: var(--he-ok);
  }
  li[data-state='done'] .wire {
    background: var(--he-wire-ok);
  }
  .skip {
    all: unset;
    cursor: pointer;
    margin-block-start: auto;
    font-size: var(--he-size-xs);
    color: var(--he-text-muted);
  }

  .content {
    flex: 999 1 420px;
    min-inline-size: 0;
    display: flex;
    flex-direction: column;
    gap: 18px;
    padding: 30px 34px;
    background: var(--he-popover);
  }
  h2 {
    margin: 0;
    font-size: var(--he-size-title);
    font-weight: 700;
    letter-spacing: -0.01em;
  }
  .lede {
    margin: -8px 0 0;
    font-size: var(--he-size-sm);
    line-height: 1.5;
    color: var(--he-text-muted);
    text-wrap: pretty;
  }

  .status {
    margin: 0;
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 11px 14px;
    font-size: var(--he-size-xs);
    color: var(--he-text-muted);
    background: var(--he-well);
    border: 1px solid var(--he-border-control);
    border-radius: var(--he-radius);
  }
  /* The status dot (board System): red and still for an error — OBS silent,
     closed, the password refused; muted and pulsing while something is under
     way (.he-pulse); green once connected (.live). Never amber. */
  .dot {
    flex: none;
    inline-size: 8px;
    block-size: 8px;
    border-radius: 50%;
    background: var(--he-danger);
  }
  /* Still looking: the page's in-progress dot, drawn by controls.css. */
  .dot.he-pulse {
    background: var(--he-text-muted);
  }
  /* A refusal is told by the whole box, not the dot alone (board Wizard-Step1):
     the sentence in red, the border a deep red. */
  .status[data-refused='true'] {
    color: var(--he-danger);
    border-color: var(--he-border-danger);
  }
  .status[data-failed='true'] .dot {
    background: var(--he-danger);
  }
  .dot.live {
    background: var(--he-ok);
  }

  .fields {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 6px;
    font-size: var(--he-size-xs);
    color: var(--he-text-muted);
  }
  .port {
    flex: 1 1 100px;
  }
  .password {
    flex: 2 1 200px;
  }
  .secret {
    display: flex;
    align-items: center;
    gap: 8px;
    background: var(--he-well);
    border: 1px solid var(--he-border-control);
    border-radius: var(--he-radius);
    padding: 0 12px 0 0;
  }
  .secret:focus-within {
    border-color: var(--he-accent);
  }
  .secret.refused {
    border-color: var(--he-danger);
  }
  .secret input {
    flex: 1;
    min-inline-size: 0;
    border: none;
    background: none;
    letter-spacing: 0.15em;
  }

  input {
    box-sizing: border-box;
    inline-size: 100%;
    font: var(--he-font-mono);
    font-size: var(--he-size-sm);
    color: var(--he-text);
    background: var(--he-well);
    border: 1px solid var(--he-border-control);
    border-radius: var(--he-radius);
    padding: 9px 12px;
  }

  .todo {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin: -8px 0 0;
    padding: 0;
    list-style: none;
    font-size: var(--he-size-sm);
    line-height: 1.45;
    color: var(--he-text-muted);
  }
  .todo li {
    display: flex;
    align-items: baseline;
    gap: 10px;
  }
  /* A plain list (board Wizard 4a): "1." in mono, right-aligned in its column,
     on the first line's baseline — no disc. */
  .num {
    flex: none;
    inline-size: 18px;
    text-align: right;
    font: var(--he-font-mono);
    font-size: var(--he-size-xs);
    color: var(--he-text-muted);
  }
  .caption code {
    font: var(--he-font-mono);
    font-size: var(--he-size-xs);
    color: var(--he-text);
  }
  .choose {
    inline-size: 100%;
  }

  .source {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .caption {
    font-size: var(--he-size-xs);
    color: var(--he-text-muted);
  }
  .url {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  /* As tall as the fields above, whose border it does without. */
  .url .he-copy-value {
    padding: 10px 13px;
  }

  .spacer {
    flex: 1;
    min-block-size: 8px;
  }
  .foot {
    margin: 0;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 9px;
    padding-block-start: 16px;
    border-block-start: 1px solid var(--he-border);
    font-size: var(--he-size-xs);
    color: var(--he-text-muted);
    /* A layer of its own: on focus, the blinking caret's layer took the line
       in, and Chrome drew it with grey antialiasing instead of ClearType — the
       red "Wrong password" seemed to lose its weight, then get it back. Drawn
       on its own layer, it looks the same whatever has the focus. */
    will-change: transform;
  }
  .line {
    flex: 1;
    line-height: 1.4;
  }
  .line.wrong {
    color: var(--he-danger);
  }
</style>
