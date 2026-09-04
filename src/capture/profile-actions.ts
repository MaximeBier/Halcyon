import { exportProfile, importConfig, type ProfileStore } from '../config/storage';
import type { OverlayConfig } from '../config/schema';
import type { ConfigBroadcaster } from './broadcast';
import { importedProfileName, profileFileName } from './profile-file';
import {
  importedToast,
  importFailedToast,
  loadToast,
  profileDeletedToast,
  READ_FAILED,
  type Health,
  type Notice,
} from './notice';

/**
 * The profile CRUD block App.svelte used to carry directly against its own
 * runes — open / create / duplicate / rename / remove / import / download,
 * plus the two closures the Replace and delete-Undo features hung off it.
 * One coherent unit (store + health + toast + history.clear + broadcast),
 * factored out the same way `createCaptureSession` is: every rune it touches
 * arrives as a getter or a setter, so the reactivity stays in the component
 * and this module stays plain values in, plain calls out.
 */
export interface ProfileActionsDeps {
  store: Pick<
    ProfileStore,
    | 'list'
    | 'active'
    | 'select'
    | 'load'
    | 'save'
    | 'create'
    | 'duplicate'
    | 'rename'
    | 'remove'
    | 'importFrom'
    | 'replaceFrom'
  >;
  broadcaster: Pick<ConfigBroadcaster, 'publish'>;
  /**
   * The profile actually open, and the configuration it holds — always read
   * together: every action below that needs one needs the other, whether to
   * save it before moving on (`duplicateProfile`) or to snapshot it before it
   * is gone (`removeProfile`'s Undo).
   */
  current(): { profile: string; config: OverlayConfig };
  setProfile(name: string): void;
  setConfig(config: OverlayConfig): void;
  setProfileNames(names: string[]): void;
  setHealth(health: Health): void;
  setToast(notice: Notice | null): void;
  /**
   * Forgets the selection, the shift-anchor and the last key learned — the
   * three bits of per-profile UI state a switch would otherwise leave
   * stranded on a profile no longer on screen. See `openProfile` for why all
   * three always move together.
   */
  resetSelection(): void;
  /** Clears the undo pile — see `openProfile` for why a switch must. */
  clearHistory(): void;
  /** The DOM mechanics of a file download, kept out of this pure module. */
  download(fileName: string, content: string): void;
}

export interface ProfileActions {
  openProfile(name: string): Notice | null;
  createProfile(name: string): void;
  duplicateProfile(): void;
  renameProfile(name: string): void;
  removeProfile(): void;
  importProfile(file: File): Promise<void>;
  downloadProfile(): void;
}

export function createProfileActions(deps: ProfileActionsDeps): ProfileActions {
  /**
   * Opens a profile, and puts the overlay on it.
   *
   * The broadcast is not optional: OBS is showing the previous profile's keys
   * and nothing about switching would reach it otherwise.
   */
  function openProfile(name: string): Notice | null {
    deps.store.select(name);
    deps.setProfile(name);
    deps.setProfileNames(deps.store.list());

    const next = deps.store.load(name);
    deps.setHealth({ problem: next.problem, dropped: next.dropped, from: 'load' });
    deps.setConfig(next.config);
    // Both name keys of the profile being left. Two profiles can share a
    // matrix index, so a stale selection does not merely look wrong —
    // "Delete 3 selected keys" would act on a set nobody chose in this
    // profile.
    deps.resetSelection();
    // A pile that survived the switch would make Ctrl+Z rewrite a document
    // that is no longer on screen — inside OBS. Renaming keeps it: the name
    // changed, not the content this pile remembers.
    deps.clearHistory();
    deps.broadcaster.publish(next.config);

    return loadToast(next.problem);
  }

  function createProfile(name: string): void {
    // `create` returns the name it really took: asking for one that exists
    // gets "Apex 2" rather than the layout that was already there.
    const created = deps.store.create(name);
    openProfile(created);
    deps.setToast({ tone: 'success', message: `Profile “${created}” created` });
  }

  function duplicateProfile(): void {
    const { profile, config } = deps.current();
    // Saved first: `duplicate` copies what is in storage, and the difference
    // would be exactly whatever has not been written yet.
    deps.store.save(profile, config);
    const copy = deps.store.duplicate(profile);
    openProfile(copy);
    deps.setToast({ tone: 'success', message: `Duplicated to “${copy}”` });
  }

  function renameProfile(name: string): void {
    // Nothing is loaded or broadcast: the configuration did not change, only
    // the name it is filed under. Reopening it here would push an identical
    // profile back at OBS for no reason.
    if (!deps.store.rename(deps.current().profile, name)) {
      deps.setToast({ tone: 'error', message: `A profile named “${name}” already exists` });
      return;
    }

    deps.setProfile(name);
    deps.setProfileNames(deps.store.list());
    deps.setToast({ tone: 'success', message: `Renamed to “${name}”` });
  }

  function removeProfile(): void {
    // Snapshotted before `openProfile` moves the open profile on to whatever
    // opens next: `current()` reflects whatever is open *right now*, so
    // reading it from the Undo closure below — pressed seconds or minutes
    // later — would hand back today's profile instead of the one that just
    // left.
    const { profile: gone, config: deletedConfig } = deps.current();
    deps.store.remove(gone);
    openProfile(deps.store.active());
    deps.setToast(
      profileDeletedToast(gone, () => {
        // `importFrom` is the store's own door for landing a configuration
        // beside the others without overwriting one — the exact collision
        // handling `freeName` gives every import, reused rather than
        // reimplemented: a same-named profile created between the delete and
        // this click gets the resurrection suffixed onto it instead of
        // erased.
        openProfile(deps.store.importFrom(gone, deletedConfig));
      }),
    );
  }

  function downloadProfile(): void {
    const { profile, config } = deps.current();
    // `exportProfile` and not `exportConfig`: the file carries the profile's
    // name, so importing it elsewhere lands under the name it left under
    // rather than under whatever the browser called the download.
    deps.download(profileFileName(profile), exportProfile(profile, config));
  }

  async function importProfile(file: File): Promise<void> {
    let text: string;
    try {
      // `File.text()` rejects when the file moved, changed, or sat on a
      // volume that went away between the picker closing and the read.
      // Unhandled, the rejection belongs to nobody: no message, and nothing
      // to retry against.
      text = await file.text();
    } catch {
      deps.setToast(READ_FAILED);
      return;
    }

    const result = importConfig(text);
    // Nothing is lost on a failure: the open profile is untouched, and the
    // toast is the only thing that changes. The permanent line still
    // describes what is actually loaded.
    if (!result.ok) {
      deps.setToast(importFailedToast(result.reason));
      return;
    }

    // A profile of its own, and never the open one. Until 2026-08-24 this
    // called `updateConfig`, which wrote the imported keys straight into
    // whatever profile happened to be loaded — the single gesture in the
    // application that could destroy a layout with nothing to undo it.
    const requestedName = importedProfileName(text, file.name);
    // Judged against the list as it stood *before* the import, and against
    // the same nameless fallback `freeName` applies to `requestedName` — a
    // nameless import comparing itself against '' would call it a collision
    // only once a profile happened to be named "" too, which never happens,
    // instead of the "Profile" it will actually land beside.
    const before = deps.store.list();
    const collidedWith = requestedName || 'Profile';
    const collided = before.includes(collidedWith);

    const landed = deps.store.importFrom(requestedName, result.config);
    openProfile(landed);
    // After `openProfile`, which sets `health` from a re-read of what we have
    // just written — where the dropped count is zero, because the keys were
    // dropped on the way in and the stored file no longer has them. The
    // count worth showing is the one from the import.
    deps.setHealth({ problem: null, dropped: result.dropped, from: 'import' });

    // No collision: exactly the toast this feature always showed, no action
    // attached (spec's constat — the free-name path never changes).
    deps.setToast(
      collided
        ? importedToast(landed, result.dropped, {
            name: collidedWith,
            run: () => {
              // `replaceFrom` refuses if `collidedWith` stopped existing
              // between the toast appearing and this click (renamed, removed
              // elsewhere) — nothing to reopen or clean up in that case, and
              // the click has already dismissed the toast regardless (see
              // Toast.svelte).
              if (!deps.store.replaceFrom(collidedWith, landed, result.config)) return;
              openProfile(collidedWith);
              // Same override as above, and for the same reason: a fresh
              // read of what `replaceFrom` just wrote reports zero dropped
              // keys.
              deps.setHealth({ problem: null, dropped: result.dropped, from: 'import' });
            },
          })
        : importedToast(landed, result.dropped),
    );
  }

  return {
    openProfile,
    createProfile,
    duplicateProfile,
    renameProfile,
    removeProfile,
    importProfile,
    downloadProfile,
  };
}
