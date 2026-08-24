import type { MigrationResult } from '../config/migrate';
import type { OverlayConfig } from '../config/schema';

export type Tone = 'success' | 'warning' | 'error';

/** One sentence and the tone to say it in. */
export interface Notice {
  tone: Tone;
  message: string;
  /**
   * An optional way back, offered at the moment of the mistake.
   *
   * The toast doctrine survives it: missing the toast still costs nothing,
   * because the action is only ever a shortcut to something the page offers
   * permanently (the undo lives in the header and under Ctrl+Z).
   */
  action?: { label: string; run: () => void };
}

/**
 * Two devices, two jobs (spec §16.6).
 *
 * The toast says something just happened and leaves; the profile line says
 * what the loaded profile is worth, and stays. One place doing both is the
 * failure the mockup removed: a "2 keys skipped" left on screen for hours, in
 * the same spot that later announces an unreadable file.
 */

/** Shared with the profile menu, which counts the same things the same way. */
export const keysLabel = (count: number) => `${count} key${count === 1 ? '' : 's'}`;

/** Nothing was imported, so nothing was lost — and that is the part to say. */
const KEPT = 'current profile kept';

export const READ_FAILED: Notice = {
  tone: 'error',
  message: `Import failed · the file could not be read · ${KEPT}`,
};

/**
 * Two functions and not one taking a name it ignores half the time.
 *
 * They were `importToast(result)` until 2026-08-24, when an import stopped
 * writing into the open profile and started making one of its own. The success
 * side then needed a profile name and the failure side had none to give — an
 * optional argument would have been a name the failure branch drops on the
 * floor, and a name the success branch can be called without.
 */
export function importFailedToast(
  reason: Extract<MigrationResult, { ok: false }>['reason'],
): Notice {
  return {
    tone: 'error',
    message:
      reason === 'too-new'
        ? `Import failed · written by a newer version of HE Overlay · ${KEPT}`
        : `Import failed · unreadable file · ${KEPT}`,
  };
}

/**
 * `profile` is the name the store actually used, never the one asked for.
 *
 * `freeName` deduplicates in silence, so a file asking for "Valorant" can land
 * in "Valorant 2". Announcing the name requested would send someone looking in
 * a profile their keys are not in.
 */
export function importedToast(profile: string, dropped: number): Notice {
  const landed = `Profile imported as "${profile}"`;

  // A warning, never an error: the import worked. Calling it a failure is how
  // someone concludes their file is broken when it merely came from another
  // keyboard.
  return dropped > 0
    ? {
        tone: 'warning',
        message: `${landed} · ${keysLabel(dropped)} skipped (not on this keyboard)`,
      }
    : { tone: 'success', message: landed };
}

/**
 * The toast for a saved profile that would not open (spec §16.6).
 *
 * It says where we landed, not merely what failed: the stored copy is put
 * aside by the store, and a message that omits that reads as "your layout is
 * gone" — which is the one thing that did not happen.
 */
export function loadToast(problem: 'unreadable' | 'too-new' | null): Notice | null {
  if (problem === null) return null;

  const cause =
    problem === 'too-new' ? 'written by a newer version of HE Overlay' : 'could not be read';
  return {
    tone: 'error',
    message: `Saved profile ${cause} · started from the defaults · the copy is kept aside`,
  };
}

/** Where the profile on screen came from, because the same count means two things. */
export interface Health {
  problem: 'unreadable' | 'too-new' | null;
  dropped: number;
  from: 'load' | 'import';
}

export function profileStatus(name: string, keyCount: number, health: Health): string {
  if (health.problem !== null) {
    const cause = health.problem === 'too-new' ? 'written by a newer version' : 'unreadable';
    return `${name} · ${cause} · started from the defaults`;
  }

  // Keys dropped by an import came from someone else's keyboard, which is
  // ordinary; keys dropped while loading were lost out of this very profile,
  // which is damage. Sending someone to look for an import they never made is
  // the worse of the two mistakes.
  const lost =
    health.dropped === 0
      ? ''
      : health.from === 'import'
        ? ` · ${health.dropped} skipped on the last import`
        : ` · ${health.dropped} could not be read`;

  return `${name} · ${keysLabel(keyCount)}${lost}`;
}

/**
 * The toast for several keys deleted at once, carrying their way back.
 *
 * A deletion is recognised by shape, not announced by the caller: two of the
 * four delete controls live in components that only hand a new config through
 * the one door, so the door itself has to tell a deletion apart. The
 * discriminator is reference identity: every editor helper keeps the surviving
 * key objects, and nothing that rebuilds them can pass for a deletion.
 *
 * It was written against imports, which used to arrive through the same door
 * with a whole new set of keys and could otherwise have talked over their own
 * toast. Since 2026-08-24 an import makes a profile of its own and reaches the
 * configuration through `openProfile`, so it no longer passes here at all —
 * the rule stands, one of its two reasons has gone.
 *
 * One key says nothing: it disappears under the cursor, the feedback is the
 * disappearance itself. Several might be Ctrl+A under a Delete meant for one —
 * the exact regret the action button is for.
 */
export function deletionToast(
  before: OverlayConfig,
  after: OverlayConfig,
  undo: () => void,
): Notice | null {
  if (after.style !== before.style || after.layoutOverride !== before.layoutOverride) return null;
  if (!after.keys.every((key) => before.keys.includes(key))) return null;

  const count = before.keys.length - after.keys.length;
  if (count < 2) return null;

  return {
    tone: 'success',
    message: `${keysLabel(count)} deleted`,
    action: { label: 'Undo', run: undo },
  };
}
