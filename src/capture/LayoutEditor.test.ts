import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/svelte';
import { tick } from 'svelte';
import LayoutEditor from './LayoutEditor.svelte';
import editorSource from './LayoutEditor.svelte?raw';
import { DEFAULT_STYLE, defaultConfig, type OverlayConfig } from '../config/schema';
import { surfaceOf } from './layout';
import { resized } from '../test/resize-observer';
import { setKeyStyle } from '../config/edit';

afterEach(cleanup);

// Two whole key widths, read from the default rather than written as a pixel
// count: the mockup moved the tile from 56 px to 72 px on 2026-08-20, and a
// literal here silently became "1.55 units", which the quarter-key grid then
// snapped to 1.5.
const TWO_KEYS_ACROSS = 2 * DEFAULT_STYLE.unit;

/**
 * The stage every test renders into, and the surface that follows from it.
 *
 * Stubbed rather than measured, and stubbed **before** the render: jsdom lays
 * nothing out, so an editor left to its own devices would fall back to the
 * minimum surface and none of the coordinates below would mean anything.
 */
const STAGE = { width: 1440, height: 720 };
const SURFACE = surfaceOf(STAGE, DEFAULT_STYLE.unit);

/**
 * Where key coordinate 0,0 sits in stage pixels: the middle of the stage.
 *
 * The work surface has room on every side of the origin (task 31), so a
 * client point of 0,0 is half a screen left of and above the first key. Every
 * coordinate below is written relative to that centre, through `from`.
 */
const ORIGIN = { x: -SURFACE.x * DEFAULT_STYLE.unit, y: -SURFACE.y * DEFAULT_STYLE.unit };

const from = (x: number, y: number): PointerEventInit => ({
  clientX: ORIGIN.x + x,
  clientY: ORIGIN.y + y,
});

function twoKeys(): OverlayConfig {
  const config = defaultConfig();
  config.keys.push(
    { id: 1, usage: 0x14, mode: 'key', label: 'A', x: 0, y: 0, w: 1, h: 1 },
    { id: 2, usage: 0x16, mode: 'key', label: 'S', x: 1, y: 0, w: 1, h: 1 },
  );
  return config;
}

function laidOut(box: { width: number; height: number }) {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    value: box.width,
    configurable: true,
  });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    value: box.height,
    configurable: true,
  });
}

// Deleted rather than restored: the stub shadows the accessor `Element`
// provides, and removing it hands the real one back.
afterEach(() =>
  ['clientWidth', 'clientHeight'].forEach((name) =>
    Reflect.deleteProperty(HTMLElement.prototype, name),
  ),
);

function editor(config = twoKeys(), box = STAGE, selectedIds: number[] = []) {
  laidOut(box);
  const onChange = vi.fn();
  const view = render(LayoutEditor, {
    props: {
      config,
      frame: [],
      selectedIds,
      stageBox: { ...box },
      onChange,
      // The popover's Style fold remembers whether it is open; nothing here
      // reaches for  on its own.
      storage: { getItem: () => null, setItem: () => {} },
    },
  });
  const handles = [...view.container.querySelectorAll('button.handle')] as HTMLElement[];
  // jsdom has no pointer capture; the editor only ever asks for it.
  for (const target of [...handles, ...view.container.querySelectorAll('.grip')]) {
    (target as HTMLElement).setPointerCapture = () => {};
    (target as HTMLElement).releasePointerCapture = () => {};
  }
  // The canvas is what carries the layout and the bare-surface handler; the
  // stage is only the window onto it, and what scrolls.
  const canvas = view.container.querySelector<HTMLElement>('.canvas')!;
  const stage = view.container.querySelector<HTMLElement>('.stage')!;
  return { ...view, onChange, handles, canvas, stage };
}

const press = (target: Element, init: PointerEventInit = {}) =>
  target.dispatchEvent(
    new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerId: 1, ...init }),
  );

const move = (target: Element, init: PointerEventInit = {}) =>
  target.dispatchEvent(
    new PointerEvent('pointermove', { bubbles: true, buttons: 1, pointerId: 1, ...init }),
  );

describe('LayoutEditor - a drag that never ends', () => {
  // Every one of these leaves the editor in a state the user cannot get out
  // of: the draft stays on screen, disagreeing with what was persisted and
  // broadcast, and plain mouse movement keeps dragging the selection.

  it('ignores a right-click, which the context menu would swallow', () => {
    const { handles, container, onChange } = editor();

    press(handles[0]!, { button: 2 });
    move(container.querySelector('.stage')!, { clientX: 200, clientY: 200 });
    container
      .querySelector('.stage')!
      .dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));

    expect(onChange).not.toHaveBeenCalled();
  });

  it('stops dragging when the pointer is cancelled', async () => {
    // Touch scrolling cancels the pointer, and nothing else would close it.
    // Checked on the handle rather than on onChange: with the drag still
    // armed the key follows the pointer on screen long before anything is
    // written, and that is what the user sees.
    const { handles, container } = editor();
    const before = handles[0]!.style.left;

    press(handles[0]!);
    window.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, pointerId: 1 }));
    move(container.querySelector('.stage')!, { clientX: 300, clientY: 0 });
    await tick();

    expect(handles[0]!.style.left).toBe(before);
  });

  it('stops dragging when the button is no longer held', async () => {
    // A pointerup lost outside the stage used to leave the key following the
    // mouse with nothing pressed at all.
    const { handles, container } = editor();
    const before = handles[0]!.style.left;

    press(handles[0]!);
    move(container.querySelector('.stage')!, { clientX: 300, clientY: 0, buttons: 0 });
    await tick();

    expect(handles[0]!.style.left).toBe(before);
  });

  it('commits on a release anywhere, not only over the stage', () => {
    const { handles, container, onChange } = editor();

    press(handles[0]!);
    move(container.querySelector('.stage')!, { clientX: 112, clientY: 0 });
    window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1 }));

    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('abandons a drag on Escape instead of leaving it armed', async () => {
    const { handles, container, onChange } = editor();
    const stage = container.querySelector('.stage')!;
    const before = handles[0]!.style.left;

    press(handles[0]!);
    move(stage, { clientX: TWO_KEYS_ACROSS, clientY: 0 });
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await tick();

    expect(handles[0]!.style.left).toBe(before);

    window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1 }));
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('LayoutEditor - writing only what changed', () => {
  it('writes nothing when a click wobbles by a pixel', () => {
    // `moved` used to mean "a pointermove happened", not "the position
    // changed": a one-pixel twitch during a click persisted and broadcast a
    // configuration identical to the stored one.
    const { handles, container, onChange } = editor();
    const stage = container.querySelector('.stage')!;

    press(handles[0]!);
    move(stage, { clientX: 1, clientY: 1 });
    window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1 }));

    expect(onChange).not.toHaveBeenCalled();
  });

  it('writes once when the key really moved', () => {
    const { handles, container, onChange } = editor();
    const stage = container.querySelector('.stage')!;

    press(handles[0]!);
    move(stage, { clientX: TWO_KEYS_ACROSS, clientY: 0 });
    window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1 }));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0]![0].keys[0]).toMatchObject({ x: 2 });
  });
});

describe('LayoutEditor - the popover is a place you go, not one you fall into', () => {
  const isOpen = (container: Element) => container.querySelector('[role="dialog"]') !== null;

  it('selects on a plain click without opening anything', () => {
    // The mockup is explicit (spec §16.5): a click selects, and that is all.
    // Opening the editor on every click puts a panel over the layout being
    // arranged, which is what one is looking at.
    const { handles, container } = editor();

    handles[0]!.dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerId: 1 }),
    );
    window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1 }));

    expect(isOpen(container)).toBe(false);
  });

  it('opens on a double click', async () => {
    const { handles, container } = editor();

    handles[0]!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    await tick();

    expect(isOpen(container)).toBe(true);
  });

  it('opens on Enter, so the keyboard reaches it too', async () => {
    const { handles, container } = editor();

    handles[0]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await tick();

    expect(isOpen(container)).toBe(true);
  });

  it('opens on a right click, and swallows the native menu', async () => {
    const { handles, container } = editor();
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });

    handles[0]!.dispatchEvent(event);
    await tick();

    expect(isOpen(container)).toBe(true);
    expect(event.defaultPrevented).toBe(true);
  });

  it('hides while a key is dragged and comes back on the drop', async () => {
    const { handles, container } = editor();
    const stage = container.querySelector('.stage')!;

    handles[0]!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    await tick();

    press(handles[0]!);
    move(stage, { clientX: TWO_KEYS_ACROSS, clientY: 0 });
    await tick();
    // A panel that follows the key across the stage is unreadable, and one
    // that stays put covers where the key is going.
    expect(isOpen(container)).toBe(false);

    window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1 }));
    await tick();
    expect(isOpen(container)).toBe(true);
  });

  it('closes when the press lands on a key outside the selection', async () => {
    const { handles, container } = editor();

    handles[0]!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    await tick();

    press(handles[1]!);
    await tick();

    expect(isOpen(container)).toBe(false);
  });

  it('gives Escape the popover before the selection', async () => {
    // Two things to undo and one key to do it with. Clearing the selection
    // first would leave the popover anchored to nothing.
    const { handles, container } = editor();

    handles[0]!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    await tick();

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await tick();
    expect(isOpen(container)).toBe(false);
    expect(handles[0]!.getAttribute('aria-pressed')).toBe('true');

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await tick();
    expect(handles[0]!.getAttribute('aria-pressed')).toBe('false');
  });
});

describe('LayoutEditor - a customized key says so', () => {
  it('marks the keys that override something', () => {
    // Without it: you style one key, forget, and hunt months later for why it
    // does not react like the others (spec §8.2).
    const { handles } = editor(setKeyStyle(twoKeys(), [2], 'activeColor', '#ff0000'));

    expect(handles[0]!.classList.contains('overridden')).toBe(false);
    expect(handles[1]!.classList.contains('overridden')).toBe(true);
  });
});

describe('LayoutEditor - pressing nothing means nothing selected', () => {
  it('drops the selection when the press lands on bare stage', async () => {
    const { handles, canvas } = editor();

    press(handles[0]!);
    window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1 }));
    await tick();
    expect(handles[0]!.getAttribute('aria-pressed')).toBe('true');

    canvas.dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerId: 2 }),
    );
    await tick();

    expect(handles[0]!.getAttribute('aria-pressed')).toBe('false');
  });

  it('keeps the selection when the press lands on a key', async () => {
    // The handles are children of the stage, so an unguarded handler would
    // clear the selection on the way to every key it is meant to select.
    const { handles } = editor();

    press(handles[0]!);
    window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1 }));
    await tick();

    expect(handles[0]!.getAttribute('aria-pressed')).toBe('true');
  });

  it('closes the popover too', async () => {
    const { handles, container, canvas } = editor();

    handles[0]!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    await tick();

    canvas.dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerId: 2 }),
    );
    await tick();

    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });
});

describe('LayoutEditor - the popover belongs to one selection', () => {
  const isOpen = (container: Element) => container.querySelector('[role="dialog"]') !== null;

  it('stays closed after the selection is emptied and refilled', async () => {
    // The sidebar's "Delete N selected keys" empties `selectedIds` the same
    // way this Delete does. A boolean flag survived it, hidden behind an empty
    // selection — and the next Ctrl+A reopened a panel nobody had asked for.
    const { handles, container } = editor();

    handles[0]!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    await tick();
    expect(isOpen(container)).toBe(true);

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
    await tick();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true }));
    await tick();

    expect(isOpen(container)).toBe(false);
  });

  it('closes when the selection grows', async () => {
    const { handles, container } = editor();

    handles[0]!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    await tick();

    handles[1]!.dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerId: 3, shiftKey: true }),
    );
    await tick();

    expect(isOpen(container)).toBe(false);
  });
});

describe('LayoutEditor - a half-typed field is not thrown away', () => {
  // Each test targets one way of arming a gesture: the bare stage commits in
  // its own handler, but a drag or a resize hides the popover through `draft`
  // alone, and those two paths used to detach the field uncommitted.
  it('blurs the popover before taking it down', async () => {
    // The fields commit on `change`, which fires on blur — and blur is part of
    // the default action of a press elsewhere, so it happens after this
    // handler. Unmounting first detaches a focused input, which then fires
    // neither blur nor change, and the label just typed is lost.
    const { handles, container, canvas } = editor();

    handles[0]!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    await tick();

    const label = container.querySelector<HTMLInputElement>('input[name="label"]')!;
    label.focus();

    // Asserted on the event, not on `document.activeElement`: removing a
    // focused element already moves the focus elsewhere, so the obvious
    // assertion would have passed with or without the fix. Detaching the
    // input fires no blur at all, which is precisely the defect.
    const blurred = vi.fn();
    label.addEventListener('blur', blurred);

    canvas.dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerId: 4 }),
    );

    expect(blurred).toHaveBeenCalled();
  });

  it('blurs the popover when a drag starts on a key already selected', async () => {
    // Pressing a key inside the selection keeps the popover's subject, so the
    // selection branch commits nothing — yet the press still arms the draft,
    // which hides the popover and detaches the field mid-edit.
    const { handles, container } = editor();

    handles[0]!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    await tick();

    const label = container.querySelector<HTMLInputElement>('input[name="label"]')!;
    label.focus();
    const blurred = vi.fn();
    label.addEventListener('blur', blurred);

    press(handles[0]!);

    expect(blurred).toHaveBeenCalled();
  });

  it('blurs the popover when a resize starts on a grip', async () => {
    // The grip never touches the selection at all, so nothing on its path
    // committed the field — same hidden popover, same silent loss.
    const { handles, container } = editor();

    handles[0]!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    await tick();

    const label = container.querySelector<HTMLInputElement>('input[name="label"]')!;
    label.focus();
    const blurred = vi.fn();
    label.addEventListener('blur', blurred);

    const grip = container.querySelector<HTMLElement>('.grip')!;
    grip.setPointerCapture = () => {};
    press(grip);

    expect(blurred).toHaveBeenCalled();
  });
});

describe('LayoutEditor - lasso selection', () => {
  // jsdom gives every element a zero-origin bounding box, so a client
  // coordinate is a stage coordinate. One key is `DEFAULT_STYLE.unit` across.
  const HALF_KEY = DEFAULT_STYLE.unit / 2;

  const selected = (container: HTMLElement) =>
    [...container.querySelectorAll('button.handle')]
      .map((handle, index) => (handle.getAttribute('aria-pressed') === 'true' ? index + 1 : 0))
      .filter(Boolean);

  const marquee = (container: HTMLElement) => container.querySelector('.lasso');

  const release = () =>
    window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1 }));

  it('takes the keys the rectangle covers', async () => {
    const { container, canvas } = editor();

    press(canvas, from(1, 1));
    move(canvas, from(TWO_KEYS_ACROSS, HALF_KEY));
    await tick();

    expect(selected(container)).toEqual([1, 2]);
  });

  it('stops where the rectangle stops', async () => {
    const { container, canvas } = editor();

    press(canvas, from(1, 1));
    move(canvas, from(HALF_KEY, HALF_KEY));
    await tick();

    expect(selected(container)).toEqual([1]);
  });

  it('works drawn backwards, up and to the left', async () => {
    // Half of all lassos are. Left to a negative extent this selects nothing,
    // and the gesture appears to fail at random.
    const { container, canvas } = editor();

    press(canvas, from(HALF_KEY, HALF_KEY));
    move(canvas, from(1, 1));
    await tick();

    expect(selected(container)).toEqual([1]);
  });

  it('shows the rectangle while it is being drawn, and not after', async () => {
    const { container, canvas } = editor();

    press(canvas, from(1, 1));
    move(canvas, from(HALF_KEY, HALF_KEY));
    await tick();
    expect(marquee(container)).not.toBeNull();

    release();
    await tick();
    expect(marquee(container)).toBeNull();
  });

  it('draws the rectangle where the pointer is, not where the origin is', async () => {
    // The marquee is positioned in canvas pixels while the gesture is
    // measured in key coordinates, so it is the one place the translation has
    // to be applied twice — and forgetting the second one draws the rectangle
    // a whole surface away from the pointer.
    const { container, canvas } = editor();

    press(canvas, from(0, 0));
    move(canvas, from(HALF_KEY, HALF_KEY));
    await tick();

    expect(marquee(container)!.getAttribute('style')).toContain(`left: ${ORIGIN.x}px`);
  });

  it('adds to the selection when Shift is held, as Shift+click does', async () => {
    const { container, canvas, handles } = editor();

    press(handles[1]!);
    release();
    await tick();

    press(canvas, { ...from(1, 1), shiftKey: true });
    move(canvas, from(HALF_KEY, HALF_KEY));
    await tick();

    expect(selected(container)).toEqual([1, 2]);
  });

  it('still clears the selection on a press that goes nowhere', async () => {
    // The behaviour bare stage had before the lasso existed. A marquee of no
    // size must not become a way to keep a selection one clicked away from.
    const { container, canvas, handles } = editor();

    press(handles[0]!);
    release();
    await tick();
    expect(selected(container)).toEqual([1]);

    press(canvas, from(1, 1));
    release();
    await tick();

    expect(selected(container)).toEqual([]);
  });

  it('never starts from a key: pressing one drags it', async () => {
    const { container, canvas, handles } = editor();

    press(handles[0]!, from(1, 1));
    move(canvas, from(HALF_KEY, HALF_KEY));
    await tick();

    expect(marquee(container)).toBeNull();
  });

  it('takes the rectangle away with the gesture on Escape', async () => {
    const { container, canvas } = editor();

    press(canvas, from(1, 1));
    move(canvas, from(TWO_KEYS_ACROSS, HALF_KEY));
    await tick();

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await tick();

    expect(marquee(container)).toBeNull();
    expect(selected(container)).toEqual([]);
  });

  it('drops the rectangle when the release happened out of sight', async () => {
    // Same failure the drag has: a pointerup outside the window leaves the
    // marquee following the mouse with nothing held down.
    const { container, canvas } = editor();

    press(canvas, from(1, 1));
    move(canvas, { ...from(HALF_KEY, HALF_KEY), buttons: 0 });
    await tick();

    expect(marquee(container)).toBeNull();
  });
});

describe('LayoutEditor - the size OBS has to be told', () => {
  it('quotes the packed size, not the room the keys are drawn in', async () => {
    // OBS fixes a browser source's size once and never revises it. The figure
    // that matters is the one the overlay actually needs — the packed box —
    // and the editor's own stage is nothing like it.
    const config = twoKeys();
    config.keys[0]!.x = 3;
    config.keys[1]!.x = 4;
    const { container } = editor(config);

    const line = container.querySelector('.source code')!;

    expect(line.textContent).toContain(String(2 * DEFAULT_STYLE.unit));
  });

  it('says nothing at all before there is a layout to size', async () => {
    const { container } = editor(defaultConfig());

    expect(container.querySelector('.source')).toBeNull();
  });

  it('follows the drag, so the figure moves with the layout', async () => {
    const { container, handles } = editor();
    const before = container.querySelector('.source code')!.textContent;

    press(handles[0]!, { clientX: 0, clientY: 0 });
    move(container.querySelector('.stage')!, { clientX: 0, clientY: TWO_KEYS_ACROSS });
    await tick();

    expect(container.querySelector('.source code')!.textContent).not.toBe(before);
  });
});

describe('LayoutEditor - the stage tells the editor its own size', () => {
  // The stage changes height without the window changing size, and this page
  // has two ways of doing it: the warning about a second capture page takes a
  // whole header line, the unsupported-browser banner is full width. Measured
  // once at mount, `surfaceOf(stageBox)` would go on describing a strip that
  // has been taken away — and that surface is what says whether a key is still
  // reachable at all, the stage having no scrollbar to go and find it.
  it('re-measures when the stage changes size, with no window resize', async () => {
    const { container } = editor();
    const handle = container.querySelector<HTMLElement>('button.handle')!;
    const before = handle.style.top;

    laidOut({ width: STAGE.width, height: STAGE.height - 240 });
    // Non-zero, or the component observed nothing and the assertion below would
    // be measuring the stub rather than the editor.
    expect(resized()).toBeGreaterThan(0);
    await tick();

    expect(handle.style.top).not.toBe(before);
  });
});

describe('LayoutEditor - the stage does not scroll', () => {
  // It gained `overflow: auto` in milestone 4 and lost it again to task 31,
  // when the work surface moved into the coordinates. The pointer conversion
  // went on adding `scrollLeft` for a day after that — a branch that reads zero
  // in every browser, kept alive by the test that used to live here, which
  // assigned `stage.scrollLeft` by hand. jsdom accepts that on a non-scrolling
  // element; nothing else in the world produces it.
  const lassoWith = async (scrollLeft: number) => {
    const { container, canvas, stage } = editor();
    stage.scrollLeft = scrollLeft;

    press(canvas, from(1, 1));
    move(canvas, from(TWO_KEYS_ACROSS, DEFAULT_STYLE.unit / 2));
    await tick();

    return [...container.querySelectorAll('button.handle')].map((handle) =>
      handle.getAttribute('aria-pressed'),
    );
  };

  it('reads the pointer from the visible box, whatever scrollLeft says', async () => {
    const still = await lassoWith(0);
    const scrolled = await lassoWith(ORIGIN.x + DEFAULT_STYLE.unit);

    // Non-trivial first: a gesture that selects nothing would make the
    // comparison below true for the wrong reason.
    expect(still).toContain('true');
    expect(scrolled).toEqual(still);
  });
});

describe('LayoutEditor - the drawing and the handles agree', () => {
  it('puts the first key where its handle is', () => {
    // The SVG is translated onto the canvas while the handles are positioned
    // from the same origin: two conversions of the same coordinate, and if
    // either forgets the constant they drift apart by a whole surface —
    // handles floating over empty space, keys nobody can grab.
    const { container, handles } = editor();
    const rect = container.querySelector('svg rect')!;

    expect(rect.getAttribute('x')).toBe(`${ORIGIN.x + DEFAULT_STYLE.gap / 2}`);
    expect(handles[0]!.style.left).toBe(`${ORIGIN.x + DEFAULT_STYLE.gap / 2}px`);
  });

  it('never sizes the canvas from the measurement it took of the stage', () => {
    // A pixel size here is a feedback loop: `clientWidth` is rounded to a
    // whole pixel, so at 90 % zoom the canvas came out half a pixel wider
    // than the box it sits in, and both scrollbars appeared. Read from the
    // source because jsdom resolves neither Svelte's scoped styles nor any
    // layout: the assertion is that the rule exists, which is the whole fix.
    const { canvas } = editor();

    expect(canvas.style.width).toBe('');
    expect(canvas.style.height).toBe('');
    expect(editorSource).toMatch(/\.canvas\s*\{[^}]*inline-size:\s*100%/);
    expect(editorSource).toMatch(/\.canvas\s*\{[^}]*block-size:\s*100%/);
  });

  it('never scrolls, so the surface really is everything there is', () => {
    // `surfaceOf` makes one promise: the edge of the work surface is the edge
    // of the screen. A scrollbar was the exception that broke it — with one,
    // "off the surface" stopped meaning "out of sight", and every pointer
    // coordinate depended on how far someone had happened to scroll. Read from
    // the source, like the canvas rule above: jsdom resolves no styles.
    expect(editorSource).toMatch(/\.stage\s*\{[^}]*overflow:\s*hidden/);
  });

  it('measures again when the window changes size', async () => {
    // The surface *is* the stage, so a window that changed size and a surface
    // that did not means an origin off centre and a boundary in the wrong
    // place — keys clamped against an edge that is no longer there.
    const { handles } = editor();
    const wider = { width: STAGE.width + 720, height: STAGE.height };

    laidOut(wider);
    window.dispatchEvent(new Event('resize'));
    await tick();

    const origin = -surfaceOf(wider, DEFAULT_STYLE.unit).x * DEFAULT_STYLE.unit;
    expect(handles[0]!.style.left).toBe(`${origin + DEFAULT_STYLE.gap / 2}px`);
  });

  it('measures its own stage rather than waiting to be told', async () => {
    // Rendered without a `stageBox`, so the only way the origin can land in
    // the middle is if the editor measured the stage itself. Everywhere else
    // the box is passed in, which would let this go untested.
    laidOut(STAGE);
    const view = render(LayoutEditor, {
      props: {
        config: twoKeys(),
        frame: [],
        selectedIds: [],
        onChange: vi.fn(),
        storage: { getItem: () => null, setItem: () => {} },
      },
    });
    await tick();

    const handle = view.container.querySelector<HTMLElement>('button.handle')!;
    expect(handle.style.left).toBe(`${ORIGIN.x + DEFAULT_STYLE.gap / 2}px`);
  });
});

describe('LayoutEditor - the popover stays inside the stage', () => {
  it('slides the popover left rather than off the right edge', async () => {
    // Anchored to a key near the edge, a 284 px panel ran outside the visible
    // stage — and instead of the panel moving, a horizontal scrollbar
    // appeared and half the controls sat off-screen.
    const config = twoKeys();
    config.keys[1]!.x = 8;
    const { container, handles } = editor(config);

    handles[1]!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    await tick();

    const left = Number.parseFloat(container.querySelector<HTMLElement>('.anchor')!.style.left);
    expect(left).toBeLessThan(ORIGIN.x + 8 * DEFAULT_STYLE.unit);
    expect(left + 284).toBeLessThanOrEqual(STAGE.width);
  });

  it('leaves a popover that already fits exactly where the key is', async () => {
    const { container, handles } = editor();

    handles[1]!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    await tick();

    expect(container.querySelector<HTMLElement>('.anchor')!.style.left).toBe(
      `${ORIGIN.x + DEFAULT_STYLE.unit}px`,
    );
  });

  /**
   * The panel's height, stubbed on the prototype.
   *
   * `offsetHeight` rather than `clientHeight`, which `laidOut` already uses
   * for the stage: two measurements that must stay independent, or a test
   * could not give the stage one size and the panel another.
   */
  const tall = (height: number) =>
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
      value: height,
      configurable: true,
    });

  afterEach(() => Reflect.deleteProperty(HTMLElement.prototype, 'offsetHeight'));

  /** In key units, from the top of the stage. */
  const openAt = async (y: number, height: number) => {
    const config = twoKeys();
    config.keys[0]!.y = y;
    const { container, handles } = editor(config);
    tall(height);

    handles[0]!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    await tick();
    // A second flush: the height is measured after the panel is in the
    // document, and the anchor only moves on the render that follows.
    await tick();

    return Number.parseFloat(container.querySelector<HTMLElement>('.anchor')!.style.top);
  };

  it('stays below the selection when there is room for it there', async () => {
    const below = ORIGIN.y + DEFAULT_STYLE.unit + DEFAULT_STYLE.gap;

    expect(await openAt(0, 200)).toBe(below);
  });

  it('flips above the selection rather than off the bottom edge', async () => {
    // The vertical half of the defect fixed sideways at milestone 6, and the
    // reason it needed its own answer: the panel's width is a token, its
    // height is whatever its contents come to.
    const key = { y: 4, height: 300 };
    const above = ORIGIN.y + key.y * DEFAULT_STYLE.unit - DEFAULT_STYLE.gap - key.height;

    expect(await openAt(key.y, key.height)).toBe(above);
  });

  it('pins the popover to the top when it fits neither above nor below', async () => {
    // Half a panel on screen beats none, and the half worth keeping is the
    // header — so it is the top edge it is pinned to, never the bottom.
    expect(await openAt(4, 700)).toBe(STAGE.height - 700);
    // Taller than the stage itself, where pinning the bottom edge would put
    // the whole panel above the top of the screen.
    expect(await openAt(4, STAGE.height + 80)).toBe(0);
  });

  it('measures the panel again when its contents change', async () => {
    // Its height is not fixed: accepting the axis suggestion takes a row away,
    // the Style fold adds five, the icon grid two. The last two are held
    // *inside* the panel, so no prop of this component changes when they do —
    // which is why the height is observed rather than re-read on a prop, and
    // why the trigger here is a resize notification rather than a rerender.
    let height = 200;
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
      get: () => height,
      configurable: true,
    });

    const config = twoKeys();
    config.keys[0]!.y = 4;
    const { container, handles } = editor(config);
    handles[0]!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    await tick();
    await tick();

    const anchor = container.querySelector<HTMLElement>('.anchor')!;
    const before = anchor.style.top;

    height = 60;
    // Non-zero, so a component that observed nothing fails here rather than
    // passing on the measurement it happened to take at mount.
    expect(resized()).toBeGreaterThan(0);
    await tick();

    expect(anchor.style.top).not.toBe(before);
    expect(anchor.style.top).toBe(
      `${ORIGIN.y + 4 * DEFAULT_STYLE.unit - DEFAULT_STYLE.gap - 60}px`,
    );
  });

  it('leaves the anchor alone while the panel has not been measured', async () => {
    // The first frame, before the panel is in the document — and jsdom, for
    // ever. With no height there is no telling whether it fits, and moving it
    // by an unmeasured amount is worse than leaving it under the key.
    const config = twoKeys();
    config.keys[0]!.y = 4;
    const { container, handles } = editor(config);

    handles[0]!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    await tick();
    await tick();

    const top = container.querySelector<HTMLElement>('.anchor')!.style.top;
    expect(top).toBe(`${ORIGIN.y + 5 * DEFAULT_STYLE.unit + DEFAULT_STYLE.gap}px`);
  });
});

describe('LayoutEditor - resizing a key by its edge', () => {
  const grips = (container: HTMLElement) => [...container.querySelectorAll('.grip')];
  const grip = (container: HTMLElement, edge: string) =>
    container.querySelector<HTMLElement>(`.grip[data-edge="${edge}"]`)!;

  const written = (onChange: ReturnType<typeof vi.fn>) =>
    (onChange.mock.calls[0]![0] as OverlayConfig).keys[0]!;

  it('offers nothing until exactly one key is selected', () => {
    // The same rule as the Position fields: a handle pulled on a group would
    // have to mean something for every key in it, and giving them all one size
    // is not what pulling an edge looks like.
    expect(grips(editor().container)).toHaveLength(0);
    expect(grips(editor(twoKeys(), STAGE, [1, 2]).container)).toHaveLength(0);
  });

  it('offers eight of them on the one selected key', () => {
    expect(grips(editor(twoKeys(), STAGE, [1]).container)).toHaveLength(8);
  });

  it('widens the key on a drag of its right edge, and writes once', () => {
    const { container, onChange } = editor(twoKeys(), STAGE, [1]);

    press(grip(container, 'e'), { clientX: 0, clientY: 0 });
    move(container.querySelector('.stage')!, { clientX: TWO_KEYS_ACROSS, clientY: 0 });
    window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1 }));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(written(onChange)).toMatchObject({ x: 0, w: 3 });
  });

  it('never arms a move from a grip: the key stays where it is', () => {
    // The grip sits on top of the key's own handle, so without a
    // `stopPropagation` the press would start both gestures at once — the key
    // sliding under the pointer while its edge is being pulled.
    const { container, onChange } = editor(twoKeys(), STAGE, [1]);

    press(grip(container, 'e'), { clientX: 0, clientY: 0 });
    move(container.querySelector('.stage')!, { clientX: DEFAULT_STYLE.unit, clientY: 0 });
    window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1 }));

    expect(written(onChange)).toMatchObject({ x: 0, y: 0, w: 2 });
  });

  it('moves the position too when the left edge is the one pulled', () => {
    const { container, onChange } = editor(twoKeys(), STAGE, [1]);

    press(grip(container, 'w'), { clientX: 0, clientY: 0 });
    move(container.querySelector('.stage')!, { clientX: -DEFAULT_STYLE.unit, clientY: 0 });
    window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1 }));

    expect(written(onChange)).toMatchObject({ x: -1, w: 2 });
  });

  it('writes nothing when the gesture changed no size', () => {
    const { container, onChange } = editor(twoKeys(), STAGE, [1]);

    press(grip(container, 'e'), { clientX: 0, clientY: 0 });
    move(container.querySelector('.stage')!, { clientX: 1, clientY: 0 });
    window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1 }));

    expect(onChange).not.toHaveBeenCalled();
  });

  it('abandons a resize on Escape instead of leaving it armed', async () => {
    const { container, onChange, handles } = editor(twoKeys(), STAGE, [1]);
    const before = handles[0]!.style.width;

    press(grip(container, 'e'), { clientX: 0, clientY: 0 });
    move(container.querySelector('.stage')!, { clientX: TWO_KEYS_ACROSS, clientY: 0 });
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await tick();

    expect(handles[0]!.style.width).toBe(before);

    window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1 }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('stops resizing when the button is no longer held', async () => {
    const { container, handles } = editor(twoKeys(), STAGE, [1]);
    const before = handles[0]!.style.width;

    press(grip(container, 'e'), { clientX: 0, clientY: 0 });
    move(container.querySelector('.stage')!, { clientX: TWO_KEYS_ACROSS, buttons: 0 });
    await tick();

    expect(handles[0]!.style.width).toBe(before);
  });

  it('ignores a right-click on a grip, which the context menu would swallow', () => {
    // The same trap as the drag: the release is eaten by the menu, and the
    // gesture stays armed on plain mouse movement afterwards.
    const { container, onChange } = editor(twoKeys(), STAGE, [1]);

    press(grip(container, 'e'), { button: 2, clientX: 0, clientY: 0 });
    move(container.querySelector('.stage')!, { clientX: TWO_KEYS_ACROSS, clientY: 0 });
    window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1 }));

    expect(onChange).not.toHaveBeenCalled();
  });

  it('shows the new size while the edge is being pulled', async () => {
    // The draft, like a drag: waiting for the release to see the size would
    // make the gesture something one aims blind.
    const { container, handles } = editor(twoKeys(), STAGE, [1]);

    press(grip(container, 'e'), { clientX: 0, clientY: 0 });
    move(container.querySelector('.stage')!, { clientX: DEFAULT_STYLE.unit, clientY: 0 });
    await tick();

    expect(handles[0]!.style.width).toBe(`${2 * DEFAULT_STYLE.unit - DEFAULT_STYLE.gap}px`);
  });
});

describe('LayoutEditor - the outlines follow the key they outline', () => {
  it('rounds a handle by the radius its key is drawn with', () => {
    // The handle carries the hover outline and the selection halo, and it sits
    // exactly on the key's own box — so a fixed 4 px left both drawn squarer
    // than the key they belong to, and visibly beside it at any larger radius.
    const config = twoKeys();
    config.style.radius = 17;

    const { handles } = editor(config);

    expect(handles[0]!.style.borderRadius).toBe('17px');
  });

  it('follows a radius overridden on the key alone', () => {
    const config = setKeyStyle(twoKeys(), [1], 'radius', 11);

    const { handles } = editor(config);

    expect(handles[0]!.style.borderRadius).toBe('11px');
    expect(handles[1]!.style.borderRadius).toBe(`${DEFAULT_STYLE.radius}px`);
  });
});

describe('LayoutEditor - the popover takes the focus and gives it back', () => {
  const anchor = (container: Element) => container.querySelector('.anchor')!;

  it('moves the focus into the popover when it opens', async () => {
    // Without this, someone who pressed Enter on a handle keeps their focus on
    // that handle and has to tab through every other key in the layout before
    // reaching the fields they just asked for — and a screen reader announces
    // nothing at all about the dialog that appeared.
    const { handles, container } = editor();

    handles[0]!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    await tick();

    expect(anchor(container).contains(document.activeElement)).toBe(true);
  });

  it('moves it on Enter too, the path that is all keyboard', async () => {
    const { handles, container } = editor();

    handles[0]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await tick();

    expect(anchor(container).contains(document.activeElement)).toBe(true);
  });

  it('does not steal the focus back when the popover returns after a drag', async () => {
    // The panel coming back is a side effect of the drop, not a request to
    // edit: the hand is on the pointer, and nothing should tear the focus
    // away from where the browser put it.
    const { handles, container } = editor();

    handles[0]!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    await tick();

    press(handles[0]!);
    move(container.querySelector('.stage')!, { clientX: TWO_KEYS_ACROSS, clientY: 0 });
    await tick();
    window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1 }));
    await tick();

    expect(anchor(container).contains(document.activeElement)).toBe(false);
  });

  it('returns the focus to the key handle on Escape', async () => {
    // Unmounting a dialog that holds the focus drops it on <body>: the next
    // Tab starts from the top of the page, nowhere near the key being edited.
    const { handles, container } = editor();

    handles[0]!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    await tick();

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    // Two flushes: closePopover waits a tick of its own before it moves the
    // focus, so the assertion has to sit one flush behind it.
    await tick();
    await tick();

    expect(document.activeElement).toBe(handles[0]);
  });

  it('keeps the focus in the editor after the popover deletes its keys', async () => {
    // The handle the focus would return to may no longer exist — the popover
    // just deleted it. Wherever the focus lands, it must land inside the
    // editor, never on a detached node or <body>.
    const { handles, container } = editor();

    handles[0]!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    await tick();

    container.querySelector<HTMLElement>('[data-delete]')!.click();
    // Same two flushes as the Escape test above: the focus moves one tick
    // after the dialog goes.
    await tick();
    await tick();

    expect(document.activeElement === document.body).toBe(false);
    expect(container.contains(document.activeElement)).toBe(true);
  });
});
