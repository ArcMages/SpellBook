// The plugin entry point, its two commands and its settings page, run against
// the imitation of the Obsidian app (tests/fakeObsidianApp.ts). These tests
// check the plugin's own behaviour from command to notes; they cannot prove
// how the real app behaves or looks.

import { beforeEach, describe, expect, it } from 'vitest';
import { ProjectStore } from '../src/core/projectStore';
import SpellbookPlugin from '../src/main';
import { openNote } from '../src/obsidian/openNote';
import { SpellbookSettingTab } from '../src/settings';
import { CreateProjectModal } from '../src/ui/createProjectModal';
import { FakeObsidian, note } from './fakeObsidianApp';
import { Modal as StubModal, Notice as StubNotice } from './obsidianStub';
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

/** The plugin, loaded the way Obsidian loads it. The app is still starting up. */
function load(fake: FakeObsidian = new FakeObsidian()): Loaded {
  const plugin = new SpellbookPlugin(fake.app, MANIFEST as never);
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
});

describe('loading and unloading', () => {
  it('registers the settings page and the two commands straight away', () => {
    const { stub } = load();
    expect(stub.settingTabs).toHaveLength(1);
    expect(stub.settingTabs[0]).toBeInstanceOf(SpellbookSettingTab);
    // Obsidian puts "Spellbook: " in front of the names itself.
    expect(stub.commands.map((command) => [command.id, command.name])).toEqual([
      ['create-project', 'Create project'],
      ['create-sample-project', 'Create sample project'],
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

  it('changes no note by loading', () => {
    const fake = novelVault();
    const before = new Map(fake.vault.text);
    const { plugin } = loadReady(fake);
    expect(fake.saves).toEqual([]);
    expect(fake.calls).toEqual([]);
    expect(new Map(fake.vault.text)).toEqual(before);
    expect(storeOf(plugin).project).toBeNull(); // nothing is opened either
    expect(notices()).toEqual([]);
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

describe('the command "Create sample project"', () => {
  it('creates the sample novel, opens it and shows its first scene', async () => {
    const { fake, plugin, command } = loadReady(novelVault());
    const before = new Map(fake.vault.text);

    command('create-sample-project').callback?.();
    await until(() => fake.workspace.opened.length > 0, 'the first scene to open');

    expect(notesUnder(fake, 'Sample Novel')).toHaveLength(57);
    expect(notesUnder(fake, 'Sample Novel/Manuscript')).toHaveLength(53);
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

    expect(notesUnder(fake, 'Sample Novel')).toHaveLength(57);
    expect(notesUnder(fake, 'Sample Novel 2')).toHaveLength(57);
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
    expect(storeOf(plugin).project).toBeNull();
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

    tab.display();

    expect(rows()).toEqual([
      { name: 'Spellbook', desc: 'Version 0.1.0', heading: false },
      { name: 'Projects in this vault', desc: '', heading: true },
      { name: 'Loose', desc: 'At the top of the vault', heading: false },
      { name: 'My Novel', desc: 'Novel', heading: false },
      { name: 'הרומן שלי', desc: 'Hebrew/הרומן שלי', heading: false },
    ]);
    // titles and folders are the writer's own text: each picks its own direction
    for (const row of element.settings.slice(2)) {
      expect(row.nameEl.attrs['dir']).toBe('auto');
      expect(row.descEl.attrs['dir']).toBe('auto');
    }
  });

  it('explains how to make a project when there are none', () => {
    const { stub } = loadReady();
    const { tab, rows } = page(stub);
    tab.display();
    expect(rows()).toHaveLength(3);
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
    tab.display();
    expect(rows()).toHaveLength(3);

    await plugin.createProject('First');
    expect(rows().slice(2)).toEqual([{ name: 'First', desc: 'First', heading: false }]);

    tab.display(); // opened again: still one listener's worth of rows
    await plugin.createProject('Second');
    expect(rows().slice(2).map((row) => row.name)).toEqual(['First', 'Second']);

    tab.hide();
    expect(rows()).toEqual([]);
    await plugin.createProject('Third');
    expect(rows()).toEqual([]); // closed: nothing is drawn behind the writer's back
    tab.display();
    expect(rows().slice(2).map((row) => row.name)).toEqual(['First', 'Second', 'Third']);
  });
});
