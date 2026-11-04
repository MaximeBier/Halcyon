<script lang="ts">
  import { fontStack } from '../config/fonts';
  import type { InstalledFamily } from './installed-fonts';

  /**
   * The fonts installed on this machine, as a list to pick a label's family
   * from — or, when Chrome refused, what to do about it.
   *
   * Each name is drawn in itself: a list of two hundred names is read by
   * shape long before it is read by spelling.
   */
  let {
    families,
    current,
    onPick,
  }: {
    families: readonly InstalledFamily[] | 'denied';
    /** The family in force, ticked when it is in the list. */
    current: string;
    onPick: (family: InstalledFamily) => void;
  } = $props();

  let query = $state('');
  let search = $state<HTMLInputElement | null>(null);

  const shown = $derived(
    families === 'denied'
      ? []
      : families.filter(({ family }) => family.toLowerCase().includes(query.trim().toLowerCase())),
  );

  $effect(() => {
    search?.focus();
  });
</script>

<div class="menu" data-installed-menu role="dialog" aria-label="Installed fonts">
  {#if families === 'denied'}
    <p class="title">Installed</p>
    <p class="blocked">Chrome blocked access to your fonts.</p>
    <p class="hint">
      Allow “Fonts” in this site’s settings (the icon left of the address), then click the tile
      again.
    </p>
  {:else}
    <p class="title">Installed · {families.length}</p>
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
         other PC, and in a key whose label is an arrow or an icon. -->
    <p class="hint">
      Must also be installed on the PC running OBS. Arrows and icons may be missing.
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
