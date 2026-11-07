<script module lang="ts">
  /** Anchor names are document-wide: each bar gets its own pair. */
  let instances = 0;
</script>

<script lang="ts">
  import { selectOnFocus } from './select-on-focus';
  import Tooltip from './Tooltip.svelte';
  import { Check, Ellipsis, Plus, X } from './icons';
  import type { Snippet } from 'svelte';

  /**
   * The profile tab bar of board `3a`: one tab per profile under the header,
   * the active one underlined and carrying its `⋯`, a `+` at the end — and,
   * at the far right, whatever the page hands in (`children`: the Add key
   * button, since the room there was empty and worth a fold in the sidebar).
   *
   * Switching is one click and always in view — the dropdown this replaced
   * hid every other profile behind a trigger. The per-profile actions (rename,
   * duplicate, delete, export) sit behind the active tab's `⋯` or a right
   * click; making profiles (new, import) sits behind `+`.
   *
   * It owns no configuration and reads no storage. Every row reports upwards
   * and waits — which is what lets the store stay the only thing that knows
   * what a profile is.
   */
  let {
    names,
    active,
    keyCount,
    onSelect,
    onCreate,
    onDuplicate,
    onRename,
    onRemove,
    onExport,
    onImport,
    children,
  }: {
    names: readonly string[];
    active: string;
    /**
     * Read on render, not held. The caller decides where the figure comes
     * from — the open profile's count changes with every key learned, the
     * others cannot move while they are not on screen.
     */
    keyCount: (name: string) => number;
    onSelect: (name: string) => void;
    onCreate: (name: string) => void;
    onDuplicate: () => void;
    onRename: (name: string) => void;
    onRemove: () => void;
    onExport: () => void;
    onImport: (file: File) => void;
    /** The right end of the row, after the tabs. */
    children?: Snippet;
  } = $props();

  /** Which popover is open: the active tab's, or the one under `+`. */
  let menu = $state<'tab' | 'add' | null>(null);
  /**
   * Which name is being typed, if any. The field replaces the menu's rows
   * rather than joining them: one field, one meaning, and never two — with a
   * rename and a creation open at once, submitting the wrong one renames the
   * profile that is loaded.
   */
  let editing = $state<'new' | 'rename' | null>(null);
  let confirming = $state(false);
  let popoverEl = $state<HTMLElement | null>(null);
  let nameField = $state<HTMLInputElement | null>(null);
  /** The control that opened whatever is open, for the focus to come back to. */
  let opener: HTMLElement | null = null;
  let strip = $state<HTMLElement | null>(null);

  /**
   * The two menus hang outside the strip that scrolls — a scrolling box clips
   * whatever overflows it, on both axes — and find their trigger by CSS anchor
   * positioning, which also follows the strip as it scrolls.
   */
  const id = ++instances;
  const anchors = { tab: `--he-profile-tab-${id}`, add: `--he-profile-add-${id}` };

  function close() {
    menu = null;
    // Both are one-shot states that only make sense inside a session with the
    // popover. Left standing, reopening shows a half-typed name, or an armed
    // delete two clicks from a layout nobody meant to lose.
    editing = null;
    confirming = false;
    // The popover took the focus when it opened, so closing hands it back —
    // otherwise it lands on `<body>` and the next Tab starts from the top of
    // the page, whatever closed it: the trigger, Escape, or a click outside.
    opener?.focus();
    opener = null;
  }

  function toggle(which: 'tab' | 'add', from: HTMLElement) {
    if (menu === which) {
      close();
      return;
    }
    menu = which;
    editing = null;
    confirming = false;
    opener = from;
  }

  /**
   * The tab's own gestures. A click switches; a right click opens the menu on
   * that profile, switching to it first when it is not the open one — every
   * action in the menu acts on the open profile, so that is the honest route
   * to "act on this one". A double click goes straight to the rename field.
   */
  function select(name: string) {
    if (menu !== null) close();
    if (name !== active) onSelect(name);
  }

  function context(name: string, event: MouseEvent & { currentTarget: HTMLElement }) {
    event.preventDefault();
    if (name !== active) onSelect(name);
    menu = 'tab';
    editing = null;
    confirming = false;
    opener = event.currentTarget;
  }

  function rename(from: HTMLElement) {
    menu = 'tab';
    editing = 'rename';
    confirming = false;
    opener = from;
  }

  /** Acts, then closes — for the actions that finish here in one click. */
  function act(run: () => void) {
    run();
    close();
  }

  function submitName(event: SubmitEvent) {
    event.preventDefault();
    const name = nameField?.value.trim() ?? '';
    // The store would name a blank creation "Profile" for us, and refuse a
    // blank rename. Doing nothing is the better answer to both: nobody submits
    // an empty name on purpose.
    if (!name) return;
    act(() => (editing === 'rename' ? onRename(name) : onCreate(name)));
  }

  function remove() {
    // Deleting a profile is the one action here that destroys work nothing can
    // recover. The row asks again rather than opening a dialog: the question
    // belongs where the click was.
    if (!confirming) {
      confirming = true;
      return;
    }
    act(onRemove);
  }

  function pick(event: Event & { currentTarget: HTMLInputElement }) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    // Cleared either way, or picking the same file twice fires nothing — which
    // is exactly what someone does after fixing it by hand.
    input.value = '';
    if (file) act(() => onImport(file));
  }

  // Focus follows the field into existence: the row was clicked to type in it,
  // and a rename hands over a selected name rather than a caret in the middle
  // of one. `editing` is read so that swapping modes refocuses the same node.
  $effect(() => {
    void editing;
    nameField?.select();
  });

  // This is a popover, not a menu, and a popover that leaves the focus behind
  // when it opens is silent: a screen reader announces nothing, and a
  // keyboard user tabs through the rest of the page before reaching the rows
  // they just asked for. Depends on `popoverEl` rather than `menu` alone —
  // that binding only exists once the popover has actually rendered.
  $effect(() => {
    if (menu === null) return;
    popoverEl?.querySelector<HTMLElement>('button, input, select')?.focus();
  });

  // The open profile is always in view: an OBS scene switch can open one that
  // sits past the right edge. The strip scrolls and nothing else — even
  // `scrollIntoView({ block: 'nearest' })` scrolls a stacked page up to this
  // row, at every scene switch, mid-stream.
  $effect(() => {
    const name = active;
    const slot = [...(strip?.querySelectorAll<HTMLElement>('[data-tab]') ?? [])]
      .find((button) => button.dataset.tab === name)
      ?.closest<HTMLElement>('.slot');
    if (!strip || !slot) return;
    const view = strip.getBoundingClientRect();
    const tab = slot.getBoundingClientRect();
    if (tab.left < view.left) strip.scrollLeft += tab.left - view.left;
    else if (tab.right > view.right) strip.scrollLeft += tab.right - view.right;
  });

  $effect(() => {
    if (menu === null) return;

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    // `pointerdown`, not `click`: the popover must be gone before whatever was
    // clicked underneath it reacts. The trigger's slot counts as inside, so the
    // trigger's own click still reaches `toggle` and closes it there.
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      const slot = opener?.closest('.slot');
      if (!popoverEl?.contains(target) && !slot?.contains(target)) close();
    };

    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
    };
  });
</script>

{#snippet field()}
  <!-- The field stands in for the rows rather than under them: while a name
       is being typed nothing else in the menu makes sense to click. -->
  <form class="edit" onsubmit={submitName}>
    <input
      use:selectOnFocus
      bind:this={nameField}
      data-name-field
      type="text"
      value={editing === 'rename' ? active : ''}
      placeholder="Profile name"
      aria-label={editing === 'rename' ? 'Rename this profile' : 'New profile name'}
    />
    <button type="submit" class="ok he-icon-btn he-icon-btn--bare" aria-label="Confirm"
      ><Check size={16} /></button
    >
    <button type="button" class="he-icon-btn he-icon-btn--bare" aria-label="Cancel" onclick={close}
      ><X size={16} /></button
    >
  </form>
{/snippet}

<!--
  Plain buttons with `aria-current`, not a `tablist`: that role promises
  arrow-key navigation this row does not deliver — only Tab does — and the
  stage below is not a `tabpanel` of anything. Buttons stay buttons, the
  popovers stay `dialog`s of ordinary controls, for the same reason.
-->
<nav class="tabs" aria-label="Profiles">
  <!-- Only the tabs and the + scroll (spec §16.9): what the page hands in stays
       pinned at the right end, however many profiles there are. -->
  <div class="strip" data-strip bind:this={strip}>
    {#each names as name (name)}
      <div
        class="slot"
        class:current={name === active}
        style:anchor-name={name === active ? anchors.tab : undefined}
      >
        <button
          type="button"
          class="tab he-text-btn"
          data-tab={name}
          aria-current={name === active ? 'true' : undefined}
          onclick={() => select(name)}
          ondblclick={(event) => rename(event.currentTarget)}
          oncontextmenu={(event) => context(name, event)}
        >
          <span class="name">{name}</span>
          <Tooltip text={`${keyCount(name)} key${keyCount(name) === 1 ? '' : 's'}`}>
            {#snippet children()}
              <span class="count">{keyCount(name)}</span>
            {/snippet}
          </Tooltip>
        </button>

        {#if name === active}
          <!-- On the active tab only: every action behind it acts on the open
             profile, so a `⋯` on the others would promise what a click there
             cannot keep. A sibling of the tab, never inside it — a button in
             a button is not a thing. -->
          <Tooltip text={menu === 'tab' ? null : 'Profile menu'}>
            {#snippet children()}
              <button
                type="button"
                class="more he-icon-btn he-icon-btn--bare"
                data-more
                aria-label={`Options for “${name}”`}
                aria-expanded={menu === 'tab'}
                aria-haspopup="dialog"
                onclick={(event) => toggle('tab', event.currentTarget)}
              >
                <Ellipsis size={16} />
              </button>
            {/snippet}
          </Tooltip>
        {/if}
      </div>
    {/each}

    <!-- After the last tab while they fit; once they overflow, held at the
         strip's right edge, the tabs scrolling — and fading — under it
         (board prototype, noteFluid). Never against Add key: it stays in the
         strip. -->
    <div class="slot pinned" style:anchor-name={anchors.add}>
      <Tooltip text={menu === 'add' ? null : 'New profile'}>
        {#snippet children()}
          <button
            type="button"
            class="add he-icon-btn he-icon-btn--bare he-icon-btn--wide"
            data-add
            aria-label="New profile"
            aria-expanded={menu === 'add'}
            aria-haspopup="dialog"
            onclick={(event) => toggle('add', event.currentTarget)}
          >
            <Plus size={16} />
          </button>
        {/snippet}
      </Tooltip>
    </div>
  </div>

  {#if menu === 'tab'}
    <div
      class="popover"
      style:position-anchor={anchors.tab}
      data-menu
      role="dialog"
      aria-label="Profile options"
      bind:this={popoverEl}
    >
      {#if editing}
        {@render field()}
      {:else}
        <button
          class="row he-menu-item"
          data-action="duplicate"
          type="button"
          onclick={() => act(onDuplicate)}
        >
          Duplicate “{active}”
        </button>
        <button
          class="row he-menu-item"
          data-action="rename"
          type="button"
          onclick={() => (editing = 'rename')}
        >
          Rename “{active}”…
        </button>
        <!-- The store always keeps one profile: with one left, the row stays
             where it is, off, and its tooltip says why (board
             Editor-ProfileMenu). -->
        {@const last = names.length < 2}
        <Tooltip text={last ? 'The last profile cannot be deleted' : null} block>
          {#snippet children(describedBy)}
            <button
              class="row danger he-menu-item he-menu-item--danger"
              class:armed={confirming}
              data-action="remove"
              type="button"
              disabled={last}
              aria-describedby={describedBy}
              onclick={remove}
            >
              {confirming ? `Click again to delete “${active}”` : `Delete “${active}”`}
            </button>
          {/snippet}
        </Tooltip>

        <hr />

        <button
          class="row he-menu-item"
          data-action="export"
          type="button"
          onclick={() => act(onExport)}
        >
          Export “{active}”…
        </button>
      {/if}
    </div>
  {/if}

  {#if menu === 'add'}
    <div
      class="popover"
      style:position-anchor={anchors.add}
      data-menu
      role="dialog"
      aria-label="Add a profile"
      bind:this={popoverEl}
    >
      {#if editing}
        {@render field()}
      {:else}
        <button
          class="row he-menu-item"
          data-action="new"
          type="button"
          onclick={() => (editing = 'new')}
        >
          New profile…
        </button>
        <!-- Here and not in the per-profile menu: `importFrom` always lands
             the file in a profile of its own, beside the others, never in
             the open one. A real label around a real file input: no click
             forwarding, and the keyboard reaches the picker the way it
             reaches everything else. -->
        <label class="row he-menu-item">
          Import profile…
          <input class="file" type="file" accept="application/json" onchange={pick} />
        </label>
      {/if}
    </div>
  {/if}

  {#if children}
    <div class="trailing">
      {@render children()}
    </div>
  {/if}
</nav>

<style>
  .tabs {
    flex: none;
    /* The menus hang from here, outside the strip that scrolls. */
    position: relative;
    display: flex;
    align-items: stretch;
    gap: 4px;
    /* 50 with its bottom border, as the stage counts it (max(560px, 100vh −
       header − tab row)): in content-box the border made 51, and the page
       scrolled by one pixel at full screen. */
    box-sizing: border-box;
    block-size: var(--he-tab-row-height);
    padding: 0 20px;
    border-block-end: 1px solid var(--he-border);
    font: var(--he-font);
    font-size: var(--he-size-sm);
    color: var(--he-text-muted);
  }
  /* Never wraps, never shortens a name: the strip scrolls instead (spec
     §16.9). `contain` keeps a sideways swipe from turning into a page back. */
  .strip {
    flex: 1;
    display: flex;
    align-items: stretch;
    gap: 4px;
    min-inline-size: 0;
    overflow-x: auto;
    overflow-y: hidden;
    overscroll-behavior-x: contain;
  }
  /* A 6 px lane under the underline, the thumb 4 px of it (spec §16.12). */
  .strip::-webkit-scrollbar {
    block-size: 6px;
  }
  .strip::-webkit-scrollbar-thumb {
    border-width: 1px;
    border-radius: 3px;
  }
  /* The underline belongs to the slot, so the active tab and its `⋯` read
     as one tab; transparent elsewhere, so no slot is taller than another. */
  /* A tab is the width of its name, count and ⋯, always: short of room it
     never gives up its padding — which squeezed the ⋯ against the count — it
     is the strip that scrolls (spec §16.9). */
  .slot {
    position: relative;
    flex: none;
    display: flex;
    align-items: stretch;
    white-space: nowrap;
    border-block-end: 2px solid transparent;
  }
  .slot.current {
    border-block-end-color: var(--he-accent);
  }
  .trailing {
    margin-inline-start: auto;
    display: flex;
    align-items: center;
    /* `position: relative` on the row's children would put a popover under
       this; the button carries none, so nothing to stack. */
  }
  .tab {
    all: unset;
    box-sizing: border-box;
    cursor: pointer;
    flex: none;
    display: flex;
    align-items: center;
    gap: 9px;
    white-space: nowrap;
    padding: 0 18px;
    color: var(--he-text-muted);
  }
  /* The `⋯` sits inside the active tab's padding, so the tab gives up its
     right half of it and the two read as one control. */
  .current .tab {
    padding-inline-end: 8px;
    font-weight: 600;
    color: var(--he-text);
  }
  .tab:focus-visible {
    outline: 2px solid var(--he-accent);
    outline-offset: -2px;
  }
  .name {
    white-space: nowrap;
  }
  .count {
    flex: none;
    font-weight: 400;
    font-size: var(--he-size-xs);
    color: var(--he-text-muted);
  }
  /* Sized and coloured by controls.css (bare icon buttons); placed here.
     Nothing else: a scoped rule outranks a global class, and the last one to
     try left the + off-centre and the ⋯ a tall square. */
  .more {
    align-self: center;
    margin-inline-end: 10px;
  }
  .add {
    align-self: center;
  }
  /* The +'s slot: sticky at the strip's right edge, so it follows the last
     tab while they fit and stays in view once they overflow. The whole row's
     height and the page's ground, so a tab passing under is hidden, not seen
     through; the shadow, in the same ground, fades that tab out instead of
     cutting it off. Above the scrollbar's lane, which stays the strip's. */
  .pinned {
    position: sticky;
    inset-inline-end: 0;
    align-self: stretch;
    align-items: center;
    padding-inline-start: 6px;
    background: var(--he-bg);
    box-shadow: -14px 0 12px -6px var(--he-bg);
  }

  .popover {
    position: absolute;
    /* Flush under the row's bottom border, hanging from its trigger's slot. The
       fallback, for a browser without anchor positioning, is the row's start. */
    top: 100%;
    left: 20px;
    z-index: 9;
    inline-size: var(--he-menu-width);
    display: flex;
    flex-direction: column;
    padding: 6px;
    background: var(--he-popover);
    border: 1px solid var(--he-border-popover);
    border-radius: var(--he-radius-panel);
    box-shadow: var(--he-shadow-menu);
  }
  /* Flipped to end at its trigger's right edge when the window has no room
     on the right — the + sits near the pinned Add key, 280 px from nothing. */
  @supports (position-anchor: --a) {
    .popover {
      top: anchor(bottom);
      left: anchor(left);
      position-try-fallbacks: flip-inline;
    }
  }

  .row {
    all: unset;
    box-sizing: border-box;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 8px 10px;
    border-radius: var(--he-radius);
    font-size: var(--he-size-sm);
    color: var(--he-text-muted);
  }
  .row:focus-within {
    background: var(--he-highlight);
    color: var(--he-text);
  }
  /* Inside its tooltip's host, a block: a button there is only as wide as its
     words, and the armed tint would stop short of the menu's edge. */
  .row.danger {
    inline-size: 100%;
    color: var(--he-danger);
  }
  /* Armed on the danger tint: a hover's grey would read as nothing done. */
  .row.danger.armed {
    font-weight: 600;
    background: var(--he-border-danger);
  }

  hr {
    inline-size: auto;
    block-size: 1px;
    margin: 5px 4px;
    border: none;
    background: var(--he-border);
  }

  .edit {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 2px 4px;
  }
  .edit input {
    flex: 1;
    min-inline-size: 0;
    box-sizing: border-box;
    font: inherit;
    font-size: var(--he-size-sm);
    font-weight: 600;
    color: var(--he-text);
    background: var(--he-well);
    /* The rest border of every field; the accent comes with the focus, from
       the shared rule (controls.css) — it opens focused, so it shows. */
    border: 1px solid var(--he-border-control);
    border-radius: var(--he-radius);
    padding: 5px 9px;
  }
  .ok {
    color: var(--he-ok);
  }

  /* Hidden from sight, not from the keyboard: `display: none` would take the
     picker out of the tab order and leave the label pointing at nothing. */
  .file {
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
