<script lang="ts">
  import { ArrowRightLeft, X } from './icons';
  import Tooltip from './Tooltip.svelte';
  import { escapeClosesPicker } from './gestures';
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
    compact = false,
  }: {
    obs: ObsStatus;
    rows: SceneRow[];
    profiles: string[];
    /** Every opening: the list is re-read from OBS. */
    onOpen: () => void;
    onLink: (uuid: string, profile: string | null) => void;
    onUnlink: (uuid: string) => void;
    /** The header's third step: the icon alone, the name on hover. */
    compact?: boolean;
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
      if (event.key === 'Escape' && !escapeClosesPicker(event)) {
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
  <!-- Why it is inert, or — as an icon — what it is: the page's tooltip
       (board Editor-Tooltip), never a title; none while its menu is open,
       which says it already. -->
  <Tooltip
    text={buttonState === 'inert'
      ? 'Connect OBS to link scenes'
      : compact && !open
        ? 'Link OBS scenes'
        : null}
  >
    {#snippet children()}
      <button
        class="trigger"
        class:he-btn-quiet={buttonState !== 'pitch'}
        class:compact
        data-scenes-trigger
        data-state={buttonState}
        type="button"
        disabled={buttonState === 'inert'}
        aria-label={compact ? 'Link OBS scenes' : undefined}
        aria-expanded={open}
        aria-haspopup="dialog"
        bind:this={trigger}
        onclick={toggle}
      >
        {#if compact}<ArrowRightLeft size={16} />{:else}Link OBS scenes{/if}
      </button>
    {/snippet}
  </Tooltip>

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
                  class="unlink he-icon-btn he-icon-btn--bare"
                  data-unlink
                  type="button"
                  aria-label={`Forget ${row.name}`}
                  onclick={() => onUnlink(row.uuid)}
                >
                  <X size={16} />
                </button>
              {:else}
                <!-- Bare, like the layout select in the gear menu: the row reads
                     "Gameplay · Apex ranked ▾", not as a form. -->
                <select
                  class="he-select he-select--scene"
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
  .trigger:not(.he-btn-quiet) {
    all: unset;
    box-sizing: border-box;
    display: inline-flex;
    align-items: center;
    block-size: 28px;
    cursor: pointer;
    padding: 0 11px;
    border: 1px solid var(--he-accent);
    border-radius: var(--he-radius);
    font-size: var(--he-size-xs);
    font-weight: 600;
    color: var(--he-accent);
    white-space: nowrap;
  }
  .trigger:not(.he-btn-quiet):hover,
  .trigger:not(.he-btn-quiet)[aria-expanded='true'] {
    color: var(--he-bg);
    background: var(--he-accent);
  }
  .trigger:not(.he-btn-quiet):focus-visible {
    outline: 2px solid var(--he-accent);
    outline-offset: 2px;
  }

  /* The header's third step (board Editor-HeaderNarrow): the icon alone, a
     28 px square — the accent outline kept while there is something to set
     up, the quiet face otherwise. The name is the tooltip's and the label's. */
  .trigger.compact {
    inline-size: 28px;
    padding: 0;
    justify-content: center;
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
    box-shadow: var(--he-shadow-menu);
    font-size: var(--he-size-xs);
    color: var(--he-text-muted);
  }
  .lead {
    margin: 0;
    padding: 14px 14px 10px;
    line-height: 1.5;
  }
  .empty {
    margin: 0;
    padding: 0 14px 14px;
    color: var(--he-text-muted);
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
    color: var(--he-text-muted);
  }
  .profile {
    color: var(--he-text-muted);
  }
  /* A long profile name stops before the scene name it answers. */
  select {
    max-inline-size: 11rem;
  }
  select.unset {
    color: var(--he-text-faint);
  }
  .unlink {
    margin-inline-start: 4px;
  }
</style>
