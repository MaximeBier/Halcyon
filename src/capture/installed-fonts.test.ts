// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { defaultWeight, families, weightOf } from './installed-fonts';

const face = (family: string, style: string) => ({ family, style });

describe('weightOf', () => {
  it('reads the weight a style name stands for', () => {
    expect(weightOf('Regular')).toBe(400);
    expect(weightOf('Bold')).toBe(700);
    expect(weightOf('SemiBold')).toBe(600);
    expect(weightOf('Semi Bold')).toBe(600);
    expect(weightOf('Extra-Light')).toBe(200);
    expect(weightOf('Black')).toBe(900);
  });

  it('refuses an italic: a label has no style but upright', () => {
    expect(weightOf('Bold Italic')).toBeNull();
    expect(weightOf('Oblique')).toBeNull();
  });

  it('refuses a width variant, which no weight can choose', () => {
    // `font-weight` reaches the bold of a family, never its condensed face: a
    // row offering "SemiBold Condensed" would draw the plain SemiBold.
    expect(weightOf('SemiBold Condensed')).toBeNull();
    expect(weightOf('Narrow')).toBeNull();
  });

  it('refuses a style it cannot read rather than guessing', () => {
    expect(weightOf('Outline Shadow')).toBeNull();
  });
});

describe('families', () => {
  it('groups the faces by family, each weight once, lightest first', () => {
    const result = families([
      face('Bahnschrift', 'Bold'),
      face('Bahnschrift', 'Regular'),
      face('Bahnschrift', 'Bold Italic'),
      face('Bahnschrift', 'Bold'),
    ]);

    expect(result).toEqual([
      {
        family: 'Bahnschrift',
        weights: [
          { weight: 400, style: 'Regular' },
          { weight: 700, style: 'Bold' },
        ],
      },
    ]);
  });

  it('sorts the families by name', () => {
    const names = families([face('Segoe UI', 'Regular'), face('Arial', 'Regular')]).map(
      (entry) => entry.family,
    );

    expect(names).toEqual(['Arial', 'Segoe UI']);
  });

  it('leaves out a family named like one the overlay brings itself', () => {
    // An installed Archivo and the embedded one would be two tiles for one
    // name, and the stack could only ever reach the first.
    const names = families([
      face('Archivo', 'Bold'),
      face('fredoka', 'Bold'),
      face('Arial', 'Bold'),
    ]);

    expect(names.map((entry) => entry.family)).toEqual(['Arial']);
  });

  it('leaves out a family with no face a weight can reach', () => {
    expect(families([face('Script', 'Italic')])).toEqual([]);
  });

  it('leaves out a family whose name could not sit in a profile', () => {
    expect(families([face("Bad'Name", 'Regular')])).toEqual([]);
  });
});

describe('defaultWeight', () => {
  it('takes bold when the family has it', () => {
    expect(defaultWeight([400, 700, 900])).toBe(700);
  });

  it('takes the face nearest to bold otherwise', () => {
    expect(defaultWeight([300, 400, 600])).toBe(600);
    expect(defaultWeight([400, 900])).toBe(900);
  });

  it('takes the heavier of two faces equally near', () => {
    expect(defaultWeight([600, 800])).toBe(800);
  });
});
