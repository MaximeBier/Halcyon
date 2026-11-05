import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/svelte';
import StylePanel from './StylePanel.svelte';
import Harness from './StylePanel.harness.svelte';
import { DEFAULT_STYLE, defaultConfig, type OverlayConfig } from '../config/schema';
import { PRESETS } from './presets';
import { tick } from 'svelte';
import type { FontAccess, LocalFonts } from './local-fonts';

afterEach(cleanup);

type Group = 'colors' | 'shape' | 'label' | 'behavior';

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

    for (const group of ['colors', 'shape', 'label', 'behavior'] as Group[]) {
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

describe('StylePanel - the label', () => {
  const tile = (container: Element, family: string) =>
    container.querySelector<HTMLButtonElement>(`[data-font="${family}"]`)!;

  it('sits between Shape and Behavior', async () => {
    const { container } = await panel();
    const groups = [...container.querySelectorAll('[data-group]')].map((head) =>
      head.getAttribute('data-group'),
    );

    expect(groups).toEqual(['colors', 'shape', 'label', 'behavior']);
  });

  it('shows each embedded face in itself, and marks the one in force', async () => {
    const { container } = await panel(defaultConfig(), 'label');

    for (const family of ['Archivo', 'Fredoka', 'Chakra Petch']) {
      const sample = tile(container, family).querySelector<HTMLElement>('[data-sample]')!;
      expect(sample.style.fontFamily.startsWith(`"${family}"`)).toBe(true);
    }
    expect(tile(container, 'Archivo').getAttribute('aria-pressed')).toBe('true');
    expect(tile(container, 'Fredoka').getAttribute('aria-pressed')).toBe('false');
  });

  it('writes the family and its one weight from the face clicked', async () => {
    // An embedded face has a single weight, so choosing it chooses the weight
    // too: there is no weight field to set it with afterwards.
    const config = defaultConfig();
    config.style.fontWeight = 400;
    const { container, onChange } = await panel(config, 'label');

    tile(container, 'Chakra Petch').click();

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0]![0].style).toMatchObject({
      fontFamily: 'Chakra Petch',
      fontWeight: 700,
    });
  });

  it('moves from face to face, each click taking over the mark', async () => {
    const localFonts: LocalFonts = {
      access: async () => 'granted',
      read: async () => [{ family: 'Arial', style: 'Bold' }],
    };
    const { container } = render(Harness, { props: { initial: defaultConfig(), localFonts } });
    head(container, 'label').click();
    for (let i = 0; i < 6; i++) await tick();

    for (const family of ['Fredoka', 'Chakra Petch', 'Archivo']) {
      tile(container, family).click();
      await tick();
      expect(tile(container, family).getAttribute('aria-pressed'), family).toBe('true');
    }
  });

  it('keeps a fourth place for an installed font', async () => {
    const { container } = await panel(defaultConfig(), 'label');

    expect(container.querySelector('[data-installed]')?.textContent).toContain('Installed font');
  });

  it('writes the text size, and leaves the key size alone', async () => {
    // "Text size" and not "Size": "Key size", in Shape, resizes the whole key.
    const { container, onChange } = await panel(defaultConfig(), 'label');

    container.querySelector<HTMLButtonElement>('[data-label-size="l"]')!.click();

    const next = onChange.mock.calls[0]![0] as OverlayConfig;
    expect(next.style.labelSize).toBe('l');
    expect(next.style.unit).toBe(DEFAULT_STYLE.unit);
  });

  it('writes the outline, none included', async () => {
    const { container, onChange } = await panel(defaultConfig(), 'label');

    container.querySelector<HTMLButtonElement>('[data-label-outline="none"]')!.click();

    expect(onChange.mock.calls[0]![0].style.labelOutline).toBe('none');
  });

  it('marks the size and the outline in force, and names the letters in full', async () => {
    const { container } = await panel(defaultConfig(), 'label');
    const medium = container.querySelector('[data-label-size="m"]')!;
    const small = container.querySelector('[data-label-size="s"]')!;

    expect(medium.getAttribute('aria-pressed')).toBe('true');
    expect(small.getAttribute('aria-pressed')).toBe('false');
    expect(small.getAttribute('aria-label')).toMatch(/small/i);
    expect(
      container.querySelector('[data-label-outline="normal"]')!.getAttribute('aria-pressed'),
    ).toBe('true');
  });
});

describe('StylePanel - an installed font', () => {
  const FACES = [
    { family: 'Bahnschrift', style: 'Regular' },
    { family: 'Bahnschrift', style: 'SemiBold' },
    { family: 'Bahnschrift', style: 'Bold' },
    { family: 'Impact', style: 'Regular' },
    { family: 'Arial', style: 'Bold' },
  ];

  function fonts(access: FontAccess, read: LocalFonts['read'] = async () => FACES): LocalFonts {
    return { access: vi.fn(async () => access), read: vi.fn(read) };
  }

  /** Lets the promises the panel chains — access, then read — all resolve. */
  async function settle() {
    for (let i = 0; i < 6; i++) await tick();
  }

  /** Opens the Label group and lets the access check settle. */
  async function labelPanel(localFonts: LocalFonts, config = defaultConfig()) {
    const onChange = vi.fn();
    const view = render(StylePanel, { props: { config, onChange, localFonts } });
    head(view.container, 'label').click();
    await settle();
    return { ...view, onChange };
  }

  const slot = (container: Element) =>
    container.querySelector<HTMLButtonElement>('[data-installed]')!;

  async function openMenu(container: Element) {
    slot(container).click();
    await settle();
    return container.querySelector<HTMLElement>('[data-installed-menu]');
  }

  it('asks Chrome on the click, and lists what it hands back', async () => {
    const localFonts = fonts('prompt');
    const { container } = await labelPanel(localFonts);

    expect(localFonts.read).not.toHaveBeenCalled();
    const menu = await openMenu(container);

    expect(localFonts.read).toHaveBeenCalledTimes(1);
    expect(menu?.textContent).toContain('Installed · 3');
    const names = [...menu!.querySelectorAll('[data-family]')].map((row) =>
      row.textContent?.trim(),
    );
    expect(names).toEqual(['Arial', 'Bahnschrift', 'Impact']);
  });

  it('reminds that the font has to be on the PC running OBS too', async () => {
    const { container } = await labelPanel(fonts('prompt'));

    expect((await openMenu(container))?.textContent).toMatch(/PC running OBS/);
  });

  it('filters the list as the name is typed', async () => {
    const { container } = await labelPanel(fonts('prompt'));
    const menu = (await openMenu(container))!;
    const search = menu.querySelector<HTMLInputElement>('input[type="search"]')!;

    search.value = 'bahn';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    await tick();

    expect(menu.querySelectorAll('[data-family]')).toHaveLength(1);
  });

  it('writes the family chosen at its bold, and closes', async () => {
    const { container, onChange } = await labelPanel(fonts('prompt'));
    const menu = (await openMenu(container))!;

    menu.querySelector<HTMLButtonElement>('[data-family="Bahnschrift"]')!.click();
    await tick();

    expect(onChange.mock.calls[0]![0].style).toMatchObject({
      fontFamily: 'Bahnschrift',
      fontWeight: 700,
    });
    expect(container.querySelector('[data-installed-menu]')).toBeNull();
  });

  it('takes the face nearest to bold for a family without one', async () => {
    const { container, onChange } = await labelPanel(fonts('prompt'));
    const menu = (await openMenu(container))!;

    menu.querySelector<HTMLButtonElement>('[data-family="Impact"]')!.click();

    expect(onChange.mock.calls[0]![0].style.fontWeight).toBe(400);
  });

  it('says how to give access back when Chrome refuses', async () => {
    const { container } = await labelPanel(fonts('prompt', async () => 'denied'));
    const menu = await openMenu(container);

    expect(menu?.textContent).toContain('Chrome blocked access to your fonts.');
    expect(menu?.textContent).toMatch(/site.s settings/);
  });

  it('closes on Escape', async () => {
    const { container } = await labelPanel(fonts('prompt'));
    await openMenu(container);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await tick();

    expect(container.querySelector('[data-installed-menu]')).toBeNull();
  });

  it('cannot be opened in a browser that has no way to list fonts', async () => {
    const { container } = await labelPanel(fonts('unsupported'));

    expect(slot(container).disabled).toBe(true);
  });

  describe('once one is chosen', () => {
    const chosen = (family: string, weight = 700) => {
      const config = defaultConfig();
      config.style.fontFamily = family;
      config.style.fontWeight = weight;
      return config;
    };

    it('fills the fourth place, and the place still says what it is', async () => {
      const { container } = await labelPanel(fonts('prompt'), chosen('Bahnschrift'));

      expect(slot(container).getAttribute('aria-pressed')).toBe('true');
      expect(slot(container).textContent).toContain('Bahnschrift');
      expect(slot(container).textContent).toContain('Installed font');
      expect(container.querySelector('[data-font="Archivo"]')!.getAttribute('aria-pressed')).toBe(
        'false',
      );
    });

    it('offers its faces when the family has more than one', async () => {
      const { container, onChange } = await labelPanel(fonts('granted'), chosen('Bahnschrift'));
      const select = container.querySelector<HTMLSelectElement>('select[name="fontWeight"]')!;

      expect([...select.options].map((option) => option.textContent)).toEqual([
        'Regular',
        'SemiBold',
        'Bold',
      ]);
      expect(select.value).toBe('700');

      change(select as unknown as HTMLInputElement, '600');
      expect(onChange.mock.calls[0]![0].style).toMatchObject({
        fontFamily: 'Bahnschrift',
        fontWeight: 600,
      });
    });

    it('offers no Style row for a family with a single face', async () => {
      const { container } = await labelPanel(fonts('granted'), chosen('Arial'));

      expect(container.querySelector('select[name="fontWeight"]')).toBeNull();
    });

    it('says when the family is not installed on this machine', async () => {
      // A profile from another PC: the name is kept, never replaced in silence.
      const { container } = await labelPanel(fonts('granted'), chosen('Ghost Sans'));

      expect(container.querySelector('[data-not-installed]')?.textContent).toMatch(
        /not installed here/i,
      );
    });

    it('says nothing about it while the list is unknown', async () => {
      const { container } = await labelPanel(fonts('prompt'), chosen('Ghost Sans'));

      expect(container.querySelector('[data-not-installed]')).toBeNull();
    });
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

describe('StylePanel - keys with a font of their own', () => {
  function withKeys(...styles: OverlayConfig['keys'][number]['style'][]): OverlayConfig {
    const config = defaultConfig();
    styles.forEach((style, index) =>
      config.keys.push({
        id: index + 1,
        usage: 0x04 + index,
        mode: 'key',
        label: String(index),
        x: index,
        y: 0,
        w: 1,
        h: 1,
        ...(style ? { style } : {}),
      }),
    );
    return config;
  }

  const line = (container: Element) => container.querySelector<HTMLElement>('[data-own-fonts]');

  it('says nothing while every key follows the global font', async () => {
    const { container } = await panel(withKeys(undefined, { activeColor: '#ff0000' }), 'label');

    expect(line(container)).toBeNull();
  });

  it('counts the keys that keep their own font, in the singular for one', async () => {
    const one = await panel(withKeys({ fontFamily: 'Fredoka', fontWeight: 700 }), 'label');
    expect(line(one.container)?.textContent).toContain('1 key uses its own font');
    cleanup();

    const four = await panel(
      withKeys(
        { fontFamily: 'Fredoka', fontWeight: 700 },
        { fontFamily: 'Chakra Petch', fontWeight: 700 },
        { fontWeight: 300 },
        { fontFamily: 'Fredoka', fontWeight: 700 },
        undefined,
      ),
      'label',
    );
    expect(line(four.container)?.textContent).toContain('4 keys use their own font');
  });

  it('hands the global font back to every key, and touches nothing else', async () => {
    const { container, onChange } = await panel(
      withKeys(
        { fontFamily: 'Fredoka', fontWeight: 700 },
        { fontFamily: 'Chakra Petch', fontWeight: 700, activeColor: '#ff0000' },
      ),
      'label',
    );

    container.querySelector<HTMLButtonElement>('[data-reset-own-fonts]')!.click();

    const next = onChange.mock.calls[0]![0] as OverlayConfig;
    expect(next.keys.map((key) => key.style)).toEqual([undefined, { activeColor: '#ff0000' }]);
  });
});
