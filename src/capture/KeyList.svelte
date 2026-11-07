<script lang="ts">
  import { hasOverrides } from '../config/resolve';
  import type { OverlayConfig } from '../config/schema';
  import { Pencil, Trash2 } from './icons';
  import Tooltip from './Tooltip.svelte';

  /**
   * The panel's list of keys (spec §16.14, board Editor-SelectionCapture).
   *
   * The row is the only thing that can reach an off-screen key (spec §16.12):
   * its handle is clipped away with the stage overflow. So the row selects —
   * plain, ctrl-toggle, shift-range, which the page decides — and a double
   * click, or the pencil, opens the popover, which already folds itself back
   * inside the stage.
   *
   * One mark per row and one meaning: the accent dot of a style of its own.
   * The `override` and `renamed` words went on 2026-11-06 — a renamed key
   * says so in its popover, where the way back is.
   */
  let {
    keys,
    selectedIds,
    offscreen,
    onPick,
    onEdit,
    onDelete,
    onDeleteSelected,
  }: {
    keys: readonly OverlayConfig['keys'][number][];
    selectedIds: readonly number[];
    /** Keys outside the work surface, which their row is the only way to. */
    offscreen: readonly number[];
    onPick: (id: number, event: MouseEvent) => void;
    onEdit: (id: number) => void;
    onDelete: (id: number) => void;
    onDeleteSelected: () => void;
  } = $props();
</script>

{#if keys.length === 0}
  <p class="fine">No keys yet.</p>
{:else}
  <ul class="keys">
    {#each keys as key (key.id)}
      <li data-key-row={key.id} class="he-list-row" class:selected={selectedIds.includes(key.id)}>
        <button
          class="pick"
          data-pick
          aria-pressed={selectedIds.includes(key.id)}
          onclick={(event) => onPick(key.id, event)}
          ondblclick={() => onEdit(key.id)}
        >
          <span class="label">{key.label}</span>
          {#if hasOverrides(key)}
            <!-- A dot, not a colour on the name: it survives being read by
                 someone who cannot tell the accent from grey. -->
            <Tooltip text="Own style">
              {#snippet children()}
                <span class="own" data-own-style></span>
              {/snippet}
            </Tooltip>
          {/if}
          {#if key.mode === 'axis'}
            <!-- Wootility's word for what the key is bound to; a keyboard key
                 needs no word of its own (spec §16.15). -->
            <span class="mode">gamepad</span>
          {/if}
          {#if offscreen.includes(key.id)}
            <!-- Red: a key nobody can see outranks how it is painted. -->
            <Tooltip
              text="Not on the work surface: widen the window, or lower “Key size” in “Global style”"
            >
              {#snippet children()}
                <span class="offscreen" data-offscreen>off screen</span>
              {/snippet}
            </Tooltip>
          {/if}
        </button>
        <span class="actions">
          <Tooltip text="Edit">
            {#snippet children()}
              <button
                type="button"
                class="he-icon-btn he-icon-btn--bare"
                data-edit
                aria-label={`Edit ${key.label}`}
                onclick={() => onEdit(key.id)}
              >
                <Pencil size={16} />
              </button>
            {/snippet}
          </Tooltip>
          <Tooltip text="Delete">
            {#snippet children()}
              <button
                type="button"
                class="he-icon-btn he-icon-btn--bare"
                data-delete
                aria-label={`Delete ${key.label}`}
                onclick={() => onDelete(key.id)}
              >
                <Trash2 size={16} />
              </button>
            {/snippet}
          </Tooltip>
        </span>
      </li>
    {/each}
  </ul>

  {#if selectedIds.length > 1}
    <button class="he-btn-tertiary delete-selected" data-delete-selected onclick={onDeleteSelected}>
      Delete {selectedIds.length} selected keys
    </button>
  {/if}
{/if}

<style>
  .fine {
    margin: 0;
    font-size: var(--he-size-xs);
    color: var(--he-text-muted);
    line-height: 1.45;
  }
  .keys {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .keys li {
    display: flex;
    align-items: center;
    gap: 10px;
    box-sizing: border-box;
    block-size: 32px;
    padding: 0 4px 0 8px;
    border-radius: var(--he-radius);
    font-size: var(--he-size-xs);
  }
  .keys li.selected {
    background: var(--he-highlight);
  }
  .pick {
    all: unset;
    display: flex;
    align-items: center;
    gap: 10px;
    flex: 1;
    min-inline-size: 0;
    align-self: stretch;
    cursor: pointer;
  }
  /* Inside: out, the ring touched the rows above and below. */
  .pick:focus-visible {
    outline: 2px solid var(--he-accent);
    outline-offset: -2px;
    border-radius: var(--he-radius);
  }
  .label {
    min-inline-size: 24px;
    font-weight: 700;
    color: var(--he-text);
  }
  .own {
    flex: none;
    inline-size: 6px;
    block-size: 6px;
    border-radius: 50%;
    background: var(--he-accent);
  }
  .mode {
    color: var(--he-text-muted);
  }
  .offscreen {
    font-weight: 600;
    color: var(--he-danger);
    white-space: nowrap;
  }
  /* There on the row under the pointer and on the chosen one; transparent,
     not removed, elsewhere, so the row never changes width as the pointer
     moves and Tab still reaches both — a focused one shows itself. */
  .actions {
    display: flex;
    gap: 2px;
    opacity: 0;
  }
  .keys li:hover .actions,
  .keys li.selected .actions,
  .actions:focus-within {
    opacity: 1;
  }
  .delete-selected {
    align-self: flex-start;
    margin-block-start: 8px;
  }
</style>
