import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/svelte';
import { tick } from 'svelte';
import KeyPopover from './KeyPopover.svelte';
import popoverSource from './KeyPopover.svelte?raw';
import { setKeyLabel, setKeyStyle } from '../config/edit';
import { DEFAULT_STYLE, defaultConfig, type OverlayConfig } from '../config/schema';
import { surfaceOf } from './layout';

afterEach(cleanup);

/** A stage of 1440 × 720 at the default unit: 20 × 10 key units. */
const SURFACE = surfaceOf({ width: 1440, height: 720 }, DEFAULT_STYLE.unit);

function twoKeys(): OverlayConfig {
  const config = defaultConfig();
  config.keys.push(
    { id: 1, usage: 0x14, mode: 'key', label: 'A', x: 0, y: 0, w: 1, h: 1 },
    { id: 2, usage: 0x16, mode: 'key', label: 'S', x: 1, y: 0, w: 1, h: 1 },
  );
  return config;
}

/** The fold inside remembers its state, and reaches for nothing. */
const memory = (initial: Record<string, string> = {}) => {
  const held = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => held.get(k) ?? null,
    setItem: (k: string, v: string) => void held.set(k, v),
  };
};

/**
 * The Style block, already unfolded.
 *
 * It is shut on a first run — the test below holds that — and a shut fold
 * renders nothing at all, so every test that reads a row starts from someone
 * who has opened it once.
 */
const unfolded = () => memory({ 'he-overlay:open:key-style': '1' });

function popover(config = twoKeys(), selectedIds = [1]) {
  const onChange = vi.fn();
  const onClose = vi.fn();
  return {
    ...render(KeyPopover, {
      props: { config, selectedIds, surface: SURFACE, onChange, onClose, storage: unfolded() },
    }),
    onChange,
    onClose,
    config,
  };
}

const change = (input: HTMLInputElement, value: string) => {
  input.value = value;
  input.dispatchEvent(new Event('change', { bubbles: true }));
};

const reset = (container: Element) =>
  container.querySelector<HTMLButtonElement>('button[data-reset="activeColor"]');

describe('KeyPopover', () => {
  it('overrides the active colour of the selection only', () => {
    const { container, onChange } = popover();

    change(container.querySelector<HTMLInputElement>('input[name="activeColor"]')!, '#ff0000');

    const next = onChange.mock.calls[0]![0];
    expect(next.keys[0].style).toEqual({ activeColor: '#ff0000' });
    expect(next.keys[1].style).toBeUndefined();
    expect(next.style.activeColor).toBe(defaultConfig().style.activeColor);
  });

  it('overrides a whole group in one gesture', () => {
    const { container, onChange } = popover(twoKeys(), [1, 2]);

    change(container.querySelector<HTMLInputElement>('input[name="activeColor"]')!, '#ff0000');

    expect(onChange.mock.calls[0]![0].keys.map((k: { style?: unknown }) => k.style)).toEqual([
      { activeColor: '#ff0000' },
      { activeColor: '#ff0000' },
    ]);
  });

  it('offers no way back to the global on a key that inherits', () => {
    // The button is the override marker as much as it is a control: offering
    // it unconditionally says every key is customized, which is the confusion
    // the markers exist to prevent (spec §8.2).
    const { container } = popover();

    expect(reset(container)).toBeNull();
  });

  it('offers the way back once the key overrides', () => {
    const { container } = popover(setKeyStyle(twoKeys(), [1], 'activeColor', '#ff0000'));

    expect(reset(container)).not.toBeNull();
  });

  it('returns the key to inheritance', () => {
    const { container, onChange } = popover(setKeyStyle(twoKeys(), [1], 'activeColor', '#ff0000'));

    reset(container)!.click();

    expect(onChange.mock.calls[0]![0].keys[0].style).toBeUndefined();
  });

  it('switches the selection to axis mode', () => {
    const { container, onChange } = popover(twoKeys(), [1, 2]);

    container.querySelector<HTMLButtonElement>('button[data-mode="axis"]')!.click();

    expect(onChange.mock.calls[0]![0].keys.map((k: { mode: string }) => k.mode)).toEqual([
      'axis',
      'axis',
    ]);
  });

  it('renames a single key', () => {
    const { container, onChange } = popover();

    change(container.querySelector<HTMLInputElement>('input[name="label"]')!, 'Sprint');

    expect(onChange.mock.calls[0]![0].keys[0].label).toBe('Sprint');
  });

  it('offers no label field on a group', () => {
    // A label is individual by nature, and a group field would have to either
    // overwrite two names with one or show nothing useful.
    const { container } = popover(twoKeys(), [1, 2]);

    expect(container.querySelector('input[name="label"]')).toBeNull();
  });

  it('deletes the selection and closes', () => {
    const { container, onChange, onClose } = popover(twoKeys(), [1, 2]);

    container.querySelector<HTMLButtonElement>('button[data-delete]')!.click();

    expect(onChange.mock.calls[0]![0].keys).toEqual([]);
    // Left open, it would anchor to a selection that no longer exists.
    expect(onClose).toHaveBeenCalled();
  });

  it('says how many keys it speaks for', () => {
    const { container } = popover(twoKeys(), [1, 2]);

    expect(container.textContent).toContain('2 keys');
  });
});

describe('KeyPopover - fine adjustment', () => {
  it('moves a key by typed coordinates', () => {
    // Spec §8.7: drag alone stops being enough the moment two keys have to
    // line up exactly.
    const { container, onChange } = popover();

    change(container.querySelector<HTMLInputElement>('input[name="x"]')!, '2.5');

    expect(onChange.mock.calls[0]![0].keys[0]).toMatchObject({ x: 2.5, y: 0 });
  });

  it('puts an emptied coordinate back instead of teleporting the key', () => {
    // `+''` is 0: clearing X to retype it used to move the key to the origin,
    // persist it and broadcast it, on the blur.
    const { container, onChange } = popover();
    const x = container.querySelector<HTMLInputElement>('input[name="x"]')!;

    change(x, '');

    expect(onChange).not.toHaveBeenCalled();
    expect(x.value).toBe('0');
  });

  it('offers no position field on a group', () => {
    const { container } = popover(twoKeys(), [1, 2]);

    expect(container.querySelector('input[name="x"]')).toBeNull();
    expect(container.querySelector('input[name="width"]')).not.toBeNull();
  });

  it('resizes the whole selection', () => {
    const { container, onChange } = popover(twoKeys(), [1, 2]);

    change(container.querySelector<HTMLInputElement>('input[name="width"]')!, '2');

    expect(onChange.mock.calls[0]![0].keys.map((k: { w: number }) => k.w)).toEqual([2, 2]);
  });
});

describe('KeyPopover - the axis suggestion', () => {
  const suggested = (config = twoKeys(), selectedIds = [1]) => {
    const onChange = vi.fn();
    const onDismissSuggestion = vi.fn();
    const view = render(KeyPopover, {
      props: {
        config,
        selectedIds,
        surface: SURFACE,
        onChange,
        onClose: vi.fn(),
        storage: memory(),
        suggestAxis: true,
        onDismissSuggestion,
      },
    });
    return { ...view, onChange, onDismissSuggestion };
  };

  it('says nothing unless asked to', () => {
    const { container } = popover();

    expect(container.querySelector('[data-suggestion]')).toBeNull();
  });

  it('describes what was observed, not a mapping it cannot know', () => {
    // The keyboard says a key travelled and never fired. It does not say the
    // key is bound to a stick, and nothing on this side can find out
    // (spec §7.4).
    const { container } = suggested();

    expect(container.querySelector('[data-suggestion]')!.textContent).toContain(
      'does not send a keystroke',
    );
  });

  it('switches the mode when accepted', () => {
    const { container, onChange } = suggested();

    container.querySelector<HTMLButtonElement>('button[data-accept-suggestion]')!.click();

    expect(onChange.mock.calls[0]![0].keys[0].mode).toBe('axis');
  });

  it('changes nothing when declined', () => {
    // A suggestion, never a switch: declining has to leave the configuration
    // exactly as it was.
    const { container, onChange, onDismissSuggestion } = suggested();

    container.querySelector<HTMLButtonElement>('button[data-dismiss-suggestion]')!.click();

    expect(onDismissSuggestion).toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });
  it('says nothing to a key that is already an axis', () => {
    // Seen on air: a key switched to axis still offered "Show as axis", right
    // under a toggle already reading Axis. The suggester answers "this key
    // never fires", which stays true forever — it is the popover's job to
    // notice the advice has been taken.
    const axis = twoKeys();
    axis.keys[0]!.mode = 'axis';

    const { container } = suggested(axis);

    expect(container.querySelector('[data-suggestion]')).toBeNull();
  });
});

describe('KeyPopover - going back to the detected label', () => {
  const AZERTY = new Map([['KeyQ', 'a']]);

  const withLayout = (config: OverlayConfig, layout: Map<string, string> | null) => {
    const onChange = vi.fn();
    const view = render(KeyPopover, {
      props: {
        config,
        selectedIds: [1],
        surface: SURFACE,
        onChange,
        onClose: vi.fn(),
        storage: memory(),
        layout,
      },
    });
    return { ...view, onChange };
  };

  const resetLabel = (container: Element) =>
    container.querySelector<HTMLButtonElement>('button[data-reset="label"]');

  it('offers nothing while the label is the detected one', () => {
    const config = twoKeys();
    config.keys[0]!.label = 'A';

    expect(resetLabel(withLayout(config, AZERTY).container)).toBeNull();
  });

  it('offers the way back once the key has been renamed', () => {
    const renamed = setKeyLabel(twoKeys(), 1, 'Sprint');

    expect(resetLabel(withLayout(renamed, AZERTY).container)).not.toBeNull();
  });

  it('puts the detected label back', () => {
    const renamed = setKeyLabel(twoKeys(), 1, 'Sprint');
    const { container, onChange } = withLayout(renamed, AZERTY);

    resetLabel(container)!.click();

    expect(onChange.mock.calls[0]![0].keys[0].label).toBe('A');
  });

  it('offers nothing when no layout was detected', () => {
    // There is nothing to go back to, and the position name it would produce
    // is worse than whatever the user typed.
    const renamed = setKeyLabel(twoKeys(), 1, 'Sprint');

    expect(resetLabel(withLayout(renamed, null).container)).toBeNull();
  });
});

describe('the width the editor is told about', () => {
  it('measures the whole panel, padding and border included', () => {
    // The editor clamps the popover against the right edge of the stage using
    // `--he-popover-width`. Without `box-sizing: border-box` that token is the
    // *content* box and the panel really occupies 312 px — so it kept
    // overflowing by exactly the padding, and the stage grew a scrollbar.
    //
    // Read from the source, because jsdom applies no layout and does not
    // resolve Svelte's injected scoped styles: `getComputedStyle` answers
    // "content-box" here whatever the component declares.
    const rule = popoverSource.slice(
      popoverSource.indexOf('.popover {'),
      popoverSource.indexOf('}', popoverSource.indexOf('.popover {')),
    );

    expect(rule).toContain('box-sizing: border-box');
    expect(rule).toContain('--he-popover-width');
  });
});

describe('KeyPopover - the Style block', () => {
  const row = (c: Element, property: string) =>
    c.querySelector<HTMLElement>(`[data-style-row="${property}"]`)!;
  const swatch = (c: Element, property: string) =>
    row(c, property).querySelector<HTMLInputElement>('input')!;
  const marker = (c: Element, property: string) =>
    row(c, property).querySelector<HTMLElement>('[data-marker]');

  it('overrides the travel fill, which nothing could reach before', () => {
    // `KeyStyle` has carried nine properties since task 13 and the popover
    // offered one of them. The model, the resolution, the broadcast and the
    // storage could all do this; only the interface never asked (spec §8.2).
    const { container, onChange } = popover();

    change(swatch(container, 'fillColor'), '#123456');

    expect(onChange.mock.calls[0]![0].keys[0].style).toEqual({ fillColor: '#123456' });
  });

  it('overrides the rest colour', () => {
    const { container, onChange } = popover();

    change(swatch(container, 'restColor'), '#0a0b0c');

    expect(onChange.mock.calls[0]![0].keys[0].style).toEqual({ restColor: '#0a0b0c' });
  });

  it('overrides the radius, because a round key in a square block is a layout intent', () => {
    const { container, onChange } = popover();

    change(swatch(container, 'radius'), '11');

    expect(onChange.mock.calls[0]![0].keys[0].style).toEqual({ radius: 11 });
  });

  it('refuses an empty radius rather than reading it as zero', () => {
    // `+''` is 0, so a field cleared to be retyped would square the key and
    // broadcast it — the defect the size fields already guard against.
    const { container, onChange } = popover();

    change(swatch(container, 'radius'), '');

    expect(onChange).not.toHaveBeenCalled();
  });

  it('marks the overridden lines and says nothing about the others', () => {
    // A column of six labels reading `global` is six statements that nothing
    // has happened. Only the exception is worth a mark, and the mark is the
    // same amber dot the rest of the page uses for "customized".
    const { container } = popover(setKeyStyle(twoKeys(), [1], 'fillColor', '#123456'));

    expect(marker(container, 'fillColor')).not.toBeNull();
    expect(marker(container, 'restColor')).toBeNull();
    expect(marker(container, 'activeColor')).toBeNull();
  });

  it('counts the overrides in the header of the fold', () => {
    // What a fold hides has to be readable while it is shut (spec §9.3).
    const twice = setKeyStyle(
      setKeyStyle(twoKeys(), [1], 'fillColor', '#123456'),
      [1],
      'radius',
      9,
    );

    expect(popover(twice).container.querySelector('summary')!.textContent).toContain('2 override');
  });

  it('hands every override back in one gesture', () => {
    const twice = setKeyStyle(
      setKeyStyle(twoKeys(), [1], 'fillColor', '#123456'),
      [1],
      'radius',
      9,
    );
    const { container, onChange } = popover(twice);

    container.querySelector<HTMLButtonElement>('[data-reset-all]')!.click();

    // One write, so one undo — and the bag is dropped, not left empty.
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0]![0].keys[0].style).toBeUndefined();
  });

  it('hands one line back from its own marker', () => {
    // The mark is next to the name, and it is also the way back for that line:
    // it keeps what the single-property reset could do before this block
    // existed — return one value without returning the four beside it — and
    // the dot is exactly where one would click to undo it.
    const twice = setKeyStyle(
      setKeyStyle(twoKeys(), [1], 'fillColor', '#123456'),
      [1],
      'radius',
      9,
    );
    const { container, onChange } = popover(twice);

    marker(container, 'radius')!.click();

    expect(onChange.mock.calls[0]![0].keys[0].style).toEqual({ fillColor: '#123456' });
  });

  it('keeps the fill direction inside the block, where the lot puts it', () => {
    const { container, onChange } = popover();

    row(container, 'fillDirection')
      .querySelector<HTMLButtonElement>('[data-direction="left"]')!
      .click();

    expect(onChange.mock.calls[0]![0].keys[0].style).toEqual({ fillDirection: 'left' });
  });
});

describe('KeyPopover - the Style block is shut on a first run', () => {
  it('starts folded, unlike the global panel', () => {
    // The two are not the same case. The global panel's contents *is* what one
    // opened the section for; a per-key override is by definition the
    // exception, and the popover's height is load-bearing — it flips above the
    // selection, or pins to the top, when it does not fit under its key.
    // Nothing is hidden by closing it: the header counts the overrides.
    const { container } = render(KeyPopover, {
      props: {
        config: twoKeys(),
        selectedIds: [1],
        surface: SURFACE,
        onChange: vi.fn(),
        onClose: vi.fn(),
        storage: memory(),
      },
    });

    expect(container.querySelector('details')!.open).toBe(false);
    expect(container.querySelector('[data-style-row="fillColor"]')).toBeNull();
  });
});

describe('KeyPopover - text or icon', () => {
  const AZERTY = new Map([['KeyQ', 'a']]);

  const withLayout = (config: OverlayConfig, selectedIds = [1]) => {
    const onChange = vi.fn();
    const view = render(KeyPopover, {
      props: {
        config,
        selectedIds,
        surface: SURFACE,
        onChange,
        onClose: vi.fn(),
        storage: memory(),
        layout: AZERTY,
      },
    });
    return { ...view, onChange };
  };

  const kind = (container: Element, value: 'text' | 'icon') =>
    container.querySelector<HTMLButtonElement>(`button[data-label-kind="${value}"]`)!;
  const icons = (container: Element) => [
    ...container.querySelectorAll<HTMLButtonElement>('button[aria-label^="Icon "]'),
  ];

  /** Enter, which the twelve cover, learned as its glyph. */
  const withEnter = (label = '⏎') => {
    const config = twoKeys();
    config.keys.push({ id: 3, usage: 0x28, mode: 'key', label, x: 2, y: 0, w: 1, h: 1 });
    return config;
  };

  it('shows the text field on a key wearing a name', () => {
    const { container } = withLayout(twoKeys());

    expect(container.querySelector('#key-label-text')).not.toBeNull();
    expect(icons(container)).toHaveLength(0);
    expect(kind(container, 'text').getAttribute('aria-pressed')).toBe('true');
  });

  // The whole point of learning a glyph: the popover has to open on the editor
  // that matches what the key is actually wearing, or the toggle reads as a
  // claim that the key is in text mode while showing a glyph.
  it('opens on the grid for a key already wearing a glyph', () => {
    const { container } = withLayout(withEnter(), [3]);

    expect(kind(container, 'icon').getAttribute('aria-pressed')).toBe('true');
    expect(icons(container)).toHaveLength(12);
    expect(container.querySelector('#key-label-text')).toBeNull();
  });

  it('marks the glyph the key is wearing', () => {
    const { container } = withLayout(withEnter(), [3]);
    const pressed = icons(container).filter((b) => b.getAttribute('aria-pressed') === 'true');

    expect(pressed.map((b) => b.textContent?.trim())).toEqual(['⏎']);
  });

  it('writes the glyph that is clicked', () => {
    const { container, onChange } = withLayout(withEnter(), [3]);

    icons(container)
      .find((b) => b.textContent?.trim() === '⌫')!
      .click();

    expect(onChange.mock.calls[0]![0].keys[2].label).toBe('⌫');
  });

  // Any glyph on any key, as the board draws the grid — a picker, not a lookup
  // of the one icon this position happens to have.
  it('offers the twelve on a writing key too', async () => {
    const { container, onChange } = withLayout(twoKeys());

    kind(container, 'icon').click();
    await tick();
    icons(container)
      .find((b) => b.textContent?.trim() === '⇧')!
      .click();

    expect(onChange.mock.calls[0]![0].keys[0].label).toBe('⇧');
  });

  it('puts the layout name back when Text is chosen', () => {
    const { container, onChange } = withLayout(withEnter(), [3]);

    kind(container, 'text').click();

    // No layout entry for Enter, so the keycap table answers — which is what
    // text mode means for a key that prints no character.
    expect(onChange.mock.calls[0]![0].keys[2].label).toBe('Enter');
  });

  // A switch must not destroy a value. The button reads `aria-pressed="true"`
  // on a renamed key, so pressing it is the natural way to confirm one is in
  // text mode — and it used to replace "Sprint" with "Q". The way back to the
  // detected name is the control below, which says what it will write.
  it('leaves a typed name alone when Text is already the mode', () => {
    const renamed = setKeyLabel(twoKeys(), 1, 'Sprint');
    const { container, onChange } = withLayout(renamed);

    expect(kind(container, 'text').getAttribute('aria-pressed')).toBe('true');
    kind(container, 'text').click();

    expect(onChange).not.toHaveBeenCalled();
  });

  // The four arrows are the same string in both tables, so a key wearing one
  // is in both modes at once. The switch is held rather than derived for
  // exactly this: picking an arrow must not shut the grid under the pointer.
  it('stays on the grid after an arrow is picked', async () => {
    const { container } = withLayout(twoKeys());

    kind(container, 'icon').click();
    await tick();
    icons(container)
      .find((b) => b.textContent?.trim() === '←')!
      .click();

    expect(kind(container, 'icon').getAttribute('aria-pressed')).toBe('true');
  });

  it('offers no way back to the detected name while the grid is open', () => {
    // "Reset to detected" and the Text button would write the same thing.
    const { container } = withLayout(withEnter(), [3]);

    expect(container.querySelector('button[data-reset="label"]')).toBeNull();
  });

  it('says nothing about labels for a group', () => {
    const { container } = withLayout(twoKeys(), [1, 2]);

    expect(container.querySelector('button[data-label-kind="icon"]')).toBeNull();
  });
});

describe('KeyPopover - resetting a group', () => {
  const resetAll = (container: Element) =>
    container.querySelector<HTMLButtonElement>('button[data-reset-all]');

  // The panel writes to the whole selection and used to read the lead key
  // alone, which broke both ways at once.
  it('offers the reset when the override is on a key that is not the first', () => {
    const config = twoKeys();
    config.keys[1]!.style = { activeColor: '#ff0000' };

    expect(resetAll(popover(config, [1, 2]).container)).not.toBeNull();
  });

  it('clears what every key of the selection overrides, not the first one only', () => {
    const config = twoKeys();
    config.keys[0]!.style = { radius: 4 };
    config.keys[1]!.style = { activeColor: '#ff0000' };
    const { container, onChange } = popover(config, [1, 2]);

    resetAll(container)!.click();

    const next = onChange.mock.calls[0]![0];
    expect(next.keys[0].style).toBeUndefined();
    expect(next.keys[1].style).toBeUndefined();
  });
});
