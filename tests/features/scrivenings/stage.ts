// A stage for testing scrivenings as it is plugged into the plugin: the real
// feature, registered through the registry, on a project store that sits on
// the tests' memory vault, with the shared stand-in plugin and the shared
// stand-in app and workspace (tests/obsidianStub.ts, tests/fakeObsidianApp.ts)
// as they are, and timers under the test's control. Nothing here is faked on
// the feature's own side: the host and the pane are the real ones.
//
// The stand-in screen lays nothing out: an element is as tall as a test says
// it is. So a scene's height is the pane's own guess from its word count
// until a test gives it a measured one.

import type { Plugin as ObsidianPlugin } from 'obsidian';
import type { ProjectStore } from '../../../src/core/projectStore';
import { WordCountCache } from '../../../src/core/wordCountCache';
import { registerFeatures } from '../../../src/features/registry';
import type { RegisteredFeatures } from '../../../src/features/registry';
import { scriveningsFeature } from '../../../src/features/scrivenings/index';
import { SCRIVENINGS_VIEW_TYPE } from '../../../src/features/scrivenings/scriveningsView';
import type { ScriveningsView } from '../../../src/features/scrivenings/scriveningsView';
import { FakeObsidian } from '../../fakeObsidianApp';
import type { FakeLeaf, FakeWorkspace } from '../../fakeObsidianApp';
import { ManualTimers, MemoryVault } from '../../memoryVault';
import { Menu as StubMenu, Plugin as StubPlugin } from '../../obsidianStub';
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

/** Three paragraphs: a heading, and two of text. With its three lines of properties, the heading is on line 5 of the note. */
export const OPENING_BODY = [
  '# Chapter One',
  '',
  'It was a dark night. The harbour was empty, and Anna walked alone.',
  '',
  '"Who is there?" she asked. **Nobody** answered!',
  '',
].join('\n');
export const LETTER_BODY = 'Dear Anna, I am writing to you from the harbour.\n';
export const NIGHT_BODY = ['# פרק ראשון', '', 'שלום לך אחותי היקרה. מה שלומך? אני כותבת לך מן הנמל!', '', 'הלילה היה חשוך, והים שקט.', ''].join('\n');
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

/** The name of a scene of the long novel, counted from 1. */
export function sceneName(number: number): string {
  return `Scene ${number}`;
}

/** A vault with a manuscript of many scenes, "Scene 1" to "Scene n", each of one paragraph of so many words. */
export function longVault(scenes: number, words = 300): MemoryVault {
  const vault = new MemoryVault();
  const names = Array.from({ length: scenes }, (_, at) => sceneName(at + 1));
  vault.seed(NOVEL_INDEX, {
    frontmatter: { spellbook: 'project', version: 1, title: 'A Long Novel', binder: names.map((name) => `Manuscript/${name}.md`) },
    body: INDEX_BODY,
  });
  for (const name of names) {
    const text = Array.from({ length: words }, (_, at) => (at === 0 ? name.replace(' ', '') : 'word')).join(' ');
    vault.seed(`Novel/Manuscript/${name}.md`, { body: `${text}\n` });
  }
  return vault;
}

// ----------------------------------------------------------------- the stage

export interface Wired {
  vault: MemoryVault;
  store: ProjectStore;
  timers: ManualTimers;
  fake: FakeObsidian;
  workspace: FakeWorkspace;
  /** The stand-in plugin: what the feature registered is read from it. */
  plugin: StubPlugin;
  storage: MemoryDeviceStorage;
  wordCounts: WordCountCache;
  features: RegisteredFeatures;
  /** Every note the feature asked to have opened, in order. */
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

  const fake = new FakeObsidian();
  const workspace = fake.workspace;
  const plugin = new StubPlugin(fake.app, { id: 'spellbook-novel-writer' });
  const storage = options.storage ?? new MemoryDeviceStorage();
  const wordCounts = new WordCountCache({ vault, setTimer: timers.set });
  wordCounts.start();
  const opened: Array<{ path: string; where: unknown }> = [];

  // Scrivenings alone, so that what these tests count is its own; the whole
  // list is registered in tests/features.test.ts.
  const features = registerFeatures([scriveningsFeature], {
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
      opened.push({ path, where: where ?? false });
      return vault.exists(path);
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
  return { vault, store, timers, fake, workspace, plugin, storage, wordCounts, features, opened, command, switchOff };
}

/**
 * Let everything come to rest: the store's queue, the notes being read and
 * counted, and frame after frame of the pane drawing its scenes one by one.
 */
export async function calm(stage: Pick<Wired, 'store' | 'timers'>): Promise<void> {
  for (let turn = 0; turn < 2000; turn++) {
    await settle(stage.store);
    await tick();
    if (stage.timers.pending === 0) return;
    stage.timers.advance(20);
  }
  throw new Error('the stage never came to rest');
}

// ------------------------------------------------------------------- reading

export interface OpenPane {
  leaf: FakeLeaf;
  view: ScriveningsView;
  pane: FakeElement;
  scroller: FakeElement;
}

/** The pane that "Open scrivenings" opened, or a failed test. */
export function paneOf(stage: Wired): OpenPane {
  const leaf = stage.workspace.getLeavesOfType(SCRIVENINGS_VIEW_TYPE)[0];
  const view = leaf?.view as unknown as (ScriveningsView & { contentEl: FakeElement }) | null | undefined;
  if (!leaf || !view) throw new Error('"Open scrivenings" opened no pane');
  const pane = view.contentEl;
  return { leaf, view, pane, scroller: one(pane, 'spellbook-scrivenings-scroll') };
}

export interface ScreenSize {
  width?: number;
  height?: number;
}

/**
 * Run "Open scrivenings", put the pane on a screen of a size (the stand-in
 * lays nothing out, so a pane has no size until it is given one) and let the
 * scenes near the top be drawn.
 */
export async function openPane(stage: Wired, size: ScreenSize = {}): Promise<OpenPane> {
  stage.command('open-scrivenings').callback?.();
  // The pane is there once the command's own steps have run; no timer is hurried.
  for (let turn = 0; turn < 4 && stage.workspace.getLeavesOfType(SCRIVENINGS_VIEW_TYPE).length === 0; turn++) await tick();
  const open = paneOf(stage);
  resize(open, size);
  await calm(stage);
  return open;
}

/** Give the pane a size, as when it comes onto the screen or its window is resized. */
export function resize(open: OpenPane, size: ScreenSize): void {
  open.pane.clientWidth = size.width ?? 900;
  open.scroller.rect = { ...open.scroller.rect, height: size.height ?? 800 };
  open.view.onResize();
}

/** The writer scrolls the manuscript to a place. */
export async function scrollTo(stage: Wired, open: OpenPane, top: number): Promise<void> {
  open.scroller.scrollTop = top;
  open.scroller.dispatch('scroll');
  await calm(stage);
}

/** The one element with a class, or a failed test. */
export function one(root: FakeElement, cls: string): FakeElement {
  const found = root.withClass(cls);
  if (found.length !== 1) throw new Error(`expected one ".${cls}", found ${found.length}`);
  return found[0] as FakeElement;
}

/** The scenes on show, top to bottom. */
export function scenesOf(pane: FakeElement): FakeElement[] {
  return one(pane, 'spellbook-scrivenings-list').children.filter((child) => child.hasClass('spellbook-scrivenings-scene'));
}

export function titleOf(scene: FakeElement): string {
  return one(scene, 'spellbook-scrivenings-title').text;
}

export function titlesOf(pane: FakeElement): string[] {
  return scenesOf(pane).map(titleOf);
}

/** The scene with a title, or a failed test. */
export function sceneCalled(pane: FakeElement, title: string): FakeElement {
  const found = scenesOf(pane).filter((scene) => titleOf(scene) === title);
  if (found.length !== 1) throw new Error(`expected one scene called "${title}", found ${found.length}`);
  return found[0] as FakeElement;
}

/** The text of a scene that is on show (not one that is still being drawn). */
export function textElOf(scene: FakeElement): FakeElement {
  const shown = scene.withClass('spellbook-scrivenings-text').filter((el) => !el.hasClass('spellbook-scrivenings-pending'));
  if (shown.length !== 1) throw new Error(`expected one text on show, found ${shown.length}`);
  return shown[0] as FakeElement;
}

/** What a scene's text says, paragraph by paragraph. Empty when the scene is only room. */
export function paragraphsOf(scene: FakeElement): string[] {
  return textElOf(scene).children.map((child) => child.fullText);
}

/** Whether a scene is empty room: its text is not on the page. */
export function isRoom(scene: FakeElement): boolean {
  return scene.hasClass('spellbook-scrivenings-is-room');
}

/** The titles of the scenes whose text is on the page. */
export function drawnTitles(pane: FakeElement): string[] {
  return scenesOf(pane)
    .filter((scene) => !isRoom(scene))
    .map(titleOf);
}

/** The height a scene is given while it is room, in pixels; null when it takes its own. */
export function roomOf(scene: FakeElement): number | null {
  const height = scene.style['height'];
  return height === undefined || height === '' ? null : Number.parseFloat(height);
}

export function countOf(scene: FakeElement): string {
  return one(scene, 'spellbook-scrivenings-count').text;
}

export function summaryOf(pane: FakeElement): string {
  return one(pane, 'spellbook-scrivenings-summary').text;
}

/** What the pane says instead of scenes, if it does. */
export function messageOf(pane: FakeElement): string {
  const root = one(pane, 'spellbook-scrivenings');
  return root.hasClass('spellbook-scrivenings-is-empty') ? one(pane, 'spellbook-scrivenings-message').text : '';
}

/** Press the scope button and hand back the menu it shows. */
export function scopeMenu(pane: FakeElement): StubMenu {
  one(pane, 'spellbook-scrivenings-scope').fire('click');
  const menu = StubMenu.shown[StubMenu.shown.length - 1];
  if (!menu) throw new Error('no menu was shown');
  return menu;
}

/** Choose a scope from the menu and let its scenes be drawn. */
export async function choose(stage: Wired, pane: FakeElement, title: string): Promise<void> {
  scopeMenu(pane).item(title).click();
  await calm(stage);
}
