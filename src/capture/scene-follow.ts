import type { Notice } from './notice';
import {
  linkedProfile,
  loadSceneLinks,
  parseSceneChanged,
  parseSceneList,
  saveSceneLinks,
  sceneSwitchLog,
  sceneSwitchToast,
  withLink,
  withNamesFrom,
  withoutLink,
  withoutProfile,
  withProfileRenamed,
  type ObsScene,
  type SceneLink,
} from './scenes';
import type { ObsRequest } from './sources';

export interface SceneState {
  /** null until OBS has answered once on this connection. */
  scenes: ObsScene[] | null;
  /** The program scene's uuid, or null when nobody has said. */
  live: string | null;
  links: SceneLink[];
}

export interface SceneFollowerDeps {
  request: ObsRequest;
  storage: Pick<Storage, 'getItem' | 'setItem'>;
  profiles(): string[];
  currentProfile(): string;
  /** `profileActions.openProfile`: the same door a tab click goes through. */
  openProfile(name: string): void;
  setToast(notice: Notice): void;
  note(message: string): void;
  /** Called after every change, with a fresh object: App assigns it to a rune. */
  onChange(state: SceneState): void;
}

export interface SceneFollower {
  /** `GetSceneList`: on identify, and every time the popover opens. */
  refresh(): Promise<void>;
  onEvent(eventType: string, eventData: Record<string, unknown>): void;
  disconnected(): void;
  link(uuid: string, profile: string | null): void;
  unlink(uuid: string): void;
  profileRenamed(from: string, to: string): void;
  profileRemoved(name: string): void;
  state(): SceneState;
}

/**
 * Makes the overlay follow OBS's scenes (spec §2.1).
 *
 * Plain values in, plain calls out, like `profile-actions.ts`: every rune it
 * would touch arrives as a getter or a setter, so the reactivity stays in the
 * component and this module can be tested in Node against a fake OBS.
 *
 * One change of profile goes through `openProfile` and nothing else: it is
 * the same path a click in the profile bar takes, so the overlay, the
 * selection and the undo pile are handled exactly once, there.
 */
export function createSceneFollower(deps: SceneFollowerDeps): SceneFollower {
  let scenes: ObsScene[] | null = null;
  let live: string | null = null;
  let links = loadSceneLinks(deps.storage);

  function snapshot(): SceneState {
    return { scenes: scenes ? [...scenes] : null, live, links: [...links] };
  }
  function changed() {
    deps.onChange(snapshot());
  }
  function setLinks(next: SceneLink[]) {
    links = next;
    saveSceneLinks(deps.storage, links);
    changed();
  }

  /** The scene is on air (or about to be): mark it, open its profile if any. */
  function follow(scene: ObsScene) {
    live = scene.uuid;
    changed();

    const profile = linkedProfile(links, scene.uuid);
    // Already open: nothing to do, and nothing to announce. A toast on every
    // scene change would teach people to stop reading toasts — and this is
    // also what makes the two signals below safe to hear one after the other.
    if (profile === null || profile === deps.currentProfile()) return;
    // A link to a profile that is gone stays in the table — the row still
    // shows what was meant — but it opens nothing.
    if (!deps.profiles().includes(profile)) return;
    deps.openProfile(profile);
    deps.setToast(sceneSwitchToast(scene.name, profile));
    deps.note(sceneSwitchLog(scene.name, profile));
  }

  /**
   * SceneTransitionStarted names the transition, not where it goes — but OBS
   * already reports the destination as its program scene from the first
   * frame (measured 2026-09-15: the answer came 1 ms after the event, the
   * end-of-transition event 1.5 s later on a Fade). One request buys the
   * whole fade back; the overlay switches with the picture, not after it.
   */
  async function followTransition() {
    const answer = await deps.request('GetCurrentProgramScene');
    if (!answer.ok) return;
    const scene = parseSceneChanged(answer.data);
    if (scene) follow(scene);
  }

  return {
    async refresh() {
      const answer = await deps.request('GetSceneList');
      // No answer: keep what we had rather than blank the table on a hiccup.
      if (!answer.ok) return;
      const parsed = parseSceneList(answer.data);
      scenes = parsed.scenes;
      live = parsed.current;
      // Names refreshed in storage too: what the row says next launch, before
      // OBS is up, is whatever OBS said last.
      links = withNamesFrom(links, scenes);
      saveSceneLinks(deps.storage, links);
      changed();
    },

    onEvent(eventType, eventData) {
      if (eventType === 'SceneTransitionStarted') {
        void followTransition();
        return;
      }
      // The late signal: OBS raises it once the transition has finished, a
      // whole fade after the one above. Kept as the net for whatever changes
      // scene without a transition signal; when the early path already
      // opened the profile this only confirms the live row.
      if (eventType !== 'CurrentProgramSceneChanged') return;
      const scene = parseSceneChanged(eventData);
      if (scene) follow(scene);
    },

    disconnected() {
      scenes = null;
      live = null;
      changed();
    },

    link(uuid, profile) {
      // Only a scene OBS listed can be linked: the name stored beside the
      // uuid is the one OBS gave, never one typed here.
      const scene = scenes?.find((entry) => entry.uuid === uuid);
      if (!scene) return;
      setLinks(withLink(links, scene, profile));
    },

    unlink(uuid) {
      setLinks(withoutLink(links, uuid));
    },

    profileRenamed(from, to) {
      setLinks(withProfileRenamed(links, from, to));
    },

    profileRemoved(name) {
      setLinks(withoutProfile(links, name));
    },

    state: snapshot,
  };
}
