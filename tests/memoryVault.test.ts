// The in-memory vault is what every store test stands on, so its own
// behaviour is pinned down here.

import { describe, expect, it } from 'vitest';
import { VaultFileMissingError } from '../src/core/vaultPort';
import type { VaultEvent } from '../src/core/vaultPort';
import { ManualTimers, MemoryVault } from './memoryVault';

function watched(vault: MemoryVault = new MemoryVault()): { vault: MemoryVault; events: VaultEvent[] } {
  const events: VaultEvent[] = [];
  vault.on((event) => events.push(event));
  return { vault, events };
}

describe('MemoryVault as a VaultPort', () => {
  it('lists markdown notes with frontmatter, optionally inside one folder', () => {
    const vault = new MemoryVault()
      .seed('A/One.md', { frontmatter: { n: 1 } })
      .seed('A/Sub/Two.md')
      .seed('AB/Three.md')
      .seed('A/picture.png');
    expect(vault.listMarkdownFiles()).toEqual([
      { path: 'A/One.md', frontmatter: { n: 1 } },
      { path: 'A/Sub/Two.md', frontmatter: null },
      { path: 'AB/Three.md', frontmatter: null },
    ]);
    expect(vault.listMarkdownFiles('A').map((file) => file.path)).toEqual(['A/One.md', 'A/Sub/Two.md']);
  });

  it('lists every folder, without the top of the vault, in no promised order', async () => {
    const vault = new MemoryVault().seed('B/Sub/Two.md').seedFolder('A').seed('Loose.md');
    expect(vault.listFolders()).toEqual(['B', 'B/Sub', 'A']);
    await vault.createFolder('A/New');
    expect(vault.listFolders()).toEqual(['B', 'B/Sub', 'A', 'A/New']);
    vault.external.delete('B');
    expect(vault.listFolders()).toEqual(['A', 'A/New']);
    expect(new MemoryVault().listFolders()).toEqual([]);
  });

  it('hands out copies: changing what it returns does not change the vault', async () => {
    const vault = new MemoryVault().seed('Note.md', { frontmatter: { list: [1, 2] } });
    const read = await vault.readFrontmatter('Note.md');
    (read?.['list'] as number[]).push(3);
    expect(vault.frontmatterOf('Note.md')).toEqual({ list: [1, 2] });
    expect(() => {
      (vault.listMarkdownFiles()[0]?.frontmatter as Record<string, unknown>)['x'] = 1;
    }).toThrow(); // what the index hands out is frozen: it must never be edited
  });

  it('treats capitals and Unicode spelling as the same name in exists()', () => {
    const vault = new MemoryVault().seed('Novel/Café.md');
    expect(vault.exists('Novel/Café.md')).toBe(true);
    expect(vault.exists('novel/CAFÉ.MD')).toBe(true);
    expect(vault.exists('Novel/Café.md'.normalize('NFD'))).toBe(true);
    expect(vault.exists('NOVEL')).toBe(true);
    expect(vault.exists('Novel/Other.md')).toBe(false);
  });

  it('updateFrontmatter saves only when the change says so, and always shows the file as it is on disk', async () => {
    const { vault, events } = watched(new MemoryVault().seed('Note.md', { frontmatter: { a: 1 }, body: 'text' }));
    vault.external.write('Note.md', { frontmatter: { a: 2 } }, { silent: true });

    const seen: unknown[] = [];
    const untouched = await vault.updateFrontmatter('Note.md', (frontmatter) => {
      seen.push({ ...frontmatter });
      frontmatter['a'] = 99; // edits to the draft are thrown away when it returns false
      return false;
    });
    expect(untouched).toBe(false);
    expect(seen).toEqual([{ a: 2 }]);
    expect(vault.frontmatterOf('Note.md')).toEqual({ a: 2 });
    expect(vault.writes).toEqual([]);
    expect(events).toEqual([]);

    const saved = await vault.updateFrontmatter('Note.md', (frontmatter) => {
      frontmatter['b'] = true;
      return true;
    });
    expect(saved).toBe(true);
    expect(vault.frontmatterOf('Note.md')).toEqual({ a: 2, b: true });
    expect(vault.bodyOf('Note.md')).toBe('text');
    expect(vault.writes).toEqual([{ op: 'updateFrontmatter', path: 'Note.md' }]);
    expect(events).toEqual([
      { type: 'modify', path: 'Note.md' },
      { type: 'metadata', path: 'Note.md', frontmatter: { a: 2, b: true } },
    ]);
  });

  it('rejects reads and writes of a missing file, or of a broken properties block', async () => {
    const vault = new MemoryVault().seed('Broken.md', { frontmatter: { a: 1 } });
    await expect(vault.readFrontmatter('Nope.md')).rejects.toBeInstanceOf(VaultFileMissingError);
    await expect(vault.updateFrontmatter('Nope.md', () => true)).rejects.toBeInstanceOf(VaultFileMissingError);
    await expect(vault.trash('Nope.md')).rejects.toBeInstanceOf(VaultFileMissingError);
    await expect(vault.rename('Nope.md', 'X.md')).rejects.toBeInstanceOf(VaultFileMissingError);

    vault.external.corrupt('Broken.md');
    await expect(vault.readFrontmatter('Broken.md')).rejects.toThrow(/YAML/);
    await expect(vault.updateFrontmatter('Broken.md', () => true)).rejects.toThrow(/YAML/);
    expect(vault.listMarkdownFiles()[0]?.frontmatter).toBeNull();
    expect(vault.writes).toEqual([]);
  });

  it('createFile refuses to overwrite and needs its folder; createFolder is content when it exists', async () => {
    const vault = new MemoryVault().seed('Dir/Note.md');
    await expect(vault.createFile('Dir/note.md', '')).rejects.toThrow(/already exists/);
    await expect(vault.createFile('Missing/Note.md', '')).rejects.toThrow(/does not exist/);
    await vault.createFolder('Dir');
    await vault.createFolder('New/Deep');
    expect(vault.hasFolder('New')).toBe(true);
    expect(vault.hasFolder('New/Deep')).toBe(true);
    expect(await vault.createFile('New/Deep/Note.md', 'body', { k: 'v' })).toBe('New/Deep/Note.md');
    expect(await vault.readText('New/Deep/Note.md')).toBe('---\nk: "v"\n---\nbody');
  });

  it('trash removes the file, remembers it, and reports a delete', async () => {
    const { vault, events } = watched(new MemoryVault().seed('Note.md'));
    await vault.trash('Note.md');
    expect(vault.has('Note.md')).toBe(false);
    expect(vault.trashed).toEqual(['Note.md']);
    expect(events).toEqual([{ type: 'delete', path: 'Note.md', folder: false }]);
  });
});

describe('MemoryVault test controls', () => {
  it('failNext makes one matching write fail and leaves the vault unchanged', async () => {
    const vault = new MemoryVault().seed('A.md', { frontmatter: { n: 1 } }).seed('B.md', { frontmatter: { n: 1 } });
    vault.failNext('updateFrontmatter', 'B.md', 'disk full');

    expect(await vault.updateFrontmatter('A.md', (fm) => ((fm['n'] = 2), true))).toBe(true); // other paths are fine
    await expect(vault.updateFrontmatter('B.md', (fm) => ((fm['n'] = 2), true))).rejects.toThrow('disk full');
    expect(vault.frontmatterOf('B.md')).toEqual({ n: 1 });
    expect(await vault.updateFrontmatter('B.md', (fm) => ((fm['n'] = 3), true))).toBe(true); // only once
    expect(vault.frontmatterOf('B.md')).toEqual({ n: 3 });
    expect(vault.writesTo('B.md')).toHaveLength(1);
  });

  it('a silent external change is on disk but not announced or indexed', async () => {
    const { vault, events } = watched(new MemoryVault().seed('Note.md', { frontmatter: { v: 1 } }));
    vault.external.write('Note.md', { frontmatter: { v: 2 } }, { silent: true });
    expect(events).toEqual([]);
    expect(await vault.readFrontmatter('Note.md')).toEqual({ v: 2 }); // the disk
    expect(vault.listMarkdownFiles()[0]?.frontmatter).toEqual({ v: 1 }); // the index
    expect(vault.writes).toEqual([]); // external changes are not the code under test writing
  });

  it('holdMetadata keeps the index behind the disk until released', async () => {
    const { vault, events } = watched(new MemoryVault().seed('Note.md', { frontmatter: { v: 1 } }));
    vault.holdMetadata();
    await vault.updateFrontmatter('Note.md', (fm) => ((fm['v'] = 2), true));
    expect(events).toEqual([{ type: 'modify', path: 'Note.md' }]);
    expect(vault.listMarkdownFiles()[0]?.frontmatter).toEqual({ v: 1 });

    vault.releaseMetadata();
    expect(vault.listMarkdownFiles()[0]?.frontmatter).toEqual({ v: 2 });
    expect(events[1]).toEqual({ type: 'metadata', path: 'Note.md', frontmatter: { v: 2 } });
  });

  it('forgetIndex and finishIndexing imitate a vault that is still starting up', () => {
    const { vault, events } = watched(new MemoryVault().seed('A.md', { frontmatter: { v: 1 } }).seed('B.md'));
    vault.forgetIndex();
    expect(vault.listMarkdownFiles().map((file) => file.frontmatter)).toEqual([null, null]);
    vault.finishIndexing('refresh-only');
    expect(events).toEqual([{ type: 'refresh' }]);
    expect(vault.listMarkdownFiles()[0]?.frontmatter).toEqual({ v: 1 });

    events.length = 0;
    vault.forgetIndex();
    vault.finishIndexing('each-note');
    expect(events.map((event) => event.type)).toEqual(['metadata', 'metadata', 'refresh']);
  });

  it('sync hands files over one at a time, creating or updating as needed', () => {
    const { vault, events } = watched(new MemoryVault().seed('Old.md', { frontmatter: { v: 1 } }));
    const deliver = vault.sync([
      { path: 'New/Index.md', frontmatter: { spellbook: 'project' } },
      { path: 'Old.md', frontmatter: { v: 2 } },
    ]);
    expect(vault.has('New/Index.md')).toBe(false);
    expect(deliver()).toBe(true);
    expect(vault.has('New/Index.md')).toBe(true);
    expect(vault.frontmatterOf('Old.md')).toEqual({ v: 1 });
    expect(deliver()).toBe(true);
    expect(vault.frontmatterOf('Old.md')).toEqual({ v: 2 });
    expect(deliver()).toBe(false);
    expect(events.map((event) => event.type)).toEqual(['create', 'create', 'metadata', 'modify', 'metadata']);
  });

  it('renaming a folder moves everything in it and reports the folder and each file, in either order', () => {
    for (const order of ['folder-first', 'files-first'] as const) {
      const { vault, events } = watched(new MemoryVault().seed('A/One.md').seed('A/Sub/Two.md', { frontmatter: { k: 1 } }));
      vault.folderRenameOrder = order;
      vault.external.rename('A', 'B');

      expect(vault.paths()).toEqual(['B/One.md', 'B/Sub/Two.md']);
      expect(vault.hasFolder('A')).toBe(false);
      expect(vault.hasFolder('B/Sub')).toBe(true);
      expect(vault.listMarkdownFiles('B')[1]?.frontmatter).toEqual({ k: 1 }); // the index follows without a metadata event
      const folderEvents = [
        { type: 'rename', path: 'B', oldPath: 'A', folder: true },
        { type: 'rename', path: 'B/Sub', oldPath: 'A/Sub', folder: true },
      ];
      const fileEvents = [
        { type: 'rename', path: 'B/One.md', oldPath: 'A/One.md', folder: false },
        { type: 'rename', path: 'B/Sub/Two.md', oldPath: 'A/Sub/Two.md', folder: false },
      ];
      expect(events).toEqual(order === 'folder-first' ? [...folderEvents, ...fileEvents] : [...fileEvents, ...folderEvents]);
    }
  });

  it('deleting a folder deletes and reports everything in it', () => {
    const { vault, events } = watched(new MemoryVault().seed('A/One.md').seed('A/Sub/Two.md').seed('Keep.md'));
    vault.external.delete('A');
    expect(vault.paths()).toEqual(['Keep.md']);
    expect(events.filter((event) => event.type === 'delete' && !event.folder)).toHaveLength(2);
    expect(events[events.length - 1]).toEqual({ type: 'delete', path: 'A', folder: true });
  });
});

describe('ManualTimers', () => {
  it('fires timers only when time is advanced, in order, and honours cancel', () => {
    const timers = new ManualTimers();
    const fired: string[] = [];
    timers.set(() => fired.push('late'), 300);
    const cancel = timers.set(() => fired.push('cancelled'), 100);
    timers.set(() => fired.push('early'), 100);
    timers.set(() => {
      fired.push('chained');
      timers.set(() => fired.push('from chained'), 50);
    }, 200);
    expect(timers.pending).toBe(4);

    cancel();
    timers.advance(99);
    expect(fired).toEqual([]);
    timers.advance(1);
    expect(fired).toEqual(['early']);
    timers.advance(200);
    expect(fired).toEqual(['early', 'chained', 'from chained', 'late']);
    expect(timers.pending).toBe(0);
  });
});
