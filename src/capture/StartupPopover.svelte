<script lang="ts">
  import { autostartPath, browserFlavor, installHint, installState } from './startup';
  import { copyToClipboard } from './clipboard';

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
    standalone = runsStandalone(),
  }: {
    agent?: string;
    standalone?: boolean;
  } = $props();

  /** What Chrome's `beforeinstallprompt` carries, which the DOM types do not name. */
  interface InstallPromptLike {
    prompt(): Promise<unknown>;
  }

  let open = $state(false);
  /** The stashed `beforeinstallprompt`, single-use: spent on the button's click. */
  let prompt = $state<InstallPromptLike | null>(null);
  /** `appinstalled` seen — this tab stayed a tab, but the install happened. */
  let installed = $state(false);
  let copied = $state<'idle' | 'done' | 'failed'>('idle');
  let root = $state<HTMLElement | null>(null);
  let trigger = $state<HTMLButtonElement | null>(null);
  let dialog = $state<HTMLElement | null>(null);

  /** jsdom has no `matchMedia`; a page that cannot ask is not in an app window. */
  function runsStandalone(): boolean {
    return globalThis.matchMedia?.('(display-mode: standalone)').matches ?? false;
  }

  const step = $derived(installState({ standalone, installed, promptAvailable: prompt !== null }));
  const path = $derived(autostartPath(browserFlavor(agent)));

  function toggle() {
    open = !open;
    copied = 'idle';
  }

  async function install() {
    const held = prompt;
    // Cleared before the ask, not after: the browser allows one call ever, and
    // a second click during the dialog must find no button to press.
    prompt = null;
    await held?.prompt();
  }

  async function copy() {
    copied = (await copyToClipboard(navigator, path.address)) ? 'done' : 'failed';
  }

  $effect(() => {
    // On the window for the page's whole life, not the popover's: the event
    // fires once, early, and a guide opened later must still hold it.
    const onPrompt = (event: Event) => {
      event.preventDefault();
      prompt = event as unknown as InstallPromptLike;
    };
    const onInstalled = () => (installed = true);

    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  });

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
  <button
    class="trigger"
    class:demoted={step === 'standalone'}
    data-startup-trigger
    type="button"
    aria-expanded={open}
    aria-haspopup="dialog"
    bind:this={trigger}
    onclick={toggle}
  >
    Start with Windows
  </button>

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
            <button class="install" data-install type="button" onclick={install}>
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
            <button
              class="link"
              data-copy
              type="button"
              onclick={copy}
              onblur={() => (copied = 'idle')}
              title={copied === 'failed' ? 'Select the address and copy it by hand' : undefined}
            >
              {copied === 'done' ? 'Copied' : copied === 'failed' ? 'Failed' : 'Copy'}
            </button>
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
  .trigger {
    all: unset;
    cursor: pointer;
    padding: 5px 11px;
    border: 1px solid var(--he-accent);
    border-radius: var(--he-radius-control);
    font-size: var(--he-size-md);
    font-weight: 600;
    color: var(--he-accent);
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
  /* Once the page is `standalone`, step 1 is already done and this is no
     longer the button that sells the feature — it is the one someone who
     just installed still needs, to come back for step 2 (auto-start). Not
     hidden, which would bury that step with it: demoted to the muted-text
     "footnote" recipe the comment above rejected for the pitch, which is
     exactly right once there is nothing left to pitch. Border kept
     transparent rather than removed so the click target does not shift. */
  .trigger.demoted {
    border-color: transparent;
    font-weight: 400;
    color: var(--he-text-muted);
  }
  .trigger.demoted:hover,
  .trigger.demoted[aria-expanded='true'] {
    color: var(--he-text);
    background: none;
  }

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
  .menu:focus {
    outline: none;
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
    color: var(--he-text-faint);
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
    background: var(--he-stage);
    border: 1px solid var(--he-border-control);
    border-radius: var(--he-radius);
    padding: 1px 5px;
  }

  .install {
    all: unset;
    cursor: pointer;
    margin-block-start: 4px;
    padding: 4px 10px;
    border-radius: var(--he-radius);
    font-weight: 600;
    color: var(--he-stage);
    background: var(--he-accent);
  }
  .install:focus-visible {
    outline: 2px solid var(--he-text);
    outline-offset: 1px;
  }

  .link {
    all: unset;
    cursor: pointer;
    color: var(--he-accent);
  }
  .link:hover {
    text-decoration: underline;
  }
  .link:focus-visible {
    outline: 2px solid var(--he-accent);
    outline-offset: 1px;
    border-radius: var(--he-radius);
  }
</style>
