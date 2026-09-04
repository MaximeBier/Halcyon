// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { importedProfileName, nameFromFileName, profileFileName } from './profile-file';

describe('the name an exported profile lands under', () => {
  it('says what the file is and which profile it holds', () => {
    expect(profileFileName('Valorant')).toBe('halcyon-profile-Valorant.json');
  });

  it('keeps the profile name out of the path, whatever it is called', () => {
    // A profile name is free text and lands in a file name: anything a path
    // could read as a separator becomes a dash.
    expect(profileFileName('Apex / Legends')).toBe('halcyon-profile-Apex-Legends.json');
  });

  it('never trails the dash the sanitising leaves behind', () => {
    // `halcyon-profile-Valorant-.json` reads as a file whose name was cut
    // off, and it comes back through `nameFromFileName` as `Valorant-`.
    expect(profileFileName('Valorant!')).toBe('halcyon-profile-Valorant.json');
  });

  it('names a file even when nothing of the profile survives sanitising', () => {
    expect(profileFileName('///')).toBe('halcyon-profile-Profile.json');
  });
});

describe('the profile name read back off a file', () => {
  // Only ever a fallback: a file this version wrote carries its name inside,
  // and that name wins. This is for a file written by hand, or exported before
  // the envelope existed.

  it('strips the prefix this version writes', () => {
    expect(nameFromFileName('halcyon-profile-Valorant.json')).toBe('Valorant');
  });

  it('strips the prefix earlier versions wrote', () => {
    // `he-overlay-<profile>.json`, up to 2026-08-24. Tried second, because
    // the longer prefix starts with the shorter one: the other order would
    // leave every current file answering `profile-Valorant`.
    expect(nameFromFileName('he-overlay-Valorant.json')).toBe('Valorant');
  });

  it('takes a file named by hand as it comes', () => {
    expect(nameFromFileName('valorant.json')).toBe('valorant');
  });

  it('keeps what the browser adds to a second download', () => {
    // Chrome renames rather than overwrites. The suffix is part of the name it
    // was given, and `freeName` would have deduplicated it anyway.
    expect(nameFromFileName('halcyon-profile-Valorant (1).json')).toBe('Valorant (1)');
  });

  it('still strips the prefix written under the old product name', () => {
    // The product was renamed on 2026-08-24, and the storage keys were renamed
    // with it — without a migration, deliberately, because the profiles had
    // been exported to files first. Those files are the way back, so the two
    // prefixes they may carry have to keep working.
    expect(nameFromFileName('he-overlay-profile-Valorant.json')).toBe('Valorant');
  });

  it('strips the oldest prefix of the three', () => {
    expect(nameFromFileName('he-overlay-Valorant.json')).toBe('Valorant');
  });

  it('answers nothing when the file name carries nothing', () => {
    // Not an error, and not a made-up name either: the store already names an
    // empty profile, and it must stay the only place that decides that.
    expect(nameFromFileName('halcyon-profile-.json')).toBe('');
  });
});

describe('which of the two names an imported file lands under', () => {
  const envelope = (name: string) => JSON.stringify({ name, version: 1, keys: [] });

  it('prefers the name the file carries inside it', () => {
    // The file name is whatever the browser, or the user, last called it. The
    // envelope is what the profile was called when it was exported.
    expect(importedProfileName(envelope('Valorant'), 'downloaded (3).json')).toBe('Valorant');
  });

  it('falls back to the file name when the file carries none', () => {
    expect(importedProfileName('{"version":1,"keys":[]}', 'halcyon-profile-Apex.json')).toBe(
      'Apex',
    );
  });

  it('falls back when the file is not JSON, rather than giving up', () => {
    // The caller has already decided whether the configuration is usable; this
    // function only names it. Throwing here would turn a readable profile into
    // a failed import.
    expect(importedProfileName('not json', 'halcyon-profile-Apex.json')).toBe('Apex');
  });

  it('answers nothing when neither carries a name', () => {
    expect(importedProfileName('{}', 'halcyon-profile-.json')).toBe('');
  });
});
