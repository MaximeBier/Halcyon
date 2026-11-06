<script lang="ts">
  import { selectOnFocus } from './select-on-focus';
  import { ChevronDown, ChevronRight, RotateCcw, Trash2 } from './icons';
  import NumberField from './NumberField.svelte';
  import { escapeClosesPicker } from './gestures';
  import { untrack } from 'svelte';
  import {
    clearKeyStyle,
    detectedLabelFor,
    setKeyFont,
    setKeyLabel,
    setKeyMode,
    setKeyStyle,
  } from '../config/edit';
  import { effectiveStyle, overriddenInAny, overriddenKeys } from '../config/resolve';
  import { FONT_CATALOG, fontStack } from '../config/fonts';
  import InstalledFontsMenu from './InstalledFontsMenu.svelte';
  import { defaultWeight, type InstalledFamily } from './installed-fonts';
  import { useInstalledFonts } from './installed-fonts-state.svelte';
  import type { LocalFonts } from './local-fonts';
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
  import { BORDER_STATES, FILL_DIRECTIONS, FILL_ICONS, REST_STATES } from './style-choices';
  import Tooltip from './Tooltip.svelte';
  import { unusedColors } from './unused-colors';
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
    localFonts,
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
    /** For tests: the page shares one instance through `provideInstalledFonts`. */
    localFonts?: LocalFonts;
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
  /** The colours that paint none of the selected keys, and why (`unusedColors`). */
  const unused = $derived(unusedColors(config.style, selection, 'selection'));
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
    ['restColor', 'Background'],
    ['fillColor', 'Press depth'],
    ['activeColor', 'Triggered'],
    ['borderColor', 'Border'],
  ];

  /**
   * Hands the whole selection back to the global style, in one write.
   *
   * Every override the heading counted, not only the six the section draws:
   * an imported profile may carry an opacity per key, which nothing here can
   * set — and a button that says "reset to global" while leaving one
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

  /*
   * The label's font. Its row sits under Label, outside the STYLE fold — it is
   * the label being dressed — and is counted in that fold's heading all the
   * same, since it is an override like the colours below.
   */
  const fonts = useInstalledFonts(untrack(() => localFonts));
  $effect(() => {
    fonts.probe();
  });

  /** The lead's own choice, ticked in the menu; `null` when the lead inherits. */
  const ownFont = $derived(
    lead && effective && overriddenKeys(lead).includes('fontFamily') ? effective.fontFamily : null,
  );
  const fontEntry = $derived(fonts.list?.find(({ family }) => family === effective?.fontFamily));
  const fontInstalled = $derived(
    effective !== null && !FONT_CATALOG.some(({ family }) => family === effective.fontFamily),
  );
  /** As in the global panel: said only once the list is known, never guessed. */
  const fontNotHere = $derived(fontInstalled && fonts.list !== null && fontEntry === undefined);

  let fontMenu = $state(false);
  /** A refusal met from this menu — forgotten when it shuts, so reopening tries again. */
  let readDenied = $state(false);
  let fontSlot = $state<HTMLElement | null>(null);
  const installedView = $derived(fonts.list ?? (readDenied ? ('denied' as const) : null));

  function toggleFontMenu() {
    fontMenu = !fontMenu;
    readDenied = false;
  }

  /** The click is the gesture Chrome wants: `read()` keeps it whole. */
  function readInstalled() {
    void fonts.read().then((result) => {
      if (result === 'denied') readDenied = true;
    });
  }

  /**
   * Choosing the global font itself hands the key back rather than copying
   * it: a copy would look inherited and stop following the global choice.
   * `setKeyFont` holds that rule, so the two can never part.
   */
  function pickFont(family: string, weight: number) {
    onChange(setKeyFont(config, selectedIds, family, weight));
    fontMenu = false;
  }

  function pickInstalled(chosen: InstalledFamily) {
    pickFont(chosen.family, defaultWeight(chosen.weights.map(({ weight }) => weight)));
  }

  // The doctrine of every other menu on this page: Escape and a pointer
  // outside close it. Escape stops here — the stage reads it next, and would
  // shut the whole popover for a keystroke meant for the menu.
  $effect(() => {
    if (!fontMenu) return;

    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || escapeClosesPicker(event)) return;
      event.stopPropagation();
      fontMenu = false;
      fontSlot?.querySelector<HTMLElement>('[data-font-trigger]')?.focus();
    };
    const onPointer = (event: PointerEvent) => {
      if (!fontSlot?.contains(event.target as Node)) fontMenu = false;
    };

    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
    };
  });
</script>

<!--
  The name of a style line, which says where its value comes from: in the
  muted grey when the key inherits, in the accent when the selection sets it — any
  key of it, since clearing acts on all of them. One colour meaning one thing,
  "this differs from the global", as on the keys list and the key itself.

  The accent name is also the way back for its line. It keeps what the
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
      class="label overridden he-btn-tertiary"
      id={labelId}
      data-marker
      data-reset={property}
      title={property === 'fontFamily' ? 'Back to the global font' : 'Back to the global style'}
      aria-label={`${label}: back to the global ${property === 'fontFamily' ? 'font' : 'style'}`}
      onclick={() => onChange(clearKeyStyle(config, selectedIds, property))}
    >
      {label}
      <RotateCcw size={14} />
    </button>
  {:else if control}
    <label for={control}>{label}</label>
  {:else}
    <span class="label" id={labelId}>{label}</span>
  {/if}
{/snippet}

{#if lead && effective}
  <div class="popover" role="dialog" aria-label="Key style">
    <!-- The label alone (spec §16.15), and the switch beside it that says
         what the key is bound to. -->
    <header>
      <span class="title">
        {single ? single.label : `${selection.length} keys`}
      </span>
      <!-- What the key is bound to in Wootility (spec §16.15): a keyboard key
           has an actuation point, a gamepad input never fires. -->
      <div class="segmented" role="group" aria-label="Bound to">
        {#each [['key', 'Keyboard'], ['axis', 'Gamepad']] as [value, label] (value)}
          <button
            type="button"
            class="he-segment"
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
            class="he-btn-tertiary"
            data-accept-suggestion
            onclick={() => onChange(setKeyMode(config, selectedIds, 'axis'))}
          >
            Set to Gamepad
          </button>
          <button
            type="button"
            class="he-btn-tertiary he-btn-tertiary--muted"
            data-dismiss-suggestion
            onclick={onDismissSuggestion}
          >
            Keep Keyboard
          </button>
        </span>
      </p>
    {/if}

    {#if single}
      <!-- One line for the label (board 3a): the word, the Text/Icon switch,
           and the field — or the grid under it when Icon is chosen. -->
      <div class="row">
        {#if labelKind === 'text' && detectedLabel !== null}
          <!-- Renamed by hand: the name of the row says it, in the accent of
               own style, and is the way back (spec §16.15) — the counterpart of
               an overridden style line. The word inside keeps its id, so the
               group below is still announced as "Label". -->
          <button
            type="button"
            class="label overridden he-btn-tertiary"
            data-reset="label"
            title="Back to the key name"
            aria-label={`Label: back to ${detectedLabel}`}
            onclick={() => onChange(setKeyLabel(config, single.id, detectedLabel))}
          >
            <span id="key-label">Label</span>
            <RotateCcw size={14} />
          </button>
        {:else}
          <span class="label" id="key-label">Label</span>
        {/if}
        <div class="value">
          <!-- Board 6e. Not a stored mode: it chooses which editor is on
               screen, and both write the same field. -->
          <div class="segmented small" role="group" aria-labelledby="key-label">
            <button
              type="button"
              class="he-segment"
              data-label-kind="text"
              class:on={labelKind === 'text'}
              aria-pressed={labelKind === 'text'}
              onclick={toText}
            >
              Text
            </button>
            <button
              type="button"
              class="he-segment"
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
              use:selectOnFocus
              class="label-text"
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
              class="he-tile he-choice"
              class:on={single.label === icon}
              aria-pressed={single.label === icon}
              aria-label={`Icon ${icon}`}
              onclick={() => onChange(setKeyLabel(config, single.id, icon))}
            >
              {icon}
            </button>
          {/each}
        </div>
      {/if}
    {/if}

    <!-- The whole selection's, unlike the label above: a group of arrows is
         exactly what gets a face of its own. The name drawn in itself, as in
         the global panel's tiles. -->
    <div class="row" data-style-row="fontFamily">
      {@render name('fontFamily', 'Font', null, 'key-font-label')}
      <div class="value font-slot" bind:this={fontSlot}>
        {#if fontNotHere}
          <span class="missing" data-not-installed>Not installed here</span>
        {/if}
        <button
          type="button"
          class="font-choice"
          data-font-trigger
          aria-haspopup="dialog"
          aria-expanded={fontMenu}
          aria-label={`Font: ${effective.fontFamily}`}
          onclick={toggleFontMenu}
        >
          <span
            style:font-family={fontStack(effective.fontFamily)}
            style:font-weight={effective.fontWeight}>{effective.fontFamily}</span
          >
          <span class="more" aria-hidden="true"><ChevronDown size={14} /></span>
        </button>
        {#if fontMenu}
          <InstalledFontsMenu
            families={installedView}
            current={ownFont}
            onPick={pickInstalled}
            inherit={{
              family: config.style.fontFamily,
              onPick: () => pickFont(config.style.fontFamily, config.style.fontWeight),
            }}
            onPickFace={pickFont}
            onRead={fonts.access === 'unsupported' ? null : readInstalled}
            retry="try again"
          />
        {/if}
      </div>
    </div>

    <!-- Only for a family with a choice to make, as in the global panel. -->
    {#if fontInstalled && fontEntry && fontEntry.weights.length > 1}
      <div class="row">
        <label for="key-fontWeight">Style</label>
        <div class="value">
          <select
            class="he-select"
            id="key-fontWeight"
            name="key-fontWeight"
            value={String(effective.fontWeight)}
            onchange={(event) => pickFont(fontEntry.family, Number(event.currentTarget.value))}
          >
            {#each fontEntry.weights as { weight, style } (weight)}
              <option value={String(weight)}>{style}</option>
            {/each}
          </select>
        </div>
      </div>
    {/if}

    {#if single}
      <!-- Dragging alone becomes frustrating the moment two keys have to line
           up exactly, which is why the spec asks for numeric fields (§8.7).
           Single selection only: a group shares a size, not a position. -->
      <div class="row">
        <span class="label" id="key-position">Position</span>
        <div class="value" aria-labelledby="key-position">
          <NumberField
            name="x"
            label="X"
            value={single.x}
            step={GRID}
            variant="axis"
            prefix="X"
            onchange={(input) => {
              const x = typed(input, single.x);
              if (x === null) return;
              const next = moveKey(config, single.id, x, single.y, surface);
              settle(input, after(next, single.id)?.x ?? single.x);
              onChange(next);
            }}
          />
          <NumberField
            name="y"
            label="Y"
            value={single.y}
            step={GRID}
            variant="axis"
            prefix="Y"
            onchange={(input) => {
              const y = typed(input, single.y);
              if (y === null) return;
              const next = moveKey(config, single.id, single.x, y, surface);
              settle(input, after(next, single.id)?.y ?? single.y);
              onChange(next);
            }}
          />
        </div>
      </div>
    {/if}

    <div class="row">
      <span class="label" id="key-size">Size</span>
      <div class="value" aria-labelledby="key-size">
        <NumberField
          name="width"
          label="Width"
          value={lead.w}
          min={GRID}
          step={GRID}
          variant="axis"
          prefix="W"
          onchange={(input) => {
            const w = typed(input, lead.w);
            if (w === null) return;
            const next = resizeKeys(config, selectedIds, w, lead.h);
            settle(input, after(next, lead.id)?.w ?? lead.w);
            onChange(next);
          }}
        />
        <NumberField
          name="height"
          label="Height"
          value={lead.h}
          min={GRID}
          step={GRID}
          variant="axis"
          prefix="H"
          onchange={(input) => {
            const h = typed(input, lead.h);
            if (h === null) return;
            const next = resizeKeys(config, selectedIds, lead.w, h);
            settle(input, after(next, lead.id)?.h ?? lead.h);
            onChange(next);
          }}
        />
      </div>
    </div>

    <hr />

    <!--
      Every appearance property a key may hold, in a flat section between two
      hairlines (board 3a) — the inset card it used to sit in is gone. Opacity
      stays global. The label's font is a key's to choose too, but it belongs
      with the label rather than here, and is counted in the heading all the
      same. The radius left this section on
      2026-09-05, the day the border's colour joined it: nobody ever rounded
      one key differently, and everybody wanted the coral key's outline coral.

      The heading is the fold's handle and its summary at once: shut, the line
      "STYLE · N changed" is all that remains (spec §9.3 — what a fold hides
      has to be readable while it is shut).
    -->
    <button
      type="button"
      class="heading he-text-btn"
      data-style-toggle
      aria-expanded={styleOpen}
      aria-controls="key-style-rows"
      onclick={toggleStyle}
    >
      <span class="caret" aria-hidden="true"><ChevronRight size={14} /></span>
      <span>
        STYLE
        {#if overridden.length > 0}
          <span class="count" data-override-count>
            · {overridden.length} changed
          </span>
        {/if}
      </span>
    </button>

    {#if styleOpen}
      <div class="rows" id="key-style-rows">
        {#each COLORS as [property, label] (property)}
          <!-- The hex beside the swatch, as the global panel has it: a swatch
               alone cannot be copied into anything, and two greys a shade
               apart cannot be told apart by eye. -->
          <!-- Out of use when no key here has a face to paint (board
               Editor-Tooltip): the whole row, its overridden name included. -->
          {@const why = unused[property as keyof typeof unused]}
          <Tooltip text={why} block>
            {#snippet children()}
              <div
                class="row"
                class:he-inert={why !== undefined}
                inert={why !== undefined}
                data-style-row={property}
              >
                {@render name(property, label, `key-${property}`)}
                <div class="value">
                  <input
                    id={`key-${property}`}
                    name={property}
                    type="color"
                    class="he-tile"
                    disabled={why !== undefined}
                    value={effective[property]}
                    onchange={(event) => apply(property, event.currentTarget.value)}
                  />
                  <input
                    use:selectOnFocus
                    class="hex"
                    type="text"
                    data-hex
                    name={`${property}Hex`}
                    aria-label={`${label} hex code`}
                    disabled={why !== undefined}
                    value={effective[property]}
                    onchange={(event) => hex(property, event.currentTarget)}
                  />
                </div>
              </div>
            {/snippet}
          </Tooltip>
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
              class="he-select"
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
          {@render name('activeBorder', 'Pressed border', 'key-activeBorder')}
          <div class="value">
            <select
              class="he-select"
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
                {@const Arrow = FILL_ICONS[value]}
                <button
                  type="button"
                  class="he-segment"
                  data-direction={value}
                  class:on={effective.fillDirection === value}
                  aria-pressed={effective.fillDirection === value}
                  aria-label={label}
                  title={label}
                  onclick={() => apply('fillDirection', value)}
                >
                  <Arrow size={14} aria-hidden="true" />
                </button>
              {/each}
            </div>
          </div>
        </div>

        {#if overridden.length > 0}
          <div class="row start">
            <button type="button" class="he-btn-tertiary" data-reset-all onclick={resetStyle}>
              Reset to global
              <RotateCcw size={14} />
            </button>
          </div>
        {/if}
      </div>
    {/if}

    <hr />

    <button
      type="button"
      class="he-btn-danger"
      data-delete
      onclick={() => {
        onChange(removeKeys(config, selectedIds));
        // Anchored to a selection that no longer exists, it would sit over an
        // empty patch of stage with a stale label in it.
        onClose();
      }}
    >
      <Trash2 size={16} />
      Delete{selection.length > 1 ? ` ${selection.length} keys` : ''}
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
    grid-template-columns: var(--he-popover-name-column) minmax(0, 1fr);
    column-gap: 8px;
    align-items: center;
  }
  .row.start > * {
    grid-column: 1 / -1;
  }
  label,
  .label {
    white-space: nowrap;
  }
  /* An overridden name takes the tertiary's colours instead (spec §16.13). */
  label,
  .label:not(.overridden) {
    color: var(--he-text-muted);
  }
  .value {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
    min-inline-size: 0;
  }
  /* The anchor of the font menu, which opens under the name, right-aligned. */
  .font-slot {
    position: relative;
  }
  .font-choice {
    all: unset;
    cursor: pointer;
    display: inline-flex;
    align-items: baseline;
    gap: 5px;
    min-inline-size: 0;
    font-size: var(--he-size-sm);
    color: var(--he-text);
    white-space: nowrap;
  }
  .font-choice > :first-child {
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .font-choice:focus-visible {
    outline: 2px solid var(--he-accent);
    outline-offset: 2px;
    border-radius: 2px;
  }
  /* In the interface's face, whatever the name beside it is drawn in. */
  .more {
    display: inline-grid;
    color: var(--he-text-muted);
  }
  /* The menu it opens is open: the chevron says so, as a dropdown's does. */
  [aria-expanded='true'] .more {
    color: var(--he-accent);
  }
  .missing {
    font-size: var(--he-size-xs);
    color: var(--he-warn);
    white-space: nowrap;
  }
  /* The STYLE heading: a handle that reads as a heading, and says how many
     lines under it depart from the global while it is shut. */
  .heading {
    all: unset;
    box-sizing: border-box;
    cursor: pointer;
    display: flex;
    align-items: center;
    /* The chevron, then the title beside it (board Editor-KeyPopover): never
       the title pushed to the far end of the line. */
    justify-content: flex-start;
    gap: 8px;
    font-size: var(--he-size-xs);
    font-weight: 600;
    letter-spacing: 0.05em;
    color: var(--he-text-muted);
  }
  .count {
    font-weight: 400;
    letter-spacing: 0;
    color: var(--he-accent);
  }
  /* Before the title, turned a quarter when open — the panel's groups' own
     chevron (spec §16.13). */
  .caret {
    display: inline-grid;
    color: var(--he-text-muted);
    transition: rotate 150ms ease-out;
  }
  .heading[aria-expanded='true'] .caret {
    rotate: 90deg;
  }
  .rows {
    display: grid;
    gap: 12px;
  }

  /* The name of an overridden line: the accent of own style (amber is kept
     for what needs a look, spec §16.13), and the way back for that line. A
     tertiary like "Reset to global" — the same colours, the same hover, never
     an underline — at the size of the names around it. */
  .label.overridden {
    justify-self: start;
    gap: 4px;
    font-size: inherit;
  }

  .segmented {
    display: flex;
    flex: none;
    border: 1px solid var(--he-border-popover);
    border-radius: var(--he-radius);
    overflow: hidden;
  }
  /* 24 px inside the border: 26 with it, the height of every field beside it. */
  .segmented button {
    box-sizing: border-box;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-inline-size: 28px;
    block-size: 24px;
    font: inherit;
    font-size: var(--he-size-xs);
    color: var(--he-text-muted);
    background: none;
    border: 0;
    padding: 0 12px;
    cursor: pointer;
  }
  /* Inside: the group clips its corners, and would clip a ring drawn out. */
  .segmented button:focus-visible {
    outline-offset: -2px;
  }
  .segmented button.on {
    font-weight: 600;
    color: var(--he-bg);
    background: var(--he-accent);
  }
  .segmented.small button {
    padding: 0 9px;
  }
  /* Six across, as the board draws it — twelve glyphs in two rows fit the
     284 px panel without any of them shrinking below a target. */
  /* The ground the chosen icon's ring stands on (he-choice, controls.css). */
  .icons {
    --choice-ground: var(--he-popover);
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
    border: 1px solid var(--he-border-popover);
    border-radius: var(--he-radius);
    cursor: pointer;
  }
  /* The chosen glyph is ringed like a chosen preset or font tile (spec
     §16.13): an outline, so the border it keeps is the one every case has. */
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
  input[type='color'] {
    /* A square as tall as the hex field beside it (26 with its edge). */
    inline-size: 26px;
    block-size: 26px;
    box-sizing: border-box;
    padding: 0;
    background: none;
    /* The tile's 1 px edge (board): what keeps a dark colour from
       vanishing into the panel. */
    border: 1px solid var(--he-border-popover);
    border-radius: var(--he-radius);
    cursor: pointer;
  }
  input[type='text'] {
    inline-size: 64px;
    box-sizing: border-box;
    font: var(--he-font-mono);
    font-size: var(--he-size-xs);
    color: var(--he-text);
    background: var(--he-well);
    border: 1px solid var(--he-border-control);
    border-radius: var(--he-radius);
    padding: 4px 8px;
  }
  /* One character wide, as most labels are, and as wide as the label once it
     is longer (board Editor-KeyPopover): never a long box around one letter. */
  input.label-text {
    flex: none;
    inline-size: auto;
    field-sizing: content;
    min-inline-size: 34px;
    max-inline-size: 100%;
    text-align: center;
  }
  /* Seven characters of mono beside the swatch, no wider. */
  input.hex {
    flex: none;
    inline-size: 5.2rem;
  }
</style>
