// A stage for testing the plot grid as it is plugged into the plugin: the
// real feature, registered through the registry, on a project store that sits
// on the tests' memory vault, with the shared stand-in plugin, app and
// workspace, and timers under the test's control. Nothing on the feature's
// own side is faked.

import type { Plugin as ObsidianPlugin } from 'obsidian';
import type { ProjectStore } from '../../../src/core/projectStore';
import { WordCountCache } from '../../../src/core/wordCountCache';
import { plotGridFeature } from '../../../src/features/plotgrid/index';
import { PLOT_GRID_VIEW_TYPE } from '../../../src/features/plotgrid/plotGridView';
import type { PlotGridView } from '../../../src/features/plotgrid/plotGridView';
import { registerFeatures } from '../../../src/features/registry';
import type { RegisteredFeatures } from '../../../src/features/registry';
import { FakeObsidian } from '../../fakeObsidianApp';
import type { FakeLeaf, FakeWorkspace } from '../../fakeObsidianApp';
import { ManualTimers, MemoryVault } from '../../memoryVault';
import { Menu as StubMenu, Plugin as StubPlugin } from '../../obsidianStub';
import type { FakeElement, StubCommand } from '../../obsidianStub';
import { INDEX_BODY, MemoryDeviceStorage, TODAY, makeStore, settle, tick } from '../../storeHarness';

export const NOVEL_INDEX = 'Novel/Novel.md';
export const SECOND_INDEX = 'Second/Second.md';

/** "Revenge": a lane with a Hebrew name. */
export const REVENGE = 'נקמה';
/** "Daniel": a label with a Hebrew name. */
export const DANIEL = 'דניאל';
/** "Night at the harbour": a scene with a Hebrew title. */
export const NIGHT_TITLE = 'לילה בנמל';
/** "A letter arrives at night." */
export const NIGHT_SYNOPSIS = 'מכתב מגיע בלילה.';
/** "Yosef": a character with a Hebrew name. */
export const YOSEF = 'יוסף';
export const MAIN = 'Main plot';

export const OPENING = 'Manuscript/Opening.md';
export const LETTER = 'Manuscript/The Letter.md';
export const NIGHT = `Manuscript/${NIGHT_TITLE}.md`;
export const MIDDLE = 'Manuscript/Middle.md';
export const GHOST = 'Manuscript/Ghost.md';
export const CLOSING = 'Manuscript/Closing.md';

export const MARA_PATH = 'World/Characters/Mara.md';
export const YOSEF_PATH = `World/Characters/${YOSEF}.md`;
export const HARBOUR_PATH = 'World/Places/Harbour.md';

export function inNovel(path: string): string {
  return `Novel/${path}`;
}

/**
 *   Opening         Main plot, Anna, Mara
 *   Part one        [f-one]
 *     The Letter    Revenge (and a lane the project does not list), Daniel
 *     (Hebrew)      Yosef
 *   Middle
 *   Ghost           (missing)
 *   Closing         Main plot
 */
export function novelVault(): MemoryVault {
  const vault = new MemoryVault();
  vault.seed(NOVEL_INDEX, {
    frontmatter: {
      spellbook: 'project',
      version: 1,
      title: 'My Novel',
      binder: [OPENING, { folder: 'Part one', id: 'f-one', children: [LETTER, NIGHT] }, MIDDLE, GHOST, CLOSING],
      labels: [
        { name: 'Anna', color: 'purple' },
        { name: DANIEL, color: 'cyan' },
      ],
      timelines: [
        { name: MAIN, color: 'purple' },
        { name: REVENGE, color: 'red' },
      ],
    },
    body: INDEX_BODY,
  });
  vault.seed(inNovel(OPENING), {
    frontmatter: { synopsis: 'Anna arrives in the old town.', label: 'Anna', timelines: [MAIN], entities: ['[[Mara]]'], order: 1024 },
    body: 'It was a dark night.\n',
  });
  vault.seed(inNovel(LETTER), { frontmatter: { label: DANIEL, timelines: [REVENGE, 'Unknown lane'], order: 2048 }, body: 'Dear Anna.\n' });
  vault.seed(inNovel(NIGHT), { frontmatter: { synopsis: NIGHT_SYNOPSIS, entities: [`[[${YOSEF}]]`], order: 3072 }, body: 'שלום.\n' });
  vault.seed(inNovel(MIDDLE), { frontmatter: { order: 4096 }, body: 'Nothing happens.\n' });
  vault.seed(inNovel(CLOSING), { frontmatter: { date: '1923-04-12', timelines: MAIN, order: 5120 }, body: 'The end.\n' });
  vault.seed(inNovel(MARA_PATH), { frontmatter: { type: 'character', summary: 'Keeps the light.' }, body: '' });
  vault.seed(inNovel(YOSEF_PATH), { frontmatter: { type: 'character' }, body: '' });
  vault.seed(inNovel(HARBOUR_PATH), { frontmatter: { type: 'place' }, body: '' });

  vault.seed(SECOND_INDEX, {
    frontmatter: { spellbook: 'project', version: 1, title: 'Second Book', binder: ['Manuscript/Prologue.md'] },
    body: INDEX_BODY,
  });
  vault.seed('Second/Manuscript/Prologue.md', { frontmatter: {}, body: 'Long ago.\n' });
  return vault;
}

export interface Wired {
  vault: MemoryVault;
  store: ProjectStore;
  timers: ManualTimers;
  workspace: FakeWorkspace;
  plugin: StubPlugin;
  storage: MemoryDeviceStorage;
  features: RegisteredFeatures;
  opened: Array<{ path: string; where: unknown }>;
  command(id: string): StubCommand;
  switchOff(): void;
}

export interface WireOptions {
  open?: string | null;
  storage?: MemoryDeviceStorage;
}

export async function wire(vault: MemoryVault = novelVault(), options: WireOptions = {}): Promise<Wired> {
  const { store, timers } = makeStore(vault);
  const indexPath = options.open === undefined ? NOVEL_INDEX : options.open;
  if (indexPath !== null) {
    const opened = await store.openProject(indexPath);
    if (opened.status !== 'done') throw new Error(`could not open the project: ${JSON.stringify(opened)}`);
  }
  vault.clearWrites();

  const fake = new FakeObsidian();
  const workspace = fake.workspace;
  const plugin = new StubPlugin(fake.app, { id: 'spellbook-novel-writer' });
  const storage = options.storage ?? new MemoryDeviceStorage();
  const wordCounts = new WordCountCache({ vault, setTimer: timers.set });
  const opened: Wired['opened'] = [];
  const features = registerFeatures([plotGridFeature], {
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
      return vault.has(path);
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
  return { vault, store, timers, workspace, plugin, storage, features, opened, command, switchOff };
}

/** Let everything come to rest: the store's queue, and whatever the host put off for a moment. */
export async function calm(stage: Pick<Wired, 'store' | 'timers'>): Promise<void> {
  for (let turn = 0; turn < 8; turn++) {
    await settle(stage.store);
    await tick();
    stage.timers.advance(0);
  }
}

export interface OpenPane {
  leaf: FakeLeaf;
  view: PlotGridView;
  pane: FakeElement;
}

/** Run "Open plot grid" and let the grid fill. */
export async function openGrid(stage: Wired): Promise<OpenPane> {
  stage.command('open-plot-grid').callback?.();
  await calm(stage);
  const leaf = stage.workspace.getLeavesOfType(PLOT_GRID_VIEW_TYPE)[0];
  const view = leaf?.view as unknown as (PlotGridView & { contentEl: FakeElement }) | null | undefined;
  if (!leaf || !view) throw new Error('"Open plot grid" opened no pane');
  return { leaf, view, pane: view.contentEl };
}

export function one(root: FakeElement, cls: string): FakeElement {
  const found = root.withClass(cls);
  if (found.length !== 1) throw new Error(`expected one ".${cls}", found ${found.length}`);
  return found[0] as FakeElement;
}

/** The headers of the plot columns, in order. */
export function headersOf(pane: FakeElement): string[] {
  return pane.withClass('spellbook-plotgrid-head-name').map((name) => name.text);
}

/** The count above each column. */
export function countsOf(pane: FakeElement): string[] {
  return pane.withClass('spellbook-plotgrid-head-count').map((count) => count.text);
}

/** The names of the rows, top to bottom: a folder's in brackets. */
export function rowNames(pane: FakeElement): string[] {
  return pane.withClass('spellbook-plotgrid-row').map((row) => {
    const folder = row.withClass('spellbook-plotgrid-folder-name')[0];
    return folder ? `[${folder.text}]` : (row.withClass('spellbook-plotgrid-title')[0]?.text ?? '');
  });
}

export function sceneRow(pane: FakeElement, title: string): FakeElement {
  const found = pane.withClass('spellbook-plotgrid-scene').filter((row) => row.withClass('spellbook-plotgrid-title')[0]?.text === title);
  if (found.length !== 1) throw new Error(`expected one row "${title}", found ${found.length}`);
  return found[0] as FakeElement;
}

/** The tappable mark of a scene's cell in a column. */
export function markOf(pane: FakeElement, title: string, column: string): FakeElement {
  const at = headersOf(pane).indexOf(column);
  if (at < 0) throw new Error(`no column "${column}"`);
  const cells = sceneRow(pane, title).withClass('spellbook-plotgrid-cell');
  const mark = cells[at]?.withClass('spellbook-plotgrid-mark')[0];
  if (!mark) throw new Error(`no cell "${title}" / "${column}"`);
  return mark;
}

/** Which columns each scene is in, as a picture: "x" for a filled cell, "." for an empty one. */
export function pictureOf(pane: FakeElement): Record<string, string> {
  const picture: Record<string, string> = {};
  for (const row of pane.withClass('spellbook-plotgrid-scene')) {
    const title = row.withClass('spellbook-plotgrid-title')[0]?.text ?? '';
    picture[title] = row
      .withClass('spellbook-plotgrid-mark')
      .map((mark) => (mark.hasClass('spellbook-plotgrid-filled') ? 'x' : '.'))
      .join('');
  }
  return picture;
}

export function lastMenu(): StubMenu {
  const menu = StubMenu.shown[StubMenu.shown.length - 1];
  if (!menu) throw new Error('no menu was shown');
  return menu;
}
