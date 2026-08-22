<script lang="ts">
  import { setGlobalStyle } from '../config/edit';
  import { PRESETS, presetFor, withPreset } from './presets';
  import { RADIUS_BOUNDS, type FillDirection, type OverlayConfig } from '../config/schema';

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

  const DIRECTIONS: [FillDirection, string][] = [
    ['up', '↑ Up'],
    ['down', '↓ Down'],
    ['left', '← Left'],
    ['right', '→ Right'],
  ];

  /** What each size may hold. `min` and `max` bind the spinner, not the keyboard. */
  const BOUNDS = {
    unit: { min: 16, max: 200 },
    gap: { min: 0, max: 40 },
    // Shared with the popover's own radius field, so the two cannot drift.
    radius: RADIUS_BOUNDS,
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
  function size(property: 'unit' | 'gap' | 'radius', input: HTMLInputElement) {
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

<section aria-label="Global style">
  <h2>Global style</h2>

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

  {#each COLORS as [property, label] (property)}
    <div class="row">
      <label for={`global-${property}`}>{label}</label>
      <div class="value">
        <code>{config.style[property]}</code>
        <input
          id={`global-${property}`}
          name={property}
          type="color"
          value={config.style[property]}
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
      {#each DIRECTIONS as [value, label] (value)}
        <option {value}>{label}</option>
      {/each}
    </select>
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
    background: var(--he-popover, #141722);
    border: 1px solid var(--he-border, #1b1e27);
    border-radius: var(--he-radius-panel, 6px);
  }
  h2 {
    margin: 0;
    font-size: var(--he-size-sm, 15px);
    font-weight: 600;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: var(--he-text-muted, #8b90a0);
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
    border: 1px solid var(--he-border-popover, #262b3a);
    border-radius: var(--he-radius, 4px);
    cursor: pointer;
  }
  /* An outline rather than a border: a border would eat a pixel of the colours
     it is marking, and on the darkest preset that pixel is the whole rest
     band. */
  .preset.on {
    outline: 2px solid var(--he-text, #dde1e9);
    outline-offset: 1px;
  }
  .preset:focus-visible {
    outline: 2px solid var(--he-accent, #7c9eff);
    outline-offset: 1px;
  }
  .caption {
    font-size: var(--he-size-xs, 14px);
    color: var(--he-text-faint, #5a5f70);
  }
  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }
  label {
    font-size: var(--he-size-md, 16px);
    color: var(--he-text-muted, #8b90a0);
  }
  .value {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  code {
    font: var(--he-font-mono, 400 15px ui-monospace, monospace);
    color: var(--he-text-faint, #5a5f70);
  }
  .unit {
    font-size: var(--he-size-xs, 14px);
    color: var(--he-text-ghost, #4a4f60);
  }
  input[type='color'] {
    /* The native swatch keeps its own chrome in every engine; a fixed box and
       no padding is as close to the mockup as it goes without rebuilding a
       colour picker, which is not what this task is for. */
    inline-size: 30px;
    block-size: 22px;
    padding: 0;
    background: none;
    border: 1px solid var(--he-border-control, #232838);
    border-radius: var(--he-radius, 4px);
    cursor: pointer;
  }
  input[type='number'] {
    inline-size: 56px;
    font: var(--he-font-mono, 400 15px ui-monospace, monospace);
    color: var(--he-text, #dde1e9);
    background: var(--he-stage, #0b0d11);
    border: 1px solid var(--he-border-control, #232838);
    border-radius: var(--he-radius, 4px);
    padding: 4px 6px;
  }
  input[type='range'] {
    inline-size: 96px;
    accent-color: var(--he-accent, #7c9eff);
  }
  select {
    font: inherit;
    font-size: var(--he-size-md, 16px);
    color: var(--he-text, #dde1e9);
    background: var(--he-stage, #0b0d11);
    border: 1px solid var(--he-border-control, #232838);
    border-radius: var(--he-radius, 4px);
    padding: 4px 6px;
  }
  input:focus-visible,
  select:focus-visible {
    outline: 2px solid var(--he-accent, #7c9eff);
    outline-offset: 1px;
  }
</style>
