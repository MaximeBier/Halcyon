<script lang="ts">
  import { tick } from 'svelte';
  import KeyboardView from '../view/KeyboardView.svelte';
  import KeyPopover from './KeyPopover.svelte';
  import { hasOverrides, resolve } from '../config/resolve';
  import { detectedLabelFor } from '../config/edit';
  import { UI_TOKENS } from '../styles/ui-tokens';
  import { recommendedSize } from '../view/scene';
  import {
    onSurface,
    pixelsToUnits,
    removeKeys,
    surfaceOf,
    toggled,
    type Edge,
    type Point,
    type Rect,
  } from './layout';
  import { createGestures } from './gestures';
  import type { OverlayConfig } from '../config/schema';
  import type { LayoutMapLike } from '../keyboard/labels';
  import type { FrameKey } from '../protocol/messages';

  let {
    config,
    frame,
    selectedIds = $bindable([]),
    stageBox = $bindable({ width: 0, height: 0 }),
    onChange,
    storage,
    layout = null,
    suggestAxis = false,
    onDismissSuggestion = () => {},
    learning = $bindable(false),
    learningBanner = false,
    wizardOpen = false,
  }: {
    config: OverlayConfig;
    frame: readonly FrameKey[];
    selectedIds: number[];
    /**
     * The stage in pixels, measured here and read out.
     *
     * Bound rather than kept private because learning a key also has to place
     * it on the work surface, and that happens in the page above — which
     * cannot measure a stage it does not own. The measurement travels, not
     * the surface: both sides then derive it through `surfaceOf`, from the
     * same box and the same unit.
     */
    stageBox?: { width: number; height: number };
    onChange: (next: OverlayConfig) => void;
    /**
     * Passed straight through to the popover, whose Style fold remembers
     * whether it is open. The editor keeps nothing of its own in it.
     */
    storage: Pick<Storage, 'getItem' | 'setItem'>;
    /**
     * Passed through to the popover, and read here for one thing: whether a
     * key still wears the name its position produces. Without it a renamed key
     * is indistinguishable from one the layout named, which is the whole point
     * of the dot the handle carries.
     */
    layout?: LayoutMapLike | null;
    suggestAxis?: boolean;
    onDismissSuggestion?: () => void;
    /**
     * Mirrors the page's capture flag (spec §8.4), bindable because the stage
     * is where the one accident this flag can cause actually happens: a key
     * pressed to abandon a gesture, or a game brought to the foreground, both
     * land here first. `Escape` and losing the tab both disarm it from this
     * component rather than asking the page to watch its own window — the
     * stage already owns the `Escape` conflict this needs to win.
     */
    learning?: boolean;
    /**
     * Whether the stage should draw its own "Listening" banner.
     *
     * Kept apart from `learning`: the wizard's third step (`Wizard.svelte`,
     * board 6c) already draws the identical recipe over this same flag while
     * it walks someone through adding their first keys, and a second banner
     * underneath it would say the same thing twice. The page above passes
     * `false` for exactly that one step; everywhere else `learning` is armed
     * without a card already announcing it, this follows it one for one.
     */
    learningBanner?: boolean;
    /**
     * Whether the wizard's own card is covering this same stage right now.
     *
     * The empty-state message below answers the exact question the wizard's
     * card is already answering out loud — "there is nothing here yet" — for
     * the one span of time (`Wizard.svelte`, spec §9.1) a first key has not
     * been added. Drawing both at once said it twice, one of them sitting
     * behind the card and invisible. The page above passes `false` once the
     * wizard has been skipped or finished, which is the case a 0-key config
     * used to leave a bare black rectangle on screen (constat 1).
     */
    wizardOpen?: boolean;
  } = $props();

  /**
   * The configuration under gesture, or `null` when none is in progress.
   *
   * Written by the gesture machine alone — the reason a gesture works on a
   * draft and commits once lives with the rules, in `gestures.ts`.
   */
  let draft = $state<OverlayConfig | null>(null);

  /**
   * The selection the popover was opened for, empty when it is closed.
   *
   * A set of ids rather than a boolean, so that **any** change of selection
   * closes it — including one made outside this component, which a boolean
   * could not see. Deleting from the sidebar list emptied `selectedIds` and
   * left the flag standing; the next Ctrl+A then reopened a panel nobody had
   * asked for. Found in review on 2026-08-20.
   *
   * Kept apart from the selection itself, because the two answer different
   * questions: a click says *which* keys, a deliberate second gesture says
   * *edit them*. Opening on selection would put a panel over the layout at the
   * exact moment one is looking at it (spec §16.5).
   */
  let editingFor = $state<number[]>([]);

  /** The marquee to draw, in key units and the right way round, or `null`. */
  let lassoRect = $state<Rect | null>(null);
  let stage = $state<HTMLElement | null>(null);

  /**
   * The eight handles, and why there are eight rather than three.
   *
   * Pulling a near edge — left or top — has to write the position *and* the
   * size, since `x` and `w` are two properties and one gesture. That is the
   * whole cost of the other five, and `resizeKeyTo` pays it in one place.
   */
  const EDGES: readonly Edge[] = ['n', 'e', 's', 'w', 'ne', 'se', 'sw', 'nw'];

  /** What the editor shows: the draft while dragging, the real one otherwise. */
  const shown = $derived(draft ?? config);
  const resolved = $derived(resolve(shown));

  /**
   * Nothing to arrange, and nobody already saying so.
   *
   * `shown` rather than `config`: a gesture never runs with zero keys, so the
   * two never disagree, and reading the same value the rest of this file
   * already reads (see the `.source` line's own `shown.keys.length` check
   * below) keeps one rule for "the stage has nothing on it" instead of two.
   */
  const showsEmptyStage = $derived(shown.keys.length === 0 && !wizardOpen);

  const unit = $derived(shown.style.unit);
  const gap = $derived(shown.style.gap);

  function measure() {
    if (stage) stageBox = { width: stage.clientWidth, height: stage.clientHeight };
  }

  /**
   * Observed, not measured once at mount.
   *
   * The stage changes height without the window changing size, and this page
   * grew two ways of doing it on 2026-08-23 alone: the warning about a second
   * capture page takes a whole header line, and the unsupported-browser banner
   * is full width. Both push the stage up while `onresize` never fires.
   *
   * A stale height is not cosmetic here. `surfaceOf(stageBox)` is what
   * `keysOutside` compares against, and the list of keys off the surface is
   * **the only thing that can say a key still exists** — the stage does not
   * scroll, so a key in the strip that was taken away is drawn nowhere at all.
   * Measured once, the editor would go on claiming the strip was still there.
   */
  $effect(() => {
    if (!stage) return;
    measure();

    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    return () => observer.disconnect();
  });

  const surface = $derived(surfaceOf(stageBox, unit));

  /**
   * The drag, resize and lasso rules, kept apart from the DOM (gestures.ts).
   *
   * This side only translates events and holds the reactive mirrors the
   * template reads; every decision — what a press selects, where a clamp
   * stops, whether a release writes — is made over there, on plain values.
   */
  const gestures = createGestures(() => ({ config, surface, unit, selectedIds }), {
    preview: (next) => (draft = next),
    marquee: (rect) => (lassoRect = rect),
    select: (ids) => (selectedIds = ids),
    commit: (next) => onChange(next),
  });

  /** A key coordinate in stage pixels. */
  const acrossX = (x: number) => (x - surface.x) * unit;
  const acrossY = (y: number) => (y - surface.y) * unit;

  /**
   * The drawing, translated onto the work surface.
   *
   * Every pixel below is a stage pixel: the handles, the marquee and the
   * popover all measure from the same origin as the SVG, and the only place
   * key coordinates appear is where they are read from or written to the
   * configuration.
   */
  const scene = $derived(onSurface(resolved, surface));

  /**
   * The radius a key is drawn with, for the outlines drawn on top of it.
   *
   * The handle sits exactly on the key's own box and carries the hover outline
   * and the selection halo, so a radius of its own would draw them beside the
   * thing they belong to. Read from the resolved style, because the radius is
   * overridable per key.
   */
  const radiusOf = (id: number) => resolved.keys.find((key) => key.id === id)?.style.radius ?? 0;
  const selection = $derived(shown.keys.filter((key) => selectedIds.includes(key.id)));

  /**
   * The key the grips belong to, or `null` when they are not offered.
   *
   * Single selection only, like the Position fields: an edge pulled on a group
   * would have to mean something for every key in it, and `resizeKeys` giving
   * them all one size is not what pulling an edge looks like.
   *
   * Read from `shown`, so the grips follow the draft while the edge is being
   * pulled instead of staying on the size it started from.
   */
  const sizable = $derived(selection.length === 1 ? selection[0]! : null);
  /**
   * What the OBS browser source has to be, in pixels — and the reason it is
   * here rather than tucked in a panel.
   *
   * OBS fixes a browser source's size when the source is created, and never
   * revises it. Every key added past that size is simply cropped, silently,
   * on both sides at once: the capture page looks right and the scene looks
   * wrong. Keeping the figure in view, next to the keys that determine it, is
   * what turns that into something anyone can notice.
   *
   * Read from the draft during a drag, so it moves as the layout does.
   */
  const source = $derived(recommendedSize(resolved));

  // Hidden for the length of the gesture, not closed: following the key across
  // the stage is unreadable, and staying put covers where the key is going.
  const popoverVisible = $derived(
    draft === null &&
      selection.length > 0 &&
      editingFor.length === selectedIds.length &&
      editingFor.every((id) => selectedIds.includes(id)),
  );

  const POPOVER_WIDTH = Number.parseInt(UI_TOKENS.popoverWidth, 10);

  let panel = $state<HTMLElement | null>(null);
  /**
   * How tall the popover currently is, in pixels.
   *
   * Measured rather than read from a token, because unlike its width it is
   * not fixed: a group selection loses the *Label* and *Position* rows, and
   * the axis suggestion adds one.
   *
   * **Observed**, because the list of what changes it is not ours to keep. It
   * used to be re-read on `shown`, `selectedIds` and `suggestAxis` — three
   * props, all owned here — while the height came to be dominated by state
   * held *inside* the panel: the Style fold opening five rows, the icon grid
   * appearing under the label. Neither is visible from this side, so the
   * anchor was computed against a height from before the fold opened, and the
   * panel ran off a stage that does not scroll — which is the exact failure
   * `flipped()` exists to prevent.
   *
   * Zero when the panel is not on screen, which is also what jsdom reports:
   * both mean "no measurement", and the clamp below leaves the anchor alone.
   */
  let panelHeight = $state(0);
  $effect(() => {
    if (!panel) {
      panelHeight = 0;
      return;
    }

    const read = () => (panelHeight = panel?.offsetHeight ?? 0);
    read();

    const observer = new ResizeObserver(read);
    observer.observe(panel);
    return () => observer.disconnect();
  });

  /**
   * Where the popover goes, in stage pixels: under the selection, and inside
   * the stage on both axes.
   *
   * Anchored to a key near an edge, the panel used to run outside the visible
   * stage — and instead of moving, it grew a scrollbar and put half its
   * controls off-screen. Clamped against the *visible* window rather than the
   * content, so it still lands correctly if the stage ever is scrolled.
   *
   * The two axes do not get the same treatment. Sideways the panel slides,
   * because sliding costs nothing. Downwards it **flips above** the selection
   * instead, because sliding up means covering the keys being edited at the
   * one moment they are being looked at (spec §16.5).
   */
  const anchor = $derived.by(() => {
    const left = acrossX(Math.min(...selection.map((key) => key.x)));
    const under = acrossY(Math.max(...selection.map((key) => key.y + key.h))) + gap;
    const over = acrossY(Math.min(...selection.map((key) => key.y))) - gap - panelHeight;

    return { x: slid(left), y: flipped(under, over) };
  });

  // The stage is `overflow: hidden` since task 31 — the work surface moved into
  // the coordinates, and the element stopped scrolling. Both clamps used to add
  // `scrollLeft` / `scrollTop`, which have read zero ever since: a dead branch,
  // kept alive by a test that assigned `stage.scrollLeft` by hand, which jsdom
  // accepts on a non-scrolling element and no browser ever produces.
  function slid(left: number): number {
    const room = stageBox.width;
    if (room === 0) return left;

    return Math.min(left, Math.max(0, room - POPOVER_WIDTH - gap));
  }

  function flipped(under: number, over: number): number {
    const room = stageBox.height;
    if (room === 0 || panelHeight === 0) return under;

    if (under + panelHeight <= room) return under;
    // Above the selection when the panel fits there, and against the top edge
    // when it fits neither way: a panel half on screen beats one entirely off
    // it, and its header is the half worth keeping.
    return over >= 0 ? over : Math.max(0, room - panelHeight);
  }

  export function open(id: number) {
    if (!selectedIds.includes(id)) selectedIds = [id];
    editingFor = [...selectedIds];
    wantsFocus = true;
  }

  /**
   * Whether a drag, resize or lasso is underway — read by the page before it
   * honours Ctrl+Z. Mid-gesture the draft still holds the old layout, and its
   * commit on release would write right over whatever undo just restored.
   */
  export function gesturing(): boolean {
    return draft !== null;
  }

  /**
   * Whether the next popover render should take the focus.
   *
   * Raised by `open()` alone, deliberately. The popover also remounts when a
   * drag ends — hidden for the gesture, back on the drop — and focusing there
   * would tear the focus away from the pointer's work for a panel nobody just
   * asked about. Only the deliberate gesture is a request to edit, and only a
   * request to edit should move the focus.
   */
  let wantsFocus = $state(false);

  // The dialog is `role="dialog"`, and a dialog that leaves the focus behind
  // is silent: the screen reader announces nothing, and a keyboard user tabs
  // through every remaining handle in the layout before reaching the fields
  // they asked for — the panel is rendered after the whole key loop.
  $effect(() => {
    if (!panel || !wantsFocus) return;
    wantsFocus = false;
    panel.querySelector<HTMLElement>('button, input, select')?.focus();
  });

  /**
   * Closes the popover and puts the focus back where the editing began.
   *
   * The dialog took the focus when it opened, so it has to hand it back:
   * unmounting it otherwise drops the focus on `<body>`, and the next Tab
   * starts from the top of the page. After the render, not before — the close
   * can travel with a config change (the popover's own Delete), and the handle
   * to return to may be gone once it lands. Whichever of the edited keys still
   * has a handle takes it; the stage catches the case where none does.
   */
  async function closePopover() {
    const ids = editingFor;
    editingFor = [];
    await tick();
    const handle = ids
      .map((id) => stage?.querySelector<HTMLElement>(`.handle[data-id="${id}"]`))
      .find((found) => found);
    (handle ?? stage)?.focus();
  }

  /**
   * Lets a half-typed field commit before the popover goes away.
   *
   * The popover's fields write on `change`, which the browser fires on blur —
   * and blur is part of the *default action* of a pointerdown elsewhere, so it
   * happens after this handler. Unmounting the popover here detached the input
   * while it still held focus, and a detached input fires neither blur nor
   * change: the label someone had just typed was silently dropped. Blurring
   * first makes the commit happen while the field is still in the document.
   */
  function commitPendingEdit() {
    const active = document.activeElement;
    if (active instanceof HTMLElement && active.closest('.anchor')) active.blur();
  }

  /**
   * Pressing bare stage drops the selection.
   *
   * Guarded on the target being the stage itself: the handles and the popover
   * sit inside it, so an unguarded handler would clear the selection on the
   * way to every key — and close the popover on the first click inside it.
   */
  function onStagePointerDown(event: PointerEvent) {
    if (event.target !== event.currentTarget) return;
    // Primary button only, as on the handles: a right-click would arm a
    // marquee whose release the context menu swallows.
    if (event.button !== 0) return;

    commitPendingEdit();
    editingFor = [];

    gestures.pressStage(stagePoint(event), event.shiftKey);
  }

  /**
   * Where the pointer is in the layout, in key units.
   *
   * The scroll has to be added back. `getBoundingClientRect()` of a scroll
   * container is its border box, which does **not** move when its own content
   * scrolls — while the handles, positioned inside that content, do. Without
   * this a layout scrolled by one key drew the lasso a key away from the
   * pointer and selected the neighbours. Found in review on 2026-08-21, on a
   * stage that only became scrollable in this same milestone.
   */
  function stagePoint(event: PointerEvent): Point {
    const box = stage?.getBoundingClientRect();
    return {
      // The surface origin comes back off: everything above works in canvas
      // pixels, and a lasso is compared against key coordinates.
      // No scroll offset: the stage is `overflow: hidden`, so the bounding
      // rectangle already is the visible origin.
      x: pixelsToUnits(event.clientX - (box?.left ?? 0), unit) + surface.x,
      y: pixelsToUnits(event.clientY - (box?.top ?? 0), unit) + surface.y,
    };
  }

  function toggle(id: number) {
    selectedIds = toggled(selectedIds, id);
  }

  /**
   * Selection happens here, on press, and nowhere else.
   *
   * It used to run twice — once here and once on the click that follows —
   * so a shift+click added the key and then immediately removed it: the
   * gesture did nothing at all. Pressing is also when an editor should
   * commit to a selection, since the drag starts from it.
   */
  function onPointerDown(event: PointerEvent, id: number) {
    // Primary button only. A right-click used to arm the drag and then have
    // its release swallowed by the context menu, leaving the editor dragging
    // the selection on plain mouse movement with nothing held down.
    if (event.button !== 0) return;

    // Before any branch: a toggle takes the popover down by changing the
    // selection, a drag by arming the draft — either way the focused field
    // detaches, so whatever is half-typed in it commits here or never.
    commitPendingEdit();

    const armed = gestures.pressKey(id, { x: event.clientX, y: event.clientY }, event.shiftKey);
    if (armed) (event.currentTarget as Element).setPointerCapture(event.pointerId);
  }

  /**
   * Arms a resize, and **only** a resize.
   *
   * The grip sits on top of the key's own handle, so without stopping the
   * propagation the press would start both gestures: the key sliding under the
   * pointer while its edge is being pulled.
   */
  function onGripPointerDown(event: PointerEvent, edge: Edge) {
    if (event.button !== 0) return;
    if (!sizable) return;
    event.stopPropagation();

    // The grip never touches the selection, so nothing else on this path
    // commits the popover's field before the draft hides it.
    commitPendingEdit();

    gestures.pressGrip(sizable, edge, { x: event.clientX, y: event.clientY });
    (event.currentTarget as Element).setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: PointerEvent) {
    // The stage point is passed as a thunk: only the lasso needs it, and the
    // conversion reads the stage's bounding box on every call.
    gestures.move({ x: event.clientX, y: event.clientY }, event.buttons, () => stagePoint(event));
  }

  /**
   * Keyboard activation only. `detail` counts the clicks of a pointer, so a
   * zero means Enter or Space on a focused key — the pointer path is already
   * handled on press, and running here as well is what broke shift+click.
   */
  function onClick(event: MouseEvent, id: number) {
    if (event.detail !== 0) return;
    if (event.shiftKey) toggle(id);
    else selectedIds = [id];
  }

  function onKeyDown(event: KeyboardEvent) {
    // Learning claims Escape before anything else on the stage reads it, and
    // returns without falling through to the block below: a key pressed to
    // stop the capture must do exactly that, not also clear a selection or
    // close a popover that has nothing to do with why the hand went there.
    if (learning && event.key === 'Escape') {
      learning = false;
      return;
    }

    // The mode selector is not an input, and Ctrl+A inside it belongs to it.
    const typing =
      event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement;

    if (!typing && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
      event.preventDefault();
      selectedIds = shown.keys.map((key) => key.id);
    }
    if (event.key === 'Escape') {
      // Abandons the gesture first: leaving a drag armed with no selection is
      // the one state with no way out.
      gestures.cancel();
      // One key, two things to undo, so they come off in the order they went
      // on. Clearing the selection first would leave the popover anchored to
      // nothing for the frame before it noticed.
      if (editingFor.length > 0) closePopover();
      else {
        selectedIds = [];
        // And the focus with it. A handle keeps focus after a click, so
        // clearing the selection alone left a ring drawn around a key that
        // was no longer selected — saying nothing true about it.
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      }
    }
    if (!typing && event.key === 'Delete' && selectedIds.length > 0) {
      onChange(removeKeys(config, selectedIds));
      selectedIds = [];
    }
  }

  /**
   * Enter and Space activate a focused key handle, and the browser turns both
   * into a click — hence the `detail === 0` path in `onClick`. Enter alone
   * opens the editor, matching the mockup; Space keeps meaning "select".
   */
  function onHandleKeyDown(event: KeyboardEvent, id: number) {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    open(id);
  }

  /**
   * Disarms learning the moment the tab stops being the one on screen.
   *
   * The only scenario in which this page can sabotage someone's stream:
   * capture left armed by an "+ Add key" nobody remembered to stop, then
   * alt-tabbed into the game. From that moment every key the game receives
   * would otherwise join the overlay live, on air, one report at a time —
   * `blur` catches the alt-tab itself, `visibilitychange` the cases a blur
   * misses (a minimized window, a switch to another virtual desktop).
   */
  function disarmOnHidden() {
    if (learning) learning = false;
  }

  function onVisibilityChange() {
    if (document.hidden) disarmOnHidden();
  }
</script>

<!-- The release and the cancellation are watched on the window, not on the
     stage: a pointer can be released anywhere, and a cancelled one — touch
     scrolling wins the gesture — never reports to the stage at all. -->
<svelte:window
  onkeydown={onKeyDown}
  onpointermove={onPointerMove}
  onpointerup={gestures.release}
  onpointercancel={gestures.cancel}
  onresize={measure}
  onblur={disarmOnHidden}
/>
<!-- `visibilitychange` fires on the document, never on the window. -->
<svelte:document onvisibilitychange={onVisibilityChange} />

<div class="editor">
  <!-- The one place the AXIS tag appears: the broadcast never shows it
       (spec §16.3). A dashed outline used to come with it, gone 2026-08-23. -->
  <!-- The stage is a surface, not a control, and it needs no keyboard path of
       its own: Escape already clears the selection from anywhere. The -1 keeps
       it out of the Tab order; it only lets a closing popover park the focus
       somewhere real when the key it would return to has been deleted. -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="stage" tabindex="-1" bind:this={stage}>
    {#if learningBanner}
      <!-- The wizard's own third step (Wizard.svelte) draws this exact recipe
           over the same flag while it walks someone through their first keys.
           This is it again for every other moment learning is armed — manual
           "+ Add key" most of all — so the stage never listens in silence. -->
      <div class="learning" data-learning-banner role="status">
        <span class="beacon" aria-hidden="true"></span>
        <strong>Listening · press any key — Esc stops</strong>
      </div>
    {/if}
    <!-- The work surface. Its size comes from the stylesheet and never from a
         number: see `.canvas` below. -->
    <div class="canvas" onpointerdown={onStagePointerDown}>
      <KeyboardView config={scene} {frame} decorations reveal />
      {#each shown.keys as key (key.id)}
        <button
          class="handle"
          data-id={key.id}
          class:selected={selectedIds.includes(key.id)}
          class:customized={hasOverrides(key) || detectedLabelFor(key, layout) !== null}
          style:transform={`translate(${acrossX(key.x) + gap / 2}px, ${acrossY(key.y) + gap / 2}px)`}
          style:width={`${Math.max(0, key.w * unit - gap)}px`}
          style:height={`${Math.max(0, key.h * unit - gap)}px`}
          style:border-radius={`${radiusOf(key.id)}px`}
          onpointerdown={(event) => onPointerDown(event, key.id)}
          onclick={(event) => onClick(event, key.id)}
          ondblclick={() => open(key.id)}
          onkeydown={(event) => onHandleKeyDown(event, key.id)}
          oncontextmenu={(event) => {
            // The native menu offers nothing over a key handle, and it would
            // land on top of the popover we are opening underneath it.
            event.preventDefault();
            open(key.id);
          }}
          aria-label={`Select ${key.label}`}
          aria-pressed={selectedIds.includes(key.id)}
        ></button>
      {/each}

      {#if showsEmptyStage}
        <!-- Centred over the whole canvas, and inert: a lasso drawn under it,
             or a click meant to clear the selection, has to reach the canvas
             underneath exactly as it would if this were not here at all. -->
        <div class="empty">
          <p>No keys yet — Add key on the right, then press one.</p>
        </div>
      {/if}

      {#if sizable}
        <!-- After the key handles in the DOM, so they paint over the one they
             belong to; the press stops here and never reaches it. One box on
             the key, and the eight bands placed inside it by the stylesheet:
             the geometry is written once, in pixels the key already gave. -->
        <div
          class="grips"
          style:transform={`translate(${acrossX(sizable.x) + gap / 2}px, ${acrossY(sizable.y) + gap / 2}px)`}
          style:width={`${Math.max(0, sizable.w * unit - gap)}px`}
          style:height={`${Math.max(0, sizable.h * unit - gap)}px`}
        >
          <!-- Plain elements rather than buttons, and hidden from assistive
               technology on purpose: there is nothing to activate, and the
               keyboard path to a size is the popover's Size fields. -->
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          {#each EDGES as edge (edge)}
            <div
              class="grip"
              class:corner={edge.length === 2}
              data-edge={edge}
              aria-hidden="true"
              onpointerdown={(event) => onGripPointerDown(event, edge)}
            ></div>
          {/each}
        </div>
      {/if}

      {#if lassoRect}
        <div
          class="lasso"
          style:transform={`translate(${acrossX(lassoRect.x)}px, ${acrossY(lassoRect.y)}px)`}
          style:width={`${lassoRect.w * unit}px`}
          style:height={`${lassoRect.h * unit}px`}
        ></div>
      {/if}

      {#if popoverVisible}
        <div
          class="anchor"
          bind:this={panel}
          style:transform={`translate(${anchor.x}px, ${anchor.y}px)`}
        >
          <KeyPopover
            {config}
            {selectedIds}
            {surface}
            {onChange}
            {storage}
            {layout}
            {suggestAxis}
            {onDismissSuggestion}
            onClose={closePopover}
          />
        </div>
      {/if}
    </div>
  </div>

  <div class="foot">
    {#if shown.keys.length > 0}
      <p class="source">
        Recommended OBS browser source · <code>{source.width} × {source.height} px</code>
      </p>
    {/if}

    <p class="shortcuts">
      Click to select · Shift+click to add · Drag the background to lasso · Double-click to edit ·
      Ctrl+A for all · Delete to remove · Ctrl+Z to undo
    </p>
  </div>
</div>

<style>
  /**
   * A column that fills whatever it is given: the stage takes the room, the
   * shortcut bar sits at the bottom of the page.
   *
   * The stage used to be as big as the keys were, which made the empty space
   * around them belong to nobody — a lasso could not start there, and a click
   * meant to clear the selection landed outside the editor entirely.
   */
  .editor {
    display: flex;
    flex-direction: column;
    block-size: 100%;
    min-block-size: 0;
  }
  /* Drawn over the keys and under nothing that is clickable: the marquee is
     feedback, and the pointer must keep reaching the stage beneath it. */
  /**
   * The resize grips, on the selected key only.
   *
   * The box itself is inert — it covers the whole key, and catching a press
   * there would take the click that selects and the drag that moves. Only the
   * eight bands inside it listen, each a few pixels straddling its edge: enough
   * to aim at, little enough that the key stays the thing one grabs to move it.
   *
   * The corners are drawn, the sides are not. A square at each corner is the
   * affordance everyone already knows; four visible bands around a key would
   * read as a second selection outline.
   */
  .grips {
    position: absolute;
    /* Pinned to the canvas origin so the inline `transform: translate()` is
       the whole offset, not a delta on top of an unset (browser-computed)
       static position — the same reasoning as `.handle` below. */
    left: 0;
    top: 0;
    pointer-events: none;
  }
  .grip {
    position: absolute;
    pointer-events: auto;
    /* The browser must not turn a drag into a scroll: it would cancel the
       pointer mid-gesture. */
    touch-action: none;
  }
  .grip[data-edge='n'],
  .grip[data-edge='s'] {
    inset-inline: 0;
    block-size: 7px;
    cursor: ns-resize;
  }
  .grip[data-edge='n'] {
    inset-block-start: -3px;
  }
  .grip[data-edge='s'] {
    inset-block-end: -3px;
  }
  .grip[data-edge='w'],
  .grip[data-edge='e'] {
    inset-block: 0;
    inline-size: 7px;
    cursor: ew-resize;
  }
  .grip[data-edge='w'] {
    inset-inline-start: -3px;
  }
  .grip[data-edge='e'] {
    inset-inline-end: -3px;
  }
  /* Last in the DOM order, so a corner wins over the two sides it meets. */
  .grip.corner {
    inline-size: 8px;
    block-size: 8px;
    background: var(--he-accent);
    border-radius: 1px;
  }
  .grip[data-edge='nw'],
  .grip[data-edge='ne'] {
    inset-block-start: -4px;
  }
  .grip[data-edge='sw'],
  .grip[data-edge='se'] {
    inset-block-end: -4px;
  }
  .grip[data-edge='nw'],
  .grip[data-edge='sw'] {
    inset-inline-start: -4px;
  }
  .grip[data-edge='ne'],
  .grip[data-edge='se'] {
    inset-inline-end: -4px;
  }
  .grip[data-edge='nw'],
  .grip[data-edge='se'] {
    cursor: nwse-resize;
  }
  .grip[data-edge='ne'],
  .grip[data-edge='sw'] {
    cursor: nesw-resize;
  }

  .lasso {
    position: absolute;
    /* See `.handle` below: `transform` carries the whole offset, so the
       static left/top this replaces has to be pinned rather than left to
       whatever the browser would have computed for it. */
    left: 0;
    top: 0;
    pointer-events: none;
    border: 1px dashed var(--he-accent);
    background: color-mix(in srgb, var(--he-accent) 12%, transparent);
    border-radius: var(--he-radius);
  }
  /**
   * The work surface itself, and **it does not scroll**.
   *
   * `surfaceOf` makes one promise — the edge of the work surface is the edge of
   * the screen — and a scrollbar was the exception that broke it. With one,
   * "off the surface" no longer meant "out of sight", so the boundary had two
   * readings; every pointer coordinate had to add back a scroll offset; and a
   * key past the edge was reachable in one direction only, since nothing
   * scrolls towards negative coordinates.
   *
   * It was there to rescue a key that had ended up outside. That job now
   * belongs to the sidebar list, which says which keys they are — and can say
   * it whichever side they went out of.
   */
  .stage {
    flex: 1;
    position: relative;
    overflow: hidden;
    background: var(--he-stage);
    /* A drag across the keys used to select the SVG labels as if they were a
       paragraph, leaving a blue smear over the layout. Nothing here is text
       anyone means to copy. */
    user-select: none;
  }
  /* The focus arrives here by script and never by Tab: a closing popover parks
     it when the key it came from has just been deleted. The browser's own ring
     then framed the whole work surface in white — the largest thing on screen,
     outlined to say something nobody asked. The `-1` above keeps this off the
     keyboard path, so unlike `.handle:focus` below there is no keyboard half to
     give the ring back to. */
  .stage:focus {
    outline: none;
  }
  /* The wizard's own banner recipe (Wizard.svelte `.banner`/`.beacon`),
     repeated here rather than shared: Svelte styles are scoped per component,
     and the two never render at once — `learningBanner` sees to that. */
  .learning {
    position: absolute;
    inset-block-start: 16px;
    inset-inline: 0;
    z-index: 4;
    inline-size: fit-content;
    margin-inline: auto;
    display: flex;
    align-items: center;
    gap: 13px;
    padding: 13px 18px;
    font: var(--he-font);
    color: var(--he-text);
    background: var(--he-popover);
    border: 1px solid var(--he-accent);
    border-radius: var(--he-radius-panel);
    /* Informational only — unlike the wizard's, this banner carries no
       button, and must not steal a click meant for the keys under it. */
    pointer-events: none;
  }
  .learning .beacon {
    flex: none;
    inline-size: 9px;
    block-size: 9px;
    border-radius: 50%;
    background: var(--he-accent);
  }
  .learning strong {
    font-size: var(--he-size-lg);
    font-weight: 700;
  }
  /**
   * Filled by the stylesheet, never sized from a measurement — and that is a
   * bug fix, not a preference.
   *
   * Setting `width: ${clientWidth}px` here is a feedback loop: the size posted
   * changes the box the measurement came from. `clientWidth` is rounded to a
   * whole pixel, so at a fractional zoom — 90 %, where the real content box is
   * 1688.5 px — it reports 1689, the canvas overflows by half a pixel, and a
   * horizontal scrollbar appears. That bar then costs fifteen pixels of
   * height, which overflows the other axis, so both appear at once.
   *
   * Worse, it sticks: with a bar present `clientWidth` excludes it, so the
   * next measurement is fifteen pixels short, the canvas shrinks and the bars
   * go — which is why zooming out produced them and zooming back in did not.
   * `100%` is exact by construction, at any zoom.
   */
  .canvas {
    position: relative;
    inline-size: 100%;
    block-size: 100%;
  }
  /* The drawing is scenery, and it covers part of the canvas: without this, a
     press on the empty space *between* two keys landed on the <svg> and the
     "pressing bare stage clears the selection" guard never matched — the only
     place it did was outside the layout's bounding box, which is often
     nowhere. Found in review on 2026-08-20. The handles are siblings, so they
     keep their events. */
  .canvas :global(svg) {
    pointer-events: none;
    display: block;
  }
  /**
   * The message a 0-key stage used to show nothing at all in place of.
   *
   * `pointer-events: none`, deliberately: this sits over the same canvas the
   * bare-stage handler and the lasso both listen on, and a message that ate
   * the click meant to start a marquee would trade one empty-stage confusion
   * for another. Centred on the whole canvas rather than following any key,
   * since with zero keys there is nothing to anchor it to.
   */
  .empty {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    text-align: center;
    pointer-events: none;
  }
  .empty p {
    margin: 0;
    max-inline-size: 36ch;
    font-size: var(--he-size-md);
    color: var(--he-text-muted);
  }
  .handle {
    position: absolute;
    /* Pinned to the canvas origin: the position moves through the inline
       `transform: translate()` now (task 16 — a drag used to reassign `left`
       and `top` every frame, which is the one layout-thrashing spot in the
       project), so `left`/`top` here must be fixed rather than left for the
       browser to compute a "static position" for. */
    left: 0;
    top: 0;
    /* The browser must not turn a drag into a scroll: it would cancel the
       pointer mid-gesture. */
    touch-action: none;
    background: transparent;
    border: 1px dashed transparent;
    border-radius: var(--he-radius);
    cursor: grab;
    padding: 0;
  }
  .handle:hover {
    border-color: var(--he-text-faint);
  }
  /* Clicking a button focuses it, and the browser's own ring then stays on
     screen after Escape has cleared the selection — a thick white outline on
     a key that is no longer selected, saying nothing true. Removed here and
     given back below for the keyboard, which is who it is for. */
  .handle:focus {
    outline: none;
  }
  .handle:focus-visible {
    outline: 2px solid var(--he-accent-hover);
    outline-offset: 2px;
  }
  .handle.selected {
    border: 1px solid var(--he-accent);
    border-style: solid;
    /* A shadow rather than an outline: `outline` is what the focus ring uses,
       and one of the two would always be hiding the other. */
    box-shadow: 0 0 0 1px var(--he-accent);
  }
  /* The same amber the popover badge uses. One colour, one meaning: **this key
     was customized** — a style that differs from the global (spec §8.2), a
     label that is not the one its position produces, or both.

     It read "differs from the global style" alone until 2026-08-24. A renamed
     key is the case that hurts more: a style override is visible on the key
     itself, while a label someone typed is invisible by construction — it
     looks exactly like a key that came out of the layout that way. Four arrows
     drawn as a clean cluster, one of which is Right Ctrl, and nothing on
     screen to say which one.

     Top *left*, because the AXIS tag the renderer draws sits top right and the
     two were printing on top of each other. Temporary: the mockup has not
     placed either of them yet, and when it does they move together. */
  .handle.customized::after {
    content: '';
    position: absolute;
    top: 3px;
    left: 3px;
    inline-size: 6px;
    block-size: 6px;
    border-radius: 50%;
    background: var(--he-override);
  }
  .anchor {
    position: absolute;
    /* See `.handle` above: the offset lives entirely in `transform` now. */
    left: 0;
    top: 0;
    /* Over the keys, and over nothing else: the stage is the only stacking
       context here, so the popover cannot escape it and cover the sidebar. */
    z-index: 1;
  }
  .foot {
    flex: none;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    padding: 9px 18px;
  }
  /* Louder than the help text below it: this one is a value to carry to OBS,
     not a reminder of what the mouse does. */
  .source {
    margin: 0;
    font-size: var(--he-size-sm);
    color: var(--he-text-muted);
  }
  .source code {
    font: var(--he-font-mono);
    color: var(--he-text);
  }
  .shortcuts {
    margin: 0;
    text-align: center;
    font-size: var(--he-size-xs);
    color: var(--he-text-faint);
  }
</style>
