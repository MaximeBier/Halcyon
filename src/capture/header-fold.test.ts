import { describe, it, expect } from 'vitest';
import { fitHeader, LAST_FOLD, type Fold } from './header-fold';

/** A header whose content is as wide as each fold makes it, in a window this wide. */
function header(widths: Record<Fold, number>, window: number) {
  let fold: Fold = 1;
  const seen: Fold[] = [];
  return {
    set: async (next: Fold) => {
      fold = next;
      seen.push(next);
    },
    overflows: () => widths[fold] > window,
    get fold() {
      return fold;
    },
    seen,
  };
}

// Each step takes something off; the last ones only shrink what is left.
const WIDTHS: Record<Fold, number> = {
  1: 1200,
  2: 1100,
  3: 900,
  4: 850,
  5: 760,
  6: 700,
  7: 560,
};

describe('the header folds by steps, measured (board Editor-HeaderNarrow)', () => {
  it('has seven steps: the last leaves the keyboard and OBS their dot only', () => {
    expect(LAST_FOLD).toBe(7);
  });

  it('shows everything when everything fits', async () => {
    const h = header(WIDTHS, 1400);
    expect(await fitHeader(h.set, h.overflows)).toBe(1);
  });

  it('gives up one thing at a time, in order, and no more than it must', async () => {
    // 2 the word; 3 the two names; 4 "Setup · N/3"; 5 the keyboard's and
    // OBS's names cut, little by little, together; 6 Resume as an icon.
    for (const [window, fold] of [
      [1150, 2],
      [1000, 3],
      [880, 4],
      [800, 5],
      [720, 6],
      [600, 7],
    ] as const) {
      const h = header(WIDTHS, window);
      expect(await fitHeader(h.set, h.overflows)).toBe(fold);
    }
  });

  it('starts again from everything, so a wider window gets its word back', async () => {
    const h = header(WIDTHS, 1400);
    await h.set(7);
    expect(await fitHeader(h.set, h.overflows)).toBe(1);
    expect(h.seen.at(-1)).toBe(1);
  });

  it('goes no further than the last step, which is the one that always fits', async () => {
    const h = header(WIDTHS, 300);
    expect(await fitHeader(h.set, h.overflows)).toBe(7);
  });

  it('folds earlier for longer pills and for Resume: it measures, it holds no threshold', async () => {
    // "OBS disconnected", "Other capture pages open", "Resume setup · 2/3".
    const longer = Object.fromEntries(
      Object.entries(WIDTHS).map(([fold, width]) => [fold, width + 200]),
    ) as Record<Fold, number>;
    const ok = header(WIDTHS, 1250);
    const ko = header(longer, 1250);
    expect(await fitHeader(ok.set, ok.overflows)).toBe(1);
    expect(await fitHeader(ko.set, ko.overflows)).toBe(3);
  });
});
