<script lang="ts">
  import { setGlobalStyle } from '../config/edit';
  import { PRESETS, presetFor, withPreset } from './presets';
  /** Shared with `KeyPopover`, whose three choices are the same three since 2026-08-26. */
  import { BORDER_STATES, FILL_DIRECTIONS, REST_STATES } from './style-choices';
  import {
    BORDER_WIDTH_BOUNDS,
    RADIUS_BOUNDS,
    type ActiveBorder,
    type FillDirection,
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
   */
  let {
    config,
    onChange,
  }: {
    config: OverlayConfig;
    onChange: (next: OverlayConfig) => void;
  } = $props();

  /**
   * Keys that answer for their own resting state, and so are not covered by
   * what this panel says about the overlay.
   *
   * Counted rather than merely detected: "some keys" leaves the reader
   * searching the layout for how many, and the figure is one property read off
   * the keys already in hand.
   */
  const kept = $derived(config.keys.filter((key) => key.style?.restVisibility).length);

  const COLORS: [
    keyof typeof config.style & ('activeColor' | 'fillColor' | 'restColor'),
    string,
  ][] = [
    ['activeColor', 'Active'],
    ['fillColor', 'Travel fill'],
    ['restColor', 'Rest'],
  ];

  /** The preset the three colours currently spell, or null once one has moved. */
  const worn = $derived(presetFor(config.style));

  /** What each size may hold. `min` and `max` bind the spinner, not the keyboard. */
  const BOUNDS = {
    unit: { min: 16, max: 200 },
    gap: { min: 0, max: 40 },
    // Shared with the popover's own radius field, so the two cannot drift.
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
</script>

<!-- No heading of its own: this panel always sits inside the "Global style
     · all keys" collapsible, and a second title directly under the first read
     as two sections where there is one. The aria-label keeps the landmark. -->
<section aria-label="Global style">
  <!--
    At the head of the panel, as the lot of 2026-08-21 has it, and drawn as one
    swatch per preset carrying its three colours in bands. Three settings behind
    one dot needs a caption, hence the line below: someone who clicks a colour
    expecting a colour would otherwise find two others changed.
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
    <span class="caption">Presets · sets active, travel fill &amp; rest together</span>
  </div>

  <!--
    How much of a key shows while nothing is happening to it.

    It sat on the `restColor` line as a checkbox until 2026-08-24 — a switch
    beside the value it governed. It has its own row now because it no longer
    governs that value alone: `hidden` takes the border and the label with it,
    and a control that reaches past its own line does not belong on it.

    A keyword and **not** a colour value: `restColor` is left untouched in
    every state, so coming back from `outline` returns the colour that was
    there rather than a default nobody chose — and a colour stays a hex colour,
    never a keyword.
  -->
  <div class="row">
    <label for="global-restVisibility">Keys at rest</label>
    <select
      id="global-restVisibility"
      name="restVisibility"
      value={config.style.restVisibility}
      onchange={(event) =>
        onChange(
          setGlobalStyle(config, 'restVisibility', event.currentTarget.value as RestVisibility),
        )}
    >
      {#each REST_STATES as [value, label] (value)}
        <option {value}>{label}</option>
      {/each}
    </select>
  </div>

  <!--
    Said only in `hidden`, and it is the one state that needs saying.
    Everything else on this panel changes the stage the moment it is set; this
    one changes nothing at all, because the editor draws every key whatever the
    mode (`reveal`) so the layout stays editable. Without this line the only
    way to tell the setting took is to open the overlay URL — the setting looks
    broken precisely because it is working.
  -->
  {#if config.style.restVisibility === 'hidden'}
    <span class="caption">
      The editor keeps showing every key ·
      <!-- The second half stopped being true on 2026-08-25, when the mode became
           something a key can override: "shows none" would describe an overlay
           nobody is looking at the moment one key is kept on the stream — and
           keeping a few is the reason this mode gets chosen at all. The count is
           of keys that answer for themselves, whatever they answer: a key set to
           `outline` under a hidden global is not shown either, but it is not
           obeying this line, and folding it in would need a second sentence. -->
      {#if kept > 0}
        the overlay shows only the {kept} key{kept === 1 ? '' : 's'} set apart
      {:else}
        the overlay shows none until you press one
      {/if}
    </span>
  {/if}

  <!--
    After the resting row and its caption, because it answers the next
    question: how much of a key shows while nothing happens, then what its
    outline does when something does.

    Global here and overridable per key in the popover — `borderColor` is the
    outline of the overlay, while announcing itself is an argument each key is
    allowed to have. This row governs the behaviour and never the colour.
  -->
  <div class="row">
    <label for="global-activeBorder">Border on press</label>
    <select
      id="global-activeBorder"
      name="activeBorder"
      value={config.style.activeBorder}
      onchange={(event) =>
        onChange(setGlobalStyle(config, 'activeBorder', event.currentTarget.value as ActiveBorder))}
    >
      {#each BORDER_STATES as [value, label] (value)}
        <option {value}>{label}</option>
      {/each}
    </select>
  </div>

  {#each COLORS as [property, label] (property)}
    <div class="row">
      <label for={`global-${property}`}>{label}</label>
      <div class="value">
        <code>{config.style[property]}</code>
        <!--
          The rest swatch goes out of use under `outline` and only there: that
          is the one state where the colour paints nothing at all. Under
          `hidden` it is precisely what a key wears the moment it appears, so
          disabling it would lock the only colour the mode ever shows.
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

  <div class="row">
    <label for="global-fillDirection">Fill direction</label>
    <select
      id="global-fillDirection"
      name="fillDirection"
      value={config.style.fillDirection}
      onchange={(event) =>
        onChange(
          setGlobalStyle(config, 'fillDirection', event.currentTarget.value as FillDirection),
        )}
    >
      {#each FILL_DIRECTIONS as [value, label] (value)}
        <option {value}>{label}</option>
      {/each}
    </select>
  </div>

  <!--
    The outline of a key: its colour, and how thick it is.

    Not in the lot, and it earned its place the hard way — under `outline` the
    border *is* the key, and one pixel of very dark grey over an arbitrary video
    is a key nobody can see. Both are global: this is the outline of the
    overlay, not an argument each key has with the theme.

    Under `hidden` it is the outline of a key being pressed, and it goes out
    with the rest of the key: the group opacity carries it, so nothing here
    needs to know about that state.
  -->
  <div class="row">
    <label for="global-borderColor">Border</label>
    <div class="value">
      <code>{config.style.borderColor}</code>
      <input
        id="global-borderColor"
        name="borderColor"
        type="color"
        value={config.style.borderColor}
        onchange={(event) =>
          onChange(setGlobalStyle(config, 'borderColor', event.currentTarget.value))}
      />
      <input
        id="global-borderWidth"
        name="borderWidth"
        type="number"
        min={BOUNDS.borderWidth.min}
        max={BOUNDS.borderWidth.max}
        value={config.style.borderWidth}
        aria-label="Border width"
        onchange={(event) => size('borderWidth', event.currentTarget)}
      />
      <span class="unit">px</span>
    </div>
  </div>

  <!-- After the fill direction, where the lot of 2026-08-21 puts it. A style
       property `KeyStyle` has carried since task 13, that the renderer has
       always applied, and that nothing could set. -->
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

  <div class="row">
    <label for="global-opacity">Opacity</label>
    <div class="value">
      <code>{Math.round(config.style.opacity * 100)}%</code>
      <input
        id="global-opacity"
        name="opacity"
        type="range"
        min="0"
        max="1"
        step="0.05"
        value={config.style.opacity}
        onchange={(event) =>
          onChange(setGlobalStyle(config, 'opacity', +event.currentTarget.value))}
      />
    </div>
  </div>

  <!-- Not in the mockup, which gives sizes no home at all: the popover sizes
       one key in units, and nothing sets what a unit is worth in pixels. It
       belongs here, with the other settings that apply to every key. -->
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
</section>

<style>
  section {
    display: grid;
    gap: 10px;
    padding: 16px 18px;
    background: var(--he-popover);
    border: 1px solid var(--he-border);
    border-radius: var(--he-radius-panel);
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
    inline-size: 24px;
    block-size: 24px;
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
  label {
    font-size: var(--he-size-md);
    color: var(--he-text-muted);
  }
  .value {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  code {
    font: var(--he-font-mono);
    color: var(--he-text-faint);
  }
  .unit {
    font-size: var(--he-size-xs);
    color: var(--he-text-ghost);
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
    inline-size: 30px;
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
    color: var(--he-text);
    background: var(--he-stage);
    border: 1px solid var(--he-border-control);
    border-radius: var(--he-radius);
    padding: 4px 6px;
  }
  input[type='range'] {
    inline-size: 96px;
    accent-color: var(--he-accent);
  }
  select {
    font: inherit;
    font-size: var(--he-size-md);
    color: var(--he-text);
    background: var(--he-stage);
    border: 1px solid var(--he-border-control);
    border-radius: var(--he-radius);
    padding: 4px 6px;
  }
  input:focus-visible,
  select:focus-visible {
    outline: 2px solid var(--he-accent);
    outline-offset: 1px;
  }
</style>
