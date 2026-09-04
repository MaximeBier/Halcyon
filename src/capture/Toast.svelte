<script lang="ts">
  import { UI_TOKENS } from '../styles/ui-tokens';
  import type { Notice, Tone } from './notice';

  /**
   * The passing half of spec §16.6: bottom centre, four seconds, three tones.
   *
   * It never carries anything one *has* to act on. Whatever the profile is
   * worth is written permanently in the profile menu, so missing this costs
   * nothing — which is the licence a four-second message needs. An optional
   * action button keeps that licence: it is only ever a shortcut to something
   * the page offers permanently (see `Notice.action`).
   */
  let {
    notice,
    onDismiss,
  }: {
    notice: Notice | null;
    onDismiss: () => void;
  } = $props();

  const DOT: Record<Tone, string> = {
    success: UI_TOKENS.ok,
    warning: UI_TOKENS.override,
    error: UI_TOKENS.danger,
  };

  const BORDER: Record<Tone, string> = {
    success: UI_TOKENS.borderOk,
    warning: UI_TOKENS.borderWarn,
    error: UI_TOKENS.borderDanger,
  };
</script>

<!-- Keyed on the notice itself, so a second message restarts the fade instead
     of inheriting the remains of the first one's. -->
{#key notice}
  {#if notice}
    <!-- The four seconds are a CSS animation, not a `setTimeout`: global
         constraint 1 forbids timers on the capture page, and the dismissal
         rides the `animationend` event exactly as everything else here rides
         `inputreport`. Nothing moves — only the opacity, at the very end. -->
    <div
      class="toast"
      role="status"
      data-tone={notice.tone}
      style:border-color={BORDER[notice.tone]}
      onanimationend={onDismiss}
    >
      <span class="dot" style:background={DOT[notice.tone]}></span>
      {notice.message}
      {#if notice.action}
        {@const action = notice.action}
        <!-- Dismissed on use: waiting out the fade would leave "3 keys
             deleted" on screen after the keys came back. -->
        <button
          class="act"
          onclick={() => {
            action.run();
            onDismiss();
          }}
        >
          {action.label}
        </button>
      {/if}
    </div>
  {/if}
{/key}

<style>
  .toast {
    position: fixed;
    bottom: 24px;
    left: 50%;
    translate: -50% 0;
    z-index: 20;

    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 14px;

    font: var(--he-font);
    font-size: var(--he-size-md);
    color: var(--he-text);
    background: var(--he-popover);
    border: 1px solid var(--he-border);
    border-radius: var(--he-radius-panel);

    animation: hold 4s forwards;
  }
  .dot {
    inline-size: 7px;
    block-size: 7px;
    border-radius: 50%;
    flex: none;
  }
  .act {
    font: inherit;
    font-weight: 600;
    color: var(--he-accent);
    background: none;
    border: 1px solid var(--he-border-popover);
    border-radius: var(--he-radius-control);
    padding: 2px 10px;
    cursor: pointer;
  }
  .act:focus-visible {
    outline: 2px solid var(--he-accent);
    outline-offset: 2px;
  }
  @keyframes hold {
    0%,
    92% {
      opacity: 1;
    }
    100% {
      opacity: 0;
    }
  }
</style>
