<script lang="ts">
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
    <button type="button" class="close" data-close aria-label="Close" onclick={onClose}>✕</button>
  </header>
  <div class="body">
    {@render children()}
  </div>
</div>

<style>
  .sheet {
    position: absolute;
    top: 8px;
    right: 8px;
    z-index: 8;
    inline-size: var(--he-sheet-width);
    max-block-size: calc(100% - 16px);
    display: flex;
    flex-direction: column;
    background: var(--he-popover);
    border: 1px solid var(--he-border-popover);
    border-radius: var(--he-radius-panel);
    font: var(--he-font);
    color: var(--he-text);
  }
  .sheet:focus {
    outline: none;
  }
  header {
    flex: none;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 14px;
    border-block-end: 1px solid var(--he-border);
  }
  h2 {
    margin: 0;
    font-size: var(--he-size-sm);
    font-weight: 600;
  }
  .close {
    all: unset;
    cursor: pointer;
    padding: 2px 6px;
    font-size: var(--he-size-xs);
    color: var(--he-text-muted);
  }
  .close:hover {
    color: var(--he-text);
  }
  .close:focus-visible {
    outline: 2px solid var(--he-accent);
    outline-offset: 1px;
    border-radius: 2px;
  }
  .body {
    min-block-size: 0;
    overflow-y: auto;
    padding: 4px 14px 14px;
  }
</style>
