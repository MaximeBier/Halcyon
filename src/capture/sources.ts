import type { ObsResponse } from '../transport/obs';

/** A browser source of ours in OBS, and the scenes it sits in. */
export interface HalcyonSource {
  name: string;
  scenes: string[];
}

export type ObsRequest = (
  requestType: string,
  requestData?: Record<string, unknown>,
) => Promise<ObsResponse>;

/**
 * Ours: same origin as this page, and the overlay path.
 *
 * Same origin and not merely the path: a dev page on localhost has no
 * business reloading the production sources next to it in the same OBS, and
 * Maxime runs exactly that setup.
 */
export function isOverlayUrl(url: unknown, origin: string): boolean {
  if (typeof url !== 'string') return false;
  try {
    const parsed = new URL(url);
    return parsed.origin === origin && parsed.pathname === '/overlay.html';
  } catch {
    return false;
  }
}

/**
 * A refusal no OBS ever sent. Code 0 is the transport's own `NO_ANSWER` (see
 * `src/transport/obs.ts`): nobody was there to answer — the socket went, or the
 * client is no longer identified. Every refusal OBS itself sends carries a
 * RequestStatus code, so code 0 is the one that means the scan lost its OBS.
 */
const gone = (answer: ObsResponse): boolean => !answer.ok && answer.code === 0;

const names = (list: unknown, key: string): string[] =>
  Array.isArray(list)
    ? list
        .map((entry) => (entry as Record<string, unknown> | null)?.[key])
        .filter((name): name is string => typeof name === 'string')
    : [];

/**
 * Every browser source pointing at our overlay, with its host scenes.
 *
 * Four kinds of request, in sequence: the browser inputs, each one's URL,
 * the scenes, each scene's items. One request per source and per scene — a
 * few dozen at most, once per connection and once per click. Nested groups
 * are not walked: a source inside a group is listed with no scene, not lost.
 *
 * `null` when OBS gave no answer — not connected, whether at the first request
 * or halfway through — so the caller can tell "nothing there" from "nobody
 * asked", and never takes a list cut short by a lost socket for the truth.
 */
export async function scanSources(
  request: ObsRequest,
  origin: string,
): Promise<HalcyonSource[] | null> {
  const inputs = await request('GetInputList', { inputKind: 'browser_source' });
  if (!inputs.ok) return null;

  const ours: string[] = [];
  for (const name of names(inputs.data.inputs, 'inputName')) {
    const settings = await request('GetInputSettings', { inputName: name });
    // A source OBS refuses by name — renamed between two requests — costs one
    // item; an OBS that stopped answering costs the whole list's meaning.
    if (gone(settings)) return null;
    const url = (settings.data.inputSettings as Record<string, unknown> | undefined)?.url;
    if (settings.ok && isOverlayUrl(url, origin)) ours.push(name);
  }
  if (ours.length === 0) return [];

  const hosts = new Map<string, string[]>(ours.map((name) => [name, []]));
  const scenes = await request('GetSceneList');
  if (gone(scenes)) return null;
  const ordered = (Array.isArray(scenes.data.scenes) ? [...scenes.data.scenes] : [])
    .map((entry) => entry as Record<string, unknown>)
    .sort((a, b) => Number(b.sceneIndex ?? 0) - Number(a.sceneIndex ?? 0));
  for (const scene of ordered) {
    if (typeof scene.sceneName !== 'string') continue;
    const items = await request('GetSceneItemList', { sceneName: scene.sceneName });
    if (gone(items)) return null;
    for (const source of names(items.data.sceneItems, 'sourceName')) {
      hosts.get(source)?.push(scene.sceneName);
    }
  }
  return ours.map((name) => ({ name, scenes: hosts.get(name) ?? [] }));
}

/**
 * The "Refresh cache of current page" button of each source, pressed from
 * here. Counts the presses OBS accepted: a source renamed between the scan
 * and the click is refused by name, and the label should not claim it.
 */
export async function reloadSources(
  request: ObsRequest,
  sources: readonly string[],
): Promise<number> {
  let reloaded = 0;
  for (const inputName of sources) {
    const answer = await request('PressInputPropertiesButton', {
      inputName,
      propertyName: 'refreshnocache',
    });
    if (answer.ok) reloaded += 1;
  }
  return reloaded;
}

export function reloadLog(reloaded: number, found: number): string {
  if (found === 0) return 'No Halcyon source in OBS to reload.';
  const noun = `Halcyon source${found === 1 ? '' : 's'}`;
  return reloaded === found
    ? `Reloaded ${reloaded} ${noun} in OBS.`
    : `Reloaded ${reloaded} of ${found} ${noun} in OBS.`;
}
