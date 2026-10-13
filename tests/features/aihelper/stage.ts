// A stage for testing the AI helper as it is plugged into the plugin: the
// real feature, registered through the registry, on a project store that
// sits on the tests' memory vault, with the shared stand-in plugin and app.

import type { Plugin as ObsidianPlugin } from 'obsidian';
import type { ProjectStore } from '../../../src/core/projectStore';
import { WordCountCache } from '../../../src/core/wordCountCache';
import { aihelperFeature } from '../../../src/features/aihelper/index';
import { registerFeatures } from '../../../src/features/registry';
import type { RegisteredFeatures } from '../../../src/features/registry';
import { FakeObsidian } from '../../fakeObsidianApp';
import { MemoryVault } from '../../memoryVault';
import { Modal as StubModal, Plugin as StubPlugin } from '../../obsidianStub';
import type { ButtonComponent, FakeElement, StubCommand } from '../../obsidianStub';
import { INDEX_BODY, MemoryDeviceStorage, TODAY, makeStore, settle, tick } from '../../storeHarness';

export const NOVEL_INDEX = 'Novel/Novel.md';
export const SECOND_INDEX = 'Second/Second.md';
/** Where the note goes in the novel, as a vault path. */
export const HELPER = 'Novel/AI helper/Spellbook for AI assistants.md';

export const OPENING_TEXT = 'It was a dark night.\n';

/** A vault with a small novel in it (a scene, a research note, a to-do list), and a second project next to it. */
export function novelVault(): MemoryVault {
  const vault = new MemoryVault();
  vault.seed(NOVEL_INDEX, {
    frontmatter: { spellbook: 'project', version: 1, title: 'My Novel', binder: ['Manuscript/Opening.md'] },
    body: INDEX_BODY,
  });
  vault.seed('Novel/Manuscript/Opening.md', { frontmatter: { status: 'To do', order: 1024 }, body: OPENING_TEXT });
  vault.seed('Novel/Research/Trains.md', { body: 'facts' });
  vault.seed('Novel/To-do.md', { body: '- [ ] write chapter one\n' });
  vault.seedFolder('Novel/Timeline');
  vault.seedFolder('Novel/Stats');
  vault.seed(SECOND_INDEX, {
    frontmatter: { spellbook: 'project', version: 1, title: 'Second Book', binder: [] },
    body: INDEX_BODY,
  });
  vault.seed('Notes/Plain.md', { body: 'Not part of any project.' });
  return vault;
}

export interface Wired {
  vault: MemoryVault;
  store: ProjectStore;
  plugin: StubPlugin;
  features: RegisteredFeatures;
  /** Every note the feature asked to have shown, in order. */
  opened: Array<{ path: string; where: unknown }>;
  /** Whether a note that is asked for can be shown. */
  canOpen: { value: boolean };
  command(id: string): StubCommand;
  /** What Obsidian does when the plugin is switched off. */
  switchOff(): void;
}

/** The feature, registered the way the plugin registers it, on a vault in memory. */
export async function wire(vault: MemoryVault = novelVault(), open: string | null = NOVEL_INDEX): Promise<Wired> {
  const { store, timers } = makeStore(vault);
  if (open !== null) {
    const result = await store.openProject(open);
    if (result.status !== 'done') throw new Error(`could not open the project: ${JSON.stringify(result)}`);
  }
  await settle(store);
  vault.clearWrites();

  const fake = new FakeObsidian();
  const plugin = new StubPlugin(fake.app, { id: 'spellbook-novel-writer' });
  const wordCounts = new WordCountCache({ vault, setTimer: timers.set });
  const opened: Wired['opened'] = [];
  const canOpen = { value: true };
  const features = registerFeatures([aihelperFeature], {
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
      return canOpen.value && vault.has(path);
    },
  });
  const command = (id: string): StubCommand => {
    const found = plugin.commands.find((candidate) => candidate.id === id);
    if (!found) throw new Error(`no command "${id}"`);
    return found;
  };
  const switchOff = (): void => {
    features.release();
    plugin.unload();
    wordCounts.dispose();
    store.dispose();
  };
  return { vault, store, plugin, features, opened, canOpen, command, switchOff };
}

/** Let the store's queue and whatever waits on it come to rest. */
export async function calm(stage: Pick<Wired, 'store'>): Promise<void> {
  for (let turn = 0; turn < 6; turn++) {
    await settle(stage.store);
    await tick();
  }
}

/** Run "Create AI helper note" and wait for what comes of it. */
export async function runCommand(stage: Wired): Promise<void> {
  stage.command('create-ai-helper-note').callback?.();
  await calm(stage);
}

/** A window, as the tests work it. */
export type Window = StubModal & { isOpen: boolean; contentEl: FakeElement; titleEl: FakeElement };

/** The window that was opened last, or a failed test. */
export function lastWindow(): Window {
  const modal = StubModal.opened[StubModal.opened.length - 1] as unknown as Window | undefined;
  if (!modal) throw new Error('no window was opened');
  return modal;
}

/** The button of a window that says this. */
export function button(window: Window, text: string): ButtonComponent {
  for (const setting of window.contentEl.settings) {
    for (const component of setting.components) {
      if ('buttonEl' in component && component.buttonEl.text === text) return component;
    }
  }
  throw new Error(`the window has no button "${text}"`);
}

/** What the window says under its title. */
export function messageOf(window: Window): string {
  return window.contentEl.withClass('spellbook-confirm-message')[0]?.text ?? '';
}
