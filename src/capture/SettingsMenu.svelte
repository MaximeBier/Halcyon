<script lang="ts">
  import type { Snippet } from 'svelte';
  import { Settings } from './icons';
  import { escapeClosesPicker } from './gestures';
  import { Copy } from './icons';
  import Tooltip from './Tooltip.svelte';
  import type { OverlayConfig } from '../config/schema';

  /**
   * The ⚙ menu of board 3a, top right: what the sidebar footer used to hold
   * — the keyboard layout and the door to Diagnostics — plus the device
   * picker and the build.
   *
   * Settings someone touches once a month do not deserve a permanent strip
   * at the foot of the panel; a menu is the right amount of room for them.
   * "Start with Windows" is *not* here: it is the one feature that changes
   * how the product is used, and it stays a header control of its own.
   */
  let {
    layout,
    toCheck,
    onLayout,
    onPickDevice,
    onDiagnostics,
    onCopyUrl,
    obsConnected,
    onObs,
    obsOpen = false,
    onObsClose,
    obsPanel,
  }: {
    layout: OverlayConfig['layoutOverride'];
    /** The Needs attention lines of Diagnostics (`needsAttention`), counted. */
    toCheck: number;
    onLayout: (layout: OverlayConfig['layoutOverride']) => void;
    /**
     * Opens Chrome's HID picker. Called straight from the click, never through
     * an await or a timer: WebHID grants the picker to a user gesture and to
     * nothing else.
     */
    onPickDevice: () => void;
    onDiagnostics: () => void;
    /** Copies the overlay URL, and says whether the browser let it. */
    onCopyUrl: () => Promise<boolean>;
    /** Whether OBS answers, for the state on the OBS connection row. */
    obsConnected: boolean;
    /**
     * Opens the OBS pill's popover, under the pill — up or down, and never a
     * retry: down, the pill's own click retries, and the port and password
     * were a right click away, just when they need fixing.
     */
    onObs: () => void;
    /** Whether the OBS popover hangs here, opened from OBS connection. */
    obsOpen?: boolean;
    onObsClose?: () => void;
    /**
     * The OBS popover itself, the very one the pill hangs, handed over by the
     * page with the way to close it: here it hangs under the gear.
     */
    obsPanel?: Snippet<[close: () => void]>;
  } = $props();

  let open = $state(false);
  let root = $state<HTMLElement | null>(null);
  let trigger = $state<HTMLButtonElement | null>(null);
  let menu = $state<HTMLElement | null>(null);

  /**
   * §9.3 on a trigger rather than a fold header: the gear says when
   * Diagnostics has something that asks for a gesture (spec §11) — a forced
   * layout, a font missing on the PC running OBS. The journal never lights it.
   */
  const flagged = $derived(toCheck > 0);
  const title = $derived(
    toCheck === 0 ? 'Settings' : `Settings · ${toCheck} thing${toCheck === 1 ? '' : 's'} to check`,
  );

  /**
   * The overlay URL without going through the OBS pill (board Editor-Settings):
   * the menu stays open and the row says what happened, for two seconds. The
   * two seconds are a CSS animation that ends the message, not a timer: spec
   * §2 keeps timers off this page (the Toast recipe). Reset on close too, or a
   * menu shut mid-message would reopen still saying it — and a clipboard that
   * answers after the close is not heard: `attempt` has moved on.
   */
  let copied = $state<'idle' | 'done' | 'failed'>('idle');
  let attempt = 0;
  async function copyUrl() {
    const mine = ++attempt;
    const done = await onCopyUrl();
    if (mine === attempt) copied = done ? 'done' : 'failed';
  }

  /**
   * The OBS popover hung here goes the way the menu does: the gear's click,
   * Escape or a click outside (the popover's own), the focus back on the gear.
   */
  function closeObs() {
    onObsClose?.();
    trigger?.focus();
  }

  function close() {
    open = false;
    attempt += 1;
    copied = 'idle';
    trigger?.focus();
  }

  /** Acts, then closes — for the rows that finish here in one click. */
  function act(run: () => void) {
    run();
    close();
  }

  // The same doctrine as every other popover on this page: focus moves in on
  // open, Escape and a pointer outside close it, the trigger's own click still
  // reaches `toggle` because the trigger is inside `root`.
  $effect(() => {
    if (!open) return;
    menu?.querySelector<HTMLElement>('button, select')?.focus();
  });

  $effect(() => {
    if (!open) return;

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !escapeClosesPicker(event)) close();
    };
    const onPointer = (event: PointerEvent) => {
      if (!root?.contains(event.target as Node)) close();
    };

    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
    };
  });
</script>

<div class="settings" bind:this={root}>
  <!-- Its name, and what there is to check, on the page's tooltip (board
       Editor-Tooltip); none while its menu is open, which says it already. -->
  <Tooltip text={open || obsOpen ? null : title}>
    {#snippet children()}
      <button
        type="button"
        class="trigger he-icon-btn"
        data-settings-trigger
        aria-label={title}
        aria-expanded={open}
        aria-haspopup="dialog"
        bind:this={trigger}
        onclick={() => (obsOpen ? closeObs() : open ? close() : (open = true))}
      >
        <Settings size={16} />
        {#if flagged}
          <span class="dot" data-flagged></span>
        {/if}
      </button>
    {/snippet}
  </Tooltip>

  {#if open}
    <!-- A `dialog` of ordinary controls, not a `menu`: nothing here answers to
         the arrow keys, only Tab does (the ProfileBar reasoning). -->
    <div class="menu" data-settings-menu role="dialog" aria-label="Settings" bind:this={menu}>
      <!-- Deliberately first and quiet: an edge case that matters only when
           detection got it wrong (spec §8.6). Only the labels follow it;
           capture is layout-independent. -->
      <label class="row he-menu-item">
        <span>Keyboard layout</span>
        <select
          class="he-select"
          aria-label="Keyboard layout"
          value={layout}
          onchange={(event) =>
            onLayout(event.currentTarget.value as OverlayConfig['layoutOverride'])}
        >
          <option value="auto">Auto</option>
          <option value="azerty">AZERTY</option>
          <option value="qwerty">QWERTY</option>
          <option value="qwertz">QWERTZ</option>
        </select>
      </label>

      <hr />

      <!-- "Choose device…" and not the board's "Rescan devices": the click
           opens Chrome's HID picker, and nothing here performs an automatic
           look. A label that promised one was how someone pressed it four
           times (the App's own note on the gate's action). -->
      <button
        class="row he-menu-item"
        data-action="device"
        type="button"
        onclick={() => act(onPickDevice)}
      >
        Choose device…
      </button>
      <button class="row he-menu-item" data-action="obs" type="button" onclick={() => act(onObs)}>
        <span>OBS connection</span>
        <span class="state" class:down={!obsConnected} data-obs-state>
          {#if !obsConnected}<span class="state-dot" aria-hidden="true"></span>{/if}
          {obsConnected ? 'Connected' : 'Disconnected'}
        </span>
      </button>
      <button class="row he-menu-item" data-action="copy-url" type="button" onclick={copyUrl}>
        {#if copied === 'idle'}
          <span>Copy overlay URL</span>
        {:else}
          <!-- The tooltip carries the way out of a failure: the OBS pill's
               popover has the URL in a field to select by hand. -->
          <Tooltip
            text={copied === 'failed' ? 'Select the URL in the OBS pill’s popover instead' : null}
          >
            {#snippet children()}
              <span class="said" data-copy-label onanimationend={() => (copied = 'idle')}>
                {copied === 'done' ? 'Overlay URL copied' : 'Copy failed'}
              </span>
            {/snippet}
          </Tooltip>
        {/if}
        <span class="icon" aria-hidden="true"><Copy size={16} /></span>
      </button>
      <button
        class="row he-menu-item"
        data-action="diagnostics"
        type="button"
        onclick={() => act(onDiagnostics)}
      >
        <span>Diagnostics</span>
        {#if toCheck > 0}
          <span class="note" data-to-report>{toCheck} to check</span>
        {/if}
      </button>

      <hr />

      <!-- The build, so a bug report can name it without opening Diagnostics
           (spec §11). `__BUILD__` is the tag the image was built from, or
           `dev` — see `vite.config.ts`. -->
      <p class="build" data-build>Halcyon {__BUILD__}</p>
    </div>
  {/if}

  {#if obsOpen && obsPanel}
    {@render obsPanel(closeObs)}
  {/if}
</div>

<style>
  .settings {
    position: relative;
    display: inline-flex;
    align-items: center;
    font: var(--he-font);
  }
  /* Over the corner of the frame, ringed in the page colour so it reads as
     a mark on the button rather than a dot inside it. */
  .dot {
    position: absolute;
    top: -3px;
    right: -3px;
    inline-size: 7px;
    block-size: 7px;
    box-sizing: content-box;
    border: 2px solid var(--he-bg);
    border-radius: 50%;
    background: var(--he-warn);
  }

  .menu {
    position: absolute;
    top: var(--he-menu-offset);
    right: 0;
    z-index: 9;
    inline-size: var(--he-menu-width);
    display: flex;
    flex-direction: column;
    padding: 6px;
    background: var(--he-popover);
    border: 1px solid var(--he-border-popover);
    border-radius: var(--he-radius-panel);
    box-shadow: var(--he-shadow-menu);
    font-size: var(--he-size-sm);
    color: var(--he-text-muted);
  }

  .row {
    all: unset;
    box-sizing: border-box;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 8px 10px;
    border-radius: var(--he-radius);
    font-size: var(--he-size-sm);
    color: var(--he-text-muted);
  }
  .row:focus-within {
    background: var(--he-highlight);
    color: var(--he-text);
  }
  /* The keyboard layout list sits in a row that already lights up with the
     focus, as a menu's options do: no ring of its own on top. */
  .row select:focus-visible {
    outline: none;
  }
  .note {
    font-size: var(--he-size-xs);
    color: var(--he-warn);
  }
  /* OBS connection's state, like the Diagnostics count: muted when OBS
     answers, red with its dot when it does not (board Editor-Settings). */
  .state {
    display: flex;
    align-items: center;
    gap: 7px;
    font-size: var(--he-size-xs);
    color: var(--he-text-muted);
  }
  .state.down {
    color: var(--he-danger);
  }
  .state-dot {
    flex: none;
    inline-size: 8px;
    block-size: 8px;
    border-radius: 50%;
    background: var(--he-danger);
  }

  /* Holds the message two seconds, then ends it (animationend). */
  .said {
    animation: said 2s linear forwards;
  }
  @keyframes said {
    to {
      opacity: 1;
    }
  }
  .icon {
    display: inline-grid;
    color: var(--he-text-muted);
  }
  hr {
    inline-size: auto;
    block-size: 1px;
    margin: 5px 4px;
    border: none;
    background: var(--he-border);
  }

  .build {
    margin: 0;
    padding: 8px 10px;
    font-size: var(--he-size-xs);
    color: var(--he-text-muted);
  }
</style>
