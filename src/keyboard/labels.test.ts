// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  FALLBACK_LAYOUTS,
  ICON_SET,
  iconFor,
  labelFor,
  loadLayoutMap,
  resolveLayout,
} from './labels';
import { ISO_GEOMETRY } from './geometry';

const azerty = new Map([
  ['KeyQ', 'a'],
  ['KeyW', 'z'],
  ['KeyA', 'q'],
  ['Semicolon', 'm'],
]);

describe('labelFor', () => {
  it('returns the character actually produced, not the HID usage', () => {
    // Usage Q on an AZERTY: the key printed A.
    expect(labelFor(0x14, azerty)).toBe('A');
  });

  it('uppercases the letter, the way the keycap prints it', () => {
    expect(labelFor(0x1a, azerty)).toBe('Z');
  });

  it('falls back to what the keycap prints when the layout stays silent', () => {
    expect(labelFor(0x2c, azerty)).toBe('Space');
    expect(labelFor(0xe1, azerty)).toBe('Shift');
  });

  it('falls back to the position name when the API is unavailable', () => {
    expect(labelFor(0x14, null)).toBe('KeyQ');
  });

  it('returns an explicit label for an unknown usage', () => {
    expect(labelFor(0xff, azerty)).toBe('HID 0xff');
  });

  it('leaves a punctuation mark alone', () => {
    expect(labelFor(0x33, azerty)).toBe('M');
    expect(labelFor(0x33, new Map([['Semicolon', ';']]))).toBe(';');
  });

  it('treats an empty answer as no answer', () => {
    expect(labelFor(0x14, new Map([['KeyQ', '']]))).toBe('KeyQ');
  });
});

describe('resolveLayout', () => {
  it('trusts detection in auto mode', () => {
    expect(resolveLayout('auto', azerty)).toBe(azerty);
  });

  it('lets the explicit choice win over a wrong detection', () => {
    const forced = resolveLayout('qwerty', azerty);

    expect(labelFor(0x14, forced)).toBe('Q');
  });

  it('serves as a fallback when detection is unavailable', () => {
    expect(labelFor(0x14, resolveLayout('azerty', null))).toBe('A');
    expect(labelFor(0x1d, resolveLayout('qwertz', null))).toBe('Y');
  });
});

describe('the three fallback layouts', () => {
  // They are picked precisely when detection is wrong, so switching between
  // qwerty and qwertz must never make a label worse — those two disagree only
  // on the seven letters, everywhere else a US-shaped board and a German one
  // print the same thing. AZERTY is not held to the same set: its digit row
  // needs Shift to type a digit at all, and half the punctuation moves too,
  // so its table also carries the positions those two have no reason to list.
  const codesOf = (name: keyof typeof FALLBACK_LAYOUTS) =>
    (FALLBACK_LAYOUTS[name] as Map<string, string>).keys();

  it('let qwerty and qwertz cover exactly the same positions', () => {
    expect([...codesOf('qwertz')].sort()).toEqual([...codesOf('qwerty')].sort());
  });

  it('gives azerty every position qwerty and qwertz cover, and more', () => {
    const azertyCodes = new Set(codesOf('azerty'));
    const qwertyCodes = [...codesOf('qwerty')];

    for (const code of qwertyCodes) expect(azertyCodes.has(code)).toBe(true);
    expect(azertyCodes.size).toBeGreaterThan(qwertyCodes.length);
  });

  it('gives every one of those positions a real character', () => {
    for (const [name, layout] of Object.entries(FALLBACK_LAYOUTS)) {
      for (const [code, produced] of layout as Map<string, string>) {
        expect(produced, `${name}/${code}`).not.toBe('');
      }
    }
  });

  it('swaps Z and Y on qwertz, which is the whole point of the name', () => {
    expect(labelFor(0x1d, resolveLayout('qwertz', null))).toBe('Y');
    expect(labelFor(0x1c, resolveLayout('qwertz', null))).toBe('Z');
    expect(labelFor(0x1d, resolveLayout('qwerty', null))).toBe('Z');
    expect(labelFor(0x1c, resolveLayout('qwerty', null))).toBe('Y');
  });
});

describe('azerty forced fallback — the digit and punctuation row', () => {
  // AZERTY needs Shift to type a digit at all: unshifted, the top row prints
  // symbols and accented letters instead. The table used to stop at the seven
  // letters, so forcing azerty without detection left this whole row printing
  // its position name literally — "Digit1", "Minus" — which is exactly the
  // debugging string `KEYCAP_LABELS` exists to keep off the screen.
  const forced = resolveLayout('azerty', null);

  // usageOf reads the usage back out of the geometry table instead of
  // hardcoding hex, so a mistyped usage here cannot agree with a mistyped one
  // in geometry.ts and hide a real mismatch.
  function usageOf(code: string): number {
    return ISO_GEOMETRY.find((key) => key.code === code)!.usage;
  }

  it('labels the digit row the way an AZERTY keycap prints it', () => {
    // `labelFor` uppercases every single-character answer already (Q reads
    // "A" above) — the accented letters here get the same treatment, so é
    // reads "É", exactly as the letter row already does.
    const row: [string, string][] = [
      ['Digit1', '&'],
      ['Digit2', 'É'],
      ['Digit3', '"'],
      ['Digit4', "'"],
      ['Digit5', '('],
      ['Digit6', '-'],
      ['Digit7', 'È'],
      ['Digit8', '_'],
      ['Digit9', 'Ç'],
      ['Digit0', 'À'],
    ];

    for (const [code, expected] of row) {
      expect(labelFor(usageOf(code), forced), code).toBe(expected);
    }
  });

  it('labels the rest of the punctuation row the same way', () => {
    const row: [string, string][] = [
      ['Minus', ')'],
      ['Equal', '='],
      ['BracketLeft', '^'],
      ['BracketRight', '$'],
      ['Quote', 'Ù'],
      ['Backslash', '*'],
      ['Comma', ';'],
      ['Period', ':'],
      ['Slash', '!'],
      ['Backquote', '²'],
    ];

    for (const [code, expected] of row) {
      expect(labelFor(usageOf(code), forced), code).toBe(expected);
    }
  });
});

describe('loadLayoutMap', () => {
  it('returns null when the API does not exist', async () => {
    await expect(loadLayoutMap(undefined)).resolves.toBeNull();
    await expect(loadLayoutMap({} as Navigator)).resolves.toBeNull();
  });

  it('returns the map when the API answers', async () => {
    const nav = { keyboard: { getLayoutMap: async () => azerty } } as unknown as Navigator;

    await expect(loadLayoutMap(nav)).resolves.toBe(azerty);
  });

  it('returns null when the API fails, without throwing', async () => {
    const nav = {
      keyboard: {
        getLayoutMap: async () => {
          throw new Error('denied');
        },
      },
    } as unknown as Navigator;

    await expect(loadLayoutMap(nav)).resolves.toBeNull();
  });
});

describe('keycap labels for the keys that print no character', () => {
  // getLayoutMap only speaks for the writing keys. Everything else fell back
  // to the position name — "ArrowLeft", "ControlRight" — which is a debugging
  // string, not something to put on air.
  it('uses the arrows a keycap actually prints', () => {
    expect(labelFor(0x50, null)).toBe('←');
    expect(labelFor(0x51, null)).toBe('↓');
    expect(labelFor(0x4f, null)).toBe('→');
    expect(labelFor(0x52, null)).toBe('↑');
  });

  it('names the modifiers the way both sides of the board are printed', () => {
    expect(labelFor(0xe0, null)).toBe('Ctrl');
    expect(labelFor(0xe4, null)).toBe('Ctrl');
    expect(labelFor(0xe1, null)).toBe('Shift');
    expect(labelFor(0xe5, null)).toBe('Shift');
    expect(labelFor(0xe2, null)).toBe('Alt');
    expect(labelFor(0xe6, null)).toBe('Alt Gr');
  });

  it('shortens the long ones so they fit on a key', () => {
    expect(labelFor(0x29, null)).toBe('Esc');
    expect(labelFor(0x2a, null)).toBe('Bksp');
    expect(labelFor(0x39, null)).toBe('Caps');
    expect(labelFor(0x4b, null)).toBe('Pg Up');
    expect(labelFor(0x4e, null)).toBe('Pg Dn');
    expect(labelFor(0x65, null)).toBe('Menu');
  });

  it('gives the numpad the digits printed on it', () => {
    expect(labelFor(0x62, null)).toBe('0');
    expect(labelFor(0x5f, null)).toBe('7');
    expect(labelFor(0x57, null)).toBe('+');
    expect(labelFor(0x58, null)).toBe('Enter');
  });

  it('leaves no key of the board showing a position name', () => {
    // Anything camelCase reaching the screen is a leaked debugging string. The
    // writing keys are exempt: getLayoutMap always speaks for those, and the
    // position name only shows when the API is missing entirely.
    const writingKey =
      /^(Key[A-Z]|Digit[0-9]|Intl|Backquote|Minus|Equal|Bracket|Semicolon|Quote|Backslash|Comma|Period|Slash)/;
    const leaked = ISO_GEOMETRY.filter(
      (key) => !writingKey.test(key.code) && /[a-z][A-Z]/.test(labelFor(key.usage, null)),
    );

    expect(leaked.map((k) => k.code)).toEqual([]);
  });

  it('lets the detected layout win over the keycap table', () => {
    // The table is a fallback, never an override: a layout that names a key
    // knows better than we do.
    expect(labelFor(0x2c, new Map([['Space', 'Espace']]))).toBe('Espace');
  });

  it('treats a blank answer from the layout as no answer', () => {
    // getLayoutMap returns " " for Space. Taken at face value it produced a
    // label made of one space — invisible on air, and impossible to diagnose.
    expect(labelFor(0x2c, new Map([['Space', ' ']]))).toBe('Space');
  });
});

describe('resolveLayout - the forced choice corrects, it does not replace', () => {
  // Each table holds the positions where forcing a layout corrects something
  // detection might get wrong — seven letters for qwerty here. Read as the
  // whole answer, forcing a layout renamed every other key to its position
  // name: D became KeyD, & became Digit1. The table says what the layouts
  // *disagree* on; detection still answers everything else.
  const detected = new Map([
    ['KeyQ', 'a'],
    ['KeyD', 'd'],
    ['Digit1', '&'],
  ]);

  it('overrides the positions the table covers', () => {
    expect(labelFor(0x14, resolveLayout('qwerty', detected))).toBe('Q');
  });

  it('keeps the detected answer for the positions it does not', () => {
    expect(labelFor(0x07, resolveLayout('qwerty', detected))).toBe('D');
  });

  it('leaves nothing to the position name when detection has an answer', () => {
    expect(labelFor(0x1e, resolveLayout('qwerty', detected))).toBe('&');
  });

  it('still works alone when detection is unavailable', () => {
    expect(labelFor(0x14, resolveLayout('azerty', null))).toBe('A');
    expect(labelFor(0x07, resolveLayout('azerty', null))).toBe('KeyD');
  });
});

describe('the icon set', () => {
  // Board 6e, "KEY LABEL · ICON SET". Twelve glyphs, and they sit *beside*
  // KEYCAP_LABELS rather than replacing it: text mode has to go on printing the
  // name the layout gives, which is the whole meaning of the Text half.
  it('gives the twelve special positions a glyph', () => {
    expect(iconFor(0x52)).toBe('↑');
    expect(iconFor(0x51)).toBe('↓');
    expect(iconFor(0x50)).toBe('←');
    expect(iconFor(0x4f)).toBe('→');
    expect(iconFor(0x28)).toBe('⏎');
    expect(iconFor(0x2a)).toBe('⌫');
    expect(iconFor(0x2c)).toBe('␣');
    expect(iconFor(0xe3)).toBe('⊞');
    expect(iconFor(0xe1)).toBe('⇧');
    expect(iconFor(0x2b)).toBe('⇥');
    expect(iconFor(0x29)).toBe('⎋');
    expect(iconFor(0x4c)).toBe('⌦');
  });

  // Same rule as the text table: one glyph for both sides of the board, since
  // both keycaps print the same thing and the position tells them apart.
  it('gives both sides of a paired modifier the same glyph', () => {
    expect(iconFor(0xe5)).toBe(iconFor(0xe1));
    expect(iconFor(0xe7)).toBe(iconFor(0xe3));
    expect(iconFor(0x58)).toBe(iconFor(0x28));
  });

  it('has nothing to say about a writing key', () => {
    expect(iconFor(0x14)).toBeNull();
    expect(iconFor(0x1e)).toBeNull();
  });

  it('says nothing for a usage the board does not have', () => {
    expect(iconFor(0xffff)).toBeNull();
  });

  // The picker offers every glyph on any key, so the set has to be listable —
  // and a key wears an icon exactly when its label is in here. That test is
  // what replaces a `labelMode` field in the schema.
  it('lists exactly the glyphs the table can produce', () => {
    const produced = new Set(
      ISO_GEOMETRY.map((position) => iconFor(position.usage)).filter(
        (icon): icon is string => icon !== null,
      ),
    );

    expect(new Set(ICON_SET)).toEqual(produced);
    expect(ICON_SET).toHaveLength(12);
  });

  it('holds no duplicate, so the picker cannot show one glyph twice', () => {
    expect(new Set(ICON_SET).size).toBe(ICON_SET.length);
  });
});
