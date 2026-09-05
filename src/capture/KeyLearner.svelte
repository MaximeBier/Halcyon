<script lang="ts">
  let {
    learning = $bindable(false),
    disabled = false,
    reason = '',
    onCancel,
  }: {
    learning: boolean;
    /**
     * No keyboard to learn from. Dimmed and inert rather than hidden: someone
     * who cannot see the feature cannot plan for it, and cannot tell "not yet"
     * from "not here" (the spec §16.8 doctrine `Gated` used to carry).
     */
    disabled?: boolean;
    /** Why it is disabled, phrased as what is missing — shown on hover. */
    reason?: string;
    onCancel: () => void;
  } = $props();
</script>

<!--
  Learning is a mode rather than a dialog: the matrix index cannot be guessed,
  it can only be observed by pressing the key (spec §8.4). The press has to
  reach the keyboard, so nothing may capture focus while it is waiting.

  One button, two states — the mockup's board `6c` turns "+ Add key" into
  "■ Stop capture" rather than adding a second control beside it. Two buttons
  would mean one of them is always the wrong one to reach for.

  In the profile row since 2026-09-05, at its right end: the room was empty
  there and worth a fold in the sidebar. The button that opens the keyboard
  picker went with the sidebar gate — the keyboard pill is that button now.
-->
<button
  class="add"
  class:listening={learning}
  type="button"
  aria-pressed={learning}
  {disabled}
  title={disabled ? reason : undefined}
  onclick={() => (learning ? onCancel() : (learning = true))}
>
  {learning ? '■ Stop capture · listening…' : '+ Add key · press any key'}
</button>

{#if learning}
  <!-- Said out loud for a screen reader, which cannot see the button change
       colour. `polite`: it must not interrupt, only follow. -->
  <span class="sr" role="status">Press the key you want to display.</span>
{/if}

<style>
  .add {
    box-sizing: border-box;
    display: inline-block;
    padding: 7px 16px;

    font: var(--he-font);
    font-size: var(--he-size-xs);
    font-weight: 700;
    white-space: nowrap;
    text-align: center;
    cursor: pointer;

    color: var(--he-bg);
    background: var(--he-accent);
    border: 1px solid var(--he-accent);
    border-radius: var(--he-radius-control);
  }
  .add:hover {
    background: var(--he-accent-hover);
    border-color: var(--he-accent-hover);
  }
  /* Listening reverses it: the accent moves to the outline, so the row reads
     as armed rather than as offering something. */
  .add.listening {
    color: var(--he-accent);
    background: var(--he-bg);
  }
  .add.listening:hover {
    background: var(--he-surface);
  }
  /* The same figure the header's undo buttons dim with: one vocabulary for
     "not available". */
  .add:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .add:disabled:hover {
    background: var(--he-accent);
    border-color: var(--he-accent);
  }
  .add:focus-visible {
    outline: 2px solid var(--he-accent);
    outline-offset: 2px;
  }

  .sr {
    position: absolute;
    inline-size: 1px;
    block-size: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
</style>
