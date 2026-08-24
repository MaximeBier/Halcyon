import { iconFor, labelFor, resolveLayout, type LayoutMapLike } from '../keyboard/labels';
import type {
  GlobalStyle,
  KeyConfig,
  KeyMode,
  KeyStyle,
  LayoutOverride,
  OverlayConfig,
} from './schema';

/**
 * Every write to the configuration is a new object, top to bottom.
 *
 * Not a matter of taste: `App.svelte` holds the configuration in a rune, and
 * the broadcaster compares what it is asked to publish against what it last
 * sent. Mutating a key in place would change both sides of that comparison at
 * once, so the change would be persisted, invisible to the comparison, and
 * never broadcast — the overlay would keep the previous style until something
 * else happened to be published.
 */
function patchKeys(
  config: OverlayConfig,
  ids: readonly number[],
  patch: (key: KeyConfig) => KeyConfig,
): OverlayConfig {
  return { ...config, keys: config.keys.map((key) => (ids.includes(key.id) ? patch(key) : key)) };
}

export function setGlobalStyle<K extends keyof GlobalStyle>(
  config: OverlayConfig,
  property: K,
  value: GlobalStyle[K],
): OverlayConfig {
  return { ...config, style: { ...config.style, [property]: value } };
}

export function setKeyStyle<K extends keyof KeyStyle>(
  config: OverlayConfig,
  ids: readonly number[],
  property: K,
  value: KeyStyle[K],
): OverlayConfig {
  return patchKeys(config, ids, (key) => ({ ...key, style: { ...key.style, [property]: value } }));
}

/**
 * Hands one property back to inheritance.
 *
 * The bag is dropped entirely once it holds nothing, rather than left as an
 * empty object: `style: {}` and no style at all mean the same thing to the
 * renderer, but not to the exported JSON, nor to anyone reading a stored
 * profile to work out which keys were ever touched.
 */
export function clearKeyStyle(
  config: OverlayConfig,
  ids: readonly number[],
  property: keyof KeyStyle,
): OverlayConfig {
  return patchKeys(config, ids, (key) => {
    const { [property]: _removed, ...rest } = key.style ?? {};
    return Object.keys(rest).length === 0 ? { ...key, style: undefined } : { ...key, style: rest };
  });
}

export function setKeyMode(
  config: OverlayConfig,
  ids: readonly number[],
  mode: KeyMode,
): OverlayConfig {
  return patchKeys(config, ids, (key) => ({ ...key, mode }));
}

/** Singular, deliberately: a label is never edited as a group. */
export function setKeyLabel(config: OverlayConfig, id: number, label: string): OverlayConfig {
  return patchKeys(config, [id], (key) => ({ ...key, label }));
}

/**
 * Rewrites every label from the current layout — destructively, on request.
 *
 * Nothing calls this on its own. Labels are frozen at learning time, and a
 * layout change must never rename a key behind the user's back: someone who
 * renamed a key "Sprint" would lose it to a keyboard being replugged
 * (spec §8.6). Making it a function rather than a reaction to `layoutOverride`
 * is what keeps that impossible.
 *
 * It produces exactly what learning produces — glyph included, since board 6e.
 * That is the whole contract of the button: it puts a key back where a fresh
 * capture would have put it. Leaving the glyph out here would have made it
 * turn every icon back into a word on its way to fixing one letter.
 */
export function recomputeLabels(
  config: OverlayConfig,
  layout: LayoutMapLike | null,
): OverlayConfig {
  return {
    ...config,
    keys: config.keys.map((key) => ({
      ...key,
      label: iconFor(key.usage) ?? labelFor(key.usage, layout),
    })),
  };
}

/**
 * The name the layout gives this position, when the key no longer wears it.
 *
 * `null` means "nobody typed this label" — either it still equals what the
 * layout produces, or there is no layout to compare against.
 *
 * The rule is `setLayoutOverride`'s, and the reasoning below it applies here
 * word for word: nothing in the stored shape separates "↓ because the layout
 * said so" from "↓ because I typed it", so the question is asked of the data.
 * It was written out a second time inside the popover, and a third and fourth
 * reader were about to copy it again — the editor's dot and the key list both
 * ask exactly this question. One rule, one place.
 *
 * **No layout, no answer.** `labelFor` would fall back to the position name,
 * and a key reported as renamed from `ControlRight` tells the user nothing
 * they can act on.
 */
export function detectedLabelFor(key: KeyConfig, layout: LayoutMapLike | null): string | null {
  if (layout === null) return null;

  const detected = labelFor(key.usage, layout);
  return detected === key.label ? null : detected;
}

/**
 * Picks the logical layout and relabels the keys that never got a name.
 *
 * The relabelling is the point, not a side effect: the fallback of §8.6 exists
 * because detection got it wrong, and the keys wearing the wrong labels are
 * the ones already on screen. A selector that only affected future learns
 * would do nothing for the person who noticed.
 *
 * **But a name someone typed is a decision, and a layout change must not undo
 * it.** Nothing in the stored shape distinguishes "A because the layout said
 * so" from "A because I typed it" — they are the same string, which is why the
 * first version of this function lost a key renamed to an arrow on the first
 * switch. So the question is asked of the data instead: *does this label still
 * equal what the layout in force produces?* If it does, nobody has touched it.
 *
 * Modelling the label as an override — optional, resolved like `key.style` —
 * would answer it outright, and cost a configuration version, a migration, and
 * a guess about every profile already written. This rule costs nothing and is
 * wrong only one way: a rename that happens to match the detected label, which
 * is a rename with no effect.
 *
 * The one case where it holds its hand entirely is `auto` with nothing
 * detected — `getLayoutMap()` missing, or not answered yet. Relabelling from
 * no layout turns every letter into its position name, which is worse than
 * whatever was there and cannot be undone.
 */
export function setLayoutOverride(
  config: OverlayConfig,
  override: LayoutOverride,
  detected: LayoutMapLike | null,
): OverlayConfig {
  const before = resolveLayout(config.layoutOverride, detected);
  const after = resolveLayout(override, detected);
  const next = { ...config, layoutOverride: override };
  if (after === null) return next;

  return {
    ...next,
    keys: next.keys.map((key) =>
      // A label still equal to what the layout in force produces was never
      // touched, so it follows. Anything else is a name someone typed.
      key.label === labelFor(key.usage, before)
        ? { ...key, label: labelFor(key.usage, after) }
        : key,
    ),
  };
}
