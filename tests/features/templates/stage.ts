// A stage for testing templates as they are plugged into the plugin: the real
// templates feature, with the real World feature next to it (whose "New
// character" offers templates), registered through the registry on a project
// store that sits on the tests' memory vault, with the shared stand-in
// plugin, app and workspace. The novel is the World tests' novel.

import type { Plugin as ObsidianPlugin, TFile } from 'obsidian';
import type { ProjectStore } from '../../../src/core/projectStore';
import { WordCountCache } from '../../../src/core/wordCountCache';
import { registerFeatures } from '../../../src/features/registry';
import type { RegisteredFeatures } from '../../../src/features/registry';
import { templatesFeature } from '../../../src/features/templates/index';
import { worldFeature } from '../../../src/features/world/index';
import { FakeObsidian } from '../../fakeObsidianApp';
import { ManualTimers, MemoryVault } from '../../memoryVault';
import { Plugin as StubPlugin, TFile as StubFile } from '../../obsidianStub';
import type { StubCommand } from '../../obsidianStub';
import { MemoryDeviceStorage, TODAY, makeStore } from '../../storeHarness';
import { NOVEL_INDEX, novelVault } from '../world/stage';

export interface Wired {
  vault: MemoryVault;
  store: ProjectStore;
  timers: ManualTimers;
  plugin: StubPlugin;
  features: RegisteredFeatures;
  opened: Array<{ path: string; where: unknown }>;
  command(id: string): StubCommand;
  /** The writer moves to another note in the editor (a vault path), or to none. */
  activate(path: string | null): void;
  switchOff(): void;
}

/** The two features, registered the way the plugin registers them. */
export async function wire(vault: MemoryVault = novelVault(), open: string | null = NOVEL_INDEX): Promise<Wired> {
  const { store, timers } = makeStore(vault);
  if (open !== null) {
    const opened = await store.openProject(open);
    if (opened.status !== 'done') throw new Error(`could not open the project: ${JSON.stringify(opened)}`);
  }
  vault.clearWrites();

  const fake = new FakeObsidian();
  const plugin = new StubPlugin(fake.app, { id: 'spellbook-novel-writer' });
  const wordCounts = new WordCountCache({ vault, setTimer: timers.set });
  const activate = (path: string | null): void => {
    let file: StubFile | null = null;
    if (path !== null) {
      file = new StubFile();
      file.path = path;
    }
    fake.workspace.setActiveFile(file as unknown as TFile | null);
  };
  const opened: Wired['opened'] = [];
  const features = registerFeatures([worldFeature, templatesFeature], {
    plugin: plugin as unknown as ObsidianPlugin,
    app: fake.app,
    store,
    vault,
    storage: new MemoryDeviceStorage(),
    deviceId: () => 'testdevice',
    clock: {
      today: () => TODAY,
      now: () => 1_000,
      setTimer: timers.set,
      nextFrame: (callback) => timers.set(() => callback(16), 16),
    },
    wordCounts,
    openNote: async (path, where) => {
      opened.push({ path, where });
      return vault.has(path);
    },
  });
  const command = (id: string): StubCommand => {
    const found = plugin.commands.find((candidate) => candidate.id === id);
    if (!found) throw new Error(`no command "${id}"`);
    return found;
  };
  return {
    vault,
    store,
    timers,
    plugin,
    features,
    opened,
    command,
    activate,
    switchOff: () => {
      features.release();
      plugin.unload();
      wordCounts.dispose();
      store.dispose();
    },
  };
}
