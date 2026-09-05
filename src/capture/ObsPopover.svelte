<script lang="ts">
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
    onReconnect,
    onCopy,
    onClose,
  }: {
    obs: ObsStatus;
    overlays: { inObs: number; inBrowser: number };
    url: string;
    /** The packed layout in pixels, or `null` while there is no key to pack. */
    size: { width: number; height: number } | null;
    /** The live settings object: the same two fields the wizard writes to. */
    settings: ConnectionSettings;
    onReconnect: () => void;
    /** Copies the URL and says whether it actually happened (see `clipboard.ts`). */
    onCopy: () => Promise<boolean>;
    onClose: () => void;
  } = $props();

  /** The password field's reveal — the one one comes back to weeks later. */
  let revealed = $state(false);
  let copied = $state<'idle' | 'done' | 'failed'>('idle');
  let root = $state<HTMLElement | null>(null);

  async function copy() {
    copied = (await onCopy()) ? 'done' : 'failed';
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
    <input readonly value={url} aria-label="Overlay URL for OBS" />
    <button
      type="button"
      class="link"
      data-copy
      onclick={copy}
      onblur={() => (copied = 'idle')}
      title={copied === 'failed' ? 'Select the field and copy it by hand' : undefined}
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
    <input type="number" min="1" max={MAX_PORT} bind:value={settings.port} onchange={onReconnect} />
  </label>
  <label class="row">
    Password
    <span class="secret">
      <input
        type={revealed ? 'text' : 'password'}
        bind:value={settings.password}
        onchange={onReconnect}
      />
      <button type="button" class="link" data-reveal onclick={() => (revealed = !revealed)}>
        {revealed ? 'Hide' : 'Show'}
      </button>
    </span>
  </label>

  <p class="fine">
    Stored in this browser and carried in the URL above. Anyone with access to this machine can read
    it.
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
  .popover:focus {
    outline: none;
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
  .url input {
    flex: 1;
    min-inline-size: 0;
    font: var(--he-font-mono);
    font-size: var(--he-size-xs);
    color: var(--he-text-muted);
    background: var(--he-stage);
    border: 1px solid var(--he-border-control);
    border-radius: var(--he-radius);
    padding: 6px 9px;
    text-overflow: ellipsis;
  }
  .link {
    all: unset;
    cursor: pointer;
    font-size: var(--he-size-xs);
    color: var(--he-accent);
  }
  .link:hover {
    color: var(--he-accent-hover);
  }
  .link:focus-visible {
    outline: 2px solid var(--he-accent);
    outline-offset: 2px;
    border-radius: 2px;
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
    background: var(--he-stage);
    border: 1px solid var(--he-border-control);
    border-radius: var(--he-radius);
    padding: 3px 9px;
  }
  .secret {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .secret input {
    letter-spacing: 0.1em;
  }

  .fine {
    margin: 0;
    font-size: var(--he-size-xs);
    line-height: 1.5;
    color: var(--he-text-faint);
  }
</style>
