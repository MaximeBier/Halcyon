// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  clockTime,
  createJournal,
  describeAnomaly,
  groupRuns,
  hexDump,
  foreignProtocolLine,
  keyboardLine,
  obsLine,
  type JournalEntry,
} from './journal';
import type { ObsStatus } from '../transport/obs';
import type { KeyboardStatus } from '../keyboard/device';

/** 14:32:05 on 6 November 2026, local time: what the wall clock says. */
const AT_1432 = new Date(2026, 10, 6, 14, 32, 5).getTime();

describe('what the journal keeps', () => {
  it('timestamps and classifies an entry, by the session and by the wall clock', () => {
    const journal = createJournal(200, () => AT_1432);
    journal.add('user', 'Keyboard unplugged', 1000);

    expect(journal.entries()).toEqual([
      { id: 0, at: 1000, time: AT_1432, kind: 'user', message: 'Keyboard unplugged' },
    ]);
  });

  it('keeps the last 200 events by default, however long the page stays open', () => {
    const journal = createJournal();
    for (let i = 0; i < 250; i++) journal.add('user', `event ${i}`, i);

    expect(journal.entries()).toHaveLength(200);
    expect(journal.entries()[0]!.message).toBe('event 50');
  });

  // The panel keys its `{#each}` on this (task 16): a journal that rotates at
  // 200 entries must not force a full DOM rewrite, which is what keying on the
  // array index — or on `at` — would still do the moment anything shifts.
  it('gives every entry an id that never repeats, even sharing a timestamp', () => {
    const journal = createJournal();
    journal.add('user', 'first', 1000);
    journal.add('bug', 'second', 1000);

    const ids = journal.entries().map((entry) => entry.id);
    expect(new Set(ids).size).toBe(2);
  });

  it('keeps an entry’s id stable as older entries roll off', () => {
    const journal = createJournal(2);
    journal.add('user', 'a', 1);
    const survivorId = 1; // the second add's id, before a third pushes 'a' out
    journal.add('user', 'b', 2);
    journal.add('user', 'c', 3);

    expect(journal.entries().map((entry) => entry.id)).toEqual([survivorId, 2]);
  });

  it('separates what someone can fix from what is ours to fix', () => {
    // The whole point of the split (spec §11): a reader has to be able to tell
    // "plug your keyboard back in" from "this keyboard says something we never
    // documented", because only one of the two is worth reporting.
    const journal = createJournal();
    journal.add('user', 'OBS unreachable', 1);
    journal.add('bug', 'Unknown low bits', 2);

    expect(journal.entries().filter((entry) => entry.kind === 'bug')).toHaveLength(1);
  });

  it('drops the oldest rather than growing without end', () => {
    // A session lasts a whole stream. Unbounded, this is a memory leak on the
    // page that must never stutter.
    const journal = createJournal(2);
    journal.add('user', 'a', 1);
    journal.add('user', 'b', 2);
    journal.add('user', 'c', 3);

    expect(journal.entries().map((entry) => entry.message)).toEqual(['b', 'c']);
  });

  it('hands out a list that cannot be written into', () => {
    // `entries()` feeds the diagnostics panel, which renders it. Handing out
    // the live array makes the panel able to corrupt the log it is displaying.
    const journal = createJournal();
    journal.add('user', 'a', 1);

    // The cast is the point: `readonly` stops an honest caller, not a mistake
    // made through `any`, a spread, or a component that mutates what it renders.
    (journal.entries() as unknown as { message: string }[])[0]!.message = 'tampered';

    expect(journal.entries()[0]!.message).toBe('a');
  });
});

describe('the text one pastes into a bug report', () => {
  it('puts one entry per line, oldest first', () => {
    const journal = createJournal();
    journal.add('user', 'first', 0);
    journal.add('bug', 'second', 1);

    const lines = journal.asText().split('\n');

    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('first');
    expect(lines[1]).toContain('second');
  });

  it('says how long into the session each line happened', () => {
    // A raw `performance.now()` float means nothing to a reader. What answers
    // "what were you doing when it broke" is the time since the page opened.
    const journal = createJournal();
    journal.add('bug', 'Unknown low bits', 12_340);

    expect(journal.asText()).toContain('12.3s');
  });

  it('carries the kind, so a reader can skip the ordinary lines', () => {
    const journal = createJournal();
    journal.add('bug', 'Unknown low bits', 1234);

    expect(journal.asText()).toContain('bug');
    expect(journal.asText()).toContain('Unknown low bits');
  });

  it('says so rather than handing over an empty string', () => {
    // An empty clipboard reads as "the copy button is broken".
    expect(createJournal().asText()).toMatch(/no entries|nothing/i);
  });
});

describe('putting an anomaly into words', () => {
  it('describes an undocumented low bit with the field that carried it', () => {
    // The field is the whole report: without it there is nothing to decode
    // afterwards, and the entry exists precisely to be decoded afterwards.
    const text = describeAnomaly({ kind: 'unknown-low-bits', index: 30, field: 0x7d02 });

    expect(text).toContain('30');
    expect(text).toContain('0x7d02');
  });

  it('describes a report of the wrong length', () => {
    expect(describeAnomaly({ kind: 'bad-length', length: 14 })).toContain('14');
  });

  it('describes a repeated index, which the plan forgot', () => {
    // Three kinds, not two. A branch that reads `field` off this one does not
    // even compile — and one that skips it drops the anomaly that says the
    // report layout is not what we think it is.
    expect(describeAnomaly({ kind: 'duplicate-index', index: 30 })).toContain('30');
  });

  it('never says the same thing for two different kinds', () => {
    const said = [
      describeAnomaly({ kind: 'unknown-low-bits', index: 1, field: 2 }),
      describeAnomaly({ kind: 'duplicate-index', index: 1 }),
      describeAnomaly({ kind: 'bad-length', length: 1 }),
    ];

    expect(new Set(said).size).toBe(3);
  });
});

describe('the raw snapshot', () => {
  it('renders sixteen bytes to a line, zero-padded', () => {
    const dump = hexDump(new Uint8Array([0x00, 0xff, 0x10]));

    expect(dump).toBe('00 ff 10');
  });

  it('wraps at sixteen, so the columns line up against the report layout', () => {
    // Spec §3.1 describes the report in pairs of bytes. Lines of sixteen put
    // every entry at the same column on every line, which is what makes an
    // unknown layout readable at a glance.
    const dump = hexDump(new Uint8Array(Array.from({ length: 20 }, (_, i) => i)));
    const lines = dump.split('\n');

    expect(lines).toHaveLength(2);
    expect(lines[0]!.split(' ')).toHaveLength(16);
    expect(lines[1]).toBe('10 11 12 13');
  });

  it('says so rather than rendering nothing at all', () => {
    expect(hexDump(new Uint8Array())).toMatch(/empty|no data/i);
  });
});

describe('the text one pastes into a bug report, by the clock', () => {
  it('gives each line its full wall-clock time', () => {
    const journal = createJournal(200, () => AT_1432);
    journal.add('user', 'OBS connected', 0);

    expect(journal.asText()).toContain('2026-11-06 14:32:05');
  });
});

describe('the activity list', () => {
  const entry = (
    id: number,
    message: string,
    time: number,
    kind: 'user' | 'bug' = 'user',
  ): JournalEntry => ({
    id,
    at: id,
    time,
    kind,
    message,
  });

  it('reads the newest first', () => {
    const runs = groupRuns([entry(0, 'a', 1), entry(1, 'b', 2)]);

    expect(runs.map((run) => run.message)).toEqual(['b', 'a']);
  });

  it('folds identical events in a row into one line, counted, at the time of the last', () => {
    const runs = groupRuns([entry(0, 'tick', 1), entry(1, 'tick', 2), entry(2, 'tick', 3)]);

    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ message: 'tick', count: 3, time: 3, id: 2 });
  });

  it('keeps apart the same event when something happened in between', () => {
    const runs = groupRuns([entry(0, 'tick', 1), entry(1, 'tock', 2), entry(2, 'tick', 3)]);

    expect(runs.map((run) => [run.message, run.count])).toEqual([
      ['tick', 1],
      ['tock', 1],
      ['tick', 1],
    ]);
  });

  it('keeps apart two kinds that happen to say the same thing', () => {
    expect(groupRuns([entry(0, 'same', 1, 'user'), entry(1, 'same', 2, 'bug')])).toHaveLength(2);
  });

  it('writes the time as hours and minutes', () => {
    expect(clockTime(AT_1432)).toBe('14:32');
    expect(clockTime(new Date(2026, 0, 1, 7, 5).getTime())).toBe('07:05');
  });
});

describe('a connection change, in words', () => {
  const OBS: ObsStatus[] = [
    'idle',
    'connecting',
    'identified',
    'auth-failed',
    'unreachable',
    'disconnected',
  ];
  const KEYBOARD: KeyboardStatus[] = [
    'unsupported',
    'no-permission',
    'disconnected',
    'connected',
    'no-analog-interface',
    'open-failed',
  ];

  it('writes the OBS states as the board Diagnostics does', () => {
    expect(obsLine('identified')).toBe('OBS connected');
    expect(obsLine('auth-failed')).toBe('Wrong OBS password');
    expect(obsLine('unreachable')).toBe('OBS not answering');
    expect(obsLine('disconnected')).toBe('OBS disconnected');
  });

  it('names the keyboard when it is known', () => {
    expect(keyboardLine('connected', 'Wooting 60HE+', null)).toBe('Wooting 60HE+ connected');
    expect(keyboardLine('connected', null, null)).toBe('Keyboard connected');
  });

  it('names the keyboard that left, which the link no longer knows', () => {
    expect(keyboardLine('disconnected', null, 'Wooting 60HE+')).toBe('Wooting 60HE+ disconnected');
    expect(keyboardLine('disconnected', null, null)).toBe('Keyboard disconnected');
  });

  it('never lends the last keyboard’s name to a device that failed to open', () => {
    expect(keyboardLine('open-failed', null, 'Wooting 60HE+')).not.toContain('60HE+');
  });

  it('says a foreign protocol and the reload in one sentence, as the board does', () => {
    expect(foreignProtocolLine(4, true)).toBe(
      'An overlay ran protocol v4, so its sources were reloaded.',
    );
    expect(foreignProtocolLine(4, false)).toBe('An overlay is running protocol v4; reload it.');
  });

  // The board's grammar (OBS-Diagnostics): an event told as a fragment —
  // "OBS connected", "Scene Gameplay → opened Apex ranked" — carries no
  // period; a sentence with a verb of its own ends with one.
  it('never shows an internal state name, and ends only a full sentence with a period', () => {
    const lines = [
      ...OBS.map(obsLine),
      ...KEYBOARD.map((s) => keyboardLine(s, 'Wooting 60HE+', null)),
      ...KEYBOARD.map((s) => keyboardLine(s, null, null)),
    ];
    for (const line of lines) {
      expect(line).toMatch(/^[A-Z]/);
      expect(line.endsWith('.')).toBe(/ (has|refused|cannot) /.test(line));
      expect(line).not.toMatch(
        /identified|auth-failed|unreachable|no-permission|analog-interface|open-failed|unsupported|idle|:/,
      );
    }
    expect(new Set(OBS.map(obsLine)).size).toBe(OBS.length);
    expect(new Set(KEYBOARD.map((s) => keyboardLine(s, null, null))).size).toBe(KEYBOARD.length);
  });
});
