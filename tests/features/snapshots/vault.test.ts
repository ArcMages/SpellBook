// The ways the snapshots write: a new snapshot note and a snapshot to the
// trash (only one folder deep inside the project's Snapshots folder), and
// the one path in the plugin that replaces the text of a note the writer
// writes in: replaceSceneText on the project store, which goes through
// replaceText on the vault doorway and accepts nothing but a scene of the
// open project.

import { describe, expect, it } from 'vitest';
import { SNAPSHOTS_FOLDER } from '../../../src/core/projectLayout';
import { VaultFileMissingError } from '../../../src/core/vaultPort';
import { ObsidianVault } from '../../../src/obsidian/obsidianVault';
import { FakeObsidian, note } from '../../fakeObsidianApp';
import { MemoryVault } from '../../memoryVault';
import { INDEX_BODY, makeStore, openSeeded, sceneBody, seedProject, valueOf } from '../../storeHarness';

const OPENING = 'Novel/Manuscript/Opening.md';
const PROPERTIES = { 'spellbook-snapshot': 1, 'scene-id': 'abc', scene: 'Manuscript/Opening.md', name: 'גרסה ראשונה' };

describe('MemoryVault.replaceText', () => {
  it('replaces the text of a file that is there, against the file as it is at that moment', async () => {
    const vault = new MemoryVault();
    vault.seed('A/Note.md', { frontmatter: { status: 'Draft' }, body: 'Old text.\n' });
    const events: string[] = [];
    vault.on((event) => events.push(`${event.type} ${'path' in event ? event.path : ''}`));
    let seen = '';
    expect(
      await vault.replaceText('A/Note.md', (current) => {
        seen = current;
        return '---\nstatus: "Final"\n---\nטקסט חדש.\n';
      }),
    ).toBe(true);
    expect(seen).toBe('---\nstatus: "Draft"\n---\nOld text.\n');
    expect(await vault.readText('A/Note.md')).toBe('---\nstatus: "Final"\n---\nטקסט חדש.\n');
    expect(vault.frontmatterOf('A/Note.md')).toEqual({ status: 'Final' });
    expect(vault.writes).toEqual([{ op: 'replaceText', path: 'A/Note.md' }]);
    expect(events).toEqual(['modify A/Note.md', 'metadata A/Note.md']);
  });

  it('writes nothing when told to leave the file, or when the text comes out the same; never creates a file', async () => {
    const vault = new MemoryVault();
    vault.seed('A/Note.md', { body: 'Text.\n' });
    expect(await vault.replaceText('A/Note.md', () => null)).toBe(false);
    expect(await vault.replaceText('A/Note.md', (current) => current)).toBe(false);
    await expect(vault.replaceText('A/Other.md', () => 'new')).rejects.toBeInstanceOf(VaultFileMissingError);
    expect(vault.has('A/Other.md')).toBe(false);
    vault.failNext('replaceText');
    await expect(vault.replaceText('A/Note.md', () => 'new')).rejects.toThrow(/not available/);
    expect(vault.writes).toEqual([]);
    expect(vault.textOf('A/Note.md')).toBe('Text.\n');
  });
});

describe('ObsidianVault.replaceText', () => {
  it('replaces the text of a note that is there in one step, and never creates one', async () => {
    const fake = new FakeObsidian();
    fake.addNote(OPENING, note({ status: 'Draft' }, 'Old text.\n'));
    const vault = new ObsidianVault(fake.app);
    let seen = '';
    expect(
      await vault.replaceText(OPENING, (current) => {
        seen = current;
        return current.replace('Old text.', 'שלום.');
      }),
    ).toBe(true);
    expect(seen).toBe(note({ status: 'Draft' }, 'Old text.\n'));
    expect(fake.textOf(OPENING)).toBe(note({ status: 'Draft' }, 'שלום.\n'));
    // Left alone: nothing is written.
    expect(await vault.replaceText(OPENING, () => null)).toBe(false);
    expect(await vault.replaceText(OPENING, (current) => current)).toBe(false);
    expect(fake.textOf(OPENING)).toBe(note({ status: 'Draft' }, 'שלום.\n'));
    await expect(vault.replaceText('Novel/Manuscript/Nowhere.md', () => 'new')).rejects.toBeInstanceOf(VaultFileMissingError);
    expect(fake.vault.getAbstractFileByPath('Novel/Manuscript/Nowhere.md')).toBeNull();
  });
});

describe('ProjectStore.createSnapshotNote', () => {
  it('makes a new note one folder deep inside Snapshots, and the folders with it', async () => {
    const { store, vault } = await openSeeded({ scenes: { Opening: 1024 } });
    const scene = vault.textOf(OPENING);
    const made = valueOf(await store.createSnapshotNote('Opening - abc', '2026-10-13 12.30.05 גרסה', PROPERTIES, 'The text.\n'));
    expect(made).toEqual({ path: 'Snapshots/Opening - abc/2026-10-13 12.30.05 גרסה.md' });
    expect(vault.writes).toEqual([
      { op: 'createFolder', path: 'Novel/Snapshots' },
      { op: 'createFolder', path: 'Novel/Snapshots/Opening - abc' },
      { op: 'createFile', path: 'Novel/Snapshots/Opening - abc/2026-10-13 12.30.05 גרסה.md' },
    ]);
    expect(vault.frontmatterOf(`Novel/${made.path}`)).toEqual(PROPERTIES);
    expect(vault.bodyOf(`Novel/${made.path}`)).toBe('The text.\n');
    expect(vault.textOf(OPENING)).toBe(scene);
    expect(SNAPSHOTS_FOLDER).toBe('Snapshots');
    // The project is as it was: a snapshot is no scene, no unfiled note and no research.
    const project = store.project;
    expect(project?.tree.map((node) => (node.kind === 'scene' ? node.path : node.name))).toEqual(['Manuscript/Opening.md']);
    expect([project?.unfiled, project?.research, project?.missing, project?.conflicts]).toEqual([[], [], [], []]);
    expect(store.listProjects()).toHaveLength(1);
  });

  it('never replaces a note: a name that is taken is refused, whatever its capitals', async () => {
    const { store, vault } = await openSeeded({ scenes: { Opening: 1024 } });
    valueOf(await store.createSnapshotNote('Opening - abc', 'First', PROPERTIES, 'One.\n'));
    vault.clearWrites();
    expect(await store.createSnapshotNote('Opening - abc', 'First', PROPERTIES, 'Two.\n')).toMatchObject({ status: 'refused', reason: 'exists' });
    expect(await store.createSnapshotNote('Opening - abc', 'FIRST', PROPERTIES, 'Two.\n')).toMatchObject({ status: 'refused', reason: 'exists' });
    expect(vault.writes).toEqual([]);
    expect(vault.bodyOf('Novel/Snapshots/Opening - abc/First.md')).toBe('One.\n');
  });

  it('refuses every place that is not Snapshots/<folder>/<name>.md, and properties that would make a project of it', async () => {
    const { store, vault } = await openSeeded({ scenes: { Opening: 1024 } });
    const before = vault.paths();
    for (const [folder, name] of [
      ['', 'Name'],
      ['Folder', ''],
      ['..', 'Name'],
      ['Folder', '..'],
      ['../Manuscript', 'Opening'],
      ['Folder', '../../Manuscript/Opening'],
      ['Folder/Deeper', 'Name'],
      ['Folder', 'Sub/Name'],
      ['Fol:der', 'Name'],
      ['Folder', 'Na*me'],
      ['.hidden', 'Name'],
      ['Folder', '.hidden'],
      [' Folder', 'Name'],
      ['Folder', 'Name '],
      ['Folder', 'Sub\\Name'],
    ] as const) {
      expect(await store.createSnapshotNote(folder, name, PROPERTIES, 'x'), `${folder} / ${name}`).toMatchObject({ status: 'refused', reason: 'invalid-path' });
    }
    expect(await store.createSnapshotNote('Folder', 'Name', { spellbook: 'project', version: 1, binder: [] }, 'x')).toMatchObject({
      status: 'refused',
      reason: 'inside-project',
    });
    expect(vault.paths()).toEqual(before);
    expect(vault.writes).toEqual([]);
  });

  it('is refused for a read-only project, for another project than the one meant, and with no project open', async () => {
    const vault = new MemoryVault();
    const indexPath = seedProject(vault, { binder: 'not a list' });
    const { store } = makeStore(vault);
    expect(await store.createSnapshotNote('Folder', 'Name', PROPERTIES, 'x')).toMatchObject({ status: 'refused', reason: 'no-project' });
    await store.openProject(indexPath);
    expect(store.project?.readOnly).toBe(true);
    expect(await store.createSnapshotNote('Folder', 'Name', PROPERTIES, 'x')).toMatchObject({ status: 'refused', reason: 'read-only' });
    expect(await store.trashSnapshotNote('Snapshots/Folder/Name.md')).toMatchObject({ status: 'refused', reason: 'read-only' });
    expect(await store.replaceSceneText('Manuscript/Opening.md', () => 'x')).toMatchObject({ status: 'refused', reason: 'read-only' });

    const open = await openSeeded({ scenes: { Opening: 1024 } });
    expect(await open.store.createSnapshotNote('Folder', 'Name', PROPERTIES, 'x', 'Other/Other.md')).toMatchObject({ status: 'refused', reason: 'other-project' });
    expect(await open.store.replaceSceneText('Manuscript/Opening.md', () => 'x', 'Other/Other.md')).toMatchObject({ status: 'refused', reason: 'other-project' });
    expect(open.vault.writes).toEqual([]);
  });
});

describe('ProjectStore.trashSnapshotNote', () => {
  it('moves a snapshot to the trash, and nothing but a snapshot', async () => {
    const { store, vault } = await openSeeded({ scenes: { Opening: 1024 } });
    vault.seed('Novel/Research/Harbours.md', { body: 'Notes.' });
    vault.seed('Novel/To-do.md', { body: '- [ ] one' });
    const made = valueOf(await store.createSnapshotNote('Opening - abc', 'First', PROPERTIES, 'One.\n'));
    vault.clearWrites();
    for (const path of [
      'Manuscript/Opening.md',
      'Research/Harbours.md',
      'To-do.md',
      'Novel.md',
      'Snapshots/First.md',
      'Snapshots/Opening - abc',
      'Snapshots/Opening - abc/Deeper/First.md',
      'Snapshots/../Manuscript/Opening.md',
      'Snapshots/Opening - abc/../../Manuscript/Opening.md',
      '../Novel/Snapshots/Opening - abc/First.md',
      'Snapshots/Opening - abc/First.txt',
    ]) {
      expect(await store.trashSnapshotNote(path), path).toMatchObject({ status: 'refused', reason: 'invalid-path' });
    }
    expect(vault.trashed).toEqual([]);
    expect(await store.trashSnapshotNote('Snapshots/Opening - abc/Gone.md')).toMatchObject({ status: 'noop', reason: 'not-found' });
    expect(await store.trashSnapshotNote(made.path)).toEqual({ status: 'done', value: undefined });
    expect(vault.trashed).toEqual(['Novel/Snapshots/Opening - abc/First.md']);
    expect(vault.writes).toEqual([{ op: 'trash', path: 'Novel/Snapshots/Opening - abc/First.md' }]);
    expect(vault.has(OPENING)).toBe(true);
  });
});

describe('ProjectStore.replaceSceneText', () => {
  it('replaces the text of a scene, handing the text as it is on disk at that moment', async () => {
    const { store, vault } = await openSeeded({ scenes: { Opening: 1024, Closing: 2048 } });
    const index = vault.textOf('Novel/Novel.md');
    const closing = vault.textOf('Novel/Manuscript/Closing.md');
    // Another device changes the scene after the store last looked.
    vault.external.write(OPENING, { body: 'Changed elsewhere.\n' }, { silent: true });
    let seen = '';
    const result = await store.replaceSceneText('Manuscript/Opening.md', (current) => {
      seen = current;
      return current.replace('Changed elsewhere.', 'Restored.');
    });
    expect(result).toEqual({ status: 'done', value: undefined });
    expect(seen).toContain('Changed elsewhere.');
    expect(vault.bodyOf(OPENING)).toBe('Restored.\n');
    expect(vault.frontmatterOf(OPENING)).toEqual({ status: 'To do', order: 1024 });
    expect(vault.writes).toEqual([{ op: 'replaceText', path: OPENING }]);
    expect(vault.textOf('Novel/Novel.md')).toBe(index);
    expect(vault.textOf('Novel/Manuscript/Closing.md')).toBe(closing);
  });

  it('leaves the scene exactly as it is when the callback says so', async () => {
    const { store, vault } = await openSeeded({ scenes: { Opening: 1024 } });
    const before = vault.textOf(OPENING);
    expect(await store.replaceSceneText('Manuscript/Opening.md', () => null)).toMatchObject({ status: 'noop', reason: 'unchanged' });
    expect(await store.replaceSceneText('Manuscript/Opening.md', (current) => current)).toMatchObject({ status: 'noop', reason: 'unchanged' });
    expect(vault.writes).toEqual([]);
    expect(vault.textOf(OPENING)).toBe(before);
  });

  it('accepts a scene and nothing else: no index, no snapshot, no to-do list, no research, nothing outside the project', async () => {
    const vault = new MemoryVault();
    vault.seed('Notes/Plain.md', { body: 'Not part of any project.' });
    vault.seed('Novel/Research/Harbours.md', { body: 'Notes.' });
    vault.seed('Novel/Timeline/Storm.md', { frontmatter: { date: '1890-01-01' }, body: '' });
    vault.seed('Novel/To-do.md', { body: '- [ ] one' });
    vault.seed('Novel/Stats/2026-10 dev.md', { body: 'log' });
    vault.seed('Novel/Novel 2.md', { frontmatter: { spellbook: 'project', version: 1, binder: [] }, body: INDEX_BODY });
    vault.seed('Novel/Manuscript/Novel 3.md', { frontmatter: { spellbook: 'project', version: 1, binder: [] }, body: '' });
    const { store } = await openSeeded({ scenes: { Opening: 1024 } }, vault);
    valueOf(await store.createSnapshotNote('Opening - abc', 'First', PROPERTIES, 'One.\n'));
    const before = new Map(vault.paths().map((path) => [path, vault.textOf(path)]));
    vault.clearWrites();
    let called = 0;
    const change = (): string => {
      called++;
      return 'REPLACED';
    };
    for (const [path, reason] of [
      ['Novel.md', 'invalid-path'],
      ['Novel 2.md', 'invalid-path'],
      ['Manuscript/Novel 3.md', 'invalid-path'],
      ['Snapshots/Opening - abc/First.md', 'invalid-path'],
      ['To-do.md', 'invalid-path'],
      ['Stats/2026-10 dev.md', 'invalid-path'],
      ['Research/Harbours.md', 'invalid-path'],
      ['Timeline/Storm.md', 'invalid-path'],
      ['../Notes/Plain.md', 'invalid-path'],
      ['Manuscript/../../Notes/Plain.md', 'invalid-path'],
      ['/Notes/Plain.md', 'invalid-path'],
      ['Manuscript/Opening.txt', 'invalid-path'],
      ['Manuscript', 'invalid-path'],
      ['', 'invalid-path'],
      ['Manuscript/Not there.md', 'missing-file'],
    ] as const) {
      expect(await store.replaceSceneText(path, change), path).toMatchObject({ status: 'refused', reason });
    }
    expect(called).toBe(0);
    expect(vault.writes).toEqual([]);
    for (const [path, text] of before) expect(vault.textOf(path), path).toBe(text);
  });

  it('refuses a snapshot even when the binder lists it, and says so when the save fails or the note is gone', async () => {
    const vault = new MemoryVault();
    vault.seed('Novel/Snapshots/Folder/Old.md', { frontmatter: PROPERTIES, body: 'Old.\n' });
    const { store } = await openSeeded({ binder: ['Manuscript/Opening.md', 'Snapshots/Folder/Old.md'], scenes: { Opening: 1024 } }, vault);
    expect(await store.replaceSceneText('Snapshots/Folder/Old.md', () => 'x')).toMatchObject({ status: 'refused', reason: 'invalid-path' });

    vault.failNext('replaceText');
    const failed = await store.replaceSceneText('Manuscript/Opening.md', () => 'x');
    expect(failed).toMatchObject({ status: 'failed' });
    expect(vault.bodyOf(OPENING)).toBe(sceneBody('Opening'));

    // Gone from the disk: nothing is created in its place.
    vault.external.delete(OPENING, { silent: true });
    expect(await store.replaceSceneText('Manuscript/Opening.md', () => 'x')).toMatchObject({ status: 'refused', reason: 'missing-file' });
    expect(vault.has(OPENING)).toBe(false);
  });
});
