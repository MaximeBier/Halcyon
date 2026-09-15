// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import type { ObsResponse } from '../transport/obs';
import { isOverlayUrl, reloadLog, reloadSources, scanSources } from './sources';

const ORIGIN = 'https://halcyon.example';
const ok = (data: Record<string, unknown> = {}): ObsResponse => ({ ok: true, code: 100, data });
const none: ObsResponse = { ok: false, code: 0, data: {} };

/** An OBS with two browser sources of ours, one foreign, across two scenes. */
function fakeObs() {
  const calls: [string, Record<string, unknown> | undefined][] = [];
  const request = vi.fn(async (type: string, data?: Record<string, unknown>) => {
    calls.push([type, data]);
    switch (type) {
      case 'GetInputList':
        return ok({
          inputs: [
            { inputName: 'Twitch Chat' },
            { inputName: 'Keys overlay' },
            { inputName: 'Keys overlay 2' },
          ],
        });
      case 'GetInputSettings':
        return ok({
          inputSettings: {
            url:
              data?.inputName === 'Twitch Chat'
                ? 'https://chat.example/?channel=x'
                : `${ORIGIN}/overlay.html?port=4455#password=x`,
          },
        });
      case 'GetSceneList':
        return ok({
          scenes: [
            { sceneName: 'Racing cam', sceneUuid: 'u-race', sceneIndex: 0 },
            { sceneName: 'Gameplay', sceneUuid: 'u-game', sceneIndex: 1 },
          ],
        });
      case 'GetSceneItemList':
        return ok({
          sceneItems:
            data?.sceneName === 'Gameplay'
              ? [{ sourceName: 'Keys overlay' }, { sourceName: 'Twitch Chat' }]
              : [{ sourceName: 'Keys overlay' }, { sourceName: 'Keys overlay 2' }],
        });
      case 'PressInputPropertiesButton':
        return data?.inputName === 'Keys overlay 2' ? { ok: false, code: 600, data: {} } : ok();
      default:
        return none;
    }
  });
  return { request, calls };
}

describe('isOverlayUrl', () => {
  it('accepts our overlay on our origin only', () => {
    expect(isOverlayUrl(`${ORIGIN}/overlay.html?port=4455#password=x`, ORIGIN)).toBe(true);
    expect(isOverlayUrl('http://localhost:5173/overlay.html?port=4455', ORIGIN)).toBe(false);
    expect(isOverlayUrl(`${ORIGIN}/`, ORIGIN)).toBe(false);
    expect(isOverlayUrl('not a url', ORIGIN)).toBe(false);
    expect(isOverlayUrl(undefined, ORIGIN)).toBe(false);
  });
});

describe('scanSources', () => {
  it('names our sources, in OBS order, with the scenes that host them', async () => {
    const { request } = fakeObs();
    await expect(scanSources(request, ORIGIN)).resolves.toEqual([
      { name: 'Keys overlay', scenes: ['Gameplay', 'Racing cam'] },
      { name: 'Keys overlay 2', scenes: ['Racing cam'] },
    ]);
  });

  it('asks for browser sources only, and for scene items by scene name', async () => {
    const { request, calls } = fakeObs();
    await scanSources(request, ORIGIN);
    expect(calls[0]).toEqual(['GetInputList', { inputKind: 'browser_source' }]);
    expect(calls.filter(([t]) => t === 'GetSceneItemList').map(([, d]) => d)).toEqual([
      { sceneName: 'Gameplay' },
      { sceneName: 'Racing cam' },
    ]);
  });

  /** The same OBS, except that one source's settings come back refused. */
  function refusing(inputName: string, answer: ObsResponse) {
    const { request } = fakeObs();
    return async (type: string, data?: Record<string, unknown>) =>
      type === 'GetInputSettings' && data?.inputName === inputName
        ? answer
        : await request(type, data);
  }

  it('gives up when OBS stops answering mid-scan rather than report a short list', async () => {
    // Code 0 is the transport's "no answer": the rest of the scan would be
    // refused too, and a list missing half its sources would read as the truth.
    await expect(scanSources(refusing('Keys overlay', none), ORIGIN)).resolves.toBeNull();
  });

  it('skips a source OBS refuses by name and keeps the others', async () => {
    // A source renamed between two requests: one item lost, scan still valid.
    await expect(
      scanSources(refusing('Keys overlay', { ok: false, code: 600, data: {} }), ORIGIN),
    ).resolves.toEqual([{ name: 'Keys overlay 2', scenes: ['Racing cam'] }]);
  });

  it('answers null when OBS did not answer, and an empty list when nothing is ours', async () => {
    await expect(scanSources(async () => none, ORIGIN)).resolves.toBeNull();
    const { request } = fakeObs();
    await expect(scanSources(request, 'https://elsewhere.example')).resolves.toEqual([]);
  });
});

describe('reloadSources', () => {
  it('presses the refresh button of every source and counts the ones that took', async () => {
    const { request, calls } = fakeObs();
    await expect(reloadSources(request, ['Keys overlay', 'Keys overlay 2'])).resolves.toBe(1);
    expect(calls.map(([, d]) => d)).toEqual([
      { inputName: 'Keys overlay', propertyName: 'refreshnocache' },
      { inputName: 'Keys overlay 2', propertyName: 'refreshnocache' },
    ]);
  });

  it('words the log for the report', () => {
    expect(reloadLog(2, 2)).toBe('Reloaded 2 Halcyon sources in OBS.');
    expect(reloadLog(1, 2)).toBe('Reloaded 1 of 2 Halcyon sources in OBS.');
    expect(reloadLog(0, 0)).toBe('No Halcyon source in OBS to reload.');
  });
});
