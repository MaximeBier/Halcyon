import { MAX_TRAVEL } from '../keyboard/analog-report';
import { OVERLAY_TOKENS } from '../styles/tokens';
import type { FillDirection, ResolvedConfig } from '../config/schema';
import type { FrameKey } from '../protocol/messages';

/**
 * Outline thickness, as a fraction of the label size.
 *
 * Enough to detach a light label from a light fill — the active colour against
 * the label colour is a contrast of 1.96, far under anything readable — and
 * thin enough not to thicken the glyph at stream size.
 */
const LABEL_OUTLINE_RATIO = 0.14;

export interface SceneFill {
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
}

export interface SceneKey {
  id: number;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  radius: number;
  baseFill: string;
  borderColor: string;
  fill: SceneFill;
  /**
   * One colour, whatever moves behind it.
   *
   * It used to be computed from the background, so the text changed shade as
   * a key was pressed — readable, but restless, and on a stream the eye
   * follows the flicker instead of the key. The outline below does that work
   * now, and it does it at every travel rather than at two.
   */
  labelFill: string;
  labelOutline: string;
  /** Proportional to the label, like its size (spec §16.3). */
  labelOutlineWidth: number;
  fontFamily: string;
  fontWeight: number;
  /** Computed from the key height (spec 16.3). */
  fontSize: number;
  opacity: number;
  /**
   * The key is in axis mode. The scene flags it; the renderer decides whether
   * to do anything with it - the editor does, the overlay never does.
   */
  axis: boolean;
}

export interface Scene {
  width: number;
  height: number;
  keys: SceneKey[];
}

function fillRect(
  x: number,
  y: number,
  w: number,
  h: number,
  ratio: number,
  direction: FillDirection,
): { x: number; y: number; w: number; h: number } {
  switch (direction) {
    case 'down':
      return { x, y, w, h: h * ratio };
    case 'right':
      return { x, y, w: w * ratio, h };
    case 'left':
      return { x: x + w - w * ratio, y, w: w * ratio, h };
    // `up` is also the fallback: the switch is exhaustive over the type,
    // which protects the code and not the data. An unknown direction returned
    // undefined, the spread then dropped x/y/w/h, and that key stopped showing
    // its travel for good — without an error anywhere.
    case 'up':
    default:
      return { x, y: y + h - h * ratio, w, h: h * ratio };
  }
}

export interface SceneOptions {
  /**
   * Translate the scene so the topmost key touches the top edge and the
   * leftmost the left edge (spec §5.4).
   *
   * On for the broadcast, off for the editor, and the asymmetry is the point.
   * Four arrows arranged in the middle of the work surface must arrive in the
   * corner of the OBS source, or the streamer is handed a source that is
   * mostly transparent by construction and has to crop it by hand. The editor
   * cannot do the same: the keys have to stay under the cursor dragging them,
   * and moving the one that defines an edge would shift every other key on the
   * stage at once.
   *
   * A property of the rendering, never of the configuration. Writing packed
   * positions back would pull the layout a little further into the corner on
   * every key removed.
   */
  pack?: boolean;
}

export function buildScene(
  config: ResolvedConfig,
  frame: readonly FrameKey[],
  { pack = false }: SceneOptions = {},
): Scene {
  const { unit, gap, restFilled } = config;
  const states = new Map(frame.map(([id, travel, active]) => [id, { travel, active }]));

  let width = 0;
  let height = 0;

  // Deduplicated here rather than only on import: a config message crossing
  // obs-websocket is validated as "an object" and no further, so two equal ids
  // would kill the keyed each block that draws them.
  const drawn = new Set<number>();
  const unique = config.keys.filter((key) => {
    if (drawn.has(key.id)) return false;
    drawn.add(key.id);
    return true;
  });

  // Guarded on the empty case: `Math.min()` of nothing is Infinity, every
  // coordinate downstream becomes NaN, and the result is an SVG that renders
  // blank without a single error to say why.
  const originX = pack && unique.length > 0 ? Math.min(...unique.map((key) => key.x)) : 0;
  const originY = pack && unique.length > 0 ? Math.min(...unique.map((key) => key.y)) : 0;

  const keys = unique.map((key): SceneKey => {
    // A key missing from the frame means zero travel and inactive (spec 7.3).
    const state = states.get(key.id) ?? { travel: 0, active: 0 as const };
    // Clamped, because the frame crosses obs-websocket and anyone
    // authenticated on it can speak. A ratio above one draws a fill several
    // times the key height, over its neighbours.
    const ratio = Number.isFinite(state.travel)
      ? Math.min(1, Math.max(0, state.travel / MAX_TRAVEL))
      : 0;

    // The translation is applied here, once, and everything else — the fill
    // rectangle, the label, the measured size — is derived from these two. A
    // scene that shifted the key and not its fill would paint the travel over
    // the neighbour.
    const x = (key.x - originX) * unit + gap / 2;
    const y = (key.y - originY) * unit + gap / 2;
    // A gap wider than the key itself is the user's to set, and a rect with a
    // negative width is an SVG error rather than a small key.
    const w = Math.max(0, key.w * unit - gap);
    const h = Math.max(0, key.h * unit - gap);

    // Axis mode never switches its background (spec 7.4): its active color
    // serves as the fill color, and nothing about it changes on actuation.
    //
    // Key mode swaps the two colors when the key fires. The fill is painted
    // over the background, so putting the active color underneath hid it
    // entirely on a fully pressed key — the one thing worth seeing, covered by
    // the travel it came from. Swapping keeps the active color on top, where
    // it grows with the press, while the travel stays readable against the
    // fill color behind it.
    const actuated = key.mode === 'key' && state.active === 1;
    const fillColor = actuated || key.mode === 'axis' ? key.style.activeColor : key.style.fillColor;
    // Switched off, a resting key has no background at all — an overlay of
    // outlines, where the keys appear as the fingers travel. What an actuated
    // key paints is untouched: that is the signal, not the backdrop.
    const baseFill = actuated
      ? key.style.fillColor
      : restFilled
        ? key.style.restColor
        : 'transparent';

    width = Math.max(width, (key.x - originX + key.w) * unit);
    height = Math.max(height, (key.y - originY + key.h) * unit);

    return {
      id: key.id,
      label: key.label,
      x,
      y,
      w,
      h,
      radius: key.style.radius,
      baseFill,
      // The second actuation signal. Swapping the fill colours makes a key at
      // full travel that never fired and a key that fired at zero travel both
      // render as one flat fill colour; the border separates them, and it
      // reads at any travel — including none, which is where a low actuation
      // point puts it.
      borderColor: actuated ? key.style.activeColor : OVERLAY_TOKENS.keyBorder,
      fill: { ...fillRect(x, y, w, h, ratio, key.style.fillDirection), color: fillColor },
      labelFill: OVERLAY_TOKENS.keyLabel,
      labelOutline: OVERLAY_TOKENS.keyLabelOutline,
      labelOutlineWidth: h * OVERLAY_TOKENS.keyLabelRatio * LABEL_OUTLINE_RATIO,
      fontFamily: key.style.fontFamily,
      fontWeight: key.style.fontWeight,
      // Proportional: a frozen pixel size breaks on resize and becomes
      // unreadable at the real stream size (mockup 4b).
      fontSize: h * OVERLAY_TOKENS.keyLabelRatio,
      opacity: key.style.opacity,
      axis: key.mode === 'axis',
    };
  });

  return { width, height, keys };
}

/**
 * Rounds a pixel size up to a whole pixel, dust and all.
 *
 * **Up**, because a browser source one pixel short crops — silently, on the
 * two edges hardest to notice. And **the dust first**, because
 * `(x - origin + w) * unit` is exact in arithmetic and not in floats: it
 * arrives as `109.00000000000001` as readily as `200.99999999999997`, so a
 * bare `Math.ceil` would answer 110 to a scene that measures 109.
 *
 * A thousandth of a pixel is far below anything a source can express, and far
 * above the error, which lands in the last bit or two.
 */
const DUST = 1e-3;
const wholePixels = (value: number) => Math.max(0, Math.ceil(value - DUST));

/**
 * Size to give the browser source in OBS, in whole pixels.
 *
 * The packed bounding box, never the raw one: an unpacked measurement
 * describes an area whose top and left are empty by construction, and handing
 * that figure to someone sizing a source is worse than handing them none.
 *
 * Measured by building the scene rather than by a formula of its own, so the
 * number quoted and the pixels drawn cannot drift apart.
 *
 * Whole pixels because **this figure is typed into OBS**, which takes
 * integers. It stays true even once every key is on the quarter grid: an
 * imported profile is under no obligation to be, and neither is `unit`.
 */
export function recommendedSize(config: ResolvedConfig): { width: number; height: number } {
  const { width, height } = buildScene(config, [], { pack: true });
  return { width: wholePixels(width), height: wholePixels(height) };
}
