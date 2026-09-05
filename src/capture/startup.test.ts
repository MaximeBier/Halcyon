// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  autostartPath,
  browserFlavor,
  installHint,
  installState,
  runsStandalone,
  watchInstall,
} from './startup';

const CHROME_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36';
const EDGE_UA = `${CHROME_UA} Edg/139.0.0.0`;

describe('installState - where the install step stands', () => {
  it('reports the app window when the page runs in one', () => {
    // `standalone` wins over everything: whatever events fired on the way,
    // being inside the installed window is the step already done.
    expect(installState({ standalone: true, installed: true, promptAvailable: true })).toBe(
      'standalone',
    );
  });

  it('reports installed once the browser said so, even from the old tab', () => {
    // `appinstalled` fires in the tab that triggered the install. That tab
    // never becomes standalone — the app opened in its own window — so without
    // this state the step would fall back to the manual hint and look undone.
    expect(installState({ standalone: false, installed: true, promptAvailable: false })).toBe(
      'installed',
    );
  });

  it('offers the button while the browser holds an install prompt', () => {
    expect(installState({ standalone: false, installed: false, promptAvailable: true })).toBe(
      'installable',
    );
  });

  it('falls back to the manual path when no prompt ever came', () => {
    // Already installed but opened as a tab, or a browser that never fires
    // `beforeinstallprompt`. Either way the address bar icon is the answer.
    expect(installState({ standalone: false, installed: false, promptAvailable: false })).toBe(
      'manual',
    );
  });
});

describe('browserFlavor - which apps page to send someone to', () => {
  it('recognises Edge by its own token', () => {
    expect(browserFlavor(EDGE_UA)).toBe('edge');
  });

  it('reads everything else as Chrome', () => {
    // WebHID narrows the field to Chromium; anything not naming itself Edge
    // gets the Chrome instructions, which its forks answer to as well.
    expect(browserFlavor(CHROME_UA)).toBe('chrome');
  });
});

describe('autostartPath - the address the guide cannot link to', () => {
  // A web page may not link to chrome:// addresses — the browser refuses the
  // navigation. The guide shows the address to copy instead, so the address
  // itself is data, not wording, and it is asserted verbatim.
  it('sends Chrome users to chrome://apps and its context menu', () => {
    const path = autostartPath('chrome');

    expect(path.address).toBe('chrome://apps');
    expect(path.instruction).toContain('Start app when you sign in');
  });

  it('sends Edge users to edge://apps and its details toggle', () => {
    const path = autostartPath('edge');

    expect(path.address).toBe('edge://apps');
    expect(path.instruction).toContain('Auto-start on device login');
  });
});

describe('installHint - the line that stands where the button cannot', () => {
  it('says nothing while the button is the answer', () => {
    expect(installHint('installable')).toBeNull();
  });

  it('confirms the app window from inside it', () => {
    expect(installHint('standalone')).toBe('You are in the installed app.');
  });

  it('confirms an install seen from the old tab', () => {
    expect(installHint('installed')).toBe('Installed — Halcyon has its own window now.');
  });

  it('points at the address bar when no prompt ever came', () => {
    expect(installHint('manual')).toBe('Use the install icon at the right end of the address bar.');
  });
});

describe('watchInstall - the prompt is held from the first moment of the page', () => {
  function fakeWindow() {
    const listeners = new Map<string, (event: Event) => void>();
    return {
      addEventListener: (type: string, handler: (event: Event) => void) =>
        void listeners.set(type, handler),
      removeEventListener: (type: string) => void listeners.delete(type),
      fire: (type: string, event: Event = new Event(type, { cancelable: true })) => {
        listeners.get(type)?.(event);
        return event;
      },
      listening: () => [...listeners.keys()].sort(),
    };
  }

  it('stashes the prompt and stops the browser asking on its own', () => {
    const target = fakeWindow();
    const seen: unknown[] = [];
    watchInstall(target, (state) => seen.push(state));

    const prompt = () => Promise.resolve();
    const event = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), { prompt });
    target.fire('beforeinstallprompt', event);

    expect(event.defaultPrevented).toBe(true);
    expect(seen).toEqual([{ prompt: event, installed: false }]);
  });

  it('spends the prompt when the install is announced from the tab', () => {
    // `appinstalled` fires in the tab that triggered the install; whatever
    // prompt that tab still held is used up.
    const target = fakeWindow();
    const seen: { prompt: unknown; installed: boolean }[] = [];
    watchInstall(target, (state) => seen.push(state));

    target.fire('beforeinstallprompt');
    target.fire('appinstalled');

    expect(seen.at(-1)).toEqual({ prompt: null, installed: true });
  });

  it('lets go of both listeners', () => {
    const target = fakeWindow();
    const stop = watchInstall(target, () => {});
    expect(target.listening()).toEqual(['appinstalled', 'beforeinstallprompt']);

    stop();

    expect(target.listening()).toEqual([]);
  });
});

describe('runsStandalone - whether the page is in the app window', () => {
  it('asks the display mode', () => {
    expect(runsStandalone(() => ({ matches: true }))).toBe(true);
    expect(runsStandalone(() => ({ matches: false }))).toBe(false);
  });

  it('answers no where it cannot ask', () => {
    // jsdom has no `matchMedia`; a page that cannot ask is not in an app window.
    expect(runsStandalone(undefined)).toBe(false);
  });
});
