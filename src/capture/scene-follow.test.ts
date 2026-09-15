// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import type { ObsResponse } from '../transport/obs';
import { SCENE_LINKS_KEY, type SceneLink } from './scenes';
import type { Notice } from './notice';
import { createSceneFollower, type SceneState } from './scene-follow';

const ok = (data: Record<string, unknown>): ObsResponse => ({ ok: true, code: 100, data });
const none: ObsResponse = { ok: false, code: 0, data: {} };
const LIST = ok({
  currentProgramSceneUuid: 'u-brb',
  scenes: [
    { sceneName: 'BRB', sceneUuid: 'u-brb', sceneIndex: 0 },
    { sceneName: 'Gameplay', sceneUuid: 'u-game', sceneIndex: 1 },
  ],
});

/** Lets the follower's awaited requests settle, as the browser would between events. */
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function setup(
  options: {
    links?: SceneLink[];
    profiles?: string[];
    current?: string;
    answers?: boolean;
    /** What OBS calls its program scene when asked mid-transition. */
    program?: { sceneName: string; sceneUuid: string };
  } = {},
) {
  const map = new Map<string, string>();
  if (options.links) map.set(SCENE_LINKS_KEY, JSON.stringify(options.links));
  const opened: string[] = [];
  const toasts: Notice[] = [];
  const notes: string[] = [];
  const states: SceneState[] = [];
  let current = options.current ?? 'Default';
  const follower = createSceneFollower({
    request: vi.fn(async (type: string) => {
      if (options.answers === false) return none;
      if (type === 'GetCurrentProgramScene') {
        return ok(options.program ?? { sceneName: 'Gameplay', sceneUuid: 'u-game' });
      }
      return LIST;
    }),
    storage: { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v) },
    profiles: () => options.profiles ?? ['Default', 'Apex ranked'],
    currentProfile: () => current,
    openProfile: (name) => {
      opened.push(name);
      current = name;
    },
    setToast: (n) => toasts.push(n),
    note: (m) => notes.push(m),
    onChange: (s) => states.push(s),
  });
  return { follower, opened, toasts, notes, states, stored: () => map.get(SCENE_LINKS_KEY) };
}

const GAME_LINK: SceneLink = { uuid: 'u-game', name: 'Game', profile: 'Apex ranked' };

describe('reading OBS', () => {
  it('starts from storage, with no scenes until OBS answers', () => {
    const { follower } = setup({ links: [GAME_LINK] });
    expect(follower.state()).toEqual({ scenes: null, live: null, links: [GAME_LINK] });
  });

  it('refresh reads the scenes, the live one, and the names OBS uses now', async () => {
    const { follower, states, stored } = setup({ links: [GAME_LINK] });
    await follower.refresh();
    expect(follower.state().scenes?.map((s) => s.name)).toEqual(['Gameplay', 'BRB']);
    expect(follower.state().live).toBe('u-brb');
    expect(follower.state().links[0]!.name).toBe('Gameplay');
    expect(JSON.parse(stored()!)[0].name).toBe('Gameplay');
    expect(states).toHaveLength(1);
  });

  it('leaves everything as it was when OBS does not answer', async () => {
    const { follower, states } = setup({ links: [GAME_LINK], answers: false });
    await follower.refresh();
    expect(follower.state().scenes).toBeNull();
    expect(states).toHaveLength(0);
  });

  it('forgets the scenes and the live one when the connection goes', async () => {
    const { follower } = setup();
    await follower.refresh();
    follower.disconnected();
    expect(follower.state()).toMatchObject({ scenes: null, live: null });
  });
});

describe('following a scene change', () => {
  const change = { sceneName: 'Gameplay', sceneUuid: 'u-game' };

  it('opens the linked profile, says so, and writes it down', () => {
    const { follower, opened, toasts, notes } = setup({ links: [GAME_LINK] });
    follower.onEvent('CurrentProgramSceneChanged', change);
    expect(opened).toEqual(['Apex ranked']);
    expect(toasts[0]!.message).toBe('OBS scene “Gameplay” opened “Apex ranked”');
    expect(notes).toEqual(['Scene Gameplay → opened Apex ranked']);
    expect(follower.state().live).toBe('u-game');
  });

  it('does nothing for an unlinked scene, beyond marking it live', () => {
    const { follower, opened, toasts } = setup();
    follower.onEvent('CurrentProgramSceneChanged', change);
    expect(opened).toEqual([]);
    expect(toasts).toEqual([]);
    expect(follower.state().live).toBe('u-game');
  });

  it('stays quiet when the linked profile is already open', () => {
    const { follower, opened, toasts, notes } = setup({
      links: [GAME_LINK],
      current: 'Apex ranked',
    });
    follower.onEvent('CurrentProgramSceneChanged', change);
    expect(opened).toEqual([]);
    expect(toasts).toEqual([]);
    expect(notes).toEqual([]);
  });

  it('ignores a link to a profile that no longer exists', () => {
    const { follower, opened } = setup({ links: [GAME_LINK], profiles: ['Default'] });
    follower.onEvent('CurrentProgramSceneChanged', change);
    expect(opened).toEqual([]);
  });

  it('ignores every other event', () => {
    const { follower, states } = setup();
    follower.onEvent('SceneTransitionEnded', { transitionName: 'Fade' });
    expect(states).toEqual([]);
  });
});

describe('following a transition from its first frame', () => {
  const started = { transitionName: 'Fade', transitionUuid: 't-1' };

  it('asks OBS where it is going and opens the profile before the fade ends', async () => {
    const { follower, opened, toasts, notes } = setup({ links: [GAME_LINK] });
    follower.onEvent('SceneTransitionStarted', started);
    await flush();
    expect(opened).toEqual(['Apex ranked']);
    expect(toasts[0]!.message).toBe('OBS scene “Gameplay” opened “Apex ranked”');
    expect(notes).toEqual(['Scene Gameplay → opened Apex ranked']);
    expect(follower.state().live).toBe('u-game');
  });

  it('stays quiet when the end-of-transition event confirms what it already did', async () => {
    const { follower, opened, toasts } = setup({ links: [GAME_LINK] });
    follower.onEvent('SceneTransitionStarted', started);
    await flush();
    follower.onEvent('CurrentProgramSceneChanged', { sceneName: 'Gameplay', sceneUuid: 'u-game' });
    expect(opened).toEqual(['Apex ranked']);
    expect(toasts).toHaveLength(1);
  });

  it('does nothing when OBS cannot say where the transition goes', async () => {
    const { follower, opened, states } = setup({ links: [GAME_LINK], answers: false });
    follower.onEvent('SceneTransitionStarted', started);
    await flush();
    expect(opened).toEqual([]);
    expect(states).toEqual([]);
  });
});

describe('editing the table', () => {
  it('links a scene by the name OBS gave it, persists, and can unlink', async () => {
    const { follower, stored } = setup();
    await follower.refresh();
    follower.link('u-game', 'Apex ranked');
    expect(JSON.parse(stored()!)).toEqual([
      { uuid: 'u-game', name: 'Gameplay', profile: 'Apex ranked' },
    ]);
    follower.link('u-game', null);
    expect(JSON.parse(stored()!)).toEqual([]);
  });

  it('refuses to link a scene it has not heard of', () => {
    const { follower, states } = setup();
    follower.link('u-nowhere', 'Apex ranked');
    expect(states).toEqual([]);
  });

  it('drops a missing link on unlink', () => {
    const { follower, stored } = setup({ links: [GAME_LINK] });
    follower.unlink('u-game');
    expect(JSON.parse(stored()!)).toEqual([]);
  });

  it('follows a profile renamed or removed', () => {
    const { follower, stored } = setup({ links: [GAME_LINK] });
    follower.profileRenamed('Apex ranked', 'Apex');
    expect(JSON.parse(stored()!)[0].profile).toBe('Apex');
    follower.profileRemoved('Apex');
    expect(JSON.parse(stored()!)).toEqual([]);
  });
});
