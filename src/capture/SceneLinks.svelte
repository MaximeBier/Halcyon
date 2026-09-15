<script lang="ts">
  import type { ObsStatus } from '../transport/obs';
  import { linkButtonState, type SceneRow } from './scenes';

  /**
   * "Link OBS scenes": a header trigger and the scene → profile table under
   * it (handoff §1–2, board 5e).
   *
   * In the header and not in the OBS popover: the OBS popover is where one
   * pastes a URL once, this is where one comes back after adding a scene.
   * Same three states as "Start with Windows" — the pitch while the table is
   * empty, muted text once it is not, inert without OBS because there is no
   * list to show without it.
   */
  let {
    obs,
    rows,
    profiles,
    onOpen,
    onLink,
    onUnlink,
  }: {
    obs: ObsStatus;
    rows: SceneRow[];
    profiles: string[];
    /** Every opening: the list is re-read from OBS. */
    onOpen: () => void;
    onLink: (uuid: string, profile: string | null) => void;
    onUnlink: (uuid: string) => void;
  } = $props();

  let open = $state(false);
  let root = $state<HTMLElement | null>(null);
  let trigger = $state<HTMLButtonElement | null>(null);
  let dialog = $state<HTMLElement | null>(null);

  const linked = $derived(rows.filter((row) => row.profile !== null).length);
  // Not named `state`: a local identifier that shadows the dollar-stripped
  // name of a rune turns every other `$state(...)` in the file into a
  // legacy store auto-subscription to it, and svelte-check fails the file.
  const buttonState = $derived(linkButtonState(obs, linked));

  function toggle() {
    if (buttonState === 'inert') return;
    open = !open;
    if (open) onOpen();
  }

  // Losing OBS while the table is open: the rows would go stale under the
  // cursor, and the trigger they hang from is inert now.
  $effect(() => {
    if (buttonState === 'inert') open = false;
  });

  $effect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        open = false;
        trigger?.focus();
      }
    };
    // `pointerdown`, not `click`: the popover must be gone before whatever
    // was clicked underneath it reacts (the ProfileBar menu's reasoning).
    const onPointer = (event: PointerEvent) => {
      if (!root?.contains(event.target as Node)) open = false;
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
    };
  });

  $effect(() => {
    if (open) dialog?.focus();
  });
</script>

<div class="scenes" bind:this={root}>
  <button
    class="trigger"
    data-scenes-trigger
    data-state={buttonState}
    type="button"
    disabled={buttonState === 'inert'}
    title={buttonState === 'inert' ? 'Connect OBS first' : undefined}
    aria-expanded={open}
    aria-haspopup="dialog"
    bind:this={trigger}
    onclick={toggle}
  >
    Link OBS scenes
  </button>

  {#if open}
    <div
      class="menu"
      data-scenes-popover
      role="dialog"
      aria-label="Link OBS scenes"
      tabindex="-1"
      bind:this={dialog}
    >
      <p class="lead">
        When OBS switches to one of these scenes, the profile you pick here opens. Scenes left on
        “—” don't change anything.
      </p>

      {#if rows.length === 0}
        <p class="empty">No scene in OBS yet.</p>
      {:else}
        <ul>
          {#each rows as row (row.uuid)}
            <li data-scene={row.uuid} data-live={row.live} data-missing={row.missing}>
              <span class="dot" aria-hidden="true"></span>
              <span class="name">
                {row.name}
                {#if row.live}<span class="live">· live</span>{/if}
                {#if row.missing}<span class="gone">· not in OBS</span>{/if}
              </span>
              {#if row.missing}
                <span class="profile">{row.profile}</span>
                <button
                  class="unlink"
                  data-unlink
                  type="button"
                  aria-label={`Forget ${row.name}`}
                  onclick={() => onUnlink(row.uuid)}
                >
                  ✕
                </button>
              {:else}
                <!-- Bare, like the layout select in the gear menu: the row reads
                     "Gameplay · Apex ranked ▾", not as a form. -->
                <select
                  data-profile
                  class:unset={row.profile === null}
                  aria-label={`Profile for ${row.name}`}
                  value={row.profile ?? ''}
                  onchange={(event) => onLink(row.uuid, event.currentTarget.value || null)}
                >
                  <option value="">—</option>
                  {#each profiles as name (name)}
                    <option value={name}>{name}</option>
                  {/each}
                </select>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  {/if}
</div>

<style>
  .scenes {
    position: relative;
    display: inline-flex;
    align-items: center;
    font: var(--he-font);
  }
  .trigger {
    all: unset;
    cursor: pointer;
    padding: 4px 11px;
    border: 1px solid var(--he-accent);
    border-radius: var(--he-radius-control);
    font-size: var(--he-size-xs);
    font-weight: 600;
    color: var(--he-accent);
    white-space: nowrap;
  }
  .trigger:hover,
  .trigger[aria-expanded='true'] {
    color: var(--he-stage);
    background: var(--he-accent);
  }
  .trigger:focus-visible {
    outline: 2px solid var(--he-accent);
    outline-offset: 1px;
  }
  .trigger[data-state='quiet'] {
    border-color: transparent;
    font-weight: 400;
    color: var(--he-text-muted);
  }
  .trigger[data-state='quiet']:hover,
  .trigger[data-state='quiet'][aria-expanded='true'] {
    color: var(--he-text);
    background: none;
  }
  .trigger[data-state='inert'] {
    border-color: transparent;
    font-weight: 400;
    color: var(--he-text-muted);
    opacity: 0.4;
    cursor: default;
  }

  .menu {
    position: absolute;
    top: var(--he-menu-offset);
    right: 0;
    z-index: 9;
    inline-size: var(--he-popover-width);
    background: var(--he-popover);
    border: 1px solid var(--he-border-popover);
    border-radius: var(--he-radius-panel);
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.45);
    font-size: var(--he-size-xs);
    color: var(--he-text-muted);
  }
  .menu:focus {
    outline: none;
  }
  .lead {
    margin: 0;
    padding: 14px 14px 10px;
    line-height: 1.5;
  }
  .empty {
    margin: 0;
    padding: 0 14px 14px;
    color: var(--he-text-faint);
  }
  ul {
    margin: 0;
    padding: 0 8px 8px;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  li {
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 6px 8px;
    border-radius: var(--he-radius);
  }
  li[data-live='true'] {
    background: var(--he-surface-low);
  }
  li[data-missing='true'] {
    opacity: 0.55;
  }
  .dot {
    flex: none;
    inline-size: 8px;
    block-size: 8px;
    border-radius: 50%;
    border: 1px solid var(--he-border-popover);
    box-sizing: border-box;
  }
  li[data-live='true'] .dot {
    border: none;
    background: var(--he-ok);
  }
  li[data-missing='true'] .dot {
    border: 1px dashed var(--he-text-faint);
  }
  .name {
    flex: 1;
    min-inline-size: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  li[data-live='true'] .name {
    color: var(--he-text);
    font-weight: 600;
  }
  .live {
    font-weight: 400;
    color: var(--he-ok);
  }
  .gone {
    color: var(--he-text-faint);
  }
  .profile {
    color: var(--he-text-muted);
  }
  select {
    font: inherit;
    font-size: var(--he-size-xs);
    color: var(--he-text);
    background: none;
    border: none;
    padding: 0;
    max-inline-size: 11rem;
    cursor: pointer;
  }
  select.unset {
    color: var(--he-text-faint);
  }
  select:focus-visible {
    outline: 2px solid var(--he-accent);
    outline-offset: 2px;
    border-radius: 2px;
  }
  .unlink {
    all: unset;
    cursor: pointer;
    margin-inline-start: 4px;
    color: var(--he-text-muted);
  }
  .unlink:hover {
    color: var(--he-text);
  }
  .unlink:focus-visible {
    outline: 2px solid var(--he-accent);
    outline-offset: 2px;
    border-radius: 2px;
  }
</style>
