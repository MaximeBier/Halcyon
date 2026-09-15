// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  linkButtonState,
  linkedProfile,
  loadSceneLinks,
  parseSceneChanged,
  parseSceneList,
  saveSceneLinks,
  SCENE_LINKS_KEY,
  sceneRows,
  sceneSwitchLog,
  sceneSwitchToast,
  withLink,
  withNamesFrom,
  withoutLink,
  withoutProfile,
  withProfileRenamed,
  type SceneLink,
} from './scenes';

function memory(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    dump: () => Object.fromEntries(map),
  };
}

const GAMEPLAY = { uuid: 'u-game', name: 'Gameplay' };
const RACING = { uuid: 'u-race', name: 'Racing cam' };
const BRB = { uuid: 'u-brb', name: 'BRB' };
const LINKS: SceneLink[] = [
  { uuid: 'u-game', name: 'Gameplay', profile: 'Apex ranked' },
  { uuid: 'u-chat', name: 'Just chatting', profile: 'Vholume' },
];

describe('persistence', () => {
  it('round-trips through storage under its own key', () => {
    const storage = memory();
    saveSceneLinks(storage, LINKS);
    expect(Object.keys(storage.dump())).toEqual([SCENE_LINKS_KEY]);
    expect(loadSceneLinks(storage)).toEqual(LINKS);
  });

  it('starts empty on nothing, garbage, or entries missing a field', () => {
    expect(loadSceneLinks(memory())).toEqual([]);
    expect(loadSceneLinks(memory({ [SCENE_LINKS_KEY]: '{not json' }))).toEqual([]);
    const partial = JSON.stringify([{ uuid: 'u', name: 'n' }, LINKS[0]]);
    expect(loadSceneLinks(memory({ [SCENE_LINKS_KEY]: partial }))).toEqual([LINKS[0]]);
  });

  it('survives a storage that refuses to write', () => {
    const refusing = {
      setItem: () => {
        throw new Error('quota');
      },
    };
    expect(() => saveSceneLinks(refusing, LINKS)).not.toThrow();
  });
});

describe('reading OBS', () => {
  it('orders scenes as OBS shows them: highest sceneIndex first', () => {
    const parsed = parseSceneList({
      currentProgramSceneUuid: 'u-race',
      currentProgramSceneName: 'Racing cam',
      scenes: [
        { sceneName: 'BRB', sceneUuid: 'u-brb', sceneIndex: 0 },
        { sceneName: 'Racing cam', sceneUuid: 'u-race', sceneIndex: 1 },
        { sceneName: 'Gameplay', sceneUuid: 'u-game', sceneIndex: 2 },
      ],
    });
    expect(parsed.scenes).toEqual([GAMEPLAY, RACING, BRB]);
    expect(parsed.current).toBe('u-race');
  });

  it('drops malformed entries and reads no current scene from an empty answer', () => {
    expect(parseSceneList({})).toEqual({ scenes: [], current: null });
    expect(parseSceneList({ scenes: [{ sceneName: 'x' }, 42] }).scenes).toEqual([]);
  });

  it('reads a scene change, and refuses one without a uuid', () => {
    expect(parseSceneChanged({ sceneName: 'Gameplay', sceneUuid: 'u-game' })).toEqual(GAMEPLAY);
    expect(parseSceneChanged({ sceneName: 'Gameplay' })).toBeNull();
  });
});

describe('rows', () => {
  it('lists every OBS scene in OBS order, then the links OBS no longer knows', () => {
    const rows = sceneRows([GAMEPLAY, RACING, BRB], LINKS, 'u-game');
    expect(rows.map((r) => [r.name, r.profile, r.live, r.missing])).toEqual([
      ['Gameplay', 'Apex ranked', true, false],
      ['Racing cam', null, false, false],
      ['BRB', null, false, false],
      ['Just chatting', 'Vholume', false, true],
    ]);
  });

  it('shows the links alone, none missing, before OBS has answered', () => {
    const rows = sceneRows(null, LINKS, null);
    expect(rows.map((r) => [r.name, r.missing, r.live])).toEqual([
      ['Gameplay', false, false],
      ['Just chatting', false, false],
    ]);
  });
});

describe('editing', () => {
  it('adds, replaces and removes a link without touching the others', () => {
    const added = withLink(LINKS, RACING, 'Racing');
    expect(added).toHaveLength(3);
    expect(linkedProfile(added, 'u-race')).toBe('Racing');

    const replaced = withLink(added, GAMEPLAY, 'Valorant');
    expect(linkedProfile(replaced, 'u-game')).toBe('Valorant');
    expect(replaced).toHaveLength(3);

    expect(withLink(replaced, GAMEPLAY, null).map((l) => l.uuid)).toEqual(['u-chat', 'u-race']);
    expect(withoutLink(replaced, 'u-chat').map((l) => l.uuid)).toEqual(['u-race', 'u-game']);
    expect(LINKS).toHaveLength(2);
  });

  it('follows a scene renamed in OBS, by uuid', () => {
    const renamed = withNamesFrom(LINKS, [{ uuid: 'u-game', name: 'Game (main)' }]);
    expect(renamed[0]!.name).toBe('Game (main)');
    expect(renamed[1]!.name).toBe('Just chatting');
  });

  it('follows a profile renamed or removed in Halcyon', () => {
    expect(withProfileRenamed(LINKS, 'Apex ranked', 'Apex')[0]!.profile).toBe('Apex');
    expect(withoutProfile(LINKS, 'Vholume').map((l) => l.uuid)).toEqual(['u-game']);
  });
});

describe('what the interface says', () => {
  it('pitches until something is linked, goes quiet after, and is inert without OBS', () => {
    expect(linkButtonState('identified', 0)).toBe('pitch');
    expect(linkButtonState('identified', 1)).toBe('quiet');
    expect(linkButtonState('disconnected', 3)).toBe('inert');
    expect(linkButtonState('idle', 0)).toBe('inert');
  });

  it('names the scene and the profile in the toast and in the log', () => {
    expect(sceneSwitchToast('Gameplay', 'Apex ranked')).toEqual({
      tone: 'success',
      message: 'OBS scene “Gameplay” opened “Apex ranked”',
    });
    expect(sceneSwitchLog('Gameplay', 'Apex ranked')).toBe('Scene Gameplay → opened Apex ranked');
  });
});
