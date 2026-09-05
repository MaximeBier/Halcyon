import { describe, it, expect } from 'vitest';
import {
  obsPill,
  canPickDevice,
  canRetryObs,
  captureWarning,
  sourceState,
  loadSettings,
  saveSettings,
  overlayUrl,
  keyboardHint,
  keyboardPill,
  obsHint,
  obsProbeHint,
  createObsProbe,
  browserStorage,
} from './settings';
import { readOverlayParams } from '../overlay/params';
import { FakeSocket, HELLO_NO_AUTH } from '../test/fixtures';

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

describe('what a pill offers to do about itself', () => {
  it('offers the device picker for every keyboard state a picker could fix', () => {
    // The panel's own button already covers three of these: nothing chosen
    // yet, nothing plugged in, and the wrong interface chosen out of the ones
    // Chrome lists for the vendor. `open-failed` joins them: the hint
    // (`keyboardHint`) tells the reader to "try again", and requestPermission()
    // is that retry — closing Wootility, then reopening the picker and
    // choosing the same device, calls open() again.
    expect(canPickDevice('no-permission')).toBe(true);
    expect(canPickDevice('disconnected')).toBe(true);
    expect(canPickDevice('no-analog-interface')).toBe(true);
    expect(canPickDevice('open-failed')).toBe(true);
  });

  it('offers nothing when a picker cannot help', () => {
    // A keyboard that works needs no gesture, and on a browser without WebHID
    // the picker does not exist — offering it is how someone clicks four times.
    expect(canPickDevice('connected')).toBe(false);
    expect(canPickDevice('unsupported')).toBe(false);
  });

  it('offers a retry only where a fresh attempt is the way in', () => {
    // Unreachable is the one that a click can change: the attempt itself is
    // what raises Chrome's local network prompt, and the WebSocket server may
    // have been switched on since. A refused password wants the field, not
    // another identical attempt.
    expect(canRetryObs('unreachable')).toBe(true);
    expect(canRetryObs('auth-failed')).toBe(false);
    expect(canRetryObs('identified')).toBe(false);
    expect(canRetryObs('connecting')).toBe(false);
    expect(canRetryObs('idle')).toBe(false);
  });

  it('offers a retry in disconnected too, since nothing else executes its own hint', () => {
    // obsHint('disconnected') says "press a key to reconnect" — unexecutable
    // without a keyboard plugged in and typing. Same reasoning as
    // `open-failed` joining `canPickDevice`: a hint must never invite a click
    // the control refuses. Found in review on 2026-09-04.
    expect(canRetryObs('disconnected')).toBe(true);
  });
});

describe('keyboardPill', () => {
  it('names the device once it answers', () => {
    expect(keyboardPill('connected', 'Wooting 60HE+')).toBe('Wooting 60HE+');
  });

  it('still says connected when the device gave no name', () => {
    expect(keyboardPill('connected', null)).toMatch(/connected/i);
  });

  it('invites the click on every state a picker could fix, and only there', () => {
    for (const status of [
      'no-permission',
      'disconnected',
      'no-analog-interface',
      'open-failed',
      'unsupported',
    ] as const) {
      expect(/click/.test(keyboardPill(status, null))).toBe(canPickDevice(status));
    }
  });

  it('names the browsers when there is no WebHID to click for', () => {
    expect(keyboardPill('unsupported', null)).toMatch(/chrome|edge/i);
  });
});

describe('status bar wording', () => {
  it('says what to do, not what failed', () => {
    // The pill is the button now, so it names the gesture rather than sending
    // the reader to a control somewhere else on the page.
    expect(keyboardHint('no-permission')).toMatch(/pick/i);
    expect(keyboardHint('no-permission')).not.toMatch(/click/i);
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

  it('names the firmware first when no analog interface is found', () => {
    // Observed 2026-08-24: same keyboard model, an out-of-date firmware, and
    // the 0xFF53 usage page simply absent. Wootility is the fix, and it is the
    // first thing to try — the old wording sent people to a diagnostics panel
    // that shows neither the vendor id nor the usage pages.
    expect(keyboardHint('no-analog-interface')).toMatch(/wootility/i);
    expect(keyboardHint('no-analog-interface')).toMatch(/firmware/i);
    expect(keyboardHint('no-analog-interface')).not.toMatch(/diagnostics/i);
  });

  it('keeps every clickable hint short enough to sit in a run of pills', () => {
    // Same cap and same reason as the unreachable hint below: the bar is a
    // wrapping flex row, so a long sentence pushes every pill after it down.
    expect(keyboardHint('no-analog-interface').length).toBeLessThan(140);
  });

  it('names Wootility when the device refused to open', () => {
    // `open()` rejecting (NotReadableError on Windows) means something else
    // already holds the device exclusively — Wootility is the concrete first
    // guess, and the hint has to say to try again, since that is the whole
    // point of surfacing this rather than leaving the status stuck.
    expect(keyboardHint('open-failed')).toMatch(/wootility/i);
    expect(keyboardHint('open-failed')).toMatch(/try again/i);
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

describe('obsProbeHint', () => {
  it('translates every terminal status into a sentence, never the bare enum', () => {
    // The Diagnostics panel printed the raw status ("identified",
    // "auth-failed", "unreachable") while every other surface in the app
    // translates one of these through a hint. Found in review on 2026-09-04.
    expect(obsProbeHint('identified')).toMatch(/connection ok/i);
    expect(obsProbeHint('auth-failed')).toMatch(/password/i);
    expect(obsProbeHint('unreachable')).toMatch(/unreachable/i);
    expect(obsProbeHint('testing')).toBe('Testing…');

    for (const status of ['identified', 'auth-failed', 'unreachable', 'testing'] as const) {
      expect(obsProbeHint(status)).not.toBe(status);
    }
  });
});

describe('createObsProbe', () => {
  function setup() {
    const sockets: FakeSocket[] = [];
    const seen: (string | null)[] = [];
    const probe = createObsProbe({
      connectOptions: () => ({
        url: 'ws://localhost:4455',
        password: 'hunter2',
        socketFactory: () => {
          const socket = new FakeSocket();
          sockets.push(socket);
          return socket;
        },
      }),
      onStatus: (status) => seen.push(status),
    });
    return { probe, sockets, seen };
  }

  it('opens exactly one socket, even when clicked twice before it answers', () => {
    // Two rapid clicks used to create two throwaway connections racing to
    // answer, and OBS kept showing a second client if the first was never
    // told to close. Found in review on 2026-09-04.
    const { probe, sockets } = setup();

    probe.run();
    probe.run();

    expect(sockets).toHaveLength(1);
  });

  it('closes the stale probe on a second click, so a hung one is not stuck forever', () => {
    // A server that accepts the TCP connection without ever finishing the
    // WebSocket handshake sends no terminal status, ever — and there is no
    // timer on this page to notice. The second click is the only way back.
    const { probe, sockets, seen } = setup();

    probe.run();
    probe.run();

    expect(sockets[0]!.closed).toBe(true);
    expect(seen.at(-1)).toBeNull();
  });

  it('reports the real answer once the handshake finishes, and closes itself', () => {
    const { probe, sockets, seen } = setup();

    probe.run();
    sockets[0]!.receive(HELLO_NO_AUTH);
    sockets[0]!.receive({ op: 2, d: { negotiatedRpcVersion: 1 } });

    expect(seen).toEqual(['testing', 'identified']);
    expect(sockets[0]!.closed).toBe(true);
  });

  it('is free to run again once the previous probe has answered', () => {
    const { probe, sockets } = setup();

    probe.run();
    sockets[0]!.receive(HELLO_NO_AUTH);
    sockets[0]!.receive({ op: 2, d: { negotiatedRpcVersion: 1 } });

    probe.run();

    expect(sockets).toHaveLength(2);
  });
});

describe('obsPill', () => {
  const none = { inObs: 0, inBrowser: 0 };

  it('carries the tally and the throughput once connected', () => {
    expect(obsPill('identified', { inObs: 1, inBrowser: 0 }, 58)).toBe('OBS · 1 overlay · 58 fps');
    expect(obsPill('identified', { inObs: 2, inBrowser: 0 }, 0)).toBe('OBS · 2 overlays · 0 fps');
  });

  it('says nobody has reported in, once OBS is there to report through', () => {
    expect(obsPill('identified', none, 0)).toMatch(/no overlay/i);
  });

  it('counts a tab apart, since opening one is how a single count got useless', () => {
    // The overlay in OBS is the one on air: it comes first and is never
    // folded into a total (spec §16.7).
    expect(obsPill('identified', { inObs: 0, inBrowser: 1 }, 58)).toBe(
      'OBS · 1 overlay in a browser · 58 fps',
    );
    expect(obsPill('identified', { inObs: 1, inBrowser: 1 }, 58)).toBe(
      'OBS · 1 overlay · 1 in a browser · 58 fps',
    );
    expect(obsPill('identified', { inObs: 2, inBrowser: 3 }, 58)).toBe(
      'OBS · 2 overlays · 3 in a browser · 58 fps',
    );
  });

  it('prints neither figure while OBS is down, where both could only be constants', () => {
    // Heartbeats only arrive over the OBS socket and the registry is cleared
    // when it drops; the rate is zeroed there too. Neither is a measurement.
    for (const status of [
      'idle',
      'connecting',
      'unreachable',
      'disconnected',
      'auth-failed',
    ] as const) {
      expect(obsPill(status, { inObs: 1, inBrowser: 1 }, 58)).not.toMatch(/overlay|fps/);
    }
  });

  it('invites the click on exactly the states the pill retries', () => {
    for (const status of [
      'idle',
      'connecting',
      'unreachable',
      'disconnected',
      'auth-failed',
    ] as const) {
      expect(/click to retry/.test(obsPill(status, none, 0))).toBe(canRetryObs(status));
    }
  });

  it('names the password when that is what OBS refused', () => {
    expect(obsPill('auth-failed', none, 0)).toMatch(/password/i);
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
    expect(captureWarning(true)).toBe('Other capture pages open · close them, then reload');
  });

  // It sits in the run of pills, not on a line of its own (the header wrapped
  // onto a second row for it, which is what got it shortened).
  it('fits a pill', () => {
    expect(captureWarning(true)!.length).toBeLessThan(60);
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
