// The Obsidian side of the vault doorway, tested against a small imitation of
// the app (tests/fakeObsidianApp.ts). These tests check the plugin's own
// logic: which Obsidian doorways it uses and how it behaves at start-up. They
// cannot prove how the real app behaves; that needs trying in Obsidian.

import { describe, expect, it } from 'vitest';
import { ProjectStore } from '../src/core/projectStore';
import { VaultFileMissingError } from '../src/core/vaultPort';
import type { VaultEvent } from '../src/core/vaultPort';
import SpellbookPlugin from '../src/main';
import { ObsidianVault } from '../src/obsidian/obsidianVault';
import { localToday } from '../src/obsidian/systemClock';
import { FakeObsidian, note } from './fakeObsidianApp';
import { ManualTimers } from './memoryVault';

const INDEX = { spellbook: 'project', version: 1, title: 'My Novel', binder: ['Manuscript/Opening.md'] };

function novelVault(): FakeObsidian {
  const fake = new FakeObsidian();
  fake.addNote('Novel/Novel.md', note(INDEX, 'Index text.'));
  fake.addNote('Novel/Manuscript/Opening.md', note({ status: 'To do', order: 1024 }, 'It was a dark night.\n'));
  fake.addNote('Notes/Plain.md', 'No properties here.');
  fake.addNote('Novel/Manuscript/cover.png', 'not really a picture');
  return fake;
}

/** An adapter on a vault that has finished starting up, with every event recorded. */
function started(fake: FakeObsidian = novelVault()): { fake: FakeObsidian; vault: ObsidianVault; events: VaultEvent[] } {
  const vault = new ObsidianVault(fake.app);
  const events: VaultEvent[] = [];
  vault.on((event) => events.push(event));
  vault.start();
  fake.finishStartup();
  events.length = 0;
  return { fake, vault, events };
}

describe('ObsidianVault: reading', () => {
  it('lists markdown notes with their indexed frontmatter', () => {
    const { vault } = started();
    expect(vault.listMarkdownFiles()).toEqual([
      { path: 'Novel/Novel.md', frontmatter: INDEX },
      { path: 'Novel/Manuscript/Opening.md', frontmatter: { status: 'To do', order: 1024 } },
      { path: 'Notes/Plain.md', frontmatter: null },
    ]);
  });

  it('can list only the notes inside one folder', () => {
    const { vault, fake } = started();
    fake.addNote('Novel 2/Other.md', 'x'); // a folder whose name merely starts the same
    expect(vault.listMarkdownFiles('Novel').map((file) => file.path)).toEqual([
      'Novel/Novel.md',
      'Novel/Manuscript/Opening.md',
    ]);
    expect(vault.listMarkdownFiles('Novel/Manuscript').map((file) => file.path)).toEqual(['Novel/Manuscript/Opening.md']);
    expect(vault.listMarkdownFiles('')).toHaveLength(4);
  });

  it('knows what exists, without telling capitals apart', () => {
    const { vault } = started();
    expect(vault.exists('Novel')).toBe(true);
    expect(vault.exists('Novel/Novel.md')).toBe(true);
    expect(vault.exists('Novel/Manuscript/opening.md')).toBe(true);
    expect(vault.exists('novel')).toBe(true);
    expect(vault.exists('Novel/Manuscript/Closing.md')).toBe(false);
    expect(vault.exists('Nowhere/Opening.md')).toBe(false);
    expect(vault.exists('Nove')).toBe(false);
  });

  it('reads frontmatter from the file itself, not from the index', async () => {
    const { vault, fake } = started();
    // The file changes on disk, but Obsidian has not indexed it yet.
    fake.vault.text.set('Novel/Novel.md', note({ ...INDEX, title: 'Changed on disk' }));
    expect(await vault.readFrontmatter('Novel/Novel.md')).toEqual({ ...INDEX, title: 'Changed on disk' });
    expect(vault.listMarkdownFiles('Novel')[0]?.frontmatter).toEqual(INDEX); // the index still lags
  });

  it('returns null for a note without properties, and rejects for a missing or unreadable one', async () => {
    const { vault, fake } = started();
    expect(await vault.readFrontmatter('Notes/Plain.md')).toBeNull();
    await expect(vault.readFrontmatter('Nowhere.md')).rejects.toBeInstanceOf(VaultFileMissingError);
    await expect(vault.readFrontmatter('Novel')).rejects.toBeInstanceOf(VaultFileMissingError); // a folder is not a note
    fake.addNote('Broken.md', '---\n{ this is not valid\n---\nbody');
    await expect(vault.readFrontmatter('Broken.md')).rejects.toThrow();
    await expect(vault.readFrontmatter('Broken.md')).rejects.not.toBeInstanceOf(VaultFileMissingError);
  });

  it('reads the whole text of a note', async () => {
    const { vault } = started();
    expect(await vault.readText('Notes/Plain.md')).toBe('No properties here.');
    await expect(vault.readText('Nowhere.md')).rejects.toBeInstanceOf(VaultFileMissingError);
  });
});

describe('ObsidianVault: writing', () => {
  it('changes properties through processFrontMatter and leaves the text alone', async () => {
    const { vault, fake } = started();
    const saved = await vault.updateFrontmatter('Novel/Manuscript/Opening.md', (frontmatter) => {
      frontmatter['order'] = 2048;
      return true;
    });
    expect(saved).toBe(true);
    expect(fake.calls).toEqual(['processFrontMatter Novel/Manuscript/Opening.md']);
    expect(await vault.readFrontmatter('Novel/Manuscript/Opening.md')).toEqual({ status: 'To do', order: 2048 });
    expect(fake.textOf('Novel/Manuscript/Opening.md').endsWith('---\nIt was a dark night.\n')).toBe(true);
  });

  it('writes nothing at all when the change says no', async () => {
    const { vault, fake, events } = started();
    const before = fake.textOf('Novel/Novel.md');

    const saved = await vault.updateFrontmatter('Novel/Novel.md', (frontmatter) => {
      frontmatter['binder'] = ['tampered']; // even if the callback fiddled with its copy
      return false;
    });

    expect(saved).toBe(false);
    expect(fake.textOf('Novel/Novel.md')).toBe(before);
    expect(fake.saves).toEqual([]);
    expect(events).toEqual([]);
  });

  it('passes on real errors, and writes nothing then either', async () => {
    const { vault, fake } = started();
    fake.addNote('Broken.md', '---\n{ this is not valid\n---\nbody');
    await expect(vault.updateFrontmatter('Broken.md', () => true)).rejects.toThrow();
    expect(fake.textOf('Broken.md')).toBe('---\n{ this is not valid\n---\nbody');

    await expect(
      vault.updateFrontmatter('Novel/Novel.md', () => {
        throw new Error('bug in the callback');
      }),
    ).rejects.toThrow('bug in the callback');
    expect(fake.saves).toEqual([]);
    await expect(vault.updateFrontmatter('Nowhere.md', () => true)).rejects.toBeInstanceOf(VaultFileMissingError);
  });

  it('gives a note without properties an empty set to fill in', async () => {
    const { vault } = started();
    await vault.updateFrontmatter('Notes/Plain.md', (frontmatter) => {
      expect(frontmatter).toEqual({});
      frontmatter['order'] = 1024;
      return true;
    });
    expect(await vault.readFrontmatter('Notes/Plain.md')).toEqual({ order: 1024 });
    expect(await vault.readText('Notes/Plain.md')).toContain('No properties here.');
  });

  it('creates a note with a properties block followed by its text', async () => {
    const { vault, fake } = started();
    const path = await vault.createFile('Novel/Manuscript/Two.md', 'Body.\n', { synopsis: '', order: 2048 });
    expect(path).toBe('Novel/Manuscript/Two.md');
    const text = fake.textOf(path);
    expect(text.startsWith('---\n')).toBe(true);
    expect(text.endsWith('\n---\nBody.\n')).toBe(true);
    expect(await vault.readFrontmatter(path)).toEqual({ synopsis: '', order: 2048 });
  });

  it('creates a note without properties as plain text, and refuses to overwrite', async () => {
    const { vault, fake } = started();
    await vault.createFile('Novel/To-do.md', '');
    expect(fake.textOf('Novel/To-do.md')).toBe('');
    await expect(vault.createFile('Novel/To-do.md', 'again')).rejects.toThrow();
    expect(fake.textOf('Novel/To-do.md')).toBe('');
    await expect(vault.createFile('No such folder/Note.md', 'x')).rejects.toThrow();
  });

  it('creates folders, and is content when one is already there', async () => {
    const { vault, fake } = started();
    await vault.createFolder('Novel/Research');
    expect(fake.vault.getFolderByPath('Novel/Research')).not.toBeNull();
    await expect(vault.createFolder('Novel/Research')).resolves.toBeUndefined();
    await expect(vault.createFolder('Novel')).resolves.toBeUndefined();
  });

  it('renames through the file manager (so links are updated) and reports the new path', async () => {
    const { vault, fake, events } = started();
    const path = await vault.rename('Novel/Manuscript/Opening.md', 'Novel/Manuscript/First.md');
    expect(path).toBe('Novel/Manuscript/First.md');
    expect(fake.calls).toEqual(['renameFile Novel/Manuscript/Opening.md -> Novel/Manuscript/First.md']);
    expect(events).toEqual([
      { type: 'rename', path: 'Novel/Manuscript/First.md', oldPath: 'Novel/Manuscript/Opening.md', folder: false },
    ]);
    await expect(vault.rename('Nowhere.md', 'X.md')).rejects.toBeInstanceOf(VaultFileMissingError);
  });

  it('deletes by moving to the trash, never outright', async () => {
    const { vault, fake, events } = started();
    await vault.trash('Novel/Manuscript/Opening.md');
    expect(fake.calls).toEqual(['trashFile Novel/Manuscript/Opening.md']);
    expect(fake.trashed).toEqual(['Novel/Manuscript/Opening.md']);
    expect(events).toEqual([{ type: 'delete', path: 'Novel/Manuscript/Opening.md', folder: false }]);
    await expect(vault.trash('Nowhere.md')).rejects.toBeInstanceOf(VaultFileMissingError);
  });
});

describe('ObsidianVault: events and start-up', () => {
  it('passes on vault and index events in the shape the store expects', async () => {
    const { vault, fake, events } = started();
    await vault.createFolder('Novel/Research');
    const path = await vault.createFile('Novel/Research/Trains.md', 'x', { kind: 'research' });
    await vault.updateFrontmatter(path, (frontmatter) => {
      frontmatter['kind'] = 'notes';
      return true;
    });
    expect(events).toEqual([
      { type: 'create', path: 'Novel/Research', folder: true },
      { type: 'create', path: 'Novel/Research/Trains.md', folder: false },
      { type: 'metadata', path: 'Novel/Research/Trains.md', frontmatter: { kind: 'research' } },
      { type: 'modify', path: 'Novel/Research/Trains.md' },
      { type: 'metadata', path: 'Novel/Research/Trains.md', frontmatter: { kind: 'notes' } },
    ]);
    fake.vault.trigger('modify', fake.vault.getFolderByPath('Novel')); // not a file: ignored
    expect(events).toHaveLength(5);
  });

  it('ignores the flood of "create" events while Obsidian is still loading the vault', () => {
    const fake = novelVault();
    const vault = new ObsidianVault(fake.app);
    const events: VaultEvent[] = [];
    vault.on((event) => events.push(event));
    vault.start();

    for (const file of fake.vault.getMarkdownFiles()) fake.vault.trigger('create', file);
    expect(events).toEqual([]);

    fake.workspace.becomeReady();
    expect(events).toEqual([{ type: 'refresh' }]);
    fake.vault.trigger('create', fake.addNote('Later.md', 'x'));
    expect(events).toEqual([{ type: 'refresh' }, { type: 'create', path: 'Later.md', folder: false }]);
  });

  it('says "look again" the first time the index reports it has caught up, and only then', () => {
    const fake = novelVault();
    const vault = new ObsidianVault(fake.app);
    const events: VaultEvent[] = [];
    vault.on((event) => events.push(event));
    vault.start();
    fake.workspace.becomeReady();
    events.length = 0;

    fake.metadataCache.trigger('resolved');
    expect(events).toEqual([{ type: 'refresh' }]);
    fake.metadataCache.trigger('resolved'); // fires again after every later edit
    fake.metadataCache.trigger('resolved');
    expect(events).toEqual([{ type: 'refresh' }]);
  });

  it('starts at once when the layout is already ready (plugin enabled later)', () => {
    const fake = novelVault();
    fake.finishStartup();
    const vault = new ObsidianVault(fake.app);
    const events: VaultEvent[] = [];
    vault.on((event) => events.push(event));
    vault.start();
    expect(events).toEqual([{ type: 'refresh' }]);
    expect(vault.listMarkdownFiles('Novel')).toHaveLength(2);
  });

  it('unhooks everything on stop, and can stop before the layout was ever ready', () => {
    const { vault, fake, events } = started();
    expect(fake.vault.listenerCount()).toBe(4);
    vault.stop();
    expect(fake.vault.listenerCount()).toBe(0);
    expect(fake.metadataCache.listenerCount()).toBe(0);
    fake.vault.trigger('create', fake.addNote('After.md', 'x'));
    expect(events).toEqual([]);

    const early = novelVault();
    const second = new ObsidianVault(early.app);
    second.on((event) => events.push(event));
    second.start();
    second.stop();
    early.finishStartup();
    expect(early.vault.listenerCount()).toBe(0);
    expect(events).toEqual([]);
  });

  it('stops telling a listener that has unsubscribed', async () => {
    const { vault } = started();
    const heard: VaultEvent[] = [];
    const off = vault.on((event) => heard.push(event));
    await vault.createFolder('One');
    off();
    await vault.createFolder('Two');
    expect(heard).toEqual([{ type: 'create', path: 'One', folder: true }]);
  });
});

describe('the store on top of ObsidianVault', () => {
  function storeOn(fake: FakeObsidian): { store: ProjectStore; vault: ObsidianVault; timers: ManualTimers } {
    const vault = new ObsidianVault(fake.app);
    const timers = new ManualTimers();
    const store = new ProjectStore({ vault, today: () => '2026-10-13', setTimer: timers.set, random: Math.random });
    store.start();
    vault.start();
    return { store, vault, timers };
  }

  it('finds projects even though the metadata cache was empty when the plugin loaded', () => {
    const fake = novelVault();
    const { store } = storeOn(fake);
    expect(store.listProjects()).toEqual([]); // plugin loaded: nothing indexed yet

    fake.finishStartup();
    expect(store.listProjects()).toEqual([{ indexPath: 'Novel/Novel.md', folder: 'Novel', title: 'My Novel' }]);
  });

  it('finds projects when notes are indexed one by one after the layout is ready', () => {
    const fake = novelVault();
    const { store } = storeOn(fake);
    fake.workspace.becomeReady();
    expect(store.listProjects()).toEqual([]);

    for (const file of fake.vault.getMarkdownFiles()) fake.metadataCache.index(file);
    expect(store.listProjects().map((p) => p.title)).toEqual(['My Novel']);
  });

  it('runs a whole round trip: create a project, add, rename, move and delete scenes', async () => {
    const fake = new FakeObsidian();
    fake.finishStartup();
    const { store, timers } = storeOn(fake);

    const created = await store.createProject('Night Train');
    expect(created.status).toBe('done');
    expect(fake.vault.getFolderByPath('Night Train/Manuscript')).not.toBeNull();
    expect(fake.vault.getFolderByPath('Night Train/Stats')).not.toBeNull();
    expect(fake.textOf('Night Train/To-do.md')).toBe('');

    expect((await store.openProject('Night Train/Night Train.md')).status).toBe('done');
    expect((await store.addScene('Opening')).status).toBe('done');
    expect((await store.addScene('The Letter')).status).toBe('done');
    const folder = await store.addFolder('Part one');
    expect(folder.status).toBe('done');
    if (folder.status !== 'done') return;
    expect((await store.moveNode({ kind: 'scene', path: 'Manuscript/The Letter.md' }, { at: 'end', parentId: folder.value.id })).status).toBe('done');
    expect((await store.renameScene('Manuscript/Opening.md', 'Prologue')).status).toBe('done');
    expect((await store.moveNode({ kind: 'scene', path: 'Manuscript/The Letter.md' }, { at: 'start', parentId: null })).status).toBe('done');
    timers.advance(5000);
    await store.idle();

    const index = await new ObsidianVault(fake.app).readFrontmatter('Night Train/Night Train.md');
    expect(index).toEqual({
      spellbook: 'project',
      version: 1,
      title: 'Night Train',
      binder: ['Manuscript/The Letter.md', 'Manuscript/Prologue.md', { folder: 'Part one', id: folder.value.id, children: [] }],
    });
    const letter = await new ObsidianVault(fake.app).readFrontmatter('Night Train/Manuscript/The Letter.md');
    const prologue = await new ObsidianVault(fake.app).readFrontmatter('Night Train/Manuscript/Prologue.md');
    expect(letter?.['order']).toBeLessThan(prologue?.['order'] as number);
    expect(letter).toMatchObject({ synopsis: '', status: 'To do', label: '', compile: true, created: '2026-10-13' });

    expect((await store.deleteScene('Manuscript/Prologue.md')).status).toBe('done');
    expect(fake.trashed).toEqual(['Night Train/Manuscript/Prologue.md']);
    expect(store.project?.tree.map((node) => (node.kind === 'scene' ? node.title : node.name))).toEqual(['The Letter', 'Part one']);
    // The whole session used only the safe doorways.
    expect(fake.calls.every((call) => /^(processFrontMatter|renameFile|trashFile) /.test(call))).toBe(true);
    store.dispose();
  });
});

describe('the plugin entry point', () => {
  it('loads, starts the store, finds projects after start-up, and cleans up on unload', () => {
    const fake = novelVault();
    const manifest = { id: 'spellbook-novel-writer', name: 'Spellbook', version: '0.1.0' };
    const plugin = new SpellbookPlugin(fake.app, manifest as never);

    plugin.onload();
    expect(plugin.store).toBeInstanceOf(ProjectStore);
    expect(plugin.store.listProjects()).toEqual([]);
    fake.finishStartup();
    expect(plugin.store.listProjects().map((p) => p.title)).toEqual(['My Novel']);
    expect(fake.saves).toEqual([]); // loading the plugin changes no note

    plugin.unload();
    expect(fake.vault.listenerCount()).toBe(0);
    expect(fake.metadataCache.listenerCount()).toBe(0);
  });
});

describe('localToday', () => {
  it('gives the local date as YYYY-MM-DD', () => {
    const today = localToday();
    expect(today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const now = new Date();
    const expected = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('-');
    expect(today).toBe(expected);
  });
});
