<script lang="ts">
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
    toReport,
    onLayout,
    onPickDevice,
    onDiagnostics,
  }: {
    layout: OverlayConfig['layoutOverride'];
    /** Journal entries that are ours to fix — §9.3: a fold says when it hides one. */
    toReport: number;
    onLayout: (layout: OverlayConfig['layoutOverride']) => void;
    /**
     * Opens Chrome's HID picker. Called straight from the click, never through
     * an await or a timer: WebHID grants the picker to a user gesture and to
     * nothing else.
     */
    onPickDevice: () => void;
    onDiagnostics: () => void;
  } = $props();

  let open = $state(false);
  let root = $state<HTMLElement | null>(null);
  let trigger = $state<HTMLButtonElement | null>(null);
  let menu = $state<HTMLElement | null>(null);

  /**
   * §9.3 on a trigger rather than a fold header: the gear says when what it
   * hides departs from the defaults (a layout forced by hand) or is ours to
   * fix (a bug in the journal). One dot for both — the menu says which.
   */
  const flagged = $derived(layout !== 'auto' || toReport > 0);

  function close() {
    open = false;
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
      if (event.key === 'Escape') close();
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
  <button
    type="button"
    class="trigger"
    data-settings-trigger
    aria-label="Settings"
    aria-expanded={open}
    aria-haspopup="dialog"
    bind:this={trigger}
    onclick={() => (open ? close() : (open = true))}
  >
    <span aria-hidden="true">⚙</span>
    {#if flagged}
      <span
        class="dot"
        data-flagged
        title={toReport > 0 ? 'Something to report in Diagnostics' : 'Keyboard layout set by hand'}
      ></span>
    {/if}
  </button>

  {#if open}
    <!-- A `dialog` of ordinary controls, not a `menu`: nothing here answers to
         the arrow keys, only Tab does (the ProfileBar reasoning). -->
    <div class="menu" data-settings-menu role="dialog" aria-label="Settings" bind:this={menu}>
      <!-- Deliberately first and quiet: an edge case that matters only when
           detection got it wrong (spec §8.6). Only the labels follow it;
           capture is layout-independent. -->
      <label class="row">
        <span>Keyboard layout</span>
        <select
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
      <button class="row" data-action="device" type="button" onclick={() => act(onPickDevice)}>
        Choose device…
      </button>
      <button
        class="row"
        data-action="diagnostics"
        type="button"
        onclick={() => act(onDiagnostics)}
      >
        <span>Diagnostics</span>
        {#if toReport > 0}
          <span class="note" data-to-report>{toReport} to report</span>
        {/if}
      </button>

      <hr />

      <!-- The build, so a bug report can name it without opening Diagnostics
           (spec §11). `__BUILD__` is the tag the image was built from, or
           `dev` — see `vite.config.ts`. -->
      <p class="build" data-build>Halcyon {__BUILD__}</p>
    </div>
  {/if}
</div>

<style>
  .settings {
    position: relative;
    display: inline-flex;
    align-items: center;
    font: var(--he-font);
  }
  .trigger {
    all: unset;
    position: relative;
    cursor: pointer;
    padding: 4px 6px;
    font-size: var(--he-size-sm);
    color: var(--he-text-muted);
  }
  .trigger:hover,
  .trigger[aria-expanded='true'] {
    color: var(--he-text);
  }
  .trigger:focus-visible {
    outline: 2px solid var(--he-accent);
    outline-offset: 1px;
    border-radius: var(--he-radius);
  }
  .dot {
    position: absolute;
    top: 3px;
    right: 2px;
    inline-size: 6px;
    block-size: 6px;
    border-radius: 50%;
    background: var(--he-override);
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
  .row:hover,
  .row:focus-visible,
  .row:focus-within {
    background: var(--he-surface);
    color: var(--he-text);
  }
  .note {
    font-size: var(--he-size-xs);
    color: var(--he-override);
  }

  /* Bare, so the row reads "Keyboard layout · Auto ▾" and not as a form. */
  select {
    font: inherit;
    font-size: var(--he-size-xs);
    color: var(--he-text);
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
  }
  select:focus-visible {
    outline: 2px solid var(--he-accent);
    outline-offset: 2px;
    border-radius: 2px;
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
    color: var(--he-text-faint);
  }
</style>
