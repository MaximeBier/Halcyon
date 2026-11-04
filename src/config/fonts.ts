/**
 * The first family of a CSS font stack, unquoted.
 *
 * Profiles written before 2026-11-04 stored the whole default stack as their
 * `fontFamily`. A profile holds a family name now, and the fallbacks are added
 * by the renderer — so a stack read back is brought down to the name it
 * started with rather than kept as a family no machine has installed.
 */
export function firstFamily(value: string): string {
  const first = value.split(',')[0]!.trim();
  return first.replace(/^(['"])(.*)\1$/, '$2').trim();
}
