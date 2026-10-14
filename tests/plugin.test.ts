// The plugin entry point, its two commands and its settings page, run against
// the imitation of the Obsidian app (tests/fakeObsidianApp.ts). These tests
// check the plugin's own behaviour from command to notes; they cannot prove
// how the real app behaves or looks.

import { getFrontMatterInfo } from 'obsidian';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ACTIVE_PROJECT_KEY } from '../src/core/devicePrefs';
import { ProjectStore } from '../src/core/projectStore';
import type { SettingsSection } from '../src/features/registry';
import { SNAPSHOTS_SERVICE, SNAPSHOTS_VIEW_TYPE } from '../src/features/snapshots';
import { TAKE_TITLE } from '../src/features/snapshots/snapshotsView';
import SpellbookPlugin from '../src/main';
import { openNote } from '../src/obsidian/openNote';
import { SpellbookSettingTab } from '../src/settings';
import { ConfirmModal } from '../src/ui/confirmModal';
import { CreateProjectModal } from '../src/ui/createProjectModal';
import { FolderPickerModal } from '../src/ui/folderPickerModal';
import { TextPromptModal } from '../src/ui/textPromptModal';
import { SNAPSHOT_ACTIONS } from '../src/views/binderActions';
import { BinderView } from '../src/views/binderView';
import {
  carry,
  countOf,
  heading,
  inRow,
  layOut,
  letGo,
  moreOf,
  one,
  picture,
  press,
  rowOf,
  selectedTitle,
  tap,
  toolbarButton,
  toolbarLabels,
} from './binderScreen';
import { FakeObsidian, note } from './fakeObsidianApp';
import type { FakeLeaf } from './fakeObsidianApp';
import {
  Menu as StubMenu,
  Modal as StubModal,
  Notice as StubNotice,
  Platform as StubPlatform,
  fakeDocument,
  fakeWindow,
  resetFakeDocument,
  resetPlatform,
} from './obsidianStub';
import type {
  ButtonComponent,
  DropdownComponent,
  FakeElement,
  Plugin as StubPlugin,
  StubCommand,
  TextComponent,
} from './obsidianStub';

const MANIFEST = { id: 'spellbook-novel-writer', name: 'Spellbook', version: '0.1.0' };
const INDEX = { spellbook: 'project', version: 1, title: 'My Novel', binder: ['Manuscript/Opening.md'] };

function novelVault(): FakeObsidian {
  const fake = new FakeObsidian();
  fake.addNote('Novel/Novel.md', note(INDEX, 'Index text.'));
  fake.addNote('Novel/Manuscript/Opening.md', note({ status: 'To do', order: 1024 }, 'It was a dark night.\n'));
  fake.addNote('Notes/Plain.md', 'No properties here.');
  fake.addFolder('Writing/Drafts');
  return fake;
}

interface Loaded {
  fake: FakeObsidian;
  plugin: SpellbookPlugin;
  stub: StubPlugin;
  command: (id: string) => StubCommand;
}

/** Every plugin a test loaded, so that it can be switched off when the test is over. */
const loadedPlugins: SpellbookPlugin[] = [];

/** The plugin, loaded the way Obsidian loads it. The app is still starting up. */
function load(fake: FakeObsidian = new FakeObsidian()): Loaded {
  const plugin = new SpellbookPlugin(fake.app, MANIFEST as never);
  loadedPlugins.push(plugin);
  plugin.onload();
  const stub = plugin as unknown as StubPlugin;
  const command = (id: string): StubCommand => {
    const found = stub.commands.find((candidate) => candidate.id === id);
    if (!found) throw new Error(`no command "${id}"`);
    return found;
  };
  return { fake, plugin, stub, command };
}

/** The plugin, loaded, with Obsidian's start-up finished. */
function loadReady(fake: FakeObsidian = new FakeObsidian()): Loaded {
  const loaded = load(fake);
  fake.finishStartup();
  return loaded;
}

function storeOf(plugin: SpellbookPlugin): ProjectStore {
  if (!plugin.store) throw new Error('the store has not been created');
  return plugin.store;
}

const notices = (): string[] => StubNotice.shown.map((notice) => notice.message);

/** Wait for something the plugin does in the background. */
async function until(check: () => boolean, what: string): Promise<void> {
  for (let attempt = 0; attempt < 500; attempt++) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error(`timed out waiting for ${what}`);
}

function notesUnder(fake: FakeObsidian, folder: string): string[] {
  return fake.vault
    .getMarkdownFiles()
    .map((file) => file.path)
    .filter((path) => path.startsWith(`${folder}/`))
    .sort();
}

beforeEach(() => {
  StubNotice.shown.length = 0;
  StubModal.opened.length = 0;
  StubMenu.shown.length = 0;
  resetFakeDocument();
});

afterEach(() => {
  // Switched off, the plugin cancels its timers; nothing runs on into the next test.
  for (const plugin of loadedPlugins.splice(0)) plugin.unload();
  resetPlatform();
});

describe('loading and unloading', () => {
  it('registers the settings page, the commands, the binder and its ribbon button straight away', () => {
    const { stub } = load();
    expect(stub.settingTabs).toHaveLength(1);
    expect(stub.settingTabs[0]).toBeInstanceOf(SpellbookSettingTab);
    // Obsidian puts "Spellbook: " in front of the names itself.
    expect(stub.commands.map((command) => [command.id, command.name])).toEqual([
      ['create-project', 'Create project'],
      ['create-sample-project', 'Create sample project'],
      ['open-binder', 'Open binder'],
      ['new-scene', 'New scene'],
      ['new-folder', 'New folder'],
      ['move-scene-up', 'Move scene up'],
      ['move-scene-down', 'Move scene down'],
      ['reveal-active-scene', 'Reveal active scene in binder'],
    ]);
    expect(stub.viewTypes).toEqual(['spellbook-binder']);
    expect(stub.ribbonIcons.map((icon) => [icon.icon, icon.title, icon.shown])).toEqual([
      ['book-open', 'Open Spellbook binder', true],
    ]);
  });

  it('waits for Obsidian to finish starting before it creates the store', () => {
    const { fake, plugin } = load(novelVault());
    expect(plugin.store).toBeNull();
    expect(fake.vault.listenerCount()).toBe(0);
    expect(fake.metadataCache.listenerCount()).toBe(0);

    fake.finishStartup();
    expect(plugin.store).toBeInstanceOf(ProjectStore);
    expect(storeOf(plugin).listProjects()).toEqual([{ indexPath: 'Novel/Novel.md', folder: 'Novel', title: 'My Novel' }]);
  });

  it('starts at once when Obsidian is already running (plugin switched on later)', () => {
    const fake = novelVault();
    fake.finishStartup();
    const { plugin } = load(fake);
    expect(storeOf(plugin).listProjects().map((p) => p.title)).toEqual(['My Novel']);
  });

  it('changes no note by loading, not even by opening the project', async () => {
    const fake = novelVault();
    const before = new Map(fake.vault.text);
    const { plugin } = loadReady(fake);
    // The vault's only project is opened, which only reads its index note.
    await until(() => storeOf(plugin).project !== null, 'the project to open');
    expect(storeOf(plugin).project?.title).toBe('My Novel');

    expect(fake.saves).toEqual([]);
    expect(fake.calls).toEqual([]);
    expect(new Map(fake.vault.text)).toEqual(before);
    expect(fake.workspace.opened).toEqual([]); // no note is shown by itself
    expect(fake.workspace.leaves).toEqual([]); // and no panel either
    expect(fake.localStorage.size).toBe(0); // nothing was chosen, so nothing is remembered
    expect(notices()).toEqual([]);
  });

  it('opens the project that was last chosen on this device', async () => {
    const fake = novelVault();
    fake.addNote('Second/Second.md', note({ spellbook: 'project', version: 1, title: 'Second Book', binder: [] }));
    fake.saveLocalStorage(ACTIVE_PROJECT_KEY, 'Second/Second.md');
    const { plugin } = loadReady(fake);
    await until(() => storeOf(plugin).project !== null, 'the project to open');
    expect(storeOf(plugin).project?.title).toBe('Second Book');
  });

  it('gives every vault listener to registerEvent and leaves none behind on unload', () => {
    const { fake, plugin, stub } = loadReady(novelVault());
    const attached = fake.vault.listenerCount() + fake.metadataCache.listenerCount();
    expect(attached).toBeGreaterThanOrEqual(5);
    expect(stub.registeredEvents.length).toBeGreaterThanOrEqual(attached);

    plugin.unload();
    expect(fake.vault.listenerCount()).toBe(0);
    expect(fake.metadataCache.listenerCount()).toBe(0);
    expect(plugin.store).toBeNull();
  });

  it('plugs the screens in once the store is ready, and lets go of them on unload', () => {
    const { fake, plugin, stub } = load(novelVault());
    expect(plugin.features).toBeNull(); // not before Obsidian has finished starting

    fake.finishStartup();
    expect(plugin.features?.ids).toEqual(['corkboard', 'progress', 'planner', 'timeline', 'outliner', 'schemes', 'modes', 'report', 'export', 'prose', 'scrivenings', 'snapshots', 'world', 'aihelper', 'plotgrid', 'welcome']);
    // Every screen's kind of pane is known to Obsidian, after the binder's own.
    expect(stub.viewTypes).toEqual([
      'spellbook-binder',
      'spellbook-corkboard',
      'spellbook-inspector',
      'spellbook-planner',
      'spellbook-timeline',
      'spellbook-outliner',
      'spellbook-report',
      'spellbook-scrivenings',
      'spellbook-snapshots',
      'spellbook-world',
      'spellbook-plotgrid',
      'spellbook-welcome',
      'spellbook-help',
    ]);
    // The outliner, the screen added last, has its command and its ribbon button.
    expect(stub.commands.map((command) => [command.id, command.name])).toContainEqual(['open-outliner', 'Open outliner']);
    expect(stub.ribbonIcons.map((icon) => [icon.icon, icon.title, icon.shown])).toContainEqual(['table', 'Open Spellbook outliner', true]);
    expect(new Set(stub.commands.map((command) => command.id)).size).toBe(stub.commands.length); // no two share an id
    // The writing progress is the one screen with settings of its own.
    expect(plugin.features?.settingsSections.map((section) => [section.id, section.title])).toEqual([
      ['progress', 'Writing progress'],
      ['schemes', 'Colour scheme'],
      ['modes', 'Writing modes'],
      ['report', 'Writing report'],
      ['prose', 'Prose checks'],
      ['snapshots', 'Snapshots'],
      ['plotgrid', 'Plot grid'],
      ['welcome', 'Welcome and help'],
    ]);
    // It watches the editor, has its place in the bottom bar, and listens to the workspace.
    expect(stub.editorExtensions).toHaveLength(1);
    expect(stub.statusBar.children).toHaveLength(1);
    expect(['file-open', 'layout-change', 'quit'].map((name) => fake.workspace.listenerCount(name))).toEqual([1, 1, 1]);
    // Plugging them in leaves no trace on the device: no id was made for it yet.
    expect(fake.localStorage.size).toBe(0);
    expect(fake.workspace.leaves).toEqual([]);

    const features = plugin.features;
    features?.services.provide('thing', 1);
    plugin.unload();
    expect(plugin.features).toBeNull();
    expect(features?.services.get('thing')).toBeUndefined();
    expect(features?.settingsSections).toEqual([]);
    expect(stub.editorExtensions).toEqual([]);
    expect(stub.statusBar.children).toEqual([]);
    expect(stub.domEventCount).toBe(0);
    expect(fake.workspace.listenerCount()).toBe(0);
  });

  it('never starts if it was unloaded before Obsidian finished starting', () => {
    const { fake, plugin } = load(novelVault());
    plugin.unload();
    fake.finishStartup();
    expect(plugin.store).toBeNull();
    expect(fake.vault.listenerCount()).toBe(0);
    expect(fake.metadataCache.listenerCount()).toBe(0);
  });

  it('answers a command politely while Obsidian is still starting', async () => {
    const { fake, plugin, command } = load();
    command('create-project').callback?.();
    command('create-sample-project').callback?.();
    expect(await plugin.createProject('Novel')).toBe(false);
    expect(notices()).toEqual(Array(3).fill('Spellbook is still starting. Try again in a moment.'));
    expect(StubModal.opened).toEqual([]);
    expect(fake.vault.getMarkdownFiles()).toEqual([]);
  });

  it('does nothing after it has been unloaded', async () => {
    const { fake, plugin } = loadReady();
    plugin.unload();
    expect(await plugin.createSampleProject()).toBe(false);
    expect(fake.vault.getMarkdownFiles()).toEqual([]);
  });
});

describe('the bottom bar', () => {
  const OPENING = 'Novel/Manuscript/Opening.md';

  it('shows the project total while the binder is closed, and keeps it when the binder opens and closes', async () => {
    const fake = novelVault();
    const { plugin, stub } = loadReady(fake);
    const bar = (): string => stub.statusBar.children[0]?.fullText ?? '';
    await until(() => bar().includes('Project 5'), 'the project total in the bottom bar');
    expect(fake.workspace.leaves).toEqual([]); // no binder, and no other pane, was opened for it
    expect(plugin.services?.wordCounts.askers()).toEqual(['progress']);

    await plugin.openBinder();
    const leaf = fake.workspace.getLeavesOfType('spellbook-binder')[0];
    await until(() => plugin.services?.wordCounts.askers().includes('binder') === true, 'the binder to ask for its counts');
    leaf?.detach();
    await until(() => plugin.services?.wordCounts.askers().includes('binder') === false, 'the binder to let go of its counts');

    // The binder took back its own request only: the scene is still counted, and the total still shown.
    expect(plugin.services?.wordCounts.askers()).toEqual(['progress']);
    expect(plugin.services?.wordCounts.get(OPENING)).toBe(5);
    await new Promise((resolve) => setTimeout(resolve, 20)); // a few frames
    expect(bar()).toContain('Project 5');
  });
});

describe('the command "Create sample project"', () => {
  it('creates the sample novel, opens it and shows its first scene', async () => {
    const { fake, plugin, stub, command } = loadReady(novelVault());
    const before = new Map(fake.vault.text);

    command('create-sample-project').callback?.();
    await until(() => fake.workspace.opened.length > 0, 'the first scene to open');
    // Its targets reach the bottom bar, with no binder open: the whole manuscript is counted against 80,000 words.
    await until(() => /Project [\d,]+ \/ 80,000/.test(stub.statusBar.children[0]?.fullText ?? ''), 'the project total against its target');
    expect(stub.statusBar.children[0]?.fullText).toMatch(/Today 0 \/ 1,000/);
    expect(fake.workspace.leaves).toEqual([]);

    // The index and the to-do list, 53 notes of the manuscript, 2 of research, the 10 events of the timeline
    // and the 18 notes of the world.
    expect(notesUnder(fake, 'Sample Novel')).toHaveLength(85);
    expect(notesUnder(fake, 'Sample Novel/World')).toHaveLength(18);
    expect(fake.textOf('Sample Novel/World/Characters/תמר.md')).toContain('"type": "character"');
    expect(notesUnder(fake, 'Sample Novel/Manuscript')).toHaveLength(53);
    expect(notesUnder(fake, 'Sample Novel/Timeline')).toHaveLength(10);
    expect(notesUnder(fake, 'Sample Novel/Stats')).toEqual([]); // no writing history is made up
    for (const sub of ['Manuscript', 'Timeline', 'Research', 'Stats']) {
      expect(fake.vault.getFolderByPath(`Sample Novel/${sub}`), sub).not.toBeNull();
    }
    expect(fake.workspace.opened).toEqual(['Sample Novel/Manuscript/Prologue.md']);

    const open = storeOf(plugin).project;
    expect(open).toMatchObject({ title: 'Sample Novel', readOnly: false, missing: [], unfiled: ['Manuscript/The Night Market.md'] });
    expect(open?.tree.filter((node) => node.kind === 'folder')).toHaveLength(5);
    expect(storeOf(plugin).listProjects().map((p) => p.title)).toEqual(['My Novel', 'Sample Novel']);

    // a scene note: properties first, then the text
    const letter = fake.textOf('Sample Novel/Manuscript/מכתב לאחותי.md');
    expect(letter.startsWith('---\n')).toBe(true);
    expect(letter).toContain('"label": "Noa"');
    expect(letter).toContain('אחותי היקרה');
    expect(fake.textOf('Sample Novel/To-do.md').split('\n').filter((line) => line.startsWith('- ['))).toHaveLength(3);

    // only safe doorways, nothing trashed, nothing that was already there changed
    expect(fake.calls).toEqual(['processFrontMatter Sample Novel/Sample Novel.md']);
    expect(fake.trashed).toEqual([]);
    for (const [path, text] of before) expect(fake.vault.text.get(path), path).toBe(text);
  });

  it('says what it is doing and what it did, in plain words', async () => {
    const { fake, command } = loadReady();
    command('create-sample-project').callback?.();
    await until(() => fake.workspace.opened.length > 0, 'the first scene to open');

    expect(notices()).toEqual(['Creating the sample project...', 'Created "Sample Novel" with 52 scenes.']);
    const progress = StubNotice.shown[0];
    expect(progress?.duration).toBe(0); // stays up until the work is done...
    expect(progress?.hidden).toBe(true); // ...and is then taken down
  });

  it('creates "Sample Novel 2" the second time', async () => {
    const { fake, plugin } = loadReady();
    expect(await plugin.createSampleProject()).toBe(true);
    expect(await plugin.createSampleProject()).toBe(true);

    expect(notesUnder(fake, 'Sample Novel')).toHaveLength(85);
    expect(notesUnder(fake, 'Sample Novel 2')).toHaveLength(85);
    expect(fake.workspace.opened).toEqual(['Sample Novel/Manuscript/Prologue.md', 'Sample Novel 2/Manuscript/Prologue.md']);
    expect(notices()).toContain('Created "Sample Novel 2" with 52 scenes.');
    expect(storeOf(plugin).project?.title).toBe('Sample Novel 2');
  });

  it('will not start a second project while one is still being created', async () => {
    const { fake, plugin } = loadReady();
    const first = plugin.createSampleProject();
    const second = plugin.createSampleProject();

    expect(await second).toBe(false);
    expect(await first).toBe(true);
    expect(notices()).toContain('Spellbook is still creating the last project. Try again when it has finished.');
    expect(fake.vault.getFolderByPath('Sample Novel 2')).toBeNull();
    // and afterwards it works again
    expect(await plugin.createSampleProject()).toBe(true);
    expect(fake.vault.getFolderByPath('Sample Novel 2')).not.toBeNull();
  });
});

describe('creating a project', () => {
  it('creates the structure with a first scene, opens the project and shows the scene', async () => {
    const { fake, plugin } = loadReady(novelVault());

    expect(await plugin.createProject('Night Train', 'Writing')).toBe(true);

    expect(notesUnder(fake, 'Writing/Night Train')).toEqual([
      'Writing/Night Train/Manuscript/Scene 1.md',
      'Writing/Night Train/Night Train.md',
      'Writing/Night Train/To-do.md',
    ]);
    for (const sub of ['Manuscript', 'Timeline', 'Research', 'Stats']) {
      expect(fake.vault.getFolderByPath(`Writing/Night Train/${sub}`), sub).not.toBeNull();
    }
    expect(fake.textOf('Writing/Night Train/To-do.md')).toBe('');
    expect(fake.workspace.opened).toEqual(['Writing/Night Train/Manuscript/Scene 1.md']);
    expect(notices()).toEqual(['Created the project "Night Train".']);
    expect(storeOf(plugin).project).toMatchObject({ title: 'Night Train', folder: 'Writing/Night Train', unfiled: [], missing: [] });
    expect(storeOf(plugin).project?.tree).toEqual([{ kind: 'scene', path: 'Manuscript/Scene 1.md', title: 'Scene 1', missing: false }]);
    expect(fake.calls).toEqual(['processFrontMatter Writing/Night Train/Night Train.md']);
  });

  it('refuses with a clear notice when the folder already exists, and writes nothing', async () => {
    const { fake, plugin } = loadReady(novelVault());
    const before = new Map(fake.vault.text);

    expect(await plugin.createProject('Novel')).toBe(false);
    expect(await plugin.createProject('notes')).toBe(false); // an ordinary folder, in other capitals

    expect(notices()).toEqual([
      'There is already something called "Novel" here. Choose another name.',
      'There is already something called "notes" here. Choose another name.',
    ]);
    expect(StubNotice.shown.every((notice) => (notice.duration ?? 0) >= 8000)).toBe(true); // long enough to read
    expect(new Map(fake.vault.text)).toEqual(before);
    expect(fake.calls).toEqual([]);
    expect(fake.workspace.opened).toEqual([]);
    // The project that was there is still the open one.
    await until(() => storeOf(plugin).project !== null, 'the project to open');
    expect(storeOf(plugin).project?.title).toBe('My Novel');
    expect(fake.localStorage.size).toBe(0);
  });

  it('refuses an empty name with a notice', async () => {
    const { fake, plugin } = loadReady();
    expect(await plugin.createProject('   ')).toBe(false);
    expect(notices()).toEqual(['Give the project a name.']);
    expect(fake.vault.getMarkdownFiles()).toEqual([]);
  });

  it('accepts a Hebrew name', async () => {
    const { fake, plugin } = loadReady();
    expect(await plugin.createProject('הרומן שלי')).toBe(true);
    expect(fake.workspace.opened).toEqual(['הרומן שלי/Manuscript/Scene 1.md']);
    expect(notices()).toEqual(['Created the project "הרומן שלי".']);
    expect(storeOf(plugin).listProjects()).toEqual([{ indexPath: 'הרומן שלי/הרומן שלי.md', folder: 'הרומן שלי', title: 'הרומן שלי' }]);
  });

  it('makes the new project the one this device works on, also after a restart', async () => {
    const fake = novelVault();
    const first = loadReady(fake);
    expect(await first.plugin.createProject('Night Train', 'Writing')).toBe(true);
    expect(fake.loadLocalStorage(ACTIVE_PROJECT_KEY)).toBe('Writing/Night Train/Night Train.md');
    expect(fake.vault.getMarkdownFiles().some((file) => file.path.includes('spellbook-active'))).toBe(false); // kept on the device, not in the vault

    // Obsidian is closed and opened again.
    first.plugin.unload();
    const second = load(fake);
    await until(() => storeOf(second.plugin).project !== null, 'the project to open');
    expect(storeOf(second.plugin).project?.title).toBe('Night Train'); // not "My Novel", though that comes first
  });
});

const binders = (fake: FakeObsidian): FakeLeaf[] => fake.workspace.getLeavesOfType('spellbook-binder');

function paneOf(leaf: FakeLeaf | undefined): FakeElement {
  if (!leaf?.view) throw new Error('there is no binder');
  return (leaf.view as unknown as { contentEl: FakeElement }).contentEl;
}

/** The plugin on a vault with one small novel, the binder open and filled in. */
async function withBinder(fake: FakeObsidian = novelVault()): Promise<Loaded & { pane: FakeElement; leaf: FakeLeaf }> {
  const loaded = loadReady(fake);
  await loaded.plugin.openBinder();
  const leaf = binders(fake)[0] as FakeLeaf;
  const pane = paneOf(leaf);
  await until(() => pane.withClass('spellbook-count').some((count) => count.text !== ''), 'the binder to fill in');
  return { ...loaded, pane, leaf };
}

/** A novel with three scenes in a row, a loose note in its Manuscript folder, and a research note. */
function threeScenes(): FakeObsidian {
  const fake = new FakeObsidian();
  fake.addNote(
    'Novel/Novel.md',
    note({ spellbook: 'project', version: 1, title: 'My Novel', binder: ['Manuscript/Opening.md', 'Manuscript/Middle.md', 'Manuscript/Ending.md'] }, 'Index text.'),
  );
  fake.addNote('Novel/Manuscript/Opening.md', note({ status: 'To do', order: 1024 }, 'It was a dark night.\n'));
  fake.addNote('Novel/Manuscript/Middle.md', note({ status: 'To do', order: 2048 }, 'The train left.\n'));
  fake.addNote('Novel/Manuscript/Ending.md', note({ status: 'To do', order: 3072 }, 'Morning came.\n'));
  fake.addNote('Novel/Manuscript/Loose.md', 'Not in the binder.');
  fake.addNote('Novel/Research/Trains.md', 'Timetables.');
  fake.addNote('Novel/To-do.md', '- [ ] Write');
  fake.addNote('Notes/Plain.md', 'No properties here.');
  return fake;
}

/** The properties of a note as they are on "disk" (the stand-in writes them as JSON). */
function propertiesOf(fake: FakeObsidian, path: string): Record<string, unknown> {
  const info = getFrontMatterInfo(fake.textOf(path));
  return info.exists ? (JSON.parse(info.frontmatter) as Record<string, unknown>) : {};
}

const binderOf = (fake: FakeObsidian, indexPath = 'Novel/Novel.md'): unknown => propertiesOf(fake, indexPath)['binder'];

/** The writer moves to a note (or to none). */
function workOn(fake: FakeObsidian, path: string | null): void {
  fake.workspace.setActiveFile(path === null ? null : fake.vault.getFileByPath(path));
}

/** The window that was opened last. */
function lastWindow(): StubModal {
  const modal = StubModal.opened[StubModal.opened.length - 1];
  if (!modal) throw new Error('no window was opened');
  return modal;
}

/** Type a name into the window that asks for one, and press Enter. */
function answer(text: string): void {
  const input = lastWindow().contentEl.withClass('spellbook-prompt-input')[0];
  if (!input) throw new Error('the open window does not ask for a name');
  input.value = text;
  press(input, 'Enter');
}

describe('the binder', () => {
  it('opens in the left sidebar from the command, and shows the open project', async () => {
    const { fake, command } = loadReady(novelVault());
    expect(binders(fake)).toEqual([]);
    expect(fake.workspace.leftSplit.collapsed).toBe(true);

    command('open-binder').callback?.();
    await until(() => binders(fake).length > 0 && binders(fake)[0]?.view !== null, 'the binder to open');
    const leaf = binders(fake)[0] as FakeLeaf;
    expect(leaf.view).toBeInstanceOf(BinderView);
    expect(leaf.getRoot()).toBe(fake.workspace.leftSplit);
    await until(() => fake.workspace.revealed.length > 0, 'the binder to be shown');
    expect(fake.workspace.revealed).toEqual([leaf]);
    expect(fake.workspace.leftSplit.collapsed).toBe(false); // the sidebar was opened to show it

    const pane = paneOf(leaf);
    await until(() => picture(pane)[0] === 'v Manuscript 5', 'the words to be counted');
    expect(heading(pane).fullText).toBe('My Novel');
    expect(picture(pane)).toEqual(['v Manuscript 5', '  Opening 5', 'v Research', '  (No research notes yet.)']);
    expect(fake.saves).toEqual([]); // showing the binder writes nothing
    expect(fake.calls).toEqual([]);
  });

  it('opens from the ribbon button too', async () => {
    const { fake, stub } = loadReady(novelVault());
    stub.ribbonIcons[0]?.callback({});
    await until(() => fake.workspace.revealed.length > 0, 'the binder to be shown');
    expect(binders(fake)).toHaveLength(1);
  });

  it('is only ever open once, however often and however fast it is asked for', async () => {
    const { fake, plugin, command, stub } = loadReady(novelVault());
    // Twice in the same instant, as from a double tap.
    await Promise.all([plugin.openBinder(), plugin.openBinder()]);
    expect(binders(fake)).toHaveLength(1);
    const leaf = binders(fake)[0];

    fake.workspace.leftSplit.collapse();
    command('open-binder').callback?.();
    stub.ribbonIcons[0]?.callback({});
    await plugin.openBinder();
    expect(binders(fake)).toEqual([leaf]); // the same one, brought to the front again
    expect(fake.workspace.leftSplit.collapsed).toBe(false);
    expect(fake.workspace.leaves).toHaveLength(1);
  });

  it('is brought to the front where it is, when the writer has moved it', async () => {
    const { fake, plugin } = loadReady(novelVault());
    const moved = fake.workspace.addLeaf(fake.workspace.rightSplit);
    await moved.setViewState({ type: 'spellbook-binder' });

    await plugin.openBinder();
    expect(binders(fake)).toEqual([moved]);
    expect(fake.workspace.rightSplit.collapsed).toBe(false);
    expect(fake.workspace.leftSplit.collapsed).toBe(true); // nothing new on the left
  });

  it('closes the extra ones if a saved layout holds several binders', async () => {
    const { fake, plugin } = loadReady(novelVault());
    const first = fake.workspace.addLeaf(fake.workspace.leftSplit);
    const second = fake.workspace.addLeaf(fake.workspace.rightSplit);
    await first.setViewState({ type: 'spellbook-binder' });
    await second.setViewState({ type: 'spellbook-binder' });

    await plugin.openBinder();
    expect(binders(fake)).toEqual([first]);
    expect(second.detached).toBe(true);
    expect(second.view).toBeNull();
  });

  it('says so when Obsidian has no room for it', async () => {
    const { fake, plugin } = loadReady(novelVault());
    fake.workspace.noRoomOnTheLeft = true;
    await plugin.openBinder();
    expect(binders(fake)).toEqual([]);
    expect(notices()).toEqual(['The binder could not be opened: Obsidian has no room for it in the left sidebar.']);
  });

  it('opens a tapped scene in the tab the writer was working in, and highlights it', async () => {
    const { fake, pane } = await withBinder();
    tap(rowOf(pane, 'Opening'));
    await until(() => fake.workspace.openCalls.length > 0, 'the scene to open');
    expect(fake.workspace.openCalls).toEqual([
      { path: 'Novel/Manuscript/Opening.md', where: false, state: { active: true } },
    ]);
    expect(picture(pane)).toContain('  Opening 5 *');
    expect(fake.workspace.leftSplit.collapses).toBe(0); // a desktop: the sidebar stays
  });

  it('opens a new tab on a Cmd or Ctrl click', async () => {
    const { fake, pane } = await withBinder();
    tap(rowOf(pane, 'Opening'), { ctrlKey: true });
    await until(() => fake.workspace.openCalls.length > 0, 'the scene to open');
    expect(fake.workspace.openCalls).toEqual([{ path: 'Novel/Manuscript/Opening.md', where: 'tab', state: undefined }]);
  });

  it('slides the drawer away on a phone once the scene is open', async () => {
    StubPlatform.isMobile = true;
    StubPlatform.isPhone = true;
    const { fake, pane } = await withBinder();
    expect(fake.workspace.leftSplit.collapsed).toBe(false);
    tap(rowOf(pane, 'Opening'));
    await until(() => fake.workspace.leftSplit.collapsed, 'the drawer to close');
    expect(fake.workspace.opened).toEqual(['Novel/Manuscript/Opening.md']);
    expect(fake.workspace.leftSplit.collapses).toBe(1);
  });

  it('follows the project: a new scene appears, a saved one is counted again', async () => {
    const { fake, plugin, pane } = await withBinder();
    const added = await storeOf(plugin).addScene('The Letter');
    expect(added.status).toBe('done');
    await until(() => picture(pane).includes('  The Letter 0'), 'the new scene to appear');
    expect(picture(pane).slice(0, 3)).toEqual(['v Manuscript 5', '  Opening 5', '  The Letter 0']);
    expect(fake.workspace.leaves).toHaveLength(1);
  });

  it('fills in a binder that Obsidian put back before Spellbook had started', async () => {
    const fake = novelVault();
    const { plugin } = load(fake);
    // Obsidian restores the saved layout while it is still starting up.
    const leaf = fake.workspace.addLeaf(fake.workspace.leftSplit);
    await leaf.setViewState({ type: 'spellbook-binder' });
    const pane = paneOf(leaf);
    expect(picture(pane)).toEqual(['(Spellbook is still starting...)']);
    expect(plugin.store).toBeNull();

    fake.finishStartup();
    await until(() => picture(pane)[0] === 'v Manuscript 5', 'the binder to fill in');
    expect(picture(pane)).toEqual(['v Manuscript 5', '  Opening 5', 'v Research', '  (No research notes yet.)']);
    expect(countOf(pane, 'Opening')).toBe('5');
  });

  it('offers to create a project in a vault that has none, through the same window as the command', async () => {
    const fake = new FakeObsidian();
    fake.addFolder('Writing');
    const { plugin } = loadReady(fake);
    await plugin.openBinder();
    const pane = paneOf(binders(fake)[0]);
    tap(one(pane, 'spellbook-binder-create'));
    expect(StubModal.opened).toHaveLength(1);
    expect(StubModal.opened[0]).toBeInstanceOf(CreateProjectModal);

    // Creating the project fills the binder in.
    expect(await plugin.createProject('Night Train')).toBe(true);
    await until(() => picture(pane)[0] === 'v Manuscript 0', 'the binder to show the project');
    expect(heading(pane).fullText).toBe('Night Train');
    // Its first scene was opened for the writer, so that row is the highlighted one.
    expect(picture(pane).slice(0, 2)).toEqual(['v Manuscript 0', '  Scene 1 0 *']);
  });

  it('is emptied, not removed, when the plugin is switched off, and nothing is left listening', async () => {
    const { fake, plugin, stub, pane, leaf } = await withBinder();
    // The binder's one listener, next to the three of the writing progress
    // (which note is in front, a tab closing, Obsidian quitting).
    expect(fake.workspace.listenerCount()).toBe(4);
    expect(fake.workspace.listenerCount('file-open')).toBe(2);

    plugin.unload();
    await until(() => pane.children.length === 0, 'the binder to be emptied');
    expect([...pane.classes]).toEqual(['view-content']);
    expect(leaf.detached).toBe(false); // its place in the sidebar is kept for when the plugin comes back
    expect(leaf.view).toBeNull();
    expect(stub.ribbonIcons.every((icon) => !icon.shown)).toBe(true);
    expect(fake.workspace.listenerCount()).toBe(0);
    expect(fake.vault.listenerCount()).toBe(0);
    expect(fake.metadataCache.listenerCount()).toBe(0);
    expect(plugin.services).toBeNull();

    // And a plugin that is off does not open anything.
    await plugin.openBinder();
    expect(fake.workspace.leaves).toEqual([leaf]);
  });
});

describe('editing the binder, through to the notes', () => {
  /** Tap the "more" button of a row and give the menu that opens. */
  function menuFor(pane: FakeElement, title: string): StubMenu {
    const button = moreOf(pane, title);
    if (!button) throw new Error(`the row "${title}" has no "more" button`);
    tap(button);
    return StubMenu.shown[StubMenu.shown.length - 1] as StubMenu;
  }

  const lines = (pane: FakeElement): string[] => picture(pane).map((line) => line.replace(' *', ''));

  it('shows the novel with its toolbar', async () => {
    const { pane } = await withBinder(threeScenes());
    await until(() => picture(pane)[0] === 'v Manuscript 10', 'the words to be counted');
    expect(toolbarLabels(pane)).toEqual(['New scene', 'New folder', 'More options']);
    expect(picture(pane)).toEqual([
      'v Manuscript 10',
      '  Opening 5',
      '  Middle 3',
      '  Ending 2',
      'v Unfiled',
      '  Loose 4',
      'v Research',
      '  Trains',
    ]);
  });

  it('creates a new scene below the selected one, with the agreed properties, and opens it for writing', async () => {
    const { fake, pane } = await withBinder(threeScenes());
    tap(rowOf(pane, 'Opening'));
    await until(() => fake.workspace.opened.length === 1, 'the tapped scene to open');
    fake.calls.length = 0;

    tap(toolbarButton(pane, 'New scene'));
    expect(lastWindow()).toBeInstanceOf(TextPromptModal);
    answer('רכבת לילה');
    await until(() => fake.workspace.opened.includes('Novel/Manuscript/רכבת לילה.md'), 'the new scene to open');

    expect(lastWindow().isOpen).toBe(false);
    expect(binderOf(fake)).toEqual([
      'Manuscript/Opening.md',
      'Manuscript/רכבת לילה.md',
      'Manuscript/Middle.md',
      'Manuscript/Ending.md',
    ]);
    const properties = propertiesOf(fake, 'Novel/Manuscript/רכבת לילה.md');
    expect(properties).toEqual({
      synopsis: '',
      status: 'To do',
      label: '',
      compile: true,
      order: 1536,
      created: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) as unknown,
    });
    expect(Object.keys(properties)).toEqual(['synopsis', 'status', 'label', 'compile', 'order', 'created']);
    expect(fake.textOf('Novel/Manuscript/רכבת לילה.md').endsWith('---\n')).toBe(true); // properties, and no text yet
    // The index was changed through Obsidian's own doorway for properties, once; no other note was touched.
    expect(fake.calls).toEqual(['processFrontMatter Novel/Novel.md']);
    expect(fake.textOf('Novel/Novel.md').endsWith('---\nIndex text.')).toBe(true);
    // Opened in the current tab, as the note being worked on.
    expect(fake.workspace.openCalls[fake.workspace.openCalls.length - 1]).toEqual({
      path: 'Novel/Manuscript/רכבת לילה.md',
      where: false,
      state: { active: true },
    });
    await until(() => picture(pane).includes('  רכבת לילה 0 *'), 'the new scene to be shown');
    expect(selectedTitle(pane)).toBe('רכבת לילה');
  });

  it('turns down an empty name in the window, creating nothing', async () => {
    const { fake, pane } = await withBinder(threeScenes());
    const before = new Map(fake.vault.text);
    tap(toolbarButton(pane, 'New scene'));
    answer('  ');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(lastWindow().isOpen).toBe(true);
    expect(lastWindow().contentEl.withClass('spellbook-prompt-message')[0]?.text).toBe('Give the scene a name.');
    expect(new Map(fake.vault.text)).toEqual(before);
    expect(fake.calls).toEqual([]);
  });

  it('adds a folder to the index, which makes no folder in the vault', async () => {
    const { fake, pane } = await withBinder(threeScenes());
    const foldersBefore = fake.vault.getAllFolders().map((folder) => folder.path).sort();
    tap(toolbarButton(pane, 'New folder'));
    answer('חלק ראשון');
    await until(() => picture(pane).includes('  v חלק ראשון 0'), 'the folder to be shown');
    const binder = binderOf(fake) as unknown[];
    expect(binder.slice(0, 3)).toEqual(['Manuscript/Opening.md', 'Manuscript/Middle.md', 'Manuscript/Ending.md']);
    expect(binder[3]).toMatchObject({ folder: 'חלק ראשון', children: [] });
    expect((binder[3] as { id: string }).id).toMatch(/^f-[a-z0-9]{6}$/);
    expect(fake.vault.getAllFolders().map((folder) => folder.path).sort()).toEqual(foldersBefore);
    expect(fake.calls).toEqual(['processFrontMatter Novel/Novel.md']);
  });

  it('renames a scene with Obsidian\'s own rename (which keeps links working), and the binder follows', async () => {
    const { fake, pane } = await withBinder(threeScenes());
    menuFor(pane, 'Middle').item('Rename').click();
    expect((lastWindow().contentEl.withClass('spellbook-prompt-input')[0] as FakeElement).value).toBe('Middle');
    answer('Crossing');
    await until(() => lines(pane).includes('  Crossing 3'), 'the new name to be shown');

    expect(fake.calls).toEqual([
      'renameFile Novel/Manuscript/Middle.md -> Novel/Manuscript/Crossing.md',
      'processFrontMatter Novel/Novel.md',
    ]);
    expect(binderOf(fake)).toEqual(['Manuscript/Opening.md', 'Manuscript/Crossing.md', 'Manuscript/Ending.md']);
    expect(fake.textOf('Novel/Manuscript/Crossing.md').endsWith('---\nThe train left.\n')).toBe(true);
    expect(fake.vault.getFileByPath('Novel/Manuscript/Middle.md')).toBeNull();
    expect(selectedTitle(pane)).toBe('Crossing');
  });

  it('deletes a scene only after asking, and then through Obsidian\'s trash', async () => {
    const { fake, pane } = await withBinder(threeScenes());
    menuFor(pane, 'Ending').item('Delete scene').click();
    const asked = lastWindow();
    expect(asked).toBeInstanceOf(ConfirmModal);
    expect(asked.titleEl.text).toBe('Delete "Ending"?');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fake.calls).toEqual([]); // nothing before the answer
    expect(fake.trashed).toEqual([]);

    (asked.contentEl.settings[0]?.components[1] as ButtonComponent).click();
    await until(() => fake.trashed.length > 0, 'the note to go to the trash');
    expect(fake.trashed).toEqual(['Novel/Manuscript/Ending.md']);
    // The index first: a note is only trashed once the binder no longer lists it.
    expect(fake.calls).toEqual(['processFrontMatter Novel/Novel.md', 'trashFile Novel/Manuscript/Ending.md']);
    expect(binderOf(fake)).toEqual(['Manuscript/Opening.md', 'Manuscript/Middle.md']);
    await until(() => !picture(pane).some((line) => line.includes('Ending')), 'the row to go');
    expect(notices()).toEqual(['Moved "Ending" to the trash.']);
    // The other notes are as they were.
    expect(fake.textOf('Novel/Manuscript/Opening.md').endsWith('---\nIt was a dark night.\n')).toBe(true);
    expect(fake.vault.getFileByPath('Novel/Manuscript/Loose.md')).not.toBeNull();
  });

  it('offers the snapshots in a scene\'s menu: "Take snapshot" asks for a name, "Snapshots" shows the scene\'s', async () => {
    const { fake, plugin, pane } = await withBinder(threeScenes());
    // The binder asks for them under the name the snapshots are offered by.
    expect(SNAPSHOT_ACTIONS).toBe(SNAPSHOTS_SERVICE);
    expect(plugin.features?.services.get(SNAPSHOT_ACTIONS)).toBeDefined();
    const before = new Map(fake.vault.text);

    const menu = menuFor(pane, 'Middle');
    expect(menu.outline.slice(-5)).toEqual(['---', 'Take snapshot', 'Snapshots', '---', 'Delete scene']);
    // Not for a note that is no scene of the binder.
    expect(menuFor(pane, 'Loose').outline).toEqual(['Add to manuscript', 'Open', 'Open in new tab']);
    expect(menuFor(pane, 'Trains').outline).toEqual(['Open', 'Open in new tab']);

    menu.item('Take snapshot').click();
    const asked = lastWindow();
    expect(asked).toBeInstanceOf(TextPromptModal);
    expect(asked.titleEl.text).toBe(TAKE_TITLE);
    expect(asked.isOpen).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(new Map(fake.vault.text)).toEqual(before); // nothing before the answer
    answer('Before the rewrite');
    await until(() => notesUnder(fake, 'Novel/Snapshots').length === 1, 'the snapshot to be saved');
    // The scene itself keeps its text; the snapshot holds a copy of it.
    expect(fake.textOf('Novel/Manuscript/Middle.md').endsWith('The train left.\n')).toBe(true);
    expect(fake.textOf(notesUnder(fake, 'Novel/Snapshots')[0] as string)).toContain('The train left.');
    expect(fake.trashed).toEqual([]);

    menuFor(pane, 'Middle').item('Snapshots').click();
    await until(() => fake.workspace.getLeavesOfType(SNAPSHOTS_VIEW_TYPE).length === 1, 'the snapshots to be shown');
    expect(fake.workspace.getLeavesOfType(SNAPSHOTS_VIEW_TYPE)[0]?.getRoot()).toBe(fake.workspace.rootSplit);
  });

  it('deletes nothing when the question is answered with Cancel', async () => {
    const { fake, pane } = await withBinder(threeScenes());
    const before = new Map(fake.vault.text);
    menuFor(pane, 'Ending').item('Delete scene').click();
    (lastWindow().contentEl.settings[0]?.components[0] as ButtonComponent).click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(new Map(fake.vault.text)).toEqual(before);
    expect(fake.calls).toEqual([]);
  });

  it('moves a scene down, writes its order key into that one note, and leaves every text alone', async () => {
    const { fake, plugin, pane } = await withBinder(threeScenes());
    menuFor(pane, 'Opening').item('Move down').click();
    await until(() => lines(pane)[1] === '  Middle 3', 'the scene to move');
    expect(binderOf(fake)).toEqual(['Manuscript/Middle.md', 'Manuscript/Opening.md', 'Manuscript/Ending.md']);
    expect(selectedTitle(pane)).toBe('Opening');
    expect(fake.calls).toEqual(['processFrontMatter Novel/Novel.md']); // the order key waits a moment

    await storeOf(plugin).syncOrderKeysNow(); // as if that moment had passed
    expect(fake.calls).toEqual(['processFrontMatter Novel/Novel.md', 'processFrontMatter Novel/Manuscript/Opening.md']);
    expect(propertiesOf(fake, 'Novel/Manuscript/Opening.md')).toEqual({ status: 'To do', order: 2560 });
    expect(fake.textOf('Novel/Manuscript/Opening.md').endsWith('---\nIt was a dark night.\n')).toBe(true);
    expect(propertiesOf(fake, 'Novel/Manuscript/Middle.md')['order']).toBe(2048);
    expect(propertiesOf(fake, 'Novel/Manuscript/Ending.md')['order']).toBe(3072);
    // The plugin's own write does not set it off again.
    await storeOf(plugin).syncOrderKeysNow();
    expect(fake.calls).toHaveLength(2);
  });

  it('moves a scene into a folder picked from the list', async () => {
    const { fake, pane } = await withBinder(threeScenes());
    tap(toolbarButton(pane, 'New folder'));
    answer('Part one');
    await until(() => picture(pane).includes('  v Part one 0'), 'the folder to be shown');

    menuFor(pane, 'Middle').item('Move to folder').click();
    const list = lastWindow() as unknown as { shownFor(query?: string): FakeElement[]; pick(text: string): void };
    expect(lastWindow()).toBeInstanceOf(FolderPickerModal);
    expect(list.shownFor().map((row) => row.text)).toEqual(['Top level', 'Part one']);
    list.pick('Part one');
    await until(() => picture(pane).includes('    Middle 3'), 'the scene to move into the folder');
    const binder = binderOf(fake) as unknown[];
    expect(binder.slice(0, 2)).toEqual(['Manuscript/Opening.md', 'Manuscript/Ending.md']);
    expect(binder[2]).toMatchObject({ folder: 'Part one', children: ['Manuscript/Middle.md'] });
    // The note itself did not move: binder folders are not folders in the vault.
    expect(fake.vault.getFileByPath('Novel/Manuscript/Middle.md')).not.toBeNull();
    expect(fake.calls.every((call) => call === 'processFrontMatter Novel/Novel.md')).toBe(true);
  });

  it('files an unfiled note at the end of the manuscript', async () => {
    const { fake, pane } = await withBinder(threeScenes());
    menuFor(pane, 'Loose').item('Add to manuscript').click();
    await until(() => !picture(pane).includes('v Unfiled'), 'the note to be filed');
    expect(binderOf(fake)).toEqual(['Manuscript/Opening.md', 'Manuscript/Middle.md', 'Manuscript/Ending.md', 'Manuscript/Loose.md']);
    expect(fake.textOf('Novel/Manuscript/Loose.md')).toBe('Not in the binder.'); // not a letter of it changed
    expect(selectedTitle(pane)).toBe('Loose');
  });

  it('follows a rename made in Obsidian\'s file explorer, and brings the index up to date', async () => {
    const { fake, pane } = await withBinder(threeScenes());
    const file = fake.vault.getFileByPath('Novel/Manuscript/Middle.md');
    if (!file) throw new Error('no such note');
    await fake.fileManager.renameFile(file, 'Novel/Manuscript/Crossing.md'); // as the file explorer does
    await until(() => picture(pane).includes('  Crossing 3'), 'the new name to be shown');
    expect(picture(pane).some((line) => line.includes('Middle'))).toBe(false);
    expect(picture(pane)).toContain('  Loose 4'); // and it did not turn up as an unfiled note
    await until(() => JSON.stringify(binderOf(fake)).includes('Manuscript/Crossing.md'), 'the index to follow');
    expect(binderOf(fake)).toEqual(['Manuscript/Opening.md', 'Manuscript/Crossing.md', 'Manuscript/Ending.md']);
  });

  it('follows a note deleted in the file explorer: its entry is kept and shown as missing', async () => {
    const { fake, pane } = await withBinder(threeScenes());
    const file = fake.vault.getFileByPath('Novel/Manuscript/Middle.md');
    if (!file) throw new Error('no such note');
    fake.calls.length = 0;
    await fake.fileManager.trashFile(file);
    await until(() => picture(pane).some((line) => line.startsWith('  ! Middle')), 'the entry to be shown as missing');
    expect(binderOf(fake)).toEqual(['Manuscript/Opening.md', 'Manuscript/Middle.md', 'Manuscript/Ending.md']); // not "repaired"
    expect(fake.calls).toEqual(['trashFile Novel/Manuscript/Middle.md']); // the plugin itself wrote nothing
    expect(menuFor(pane, 'Middle').outline).toEqual(['Remove from binder']);
  });

  it('follows an index that another device changed', async () => {
    const { fake, pane } = await withBinder(threeScenes());
    const index = fake.vault.getFileByPath('Novel/Novel.md');
    if (!index) throw new Error('no index note');
    // The synced file lands on disk; Obsidian notices and indexes it again.
    fake.vault.text.set(
      'Novel/Novel.md',
      note(
        {
          spellbook: 'project',
          version: 1,
          title: 'My Novel',
          binder: ['Manuscript/Ending.md', { folder: 'From the phone', id: 'f-phone', children: ['Manuscript/Opening.md', 'Manuscript/Middle.md'] }],
        },
        'Index text.',
      ),
    );
    fake.vault.trigger('modify', index);
    fake.metadataCache.index(index);
    await until(() => picture(pane)[1] === '  Ending 2', 'the binder to follow');
    expect(picture(pane).slice(0, 5)).toEqual(['v Manuscript 10', '  Ending 2', '  v From the phone 8', '    Opening 5', '    Middle 3']);
    expect(fake.calls).toEqual([]); // following writes nothing
  });
});

describe('dragging in the binder, through to the notes', () => {
  const lines = (pane: FakeElement): string[] => picture(pane).map((line) => line.replace(' *', ''));

  it('moves a dragged scene with one change of the index, and touches no note', async () => {
    const { fake, pane } = await withBinder(threeScenes());
    layOut(pane);
    const opening = rowOf(pane, 'Opening');
    const y = inRow(rowOf(pane, 'Middle'), 0.75);
    carry(opening, 60, y);
    expect(fakeDocument.body.withClass('spellbook-drag-ghost')).toHaveLength(1);
    expect(fake.calls).toEqual([]); // nothing changes while it is carried
    letGo(opening, 60, y);
    await until(() => lines(pane)[1] === '  Middle 3', 'the scene to move');

    expect(binderOf(fake)).toEqual(['Manuscript/Middle.md', 'Manuscript/Opening.md', 'Manuscript/Ending.md']);
    expect(fake.calls).toEqual(['processFrontMatter Novel/Novel.md']);
    expect(selectedTitle(pane)).toBe('Opening');
    expect(fake.textOf('Novel/Manuscript/Opening.md').endsWith('---\nIt was a dark night.\n')).toBe(true);
    expect(fake.workspace.opened).toEqual([]); // dragging opens nothing
    expect(fakeDocument.body.children).toEqual([]);
  });

  it('files an unfiled note where it is dropped', async () => {
    const { fake, pane } = await withBinder(threeScenes());
    layOut(pane);
    const loose = rowOf(pane, 'Loose');
    const y = inRow(rowOf(pane, 'Middle'), 0.25);
    carry(loose, 60, y);
    letGo(loose, 60, y);
    await until(() => !picture(pane).includes('v Unfiled'), 'the note to be filed');
    expect(binderOf(fake)).toEqual(['Manuscript/Opening.md', 'Manuscript/Loose.md', 'Manuscript/Middle.md', 'Manuscript/Ending.md']);
    expect(fake.calls).toEqual(['processFrontMatter Novel/Novel.md']);
    expect(fake.textOf('Novel/Manuscript/Loose.md')).toBe('Not in the binder.');
  });

  it('leaves nothing on the page when the plugin is switched off in the middle of a drag', async () => {
    const { plugin, pane } = await withBinder(threeScenes());
    layOut(pane);
    carry(rowOf(pane, 'Opening'), 60, inRow(rowOf(pane, 'Ending'), 0.75));
    expect(fakeDocument.body.children.length).toBeGreaterThan(0);
    plugin.unload();
    await until(() => pane.children.length === 0, 'the binder to be emptied');
    expect(fakeDocument.body.children).toEqual([]);
    expect(fakeDocument.listenerCount()).toBe(0);
    expect(fakeWindow.listenerCount()).toBe(0);
  });
});

describe('a conflicting copy of the index, through to the notes', () => {
  function withCopy(): FakeObsidian {
    const fake = threeScenes();
    // What another device left behind: its own order, and the loose note filed.
    fake.addNote(
      'Novel/Novel 2.md',
      note({ spellbook: 'project', version: 1, title: 'My Novel', binder: ['Manuscript/Ending.md', 'Manuscript/Loose.md', 'Manuscript/Opening.md'] }, 'Index text.'),
    );
    return fake;
  }

  const banner = (pane: FakeElement): FakeElement[] => pane.withClass('spellbook-conflict-banner');
  const button = (pane: FakeElement, name: string): FakeElement =>
    one(pane, 'spellbook-binder-alerts').all().filter((element) => element.tag === 'button' && element.text === name)[0] as FakeElement;

  it('is shown as a notice, not as a second project', async () => {
    const { plugin, pane } = await withBinder(withCopy());
    expect(storeOf(plugin).listProjects().map((project) => project.indexPath)).toEqual(['Novel/Novel.md']);
    expect(storeOf(plugin).project?.indexPath).toBe('Novel/Novel.md');
    expect(banner(pane)).toHaveLength(1);
    expect(one(banner(pane)[0] as FakeElement, 'spellbook-binder-banner-title').text).toBe(
      "A conflicting copy of this project's structure was found.",
    );
    expect(heading(pane).fullText).toBe('My Novel');
  });

  it('is merged into the index and moved to Obsidian\'s trash, never deleted', async () => {
    const { fake, pane } = await withBinder(withCopy());
    tap(button(pane, 'Merge'));
    await until(() => fake.trashed.length > 0, 'the copy to be trashed');
    await until(() => banner(pane).length === 0, 'the notice to go');

    expect(binderOf(fake)).toEqual(['Manuscript/Opening.md', 'Manuscript/Middle.md', 'Manuscript/Ending.md', 'Manuscript/Loose.md']);
    expect(fake.calls).toEqual(['processFrontMatter Novel/Novel.md', 'trashFile Novel/Novel 2.md']);
    expect(fake.trashed).toEqual(['Novel/Novel 2.md']);
    expect(fake.textOf('Novel/Novel.md').endsWith('---\nIndex text.')).toBe(true); // the index note's own text is as it was
    expect(notices()).toEqual([
      'Merged the copy "Novel 2": 1 scene was added at the end of the manuscript. The copy was moved to the trash.',
    ]);
  });

  it('is left alone when the notice is dismissed', async () => {
    const { fake, pane } = await withBinder(withCopy());
    tap(button(pane, 'Dismiss'));
    expect(banner(pane)).toEqual([]);
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(fake.calls).toEqual([]);
    expect(fake.vault.getFileByPath('Novel/Novel 2.md')).not.toBeNull();
  });
});

describe('the commands for working without a mouse', () => {
  const EDITING = ['new-scene', 'new-folder', 'move-scene-up', 'move-scene-down', 'reveal-active-scene'];

  const offered = (loaded: Loaded, id: string): boolean => loaded.command(id).checkCallback?.(true) === true;
  const offeredOf = (loaded: Loaded): string[] => EDITING.filter((id) => offered(loaded, id));
  const run = (loaded: Loaded, id: string): void => {
    loaded.command(id).checkCallback?.(false);
  };

  /** The plugin on the three-scene novel, with its project open. */
  async function ready(fake: FakeObsidian = threeScenes()): Promise<Loaded> {
    const loaded = loadReady(fake);
    await until(() => storeOf(loaded.plugin).project !== null, 'the project to open');
    return loaded;
  }

  it('are commands that the palette asks before offering them', () => {
    const loaded = load();
    for (const id of EDITING) {
      expect(typeof loaded.command(id).checkCallback, id).toBe('function');
      expect(loaded.command(id).callback, id).toBeUndefined();
    }
  });

  it('are hidden while Obsidian is starting, and in a vault without a project', async () => {
    const starting = load(threeScenes());
    expect(offeredOf(starting)).toEqual([]);

    const fake = new FakeObsidian();
    fake.addNote('Notes/Plain.md', 'No properties here.');
    const empty = loadReady(fake);
    workOn(fake, 'Notes/Plain.md');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(storeOf(empty.plugin).project).toBeNull();
    expect(offeredOf(empty)).toEqual([]);

    // And once the plugin has been switched off.
    const off = await ready();
    workOn(off.fake, 'Novel/Manuscript/Middle.md');
    expect(offeredOf(off)).toEqual(EDITING);
    off.plugin.unload();
    expect(offeredOf(off)).toEqual([]);
  });

  it('offer New scene and New folder whenever a project is open, and the scene commands only for a scene of it', async () => {
    const loaded = await ready();
    const { fake } = loaded;
    expect(offeredOf(loaded)).toEqual(['new-scene', 'new-folder']); // no note is being worked on

    workOn(fake, 'Novel/Manuscript/Middle.md');
    expect(offeredOf(loaded)).toEqual(EDITING);

    workOn(fake, 'Notes/Plain.md'); // a note outside the project
    expect(offeredOf(loaded)).toEqual(['new-scene', 'new-folder']);
    workOn(fake, 'Novel/To-do.md'); // a note of the project that is not a scene
    expect(offeredOf(loaded)).toEqual(['new-scene', 'new-folder']);
    workOn(fake, 'Novel/Novel.md'); // the index note itself
    expect(offeredOf(loaded)).toEqual(['new-scene', 'new-folder']);

    // Notes that have a row but no place in the binder can be revealed, not moved.
    workOn(fake, 'Novel/Manuscript/Loose.md');
    expect(offeredOf(loaded)).toEqual(['new-scene', 'new-folder', 'reveal-active-scene']);
    workOn(fake, 'Novel/Research/Trains.md');
    expect(offeredOf(loaded)).toEqual(['new-scene', 'new-folder', 'reveal-active-scene']);

    workOn(fake, null);
    expect(offeredOf(loaded)).toEqual(['new-scene', 'new-folder']);
  });

  it('offer nothing that would change a read-only project', async () => {
    const fake = new FakeObsidian();
    fake.addNote('Novel/Novel.md', note({ spellbook: 'project', version: 1, binder: { not: 'a list' } }));
    fake.addNote('Novel/Manuscript/Opening.md', 'Text.');
    const loaded = await ready(fake);
    expect(storeOf(loaded.plugin).project?.readOnly).toBe(true);
    workOn(fake, 'Novel/Manuscript/Opening.md');
    expect(offeredOf(loaded)).toEqual(['reveal-active-scene']); // looking is still allowed
  });

  it('change nothing and open nothing when the palette only asks', async () => {
    const loaded = await ready();
    const before = new Map(loaded.fake.vault.text);
    workOn(loaded.fake, 'Novel/Manuscript/Middle.md');
    for (let turn = 0; turn < 3; turn++) offeredOf(loaded);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(new Map(loaded.fake.vault.text)).toEqual(before);
    expect(loaded.fake.calls).toEqual([]);
    expect(StubModal.opened).toEqual([]);
    expect(binders(loaded.fake)).toEqual([]);
    expect(notices()).toEqual([]);
  });

  it('"New scene" asks for a name, and puts the scene below the scene being worked on', async () => {
    const loaded = await ready();
    const { fake } = loaded;
    workOn(fake, 'Novel/Manuscript/Opening.md');
    run(loaded, 'new-scene');
    expect(lastWindow()).toBeInstanceOf(TextPromptModal);
    expect(lastWindow().titleEl.text).toBe('New scene');
    answer('Between');
    await until(() => fake.workspace.opened.includes('Novel/Manuscript/Between.md'), 'the new scene to open');
    expect(binderOf(fake)).toEqual(['Manuscript/Opening.md', 'Manuscript/Between.md', 'Manuscript/Middle.md', 'Manuscript/Ending.md']);
    expect(propertiesOf(fake, 'Novel/Manuscript/Between.md')).toMatchObject({ status: 'To do', compile: true, order: 1536 });
    expect(binders(fake)).toEqual([]); // the binder does not have to be open for this
  });

  it('"New scene" puts the scene at the end when no scene is being worked on', async () => {
    const loaded = await ready();
    const { fake } = loaded;
    workOn(fake, 'Notes/Plain.md');
    run(loaded, 'new-scene');
    answer('Epilogue');
    await until(() => fake.workspace.opened.includes('Novel/Manuscript/Epilogue.md'), 'the new scene to open');
    expect(binderOf(fake)).toEqual(['Manuscript/Opening.md', 'Manuscript/Middle.md', 'Manuscript/Ending.md', 'Manuscript/Epilogue.md']);
    expect(propertiesOf(fake, 'Novel/Manuscript/Epilogue.md')['order']).toBe(4096);
  });

  it('"New folder" asks for a name, and puts the folder below the scene being worked on', async () => {
    const loaded = await ready();
    const { fake } = loaded;
    workOn(fake, 'Novel/Manuscript/Opening.md');
    run(loaded, 'new-folder');
    expect(lastWindow().titleEl.text).toBe('New folder');
    answer('Part two');
    await until(() => (binderOf(fake) as unknown[]).length === 4, 'the folder to be added');
    const binder = binderOf(fake) as unknown[];
    expect(binder[0]).toBe('Manuscript/Opening.md');
    expect(binder[1]).toMatchObject({ folder: 'Part two', children: [] });
    expect(binder.slice(2)).toEqual(['Manuscript/Middle.md', 'Manuscript/Ending.md']);
  });

  it('"Move scene down" and "Move scene up" move the scene being worked on', async () => {
    const loaded = await ready();
    const { fake, plugin } = loaded;
    workOn(fake, 'Novel/Manuscript/Opening.md');
    run(loaded, 'move-scene-down');
    await until(() => (binderOf(fake) as string[])[0] === 'Manuscript/Middle.md', 'the scene to move down');
    expect(binderOf(fake)).toEqual(['Manuscript/Middle.md', 'Manuscript/Opening.md', 'Manuscript/Ending.md']);
    run(loaded, 'move-scene-down');
    await until(() => (binderOf(fake) as string[])[2] === 'Manuscript/Opening.md', 'the scene to move down again');
    run(loaded, 'move-scene-up');
    await until(() => (binderOf(fake) as string[])[1] === 'Manuscript/Opening.md', 'the scene to move up');
    expect(binderOf(fake)).toEqual(['Manuscript/Middle.md', 'Manuscript/Opening.md', 'Manuscript/Ending.md']);
    expect(notices()).toEqual([]);

    // Its order key ends up between its new neighbours; nothing else is written.
    await storeOf(plugin).syncOrderKeysNow();
    expect(propertiesOf(fake, 'Novel/Manuscript/Opening.md')['order']).toBe(2560);
    expect(fake.calls.filter((call) => !call.endsWith('Novel/Novel.md'))).toEqual(['processFrontMatter Novel/Manuscript/Opening.md']);
    expect(fake.workspace.opened).toEqual([]); // the writer stays where they were
  });

  it('"Move scene up" says so when the scene is already the first', async () => {
    const loaded = await ready();
    workOn(loaded.fake, 'Novel/Manuscript/Opening.md');
    run(loaded, 'move-scene-up');
    await until(() => notices().length > 0, 'the notice');
    expect(notices()).toEqual(['It is already at the top.']);
    expect(loaded.fake.saves).toEqual([]); // the index was looked at, and left as it was
  });

  it('"Reveal active scene in binder" opens the binder with the scene\'s row selected', async () => {
    const loaded = await ready();
    const { fake } = loaded;
    workOn(fake, 'Novel/Manuscript/Middle.md');
    expect(binders(fake)).toEqual([]);
    run(loaded, 'reveal-active-scene');
    await until(() => binders(fake)[0]?.view != null && selectedTitle(paneOf(binders(fake)[0])) === 'Middle', 'the row to be selected');
    expect(binders(fake)).toHaveLength(1);
    expect(fake.workspace.leftSplit.collapsed).toBe(false); // the sidebar was opened to show it
    expect(picture(paneOf(binders(fake)[0]))).toContain('  Middle 3 *');
    expect(fake.calls).toEqual([]); // revealing writes nothing
  });

  it('"Reveal active scene in binder" unfolds what the scene is folded into', async () => {
    const fake = threeScenes();
    fake.vault.text.set(
      'Novel/Novel.md',
      note({
        spellbook: 'project',
        version: 1,
        title: 'My Novel',
        binder: ['Manuscript/Opening.md', { folder: 'Part one', id: 'f-one', children: ['Manuscript/Middle.md'] }, 'Manuscript/Ending.md'],
      }),
    );
    const loaded = await withBinder(fake);
    tap(rowOf(loaded.pane, 'Part one'));
    tap(rowOf(loaded.pane, 'Manuscript'));
    expect(picture(loaded.pane)[0]).toMatch(/^> Manuscript/);

    workOn(fake, 'Novel/Manuscript/Middle.md');
    run(loaded, 'reveal-active-scene');
    await until(() => picture(loaded.pane)[0] === 'v Manuscript 10', 'the section to be unfolded');
    expect(picture(loaded.pane).slice(0, 4)).toEqual(['v Manuscript 10', '  Opening 5', '  v Part one 3', '    Middle 3 *']);
    expect(selectedTitle(loaded.pane)).toBe('Middle');
  });

  it('"Reveal active scene in binder" opens the scene\'s own project when it belongs to another one', async () => {
    const fake = threeScenes();
    fake.addNote('Second/Second.md', note({ spellbook: 'project', version: 1, title: 'Second Book', binder: ['Manuscript/Elsewhere.md'] }));
    fake.addNote('Second/Manuscript/Elsewhere.md', note({ order: 1024 }, 'Far away.'));
    fake.addNote('Second/To-do.md', '');
    const loaded = await ready(fake);
    expect(storeOf(loaded.plugin).project?.title).toBe('My Novel');

    workOn(fake, 'Second/To-do.md');
    expect(offered(loaded, 'reveal-active-scene')).toBe(false); // not a note the binder shows
    workOn(fake, 'Second/Manuscript/Elsewhere.md');
    expect(offered(loaded, 'reveal-active-scene')).toBe(true);
    expect(offered(loaded, 'move-scene-up')).toBe(false); // moving works in the open project only

    run(loaded, 'reveal-active-scene');
    await until(() => binders(fake)[0]?.view != null && selectedTitle(paneOf(binders(fake)[0])) === 'Elsewhere', 'the row to be selected');
    expect(storeOf(loaded.plugin).project?.title).toBe('Second Book');
    expect(heading(paneOf(binders(fake)[0])).fullText).toBe('Second Book');
    expect(fake.loadLocalStorage(ACTIVE_PROJECT_KEY)).toBe('Second/Second.md'); // it is the project this device works on now
    expect(fake.calls).toEqual([]);
  });
});

describe('the command "Create project"', () => {
  function openWindow(loaded: Loaded): {
    modal: StubModal;
    name: TextComponent;
    location: DropdownComponent;
    create: ButtonComponent;
  } {
    loaded.command('create-project').callback?.();
    const modal = StubModal.opened[StubModal.opened.length - 1];
    if (!modal) throw new Error('no window was opened');
    const rows = modal.contentEl.settings;
    return {
      modal,
      name: rows[0]?.components[0] as TextComponent,
      location: rows[1]?.components[0] as DropdownComponent,
      create: rows[2]?.components[1] as ButtonComponent,
    };
  }

  it('opens a window offering the folders a project can go in', () => {
    const loaded = loadReady(novelVault());
    const { modal, location } = openWindow(loaded);
    expect(modal).toBeInstanceOf(CreateProjectModal);
    expect(modal.isOpen).toBe(true);
    // the top of the vault first; the existing project's own folders are not offered
    expect(location.selectEl.children.map((option) => option.value)).toEqual(['', 'Notes', 'Writing', 'Writing/Drafts']);
    expect(location.getValue()).toBe('');
    expect(notices()).toEqual([]);
  });

  it('creates the project from the answers and closes the window', async () => {
    const loaded = loadReady(novelVault());
    const { modal, name, location, create } = openWindow(loaded);
    name.type('Night Train');
    location.choose('Writing/Drafts');
    create.click();
    await until(() => !modal.isOpen, 'the window to close');

    expect(loaded.fake.textOf('Writing/Drafts/Night Train/Manuscript/Scene 1.md')).toContain('"status": "To do"');
    expect(loaded.fake.workspace.opened).toEqual(['Writing/Drafts/Night Train/Manuscript/Scene 1.md']);
    expect(notices()).toEqual(['Created the project "Night Train".']);
  });

  it('keeps the window open when the folder already exists, so another name can be tried', async () => {
    const loaded = loadReady(novelVault());
    const { modal, name, create } = openWindow(loaded);
    name.type('Novel');
    create.click();
    await until(() => notices().length > 0, 'the refusal');
    await until(() => !create.disabled, 'the button to come back');

    expect(notices()).toEqual(['There is already something called "Novel" here. Choose another name.']);
    expect(modal.isOpen).toBe(true);
    expect(loaded.fake.workspace.opened).toEqual([]);

    name.type('Novel two');
    create.click();
    await until(() => !modal.isOpen, 'the window to close');
    expect(loaded.fake.vault.getFolderByPath('Novel two/Manuscript')).not.toBeNull();
  });
});

describe('openNote', () => {
  it('opens a note that exists, in the current tab', async () => {
    const fake = novelVault();
    expect(await openNote(fake.app, 'Novel/Manuscript/Opening.md')).toBe(true);
    expect(fake.workspace.opened).toEqual(['Novel/Manuscript/Opening.md']);
    expect(await openNote(fake.app, '/Novel//Manuscript/Opening.md')).toBe(true); // an untidy path for the same note
    expect(fake.workspace.opened).toHaveLength(2);
  });

  it('never creates a note: a path with nothing at it, or a folder, is simply not opened', async () => {
    const fake = novelVault();
    const before = [...fake.vault.entries.keys()];
    expect(await openNote(fake.app, 'Novel/Manuscript/Nope.md')).toBe(false);
    expect(await openNote(fake.app, 'Novel/Manuscript')).toBe(false);
    expect(fake.workspace.opened).toEqual([]);
    expect([...fake.vault.entries.keys()]).toEqual(before);
  });
});

describe('the settings page', () => {
  interface Row {
    name: string;
    desc: string;
    heading: boolean;
  }

  function page(stub: StubPlugin): { tab: SpellbookSettingTab; rows: () => Row[]; element: FakeElement } {
    const tab = stub.settingTabs[0] as SpellbookSettingTab;
    const element = tab.containerEl as unknown as FakeElement;
    const rows = (): Row[] =>
      element.settings.map((row) => ({
        name: row.nameEl.text,
        desc: row.descEl.text,
        heading: row.settingEl.classes.has('setting-item-heading'),
      }));
    return { tab, rows, element };
  }

  it('shows the version and the projects found in the vault', () => {
    const fake = novelVault();
    fake.addNote('Hebrew/הרומן שלי/הרומן שלי.md', note({ spellbook: 'project', version: 1, title: 'הרומן שלי', binder: [] }));
    fake.addNote('Loose.md', note({ spellbook: 'project', version: 1, binder: [] }));
    const { stub } = loadReady(fake);
    const { tab, rows, element } = page(stub);
    expect(fake.localStorage.size).toBe(0);

    tab.display();

    expect(rows()).toEqual([
      { name: 'Spellbook', desc: 'Version 0.1.0', heading: false },
      { name: 'Projects in this vault', desc: '', heading: true },
      { name: 'Loose', desc: 'At the top of the vault', heading: false },
      { name: 'My Novel', desc: 'Novel', heading: false },
      { name: 'הרומן שלי', desc: 'Hebrew/הרומן שלי', heading: false },
      // After the projects: the one section a screen added, under its own heading.
      { name: 'Writing progress', desc: '', heading: true },
      { name: 'Colour scheme', desc: '', heading: true },
      { name: 'Writing modes', desc: '', heading: true },
      { name: 'Writing report', desc: '', heading: true },
      { name: 'Prose checks', desc: '', heading: true },
      { name: 'Snapshots', desc: '', heading: true },
      { name: 'Plot grid', desc: '', heading: true },
      { name: 'Welcome and help', desc: '', heading: true },
    ]);
    // titles and folders are the writer's own text: each picks its own direction
    for (const row of element.settings.slice(2, 5)) {
      expect(row.nameEl.attrs['dir']).toBe('auto');
      expect(row.descEl.attrs['dir']).toBe('auto');
    }
    // The section's own rows are drawn in a place of its own: one switch, off until the writer turns it on.
    const section = one(element, 'spellbook-settings-progress');
    expect(section.settings.map((row) => row.nameEl.text)).toEqual(['Count pasted text']);
    const toggle = section.settings[0]?.toggles[0];
    expect(toggle?.getValue()).toBe(false);
    toggle?.flip();
    expect(fake.localStorage.size).toBe(1); // the choice is kept on this device
    tab.display();
    expect(one(element, 'spellbook-settings-progress').settings[0]?.toggles[0]?.getValue()).toBe(true);
  });

  it('explains how to make a project when there are none', () => {
    const { stub } = loadReady();
    const { tab, rows } = page(stub);
    tab.display();
    expect(rows().map((row) => row.name)).toEqual(['Spellbook', 'Projects in this vault', '', 'Writing progress', 'Colour scheme', 'Writing modes', 'Writing report', 'Prose checks', 'Snapshots', 'Plot grid', 'Welcome and help']);
    expect(rows()[2]?.name).toBe('');
    expect(rows()[2]?.desc).toMatch(/No projects yet/);
    expect(rows()[2]?.desc).toMatch(/"Spellbook: Create project"/);
    expect(rows()[2]?.desc).toMatch(/"Spellbook: Create sample project"/);
  });

  it('says so while Obsidian is still starting', () => {
    const { stub } = load(novelVault());
    const { tab, rows } = page(stub);
    tab.display();
    expect(rows().map((row) => row.name)).toEqual(['Spellbook', 'Projects in this vault', '']);
    expect(rows()[2]?.desc).toMatch(/still starting/);
  });

  it('follows the vault while it is open, and stops when it is closed', async () => {
    const { plugin, stub } = loadReady();
    const { tab, rows } = page(stub);
    /** The rows between the "Projects in this vault" heading and the first heading a screen added. */
    const projects = (): Row[] => {
      const after = rows().slice(2);
      const next = after.findIndex((row) => row.heading);
      return next < 0 ? after : after.slice(0, next);
    };
    tab.display();
    expect(rows()).toHaveLength(11);
    expect(projects().map((row) => row.name)).toEqual(['']); // "No projects yet"

    await plugin.createProject('First');
    expect(projects()).toEqual([{ name: 'First', desc: 'First', heading: false }]);
    expect(rows().filter((row) => row.heading).map((row) => row.name)).toEqual(['Projects in this vault', 'Writing progress', 'Colour scheme', 'Writing modes', 'Writing report', 'Prose checks', 'Snapshots', 'Plot grid', 'Welcome and help']);

    tab.display(); // opened again: still one listener's worth of rows
    await plugin.createProject('Second');
    expect(projects().map((row) => row.name)).toEqual(['First', 'Second']);

    tab.hide();
    expect(rows()).toEqual([]);
    await plugin.createProject('Third');
    expect(rows()).toEqual([]); // closed: nothing is drawn behind the writer's back
    tab.display();
    expect(projects().map((row) => row.name)).toEqual(['First', 'Second', 'Third']);
  });

  describe('with sections that features added', () => {
    interface Drawn {
      tab: SpellbookSettingTab;
      element: FakeElement;
      log: string[];
    }

    /** A settings page for a plugin whose features added these sections. */
    function pageWith(sections: SettingsSection[]): Drawn {
      const host = { manifest: MANIFEST, store: null, features: { settingsSections: sections } };
      const tab = new SpellbookSettingTab(new FakeObsidian().app, host as never);
      return { tab, element: tab.containerEl as unknown as FakeElement, log: [] };
    }

    const headings = (element: FakeElement): string[] =>
      element.settings.filter((row) => row.settingEl.classes.has('setting-item-heading')).map((row) => row.nameEl.text);

    it('shows each under a heading of its own, after the projects, in the order they were added', () => {
      const log: string[] = [];
      const section = (id: string, title: string): SettingsSection => ({
        id,
        title,
        render: (place) => {
          log.push(`draw ${id}`);
          (place as unknown as FakeElement).createDiv({ cls: `spellbook-test-${id}`, text: `rows of ${id}` });
        },
      });
      const { tab, element } = pageWith([section('progress', 'Writing progress'), section('planner', 'Planner')]);
      tab.display();

      expect(headings(element)).toEqual(['Projects in this vault', 'Writing progress', 'Planner']);
      expect(log).toEqual(['draw progress', 'draw planner']);
      // Each section draws into a place that is its own.
      const places = element.withClass('spellbook-settings-section');
      expect(places.map((place) => [...place.classes].sort())).toEqual([
        ['spellbook-settings-progress', 'spellbook-settings-section'],
        ['spellbook-settings-planner', 'spellbook-settings-section'],
      ]);
      expect(places.map((place) => place.children.map((child) => child.text))).toEqual([['rows of progress'], ['rows of planner']]);
    });

    it('tells a section when its rows are taken away: on closing, and before drawing again', () => {
      const log: string[] = [];
      const { tab } = pageWith([
        {
          id: 'progress',
          title: 'Writing progress',
          render: () => {
            log.push('draw');
            return () => log.push('gone');
          },
        },
      ]);
      tab.display();
      expect(log).toEqual(['draw']);
      tab.display(); // shown again: the old rows go first
      expect(log).toEqual(['draw', 'gone', 'draw']);
      tab.hide();
      expect(log).toEqual(['draw', 'gone', 'draw', 'gone']);
      tab.hide(); // closed already: nothing more to take away
      expect(log).toEqual(['draw', 'gone', 'draw', 'gone']);
    });

    it('keeps the rest of the page when one section fails', () => {
      const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const { tab, element } = pageWith([
        {
          id: 'broken',
          title: 'Broken',
          render: () => {
            throw new Error('bug in a section');
          },
        },
        { id: 'fine', title: 'Fine', render: () => undefined },
      ]);
      tab.display();
      expect(headings(element)).toEqual(['Projects in this vault', 'Broken', 'Fine']);
      expect(element.withClass('spellbook-settings-broken')[0]?.settings[0]?.descEl.text).toMatch(/could not be shown/);
      expect(logged).toHaveBeenCalledTimes(1);
      logged.mockRestore();
    });
  });
});
