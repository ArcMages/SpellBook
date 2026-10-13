// A stage for testing the outliner as it is plugged into the plugin: the real
// feature, registered through the registry, on a project store that sits on
// the tests' memory vault, with the stand-in plugin and the stand-in
// workspace, and timers under the test's control. Nothing here is faked on
// the feature's own side: the host is the real one (host.ts).

import type { App, Plugin as ObsidianPlugin, TFile } from 'obsidian';
import type { ProjectStore } from '../../../src/core/projectStore';
import { countWords } from '../../../src/core/wordCount';
import { WordCountCache } from '../../../src/core/wordCountCache';
import { outlinerFeature } from '../../../src/features/outliner/index';
import { OUTLINER_VIEW_TYPE } from '../../../src/features/outliner/outlinerView';
import type { OutlinerView } from '../../../src/features/outliner/outlinerView';
import { registerFeatures } from '../../../src/features/registry';
import type { RegisteredFeatures } from '../../../src/features/registry';
import { FakeLeaf, FakeWorkspace } from '../../fakeObsidianApp';
import { ManualTimers, MemoryVault } from '../../memoryVault';
import { Menu as StubMenu, Plugin as StubPlugin, TFile as StubFile } from '../../obsidianStub';
import type { FakeElement, StubCommand } from '../../obsidianStub';
import { INDEX_BODY, MemoryDeviceStorage, TODAY, makeStore, settle, tick } from '../../storeHarness';

// ------------------------------------------------------------------- a novel

export const NOVEL_INDEX = 'Novel/Novel.md';
export const SECOND_INDEX = 'Second/Second.md';

/** "Night at the harbour": a scene with a Hebrew title. */
export const NIGHT_TITLE = 'לילה בנמל';
/** "Daniel": a label with a Hebrew name. */
export const DANIEL = 'דניאל';
/** "Part two": a folder with a Hebrew name. */
export const INNER_NAME = 'חלק שני';
/** "A letter arrives at night." */
export const NIGHT_SYNOPSIS = 'מכתב מגיע בלילה.';

export const OPENING = 'Manuscript/Opening.md';
export const LETTER = 'Manuscript/The Letter.md';
export const NIGHT = `Manuscript/${NIGHT_TITLE}.md`;
export const GHOST = 'Manuscript/Ghost.md';
export const CLOSING = 'Manuscript/Closing.md';
/** A note in the manuscript folder that is not in the binder. */
export const LOOSE = 'Manuscript/Loose.md';

export const OPENING_BODY = 'It was a dark night.\n\n- [x] name the dog\n- [ ] look up the trains\n';
export const LETTER_BODY = 'Dear Anna, I am writing to you from the harbour.\n';
export const NIGHT_BODY = 'שלום לך אחותי היקרה.\n\n- [x] לבדוק את הרכבות\n';
export const CLOSING_BODY = 'The end came quietly.\n';

export const STATUSES = [
  { name: 'To do', color: 'red' },
  { name: 'First draft', color: 'orange' },
  { name: 'Done', color: 'green' },
];
export const LABELS = [
  { name: 'Anna', color: 'purple' },
  { name: DANIEL, color: 'cyan' },
];

/** The words the plugin counts in a scene's text. */
export const WORDS = {
  opening: countWords(OPENING_BODY),
  letter: countWords(LETTER_BODY),
  night: countWords(NIGHT_BODY),
  closing: countWords(CLOSING_BODY),
};

/** A scene's vault path in the novel. */
export function inNovel(path: string): string {
  return `Novel/${path}`;
}

/**
 * A vault with a small novel in it: a scene with everything set, a folder
 * with a scene and a folder inside it that holds a Hebrew scene, an entry
 * whose note is missing, and a scene with a status the list does not have. A
 * second, smaller project sits next to it.
 *
 *   Opening
 *   Part one        [f-one]
 *     The Letter
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
        { folder: 'Part one', id: 'f-one', children: [LETTER, { folder: INNER_NAME, id: 'f-inner', children: [NIGHT] }] },
        GHOST,
        CLOSING,
      ],
      statuses: STATUSES,
      labels: LABELS,
    },
    body: INDEX_BODY,
  });
  vault.seed(inNovel(OPENING), {
    frontmatter: {
      synopsis: 'Anna arrives in the old town.',
      status: 'To do',
      label: 'Anna',
      target: 1000,
      compile: true,
      created: '2026-10-01',
      edited: TODAY,
      order: 1024,
      tags: ['draft', 'act-one'],
      pov: 'Anna',
    },
    body: OPENING_BODY,
  });
  vault.seed(inNovel(LETTER), { frontmatter: { status: 'First draft', target: 4, order: 2048, pov: 'Daniel' }, body: LETTER_BODY });
  vault.seed(inNovel(NIGHT), {
    frontmatter: { synopsis: NIGHT_SYNOPSIS, status: 'Done', label: DANIEL, order: 3072 },
    body: NIGHT_BODY,
  });
  vault.seed(inNovel(CLOSING), { frontmatter: { status: 'Sent off', compile: false, order: 4096 }, body: CLOSING_BODY });
  vault.seed(inNovel(LOOSE), { body: 'Not in the binder yet.\n' });
  vault.seedFolder('Novel/Research');

  vault.seed(SECOND_INDEX, {
    frontmatter: {
      spellbook: 'project',
      version: 1,
      title: 'Second Book',
      binder: ['Manuscript/Prologue.md', 'Manuscript/Opening.md'],
      statuses: [{ name: 'Idea', color: 'blue' }],
    },
    body: INDEX_BODY,
  });
  vault.seed('Second/Manuscript/Prologue.md', { frontmatter: { status: 'Idea', synopsis: 'Before it all began.' }, body: 'Long ago.\n' });
  vault.seed('Second/Manuscript/Opening.md', { frontmatter: { synopsis: 'Another opening altogether.' }, body: 'One two three.\n' });
  vault.seed('Notes/Plain.md', { body: 'Not part of any project.' });
  return vault;
}

// ---------------------------------------------------------------- the workspace

/**
 * The stand-in workspace knows the left sidebar and how to open a note. The
 * outliner needs a new tab in the main area that can hold one of the plugin's
 * views: that is added here, for these tests only.
 */
function makeRoom(workspace: FakeWorkspace): void {
  const opener = workspace.getLeaf.bind(workspace);
  const roomy = workspace as unknown as { getLeaf(where?: unknown): unknown };
  roomy.getLeaf = (where?: unknown) => {
    const plain = opener(where);
    // The tab the writer is in (or a split, or a window): only ever used to show a note.
    if (where !== 'tab' && where !== true) return plain;
    const leaf = workspace.addLeaf(workspace.rootSplit);
    return Object.assign(leaf, { openFile: plain.openFile });
  };
}

// ----------------------------------------------------------------- the stage

export interface Wired {
  vault: MemoryVault;
  store: ProjectStore;
  timers: ManualTimers;
  workspace: FakeWorkspace;
  /** The stand-in plugin: what the feature registered is read from it. */
  plugin: StubPlugin;
  storage: MemoryDeviceStorage;
  wordCounts: WordCountCache;
  features: RegisteredFeatures;
  /** Every note the feature asked to have shown, in order. */
  opened: Array<{ path: string; where: unknown }>;
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
  // What was read and written to get this far is not what the tests are about.
  vault.clearWrites();
  vault.reads.readFrontmatter = 0;
  vault.reads.readText = 0;

  const app = {} as { workspace: FakeWorkspace };
  const workspace = new FakeWorkspace(app);
  app.workspace = workspace;
  makeRoom(workspace);
  const plugin = new StubPlugin(app, { id: 'spellbook-novel-writer' });
  const storage = options.storage ?? new MemoryDeviceStorage();
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

  const opened: Wired['opened'] = [];
  // The outliner is not in the plugin's own list yet: it is registered directly.
  const features = registerFeatures([outlinerFeature], {
    plugin: plugin as unknown as ObsidianPlugin,
    app: app as unknown as App,
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
      workspace.setActiveFile(fileAt(path) as unknown as TFile);
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
  return { vault, store, timers, workspace, plugin, storage, wordCounts, features, opened, command, switchOff };
}

/**
 * Let everything come to rest: the store's queue, the reading and counting of
 * notes, and whatever the host and the table put off for a moment. Timers
 * that wait for a pause (a save, a note being read again, typing in the
 * filter box) are not hurried.
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
  view: OutlinerView;
  pane: FakeElement;
}

/** Run "Open outliner" and let the table fill. */
export async function openOutliner(stage: Wired): Promise<OpenPane> {
  stage.command('open-outliner').callback?.();
  await calm(stage);
  const leaf = stage.workspace.getLeavesOfType(OUTLINER_VIEW_TYPE)[0];
  const view = leaf?.view as unknown as (OutlinerView & { contentEl: FakeElement }) | null | undefined;
  if (!leaf || !view) throw new Error('"Open outliner" opened no pane');
  return { leaf, view, pane: view.contentEl };
}

/** The one element with a class, or a failed test. */
export function one(root: FakeElement, cls: string): FakeElement {
  const found = root.withClass(cls);
  if (found.length !== 1) throw new Error(`expected one ".${cls}", found ${found.length}`);
  return found[0] as FakeElement;
}

/** The rows above the Total row, top to bottom. */
export function rowsOf(pane: FakeElement): FakeElement[] {
  return pane.withClass('spellbook-outliner-row').filter((row) => !row.hasClass('spellbook-outliner-total'));
}

export function totalRow(pane: FakeElement): FakeElement {
  return one(pane, 'spellbook-outliner-total');
}

/** The name a row is known by: a scene's title, a folder's name, "Manuscript" or "Total". */
export function nameOf(row: FakeElement): string {
  const name = row.withClass('spellbook-outliner-title')[0] ?? row.withClass('spellbook-outliner-folder-name')[0];
  return name?.text ?? '';
}

export function namesOf(pane: FakeElement): string[] {
  return rowsOf(pane).map(nameOf);
}

export function rowNamed(pane: FakeElement, name: string): FakeElement {
  const found = [...rowsOf(pane), totalRow(pane)].filter((row) => nameOf(row) === name);
  if (found.length !== 1) throw new Error(`expected one row "${name}", found ${found.length}`);
  return found[0] as FakeElement;
}

/** The cell of a row in a column ("words", "status", "property" ...). */
export function cellOf(row: FakeElement, column: string): FakeElement {
  const found = row.children.filter((cell) => cell.hasClass(`spellbook-outliner-col-${column}`));
  if (found.length !== 1) throw new Error(`expected one "${column}" cell, found ${found.length}`);
  return found[0] as FakeElement;
}

/** What a cell says, as a reader sees it. */
export function textOf(pane: FakeElement, name: string, column: string): string {
  return cellOf(rowNamed(pane, name), column).fullText;
}

/** The headers of the columns on show, in order. */
export function headersOf(pane: FakeElement): string[] {
  return pane.withClass('spellbook-outliner-head-title').map((title) => title.text);
}

/** The part of a column's header that a click sorts by. */
export function headerButton(pane: FakeElement, title: string): FakeElement {
  const head = pane.withClass('spellbook-outliner-head').find((th) => th.withClass('spellbook-outliner-head-title')[0]?.text === title);
  const button = head?.withClass('spellbook-outliner-head-button')[0];
  if (!button) throw new Error(`no column "${title}"`);
  return button;
}

/** The chips above the table, as they read. (A chip is made of pieces; the stand-in screen puts a space between them.) */
export function chipsOf(pane: FakeElement): string[] {
  return pane.withClass('spellbook-outliner-chip').map((chip) => chip.fullText.replace(/\s+/g, ' ').replace(/ ,/g, ','));
}

/** The menu that was shown last, or a failed test. */
export function lastMenu(): StubMenu {
  const menu = StubMenu.shown[StubMenu.shown.length - 1];
  if (!menu) throw new Error('no menu was shown');
  return menu;
}

/** The field that is open in a cell, or a failed test. */
export function fieldIn(cell: FakeElement): FakeElement {
  return one(cell, 'spellbook-outliner-input');
}
