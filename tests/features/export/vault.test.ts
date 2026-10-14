// The one way the plugin writes an exported file: createExportFile on the
// project store, which goes through createBinary on the vault doorway. It
// makes a new file in the open project's Exports folder and nothing else:
// no other place, no other kind of file, and never over a file that is there.

import { describe, expect, it } from 'vitest';
import { utf8 } from '../../../src/core/export';
import { EXPORTS_FOLDER, EXPORT_EXTENSIONS } from '../../../src/core/projectLayout';
import { ObsidianVault } from '../../../src/obsidian/obsidianVault';
import { FakeObsidian, note } from '../../fakeObsidianApp';
import { MemoryVault } from '../../memoryVault';
import { makeStore, openSeeded, seedProject, settle, valueOf } from '../../storeHarness';

const BYTES = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0xff, 0x80]);

describe('MemoryVault.createBinary', () => {
  it('creates a new file of exactly these bytes, and says so', async () => {
    const vault = new MemoryVault();
    vault.seedFolder('Novel/Exports');
    const events: string[] = [];
    vault.on((event) => events.push(`${event.type} ${'path' in event ? event.path : ''}`));
    expect(await vault.createBinary('Novel/Exports/Book.docx', BYTES)).toBe('Novel/Exports/Book.docx');
    expect(vault.bytesOf('Novel/Exports/Book.docx')).toEqual(BYTES);
    expect(vault.writes).toEqual([{ op: 'createBinary', path: 'Novel/Exports/Book.docx' }]);
    expect(events).toEqual(['create Novel/Exports/Book.docx']);
    expect(vault.listFiles('Novel/Exports')).toEqual(['Novel/Exports/Book.docx']);
    expect(vault.listMarkdownFiles()).toEqual([]);
  });

  it('never replaces a file, whatever the capitals of its name, and needs the folder to be there', async () => {
    const vault = new MemoryVault();
    vault.seedFolder('Novel/Exports');
    await vault.createBinary('Novel/Exports/Book.docx', BYTES);
    await expect(vault.createBinary('Novel/Exports/Book.docx', utf8('other'))).rejects.toThrow(/already exists/);
    await expect(vault.createBinary('Novel/Exports/book.DOCX', utf8('other'))).rejects.toThrow(/already exists/);
    await expect(vault.createBinary('Nowhere/Book.docx', BYTES)).rejects.toThrow(/Folder does not exist/);
    expect(vault.bytesOf('Novel/Exports/Book.docx')).toEqual(BYTES);
    expect(vault.writes).toHaveLength(1);
  });

  it('a Markdown file made this way reads as its text, and can be made to fail', async () => {
    const vault = new MemoryVault();
    vault.seedFolder('A');
    await vault.createBinary('A/Book.md', utf8('# כותרת\n\nText.\n'));
    expect(await vault.readText('A/Book.md')).toBe('# כותרת\n\nText.\n');
    expect(vault.listMarkdownFiles().map((file) => file.path)).toEqual(['A/Book.md']);
    vault.failNext('createBinary');
    await expect(vault.createBinary('A/Other.md', BYTES)).rejects.toThrow(/not available/);
    expect(vault.has('A/Other.md')).toBe(false);
  });
});

describe('ObsidianVault.createBinary', () => {
  /** The imitation app with Obsidian's vault.createBinary added: it records what it is given. */
  function app(): { fake: FakeObsidian; vault: ObsidianVault; made: Array<{ path: string; data: ArrayBuffer }> } {
    const fake = new FakeObsidian();
    fake.addNote('Novel/Novel.md', note({ spellbook: 'project', version: 1, binder: [] }, ''));
    fake.addNote('Novel/Exports/Old.docx', 'an older export');
    const made: Array<{ path: string; data: ArrayBuffer }> = [];
    Object.assign(fake.vault, {
      createBinary: async (path: string, data: ArrayBuffer) => {
        if (fake.vault.getAbstractFileByPath(path)) throw new Error('File already exists.');
        made.push({ path, data });
        return fake.vault.attachFile(path, '');
      },
    });
    return { fake, vault: new ObsidianVault(fake.app), made };
  }

  it('hands Obsidian exactly the bytes, as a buffer of their own', async () => {
    const { vault, made } = app();
    // The bytes are a window on a larger buffer: only the window is written.
    const larger = new Uint8Array([9, 9, ...BYTES, 9]);
    const window = larger.subarray(2, 2 + BYTES.length);
    expect(await vault.createBinary('Novel/Exports/Book.docx', window)).toBe('Novel/Exports/Book.docx');
    expect(made.map((entry) => entry.path)).toEqual(['Novel/Exports/Book.docx']);
    expect(new Uint8Array(made[0]!.data)).toEqual(BYTES);
    expect(made[0]!.data).not.toBe(larger.buffer);
  });

  it('never replaces a file, whatever the capitals of its name: Obsidian is not even asked', async () => {
    const { fake, vault, made } = app();
    await expect(vault.createBinary('Novel/Exports/Old.docx', BYTES)).rejects.toThrow(/already a file/);
    await expect(vault.createBinary('Novel/Exports/old.DOCX', BYTES)).rejects.toThrow(/already a file/);
    expect(made).toEqual([]);
    expect(fake.vault.text.get('Novel/Exports/Old.docx')).toBe('an older export');
    expect(fake.vault.processed).toEqual([]);
  });
});

describe('ProjectStore.createExportFile', () => {
  const NAME = 'My Novel 2026-10-13.docx';

  it('saves a new file in the Exports folder of the open project, making the folder first', async () => {
    const { store, vault } = await openSeeded({ scenes: { Opening: 1024 } });
    const before = vault.paths();
    const opening = vault.textOf('Novel/Manuscript/Opening.md');
    const index = vault.textOf('Novel/Novel.md');

    expect(valueOf(await store.createExportFile(NAME, BYTES))).toEqual({ path: `Exports/${NAME}` });
    expect(vault.bytesOf(`Novel/Exports/${NAME}`)).toEqual(BYTES);
    // Two writes and no more: the folder, and the new file. No note was touched.
    expect(vault.writes).toEqual([
      { op: 'createFolder', path: 'Novel/Exports' },
      { op: 'createBinary', path: `Novel/Exports/${NAME}` },
    ]);
    expect(vault.paths()).toEqual([...before, `Novel/Exports/${NAME}`].sort());
    expect(vault.textOf('Novel/Manuscript/Opening.md')).toBe(opening);
    expect(vault.textOf('Novel/Novel.md')).toBe(index);
    expect(EXPORTS_FOLDER).toBe('Exports');
  });

  it('never replaces a file: a name that is taken is refused, whatever its capitals, and the file stays as it was', async () => {
    const { store, vault } = await openSeeded({ scenes: { Opening: 1024 } });
    valueOf(await store.createExportFile(NAME, BYTES));
    vault.clearWrites();
    expect(await store.createExportFile(NAME, utf8('other'))).toMatchObject({ status: 'refused', reason: 'exists' });
    expect(await store.createExportFile(NAME.toUpperCase().replace('.DOCX', '.docx'), utf8('other'))).toMatchObject({
      status: 'refused',
      reason: 'exists',
    });
    expect(vault.writes).toEqual([]);
    expect(vault.bytesOf(`Novel/Exports/${NAME}`)).toEqual(BYTES);
    // The next name is free.
    expect(valueOf(await store.createExportFile('My Novel 2026-10-13 2.docx', BYTES)).path).toBe('Exports/My Novel 2026-10-13 2.docx');
  });

  it('takes the three kinds of export, in any language', async () => {
    const { store, vault } = await openSeeded({ scenes: { Opening: 1024 } });
    expect(EXPORT_EXTENSIONS).toEqual(['md', 'html', 'docx', 'epub']);
    for (const name of ['Book.md', 'Book.html', 'הרומן שלי 2026-10-13.docx', 'My Novel (to print) 2026-10-13.html']) {
      expect(valueOf(await store.createExportFile(name, BYTES)).path, name).toBe(`Exports/${name}`);
    }
    expect(vault.listFiles('Novel/Exports')).toHaveLength(4);
  });

  it('refuses every name that is not a plain file name of an export: nothing is written anywhere else', async () => {
    const { store, vault } = await openSeeded({ scenes: { Opening: 1024 } });
    const before = vault.paths();
    for (const name of [
      '',
      'Book',
      '.docx',
      'Book.exe',
      'Book.js',
      'Book.docx.sh',
      'Book.DOCX',
      'Book.docx ',
      ' Book.docx',
      '.hidden.md',
      '../Book.docx',
      '../../Notes/Plain.md',
      '../Manuscript/Opening.md',
      'Sub/Book.docx',
      '/Book.docx',
      'Sub\\Book.docx',
      'Bo:ok.docx',
      'Bo*ok.docx',
      'Bo#ok.md',
      'Book..docx',
      'Bo\nok.docx',
    ]) {
      expect(await store.createExportFile(name, BYTES), JSON.stringify(name)).toMatchObject({ status: 'refused', reason: 'invalid-name' });
    }
    expect(vault.writes).toEqual([]);
    expect(vault.paths()).toEqual(before);
    expect(vault.hasFolder('Novel/Exports')).toBe(false);
  });

  it('refuses a name the binder lists as a scene, which may still be on its way from another device', async () => {
    const { store, vault } = await openSeeded({ binder: ['Manuscript/Opening.md', 'Exports/Chapter.md'], scenes: { Opening: 1024 } });
    expect(await store.createExportFile('Chapter.md', BYTES)).toMatchObject({ status: 'refused', reason: 'invalid-name' });
    expect(await store.createExportFile('chapter.md', BYTES)).toMatchObject({ status: 'refused', reason: 'invalid-name' });
    expect(vault.writes).toEqual([]);
  });

  it('refuses when no project is open, for a read-only project, and for another project than the one it was meant for', async () => {
    const vault = new MemoryVault();
    const indexPath = seedProject(vault, { scenes: { Opening: 1024 } });
    const { store } = makeStore(vault);
    expect(await store.createExportFile(NAME, BYTES)).toMatchObject({ status: 'refused', reason: 'no-project' });

    valueOf(await store.openProject(indexPath));
    vault.clearWrites();
    expect(await store.createExportFile(NAME, BYTES, 'Other/Other.md')).toMatchObject({ status: 'refused', reason: 'other-project' });

    vault.external.editFrontmatter(indexPath, (frontmatter) => {
      frontmatter['binder'] = 'not a list';
    });
    await settle(store);
    expect(store.project?.readOnly).toBe(true);
    expect(await store.createExportFile(NAME, BYTES)).toMatchObject({ status: 'refused', reason: 'read-only' });
    expect(vault.writes).toEqual([]);
  });

  it('says so when the file cannot be written, and leaves no half-made file', async () => {
    const { store, vault } = await openSeeded({ scenes: { Opening: 1024 } });
    vault.failNext('createBinary');
    const result = await store.createExportFile(NAME, BYTES);
    expect(result).toMatchObject({ status: 'failed' });
    expect(result.status === 'failed' ? result.message : '').toContain(NAME);
    expect(vault.has(`Novel/Exports/${NAME}`)).toBe(false);
    // The same name works once the disk is back.
    expect(valueOf(await store.createExportFile(NAME, BYTES)).path).toBe(`Exports/${NAME}`);
  });

  it('writes into the project that is open, also when it sits inside other folders', async () => {
    const { store, vault } = await openSeeded({ folder: 'Writing/Novel', scenes: { Opening: 1024 } });
    valueOf(await store.createExportFile(NAME, BYTES));
    expect(vault.has(`Writing/Novel/Exports/${NAME}`)).toBe(true);
    expect(vault.hasFolder('Exports')).toBe(false);
  });
});
