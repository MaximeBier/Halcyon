import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/svelte';
import StylePanel from './StylePanel.svelte';
import { DEFAULT_STYLE, defaultConfig, type OverlayConfig } from '../config/schema';
import { PRESETS } from './presets';

afterEach(cleanup);

type Group = 'colors' | 'shape' | 'behavior';

const head = (container: Element, group: Group) =>
  container.querySelector<HTMLButtonElement>(`[data-group="${group}"]`)!;

/**
 * Renders the panel and opens one group: every control lives inside one, and
 * the groups start shut (board 3a), so a test has to open the one it reads.
 */
async function panel(config: OverlayConfig = defaultConfig(), group: Group | null = null) {
  const onChange = vi.fn();
  const view = render(StylePanel, { props: { config, onChange } });
  if (group) {
    head(view.container, group).click();
    await Promise.resolve();
  }
  return { ...view, onChange, config };
}

/** `<input type="color">` reports its value lowercased, whatever was set. */
const change = (input: HTMLInputElement, value: string) => {
  input.value = value;
  input.dispatchEvent(new Event('change', { bubbles: true }));
};

describe('StylePanel - three groups, one open at a time', () => {
  it('starts with every group shut', async () => {
    // The panel is read far more often than it is edited: twelve controls in
    // a column made the keys list something to scroll for.
    const { container } = await panel();

    for (const group of ['colors', 'shape', 'behavior'] as Group[]) {
      expect(head(container, group).getAttribute('aria-expanded')).toBe('false');
    }
    expect(container.querySelector('input, select')).toBeNull();
  });

  it('opens a group on its header, and shuts it on the same click', async () => {
    const { container } = await panel(defaultConfig(), 'shape');

    expect(head(container, 'shape').getAttribute('aria-expanded')).toBe('true');
    expect(container.querySelector('input[name="radius"]')).not.toBeNull();

    head(container, 'shape').click();
    await Promise.resolve();

    expect(container.querySelector('input[name="radius"]')).toBeNull();
  });

  it('keeps a group open when another opens', async () => {
    // Not an accordion: a border width is chosen with the border's colour in
    // view, and the first draft shut Colors the moment Shape was opened.
    const { container } = await panel(defaultConfig(), 'colors');

    head(container, 'behavior').click();
    await Promise.resolve();

    expect(head(container, 'colors').getAttribute('aria-expanded')).toBe('true');
    expect(head(container, 'behavior').getAttribute('aria-expanded')).toBe('true');
    expect(container.querySelector('[data-preset]')).not.toBeNull();
    expect(container.querySelector('select[name="restVisibility"]')).not.toBeNull();
  });

  it('carries no note in a shut header', async () => {
    // A group says what it holds and the values wait inside (board 3a); the
    // one mark allowed is the collapsible's own dot above the panel.
    const { container } = await panel();
    // The caret is decoration, not a note.
    const words = (group: Group) => head(container, group).textContent!.replace('▸', '').trim();

    expect(words('colors')).toBe('Colors');
    expect(words('shape')).toBe('Shape');
    expect(words('behavior')).toBe('Behavior');
  });
});

describe('StylePanel', () => {
  it('writes the global active colour', async () => {
    const { container, onChange } = await panel(defaultConfig(), 'colors');

    change(container.querySelector<HTMLInputElement>('input[name="activeColor"]')!, '#ff0000');

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0]![0].style.activeColor).toBe('#ff0000');
  });

  it('writes a colour typed as hex, and shows it normalised', async () => {
    // The code beside the swatch is a field: a colour copied from a brand
    // sheet arrives as six characters, hash or no hash, in either case.
    const { container, onChange } = await panel(defaultConfig(), 'colors');
    const field = container.querySelector<HTMLInputElement>('input[name="fillColorHex"]')!;

    change(field, 'AB12CD ');

    expect(onChange.mock.calls[0]![0].style.fillColor).toBe('#ab12cd');
    expect(field.value).toBe('#ab12cd');
  });

  it('puts the hex field back when what was typed is not a colour', async () => {
    const { container, onChange } = await panel(defaultConfig(), 'colors');
    const field = container.querySelector<HTMLInputElement>('input[name="restColorHex"]')!;

    change(field, 'grey');

    expect(onChange).not.toHaveBeenCalled();
    expect(field.value).toBe(DEFAULT_STYLE.restColor);
  });

  it('writes the global fill direction from the arrow pressed', async () => {
    // Four arrows in a row rather than a select (board 3a): the answer is a
    // direction, and a direction is drawn faster than it is read.
    const { container, onChange } = await panel(defaultConfig(), 'behavior');

    container.querySelector<HTMLButtonElement>('[data-direction="left"]')!.click();

    expect(onChange.mock.calls[0]![0].style.fillDirection).toBe('left');
  });

  it('marks the direction in force, and names each arrow for whoever hears it', async () => {
    const { container } = await panel(defaultConfig(), 'behavior');
    const up = container.querySelector<HTMLButtonElement>('[data-direction="up"]')!;
    const left = container.querySelector<HTMLButtonElement>('[data-direction="left"]')!;

    expect(up.getAttribute('aria-pressed')).toBe('true');
    expect(left.getAttribute('aria-pressed')).toBe('false');
    expect(left.getAttribute('aria-label')).toMatch(/left/i);
  });

  it('writes the global border behaviour', async () => {
    const { container, onChange } = await panel(defaultConfig(), 'behavior');
    const select = container.querySelector<HTMLSelectElement>('select[name="activeBorder"]')!;

    select.value = 'active';
    select.dispatchEvent(new Event('change', { bubbles: true }));

    expect(onChange.mock.calls[0]![0].style.activeBorder).toBe('active');
  });

  it('never touches a key', async () => {
    // This panel is global and nothing else. It sat next to a per-key editor
    // in the plan, sharing one `apply` that chose its target from the
    // selection — a wrong branch there is invisible on screen, because the
    // preview renders the resolved style either way (spec §16.4).
    const config = defaultConfig();
    config.keys.push({ id: 1, usage: 0x14, mode: 'key', label: 'A', x: 0, y: 0, w: 1, h: 1 });
    const { container, onChange } = await panel(config, 'colors');

    change(container.querySelector<HTMLInputElement>('input[name="restColor"]')!, '#123456');

    expect(onChange.mock.calls[0]![0].keys[0].style).toBeUndefined();
  });

  it('writes an empty size field back rather than collapsing the layout', async () => {
    // `+''` is 0, not NaN: clearing the field to retype it used to set every
    // key to zero pixels, persist it and broadcast it — the same defect the
    // position fields carry a guard for.
    const { container, onChange } = await panel(defaultConfig(), 'shape');
    const unit = container.querySelector<HTMLInputElement>('input[name="unit"]')!;

    unit.value = '';
    unit.dispatchEvent(new Event('change', { bubbles: true }));

    expect(onChange).not.toHaveBeenCalled();
    expect(unit.value).toBe(String(defaultConfig().style.unit));
  });
});

describe('StylePanel - a size the renderer can survive', () => {
  // `min` and `max` bound the spinner arrows, not the keyboard. A typed zero
  // used to be stored, saved, and broadcast — where `isExtent(unit)` rejects
  // it and `parseMessage` throws away the whole configuration message, leaving
  // the overlay on the last good one with no way to say why.
  const write = async (name: string, value: string) => {
    const { container, onChange } = await panel(defaultConfig(), 'shape');
    const input = container.querySelector<HTMLInputElement>(`input[name="${name}"]`)!;
    input.value = value;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return { input, onChange };
  };

  it('refuses a key size of zero', async () => {
    const { onChange, input } = await write('unit', '0');

    expect(onChange.mock.calls[0]![0].style.unit).toBe(16);
    expect(input.value).toBe('16');
  });

  it('refuses a negative gap', async () => {
    const { onChange } = await write('gap', '-8');

    expect(onChange.mock.calls[0]![0].style.gap).toBe(0);
  });

  it('caps a size nobody meant to type', async () => {
    const { onChange } = await write('unit', '99999');

    expect(onChange.mock.calls[0]![0].style.unit).toBe(200);
  });

  it('refuses text that parses to nothing', async () => {
    // A number field can hold `e` and `-`, and `Number('e')` is NaN — which
    // `isExtent` rejects for the same reason zero is rejected.
    const { onChange, input } = await write('unit', 'e');

    expect(onChange).not.toHaveBeenCalled();
    expect(input.value).toBe(String(defaultConfig().style.unit));
  });
});

describe('StylePanel - the corner radius', () => {
  const radius = async (config: OverlayConfig = defaultConfig()) => {
    const view = await panel(config, 'shape');
    return {
      ...view,
      input: view.container.querySelector<HTMLInputElement>('input[name="radius"]')!,
    };
  };

  it('writes the global radius', async () => {
    // The one style property the panel never offered: `KeyStyle` has carried it
    // since task 13, the renderer applies it, and nothing could set it.
    const { input, onChange } = await radius();

    input.value = '12';
    input.dispatchEvent(new Event('change', { bubbles: true }));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0]![0].style.radius).toBe(12);
  });

  it('accepts zero, which is a square key and not a missing value', async () => {
    const { input, onChange } = await radius();

    input.value = '0';
    input.dispatchEvent(new Event('change', { bubbles: true }));

    expect(onChange.mock.calls[0]![0].style.radius).toBe(0);
  });

  it('refuses a negative radius', async () => {
    // `rx="-5"` is an SVG error rather than a square corner, and what survives
    // it is up to the browser (spec §8.8, `isStyleValue`).
    const { input, onChange } = await radius();

    input.value = '-5';
    input.dispatchEvent(new Event('change', { bubbles: true }));

    expect(onChange.mock.calls[0]![0].style.radius).toBe(0);
  });

  it('shows the radius the configuration holds', async () => {
    const config = defaultConfig();
    config.style.radius = 9;

    expect((await radius(config)).input.value).toBe('9');
  });
});

describe('StylePanel - the opacity', () => {
  const opacity = async (config: OverlayConfig = defaultConfig()) => {
    const view = await panel(config, 'behavior');
    return {
      ...view,
      slider: view.container.querySelector<HTMLInputElement>('input[name="opacity"]')!,
      field: view.container.querySelector<HTMLInputElement>('input[name="opacityPercent"]')!,
    };
  };

  it('offers a slider to explore and a field to land exactly', async () => {
    const { slider, field } = await opacity();

    expect(slider.type).toBe('range');
    expect(field.value).toBe('100');
  });

  it('writes the typed percent back as a fraction', async () => {
    const { field, onChange } = await opacity();

    field.value = '80';
    field.dispatchEvent(new Event('change', { bubbles: true }));

    expect(onChange.mock.calls[0]![0].style.opacity).toBeCloseTo(0.8);
  });

  it('clamps a percent nobody meant, and writes the clamp back', async () => {
    const { field, onChange } = await opacity();

    field.value = '250';
    field.dispatchEvent(new Event('change', { bubbles: true }));

    expect(onChange.mock.calls[0]![0].style.opacity).toBe(1);
    expect(field.value).toBe('100');
  });

  it('puts an empty field back rather than writing zero', async () => {
    const { field, onChange } = await opacity();

    field.value = '';
    field.dispatchEvent(new Event('change', { bubbles: true }));

    expect(onChange).not.toHaveBeenCalled();
    expect(field.value).toBe('100');
  });

  it('commits the slider on release', async () => {
    const { slider, onChange } = await opacity();

    slider.value = '0.5';
    slider.dispatchEvent(new Event('change', { bubbles: true }));

    expect(onChange.mock.calls[0]![0].style.opacity).toBe(0.5);
  });

  it('shows where the thumb is while it is still being dragged', async () => {
    // Knowing when to let go is the whole reason to read the figure while
    // dragging; a field that only moved on release would say 100 the whole
    // way down to 40. Nothing is committed until release — no undo entry and
    // no broadcast per pixel.
    const { slider, field, onChange } = await opacity();

    slider.value = '0.4';
    slider.dispatchEvent(new Event('input', { bubbles: true }));
    await Promise.resolve();

    expect(field.value).toBe('40');
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('StylePanel - the presets', () => {
  const swatches = (container: Element) => [
    ...container.querySelectorAll<HTMLButtonElement>('[data-preset]'),
  ];

  it('offers every preset, at the head of the colours', async () => {
    // What makes this panel usable without being a colourist, and what §9.2
    // asks of the defaults — several of them rather than one.
    const { container } = await panel(defaultConfig(), 'colors');

    expect(swatches(container)).toHaveLength(PRESETS.length);
  });

  it('sets the three colours in one write', async () => {
    // One write, so one undo. Three would leave two intermediate states on the
    // wire and in local storage, each a trio nobody chose.
    const { container, onChange } = await panel(defaultConfig(), 'colors');

    swatches(container)[2]!.click();

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0]![0].style).toMatchObject({
      activeColor: PRESETS[2]!.activeColor,
      fillColor: PRESETS[2]!.fillColor,
      restColor: PRESETS[2]!.restColor,
      borderColor: PRESETS[2]!.borderColor,
    });
  });

  it('marks the one the style is wearing', async () => {
    const { container } = await panel(defaultConfig(), 'colors');

    expect(swatches(container)[0]!.getAttribute('aria-pressed')).toBe('true');
    expect(swatches(container)[1]!.getAttribute('aria-pressed')).toBe('false');
  });

  it('marks none once a colour has been changed by hand', async () => {
    // Two of three is not a preset, and a swatch that goes on claiming the trio
    // describes a layout that is no longer on screen.
    const config = defaultConfig();
    config.style.restColor = '#010203';

    expect(
      swatches((await panel(config, 'colors')).container).every(
        (swatch) => swatch.getAttribute('aria-pressed') === 'false',
      ),
    ).toBe(true);
  });

  it('says what a preset touches, since it is three settings behind one dot', async () => {
    expect((await panel(defaultConfig(), 'colors')).container.textContent).toContain(
      'active, travel fill, rest & border',
    );
  });
});

describe('StylePanel - how much of a resting key shows', () => {
  const box = async (config: OverlayConfig = defaultConfig()) => {
    const view = await panel(config, 'behavior');
    return {
      ...view,
      select: view.container.querySelector<HTMLSelectElement>('select[name="restVisibility"]')!,
    };
  };

  /** The rest swatch lives in the colours group, one click away. */
  const swatch = async (config: OverlayConfig) =>
    (await panel(config, 'colors')).container.querySelector<HTMLInputElement>(
      'input[name="restColor"]',
    )!;

  const choose = (select: HTMLSelectElement, value: string) => {
    select.value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  };

  it('offers the three states, in the order of how much they show', async () => {
    expect([...(await box()).select.options].map((option) => option.value)).toEqual([
      'filled',
      'outline',
      'hidden',
    ]);
  });

  it('starts filled, since a keyboard that is always readable is the ordinary case', async () => {
    expect((await box()).select.value).toBe('filled');
  });

  it('drops the background without touching the colour', async () => {
    // The whole reason it is a keyword and not a colour value: the colour stays
    // where it was, so coming back returns what was there rather than a default
    // nobody chose.
    const { select, onChange } = await box();

    choose(select, 'outline');

    expect(onChange.mock.calls[0]![0].style.restVisibility).toBe('outline');
    expect(onChange.mock.calls[0]![0].style.restColor).toBe(DEFAULT_STYLE.restColor);
  });

  it('comes back to the colour that was waiting', async () => {
    const config = defaultConfig();
    config.style.restVisibility = 'outline';
    config.style.restColor = '#334455';
    const { select, onChange } = await box(config);

    choose(select, 'filled');

    expect(onChange.mock.calls[0]![0].style).toMatchObject({
      restVisibility: 'filled',
      restColor: '#334455',
    });
  });

  it('hides the keys until they are pressed', async () => {
    const { select, onChange } = await box();

    choose(select, 'hidden');

    expect(onChange.mock.calls[0]![0].style.restVisibility).toBe('hidden');
  });

  it('takes the swatch out of use only where the colour paints nothing', async () => {
    // Not dimmed-but-clickable: picking a colour that changes nothing on screen
    // is worse than a control that plainly says it is not in use.
    //
    // `hidden` is **not** such a case, and that is the trap this guards. The
    // rest colour is exactly what a hidden key wears the moment it appears, so
    // disabling the swatch there would lock the one colour the mode shows.
    const outlined = defaultConfig();
    outlined.style.restVisibility = 'outline';
    const concealed = defaultConfig();
    concealed.style.restVisibility = 'hidden';

    expect((await swatch(outlined)).disabled).toBe(true);
    expect((await swatch(concealed)).disabled).toBe(false);
    expect((await swatch(defaultConfig())).disabled).toBe(false);
  });

  it('says why the stage did not change when the keys go hidden', async () => {
    // Choosing the mode changes nothing on the capture page: the editor keeps
    // drawing every key so the layout stays editable. Without a word here, the
    // only way to tell the setting took is to open the overlay URL — the
    // setting looks broken precisely because it is working.
    const concealed = defaultConfig();
    concealed.style.restVisibility = 'hidden';

    expect((await panel(concealed, 'behavior')).container.textContent).toContain(
      'editor keeps showing every key',
    );
  });

  it('stops claiming the overlay is empty once a key is kept on screen', async () => {
    // "shows none until you press one" was true while the mode was global. A
    // key overriding it is exactly what the property became per key for, and
    // the sentence would then be describing an overlay nobody is looking at.
    const concealed = defaultConfig();
    concealed.style.restVisibility = 'hidden';
    concealed.keys.push({
      id: 1,
      usage: 0x14,
      mode: 'key',
      label: 'A',
      x: 0,
      y: 0,
      w: 1,
      h: 1,
      style: { restVisibility: 'filled' },
    });

    const { container } = await panel(concealed, 'behavior');

    expect(container.textContent).toContain('editor keeps showing every key');
    expect(container.textContent).not.toContain('shows none');
    expect(container.textContent).toMatch(/1 key/);
  });

  it('keeps quiet in the modes where the stage tells the truth on its own', async () => {
    expect((await panel(defaultConfig(), 'behavior')).container.textContent).not.toContain(
      'editor keeps showing every key',
    );
  });
});

describe('StylePanel - the outline of a key', () => {
  const field = (container: Element, name: string) =>
    container.querySelector<HTMLInputElement>(`input[name="${name}"]`)!;

  it('sets the resting border colour, with the other colours', async () => {
    // It left `KeyStyle` a day ago because a border around a filled key is a
    // detail. It is back, global, because a key with no background *is* its
    // border — and one pixel of very dark grey over a video is nothing anyone
    // can see. A colour, so it lives in Colors; only its width is a shape.
    const { container, onChange } = await panel(defaultConfig(), 'colors');

    change(field(container, 'borderColor'), '#ff00aa');

    expect(onChange.mock.calls[0]![0].style.borderColor).toBe('#ff00aa');
    expect(container.querySelector('input[name="borderWidth"]')).toBeNull();
  });

  it('sets the border width', async () => {
    const { container, onChange } = await panel(defaultConfig(), 'shape');
    const input = field(container, 'borderWidth');

    input.value = '3';
    input.dispatchEvent(new Event('change', { bubbles: true }));

    expect(onChange.mock.calls[0]![0].style.borderWidth).toBe(3);
  });

  it('accepts zero, which is a key with no outline', async () => {
    const { container, onChange } = await panel(defaultConfig(), 'shape');
    const input = field(container, 'borderWidth');

    input.value = '0';
    input.dispatchEvent(new Event('change', { bubbles: true }));

    expect(onChange.mock.calls[0]![0].style.borderWidth).toBe(0);
  });

  it('refuses a negative width, which is an SVG error and not a thin border', async () => {
    const { container, onChange } = await panel(defaultConfig(), 'shape');
    const input = field(container, 'borderWidth');

    input.value = '-2';
    input.dispatchEvent(new Event('change', { bubbles: true }));

    expect(onChange.mock.calls[0]![0].style.borderWidth).toBe(0);
  });

  it('shows what the configuration holds', async () => {
    const config = defaultConfig();
    config.style.borderWidth = 5;

    expect(field((await panel(config, 'shape')).container, 'borderWidth').value).toBe('5');
  });
});
