// A stage for testing world-building as it is plugged into the plugin: the
// real feature, registered through the registry, on a project store that sits
// on the tests' memory vault, with the shared stand-in plugin, app and
// workspace, and timers under the test's control. Nothing here is faked on
// the feature's own side. The inspector can be put on the stage as well (the
// real corkboard feature), to see "In this scene" from end to end.

import type { Plugin as ObsidianPlugin, TFile } from 'obsidian';
import type { ProjectStore } from '../../../src/core/projectStore';
import { WordCountCache } from '../../../src/core/wordCountCache';
import { corkboardFeature } from '../../../src/features/corkboard/index';
import { registerFeatures } from '../../../src/features/registry';
import type { RegisteredFeatures } from '../../../src/features/registry';
import { worldFeature } from '../../../src/features/world/index';
import { WORLD_VIEW_TYPE } from '../../../src/features/world/worldView';
import type { WorldView } from '../../../src/features/world/worldView';
import { FakeObsidian } from '../../fakeObsidianApp';
import type { FakeLeaf, FakeWorkspace } from '../../fakeObsidianApp';
import { ManualTimers, MemoryVault } from '../../memoryVault';
import { Menu as StubMenu, Modal as StubModal, Plugin as StubPlugin, TFile as StubFile } from '../../obsidianStub';
import type { FakeElement, StubCommand } from '../../obsidianStub';
import { INDEX_BODY, MemoryDeviceStorage, TODAY, makeStore, settle, tick } from '../../storeHarness';

export const NOVEL_INDEX = 'Novel/Novel.md';

/** "Mara", "Keeper of the lighthouse" and "Night at the harbour", in Hebrew. */
export const MARA_HE = 'מארה';
export const MARA_HE_SUMMARY = 'שומרת המגדלור';
export const NIGHT_TITLE = 'לילה בנמל';

export const OPENING = 'Manuscript/Opening.md';
export const LETTER = 'Manuscript/The Letter.md';
export const NIGHT = `Manuscript/${NIGHT_TITLE}.md`;
export const CLOSING = 'Manuscript/Closing.md';
export const FIRE = 'Timeline/The fire.md';

export const MARA = 'World/Characters/Mara.md';
export const MARA_HE_PATH = `World/Characters/${MARA_HE}.md`;
export const SALTWICK = 'World/Places/Saltwick.md';
export const LAMP = 'World/Items/Lamp.md';

export const OPENING_BODY = 'Mara lit the lamp. The harbour of Saltwick was quiet.\n';
export const LETTER_BODY = 'Dear Anna, the keeper has not been seen since the storm.\n';
export const NIGHT_BODY = `ו${MARA_HE} עמדה על המזח.\n`;
export const CLOSING_BODY = 'Tamara closed the book. Nobody spoke of Saltwick again.\n';

/** A note's vault path in the novel. */
export function inNovel(path: string): string {
  return `Novel/${path}`;
}

/**
 * A vault with a small novel in it:
 *
 *   Opening          lists Mara and Saltwick
 *   Part one
 *     The Letter     lists nobody (its text names "the keeper")
 *     (Hebrew title) lists nobody (its text names Mara in Hebrew)
 *   Closing          lists Saltwick, and a link that leads nowhere
 *
 * and in its World folder two characters (one with a Hebrew name), a place
 * and an item. One timeline event lists Saltwick.
 */
export function novelVault(): MemoryVault {
  const vault = new MemoryVault();
  vault.seed(NOVEL_INDEX, {
    frontmatter: {
      spellbook: 'project',
      version: 1,
      title: 'My Novel',
      binder: [OPENING, { folder: 'Part one', id: 'f-one', children: [LETTER, NIGHT] }, CLOSING],
    },
    body: INDEX_BODY,
  });
  vault.seed(inNovel(OPENING), { frontmatter: { status: 'To do', order: 1024, entities: ['[[Mara]]', '[[Saltwick]]'] }, body: OPENING_BODY });
  vault.seed(inNovel(LETTER), { frontmatter: { status: 'To do', order: 2048 }, body: LETTER_BODY });
  vault.seed(inNovel(NIGHT), { frontmatter: { status: 'To do', order: 3072 }, body: NIGHT_BODY });
  vault.seed(inNovel(CLOSING), { frontmatter: { status: 'To do', order: 4096, entities: ['[[Saltwick]]', '[[Nobody]]'] }, body: CLOSING_BODY });
  vault.seed(inNovel(FIRE), { frontmatter: { spellbook: 'event', date: '1890-03-01', timelines: ['Town'], entities: ['[[Saltwick]]'] }, body: '' });

  vault.seed(inNovel(MARA), {
    frontmatter: { type: 'character', role: 'Lighthouse keeper', age: 34, appearance: '', goal: '', summary: 'Keeps the light, and a secret.', aliases: ['the keeper'] },
    body: '## Description\n\nHer story so far.\n',
  });
  vault.seed(inNovel(MARA_HE_PATH), { frontmatter: { type: 'character', summary: MARA_HE_SUMMARY, aliases: [] }, body: '' });
  vault.seed(inNovel(SALTWICK), { frontmatter: { type: 'place', kind: 'Harbour town', region: 'North coast', summary: 'Fog, salt and gulls.' }, body: '' });
  vault.seed(inNovel(LAMP), { frontmatter: { type: 'item', kind: 'Lamp', owner: 'Mara', summary: '' }, body: '' });
  vault.seed('Notes/Plain.md', { body: 'Not part of any project.' });
  return vault;
}

export interface Wired {
  vault: MemoryVault;
  store: ProjectStore;
  timers: ManualTimers;
  workspace: FakeWorkspace;
  /** The stand-in plugin: what the feature registered is read from it. */
  plugin: StubPlugin;
  storage: MemoryDeviceStorage;
  features: RegisteredFeatures;
  /** Every note the feature asked to have shown, in order. */
  opened: Array<{ path: string; where: unknown }>;
  command(id: string): StubCommand;
  /** The writer moves to another note in the editor (a vault path), or to none. */
  activate(path: string | null): void;
  /** What Obsidian does when the plugin is switched off. */
  switchOff(): void;
}

export interface WireOptions {
  /** The project to open before the feature is registered; null for none. Default: the novel. */
  open?: string | null;
  /** Put the corkboard and the inspector on the stage as well. */
  inspector?: boolean;
}

/** The feature, registered the way the plugin registers it, on a vault in memory. */
export async function wire(vault: MemoryVault = novelVault(), options: WireOptions = {}): Promise<Wired> {
  const { store, timers } = makeStore(vault);
  const indexPath = options.open === undefined ? NOVEL_INDEX : options.open;
  if (indexPath !== null) {
    const opened = await store.openProject(indexPath);
    if (opened.status !== 'done') throw new Error(`could not open the project: ${JSON.stringify(opened)}`);
  }
  // What was read and written to get this far is not what the tests are about.
  vault.clearWrites();
  vault.reads.readFrontmatter = 0;
  vault.reads.readText = 0;

  const fake = new FakeObsidian();
  const workspace = fake.workspace;
  const plugin = new StubPlugin(fake.app, { id: 'spellbook-novel-writer' });
  const storage = new MemoryDeviceStorage();
  const wordCounts = new WordCountCache({ vault, setTimer: timers.set });
  wordCounts.start();

  const files = new Map<string, StubFile>();
  const fileAt = (path: string): StubFile => {
    let file = files.get(path);
    if (!file) {
      file = new StubFile();
      file.path = path;
      files.set(path, file);
    }
    return file;
  };
  const activate = (path: string | null): void => {
    workspace.setActiveFile(path === null ? null : (fileAt(path) as unknown as TFile));
  };

  const opened: Wired['opened'] = [];
  const features = registerFeatures(options.inspector === true ? [corkboardFeature, worldFeature] : [worldFeature], {
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
      if (!vault.has(path)) return false;
      activate(path);
      return true;
    },
  });

  const command = (id: string): StubCommand => {
    const found = plugin.commands.find((candidate) => candidate.id === id);
    if (!found) throw new Error(`no command "${id}"`);
    return found;
  };
  const switchOff = (): void => {
    // As in src/main.ts: the features are let go of first, then Obsidian
    // takes away what was registered through the plugin and closes its views.
    features.release();
    plugin.unload();
    wordCounts.dispose();
    store.dispose();
  };
  return { vault, store, timers, workspace, plugin, storage, features, opened, command, activate, switchOff };
}

/**
 * Let everything come to rest: the store's queue, the notes being read, and
 * whatever the host and the screens put off for a moment.
 */
export async function calm(stage: Pick<Wired, 'store' | 'timers'>): Promise<void> {
  for (let turn = 0; turn < 8; turn++) {
    await settle(stage.store);
    await tick();
    stage.timers.advance(0);
  }
}

// ------------------------------------------------------------------- reading

export interface OpenPane {
  leaf: FakeLeaf;
  view: WorldView;
  pane: FakeElement;
}

/** Run "Open world" and let the browser fill. */
export async function openWorld(stage: Wired, width = 900): Promise<OpenPane> {
  stage.command('open-world').callback?.();
  await calm(stage);
  const leaf = stage.workspace.getLeavesOfType(WORLD_VIEW_TYPE)[0];
  const view = leaf?.view as unknown as (WorldView & { contentEl: FakeElement }) | null | undefined;
  if (!leaf || !view) throw new Error('"Open world" opened no pane');
  setWidth({ leaf, view, pane: view.contentEl }, width);
  return { leaf, view, pane: view.contentEl };
}

/** Give the pane a width, as a browser would after laying it out. */
export function setWidth(open: OpenPane, width: number): void {
  open.pane.clientWidth = width;
  open.view.onResize();
}

/** The one element with a class, or a failed test. */
export function one(root: FakeElement, cls: string): FakeElement {
  const found = root.withClass(cls);
  if (found.length !== 1) throw new Error(`expected one ".${cls}", found ${found.length}`);
  return found[0] as FakeElement;
}

/** The groups of the browser as a reader sees them: [heading, count, names of the cards]. */
export function groupsOf(pane: FakeElement): Array<[string, string, string[]]> {
  return pane.withClass('spellbook-world-group').map((group) => [
    one(group, 'spellbook-world-group-name').text,
    one(group, 'spellbook-world-group-count').text,
    group.withClass('spellbook-world-card-name').map((name) => name.text),
  ]);
}

export function cardNamed(pane: FakeElement, name: string): FakeElement {
  const found = pane.withClass('spellbook-world-card').filter((card) => one(card, 'spellbook-world-card-name').text === name);
  if (found.length !== 1) throw new Error(`expected one card "${name}", found ${found.length}`);
  return found[0] as FakeElement;
}

/** The menu that was shown last, or a failed test. */
export function lastMenu(): StubMenu {
  const menu = StubMenu.shown[StubMenu.shown.length - 1];
  if (!menu) throw new Error('no menu was shown');
  return menu;
}

/** A window as the tests see it: the stand-in, whatever class of the plugin it is. */
export type OpenWindow = StubModal & { contentEl: FakeElement; titleEl: FakeElement };

/** The window that was opened last and is still open, or a failed test. */
export function lastWindow(): OpenWindow {
  const open = StubModal.opened.filter((modal) => modal.isOpen);
  const modal = open[open.length - 1];
  if (!modal) throw new Error('no window is open');
  return modal as OpenWindow;
}

/** Press the button that goes ahead in the window that asks "are you sure?". */
export function confirmIn(window: OpenWindow): void {
  const button = window.contentEl.settings[0]?.components[1] as { click?: () => void } | undefined;
  if (!button?.click) throw new Error('the window has no button to go ahead with');
  button.click();
}

/** The last of a list, or a failed test. */
export function last<T>(list: readonly T[]): T {
  if (list.length === 0) throw new Error('the list is empty');
  return list[list.length - 1] as T;
}

/** Type into a field, as a writer would. */
export function typeInto(field: FakeElement, text: string): void {
  field.value = text;
  field.fire('input');
}

/** Type a name into the window that asks for one line of text, and confirm with Enter. */
export async function answer(stage: Wired, text: string): Promise<void> {
  const input = one(lastWindow().contentEl, 'spellbook-prompt-input');
  typeInto(input, text);
  input.fire('keydown', { key: 'Enter' });
  await calm(stage);
}
