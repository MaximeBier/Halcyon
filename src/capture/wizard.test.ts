// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  loadStatus,
  nextStep,
  saveStatus,
  showsResume,
  showsWizard,
  stepNumber,
  obsNote,
  type SetupState,
} from './wizard';

const nothing: SetupState = {
  keyboard: 'disconnected',
  obs: 'idle',
  overlaysInObs: 0,
  keyCount: 0,
};
const ready: SetupState = {
  keyboard: 'connected',
  obs: 'identified',
  overlaysInObs: 1,
  keyCount: 0,
};

describe('what is left to do', () => {
  it('starts at the keyboard, since nothing else can be tried without one', () => {
    expect(nextStep(nothing)).toBe('keyboard');
  });

  it('moves on to OBS once the keyboard answers', () => {
    expect(nextStep({ ...nothing, keyboard: 'connected' })).toBe('obs');
  });

  it('waits for the browser source, not merely for the socket', () => {
    // The socket is the easy half. The half that fails silently is the browser
    // source: a correct URL never pasted into OBS looks exactly like a wrong
    // one, and the whole point of the step is to prove otherwise (spec §9.1).
    expect(nextStep({ ...nothing, keyboard: 'connected', obs: 'identified' })).toBe('obs');
  });

  // Only the one in OBS proves anything. Opening `overlay.html` in a tab to
  // check that it works is an overlay too, and it used to clear this step —
  // which the page then remembered as done, for ever, while OBS still had no
  // source at all. The count was split for exactly this (task 30); the wizard
  // had gone on reading the total.
  it('is not satisfied by an overlay open in a browser tab', () => {
    const inTabOnly = { ...nothing, keyboard: 'connected' as const, obs: 'identified' as const };

    expect(nextStep({ ...inTabOnly, overlaysInObs: 0 })).toBe('obs');
    expect(nextStep({ ...inTabOnly, overlaysInObs: 1 })).toBe('keys');
  });

  it('asks for keys once something is actually on screen in OBS', () => {
    expect(nextStep(ready)).toBe('keys');
  });

  it('is finished on the first key, which lands live in the overlay', () => {
    expect(nextStep({ ...ready, keyCount: 1 })).toBe('done');
  });

  it('reports what is missing, not how far one got', () => {
    // Derived from the state every time. A counter that only moves forward
    // would claim the setup is done for someone whose keyboard was unplugged
    // halfway; that it is the *status* which sticks, not the step, is what
    // keeps a finished install from reopening the wizard on an OBS restart.
    expect(nextStep({ ...ready, keyCount: 4, keyboard: 'disconnected' })).toBe('keyboard');
  });
});

describe('numbering the steps for the header', () => {
  it('numbers the three steps in the order they are done', () => {
    expect(stepNumber('keyboard')).toBe(1);
    expect(stepNumber('obs')).toBe(2);
    expect(stepNumber('keys')).toBe(3);
  });

  it('counts a finished setup as the last step, never a fourth', () => {
    // The label reads "Resume setup · N/3"; a 4 would be nonsense on screen.
    expect(stepNumber('done')).toBe(3);
  });
});

describe('whether anything shows at all', () => {
  it('shows the wizard on a first run', () => {
    expect(showsWizard('open', 'keyboard')).toBe(true);
    expect(showsResume('open', 'keyboard')).toBe(false);
  });

  it('shows nothing at all once everything works', () => {
    expect(showsWizard('open', 'done')).toBe(false);
    expect(showsResume('skipped', 'done')).toBe(false);
  });

  it('offers to resume after a skip, and only then', () => {
    expect(showsWizard('skipped', 'obs')).toBe(false);
    expect(showsResume('skipped', 'obs')).toBe(true);
  });

  it('never reopens a setup that was seen through', () => {
    // Someone whose OBS is merely off tonight is not being set up again.
    expect(showsWizard('done', 'obs')).toBe(false);
    expect(showsResume('done', 'obs')).toBe(false);
  });
});

describe('remembering across reloads', () => {
  const memory = (initial?: string) => {
    const map = new Map(initial === undefined ? [] : [['halcyon:setup', initial]]);
    return {
      getItem: (key: string) => map.get(key) ?? null,
      setItem: (key: string, value: string) => void map.set(key, value),
      map,
    };
  };

  it('opens on a browser that has never seen this application', () => {
    expect(loadStatus(memory())).toBe('open');
  });

  it('reads back what was written', () => {
    const storage = memory();
    saveStatus(storage, 'skipped');

    expect(loadStatus(storage)).toBe('skipped');
  });

  it('opens rather than trusting a value it does not recognise', () => {
    // Anything else would leave someone with no keyboard, no wizard, and no
    // clue — over a storage key they never touched on purpose.
    expect(loadStatus(memory('finished'))).toBe('open');
  });

  it('does not throw when the browser refuses to write', () => {
    const hostile = {
      setItem: () => {
        throw new DOMException('QuotaExceededError');
      },
    };

    expect(() => saveStatus(hostile, 'done')).not.toThrow();
  });
});

describe('what the OBS row admits to', () => {
  it('waits quietly before anything was tried', () => {
    expect(obsNote('idle', 0)).toBe('waiting…');
  });

  it('shows the attempt while it runs', () => {
    expect(obsNote('connecting', 0)).toBe('connecting…');
  });

  it('says the password was refused, from where it was typed', () => {
    // The header pill said it all along, but the person mid-setup is looking
    // at the card, right under the field they just filled. Three different
    // failures used to share one "waiting…" — this is the one a retype fixes.
    expect(obsNote('auth-failed', 0)).toContain('password refused');
  });

  it('names the keystroke that retries a silent server', () => {
    // The retry rides on keyboard reports (spec §2.2): a screen nobody types
    // at never moves, so the note must say what moves it.
    expect(obsNote('unreachable', 0)).toContain('press a key');
    expect(obsNote('disconnected', 0)).toContain('press a key');
  });

  it('splits the socket from the browser source once connected', () => {
    // The socket is the easy half; the step is not cleared until something
    // inside OBS reports in, and the note says which half is missing.
    expect(obsNote('identified', 0)).toContain('connected');
    expect(obsNote('identified', 0)).toContain('waiting for the browser source');
  });

  it('claims no more than connected once a source listens', () => {
    expect(obsNote('identified', 1)).toBe('connected');
  });
});
