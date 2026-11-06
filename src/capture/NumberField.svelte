<!--
  A number field with arrows of its own (board Editor-NumberStepper, spec
  §16.13): the native spinner cannot be styled, so it is hidden (controls.css)
  and two half-height buttons stand at the right end of the frame, after the
  unit when the unit is inside.

  Still `type="number"` with its `min`, `max` and `step`: ↑ ↓ on the keyboard
  keep working, and an arrow is `stepUp()` / `stepDown()` — the step, the
  bounds, the grid of position and size all come from the input itself. A
  step is committed through `onchange`, the very path a typed value takes:
  one undo entry per step.

  Held, an arrow repeats after 400 ms, then every 60 ms. The beat is a CSS
  animation's own events, `animationstart` then `animationiteration` — spec §2
  keeps timers off this page (the Toast recipe). Release, leave or cancel ends
  it. The arrows never take the focus: a field that had it keeps it.

  The frame is the input's label (spec §16.13): a click anywhere in it puts the
  caret in — but a click on an arrow is the arrow's, buttons being interactive.
  The input carries its own `aria-label`, which wins over the label's content,
  so the arrows' names never end up in the field's name.
-->
<script lang="ts">
  import { selectOnFocus } from './select-on-focus';
  import { ChevronDown, ChevronUp } from './icons';

  let {
    id,
    name,
    label,
    value,
    min,
    max,
    step,
    unit,
    prefix,
    variant = 'px',
    onchange,
  }: {
    id?: string;
    name: string;
    /** The field's accessible name. */
    label: string;
    value: number;
    min?: number;
    max?: number;
    step?: number;
    /** After the figure, inside the frame: "px". */
    unit?: string;
    /** Before the figure, inside the frame: "X", "W". */
    prefix?: string;
    variant?: 'px' | 'axis' | 'percent';
    /** Commits what the field holds — typed, ↑ ↓, or an arrow. */
    onchange: (input: HTMLInputElement) => void;
  } = $props();

  let input = $state<HTMLInputElement | null>(null);
  let held = $state<1 | -1 | null>(null);

  const atMax = $derived(max !== undefined && value >= max);
  const atMin = $derived(min !== undefined && value <= min);

  function stepBy(direction: 1 | -1) {
    if (!input) return;
    if (direction > 0) input.stepUp();
    else input.stepDown();
    onchange(input);
    // A bound reached mid-hold ends the hold: the arrow is about to go inert.
    const now = Number(input.value);
    if (
      (direction > 0 && max !== undefined && now >= max) ||
      (direction < 0 && min !== undefined && now <= min)
    ) {
      held = null;
    }
  }

  function press(event: PointerEvent, direction: 1 | -1) {
    if (event.button !== 0) return;
    // The focus stays where it was: in the field if it was there.
    event.preventDefault();
    // Held first, so a press that reaches the bound has the last word and
    // leaves no hold to fire once more on a disabled arrow.
    held = direction;
    stepBy(direction);
  }

  const release = () => (held = null);
</script>

<label class="he-field he-field--{variant}">
  {#if prefix}<span class="he-field-unit" aria-hidden="true">{prefix}</span>{/if}
  <input
    use:selectOnFocus
    bind:this={input}
    {id}
    class="he-field-input"
    {name}
    type="number"
    {min}
    {max}
    {step}
    {value}
    aria-label={label}
    onchange={(event) => onchange(event.currentTarget)}
  />
  {#if unit}<span class="he-field-unit" aria-hidden="true">{unit}</span>{/if}
  <span class="he-steps">
    {#each [1, -1] as const as direction (direction)}
      <button
        type="button"
        class="he-step"
        class:held={held === direction}
        tabindex="-1"
        aria-label={direction > 0 ? 'Increase' : 'Decrease'}
        disabled={direction > 0 ? atMax : atMin}
        onpointerdown={(event) => press(event, direction)}
        onmousedown={(event) => event.preventDefault()}
        onpointerup={release}
        onpointerleave={release}
        onpointercancel={release}
        onclick={(event) => {
          // A pointer already stepped on its way down; a click with no pointer
          // behind it (a screen reader, `detail` 0) steps here instead.
          if (event.detail === 0) stepBy(direction);
        }}
        onanimationstart={() => held === direction && stepBy(direction)}
        onanimationiteration={() => held === direction && stepBy(direction)}
      >
        {#if direction > 0}
          <ChevronUp size={10} strokeWidth={2.5} aria-hidden="true" />
        {:else}
          <ChevronDown size={10} strokeWidth={2.5} aria-hidden="true" />
        {/if}
      </button>
    {/each}
  </span>
</label>
