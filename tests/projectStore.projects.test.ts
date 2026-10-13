// Project store: finding projects, opening one, read-only projects, creating a project.

import { describe, expect, it } from 'vitest';
import { folderRef, sceneRef } from '../src/core/binderTree';
import type { IntentResult } from '../src/core/types';
import { MemoryVault } from './memoryVault';
import {
  binderOnDisk,
  draw,
  makeStore,
  openSeeded,
  picture,
  project,
  seedProject,
  settle,
  valueOf,
} from './storeHarness';

describe('finding projects', () => {
  it('finds every project index in the vault, sorted by title, and nothing else', () => {
    const vault = new MemoryVault();
    seedProject(vault, { folder: 'Novel', title: 'Zebra Crossing' });
    seedProject(vault, { folder: 'Writing/Second', title: 'Apple Orchard' });
    seedProject(vault, { folder: 'Untitled Thing', title: null });
    vault.seed('Notes/Shopping.md', { frontmatter: { tags: ['list'] } });
    vault.seed('Notes/Almost.md', { frontmatter: { spellbook: 'draft' } });
    vault.seed('Plain.md');
    const { store } = makeStore(vault);

    expect(store.listProjects()).toEqual([
      { indexPath: 'Writing/Second/Second.md', folder: 'Writing/Second', title: 'Apple Orchard' },
      { indexPath: 'Untitled Thing/Untitled Thing.md', folder: 'Untitled Thing', title: 'Untitled Thing' },
      { indexPath: 'Novel/Novel.md', folder: 'Novel', title: 'Zebra Crossing' },
    ]);
  });

  it('finds nothing in a vault without projects', () => {
    const vault = new MemoryVault().seed('Plain.md').seed('Notes/Other.md', { frontmatter: { title: 'x' } });
    expect(makeStore(vault).store.listProjects()).toEqual([]);
  });

  describe('when the plugin loads before Obsidian has indexed the notes', () => {
    it('finds the projects once each note is indexed', () => {
      const vault = new MemoryVault();
      seedProject(vault, { title: 'Early Bird' });
      vault.forgetIndex();
      const { store, changes } = makeStore(vault);
      expect(store.listProjects()).toEqual([]); // nothing is known yet

      vault.finishIndexing('each-note');
      expect(store.listProjects().map((p) => p.title)).toEqual(['Early Bird']);
      expect(changes).toContainEqual({ type: 'projects' });
    });

    it('finds the projects when the index is restored in one go', () => {
      const vault = new MemoryVault();
      seedProject(vault, { title: 'Early Bird' });
      seedProject(vault, { folder: 'Other', title: 'Second' });
      vault.forgetIndex();
      const { store, changes } = makeStore(vault);
      expect(store.listProjects()).toEqual([]);

      vault.finishIndexing('refresh-only');
      expect(store.listProjects().map((p) => p.title)).toEqual(['Early Bird', 'Second']);
      expect(changes).toEqual([{ type: 'projects' }]);
    });

    it('can open a project by path before the index is ready', async () => {
      const vault = new MemoryVault();
      const indexPath = seedProject(vault, { scenes: { A: 1024 } });
      vault.forgetIndex();
      const { store } = makeStore(vault);
      const snapshot = valueOf(await store.openProject(indexPath));
      expect(draw(snapshot.tree)).toBe('A');
      expect(store.listProjects().map((p) => p.indexPath)).toEqual([indexPath]);
    });
  });

  it('notices a project that appears later', async () => {
    const { store, vault, changes } = makeStore();
    vault.external.create('Later/Later.md', { frontmatter: { spellbook: 'project', title: 'Came Later' } });
    expect(store.listProjects()).toEqual([{ indexPath: 'Later/Later.md', folder: 'Later', title: 'Came Later' }]);
    expect(changes).toEqual([{ type: 'projects' }]);
  });

  it('notices a note that becomes a project, and one that stops being one', () => {
    const vault = new MemoryVault().seed('Idea/Idea.md', { frontmatter: { tags: ['idea'] } });
    const { store } = makeStore(vault);
    expect(store.listProjects()).toEqual([]);

    vault.external.editFrontmatter('Idea/Idea.md', (fm) => {
      fm['spellbook'] = 'project';
    });
    expect(store.listProjects().map((p) => p.title)).toEqual(['Idea']);

    vault.external.editFrontmatter('Idea/Idea.md', (fm) => {
      delete fm['spellbook'];
    });
    expect(store.listProjects()).toEqual([]);
  });

  it('follows a title that is changed', () => {
    const vault = new MemoryVault();
    const indexPath = seedProject(vault, { title: 'Working Title' });
    const { store, changes } = makeStore(vault);
    vault.external.editFrontmatter(indexPath, (fm) => {
      fm['title'] = 'Final Title';
    });
    expect(store.listProjects().map((p) => p.title)).toEqual(['Final Title']);
    expect(changes).toEqual([{ type: 'projects' }]);
  });

  it('does not announce a change when an ordinary note is edited', () => {
    const vault = new MemoryVault().seed('Notes/Plain.md', { frontmatter: { tags: [] } });
    seedProject(vault);
    const { changes } = makeStore(vault);
    vault.external.editFrontmatter('Notes/Plain.md', (fm) => {
      fm['tags'] = ['x'];
    });
    vault.external.write('Novel/Novel.md', { body: 'new text' });
    expect(changes).toEqual([]);
  });

  it('forgets a project whose index note or folder is deleted', () => {
    const vault = new MemoryVault();
    seedProject(vault, { folder: 'One', title: 'One' });
    seedProject(vault, { folder: 'Two', title: 'Two', scenes: { A: 1 } });
    const { store } = makeStore(vault);

    vault.external.delete('One/One.md');
    expect(store.listProjects().map((p) => p.title)).toEqual(['Two']);
    vault.external.delete('Two');
    expect(store.listProjects()).toEqual([]);
  });

  it('follows an index note or project folder that is renamed', () => {
    const vault = new MemoryVault();
    seedProject(vault, { folder: 'Novel', title: null });
    const { store } = makeStore(vault);

    vault.external.rename('Novel/Novel.md', 'Novel/Book.md');
    // the title came from the file name, so it follows the new name
    expect(store.listProjects()).toEqual([{ indexPath: 'Novel/Book.md', folder: 'Novel', title: 'Book' }]);

    vault.external.rename('Novel', 'Shelf/Saga');
    expect(store.listProjects()).toEqual([{ indexPath: 'Shelf/Saga/Book.md', folder: 'Shelf/Saga', title: 'Book' }]);
  });
});

describe('opening a project', () => {
  it('shows the binder as a tree, with Unfiled and Missing worked out, and writes nothing', async () => {
    const vault = new MemoryVault();
    const indexPath = seedProject(vault, {
      binder: [
        'Manuscript/Opening.md',
        { folder: 'Part one', id: 'f-one', children: ['Manuscript/The Letter.md', 'Manuscript/Lost.md'] },
        'Manuscript/Ending.md',
      ],
      scenes: { Opening: 1024, 'The Letter': 2048, Ending: 3072, 'Loose Idea': null },
    });
    vault.seed('Novel/Manuscript/Sketches/Deep.md');
    vault.seed('Novel/Research/Trains.md');
    vault.seed('Novel/To-do.md');
    vault.seed('Novel/Manuscript/cover.png');
    vault.seed('Elsewhere/Manuscript/Other.md');
    const { store, changes } = makeStore(vault);

    const snapshot = valueOf(await store.openProject(indexPath));

    expect(snapshot).toMatchObject({
      indexPath,
      folder: 'Novel',
      title: 'My Novel',
      readOnly: false,
      error: null,
      notes: [],
    });
    expect(snapshot.tree).toEqual([
      { kind: 'scene', path: 'Manuscript/Opening.md', title: 'Opening', missing: false },
      {
        kind: 'folder',
        id: 'f-one',
        name: 'Part one',
        children: [
          { kind: 'scene', path: 'Manuscript/The Letter.md', title: 'The Letter', missing: false },
          { kind: 'scene', path: 'Manuscript/Lost.md', title: 'Lost', missing: true },
        ],
      },
      { kind: 'scene', path: 'Manuscript/Ending.md', title: 'Ending', missing: false },
    ]);
    // Missing: in the binder, no note. Kept, because it may still be syncing.
    expect(snapshot.missing).toEqual(['Manuscript/Lost.md']);
    // Unfiled: notes under Manuscript/ (at any depth) that the binder does not list.
    expect(snapshot.unfiled).toEqual(['Manuscript/Loose Idea.md', 'Manuscript/Sketches/Deep.md']);
    expect(store.project).toBe(snapshot);
    expect(changes).toEqual([{ type: 'project' }]);
    expect(vault.writes).toEqual([]);
  });

  it('uses the file name as the title when the index has none', async () => {
    const { store } = await openSeeded({ folder: 'Shelf/Night Train', title: null });
    expect(project(store)).toMatchObject({ title: 'Night Train', folder: 'Shelf/Night Train' });
  });

  it('refuses a note that is not a project, and a path with no note', async () => {
    const vault = new MemoryVault().seed('Notes/Plain.md', { frontmatter: { title: 'x' } }).seed('Bare.md');
    const { store } = makeStore(vault);
    expect(await store.openProject('Notes/Plain.md')).toMatchObject({ status: 'refused', reason: 'not-a-project' });
    expect(await store.openProject('Bare.md')).toMatchObject({ status: 'refused', reason: 'not-a-project' });
    expect(await store.openProject('Nowhere/Gone.md')).toMatchObject({ status: 'refused', reason: 'not-found' });
    expect(store.project).toBeNull();
  });

  it('switches from one project to another, and closes', async () => {
    const vault = new MemoryVault();
    const first = seedProject(vault, { folder: 'One', title: 'One', scenes: { A: 1 } });
    const second = seedProject(vault, { folder: 'Two', title: 'Two', scenes: { B: 1 } });
    const { store, changes } = makeStore(vault);

    await store.openProject(first);
    expect(picture(store)).toBe('A');
    await store.openProject(second);
    expect(project(store).title).toBe('Two');
    expect(picture(store)).toBe('B');

    changes.length = 0;
    await store.closeProject();
    expect(store.project).toBeNull();
    expect(changes).toEqual([{ type: 'project' }]);
    // an intent with no project open is refused
    expect(await store.addFolder('X')).toMatchObject({ status: 'refused', reason: 'no-project' });
    expect(await store.addScene('X')).toMatchObject({ status: 'refused', reason: 'no-project' });
    expect(vault.writes).toEqual([]);
  });

  it('drops a repeated scene from what it shows, without rewriting the index', async () => {
    const { store, vault, indexPath } = await openSeeded({
      binder: ['Manuscript/A.md', 'Manuscript/B.md', 'Manuscript/A.md'],
      scenes: { A: 1024, B: 2048 },
    });
    expect(picture(store)).toBe('A B');
    expect(project(store).notes).toHaveLength(1);
    expect(project(store).notes[0]).toMatch(/listed more than once/);
    expect(project(store).readOnly).toBe(false);
    // Opening never writes; the duplicate is still in the file ...
    expect(vault.writes).toEqual([]);
    expect(binderOnDisk(vault, indexPath)).toEqual(['Manuscript/A.md', 'Manuscript/B.md', 'Manuscript/A.md']);

    // ... until the writer changes the binder, and then it is saved tidy.
    valueOf(await store.moveNode(sceneRef('Manuscript/B.md'), { at: 'start', parentId: null }));
    expect(binderOnDisk(vault, indexPath)).toEqual(['Manuscript/B.md', 'Manuscript/A.md']);
    expect(project(store).notes).toEqual([]);
  });
});

describe('a project whose index cannot be understood', () => {
  const unreadable: Array<[string, unknown, RegExp]> = [
    ['a binder that is text', 'Manuscript/Opening.md', /should be a list/],
    ['an entry that is a number', ['Manuscript/Opening.md', 42], /Entry 2 of the binder/],
    ['a folder without a name', ['Manuscript/Opening.md', { id: 'f-1', children: [] }], /"folder" name/],
    ['a path that leaves the project', ['../Other/Note.md'], /not a path inside the project folder/],
  ];

  for (const [name, binder, message] of unreadable) {
    it(`opens read-only for ${name}, shows why, and never writes anything`, async () => {
      const { store, vault, timers, indexPath } = await openSeeded({
        binder,
        scenes: { Opening: 1024, Two: 2048 },
      });
      const filesBefore = vault.paths();
      const indexBefore = vault.frontmatterOf(indexPath);

      const snapshot = project(store);
      expect(snapshot.readOnly).toBe(true);
      expect(snapshot.error).toMatch(message);
      expect(snapshot.error).toMatch(/read-only/);
      expect(snapshot.title).toBe('My Novel');
      expect(snapshot.tree).toEqual([]);
      // the scenes are still reachable
      expect(snapshot.unfiled).toEqual(['Manuscript/Opening.md', 'Manuscript/Two.md']);

      const results: IntentResult<unknown>[] = [
        await store.addScene('New scene'),
        await store.addFolder('New folder'),
        await store.renameScene('Manuscript/Opening.md', 'Renamed'),
        await store.renameFolder('f-1', 'Renamed'),
        await store.moveNode(sceneRef('Manuscript/Opening.md'), { at: 'end', parentId: null }),
        await store.moveNode(folderRef('f-1'), { at: 'start', parentId: null }),
        await store.removeFolder('f-1'),
        await store.deleteScene('Manuscript/Opening.md'),
        await store.removeMissingEntry('Manuscript/Ghost.md'),
        await store.addUnfiledToBinder('Manuscript/Two.md'),
      ];
      for (const result of results) {
        expect(result).toMatchObject({ status: 'refused', reason: 'read-only' });
      }
      // a note renamed by hand does not get "followed" into the index either
      vault.external.rename('Novel/Manuscript/Two.md', 'Novel/Manuscript/Second.md');
      await store.syncOrderKeysNow();
      timers.advance(60_000);
      await settle(store);

      expect(vault.writes).toEqual([]);
      expect(vault.trashed).toEqual([]);
      expect(vault.frontmatterOf(indexPath)).toEqual(indexBefore);
      expect(vault.paths()).toEqual(filesBefore.map((p) => p.replace('Two.md', 'Second.md')).sort());
    });
  }

  it('is read-only when the index was saved by a newer version of the plugin', async () => {
    const { store, vault, indexPath } = await openSeeded({ scenes: { A: 1024 }, extra: { version: 2 } });
    expect(project(store).readOnly).toBe(true);
    expect(project(store).error).toMatch(/newer version of Spellbook/);
    expect(await store.addFolder('X')).toMatchObject({ status: 'refused', reason: 'read-only' });
    expect(vault.writes).toEqual([]);
    expect(vault.frontmatterOf(indexPath)?.['version']).toBe(2);
  });

  it('becomes editable again as soon as the index is repaired', async () => {
    const { store, vault, indexPath, changes } = await openSeeded({ binder: { oops: true }, scenes: { A: 1024 } });
    expect(project(store).readOnly).toBe(true);

    vault.external.editFrontmatter(indexPath, (fm) => {
      fm['binder'] = ['Manuscript/A.md'];
    });
    await settle(store);

    expect(project(store)).toMatchObject({ readOnly: false, error: null });
    expect(picture(store)).toBe('A');
    expect(changes).toContainEqual({ type: 'project' });
    expect(valueOf(await store.addFolder('Part one')).id).toMatch(/^f-/);
  });

  it('turns read-only when a good index is broken by a later change', async () => {
    const { store, vault, indexPath } = await openSeeded({ scenes: { A: 1024 } });
    expect(project(store).readOnly).toBe(false);

    vault.external.editFrontmatter(indexPath, (fm) => {
      fm['binder'] = [['nested', 'list']];
    });
    await settle(store);

    expect(project(store).readOnly).toBe(true);
    expect(project(store).error).toMatch(/Entry 1 of the binder/);
    expect(await store.addFolder('X')).toMatchObject({ status: 'refused', reason: 'read-only' });
    expect(vault.writes).toEqual([]);
  });

  it('turns read-only when the properties block itself is broken, and recovers when it is fixed', async () => {
    const { store, vault, indexPath } = await openSeeded({ scenes: { A: 1024 } });
    vault.external.corrupt(indexPath);
    await settle(store);

    expect(project(store).readOnly).toBe(true);
    expect(project(store).error).toMatch(/could not be read/);
    expect(await store.addScene('X')).toMatchObject({ status: 'refused', reason: 'read-only' });
    expect(vault.writes).toEqual([]);

    vault.external.write(indexPath, {
      frontmatter: { spellbook: 'project', version: 1, title: 'My Novel', binder: ['Manuscript/A.md'] },
    });
    await settle(store);
    expect(project(store).readOnly).toBe(false);
    expect(picture(store)).toBe('A');
  });
});

describe('createProject', () => {
  it('creates the project structure, and nothing else', async () => {
    const vault = new MemoryVault().seedFolder('Writing');
    const { store, changes } = makeStore(vault);

    const result = await store.createProject('My Novel', 'Writing');

    expect(result).toEqual({
      status: 'done',
      value: { indexPath: 'Writing/My Novel/My Novel.md', folder: 'Writing/My Novel', title: 'My Novel', scenes: [] },
    });
    expect(vault.writes.map((write) => `${write.op} ${write.path}`)).toEqual([
      'createFolder Writing/My Novel',
      'createFile Writing/My Novel/My Novel.md',
      'createFolder Writing/My Novel/Manuscript',
      'createFolder Writing/My Novel/Timeline',
      'createFolder Writing/My Novel/Research',
      'createFolder Writing/My Novel/Stats',
      'createFile Writing/My Novel/To-do.md',
    ]);
    expect(vault.paths()).toEqual(['Writing/My Novel/My Novel.md', 'Writing/My Novel/To-do.md']);
    for (const sub of ['Manuscript', 'Timeline', 'Research', 'Stats']) {
      expect(vault.hasFolder(`Writing/My Novel/${sub}`), sub).toBe(true);
    }

    const index = vault.frontmatterOf('Writing/My Novel/My Novel.md');
    expect(index).toEqual({ spellbook: 'project', version: 1, title: 'My Novel', binder: [] });
    expect(Object.keys(index ?? {})).toEqual(['spellbook', 'version', 'title', 'binder']);
    expect(vault.bodyOf('Writing/My Novel/My Novel.md')).toBe('');
    expect(vault.frontmatterOf('Writing/My Novel/To-do.md')).toBeNull();
    expect(vault.bodyOf('Writing/My Novel/To-do.md')).toBe('');

    expect(store.listProjects()).toEqual([
      { indexPath: 'Writing/My Novel/My Novel.md', folder: 'Writing/My Novel', title: 'My Novel' },
    ]);
    expect(changes).toContainEqual({ type: 'projects' });
  });

  it('creates a project in the vault root, ready to open and use', async () => {
    const { store, vault } = makeStore();
    const created = valueOf(await store.createProject('Novel'));
    expect(created.indexPath).toBe('Novel/Novel.md');

    const snapshot = valueOf(await store.openProject(created.indexPath));
    expect(snapshot).toMatchObject({ title: 'Novel', readOnly: false, tree: [], unfiled: [], missing: [] });
    expect(valueOf(await store.addScene('Opening')).path).toBe('Manuscript/Opening.md');
    expect(vault.has('Novel/Manuscript/Opening.md')).toBe(true);
  });

  it('refuses when a folder with that name already exists, and writes nothing', async () => {
    const vault = new MemoryVault().seedFolder('Novel').seed('Novel/keep.md', { body: 'mine' });
    const { store } = makeStore(vault);

    const result = await store.createProject('Novel');
    expect(result).toMatchObject({ status: 'refused', reason: 'exists' });
    // phones and Macs would treat these as the same folder
    expect(await store.createProject('novel')).toMatchObject({ status: 'refused', reason: 'exists' });
    expect(await store.createProject('  NOVEL  ')).toMatchObject({ status: 'refused', reason: 'exists' });

    expect(vault.writes).toEqual([]);
    expect(vault.paths()).toEqual(['Novel/keep.md']);
    expect(store.listProjects()).toEqual([]);
  });

  it('refuses a second project with the same name', async () => {
    const { store, vault } = makeStore();
    valueOf(await store.createProject('Novel'));
    const writes = vault.writes.length;
    expect(await store.createProject('Novel')).toMatchObject({ status: 'refused', reason: 'exists' });
    expect(vault.writes).toHaveLength(writes);
  });

  it('keeps the title as typed but cleans the folder name', async () => {
    const { store, vault } = makeStore();
    const created = valueOf(await store.createProject('Who: Me?'));
    expect(created).toEqual({ indexPath: 'Who Me/Who Me.md', folder: 'Who Me', title: 'Who: Me?', scenes: [] });
    expect(vault.frontmatterOf('Who Me/Who Me.md')?.['title']).toBe('Who: Me?');
  });

  it('accepts a title in Hebrew', async () => {
    const { store, vault } = makeStore();
    const created = valueOf(await store.createProject('הרומן שלי'));
    expect(created).toEqual({ indexPath: 'הרומן שלי/הרומן שלי.md', folder: 'הרומן שלי', title: 'הרומן שלי', scenes: [] });
    expect(vault.hasFolder('הרומן שלי/Manuscript')).toBe(true);
  });

  it('refuses a name with nothing usable in it', async () => {
    const { store, vault } = makeStore();
    expect(await store.createProject('')).toMatchObject({ status: 'refused', reason: 'invalid-name' });
    expect(await store.createProject('   ')).toMatchObject({ status: 'refused', reason: 'invalid-name' });
    expect(await store.createProject('???')).toMatchObject({ status: 'refused', reason: 'invalid-name' });
    expect(vault.writes).toEqual([]);
  });

  it('refuses a parent folder that does not exist or is not inside the vault', async () => {
    const { store, vault } = makeStore();
    expect(await store.createProject('Novel', 'Nowhere')).toMatchObject({ status: 'refused', reason: 'parent-missing' });
    expect(await store.createProject('Novel', '../Outside')).toMatchObject({ status: 'refused', reason: 'invalid-path' });
    expect(vault.writes).toEqual([]);
  });

  it('refuses to create a project inside another project', async () => {
    const vault = new MemoryVault();
    seedProject(vault, { folder: 'Novel' });
    vault.seedFolder('Novel/Research');
    const { store } = makeStore(vault);
    expect(await store.createProject('Sub', 'Novel')).toMatchObject({ status: 'refused', reason: 'inside-project' });
    expect(await store.createProject('Sub', 'Novel/Research')).toMatchObject({ status: 'refused', reason: 'inside-project' });
    expect(vault.writes).toEqual([]);
    // next to it is fine
    expect((await store.createProject('Sibling')).status).toBe('done');
  });

  it('reports a failure part-way honestly and deletes nothing', async () => {
    const { store, vault } = makeStore();
    vault.failNext('createFolder', 'Novel/Timeline');

    const result = await store.createProject('Novel');

    expect(result.status).toBe('failed');
    if (result.status !== 'failed') return;
    expect(result.message).toMatch(/only partly created/);
    expect(result.message).toMatch(/"Timeline" folder/);
    expect(result.message).toMatch(/disk is not available/);
    // what was made before the failure is still there
    expect(vault.has('Novel/Novel.md')).toBe(true);
    expect(vault.hasFolder('Novel/Manuscript')).toBe(true);
    expect(vault.hasFolder('Novel/Timeline')).toBe(false);
    expect(vault.trashed).toEqual([]);
    expect(vault.writes.every((write) => write.op === 'createFile' || write.op === 'createFolder')).toBe(true);
  });
});
