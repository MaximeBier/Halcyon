<!--
  The overlay URL, one click from where the layout is made (board Main): a
  bare link icon after "OBS source size", the two things someone carries to
  OBS. The copy itself is the page's one action (App `copyUrl`, shared with
  Settings › Copy overlay URL), which journals it and says whether it happened.

  Done: a green check and "Overlay URL copied" for two seconds. The two
  seconds are a CSS animation that ends the state (`animationend`), never a
  timer — spec §2 keeps timers off this page (the Toast and Settings recipe).
  Failed: "Copy failed", for as long: never a check over an empty clipboard.
-->
<script lang="ts">
  import Tooltip from './Tooltip.svelte';
  import { Check, Link } from './icons';

  let { onCopy }: { onCopy: () => Promise<boolean> } = $props();

  let copied = $state<'idle' | 'done' | 'failed'>('idle');
  /** Bumped on every copy, so a second click restarts the two seconds. */
  let attempt = $state(0);

  const SAID = {
    idle: 'Copy overlay URL',
    done: 'Overlay URL copied',
    failed: 'Copy failed',
  } as const;

  async function copy() {
    const done = await onCopy();
    attempt += 1;
    copied = done ? 'done' : 'failed';
  }
</script>

<Tooltip text={SAID[copied]}>
  {#snippet children()}
    <button
      type="button"
      class="he-icon-btn he-icon-btn--bare"
      data-copy-url
      data-copied={copied}
      aria-label="Copy overlay URL"
      onclick={copy}
    >
      {#key attempt}
        {#if copied === 'idle'}
          <Link size={16} />
        {:else}
          <span
            class="said"
            class:ok={copied === 'done'}
            data-said
            onanimationend={() => (copied = 'idle')}
          >
            {#if copied === 'done'}<Check size={16} />{:else}<Link size={16} />{/if}
          </span>
        {/if}
      {/key}
    </button>
  {/snippet}
</Tooltip>
<!-- The tooltip shows under the pointer only; a screen reader hears it here. -->
<span class="sr" role="status">{copied === 'idle' ? '' : SAID[copied]}</span>

<style>
  /* On the glyph, not the button: the bare button's hover sets the button's
     colour, and the pointer is still on it right after the click. */
  .ok {
    color: var(--he-ok);
  }
  .said {
    display: inline-grid;
    animation: said 2s linear forwards;
  }
  @keyframes said {
    to {
      opacity: 1;
    }
  }
  /* The KeyLearner recipe: present for the reader, absent from the layout. */
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
