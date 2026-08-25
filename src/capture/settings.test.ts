import { describe, it, expect } from 'vitest';
import {
  overlayTally,
  captureWarning,
  sourceState,
  loadSettings,
  saveSettings,
  overlayUrl,
  keyboardHint,
  obsHint,
  browserStorage,
} from './settings';
import { readOverlayParams } from '../overlay/params';

function memoryStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    map,
  };
}

describe('credential persistence', () => {
  it('falls back to port 4455 and an empty password', () => {
    expect(loadSettings(memoryStorage())).toEqual({ port: 4455, password: '' });
  });

  it('reads back what was saved', () => {
    const storage = memoryStorage();
    saveSettings(storage, { port: 4456, password: 'hunter2' });

    expect(loadSettings(storage)).toEqual({ port: 4456, password: 'hunter2' });
  });

  it('survives a corrupted value in storage', () => {
    expect(loadSettings(memoryStorage({ 'halcyon:connection': '{{{' }))).toEqual({
      port: 4455,
      password: '',
    });
  });

  it('does not throw when the browser refuses to write', () => {
    // saveSettings runs just before the OBS client is rebuilt. Letting a quota
    // error out of it aborts the reconnection: the user retypes their password,
    // nothing happens, and nothing says why.
    const hostile = {
      setItem: () => {
        throw new DOMException('QuotaExceededError');
      },
    };

    expect(() => saveSettings(hostile, { port: 4455, password: 'hunter2' })).not.toThrow();
  });

  it('hands back a usable storage even when local storage is unreachable', () => {
    // Reading the property itself throws with cookies blocked, and it happens
    // while the component initialises — the capture page would not mount.
    const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('SecurityError');
      },
    });

    try {
      const storage = browserStorage();
      saveSettings(storage, { port: 4456, password: 'hunter2' });

      expect(loadSettings(storage)).toEqual({ port: 4456, password: 'hunter2' });
    } finally {
      if (original) Object.defineProperty(globalThis, 'localStorage', original);
    }
  });

  it('can delete, even on the fallback: profiles remove their own keys', () => {
    // The profile store is the first caller that deletes. A fallback without
    // `removeItem` throws on the first profile anyone removes — in a browser
    // that already refuses storage, so nowhere near a development machine.
    const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('SecurityError');
      },
    });

    try {
      const storage = browserStorage();
      storage.setItem('halcyon:profile:Apex', '{}');
      storage.removeItem('halcyon:profile:Apex');

      expect(storage.getItem('halcyon:profile:Apex')).toBeNull();
    } finally {
      if (original) Object.defineProperty(globalThis, 'localStorage', original);
    }
  });

  it('refuses a port no URL could carry', () => {
    const stored = JSON.stringify({ port: 99999, password: 'hunter2' });

    expect(loadSettings(memoryStorage({ 'halcyon:connection': stored }))).toEqual({
      port: 4455,
      password: 'hunter2',
    });
  });
});

describe('overlayUrl', () => {
  it('carries the password in the fragment, never in the query string', () => {
    // A query string lands in the access log of whoever hosts the page — us.
    // This URL is the one place the capture page hands a password to the user,
    // so it is the one place that decides where their credentials travel.
    expect(overlayUrl('https://halcyon.example', { port: 4455, password: 'a&b' })).toBe(
      'https://halcyon.example/overlay.html?port=4455#password=a%26b',
    );
  });

  it('adds no fragment for an empty password', () => {
    expect(overlayUrl('http://localhost:5173', { port: 4455, password: '' })).toBe(
      'http://localhost:5173/overlay.html?port=4455',
    );
  });

  it('produces a URL the overlay reads back unchanged', () => {
    // The two sides encode independently; only a round trip proves they agree.
    const settings = { port: 4456, password: 'p@ss w&rd=#é' };
    const url = new URL(overlayUrl('https://halcyon.example', settings));

    expect(readOverlayParams(url.search, url.hash)).toEqual(settings);
  });
});

describe('status bar wording', () => {
  it('says what to do, not what failed', () => {
    expect(keyboardHint('no-permission')).toMatch(/allow/i);
    expect(keyboardHint('disconnected')).toMatch(/plug|connect/i);
    expect(keyboardHint('unsupported')).toMatch(/chrome|edge/i);
    expect(keyboardHint('no-analog-interface')).toMatch(/analog/i);
    expect(obsHint('unreachable')).toMatch(/websocket server/i);
    // Chrome asks for local network access, and blocks until it is granted
    // (spec §2.1, §11). It asks exactly once: a refusal is permanent until
    // site settings lift it, so the hint has to name the way back.
    expect(obsHint('unreachable')).toMatch(/local network/i);
    expect(obsHint('unreachable')).toMatch(/site settings/i);
    expect(obsHint('auth-failed')).toMatch(/password/i);
  });

  it('tells a refused password apart from an unreachable server', () => {
    expect(obsHint('auth-failed')).not.toBe(obsHint('unreachable'));
  });

  it('tells a server that never answered apart from one that went away', () => {
    expect(obsHint('disconnected')).not.toBe(obsHint('unreachable'));
    // A connection that closed says how to get it back: nothing retries on its
    // own, the reconnection rides on keyboard reports, and that sentence is the
    // whole message.
    expect(obsHint('disconnected')).toMatch(/key/i);
  });

  it('leaves the keystroke out of the unreachable hint, which has more to say', () => {
    // It said it until 2026-08-24, and the sentence had grown to three
    // instructions — enough to wrap the status bar onto a third row and push
    // the other four pills apart. The keystroke is the cheapest of the three
    // to drop: it is what anyone using a keyboard overlay does next anyway,
    // and the wizard's OBS row still spells it out where a beginner is looking.
    expect(obsHint('unreachable')).not.toMatch(/press a key/i);
  });

  it('keeps the unreachable hint short enough to sit in a run of pills', () => {
    // The status bar is a wrapping flex row (StatusBar.svelte), so a long
    // sentence in the middle of it does not merely wrap itself — it pushes
    // every pill after it onto another row. The cap is a round number, not a
    // measurement: what it guards is that nobody appends a fourth instruction
    // here without noticing what it costs the bar.
    expect(obsHint('unreachable').length).toBeLessThan(140);
  });
});

describe('overlayTally', () => {
  it('says nobody has reported in, once OBS is there to report through', () => {
    expect(overlayTally({ inObs: 0, inBrowser: 0 }, true)).toMatch(/no overlay/i);
  });

  it('says nothing at all when OBS is down and the zero is arithmetic', () => {
    // Heartbeats only arrive over the OBS socket, and the registry is cleared
    // when it drops — so "no overlay" there is not an observation, it is the
    // OBS pill said twice, in red, on a row of its own.
    expect(overlayTally({ inObs: 0, inBrowser: 0 }, false)).toBeNull();
  });

  it('still names whoever is listening when OBS has just gone', () => {
    // Between the socket dropping and the registry being cleared, a count that
    // vanished would read as the overlays having left. Only the empty case is
    // redundant; a number never is.
    expect(overlayTally({ inObs: 1, inBrowser: 0 }, false)).toBe('1 overlay in OBS');
  });

  it('names the one that matters on its own', () => {
    // The overlay in OBS is the one on air. It is the figure someone is looking
    // for, so it comes first and it is never folded into a total.
    expect(overlayTally({ inObs: 1, inBrowser: 0 }, true)).toBe('1 overlay in OBS');
    expect(overlayTally({ inObs: 2, inBrowser: 0 }, true)).toBe('2 overlays in OBS');
  });

  it('counts a tab apart, since opening one is how the count got useless', () => {
    expect(overlayTally({ inObs: 0, inBrowser: 1 }, true)).toBe('1 overlay in a browser');
    expect(overlayTally({ inObs: 1, inBrowser: 1 }, true)).toBe(
      '1 overlay in OBS · 1 in a browser',
    );
    expect(overlayTally({ inObs: 2, inBrowser: 3 }, true)).toBe(
      '2 overlays in OBS · 3 in a browser',
    );
  });
});

describe('captureWarning', () => {
  it('says nothing at all when this page is the only one talking', () => {
    expect(captureWarning(false)).toBeNull();
  });

  // Plainly in the status bar, never behind a fold: this is the failure where
  // both pages look perfectly healthy while the overlay swings between two
  // layouts, so nothing about it is discoverable by looking closer.
  //
  // Both steps, in the order they work. Closing the other pages stops them
  // speaking; reloading this one resends this configuration, which is what
  // takes the overlay back — and is the only thing that clears the warning,
  // since it never lifts on its own.
  it('says that others are open, and the two steps out', () => {
    expect(captureWarning(true)).toBe(
      'Other capture pages are open. Close them, then reload this page.',
    );
  });

  // Quoting a number would mean knowing one, and a page draws a fresh name on
  // every load: a tab reloaded three times reads as three pages. The plural is
  // carried by the instruction, which is right for one page and for five.
  it('quotes no figure it cannot stand behind', () => {
    expect(captureWarning(true)).not.toMatch(/\d/);
  });
});

describe('sourceState', () => {
  it('confirms the source only when it is in OBS', () => {
    expect(sourceState({ inObs: 1, inBrowser: 0 })).toMatch(/connected in OBS/);
    expect(sourceState({ inObs: 1, inBrowser: 3 })).toMatch(/connected in OBS/);
  });

  // The step exists to prove the URL reached OBS, and this is the state that
  // used to read as success: a tab opened to check the overlay works.
  it('says which half is missing when only a tab answers', () => {
    expect(sourceState({ inObs: 0, inBrowser: 1 })).toMatch(/no source in OBS yet/);
  });

  it('says nothing has reported in when nothing has', () => {
    expect(sourceState({ inObs: 0, inBrowser: 0 })).toMatch(/No overlay/);
  });
});
