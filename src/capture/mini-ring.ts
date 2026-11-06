/**
 * Where the accent ring sits on the mini key of Colors (board
 * Editor-GlobalStyle, spec §16.13): around the part the hovered row paints.
 *
 * The face is only what the fill leaves of it — the part of Background a
 * viewer actually sees (a correction of the board, 2026-11-06). As the board
 * draws it, both are rings **inside the border**, square-cornered, inside a
 * clip that has the key's own rounding less the border — so the bottom
 * corners of a fill follow the key, and its top edge stays straight across it. A ring with a radius of its own, laid on
 * the key's outer edge, covered the border and rounded corners in the middle
 * of the key.
 *
 * The border is the one zone on the edge itself: it is ringed on the key, not
 * here (`null`).
 */
export interface MiniRing {
  /** The key's inside: inset by the border width, rounded by what is left of the radius. */
  clip: { inset: number; radius: number };
  /** The ringed zone, from the top left of that inside. */
  box: { x: number; y: number; w: number; h: number };
  /**
   * The ring's own corners — top left, top right, bottom right, bottom left —
   * rounded like the key where they are the key's corners, square where they
   * cross it: the ring follows Radius instead of being cut by it.
   */
  radii: [number, number, number, number];
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Below this, two edges are the same edge: the cut is arithmetic, not geometry. */
const EPSILON = 1e-6;

export function miniRing(
  zone: 'face' | 'depth' | 'border',
  key: { size: number; radius: number; border: { width: number }; fill: Rect },
): MiniRing | null {
  if (zone === 'border') return null;

  const inset = key.border.width;
  const inner = Math.max(0, key.size - 2 * inset);
  const clip = { inset, radius: Math.max(0, key.radius - inset) };
  const ringed = (box: Rect): MiniRing => {
    const top = box.y < EPSILON;
    const left = box.x < EPSILON;
    const bottom = box.y + box.h > inner - EPSILON;
    const right = box.x + box.w > inner - EPSILON;
    const r = clip.radius;
    return {
      clip,
      box,
      radii: [
        top && left ? r : 0,
        top && right ? r : 0,
        bottom && right ? r : 0,
        bottom && left ? r : 0,
      ],
    };
  };

  // The fill, cut to the inside of the border.
  const left = Math.max(key.fill.x, inset);
  const top = Math.max(key.fill.y, inset);
  const right = Math.min(key.fill.x + key.fill.w, key.size - inset);
  const bottom = Math.min(key.fill.y + key.fill.h, key.size - inset);
  const fill = {
    x: left - inset,
    y: top - inset,
    w: Math.max(0, right - left),
    h: Math.max(0, bottom - top),
  };
  if (zone === 'depth') return ringed(fill);

  // Background: only the face the fill leaves visible. The fill always grows
  // from one side across the whole key, so what is left is one rectangle, on
  // the far side of it.
  if (fill.w === 0 || fill.h === 0) return ringed({ x: 0, y: 0, w: inner, h: inner });
  if (fill.w >= inner) {
    return ringed(
      fill.y > 0
        ? { x: 0, y: 0, w: inner, h: fill.y }
        : { x: 0, y: fill.h, w: inner, h: inner - fill.h },
    );
  }
  return ringed(
    fill.x > 0
      ? { x: 0, y: 0, w: fill.x, h: inner }
      : { x: fill.w, y: 0, w: inner - fill.w, h: inner },
  );
}
