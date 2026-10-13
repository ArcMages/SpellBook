// Project store: the intents (add, rename, move, remove), what happens when
// the index changed on disk after it was loaded, no-ops, and the queue.

import { describe, expect, it } from 'vitest';
import { folderRef, sceneRef } from '../src/core/binderTree';
import { RENAME_SETTLE_MS } from '../src/core/projectStore';
import type { Frontmatter } from '../src/core/types';
import { MemoryVault } from './memoryVault';
import {
  INDEX_BODY,
  TODAY,
  binderOnDisk,
  makeStore,
  openSeeded,
  picture,
  project,
  sceneBody,
  seedProject,
  settle,
  valueOf,
} from './storeHarness';

/** A project with scenes A B C D, B and C inside the folder "Part" (f-part). */
const withFolder = {
  binder: ['Manuscript/A.md', { folder: 'Part', id: 'f-part', children: ['Manuscript/B.md', 'Manuscript/C.md'] }, 'Manuscript/D.md'],
  scenes: { A: 1024, B: 2048, C: 3072, D: 4096 },
};

describe('addScene', () => {
  it('creates the note with the agreed properties and files it at the end of the binder', async () => {
    const { store, vault, indexPath, changes } = await openSeeded({
      scenes: { Opening: 1024 },
      extra: { targets: { draft: 80000 }, aliases: ['MN'] },
    });

    const result = await store.addScene('The Letter');

    expect(result).toEqual({ status: 'done', value: { path: 'Manuscript/The Letter.md' } });
    const created = vault.frontmatterOf('Novel/Manuscript/The Letter.md') as Frontmatter;
    expect(created).toEqual({ synopsis: '', status: 'To do', label: '', compile: true, order: 2048, created: TODAY });
    expect(Object.keys(created)).toEqual(['synopsis', 'status', 'label', 'compile', 'order', 'created']);
    expect(created).not.toHaveProperty('target');
    expect(created).not.toHaveProperty('edited');
    expect(vault.bodyOf('Novel/Manuscript/The Letter.md')).toBe('');

    expect(binderOnDisk(vault, indexPath)).toEqual(['Manuscript/Opening.md', 'Manuscript/The Letter.md']);
    expect(picture(store)).toBe('Opening The Letter');
    // exactly two writes: the new note, and one write of the index
    expect(vault.writes).toEqual([
      { op: 'createFile', path: 'Novel/Manuscript/The Letter.md' },
      { op: 'updateFrontmatter', path: indexPath },
    ]);
    // and exactly one announcement
    expect(changes).toEqual([{ type: 'project' }]);
  });

  it('leaves every other property of the index, and its text, exactly as they were', async () => {
    const extra = { targets: { draft: 80000, deadline: '2027-01-01' }, aliases: ['MN'], 'day marks': [{ on: '2026-10-01' }] };
    const { store, vault, indexPath } = await openSeeded({ scenes: { Opening: 1024 }, extra });
    const before = vault.frontmatterOf(indexPath) as Frontmatter;

    valueOf(await store.addScene('Two'));
    valueOf(await store.addFolder('Part'));

    const after = vault.frontmatterOf(indexPath) as Frontmatter;
    expect(Object.keys(after)).toEqual(Object.keys(before));
    for (const key of Object.keys(before)) {
      if (key !== 'binder') expect(after[key], key).toEqual(before[key]);
    }
    expect(vault.bodyOf(indexPath)).toBe(INDEX_BODY);
  });

  it('puts the scene where it was asked to go', async () => {
    const { store } = await openSeeded(withFolder);
    valueOf(await store.addScene('In folder', { at: 'end', parentId: 'f-part' }));
    valueOf(await store.addScene('First', { at: 'before', sibling: sceneRef('Manuscript/A.md') }));
    valueOf(await store.addScene('After B', { at: 'after', sibling: sceneRef('Manuscript/B.md') }));
    valueOf(await store.addScene('Top of folder', { at: 'start', parentId: 'f-part' }));
    expect(picture(store)).toBe('First A Part[Top of folder B After B C In folder] D');
  });

  it('cleans the title into a file name', async () => {
    const { store, vault } = await openSeeded();
    expect(valueOf(await store.addScene('Chapter 1: "Fire"?')).path).toBe('Manuscript/Chapter 1 Fire.md');
    expect(valueOf(await store.addScene('   ')).path).toBe('Manuscript/Untitled scene.md');
    expect(valueOf(await store.addScene('???')).path).toBe('Manuscript/Untitled scene 2.md');
    expect(vault.has('Novel/Manuscript/Chapter 1 Fire.md')).toBe(true);
  });

  it('keeps a Hebrew title as the file name and the scene title', async () => {
    const { store, vault } = await openSeeded();
    expect(valueOf(await store.addScene('מכתב ראשון')).path).toBe('Manuscript/מכתב ראשון.md');
    expect(vault.has('Novel/Manuscript/מכתב ראשון.md')).toBe(true);
    expect(project(store).tree).toEqual([
      { kind: 'scene', path: 'Manuscript/מכתב ראשון.md', title: 'מכתב ראשון', missing: false },
    ]);
  });

  it('adds " 2", " 3" when the name is taken, ignoring capitals', async () => {
    const { store } = await openSeeded({ scenes: { Opening: 1024 } });
    expect(valueOf(await store.addScene('Opening')).path).toBe('Manuscript/Opening 2.md');
    expect(valueOf(await store.addScene('Opening')).path).toBe('Manuscript/Opening 3.md');
    expect(valueOf(await store.addScene('opening')).path).toBe('Manuscript/opening 4.md');
  });

  it('does not reuse the name of a Missing entry, whose note may still be on its way', async () => {
    const { store, vault } = await openSeeded({
      binder: ['Manuscript/A.md', 'Manuscript/Ghost.md'],
      scenes: { A: 1024 },
    });
    expect(valueOf(await store.addScene('Ghost')).path).toBe('Manuscript/Ghost 2.md');
    expect(vault.has('Novel/Manuscript/Ghost.md')).toBe(false);
    expect(picture(store)).toBe('A Ghost? Ghost 2');
  });

  it('creates the Manuscript folder when it is not there', async () => {
    const vault = new MemoryVault();
    const indexPath = 'Bare/Bare.md';
    vault.seed(indexPath, { frontmatter: { spellbook: 'project' } });
    const { store } = makeStore(vault);
    valueOf(await store.openProject(indexPath));

    expect(valueOf(await store.addScene('One')).path).toBe('Manuscript/One.md');
    expect(vault.hasFolder('Bare/Manuscript')).toBe(true);
    expect(vault.frontmatterOf(indexPath)).toEqual({ spellbook: 'project', binder: ['Manuscript/One.md'] });
  });

  it('adds at the end, and says so, when the chosen place has gone from the index', async () => {
    const { store, vault, indexPath } = await openSeeded(withFolder);
    // Another device removed the folder; this device has not noticed yet.
    vault.external.editFrontmatter(
      indexPath,
      (fm) => {
        fm['binder'] = ['Manuscript/A.md', 'Manuscript/B.md'];
      },
      { silent: true },
    );

    const result = await store.addScene('New', { at: 'end', parentId: 'f-part' });

    expect(result.status).toBe('done');
    expect(result.status === 'done' && result.warning).toMatch(/added at the end/);
    expect(binderOnDisk(vault, indexPath)).toEqual(['Manuscript/A.md', 'Manuscript/B.md', 'Manuscript/New.md']);
  });

  it('when the index cannot be saved, says the note exists but is unfiled', async () => {
    const { store, vault, indexPath } = await openSeeded({ scenes: { A: 1024 } });
    vault.failNext('updateFrontmatter', indexPath);

    const result = await store.addScene('Orphan');

    expect(result.status).toBe('failed');
    expect(result.status === 'failed' && result.message).toMatch(/was created, but it could not be added to the binder/);
    expect(vault.has('Novel/Manuscript/Orphan.md')).toBe(true);
    expect(binderOnDisk(vault, indexPath)).toEqual(['Manuscript/A.md']);
    expect(project(store).unfiled).toEqual(['Manuscript/Orphan.md']);
    expect(picture(store)).toBe('A');

    // nothing is lost: it can be filed afterwards
    valueOf(await store.addUnfiledToBinder('Manuscript/Orphan.md'));
    expect(picture(store)).toBe('A Orphan');
    expect(project(store).unfiled).toEqual([]);
  });
});

describe('addFolder', () => {
  it('adds a virtual folder with a short random id: nothing is created on disk', async () => {
    const { store, vault, indexPath } = await openSeeded({ scenes: { A: 1024 } });

    const id = valueOf(await store.addFolder('  Part   one ')).id;

    expect(id).toMatch(/^f-[a-z0-9]{6}$/);
    expect(binderOnDisk(vault, indexPath)).toEqual(['Manuscript/A.md', { folder: 'Part one', id, children: [] }]);
    expect(picture(store)).toBe('A Part one[]');
    expect(vault.writes).toEqual([{ op: 'updateFrontmatter', path: indexPath }]);
    expect(vault.hasFolder('Novel/Part one')).toBe(false);
    expect(vault.hasFolder('Novel/Manuscript/Part one')).toBe(false);
  });

  it('gives every folder its own id, and places folders inside folders', async () => {
    const { store } = await openSeeded();
    const outer = valueOf(await store.addFolder('Outer')).id;
    const inner = valueOf(await store.addFolder('Inner', { at: 'end', parentId: outer })).id;
    const other = valueOf(await store.addFolder('חלק שני')).id;
    expect(new Set([outer, inner, other]).size).toBe(3);
    expect(picture(store)).toBe('Outer[Inner[]] חלק שני[]');
  });

  it('refuses an empty name', async () => {
    const { store, vault } = await openSeeded();
    expect(await store.addFolder('  \n ')).toMatchObject({ status: 'refused', reason: 'invalid-name' });
    expect(vault.writes).toEqual([]);
  });
});

describe('renameScene', () => {
  it('renames the note through the vault and updates the index path, with one index write', async () => {
    const { store, vault, timers, indexPath } = await openSeeded(withFolder);

    const result = await store.renameScene('Manuscript/B.md', 'The Letter');

    expect(result).toEqual({ status: 'done', value: { path: 'Manuscript/The Letter.md' } });
    expect(vault.has('Novel/Manuscript/B.md')).toBe(false);
    expect(vault.bodyOf('Novel/Manuscript/The Letter.md')).toBe(sceneBody('B'));
    expect(vault.frontmatterOf('Novel/Manuscript/The Letter.md')).toEqual({ status: 'To do', order: 2048 });
    expect(binderOnDisk(vault, indexPath)).toEqual([
      'Manuscript/A.md',
      { folder: 'Part', id: 'f-part', children: ['Manuscript/The Letter.md', 'Manuscript/C.md'] },
      'Manuscript/D.md',
    ]);
    expect(picture(store)).toBe('A Part[The Letter C] D');
    expect(vault.writes).toEqual([
      { op: 'rename', path: 'Novel/Manuscript/B.md', to: 'Novel/Manuscript/The Letter.md' },
      { op: 'updateFrontmatter', path: indexPath },
    ]);

    // The vault also reported the rename as an event; that must not cause a second write.
    timers.advance(60_000);
    await settle(store);
    expect(vault.writes).toHaveLength(2);
  });

  it('updates the index itself, without relying on the vault reporting the rename', async () => {
    // A vault that renames the note but never sends the "rename" event.
    class SilentRenameVault extends MemoryVault {
      override async rename(from: string, to: string): Promise<string> {
        this.external.rename(from, to, { silent: true });
        return to;
      }
    }
    const { store, vault, indexPath } = await openSeeded({ scenes: { A: 1024, B: 2048 } }, new SilentRenameVault());

    expect(valueOf(await store.renameScene('Manuscript/B.md', 'Bee')).path).toBe('Manuscript/Bee.md');
    expect(binderOnDisk(vault, indexPath)).toEqual(['Manuscript/A.md', 'Manuscript/Bee.md']);
    expect(picture(store)).toBe('A Bee');
  });

  it('keeps the note in the folder it is in', async () => {
    const vault = new MemoryVault();
    const indexPath = seedProject(vault, { binder: ['Manuscript/Act 1/Deep.md'] });
    vault.seed('Novel/Manuscript/Act 1/Deep.md', { body: 'deep' });
    const { store } = makeStore(vault);
    await store.openProject(indexPath);

    expect(valueOf(await store.renameScene('Manuscript/Act 1/Deep.md', 'Deeper')).path).toBe('Manuscript/Act 1/Deeper.md');
    expect(vault.bodyOf('Novel/Manuscript/Act 1/Deeper.md')).toBe('deep');
  });

  it('cleans the new title and avoids names that are taken', async () => {
    const { store } = await openSeeded(withFolder);
    expect(valueOf(await store.renameScene('Manuscript/B.md', 'What?/Why')).path).toBe('Manuscript/What Why.md');
    expect(valueOf(await store.renameScene('Manuscript/C.md', 'A')).path).toBe('Manuscript/A 2.md');
    expect(valueOf(await store.renameScene('Manuscript/D.md', 'a')).path).toBe('Manuscript/a 3.md');
    expect(picture(store)).toBe('A Part[What Why A 2] a 3');
  });

  it('allows changing only the capitals of a name', async () => {
    const { store, vault } = await openSeeded(withFolder);
    expect(valueOf(await store.renameScene('Manuscript/B.md', 'b')).path).toBe('Manuscript/b.md');
    expect(vault.has('Novel/Manuscript/b.md')).toBe(true);
  });

  it('does nothing when the name stays the same', async () => {
    const { store, vault } = await openSeeded(withFolder);
    expect(await store.renameScene('Manuscript/B.md', '  B ')).toMatchObject({ status: 'noop', reason: 'unchanged' });
    expect(vault.writes).toEqual([]);
  });

  it('refuses a scene whose note is missing, and paths outside the project', async () => {
    const { store, vault } = await openSeeded({ binder: ['Manuscript/Ghost.md'] });
    expect(await store.renameScene('Manuscript/Ghost.md', 'New')).toMatchObject({ status: 'refused', reason: 'missing-file' });
    expect(await store.renameScene('../Other/Note.md', 'New')).toMatchObject({ status: 'refused', reason: 'invalid-path' });
    expect(await store.renameScene('Novel.md', 'New')).toMatchObject({ status: 'refused', reason: 'invalid-path' });
    expect(vault.writes).toEqual([]);
  });

  it('renames an unfiled note without touching the index', async () => {
    const { store, vault } = await openSeeded({ binder: [], scenes: { Loose: null } });
    expect(valueOf(await store.renameScene('Manuscript/Loose.md', 'Found')).path).toBe('Manuscript/Found.md');
    expect(vault.writes).toEqual([{ op: 'rename', path: 'Novel/Manuscript/Loose.md', to: 'Novel/Manuscript/Found.md' }]);
    expect(project(store).unfiled).toEqual(['Manuscript/Found.md']);
  });

  it('heals itself when the index could not be saved right after the note was renamed', async () => {
    const { store, vault, timers, indexPath } = await openSeeded({ scenes: { A: 1024, B: 2048 } });
    vault.failNext('updateFrontmatter', indexPath);

    const result = await store.renameScene('Manuscript/B.md', 'New');

    expect(result.status).toBe('failed');
    expect(result.status === 'failed' && result.message).toMatch(/renamed to "New", but the binder could not be updated/);
    expect(vault.has('Novel/Manuscript/New.md')).toBe(true);
    expect(binderOnDisk(vault, indexPath)).toEqual(['Manuscript/A.md', 'Manuscript/B.md']); // not saved
    expect(picture(store)).toBe('A New'); // but the store has not lost track of the scene

    // The store tries again shortly afterwards.
    timers.advance(RENAME_SETTLE_MS);
    await settle(store);
    expect(binderOnDisk(vault, indexPath)).toEqual(['Manuscript/A.md', 'Manuscript/New.md']);
    expect(picture(store)).toBe('A New');
  });
});

describe('renameFolder', () => {
  it('changes the name and keeps the id, the children and unknown properties', async () => {
    const { store, vault, indexPath } = await openSeeded({
      binder: [{ folder: 'Part', id: 'f-part', children: ['Manuscript/A.md'], colour: 'red' }],
      scenes: { A: 1024 },
    });
    expect(await store.renameFolder('f-part', 'חלק ראשון')).toEqual({ status: 'done', value: undefined });
    expect(binderOnDisk(vault, indexPath)).toEqual([
      { folder: 'חלק ראשון', id: 'f-part', children: ['Manuscript/A.md'], colour: 'red' },
    ]);
    expect(picture(store)).toBe('חלק ראשון[A]');
    expect(vault.writes).toEqual([{ op: 'updateFrontmatter', path: indexPath }]);
  });

  it('refuses an empty name', async () => {
    const { store, vault } = await openSeeded(withFolder);
    expect(await store.renameFolder('f-part', '   ')).toMatchObject({ status: 'refused', reason: 'invalid-name' });
    expect(vault.writes).toEqual([]);
  });
});

describe('moveNode', () => {
  it('moves a scene into a folder without moving its file', async () => {
    const { store, vault, indexPath } = await openSeeded(withFolder);
    const filesBefore = vault.paths();

    expect(await store.moveNode(sceneRef('Manuscript/D.md'), { at: 'start', parentId: 'f-part' })).toEqual({
      status: 'done',
      value: undefined,
    });

    expect(picture(store)).toBe('A Part[D B C]');
    expect(binderOnDisk(vault, indexPath)).toEqual([
      'Manuscript/A.md',
      { folder: 'Part', id: 'f-part', children: ['Manuscript/D.md', 'Manuscript/B.md', 'Manuscript/C.md'] },
    ]);
    expect(vault.paths()).toEqual(filesBefore); // binder folders are virtual
    expect(vault.writes).toEqual([{ op: 'updateFrontmatter', path: indexPath }]);
  });

  it('moves a scene out of a folder and a folder with its scenes', async () => {
    const { store } = await openSeeded(withFolder);
    valueOf(await store.moveNode(sceneRef('Manuscript/B.md'), { at: 'start', parentId: null }));
    expect(picture(store)).toBe('B A Part[C] D');
    valueOf(await store.moveNode(folderRef('f-part'), { at: 'end', parentId: null }));
    expect(picture(store)).toBe('B A D Part[C]');
  });

  it('refuses to move a folder into itself, and writes nothing', async () => {
    const { store, vault } = await openSeeded({
      binder: [{ folder: 'Outer', id: 'f-out', children: [{ folder: 'Inner', id: 'f-in', children: [] }] }],
    });
    expect(await store.moveNode(folderRef('f-out'), { at: 'end', parentId: 'f-in' })).toMatchObject({
      status: 'refused',
      reason: 'invalid-move',
    });
    expect(await store.moveNode(folderRef('f-out'), { at: 'end', parentId: 'f-out' })).toMatchObject({
      status: 'refused',
      reason: 'invalid-move',
    });
    expect(vault.writes).toEqual([]);
    expect(picture(store)).toBe('Outer[Inner[]]');
  });
});

describe('removeFolder', () => {
  it('keeps the scenes: they move up to where the folder was, and no file is touched', async () => {
    const { store, vault, indexPath } = await openSeeded(withFolder);
    const filesBefore = vault.paths();

    expect(await store.removeFolder('f-part')).toEqual({ status: 'done', value: undefined });

    expect(picture(store)).toBe('A B C D');
    expect(binderOnDisk(vault, indexPath)).toEqual(['Manuscript/A.md', 'Manuscript/B.md', 'Manuscript/C.md', 'Manuscript/D.md']);
    expect(vault.paths()).toEqual(filesBefore);
    expect(vault.trashed).toEqual([]);
    expect(vault.writes).toEqual([{ op: 'updateFrontmatter', path: indexPath }]);
  });
});

describe('deleteScene', () => {
  it('takes the scene out of the binder and moves its note to the trash', async () => {
    const { store, vault, indexPath } = await openSeeded(withFolder);

    expect(await store.deleteScene('Manuscript/B.md')).toEqual({ status: 'done', value: undefined });

    expect(picture(store)).toBe('A Part[C] D');
    expect(vault.trashed).toEqual(['Novel/Manuscript/B.md']);
    expect(vault.has('Novel/Manuscript/B.md')).toBe(false);
    expect(vault.writes).toEqual([
      { op: 'updateFrontmatter', path: indexPath },
      { op: 'trash', path: 'Novel/Manuscript/B.md' },
    ]);
    expect(project(store).missing).toEqual([]);
  });

  it('refuses to delete the index note, anything outside the project, or a file that is not a note', async () => {
    const vault = new MemoryVault().seed('Other/Note.md', { body: 'not yours' });
    const { store } = await openSeeded(withFolder, vault);
    for (const path of ['Novel.md', '../Other/Note.md', '/Other/Note.md', 'Manuscript/../../Other/Note.md', 'Manuscript/cover.png', '']) {
      expect(await store.deleteScene(path), path).toMatchObject({ status: 'refused', reason: 'invalid-path' });
    }
    expect(vault.trashed).toEqual([]);
    expect(vault.writes).toEqual([]);
    expect(vault.has('Other/Note.md')).toBe(true);
  });

  it('refuses notes of the project that are not scenes: To-do.md, research, timeline, stats', async () => {
    const vault = new MemoryVault()
      .seed('Novel/To-do.md', { body: '- [ ] write' })
      .seed('Novel/Research/Trains.md', { body: 'facts' })
      .seed('Novel/Timeline/Event.md')
      .seed('Novel/Stats/2026-10.md');
    const { store } = await openSeeded(withFolder, vault);
    for (const path of ['To-do.md', 'Research/Trains.md', 'Timeline/Event.md', 'Stats/2026-10.md']) {
      expect(await store.deleteScene(path), path).toMatchObject({ status: 'refused', reason: 'invalid-path' });
      expect(await store.renameScene(path, 'Renamed'), path).toMatchObject({ status: 'refused', reason: 'invalid-path' });
      expect(await store.addUnfiledToBinder(path), path).toMatchObject({ status: 'refused', reason: 'invalid-path' });
    }
    expect(vault.writes).toEqual([]);
    expect(vault.trashed).toEqual([]);
    expect(vault.bodyOf('Novel/To-do.md')).toBe('- [ ] write');
  });

  it('can delete a note outside Manuscript when the binder lists it as a scene', async () => {
    const vault = new MemoryVault().seed('Novel/Research/Filed.md', { body: 'a scene kept elsewhere' });
    const { store } = await openSeeded({ binder: ['Manuscript/A.md', 'Research/Filed.md'], scenes: { A: 1024 } }, vault);
    expect((await store.deleteScene('Research/Filed.md')).status).toBe('done');
    expect(vault.trashed).toEqual(['Novel/Research/Filed.md']);
    expect(picture(store)).toBe('A');
  });

  it('does not trash such a note when the binder on disk no longer lists it', async () => {
    const vault = new MemoryVault().seed('Novel/Research/Filed.md', { body: 'kept' });
    const { store, indexPath } = await openSeeded({ binder: ['Manuscript/A.md', 'Research/Filed.md'], scenes: { A: 1024 } }, vault);
    vault.external.editFrontmatter(indexPath, (fm) => {
      fm['binder'] = ['Manuscript/A.md'];
    }, { silent: true });
    expect(await store.deleteScene('Research/Filed.md')).toMatchObject({ status: 'noop', reason: 'not-found' });
    expect(vault.trashed).toEqual([]);
    expect(vault.has('Novel/Research/Filed.md')).toBe(true);
  });

  it('trashes an unfiled note without writing the index', async () => {
    const { store, vault } = await openSeeded({ binder: ['Manuscript/A.md'], scenes: { A: 1024, Loose: null } });
    expect((await store.deleteScene('Manuscript/Loose.md')).status).toBe('done');
    expect(vault.writes).toEqual([{ op: 'trash', path: 'Novel/Manuscript/Loose.md' }]);
    expect(project(store).unfiled).toEqual([]);
  });

  it('removes the entry of a scene whose note is already gone', async () => {
    const { store, vault, indexPath } = await openSeeded({ binder: ['Manuscript/A.md', 'Manuscript/Ghost.md'], scenes: { A: 1024 } });
    expect((await store.deleteScene('Manuscript/Ghost.md')).status).toBe('done');
    expect(binderOnDisk(vault, indexPath)).toEqual(['Manuscript/A.md']);
    expect(vault.trashed).toEqual([]);
  });

  it('reports a scene that is neither in the binder nor in the vault', async () => {
    const { store, vault } = await openSeeded(withFolder);
    expect(await store.deleteScene('Manuscript/Never.md')).toMatchObject({ status: 'noop', reason: 'not-found' });
    expect(vault.writes).toEqual([]);
  });

  it('does not trash the note when the binder could not be updated', async () => {
    const { store, vault, indexPath } = await openSeeded(withFolder);
    vault.failNext('updateFrontmatter', indexPath);

    const result = await store.deleteScene('Manuscript/B.md');

    expect(result.status).toBe('failed');
    expect(vault.trashed).toEqual([]);
    expect(vault.has('Novel/Manuscript/B.md')).toBe(true);
    expect(picture(store)).toBe('A Part[B C] D'); // nothing happened at all
  });

  it('when the trash fails, nothing is lost: the note is kept and the scene goes back to its place', async () => {
    const { store, vault, indexPath } = await openSeeded(withFolder);
    const binderBefore = binderOnDisk(vault, indexPath);
    vault.failNext('trash');

    const result = await store.deleteScene('Manuscript/B.md');

    expect(result.status).toBe('failed');
    expect(result.status === 'failed' && result.message).toMatch(/could not be moved to the trash/);
    expect(result.status === 'failed' && result.message).toMatch(/still in the binder/);
    expect(vault.has('Novel/Manuscript/B.md')).toBe(true);
    expect(vault.bodyOf('Novel/Manuscript/B.md')).toBe(sceneBody('B'));
    expect(picture(store)).toBe('A Part[B C] D');
    expect(binderOnDisk(vault, indexPath)).toEqual(binderBefore);
    expect(project(store).unfiled).toEqual([]);
    expect(vault.trashed).toEqual([]);
  });

  it('puts the scene back in the right place wherever it was: first in a folder, or first of all', async () => {
    const { store, vault, indexPath } = await openSeeded(withFolder);
    const binderBefore = binderOnDisk(vault, indexPath);
    for (const path of ['Manuscript/A.md', 'Manuscript/B.md', 'Manuscript/C.md', 'Manuscript/D.md']) {
      vault.failNext('trash');
      expect((await store.deleteScene(path)).status, path).toBe('failed');
      expect(binderOnDisk(vault, indexPath), path).toEqual(binderBefore);
    }
    expect(picture(store)).toBe('A Part[B C] D');
  });

  it('when the trash fails for a scene kept outside Manuscript, it goes back into the binder too', async () => {
    // Such a note would not show under Unfiled, so losing its entry would hide it altogether.
    const vault = new MemoryVault().seed('Novel/Research/Filed.md', { body: 'a scene kept elsewhere' });
    const { store, indexPath } = await openSeeded({ binder: ['Manuscript/A.md', 'Research/Filed.md'], scenes: { A: 1024 } }, vault);
    vault.failNext('trash', 'Novel/Research/Filed.md');

    const result = await store.deleteScene('Research/Filed.md');

    expect(result.status).toBe('failed');
    expect(result.status === 'failed' && result.message).toMatch(/could not be moved to the trash/);
    expect(result.status === 'failed' && result.message).not.toMatch(/Unfiled/);
    expect(binderOnDisk(vault, indexPath)).toEqual(['Manuscript/A.md', 'Research/Filed.md']);
    expect(picture(store)).toBe('A Filed');
    expect(project(store).unfiled).toEqual([]);
    expect(vault.bodyOf('Novel/Research/Filed.md')).toBe('a scene kept elsewhere');
    // and it can still be deleted once the trash works again
    expect((await store.deleteScene('Research/Filed.md')).status).toBe('done');
    expect(vault.trashed).toEqual(['Novel/Research/Filed.md']);
  });

  it('puts the scene at the end when its old place has gone in the meantime', async () => {
    const { store, vault, indexPath } = await openSeeded(withFolder);
    vault.failNext('trash');
    // Another device removes the folder "Part" just after this device took C out of it.
    let done = false;
    vault.on((event) => {
      if (done || event.type !== 'modify' || event.path !== indexPath) return;
      done = true;
      vault.external.editFrontmatter(indexPath, (fm) => {
        fm['binder'] = ['Manuscript/A.md', 'Manuscript/D.md'];
      }, { silent: true });
    });

    expect((await store.deleteScene('Manuscript/C.md')).status).toBe('failed');

    expect(binderOnDisk(vault, indexPath)).toEqual(['Manuscript/A.md', 'Manuscript/D.md', 'Manuscript/C.md']);
    expect(picture(store)).toBe('A D C');
  });

  describe('when the trash fails and the scene cannot be put back either', () => {
    /** Let the first save of the index through and make the second one fail. */
    function failSecondIndexSave(vault: MemoryVault, indexPath: string): void {
      let armed = false;
      vault.on((event) => {
        if (armed || event.type !== 'modify' || event.path !== indexPath) return;
        armed = true;
        vault.failNext('updateFrontmatter', indexPath);
      });
    }

    it('says that a manuscript note is now under Unfiled, and it is', async () => {
      const { store, vault, indexPath } = await openSeeded(withFolder);
      vault.failNext('trash');
      failSecondIndexSave(vault, indexPath);

      const result = await store.deleteScene('Manuscript/B.md');

      expect(result.status).toBe('failed');
      expect(result.status === 'failed' && result.message).toMatch(/taken out of the binder/);
      expect(result.status === 'failed' && result.message).toMatch(/You can find it under Unfiled/);
      expect(picture(store)).toBe('A Part[C] D');
      expect(project(store).unfiled).toEqual(['Manuscript/B.md']);
      expect(vault.bodyOf('Novel/Manuscript/B.md')).toBe(sceneBody('B'));
    });

    it('says where a note outside Manuscript is, and does not claim it is under Unfiled', async () => {
      const vault = new MemoryVault().seed('Novel/Research/Filed.md', { body: 'kept' });
      const { store, indexPath } = await openSeeded({ binder: ['Manuscript/A.md', 'Research/Filed.md'], scenes: { A: 1024 } }, vault);
      vault.failNext('trash');
      failSecondIndexSave(vault, indexPath);

      const result = await store.deleteScene('Research/Filed.md');

      expect(result.status).toBe('failed');
      const message = result.status === 'failed' ? result.message : '';
      expect(message).toMatch(/taken out of the binder/);
      expect(message).toContain('still at "Research/Filed.md"');
      expect(message).toMatch(/move it into the Manuscript folder/);
      expect(message).not.toMatch(/You can find it under Unfiled/);
      expect(project(store).unfiled).toEqual([]);
      expect(vault.bodyOf('Novel/Research/Filed.md')).toBe('kept');
      // The advice works: once moved into Manuscript/, the note can be filed again.
      vault.external.rename('Novel/Research/Filed.md', 'Novel/Manuscript/Filed.md');
      await settle(store);
      expect(project(store).unfiled).toEqual(['Manuscript/Filed.md']);
      expect((await store.addUnfiledToBinder('Manuscript/Filed.md')).status).toBe('done');
    });
  });
});

describe('removeMissingEntry', () => {
  it('removes an entry whose note does not exist', async () => {
    const { store, vault, indexPath } = await openSeeded({ binder: ['Manuscript/A.md', 'Manuscript/Ghost.md'], scenes: { A: 1024 } });
    expect(await store.removeMissingEntry('Manuscript/Ghost.md')).toEqual({ status: 'done', value: undefined });
    expect(binderOnDisk(vault, indexPath)).toEqual(['Manuscript/A.md']);
    expect(project(store).missing).toEqual([]);
    expect(vault.trashed).toEqual([]);
  });

  it('removes a hand-written entry that does not even end in .md', async () => {
    const { store, vault, indexPath } = await openSeeded({ binder: ['Manuscript/A.md', 'Manuscript/Old note'], scenes: { A: 1024 } });
    expect(project(store).missing).toEqual(['Manuscript/Old note']);
    expect((await store.removeMissingEntry('Manuscript/Old note')).status).toBe('done');
    expect(binderOnDisk(vault, indexPath)).toEqual(['Manuscript/A.md']);
  });

  it('keeps the entry when the note has arrived in the meantime', async () => {
    const { store, vault, indexPath } = await openSeeded({ binder: ['Manuscript/A.md', 'Manuscript/Late.md'], scenes: { A: 1024 } });
    expect(picture(store)).toBe('A Late?');
    // The note lands on disk just before the writer taps "remove".
    vault.external.create('Novel/Manuscript/Late.md', { body: 'arrived' }, { silent: true });

    const result = await store.removeMissingEntry('Manuscript/Late.md');

    expect(result).toMatchObject({ status: 'noop', reason: 'file-exists' });
    expect(vault.writes).toEqual([]);
    expect(binderOnDisk(vault, indexPath)).toEqual(['Manuscript/A.md', 'Manuscript/Late.md']);
    expect(picture(store)).toBe('A Late');
  });

  it('reports an entry that is not in the binder', async () => {
    const { store, vault } = await openSeeded({ scenes: { A: 1024 } });
    expect(await store.removeMissingEntry('Manuscript/Nope.md')).toMatchObject({ status: 'noop', reason: 'not-found' });
    expect(vault.writes).toEqual([]);
  });
});

describe('addUnfiledToBinder', () => {
  it('files a note that was not in the binder, where asked, without touching its text', async () => {
    const { store, vault, indexPath } = await openSeeded({ binder: ['Manuscript/A.md'], scenes: { A: 1024, Loose: null } });
    expect(project(store).unfiled).toEqual(['Manuscript/Loose.md']);

    const result = await store.addUnfiledToBinder('Manuscript/Loose.md', { at: 'start', parentId: null });

    expect(result).toEqual({ status: 'done', value: { path: 'Manuscript/Loose.md' } });
    expect(binderOnDisk(vault, indexPath)).toEqual(['Manuscript/Loose.md', 'Manuscript/A.md']);
    expect(project(store).unfiled).toEqual([]);
    expect(vault.bodyOf('Novel/Manuscript/Loose.md')).toBe(sceneBody('Loose'));
    expect(vault.writes).toEqual([{ op: 'updateFrontmatter', path: indexPath }]);
  });

  it('does nothing for a note that is already in the binder or does not exist', async () => {
    const { store, vault } = await openSeeded({ scenes: { A: 1024 } });
    expect(await store.addUnfiledToBinder('Manuscript/A.md')).toMatchObject({ status: 'noop', reason: 'already-in-binder' });
    expect(await store.addUnfiledToBinder('Manuscript/Nope.md')).toMatchObject({ status: 'noop', reason: 'not-found' });
    expect(await store.addUnfiledToBinder('Novel.md')).toMatchObject({ status: 'refused', reason: 'invalid-path' });
    expect(vault.writes).toEqual([]);
  });
});

describe('an intent when the index changed on disk after it was loaded', () => {
  it('is applied to the binder on disk, not to the copy in memory', async () => {
    const { store, vault, indexPath } = await openSeeded({ scenes: { A: 1024, B: 2048, C: 3072 } });
    // Another device added a folder with a new scene, reordered, and set a
    // target. The files are on disk, but this device has not noticed yet.
    vault.external.create('Novel/Manuscript/D.md', { body: 'd' }, { silent: true });
    vault.external.editFrontmatter(
      indexPath,
      (fm) => {
        fm['binder'] = [
          'Manuscript/C.md',
          { folder: 'Synced', id: 'f-sync', children: ['Manuscript/D.md'] },
          'Manuscript/A.md',
          'Manuscript/B.md',
        ];
        fm['targets'] = { draft: 90000 };
      },
      { silent: true },
    );
    expect(picture(store)).toBe('A B C'); // what is on screen is stale

    const result = await store.moveNode(sceneRef('Manuscript/A.md'), { at: 'end', parentId: null });

    expect(result.status).toBe('done');
    // The other device's work is all still there, plus this move.
    expect(binderOnDisk(vault, indexPath)).toEqual([
      'Manuscript/C.md',
      { folder: 'Synced', id: 'f-sync', children: ['Manuscript/D.md'] },
      'Manuscript/B.md',
      'Manuscript/A.md',
    ]);
    expect(vault.frontmatterOf(indexPath)?.['targets']).toEqual({ draft: 90000 });
    // And the screen is refreshed from disk after the write.
    expect(picture(store)).toBe('C Synced[D] B A');
  });

  it('adds next to a sibling wherever that sibling is now', async () => {
    const { store, vault, indexPath } = await openSeeded(withFolder);
    vault.external.editFrontmatter(
      indexPath,
      (fm) => {
        // B was moved out of the folder to the very end
        fm['binder'] = ['Manuscript/A.md', { folder: 'Part', id: 'f-part', children: ['Manuscript/C.md'] }, 'Manuscript/D.md', 'Manuscript/B.md'];
      },
      { silent: true },
    );
    valueOf(await store.addFolder('After B', { at: 'after', sibling: sceneRef('Manuscript/B.md') }));
    expect(picture(store)).toBe('A Part[C] D B After B[]');
  });

  it('is a no-op that reports back when the node has vanished', async () => {
    const { store, vault, indexPath, changes } = await openSeeded({ scenes: { A: 1024, B: 2048, C: 3072 } });
    vault.external.editFrontmatter(
      indexPath,
      (fm) => {
        fm['binder'] = ['Manuscript/A.md', 'Manuscript/C.md'];
      },
      { silent: true },
    );

    const result = await store.moveNode(sceneRef('Manuscript/B.md'), { at: 'start', parentId: null });

    expect(result).toMatchObject({ status: 'noop', reason: 'not-found' });
    expect(result.status === 'noop' && result.message).toMatch(/no longer in the binder/);
    expect(vault.writes).toEqual([]);
    expect(binderOnDisk(vault, indexPath)).toEqual(['Manuscript/A.md', 'Manuscript/C.md']);
    // The screen catches up with the disk, so the writer sees why.
    expect(picture(store)).toBe('A C');
    expect(project(store).unfiled).toEqual(['Manuscript/B.md']);
    expect(changes).toEqual([{ type: 'project' }]);
  });

  it('is a no-op when the destination has vanished', async () => {
    const { store, vault, indexPath } = await openSeeded(withFolder);
    vault.external.editFrontmatter(
      indexPath,
      (fm) => {
        fm['binder'] = ['Manuscript/A.md', 'Manuscript/B.md', 'Manuscript/C.md', 'Manuscript/D.md'];
      },
      { silent: true },
    );
    expect(await store.moveNode(sceneRef('Manuscript/A.md'), { at: 'end', parentId: 'f-part' })).toMatchObject({
      status: 'noop',
      reason: 'target-missing',
    });
    expect(await store.renameFolder('f-part', 'New name')).toMatchObject({ status: 'noop', reason: 'not-found' });
    expect(await store.removeFolder('f-part')).toMatchObject({ status: 'noop', reason: 'not-found' });
    expect(await store.deleteScene('Manuscript/Zzz.md')).toMatchObject({ status: 'noop', reason: 'not-found' });
    expect(vault.writes).toEqual([]);
  });

  it('never writes an index that has become unreadable in the meantime', async () => {
    const { store, vault, indexPath } = await openSeeded(withFolder);
    vault.external.editFrontmatter(
      indexPath,
      (fm) => {
        fm['binder'] = 'a bad merge';
      },
      { silent: true },
    );
    const indexBefore = vault.frontmatterOf(indexPath);

    expect(await store.addFolder('X')).toMatchObject({ status: 'refused', reason: 'read-only' });
    // The store has now seen the problem, so later intents are refused up front.
    expect(project(store).readOnly).toBe(true);
    expect(await store.moveNode(sceneRef('Manuscript/A.md'), { at: 'end', parentId: null })).toMatchObject({
      status: 'refused',
      reason: 'read-only',
    });
    expect(await store.deleteScene('Manuscript/A.md')).toMatchObject({ status: 'refused', reason: 'read-only' });

    expect(vault.writes).toEqual([]);
    expect(vault.trashed).toEqual([]);
    expect(vault.frontmatterOf(indexPath)).toEqual(indexBefore);
  });

  it('does not write the index when adding a scene finds it unreadable; the new note is kept as unfiled', async () => {
    const { store, vault, indexPath } = await openSeeded({ scenes: { A: 1024 } });
    vault.external.editFrontmatter(
      indexPath,
      (fm) => {
        fm['binder'] = { not: 'a list' };
      },
      { silent: true },
    );

    const result = await store.addScene('New');

    expect(result.status).toBe('failed');
    expect(vault.writesTo(indexPath)).toEqual([]);
    expect(vault.frontmatterOf(indexPath)?.['binder']).toEqual({ not: 'a list' });
    expect(vault.has('Novel/Manuscript/New.md')).toBe(true);
    expect(project(store).readOnly).toBe(true);
    expect(project(store).unfiled).toEqual(['Manuscript/A.md', 'Manuscript/New.md']);
  });

  it('does not write an index whose properties block is broken', async () => {
    const { store, vault, indexPath } = await openSeeded(withFolder);
    vault.external.corrupt(indexPath, { silent: true });

    const result = await store.renameFolder('f-part', 'New');

    expect(result.status).toBe('failed');
    expect(vault.writes).toEqual([]);
    expect(project(store).readOnly).toBe(true);
    expect(project(store).error).toMatch(/could not be read/);
  });

  it('closes the project when the note has stopped being a project index', async () => {
    const { store, vault, indexPath } = await openSeeded(withFolder);
    vault.external.editFrontmatter(
      indexPath,
      (fm) => {
        delete fm['spellbook'];
      },
      { silent: true },
    );
    expect(await store.addFolder('X')).toMatchObject({ status: 'refused', reason: 'not-a-project' });
    expect(vault.writes).toEqual([]);
    expect(store.project).toBeNull();
  });
});

describe('intents that change nothing', () => {
  it('write nothing and announce nothing', async () => {
    const { store, vault, changes } = await openSeeded(withFolder);

    const results = [
      await store.renameFolder('f-part', 'Part'), // same name
      await store.renameFolder('f-nope', 'X'), // no such folder
      await store.removeFolder('f-nope'),
      await store.moveNode(sceneRef('Manuscript/A.md'), { at: 'start', parentId: null }), // already first
      await store.moveNode(sceneRef('Manuscript/C.md'), { at: 'after', sibling: sceneRef('Manuscript/B.md') }), // already there
      await store.moveNode(sceneRef('Manuscript/Zzz.md'), { at: 'start', parentId: null }),
      await store.moveNode(sceneRef('Manuscript/A.md'), { at: 'before', sibling: folderRef('f-nope') }),
      await store.moveNode(folderRef('f-part'), { at: 'after', sibling: folderRef('f-part') }),
      await store.removeMissingEntry('Manuscript/Zzz.md'),
      await store.addUnfiledToBinder('Manuscript/B.md'),
      await store.renameScene('Manuscript/A.md', 'A'),
    ];

    expect(results.map((result) => result.status)).toEqual(new Array(results.length).fill('noop'));
    expect(results.map((result) => (result.status === 'noop' ? result.reason : ''))).toEqual([
      'unchanged',
      'not-found',
      'not-found',
      'unchanged',
      'unchanged',
      'not-found',
      'target-missing',
      'unchanged',
      'not-found',
      'already-in-binder',
      'unchanged',
    ]);
    for (const result of results) expect(result.status === 'noop' && result.message.length).toBeGreaterThan(0);
    expect(vault.writes).toEqual([]);
    expect(changes).toEqual([]);
    expect(picture(store)).toBe('A Part[B C] D');
  });
});

describe('a write that fails', () => {
  it('is reported, changes nothing, and can be tried again', async () => {
    const { store, vault, indexPath, changes } = await openSeeded(withFolder);
    const before = binderOnDisk(vault, indexPath);
    vault.failNext('updateFrontmatter', indexPath);

    const result = await store.moveNode(sceneRef('Manuscript/D.md'), { at: 'start', parentId: null });

    expect(result.status).toBe('failed');
    expect(result.status === 'failed' && result.message).toMatch(/could not be saved.*disk is not available/);
    expect(binderOnDisk(vault, indexPath)).toEqual(before);
    expect(picture(store)).toBe('A Part[B C] D');
    expect(changes).toEqual([]);

    const again = await store.moveNode(sceneRef('Manuscript/D.md'), { at: 'start', parentId: null });
    expect(again.status).toBe('done');
    expect(picture(store)).toBe('D A Part[B C]');
  });
});

describe('the queue', () => {
  /** A vault whose index writes take a moment, and which notices if two overlap. */
  class SlowVault extends MemoryVault {
    running = 0;
    mostAtOnce = 0;

    override async updateFrontmatter(path: string, change: (frontmatter: Frontmatter) => boolean): Promise<boolean> {
      this.running++;
      this.mostAtOnce = Math.max(this.mostAtOnce, this.running);
      try {
        await new Promise((resolve) => setTimeout(resolve, 2));
        return await super.updateFrontmatter(path, change);
      } finally {
        this.running--;
      }
    }

    override async readFrontmatter(path: string): Promise<Frontmatter | null> {
      await new Promise((resolve) => setTimeout(resolve, 1));
      return super.readFrontmatter(path);
    }
  }

  it('runs intents one at a time, in the order they were asked for, each seeing the one before', async () => {
    const vault = new SlowVault();
    const { store, indexPath } = await openSeeded({ scenes: { A: 1024 } }, vault);

    // Fired together, without waiting for one another.
    const pending = [
      store.addFolder('One'),
      store.addScene('B'),
      store.addFolder('Two'),
      store.moveNode(sceneRef('Manuscript/A.md'), { at: 'end', parentId: null }),
      store.addScene('C', { at: 'start', parentId: null }),
      store.renameScene('Manuscript/B.md', 'Bee'),
    ];
    const results = await Promise.all(pending);

    expect(results.map((result) => result.status)).toEqual(['done', 'done', 'done', 'done', 'done', 'done']);
    expect(vault.mostAtOnce).toBe(1);
    expect(picture(store)).toBe('C One[] Bee Two[] A');
    const onDisk = binderOnDisk(vault, indexPath) as unknown[];
    expect(onDisk).toHaveLength(5);
    expect(onDisk[0]).toBe('Manuscript/C.md');
    expect(onDisk[2]).toBe('Manuscript/Bee.md');
    expect(onDisk[4]).toBe('Manuscript/A.md');
  });

  it('keeps going after an intent fails', async () => {
    const vault = new SlowVault();
    const { store, indexPath } = await openSeeded({ scenes: { A: 1024 } }, vault);
    vault.failNext('updateFrontmatter', indexPath);

    const [first, second] = await Promise.all([store.addFolder('Fails'), store.addFolder('Works')]);

    expect(first.status).toBe('failed');
    expect(second.status).toBe('done');
    expect(picture(store)).toBe('A Works[]');
  });

  it('a listener that throws does not stop the store', async () => {
    const { store } = await openSeeded({ scenes: { A: 1024 } });
    const errors: unknown[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => errors.push(args);
    try {
      store.onChange(() => {
        throw new Error('a view failed to redraw');
      });
      let heard = 0;
      store.onChange(() => heard++);
      expect((await store.addFolder('X')).status).toBe('done');
      expect(heard).toBe(1);
      expect(errors).toHaveLength(1);
      expect(picture(store)).toBe('A X[]');
    } finally {
      console.error = original;
    }
  });
});
