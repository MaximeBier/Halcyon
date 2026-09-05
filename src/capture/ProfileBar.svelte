<script lang="ts">
  /**
   * The profile tab bar of board `3a`: one tab per profile under the header,
   * the active one underlined and carrying its `⋯`, a `+` at the end.
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
    status,
    statusWarn = false,
    onSelect,
    onCreate,
    onDuplicate,
    onRename,
    onRemove,
    onExport,
    onImport,
  }: {
    names: readonly string[];
    active: string;
    /**
     * Read on render, not held. The caller decides where the figure comes
     * from — the open profile's count changes with every key learned, the
     * others cannot move while they are not on screen.
     */
    keyCount: (name: string) => number;
    /** The line that stays (spec §16.6), under the active tab's menu. */
    status: string;
    /** Amber, per the mockup: a fact worth keeping visible, not just readable. */
    statusWarn?: boolean;
    onSelect: (name: string) => void;
    onCreate: (name: string) => void;
    onDuplicate: () => void;
    onRename: (name: string) => void;
    onRemove: () => void;
    onExport: () => void;
    onImport: (file: File) => void;
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

  $effect(() => {
    if (menu === null) return;

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    // `pointerdown`, not `click`: the popover must be gone before whatever was
    // clicked underneath it reacts. The anchor is the slot the popover hangs
    // from — trigger included — so the trigger's own click still reaches
    // `toggle` and closes it there.
    const onPointer = (event: PointerEvent) => {
      const anchor = popoverEl?.parentElement;
      if (anchor && !anchor.contains(event.target as Node)) close();
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
      bind:this={nameField}
      data-name-field
      type="text"
      value={editing === 'rename' ? active : ''}
      placeholder="Profile name"
      aria-label={editing === 'rename' ? 'Rename this profile' : 'New profile name'}
    />
    <button type="submit" class="ok" aria-label="Confirm">✓</button>
    <button type="button" class="cancel" aria-label="Cancel" onclick={close}>✕</button>
  </form>
{/snippet}

<!--
  Plain buttons with `aria-current`, not a `tablist`: that role promises
  arrow-key navigation this row does not deliver — only Tab does — and the
  stage below is not a `tabpanel` of anything. Buttons stay buttons, the
  popovers stay `dialog`s of ordinary controls, for the same reason.
-->
<nav class="tabs" aria-label="Profiles">
  {#each names as name (name)}
    <div class="slot" class:current={name === active}>
      <button
        type="button"
        class="tab"
        data-tab={name}
        aria-current={name === active ? 'true' : undefined}
        onclick={() => select(name)}
        ondblclick={(event) => rename(event.currentTarget)}
        oncontextmenu={(event) => context(name, event)}
      >
        <span class="name">{name}</span>
        <span class="count">{keyCount(name)}</span>
      </button>

      {#if name === active}
        <!-- On the active tab only: every action behind it acts on the open
             profile, so a `⋯` on the others would promise what a click there
             cannot keep. A sibling of the tab, never inside it — a button in
             a button is not a thing. -->
        <button
          type="button"
          class="more"
          data-more
          aria-label={`Options for “${name}”`}
          aria-expanded={menu === 'tab'}
          aria-haspopup="dialog"
          onclick={(event) => toggle('tab', event.currentTarget)}
        >
          ⋯
        </button>

        {#if menu === 'tab'}
          <div
            class="popover"
            data-menu
            role="dialog"
            aria-label="Profile options"
            bind:this={popoverEl}
          >
            {#if editing}
              {@render field()}
            {:else}
              <button
                class="row"
                data-action="duplicate"
                type="button"
                onclick={() => act(onDuplicate)}
              >
                Duplicate “{active}”
              </button>
              <button
                class="row"
                data-action="rename"
                type="button"
                onclick={() => (editing = 'rename')}
              >
                Rename “{active}”…
              </button>
              <!-- Nothing to delete when one profile is left: the store always
                   keeps one, and a row that answers a click with nothing is
                   how someone presses it four times. -->
              {#if names.length > 1}
                <button
                  class="row danger"
                  class:armed={confirming}
                  data-action="remove"
                  type="button"
                  onclick={remove}
                >
                  {confirming ? `Really delete “${active}”?` : `Delete “${active}”`}
                </button>
              {/if}

              <hr />

              <button class="row" data-action="export" type="button" onclick={() => act(onExport)}>
                Export “{active}” as JSON
              </button>

              {#if status}
                <span class="status" class:warn={statusWarn}>{status}</span>
              {/if}
            {/if}
          </div>
        {/if}
      {/if}
    </div>
  {/each}

  <div class="slot">
    <button
      type="button"
      class="add"
      data-add
      aria-label="Add a profile"
      aria-expanded={menu === 'add'}
      aria-haspopup="dialog"
      onclick={(event) => toggle('add', event.currentTarget)}
    >
      +
    </button>

    {#if menu === 'add'}
      <div class="popover" data-menu role="dialog" aria-label="Add a profile" bind:this={popoverEl}>
        {#if editing}
          {@render field()}
        {:else}
          <button class="row" data-action="new" type="button" onclick={() => (editing = 'new')}>
            New profile…
          </button>
          <!-- Here and not in the per-profile menu: `importFrom` always lands
               the file in a profile of its own, beside the others, never in
               the open one. A real label around a real file input: no click
               forwarding, and the keyboard reaches the picker the way it
               reaches everything else. -->
          <label class="row">
            Import JSON…
            <input class="file" type="file" accept="application/json" onchange={pick} />
          </label>
        {/if}
      </div>
    {/if}
  </div>
</nav>

<style>
  .tabs {
    flex: none;
    display: flex;
    align-items: stretch;
    gap: 4px;
    block-size: var(--he-tab-row-height);
    padding: 0 20px;
    border-block-end: 1px solid var(--he-border);
    font: var(--he-font);
    font-size: var(--he-size-sm);
    color: var(--he-text-muted);
  }
  .slot {
    position: relative;
    display: flex;
    align-items: stretch;
    min-inline-size: 0;
  }
  .tab {
    all: unset;
    box-sizing: border-box;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 9px;
    min-inline-size: 0;
    padding: 0 18px;
    /* Transparent rather than absent, so the active underline adds no height. */
    border-block-end: 2px solid transparent;
    color: var(--he-text-muted);
  }
  /* The `⋯` sits inside the active tab's padding, so the tab gives up its
     right half of it and the two read as one control. */
  .current .tab {
    padding-inline-end: 0;
    font-weight: 600;
    color: var(--he-text);
    border-block-end-color: var(--he-accent);
  }
  .tab:hover {
    color: var(--he-text);
  }
  .tab:focus-visible,
  .more:focus-visible,
  .add:focus-visible {
    outline: 2px solid var(--he-accent);
    outline-offset: -2px;
  }
  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .count {
    flex: none;
    font-weight: 400;
    font-size: var(--he-size-xs);
    color: var(--he-text-faint);
  }
  .more {
    all: unset;
    box-sizing: border-box;
    cursor: pointer;
    display: flex;
    align-items: center;
    padding: 0 18px 0 9px;
    /* The same invisible underline as the tab beside it, and the same accent:
       the two are one tab to the eye. */
    border-block-end: 2px solid var(--he-accent);
    font-size: var(--he-size-xs);
    color: var(--he-text-faint);
  }
  .more:hover,
  .more[aria-expanded='true'] {
    color: var(--he-text);
  }
  .add {
    all: unset;
    box-sizing: border-box;
    cursor: pointer;
    display: flex;
    align-items: center;
    padding: 0 14px;
    color: var(--he-text-faint);
  }
  .add:hover,
  .add[aria-expanded='true'] {
    color: var(--he-text);
  }

  .popover {
    position: absolute;
    /* Flush under the row's bottom border, hanging from the tab it belongs to. */
    top: 100%;
    left: 0;
    z-index: 9;
    inline-size: var(--he-menu-width);
    display: flex;
    flex-direction: column;
    padding: 6px;
    background: var(--he-popover);
    border: 1px solid var(--he-border-popover);
    border-radius: var(--he-radius-panel);
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
  .row:hover,
  .row:focus-visible,
  .row:focus-within {
    background: var(--he-surface);
    color: var(--he-text);
  }
  .row.danger {
    color: var(--he-danger);
  }
  .row.danger.armed {
    font-weight: 600;
    background: var(--he-surface);
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
    background: var(--he-stage);
    border: 1px solid var(--he-accent);
    border-radius: var(--he-radius);
    padding: 5px 9px;
  }
  .edit input:focus-visible {
    outline: none;
  }
  .ok,
  .cancel {
    all: unset;
    cursor: pointer;
    padding: 4px;
    font-size: var(--he-size-xs);
  }
  .ok {
    color: var(--he-ok);
  }
  .cancel {
    color: var(--he-text-muted);
  }
  .ok:focus-visible,
  .cancel:focus-visible {
    outline: 2px solid var(--he-accent);
    outline-offset: 1px;
    border-radius: 2px;
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

  .status {
    padding: 4px 10px 5px;
    font-size: var(--he-size-xs);
    line-height: 1.4;
    color: var(--he-text-faint);
  }
  .status.warn {
    color: var(--he-override);
  }
</style>
