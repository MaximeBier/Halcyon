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
   * For most callers the toast doctrine survives losing it: missing the
   * toast still costs nothing, because the action is only ever a shortcut to
   * something the page offers permanently (the undo lives in the header and
   * under Ctrl+Z). Two callers carve out the deliberate exception:
   * `profileDeletedToast` below, whose Undo is the only way back for a
   * profile with no other undo, and the `replace` action on `importedToast`,
   * whose button is the only route to overwriting the profile an import
   * collided with. For both, losing this toast (a later one replacing it,
   * the four seconds running out) really does cost something. Accepted, not
   * fought: see the toast-replace behaviour this file already documents, and
   * `importedToast`'s own doc below for why its exception is shaped the way
   * it is.
   */
  action?: { label: string; run: () => void };
}

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
        ? `Import failed · written by a newer version of Halcyon · ${KEPT}`
        : `Import failed · unreadable file · ${KEPT}`,
  };
}

/**
 * `profile` is the name the store actually used, never the one asked for.
 *
 * `freeName` deduplicates in silence, so a file asking for "Valorant" can land
 * in "Valorant 2". Announcing the name requested would send someone looking in
 * a profile their keys are not in.
 *
 * `replace`, present only when the import collided with an existing profile,
 * is the way back that silent dedup does not otherwise offer: without it,
 * re-importing the same backup piles up "Valorant 2", "Valorant 3", … forever
 * (spec's constat). It names the profile the action would overwrite — the one
 * that actually collided, never the suffixed copy this toast is already
 * about.
 */
export function importedToast(
  profile: string,
  dropped: number,
  replace?: { name: string; run: () => void },
): Notice {
  const landed = `Profile imported as "${profile}"`;
  const action = replace ? { label: `Replace “${replace.name}”`, run: replace.run } : undefined;

  // A warning, never an error: the import worked. Calling it a failure is how
  // someone concludes their file is broken when it merely came from another
  // keyboard.
  return dropped > 0
    ? {
        tone: 'warning',
        message: `${landed} · ${keysLabel(dropped)} skipped (not on this keyboard)`,
        action,
      }
    : { tone: 'success', message: landed, action };
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
    problem === 'too-new' ? 'written by a newer version of Halcyon' : 'could not be read';
  return {
    tone: 'error',
    message: `Saved profile ${cause} · started from the defaults · the copy is kept aside`,
  };
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

/**
 * The toast for a profile deleted outright (spec's constat).
 *
 * The only action in the app that used to destroy work with no way back: the
 * store forgets the profile and `openProfile` clears the undo pile behind it,
 * so past this toast nothing else in the page remembers what was here.
 * `undo` therefore takes no null branch and this notice takes no bare warning
 * standing in for a way back that failed to get wired — see the exception
 * carved out on `Notice.action` above. Every call site in this codebase can
 * in fact wire it, so this always comes back `success` with the button
 * attached.
 */
export function profileDeletedToast(name: string, undo: () => void): Notice {
  return {
    tone: 'success',
    message: `Profile “${name}” deleted`,
    action: { label: 'Undo', run: undo },
  };
}
