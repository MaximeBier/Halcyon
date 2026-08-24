import { readProfileName } from '../config/storage';

/**
 * The file an exported profile lands in, and the name read back off one.
 *
 * A module of its own rather than two helpers inside `App.svelte`: naming a
 * download and parsing a name out of one are pure string work, and pure string
 * work tested through a rendered component is tested through everything else
 * that component does.
 */

/** What every exported profile is called, whatever version wrote it. */
const STEM = 'he-overlay';

/**
 * Prefixes stripped when reading a name back, longest first.
 *
 * The order is load-bearing, not cosmetic: `he-overlay-profile-` starts with
 * `he-overlay-`, so trying the short one first would leave every file this
 * version writes answering `profile-Valorant`.
 */
const PREFIXES = [`${STEM}-profile-`, `${STEM}-`];

/**
 * Fallback name, and deliberately the same word `freeName` uses.
 *
 * Two places cannot invent two different names for the same nameless profile.
 */
const UNNAMED = 'Profile';

export function profileFileName(profile: string): string {
  const slug =
    profile
      .replace(/[^\w.-]+/g, '-')
      // Trimmed, because the sanitising leaves a dash wherever the name ended
      // in something a path could read: `he-overlay-profile-Valorant-.json`
      // reads as a name cut off mid-word, and comes back through
      // `nameFromFileName` as `Valorant-`.
      .replace(/^[-.]+|[-.]+$/g, '') || UNNAMED;

  return `${STEM}-profile-${slug}.json`;
}

/**
 * The profile name a file name suggests — **a fallback and nothing more**.
 *
 * A file this version wrote carries its name inside it, and that name wins.
 * This is for the file written by hand, and for the ones exported before the
 * envelope existed.
 *
 * An empty answer is a real answer: the store already decides what a nameless
 * profile is called, and it has to stay the only place that does.
 */
export function nameFromFileName(fileName: string): string {
  const withoutExtension = fileName.replace(/\.json$/i, '');
  const prefix = PREFIXES.find((candidate) => withoutExtension.startsWith(candidate));
  return (prefix ? withoutExtension.slice(prefix.length) : withoutExtension).trim();
}

/**
 * The name an imported file should land under.
 *
 * The envelope wins over the file name, and the order is the whole point: a
 * file name is whatever the browser or the user last called it — `Valorant
 * (3).json` after a third download, `downloaded.json` after a detour through a
 * chat — while the envelope is what the profile was called when it was
 * exported.
 *
 * Never throws and never refuses. Whether the configuration is usable has
 * already been decided by the caller; this only names it, and a name that
 * could fail would turn a readable profile into a failed import.
 */
export function importedProfileName(text: string, fileName: string): string {
  return readProfileName(text) ?? nameFromFileName(fileName);
}
