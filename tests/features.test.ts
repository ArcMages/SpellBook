// The feature registry: how the screens plug into the plugin, what each is
// handed, and how they are let go of again.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEVICE_ID_KEY, DEVICE_ID_LENGTH, deviceIdOf, isDeviceId, newDeviceId } from '../src/core/deviceId';
import { WordCountCache } from '../src/core/wordCountCache';
import { corkboardFeature } from '../src/features/corkboard/index';
import { modesFeature } from '../src/features/modes/index';
import { exportFeature } from '../src/features/export/index';
import { outlinerFeature } from '../src/features/outliner/index';
import { plannerFeature } from '../src/features/planner/index';
import { progressFeature } from '../src/features/progress/index';
import { schemesFeature } from '../src/features/schemes/index';
import { reportFeature } from '../src/features/report/index';
import { proseFeature } from '../src/features/prose/index';
import { scriveningsFeature } from '../src/features/scrivenings/index';
import { FEATURES, registerFeatures } from '../src/features/registry';
import type { Feature, FeatureContext, FeatureHost, SettingsSection } from '../src/features/registry';
import { timelineFeature } from '../src/features/timeline/index';
import { FakeObsidian } from './fakeObsidianApp';
import { Plugin as StubPlugin, resetFakeDocument } from './obsidianStub';
import { MemoryDeviceStorage, TODAY, fixedRandom, makeStore } from './storeHarness';

afterEach(() => {
  vi.restoreAllMocks();
  resetFakeDocument();
});

interface Stand {
  host: FeatureHost;
  /** The stand-in app the features are handed. */
  fake: FakeObsidian;
  /** The stand-in plugin: it can hold views, commands, a status bar item and an editor extension. */
  plugin: StubPlugin;
  storage: MemoryDeviceStorage;
  opened: Array<{ path: string; where: unknown }>;
  /** How often the device id was asked for from the host. */
  idsMade: () => number;
}

/** Everything the plugin hands to the registry, as stand-ins. */
function stand(): Stand {
  const { store, vault, timers } = makeStore();
  const storage = new MemoryDeviceStorage();
  const opened: Array<{ path: string; where: unknown }> = [];
  const fake = new FakeObsidian();
  const plugin = new StubPlugin(fake.app, { id: 'spellbook-novel-writer', name: 'Spellbook', version: '0.1.0' });
  let made = 0;
  let id: string | null = null;
  const host: FeatureHost = {
    plugin: plugin as never,
    app: fake.app,
    store,
    vault,
    storage,
    deviceId: () => {
      made++;
      return (id ??= deviceIdOf(storage, fixedRandom()));
    },
    clock: { today: () => TODAY, now: () => 1_000, setTimer: timers.set, nextFrame: (callback) => timers.set(() => callback(16), 16) },
    wordCounts: new WordCountCache({ vault, setTimer: timers.set }),
    openNote: async (path, where) => {
      opened.push({ path, where });
      return true;
    },
  };
  return { host, fake, plugin, storage, opened, idsMade: () => made };
}

const feature = (id: string, register: (context: FeatureContext) => void = () => undefined): Feature => ({ id, register });

describe('the list of features', () => {
  it('holds the five screens, each from a folder of its own', () => {
    expect(FEATURES).toEqual([corkboardFeature, progressFeature, plannerFeature, timelineFeature, outlinerFeature, schemesFeature, modesFeature, reportFeature, exportFeature, proseFeature, scriveningsFeature]);
    expect(FEATURES.map((entry) => entry.id)).toEqual(['corkboard', 'progress', 'planner', 'timeline', 'outliner', 'schemes', 'modes', 'report', 'export', 'prose', 'scrivenings']);
  });

  it('registers as it stands: every screen plugs itself in, and none leaves a trace on the device', () => {
    const { host, fake, plugin, storage, idsMade } = stand();
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const registered = registerFeatures(FEATURES, host);
    expect(logged).not.toHaveBeenCalled(); // no screen failed to start
    expect(registered.ids).toEqual(['corkboard', 'progress', 'planner', 'timeline', 'outliner', 'schemes', 'modes', 'report', 'export', 'prose', 'scrivenings']);

    // What the screens registered through the plugin.
    expect(plugin.viewTypes).toEqual([
      'spellbook-corkboard',
      'spellbook-inspector',
      'spellbook-planner',
      'spellbook-timeline',
      'spellbook-outliner',
      'spellbook-report',
      'spellbook-scrivenings',
    ]);
    const commandIds = plugin.commands.map((command) => command.id);
    expect(commandIds).toEqual(
      expect.arrayContaining(['open-corkboard', 'open-inspector', 'set-writing-targets', 'open-planner', 'open-timeline', 'open-outliner', 'export-manuscript']),
    );
    expect(new Set(commandIds).size).toBe(commandIds.length); // no two share an id
    expect(registered.settingsSections.map((section) => [section.id, section.title])).toEqual([
      ['progress', 'Writing progress'],
      ['schemes', 'Colour scheme'],
      ['modes', 'Writing modes'],
      ['prose', 'Prose checks'],
    ]);
    // The writing progress watches the editor and has its place in the bottom bar.
    expect(plugin.editorExtensions).toHaveLength(1);
    expect(plugin.statusBar.children).toHaveLength(1);
    expect(registered.services.get('progress.sceneLine')).toBeDefined();
    expect(registered.services.get('progress.stats')).toBeDefined();

    // No trace: no pane was opened, nothing was saved on the device, not even an id for it was made.
    expect(fake.workspace.leaves).toEqual([]);
    expect(storage.saves).toEqual([]);
    expect(idsMade()).toBe(0);

    // Letting go: the features first (as the plugin does), then what Obsidian takes away itself.
    registered.release();
    plugin.unload();
    expect(registered.settingsSections).toEqual([]);
    expect(registered.services.get('progress.stats')).toBeUndefined();
    expect(fake.workspace.listenerCount()).toBe(0);
    expect(plugin.statusBar.children).toEqual([]);
    expect(plugin.domEventCount).toBe(0);
    expect(fake.workspace.optionsUpdated).toBe(1); // the editors were told to drop the extension
  });
});

describe('registering features', () => {
  it('hands every feature the same things to work with', async () => {
    const { host, opened } = stand();
    const seen: FeatureContext[] = [];
    registerFeatures([feature('one', (context) => seen.push(context)), feature('two', (context) => seen.push(context))], host);
    expect(seen).toHaveLength(2);
    expect(seen[0]).toBe(seen[1]);
    const context = seen[0] as FeatureContext;
    expect(context.plugin).toBe(host.plugin);
    expect(context.app).toBe(host.app);
    expect(context.store).toBe(host.store);
    expect(context.vault).toBe(host.vault);
    expect(context.storage).toBe(host.storage);
    expect(context.wordCounts).toBe(host.wordCounts);
    expect(context.clock.today()).toBe(TODAY);
    expect(context.clock.now()).toBe(1_000);
    expect(await context.openNote('Novel/Manuscript/A.md', 'tab')).toBe(true);
    expect(opened).toEqual([{ path: 'Novel/Manuscript/A.md', where: 'tab' }]);
  });

  it('calls each feature once, in the order of the list', () => {
    const { host } = stand();
    const order: string[] = [];
    const registered = registerFeatures(
      ['a', 'b', 'c'].map((id) => feature(id, () => order.push(id))),
      host,
    );
    expect(order).toEqual(['a', 'b', 'c']);
    expect(registered.ids).toEqual(['a', 'b', 'c']);
  });

  it('leaves out a feature that fails, and registers the others all the same', () => {
    const { host } = stand();
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const order: string[] = [];
    const registered = registerFeatures(
      [
        feature('first', () => order.push('first')),
        feature('broken', () => {
          throw new Error('bug in a feature');
        }),
        feature('last', () => order.push('last')),
      ],
      host,
    );
    expect(order).toEqual(['first', 'last']);
    expect(registered.ids).toEqual(['first', 'last']);
    expect(logged).toHaveBeenCalledTimes(1);
  });

  it('leaves out the second of two features with the same id', () => {
    const { host } = stand();
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const order: string[] = [];
    const registered = registerFeatures(
      [feature('twin', () => order.push('one')), feature('twin', () => order.push('two'))],
      host,
    );
    expect(order).toEqual(['one']);
    expect(registered.ids).toEqual(['twin']);
    expect(logged).toHaveBeenCalledTimes(1);
  });
});

describe('this device\'s id', () => {
  it('is made only when a feature asks for it, and is the same every time after that', () => {
    const { host, storage, idsMade } = stand();
    let context: FeatureContext | null = null;
    registerFeatures([feature('one', (given) => (context = given))], host);
    expect(idsMade()).toBe(0);
    expect(storage.saves).toEqual([]);

    const id = (context as unknown as FeatureContext).deviceId;
    expect(isDeviceId(id)).toBe(true);
    expect((context as unknown as FeatureContext).deviceId).toBe(id);
    expect(storage.saves).toEqual([[DEVICE_ID_KEY, id]]); // saved once, on the device
  });

  it('is kept in the device\'s own storage, so it is the same after a restart', () => {
    const storage = new MemoryDeviceStorage();
    const first = deviceIdOf(storage, fixedRandom(1));
    expect(first).toMatch(/^[a-z0-9]+$/);
    expect(first).toHaveLength(DEVICE_ID_LENGTH);
    expect(deviceIdOf(storage, fixedRandom(99))).toBe(first); // another random source: still the stored one
    expect(storage.saves).toHaveLength(1);
    // Another device makes another id.
    expect(deviceIdOf(new MemoryDeviceStorage(), fixedRandom(2))).not.toBe(first);
  });

  it('is only ever lower-case letters and digits, whatever the random source gives', () => {
    for (const value of [0, 0.5, 0.999999, 1, -1, Number.NaN]) {
      const id = newDeviceId(() => value);
      expect(id, String(value)).toMatch(/^[a-z0-9]{10}$/);
    }
    expect(isDeviceId('ab12cd34ef')).toBe(true);
    for (const bad of ['', 'abc', 'Has Capitals', 'with/slash', '../../etc', 'a'.repeat(33), 42, null, undefined, ['ab12cd34ef']]) {
      expect(isDeviceId(bad), JSON.stringify(bad)).toBe(false);
    }
  });

  it('replaces anything in the storage that cannot be an id, and survives a storage that does not work', () => {
    const storage = new MemoryDeviceStorage();
    storage.values.set(DEVICE_ID_KEY, JSON.stringify('../../not an id'));
    const id = deviceIdOf(storage, fixedRandom());
    expect(isDeviceId(id)).toBe(true);
    expect(storage.load(DEVICE_ID_KEY)).toBe(id);

    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const broken = new MemoryDeviceStorage();
    broken.broken = true;
    expect(isDeviceId(deviceIdOf(broken, fixedRandom()))).toBe(true);
  });
});

describe('services between features', () => {
  it('are looked up when they are used, so the order of registering does not matter', () => {
    const { host } = stand();
    let ask: (() => number | undefined) | null = null;
    registerFeatures(
      [
        // The first feature wants something the second one offers.
        feature('reader', (context) => {
          expect(context.services.get('word-log')).toBeUndefined(); // nobody offers it yet
          ask = () => context.services.get<{ total: () => number }>('word-log')?.total();
        }),
        feature('writer', (context) => context.services.provide('word-log', { total: () => 1234 })),
      ],
      host,
    );
    expect((ask as unknown as () => number | undefined)()).toBe(1234);
  });

  it('give undefined for a name nobody offers, and the newest value for one offered twice', () => {
    const { host } = stand();
    const { services } = registerFeatures([], host);
    expect(services.get('nothing')).toBeUndefined();
    services.provide('colour', 'red');
    services.provide('colour', 'blue');
    expect(services.get<string>('colour')).toBe('blue');
    services.provide('zero', 0);
    expect(services.get<number>('zero')).toBe(0);
  });
});

describe('settings sections', () => {
  const section = (id: string, title = id): SettingsSection => ({ id, title, render: () => undefined });

  it('are collected in the order they were added', () => {
    const { host } = stand();
    const registered = registerFeatures(
      [
        feature('one', (context) => context.addSettingsSection(section('one', 'First'))),
        feature('two', (context) => context.addSettingsSection(section('two', 'Second'))),
      ],
      host,
    );
    expect(registered.settingsSections.map((entry) => [entry.id, entry.title])).toEqual([
      ['one', 'First'],
      ['two', 'Second'],
    ]);
  });

  it('keep one section per id: adding it again replaces it, in its place', () => {
    const { host } = stand();
    const registered = registerFeatures(
      [
        feature('one', (context) => {
          context.addSettingsSection(section('one', 'Old'));
          context.addSettingsSection(section('other'));
          context.addSettingsSection(section('one', 'New'));
        }),
      ],
      host,
    );
    expect(registered.settingsSections.map((entry) => entry.title)).toEqual(['New', 'other']);
  });
});

describe('unloading', () => {
  it('calls what the features asked for, last in first out, and forgets services and sections', () => {
    const { host } = stand();
    const order: string[] = [];
    let late: FeatureContext | null = null;
    const registered = registerFeatures(
      [
        feature('one', (context) => {
          late = context;
          context.onUnload(() => order.push('one'));
          context.services.provide('thing', 1);
          context.addSettingsSection({ id: 'one', title: 'One', render: () => undefined });
        }),
        feature('two', (context) => context.onUnload(() => order.push('two'))),
      ],
      host,
    );

    registered.release();
    expect(order).toEqual(['two', 'one']);
    expect(registered.settingsSections).toEqual([]);
    expect(registered.services.get('thing')).toBeUndefined();

    registered.release(); // again: nothing more happens
    expect(order).toEqual(['two', 'one']);

    // A feature that asks after the unload is told at once, and can add nothing more.
    const context = late as unknown as FeatureContext;
    context.onUnload(() => order.push('late'));
    context.addSettingsSection({ id: 'late', title: 'Late', render: () => undefined });
    expect(order).toEqual(['two', 'one', 'late']);
    expect(registered.settingsSections).toEqual([]);
  });

  it('goes on closing the others when one of them fails', () => {
    const { host } = stand();
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const order: string[] = [];
    const registered = registerFeatures(
      [
        feature('one', (context) => context.onUnload(() => order.push('one'))),
        feature('two', (context) =>
          context.onUnload(() => {
            throw new Error('bug while closing');
          }),
        ),
      ],
      host,
    );
    registered.release();
    expect(order).toEqual(['one']);
    expect(logged).toHaveBeenCalledTimes(1);
  });
});
