// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { missingFont, missingFonts } from './font-check';

/** A machine that has the families listed, and draws anything else in its fallback. */
function machine(...installed: string[]) {
  return vi.fn((font: string) => {
    const requested = /'([^']+)'/.exec(font)?.[1];
    const fallback = font.endsWith('serif') ? 120 : 100;
    return requested && installed.includes(requested) ? 137 : fallback;
  });
}

describe('missingFont', () => {
  it('says nothing about a family this machine draws', () => {
    expect(missingFont('Bahnschrift', 700, machine('Bahnschrift'))).toBeNull();
  });

  it('names a family this machine falls back from', () => {
    expect(missingFont('Bahnschrift', 700, machine('Arial'))).toBe('Bahnschrift');
  });

  it('never measures a face the overlay brings itself', () => {
    // They are served with the page: a check could only fail on a file still
    // loading, and `swap` already answers that.
    const measure = machine();

    expect(missingFont('Fredoka', 700, measure)).toBeNull();
    expect(measure).not.toHaveBeenCalled();
  });

  it('measures at the weight the label is drawn at', () => {
    const measure = machine('Bahnschrift');
    missingFont('Bahnschrift', 600, measure);

    expect(measure.mock.calls.every(([font]) => font.startsWith('600 '))).toBe(true);
  });
});

describe('missingFonts', () => {
  const face = (fontFamily: string, fontWeight = 700) => ({ fontFamily, fontWeight });

  it('names each missing family once, with the keys that ask for it out of all of them', () => {
    const keys = [
      face('Archivo'),
      face('Bahnschrift'),
      face('Bahnschrift'),
      face('Impact', 400),
      face('Arial'),
    ];

    expect(missingFonts(keys, machine('Arial'))).toEqual([
      { family: 'Bahnschrift', keys: 2, total: 5 },
      { family: 'Impact', keys: 1, total: 5 },
    ]);
  });

  it('reports nothing when every face is drawn', () => {
    expect(missingFonts([face('Archivo'), face('Arial')], machine('Arial'))).toEqual([]);
  });

  it('measures a family and weight once, however many keys share it', () => {
    const measure = machine();
    missingFonts([face('Bahnschrift'), face('Bahnschrift'), face('Bahnschrift')], measure);
    const once = measure.mock.calls.length;

    measure.mockClear();
    missingFonts([face('Bahnschrift')], measure);

    expect(measure.mock.calls.length).toBe(once);
  });
});
