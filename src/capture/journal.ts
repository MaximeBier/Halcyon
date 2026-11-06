import type { DecodeAnomaly } from '../keyboard/decode';

/**
 * Who a line is for.
 *
 * `user` is something to act on — plug the keyboard back in, start OBS.
 * `bug` is something we got wrong, or a keyboard saying what no document
 * describes. A reader has to be able to skip one and report the other; one
 * undifferentiated stream makes both invisible (spec §11).
 */
export type JournalKind = 'user' | 'bug';

export interface JournalEntry {
  /**
   * A stable identity, handed out at write time.
   *
   * `at` cannot serve as the key the panel renders with: an anomaly and its
   * own `note('bug', ...)` line, or a beat and a `hello`, can land in the same
   * `performance.now()` tick and read as one entry twice. This counter never
   * repeats, which is the one property `{#each ... (id)}` actually needs.
   */
  id: number;
  /** Since the page opened, from `performance.now()`. */
  at: number;
  /**
   * The wall clock, which is what the panel shows (spec §11): "14:32" is a
   * moment someone remembers; "+812.4s" is arithmetic.
   */
  time: number;
  kind: JournalKind;
  message: string;
}

export interface Journal {
  add(kind: JournalKind, message: string, now: number): void;
  entries(): readonly JournalEntry[];
  /** Text to paste into a bug report (spec §11). */
  asText(): string;
}

const EMPTY = 'No entries yet.';

/**
 * The last 200 events and no more (spec §11): the page stays open for whole
 * streams, and a log that only grows is a leak on the one page that must not
 * stutter. `clock` is the wall clock, injected so a test can stop it.
 */
export function createJournal(limit = 200, clock: () => number = Date.now): Journal {
  const entries: JournalEntry[] = [];
  let nextId = 0;

  return {
    add(kind, message, now) {
      entries.push({ id: nextId++, at: now, time: clock(), kind, message });
      // A session lasts a whole stream, and anomalies can arrive at the report
      // rate. Unbounded, this is a memory leak on the page that must not stutter.
      if (entries.length > limit) entries.splice(0, entries.length - limit);
    },

    entries() {
      // Copied, not handed over: this feeds the panel that renders it, and a
      // live array makes the display able to corrupt the log it displays.
      return entries.map((entry) => ({ ...entry }));
    },

    asText() {
      if (entries.length === 0) return EMPTY;
      return entries
        .map(
          (entry) =>
            `${fullTime(entry.time)}\t${elapsed(entry.at)}\t${entry.kind}\t${entry.message}`,
        )
        .join('\n');
    },
  };
}

/**
 * Time since the page opened, which is what the reader of a report has.
 *
 * A bare `performance.now()` float means nothing to anyone; "what were you
 * doing 12 seconds in" is a question someone can actually answer.
 */
function elapsed(at: number): string {
  return `+${(at / 1000).toFixed(1)}s`;
}

/**
 * One line of the activity list: an event, or several identical ones in a row
 * folded into it, counted, at the time of the last (spec §11). A reconnect
 * loop writing the same line forty times reads as one line with ×40, and the
 * line before it is still in view.
 */
export interface JournalRun {
  id: number;
  time: number;
  kind: JournalKind;
  message: string;
  count: number;
}

/** Newest first, consecutive identical events folded. */
export function groupRuns(entries: readonly JournalEntry[]): JournalRun[] {
  const runs: JournalRun[] = [];
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i]!;
    const last = runs[runs.length - 1];
    if (last && last.kind === entry.kind && last.message === entry.message) {
      last.count += 1;
      continue;
    }
    runs.push({
      id: entry.id,
      time: entry.time,
      kind: entry.kind,
      message: entry.message,
      count: 1,
    });
  }
  return runs;
}

const two = (n: number) => String(n).padStart(2, '0');

/** "14:32", local time: what the panel prints beside each line. */
export function clockTime(time: number): string {
  const date = new Date(time);
  return `${two(date.getHours())}:${two(date.getMinutes())}`;
}

/** The whole local date and time, for the text pasted into a report. */
function fullTime(time: number): string {
  const d = new Date(time);
  return (
    `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ` +
    `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`
  );
}

export function describeAnomaly(anomaly: DecodeAnomaly): string {
  switch (anomaly.kind) {
    case 'bad-length':
      return `Report was ${anomaly.length} bytes, not 64; ignored.`;
    case 'duplicate-index':
      return (
        `Key ${anomaly.index} appeared twice in one report; the repeat was ignored. ` +
        `The report layout is not what we assume.`
      );
    case 'unknown-low-bits':
      // The field, not just the index: the entry exists to be decoded later,
      // and without the raw value there is nothing left to decode.
      return (
        `Key ${anomaly.index} reported undocumented low bits ` +
        `(field 0x${anomaly.field.toString(16)}); entry ignored.`
      );
  }
}

const BYTES_PER_LINE = 16;

/**
 * Raw snapshot, to identify the report format of an unknown keyboard (§11).
 *
 * Sixteen to a line because spec §3.1 reads the report in pairs of bytes: a
 * fixed, even width puts every entry at the same column on every line, which
 * is what makes a layout nobody documented readable at a glance.
 */
export function hexDump(data: Uint8Array): string {
  if (data.length === 0) return 'No data.';

  const lines: string[] = [];
  for (let offset = 0; offset < data.length; offset += BYTES_PER_LINE) {
    lines.push(
      [...data.slice(offset, offset + BYTES_PER_LINE)]
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join(' '),
    );
  }
  return lines.join('\n');
}
