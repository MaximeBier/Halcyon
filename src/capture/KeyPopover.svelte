<script lang="ts">
  import { untrack } from 'svelte';
  import {
    clearKeyStyle,
    detectedLabelFor,
    setKeyLabel,
    setKeyMode,
    setKeyStyle,
  } from '../config/edit';
  import { effectiveStyle, overriddenInAny } from '../config/resolve';
  import { normalizeHex } from '../config/validate';
  import { GRID, moveKey, removeKeys, resizeKeys, type Rect } from './layout';
  import { ICON_SET, labelFor, type LayoutMapLike } from '../keyboard/labels';
  import { loadOpenState, saveOpenState } from './collapse';
  /**
   * The wording of the three style choices, shared with the global panel.
   *
   * They were lists of this component's own, wearing shortened labels: `↑` for
   * `↑ Up`, `Hidden` for `Hidden until pressed`, because this block is 284 px
   * wide and three words do not fit a third of a row of buttons. Those choices
   * are dropdowns since 2026-08-26, and a dropdown opens over the popover
   * instead of inside its row — so the width stopped deciding the wording, and
   * two lists that no longer differ became one. The fill direction went back
   * to four arrows on 2026-09-05 (board 3a), and borrows the arrows the
   * global panel draws.
   */
  import { BORDER_STATES, FILL_ARROWS, FILL_DIRECTIONS, REST_STATES } from './style-choices';
  import {
    type ActiveBorder,
    type KeyMode,
    type RestVisibility,
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
     * For the STYLE section, which remembers whether it is open (spec §9.3).
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
  const detectedLabel = $derived(single ? detectedLabelFor(single, layout) : null);

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
   * Whether the STYLE section is unfolded — remembered like every other fold
   * (spec §9.3), under the key the `Collapsible` it replaced used, so nobody's
   * choice is lost to the restyle. Shut on a first run, unlike the global
   * panel: a per-key override is the exception, and the popover's height is
   * load-bearing — it flips above the selection when it does not fit under.
   * Nothing is hidden by shutting it: the heading counts the overrides.
   */
  let styleOpen = $state(untrack(() => loadOpenState(storage, 'key-style', false)));

  function toggleStyle() {
    styleOpen = !styleOpen;
    saveOpenState(storage, 'key-style', styleOpen);
  }

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
    // Only when leaving the grid. Clicking Text while the text field is
    // already showing used to overwrite the name: a key renamed "Sprint" reads
    // as text mode, the button reads `aria-pressed="true"`, and pressing it —
    // the natural way to confirm one is in text mode — turned it back into
    // "W". Nothing about a switch should destroy a value, and the destructive
    // path already has its own control below, which names what it will write.
    const leavingIcon = labelKind === 'icon';
    picked = 'text';
    if (leavingIcon && single)
      onChange(setKeyLabel(config, single.id, labelFor(single.usage, layout)));
  }
  const mode = $derived<KeyMode>(
    selection.length > 0 && selection.every((key) => key.mode === 'axis') ? 'axis' : 'key',
  );

  function apply<K extends keyof KeyStyle>(property: K, value: KeyStyle[K]) {
    onChange(setKeyStyle(config, selectedIds, property, value));
  }

  /** A colour typed as text: taken when it is one, put back when it is not. */
  function hex(property: (typeof COLORS)[number][0], input: HTMLInputElement) {
    const value = normalizeHex(input.value);
    if (value === null) {
      input.value = effective![property];
      return;
    }
    input.value = value;
    apply(property, value);
  }

  /** The four colours a key may argue with the theme about, in the panel's order. */
  const COLORS: [
    keyof KeyStyle & ('activeColor' | 'fillColor' | 'restColor' | 'borderColor'),
    string,
  ][] = [
    ['activeColor', 'Active'],
    ['fillColor', 'Travel fill'],
    ['restColor', 'Rest'],
    ['borderColor', 'Border'],
  ];

  /**
   * Hands the whole selection back to the global style, in one write.
   *
   * Every override the heading counted, not only the six the section draws:
   * an imported profile may carry an opacity or a font per key, which nothing
   * here can set — and a button that says "reset to global" while leaving one
   * behind is worse than no button.
   */
  function resetStyle() {
    onChange(
      overridden.reduce((next, property) => clearKeyStyle(next, selectedIds, property), config),
    );
  }

  function typed(input: HTMLInputElement, fallback: number): number | null {
    const value = Number(input.value);
    // Finite, not merely non-empty. A NaN would reach the configuration, fail
    // `isResolvedConfig` on the wire, and freeze the overlay on its last valid
    // frame — with the editor showing a change that never left the page.
    if (input.value === '' || !Number.isFinite(value)) {
      input.value = String(fallback);
      return null;
    }
    return value;
  }

  /**
   * Writes the configuration's own value back into the field.
   *
   * Every number here is clamped downstream — the position against the work
   * surface, the size against the grid. When the clamped result equals what was already stored, nothing
   * in the configuration changes, so Svelte never rewrites the input and it
   * goes on showing a figure nothing holds. **A silent clamp is how someone
   * concludes the setting is broken** — the finding of the 2026-08-20 review,
   * which `StylePanel.size()` acted on and this panel never did.
   */
  function settle(input: HTMLInputElement, value: number) {
    input.value = String(value);
  }

  /** The key as it came out of an edit, for `settle` to read its clamped value. */
  const after = (next: OverlayConfig, id: number) => next.keys.find((key) => key.id === id);
</script>

<!--
  The name of a style line, which says where its value comes from: in the
  muted grey when the key inherits, in amber when the selection sets it — any
  key of it, since clearing acts on all of them. One colour meaning one thing,
  "this differs from the global", as on the keys list and the key itself.

  The amber name is also the way back for its line. It keeps what the
  per-property reset could do before this section existed — return one value
  without returning the five beside it — and it sits exactly where one reads
  that the value was changed. The board's `override` / `global` tags said the
  same in a column of words; the words went on 2026-09-05, the colour stayed.

  `control` is the id the plain name labels; `labelId` is the id the name
  itself carries, for a group of buttons that names itself through
  `aria-labelledby` and cannot take a `<label for>`.
-->
{#snippet name(
  property: keyof KeyStyle,
  label: string,
  control: string | null,
  labelId: string | null = null,
)}
  {#if overridden.includes(property)}
    <button
      type="button"
      class="label overridden"
      id={labelId}
      data-marker
      data-reset={property}
      title="Reset to global"
      aria-label={`${label}: reset to global`}
      onclick={() => onChange(clearKeyStyle(config, selectedIds, property))}
    >
      {label}
    </button>
  {:else if control}
    <label for={control}>{label}</label>
  {:else}
    <span class="label" id={labelId}>{label}</span>
  {/if}
{/snippet}

{#if lead && effective}
  <div class="popover" role="dialog" aria-label="Key style">
    <!-- The name and the mode on one line (board 3a): "Z · key", and the
         switch that changes the second word beside it. -->
    <header>
      <span class="title">
        {single ? single.label : `${selection.length} keys`}
        <span class="kind">· {mode}</span>
      </span>
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
    </header>

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

    {#if single}
      <!-- One line for the label (board 3a): the word, the Text/Icon switch,
           and the field — or the grid under it when Icon is chosen. -->
      <div class="row">
        <!-- The badge sits with the word it qualifies, not at the far end of a
             `space-between` row where it would read as a third control. One
             colour, one meaning — this was customized — and the word says
             which kind.

             Outside `#key-label`, deliberately: that id is the accessible name
             of the segmented group, and folding "renamed" into it would have
             the Text/Icon buttons announce themselves as "Label renamed". -->
        <div class="named">
          <span class="label" id="key-label">Label</span>
          {#if detectedLabel !== null}
            <span
              class="badge"
              data-badge="renamed"
              title="Renamed by hand · this is not the name its position produces"
            >
              renamed
            </span>
          {/if}
        </div>
        <div class="value">
          <!-- Board 6e. Not a stored mode: it chooses which editor is on
               screen, and both write the same field. -->
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
          {#if labelKind === 'text'}
            <input
              id="key-label-text"
              name="label"
              type="text"
              aria-labelledby="key-label"
              value={single.label}
              onchange={(event) =>
                onChange(setKeyLabel(config, single.id, event.currentTarget.value))}
            />
          {/if}
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
              if (x === null) return;
              const next = moveKey(config, single.id, x, single.y, surface);
              settle(event.currentTarget, after(next, single.id)?.x ?? single.x);
              onChange(next);
            }}
          />
          <span class="times">·</span>
          <input
            name="y"
            type="number"
            step={GRID}
            aria-label="Y"
            value={single.y}
            onchange={(event) => {
              const y = typed(event.currentTarget, single.y);
              if (y === null) return;
              const next = moveKey(config, single.id, single.x, y, surface);
              settle(event.currentTarget, after(next, single.id)?.y ?? single.y);
              onChange(next);
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
            if (w === null) return;
            const next = resizeKeys(config, selectedIds, w, lead.h);
            settle(event.currentTarget, after(next, lead.id)?.w ?? lead.w);
            onChange(next);
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
            if (h === null) return;
            const next = resizeKeys(config, selectedIds, lead.w, h);
            settle(event.currentTarget, after(next, lead.id)?.h ?? lead.h);
            onChange(next);
          }}
        />
      </div>
    </div>

    <hr />

    <!--
      Every appearance property a key may hold, in a flat section between two
      hairlines (board 3a) — the inset card it used to sit in is gone. Seven of
      the ten: opacity and the two font properties stay global — two typefaces
      in one overlay serve no real case. The radius left this section on
      2026-09-05, the day the border's colour joined it: nobody ever rounded
      one key differently, and everybody wanted the coral key's outline coral.

      The heading is the fold's handle and its summary at once: shut, the line
      "STYLE · N overrides" is all that remains (spec §9.3 — what a fold hides
      has to be readable while it is shut).
    -->
    <button
      type="button"
      class="heading"
      data-style-toggle
      aria-expanded={styleOpen}
      aria-controls="key-style-rows"
      onclick={toggleStyle}
    >
      <span>
        STYLE
        {#if overridden.length > 0}
          <span class="count" data-override-count>
            · {overridden.length} override{overridden.length === 1 ? '' : 's'}
          </span>
        {/if}
      </span>
      <span class="caret" aria-hidden="true">▾</span>
    </button>

    {#if styleOpen}
      <div class="rows" id="key-style-rows">
        {#each COLORS as [property, label] (property)}
          <!-- The hex beside the swatch, as the global panel has it: a swatch
               alone cannot be copied into anything, and two greys a shade
               apart cannot be told apart by eye. -->
          <div class="row" data-style-row={property}>
            {@render name(property, label, `key-${property}`)}
            <div class="value">
              <input
                class="hex"
                type="text"
                data-hex
                name={`${property}Hex`}
                aria-label={`${label} hex code`}
                value={effective[property]}
                onchange={(event) => hex(property, event.currentTarget)}
              />
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

        <!--
          Per key since 2026-08-25, and the reason the property moved at all: an
          overlay hidden at rest exists to be empty, and the keys worth keeping
          on the stream are a handful, not a mode of their own.

          The editor keeps drawing every key whatever this says (`reveal`), so a
          key hidden here is still there to be selected and given back.
        -->
        <div class="row" data-style-row="restVisibility">
          {@render name('restVisibility', 'At rest', 'key-restVisibility')}
          <div class="value">
            <select
              id="key-restVisibility"
              name="key-restVisibility"
              value={effective.restVisibility}
              onchange={(event) =>
                apply('restVisibility', event.currentTarget.value as RestVisibility)}
            >
              {#each REST_STATES as [value, label] (value)}
                <option {value}>{label}</option>
              {/each}
            </select>
          </div>
        </div>

        <!--
          Beside the resting row, which is the setting it reads next to: one
          says what a key shows while nothing happens, the other what its
          outline does when something does. Per key because a border that
          announces itself is worth having on the two keys that matter and not
          on the twenty around them.

          `borderColor` stays global on purpose — this row governs the
          behaviour, never the resting colour.
        -->
        <div class="row" data-style-row="activeBorder">
          {@render name('activeBorder', 'On press', 'key-activeBorder')}
          <div class="value">
            <select
              id="key-activeBorder"
              name="key-activeBorder"
              value={effective.activeBorder}
              onchange={(event) => apply('activeBorder', event.currentTarget.value as ActiveBorder)}
            >
              {#each BORDER_STATES as [value, label] (value)}
                <option {value}>{label}</option>
              {/each}
            </select>
          </div>
        </div>

        <!-- The global panel's four arrows, at this block's density. Each
             carries its full label for whoever hears it. -->
        <div class="row" data-style-row="fillDirection">
          {@render name('fillDirection', 'Fill direction', null, 'key-fillDirection-label')}
          <div class="value">
            <div class="segmented small" role="group" aria-labelledby="key-fillDirection-label">
              {#each FILL_DIRECTIONS as [value, label] (value)}
                <button
                  type="button"
                  data-direction={value}
                  class:on={effective.fillDirection === value}
                  aria-pressed={effective.fillDirection === value}
                  aria-label={label}
                  title={label}
                  onclick={() => apply('fillDirection', value)}
                >
                  {FILL_ARROWS[value]}
                </button>
              {/each}
            </div>
          </div>
        </div>

        {#if overridden.length > 0}
          <div class="row start">
            <button type="button" class="link" data-reset-all onclick={resetStyle}>
              Reset to global
            </button>
          </div>
        {/if}
      </div>
    {/if}

    <hr />

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
      Delete{selection.length > 1 ? ` ${selection.length} keys` : ''} · Del
    </button>
  </div>
{/if}

<style>
  .popover {
    display: grid;
    gap: 12px;
    /* Border-box, or the token lies: without it the 380 px is the *content*
       box and the panel really occupies 412 — padding and border on top. The
       editor clamps the popover against the stage edge using that same token,
       so a token that means something else is a popover that still overflows,
       by exactly the padding. */
    box-sizing: border-box;
    inline-size: var(--he-popover-width);
    padding: 16px;
    background: var(--he-popover);
    border: 1px solid var(--he-border-popover);
    border-radius: var(--he-radius-panel);
    font-size: var(--he-size-sm);
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  .title {
    font-size: var(--he-size-lg);
    font-weight: 700;
    color: var(--he-text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .kind {
    font-weight: 400;
    color: var(--he-text-muted);
  }

  hr {
    margin: 0;
    border: none;
    block-size: 1px;
    background: var(--he-border-control);
  }

  /**
   * Three columns for every row — the name, the control, the tag — so the
   * controls line up down the popover whatever the name's length. A row that
   * is a lone link spans both.
   */
  .row {
    display: grid;
    grid-template-columns: 6.5rem minmax(0, 1fr);
    column-gap: 8px;
    align-items: center;
  }
  .row.end > *,
  .row.start > * {
    grid-column: 1 / -1;
  }
  .row.end > * {
    justify-self: end;
  }
  /* A row's label and the badge that qualifies it, held together in the
     name's column. */
  .named {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  label,
  .label {
    color: var(--he-text-muted);
    white-space: nowrap;
  }
  .value {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
    min-inline-size: 0;
  }
  /* The STYLE heading: a handle that reads as a heading, and says how many
     lines under it depart from the global while it is shut. */
  .heading {
    all: unset;
    box-sizing: border-box;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    font-size: var(--he-size-xs);
    font-weight: 600;
    letter-spacing: 0.05em;
    color: var(--he-text-muted);
  }
  .heading:hover {
    color: var(--he-text);
  }
  .heading:focus-visible {
    outline: 2px solid var(--he-accent);
    outline-offset: 2px;
    border-radius: 2px;
  }
  .count {
    font-weight: 400;
    letter-spacing: 0;
    color: var(--he-override);
  }
  .caret {
    transition: rotate 120ms ease-out;
  }
  .heading[aria-expanded='false'] .caret {
    rotate: -90deg;
  }
  .rows {
    display: grid;
    gap: 12px;
  }

  /* The name of an overridden line: amber, and the way back for that line.
     The underline waits for the pointer, so a column of names reads as names
     and the one that answers a click says so once the hand is there. */
  .label.overridden {
    all: unset;
    cursor: pointer;
    font-size: inherit;
    color: var(--he-override);
    white-space: nowrap;
  }
  .label.overridden:hover {
    text-decoration: underline;
  }
  .label.overridden:focus-visible {
    outline: 2px solid var(--he-accent);
    outline-offset: 2px;
    border-radius: 2px;
  }
  /* The renamed badge beside the Label word: the same amber, the same
     meaning — this was customized — and the word says which kind. */
  .badge {
    font-size: var(--he-size-xs);
    color: var(--he-override);
    white-space: nowrap;
  }

  .segmented {
    display: flex;
    flex: none;
    border: 1px solid var(--he-border-popover);
    border-radius: var(--he-radius);
    overflow: hidden;
  }
  .segmented button {
    font: inherit;
    font-size: var(--he-size-xs);
    color: var(--he-text-muted);
    background: none;
    border: 0;
    padding: 4px 12px;
    cursor: pointer;
  }
  .segmented button:hover {
    color: var(--he-text);
  }
  .segmented button.on {
    font-weight: 600;
    color: var(--he-bg);
    background: var(--he-accent);
  }
  .segmented.small button {
    padding: 2px 9px;
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
    font-size: var(--he-size-lg);
    color: var(--he-text);
    background: var(--he-bg);
    border: 1px solid var(--he-border-control);
    border-radius: var(--he-radius-control);
    cursor: pointer;
  }
  .icons button:hover {
    border-color: var(--he-border-hover);
  }
  .icons button.on {
    border-color: var(--he-accent);
    outline: 1px solid var(--he-accent);
  }
  .hint {
    margin: 0;
    font-size: var(--he-size-xs);
    line-height: 1.45;
    color: var(--he-text-faint);
  }
  .suggestion {
    margin: 0;
    display: grid;
    gap: 6px;
    font-size: var(--he-size-xs);
    line-height: 1.4;
    color: var(--he-text-muted);
    background: var(--he-surface);
    border: 1px solid var(--he-border-control);
    border-radius: var(--he-radius);
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
    font: var(--he-font-mono);
    font-size: var(--he-size-xs);
    color: var(--he-text);
    background: var(--he-stage);
    border: 1px solid var(--he-border-control);
    border-radius: 3px;
    padding: 1px 5px;
    margin-inline-start: 2px;
  }
  .link.quiet {
    color: var(--he-text-faint);
  }
  .link.quiet:hover {
    color: var(--he-text-muted);
  }
  .link {
    font: inherit;
    font-size: var(--he-size-xs);
    color: var(--he-accent);
    background: none;
    border: 0;
    padding: 0;
    cursor: pointer;
  }
  .link:hover {
    color: var(--he-accent-hover);
  }
  .danger {
    font: inherit;
    font-size: var(--he-size-xs);
    font-weight: 600;
    color: var(--he-danger);
    background: none;
    border: 1px solid var(--he-border-danger);
    border-radius: var(--he-radius);
    padding: 6px 0;
    text-align: center;
    cursor: pointer;
  }
  .danger:hover {
    background: var(--he-surface);
  }
  .times {
    font-size: var(--he-size-xs);
    color: var(--he-text-faint);
  }
  input[type='color'] {
    inline-size: 22px;
    block-size: 22px;
    padding: 0;
    background: none;
    border: 1px solid var(--he-border-control);
    border-radius: 3px;
    cursor: pointer;
  }
  input[type='text'],
  input[type='number'] {
    inline-size: 64px;
    box-sizing: border-box;
    font: var(--he-font-mono);
    font-size: var(--he-size-xs);
    color: var(--he-text);
    background: var(--he-stage);
    border: 1px solid var(--he-border-control);
    border-radius: 3px;
    padding: 4px 8px;
  }
  input[type='text'] {
    /* What is left of the row beside the Text/Icon switch. */
    flex: 1;
    min-inline-size: 0;
  }
  /* Seven characters of mono beside the swatch, no wider. */
  input.hex {
    flex: none;
    inline-size: 5.2rem;
  }
  /* The global panel's own select, at this block's density. A select left
     unstyled is not merely plainer — the browser paints it in its own light
     chrome, which on a dark popover reads as a foreign control someone forgot.

     It fills its column: the longest option ("Hidden until pressed") sets no
     width of its own, so every select in the popover ends on the same line. */
  select {
    flex: 1;
    min-inline-size: 0;
    font: inherit;
    font-size: var(--he-size-xs);
    color: var(--he-text);
    background: var(--he-stage);
    border: 1px solid var(--he-border-control);
    border-radius: 3px;
    padding: 4px 6px;
  }
  button:focus-visible,
  input:focus-visible,
  select:focus-visible {
    outline: 2px solid var(--he-accent);
    outline-offset: 1px;
  }
</style>
