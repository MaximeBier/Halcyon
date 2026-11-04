import { describe, it, expect, afterEach, vi } from 'vitest';
import { browserLocalFonts } from './local-fonts';

afterEach(() => {
  delete (window as { queryLocalFonts?: unknown }).queryLocalFonts;
  vi.restoreAllMocks();
});

function withApi(query: () => Promise<unknown>, state: PermissionState = 'prompt') {
  (window as { queryLocalFonts?: unknown }).queryLocalFonts = query;
  Object.defineProperty(navigator, 'permissions', {
    configurable: true,
    value: { query: vi.fn(async () => ({ state })) },
  });
}

describe('browserLocalFonts.access', () => {
  it('says the browser cannot list fonts when it has no API for it', async () => {
    expect(await browserLocalFonts.access()).toBe('unsupported');
  });

  it('reports the permission as Chrome holds it', async () => {
    withApi(async () => [], 'granted');
    expect(await browserLocalFonts.access()).toBe('granted');

    withApi(async () => [], 'denied');
    expect(await browserLocalFonts.access()).toBe('denied');
  });

  it('falls back to asking when the permission cannot be queried', async () => {
    withApi(async () => []);
    Object.defineProperty(navigator, 'permissions', {
      configurable: true,
      value: { query: vi.fn(async () => Promise.reject(new TypeError('unknown name'))) },
    });

    expect(await browserLocalFonts.access()).toBe('prompt');
  });
});

describe('browserLocalFonts.read', () => {
  it('hands back each face as a family and a style', async () => {
    withApi(async () => [{ family: 'Arial', style: 'Bold', fullName: 'Arial Bold' }]);

    expect(await browserLocalFonts.read()).toEqual([{ family: 'Arial', style: 'Bold' }]);
  });

  it('says denied when a blocked Chrome answers with an empty list', async () => {
    // What Chrome does with fonts blocked in the site's settings: no error, no
    // fonts. A machine with no font at all does not exist.
    withApi(async () => [], 'denied');
    expect(await browserLocalFonts.read()).toBe('denied');
  });

  it('takes an empty list at its word when access is granted', async () => {
    withApi(async () => [], 'granted');
    expect(await browserLocalFonts.read()).toEqual([]);
  });

  it('says denied when Chrome refuses', async () => {
    withApi(async () => Promise.reject(new DOMException('no', 'NotAllowedError')));
    expect(await browserLocalFonts.read()).toBe('denied');

    withApi(async () => Promise.reject(new DOMException('no', 'SecurityError')));
    expect(await browserLocalFonts.read()).toBe('denied');
  });
});
