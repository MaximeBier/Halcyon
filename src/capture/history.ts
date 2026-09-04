/**
 * The undo pile behind `updateConfig` — the one door every configuration
 * change already goes through, which is what makes a pile sufficient: nothing
 * can change the document without passing it, so nothing can escape it.
 *
 * It holds references, never copies. The configuration is immutable by
 * convention (every editor helper builds a new object and shares the untouched
 * children), so a snapshot costs one array slot — and reference identity is
 * also the contract: the door hands in the state a change replaced, and gets
 * the exact same object back on undo.
 */
export interface History<T> {
  /** Remembers the state a change is about to replace. Empties the redo pile. */
  push(state: T): void;
  /**
   * Hands back the state before the last change, or `null` when there is none.
   * `current` is what undoing displaces — it becomes the next redo.
   */
  undo(current: T): T | null;
  /** The mirror of `undo`. */
  redo(current: T): T | null;
  /**
   * Forgets everything, both ways. For switching profiles: a pile that
   * survived would make Ctrl+Z rewrite a document that is no longer on
   * screen — open "Apex", undo, and "Valorant" changes inside OBS.
   */
  clear(): void;
  canUndo(): boolean;
  canRedo(): boolean;
  /**
   * Bumped by every call above that could have changed what `canUndo` or
   * `canRedo` would answer — never by one that finds nothing to do.
   *
   * Plain data, like the rest of this module: the pile holds no runes of its
   * own, so a component cannot know it moved just by calling `canUndo()`
   * again. This is the one thing worth reading into a `$derived` — the
   * single signal both flags key off, rather than each being mirrored by
   * hand at every call site that mutates the pile.
   */
  version(): number;
}

/**
 * Fifty gestures. Snapshots share their children, so this is a few hundred
 * kilobytes at the very worst — and beyond fifty, one is undoing changes
 * nobody remembers making.
 */
export const HISTORY_DEPTH = 50;

export function createHistory<T>(depth: number = HISTORY_DEPTH): History<T> {
  let past: T[] = [];
  let future: T[] = [];
  let rev = 0;

  // Shared by push and redo: both grow the past, and both must respect the
  // depth — a redo landing on a full pile would otherwise stretch it by one.
  function remember(state: T) {
    past.push(state);
    if (past.length > depth) past.shift();
  }

  return {
    push(state) {
      // The door already refuses a config that did not change, but the pile
      // defends itself too: a duplicate entry makes one Ctrl+Z visibly do
      // nothing, which reads as broken.
      if (past[past.length - 1] === state) return;
      remember(state);
      // After undoing and then editing, "redo" would have two futures to
      // choose from, and it must never guess.
      future = [];
      rev += 1;
    },
    undo(current) {
      if (past.length === 0) return null;
      future.push(current);
      rev += 1;
      return past.pop()!;
    },
    redo(current) {
      if (future.length === 0) return null;
      remember(current);
      rev += 1;
      return future.pop()!;
    },
    clear() {
      // Nothing about canUndo/canRedo moves when both piles were already
      // empty — an idle keyboard shortcut, or a profile switch right after
      // opening one, must not spend a redraw on a no-op.
      if (past.length === 0 && future.length === 0) return;
      past = [];
      future = [];
      rev += 1;
    },
    canUndo: () => past.length > 0,
    canRedo: () => future.length > 0,
    version: () => rev,
  };
}
