<script lang="ts">
  import { selectOnFocus } from './select-on-focus';
  import { Check } from './icons';
  import HelpText from './HelpText.svelte';
  import { MAX_PORT, type ObsStatus } from '../transport/obs';
  import { obsHint, sourceState, type ConnectionSettings } from './settings';

  /**
   * What hangs under the OBS pill (board 3a): the connection in one line, the
   * browser source URL to paste, the size to give it, and the two credentials.
   *
   * The sidebar fold that used to carry all this is gone — the pill is the
   * single entry point to OBS now, connected or not. The popover owns no
   * connection: the fields write into the live settings object and the
   * caller rebuilds the client on `onReconnect`, exactly as the fold did.
   */
  let {
    obs,
    overlays,
    url,
    size,
    settings,
    sources,
    onReconnect,
    onCopy,
    onReload,
    onClose,
    align = 'start',
  }: {
    obs: ObsStatus;
    overlays: { inObs: number; inBrowser: number };
    url: string;
    /** The packed layout in pixels, or `null` while there is no key to pack. */
    size: { width: number; height: number } | null;
    /** The live settings object: the same two fields the wizard writes to. */
    settings: ConnectionSettings;
    /** Our browser sources found in OBS, or null while nobody has looked (not connected). */
    sources: number | null;
    onReconnect: () => void;
    /** Copies the URL and says whether it actually happened (see `clipboard.ts`). */
    onCopy: () => Promise<boolean>;
    /** Presses Refresh on each; resolves with how many took. */
    onReload: () => Promise<number>;
    onClose: () => void;
    /**
     * Which edge it hangs from: the pill's left, or — opened from Settings ›
     * OBS connection — the ⚙'s right, at the menu's offset, in the place of
     * the menu that just closed (board Editor-Settings).
     */
    align?: 'start' | 'end';
  } = $props();

  /** The password field's reveal — the one one comes back to weeks later. */
  let revealed = $state(false);
  let copied = $state<'idle' | 'done' | 'failed'>('idle');
  let root = $state<HTMLElement | null>(null);
  /** Set once a reload resolves; the `data-reloaded` line rides it until the
   * CSS animation ends (constraint 1 forbids a timer here, as in Toast). */
  let reloaded = $state<number | null>(null);

  async function copy() {
    copied = (await onCopy()) ? 'done' : 'failed';
  }

  async function reload() {
    reloaded = await onReload();
  }

  // `role="dialog"` promises the platform that opening it moves the focus in.
  // The dialog itself takes it, not the first control: the URL is what most
  // openings are for, and it is read, not typed into.
  $effect(() => {
    root?.focus();
  });

  $effect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    // `pointerdown`, not `click`: the popover must be gone before whatever was
    // clicked underneath it reacts. The anchor is the slot it hangs from, pill
    // included, so the pill's own click still reaches its handler.
    const onPointer = (event: PointerEvent) => {
      const anchor = root?.parentElement;
      if (anchor && !anchor.contains(event.target as Node)) onClose();
    };

    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
    };
  });
</script>

<div
  class="popover"
  class:end={align === 'end'}
  data-obs-popover
  role="dialog"
  aria-label="OBS connection"
  tabindex="-1"
  bind:this={root}
>
  <!-- The pill says the state in three words; this says it in a sentence, with
       what to do about it when there is something to do. Connected, the
       sentence is about who is listening — the only question left then. -->
  <p class="state">
    <span class="dot" data-live={obs === 'identified'} aria-hidden="true"></span>
    {obs === 'identified' ? sourceState(overlays) : obsHint(obs)}
  </p>

  <div class="url">
    <!-- A value to copy, not a field (he-copy-value): one click selects it all. -->
    <output class="he-copy-value" aria-label="Overlay URL for OBS">{url}</output>
    <button
      type="button"
      class="he-btn-tertiary"
      data-copy
      onclick={copy}
      onblur={() => (copied = 'idle')}
      title={copied === 'failed' ? 'Select the URL and copy it by hand' : undefined}
    >
      {copied === 'done' ? 'Copied' : copied === 'failed' ? 'Failed' : 'Copy'}
    </button>
  </div>

  {#if size}
    <p class="row">
      <span>Recommended source size</span>
      <span class="value" data-size>{size.width} × {size.height} px</span>
    </p>
  {/if}

  <label class="row">
    Port
    <!-- An identifier, not a quantity: no arrows (spec §16.13). -->
    <input
      use:selectOnFocus
      class="port"
      type="number"
      min="1"
      max={MAX_PORT}
      bind:value={settings.port}
      onchange={onReconnect}
    />
  </label>
  <!-- The field and what it is worth knowing about it, 4 px apart. -->
  <div class="he-with-help">
    <label class="row">
      Password
      <span class="secret">
        <input
          use:selectOnFocus
          type={revealed ? 'text' : 'password'}
          bind:value={settings.password}
          onchange={onReconnect}
        />
        <button
          type="button"
          class="he-btn-tertiary"
          data-reveal
          onclick={() => (revealed = !revealed)}
        >
          {revealed ? 'Hide' : 'Show'}
        </button>
      </span>
    </label>
    <HelpText>
      Stored in this browser and carried in the URL above. Anyone with access to this machine can
      read it.
    </HelpText>
  </div>

  <hr />

  <!-- The count is read from OBS itself, not from who answers on the bus: a
       source that is there and silent is exactly the case this row is for.
       Zero, connected, is the first place to look when the overlay is black. -->
  <p class="row" data-sources-row>
    <span>Halcyon sources in OBS</span>
    <span class="sources">
      <span class="value" data-sources-count data-none={sources === 0}>{sources ?? '—'}</span>
      {#if reloaded !== null}
        {#key reloaded}
          <!-- Three seconds by animation, never by timer (constraint 1). -->
          <!-- Amber on zero: a green tick over "Reloaded 0" reads as a job
               done, when nothing was pressed and the overlay is still stale. -->
          <span
            class="done"
            data-reloaded
            data-none={reloaded === 0}
            onanimationend={() => (reloaded = null)}
          >
            <Check size={14} aria-hidden="true" />
            Reloaded {reloaded}
          </span>
        {/key}
      {:else}
        <button
          type="button"
          class="he-btn-tertiary"
          data-reload
          disabled={sources === null}
          onclick={reload}
        >
          Reload
        </button>
      {/if}
    </span>
  </p>
</div>

<style>
  .popover {
    position: absolute;
    top: calc(100% + 8px);
    left: 0;
    z-index: 9;
    inline-size: var(--he-status-popover-width);
    display: flex;
    flex-direction: column;
    gap: 11px;
    padding: 14px;
    background: var(--he-popover);
    border: 1px solid var(--he-border-popover);
    border-radius: var(--he-radius-panel);
    font: var(--he-font);
    font-size: var(--he-size-sm);
    color: var(--he-text);
    /* Inherited from the pill, whose text turns red with its dot. */
    text-align: left;
    font-weight: 400;
  }
  /* Under the ⚙: right edges aligned, at the Settings menu's own offset — the
     place of the menu that just closed. Never off the window's right edge. */
  .popover.end {
    top: var(--he-menu-offset);
    right: 0;
    left: auto;
  }

  .state {
    margin: 0;
    display: flex;
    align-items: center;
    gap: 8px;
    font-weight: 600;
    line-height: 1.4;
  }
  .state .dot {
    flex: none;
    inline-size: 8px;
    block-size: 8px;
    border-radius: 50%;
    background: var(--he-danger);
  }
  .state .dot[data-live='true'] {
    background: var(--he-ok);
  }

  .url {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  /* As tall as the port and password below, whose border it does without. */
  .url .he-copy-value {
    padding: 7px 10px;
  }

  .row {
    margin: 0;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    font-size: var(--he-size-xs);
    color: var(--he-text-muted);
  }
  .value,
  .row input {
    font: var(--he-font-mono);
    font-size: var(--he-size-xs);
    color: var(--he-text);
  }
  .row input {
    inline-size: 7rem;
    background: var(--he-well);
    border: 1px solid var(--he-border-control);
    border-radius: var(--he-radius);
    padding: 3px 9px;
  }
  /* Four digits wide, as a port almost always is, and a fifth when it takes
     one: the field grows with what it holds. */
  .row input.port {
    inline-size: auto;
    field-sizing: content;
    min-inline-size: 4ch;
  }
  .secret {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .secret input {
    letter-spacing: 0.1em;
  }

  hr {
    inline-size: auto;
    block-size: 1px;
    margin: 0;
    border: none;
    background: var(--he-border-control);
  }
  .sources {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .value[data-none='true'] {
    color: var(--he-warn);
  }
  .done {
    font-size: var(--he-size-xs);
    color: var(--he-ok);
    animation: shown 3s forwards;
  }
  .done[data-none='true'] {
    color: var(--he-warn);
  }
  @keyframes shown {
    0%,
    90% {
      opacity: 1;
    }
    100% {
      opacity: 0;
    }
  }
</style>
