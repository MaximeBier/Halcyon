<script lang="ts">
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
   * it. `no-permission` is left out — nothing has failed yet there.
   */
  const keyboardFailed = $derived(
    keyboard === 'no-analog-interface' || keyboard === 'disconnected' || keyboard === 'open-failed',
  );

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
      return where === 'current' ? obsNote(obs, overlaysInObs) : 'not connected yet';
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
    obs === 'idle'
      ? 'Waiting for OBS'
      : obs === 'unreachable'
        ? obsHint(obs)
        : obsNote(obs, overlaysInObs).replace(/^\w/, (first) => first.toUpperCase()),
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
      {#each ROWS as row (row.step)}
        <li data-row={row.step} data-state={rowState(row.step)}>
          <span class="bullet" aria-hidden="true">
            {rowState(row.step) === 'done' ? '✓' : stepNumber(row.step)}
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
    <button class="skip" data-action="skip" type="button" onclick={onSkip}>Skip setup →</button>
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

      <p class="status" data-status data-failed={keyboardFailed}>
        <span class="dot" aria-hidden="true"></span>
        {keyboardFailed ? keyboardHint(keyboard) : 'Scanning devices…'}
      </p>

      <!-- One label for every status this button is shown in: it always calls
           `requestPermission()`, which always opens the same HID picker —
           potentially empty. "Rescan devices" used to promise an automatic
           look that the code never performs. -->
      <button class="secondary" data-action="keyboard" type="button" onclick={onAllowKeyboard}>
        Choose device…
      </button>
    {:else}
      <h2>Connect OBS</h2>
      <p class="lede">
        In OBS: Tools → WebSocket Server Settings → tick “Enable WebSocket server” and “Enable
        Authentication”. To see the password, click “Show Connect Info”.
      </p>

      <div class="fields">
        <label class="port">
          Port
          <input
            type="number"
            min="1"
            max={MAX_PORT}
            bind:value={settings.port}
            onchange={onReconnect}
          />
        </label>
        <label class="password">
          Password
          <span class="secret" class:refused={obs === 'auth-failed'}>
            <input
              type={revealed ? 'text' : 'password'}
              bind:value={settings.password}
              onchange={onReconnect}
            />
            <button type="button" onclick={() => (revealed = !revealed)}>
              {revealed ? 'Hide' : 'Show'}
            </button>
          </span>
          {#if obs === 'auth-failed'}
            <!-- Under the field it was typed into: the correction appears
                 where the mistake was made. -->
            <span class="error" data-error>{obsNote(obs, overlaysInObs)}</span>
          {/if}
        </label>
      </div>

      <div class="source">
        <span class="caption">Then add this browser source in your scene</span>
        <div class="url">
          <input data-url readonly value={url} aria-label="Overlay URL for OBS" />
          <button
            class="primary"
            data-action="copy"
            type="button"
            onclick={copy}
            onblur={() => (copyState = 'idle')}
            title={copyState === 'failed'
              ? 'Select the URL field above and copy it by hand'
              : undefined}
          >
            {copyState === 'done' ? 'Copied' : copyState === 'failed' ? 'Copy failed' : 'Copy URL'}
          </button>
        </div>
      </div>

      <div class="spacer"></div>

      <p class="foot" data-obs-line>
        <span class="dot" class:live={obs === 'identified'} aria-hidden="true"></span>
        <span class="line">{obsLine}</span>
        <!-- The one page that hands out a URL with a password in it owes the
             reader this sentence (spec §16.8). -->
        <span class="fine">The password never leaves your computer.</span>
      </p>
    {/if}
  </section>
</div>

<style>
  .card {
    display: flex;
    inline-size: 960px;
    max-inline-size: 100%;
    box-sizing: border-box;
    overflow: hidden;
    font: var(--he-font);
    color: var(--he-text);
    background: var(--he-surface-low);
    border: 1px solid var(--he-border-control);
    border-radius: 10px;
  }

  .rail {
    flex: none;
    inline-size: 300px;
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
  .steps {
    display: flex;
    flex-direction: column;
    gap: 20px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .steps li {
    display: flex;
    align-items: flex-start;
    gap: 13px;
  }
  .bullet {
    flex: none;
    inline-size: 30px;
    block-size: 30px;
    border-radius: 50%;
    border: 1px solid var(--he-border-popover);
    display: grid;
    place-items: center;
    font-size: var(--he-size-xs);
    color: var(--he-text-faint);
  }
  .text {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .label {
    font-size: var(--he-size-sm);
    font-weight: 600;
    color: var(--he-text-faint);
  }
  .note {
    font-size: var(--he-size-xs);
    color: var(--he-text-ghost);
  }
  li[data-state='current'] .label {
    color: var(--he-text);
  }
  li[data-state='current'] .note {
    color: var(--he-text-faint);
  }
  li[data-state='current'] .bullet {
    font-weight: 600;
    color: var(--he-accent);
    border-color: var(--he-accent);
  }
  li[data-state='done'] .label {
    color: var(--he-text-muted);
  }
  li[data-state='done'] .note {
    color: var(--he-ok);
  }
  li[data-state='done'] .bullet {
    font-size: var(--he-size-sm);
    color: var(--he-ok);
    background: var(--he-surface-ok);
    border-color: transparent;
  }
  .skip {
    all: unset;
    cursor: pointer;
    margin-block-start: auto;
    font-size: var(--he-size-xs);
    color: var(--he-text-faint);
  }
  .skip:hover {
    color: var(--he-text-muted);
  }

  .content {
    flex: 1;
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
    background: var(--he-stage);
    border: 1px solid var(--he-border-control);
    border-radius: var(--he-radius-control);
  }
  .dot {
    flex: none;
    inline-size: 8px;
    block-size: 8px;
    border-radius: 50%;
    background: var(--he-override);
  }
  .status[data-failed='true'] .dot {
    background: var(--he-danger);
  }
  .dot.live {
    background: var(--he-ok);
  }

  .fields {
    display: flex;
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
    flex: 1;
  }
  .password {
    flex: 2;
  }
  .secret {
    display: flex;
    align-items: center;
    gap: 8px;
    background: var(--he-stage);
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
  .secret input:focus-visible {
    outline: none;
  }
  .secret button {
    all: unset;
    cursor: pointer;
    font-size: var(--he-size-xs);
    color: var(--he-accent);
  }
  .secret button:hover {
    color: var(--he-accent-hover);
  }
  .error {
    font-size: var(--he-size-xs);
    color: var(--he-danger);
  }

  input {
    box-sizing: border-box;
    inline-size: 100%;
    font: var(--he-font-mono);
    font-size: var(--he-size-sm);
    color: var(--he-text);
    background: var(--he-stage);
    border: 1px solid var(--he-border-control);
    border-radius: var(--he-radius);
    padding: 9px 12px;
  }
  input:focus-visible {
    outline: none;
    border-color: var(--he-accent);
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
  .url input {
    flex: 1;
    min-inline-size: 0;
    font-size: var(--he-size-xs);
    color: var(--he-text-muted);
    text-overflow: ellipsis;
  }

  .spacer {
    flex: 1;
    min-block-size: 8px;
  }
  .foot {
    margin: 0;
    display: flex;
    align-items: center;
    gap: 9px;
    padding-block-start: 16px;
    border-block-start: 1px solid var(--he-border);
    font-size: var(--he-size-xs);
    color: var(--he-text-muted);
  }
  .line {
    flex: 1;
    line-height: 1.4;
  }
  .fine {
    flex: none;
    color: var(--he-text-faint);
  }

  .primary,
  .secondary {
    all: unset;
    box-sizing: border-box;
    cursor: pointer;
    text-align: center;
    font-size: var(--he-size-xs);
    font-weight: 600;
    border-radius: var(--he-radius-control);
    white-space: nowrap;
  }
  .secondary {
    padding: 9px 0;
    color: var(--he-text);
    border: 1px solid var(--he-border-popover);
  }
  .secondary:hover {
    border-color: var(--he-border-hover);
    background: var(--he-surface);
  }
  .primary {
    padding: 9px 18px;
    font-weight: 700;
    color: var(--he-bg);
    background: var(--he-accent);
  }
  .primary:hover {
    background: var(--he-accent-hover);
  }
  .primary:focus-visible,
  .secondary:focus-visible,
  .skip:focus-visible,
  .secret button:focus-visible {
    outline: 2px solid var(--he-accent);
    outline-offset: 2px;
  }
</style>
