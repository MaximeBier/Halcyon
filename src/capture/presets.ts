import { setGlobalStyle } from '../config/edit';
import { DEFAULT_STYLE, type OverlayConfig } from '../config/schema';

/**
 * Three colours chosen to work with each other.
 *
 * What makes the style panel usable by someone who is not a colourist, and what
 * §9.2 asks of the defaults — except that the lot of 2026-08-21 offers six of
 * them instead of one. The three are set **together**: picking an active colour
 * and leaving the travel fill behind is exactly what someone does by hand when
 * the result comes out wrong.
 */
export interface Preset {
  name: string;
  activeColor: string;
  fillColor: string;
  restColor: string;
}

/**
 * The six of the lot, in its order.
 *
 * The first is the default, read from the tokens rather than copied beside
 * them: a literal here would drift the day the mockup moves a colour, and the
 * swatch would go on claiming a trio nothing wears.
 */
export const PRESETS: readonly Preset[] = [
  {
    name: 'Blue',
    activeColor: DEFAULT_STYLE.activeColor,
    fillColor: DEFAULT_STYLE.fillColor,
    restColor: DEFAULT_STYLE.restColor,
  },
  { name: 'Green', activeColor: '#5ED49E', fillColor: '#2E5D48', restColor: '#121815' },
  { name: 'Coral', activeColor: '#F2755F', fillColor: '#6B3229', restColor: '#1A1312' },
  { name: 'Amber', activeColor: '#F5A64B', fillColor: '#6E4A24', restColor: '#191510' },
  { name: 'Violet', activeColor: '#B48CF2', fillColor: '#4E3D78', restColor: '#16131D' },
  { name: 'Cyan', activeColor: '#5BD0E8', fillColor: '#2D5A66', restColor: '#101719' },
  /**
   * Two neutrals, added on 2026-08-22 and **appended, never inserted**: the six
   * above keep the order and the positions the lot gave them, so no swatch
   * moves under someone who learned where it was.
   *
   * `Paper` runs the ramp the other way round. The six above go dark to bright
   * — rest the darkest, active the most vivid — and a light theme cannot: a
   * white active on a pale rest is nothing to see. So its keys go *dark* on
   * actuation. **It is the direction that carries the signal, not the colour.**
   *
   * One thing a light theme cannot fix from here: the label keeps its fixed
   * light colour and its dark outline (spec §16.3), because that decision is
   * global and not per preset. The outline is what makes it readable on a pale
   * key, which is what it was for — but it will not be elegant.
   */
  { name: 'Graphite', activeColor: '#DDE1E9', fillColor: '#565B66', restColor: '#0E1013' },
  { name: 'Paper', activeColor: '#2A2D34', fillColor: '#9BA1AC', restColor: '#EDEFF3' },
];

const COLORS = ['activeColor', 'fillColor', 'restColor'] as const;

/** The colours of a preset, in one write — so one undo puts them all back. */
export function withPreset(config: OverlayConfig, preset: Preset): OverlayConfig {
  return COLORS.reduce(
    (next, property) => setGlobalStyle(next, property, preset[property]),
    config,
  );
}

/**
 * The preset a style is wearing, or `null` once any of the three has moved.
 *
 * Case-insensitive, and that is not politeness: `<input type="color">` reports
 * its value lowercased whatever was set, so a preset picked from the swatch
 * beside it comes back in another case — and a strict comparison would take the
 * mark straight off the swatch just clicked.
 *
 * Two of three is not a preset. Claiming one that is no longer on screen is
 * worse than claiming none.
 */
export function presetFor(style: Pick<Preset, 'activeColor' | 'fillColor' | 'restColor'>) {
  const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

  return (
    PRESETS.find((preset) => COLORS.every((property) => same(style[property], preset[property]))) ??
    null
  );
}
