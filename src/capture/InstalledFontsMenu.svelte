<script lang="ts">
  import { FONT_CATALOG, fontStack } from '../config/fonts';
  import type { InstalledFamily } from './installed-fonts';

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
</script>

<div
  class="menu"
  data-installed-menu
  role="dialog"
  aria-label={onPickFace ? 'Fonts' : 'Installed fonts'}
>
  {#if inherit}
    <button
      type="button"
      class="family"
      class:on={current === null}
      data-inherit
      onclick={inherit.onPick}
    >
      <span>Global <span class="aside">· {inherit.family}</span></span>
      {#if current === null}<span class="tick" aria-hidden="true">✓</span>{/if}
    </button>
  {/if}
  {#if onPickFace}
    {#if inherit}<hr />{/if}
    <p class="title">Built-in</p>
    {#each FONT_CATALOG as { family, weight } (family)}
      <button
        type="button"
        class="family"
        class:on={family === current}
        data-face={family}
        onclick={() => onPickFace(family, weight)}
      >
        <span style:font-family={fontStack(family)} style:font-weight={weight}>{family}</span>
        {#if family === current}<span class="tick" aria-hidden="true">✓</span>{/if}
      </button>
    {/each}
  {/if}
  {#if inherit || onPickFace}
    {#if families !== null || onRead}<hr />{/if}
  {/if}

  {#if families === 'denied'}
    <p class="title">Installed</p>
    <p class="blocked">Chrome blocked access to your fonts.</p>
    <p class="hint">
      Allow “Fonts” in this site’s settings (the icon left of the address), then {retry}.
    </p>
  {:else if families === null}
    {#if onRead}
      <button type="button" class="family" data-read-installed onclick={onRead}>
        Installed fonts…
      </button>
    {/if}
  {:else}
    <p class="title">Installed · {list.length}</p>
    <div class="search">
      <input
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
          class="family"
          class:on={entry.family === current}
          data-family={entry.family}
          onclick={() => onPick(entry)}
        >
          <span style:font-family={fontStack(entry.family)}>{entry.family}</span>
          {#if entry.family === current}<span class="tick" aria-hidden="true">✓</span>{/if}
        </button>
      {/each}
    </div>
    <hr />
    <!-- Both of these happen after the choice, where nobody is looking: on the
         other PC, and in a key whose label is an arrow or an icon. The second
         is left out of the key popover, opened on keys chosen for their font:
         whoever is there already knows what they want those keys to show. -->
    <p class="hint">
      Must also be installed on the PC running OBS.{#if !onPickFace}
        Arrows and icons may be missing.{/if}
    </p>
  {/if}
</div>

<style>
  .menu {
    position: absolute;
    top: calc(100% + 4px);
    right: 0;
    z-index: 9;
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
    background: var(--he-stage);
    border: 1px solid var(--he-border-control);
    border-radius: var(--he-radius);
  }
  input::placeholder {
    color: var(--he-text-faint);
  }
  input:focus-visible {
    outline: 2px solid var(--he-accent);
    outline-offset: 1px;
  }
  /* Long enough for a screenful of names, short enough to stay inside the
     sidebar: two hundred families would otherwise run off the page. */
  .list {
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
  .family:hover,
  .family:focus-visible,
  .family.on {
    background: var(--he-surface);
    color: var(--he-text);
  }
  /* The name of the global font beside "Global": what inheriting means here,
     said in the interface's face — it is a reminder, not a sample. */
  .aside {
    font-weight: 400;
    color: var(--he-text-faint);
  }
  .tick {
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
  .hint {
    padding: 6px 10px 8px;
    font-size: var(--he-size-xs);
    line-height: 1.4;
    color: var(--he-text-faint);
  }
</style>
