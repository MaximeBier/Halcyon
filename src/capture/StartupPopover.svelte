<script lang="ts">
  import {
    autostartPath,
    browserFlavor,
    installHint,
    installState,
    type InstallWatch,
  } from './startup';
  import { copyToClipboard } from './clipboard';
  import { Power } from './icons';
  import Tooltip from './Tooltip.svelte';

  /**
   * The "Start with Windows" guide: a header trigger and the three steps.
   *
   * It teaches the only part the page cannot do for itself. Opened at sign-in,
   * the capture already takes the keyboard back without a gesture and retries
   * OBS until it answers — so the guide is install the app, tick the browser's
   * run-on-login option, and leave the window alone.
   */
  let {
    /** Overridable for the tests; the flavor only picks which address to show. */
    agent = navigator.userAgent,
    standalone,
    install,
    onInstall,
    compact = false,
  }: {
    agent?: string;
    /** `(display-mode: standalone)` — the page runs in the installed window. */
    standalone: boolean;
    /**
     * What the page has heard about the install (`watchInstall`). Held by
     * the page and not here: Chrome fires `beforeinstallprompt` once, early,
     * and this popover is not mounted while the setup wizard has the page.
     */
    install: InstallWatch;
    /** Spends the held prompt — the page's, since the page holds it. */
    onInstall: () => void;
    /** The header's third step: the icon alone, the name on hover. */
    compact?: boolean;
  } = $props();

  let open = $state(false);
  let copied = $state<'idle' | 'done' | 'failed'>('idle');
  let root = $state<HTMLElement | null>(null);
  let trigger = $state<HTMLButtonElement | null>(null);
  let dialog = $state<HTMLElement | null>(null);

  const step = $derived(
    installState({
      standalone,
      installed: install.installed,
      promptAvailable: install.prompt !== null,
    }),
  );
  const path = $derived(autostartPath(browserFlavor(agent)));

  function toggle() {
    open = !open;
    copied = 'idle';
  }

  async function copy() {
    copied = (await copyToClipboard(navigator, path.address)) ? 'done' : 'failed';
  }

  $effect(() => {
    if (!open) return;

    const onKey = (event: KeyboardEvent) => {
      // The trigger is where the keystroke logically returns to: Escape is
      // the one close path with no click of its own to leave the focus
      // somewhere sensible (KeyPopover's `closePopover` hands it back for
      // the same reason, to a handle instead of a button).
      if (event.key === 'Escape') {
        open = false;
        trigger?.focus();
      }
    };
    // `pointerdown`, not `click`: the guide must be gone before whatever was
    // clicked underneath it reacts (the ProfileBar menu's reasoning).
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

  // `role="dialog"` promises the platform that opening it moves the focus in;
  // without this a screen reader announces nothing and a keyboard user tabs
  // through the header before ever reaching the guide. The dialog itself
  // takes it, not the first control inside — there is no single "first
  // field" here worth landing on, and `tabindex="-1"` exists on the element
  // for exactly this.
  $effect(() => {
    if (open) dialog?.focus();
  });
</script>

<div class="startup" bind:this={root}>
  <!-- As an icon, its name is the page's tooltip (board Editor-HeaderNarrow). -->
  <Tooltip text={compact ? 'Start with Windows' : null}>
    {#snippet children()}
      <button
        class="trigger"
        class:demoted={step === 'standalone'}
        class:he-btn-quiet={step === 'standalone'}
        class:compact
        data-startup-trigger
        type="button"
        aria-label={compact ? 'Start with Windows' : undefined}
        aria-expanded={open}
        aria-haspopup="dialog"
        bind:this={trigger}
        onclick={toggle}
      >
        {#if compact}<Power size={16} />{:else}Start with Windows{/if}
      </button>
    {/snippet}
  </Tooltip>

  {#if open}
    <div
      class="menu"
      data-startup-guide
      role="dialog"
      aria-label="Start with Windows"
      tabindex="-1"
      bind:this={dialog}
    >
      <p class="lead">
        Opened at sign-in, this page reconnects on its own — keyboard, OBS, overlay. These three
        steps make Windows open it.
      </p>

      <ol>
        <li data-step="install" class:done={step === 'standalone' || step === 'installed'}>
          <span class="title">Install Halcyon as an app</span>
          {#if step === 'installable'}
            <button class="install he-btn-primary" data-install type="button" onclick={onInstall}>
              Install Halcyon…
            </button>
          {:else}
            <span class="hint">{installHint(step)}</span>
          {/if}
        </li>

        <li data-step="autostart">
          <span class="title">Let it start when you sign in</span>
          <span class="hint">
            <!-- Shown to copy, never to click: the browser refuses to follow a
                 chrome:// link from a page, so pretending it is one would only
                 teach that the guide is broken. -->
            Go to <code data-address>{path.address}</code>
            <Tooltip text={copied === 'failed' ? 'Select the address and copy it by hand' : null}>
              {#snippet children(describedBy)}
                <button
                  class="he-btn-tertiary"
                  data-copy
                  type="button"
                  aria-describedby={describedBy}
                  onclick={copy}
                  onblur={() => (copied = 'idle')}
                >
                  {copied === 'done' ? 'Copied' : copied === 'failed' ? 'Failed' : 'Copy'}
                </button>
              {/snippet}
            </Tooltip>
            — then {path.instruction}
          </span>
        </li>

        <li data-step="background">
          <span class="title">Leave the window running</span>
          <span class="hint">
            Minimise it rather than close it: capture keeps streaming from the background.
          </span>
        </li>
      </ol>
    </div>
  {/if}
</div>

<style>
  .startup {
    position: relative;
    display: inline-flex;
    align-items: center;
    font: var(--he-font);
  }
  /* The Resume-setup recipe in the accent colour: bordered, bold, its own
     pill. Muted text was the first draft, and it made the one feature that
     changes how the product is *used* — open once, never touch again — look
     like a footnote next to the profile menu. */
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
    /* The header's own size (board 3a): the pills and the gear beside it
       speak at 14 px, and a pitch one notch louder read as a stray. */
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
  /* Once the page is `standalone`, step 1 is already done and this is no
     longer the button that sells the feature — it is the one someone who
     just installed still needs, to come back for step 2 (auto-start). Not
     hidden, which would bury that step with it: demoted to the muted-text
     "footnote" recipe the comment above rejected for the pitch, which is
     exactly right once there is nothing left to pitch. Border kept
     transparent rather than removed so the click target does not shift. */

  .menu {
    position: absolute;
    top: var(--he-menu-offset);
    right: 0;
    z-index: 9;
    inline-size: var(--he-guide-width);

    padding: 12px 14px;

    background: var(--he-popover);
    border: 1px solid var(--he-border-popover);
    border-radius: var(--he-radius-panel);

    font-size: var(--he-size-sm);
    color: var(--he-text-muted);
  }

  .lead {
    margin: 0 0 10px;
    line-height: 1.45;
  }

  ol {
    margin: 0;
    padding-inline-start: 22px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  li {
    line-height: 1.45;
  }
  li::marker {
    color: var(--he-text-muted);
  }
  li.done::marker {
    color: var(--he-accent);
  }

  .title {
    display: block;
    font-weight: 600;
    color: var(--he-text);
  }
  .hint {
    display: block;
  }

  code {
    font: var(--he-font-mono);
    color: var(--he-text);
    background: var(--he-well);
    border: 1px solid var(--he-border-control);
    border-radius: var(--he-radius);
    padding: 1px 5px;
  }

  /* Under the step it belongs to, never stretched across the guide. */
  .install {
    align-self: flex-start;
    margin-block-start: 4px;
  }
</style>
