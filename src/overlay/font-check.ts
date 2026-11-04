import { FONT_CATALOG } from '../config/fonts';

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
