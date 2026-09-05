<script lang="ts">
  import { setGlobalStyle } from '../config/edit';
  import { normalizeHex } from '../config/validate';
  import { PRESETS, presetFor, withPreset } from './presets';
  /** Shared with `KeyPopover`, whose three choices are the same three since 2026-08-26. */
  import { BORDER_STATES, FILL_ARROWS, FILL_DIRECTIONS, REST_STATES } from './style-choices';
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
   * Three groups since board 3a — Colors, Shape, Behavior — none open by
   * default: the panel is read far more often than it is edited, and twelve
   * controls in a column made the keys list below them something to scroll
   * for. Each opens on its own; the accordion of the first draft shut Colors
   * the moment Shape was opened, and a border is chosen with its colour in
   * view.
   */
  let {
    config,
    onChange,
  }: {
    config: OverlayConfig;
    onChange: (next: OverlayConfig) => void;
  } = $props();

  type Group = 'colors' | 'shape' | 'behavior';

  /**
   * Which groups are open. Component state and nothing more: they start shut
   * on every load, which is what "collapsed by default" means, and a session
   * is exactly how long the memory of which ones were open is worth.
   */
  let open = $state<Record<Group, boolean>>({ colors: false, shape: false, behavior: false });

  function toggle(group: Group) {
    open[group] = !open[group];
  }

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
  const COLORS: [
    keyof typeof config.style & ('activeColor' | 'fillColor' | 'restColor' | 'borderColor'),
    string,
  ][] = [
    ['activeColor', 'Active'],
    ['fillColor', 'Travel fill'],
    ['restColor', 'Rest'],
    ['borderColor', 'Border'],
  ];

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

<!-- No heading of its own: this panel always sits inside the "Global style"
     collapsible, and a second title directly under the first read as two
     sections where there is one. The aria-label keeps the landmark. -->
<section aria-label="Global style">
  <div class="group" class:open={open.colors}>
    <!-- No note in the header (board 3a): a group says what it holds, and the
         values wait inside. The one mark allowed is the collapsible's dot
         above, for a style that departs from the defaults. -->
    <button
      type="button"
      class="head"
      data-group="colors"
      aria-expanded={open.colors}
      aria-controls="style-colors"
      onclick={() => toggle('colors')}
    >
      <span class="caret" aria-hidden="true">▸</span>
      Colors
    </button>
    {#if open.colors}
      <div class="body" id="style-colors">
        <!--
          At the head of the group, as the lot of 2026-08-21 has it, and drawn
          as one swatch per preset carrying its three colours in bands. Three
          settings behind one dot needs a caption, hence the line below:
          someone who clicks a colour expecting a colour would otherwise find
          two others changed.
        -->
        <div class="presets">
          <div class="swatches" role="group" aria-label="Presets">
            {#each PRESETS as preset (preset.name)}
              <button
                type="button"
                class="preset"
                data-preset={preset.name}
                class:on={worn === preset}
                aria-pressed={worn === preset}
                aria-label={`Preset: ${preset.name}`}
                title={preset.name}
                style:background={`linear-gradient(180deg, ${preset.activeColor} 0 46%, ${preset.fillColor} 46% 76%, ${preset.restColor} 76% 100%)`}
                onclick={() => onChange(withPreset(config, preset))}
              ></button>
            {/each}
          </div>
          <span class="caption">Presets · sets active, travel fill, rest &amp; border together</span
          >
        </div>

        {#each COLORS as [property, label] (property)}
          <div class="row">
            <label for={`global-${property}`}>{label}</label>
            <div class="value">
              <!-- The code is a field, not a caption: a colour copied from
                   a stream layout or a brand sheet arrives as six characters,
                   and a swatch cannot take those. Anything that is not a hex
                   colour is put back rather than half-applied. -->
              <input
                class="hex"
                type="text"
                name={`${property}Hex`}
                aria-label={`${label} hex code`}
                value={config.style[property]}
                onchange={(event) => hex(property, event.currentTarget)}
              />
              <!--
                The rest swatch goes out of use under `outline` and only there:
                that is the one state where the colour paints nothing at all.
                Under `hidden` it is precisely what a key wears the moment it
                appears, so disabling it would lock the only colour the mode
                ever shows.
              -->
              <input
                id={`global-${property}`}
                name={property}
                type="color"
                value={config.style[property]}
                disabled={property === 'restColor' && config.style.restVisibility === 'outline'}
                onchange={(event) =>
                  onChange(setGlobalStyle(config, property, event.currentTarget.value))}
              />
            </div>
          </div>
        {/each}
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
      <span class="caret" aria-hidden="true">▸</span>
      Shape
    </button>
    {#if open.shape}
      <div class="body" id="style-shape">
        <!-- A style property `KeyStyle` has carried since task 13, that the
             renderer has always applied, and that nothing could set. -->
        <div class="row">
          <label for="global-radius">Radius</label>
          <div class="value">
            <input
              id="global-radius"
              name="radius"
              type="number"
              min={BOUNDS.radius.min}
              max={BOUNDS.radius.max}
              value={config.style.radius}
              onchange={(event) => size('radius', event.currentTarget)}
            />
            <span class="unit">px</span>
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
            <input
              id="global-borderWidth"
              name="borderWidth"
              type="number"
              min={BOUNDS.borderWidth.min}
              max={BOUNDS.borderWidth.max}
              value={config.style.borderWidth}
              onchange={(event) => size('borderWidth', event.currentTarget)}
            />
            <span class="unit">px</span>
          </div>
        </div>

        <!-- Not in the mockup, which gives sizes no home at all: the popover
             sizes one key in units, and nothing sets what a unit is worth in
             pixels. It belongs here, with the other settings that apply to
             every key. -->
        <div class="row">
          <label for="global-unit">Key size</label>
          <div class="value">
            <input
              id="global-unit"
              name="unit"
              type="number"
              min={BOUNDS.unit.min}
              max={BOUNDS.unit.max}
              value={config.style.unit}
              onchange={(event) => size('unit', event.currentTarget)}
            />
            <span class="unit">px</span>
          </div>
        </div>

        <div class="row">
          <label for="global-gap">Gap</label>
          <div class="value">
            <input
              id="global-gap"
              name="gap"
              type="number"
              min={BOUNDS.gap.min}
              max={BOUNDS.gap.max}
              value={config.style.gap}
              onchange={(event) => size('gap', event.currentTarget)}
            />
            <span class="unit">px</span>
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
      <span class="caret" aria-hidden="true">▸</span>
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
        <div class="row">
          <label for="global-restVisibility">Keys at rest</label>
          <select
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
          <span class="caption">
            The editor keeps showing every key ·
            <!-- The second half stopped being true on 2026-08-25, when the mode
                 became something a key can override: "shows none" would
                 describe an overlay nobody is looking at the moment one key is
                 kept on the stream — and keeping a few is the reason this mode
                 gets chosen at all. The count is of keys that answer for
                 themselves, whatever they answer: a key set to `outline` under
                 a hidden global is not shown either, but it is not obeying this
                 line, and folding it in would need a second sentence. -->
            {#if kept > 0}
              the overlay shows only the {kept} key{kept === 1 ? '' : 's'} set apart
            {:else}
              the overlay shows none until you press one
            {/if}
          </span>
        {/if}

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
          <label for="global-activeBorder">Border on press</label>
          <select
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
              <button
                type="button"
                class="segment"
                data-direction={value}
                class:on={config.style.fillDirection === value}
                aria-pressed={config.style.fillDirection === value}
                aria-label={label}
                title={label}
                onclick={() => onChange(setGlobalStyle(config, 'fillDirection', value))}
              >
                {FILL_ARROWS[value]}
              </button>
            {/each}
          </div>
        </div>

        <!-- Two controls on one value (board 3a): drag the slider to explore,
             type the figure to land exactly. The slider commits on release,
             not on every pixel — each commit is an undo entry and a broadcast.
             Its step is the field's own unit, one percent: a coarser step
             would snap a typed 83 to 85 the next time the thumb moved. -->
        <div class="opacity">
          <div class="row">
            <label for="global-opacity">Opacity</label>
            <div class="value">
              <input
                id="global-opacityPercent"
                name="opacityPercent"
                type="number"
                min="0"
                max="100"
                value={shown}
                aria-label="Opacity, in percent"
                onchange={(event) => typedPercent(event.currentTarget)}
              />
              <span class="unit">%</span>
            </div>
          </div>
          <input
            id="global-opacity"
            name="opacity"
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={config.style.opacity}
            oninput={(event) => (dragged = Math.round(+event.currentTarget.value * 100))}
            onchange={(event) => {
              dragged = null;
              onChange(setGlobalStyle(config, 'opacity', +event.currentTarget.value));
            }}
          />
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
    border-radius: var(--he-radius-control);
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
  .caret {
    color: var(--he-text-faint);
    /* Rotated rather than replaced, and transitioned so the gesture is legible
       even when the contents below it appears in one frame (the Collapsible
       recipe). */
    transition: rotate 120ms ease-out;
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
  .preset.on {
    outline: 2px solid var(--he-text);
    outline-offset: 1px;
  }
  .preset:focus-visible {
    outline: 2px solid var(--he-accent);
    outline-offset: 1px;
  }
  .caption {
    font-size: var(--he-size-xs);
    color: var(--he-text-faint);
  }
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
  /* Seven characters of mono, framed like the other fields. */
  .hex {
    inline-size: 5.2rem;
    box-sizing: border-box;
    font: var(--he-font-mono);
    font-size: var(--he-size-xs);
    color: var(--he-text);
    background: var(--he-stage);
    border: 1px solid var(--he-border-control);
    border-radius: var(--he-radius);
    padding: 3px 8px;
  }
  .unit {
    font-size: var(--he-size-xs);
    color: var(--he-text-faint);
  }
  /* Out of use, and saying so: under `outline` the control that colours the
     resting background has no background to colour. Dimmed-but-clickable would
     let someone pick a colour and watch nothing happen.

     `outline` and not "anything but filled": under `hidden` the rest colour is
     exactly what a key wears the moment it appears. */
  input[type='color']:disabled {
    opacity: 0.35;
    cursor: default;
  }
  input[type='color'] {
    /* The native swatch keeps its own chrome in every engine; a fixed box and
       no padding is as close to the mockup as it goes without rebuilding a
       colour picker, which is not what this task is for. */
    inline-size: 22px;
    block-size: 22px;
    padding: 0;
    background: none;
    border: 1px solid var(--he-border-control);
    border-radius: var(--he-radius);
    cursor: pointer;
  }
  input[type='number'] {
    inline-size: 56px;
    font: var(--he-font-mono);
    font-size: var(--he-size-xs);
    color: var(--he-text);
    background: var(--he-stage);
    border: 1px solid var(--he-border-control);
    border-radius: var(--he-radius);
    padding: 3px 8px;
  }
  select {
    font: inherit;
    font-size: var(--he-size-xs);
    color: var(--he-text);
    background: var(--he-stage);
    border: 1px solid var(--he-border-control);
    border-radius: var(--he-radius);
    padding: 3px 6px;
  }

  .segments {
    display: flex;
    border: 1px solid var(--he-border-popover);
    border-radius: var(--he-radius);
    overflow: hidden;
  }
  .segment {
    all: unset;
    cursor: pointer;
    padding: 3px 9px;
    font-size: var(--he-size-xs);
    color: var(--he-text-muted);
  }
  .segment:hover {
    color: var(--he-text);
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

  .opacity {
    display: flex;
    flex-direction: column;
    gap: 7px;
  }
  input[type='range'] {
    inline-size: 100%;
    margin: 0;
    accent-color: var(--he-accent);
  }
  input:focus-visible,
  select:focus-visible {
    outline: 2px solid var(--he-accent);
    outline-offset: 1px;
  }
</style>
