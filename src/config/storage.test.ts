// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  loadConfig,
  saveConfig,
  exportConfig,
  exportProfile,
  importConfig,
  readProfileName,
  createProfileStore,
} from './storage';
import { defaultConfig, CONFIG_VERSION, type KeyConfig } from './schema';

function memoryStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
  };
}

const aKey: KeyConfig = {
  id: 174,
  usage: 0x50,
  mode: 'key',
  label: 'Q',
  x: 0,
  y: 0,
  w: 1,
  h: 1,
};

describe('configuration persistence', () => {
  it('returns the default configuration when nothing is saved', () => {
    expect(loadConfig(memoryStorage())).toEqual({
      config: defaultConfig(),
      problem: null,
      dropped: 0,
    });
  });

  it('reads back what was saved', () => {
    const storage = memoryStorage();
    const config = defaultConfig();
    config.keys.push(aKey);
    saveConfig(storage, config);

    expect(loadConfig(storage).config.keys).toHaveLength(1);
  });

  it('reports an unreadable configuration without losing the use of the application', () => {
    const result = loadConfig(memoryStorage({ 'halcyon:config': '{{{' }));

    expect(result.problem).toBe('unreadable');
    expect(result.config).toEqual(defaultConfig());
  });

  it('reports a configuration written by a newer version', () => {
    const raw = JSON.stringify({ version: CONFIG_VERSION + 1, layout: 'iso', style: {}, keys: [] });

    expect(loadConfig(memoryStorage({ 'halcyon:config': raw })).problem).toBe('too-new');
  });

  it('says how many keys the stored configuration lost on the way in', () => {
    const raw = JSON.stringify({ version: 1, layout: 'iso', style: {}, keys: [aKey, { id: 9 }] });

    const result = loadConfig(memoryStorage({ 'halcyon:config': raw }));

    expect(result.config.keys).toHaveLength(1);
    expect(result.dropped).toBe(1);
  });

  it('does not throw when the browser refuses to write', () => {
    const hostile = {
      setItem: () => {
        throw new DOMException('QuotaExceededError');
      },
    };

    expect(() => saveConfig(hostile, defaultConfig())).not.toThrow();
  });
});

describe('import and export', () => {
  it('exports a readable, re-importable JSON', () => {
    const config = defaultConfig();
    config.keys.push({ id: 9, usage: 0x1a, mode: 'axis', label: 'Z', x: 1, y: 0, w: 1, h: 1 });

    const result = importConfig(exportConfig(config));

    expect(result).toEqual({ ok: true, config, dropped: 0 });
  });

  it('exports something a human can read and edit', () => {
    expect(exportConfig(defaultConfig())).toContain('\n  "version"');
  });

  it('rejects an invalid JSON without throwing', () => {
    expect(importConfig('not json')).toEqual({ ok: false, reason: 'unreadable' });
  });

  it('runs the import through the migrations', () => {
    const legacy = JSON.stringify({ style: {}, keys: [] });

    const result = importConfig(legacy);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.config.version).toBe(CONFIG_VERSION);
  });

  it('carries the dropped count out of an import', () => {
    // Silently returning an amputated keyboard is the failure spec §11 rules
    // out: the interface has to be able to say how many keys went missing.
    const raw = JSON.stringify({ version: 1, layout: 'iso', style: {}, keys: [aKey, aKey] });

    const result = importConfig(raw);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.dropped).toBe(1);
  });
});

describe('what loading leaves behind in storage', () => {
  const aStore = (raw: string) => {
    const map = new Map([['halcyon:config', raw]]);
    return {
      getItem: (key: string) => map.get(key) ?? null,
      setItem: (key: string, value: string) => void map.set(key, value),
      map,
    };
  };

  it('writes the cleaned configuration back, so the warning does not return forever', () => {
    // Cleaning only in memory means the notice reappears on every reload, about
    // something the user has no way to fix.
    const storage = aStore(
      JSON.stringify({ version: 1, layout: 'iso', style: {}, keys: [aKey, aKey] }),
    );

    expect(loadConfig(storage).dropped).toBe(1);
    expect(loadConfig(storage).dropped).toBe(0);
  });

  it('leaves storage untouched when there was nothing to clean', () => {
    const raw = exportConfig(defaultConfig());
    const storage = aStore(raw);

    loadConfig(storage);

    expect(storage.map.get('halcyon:config')).toBe(raw);
  });

  it('backs up the raw file before the cleaned version overwrites it', () => {
    // The `unreadable` path already does this (below): a file we could not
    // parse at all is kept aside before the defaults take its place. A file
    // that parsed but lost keys on the way in got no such courtesy, and the
    // dropped keys are exactly the ones worth being able to look at again —
    // they may be the symptom of a serialisation bug, not a hand-edited file.
    const raw = JSON.stringify({ version: 1, layout: 'iso', style: {}, keys: [aKey, aKey] });
    const storage = aStore(raw);

    loadConfig(storage);

    expect(storage.map.get('halcyon:backup:halcyon:config')).toBe(raw);
  });

  it('puts a configuration from a newer version aside before anything overwrites it', () => {
    // Falling back to the defaults is right; letting the next save bury a
    // profile we just refused to guess at is not. A rolled-back deployment
    // would cost an evening of layout work.
    const raw = JSON.stringify({ version: CONFIG_VERSION + 1, layout: 'iso', style: {}, keys: [] });
    const storage = aStore(raw);

    const result = loadConfig(storage);

    expect(result.problem).toBe('too-new');
    expect(storage.map.get('halcyon:backup:halcyon:config')).toBe(raw);
  });

  it('keeps an unreadable configuration aside too, in case it can be salvaged', () => {
    const storage = aStore('{{{');

    loadConfig(storage);

    expect(storage.map.get('halcyon:backup:halcyon:config')).toBe('{{{');
  });

  it('survives a storage that refuses to be written to while loading', () => {
    const storage = {
      getItem: () => '{{{',
      setItem: () => {
        throw new DOMException('QuotaExceededError');
      },
    };

    expect(() => loadConfig(storage)).not.toThrow();
  });
});

/** The full surface a profile store needs: it deletes keys, the config store never does. */
function profileStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
    map,
  };
}

function withKeys(...keys: KeyConfig[]) {
  const config = defaultConfig();
  config.keys.push(...keys);
  return config;
}

const anotherKey: KeyConfig = { ...aKey, id: 175, usage: 0x1a, label: 'Z' };

describe('named profiles', () => {
  it('starts with a default profile active', () => {
    const store = createProfileStore(profileStorage());

    expect(store.list()).toEqual(['Default']);
    expect(store.active()).toBe('Default');
  });

  it('creates a profile and makes it active', () => {
    const store = createProfileStore(profileStorage());

    expect(store.create('Valorant')).toBe('Valorant');
    expect(store.list()).toEqual(['Default', 'Valorant']);
    expect(store.active()).toBe('Valorant');
  });

  it('keeps configurations separate between profiles', () => {
    const store = createProfileStore(profileStorage());
    store.save('Default', withKeys(aKey));
    store.create('Valorant');

    expect(store.load('Valorant').config.keys).toEqual([]);
    expect(store.load('Default').config.keys).toHaveLength(1);
  });

  it('renames without losing the configuration', () => {
    const store = createProfileStore(profileStorage());
    store.save('Default', withKeys(aKey));

    store.rename('Default', 'Main');

    expect(store.list()).toEqual(['Main']);
    expect(store.active()).toBe('Main');
    expect(store.load('Main').config.keys).toHaveLength(1);
  });

  it('refuses to remove the last profile', () => {
    const store = createProfileStore(profileStorage());
    store.save('Default', withKeys(aKey));

    store.remove('Default');

    expect(store.list()).toEqual(['Default']);
    expect(store.load('Default').config.keys).toHaveLength(1);
  });

  it('switches the active profile to a survivor after removal', () => {
    const store = createProfileStore(profileStorage());
    store.create('Valorant');
    store.remove('Valorant');

    expect(store.active()).toBe('Default');
  });

  it('remembers the profile that was selected, across a reload', () => {
    // Switching profiles without writing the choice down means the next launch
    // silently reopens the previous one — with the overlay following it.
    const storage = profileStorage();
    createProfileStore(storage).create('Valorant');
    createProfileStore(storage).select('Default');

    expect(createProfileStore(storage).active()).toBe('Default');
  });

  it('falls back to the first profile when the active one is gone', () => {
    const store = createProfileStore(
      profileStorage({
        'halcyon:profiles': JSON.stringify(['Default']),
        'halcyon:active-profile': 'Deleted by hand',
      }),
    );

    expect(store.active()).toBe('Default');
  });
});

describe('profiles that must not eat one another', () => {
  it('creates a free name rather than overwriting a profile that exists', () => {
    // The mockup offers "New profile…" as a plain text field: two people, two
    // months apart, will type the same name. Reusing it would silently replace
    // a layout with an empty one — the worst outcome of the whole feature.
    const store = createProfileStore(profileStorage());
    store.save('Default', withKeys(aKey));

    const created = store.create('Default');

    expect(created).toBe('Default 2');
    expect(store.load('Default').config.keys).toHaveLength(1);
  });

  it('names an empty profile rather than creating a nameless one', () => {
    const store = createProfileStore(profileStorage());

    expect(store.create('   ')).toBe('Profile');
  });

  it('duplicates a profile with its keys, under a name of its own', () => {
    const store = createProfileStore(profileStorage());
    store.save('Default', withKeys(aKey, anotherKey));

    const copy = store.duplicate('Default');

    expect(copy).toBe('Default copy');
    expect(store.active()).toBe('Default copy');
    expect(store.load(copy).config.keys).toHaveLength(2);
    expect(store.load('Default').config.keys).toHaveLength(2);
  });

  it('refuses a rename onto a name already taken, and says so', () => {
    // Uniquifying would be wrong here, unlike on create: someone typing an
    // existing name over a profile means one of the two, and silently landing
    // on "Default 2" answers neither.
    const store = createProfileStore(profileStorage());
    store.create('Valorant');
    store.save('Valorant', withKeys(aKey));

    expect(store.rename('Valorant', 'Default')).toBe(false);
    expect(store.list()).toEqual(['Default', 'Valorant']);
    expect(store.load('Valorant').config.keys).toHaveLength(1);
  });

  it('reports a rename that went through', () => {
    const store = createProfileStore(profileStorage());

    expect(store.rename('Default', 'Main')).toBe(true);
  });

  it('refuses a rename to nothing at all', () => {
    const store = createProfileStore(profileStorage());

    expect(store.rename('Default', '   ')).toBe(false);
    expect(store.list()).toEqual(['Default']);
  });

  it('takes a rename to the same name as done, not as a collision', () => {
    // Submitting an unchanged field is not an error, and reporting one would
    // put an "already exists" in front of someone who changed nothing.
    const store = createProfileStore(profileStorage());

    expect(store.rename('Default', 'Default')).toBe(true);
    expect(store.list()).toEqual(['Default']);
  });
});

describe('profiles adopt what came before them', () => {
  const legacy = () =>
    profileStorage({ 'halcyon:config': exportConfig(withKeys(aKey, anotherKey)) });

  it('adopts a pre-profile configuration as the default profile', () => {
    // Everyone upgrading from v0.5 has their whole layout under the old key.
    // Starting them on an empty Default would read as "the update deleted my
    // keyboard", and the backup that saves the other failures is not written
    // here: nothing failed.
    const store = createProfileStore(legacy());

    expect(store.list()).toEqual(['Default']);
    expect(store.load('Default').config.keys).toHaveLength(2);
  });

  it('leaves the old key where it was, so a rollback still finds it', () => {
    const storage = legacy();
    const before = storage.map.get('halcyon:config');

    createProfileStore(storage);

    expect(storage.map.get('halcyon:config')).toBe(before);
  });

  it('never adopts twice, so an old key cannot come back over a real profile', () => {
    const storage = legacy();
    createProfileStore(storage).save('Default', defaultConfig());

    expect(createProfileStore(storage).load('Default').config.keys).toEqual([]);
  });
});

describe('what a profile says about itself', () => {
  it('counts the keys of a profile that is not the active one', () => {
    const store = createProfileStore(profileStorage());
    store.save('Default', withKeys(aKey, anotherKey));
    store.create('Valorant');

    expect(store.keyCount('Default')).toBe(2);
    expect(store.keyCount('Valorant')).toBe(0);
  });

  it('reports an unreadable profile instead of pretending it was empty', () => {
    // Spec §16.6: the profile menu line has to be able to say that we started
    // from the defaults. Swallowing the failure into an empty configuration is
    // indistinguishable from a profile someone really did empty.
    const store = createProfileStore(
      profileStorage({
        'halcyon:profiles': JSON.stringify(['Default']),
        'halcyon:profile:Default': '{{{',
      }),
    );

    const loaded = store.load('Default');

    expect(loaded.problem).toBe('unreadable');
    expect(loaded.config).toEqual(defaultConfig());
  });

  it('keeps an unreadable profile aside, as the single configuration did', () => {
    const storage = profileStorage({
      'halcyon:profiles': JSON.stringify(['Default']),
      'halcyon:profile:Default': '{{{',
    });

    createProfileStore(storage).load('Default');

    expect(storage.map.get('halcyon:backup:halcyon:profile:Default')).toBe('{{{');
  });
});

describe('a storage that refuses to write must not destroy anything', () => {
  /** Reads work, writes fail. A full quota, or a browser that took storage away. */
  function readOnly(initial: Record<string, string>) {
    const map = new Map(Object.entries(initial));
    return {
      getItem: (key: string) => map.get(key) ?? null,
      setItem: () => {
        throw new DOMException('QuotaExceededError');
      },
      removeItem: (key: string) => void map.delete(key),
      map,
    };
  }

  const withOneProfile = () => ({
    'halcyon:profiles': JSON.stringify(['Default']),
    'halcyon:profile:Default': exportConfig(withKeys(aKey, anotherKey)),
  });

  it('keeps the profile when a rename cannot be written', () => {
    // The worst failure this module can have. `write` swallows quota errors on
    // purpose, but the `removeItem` that followed was not guarded: the copy
    // never landed, the list never changed, and the source was deleted anyway.
    // Both names then loaded the defaults, and the caller was told it worked.
    const storage = readOnly(withOneProfile());
    const store = createProfileStore(storage);

    expect(store.rename('Default', 'Main')).toBe(false);
    expect(store.load('Default').config.keys).toHaveLength(2);
  });

  it('keeps the profile when a removal cannot be written', () => {
    // Same shape: the list write is swallowed, the deletion is not. The name
    // survives in the list with nothing behind it.
    const storage = readOnly({
      ...withOneProfile(),
      'halcyon:profiles': JSON.stringify(['Default', 'Apex']),
      'halcyon:profile:Apex': exportConfig(withKeys(aKey)),
    });
    const store = createProfileStore(storage);

    store.remove('Apex');

    expect(store.load('Apex').config.keys).toHaveLength(1);
  });

  it('keeps the suffixed copy when a replacement cannot be written', () => {
    // Write first, drop second, same as rename above: removing "Default 2"
    // on the strength of a write that never landed would leave the imported
    // keys nowhere at all — the one outcome worse than the pile-up this
    // feature exists to fix.
    const storage = readOnly({
      'halcyon:profiles': JSON.stringify(['Default', 'Default 2']),
      'halcyon:profile:Default': exportConfig(withKeys(aKey)),
      'halcyon:profile:Default 2': exportConfig(withKeys(aKey, anotherKey)),
    });
    const store = createProfileStore(storage);

    expect(store.replaceFrom('Default', 'Default 2', withKeys(anotherKey))).toBe(false);
    expect(store.list()).toEqual(['Default', 'Default 2']);
    expect(store.load('Default').config.keys).toHaveLength(1);
    expect(store.load('Default 2').config.keys).toHaveLength(2);
  });
});

describe('a profile named like a backup', () => {
  it('does not have its configuration overwritten by its neighbour failing', () => {
    // `halcyon:profile:X` + ".backup" is exactly `halcyon:profile:X.backup`.
    // With the backup written into the same namespace, a profile that failed to
    // load buried the profile literally named "X.backup".
    const storage = profileStorage({
      'halcyon:profiles': JSON.stringify(['Default', 'Default.backup']),
      'halcyon:profile:Default': '{{{',
      'halcyon:profile:Default.backup': exportConfig(withKeys(aKey)),
    });
    const store = createProfileStore(storage);

    store.load('Default');

    expect(store.load('Default.backup').config.keys).toHaveLength(1);
  });

  it('is not erased when its neighbour is removed', () => {
    const storage = profileStorage({
      'halcyon:profiles': JSON.stringify(['Default', 'Default.backup']),
      'halcyon:profile:Default.backup': exportConfig(withKeys(aKey)),
    });
    const store = createProfileStore(storage);

    store.remove('Default');

    expect(store.load('Default.backup').config.keys).toHaveLength(1);
  });
});

describe('the name an exported profile carries with it', () => {
  it('writes the profile name beside the configuration', () => {
    const written: unknown = JSON.parse(exportProfile('Valorant', defaultConfig()));

    expect(written).toMatchObject({ name: 'Valorant', version: CONFIG_VERSION });
  });

  it('reads that name back', () => {
    expect(readProfileName(exportProfile('Valorant', defaultConfig()))).toBe('Valorant');
  });

  it('keeps the configuration importable, name and all', () => {
    // The name is an envelope, not a field: `migrate` builds its result from
    // the fields it knows, so it drops the name on its own and nothing has to
    // strip it first.
    const config = defaultConfig();

    const result = importConfig(exportProfile('Valorant', config));

    expect(result).toEqual({ ok: true, config, dropped: 0 });
  });

  it('never lets the name reach what is stored', () => {
    // The profile list already holds every profile's name. A second copy in
    // the stored configuration would go stale on the first rename, and the two
    // would then disagree with nothing to say which is right.
    expect(readProfileName(exportConfig(defaultConfig()))).toBe(null);
  });

  it('answers nothing for a file that carries no name', () => {
    expect(readProfileName(JSON.stringify({ version: 1, keys: [] }))).toBe(null);
  });

  it('answers nothing for a name that is not a name', () => {
    // The file may come from a forum post. A `name` of `42` reaches a store
    // that keys on strings, and an empty one would create a profile with no
    // name at all.
    expect(readProfileName(JSON.stringify({ name: 42 }))).toBe(null);
    expect(readProfileName(JSON.stringify({ name: '   ' }))).toBe(null);
  });

  it('answers nothing for a file that is not JSON at all', () => {
    expect(readProfileName('not json')).toBe(null);
  });
});

describe('an import lands beside the open profile, never on top of it', () => {
  it('creates a profile under the name it was given, and makes it active', () => {
    const store = createProfileStore(profileStorage());
    const config = defaultConfig();
    config.keys.push(aKey);

    const named = store.importFrom('Valorant', config);

    expect(named).toBe('Valorant');
    expect(store.list()).toContain('Valorant');
    expect(store.active()).toBe('Valorant');
    expect(store.load('Valorant').config.keys).toHaveLength(1);
  });

  it('leaves the profile that was open exactly as it was', () => {
    // The whole point of the change: importing used to overwrite the open
    // profile, which is the one way this gesture could lose work.
    const store = createProfileStore(profileStorage());
    const before = defaultConfig();
    before.keys.push(aKey);
    store.save('Default', before);

    store.importFrom('Valorant', defaultConfig());

    expect(store.load('Default').config.keys).toHaveLength(1);
  });

  it('finds a free name rather than burying a profile that exists', () => {
    const store = createProfileStore(profileStorage());
    store.create('Valorant');

    expect(store.importFrom('Valorant', defaultConfig())).toBe('Valorant 2');
  });

  it('names a nameless import rather than creating a profile with no name', () => {
    const store = createProfileStore(profileStorage());

    expect(store.importFrom('', defaultConfig())).toBe('Profile');
  });
});

describe('replacing the profile an import collided with', () => {
  it('writes the imported configuration into the existing profile', () => {
    const store = createProfileStore(profileStorage());
    store.create('Valorant');
    store.save('Valorant', withKeys(aKey));
    const suffixed = store.importFrom('Valorant', withKeys(aKey, anotherKey));

    expect(store.replaceFrom('Valorant', suffixed, withKeys(anotherKey))).toBe(true);
    expect(store.load('Valorant').config.keys).toEqual([anotherKey]);
  });

  it('removes the suffixed copy once the target carries the new configuration', () => {
    // Nothing left pointing at "Valorant 2" once "Valorant" has taken its
    // place — the whole reason this door exists, over the pile-up the spec
    // complains about.
    const store = createProfileStore(profileStorage());
    store.create('Valorant');
    store.save('Valorant', withKeys(aKey));
    const suffixed = store.importFrom('Valorant', withKeys(anotherKey));

    store.replaceFrom('Valorant', suffixed, withKeys(anotherKey));

    expect(store.list()).toEqual(['Default', 'Valorant']);
  });

  it('refuses, and removes nothing, once the target has disappeared', () => {
    // The toast can outlive the profile it names: renamed or removed while it
    // was still on screen. Nothing to reconcile a config into any more, and
    // the suffixed copy is the only surviving copy of the imported keys.
    const store = createProfileStore(profileStorage());
    store.create('Valorant');
    const suffixed = store.importFrom('Valorant', withKeys(aKey));
    store.remove('Valorant');

    expect(store.replaceFrom('Valorant', suffixed, withKeys(aKey))).toBe(false);
    expect(store.list()).toEqual(['Default', suffixed]);
    expect(store.load(suffixed).config.keys).toHaveLength(1);
  });
});
