<script lang="ts">
  import { obsNote, stepNumber, type WizardStep } from './wizard';
  import { keyboardHint, type ConnectionSettings } from './settings';
  import type { KeyboardStatus } from '../keyboard/device';
  import { MAX_PORT, type ObsStatus } from '../transport/obs';
  import { copyToClipboard } from './clipboard';

  /**
   * The first-run setup, as boards `6a`–`6c` draw it.
   *
   * **It orchestrates, it does not duplicate** (spec §9.1). Nothing here
   * configures anything the editor cannot: the keyboard button is the one from
   * the toolbar, the port and password are the same two fields, and the last
   * step is the ordinary learning mode with a banner over it. What the wizard
   * adds is an order, and the refusal to move on before each step has proved
   * itself.
   */
  let {
    step,
    keyboard,
    device,
    obs,
    overlaysInObs,
    settings,
    url,
    learning = $bindable(false),
    added,
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
    /** The live settings object: the same two fields the editor writes to. */
    settings: ConnectionSettings;
    url: string;
    learning: boolean;
    /** The label of the key that just landed, for the step 3 confirmation. */
    added: string | null;
    onAllowKeyboard: () => void;
    onReconnect: () => void;
    onSkip: () => void;
  } = $props();

  const ROWS: { step: WizardStep; label: string }[] = [
    { step: 'keyboard', label: 'Connect your keyboard' },
    { step: 'obs', label: 'Connect OBS (WebSocket + browser source)' },
    { step: 'keys', label: 'Add the keys you want on stream' },
  ];

  // Narrow on purpose: `step` also carries `'keys'` and `'done'`, neither of
  // which reaches `TITLES[step]` below — the card only renders for the other
  // two. `Record<string, string>` used to hide that behind `undefined`
  // instead of letting the compiler prove the two branches line up.
  const TITLES: Record<'keyboard' | 'obs', string> = {
    keyboard: 'Connect your keyboard',
    obs: 'Connect OBS',
  };

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

  /** What a row says on its right, and only while it is done or in progress. */
  function note(row: WizardStep): string | null {
    if (row === 'keyboard') {
      if (device) return device;
      if (rowState(row) !== 'current') return null;
      // `no-analog-interface`, `disconnected` and `open-failed` never resolve
      // into a device on their own — old firmware, nothing plugged in, or
      // something else already holding it — so "searching…" was a lie that
      // never expired. `keyboardHint` already names each one for the status
      // bar; this row is the one a beginner is actually looking at (spec's
      // first documented Wooting user hit exactly this wall on the firmware
      // one). `no-permission` is left out: nothing has failed yet there.
      if (
        keyboard === 'no-analog-interface' ||
        keyboard === 'disconnected' ||
        keyboard === 'open-failed'
      ) {
        return keyboardHint(keyboard);
      }
      return 'searching…';
    }
    if (row === 'obs' && rowState(row) === 'current') return obsNote(obs, overlaysInObs);
    return null;
  }

  let revealed = $state(false);
  /** Tri-state and blur-reset, for the reasons in `clipboard.ts`. */
  let copyState = $state<'idle' | 'done' | 'failed'>('idle');

  async function copy() {
    copyState = (await copyToClipboard(navigator, url)) ? 'done' : 'failed';
  }

  /**
   * Puts the setup aside, and disarms the capture on the way out.
   *
   * The effect below arms it on arrival at the last step and only disarms when
   * the step *changes* — but skipping unmounts the card instead, leaving the
   * page listening with nothing on screen to say so. The next key brushed was
   * added to the layout in silence.
   */
  function skip() {
    learning = false;
    onSkip();
  }

  /**
   * Arms the capture once, on arrival at the last step.
   *
   * The mockup shows step 3 already listening, and asking for one more click
   * to begin the step one has just reached explains nothing. Once, though:
   * re-arming on every pass would make cancelling a fight the user cannot win,
   * with a button that refuses to turn off.
   */
  let armed = $state(false);
  $effect(() => {
    if (step !== 'keys') {
      armed = false;
      return;
    }
    if (!armed) {
      armed = true;
      learning = true;
    }
  });

  /**
   * Re-arms the capture from the banner itself (task 8).
   *
   * `armed` above only fires once per arrival at this step, so it does not
   * notice — let alone undo — a disarm the stage performs on its own: Escape,
   * or the tab losing focus. Nothing new is invented here: `learning = true`
   * is the exact write the panel's "+ Add key" button already performs, since
   * both sides bind the same flag.
   */
  function resume() {
    learning = true;
  }
</script>

{#if step === 'keys'}
  <!-- No card here: a 410 px panel in the middle of the stage would cover the
       one thing this step exists to show (board 6c). -->
  <div class="banner" data-banner role="status">
    <!-- Dimmed rather than accented while stopped: the colour is the only
         part of this banner a glance actually reads. -->
    <span class="beacon" class:idle={!learning} aria-hidden="true"></span>
    <span class="lines">
      <!-- `learning` can go false without this step ever changing — the
           stage disarms it on its own (Escape, alt-tab) — so the banner reads
           that flag rather than asserting "Listening" for the whole step. -->
      <strong>{learning ? 'Listening · press any key' : 'Capture stopped'}</strong>
      {#if added}<span class="added">{added} added</span>{/if}
    </span>
    {#if !learning}
      <button class="secondary" data-action="resume" type="button" onclick={resume}>
        Resume listening
      </button>
    {/if}
    <button class="skip" data-action="skip" type="button" onclick={skip}>Skip setup</button>
  </div>
{:else if step === 'keyboard' || step === 'obs'}
  <div class="card" data-card>
    <span class="eyebrow">SETUP {at}/3</span>
    <h2>{TITLES[step]}</h2>

    {#if step === 'keyboard'}
      <!-- Wooting and nothing else, because that is what the device chooser
           will show: `requestDevice` filters on their vendor id. Offering "any
           analog HE keyboard" sent people to a picker that had nothing in it. -->
      <p class="lede">
        Plug in your Wooting keyboard. Other analog keyboards are not supported yet.
      </p>
    {:else}
      <p class="lede">
        <b>a.</b> In OBS: Tools → WebSocket Server Settings → tick “Enable WebSocket server” and
        “Enable Authentication”, and keep the generated password.
        <br />
        <b>b.</b> Copy the port and password into the fields below.
      </p>

      <div class="fields">
        <label>
          Server port
          <input
            type="number"
            min="1"
            max={MAX_PORT}
            bind:value={settings.port}
            onchange={onReconnect}
          />
        </label>
        <label>
          Server password
          <span class="secret">
            <input
              type={revealed ? 'text' : 'password'}
              bind:value={settings.password}
              onchange={onReconnect}
            />
            <button type="button" onclick={() => (revealed = !revealed)}>
              {revealed ? 'hide' : 'show'}
            </button>
          </span>
        </label>
      </div>

      <p class="lede"><b>c.</b> Sources → + → Browser, and paste the ready-made URL.</p>

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

      <p class="fine">
        Port and password stay between OBS and this app, on your machine — we never receive them.
        Keep the random password OBS generated, and avoid showing this URL on stream.
      </p>
    {/if}

    <ol class="steps">
      {#each ROWS as row (row.step)}
        <li data-row={row.step} data-state={rowState(row.step)}>
          <span class="bullet" aria-hidden="true">
            {rowState(row.step) === 'done' ? '✓' : stepNumber(row.step)}
          </span>
          <span class="label">{row.label}</span>
          {#if note(row.step)}<span class="note">{note(row.step)}</span>{/if}
        </li>
      {/each}
    </ol>

    <div class="actions">
      {#if step === 'keyboard'}
        <!-- One label for every status this button is shown in: it always
             calls `requestPermission()`, which always opens the same HID
             picker — potentially empty. "Rescan devices" used to promise an
             automatic look that the code never performs. -->
        <button class="secondary" data-action="keyboard" type="button" onclick={onAllowKeyboard}>
          Choose device…
        </button>
      {/if}
      <button class="skip" data-action="skip" type="button" onclick={skip}>Skip setup</button>
    </div>
  </div>
{/if}

<style>
  .card {
    inline-size: 470px;
    max-inline-size: 100%;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    gap: 16px;
    padding: 26px;

    font: var(--he-font, 400 16px system-ui, sans-serif);
    color: var(--he-text, #dde1e9);
    background: var(--he-popover, #141722);
    border: 1px solid var(--he-border-popover, #262b3a);
    border-radius: var(--he-radius-panel, 6px);
  }
  .eyebrow {
    font: var(--he-font-mono, 400 15px ui-monospace, monospace);
    font-size: var(--he-size-xs, 14px);
    letter-spacing: 0.08em;
    color: var(--he-accent, #7c9eff);
  }
  h2 {
    margin: 0;
    font-size: 27px;
    font-weight: 700;
  }
  .lede {
    margin: 0;
    font-size: var(--he-size-md, 16px);
    line-height: 1.55;
    color: var(--he-text-muted, #8b90a0);
    text-wrap: pretty;
  }
  .lede b {
    color: var(--he-accent, #7c9eff);
    font-weight: 600;
  }
  .fine {
    margin: 0;
    font-size: var(--he-size-xs, 14px);
    line-height: 1.45;
    color: var(--he-text-faint, #5a5f70);
    text-wrap: pretty;
  }

  .fields {
    display: flex;
    gap: 12px;
  }
  label {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 5px;
    font-size: var(--he-size-sm, 15px);
    color: var(--he-text-muted, #8b90a0);
  }
  .secret {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .secret input {
    min-inline-size: 0;
    flex: 1;
  }
  .secret button {
    all: unset;
    cursor: pointer;
    font-size: var(--he-size-xs, 14px);
    color: var(--he-accent, #7c9eff);
  }
  .secret button:hover {
    color: var(--he-accent-hover, #a5bcff);
  }

  input {
    box-sizing: border-box;
    inline-size: 100%;
    font: var(--he-font-mono, 400 15px ui-monospace, monospace);
    font-size: var(--he-size-sm, 15px);
    color: var(--he-text, #dde1e9);
    background: var(--he-stage, #0b0d11);
    border: 1px solid var(--he-border-control, #232838);
    border-radius: var(--he-radius, 4px);
    padding: 7px 9px;
  }
  input:focus-visible {
    outline: 1px solid var(--he-accent, #7c9eff);
  }

  .url {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .url input {
    flex: 1;
    min-inline-size: 0;
    color: var(--he-text-faint, #5a5f70);
    text-overflow: ellipsis;
  }

  .steps {
    display: flex;
    flex-direction: column;
    gap: 10px;
    margin: 0;
    padding: 16px 0 0;
    list-style: none;
    border-top: 1px solid var(--he-border, #1b1e27);
  }
  .steps li {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: var(--he-size-md, 16px);
    color: var(--he-text-faint, #5a5f70);
  }
  .bullet {
    flex: none;
    inline-size: 18px;
    block-size: 18px;
    border-radius: 50%;
    border: 1px solid var(--he-border-popover, #262b3a);
    display: grid;
    place-items: center;
    font-size: var(--he-size-xs, 14px);
    font-weight: 700;
  }
  li[data-state='current'] {
    color: var(--he-text, #dde1e9);
  }
  li[data-state='current'] .label {
    font-weight: 600;
  }
  li[data-state='current'] .bullet {
    color: var(--he-bg, #0e1015);
    background: var(--he-accent, #7c9eff);
    border-color: var(--he-accent, #7c9eff);
  }
  li[data-state='done'] {
    color: var(--he-text-muted, #8b90a0);
  }
  li[data-state='done'] .bullet {
    color: var(--he-ok, #4caf7d);
    border-color: var(--he-ok, #4caf7d);
  }
  .note {
    margin-left: auto;
    font-size: var(--he-size-xs, 14px);
    color: var(--he-override, #d9a05b);
  }
  li[data-state='done'] .note {
    color: var(--he-text-faint, #5a5f70);
  }

  .actions {
    display: flex;
    align-items: center;
    gap: 14px;
  }
  .primary,
  .secondary {
    all: unset;
    cursor: pointer;
    font-size: var(--he-size-md, 16px);
    font-weight: 600;
    border-radius: var(--he-radius-control, 5px);
    padding: 8px 16px;
    white-space: nowrap;
  }
  .secondary {
    color: var(--he-text, #dde1e9);
    border: 1px solid var(--he-border-popover, #262b3a);
  }
  .secondary:hover {
    border-color: var(--he-border-hover, #3a4054);
    background: var(--he-surface, #151823);
  }
  .primary {
    color: var(--he-bg, #0e1015);
    background: var(--he-accent, #7c9eff);
  }
  .primary:hover {
    background: var(--he-accent-hover, #a5bcff);
  }
  .skip {
    all: unset;
    cursor: pointer;
    font-size: var(--he-size-sm, 15px);
    color: var(--he-text-faint, #5a5f70);
  }
  .skip:hover {
    color: var(--he-text-muted, #8b90a0);
  }
  .primary:focus-visible,
  .secondary:focus-visible,
  .skip:focus-visible,
  .secret button:focus-visible {
    outline: 2px solid var(--he-accent, #7c9eff);
    outline-offset: 2px;
  }

  .banner {
    display: flex;
    align-items: center;
    gap: 13px;
    padding: 13px 18px;
    font: var(--he-font, 400 16px system-ui, sans-serif);
    color: var(--he-text, #dde1e9);
    background: var(--he-popover, #141722);
    border: 1px solid var(--he-accent, #7c9eff);
    border-radius: var(--he-radius-panel, 6px);
  }
  .beacon {
    flex: none;
    inline-size: 9px;
    block-size: 9px;
    border-radius: 50%;
    background: var(--he-accent, #7c9eff);
  }
  .beacon.idle {
    background: var(--he-text-faint, #5a5f70);
  }
  .lines {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .lines strong {
    font-size: var(--he-size-lg, 18px);
    font-weight: 700;
  }
  .added {
    font-size: var(--he-size-sm, 15px);
    color: var(--he-ok, #4caf7d);
  }
</style>
