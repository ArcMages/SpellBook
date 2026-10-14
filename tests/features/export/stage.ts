// A stage for testing the export as it is plugged into the plugin: the real
// feature, registered through the registry, on a project store that sits on
// the tests' memory vault, with the shared stand-in plugin and app
// (tests/obsidianStub.ts, tests/fakeObsidianApp.ts) as they are. Nothing
// here is faked on the feature's own side.

import type { Plugin as ObsidianPlugin } from 'obsidian';
import type { ProjectStore } from '../../../src/core/projectStore';
import { WordCountCache } from '../../../src/core/wordCountCache';
import { exportFeature } from '../../../src/features/export/index';
import type { ExportModal } from '../../../src/features/export/index';
import { registerFeatures } from '../../../src/features/registry';
import type { RegisteredFeatures } from '../../../src/features/registry';
import { FakeObsidian } from '../../fakeObsidianApp';
import { ManualTimers, MemoryVault } from '../../memoryVault';
import { Modal as StubModal, Plugin as StubPlugin } from '../../obsidianStub';
import type { ButtonComponent, DropdownComponent, FakeElement, Setting, StubCommand, TextComponent, ToggleComponent } from '../../obsidianStub';
import { INDEX_BODY, MemoryDeviceStorage, TODAY, makeStore, settle, tick } from '../../storeHarness';

// ------------------------------------------------------------------- a novel

export const NOVEL_INDEX = 'Novel/Novel.md';
export const SECOND_INDEX = 'Second/Second.md';

/** "Night at the harbour": a scene with a Hebrew title. */
export const NIGHT_TITLE = 'לילה בנמל';
/** "Part two": a folder with a Hebrew name. */
export const INNER_NAME = 'חלק שני';

export const OPENING = 'Manuscript/Opening.md';
export const LETTER = 'Manuscript/The Letter.md';
export const DRAFT = 'Manuscript/Draft.md';
export const NIGHT = `Manuscript/${NIGHT_TITLE}.md`;
export const GHOST = 'Manuscript/Ghost.md';
export const CLOSING = 'Manuscript/Closing.md';

export const OPENING_LINE = 'It was a dark night.';
export const LETTER_LINE = 'Dear Anna, I am writing to you from the harbour.';
export const DRAFT_LINE = 'This draft is not ready to be read.';
/** "Hello to you, my dear sister." */
export const NIGHT_LINE = 'שלום לך אחותי היקרה.';
export const CLOSING_LINE = 'The end came quietly.';
export const PRIVATE_NOTE = 'remember to check the tides';

/** A scene's vault path in the novel. */
export function inNovel(path: string): string {
  return `Novel/${path}`;
}

/**
 * A vault with a small novel in it, and a second project next to it.
 *
 *   Opening
 *   Part one        [f-one]
 *     The Letter
 *     Draft         (compile off)
 *     (Hebrew name) [f-inner]
 *       (Hebrew title)
 *   Ghost           (missing)
 *   Closing
 */
export function novelVault(): MemoryVault {
  const vault = new MemoryVault();
  vault.seed(NOVEL_INDEX, {
    frontmatter: {
      spellbook: 'project',
      version: 1,
      title: 'My Novel',
      binder: [
        OPENING,
        { folder: 'Part one', id: 'f-one', children: [LETTER, DRAFT, { folder: INNER_NAME, id: 'f-inner', children: [NIGHT] }] },
        GHOST,
        CLOSING,
      ],
    },
    body: INDEX_BODY,
  });
  vault.seed(inNovel(OPENING), {
    frontmatter: { synopsis: 'Anna arrives in the old town.', status: 'To do', compile: true, order: 1024 },
    body: `${OPENING_LINE}\n\n%%${PRIVATE_NOTE}%%\n\nThe **rain** fell.\n`,
  });
  vault.seed(inNovel(LETTER), { frontmatter: { status: 'First draft', order: 2048 }, body: `${LETTER_LINE}\n` });
  vault.seed(inNovel(DRAFT), { frontmatter: { compile: false, order: 2560 }, body: `${DRAFT_LINE}\n` });
  vault.seed(inNovel(NIGHT), { frontmatter: { status: 'Done', order: 3072 }, body: `${NIGHT_LINE}\n` });
  vault.seed(inNovel(CLOSING), { frontmatter: { order: 4096 }, body: `${CLOSING_LINE}\n` });
  vault.seedFolder('Novel/Research');

  vault.seed(SECOND_INDEX, {
    frontmatter: { spellbook: 'project', version: 1, title: 'Second Book', binder: ['Manuscript/Prologue.md'] },
    body: INDEX_BODY,
  });
  vault.seed('Second/Manuscript/Prologue.md', { body: 'Long ago.\n' });
  vault.seed('Notes/Plain.md', { body: 'Not part of any project.' });
  return vault;
}

// ----------------------------------------------------------------- the stage

export interface Wired {
  vault: MemoryVault;
  store: ProjectStore;
  timers: ManualTimers;
  /** The stand-in plugin: what the feature registered is read from it. */
  plugin: StubPlugin;
  storage: MemoryDeviceStorage;
  features: RegisteredFeatures;
  /** The stand-in Obsidian the feature was given: its workspace and its own list of files. */
  fake: FakeObsidian;
  /** Every file the feature asked to have shown, in order. */
  opened: Array<{ path: string; where: unknown }>;
  /** Whether a file that is asked for can be shown. */
  canOpen: { value: boolean };
  command(id: string): StubCommand;
  /** What Obsidian does when the plugin is switched off. */
  switchOff(): void;
}

export interface WireOptions {
  /** The project to open before the feature is registered; null for none. Default: the novel. */
  open?: string | null;
  /** What the device already remembers. */
  storage?: MemoryDeviceStorage;
}

/** The feature, registered the way the plugin registers it, on a vault in memory. */
export async function wire(vault: MemoryVault = novelVault(), options: WireOptions = {}): Promise<Wired> {
  const { store, timers } = makeStore(vault);
  const indexPath = options.open === undefined ? NOVEL_INDEX : options.open;
  if (indexPath !== null) {
    const opened = await store.openProject(indexPath);
    if (opened.status !== 'done') throw new Error(`could not open the project: ${JSON.stringify(opened)}`);
  }
  await settle(store);
  // What was written to get this far is not what the tests are about.
  vault.clearWrites();

  const fake = new FakeObsidian();
  const plugin = new StubPlugin(fake.app, { id: 'spellbook-novel-writer' });
  const storage = options.storage ?? new MemoryDeviceStorage();
  const wordCounts = new WordCountCache({ vault, setTimer: timers.set });
  const opened: Wired['opened'] = [];
  const canOpen = { value: true };

  const features = registerFeatures([exportFeature], {
    plugin: plugin as unknown as ObsidianPlugin,
    app: fake.app,
    store,
    vault,
    storage,
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
  return { vault, store, timers, plugin, storage, features, fake, opened, canOpen, command, switchOff };
}

/** Let the store's queue and whatever waits on it come to rest. */
export async function calm(stage: Pick<Wired, 'store'>): Promise<void> {
  for (let turn = 0; turn < 6; turn++) {
    await settle(stage.store);
    await tick();
  }
}

// ---------------------------------------------------------------- the window

/** The export window, as the tests work it. */
export interface Window {
  modal: ExportModal & { isOpen: boolean; contentEl: FakeElement; titleEl: FakeElement; modalEl: FakeElement };
  content: FakeElement;
}

/** Run "Export manuscript" and give the window it opened. */
export function openWindow(stage: Wired): Window {
  const before = StubModal.opened.length;
  stage.command('export-manuscript').callback?.();
  const modal = StubModal.opened[StubModal.opened.length - 1] as unknown as Window['modal'] | undefined;
  if (!modal || StubModal.opened.length === before) throw new Error('"Export manuscript" opened no window');
  return { modal, content: modal.contentEl };
}

/** The small window that came up when the export was saved. */
export function doneWindow(): Window {
  const modal = [...StubModal.opened].reverse().find((candidate) => (candidate as unknown as Window['modal']).modalEl.hasClass('spellbook-export-done')) as
    | Window['modal']
    | undefined;
  if (!modal) throw new Error('no window says the export is saved');
  return { modal, content: modal.contentEl };
}

/** The row of the window with this name. */
export function row(window: Window, name: string): Setting {
  const found = window.content.settings.find((setting) => setting.nameEl.text === name);
  if (!found) throw new Error(`the window has no row "${name}"`);
  return found;
}

export function hasRow(window: Window, name: string): boolean {
  return window.content.settings.some((setting) => setting.nameEl.text === name);
}

export function dropdown(window: Window, name: string): DropdownComponent {
  return row(window, name).components[0] as DropdownComponent;
}

/** The choices of a list, as [value, text]. */
export function choicesOf(window: Window, name: string): Array<[string, string]> {
  return dropdown(window, name).selectEl.children.map((option) => [option.value, option.text]);
}

export function textField(window: Window, name: string): TextComponent {
  return row(window, name).components[0] as TextComponent;
}

export function toggle(window: Window, name: string): ToggleComponent {
  return row(window, name).toggles[0] as ToggleComponent;
}

/** The button of the window that says this. */
export function button(window: Window, text: string): ButtonComponent {
  for (const setting of window.content.settings) {
    for (const component of setting.components) {
      if ('buttonEl' in component && component.buttonEl.text === text) return component;
    }
  }
  throw new Error(`the window has no button "${text}"`);
}

/** The text of the elements with a class, as a reader sees it. */
export function textsOf(window: Window, cls: string): string[] {
  return window.content.withClass(cls).map((element) => element.fullText);
}

/** Press Export and wait for the file. */
export async function pressExport(stage: Wired, window: Window): Promise<void> {
  button(window, 'Export').click();
  await calm(stage);
}

/** The files in the novel's Exports folder, sorted. */
export function exportsOf(vault: MemoryVault): string[] {
  return vault.listFiles('Novel/Exports').sort();
}
