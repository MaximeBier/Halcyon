// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { extname, join } from 'node:path';

/**
 * Every file in the project is UTF-8, and nothing on the way in read it as
 * something else.
 *
 * Commit 1520133 shipped `src/capture/App.svelte` with 64 mojibake lines: some
 * tool read its UTF-8 bytes one at a time as Latin-1 and wrote them back out as
 * UTF-8, so the multiplication sign reached the browser as two characters, the
 * section sign as two more, and the trash button's wastebasket as four. The
 * pages declare `<meta charset="utf-8">`, so the browser was right and the file
 * was wrong -- nothing in the build could have rescued it.
 *
 * The corruption is silent: it survives Prettier, `svelte-check` and every
 * behavioural test, because a label is a string whatever bytes it holds. Only a
 * reader looking at the screen -- or this test -- can tell.
 *
 * This file stays pure ASCII on purpose: it is the one file whose own
 * characters could make it lie about the others. That is also why the cp1252
 * table below is written as numbers.
 */

/** UTF-8 that refuses to guess: a bad byte throws instead of becoming U+FFFD. */
const strict = new TextDecoder('utf-8', { fatal: true });

/**
 * The replacement character, named rather than typed.
 *
 * This file is scanned along with every other, so a literal one here
 * would make it report itself as damaged.
 */
const REPLACEMENT = String.fromCharCode(0xfffd);

/**
 * Windows is why cp1252 is here and not just Latin-1.
 *
 * Latin-1 maps every byte to the codepoint of the same value, but cp1252 --
 * the ANSI codepage PowerShell's `Set-Content` and `Out-File` reach for by
 * default -- fills 0x80-0x9F with punctuation instead. The same mistake made
 * by two different tools therefore leaves two different signatures, and a
 * check that knows only Latin-1 would wave the more likely one through.
 *
 * Codepoint -> the cp1252 byte that produces it. Outside this range cp1252
 * and Latin-1 agree.
 */
const CP1252_HIGH: Record<number, number> = {
  0x20ac: 0x80,
  0x201a: 0x82,
  0x0192: 0x83,
  0x201e: 0x84,
  0x2026: 0x85,
  0x2020: 0x86,
  0x2021: 0x87,
  0x02c6: 0x88,
  0x2030: 0x89,
  0x0160: 0x8a,
  0x2039: 0x8b,
  0x0152: 0x8c,
  0x017d: 0x8e,
  0x2018: 0x91,
  0x2019: 0x92,
  0x201c: 0x93,
  0x201d: 0x94,
  0x2022: 0x95,
  0x2013: 0x96,
  0x2014: 0x97,
  0x02dc: 0x98,
  0x2122: 0x99,
  0x0161: 0x9a,
  0x203a: 0x9b,
  0x0153: 0x9c,
  0x017e: 0x9e,
  0x0178: 0x9f,
};

/** The byte this character would have been in `codec`, or null if it had none. */
function encodedByte(code: number, codec: 'latin1' | 'cp1252'): number | null {
  if (code >= 0x80 && code <= 0xff) {
    // cp1252 keeps other characters in 0x80-0x9F, so a bare C1 control never
    // came from a cp1252 byte -- only from a Latin-1 one.
    return codec === 'cp1252' && code <= 0x9f ? null : code;
  }
  return codec === 'cp1252' ? (CP1252_HIGH[code] ?? null) : null;
}

/**
 * Double-encoded runs, and why the round trip is the test.
 *
 * A UTF-8 sequence misread byte-by-byte becomes a run of characters that each
 * stand for one of the original bytes -- so the run still *is* those bytes.
 * Reading them back as UTF-8 either yields the character that was meant, or
 * fails outright; a run of text genuinely written in Latin-1 or cp1252 almost
 * never decodes cleanly. So what decodes was mojibake, and what refuses was
 * always fine.
 *
 * Single characters are skipped: one high byte alone is never valid UTF-8, so
 * it can only be a real character and never a misread sequence.
 */
function doubleEncoded(text: string, codec: 'latin1' | 'cp1252'): string[] {
  const found: string[] = [];
  let run: { byte: number; character: string }[] = [];

  const flush = () => {
    if (run.length > 1) {
      const bytes = Uint8Array.from(run, (entry) => entry.byte);
      const original = run.map((entry) => entry.character).join('');
      try {
        const decoded = strict.decode(bytes);
        if (decoded !== original) {
          found.push(`${JSON.stringify(original)} -> ${JSON.stringify(decoded)}`);
        }
      } catch {
        /* Not UTF-8 misread through this codec: leave it alone. */
      }
    }
    run = [];
  };

  for (const character of text) {
    const byte = encodedByte(character.codePointAt(0)!, codec);
    if (byte === null) flush();
    else run.push({ byte, character });
  }
  flush();
  return found;
}

/** Everything wrong with one file's bytes, worst first; empty means clean. */
export function encodingFaults(bytes: Buffer): string[] {
  const faults: string[] = [];

  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf)
    faults.push('starts with a UTF-8 BOM');
  if ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff)) {
    faults.push('starts with a UTF-16 BOM: this file is not UTF-8 at all');
  }

  let text: string;
  try {
    text = strict.decode(bytes);
  } catch (error) {
    // Nothing further to say: the bytes are not UTF-8, so every other check
    // below would be reading a guess.
    return [...faults, `is not valid UTF-8 (${(error as Error).message})`];
  }

  // U+FFFD is the mark of a decode that already went wrong somewhere upstream
  // and threw the original character away. Unlike mojibake, it cannot be undone.
  const lost = text.split(REPLACEMENT).length - 1;
  if (lost) faults.push(`holds ${lost} replacement character(s): those bytes are gone for good`);

  for (const codec of ['latin1', 'cp1252'] as const) {
    const runs = doubleEncoded(text, codec);
    if (runs.length) {
      faults.push(
        `holds ${runs.length} run(s) of UTF-8 misread as ${codec}: ${runs.slice(0, 4).join(', ')}`,
      );
    }
  }

  return faults;
}

/** Files git knows about, which is the only honest definition of "the project". */
function projectFiles(): string[] {
  const repository = join(import.meta.dirname, '..', '..');
  const listed = execFileSync('git', ['ls-files', '-z'], { cwd: repository, encoding: 'utf8' });
  return listed.split('\0').filter(Boolean);
}

/** Fonts and images are bytes on purpose; decoding them proves nothing. */
const BINARY = /\.(png|jpe?g|gif|ico|webp|avif|woff2?|ttf|otf|eot|pdf|zip|gz|mp4|webm|wasm)$/i;

describe('project encoding', () => {
  const repository = join(import.meta.dirname, '..', '..');
  const files = projectFiles().filter((file) => !BINARY.test(extname(file) ? file : `${file}.txt`));

  it('asked git for the file list and got one', () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it.each(files)('%s is clean UTF-8', (file) => {
    const bytes = readFileSync(join(repository, file));
    // A NUL byte means this is binary despite its name; nothing to decode.
    if (bytes.includes(0)) return;
    expect(encodingFaults(bytes)).toEqual([]);
  });
});

/**
 * The check above passes on a clean project whether or not it works, so these
 * cases hold it to the damage it is supposed to name. Every fixture is written
 * as bytes: what went wrong last time was bytes, and a fixture typed as
 * characters would be at the mercy of whatever wrote this file.
 */
describe('encodingFaults', () => {
  const bytes = (...values: number[]) => Buffer.from(values);

  it('passes clean UTF-8', () => {
    // "216 x 216" with a real multiplication sign (U+00D7 = c3 97).
    expect(
      encodingFaults(bytes(0x32, 0x31, 0x36, 0x20, 0xc3, 0x97, 0x20, 0x32, 0x31, 0x36)),
    ).toEqual([]);
  });

  it('catches UTF-8 misread as Latin-1', () => {
    // The 1520133 bug exactly: c3 97 read as two Latin-1 characters, then
    // written back out as c3 83 c2 97.
    const faults = encodingFaults(bytes(0xc3, 0x83, 0xc2, 0x97));
    expect(faults).toHaveLength(1);
    expect(faults[0]).toContain('misread as latin1');
  });

  it('catches UTF-8 misread as cp1252, which Latin-1 alone would miss', () => {
    // An em dash (e2 80 94) through cp1252 becomes a-circumflex, euro sign and
    // a right double quote -- two of which are above U+00FF, so a Latin-1-only
    // check never sees a run at all.
    const faults = encodingFaults(bytes(0xc3, 0xa2, 0xe2, 0x82, 0xac, 0xe2, 0x80, 0x9d));
    expect(faults).toHaveLength(1);
    expect(faults[0]).toContain('misread as cp1252');
  });

  it('catches replacement characters', () => {
    expect(encodingFaults(bytes(0xef, 0xbf, 0xbd))[0]).toContain('gone for good');
  });

  it('catches a UTF-8 BOM', () => {
    expect(encodingFaults(bytes(0xef, 0xbb, 0xbf, 0x6f, 0x6b))[0]).toContain('UTF-8 BOM');
  });

  it('catches bytes that are not UTF-8 at all', () => {
    // c3 must be followed by a continuation byte; "(" is not one.
    expect(encodingFaults(bytes(0x41, 0xc3, 0x28))[0]).toContain('not valid UTF-8');
  });

  it('leaves accented prose alone', () => {
    // "Deja vu" with real accents: single high characters, never a run that
    // could be mistaken for a misread sequence.
    expect(encodingFaults(bytes(0x44, 0xc3, 0xa9, 0x6a, 0xc3, 0xa0, 0x20, 0x76, 0x75))).toEqual([]);
  });
});
