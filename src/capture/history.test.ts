// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { createHistory, HISTORY_DEPTH } from './history';

// Snapshots are opaque to the pile: reference identity is all it ever reads.
const state = (name: string) => ({ name });

describe('the undo pile', () => {
  it('starts with nothing to offer either way', () => {
    const history = createHistory<object>();

    expect(history.canUndo()).toBe(false);
    expect(history.canRedo()).toBe(false);
    expect(history.undo(state('now'))).toBeNull();
    expect(history.redo(state('now'))).toBeNull();
  });

  it('hands back the state a change replaced, and remembers the one it displaced', () => {
    const history = createHistory<object>();
    const before = state('before');
    const after = state('after');

    history.push(before);
    expect(history.canUndo()).toBe(true);

    expect(history.undo(after)).toBe(before);
    expect(history.canUndo()).toBe(false);
    expect(history.canRedo()).toBe(true);
    expect(history.redo(before)).toBe(after);
    expect(history.canRedo()).toBe(false);
    expect(history.canUndo()).toBe(true);
  });

  it('walks several steps back in the order they were taken', () => {
    const history = createHistory<object>();
    const steps = [state('a'), state('b'), state('c')];
    for (const step of steps) history.push(step);

    expect(history.undo(state('d'))).toBe(steps[2]);
    expect(history.undo(steps[2]!)).toBe(steps[1]);
    expect(history.undo(steps[1]!)).toBe(steps[0]);
    expect(history.undo(steps[0]!)).toBeNull();
  });

  it('drops the whole redo pile on a new change', () => {
    // Standard, and the only sane rule: after undoing and editing, "redo"
    // would have two futures to choose from, and it must never guess.
    const history = createHistory<object>();
    const before = state('before');

    history.push(before);
    history.undo(state('after'));
    expect(history.canRedo()).toBe(true);

    history.push(before);
    expect(history.canRedo()).toBe(false);
  });

  it('refuses a state it already holds on top', () => {
    // The door guards this too, but the pile defends itself: two identical
    // entries make one Ctrl+Z visibly do nothing, which reads as broken.
    const history = createHistory<object>();
    const same = state('same');

    history.push(same);
    history.push(same);

    expect(history.undo(state('now'))).toBe(same);
    expect(history.canUndo()).toBe(false);
  });

  it('forgets the oldest step beyond its depth', () => {
    const history = createHistory<object>(2);
    const steps = [state('a'), state('b'), state('c')];
    for (const step of steps) history.push(step);

    expect(history.undo(state('d'))).toBe(steps[2]);
    expect(history.undo(steps[2]!)).toBe(steps[1]);
    // 'a' fell off the far end: two was the whole depth.
    expect(history.undo(steps[1]!)).toBeNull();
  });

  it('clears both piles at once', () => {
    const history = createHistory<object>();
    history.push(state('a'));
    history.undo(state('b'));

    history.clear();

    expect(history.canUndo()).toBe(false);
    expect(history.canRedo()).toBe(false);
  });

  it('ships a depth measured in gestures nobody remembers past', () => {
    expect(HISTORY_DEPTH).toBe(50);
  });

  it('starts at a version nothing has moved yet', () => {
    expect(createHistory<object>().version()).toBe(0);
  });

  it('moves the version only on a call that could flip canUndo or canRedo', () => {
    const history = createHistory<object>();
    const same = state('same');

    const v0 = history.version();
    history.push(same);
    const v1 = history.version();
    expect(v1).toBeGreaterThan(v0);

    // Deduped: the pile already holds this state on top.
    history.push(same);
    expect(history.version()).toBe(v1);

    history.undo(state('now'));
    const v2 = history.version();
    expect(v2).toBeGreaterThan(v1);

    // Nothing left to undo.
    expect(history.undo(state('now'))).toBeNull();
    expect(history.version()).toBe(v2);

    history.redo(same);
    const v3 = history.version();
    expect(v3).toBeGreaterThan(v2);

    // Nothing left to redo.
    expect(history.redo(same)).toBeNull();
    expect(history.version()).toBe(v3);

    history.clear();
    const v4 = history.version();
    expect(v4).toBeGreaterThan(v3);

    // Already empty: clearing again changes nothing.
    history.clear();
    expect(history.version()).toBe(v4);
  });
});
