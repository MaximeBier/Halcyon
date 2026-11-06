/**
 * The colours that paint nothing for the keys concerned, and why (board
 * Editor-Tooltip, spec §16.13). One rule for the global panel and the key
 * popover, so the two can never disagree about the same key.
 *
 * - **Background** under `outline`: a key at rest has no face at all, and
 *   once it fires it wears Press depth (scene.ts) — the rest colour is never
 *   drawn. Under `hidden` it is precisely what a key wears the moment it
 *   appears, which is why that mode leaves it alone.
 * - **Press depth** on a Gamepad key (`mode: 'axis'`): it fills with Triggered
 *   and never fires, so the swap that would bring Press depth never happens
 *   (spec §7.4).
 *
 * `profile` is the global panel: every key of the profile, and the keys still
 * to come. A key added later inherits the global rest, so Background is only
 * out of use while the global rest itself is an outline; it is a keyboard
 * key, so the panel never greys Press depth — not even on a profile of
 * gamepad inputs only, whose next key would fill with it. `selection` is the
 * popover: the selected keys and nothing else.
 */
import type { GlobalStyle, KeyConfig } from '../config/schema';

export const NO_BACKGROUND = 'No background while At rest is “Outline only”.';
export const GAMEPAD_FILL = 'Gamepad keys fill with Triggered.';

export type UnusedColors = Partial<Record<'restColor' | 'fillColor', string>>;

export function unusedColors(
  global: Pick<GlobalStyle, 'restVisibility'>,
  keys: readonly KeyConfig[],
  scope: 'profile' | 'selection',
): UnusedColors {
  const unused: UnusedColors = {};

  const outlined = keys.every(
    (key) => (key.style?.restVisibility ?? global.restVisibility) === 'outline',
  );
  const noFace =
    outlined && (scope === 'profile' ? global.restVisibility === 'outline' : keys.length > 0);
  if (noFace) unused.restColor = NO_BACKGROUND;

  if (scope === 'selection' && keys.length > 0 && keys.every((key) => key.mode === 'axis')) {
    unused.fillColor = GAMEPAD_FILL;
  }

  return unused;
}
