import { describe, it, expect } from 'vitest';
import { PRESETS, presetFor, withPreset } from './presets';
import { DEFAULT_STYLE, defaultConfig } from '../config/schema';

describe('PRESETS', () => {
  it('opens on the defaults, rather than repeating them', () => {
    // The first one is what a new profile already wears, taken from the tokens
    // and not copied beside them: a literal here would drift the day the
    // mockup moves a colour, and the swatch would stop matching the layout it
    // claims to describe.
    expect(PRESETS[0]).toMatchObject({
      activeColor: DEFAULT_STYLE.activeColor,
      fillColor: DEFAULT_STYLE.fillColor,
      restColor: DEFAULT_STYLE.restColor,
      borderColor: DEFAULT_STYLE.borderColor,
    });
  });

  it('offers the lot six, and two neutrals after them', () => {
    // The plate keeps its order and its positions: the two greys are appended,
    // never inserted, so a swatch does not move under someone who learned where
    // it was.
    expect(PRESETS).toHaveLength(8);
    expect(new Set(PRESETS.map((preset) => preset.name)).size).toBe(8);
    expect(PRESETS.slice(6).map((preset) => preset.name)).toEqual(['Graphite', 'Paper']);
  });

  it('runs the light one the other way round, so the actuation still reads', () => {
    // The six of the lot go dark to bright: rest the darkest, active the most
    // vivid. A light theme cannot do that — a white active on a pale rest is
    // nothing to see — so its ramp is inverted, and the actuation reads as the
    // key going *dark*. It is the direction that carries the signal, not the
    // colour.
    const paper = PRESETS.find((preset) => preset.name === 'Paper')!;
    const graphite = PRESETS.find((preset) => preset.name === 'Graphite')!;
    const light = (color: string) => Number.parseInt(color.slice(1, 3), 16);

    expect(light(paper.restColor)).toBeGreaterThan(light(paper.activeColor));
    expect(light(graphite.restColor)).toBeLessThan(light(graphite.activeColor));
  });
});

describe('withPreset', () => {
  it('sets the four colours together, and nothing else', () => {
    // The point of a preset: four colours chosen to work with each other, the
    // border included — the blue theme's grey around a coral key is the
    // mismatch a preset exists to prevent.
    // Setting one and leaving the others is what someone does by hand when the
    // result looks wrong.
    const config = defaultConfig();
    config.style.radius = 12;

    const next = withPreset(config, PRESETS[2]!);

    expect(next.style).toMatchObject({
      activeColor: PRESETS[2]!.activeColor,
      fillColor: PRESETS[2]!.fillColor,
      restColor: PRESETS[2]!.restColor,
      borderColor: PRESETS[2]!.borderColor,
      radius: 12,
      fillDirection: config.style.fillDirection,
    });
  });

  it('leaves the keys alone, overrides included', () => {
    // A preset is a theme. A key that was given its own active colour asked for
    // it, and the global panel has never written to a key (spec §16.4).
    const config = defaultConfig();
    config.keys.push({
      id: 1,
      usage: 0x14,
      mode: 'key',
      label: 'A',
      x: 0,
      y: 0,
      w: 1,
      h: 1,
      style: { activeColor: '#ff0000' },
    });

    expect(withPreset(config, PRESETS[1]!).keys[0]!.style).toEqual({ activeColor: '#ff0000' });
  });
});

describe('presetFor', () => {
  it('names the preset a style is wearing', () => {
    expect(presetFor(DEFAULT_STYLE)).toBe(PRESETS[0]);
  });

  it('ignores the case, which the swatch decides and not us', () => {
    // `<input type="color">` reports its value lowercased, whatever was set —
    // so a preset picked from the swatch beside it comes back in another case,
    // and a strict comparison would drop the mark off the swatch just chosen.
    const shouted = {
      activeColor: PRESETS[3]!.activeColor.toUpperCase(),
      fillColor: PRESETS[3]!.fillColor.toLowerCase(),
      restColor: PRESETS[3]!.restColor.toUpperCase(),
      borderColor: PRESETS[3]!.borderColor.toUpperCase(),
    };

    expect(presetFor(shouted)).toBe(PRESETS[3]);
  });

  it('names nothing once one of the four has been changed', () => {
    // Three of four is not a preset: the swatch would claim a set that is not
    // on screen any more.
    expect(presetFor({ ...DEFAULT_STYLE, restColor: '#010203' })).toBeNull();
    expect(presetFor({ ...DEFAULT_STYLE, borderColor: '#010203' })).toBeNull();
  });
});
