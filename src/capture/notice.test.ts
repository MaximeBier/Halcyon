import { describe, it, expect } from 'vitest';
import {
  deletionToast,
  importedToast,
  importFailedToast,
  loadToast,
  profileStatus,
  READ_FAILED,
} from './notice';
import { defaultConfig } from '../config/schema';

describe('what an import says, once', () => {
  it('names the profile the file landed in', () => {
    // An import no longer touches what is open: it makes a profile of its own,
    // and the only way to know which one is to be told.
    expect(importedToast('Valorant', 0)).toEqual({
      tone: 'success',
      message: 'Profile imported as "Valorant"',
    });
  });

  it('names the profile it actually landed in, not the one it asked for', () => {
    // `freeName` deduplicates in silence. Saying "Valorant" while the keys are
    // in "Valorant 2" sends someone looking in the wrong profile.
    expect(importedToast('Valorant 2', 0).message).toContain('"Valorant 2"');
  });

  it('warns, rather than confirms, when keys were skipped', () => {
    // The import worked: nothing was lost, and calling it an error is how
    // someone concludes their file is broken when it is merely from another
    // keyboard (spec §16.6).
    expect(importedToast('Valorant', 2)).toEqual({
      tone: 'warning',
      message: 'Profile imported as "Valorant" · 2 keys skipped (not on this keyboard)',
    });
  });

  it('counts one skipped key without pluralising it', () => {
    expect(importedToast('Valorant', 1).message).toContain('1 key skipped');
  });

  it('says the current profile was kept when the file was unreadable', () => {
    // The one thing to say here is what did *not* happen. A bare "import
    // failed" leaves people reloading to check they still have their layout.
    expect(importFailedToast('unreadable')).toEqual({
      tone: 'error',
      message: 'Import failed · unreadable file · current profile kept',
    });
  });

  it('names the version as the reason when that is what it is', () => {
    const message = importFailedToast('too-new').message;

    expect(message).toContain('newer version');
    expect(message).toContain('current profile kept');
  });

  it('has an error to show for a file the browser could not even read', () => {
    expect(READ_FAILED.tone).toBe('error');
  });
});

describe('what a profile says when it will not open', () => {
  it('stays quiet about a profile that opened normally', () => {
    expect(loadToast(null)).toBeNull();
  });

  it('says it out loud, and never as a loss', () => {
    // Nothing was overwritten: the stored copy is kept aside. Saying "unreadable"
    // without saying that is how someone concludes their work is gone.
    const notice = loadToast('unreadable')!;

    expect(notice.tone).toBe('error');
    expect(notice.message).toContain('kept aside');
  });

  it('separates a profile ahead of this build from a broken one', () => {
    expect(loadToast('too-new')!.message).toContain('newer version');
  });
});

describe('what the profile menu says, permanently', () => {
  it('names the profile and counts its keys', () => {
    expect(profileStatus('Apex', 6, { problem: null, dropped: 0, from: 'load' })).toBe(
      'Apex · 6 keys',
    );
  });

  it('counts a single key without pluralising it', () => {
    expect(profileStatus('Apex', 1, { problem: null, dropped: 0, from: 'load' })).toBe(
      'Apex · 1 key',
    );
  });

  it('keeps the skipped count long after the toast has gone', () => {
    // The whole reason the two exist side by side: the toast says it happened,
    // the line says what the profile is worth (spec §16.6).
    expect(profileStatus('Apex', 4, { problem: null, dropped: 2, from: 'import' })).toBe(
      'Apex · 4 keys · 2 skipped on the last import',
    );
  });

  it('does not blame an import for keys the saved profile itself had lost', () => {
    // The same count reaches this line from two places, and they mean opposite
    // things: a file from another keyboard is normal, a saved profile that lost
    // keys is damage. Sending someone to look for an import they never did is
    // the worse of the two mistakes.
    expect(profileStatus('Apex', 4, { problem: null, dropped: 2, from: 'load' })).toBe(
      'Apex · 4 keys · 2 could not be read',
    );
  });

  it('says where an unreadable saved profile left us', () => {
    expect(profileStatus('Apex', 0, { problem: 'unreadable', dropped: 0, from: 'load' })).toBe(
      'Apex · unreadable · started from the defaults',
    );
  });

  it('separates a profile from a newer version from a broken one', () => {
    // They fail identically on screen and mean opposite things: one is corrupt,
    // the other is intact and simply ahead of this build.
    expect(profileStatus('Apex', 0, { problem: 'too-new', dropped: 0, from: 'load' })).toBe(
      'Apex · written by a newer version · started from the defaults',
    );
  });
});

describe('what a deletion is recognised by', () => {
  const undo = () => {};

  /** A configured key, minimal but honest to the schema. */
  const key = (id: number) => ({
    id,
    usage: id,
    mode: 'key' as const,
    label: `K${id}`,
    x: 0,
    y: 0,
    w: 1,
    h: 1,
  });

  const config = (keys: ReturnType<typeof key>[]) => ({
    ...defaultConfig(),
    keys,
  });

  it('offers an undo when several keys went away at once', () => {
    const keys = [key(1), key(2), key(3)];
    const before = config(keys);
    const after = { ...before, keys: [keys[0]!] };

    const notice = deletionToast(before, after, undo);

    expect(notice).not.toBeNull();
    expect(notice!.message).toBe('2 keys deleted');
    expect(notice!.tone).toBe('success');
    expect(notice!.action).toEqual({ label: 'Undo', run: undo });
  });

  it('says nothing for a single key', () => {
    // The key disappears under the cursor: the feedback is the disappearance
    // itself, and the header buttons stay for the regret.
    const keys = [key(1), key(2)];
    const before = config(keys);
    const after = { ...before, keys: [keys[0]!] };

    expect(deletionToast(before, after, undo)).toBeNull();
  });

  it('does not mistake an import for a deletion', () => {
    // An import rebuilds every key object, so none of the survivors are the
    // same references — that is the whole discriminator. Without it, importing
    // a smaller profile would announce "keys deleted" over the import's own
    // toast.
    const before = config([key(1), key(2), key(3)]);
    const after = config([key(1)]);

    expect(deletionToast(before, after, undo)).toBeNull();
  });

  it('does not mistake a style or layout change for a deletion', () => {
    const keys = [key(1), key(2), key(3)];
    const before = config(keys);
    const restyled = { ...before, style: { ...before.style }, keys: [keys[0]!] };
    const relaid = { ...before, layoutOverride: 'azerty' as const, keys: [keys[0]!] };

    expect(deletionToast(before, restyled, undo)).toBeNull();
    expect(deletionToast(before, relaid, undo)).toBeNull();
  });

  it('says nothing when keys were added or merely kept', () => {
    const keys = [key(1), key(2)];
    const before = config(keys);

    expect(deletionToast(before, { ...before, keys: [...keys, key(3)] }, undo)).toBeNull();
    expect(deletionToast(before, { ...before, keys }, undo)).toBeNull();
  });
});
