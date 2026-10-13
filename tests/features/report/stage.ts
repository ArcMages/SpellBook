// A stage for testing the writing report as it is plugged into the plugin:
// the real feature, registered through the registry, on a project store that
// sits on the tests' memory vault, with the shared stand-in plugin and the
// shared stand-in app and workspace (tests/obsidianStub.ts,
// tests/fakeObsidianApp.ts) as they are, and timers under the test's control.
// Nothing here is faked on the feature's own side: the host is the real one.

import type { Plugin as ObsidianPlugin, TFile } from 'obsidian';
import type { ProjectStore } from '../../../src/core/projectStore';
import { WordCountCache } from '../../../src/core/wordCountCache';
import { registerFeatures } from '../../../src/features/registry';
import type { RegisteredFeatures } from '../../../src/features/registry';
import { reportFeature } from '../../../src/features/report/index';
import { REPORT_VIEW_TYPE } from '../../../src/features/report/reportView';
import type { ReportView } from '../../../src/features/report/reportView';
import { FakeObsidian } from '../../fakeObsidianApp';
import type { FakeLeaf, FakeWorkspace } from '../../fakeObsidianApp';
import { ManualTimers, MemoryVault } from '../../memoryVault';
import { Menu as StubMenu, Plugin as StubPlugin, TFile as StubFile } from '../../obsidianStub';
import type { FakeElement, StubCommand } from '../../obsidianStub';
import { INDEX_BODY, MemoryDeviceStorage, TODAY, makeStore, settle, tick } from '../../storeHarness';

// ------------------------------------------------------------------- a novel

export const NOVEL_INDEX = 'Novel/Novel.md';

/** "Night at the harbour": a scene with a Hebrew title. */
export const NIGHT_TITLE = 'לילה בנמל';
/** "Part two": a folder with a Hebrew name. */
export const INNER_NAME = 'חלק שני';

export const OPENING = 'Manuscript/Opening.md';
export const LETTER = 'Manuscript/The Letter.md';
export const NIGHT = `Manuscript/${NIGHT_TITLE}.md`;
export const GHOST = 'Manuscript/Ghost.md';
export const CLOSING = 'Manuscript/Closing.md';

// Each text with its hand count: words, characters with and without spaces,
// sentences, paragraphs. The first and the third are counted line by line in
// engine.test.ts.

/** 28 words, 152 characters (128 without spaces), 5 sentences, 3 paragraphs. */
export const OPENING_BODY = [
  '# Chapter One',
  '',
  'It was a dark night. The harbour was empty, and Anna walked alone.',
  '',
  '"Who is there?" she asked. Nobody answered!',
  '',
  '%% remember to name the dog %%',
  'Dr. Levi had sent **three** letters.',
  '',
].join('\n');
/** 10 words, 48 characters (39 without the 9 spaces), 1 sentence, 1 paragraph. */
export const LETTER_BODY = 'Dear Anna, I am writing to you from the harbour.\n';
/** 18 words, 86 characters (71 without spaces), 4 sentences, 2 paragraphs. */
export const NIGHT_BODY = ['# פרק ראשון', '', 'שלום לך אחותי היקרה. מה שלומך? אני כותבת לך מן הנמל!', '', 'הלילה היה חשוך, והים שקט.', ''].join('\n');
/** 4 words, 21 characters (18 without the 3 spaces), 1 sentence, 1 paragraph. */
export const CLOSING_BODY = 'The end came quietly.\n';

/** A scene's vault path in the novel. */
export function inNovel(path: string): string {
  return `Novel/${path}`;
}

/**
 * A vault with a small novel in it:
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
    },
    body: INDEX_BODY,
  });
  vault.seed(inNovel(OPENING), { frontmatter: { synopsis: 'Anna arrives in the old town.', status: 'Draft', order: 1024 }, body: OPENING_BODY });
  vault.seed(inNovel(LETTER), { frontmatter: { order: 2048 }, body: LETTER_BODY });
  vault.seed(inNovel(NIGHT), { frontmatter: { order: 3072 }, body: NIGHT_BODY });
  vault.seed(inNovel(CLOSING), { body: CLOSING_BODY });
  vault.seed('Novel/Research/Harbours.md', { body: 'Notes on harbours. Not part of the manuscript.\n' });
  vault.seed('Notes/Plain.md', { body: 'Not part of any project.' });
  return vault;
}

/** A vault with a manuscript of many short scenes, "Scene 1" to "Scene n", each of three words. */
export function longVault(scenes: number): MemoryVault {
  const vault = new MemoryVault();
  const names = Array.from({ length: scenes }, (_, at) => `Scene ${at + 1}`);
  vault.seed(NOVEL_INDEX, {
    frontmatter: { spellbook: 'project', version: 1, title: 'A Long Novel', binder: names.map((name) => `Manuscript/${name}.md`) },
    body: INDEX_BODY,
  });
  for (const name of names) vault.seed(`Novel/Manuscript/${name}.md`, { body: 'One more scene.\n' });
  return vault;
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
  features: RegisteredFeatures;
  command(id: string): StubCommand;
  /** The writer brings a note to the front (or none). */
  front(path: string | null): void;
  /** What Obsidian does when the plugin is switched off. */
  switchOff(): void;
}

export interface WireOptions {
  /** The project to open before the feature is registered; null for none. Default: the novel. */
  open?: string | null;
  /** The note that is in front when the feature is registered. Default: none. */
  front?: string | null;
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

  const fake = new FakeObsidian();
  const workspace = fake.workspace;
  const plugin = new StubPlugin(fake.app, { id: 'spellbook-novel-writer' });
  const storage = options.storage ?? new MemoryDeviceStorage();
  const wordCounts = new WordCountCache({ vault, setTimer: timers.set });

  const files = new Map<string, StubFile>();
  const front = (path: string | null): void => {
    if (path === null) {
      workspace.setActiveFile(null);
      return;
    }
    let file = files.get(path);
    if (!file) {
      file = new StubFile();
      file.path = path;
      files.set(path, file);
    }
    workspace.setActiveFile(file as unknown as TFile);
  };
  if (options.front !== undefined) front(options.front);

  // The report alone, so that what these tests count (notes read, commands,
  // buttons) is its own; the whole list is registered in tests/features.test.ts.
  const features = registerFeatures([reportFeature], {
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
    openNote: async () => false,
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
  return { vault, store, timers, workspace, plugin, storage, features, command, front, switchOff };
}

/** Let what is ready to run, run: the store's queue and the notes being read. No timer is hurried. */
export async function breathe(stage: Pick<Wired, 'store'>): Promise<void> {
  for (let turn = 0; turn < 4; turn++) {
    await settle(stage.store);
    await tick();
  }
}

/** Let everything come to rest: also the moments the report gives the screen between two goes of reading. */
export async function calm(stage: Pick<Wired, 'store' | 'timers'>): Promise<void> {
  for (let turn = 0; turn < 40; turn++) {
    await settle(stage.store);
    await tick();
    if (stage.timers.pending === 0) return;
    stage.timers.advance(0);
  }
}

// ------------------------------------------------------------------- reading

export interface OpenPane {
  leaf: FakeLeaf;
  view: ReportView;
  pane: FakeElement;
}

/** The pane that "Open writing report" opened, or a failed test. */
export function paneOf(stage: Wired): OpenPane {
  const leaf = stage.workspace.getLeavesOfType(REPORT_VIEW_TYPE)[0];
  const view = leaf?.view as unknown as (ReportView & { contentEl: FakeElement }) | null | undefined;
  if (!leaf || !view) throw new Error('"Open writing report" opened no pane');
  return { leaf, view, pane: view.contentEl };
}

/** Run "Open writing report" and let the figures be worked out. */
export async function openReport(stage: Wired): Promise<OpenPane> {
  stage.command('open-writing-report').callback?.();
  await calm(stage);
  return paneOf(stage);
}

/** The one element with a class, or a failed test. */
export function one(root: FakeElement, cls: string): FakeElement {
  const found = root.withClass(cls);
  if (found.length !== 1) throw new Error(`expected one ".${cls}", found ${found.length}`);
  return found[0] as FakeElement;
}

/** What a tile says: its figure. */
export function figure(pane: FakeElement, id: string): string {
  return one(one(pane, `spellbook-report-tile-${id}`), 'spellbook-report-tile-value').text;
}

/** The five figures that are counted, as the tiles show them. */
export function counts(pane: FakeElement): Record<string, string> {
  return {
    words: figure(pane, 'words'),
    characters: figure(pane, 'characters'),
    charactersNoSpaces: figure(pane, 'characters-no-spaces'),
    sentences: figure(pane, 'sentences'),
    paragraphs: figure(pane, 'paragraphs'),
  };
}

/** The line that says a tile's figure was worked out how; empty when it has none. */
export function noteOf(pane: FakeElement, id: string): string {
  return one(pane, `spellbook-report-tile-${id}`).withClass('spellbook-report-tile-note')[0]?.text ?? '';
}

/** What the pane says instead of figures, if it does. */
export function messageOf(pane: FakeElement): string {
  return pane.withClass('spellbook-report-message')[0]?.text ?? '';
}

/** What the line above the figures says: the reading, or that they are out of date. */
export function statusOf(pane: FakeElement): string {
  return one(pane, 'spellbook-report-status').fullText;
}

/** The most used words on show, each with how often it is used. */
export function wordsOf(pane: FakeElement): Array<[string, string]> {
  return pane
    .withClass('spellbook-report-word-row')
    .map((row) => [one(row, 'spellbook-report-word').text, one(row, 'spellbook-report-word-count').text]);
}

/** Press the scope button and hand back the menu it shows. */
export function scopeMenu(pane: FakeElement): StubMenu {
  one(pane, 'spellbook-report-scope').fire('click');
  const menu = StubMenu.shown[StubMenu.shown.length - 1];
  if (!menu) throw new Error('no menu was shown');
  return menu;
}

/** Choose a scope from the menu and let the figures be worked out. */
export async function choose(stage: Wired, pane: FakeElement, title: string): Promise<void> {
  scopeMenu(pane).item(title).click();
  await calm(stage);
}

export async function pressRefresh(stage: Wired, pane: FakeElement): Promise<void> {
  one(pane, 'spellbook-report-refresh').fire('click');
  await calm(stage);
}
