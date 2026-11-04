import { FONT_CATALOG } from '../config/fonts';
import { isStyleValue } from '../config/validate';

/** The two fields of a `FontData` this module reads. */
export interface LocalFace {
  family: string;
  style: string;
}

export interface InstalledWeight {
  weight: number;
  /** The face's own name for itself, which is what the Style row offers. */
  style: string;
}

export interface InstalledFamily {
  family: string;
  weights: InstalledWeight[];
}

/**
 * Style words and the weight each stands for, in the usual OpenType sense.
 * Written without spaces or hyphens: "Semi Bold", "Semi-Bold" and "SemiBold"
 * are one name spelt three ways by three foundries.
 */
const WEIGHTS: Record<string, number> = {
  thin: 100,
  hairline: 100,
  extralight: 200,
  ultralight: 200,
  light: 300,
  regular: 400,
  normal: 400,
  book: 400,
  roman: 400,
  medium: 500,
  semibold: 600,
  demibold: 600,
  bold: 700,
  extrabold: 800,
  ultrabold: 800,
  black: 900,
  heavy: 900,
};

/**
 * The weight a face's style name stands for, or `null` when no weight can
 * reach it.
 *
 * A label is drawn upright, and `font-weight` is all it can ask for: an italic,
 * or a condensed face of a family, is a face no setting of ours would ever
 * draw, and offering it in the Style row would draw a different one. A name
 * this table cannot read is left out rather than guessed at.
 */
export function weightOf(style: string): number | null {
  const word = style.toLowerCase().replace(/[\s_-]+/g, '');
  return WEIGHTS[word] ?? null;
}

const embedded = new Set(FONT_CATALOG.map(({ family }) => family.toLowerCase()));

/**
 * The installed families a label can be drawn in, as the menu lists them.
 *
 * Left out: a family named like one the overlay brings itself — the stack
 * could only ever reach one of the two, and two tiles for one name would say
 * otherwise; a family with no face a weight can reach; and a name a profile
 * could not hold, which would be refused on the next read anyway.
 */
export function families(faces: readonly LocalFace[]): InstalledFamily[] {
  const byFamily = new Map<string, Map<number, string>>();

  for (const { family, style } of faces) {
    if (embedded.has(family.toLowerCase()) || !isStyleValue('fontFamily', family)) continue;
    const weight = weightOf(style);
    if (weight === null) continue;

    const weights = byFamily.get(family) ?? new Map<number, string>();
    if (!weights.has(weight)) weights.set(weight, style);
    byFamily.set(family, weights);
  }

  return [...byFamily]
    .map(([family, weights]) => ({
      family,
      weights: [...weights]
        .map(([weight, style]) => ({ weight, style }))
        .sort((a, b) => a.weight - b.weight),
    }))
    .sort((a, b) => a.family.localeCompare(b.family));
}

/**
 * The weight a family is drawn at when it is first chosen: bold, which is
 * what every embedded face is drawn at, or the face nearest to it — the
 * heavier one when two are as near, since a label is read on a stream.
 */
export function defaultWeight(weights: readonly number[]): number {
  return weights.reduce((best, weight) => {
    const gap = Math.abs(weight - 700) - Math.abs(best - 700);
    return gap < 0 || (gap === 0 && weight > best) ? weight : best;
  });
}
