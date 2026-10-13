// Project store: the parts of the snapshot that only the views read, the
// Research listing and where each note really is.

import { describe, expect, it } from 'vitest';
import { MemoryVault } from './memoryVault';
import { openSeeded, project, settle } from './storeHarness';

describe('the Research listing', () => {
  it('lists the notes under Research/, in sub-folders too, and nothing else', async () => {
    const vault = new MemoryVault();
    vault.seed('Novel/Research/Trains.md');
    vault.seed('Novel/Research/Maps/City.md');
    vault.seed('Novel/Research/Maps/Old/Harbour.md');
    vault.seed('Novel/Research/photo.png');
    vault.seed('Novel/Timeline/Event.md');
    vault.seed('Novel/To-do.md');
    vault.seed('Research/Not in the project.md');
    const { store } = await openSeeded({ scenes: { A: 1024 } }, vault);

    expect(project(store).research).toEqual([
      'Research/Maps/City.md',
      'Research/Maps/Old/Harbour.md',
      'Research/Trains.md',
    ]);
    expect(vault.writes).toEqual([]);
  });

  it('is empty for a project without research', async () => {
    const { store } = await openSeeded({ scenes: { A: 1024 } });
    expect(project(store).research).toEqual([]);
  });

  it('follows notes that are added, renamed and deleted, and tells the views', async () => {
    const { store, vault, changes } = await openSeeded({ scenes: { A: 1024 } });

    vault.external.create('Novel/Research/Trains.md', { body: 'Timetables.' });
    await settle(store);
    expect(project(store).research).toEqual(['Research/Trains.md']);
    expect(changes).toEqual([{ type: 'project' }]);

    vault.external.rename('Novel/Research/Trains.md', 'Novel/Research/Railways/Night trains.md');
    await settle(store);
    expect(project(store).research).toEqual(['Research/Railways/Night trains.md']);

    vault.external.delete('Novel/Research/Railways/Night trains.md');
    await settle(store);
    expect(project(store).research).toEqual([]);
    expect(vault.writes).toEqual([]); // research notes are never the store's to change
  });

  it('is still listed when the index cannot be understood', async () => {
    const vault = new MemoryVault();
    vault.seed('Novel/Research/Trains.md');
    const { store } = await openSeeded({ binder: { not: 'a list' } }, vault);
    expect(project(store).readOnly).toBe(true);
    expect(project(store).research).toEqual(['Research/Trains.md']);
  });
});

describe('vaultPathOf', () => {
  it('gives the vault path of a note of the open project', async () => {
    const vault = new MemoryVault();
    vault.seed('Shelf/Novel/Research/Trains.md');
    const { store } = await openSeeded({ folder: 'Shelf/Novel', scenes: { A: 1024 } }, vault);
    expect(store.vaultPathOf('Manuscript/A.md')).toBe('Shelf/Novel/Manuscript/A.md');
    expect(store.vaultPathOf('Research/Trains.md')).toBe('Shelf/Novel/Research/Trains.md');
  });

  it('gives null for a note that is not there', async () => {
    const { store } = await openSeeded({ binder: ['Manuscript/A.md', 'Manuscript/Ghost.md'], scenes: { A: 1024 } });
    expect(store.vaultPathOf('Manuscript/Ghost.md')).toBeNull();
    expect(store.vaultPathOf('Manuscript/Never heard of.md')).toBeNull();
    expect(store.vaultPathOf('../Outside.md')).toBeNull();
  });

  it('finds a note whose name the binder and the disk spell in two Unicode forms', async () => {
    // "é" as one character in the binder, as "e" plus an accent on disk.
    const composed = 'Manuscript/Café.md';
    const onDisk = 'Novel/Manuscript/Café.md';
    const vault = new MemoryVault();
    vault.seed(onDisk, { frontmatter: { order: 1024 }, body: 'Coffee.' });
    const { store } = await openSeeded({ binder: [composed] }, vault);

    expect(project(store).missing).toEqual([]);
    expect(store.vaultPathOf(composed)).toBe(onDisk);
    expect(await vault.readText(store.vaultPathOf(composed) as string)).toContain('Coffee.');
  });

  it('follows a renamed project folder', async () => {
    const { store, vault } = await openSeeded({ scenes: { A: 1024 } });
    vault.external.rename('Novel', 'Saga');
    await settle(store);
    expect(store.vaultPathOf('Manuscript/A.md')).toBe('Saga/Manuscript/A.md');
  });

  it('gives null when no project is open', async () => {
    const { store } = await openSeeded({ scenes: { A: 1024 } });
    await store.closeProject();
    expect(store.vaultPathOf('Manuscript/A.md')).toBeNull();
  });
});
