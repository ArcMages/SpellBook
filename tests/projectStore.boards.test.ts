// Project store: the idea boards.
//
// boardFiles, readBoardFile, createBoardFile, updateBoardFile,
// renameBoardFile and trashBoardFile are the only ways a screen can list,
// read, make, change, rename or remove a board. What is checked hardest: none
// of them replaces anything, none reaches outside the open project's Boards
// folder, none touches a note, and a board is never taken for part of the
// manuscript.

import { describe, expect, it } from 'vitest';
import { BOARDS_FOLDER, EMPTY_BOARD_TEXT } from '../src/core/boards';
import { ObsidianVault } from '../src/obsidian/obsidianVault';
import { FakeObsidian } from './fakeObsidianApp';
import { MemoryVault } from './memoryVault';
import { openSeeded, sceneBody } from './storeHarness';

const scenes = { scenes: { A: 1024, B: 2048 } };
const IDEAS = 'Novel/Boards/Ideas.canvas';
const IDEAS_TEXT = '{"nodes":[{"id":"t1","type":"text","text":"An idea","x":0,"y":0,"width":250,"height":60}],"edges":[]}';
/** "Ideas", in Hebrew. */
const IDEAS_HE = 'רעיונות';

function withBoards(): MemoryVault {
  return new MemoryVault()
    .seed(IDEAS, { body: IDEAS_TEXT })
    .seed(`Novel/Boards/${IDEAS_HE}.canvas`, { body: EMPTY_BOARD_TEXT })
    .seed('Novel/Boards/Notes.md', { body: 'Not a board.' })
    .seed('Novel/Boards/Deeper/Inside.canvas', { body: EMPTY_BOARD_TEXT })
    .seed('Novel/Research/Map.canvas', { body: EMPTY_BOARD_TEXT })
    .seed('Elsewhere/Boards/Other.canvas', { body: EMPTY_BOARD_TEXT });
}

describe('the Boards folder', () => {
  it('is called Boards', () => {
    expect(BOARDS_FOLDER).toBe('Boards');
  });

  it('lists the Canvas files directly inside it, and nothing else', async () => {
    const { store } = await openSeeded(scenes, withBoards());
    expect(store.boardFiles()).toEqual(['Boards/Ideas.canvas', `Boards/${IDEAS_HE}.canvas`].sort());
    const empty = await openSeeded(scenes);
    expect(empty.store.boardFiles()).toEqual([]);
  });

  it('is never part of the manuscript: no board is a scene, an unfiled note, research, or a note of the project', async () => {
    const { store } = await openSeeded(scenes, withBoards());
    expect(store.project?.unfiled).toEqual([]);
    expect(store.project?.research).toEqual([]);
    expect(store.project?.missing).toEqual([]);
    expect(store.projectNotes().map((note) => note.path)).not.toContain('Boards/Ideas.canvas');
    expect(store.projectNotes().every((note) => note.path.endsWith('.md'))).toBe(true);
    expect(store.timelineNotes()).toEqual([]);
    expect(store.worldNotes()).toEqual([]);
  });
});

describe('readBoardFile', () => {
  it('reads a board, and refuses every path that is no board of the Boards folder', async () => {
    const { store } = await openSeeded(scenes, withBoards());
    expect(await store.readBoardFile('Boards/Ideas.canvas')).toEqual({ status: 'done', value: IDEAS_TEXT });
    for (const path of ['Manuscript/A.md', 'Boards/Notes.md', 'Boards/Deeper/Inside.canvas', 'Research/Map.canvas', '../Elsewhere/Boards/Other.canvas', 'Boards/../Manuscript/A.md']) {
      expect((await store.readBoardFile(path)).status, path).toBe('refused');
    }
    expect((await store.readBoardFile('Boards/Gone.canvas')).status).toBe('noop');
  });
});

describe('createBoardFile', () => {
  it('makes a new board, and the Boards folder with it, in one write of the file', async () => {
    const { store, vault } = await openSeeded(scenes);
    const made = await store.createBoardFile('Ideas', EMPTY_BOARD_TEXT);
    expect(made).toEqual({ status: 'done', value: { path: 'Boards/Ideas.canvas' } });
    expect(vault.writes).toEqual([
      { op: 'createFolder', path: 'Novel/Boards' },
      { op: 'createFile', path: 'Novel/Boards/Ideas.canvas' },
    ]);
    expect(vault.textOf('Novel/Boards/Ideas.canvas')).toBe(EMPTY_BOARD_TEXT);
    expect(store.boardFiles()).toEqual(['Boards/Ideas.canvas']);
  });

  it('makes a board with a Hebrew name', async () => {
    const { store } = await openSeeded(scenes);
    expect(await store.createBoardFile(IDEAS_HE, EMPTY_BOARD_TEXT)).toEqual({ status: 'done', value: { path: `Boards/${IDEAS_HE}.canvas` } });
  });

  it('never replaces anything, whatever its capitals', async () => {
    const { store, vault } = await openSeeded(scenes, withBoards());
    vault.clearWrites();
    for (const name of ['Ideas', 'IDEAS', 'ideas']) {
      const result = await store.createBoardFile(name, EMPTY_BOARD_TEXT);
      expect(result.status === 'refused' && result.reason, name).toBe('exists');
    }
    expect(vault.writes).toEqual([]);
    expect(vault.textOf(IDEAS)).toBe(IDEAS_TEXT);
  });

  it('refuses a name that is not a tidy file name, and a text that is not a board', async () => {
    const { store, vault } = await openSeeded(scenes);
    for (const name of ['', 'a/b', '../Manuscript/A', 'x:y', '.hidden', ' padded ']) {
      expect((await store.createBoardFile(name, EMPTY_BOARD_TEXT)).status, name).toBe('refused');
    }
    expect((await store.createBoardFile('Fine', 'not a board')).status).toBe('refused');
    expect(vault.writes).toEqual([]);
  });

  it('writes nothing in a project that is read-only, or with no project open', async () => {
    const { store, vault } = await openSeeded({ binder: 'not a list' });
    expect(store.project?.readOnly).toBe(true);
    expect((await store.createBoardFile('Ideas', EMPTY_BOARD_TEXT)).status).toBe('refused');
    await store.closeProject();
    expect((await store.createBoardFile('Ideas', EMPTY_BOARD_TEXT)).status).toBe('refused');
    expect(vault.writes).toEqual([]);
  });
});

describe('updateBoardFile', () => {
  it('changes a board against its text on disk, in one step', async () => {
    const { store, vault } = await openSeeded(scenes, withBoards());
    vault.clearWrites();
    let seen = '';
    const result = await store.updateBoardFile('Boards/Ideas.canvas', (current) => {
      seen = current;
      return EMPTY_BOARD_TEXT;
    });
    expect(result.status).toBe('done');
    expect(seen).toBe(IDEAS_TEXT);
    expect(vault.writes).toEqual([{ op: 'updateBoardText', path: IDEAS }]);
    expect(vault.textOf(IDEAS)).toBe(EMPTY_BOARD_TEXT);
  });

  it('writes nothing when told to leave it, or when the new text is not a board', async () => {
    const { store, vault } = await openSeeded(scenes, withBoards());
    vault.clearWrites();
    expect((await store.updateBoardFile('Boards/Ideas.canvas', () => null)).status).toBe('noop');
    expect((await store.updateBoardFile('Boards/Ideas.canvas', () => 'broken {')).status).toBe('noop');
    expect(vault.writes).toEqual([]);
    expect(vault.textOf(IDEAS)).toBe(IDEAS_TEXT);
  });

  it('never reaches a note, another folder, or a board that is not there', async () => {
    const { store, vault } = await openSeeded(scenes, withBoards());
    vault.clearWrites();
    for (const path of ['Manuscript/A.md', 'Boards/Notes.md', 'Research/Map.canvas', 'Boards/Deeper/Inside.canvas', 'Novel.md']) {
      expect((await store.updateBoardFile(path, () => EMPTY_BOARD_TEXT)).status, path).toBe('refused');
    }
    expect((await store.updateBoardFile('Boards/Gone.canvas', () => EMPTY_BOARD_TEXT)).status).toBe('noop');
    expect(vault.writes).toEqual([]);
    expect(vault.bodyOf('Novel/Manuscript/A.md')).toBe(sceneBody('A'));
  });

  it('in Obsidian, changes a board through vault.process and refuses any file that is not a Canvas file', async () => {
    const fake = new FakeObsidian();
    fake.addNote('Novel/Boards/Ideas.canvas', IDEAS_TEXT);
    fake.addNote('Novel/Manuscript/A.md', 'text');
    const vault = new ObsidianVault(fake.app);
    expect(await vault.updateBoardText('Novel/Boards/Ideas.canvas', () => EMPTY_BOARD_TEXT)).toBe(true);
    expect(fake.vault.processed).toEqual(['Novel/Boards/Ideas.canvas']);
    await expect(vault.updateBoardText('Novel/Manuscript/A.md', () => 'x')).rejects.toThrow(/not a board/);
    await expect(vault.updateBoardText('Novel/Boards/Gone.canvas', () => 'x')).rejects.toThrow();
    expect(fake.vault.processed).toEqual(['Novel/Boards/Ideas.canvas']);
  });
});

describe('renameBoardFile and trashBoardFile', () => {
  it('renames a board where it is, and never onto another', async () => {
    const { store, vault } = await openSeeded(scenes, withBoards());
    expect(await store.renameBoardFile('Boards/Ideas.canvas', 'Part two')).toEqual({ status: 'done', value: { path: 'Boards/Part two.canvas' } });
    expect(vault.has('Novel/Boards/Part two.canvas')).toBe(true);
    const clash = await store.renameBoardFile('Boards/Part two.canvas', IDEAS_HE);
    expect(clash.status === 'refused' && clash.reason).toBe('exists');
    expect((await store.renameBoardFile('Boards/Part two.canvas', 'a/b')).status).toBe('refused');
    expect((await store.renameBoardFile('Manuscript/A.md', 'Z')).status).toBe('refused');
    expect((await store.renameBoardFile('Boards/Part two.canvas', 'Part two')).status).toBe('noop');
  });

  it('moves a board to the trash, and nothing else', async () => {
    const { store, vault } = await openSeeded(scenes, withBoards());
    vault.clearWrites();
    expect((await store.trashBoardFile('Manuscript/A.md')).status).toBe('refused');
    expect((await store.trashBoardFile('Boards/Notes.md')).status).toBe('refused');
    expect(vault.writes).toEqual([]);
    expect((await store.trashBoardFile('Boards/Ideas.canvas')).status).toBe('done');
    expect(vault.writes).toEqual([{ op: 'trash', path: IDEAS }]);
    expect((await store.trashBoardFile('Boards/Ideas.canvas')).status).toBe('noop');
  });
});
