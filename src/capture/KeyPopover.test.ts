import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/svelte';
import { tick } from 'svelte';
import { openPicker } from '../test/picker';
import { lastChildIsIcon } from '../test/dom';
import KeyPopover from './KeyPopover.svelte';
import popoverSource from './KeyPopover.svelte?raw';
import menuSource from './InstalledFontsMenu.svelte?raw';
import { setKeyLabel, setKeyMode, setKeyStyle } from '../config/edit';
import { DEFAULT_STYLE, defaultConfig, type OverlayConfig } from '../config/schema';
import { surfaceOf } from './layout';
import type { FontAccess, LocalFonts } from './local-fonts';

afterEach(cleanup);

/** The page's tooltip around an element (board Editor-Tooltip), never a native title. */
const tipOf = (el: Element | null) =>
  el?.closest('[data-tooltip-host]')?.querySelector(':scope > [role="tooltip"]')?.textContent;

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
const unfolded = () => memory({ 'halcyon:open:key-style': '1' });

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

  const labelBadge = (container: Element) => container.querySelector('[data-badge="renamed"]');

  it('turns the Label name itself into the way back, as an overridden style line does', () => {
    // Spec §16.15: no "renamed" word any more — the name of the row says it,
    // in the accent, and a click on it gives the key its name back.
    const renamed = setKeyLabel(twoKeys(), 1, 'Sprint');
    const { container } = withLayout(renamed, AZERTY);
    const back = resetLabel(container)!;

    expect(back.textContent!.trim()).toBe('Label');
    expect(tipOf(back)).toBe('Back to the key name');
    expect(back.hasAttribute('title')).toBe(false);
    expect(labelBadge(container)).toBeNull();
    expect(container.textContent).not.toContain('Reset to detected');
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
  const dropdown = (c: Element, property: string) =>
    row(c, property).querySelector<HTMLSelectElement>('select')!;
  const choose = (select: HTMLSelectElement, value: string) => {
    select.value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  };

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

  it('overrides the border colour, the fourth colour a key may argue about', () => {
    // A border in the theme's grey around a key painted coral is the mismatch
    // that made the border a per-key colour (2026-09-05).
    const { container, onChange } = popover();

    change(swatch(container, 'borderColor'), '#ff00aa');

    expect(onChange.mock.calls[0]![0].keys[0].style).toEqual({ borderColor: '#ff00aa' });
  });

  const hex = (c: Element, property: string) =>
    row(c, property).querySelector<HTMLInputElement>('[data-hex]')!;

  it('writes the hex beside every swatch', () => {
    // A swatch alone cannot be copied into anything, and two greys a shade
    // apart cannot be told apart by eye.
    const { container } = popover(setKeyStyle(twoKeys(), [1], 'activeColor', '#ff0000'));

    expect(hex(container, 'activeColor').value).toBe('#ff0000');
    expect(hex(container, 'borderColor').value).toBe(DEFAULT_STYLE.borderColor);
  });

  it('takes a hex typed into the field, hash or no hash', () => {
    // A colour copied from a brand sheet arrives as six characters, which a
    // swatch cannot take.
    const { container, onChange } = popover();

    change(hex(container, 'activeColor'), 'FF00AA');

    expect(onChange.mock.calls[0]![0].keys[0].style).toEqual({ activeColor: '#ff00aa' });
    expect(hex(container, 'activeColor').value).toBe('#ff00aa');
  });

  it('puts the field back when what was typed is not a colour', () => {
    const { container, onChange } = popover();

    change(hex(container, 'restColor'), 'rebeccapurple');

    expect(onChange).not.toHaveBeenCalled();
    expect(hex(container, 'restColor').value).toBe(DEFAULT_STYLE.restColor);
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

  it('counts what changed in the STYLE heading', () => {
    // What a fold hides has to be readable while it is shut (spec §9.3).
    const twice = setKeyStyle(
      setKeyStyle(twoKeys(), [1], 'fillColor', '#123456'),
      [1],
      'borderColor',
      '#ff00aa',
    );

    expect(popover(twice).container.querySelector('[data-style-toggle]')!.textContent).toContain(
      '2 changed',
    );
  });

  it('turns the name of an overridden line to the accent, and leaves the others plain', () => {
    // The name says where the value comes from, in the one colour the whole
    // page uses for "customized" — no `override` / `global` word beside it.
    // The accent name is also the way back for that line.
    const { container } = popover(setKeyStyle(twoKeys(), [1], 'fillColor', '#123456'));

    const overriddenName = marker(container, 'fillColor')!;
    expect(overriddenName.textContent!.trim()).toBe('Press depth');
    expect(tipOf(overriddenName)).toBe('Back to the global style');
    expect(overriddenName.hasAttribute('title')).toBe(false);
    expect(row(container, 'restColor').querySelector('[data-marker]')).toBeNull();
    expect(row(container, 'restColor').textContent).not.toMatch(/global|override/);
    expect(row(container, 'fillColor').textContent).not.toMatch(/override/);
  });

  it('keeps every plain name a label of its control', () => {
    const { container } = popover();

    expect(row(container, 'restColor').querySelector('label[for="key-restColor"]')).not.toBeNull();
    expect(
      row(container, 'restVisibility').querySelector('label[for="key-restVisibility"]'),
    ).not.toBeNull();
  });

  it('hands every override back in one gesture', () => {
    const twice = setKeyStyle(
      setKeyStyle(twoKeys(), [1], 'fillColor', '#123456'),
      [1],
      'borderColor',
      '#ff00aa',
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
      'borderColor',
      '#ff00aa',
    );
    const { container, onChange } = popover(twice);

    marker(container, 'borderColor')!.click();

    expect(onChange.mock.calls[0]![0].keys[0].style).toEqual({ fillColor: '#123456' });
  });

  it('sets how one key rests, against what the whole overlay does', () => {
    // The point of the property being per key at all: an overlay hidden at
    // rest, and three keys kept on the stream.
    const { container, onChange } = popover();

    choose(dropdown(container, 'restVisibility'), 'hidden');

    expect(onChange.mock.calls[0]![0].keys[0].style).toEqual({ restVisibility: 'hidden' });
  });

  it('shows the global value on a key that overrides nothing', () => {
    const config = twoKeys();
    config.style = { ...config.style, restVisibility: 'outline' };
    const { container } = popover(config);

    expect(dropdown(container, 'restVisibility').value).toBe('outline');
  });

  it('spells the resting states out, which the narrow group could not', () => {
    // The short forms existed for a 284 px row of buttons. A `<select>` opens
    // over the popover, so the panel's own wording fits — and is the wording.
    const { container } = popover();
    const options = [...dropdown(container, 'restVisibility').options].map((o) => o.textContent);

    expect(options).toEqual(['Filled', 'Outline only', 'Hidden until pressed']);
  });

  it('sets whether one key announces itself with its border', () => {
    const { container, onChange } = popover();

    choose(dropdown(container, 'activeBorder'), 'active');

    expect(onChange.mock.calls[0]![0].keys[0].style).toEqual({ activeBorder: 'active' });
  });

  it('shows the global border behaviour on a key that overrides nothing', () => {
    const config = twoKeys();
    config.style = { ...config.style, activeBorder: 'active' };
    const { container } = popover(config);

    expect(dropdown(container, 'activeBorder').value).toBe('active');
  });

  it('keeps the fill direction inside the block, as four arrows', () => {
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

    expect(container.querySelector('[data-style-toggle]')!.getAttribute('aria-expanded')).toBe(
      'false',
    );
    expect(container.querySelector('[data-style-row="fillColor"]')).toBeNull();
  });

  it('unfolds on its heading, and remembers it', async () => {
    const storage = memory();
    const { container } = render(KeyPopover, {
      props: {
        config: twoKeys(),
        selectedIds: [1],
        surface: SURFACE,
        onChange: vi.fn(),
        onClose: vi.fn(),
        storage,
      },
    });

    container.querySelector<HTMLButtonElement>('[data-style-toggle]')!.click();
    await tick();

    expect(container.querySelector('[data-style-row="fillColor"]')).not.toBeNull();
    expect(storage.getItem('halcyon:open:key-style')).toBe('1');
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
    config.keys[0]!.style = { borderColor: '#ff00aa' };
    config.keys[1]!.style = { activeColor: '#ff0000' };
    const { container, onChange } = popover(config, [1, 2]);

    resetAll(container)!.click();

    const next = onChange.mock.calls[0]![0];
    expect(next.keys[0].style).toBeUndefined();
    expect(next.keys[1].style).toBeUndefined();
  });
});

describe('KeyPopover - what names what', () => {
  // A group of buttons cannot take a `<label for>` — nothing in it is
  // labelable — so the four arrows name themselves through `aria-labelledby`,
  // and the id it points at has to exist: a dangling reference names nothing
  // in any reader. Each arrow carries its full word besides.
  it('names the fill direction group, and each arrow in it', () => {
    const { container } = popover(twoKeys(), [1]);
    const group = container.querySelector<HTMLElement>(
      '[data-style-row="fillDirection"] [role="group"]',
    )!;
    const labelled = container.querySelector(`#${group.getAttribute('aria-labelledby')}`);

    expect(labelled?.textContent).toBe('Fill direction');
    expect(group.querySelector('[data-direction="left"]')?.getAttribute('aria-label')).toMatch(
      /left/i,
    );
  });
});

describe('KeyPopover - the label font', () => {
  const FACES = [
    { family: 'Bahnschrift', style: 'Regular' },
    { family: 'Bahnschrift', style: 'Bold' },
    { family: 'Impact', style: 'Regular' },
  ];

  function fonts(access: FontAccess, read: LocalFonts['read'] = async () => FACES): LocalFonts {
    return { access: vi.fn(async () => access), read: vi.fn(read) };
  }

  async function settle() {
    for (let i = 0; i < 6; i++) await tick();
  }

  async function withFonts(
    config = twoKeys(),
    selectedIds = [1],
    localFonts: LocalFonts = fonts('prompt'),
  ) {
    const onChange = vi.fn();
    const view = render(KeyPopover, {
      props: {
        config,
        selectedIds,
        surface: SURFACE,
        onChange,
        onClose: vi.fn(),
        storage: unfolded(),
        localFonts,
      },
    });
    await settle();
    return { ...view, onChange, localFonts };
  }

  const trigger = (container: Element) =>
    container.querySelector<HTMLButtonElement>('[data-font-trigger]')!;

  async function openMenu(container: Element) {
    trigger(container).click();
    await settle();
    return container.querySelector<HTMLElement>('[data-installed-menu]')!;
  }

  const ownFont = (family: string, weight = 700) => {
    const config = twoKeys();
    config.keys[0]!.style = { fontFamily: family, fontWeight: weight };
    return config;
  };

  it('rules its sections apart: Global, Built-in, Installed', async () => {
    const { container } = await withFonts(twoKeys(), [1], fonts('granted'));
    const menu = await openMenu(container);
    const parts = [...menu.children].map((el) =>
      el.tagName === 'HR' ? '—' : (el.getAttribute('data-inherit') ?? el.className),
    );

    // A rule between each section, and rules that never give way to a short
    // window: the list shrinks and scrolls, nothing else does.
    expect(parts.filter((p) => p === '—')).toHaveLength(2);
    expect(menu.querySelector('.title:last-of-type')!.textContent).toMatch(/Installed · 2/);
    expect(menuSource).toMatch(/\.menu > :not\(\.list\)\s*\{[^}]*flex:\s*none/);
    expect(menuSource).toMatch(/\.list\s*\{[^}]*min-block-size:\s*0/);
  });

  it('shows the global font, inherited, with nothing counted', async () => {
    const { container } = await withFonts();

    expect(trigger(container).textContent).toContain('Archivo');
    expect(container.querySelector('[data-reset="fontFamily"]')).toBeNull();
    expect(container.querySelector('[data-override-count]')).toBeNull();
  });

  it('writes an embedded face, family and weight, on the whole selection', async () => {
    const { container, onChange } = await withFonts(twoKeys(), [1, 2]);

    (await openMenu(container))
      .querySelector<HTMLButtonElement>('[data-face="Chakra Petch"]')!
      .click();

    const next = onChange.mock.calls[0]![0] as OverlayConfig;
    expect(next.keys.map((key) => key.style)).toEqual([
      { fontFamily: 'Chakra Petch', fontWeight: 700 },
      { fontFamily: 'Chakra Petch', fontWeight: 700 },
    ]);
  });

  it('hands the key back when the global face is picked, rather than copying it', async () => {
    const { container, onChange } = await withFonts(ownFont('Fredoka'));

    (await openMenu(container)).querySelector<HTMLButtonElement>('[data-face="Archivo"]')!.click();

    expect((onChange.mock.calls[0]![0] as OverlayConfig).keys[0]!.style).toBeUndefined();
  });

  it('counts an own font as one change, and its accent name gives the global back', async () => {
    const { container, onChange } = await withFonts(ownFont('Fredoka'));

    expect(container.querySelector('[data-override-count]')?.textContent).toContain('1 changed');
    container.querySelector<HTMLButtonElement>('[data-reset="fontFamily"]')!.click();

    expect((onChange.mock.calls[0]![0] as OverlayConfig).keys[0]!.style).toBeUndefined();
  });

  it('gives the global back from the menu too, ticked while the key inherits', async () => {
    const { container, onChange } = await withFonts(ownFont('Fredoka'));
    const menu = await openMenu(container);

    expect(menu.querySelector('[data-face="Fredoka"] [data-tick]')).not.toBeNull();
    menu.querySelector<HTMLButtonElement>('[data-inherit]')!.click();

    expect((onChange.mock.calls[0]![0] as OverlayConfig).keys[0]!.style).toBeUndefined();
  });

  it('draws no key of its own, and writes each name in its face, Global first', async () => {
    const { container } = await withFonts(ownFont('Chakra Petch'));
    const menu = await openMenu(container);

    // No preview: the only drawings in the popover are its interface icons.
    expect(container.querySelector('svg:not(.lucide-icon)')).toBeNull();
    expect(menu.querySelector('[data-inherit]')?.textContent).toContain('Global · Archivo');
    expect(menu.firstElementChild?.hasAttribute('data-inherit')).toBe(true);
    expect(
      menu.querySelector<HTMLElement>('[data-face="Chakra Petch"] span')?.style.fontFamily,
    ).toContain('Chakra Petch');
  });

  describe('the installed section, by what Chrome has said (board Menu Font du popover touche)', () => {
    const faces = (menu: Element) => menu.querySelector('[data-face="Chakra Petch"]')!;

    it('asks with a dashed "+ Installed font" right under the built-in faces, no title', async () => {
      const { container } = await withFonts(twoKeys(), [1], fonts('prompt'));
      const menu = await openMenu(container);
      const ask = menu.querySelector<HTMLButtonElement>('[data-read-installed]')!;

      expect(ask.textContent!.trim()).toBe('Installed font');
      expect(ask.querySelector('svg')).not.toBeNull();
      expect(ask.classList).toContain('he-slot');
      expect(ask.closest('.ask-row')!.previousElementSibling).toBe(faces(menu));
      expect(menu.textContent).not.toMatch(/Installed\b(?! font)/);
      expect(menu.querySelectorAll('hr')).toHaveLength(1);
      expect(menuSource).toMatch(/\.ask-row\s*\{[^}]*padding:\s*4px 6px;/);
    });

    it('says Chrome refused, under a rule and with no title', async () => {
      const { container } = await withFonts(
        twoKeys(),
        [1],
        fonts('prompt', async () => 'denied'),
      );
      const menu = await openMenu(container);
      menu.querySelector<HTMLButtonElement>('[data-read-installed]')!.click();
      await settle();

      expect(menu.querySelector('[data-read-installed]')).toBeNull();
      expect(menu.querySelector('.blocked')!.textContent).toBe(
        'Chrome blocked access to your fonts.',
      );
      expect(menu.querySelector('.hint')!.textContent!.replace(/\s+/g, ' ').trim()).toBe(
        'Allow “Fonts” in this site’s settings (the icon left of the address), then try again.',
      );
      expect(menu.querySelectorAll('.title')).toHaveLength(1);
      expect(menu.querySelectorAll('hr')).toHaveLength(2);
    });

    it('shows nothing under the built-in faces when no font was found', async () => {
      const { container } = await withFonts(
        twoKeys(),
        [1],
        fonts('granted', async () => []),
      );
      const menu = await openMenu(container);

      expect(menu.lastElementChild).toBe(faces(menu));
    });
  });

  it('reads the installed fonts from a click, and offers a style for a family with several', async () => {
    const localFonts = fonts('prompt');
    const { container, onChange, rerender } = await withFonts(twoKeys(), [1], localFonts);

    const menu = await openMenu(container);
    expect(localFonts.read).not.toHaveBeenCalled();
    menu.querySelector<HTMLButtonElement>('[data-read-installed]')!.click();
    await settle();
    expect(localFonts.read).toHaveBeenCalledTimes(1);

    container.querySelector<HTMLButtonElement>('[data-family="Bahnschrift"]')!.click();
    const next = onChange.mock.calls[0]![0] as OverlayConfig;
    expect(next.keys[0]!.style).toEqual({ fontFamily: 'Bahnschrift', fontWeight: 700 });

    await rerender({ config: next });
    expect(container.querySelector('select[name="key-fontWeight"]')).not.toBeNull();

    await rerender({ config: ownFont('Impact', 400) });
    expect(container.querySelector('select[name="key-fontWeight"]')).toBeNull();
  });

  it('says a family is not installed here once the list is known, and only then', async () => {
    const unread = await withFonts(ownFont('Nowhere Sans'), [1], fonts('prompt'));
    expect(unread.container.querySelector('[data-not-installed]')).toBeNull();
    cleanup();

    const read = await withFonts(ownFont('Nowhere Sans'), [1], fonts('granted'));
    expect(read.container.querySelector('[data-not-installed]')).not.toBeNull();
  });

  it('shuts the menu on Escape without letting the stage close the popover', async () => {
    const { container } = await withFonts();
    await openMenu(container);
    const stage = vi.fn();
    window.addEventListener('keydown', stage);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await tick();

    expect(container.querySelector('[data-installed-menu]')).toBeNull();
    expect(stage).not.toHaveBeenCalled();
    window.removeEventListener('keydown', stage);
  });

  it('keeps the menu open when Escape closes a dropdown', async () => {
    const { container } = await withFonts();
    await openMenu(container);
    const picker = openPicker();

    picker.escape();
    await tick();

    expect(container.querySelector('[data-installed-menu]')).not.toBeNull();
    picker.remove();
  });
});

describe('KeyPopover - the dropdowns', () => {
  it("open the page's own menu", () => {
    // The class is the contract with controls.css (spec §16.10).
    const { container } = popover();
    const selects = [...container.querySelectorAll('select')];

    expect(selects.length).toBeGreaterThanOrEqual(2);
    expect(selects.every((select) => select.classList.contains('he-select'))).toBe(true);
  });
});

describe('KeyPopover - the delete button', () => {
  it('carries no shortcut after its name', () => {
    const { container } = popover();

    expect(container.querySelector('[data-delete]')!.textContent!.trim()).toBe('Delete');
  });

  it('counts the keys it would delete', () => {
    const { container } = popover(twoKeys(), [1, 2]);

    expect(container.querySelector('[data-delete]')!.textContent!.trim()).toBe('Delete 2 keys');
  });
});

describe('KeyPopover - button levels', () => {
  it('draws Delete as the destructive button and the resets as links', () => {
    const { container } = popover(setKeyStyle(twoKeys(), [1], 'fillColor', '#123456'));

    expect(container.querySelector('[data-delete]')!.classList.contains('he-btn-danger')).toBe(
      true,
    );
    expect(container.querySelector('[data-reset-all]')!.classList.contains('he-btn-tertiary')).toBe(
      true,
    );
  });

  it('writes every reset before its icon: Reset to global and the overridden names', () => {
    const { container } = popover(setKeyStyle(twoKeys(), [1], 'fillColor', '#123456'));
    const resets = [
      container.querySelector('[data-reset-all]')!,
      ...container.querySelectorAll('.label.overridden'),
    ];

    expect(resets.length).toBe(2);
    for (const reset of resets) expect(lastChildIsIcon(reset)).toBe(true);
  });
});

describe('KeyPopover - axes written in the fields', () => {
  it('prefixes position and size with the axis each one moves', () => {
    const { container } = popover();
    const prefix = (name: string) =>
      container.querySelector(`input[name="${name}"]`)!.closest('.he-field')?.textContent?.trim();

    expect(prefix('x')).toBe('X');
    expect(prefix('y')).toBe('Y');
    expect(prefix('width')).toBe('W');
    expect(prefix('height')).toBe('H');
  });
});

describe('KeyPopover - one name per setting (spec §16.15)', () => {
  const row = (c: Element, property: string) =>
    c.querySelector<HTMLElement>(`[data-style-row="${property}"]`)!;
  const dropdown = (c: Element, property: string) =>
    row(c, property).querySelector<HTMLSelectElement>('select')!;

  it('titles itself with the label alone', () => {
    const one = popover();
    expect(one.container.querySelector('.title')!.textContent!.trim()).toBe('A');
    cleanup();

    const two = popover(twoKeys(), [1, 2]);
    expect(two.container.querySelector('.title')!.textContent!.trim()).toBe('2 keys');
  });

  it('names its colours as the panel does', () => {
    const { container } = popover();
    const name = (property: string) =>
      row(container, property).querySelector('label, .label')!.textContent!.trim();

    expect(name('restColor')).toBe('Background');
    expect(name('fillColor')).toBe('Press depth');
    expect(name('activeColor')).toBe('Triggered');
    expect(name('borderColor')).toBe('Border');
  });

  it('names the resting and pressed rows as the panel does', () => {
    const { container } = popover();

    expect(row(container, 'restVisibility').textContent).toContain('At rest');
    expect(row(container, 'activeBorder').textContent).toContain('Pressed border');
    expect([...dropdown(container, 'activeBorder').options].map((o) => o.textContent)).toEqual([
      'Unchanged',
      'Triggered color',
    ]);
  });
});

describe('KeyPopover - what the key is bound to (spec §16.15)', () => {
  it('asks Keyboard or Gamepad, the words Wootility uses, over the same model', () => {
    const { container, onChange } = popover();
    const choice = (mode: string) =>
      container.querySelector<HTMLButtonElement>(`[data-mode="${mode}"]`)!;

    expect(choice('key').textContent!.trim()).toBe('Keyboard');
    expect(choice('axis').textContent!.trim()).toBe('Gamepad');

    choice('axis').click();
    expect(onChange.mock.calls[0]![0].keys[0].mode).toBe('axis');
  });

  it('adds no sentence under the choice', () => {
    const { container } = popover();

    expect(container.querySelector('header')!.nextElementSibling?.matches('p')).not.toBe(true);
  });
});

describe('KeyPopover - the colour rows, as the panel draws them', () => {
  const rowOf = (c: Element, property: string) =>
    c.querySelector<HTMLElement>(`[data-style-row="${property}"]`)!;

  it('lists the colours from the back of the key to its edge, swatch first', () => {
    const { container } = popover();
    const order = [...container.querySelectorAll<HTMLElement>('[data-style-row$="Color"]')].map(
      (row) => row.dataset.styleRow,
    );

    expect(order).toEqual(['restColor', 'fillColor', 'activeColor', 'borderColor']);
    expect([...rowOf(container, 'fillColor').querySelectorAll('input')].map((i) => i.type)).toEqual(
      ['color', 'text'],
    );
  });
});

describe('KeyPopover - Background with nothing to paint (board Editor-Tooltip)', () => {
  const row = (c: Element) => c.querySelector<HTMLElement>('[data-style-row="restColor"]')!;

  it('is out of use when every selected key rests as an outline', () => {
    const config = setKeyStyle(twoKeys(), [1, 2], 'restVisibility', 'outline');
    const { container } = popover(config, [1, 2]);

    expect(Boolean(row(container).inert) || row(container).hasAttribute('inert')).toBe(true);
    expect(row(container).querySelector<HTMLInputElement>('input[type="color"]')!.disabled).toBe(
      true,
    );
    expect(
      row(container).closest('[data-tooltip-host]')!.querySelector(':scope > [role="tooltip"]')!
        .textContent,
    ).toBe('No background while At rest is “Outline only”.');
  });

  it('stays in use while one key of the selection still paints its background', () => {
    const config = setKeyStyle(twoKeys(), [1], 'restVisibility', 'outline');
    const { container } = popover(config, [1, 2]);

    expect(Boolean(row(container).inert) || row(container).hasAttribute('inert')).toBe(false);
    expect(
      row(container).closest('[data-tooltip-host]')?.querySelector(':scope > [role="tooltip"]'),
    ).toBeFalsy();
  });
});

describe('KeyPopover - Press depth on Gamepad keys (board Editor-Tooltip)', () => {
  const row = (c: Element) => c.querySelector<HTMLElement>('[data-style-row="fillColor"]')!;
  const inert = (el: HTMLElement) => Boolean(el.inert) || el.hasAttribute('inert');

  it('is out of use when every selected key is a gamepad input', () => {
    const config = setKeyStyle(setKeyMode(twoKeys(), [1, 2], 'axis'), [1], 'fillColor', '#123456');
    const { container } = popover(config, [1, 2]);

    expect(inert(row(container))).toBe(true);
    expect(
      row(container).querySelector<HTMLInputElement>('input[name="fillColorHex"]')!.disabled,
    ).toBe(true);
    expect(
      row(container).closest('[data-tooltip-host]')!.querySelector(':scope > [role="tooltip"]')!
        .textContent,
    ).toBe('Gamepad keys fill with Triggered.');
  });

  it('stays in use while one selected key is a keyboard key', () => {
    const { container } = popover(setKeyMode(twoKeys(), [1], 'axis'), [1, 2]);
    expect(inert(row(container))).toBe(false);
  });
});
