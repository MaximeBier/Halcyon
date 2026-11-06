<script lang="ts">
  import { X } from './icons';
  import type { Snippet } from 'svelte';

  /**
   * A panel that floats over the stage, under the header's right edge: where
   * Diagnostics lives since the sidebar footer went (board 3a, ⚙ menu).
   *
   * Not a modal. The page behind stays live and clickable — the readings in
   * it follow the keyboard, and the probe is meant to run while one goes
   * back to work. Escape, the ✕ and a pointer outside close it.
   */
  let {
    title,
    onClose,
    children,
  }: {
    title: string;
    onClose: () => void;
    children: Snippet;
  } = $props();

  let root = $state<HTMLElement | null>(null);

  // `role="dialog"` promises the platform that opening it moves the focus in;
  // the panel itself takes it (`tabindex="-1"`), there being no single first
  // control worth landing on.
  $effect(() => {
    root?.focus();
  });

  $effect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    const onPointer = (event: PointerEvent) => {
      if (!root?.contains(event.target as Node)) onClose();
    };

    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
    };
  });
</script>

<div class="sheet" data-sheet role="dialog" aria-label={title} tabindex="-1" bind:this={root}>
  <header>
    <h2>{title}</h2>
    <button
      type="button"
      class="close he-icon-btn he-icon-btn--bare"
      data-close
      aria-label="Close"
      onclick={onClose}><X size={16} /></button
    >
  </header>
  <div class="body">
    {@render children()}
  </div>
</div>

<style>
  .sheet {
    /* Fixed, so it stays under the header while a stacked page scrolls. */
    position: fixed;
    /* Under the header's edge, 16 px off the bottom of the window: the title
       and the ✕ stay put, the body scrolls (spec §16.12). */
    top: calc(var(--he-header-height) + 6px);
    right: 8px;
    z-index: 8;
    inline-size: var(--he-sheet-width);
    max-block-size: calc(100vh - var(--he-header-height) - 22px);
    display: flex;
    flex-direction: column;
    background: var(--he-popover);
    border: 1px solid var(--he-border-popover);
    border-radius: var(--he-radius-panel);
    box-shadow: var(--he-shadow-menu);
    font: var(--he-font);
    color: var(--he-text);
  }
  header {
    flex: none;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 10px 10px 14px;
    border-block-end: 1px solid var(--he-border);
  }
  h2 {
    margin: 0;
    font-size: var(--he-size-sm);
    font-weight: 600;
  }
  .body {
    min-block-size: 0;
    overflow-y: auto;
  }
</style>
