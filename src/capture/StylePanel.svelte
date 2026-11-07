<script lang="ts">
  import { selectOnFocus } from './select-on-focus';
  import { ChevronDown, ChevronRight, Plus, RotateCcw } from './icons';
  import NumberField from './NumberField.svelte';
  import { escapeClosesPicker } from './gestures';
  import { resetKeyFonts, setFont, setGlobalStyle } from '../config/edit';
  import { ownFontCount, resolve } from '../config/resolve';
  import KeyboardView from '../view/KeyboardView.svelte';
  import { buildScene } from '../view/scene';
  import { FONT_CATALOG, fontStack } from '../config/fonts';
  import { normalizeHex } from '../config/validate';
  import { PRESETS, presetFor, withPreset } from './presets';
  import InstalledFontsMenu from './InstalledFontsMenu.svelte';
  import HelpText from './HelpText.svelte';
  import { tick, untrack } from 'svelte';
  import { defaultWeight, type InstalledFamily } from './installed-fonts';
  import { useInstalledFonts } from './installed-fonts-state.svelte';
  import type { LocalFonts } from './local-fonts';
  /** Shared with `KeyPopover`, whose three choices are the same three since 2026-08-26. */
  import {
    BORDER_STATES,
    FILL_ICONS,
    FILL_DIRECTIONS,
    LABEL_OUTLINES,
    LABEL_SIZES,
    REST_STATES,
  } from './style-choices';
  import Tooltip from './Tooltip.svelte';
  import { unusedColors } from './unused-colors';
  import { miniRing } from './mini-ring';
  import {
    BORDER_WIDTH_BOUNDS,
    RADIUS_BOUNDS,
    type ActiveBorder,
    type OverlayConfig,
    type RestVisibility,
  } from '../config/schema';

  /**
   * Global appearance, and nothing else.
   *
   * The per-key editor is `KeyPopover`, a separate component anchored to the
   * selection (spec §16.4). They were one component in the plan, sharing an
   * `apply` that chose its target from the selection — a tempting shape, and a
   * dangerous one: writing to the wrong side looks identical on screen,
   * because the preview renders the resolved style either way. Splitting them
   * makes the mistake unwritable rather than merely unlikely.
   *
   * Groups since board 3a — Colors, Shape, Behavior, and Label between the
   * last two since 2026-11-04 — none open by default: the panel is read far
   * more often than it is edited, and twelve
   * controls in a column made the keys list below them something to scroll
   * for. Each opens on its own; the accordion of the first draft shut Colors
   * the moment Shape was opened, and a border is chosen with its colour in
   * view.
   */
  let {
    config,
    onChange,
    localFonts,
  }: {
    config: OverlayConfig;
    onChange: (next: OverlayConfig) => void;
    /** For tests: the page shares one instance through `provideInstalledFonts`. */
    localFonts?: LocalFonts;
  } = $props();

  type Group = 'colors' | 'shape' | 'label' | 'behavior';

  /**
   * Which groups are open. Component state and nothing more: they start shut
   * on every load, which is what "collapsed by default" means, and a session
   * is exactly how long the memory of which ones were open is worth.
   */
  let open = $state<Record<Group, boolean>>({
    colors: false,
    shape: false,
    label: false,
    behavior: false,
  });

  function toggle(group: Group) {
    open[group] = !open[group];
  }

  /**
   * Opens a group from outside and brings it on screen, its header focused:
   * Diagnostics' "Change font" lands on Label this way (spec §11). `nearest`
   * scrolls the panel, never the whole page, when the group is already there.
   */
  export async function reveal(group: Group) {
    open[group] = true;
    await tick();
    const header = root?.querySelector<HTMLElement>(`[data-group="${group}"]`);
    header?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
    header?.focus();
  }
  let root = $state<HTMLElement | null>(null);

  /** Shared with the key popover, so a permission granted in one is granted in both. */
  const fonts = useInstalledFonts(untrack(() => localFonts));
  const access = $derived(fonts.access);
  const installed = $derived(fonts.list);
  /** How many keys draw their label in a font of their own, whatever this group says. */
  const ownFonts = $derived(ownFontCount(config.keys));
  /** What the open menu shows, or `null` while it is shut. */
  let menu = $state<InstalledFamily[] | 'denied' | null>(null);
  let slot = $state<HTMLElement | null>(null);

  /** Neither of the embedded faces: the family came from this machine, or another one. */
  const installedChosen = $derived(
    !FONT_CATALOG.some(({ family }) => family === config.style.fontFamily),
  );
  const entry = $derived(installed?.find(({ family }) => family === config.style.fontFamily));
  /**
   * The installed font the fourth tile holds, chosen or not (board
   * Editor-LabelInstalledFont): pick another tile and it stays there, one
   * click above giving it back. Taken from the profile when its font is an
   * installed one, and from every installed font chosen since.
   */
  let keptFont = $state<{ family: string; weight: number } | null>(
    untrack(() =>
      installedChosen ? { family: config.style.fontFamily, weight: config.style.fontWeight } : null,
    ),
  );
  $effect(() => {
    if (installedChosen) {
      keptFont = { family: config.style.fontFamily, weight: config.style.fontWeight };
    }
  });
  /**
   * A family the tile holds and this machine does not have — a profile made
   * on the other PC. The name is kept and said to be missing, never replaced:
   * the PC running OBS may well have it.
   */
  const notHere = $derived(
    keptFont !== null &&
      installed !== null &&
      !installed.some(({ family }) => family === keptFont!.family),
  );

  /** The tile's upper half: its font, applied — and nothing if it already is. */
  function chooseKept() {
    if (keptFont === null || (installedChosen && config.style.fontFamily === keptFont.family))
      return;
    onChange(setFont(config, keptFont.family, keptFont.weight));
  }

  /**
   * Asks where the permission stands when the group first opens, and reads
   * the list straight away if it is already granted — reading needs no
   * gesture then, and it is what lets the tile say "not installed here"
   * before anyone clicks it.
   */
  $effect(() => {
    if (open.label) fonts.probe();
  });

  /** The click is the gesture Chrome wants: `read()` keeps it whole. */
  function toggleInstalled() {
    if (menu !== null) {
      menu = null;
      return;
    }
    if (installed !== null) {
      menu = installed;
      return;
    }
    void fonts.read().then((result) => {
      menu = result;
    });
  }

  function pick(chosen: InstalledFamily) {
    const weight = defaultWeight(chosen.weights.map(({ weight }) => weight));
    onChange(setFont(config, chosen.family, weight));
    menu = null;
  }

  // The doctrine of every other popover on this page: Escape and a pointer
  // outside close it, and the tile's own click reaches `toggleInstalled`
  // because the tile is inside `slot`.
  $effect(() => {
    if (menu === null) return;

    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || escapeClosesPicker(event)) return;
      menu = null;
      // Back to what opened it: "Other fonts" on a filled tile, the tile itself on an empty one.
      slot?.querySelector<HTMLElement>('[data-other-fonts], [data-installed]')?.focus();
    };
    const onPointer = (event: PointerEvent) => {
      if (!slot?.contains(event.target as Node)) menu = null;
    };

    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
    };
  });

  /**
   * Keys that answer for their own resting state, and so are not covered by
   * what this panel says about the overlay.
   *
   * Counted rather than merely detected: "some keys" leaves the reader
   * searching the layout for how many, and the figure is one property read off
   * the keys already in hand.
   */
  const kept = $derived(config.keys.filter((key) => key.style?.restVisibility).length);

  /**
   * The four colours of the overlay, in the order a key wears them: pressed,
   * travelling, resting, outlined. The border is a colour like the others and
   * sits with them — its width is a shape, and sits in Shape.
   */
  /** The colours that paint none of the profile's keys, and why (`unusedColors`). */
  const unused = $derived(unusedColors(config.style, config.keys, 'profile'));

  const COLORS: [
    keyof typeof config.style & ('activeColor' | 'fillColor' | 'restColor' | 'borderColor'),
    string,
  ][] = [
    ['restColor', 'Background'],
    ['fillColor', 'Press depth'],
    ['activeColor', 'Triggered'],
    ['borderColor', 'Border'],
  ];

  /**
   * The key beside the four colours (spec §16.13, board Editor-GlobalStyle):
   * one key, drawn by the overlay's own renderer, half pressed in the global
   * colours. The row under the pointer rings the part it paints; Triggered
   * fires the key instead, which is the one colour a key at rest never shows.
   *
   * `scene.ts` swaps the colours of a key that fires; drawing it there rather
   * than here is what keeps this key from ever disagreeing with the stream.
   *
   * While a swatch's picker is open, the key wears the colour under the
   * cursor, live (`input`), with its zone ringed and Triggered fired — the
   * pointer is in the picker by then, not on the row. Only `change`, the
   * colour chosen, reaches the profile: one undo step and one broadcast, not
   * one per pixel of the drag.
   */
  type Colour = (typeof COLORS)[number][0];
  let hovered = $state<Colour | null>(null);
  let picking = $state<{ property: Colour; value: string } | null>(null);
  const showing = $derived(picking?.property ?? hovered);
  // The global radius and border width as they are, in pixels: the key reads
  // the Shape settings the way it reads the colours.
  const MINI = { unit: 56, label: 'A', travel: Math.round(0.45 * 1023) };
  const mini = $derived(
    resolve({
      ...config,
      style: {
        ...config.style,
        ...(picking ? { [picking.property]: picking.value } : {}),
        unit: MINI.unit,
        gap: 0,
      },
      keys: [{ id: 0, usage: 0, mode: 'key', label: MINI.label, x: 0, y: 0, w: 1, h: 1 }],
    }),
  );
  const miniFrame = $derived([[0, MINI.travel, showing === 'activeColor' ? 1 : 0]] as const);
  const miniKey = $derived(buildScene(mini, miniFrame, { reveal: true }).keys[0]);
  /** As the renderer drew it, which keeps a radius within half the key. */
  const miniRadius = $derived(miniKey?.radius ?? config.style.radius);
  const RINGS: Partial<Record<Colour, 'face' | 'depth' | 'border'>> = {
    restColor: 'face',
    fillColor: 'depth',
    borderColor: 'border',
  };
  const ring = $derived(showing === null ? undefined : (RINGS[showing] ?? 'depth'));
  /** Face and fill ringed inside the border, as the board draws them (`miniRing`). */
  const ringed = $derived(
    ring && miniKey
      ? miniRing(ring, {
          size: MINI.unit,
          radius: miniRadius,
          border: miniKey.border,
          fill: miniKey.fill,
        })
      : null,
  );

  /** The preset the three colours currently spell, or null once one has moved. */
  const worn = $derived(presetFor(config.style));

  /** What each size may hold. `min` and `max` bind the spinner, not the keyboard. */
  const BOUNDS = {
    unit: { min: 16, max: 200 },
    gap: { min: 0, max: 40 },
    // From the schema, where the import and the wire read the same ceiling.
    radius: RADIUS_BOUNDS,
    borderWidth: BORDER_WIDTH_BOUNDS,
  } as const;

  /**
   * Reads a size field, and refuses to let it out of range.
   *
   * `min` and `max` on a number input constrain the arrows and validation, not
   * what can be typed — and nothing downstream is forgiving. A unit of zero
   * passes `setGlobalStyle`, is saved, and is broadcast, where
   * `isExtent(unit)` rejects it and `parseMessage` discards the whole
   * configuration message: the overlay stays on the last good one and says
   * nothing. Found in review on 2026-08-20.
   *
   * `''` and unparseable text are put back rather than clamped: `+''` is `0`
   * and `Number('e')` is `NaN`, and someone clearing a field to retype it has
   * not asked for anything yet.
   */
  function size(property: 'unit' | 'gap' | 'radius' | 'borderWidth', input: HTMLInputElement) {
    const { min, max } = BOUNDS[property];
    const typed = Number(input.value);

    if (input.value === '' || !Number.isFinite(typed)) {
      input.value = String(config.style[property]);
      return;
    }

    const value = Math.min(max, Math.max(min, typed));
    // Written back, so the field never shows a figure the configuration does
    // not hold — a silent clamp is how someone concludes the setting is broken.
    input.value = String(value);
    onChange(setGlobalStyle(config, property, value));
  }

  /** A colour typed as text: taken when it is one, put back when it is not. */
  function hex(property: (typeof COLORS)[number][0], input: HTMLInputElement) {
    const value = normalizeHex(input.value);
    if (value === null) {
      input.value = config.style[property];
      return;
    }
    input.value = value;
    onChange(setGlobalStyle(config, property, value));
  }

  /** The opacity as the interface speaks it: whole percent, never a fraction. */
  const percent = $derived(Math.round(config.style.opacity * 100));

  /**
   * Where the thumb is *right now*, mid-drag, or `null` when nothing is being
   * dragged. The slider only commits on release (see below), so without this
   * the figure beside it would sit still while the thumb moved — and knowing
   * when to let go is the whole reason to read the figure while dragging.
   */
  let dragged = $state<number | null>(null);
  const shown = $derived(dragged ?? percent);

  /**
   * The typed half of the opacity control (board 3a): the slider is for
   * exploring, this is for landing on exactly 80. Same discipline as `size`
   * — an empty or unreadable field is put back, an out-of-range one clamped
   * and written back.
   */
  function typedPercent(input: HTMLInputElement) {
    const typed = Number(input.value);
    if (input.value === '' || !Number.isFinite(typed)) {
      input.value = String(percent);
      return;
    }
    const value = Math.min(100, Math.max(0, Math.round(typed)));
    input.value = String(value);
    onChange(setGlobalStyle(config, 'opacity', value / 100));
  }
</script>

<!-- No heading of its own: this panel always sits under the "Global style"
     title of the side panel, and a second title directly under the first read as two
     sections where there is one. The aria-label keeps the landmark. -->
<section aria-label="Global style" bind:this={root}>
  <div class="group" class:open={open.colors}>
    <!-- No note in the header (board 3a): a group says what it holds, and the
         values wait inside. The one mark allowed is the dot beside the
         "Global style" title above, for a style that departs from the defaults. -->
    <button
      type="button"
      class="head"
      data-group="colors"
      aria-expanded={open.colors}
      aria-controls="style-colors"
      onclick={() => toggle('colors')}
    >
      <span class="caret" aria-hidden="true"><ChevronRight size={14} /></span>
      Colors
    </button>
    {#if open.colors}
      <div class="body" id="style-colors">
        <!--
          At the head of the group, as the lot of 2026-08-21 has it, and drawn
          as one swatch per preset carrying its colours in bands. No sentence
          under them (spec §16.13): the four rows below change as the swatch
          is clicked, which says what a preset sets better than a line can.
        -->
        <div class="presets">
          <div class="swatches" role="group" aria-label="Presets">
            {#each PRESETS as preset (preset.name)}
              <Tooltip text={preset.name}>
                {#snippet children()}
                  <button
                    type="button"
                    class="preset he-tile he-choice"
                    data-preset={preset.name}
                    class:on={worn === preset}
                    aria-pressed={worn === preset}
                    aria-label={`Preset: ${preset.name}`}
                    style:background={`linear-gradient(180deg, ${preset.activeColor} 0 46%, ${preset.fillColor} 46% 76%, ${preset.restColor} 76% 100%)`}
                    onclick={() => onChange(withPreset(config, preset))}
                  ></button>
                {/snippet}
              </Tooltip>
            {/each}
          </div>
        </div>

        <div class="colors">
          <figure
            class="mini"
            data-mini-key
            data-state={showing === 'activeColor' ? 'triggered' : 'half'}
            data-ring={ring}
            aria-hidden="true"
          >
            <span class="mini-key" style:border-radius={`${miniRadius}px`}>
              <KeyboardView config={mini} frame={miniFrame} reveal />
              {#if ringed}
                <span
                  class="ring-clip"
                  data-ring-clip
                  style:inset={`${ringed.clip.inset}px`}
                  style:border-radius={`${ringed.clip.radius}px`}
                >
                  <span
                    class="ring"
                    style:left={`${ringed.box.x}px`}
                    style:top={`${ringed.box.y}px`}
                    style:width={`${ringed.box.w}px`}
                    style:height={`${ringed.box.h}px`}
                    style:border-radius={ringed.radii.map((r) => `${r}px`).join(' ')}
                  ></span>
                </span>
              {:else if ring === 'border'}
                <span class="ring border" style:border-radius={`${miniRadius}px`}></span>
              {/if}
            </span>
          </figure>

          <div class="color-rows">
            {#each COLORS as [property, label] (property)}
              <!-- Out of use, the whole row (board Editor-Tooltip): name,
                   swatch and code dimmed, inert, and the reason on hover. -->
              {@const why = unused[property as keyof typeof unused]}
              <Tooltip text={why} block>
                {#snippet children()}
                  <div
                    class="row color"
                    class:hovered={showing === property}
                    class:he-inert={why !== undefined}
                    inert={why !== undefined}
                    data-color-row={property}
                    role="group"
                    aria-label={label}
                    onpointerenter={() => (hovered = property)}
                    onpointerleave={() => (hovered = null)}
                    onfocusin={() => (hovered = property)}
                    onfocusout={() => (hovered = null)}
                  >
                    <label for={`global-${property}`}>{label}</label>
                    <div class="value">
                      <input
                        id={`global-${property}`}
                        name={property}
                        type="color"
                        class="he-tile"
                        value={config.style[property]}
                        disabled={why !== undefined}
                        oninput={(event) =>
                          (picking = { property, value: event.currentTarget.value })}
                        onchange={(event) => {
                          picking = null;
                          onChange(setGlobalStyle(config, property, event.currentTarget.value));
                        }}
                        onblur={() => (picking = null)}
                      />
                      <!-- The code is a field, not a caption: a colour copied from
                   a stream layout or a brand sheet arrives as six characters,
                   and a swatch cannot take those. Anything that is not a hex
                   colour is put back rather than half-applied. -->
                      <input
                        use:selectOnFocus
                        class="hex"
                        type="text"
                        name={`${property}Hex`}
                        aria-label={`${label} hex code`}
                        disabled={why !== undefined}
                        value={config.style[property]}
                        onchange={(event) => hex(property, event.currentTarget)}
                      />
                    </div>
                  </div>
                {/snippet}
              </Tooltip>
            {/each}
          </div>
        </div>
      </div>
    {/if}
  </div>

  <div class="group" class:open={open.shape}>
    <button
      type="button"
      class="head"
      data-group="shape"
      aria-expanded={open.shape}
      aria-controls="style-shape"
      onclick={() => toggle('shape')}
    >
      <span class="caret" aria-hidden="true"><ChevronRight size={14} /></span>
      Shape
    </button>
    {#if open.shape}
      <div class="body" id="style-shape">
        <!-- A style property `KeyStyle` has carried since task 13, that the
             renderer has always applied, and that nothing could set. -->
        <div class="row">
          <label for="global-radius">Radius</label>
          <div class="value">
            <NumberField
              id="global-radius"
              name="radius"
              label="Radius"
              value={config.style.radius}
              min={BOUNDS.radius.min}
              max={BOUNDS.radius.max}
              unit="px"
              onchange={(input) => size('radius', input)}
            />
          </div>
        </div>

        <!--
          How thick the outline of a key is; its colour sits with the other
          colours. Not in the lot, and it earned its place the hard way — under
          `outline` the border *is* the key, and one pixel over an arbitrary
          video is a key nobody can see. Global: this is the outline of the
          overlay, not an argument each key has with the theme.

          Under `hidden` it is the outline of a key being pressed, and it goes
          out with the rest of the key: the group opacity carries it, so
          nothing here needs to know about that state.
        -->
        <div class="row">
          <label for="global-borderWidth">Border width</label>
          <div class="value">
            <NumberField
              id="global-borderWidth"
              name="borderWidth"
              label="Border width"
              value={config.style.borderWidth}
              min={BOUNDS.borderWidth.min}
              max={BOUNDS.borderWidth.max}
              unit="px"
              onchange={(input) => size('borderWidth', input)}
            />
          </div>
        </div>

        <!-- Not in the mockup, which gives sizes no home at all: the popover
             sizes one key in units, and nothing sets what a unit is worth in
             pixels. It belongs here, with the other settings that apply to
             every key. -->
        <div class="row">
          <label for="global-unit">Key size</label>
          <div class="value">
            <NumberField
              id="global-unit"
              name="unit"
              label="Key size"
              value={config.style.unit}
              min={BOUNDS.unit.min}
              max={BOUNDS.unit.max}
              unit="px"
              onchange={(input) => size('unit', input)}
            />
          </div>
        </div>

        <div class="row">
          <label for="global-gap">Gap</label>
          <div class="value">
            <NumberField
              id="global-gap"
              name="gap"
              label="Gap"
              value={config.style.gap}
              min={BOUNDS.gap.min}
              max={BOUNDS.gap.max}
              unit="px"
              onchange={(input) => size('gap', input)}
            />
          </div>
        </div>
      </div>
    {/if}
  </div>

  <div class="group" class:open={open.label}>
    <button
      type="button"
      class="head"
      data-group="label"
      aria-expanded={open.label}
      aria-controls="style-label"
      onclick={() => toggle('label')}
    >
      <span class="caret" aria-hidden="true"><ChevronRight size={14} /></span>
      Label
    </button>
    {#if open.label}
      <div class="body" id="style-label">
        <!--
          Each face shown in itself rather than named: three names are three
          words to look up, and "Aa" drawn in the face is the choice itself.
          The fourth place is for a font installed on this machine, and keeps
          its dashed edge whatever it holds — the place always says what it is.
        -->
        <div class="fonts" role="group" aria-label="Font">
          {#each FONT_CATALOG as { family, weight } (family)}
            <button
              type="button"
              class="font he-tile he-choice"
              data-font={family}
              class:on={config.style.fontFamily === family}
              aria-pressed={config.style.fontFamily === family}
              onclick={() => onChange(setFont(config, family, weight))}
            >
              <span
                class="sample"
                data-sample
                style:font-family={fontStack(family)}
                style:font-weight={weight}
                aria-hidden="true">Aa</span
              >
              <span class="name">{family}</span>
            </button>
          {/each}
          <div class="slot" bind:this={slot}>
            {#if keptFont}
              <!-- Filled (board Editor-LabelInstalledFont): two halves, one meaning
                   each. Above, the font, chosen with a click; below, "Other
                   fonts", which opens the list — the click Chrome wants for its
                   permission, as the empty place's is. -->
              <div class="font installed filled he-tile he-choice" class:on={installedChosen}>
                <button
                  type="button"
                  class="pick"
                  data-installed
                  aria-pressed={installedChosen}
                  onclick={chooseKept}
                >
                  <span
                    class="sample"
                    style:font-family={fontStack(keptFont.family)}
                    style:font-weight={keptFont.weight}
                    aria-hidden="true">Aa</span
                  >
                  <span class="names">
                    <span class="name">{keptFont.family}</span>
                    <!-- Only once the list is known: before that, absent and
                         unread look the same, and saying so would be a guess. -->
                    {#if notHere}
                      <span class="missing" data-not-installed>Not installed here</span>
                    {/if}
                  </span>
                </button>
                <button
                  type="button"
                  class="other he-btn-quiet"
                  data-other-fonts
                  aria-haspopup="listbox"
                  aria-expanded={menu !== null}
                  disabled={access === 'unsupported'}
                  onclick={toggleInstalled}
                >
                  Other fonts <ChevronDown size={14} aria-hidden="true" />
                </button>
              </div>
            {:else}
              <!--
                The click on the empty place is the gesture Chrome wants before it
                asks for the fonts: the list is read here, never on load.
              -->
              <Tooltip
                text={access === 'unsupported'
                  ? 'This browser cannot list the fonts installed here'
                  : null}
                fill
              >
                {#snippet children(describedBy)}
                  <button
                    type="button"
                    class="font installed he-tile he-slot"
                    data-installed
                    aria-pressed="false"
                    aria-expanded={menu !== null}
                    aria-haspopup="dialog"
                    aria-describedby={describedBy}
                    disabled={access === 'unsupported'}
                    onclick={toggleInstalled}
                  >
                    <span class="sample plus" aria-hidden="true"><Plus size={22} /></span>
                    <span class="name">Installed font</span>
                  </button>
                {/snippet}
              </Tooltip>
            {/if}
            {#if menu !== null}
              <InstalledFontsMenu families={menu} current={config.style.fontFamily} onPick={pick} />
            {/if}
          </div>
        </div>

        <!-- Only for a family with a choice to make: an embedded face has one
             weight, and so does many an installed family. Never a number to
             type — the faces are named as the family names them. -->
        {#if installedChosen && entry && entry.weights.length > 1}
          <div class="row">
            <label for="global-fontWeight">Style</label>
            <select
              class="he-select"
              id="global-fontWeight"
              name="fontWeight"
              value={String(config.style.fontWeight)}
              onchange={(event) =>
                onChange(setFont(config, entry.family, Number(event.currentTarget.value)))}
            >
              {#each entry.weights as { weight, style } (weight)}
                <option value={String(weight)}>{style}</option>
              {/each}
            </select>
          </div>
        {/if}

        <!-- "Text size", never "Size": "Key size" in Shape changes the whole
             key, and this changes the letters alone. -->
        <!-- Without it, changing the font above would read as changing the
             whole overlay's, while the keys that chose their own keep theirs. -->
        {#if ownFonts > 0}
          <div class="row" data-own-fonts>
            <span class="own">
              <span class="own-dot" aria-hidden="true"></span>
              {ownFonts === 1 ? '1 key uses its own font' : `${ownFonts} keys use their own font`}
            </span>
            <button
              type="button"
              class="he-btn-tertiary"
              data-reset-own-fonts
              onclick={() => onChange(resetKeyFonts(config))}
            >
              Reset fonts
              <RotateCcw size={14} />
            </button>
          </div>
        {/if}

        <div class="row">
          <span class="label" id="global-labelSize-label">Text size</span>
          <div class="segments" role="group" aria-labelledby="global-labelSize-label">
            {#each LABEL_SIZES as [value, letter, name] (value)}
              <Tooltip text={name}>
                {#snippet children()}
                  <button
                    type="button"
                    class="segment he-segment"
                    data-label-size={value}
                    class:on={config.style.labelSize === value}
                    aria-pressed={config.style.labelSize === value}
                    aria-label={name}
                    onclick={() => onChange(setGlobalStyle(config, 'labelSize', value))}
                  >
                    {letter}
                  </button>
                {/snippet}
              </Tooltip>
            {/each}
          </div>
        </div>

        <!-- `None` is for the overlays with nothing behind their labels — keys
             resting as outlines or hidden, over bright video — where an
             outline sized for a filled key only weighs on the letters. -->
        <div class="row">
          <span class="label" id="global-labelOutline-label">Text outline</span>
          <div class="segments" role="group" aria-labelledby="global-labelOutline-label">
            {#each LABEL_OUTLINES as [value, label] (value)}
              <button
                type="button"
                class="segment he-segment"
                data-label-outline={value}
                class:on={config.style.labelOutline === value}
                aria-pressed={config.style.labelOutline === value}
                onclick={() => onChange(setGlobalStyle(config, 'labelOutline', value))}
              >
                {label}
              </button>
            {/each}
          </div>
        </div>
      </div>
    {/if}
  </div>

  <div class="group" class:open={open.behavior}>
    <button
      type="button"
      class="head"
      data-group="behavior"
      aria-expanded={open.behavior}
      aria-controls="style-behavior"
      onclick={() => toggle('behavior')}
    >
      <span class="caret" aria-hidden="true"><ChevronRight size={14} /></span>
      Behavior
    </button>
    {#if open.behavior}
      <div class="body" id="style-behavior">
        <!--
          How much of a key shows while nothing is happening to it.

          It sat on the `restColor` line as a checkbox until 2026-08-24 — a
          switch beside the value it governed. It has its own row now because
          it no longer governs that value alone: `hidden` takes the border and
          the label with it, and a control that reaches past its own line does
          not belong on it.

          A keyword and **not** a colour value: `restColor` is left untouched
          in every state, so coming back from `outline` returns the colour that
          was there rather than a default nobody chose — and a colour stays a
          hex colour, never a keyword.
        -->
        <!-- The row and the sentence that explains it, 4 px apart. -->
        <div class="he-with-help">
          <div class="row">
            <label for="global-restVisibility">At rest</label>
            <select
              class="he-select"
              id="global-restVisibility"
              name="restVisibility"
              value={config.style.restVisibility}
              onchange={(event) =>
                onChange(
                  setGlobalStyle(
                    config,
                    'restVisibility',
                    event.currentTarget.value as RestVisibility,
                  ),
                )}
            >
              {#each REST_STATES as [value, label] (value)}
                <option {value}>{label}</option>
              {/each}
            </select>
          </div>

          <!--
          Said only in `hidden`, and it is the one state that needs saying.
          Everything else on this panel changes the stage the moment it is
          set; this one changes nothing at all, because the editor draws every
          key whatever the mode (`reveal`) so the layout stays editable.
          Without this line the only way to tell the setting took is to open
          the overlay URL — the setting looks broken precisely because it is
          working.
        -->
          {#if config.style.restVisibility === 'hidden'}
            <HelpText>
              The editor keeps showing every key.
              <!-- The second half stopped being true on 2026-08-25, when the mode
                 became something a key can override: "shows none" would
                 describe an overlay nobody is looking at the moment one key is
                 kept on the stream — and keeping a few is the reason this mode
                 gets chosen at all. The count is of keys that answer for
                 themselves, whatever they answer: a key set to `outline` under
                 a hidden global is not shown either, but it is not obeying this
                 line, and folding it in would need a second sentence. -->
              {#if kept > 0}
                The overlay shows only the {kept} key{kept === 1 ? '' : 's'} set apart.
              {:else}
                The overlay shows none until you press one.
              {/if}
            </HelpText>
          {/if}
        </div>

        <!--
          After the resting row and its caption, because it answers the next
          question: how much of a key shows while nothing happens, then what
          its outline does when something does.

          Global here and overridable per key in the popover — `borderColor`
          is the outline of the overlay, while announcing itself is an argument
          each key is allowed to have. This row governs the behaviour and never
          the colour.
        -->
        <div class="row">
          <label for="global-activeBorder">Pressed border</label>
          <select
            class="he-select"
            id="global-activeBorder"
            name="activeBorder"
            value={config.style.activeBorder}
            onchange={(event) =>
              onChange(
                setGlobalStyle(config, 'activeBorder', event.currentTarget.value as ActiveBorder),
              )}
          >
            {#each BORDER_STATES as [value, label] (value)}
              <option {value}>{label}</option>
            {/each}
          </select>
        </div>

        <!-- Four arrows in a row rather than a `<select>` (board 3a): the
             answer is a direction, and a direction is drawn faster than it is
             read. Each carries its full label for whoever hears it. -->
        <div class="row">
          <span class="label" id="global-fillDirection-label">Fill direction</span>
          <div class="segments" role="group" aria-labelledby="global-fillDirection-label">
            {#each FILL_DIRECTIONS as [value, label] (value)}
              {@const Arrow = FILL_ICONS[value]}
              <Tooltip text={label}>
                {#snippet children()}
                  <button
                    type="button"
                    class="segment he-segment"
                    data-direction={value}
                    class:on={config.style.fillDirection === value}
                    aria-pressed={config.style.fillDirection === value}
                    aria-label={label}
                    onclick={() => onChange(setGlobalStyle(config, 'fillDirection', value))}
                  >
                    <Arrow size={14} aria-hidden="true" />
                  </button>
                {/snippet}
              </Tooltip>
            {/each}
          </div>
        </div>

        <!-- Two controls on one value (board 3a): drag the slider to explore,
             type the figure to land exactly. The slider commits on release,
             not on every pixel — each commit is an undo entry and a broadcast.
             Its step is the field's own unit, one percent: a coarser step
             would snap a typed 83 to 85 the next time the thumb moved. -->
        <div class="row opacity">
          <label for="global-opacity">Opacity</label>
          <input
            id="global-opacity"
            class="he-range"
            name="opacity"
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={config.style.opacity}
            style:--fill={`${shown}%`}
            oninput={(event) => (dragged = Math.round(+event.currentTarget.value * 100))}
            onchange={(event) => {
              dragged = null;
              onChange(setGlobalStyle(config, 'opacity', +event.currentTarget.value));
            }}
          />
          <span class="percent">
            <NumberField
              id="global-opacityPercent"
              name="opacityPercent"
              label="Opacity, in percent"
              value={shown}
              min={0}
              max={100}
              variant="percent"
              onchange={(input) => typedPercent(input)}
            />
            <span class="percent-unit" aria-hidden="true">%</span>
          </span>
        </div>
      </div>
    {/if}
  </div>
</section>

<style>
  section {
    display: flex;
    flex-direction: column;
    gap: 10px;
    font: var(--he-font);
  }

  /* One group: a bordered box that reads as a header while shut, and holds
     its rows at the same indent once open. */
  .group {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 9px 11px;
    background: var(--he-surface-low);
    border: 1px solid var(--he-border);
    border-radius: var(--he-radius-panel);
  }
  .group.open {
    padding: 10px 12px;
  }
  .head {
    all: unset;
    box-sizing: border-box;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: var(--he-size-xs);
    font-weight: 600;
    color: var(--he-text);
  }
  .head:focus-visible {
    outline: 2px solid var(--he-accent);
    outline-offset: 2px;
    border-radius: 2px;
  }
  /* Before the title, turned a quarter when open (spec §16.13): rotated rather
     than replaced, and transitioned so the gesture is legible even when the
     contents below it appears in one frame. */
  .caret {
    display: inline-grid;
    color: var(--he-text-muted);
    transition: rotate 150ms ease-out;
  }
  .open .caret {
    rotate: 90deg;
  }
  .body {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .presets {
    display: grid;
    gap: 6px;
  }
  .swatches {
    display: flex;
    gap: 7px;
  }
  /**
   * One swatch, three colours, in the bands of the lot: active on top, travel
   * fill in the middle, rest at the foot.
   *
   * It shows what it will do rather than naming it — six names would be six
   * words nobody can check against the layout, and the gradient *is* the trio.
   */
  .preset {
    inline-size: 26px;
    block-size: 26px;
    padding: 0;
    border: 1px solid var(--he-border-popover);
    border-radius: var(--he-radius);
    cursor: pointer;
  }
  /* An outline rather than a border: a border would eat a pixel of the colours
     it is marking, and on the darkest preset that pixel is the whole rest
     band. */
  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }
  label,
  .label {
    font-size: var(--he-size-xs);
    color: var(--he-text-muted);
  }
  .value {
    display: flex;
    align-items: center;
    gap: 7px;
  }
  /* The key on the left, the four rows beside it (board Editor-GlobalStyle). */
  .colors {
    display: flex;
    align-items: flex-start;
    gap: 12px;
  }
  .color-rows {
    flex: 1;
    min-inline-size: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .row.color {
    min-block-size: 26px;
    margin: 0 -6px;
    padding: 0 6px;
    border-radius: var(--he-radius);
  }
  .row.color.hovered {
    background: var(--he-highlight);
  }
  .row.color.hovered label {
    color: var(--he-text);
  }
  .mini {
    flex: none;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    margin: 0;
    padding-block-start: 2px;
  }
  /* Under the key, the convention for "transparent": a check. A face that
     paints covers it whole (same corners); a face that does not — At rest =
     Outline only — shows it, which says "nothing here" better than the
     panel's own grey ever could. */
  .mini-key {
    position: relative;
    display: block;
    inline-size: 56px;
    block-size: 56px;
    background: repeating-conic-gradient(var(--he-border-popover) 0 25%, transparent 0 50%) 0 0 /
      8px 8px;
  }
  .mini-key :global(svg) {
    display: block;
  }
  /* The part the hovered row paints, ringed in the accent (board
     Editor-GlobalStyle). Face and fill: inside the border, square-cornered,
     clipped by the key's own rounding — so a fill's top edge runs straight
     across the key and its bottom corners follow it. The border: on the
     key's edge, where it is drawn. */
  .ring-clip {
    position: absolute;
    overflow: hidden;
    pointer-events: none;
  }
  .ring {
    position: absolute;
    box-sizing: border-box;
    box-shadow: inset 0 0 0 2px var(--he-accent);
    pointer-events: none;
  }
  .ring.border {
    inset: 0;
    box-shadow: none;
    border: 2px solid var(--he-accent);
  }
  /* Opacity's field and its unit, outside the frame since the arrows took the
     frame's right end (board Editor-NumberStepper). */
  .percent {
    flex: none;
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
  .percent-unit {
    font-size: var(--he-size-xs);
    color: var(--he-text-muted);
  }
  /* Seven characters of mono, framed like the other fields. */
  .hex {
    inline-size: 5.2rem;
    block-size: 26px;
    box-sizing: border-box;
    font: var(--he-font-mono);
    font-size: var(--he-size-xs);
    color: var(--he-text);
    background: var(--he-well);
    border: 1px solid var(--he-border-control);
    border-radius: var(--he-radius);
    padding: 3px 8px;
  }
  /* Out of use, and saying so: under `outline` the control that colours the
     resting background has no background to colour. Dimmed-but-clickable would
     let someone pick a colour and watch nothing happen.

     `outline` and not "anything but filled": under `hidden` the rest colour is
     exactly what a key wears the moment it appears. */
  input[type='color']:disabled {
    cursor: default;
  }
  .hex:disabled {
    cursor: default;
  }
  input[type='color'] {
    /* A square as tall as the hex field beside it (26 with its edge); the
       colour fills it (controls.css, `.he-tile` swatch). */
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
  .segments {
    display: flex;
    border: 1px solid var(--he-border-popover);
    border-radius: var(--he-radius);
    overflow: hidden;
  }
  /* 24 px inside the border: 26 with it, the height of every field beside it. */
  .segment {
    all: unset;
    box-sizing: border-box;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-inline-size: 28px;
    block-size: 24px;
    cursor: pointer;
    padding: 0 9px;
    font-size: var(--he-size-xs);
    color: var(--he-text-muted);
  }
  .segment.on {
    font-weight: 600;
    color: var(--he-bg);
    background: var(--he-accent);
  }
  .segment:focus-visible {
    outline: 2px solid var(--he-accent);
    outline-offset: -2px;
  }

  .fonts {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }
  .font {
    all: unset;
    box-sizing: border-box;
    cursor: pointer;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 12px 6px 9px;
    background: var(--he-surface);
    border: 1px solid var(--he-border-popover);
    border-radius: var(--he-radius);
  }
  /* An outline, like the presets: the face in force is marked around the
     tile, never by changing what the tile shows. */
  .font.installed {
    background: none;
    border: 1px dashed var(--he-border-hover);
  }
  .slot {
    position: relative;
    display: grid;
  }
  /* The filled fourth tile: its dashed edge, the tiles' ground, two halves. */
  .font.installed.filled {
    padding: 0;
    gap: 0;
    align-items: stretch;
    overflow: hidden;
    cursor: default;
    background: var(--he-surface);
  }
  .pick {
    all: unset;
    box-sizing: border-box;
    flex: 1;
    min-inline-size: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 12px 6px 9px;
    cursor: pointer;
  }
  /* "Other fonts": the quiet text button's face (he-btn-quiet), the width of
     the tile, under a dashed rule like the tile's edge. */
  .other {
    justify-content: center;
    gap: 4px;
    inline-size: 100%;
    padding: 0;
    border: none;
    border-block-start: 1px dashed var(--he-border-hover);
    border-radius: 0;
  }
  .pick:focus-visible,
  .other:focus-visible {
    outline: 2px solid var(--he-accent);
    outline-offset: -2px;
  }
  .names {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1px;
    max-inline-size: 100%;
  }
  .names .name {
    max-inline-size: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  /* Keys with a font of their own: the accent of own style, the words muted
     — it is a fact about the overlay, not a warning (spec §16.13). */
  .own {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-size: var(--he-size-xs);
    color: var(--he-text-muted);
  }
  .own-dot {
    flex: none;
    inline-size: 6px;
    block-size: 6px;
    border-radius: 50%;
    background: var(--he-accent);
  }
  .missing {
    font-size: var(--he-size-xs);
    color: var(--he-warn);
    white-space: nowrap;
  }
  /* A specimen, not text to read: 26 px is the size at which three faces tell
     themselves apart in a tile, and it sits outside the interface's scale on
     purpose. */
  .sample {
    font-size: 26px;
    line-height: 1;
    color: var(--he-text);
  }
  .sample.plus {
    display: grid;
    color: var(--he-text-muted);
  }
  .name {
    font-size: var(--he-size-xs);
    color: var(--he-text-muted);
    white-space: nowrap;
  }

  /* Name, slider, field on one line (spec §16.11): the slider takes what the
     other two leave, never under 80 px. */
  .row.opacity {
    justify-content: flex-start;
    gap: 10px;
  }
  .row.opacity label {
    flex: none;
  }
  .row.opacity .he-range {
    flex: 1;
    min-inline-size: 80px;
  }
</style>
