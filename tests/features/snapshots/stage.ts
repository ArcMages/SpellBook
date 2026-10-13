// A stage for testing the snapshots as they are plugged into the plugin: the
// real feature, registered through the registry, on a project store that
// sits on the tests' memory vault, with the shared stand-in plugin, app and
// workspace as they are, and the clock and the timers under the test's
// control. Nothing here is faked on the feature's own side.

import type { Plugin as ObsidianPlugin, TFile } from 'obsidian';
import type { ProjectStore } from '../../../src/core/projectStore';
import type { Frontmatter } from '../../../src/core/types';
import { WordCountCache } from '../../../src/core/wordCountCache';
import { registerFeatures } from '../../../src/features/registry';
import type { RegisteredFeatures } from '../../../src/features/registry';
import { SNAPSHOTS_VIEW_TYPE, snapshotsFeature } from '../../../src/features/snapshots/index';
import type { SnapshotsView } from '../../../src/features/snapshots/index';
import { FakeObsidian } from '../../fakeObsidianApp';
import type { FakeLeaf, FakeWorkspace } from '../../fakeObsidianApp';
import { ManualTimers, MemoryVault } from '../../memoryVault';
import { Modal as StubModal, Plugin as StubPlugin, TFile as StubFile } from '../../obsidianStub';
import type { ButtonComponent, FakeElement, StubCommand } from '../../obsidianStub';
import { INDEX_BODY, MemoryDeviceStorage, makeStore, settle, tick } from '../../storeHarness';

export const NOVEL_INDEX = 'Novel/Novel.md';
/** "Night at the harbour": a scene with a Hebrew title. */
export const NIGHT_TITLE = 'לילה בנמל';
export const OPENING = 'Manuscript/Opening.md';
export const NIGHT = `Manuscript/${NIGHT_TITLE}.md`;
export const CLOSING = 'Manuscript/Closing.md';

export const OPENING_BODY = ['# Chapter One', '', 'It was a dark night. The harbour was empty, and Anna walked alone.', '', '"Who is there?" she asked. Nobody answered!', ''].join('\n');
export const NIGHT_BODY = ['# פרק ראשון', '', 'שלום לך אחותי היקרה. מה שלומך? אני כותבת לך מן הנמל!', '', 'הלילה היה חשוך, והים שקט.', ''].join('\n');
export const CLOSING_BODY = 'The end came quietly.\n';
export const OPENING_PROPERTIES: Frontmatter = { synopsis: 'Anna arrives in the old town.', status: 'First draft', label: 'Blue', order: 1024 };

/** 12:30:05 on some day, in milliseconds; the tests move the clock on from here. */
export const NOON = Date.UTC(2026, 9, 13, 12, 30, 5);

export function inNovel(path: string): string {
  return `Novel/${path}`;
}

/** A vault with a small novel: Opening, a Hebrew scene, Closing; a research note, a to-do list and a note outside. */
export function novelVault(): MemoryVault {
  const vault = new MemoryVault();
  vault.seed(NOVEL_INDEX, {
    frontmatter: { spellbook: 'project', version: 1, title: 'My Novel', binder: [OPENING, { folder: 'Part one', id: 'f-one', children: [NIGHT] }, CLOSING] },
    body: INDEX_BODY,
  });
  vault.seed(inNovel(OPENING), { frontmatter: { ...OPENING_PROPERTIES }, body: OPENING_BODY });
  vault.seed(inNovel(NIGHT), { frontmatter: { order: 2048 }, body: NIGHT_BODY });
  vault.seed(inNovel(CLOSING), { body: CLOSING_BODY });
  vault.seed('Novel/Research/Harbours.md', { body: 'Notes on harbours.\n' });
  vault.seed('Novel/To-do.md', { body: '- [ ] one\n' });
  vault.seed('Notes/Plain.md', { body: 'Not part of any project.' });
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
  /** The clock the feature reads: move it on by setting these. */
  clock: { now: number; today: string };
  command(id: string): StubCommand;
  /** The writer brings a note to the front (or none). */
  front(path: string | null): void;
  switchOff(): void;
}

export interface WireOptions {
  open?: string | null;
  front?: string | null;
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
  vault.reads.readFrontmatter = 0;
  vault.reads.readText = 0;

  const fake = new FakeObsidian();
  const workspace = fake.workspace;
  const plugin = new StubPlugin(fake.app, { id: 'spellbook-novel-writer' });
  const storage = options.storage ?? new MemoryDeviceStorage();
  const wordCounts = new WordCountCache({ vault, setTimer: timers.set });
  const clock = { now: NOON, today: '2026-10-13' };

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

  const features = registerFeatures([snapshotsFeature], {
    plugin: plugin as unknown as ObsidianPlugin,
    app: fake.app,
    store,
    vault,
    storage,
    deviceId: () => 'testdevice',
    clock: {
      today: () => clock.today,
      now: () => clock.now,
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
    features.release();
    plugin.unload();
    wordCounts.dispose();
    store.dispose();
  };
  return { vault, store, timers, workspace, plugin, storage, features, clock, command, front, switchOff };
}

/** Let everything come to rest: the store's queue, what is being read, and the pauses the pane takes. */
export async function calm(stage: Pick<Wired, 'store' | 'timers'>): Promise<void> {
  for (let turn = 0; turn < 14; turn++) {
    await settle(stage.store);
    await tick();
    stage.timers.advance(0);
  }
  await settle(stage.store);
  await tick();
}

// ------------------------------------------------------------------ windows

export function lastWindow(): StubModal {
  const modal = StubModal.opened[StubModal.opened.length - 1];
  if (!modal?.isOpen) throw new Error('no window is open');
  return modal;
}

/** The button of a window with this text. */
export function windowButton(modal: StubModal, text: string): ButtonComponent {
  for (const row of modal.contentEl.settings) {
    for (const component of row.components) {
      const button = component as ButtonComponent;
      if (button.buttonEl?.text === text) return button;
    }
  }
  throw new Error(`the window has no button "${text}"`);
}

/** Run "Take snapshot", type a name (or none) and confirm. */
export async function takeSnapshot(stage: Wired, name = ''): Promise<void> {
  stage.command('take-snapshot').callback?.();
  const modal = lastWindow();
  const input = modal.contentEl.withClass('spellbook-prompt-input')[0] as FakeElement;
  input.value = name;
  windowButton(modal, 'Take snapshot').click();
  await calm(stage);
  stage.clock.now += 60_000;
}

// --------------------------------------------------------------------- pane

export interface OpenPane {
  leaf: FakeLeaf;
  view: SnapshotsView;
  pane: FakeElement;
}

export function paneOf(stage: Wired): OpenPane {
  const leaf = stage.workspace.getLeavesOfType(SNAPSHOTS_VIEW_TYPE)[0];
  const view = leaf?.view as unknown as (SnapshotsView & { contentEl: FakeElement }) | null | undefined;
  if (!leaf || !view) throw new Error('"Snapshots of this scene" opened no pane');
  return { leaf, view, pane: view.contentEl };
}

export async function openSnapshots(stage: Wired): Promise<OpenPane> {
  stage.command('open-snapshots').callback?.();
  await calm(stage);
  return paneOf(stage);
}

export function one(root: FakeElement, cls: string): FakeElement {
  const found = root.withClass(cls);
  if (found.length !== 1) throw new Error(`expected one ".${cls}", found ${found.length}`);
  return found[0] as FakeElement;
}

/** The rows of the list, as the writer reads them. */
export function rowsOf(pane: FakeElement): Array<{ name: string; date: string; words: string; change: string; el: FakeElement }> {
  return pane.withClass('spellbook-snapshots-row').map((el) => ({
    name: one(el, 'spellbook-snapshots-name').text,
    date: el.withClass('spellbook-snapshots-date')[0]?.text ?? '',
    words: el.withClass('spellbook-snapshots-words')[0]?.text ?? '',
    change: one(el, 'spellbook-snapshots-change').text,
    el,
  }));
}

/** Press a button of a row (or of the bar above a snapshot), by its class, and let things come to rest. */
export async function press(stage: Wired, root: FakeElement, cls: string): Promise<void> {
  const button = root.withClass(cls)[0];
  if (!button) throw new Error(`no ".${cls}" to press`);
  button.fire('click');
  await calm(stage);
}

/** The snapshot notes on disk, as vault paths, sorted. */
export function snapshotPaths(vault: MemoryVault): string[] {
  return vault.paths().filter((path) => path.startsWith('Novel/Snapshots/')).sort();
}

/** What the comparison shows, cell by cell: "[sign] text", with what was added as {+..} and what was removed as [-..]. */
export function cellsOf(pane: FakeElement): string[][] {
  return pane
    .withClass('spellbook-snapshots-pair')
    .filter((pair) => !pair.hasClass('spellbook-snapshots-heads'))
    .map((pair) =>
      pair.withClass('spellbook-snapshots-cell').map((cell) => {
        if (cell.hasClass('is-empty')) return '';
        const sign = one(cell, 'spellbook-snapshots-sign').text;
        const text = one(cell, 'spellbook-snapshots-para')
          .children.map((piece) => (piece.tag === 'ins' ? `{+${piece.text}}` : piece.tag === 'del' ? `[-${piece.text}]` : piece.text))
          .join('');
        return `${sign === '' ? '' : `${sign} `}${text}`;
      }),
    );
}
