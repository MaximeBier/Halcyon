import type { AnalogEntry } from '../keyboard/decode';
import { geometryFor, placeNewKey } from '../keyboard/geometry';
import { iconFor, labelFor, type LayoutMapLike } from '../keyboard/labels';
import { ontoSurface, type Rect } from './layout';
import type { KeyConfig, OverlayConfig } from '../config/schema';

/**
 * Roughly 20 % of travel: past a brush, short of actuation.
 *
 * Below the firmware's actuation point on purpose — configuring a key should
 * not type it. The smallest travel ever measured in use is 1.4 % (spec §7.3),
 * so this is nowhere near sensor noise either.
 */
export const LEARN_TRAVEL_THRESHOLD = 200;

export function pickLearned(entries: readonly AnalogEntry[]): AnalogEntry | null {
  let best: AnalogEntry | null = null;
  for (const entry of entries) {
    if (entry.travel < LEARN_TRAVEL_THRESHOLD) continue;
    if (!best || entry.travel > best.travel) best = entry;
  }
  return best;
}

/**
 * Adds a key learned by pressing it (spec §8.4).
 *
 * Deduplicated on the matrix index rather than the usage: the index is what
 * identifies a key in the configuration, and what keys the overlay's SVG
 * nodes. Returns a new configuration — the caller hands it to `updateConfig`,
 * which persists and broadcasts it, so mutating the argument would let a
 * change reach the preview without doing either.
 */
export function addLearnedKey(
  config: OverlayConfig,
  entry: AnalogEntry,
  layout: LayoutMapLike | null,
  surface: Rect,
): OverlayConfig {
  if (config.keys.some((key) => key.id === entry.index)) return config;

  const geometry = geometryFor(entry.usage);
  const w = geometry?.w ?? 1;
  const h = geometry?.h ?? 1;
  // Keys already placed never move (spec §8.5). The new one is brought back
  // onto the surface if its reference position falls off it — which is what
  // happens as soon as the board being rebuilt is wider than the stage.
  const placed = ontoSurface(placeNewKey(config.keys, entry.usage), w, h, surface);

  const key: KeyConfig = {
    id: entry.index,
    usage: entry.usage,
    mode: 'key',
    // The glyph wins where there is one (board 6e). Learning is the one moment
    // when nobody has yet decided anything about this key's name, so it is the
    // only moment a default may be chosen without overruling somebody.
    label: iconFor(entry.usage) ?? labelFor(entry.usage, layout),
    x: placed.x,
    y: placed.y,
    w,
    h,
  };

  return { ...config, keys: [...config.keys, key] };
}

export function removeKey(config: OverlayConfig, id: number): OverlayConfig {
  return removeKeys(config, [id]);
}

export function removeKeys(config: OverlayConfig, ids: readonly number[]): OverlayConfig {
  return { ...config, keys: config.keys.filter((key) => !ids.includes(key.id)) };
}
