<script lang="ts">
  import { clearKeyStyle, setKeyLabel, setKeyMode, setKeyStyle } from '../config/edit';
  import { effectiveStyle, overriddenInAny } from '../config/resolve';
  import { removeKeys } from './learn';
  import { moveKey, resizeKeys, GRID, type Rect } from './layout';
  import { ICON_SET, labelFor, type LayoutMapLike } from '../keyboard/labels';
  import Collapsible from './Collapsible.svelte';
  import {
    RADIUS_BOUNDS,
    type FillDirection,
    type KeyMode,
    type KeyStyle,
    type OverlayConfig,
  } from '../config/schema';

  /**
   * Everything that belongs to the selection: mode, colour, fill direction,
   * label, size, deletion. The global settings live in `StylePanel`, and the
   * two never share a write path (spec §16.4).
   */
  let {
    config,
    selectedIds,
    surface,
    onChange,
    onClose,
    storage,
    layout = null,
    suggestAxis = false,
    onDismissSuggestion = () => {},
  }: {
    config: OverlayConfig;
    selectedIds: number[];
    /**
     * The work surface the position fields write into. Typing 500 into X is
     * as good a way off the screen as dragging, and it goes through the same
     * boundary.
     */
    surface: Rect;
    onChange: (next: OverlayConfig) => void;
    onClose: () => void;
    /**
     * For the Style fold, which remembers whether it is open (spec §9.3).
     *
     * Injected rather than reached for, like every other fold's: `localStorage`
     * throws outright with cookies blocked, and a popover is the last place
     * that should take a page down.
     */
    storage: Pick<Storage, 'getItem' | 'setItem'>;
    /** What the keyboard says this position produces, for the way back. */
    layout?: LayoutMapLike | null;
    /** The key travels its whole depth and never fires (spec §7.4). */
    suggestAxis?: boolean;
    onDismissSuggestion?: () => void;
  } = $props();

  const selection = $derived(config.keys.filter((key) => selectedIds.includes(key.id)));
  /**
   * The first key of the selection supplies the displayed values; every change
   * applies to all of them. Showing a group's shared value only where they
   * agree was considered and dropped: a blank field that means "they differ"
   * is indistinguishable from one that means "nothing is set".
   */
  const lead = $derived(selection[0] ?? null);
  const effective = $derived(lead ? effectiveStyle(config.style, lead) : null);
  /**
   * Over the whole selection, not the lead key — because that is what the
   * reset below writes to. The displayed *values* come from the lead by
   * design (see above); what is overridden cannot, or the button clears the
   * lead's properties on everyone and leaves the rest behind.
   */
  const overridden = $derived(overriddenInAny(selection));
  const single = $derived(selection.length === 1 ? selection[0]! : null);

  /**
   * The label the detected layout gives this position, when it differs from
   * what the key wears — that is, when the key has been renamed by hand.
   *
   * Null with no layout: there is nothing to go back to, and the position name
   * `labelFor` would produce is worse than anything the user typed.
   */
  const detectedLabel = $derived.by(() => {
    if (!single || layout === null) return null;
    const detected = labelFor(single.usage, layout);
    return detected === single.label ? null : detected;
  });

  /**
   * Which of the two label editors is showing — a view switch, not a stored
   * mode. Nothing in the configuration records "this key is in icon mode"; the
   * label is the label, and a glyph is text like any other (spec §16.4).
   *
   * It has to be held rather than derived from the label, for the four arrows:
   * `KEYCAP_LABELS` and the icon set answer `←` alike, so a key wearing one is
   * in both modes at once. Derived, picking `←` in the grid would read as text
   * again and shut the grid under the pointer.
   */
  let picked = $state<'text' | 'icon' | null>(null);
  const labelKind = $derived(
    picked ?? (single && ICON_SET.includes(single.label) ? 'icon' : 'text'),
  );

  // A different key is a different question. Without this, opening the grid on
  // Enter and then clicking a letter leaves the letter showing a grid.
  let editing = $state<number | null>(null);
  $effect(() => {
    if (single?.id !== editing) {
      editing = single?.id ?? null;
      picked = null;
    }
  });

  /**
   * Back to the name, on request — destructive like the recompute button, and
   * for the same reason: it is a click, not a side effect.
   *
   * With no layout detected this hands back the position name for a writing
   * key, which is poor. It is still the honest answer, it is one field away
   * from being fixed by hand, and the alternative — a Text button that does
   * nothing — would be worse.
   */
  function toText() {
    picked = 'text';
    if (single) onChange(setKeyLabel(config, single.id, labelFor(single.usage, layout)));
  }
  const mode = $derived<KeyMode>(
    selection.length > 0 && selection.every((key) => key.mode === 'axis') ? 'axis' : 'key',
  );

  function apply<K extends keyof KeyStyle>(property: K, value: KeyStyle[K]) {
    onChange(setKeyStyle(config, selectedIds, property, value));
  }

  const DIRECTIONS: [FillDirection, string][] = [
    ['up', '↑'],
    ['down', '↓'],
    ['left', '←'],
    ['right', '→'],
  ];

  const COLORS: [keyof KeyStyle & ('activeColor' | 'fillColor' | 'restColor'), string][] = [
    ['activeColor', 'Active color'],
    ['fillColor', 'Travel fill'],
    ['restColor', 'Rest'],
  ];

  /**
   * Hands the whole selection back to the global style, in one write.
   *
   * Every override the header counted, not only the five the block draws: an
   * imported profile may carry an opacity or a font per key, which nothing
   * here can set — and a button that says "reset to global" while leaving one
   * behind is worse than no button.
   */
  function resetStyle() {
    onChange(
      overridden.reduce((next, property) => clearKeyStyle(next, selectedIds, property), config),
    );
  }

  function typed(input: HTMLInputElement, fallback: number): number | null {
    if (input.value !== '') return Number(input.value);
    input.value = String(fallback);
    return null;
  }
</script>

<!--
  The name of a property, and a dot beside it when the selection overrides it —
  any key of it, since clicking the dot clears the property on all of them.

  **Only the exception is marked.** A column of labels reading `global` is a
  column of statements that nothing has happened, in a panel 284 px wide — and
  the word `override` in full weighed more than the value it described.

  The dot is the same amber the rest of the page uses for "customized", and it
  is also the way back for its line: it keeps what the per-property reset could
  do before this block existed — return one value without returning the four
  beside it — and it is exactly where one would click to undo it. Padded well
  past its six pixels, so the target is a target.
-->
{#snippet named(property: keyof KeyStyle, label: string, control: string)}
  <span class="name">
    <label for={control}>{label}</label>
    {#if overridden.includes(property)}
      <button
        type="button"
        class="mark"
        data-marker
        data-reset={property}
        title="Reset to global"
        aria-label={`${label}: reset to global`}
        onclick={() => onChange(clearKeyStyle(config, selectedIds, property))}
      ></button>
    {/if}
  </span>
{/snippet}

{#if lead && effective}
  <div class="popover" role="dialog" aria-label="Key style">
    <header>
      <span class="title">{single ? single.label : `${selection.length} keys`}</span>
      {#if overridden.length > 0}
        <!-- Same amber as the marker on the key itself: one colour means one
             thing, "this differs from the global" (spec §8.2). -->
        <span class="badge">override</span>
      {/if}
    </header>

    <div class="segmented" role="group" aria-label="Display mode">
      {#each [['key', 'Key'], ['axis', 'Axis']] as [value, label] (value)}
        <button
          type="button"
          data-mode={value}
          class:on={mode === value}
          aria-pressed={mode === value}
          onclick={() => onChange(setKeyMode(config, selectedIds, value as KeyMode))}
        >
          {label}
        </button>
      {/each}
    </div>

    {#if suggestAxis && mode === 'key'}
      <!-- Worded as the observation, not as a conclusion: the keyboard says
           this key travelled its whole depth and never fired. It does not say
           the key is bound to a stick, and nothing here can find out. Never a
           switch, always an offer (spec §7.4).

           Gated on the mode here rather than on the suggester's side, so the
           panel cannot contradict the toggle sitting above it. "This key never
           fires" stays true after the advice is taken — the suggester has no
           reason to withdraw it, and would go on offering a switch that has
           already happened. -->
      <p class="suggestion" data-suggestion>
        This key does not send a keystroke.
        <span class="actions">
          <button
            type="button"
            class="link"
            data-accept-suggestion
            onclick={() => onChange(setKeyMode(config, selectedIds, 'axis'))}
          >
            Show as axis
          </button>
          <button
            type="button"
            class="link quiet"
            data-dismiss-suggestion
            onclick={onDismissSuggestion}
          >
            Keep as key
          </button>
        </span>
      </p>
    {/if}

    <!--
      Every appearance property a key may hold, behind one fold (lot of
      2026-08-21). Five of the eight: opacity and the two font properties stay
      global — two typefaces in one overlay serve no real case. `borderColor`
      used to be a sixth; it left the model on 2026-08-22, the resting border
      being the `keyBorder` token again and the actuated one `activeColor`.

      The tag on each line **is** the way back for that line. The plate draws a
      tag and a single "Reset to global" at the foot; a tag that resets keeps
      what the old per-property link could do — return one colour without
      returning the four beside it — and costs not a pixel more.
    -->
    <div class="style-block">
      <Collapsible
        id="key-style"
        title="Style"
        note={overridden.length > 0
          ? `${overridden.length} override${overridden.length === 1 ? '' : 's'}`
          : null}
        modified={overridden.length > 0}
        {storage}
      >
        {#each COLORS as [property, label] (property)}
          <div class="row" data-style-row={property}>
            {@render named(property, label, `key-${property}`)}
            <div class="value">
              <input
                id={`key-${property}`}
                name={property}
                type="color"
                value={effective[property]}
                onchange={(event) => apply(property, event.currentTarget.value)}
              />
            </div>
          </div>
        {/each}

        <div class="row" data-style-row="fillDirection">
          {@render named('fillDirection', 'Fill direction', 'key-fillDirection')}
          <div class="value">
            <div class="segmented small" role="group" aria-labelledby="key-fillDirection">
              {#each DIRECTIONS as [value, glyph] (value)}
                <button
                  type="button"
                  data-direction={value}
                  class:on={effective.fillDirection === value}
                  aria-pressed={effective.fillDirection === value}
                  aria-label={value}
                  onclick={() => apply('fillDirection', value)}
                >
                  {glyph}
                </button>
              {/each}
            </div>
          </div>
        </div>

        <div class="row" data-style-row="radius">
          {@render named('radius', 'Radius', 'key-radius')}
          <div class="value">
            <input
              id="key-radius"
              name="radius"
              type="number"
              min={RADIUS_BOUNDS.min}
              max={RADIUS_BOUNDS.max}
              value={effective.radius}
              onchange={(event) => {
                const value = typed(event.currentTarget, effective!.radius);
                if (value !== null)
                  apply('radius', Math.min(RADIUS_BOUNDS.max, Math.max(RADIUS_BOUNDS.min, value)));
              }}
            />
            <span class="unit">px</span>
          </div>
        </div>

        {#if overridden.length > 0}
          <div class="row end">
            <button type="button" class="link" data-reset-all onclick={resetStyle}>
              Reset to global
            </button>
          </div>
        {/if}
      </Collapsible>
    </div>

    {#if single}
      <div class="row">
        <span class="label" id="key-label">Label</span>
        <!-- Board 6e. Not a stored mode: it chooses which editor is on screen,
             and both write the same field. -->
        <div class="segmented small" role="group" aria-labelledby="key-label">
          <button
            type="button"
            data-label-kind="text"
            class:on={labelKind === 'text'}
            aria-pressed={labelKind === 'text'}
            onclick={toText}
          >
            Text
          </button>
          <button
            type="button"
            data-label-kind="icon"
            class:on={labelKind === 'icon'}
            aria-pressed={labelKind === 'icon'}
            onclick={() => (picked = 'icon')}
          >
            Icon
          </button>
        </div>
      </div>

      {#if labelKind === 'icon'}
        <div class="icons" role="group" aria-label="Icon">
          {#each ICON_SET as icon (icon)}
            <button
              type="button"
              class:on={single.label === icon}
              aria-pressed={single.label === icon}
              aria-label={`Icon ${icon}`}
              onclick={() => onChange(setKeyLabel(config, single.id, icon))}
            >
              {icon}
            </button>
          {/each}
        </div>
        <!-- Said here because it is the one thing the grid cannot show: the
             twelve are already on the keys nobody had to touch. -->
        <p class="hint">Special keys pick their icon on capture. Text keeps the layout name.</p>
      {:else}
        <div class="row">
          <input
            id="key-label-text"
            name="label"
            type="text"
            aria-labelledby="key-label"
            value={single.label}
            onchange={(event) =>
              onChange(setKeyLabel(config, single.id, event.currentTarget.value))}
          />
        </div>
      {/if}

      {#if labelKind === 'text' && detectedLabel !== null}
        <!-- The counterpart of "Reset to global" for the one property that is
             not a style. Without it a rename only comes undone by retyping the
             detected label exactly — and a layout change will not do it, since
             a typed name is deliberately left alone (spec §8.6). -->
        <div class="row end">
          <button
            type="button"
            class="link"
            data-reset="label"
            onclick={() => onChange(setKeyLabel(config, single.id, detectedLabel))}
          >
            Reset to detected · <code>{detectedLabel}</code>
          </button>
        </div>
      {/if}

      <!-- Dragging alone becomes frustrating the moment two keys have to line
           up exactly, which is why the spec asks for numeric fields (§8.7).
           Single selection only: a group shares a size, not a position. -->
      <div class="row">
        <span class="label" id="key-position">Position</span>
        <div class="value" aria-labelledby="key-position">
          <input
            name="x"
            type="number"
            step={GRID}
            aria-label="X"
            value={single.x}
            onchange={(event) => {
              const x = typed(event.currentTarget, single.x);
              if (x !== null) onChange(moveKey(config, single.id, x, single.y, surface));
            }}
          />
          <span class="times">,</span>
          <input
            name="y"
            type="number"
            step={GRID}
            aria-label="Y"
            value={single.y}
            onchange={(event) => {
              const y = typed(event.currentTarget, single.y);
              if (y !== null) onChange(moveKey(config, single.id, single.x, y, surface));
            }}
          />
        </div>
      </div>
    {/if}

    <div class="row">
      <span class="label" id="key-size">Size</span>
      <div class="value" aria-labelledby="key-size">
        <input
          name="width"
          type="number"
          step={GRID}
          min={GRID}
          aria-label="Width"
          value={lead.w}
          onchange={(event) => {
            const w = typed(event.currentTarget, lead.w);
            if (w !== null) onChange(resizeKeys(config, selectedIds, w, lead.h));
          }}
        />
        <span class="times">×</span>
        <input
          name="height"
          type="number"
          step={GRID}
          min={GRID}
          aria-label="Height"
          value={lead.h}
          onchange={(event) => {
            const h = typed(event.currentTarget, lead.h);
            if (h !== null) onChange(resizeKeys(config, selectedIds, lead.w, h));
          }}
        />
      </div>
    </div>

    <button
      type="button"
      class="danger"
      data-delete
      onclick={() => {
        onChange(removeKeys(config, selectedIds));
        // Anchored to a selection that no longer exists, it would sit over an
        // empty patch of stage with a stale label in it.
        onClose();
      }}
    >
      Delete{selection.length > 1 ? ` ${selection.length} keys` : ''} · Suppr
    </button>
  </div>
{/if}

<style>
  .popover {
    display: grid;
    gap: 9px;
    /* Border-box, or the token lies: without it the 284 px is the *content*
       box and the panel really occupies 312 — padding and border on top. The
       editor clamps the popover against the stage edge using that same token,
       so a token that means something else is a popover that still overflows,
       by exactly the padding. */
    box-sizing: border-box;
    inline-size: var(--he-popover-width, 284px);
    padding: 13px;
    background: var(--he-popover, #141722);
    border: 1px solid var(--he-border-popover, #262b3a);
    border-radius: var(--he-radius-panel, 6px);
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  .title {
    font-size: var(--he-size-md, 16px);
    font-weight: 600;
    color: var(--he-text, #dde1e9);
  }
  .badge {
    font-size: var(--he-size-xs, 14px);
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--he-override, #d9a05b);
    border: 1px solid var(--he-override, #d9a05b);
    border-radius: 20px;
    padding: 1px 7px;
  }
  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
  }
  /* The fold brings its own frame; inside the popover it is a run of rows like
     any other, so it gets the same spacing and no second border. */
  .style-block :global(.fold) {
    border: none;
    padding: 0;
    display: grid;
    gap: 10px;
  }
  .name {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  /**
   * Six amber pixels beside the name, and nothing at all when the value is
   * inherited — the same dot the folds use for "customized".
   *
   * A button, because it is also how one line goes back to the global. The box
   * is padded to a real target while the dot stays six pixels: a negative
   * margin keeps the row's height from following the padding.
   */
  .mark {
    /* Six pixels of dot, eighteen of target: the padding is the click area and
       the background is clipped to the content box, so only the dot is drawn.
       The negative margin keeps the row's height off the padding. */
    inline-size: 6px;
    block-size: 6px;
    box-sizing: content-box;
    padding: 6px;
    margin: -6px;
    border: none;
    border-radius: 50%;
    background: var(--he-override, #d9a05b) content-box;
    cursor: pointer;
  }
  .mark:hover {
    background-color: var(--he-text, #dde1e9);
  }
  .mark:focus-visible {
    outline: 2px solid var(--he-accent, #7c9eff);
    outline-offset: 1px;
  }
  .unit {
    font-size: var(--he-size-xs, 14px);
    color: var(--he-text-ghost, #4a4f60);
  }
  label,
  .label {
    font-size: var(--he-size-md, 16px);
    color: var(--he-text-muted, #8b90a0);
  }
  .value {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .segmented {
    display: flex;
    border: 1px solid var(--he-border-control, #232838);
    border-radius: var(--he-radius-control, 5px);
    overflow: hidden;
  }
  .segmented button {
    flex: 1;
    font: inherit;
    font-size: var(--he-size-md, 16px);
    color: var(--he-text-muted, #8b90a0);
    background: none;
    border: 0;
    padding: 5px 10px;
    cursor: pointer;
  }
  .segmented button:hover {
    color: var(--he-text, #dde1e9);
  }
  .segmented button.on {
    color: var(--he-bg, #0e1015);
    background: var(--he-accent, #7c9eff);
  }
  .segmented.small button {
    padding: 4px 8px;
  }
  /* Six across, as the board draws it — twelve glyphs in two rows fit the
     284 px panel without any of them shrinking below a target. */
  .icons {
    display: grid;
    grid-template-columns: repeat(6, 1fr);
    gap: 7px;
  }
  .icons button {
    display: grid;
    place-items: center;
    height: 30px;
    font: inherit;
    /* Larger than the panel's text on purpose: these are drawn by a system
       face, not by Archivo, and they read small at the UI size. */
    font-size: var(--he-size-lg, 18px);
    color: var(--he-text, #dde1e9);
    background: var(--he-bg, #0e1015);
    border: 1px solid var(--he-border-control, #232838);
    border-radius: var(--he-radius-control, 5px);
    cursor: pointer;
  }
  .icons button:hover {
    border-color: var(--he-border-hover, #3a4054);
  }
  .icons button.on {
    border-color: var(--he-accent, #7c9eff);
    outline: 1px solid var(--he-accent, #7c9eff);
  }
  .hint {
    margin: 0;
    font-size: var(--he-size-sm, 15px);
    line-height: 1.45;
    color: var(--he-text-faint, #5a5f70);
  }
  .suggestion {
    margin: 0;
    display: grid;
    gap: 6px;
    font-size: var(--he-size-sm, 15px);
    line-height: 1.4;
    color: var(--he-text-muted, #8b90a0);
    background: var(--he-surface, #151823);
    border: 1px solid var(--he-border-control, #232838);
    border-radius: var(--he-radius, 4px);
    padding: 8px 9px;
  }
  .actions {
    display: flex;
    gap: 12px;
  }
  /* The label is a value, not prose, and it reads as prose without this: the
     button said "Reset to detected · A" and the A disappeared into the
     sentence. Same mono face as the field it puts the value back into, one
     row above, so the two are visibly the same kind of thing. */
  [data-reset='label'] code {
    font: var(--he-font-mono, 400 15px ui-monospace, monospace);
    color: var(--he-text, #dde1e9);
    background: var(--he-stage, #0b0d11);
    border: 1px solid var(--he-border-control, #232838);
    border-radius: 3px;
    padding: 1px 5px;
    margin-inline-start: 2px;
  }
  .row.end {
    justify-content: flex-end;
  }
  .link.quiet {
    color: var(--he-text-faint, #5a5f70);
  }
  .link.quiet:hover {
    color: var(--he-text-muted, #8b90a0);
  }
  .link {
    font: inherit;
    font-size: var(--he-size-sm, 15px);
    color: var(--he-accent, #7c9eff);
    background: none;
    border: 0;
    padding: 0;
    cursor: pointer;
  }
  .link:hover {
    color: var(--he-accent-hover, #a5bcff);
  }
  .danger {
    font: inherit;
    font-size: var(--he-size-md, 16px);
    color: var(--he-danger, #e06c5b);
    background: none;
    border: 1px solid #3a2226;
    border-radius: var(--he-radius-control, 5px);
    padding: 6px 10px;
    cursor: pointer;
  }
  .times {
    font-size: var(--he-size-sm, 15px);
    color: var(--he-text-ghost, #4a4f60);
  }
  input[type='color'] {
    inline-size: 30px;
    block-size: 22px;
    padding: 0;
    background: none;
    border: 1px solid var(--he-border-control, #232838);
    border-radius: var(--he-radius, 4px);
    cursor: pointer;
  }
  input[type='text'],
  input[type='number'] {
    inline-size: 56px;
    font: var(--he-font-mono, 400 15px ui-monospace, monospace);
    color: var(--he-text, #dde1e9);
    background: var(--he-stage, #0b0d11);
    border: 1px solid var(--he-border-control, #232838);
    border-radius: var(--he-radius, 4px);
    padding: 4px 6px;
  }
  input[type='text'] {
    inline-size: 118px;
  }
  button:focus-visible,
  input:focus-visible {
    outline: 2px solid var(--he-accent, #7c9eff);
    outline-offset: 1px;
  }
</style>
