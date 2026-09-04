// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { addLearnedKey, learnKeys, LEARN_TRAVEL_THRESHOLD } from './learn';
import { DEFAULT_STYLE, defaultConfig, type OverlayConfig } from '../config/schema';
import { surfaceOf } from './layout';
import type { AnalogEntry } from '../keyboard/decode';

/** A stage of 1440 × 720 at the default unit: 20 × 10 key units. */
const SURFACE = surfaceOf({ width: 1440, height: 720 }, DEFAULT_STYLE.unit);

const azerty = new Map([
  ['KeyQ', 'a'],
  ['KeyW', 'z'],
  ['KeyA', 'q'],
  ['KeyS', 's'],
]);

const entry = (index: number, usage: number, travel: number): AnalogEntry => ({
  index,
  usage,
  travel,
  active: false,
});

describe('learnKeys', () => {
  const learn = (config: OverlayConfig, entries: readonly AnalogEntry[]) =>
    learnKeys(config, entries, azerty, SURFACE);

  it('adds every key a report shows pressed, not just the deepest one', () => {
    // Capture stays armed, so there is no longer one key to elect: a chord
    // pressed together is a chord meant to be added together.
    const config = learn(defaultConfig(), [entry(1, 0x14, 300), entry(2, 0x1a, 900)]);

    expect(config.keys.map((k) => k.id)).toEqual([1, 2]);
  });

  it('hands the same configuration back for a key held down', () => {
    // What replaces the mode closing itself after one key. The reports arrive
    // by the thousand while a key is held, and every one of them repeats it —
    // returning the same reference is what keeps that from reaching
    // `updateConfig`, which would persist, broadcast and stack an undo step.
    const config = learn(defaultConfig(), [entry(1, 0x14, 900)]);

    expect(learn(config, [entry(1, 0x14, 900)])).toBe(config);
  });

  it('adds the keys of a chord still held when a new one joins it', () => {
    const config = learn(defaultConfig(), [entry(1, 0x14, 900)]);

    const next = learn(config, [entry(1, 0x14, 900), entry(2, 0x1a, 400)]);

    expect(next.keys.map((k) => k.id)).toEqual([1, 2]);
  });

  it('ignores a brush below the learning threshold', () => {
    const config = defaultConfig();

    expect(learn(config, [entry(1, 0x14, LEARN_TRAVEL_THRESHOLD - 1)])).toBe(config);
  });

  it('hands the same configuration back for a report at rest', () => {
    const config = defaultConfig();

    expect(learn(config, [entry(1, 0x14, 0)])).toBe(config);
    expect(learn(config, [])).toBe(config);
  });

  it('stays below the firmware actuation point, which is around 375', () => {
    // Learning must fire on a deliberate press without needing the keystroke
    // to register: pressing a key to configure it should not type it.
    expect(LEARN_TRAVEL_THRESHOLD).toBeGreaterThan(100);
    expect(LEARN_TRAVEL_THRESHOLD).toBeLessThan(375);
  });
});

describe('addLearnedKey', () => {
  it('adds the key with its label, its size and its default position', () => {
    const config = addLearnedKey(defaultConfig(), entry(174, 0x04, 900), azerty, SURFACE);

    expect(config.keys).toHaveLength(1);
    expect(config.keys[0]).toMatchObject({
      id: 174,
      usage: 0x04,
      mode: 'key',
      label: 'Q',
      w: 1,
      h: 1,
    });
  });

  // Board 6e: "special keys pick their icon automatically on capture". The
  // moment a key is learned is the moment its use is known, and it is the only
  // moment nobody has yet decided anything about its name.
  it('gives a special key its glyph rather than its name', () => {
    const config = addLearnedKey(defaultConfig(), entry(174, 0x2c, 900), azerty, SURFACE);

    expect(config.keys[0]).toMatchObject({ label: '␣', w: 6.25 });
  });

  it('leaves a writing key the name the layout gives it', () => {
    const config = addLearnedKey(defaultConfig(), entry(1, 0x1a, 900), azerty, SURFACE);

    expect(config.keys[0]?.label).toBe('Z');
  });

  it('applies the key mode by default', () => {
    const config = addLearnedKey(defaultConfig(), entry(1, 0x14, 900), azerty, SURFACE);

    expect(config.keys[0]?.mode).toBe('key');
    expect(config.keys[0]?.style).toBeUndefined();
  });

  it('lines up learned keys the way a keyboard does', () => {
    let config = defaultConfig();
    config = addLearnedKey(config, entry(1, 0x1a, 900), azerty, SURFACE); // Z
    config = addLearnedKey(config, entry(2, 0x04, 900), azerty, SURFACE); // Q
    config = addLearnedKey(config, entry(3, 0x16, 900), azerty, SURFACE); // S

    expect(config.keys.map((k) => [k.label, k.x, k.y])).toEqual([
      ['Z', 0, 0],
      ['Q', -0.75, 1],
      ['S', 0.25, 1],
    ]);
  });

  it('does not add the same key twice', () => {
    let config = addLearnedKey(defaultConfig(), entry(1, 0x14, 900), azerty, SURFACE);
    config = addLearnedKey(config, entry(1, 0x14, 900), azerty, SURFACE);

    expect(config.keys).toHaveLength(1);
  });

  it('keeps the custom positions of keys already placed', () => {
    let config = addLearnedKey(defaultConfig(), entry(1, 0x1a, 900), azerty, SURFACE);
    config.keys[0]!.x = 10;
    config.keys[0]!.y = 10;

    config = addLearnedKey(config, entry(2, 0x04, 900), azerty, SURFACE);

    expect(config.keys[0]).toMatchObject({ x: 10, y: 10 });
  });

  it('leaves a layout parked left of the origin exactly where it is', () => {
    // The reframing used to rewrite every position whenever a new key landed
    // before the origin. On a work surface with room on all sides that is a
    // layout teleporting under the hand that placed it (task 31).
    let config = addLearnedKey(defaultConfig(), entry(1, 0x1a, 900), azerty, SURFACE);
    config.keys[0]!.x = -8;
    config.keys[0]!.y = -3;

    config = addLearnedKey(config, entry(2, 0x04, 900), azerty, SURFACE);

    expect(config.keys[0]).toMatchObject({ x: -8, y: -3 });
    expect(config.keys[1]).toMatchObject({ x: -8.75, y: -2 });
  });

  it('brings a key back onto the surface rather than off its edge', () => {
    // Reachable: a layout dragged hard against the left edge, then a key
    // learned that belongs further left still. Off the canvas it would be
    // drawn at a pixel the stage cannot scroll to.
    let config = addLearnedKey(defaultConfig(), entry(1, 0x1a, 900), azerty, SURFACE);
    config.keys[0]!.x = SURFACE.x;

    config = addLearnedKey(config, entry(2, 0x04, 900), azerty, SURFACE);

    expect(config.keys[1]?.x).toBe(SURFACE.x);
  });

  it('accepts a key missing from the geometry table', () => {
    const config = addLearnedKey(defaultConfig(), entry(200, 0xff, 900), azerty, SURFACE);

    expect(config.keys[0]).toMatchObject({ label: 'HID 0xff', w: 1, h: 1 });
  });

  it('leaves the configuration it was given untouched', () => {
    // It goes through updateConfig, which persists and broadcasts whatever it
    // returns. Mutating the argument would let a change reach the preview
    // without either.
    const before = defaultConfig();

    addLearnedKey(before, entry(1, 0x14, 900), azerty, SURFACE);

    expect(before.keys).toEqual([]);
  });
});
