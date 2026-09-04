// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { autostartPath, browserFlavor, installHint, installState } from './startup';

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
