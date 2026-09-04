// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { createProfileActions } from './profile-actions';
import { defaultConfig, type OverlayConfig } from '../config/schema';
import { exportProfile } from '../config/storage';
import { profileFileName } from './profile-file';
import { loadToast, type Health, type Notice } from './notice';

/**
 * A stub `File`, typed by `Pick<>` rather than `as never`: `importProfile`
 * only ever calls `text()` on what it is handed, and reads `name` for the
 * fallback that applies when the file carries none of its own.
 */
function stubFile(name: string, text: string): Pick<File, 'text' | 'name'> {
  return { name, text: () => Promise.resolve(text) };
}

function setup(
  options: {
    profile?: string;
    config?: OverlayConfig;
    names?: string[];
    load?: (name: string) => { config: OverlayConfig; problem: Health['problem']; dropped: number };
    renames?: boolean;
    replaces?: boolean;
  } = {},
) {
  const calls: string[] = [];
  const toasts: (Notice | null)[] = [];
  const downloads: { fileName: string; content: string }[] = [];
  let profile = options.profile ?? 'Apex';
  let config = options.config ?? defaultConfig();

  const names = options.names ?? ['Apex', 'Valorant'];
  const load = options.load ?? (() => ({ config: defaultConfig(), problem: null, dropped: 0 }));

  const store = {
    list: vi.fn((): string[] => {
      calls.push('store.list');
      return names;
    }),
    active: vi.fn((): string => {
      calls.push('store.active');
      return names[0]!;
    }),
    select: vi.fn((name: string): void => {
      calls.push(`store.select(${name})`);
    }),
    load: vi.fn((name: string) => {
      calls.push(`store.load(${name})`);
      return load(name);
    }),
    save: vi.fn((name: string, _config: OverlayConfig): void => {
      calls.push(`store.save(${name})`);
    }),
    create: vi.fn((name: string): string => {
      calls.push(`store.create(${name})`);
      return name;
    }),
    duplicate: vi.fn((from: string): string => {
      calls.push(`store.duplicate(${from})`);
      return `${from} copy`;
    }),
    rename: vi.fn((from: string, to: string): boolean => {
      calls.push(`store.rename(${from},${to})`);
      return options.renames ?? true;
    }),
    remove: vi.fn((name: string): void => {
      calls.push(`store.remove(${name})`);
    }),
    importFrom: vi.fn((name: string, _config: OverlayConfig): string => {
      calls.push(`store.importFrom(${name})`);
      return name || 'Profile';
    }),
    replaceFrom: vi.fn((target: string, suffixed: string, _config: OverlayConfig): boolean => {
      calls.push(`store.replaceFrom(${target},${suffixed})`);
      return options.replaces ?? true;
    }),
  };

  const broadcaster = {
    publish: vi.fn((_config: OverlayConfig): void => {
      calls.push('broadcaster.publish');
    }),
  };

  const actions = createProfileActions({
    store,
    broadcaster,
    current: () => ({ profile, config }),
    setProfile: (name) => {
      calls.push(`setProfile(${name})`);
      profile = name;
    },
    setConfig: (next) => {
      calls.push('setConfig');
      config = next;
    },
    setProfileNames: (list) => calls.push(`setProfileNames(${list.join(',')})`),
    setHealth: (health) =>
      calls.push(`setHealth(${health.problem},${health.dropped},${health.from})`),
    setToast: (notice) => {
      calls.push(`setToast(${notice?.tone ?? 'null'})`);
      toasts.push(notice);
    },
    resetSelection: () => calls.push('resetSelection'),
    clearHistory: () => calls.push('clearHistory'),
    download: (fileName, content) => {
      calls.push(`download(${fileName})`);
      downloads.push({ fileName, content });
    },
  });

  /** The exact door sequence a plain `openProfile(name)` walks. */
  function openDoors(name: string): string[] {
    return [
      `store.select(${name})`,
      `setProfile(${name})`,
      'store.list',
      `setProfileNames(${names.join(',')})`,
      `store.load(${name})`,
      'setHealth(null,0,load)',
      'setConfig',
      'resetSelection',
      'clearHistory',
      'broadcaster.publish',
    ];
  }

  return { actions, calls, toasts, downloads, store, broadcaster, openDoors };
}

describe('createProfileActions', () => {
  describe('openProfile', () => {
    it('walks the whole door — select, name, load, health, config, reset, history, broadcast', () => {
      const { actions, calls, openDoors } = setup();

      const result = actions.openProfile('Valorant');

      expect(calls).toEqual(openDoors('Valorant'));
      expect(result).toBeNull();
    });

    it('returns the load toast when the stored profile would not load', () => {
      const { actions } = setup({
        load: () => ({ config: defaultConfig(), problem: 'unreadable', dropped: 2 }),
      });

      const result = actions.openProfile('Valorant');

      expect(result).toEqual(loadToast('unreadable'));
    });
  });

  describe('createProfile', () => {
    it('creates, opens what it actually created, then announces it', () => {
      const { actions, calls, toasts, openDoors } = setup();

      actions.createProfile('Valorant');

      expect(calls).toEqual([
        'store.create(Valorant)',
        ...openDoors('Valorant'),
        'setToast(success)',
      ]);
      expect(toasts.at(-1)).toEqual({ tone: 'success', message: 'Profile “Valorant” created' });
    });

    it('announces the name the store actually took, not the one asked for', () => {
      // `create` may hand back "Apex 2" for a name already taken — the toast
      // must say what actually happened, not what was requested.
      const { actions, store, toasts } = setup();
      store.create.mockImplementation((name: string) => `${name} 2`);

      actions.createProfile('Apex');

      expect(toasts.at(-1)?.message).toBe('Profile “Apex 2” created');
    });
  });

  describe('duplicateProfile', () => {
    it('saves the open profile, duplicates it, opens the copy, announces it', () => {
      const { actions, calls, toasts, openDoors } = setup();

      actions.duplicateProfile();

      expect(calls).toEqual([
        'store.save(Apex)',
        'store.duplicate(Apex)',
        ...openDoors('Apex copy'),
        'setToast(success)',
      ]);
      expect(toasts.at(-1)).toEqual({ tone: 'success', message: 'Duplicated to “Apex copy”' });
    });
  });

  describe('renameProfile', () => {
    it('renames, refreshes the name and the list, and announces it — nothing is loaded', () => {
      const { actions, calls, toasts, store } = setup();

      actions.renameProfile('Valorant');

      expect(calls).toEqual([
        'store.rename(Apex,Valorant)',
        'setProfile(Valorant)',
        'store.list',
        'setProfileNames(Apex,Valorant)',
        'setToast(success)',
      ]);
      expect(toasts.at(-1)).toEqual({ tone: 'success', message: 'Renamed to “Valorant”' });
      // Nothing is loaded or broadcast: only the filing changed.
      expect(store.load).not.toHaveBeenCalled();
      expect(store.select).not.toHaveBeenCalled();
    });

    it('refuses a name already taken, and touches nothing else', () => {
      const { actions, calls, toasts } = setup({ renames: false });

      actions.renameProfile('Valorant');

      expect(calls).toEqual(['store.rename(Apex,Valorant)', 'setToast(error)']);
      expect(toasts.at(-1)).toEqual({
        tone: 'error',
        message: 'A profile named “Valorant” already exists',
      });
    });
  });

  describe('removeProfile', () => {
    it('removes the open profile, opens whatever is active now, and offers Undo', () => {
      const { actions, calls, toasts, store, openDoors } = setup({ names: ['Valorant'] });

      actions.removeProfile();

      expect(calls).toEqual([
        'store.remove(Apex)',
        'store.active',
        ...openDoors('Valorant'),
        'setToast(success)',
      ]);
      expect(toasts.at(-1)?.message).toBe('Profile “Apex” deleted');
      expect(store.importFrom).not.toHaveBeenCalled();
    });

    it('Undo resurrects the deleted profile through importFrom, then opens it', () => {
      const deletedConfig = defaultConfig();
      deletedConfig.keys.push({
        id: 1,
        usage: 0x50,
        mode: 'key',
        label: 'Q',
        x: 0,
        y: 0,
        w: 1,
        h: 1,
      });
      const { actions, calls, toasts, store, openDoors } = setup({
        profile: 'Apex',
        config: deletedConfig,
        names: ['Valorant'],
      });

      actions.removeProfile();
      calls.length = 0;

      const undo = toasts.at(-1)?.action;
      expect(undo?.label).toBe('Undo');
      undo!.run();

      expect(calls).toEqual(['store.importFrom(Apex)', ...openDoors('Apex')]);
      // The snapshot taken *before* `openProfile` moved `config` on — not
      // whatever profile happens to be open by the time Undo is clicked.
      expect(store.importFrom).toHaveBeenCalledWith('Apex', deletedConfig);
    });
  });

  describe('downloadProfile', () => {
    it('downloads the exported profile under the profile file name', () => {
      const config = defaultConfig();
      const { actions, downloads } = setup({ profile: 'Apex', config });

      actions.downloadProfile();

      expect(downloads).toEqual([
        { fileName: profileFileName('Apex'), content: exportProfile('Apex', config) },
      ]);
    });
  });

  describe('importProfile', () => {
    it('reports a read failure without touching the store', async () => {
      const { actions, calls, toasts, store } = setup();
      const file = stubFile('broken.json', '');
      vi.spyOn(file, 'text').mockRejectedValue(new Error('gone'));

      await actions.importProfile(file as File);

      expect(calls).toEqual(['setToast(error)']);
      expect(toasts.at(-1)?.message).toMatch(/could not be read/);
      expect(store.importFrom).not.toHaveBeenCalled();
    });

    it('reports an unreadable file without touching the store', async () => {
      const { actions, calls, store } = setup();
      const file = stubFile('broken.json', 'not json');

      await actions.importProfile(file as File);

      expect(calls).toEqual(['setToast(error)']);
      expect(store.importFrom).not.toHaveBeenCalled();
    });

    it('lands a clean import beside the others and opens it', async () => {
      const { actions, calls, toasts, openDoors } = setup({ names: ['Apex'] });
      const text = exportProfile('Valorant', defaultConfig());
      const file = stubFile('valorant.json', text);

      await actions.importProfile(file as File);

      expect(calls).toEqual([
        'store.list',
        'store.importFrom(Valorant)',
        ...openDoors('Valorant'),
        'setHealth(null,0,import)',
        'setToast(success)',
      ]);
      expect(toasts.at(-1)?.message).toBe('Profile imported as "Valorant"');
    });

    it('offers to replace on a name collision, and Replace writes through replaceFrom then reopens the target', async () => {
      const { actions, calls, toasts, store, openDoors } = setup({ names: ['Apex', 'Apex 2'] });
      // The real store's `freeName` would land a colliding import on
      // "Apex 2"; the double is told to answer the same way.
      store.importFrom.mockImplementation((name: string) => `${name} 2`);
      const text = exportProfile('Apex', defaultConfig());
      const file = stubFile('apex.json', text);

      await actions.importProfile(file as File);

      const toast = toasts.at(-1);
      expect(toast?.action?.label).toBe('Replace “Apex”');

      calls.length = 0;
      toast!.action!.run();

      expect(calls).toEqual([
        'store.replaceFrom(Apex,Apex 2)',
        ...openDoors('Apex'),
        'setHealth(null,0,import)',
      ]);
    });

    it('Replace does nothing when the collided profile is already gone', async () => {
      const { actions, calls, toasts, store } = setup({
        names: ['Apex', 'Apex 2'],
        replaces: false,
      });
      store.importFrom.mockImplementation((name: string) => `${name} 2`);
      const text = exportProfile('Apex', defaultConfig());
      const file = stubFile('apex.json', text);

      await actions.importProfile(file as File);

      const toast = toasts.at(-1);
      calls.length = 0;
      toast!.action!.run();

      // Nothing to reconcile the import into: no reopening, no health update.
      expect(calls).toEqual(['store.replaceFrom(Apex,Apex 2)']);
    });
  });
});
