<script lang="ts">
  import { selectOnFocus } from './select-on-focus';
  import { Check, Plus } from './icons';
  import HelpText from './HelpText.svelte';
  import { FONT_CATALOG, fontStack } from '../config/fonts';
  import type { InstalledFamily } from './installed-fonts';
  import { menuPlacement, type MenuPlacement } from './menu-placement';

  /**
   * The fonts installed on this machine, as a list to pick a label's family
   * from — or, when Chrome refused, what to do about it.
   *
   * Each name is drawn in itself: a list of two hundred names is read by
   * shape long before it is read by spelling.
   *
   * The key popover opens the same menu with two things on top: "Global",
   * the way back to the overlay's own font, and the embedded faces, which the
   * global panel shows as tiles instead. Its installed section may also be
   * unread yet, and is then a row to click — the gesture Chrome asks for.
   */
  let {
    families,
    current,
    onPick,
    inherit = null,
    onPickFace = null,
    onRead = null,
    retry = 'click the tile again',
  }: {
    /** `null`: not read yet, and offered as a row when `onRead` is given. */
    families: readonly InstalledFamily[] | 'denied' | null;
    /** The family in force, ticked where it appears — `null` when inherited. */
    current: string | null;
    onPick: (family: InstalledFamily) => void;
    /** The global font, offered first, ticked when `current` is null. */
    inherit?: { family: string; onPick: () => void } | null;
    /** Lists the embedded faces under "Global" when given. */
    onPickFace?: ((family: string, weight: number) => void) | null;
    onRead?: (() => void) | null;
    /** How to try again once fonts are allowed, said in the place's own words. */
    retry?: string;
  } = $props();

  let query = $state('');
  let search = $state<HTMLInputElement | null>(null);

  const list = $derived(Array.isArray(families) ? families : []);
  const shown = $derived(
    list.filter(({ family }) => family.toLowerCase().includes(query.trim().toLowerCase())),
  );

  $effect(() => {
    search?.focus();
  });

  /**
   * In the top layer (spec §8.9), placed in the window from the element it
   * hangs from — its parent: the tile, the popover's font row. Inside the side
   * panel's scrolling section it slid under Keys; in a key's popover it could
   * run off the bottom of the screen. Placed again when the window or any
   * scrolling ancestor moves, and when its content changes height (the list
   * arriving once Chrome answers). Still a child of its parent in the DOM, so
   * the outside-click tests of both callers hold.
   */
  let menuEl = $state<HTMLElement | null>(null);
  let at = $state<MenuPlacement | null>(null);

  function place() {
    const anchor = menuEl?.parentElement;
    if (!menuEl || !anchor) return;
    const box = anchor.getBoundingClientRect();
    at = menuPlacement(
      { x: box.left, y: box.top, w: box.width, h: box.height },
      // The content's own height, whatever cap is on the box: the side is
      // chosen for the whole menu, not for the room it was last given.
      { width: menuEl.offsetWidth, height: menuEl.scrollHeight },
      { width: window.innerWidth, height: window.innerHeight },
    );
  }

  $effect(() => {
    if (!menuEl) return;
    menuEl.showPopover?.();
    place();
    const observer = new ResizeObserver(place);
    observer.observe(menuEl);
    window.addEventListener('resize', place);
    document.addEventListener('scroll', place, true);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', place);
      document.removeEventListener('scroll', place, true);
    };
  });
</script>

<div
  class="menu"
  data-installed-menu
  role="dialog"
  aria-label={onPickFace ? 'Fonts' : 'Installed fonts'}
  popover="manual"
  bind:this={menuEl}
  style:left={`${at?.left ?? 0}px`}
  style:top={`${at?.top ?? 0}px`}
  style:max-height={`${at?.maxHeight ?? 0}px`}
>
  {#if inherit}
    <button
      type="button"
      class="family he-menu-item"
      class:on={current === null}
      data-inherit
      onclick={inherit.onPick}
    >
      <span>Global <span class="aside">· {inherit.family}</span></span>
      {#if current === null}<span class="tick" data-tick aria-hidden="true"
          ><Check size={16} /></span
        >{/if}
    </button>
  {/if}
  {#if onPickFace}
    {#if inherit}<hr />{/if}
    <p class="title">Built-in</p>
    {#each FONT_CATALOG as { family, weight } (family)}
      <button
        type="button"
        class="family he-menu-item"
        class:on={family === current}
        data-face={family}
        onclick={() => onPickFace(family, weight)}
      >
        <span style:font-family={fontStack(family)} style:font-weight={weight}>{family}</span>
        {#if family === current}<span class="tick" data-tick aria-hidden="true"
            ><Check size={16} /></span
          >{/if}
      </button>
    {/each}
  {/if}
  <!-- In the key popover, under the built-in faces (board Menu Font du popover
       touche), the installed section shows only what is there to show:
       unread, the place to click and nothing else; refused, why; read, the
       list — and nothing at all when the machine has no font to offer. The
       panel's menu, opened from its tile, keeps its title in every state. -->
  {#if families === 'denied'}
    {#if onPickFace}<hr />{:else}<p class="title">Installed</p>{/if}
    <p class="blocked">Chrome blocked access to your fonts.</p>
    <p class="hint">
      Allow “Fonts” in this site’s settings (the icon left of the address), then {retry}.
    </p>
  {:else if families === null}
    {#if onRead}
      <!-- The gesture Chrome wants, right under the faces: drawn as the panel's
           empty fourth tile is — an empty place to fill — never a row that
           reads like a heading. -->
      <div class="ask-row">
        <button type="button" class="ask he-slot" data-read-installed onclick={onRead}>
          <Plus size={14} aria-hidden="true" /> Installed font
        </button>
      </div>
    {/if}
  {:else if list.length > 0 || !onPickFace}
    {#if inherit || onPickFace}<hr />{/if}
    <p class="title">Installed · {list.length}</p>
    <div class="search">
      <input
        use:selectOnFocus
        bind:this={search}
        bind:value={query}
        type="search"
        placeholder="Search fonts"
        aria-label="Search fonts"
      />
    </div>
    <div class="list">
      {#each shown as entry (entry.family)}
        <button
          type="button"
          class="family he-menu-item"
          class:on={entry.family === current}
          data-family={entry.family}
          onclick={() => onPick(entry)}
        >
          <span style:font-family={fontStack(entry.family)}>{entry.family}</span>
          {#if entry.family === current}<span class="tick" data-tick aria-hidden="true"
              ><Check size={16} /></span
            >{/if}
        </button>
      {/each}
    </div>
    <!-- Ruled off in the panel's menu; straight under the list in the key
         popover's (both boards). -->
    {#if !onPickFace}<hr />{/if}
    <!-- Both of these happen after the choice, where nobody is looking: on the
         other PC, and in a key whose label is an arrow or an icon. The second
         is left out of the key popover, opened on keys chosen for their font:
         whoever is there already knows what they want those keys to show. -->
    <div class="help">
      <HelpText>
        Must also be installed on the PC running OBS.{#if !onPickFace}{' '}Arrows and icons may be
          missing.{/if}
      </HelpText>
    </div>
  {/if}
</div>

<style>
  /* In the top layer, placed by `menuPlacement`: the popover's own inset and
     margin cleared, its height capped to the room it has — past that, it
     scrolls. */
  .menu {
    position: fixed;
    inset: auto;
    margin: 0;
    overflow-y: auto;
    color: var(--he-text);
    inline-size: var(--he-menu-width);
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    padding: 6px;
    background: var(--he-popover);
    border: 1px solid var(--he-border-popover);
    border-radius: var(--he-radius-panel);
    font: var(--he-font);
  }
  p {
    margin: 0;
  }
  .title {
    padding: 8px 10px 4px;
    font-size: var(--he-size-xs);
    font-weight: 600;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: var(--he-text-muted);
  }
  /* "+ Installed font": the whole width, a dashed edge like the empty
     fourth tile of the panel. */
  .ask-row {
    padding: 4px 6px;
  }
  .ask {
    all: unset;
    box-sizing: border-box;
    inline-size: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    padding: 7px 0;
    border: 1px dashed var(--he-border-hover);
    border-radius: var(--he-radius);
    font-size: var(--he-size-xs);
    color: var(--he-text-muted);
    cursor: pointer;
  }
  .search {
    padding: 4px 6px 6px;
  }
  input {
    inline-size: 100%;
    box-sizing: border-box;
    padding: 5px 9px;
    font: inherit;
    font-size: var(--he-size-xs);
    color: var(--he-text);
    background: var(--he-well);
    border: 1px solid var(--he-border-control);
    border-radius: var(--he-radius);
  }
  input::placeholder {
    color: var(--he-text-muted);
  }
  /* Long enough for a screenful of names, short enough to stay inside the
     sidebar: two hundred families would otherwise run off the page. Short of
     room, the list is what gives way and scrolls — never a rule, a title or
     the search, which a capped column would otherwise squeeze to nothing (the
     1 px rules between Global, Built-in and Installed did). */
  .menu > :not(.list) {
    flex: none;
  }
  .list {
    min-block-size: 0;
    max-block-size: 280px;
    overflow-y: auto;
  }
  .family {
    all: unset;
    box-sizing: border-box;
    inline-size: 100%;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 7px 10px;
    border-radius: var(--he-radius);
    font-size: var(--he-size-sm);
    font-weight: 700;
    color: var(--he-text-muted);
  }
  .family:focus-visible,
  .family.on {
    background: var(--he-highlight);
    color: var(--he-text);
  }
  /* The name of the global font beside "Global": what inheriting means here,
     said in the interface's face — it is a reminder, not a sample. */
  .aside {
    font-weight: 400;
    color: var(--he-text-muted);
  }
  .tick {
    display: inline-grid;
    color: var(--he-accent);
  }
  hr {
    block-size: 1px;
    margin: 5px 4px;
    border: none;
    background: var(--he-border);
  }
  .blocked {
    padding: 6px 10px 2px;
    font-size: var(--he-size-sm);
    line-height: 1.4;
    color: var(--he-text);
  }
  .hint,
  .help {
    padding: 6px 10px 8px;
    font-size: var(--he-size-xs);
    line-height: 1.4;
    color: var(--he-text-muted);
  }
</style>
