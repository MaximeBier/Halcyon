import type { OverlayConfig } from '../config/schema';
import type { MissingFont } from '../protocol/messages';

/**
 * What Diagnostics asks someone to look at (spec §11): only what is going on
 * now and needs a gesture, each with the gesture. These, and nothing else,
 * light the gear's dot and count in "Diagnostics · N to check" — the journal
 * is history, read under ACTIVITY, and never raises an alarm on its own.
 */
export interface AttentionItem {
  id: string;
  text: string;
  /** The gesture the line offers: back to auto, or to the font choice. */
  action: 'use-auto' | 'change-font';
}

const LAYOUT_NAMES: Record<Exclude<OverlayConfig['layoutOverride'], 'auto'>, string> = {
  azerty: 'AZERTY',
  qwerty: 'QWERTY',
  qwertz: 'QWERTZ',
};

/** Fonts first, then the layout: the order of the board (OBS-Diagnostics). */
export function needsAttention(
  layout: OverlayConfig['layoutOverride'],
  missingFonts: readonly MissingFont[],
): AttentionItem[] {
  const items: AttentionItem[] = missingFonts.map(({ family, keys, total }) => ({
    id: `font:${family}`,
    // The overlay goes on drawing, in the face it brings itself, which is why
    // the line says what is drawn rather than that something failed.
    text: `${family} is not installed on the PC running OBS. ${
      keys === total ? 'All keys' : keys === 1 ? '1 key' : `${keys} keys`
    } drawn in Archivo.`,
    action: 'change-font',
  }));
  if (layout !== 'auto') {
    items.push({
      id: 'layout',
      text: `Keyboard layout forced to ${LAYOUT_NAMES[layout]} — auto-detection is off.`,
      action: 'use-auto',
    });
  }
  return items;
}
