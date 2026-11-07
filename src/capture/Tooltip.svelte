<!--
  The page's tooltip (board Editor-Tooltip): one sentence, when an element
  needs one — what it does, or why it is off. Not a stand-in for `title` on
  every control: an icon button keeps its `aria-label`, and gets this only
  where the board draws one.

  In the top layer (`popover="manual"`), so no panel that scrolls can cut it.
  Above its element, under it when the window's top is too close; it opens
  400 ms into a hover — the stylesheet's delay, never a timer (spec §2) — or
  at once for the keyboard, and closes the moment the pointer or the focus
  leaves.

  A disabled control takes no pointer events, so its host would never hear
  the hover: inside a host, a disabled element lets the pointer through to
  it. The children get the tooltip's id, to describe themselves with.
-->
<script lang="ts">
  import { untrack } from 'svelte';
  import type { Snippet } from 'svelte';
  import { tooltipPlacement, type TooltipPlacement } from './tooltip-placement';

  let {
    text,
    block = false,
    shrink = false,
    children,
  }: {
    /** Nothing to clarify: no tooltip at all. */
    text: string | null | undefined;
    /** A whole row rather than an inline control: the tooltip aligns on its right, over its field. */
    block?: boolean;
    /**
     * In a flex row, the host gives way with what it wraps (a pill whose name
     * may be cut): without it, the host keeps its content's width and nothing
     * inside can shrink.
     */
    shrink?: boolean;
    children: Snippet<[string | undefined]>;
  } = $props();

  const id = $props.id();
  let host = $state<HTMLElement | null>(null);
  let tip = $state<HTMLElement | null>(null);
  let open = $state(false);
  let instant = $state(false);
  let at = $state<TooltipPlacement>({ left: 0, top: 0, below: false, arrow: 0 });

  function show(atOnce: boolean) {
    if (!text || !tip || !host) return;
    instant = atOnce;
    tip.showPopover?.();
    place();
    open = true;
  }

  /** Around the host, for the sentence as it now reads. */
  function place() {
    if (!tip || !host) return;
    const h = host.getBoundingClientRect();
    const t = tip.getBoundingClientRect();
    at = tooltipPlacement(
      { x: h.left, y: h.top, w: h.width, h: h.height },
      { width: t.width, height: t.height },
      { width: window.innerWidth, height: window.innerHeight },
      { row: block },
    );
  }

  /*
   * A sentence that changes while it shows ("Copy overlay URL" → "Overlay URL
   * copied") changes width: placed for the old one, it would sit off-centre.
   * Placed again, after the DOM holds the new text.
   */
  $effect(() => {
    void text;
    if (untrack(() => open)) untrack(place);
  });

  function hide() {
    open = false;
    if (tip?.matches?.(':popover-open')) tip.hidePopover?.();
  }

  /** Keyboard focus only: a click focuses too, and must not pop a sentence. */
  function focused(event: FocusEvent) {
    const target = event.target as Element;
    let visible = true;
    try {
      visible = target.matches(':focus-visible');
    } catch {
      // An engine that cannot answer: say it, rather than hide it.
    }
    if (visible) show(true);
  }
</script>

<!-- The host only watches the pointer to show a description; what it wraps is
     the control, and keeps its own role. -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<span
  class="host"
  class:block
  class:shrink
  data-tooltip-host
  bind:this={host}
  onpointerenter={() => show(false)}
  onpointerleave={hide}
  onfocusin={focused}
  onfocusout={hide}
>
  {@render children(text ? id : undefined)}
  {#if text}
    <span
      bind:this={tip}
      {id}
      class="tip"
      class:instant
      role="tooltip"
      popover="manual"
      data-open={open}
      data-below={at.below}
      style:left={`${at.left}px`}
      style:top={`${at.top}px`}
      style:--arrow={`${at.arrow}px`}>{text}</span
    >
  {/if}
</span>

<style>
  .host {
    display: inline-flex;
  }
  .host.block {
    display: block;
  }
  .host.shrink {
    flex: 0 1 auto;
    min-inline-size: 0;
  }
  .host :global(:disabled) {
    pointer-events: none;
  }

  .tip {
    position: fixed;
    inset: auto;
    margin: 0;
    box-sizing: border-box;
    max-inline-size: var(--he-tooltip-max-width);
    padding: 6px 10px;
    overflow: visible;
    background: var(--he-tooltip);
    border: 1px solid var(--he-border-hover);
    border-radius: var(--he-radius);
    box-shadow: var(--he-shadow-bar);
    font: var(--he-font);
    font-size: var(--he-size-xs);
    line-height: 1.4;
    color: var(--he-text);
    white-space: normal;
    pointer-events: none;
    opacity: 0;
    animation: he-tip-in 1ms 400ms forwards;
  }
  .tip.instant {
    animation-delay: 0s;
  }
  /* The arrow: an 8 px square turned a quarter, half of it out of the box,
     pointing at the element whatever the box's slide. */
  .tip::after {
    content: '';
    position: absolute;
    left: var(--arrow);
    bottom: -5px;
    inline-size: 8px;
    block-size: 8px;
    translate: -50% 0;
    rotate: 45deg;
    background: var(--he-tooltip);
    border: solid var(--he-border-hover);
    border-width: 0 1px 1px 0;
  }
  .tip[data-below='true']::after {
    top: -5px;
    bottom: auto;
    border-width: 1px 0 0 1px;
  }
  @keyframes he-tip-in {
    to {
      opacity: 1;
    }
  }
</style>
