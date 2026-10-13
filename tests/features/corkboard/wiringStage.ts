// A stage for testing the corkboard feature as it is plugged into the plugin:
// the real feature, registered through the registry, on a project store that
// sits on the tests' memory vault, with the stand-in plugin and the stand-in
// workspace, and timers under the test's control. Nothing here is faked on
// the feature's own side: the host is the real one (storeHost.ts).

import type { App, Plugin as ObsidianPlugin, TFile } from 'obsidian';
import type { ProjectStore } from '../../../src/core/projectStore';
import { WordCountCache } from '../../../src/core/wordCountCache';
import { CORKBOARD_VIEW_TYPE } from '../../../src/features/corkboard/corkboardView';
import type { CorkboardView } from '../../../src/features/corkboard/corkboardView';
import { corkboardFeature } from '../../../src/features/corkboard/index';
import { INSPECTOR_VIEW_TYPE } from '../../../src/features/corkboard/inspectorView';
import type { InspectorView } from '../../../src/features/corkboard/inspectorView';
import { registerFeatures } from '../../../src/features/registry';
import type { RegisteredFeatures } from '../../../src/features/registry';
import { FakeLeaf, FakeWorkspace } from '../../fakeObsidianApp';
import { ManualTimers, MemoryVault } from '../../memoryVault';
import { Plugin as StubPlugin, TFile as StubFile } from '../../obsidianStub';
import type { FakeElement, StubCommand } from '../../obsidianStub';
import { INDEX_BODY, MemoryDeviceStorage, TODAY, makeStore, settle, tick } from '../../storeHarness';
// Also gives the stand-in ItemView the getState and setState that Obsidian's has.
import { CLOSING, DANIEL, GHOST, HEBREW_SCENE, HEBREW_SYNOPSIS, INNER_NAME, LETTER, LETTER_TEXT, OPENING } from './stage';

// ---------------------------------------------------------------- the workspace

/** What a test can say about the stand-in workspace once it has room for the feature's panes. */
export interface Room {
  /** Set to make getRightLeaf() return null, as Obsidian may. */
  noRoomOnTheRight: boolean;
  /** How often a view asked for the layout to be saved. */
  layoutSaves: number;
}

/**
 * The stand-in workspace knows the left sidebar and how to open a note. The
 * corkboard needs a new tab in the main area, the inspector a pane in the
 * right sidebar, and the board asks for the layout to be saved: those are
 * added here, for these tests only.
 */
export function makeRoom(workspace: FakeWorkspace): Room {
  // The shared stand-in workspace (tests/fakeObsidianApp.ts) has all of it
  // now; a Room is the workspace itself, under the names these tests use.
  return workspace;
}

// ------------------------------------------------------------------- a novel

export const NOVEL_INDEX = 'Novel/Novel.md';
export const SECOND_INDEX = 'Second/Second.md';

export const STATUSES = [
  { name: 'To do', color: 'red' },
  { name: 'First draft', color: 'orange' },
  { name: 'Done', color: 'green' },
];
export const LABELS = [
  { name: 'Anna', color: 'purple' },
  { name: DANIEL, color: 'cyan' },
];

/**
 * A vault with the small novel of the screen tests in it (tests/features/
 * corkboard/stage.ts), this time as notes: a scene with everything set, a
 * folder with a scene that has no synopsis and a folder inside it with a
 * Hebrew scene, an entry whose note is missing, and a scene with a status the
 * list does not have. A second, smaller project sits next to it.
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
        {
          folder: 'Part one',
          id: 'f-one',
          children: [LETTER, { folder: INNER_NAME, id: 'f-inner', children: [HEBREW_SCENE] }],
        },
        GHOST,
        CLOSING,
      ],
      statuses: STATUSES,
      labels: LABELS,
    },
    body: INDEX_BODY,
  });
  vault.seed(`Novel/${OPENING}`, {
    frontmatter: {
      synopsis: 'Anna arrives in the old town.',
      status: 'To do',
      label: 'Anna',
      target: 1000,
      compile: true,
      created: '2026-10-01',
      edited: TODAY,
      order: 1024,
    },
    body: 'It was a dark night.\n',
  });
  vault.seed(`Novel/${LETTER}`, { frontmatter: { status: 'First draft', order: 2048 }, body: `${LETTER_TEXT}\n` });
  vault.seed(`Novel/${HEBREW_SCENE}`, {
    frontmatter: { synopsis: HEBREW_SYNOPSIS, status: 'Done', label: DANIEL, order: 3072 },
    body: 'שלום לך אחותי היקרה.\n',
  });
  vault.seed(`Novel/${CLOSING}`, {
    frontmatter: { status: 'Sent off', compile: false, order: 4096 },
    body: 'The end came quietly.\n',
  });
  vault.seedFolder('Novel/Research');
  vault.seed('Novel/Research/Trains.md', { body: 'Timetables of the night trains.' });

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

// ----------------------------------------------------------------- the stage

export interface Wired {
  vault: MemoryVault;
  store: ProjectStore;
  timers: ManualTimers;
  workspace: FakeWorkspace;
  room: Room;
  /** The stand-in plugin: what the feature registered is read from it. */
  plugin: StubPlugin;
  storage: MemoryDeviceStorage;
  wordCounts: WordCountCache;
  features: RegisteredFeatures;
  /** Every note the feature asked to have shown, in order. */
  opened: Array<{ path: string; where: unknown }>;
  command(id: string): StubCommand;
  /** The writer moves to the note at a vault path (or to none). */
  workOn(path: string | null): void;
  /** What Obsidian does when the plugin is switched off. */
  switchOff(): void;
}

export interface WireOptions {
  /** The project to open before the feature is registered; null for none. Default: the novel. */
  open?: string | null;
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
  const room = makeRoom(workspace);
  const plugin = new StubPlugin(app, { id: 'spellbook-novel-writer' });
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
  const workOn = (path: string | null): void => {
    workspace.setActiveFile(path === null ? null : (fileAt(path) as unknown as TFile));
  };

  const opened: Wired['opened'] = [];
  const features = registerFeatures([corkboardFeature], {
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
      workOn(path);
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
  return { vault, store, timers, workspace, room, plugin, storage, wordCounts, features, opened, command, workOn, switchOff };
}

/**
 * Let everything come to rest: the store's queue, the reading and counting of
 * notes, and whatever the host and the views put off for a moment. Timers
 * that wait for a pause (a save, a note being read again) are not hurried.
 */
export async function calm(stage: Pick<Wired, 'store' | 'timers'>): Promise<void> {
  for (let turn = 0; turn < 8; turn++) {
    await settle(stage.store);
    await tick();
    stage.timers.advance(0);
  }
}

// ------------------------------------------------------------------- reading

export function leavesOf(stage: Pick<Wired, 'workspace'>, type: string): FakeLeaf[] {
  return stage.workspace.getLeavesOfType(type);
}

/** What a view put on the screen. */
export function paneOf(leaf: FakeLeaf | undefined): FakeElement {
  const view = leaf?.view as unknown as { contentEl: FakeElement } | null | undefined;
  if (!view) throw new Error('the pane holds no view');
  return view.contentEl;
}

export interface OpenPane<V> {
  leaf: FakeLeaf;
  view: V;
  pane: FakeElement;
}

/** Run a command that opens a pane, and give the pane of that kind. */
async function openWith<V>(stage: Wired, commandId: string, type: string): Promise<OpenPane<V>> {
  stage.command(commandId).callback?.();
  await calm(stage);
  const leaf = leavesOf(stage, type)[0];
  if (!leaf?.view) throw new Error(`"${commandId}" opened no pane`);
  return { leaf, view: leaf.view as unknown as V, pane: paneOf(leaf) };
}

/** Run "Open corkboard" and let the board fill. */
export function openCorkboard(stage: Wired): Promise<OpenPane<CorkboardView>> {
  return openWith<CorkboardView>(stage, 'open-corkboard', CORKBOARD_VIEW_TYPE);
}

/** Run "Open inspector". */
export function openInspectorPane(stage: Wired): Promise<OpenPane<InspectorView>> {
  return openWith<InspectorView>(stage, 'open-inspector', INSPECTOR_VIEW_TYPE);
}
