import { describe, it, expect } from 'vitest';
import { fitHeader, headerSpills, LAST_FOLD, spills, type Fold, type Laid } from './header-fold';

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

/** A box on the line, or off it, holding what it holds. */
function box(right: number, children: Laid[] = [], more: Partial<Laid> = {}): Laid {
  return { right, end: right, floating: false, clips: false, children, ...more };
}

describe('the header measures its own items only (a wrong OBS password)', () => {
  it('leaves out a popover hanging from a pill', () => {
    // The run of pills ends at 360; the OBS popover hangs under its pill and
    // reaches 520 — well past the run, in a header with all the room.
    const pills = box(360, [
      box(180, [box(180)]),
      box(360, [box(360), box(520, [box(520)], { floating: true })]),
    ]);
    expect(spills(pills)).toBe(false);
  });

  it('still sees a run of pills spilling out of its own box', () => {
    // Squeezed, the run is narrower than its pills' floors.
    expect(spills(box(300, [box(180), box(360)]))).toBe(true);
  });

  it('still sees a pill spilling out from deeper down', () => {
    expect(spills(box(300, [box(300, [box(360)])]))).toBe(true);
  });

  it('does not count what a cut name hides', () => {
    expect(spills(box(200, [box(200, [box(400)], { clips: true })]))).toBe(false);
  });

  it('counts the end padding as out of room', () => {
    expect(spills(box(1000, [box(990)], { end: 980 }))).toBe(true);
    expect(spills(box(1000, [box(980)], { end: 980 }))).toBe(false);
  });

  it('gives a pixel of slack to a run that fits exactly', () => {
    expect(spills(box(360, [box(360.6)]))).toBe(false);
  });
});

describe('the header, read from the page', () => {
  /**
   * An element whose right edge is `right`, with `style` inline. Borderless
   * by hand: jsdom gives a border with no style a width all the same.
   */
  function el(right: number, style = '', children: Element[] = []): HTMLElement {
    const node = document.createElement('div');
    node.setAttribute('style', `border: 0; ${style}`);
    node.getBoundingClientRect = () => ({ right }) as DOMRect;
    node.append(...children);
    return node;
  }

  it('stays whole at full width with the OBS popover open under its pill', async () => {
    // A 1909 px window: the bar ends at 1909 with 20 px of padding, the left
    // block at 1500, the pills at 360 — and the popover reaches 700.
    const popover = el(700, 'position: absolute', [el(700)]);
    const slot = el(360, 'position: relative', [el(360), popover]);
    const status = el(360, '', [el(180), slot]);
    const lead = el(1500, '', [el(120), status]);
    const bar = el(1909, 'padding-right: 20px', [lead, el(1889)]);

    expect(headerSpills(bar, lead)).toBe(false);
    expect(
      await fitHeader(
        async () => {},
        () => headerSpills(bar, lead),
      ),
    ).toBe(1);
  });

  it('folds when the pills really spill', () => {
    const status = el(300, '', [el(180), el(360)]);
    const lead = el(1500, '', [status]);
    const bar = el(1909, 'padding-right: 20px', [lead]);

    expect(headerSpills(bar, lead)).toBe(true);
  });

  it('folds when the right block runs into the end padding', () => {
    const lead = el(1500);
    const bar = el(1909, 'padding-right: 20px', [lead, el(1900)]);

    expect(headerSpills(bar, lead)).toBe(true);
  });
});
