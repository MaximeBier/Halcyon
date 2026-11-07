<script lang="ts">
  import { Plus, Square } from './icons';
  import Tooltip from './Tooltip.svelte';
  let {
    learning = $bindable(false),
    disabled = false,
    onCancel,
    onArm,
  }: {
    learning: boolean;
    /**
     * No keyboard to learn from. Dimmed and inert rather than hidden: someone
     * who cannot see the feature cannot plan for it, and cannot tell "not yet"
     * from "not here" (spec §16.5: greyed, never hidden).
     */
    disabled?: boolean;
    onCancel: () => void;
    /** Where the focus waits once armed: the stage, given by the page. */
    onArm?: () => void;
  } = $props();

  /**
   * Armed, the button lets go of the focus. Kept, it turned the next Enter or
   * Space into a click on Stop capture, and the key the stream had just
   * learned was taken back with it (`learnedByStopPress`). Escape and this
   * same button, clicked, still stop the capture.
   */
  function toggle(event: MouseEvent & { currentTarget: HTMLButtonElement }) {
    if (learning) {
      onCancel();
      return;
    }
    learning = true;
    event.currentTarget.blur();
    onArm?.();
  }
</script>

<!--
  Learning is a mode rather than a dialog: the matrix index cannot be guessed,
  it can only be observed by pressing the key (spec §8.4). The press has to
  reach the keyboard, so nothing may capture focus while it is waiting.

  One button, two states — the mockup's board `6c` turns "Add key" into
  "Stop capture" rather than adding a second control beside it. Two buttons
  would mean one of them is always the wrong one to reach for.

  In the profile row since 2026-09-05, at its right end: the room was empty
  there and worth a fold in the sidebar. The button that opens the keyboard
  picker went with the sidebar gate — the keyboard pill is that button now.
-->
<!-- Why it is off, on hover, in the words of the board (Editor-Tooltip): what
     is missing, not the keyboard's state — the pill beside it says that. -->
<Tooltip text={disabled ? 'Connect a keyboard to add keys' : null}>
  {#snippet children(describedBy)}
    <button
      class="add he-btn-primary"
      class:listening={learning}
      type="button"
      aria-pressed={learning}
      aria-describedby={describedBy}
      {disabled}
      onclick={toggle}
    >
      {#if learning}
        <Square size={12} fill="currentColor" />
        Stop capture
      {:else}
        <Plus size={16} />
        Add key
      {/if}
    </button>
  {/snippet}
</Tooltip>

{#if learning}
  <!-- Said out loud for a screen reader, which cannot see the button change
       colour. `polite`: it must not interrupt, only follow. -->
  <span class="sr" role="status">Press the key you want to display.</span>
{/if}

<style>
  /* Listening reverses it: the accent moves to the outline, so the row reads
     as armed rather than as offering something. */
  .add.listening {
    color: var(--he-accent);
    background: var(--he-bg);
  }
  .add.listening:hover:not(:disabled) {
    border-color: var(--he-accent);
    background: var(--he-highlight);
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
