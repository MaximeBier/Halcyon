import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/svelte';
import Unsupported from './Unsupported.svelte';
import type { KeyboardStatus } from '../keyboard/device';

afterEach(cleanup);

const shown = (keyboard: KeyboardStatus) => render(Unsupported, { props: { keyboard } }).container;

describe('a browser that cannot run the capture page', () => {
  it('names what is needed, not what is missing', () => {
    // One sentence. What the browser lacks is diagnosis — it belongs to the
    // keyboard pill and the journal; a first-level banner only has to send
    // someone somewhere.
    const text = shown('unsupported').textContent ?? '';

    // Named, not "this page": the banner is the first line of a window that
    // may well have been opened from a link, and the product is what someone
    // will go looking for in the other browser.
    expect(text).toMatch(/he overlay/i);
    expect(text).toMatch(/chromium/i);
    expect(text.length).toBeLessThan(80);
  });

  it('is announced, not merely drawn', () => {
    // First-level for someone who cannot see the banner either.
    expect(shown('unsupported').querySelector('[role="alert"]')).not.toBeNull();
  });

  it('never appears on a browser that can, not even before the keyboard is found', () => {
    // `disconnected` is the status at load, before `resume()` has looked for a
    // device: a warning that flashed there would accuse every Chrome user for
    // a tick. The other three are all reached through `navigator.hid`, so they
    // are proof it exists.
    for (const status of [
      'disconnected',
      'no-permission',
      'connected',
      'no-analog-interface',
    ] as const)
      expect(shown(status).textContent).toBe('');
  });
});
