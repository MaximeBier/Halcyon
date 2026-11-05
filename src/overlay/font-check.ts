import { FONT_CATALOG } from '../config/fonts';
import type { MissingFont } from '../protocol/messages';

/** Wide and narrow letters both, so that two faces rarely measure alike. */
const SAMPLE = 'mmmmmmmmmmlli10WQ@#';
const FALLBACKS = ['monospace', 'serif'];

/**
 * The family asked for when this machine cannot draw it, or `null`.
 *
 * A family that is not installed is not an error anywhere: the browser falls
 * back to the next one in the stack and says nothing. The only way to know is
 * to measure — the same text in the family over a fallback, against the
 * fallback alone. Equal widths over two different fallbacks mean the family
 * never got a say.
 *
 * The embedded faces are not measured: they come with the page, and one still
 * loading would read as missing for the few frames `swap` already covers.
 *
 * `measure` returns the width of `SAMPLE` in a CSS font shorthand; the overlay
 * hands it a canvas.
 */
export function missingFont(
  family: string,
  weight: number,
  measure: (font: string) => number,
): string | null {
  if (FONT_CATALOG.some((face) => face.family === family)) return null;

  const drawn = FALLBACKS.some(
    (fallback) =>
      measure(`${weight} 72px '${family}', ${fallback}`) !== measure(`${weight} 72px ${fallback}`),
  );
  return drawn ? null : family;
}

/**
 * Every family this overlay's keys ask for and cannot draw, with how many keys
 * ask for it out of how many there are.
 *
 * Counted here, where the keys are drawn, and not by the capture page from
 * its own profile: with scenes linked to profiles, the source in OBS may be
 * drawing another one. Each family and weight is measured once, however many
 * keys share it.
 */
export function missingFonts(
  styles: readonly { fontFamily: string; fontWeight: number }[],
  measure: (font: string) => number,
): MissingFont[] {
  const verdicts = new Map<string, string | null>();
  const counts = new Map<string, number>();
  for (const { fontFamily, fontWeight } of styles) {
    const face = `${fontWeight} ${fontFamily}`;
    if (!verdicts.has(face)) verdicts.set(face, missingFont(fontFamily, fontWeight, measure));
    const missing = verdicts.get(face);
    if (missing) counts.set(missing, (counts.get(missing) ?? 0) + 1);
  }
  return [...counts].map(([family, keys]) => ({ family, keys, total: styles.length }));
}

/**
 * A measurer backed by a canvas, for the page that draws — or `null` without
 * one, where measuring nothing would report every family missing.
 */
export function canvasMeasure(): ((font: string) => number) | null {
  const context = document.createElement('canvas').getContext('2d');
  if (!context) return null;
  return (font) => {
    context.font = font;
    return context.measureText(SAMPLE).width;
  };
}
