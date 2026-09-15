import type { ObsStatus } from '../transport/obs';
import type { Notice } from './notice';

/** A scene as OBS names it. The uuid is the identity; the name is for people. */
export interface ObsScene {
  uuid: string;
  name: string;
}

/**
 * One row of the table: this scene opens this profile.
 *
 * Keyed by uuid, not name: renaming a scene in OBS is routine, and a link
 * that broke on it would be found out on air. The name is cached so the row
 * still reads when OBS is not there to say it, and refreshed on every list.
 */
export interface SceneLink {
  uuid: string;
  name: string;
  profile: string;
}

export interface SceneRow {
  uuid: string;
  name: string;
  profile: string | null;
  live: boolean;
  /** Linked here, unknown to OBS: deleted, or a different scene collection. */
  missing: boolean;
}

/**
 * Application data, not profile data: a profile file travels between
 * machines whose OBS have different scenes, and a table of foreign uuids
 * would land as a column of "not in OBS" rows.
 */
export const SCENE_LINKS_KEY = 'halcyon:scene-links';

function isLink(value: unknown): value is SceneLink {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.uuid === 'string' && typeof v.name === 'string' && typeof v.profile === 'string';
}

export function loadSceneLinks(storage: Pick<Storage, 'getItem'>): SceneLink[] {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(SCENE_LINKS_KEY) ?? '');
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isLink).map(({ uuid, name, profile }) => ({ uuid, name, profile }));
  } catch {
    return [];
  }
}

export function saveSceneLinks(
  storage: Pick<Storage, 'setItem'>,
  links: readonly SceneLink[],
): void {
  try {
    storage.setItem(SCENE_LINKS_KEY, JSON.stringify(links));
  } catch {
    // Quota, or a browser that refuses to write. The table keeps working for
    // the session; it simply will not survive a reload.
  }
}

function asScene(value: unknown): ObsScene | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.sceneUuid !== 'string' || typeof v.sceneName !== 'string') return null;
  return { uuid: v.sceneUuid, name: v.sceneName };
}

/**
 * `GetSceneList`, read into OBS's own display order.
 *
 * obs-websocket numbers scenes from the bottom of the list: index 0 is the
 * last one on screen. Sorted descending so the popover reads top to bottom
 * like the panel someone is looking at in OBS.
 */
export function parseSceneList(data: Record<string, unknown>): {
  scenes: ObsScene[];
  current: string | null;
} {
  const raw = Array.isArray(data.scenes) ? data.scenes : [];
  const indexed = raw
    .map((entry) => {
      const scene = asScene(entry);
      const index = (entry as Record<string, unknown> | null)?.sceneIndex;
      return scene ? { scene, index: typeof index === 'number' ? index : 0 } : null;
    })
    .filter((entry): entry is { scene: ObsScene; index: number } => entry !== null)
    .sort((a, b) => b.index - a.index);
  const current =
    typeof data.currentProgramSceneUuid === 'string' ? data.currentProgramSceneUuid : null;
  return { scenes: indexed.map((entry) => entry.scene), current };
}

/** `CurrentProgramSceneChanged`'s payload. */
export function parseSceneChanged(data: Record<string, unknown>): ObsScene | null {
  return asScene(data);
}

export function linkedProfile(links: readonly SceneLink[], uuid: string): string | null {
  return links.find((link) => link.uuid === uuid)?.profile ?? null;
}

/**
 * The table as shown: OBS's scenes in OBS's order, each with its link if any,
 * then the links pointing at scenes OBS did not list. `scenes` is null until
 * OBS has answered once this connection — the links alone are shown then, and
 * none of them is called missing on the strength of an answer not yet given.
 */
export function sceneRows(
  scenes: readonly ObsScene[] | null,
  links: readonly SceneLink[],
  live: string | null,
): SceneRow[] {
  if (scenes === null) {
    return links.map((link) => ({
      uuid: link.uuid,
      name: link.name,
      profile: link.profile,
      live: false,
      missing: false,
    }));
  }
  const known = new Set(scenes.map((scene) => scene.uuid));
  const present = scenes.map((scene) => ({
    uuid: scene.uuid,
    name: scene.name,
    profile: linkedProfile(links, scene.uuid),
    live: scene.uuid === live,
    missing: false,
  }));
  const gone = links
    .filter((link) => !known.has(link.uuid))
    .map((link) => ({
      uuid: link.uuid,
      name: link.name,
      profile: link.profile,
      live: false,
      missing: true,
    }));
  return [...present, ...gone];
}

export function withLink(
  links: readonly SceneLink[],
  scene: ObsScene,
  profile: string | null,
): SceneLink[] {
  const others = links.filter((link) => link.uuid !== scene.uuid);
  return profile === null ? others : [...others, { uuid: scene.uuid, name: scene.name, profile }];
}

export function withoutLink(links: readonly SceneLink[], uuid: string): SceneLink[] {
  return links.filter((link) => link.uuid !== uuid);
}

export function withNamesFrom(
  links: readonly SceneLink[],
  scenes: readonly ObsScene[],
): SceneLink[] {
  const names = new Map(scenes.map((scene) => [scene.uuid, scene.name]));
  return links.map((link) => ({ ...link, name: names.get(link.uuid) ?? link.name }));
}

export function withProfileRenamed(
  links: readonly SceneLink[],
  from: string,
  to: string,
): SceneLink[] {
  return links.map((link) => (link.profile === from ? { ...link, profile: to } : link));
}

export function withoutProfile(links: readonly SceneLink[], profile: string): SceneLink[] {
  return links.filter((link) => link.profile !== profile);
}

/**
 * The header button's three states (handoff §1), the StartupPopover recipe:
 * the accent pitch while nothing is linked, muted text once something is,
 * and inert without OBS — the list has nothing to show without it.
 */
export type LinkButtonState = 'pitch' | 'quiet' | 'inert';

export function linkButtonState(obs: ObsStatus, linkCount: number): LinkButtonState {
  if (obs !== 'identified') return 'inert';
  return linkCount === 0 ? 'pitch' : 'quiet';
}

export function sceneSwitchToast(scene: string, profile: string): Notice {
  return { tone: 'success', message: `OBS scene “${scene}” opened “${profile}”` };
}

export function sceneSwitchLog(scene: string, profile: string): string {
  return `Scene ${scene} → opened ${profile}`;
}
