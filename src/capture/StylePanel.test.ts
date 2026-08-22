import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/svelte';
import StylePanel from './StylePanel.svelte';
import { DEFAULT_STYLE, defaultConfig, type OverlayConfig } from '../config/schema';
import { PRESETS } from './presets';

afterEach(cleanup);

function panel(config: OverlayConfig = defaultConfig()) {
  const onChange = vi.fn();
  return { ...render(StylePanel, { props: { config, onChange } }), onChange, config };
}

/** `<input type="color">` reports its value lowercased, whatever was set. */
const change = (input: HTMLInputElement, value: string) => {
  input.value = value;
  input.dispatchEvent(new Event('change', { bubbles: true }));
};

describe('StylePanel', () => {
  it('writes the global active colour', () => {
    const { container, onChange } = panel();

    change(container.querySelector<HTMLInputElement>('input[name="activeColor"]')!, '#ff0000');

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0]![0].style.activeColor).toBe('#ff0000');
  });

  it('writes the global fill direction', () => {
    const { container, onChange } = panel();
    const select = container.querySelector<HTMLSelectElement>('select[name="fillDirection"]')!;

    select.value = 'left';
    select.dispatchEvent(new Event('change', { bubbles: true }));

    expect(onChange.mock.calls[0]![0].style.fillDirection).toBe('left');
  });

  it('never touches a key', () => {
    // This panel is global and nothing else. It sat next to a per-key editor
    // in the plan, sharing one `apply` that chose its target from the
    // selection — a wrong branch there is invisible on screen, because the
    // preview renders the resolved style either way (spec §16.4).
    const config = defaultConfig();
    config.keys.push({ id: 1, usage: 0x14, mode: 'key', label: 'A', x: 0, y: 0, w: 1, h: 1 });
    const { container, onChange } = panel(config);

    change(container.querySelector<HTMLInputElement>('input[name="restColor"]')!, '#123456');

    expect(onChange.mock.calls[0]![0].keys[0].style).toBeUndefined();
  });

  it('writes an empty size field back rather than collapsing the layout', () => {
    // `+''` is 0, not NaN: clearing the field to retype it used to set every
    // key to zero pixels, persist it and broadcast it — the same defect the
    // position fields carry a guard for.
    const { container, onChange } = panel();
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
  const write = (name: string, value: string) => {
    const { container, onChange } = panel();
    const input = container.querySelector<HTMLInputElement>(`input[name="${name}"]`)!;
    input.value = value;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return { input, onChange };
  };

  it('refuses a key size of zero', () => {
    const { onChange, input } = write('unit', '0');

    expect(onChange.mock.calls[0]![0].style.unit).toBe(16);
    expect(input.value).toBe('16');
  });

  it('refuses a negative gap', () => {
    const { onChange } = write('gap', '-8');

    expect(onChange.mock.calls[0]![0].style.gap).toBe(0);
  });

  it('caps a size nobody meant to type', () => {
    const { onChange } = write('unit', '99999');

    expect(onChange.mock.calls[0]![0].style.unit).toBe(200);
  });

  it('refuses text that parses to nothing', () => {
    // A number field can hold `e` and `-`, and `Number('e')` is NaN — which
    // `isExtent` rejects for the same reason zero is rejected.
    const { onChange, input } = write('unit', 'e');

    expect(onChange).not.toHaveBeenCalled();
    expect(input.value).toBe(String(defaultConfig().style.unit));
  });
});

describe('StylePanel - the corner radius', () => {
  const radius = (config: OverlayConfig = defaultConfig()) => {
    const view = panel(config);
    return {
      ...view,
      input: view.container.querySelector<HTMLInputElement>('input[name="radius"]')!,
    };
  };

  it('writes the global radius', () => {
    // The one style property the panel never offered: `KeyStyle` has carried it
    // since task 13, the renderer applies it, and nothing could set it.
    const { input, onChange } = radius();

    input.value = '12';
    input.dispatchEvent(new Event('change', { bubbles: true }));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0]![0].style.radius).toBe(12);
  });

  it('accepts zero, which is a square key and not a missing value', () => {
    const { input, onChange } = radius();

    input.value = '0';
    input.dispatchEvent(new Event('change', { bubbles: true }));

    expect(onChange.mock.calls[0]![0].style.radius).toBe(0);
  });

  it('refuses a negative radius', () => {
    // `rx="-5"` is an SVG error rather than a square corner, and what survives
    // it is up to the browser (spec §8.8, `isStyleValue`).
    const { input, onChange } = radius();

    input.value = '-5';
    input.dispatchEvent(new Event('change', { bubbles: true }));

    expect(onChange.mock.calls[0]![0].style.radius).toBe(0);
  });

  it('shows the radius the configuration holds', () => {
    const config = defaultConfig();
    config.style.radius = 9;

    expect(radius(config).input.value).toBe('9');
  });
});

describe('StylePanel - the presets', () => {
  const swatches = (container: Element) => [
    ...container.querySelectorAll<HTMLButtonElement>('[data-preset]'),
  ];

  it('offers the six of the lot, at the head of the panel', () => {
    // What makes this panel usable without being a colourist, and what §9.2
    // asks of the defaults — six of them rather than one.
    const { container } = panel();

    expect(swatches(container)).toHaveLength(PRESETS.length);
  });

  it('sets the three colours in one write', () => {
    // One write, so one undo. Three would leave two intermediate states on the
    // wire and in local storage, each a trio nobody chose.
    const { container, onChange } = panel();

    swatches(container)[2]!.click();

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0]![0].style).toMatchObject({
      activeColor: PRESETS[2]!.activeColor,
      fillColor: PRESETS[2]!.fillColor,
      restColor: PRESETS[2]!.restColor,
    });
  });

  it('marks the one the style is wearing', () => {
    const { container } = panel();

    expect(swatches(container)[0]!.getAttribute('aria-pressed')).toBe('true');
    expect(swatches(container)[1]!.getAttribute('aria-pressed')).toBe('false');
  });

  it('marks none once a colour has been changed by hand', () => {
    // Two of three is not a preset, and a swatch that goes on claiming the trio
    // describes a layout that is no longer on screen.
    const config = defaultConfig();
    config.style.restColor = '#010203';

    expect(
      swatches(panel(config).container).every(
        (swatch) => swatch.getAttribute('aria-pressed') === 'false',
      ),
    ).toBe(true);
  });

  it('says what a preset touches, since it is three settings behind one dot', () => {
    expect(panel().container.textContent).toContain('active, travel fill & rest');
  });
});

describe('StylePanel - whether a resting key has a background at all', () => {
  const box = (config: OverlayConfig = defaultConfig()) => {
    const view = panel(config);
    return {
      ...view,
      input: view.container.querySelector<HTMLInputElement>('input[name="restFilled"]')!,
      swatch: view.container.querySelector<HTMLInputElement>('input[name="restColor"]')!,
    };
  };

  const toggle = (input: HTMLInputElement, checked: boolean) => {
    input.checked = checked;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  };

  it('switches the background off without touching the colour', () => {
    // The whole reason it is a switch and not a colour value: the colour stays
    // where it was, so switching back on returns what was there rather than a
    // default nobody chose.
    const { input, onChange } = box();

    toggle(input, false);

    expect(onChange.mock.calls[0]![0].style.restFilled).toBe(false);
    expect(onChange.mock.calls[0]![0].style.restColor).toBe(DEFAULT_STYLE.restColor);
  });

  it('switches it back on, to the colour that was waiting', () => {
    const config = defaultConfig();
    config.style.restFilled = false;
    config.style.restColor = '#334455';
    const { input, onChange } = box(config);

    toggle(input, true);

    expect(onChange.mock.calls[0]![0].style).toMatchObject({
      restFilled: true,
      restColor: '#334455',
    });
  });

  it('starts on, since a key with no background is the exception', () => {
    expect(box().input.checked).toBe(true);
  });

  it('takes the swatch out of use while there is no background to colour', () => {
    // Not dimmed-but-clickable: picking a colour that changes nothing on screen
    // is worse than a control that plainly says it is not in use.
    const config = defaultConfig();
    config.style.restFilled = false;

    expect(box(config).swatch.disabled).toBe(true);
    expect(box().swatch.disabled).toBe(false);
  });
});

describe('StylePanel - the outline of a key', () => {
  const field = (container: Element, name: string) =>
    container.querySelector<HTMLInputElement>(`input[name="${name}"]`)!;

  it('sets the resting border colour, which nothing could reach', () => {
    // It left `KeyStyle` a day ago because a border around a filled key is a
    // detail. It is back, global, because a key with no background *is* its
    // border — and one pixel of very dark grey over a video is nothing anyone
    // can see.
    const { container, onChange } = panel();

    change(field(container, 'borderColor'), '#ff00aa');

    expect(onChange.mock.calls[0]![0].style.borderColor).toBe('#ff00aa');
  });

  it('sets the border width', () => {
    const { container, onChange } = panel();
    const input = field(container, 'borderWidth');

    input.value = '3';
    input.dispatchEvent(new Event('change', { bubbles: true }));

    expect(onChange.mock.calls[0]![0].style.borderWidth).toBe(3);
  });

  it('accepts zero, which is a key with no outline', () => {
    const { container, onChange } = panel();
    const input = field(container, 'borderWidth');

    input.value = '0';
    input.dispatchEvent(new Event('change', { bubbles: true }));

    expect(onChange.mock.calls[0]![0].style.borderWidth).toBe(0);
  });

  it('refuses a negative width, which is an SVG error and not a thin border', () => {
    const { container, onChange } = panel();
    const input = field(container, 'borderWidth');

    input.value = '-2';
    input.dispatchEvent(new Event('change', { bubbles: true }));

    expect(onChange.mock.calls[0]![0].style.borderWidth).toBe(0);
  });

  it('shows what the configuration holds', () => {
    const config = defaultConfig();
    config.style.borderWidth = 5;

    expect(field(panel(config).container, 'borderWidth').value).toBe('5');
  });
});
