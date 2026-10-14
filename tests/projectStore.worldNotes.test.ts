// Project store: the world-building notes.
//
// addWorldNote, renameWorldNote and trashWorldNote are the only ways a screen
// can make, rename or remove a note of the World folder. What is checked
// hardest: none of them replaces anything, none tidies a name behind the
// caller's back, none reaches outside the open project's World folder, and no
// scene, index or other note is ever renamed or trashed through them.

import { describe, expect, it } from 'vitest';
import { PROJECT_FOLDERS, ProjectStore, WORLD_FOLDER } from '../src/core/projectStore';
import { ObsidianVault } from '../src/obsidian/obsidianVault';
import { FakeObsidian, note } from './fakeObsidianApp';
import { MemoryVault } from './memoryVault';
import { binderOnDisk, makeStore, openSeeded, picture, sceneBody, seedProject, valueOf } from './storeHarness';

const INDEX = 'Novel/Novel.md';
const scenes = { scenes: { A: 1024, B: 2048 } };
const MARA = { type: 'character', role: '', summary: '', aliases: [] };
const BODY = '## Description\n\n## Notes\n\n';
/** "Mara", in Hebrew. */
const MARA_HE = 'מארה';

/** A project that already has a World folder with one character and one place in it. */
function withWorld(): MemoryVault {
  return new MemoryVault()
    .seed('Novel/World/Characters/Mara.md', { frontmatter: { type: 'character', summary: 'Keeps the light.' }, body: 'Her story so far.' })
    .seed('Novel/World/Places/Saltwick.md', { frontmatter: { type: 'place' }, body: 'A harbour town.' })
    .seed('Novel/Research/Tides.md', { body: 'High at noon.' })
    .seed('Elsewhere/Note.md', { frontmatter: { mine: true }, body: 'not yours' });
}

describe('the World folder', () => {
  it('is called World, and is not one of the folders every new project gets', () => {
    expect(WORLD_FOLDER).toBe('World');
    expect(PROJECT_FOLDERS).toEqual(['Manuscript', 'Timeline', 'Research', 'Stats']);
  });

  it('lists its notes with their properties, and nothing from outside it', async () => {
    const { store } = await openSeeded(scenes, withWorld());
    expect(store.worldNotes()).toEqual([
      { path: 'World/Characters/Mara.md', frontmatter: { type: 'character', summary: 'Keeps the light.' } },
      { path: 'World/Places/Saltwick.md', frontmatter: { type: 'place' } },
    ]);
    // They are not scenes waiting to be filed, and not research.
    expect(store.project?.unfiled).toEqual([]);
    expect(store.project?.research).toEqual(['Research/Tides.md']);
    const empty = await openSeeded(scenes);
    expect(empty.store.worldNotes()).toEqual([]);
  });
});

describe('addWorldNote', () => {
  it('makes a note in the folder of its type with the properties and the text given, in one write', async () => {
    const { store, vault } = await openSeeded(scenes, withWorld());
    const made = valueOf(await store.addWorldNote('Characters', 'Joss', MARA, BODY));
    expect(made).toEqual({ path: 'World/Characters/Joss.md' });
    expect(vault.writes).toEqual([{ op: 'createFile', path: 'Novel/World/Characters/Joss.md' }]);
    expect(vault.frontmatterOf('Novel/World/Characters/Joss.md')).toEqual(MARA);
    expect(vault.bodyOf('Novel/World/Characters/Joss.md')).toBe(BODY);
    expect(store.worldNotes().map((entry) => entry.path)).toContain('World/Characters/Joss.md');
    expect(store.vaultPathOf('World/Characters/Joss.md')).toBe('Novel/World/Characters/Joss.md');
  });

  it('makes the World folder and the type\'s folder first when the project has none', async () => {
    const { store, vault } = await openSeeded(scenes);
    valueOf(await store.addWorldNote('Characters', 'Mara', MARA));
    expect(vault.writes).toEqual([
      { op: 'createFolder', path: 'Novel/World' },
      { op: 'createFolder', path: 'Novel/World/Characters' },
      { op: 'createFile', path: 'Novel/World/Characters/Mara.md' },
    ]);
    expect(vault.bodyOf('Novel/World/Characters/Mara.md')).toBe('');
    // A note with no folder of its own goes straight into World.
    expect(valueOf(await store.addWorldNote('', 'Loose', { type: 'other' }))).toEqual({ path: 'World/Loose.md' });
  });

  it('leaves the binder, the index and every other note exactly as they were', async () => {
    const { store, vault } = await openSeeded(scenes, withWorld());
    const index = vault.textOf(INDEX);
    const before = picture(store);
    valueOf(await store.addWorldNote('Characters', 'Joss', MARA, BODY));
    expect(vault.textOf(INDEX)).toBe(index);
    expect(binderOnDisk(vault, INDEX)).toEqual(['Manuscript/A.md', 'Manuscript/B.md']);
    expect(picture(store)).toBe(before);
    expect(store.project?.unfiled).toEqual([]);
    expect(vault.bodyOf('Novel/World/Characters/Mara.md')).toBe('Her story so far.');
    expect(vault.bodyOf('Novel/Manuscript/A.md')).toBe(sceneBody('A'));
  });

  it('keeps a name and a folder in any language as they were given, and takes a copy of the properties', async () => {
    const { store, vault } = await openSeeded(scenes, withWorld());
    const given = { type: 'creature', aliases: ['x'] };
    expect(valueOf(await store.addWorldNote('יצורים', MARA_HE, given))).toEqual({ path: `World/יצורים/${MARA_HE}.md` });
    given.aliases.push('changed');
    expect(vault.frontmatterOf(`Novel/World/יצורים/${MARA_HE}.md`)).toEqual({ type: 'creature', aliases: ['x'] });
  });

  it('REFUSES a name that is taken, whatever its capitals, and replaces nothing', async () => {
    const { store, vault } = await openSeeded(scenes, withWorld());
    for (const name of ['Mara', 'MARA']) {
      expect(await store.addWorldNote('Characters', name, MARA, BODY), name).toMatchObject({ status: 'refused', reason: 'exists' });
    }
    expect(vault.writes).toEqual([]);
    expect(vault.frontmatterOf('Novel/World/Characters/Mara.md')).toEqual({ type: 'character', summary: 'Keeps the light.' });
    expect(vault.bodyOf('Novel/World/Characters/Mara.md')).toBe('Her story so far.');
    // The same name in another type's folder is another note.
    expect(valueOf(await store.addWorldNote('Places', 'Mara', { type: 'place' }))).toEqual({ path: 'World/Places/Mara.md' });
  });

  it('REFUSES every name and folder that is not a tidy file name as it stands, and reaches nowhere else', async () => {
    const { store, vault } = await openSeeded(scenes, withWorld());
    const before = vault.paths();
    const untidy = ['', ' ', ' padded', 'padded ', '.hidden', 'dot.', '..', '../Manuscript/A', '../../Elsewhere/Note', '/Elsewhere/Note', 'sub/folder', 'back\\slash', 'a:b', 'what?', '[link]', 'hash#tag', 'line\nbreak', 'x'.repeat(201)];
    for (const name of untidy) {
      expect(await store.addWorldNote('Characters', name, MARA), JSON.stringify(name)).toMatchObject({ status: 'refused', reason: 'invalid-name' });
    }
    for (const folder of untidy.filter((name) => name !== '')) {
      expect(await store.addWorldNote(folder, 'Joss', MARA), JSON.stringify(folder)).toMatchObject({ status: 'refused', reason: 'invalid-name' });
    }
    expect(vault.writes).toEqual([]);
    expect(vault.paths()).toEqual(before);
  });

  it('refuses properties that would make the note a project, a read-only project, no project and another project', async () => {
    const { store, vault } = await openSeeded(scenes, withWorld());
    expect(await store.addWorldNote('Characters', 'Sneaky', { spellbook: 'project', version: 1, binder: [] })).toMatchObject({ status: 'refused', reason: 'inside-project' });
    expect(await store.addWorldNote('Characters', 'Joss', MARA, '', 'Other/Other.md')).toMatchObject({ status: 'refused', reason: 'other-project' });
    expect(vault.writes).toEqual([]);

    const broken = new MemoryVault();
    seedProject(broken, { binder: { not: 'a list' }, scenes: { A: 1024 } });
    const closed = makeStore(broken);
    expect(await closed.store.addWorldNote('Characters', 'Joss', MARA)).toMatchObject({ status: 'refused', reason: 'no-project' });
    valueOf(await closed.store.openProject(INDEX));
    expect(await closed.store.addWorldNote('Characters', 'Joss', MARA)).toMatchObject({ status: 'refused', reason: 'read-only' });
    expect(broken.writes).toEqual([]);
  });

  it('takes its turn in the queue, and says so when the note could not be created', async () => {
    const { store, vault } = await openSeeded(scenes, withWorld());
    const [first, second] = await Promise.all([store.addWorldNote('Characters', 'Twice', MARA), store.addWorldNote('Characters', 'Twice', { type: 'place' })]);
    expect(first).toMatchObject({ status: 'done' });
    expect(second).toMatchObject({ status: 'refused', reason: 'exists' });
    expect(vault.frontmatterOf('Novel/World/Characters/Twice.md')).toEqual(MARA);

    vault.failNext('createFile', 'Novel/World/Characters/Unlucky.md');
    expect((await store.addWorldNote('Characters', 'Unlucky', MARA)).status).toBe('failed');
    expect(vault.has('Novel/World/Characters/Unlucky.md')).toBe(false);
    expect(valueOf(await store.addWorldNote('Characters', 'Unlucky', MARA))).toEqual({ path: 'World/Characters/Unlucky.md' });
  });
});

describe('renameWorldNote', () => {
  it('renames the note where it is, in one write, and leaves its text and properties alone', async () => {
    const { store, vault } = await openSeeded(scenes, withWorld());
    expect(valueOf(await store.renameWorldNote('World/Characters/Mara.md', 'Mara Voss'))).toEqual({ path: 'World/Characters/Mara Voss.md', links: 0, notes: 0, outside: [], missed: [] });
    expect(vault.writes).toEqual([{ op: 'moveFile', path: 'Novel/World/Characters/Mara.md', to: 'Novel/World/Characters/Mara Voss.md' }]);
    expect(vault.bodyOf('Novel/World/Characters/Mara Voss.md')).toBe('Her story so far.');
    expect(vault.frontmatterOf('Novel/World/Characters/Mara Voss.md')).toEqual({ type: 'character', summary: 'Keeps the light.' });
    expect(store.vaultPathOf('World/Characters/Mara Voss.md')).toBe('Novel/World/Characters/Mara Voss.md');
    expect(binderOnDisk(vault, INDEX)).toEqual(['Manuscript/A.md', 'Manuscript/B.md']);
  });

  it('brings every link to it in the project up to date itself, and asks the vault nothing', async () => {
    const vault = withWorld()
      .seed('Novel/Research/Lighthouse.md', {
        frontmatter: { related: ['[[Mara]]', '[[Saltwick]]'], about: '[[Mara|the keeper]]' },
        body: 'See [[Mara]], [[World/Characters/Mara|her]], ![[Mara#Youth]], [the keeper](Mara.md) and [[Saltwick]].\nIn code: `[[Mara]]`.',
      })
      .seed('Novel/World/Places/Harbour.md', { body: 'Kept by [[mara]] and [[Mara.md|Mara]].' })
      .seed('Elsewhere/Diary.md', { body: 'Met [[Mara]] today.' });
    // The entity's own note links to itself too.
    vault.external.write('Novel/World/Characters/Mara.md', { frontmatter: { type: 'character' }, body: 'Her story: [[Mara#Youth]].' });
    const { store } = await openSeeded(scenes, vault);
    vault.writes.length = 0;
    const result = valueOf(await store.renameWorldNote('World/Characters/Mara.md', 'Mara Voss'));
    expect(result).toEqual({ path: 'World/Characters/Mara Voss.md', links: 9, notes: 3, outside: ['Elsewhere/Diary.md'], missed: [] });
    expect(vault.bodyOf('Novel/Research/Lighthouse.md')).toBe(
      'See [[Mara Voss]], [[World/Characters/Mara Voss|her]], ![[Mara Voss#Youth]], [the keeper](Mara%20Voss.md) and [[Saltwick]].\nIn code: `[[Mara]]`.',
    );
    expect(vault.frontmatterOf('Novel/Research/Lighthouse.md')).toEqual({ related: ['[[Mara Voss]]', '[[Saltwick]]'], about: '[[Mara Voss|the keeper]]' });
    expect(vault.bodyOf('Novel/World/Places/Harbour.md')).toBe('Kept by [[Mara Voss]] and [[Mara Voss.md|Mara]].');
    expect(vault.bodyOf('Novel/World/Characters/Mara Voss.md')).toBe('Her story: [[Mara Voss#Youth]].');
    // Nothing outside the project is changed, and no rename that updates links was asked of the vault.
    expect(vault.bodyOf('Elsewhere/Diary.md')).toBe('Met [[Mara]] today.');
    expect(vault.writes.some((write) => write.op === 'rename')).toBe(false);
    expect(vault.writes.every((write) => write.path.startsWith('Novel/'))).toBe(true);
    expect(vault.writes[0]).toEqual({ op: 'moveFile', path: 'Novel/World/Characters/Mara.md', to: 'Novel/World/Characters/Mara Voss.md' });
  });

  it('names the whole path where another note of the new name would be found first', async () => {
    const vault = withWorld()
      .seed('Novel/World/Places/Joss.md', { body: 'A cove.' })
      .seed('Novel/World/Places/Map.md', { body: 'Near [[Mara]].' });
    const { store } = await openSeeded(scenes, vault);
    valueOf(await store.renameWorldNote('World/Characters/Mara.md', 'Joss'));
    expect(vault.bodyOf('Novel/World/Places/Map.md')).toBe('Near [[Novel/World/Characters/Joss]].');
  });

  it('may change only the capitals of a name, and does nothing for the name it already has', async () => {
    const { store, vault } = await openSeeded(scenes, withWorld());
    expect(await store.renameWorldNote('World/Characters/Mara.md', 'Mara')).toMatchObject({ status: 'noop', reason: 'unchanged' });
    expect(vault.writes).toEqual([]);
    expect(valueOf(await store.renameWorldNote('World/Characters/Mara.md', 'MARA'))).toMatchObject({ path: 'World/Characters/MARA.md' });
  });

  it('REFUSES a name that is taken or untidy, and replaces nothing', async () => {
    const vault = withWorld().seed('Novel/World/Characters/Joss.md', { frontmatter: { type: 'character' }, body: 'Joss.' });
    const { store } = await openSeeded(scenes, vault);
    expect(await store.renameWorldNote('World/Characters/Mara.md', 'joss')).toMatchObject({ status: 'refused', reason: 'exists' });
    for (const name of ['', ' x', '../Places/Saltwick', 'a/b', 'a:b']) {
      expect(await store.renameWorldNote('World/Characters/Mara.md', name), name).toMatchObject({ status: 'refused', reason: 'invalid-name' });
    }
    expect(vault.writes).toEqual([]);
    expect(vault.bodyOf('Novel/World/Characters/Joss.md')).toBe('Joss.');
  });

  it('REFUSES everything that is not a note of the World folder: scenes, research, the index, other vault notes', async () => {
    const { store, vault } = await openSeeded({ ...scenes, binder: ['Manuscript/A.md', 'Manuscript/B.md', 'World/Places/Saltwick.md'] }, withWorld());
    for (const path of ['Manuscript/A.md', 'Research/Tides.md', 'Novel.md', '../Elsewhere/Note.md', 'World/../Manuscript/A.md', 'World', 'World/Characters', 'To-do.md']) {
      const result = await store.renameWorldNote(path, 'Renamed');
      expect(result.status, path).toBe('refused');
      const trashed = await store.trashWorldNote(path);
      expect(trashed.status, path).toBe('refused');
    }
    // A World note that the binder lists is a scene: it is handled from the binder.
    expect(await store.renameWorldNote('World/Places/Saltwick.md', 'Renamed')).toMatchObject({ status: 'refused', reason: 'invalid-path' });
    expect(await store.trashWorldNote('World/Places/Saltwick.md')).toMatchObject({ status: 'refused', reason: 'invalid-path' });
    expect(await store.renameWorldNote('World/Characters/Nobody.md', 'Renamed')).toMatchObject({ status: 'refused', reason: 'missing-file' });
    expect(vault.writes).toEqual([]);
    expect(vault.trashed).toEqual([]);
  });

  it('says so when the rename fails, and refuses a read-only project', async () => {
    const { store, vault } = await openSeeded(scenes, withWorld());
    vault.failNext('moveFile', 'Novel/World/Characters/Mara.md');
    expect((await store.renameWorldNote('World/Characters/Mara.md', 'Other')).status).toBe('failed');
    expect(vault.has('Novel/World/Characters/Mara.md')).toBe(true);

    const broken = withWorld();
    seedProject(broken, { binder: { not: 'a list' } });
    const closed = makeStore(broken);
    valueOf(await closed.store.openProject(INDEX));
    expect(await closed.store.renameWorldNote('World/Characters/Mara.md', 'Other')).toMatchObject({ status: 'refused', reason: 'read-only' });
    expect(await closed.store.trashWorldNote('World/Characters/Mara.md')).toMatchObject({ status: 'refused', reason: 'read-only' });
    expect(broken.writes).toEqual([]);
  });
});

describe('trashWorldNote', () => {
  it('moves the note to the trash, never deletes it outright, and touches nothing else', async () => {
    const { store, vault } = await openSeeded(scenes, withWorld());
    const index = vault.textOf(INDEX);
    valueOf(await store.trashWorldNote('World/Characters/Mara.md'));
    expect(vault.writes).toEqual([{ op: 'trash', path: 'Novel/World/Characters/Mara.md' }]);
    expect(vault.trashed).toEqual(['Novel/World/Characters/Mara.md']);
    expect(store.worldNotes().map((entry) => entry.path)).toEqual(['World/Places/Saltwick.md']);
    expect(vault.textOf(INDEX)).toBe(index);
    expect(vault.hasFolder('Novel/World/Characters')).toBe(true); // the folder stays
  });

  it('says so when the note could not be moved to the trash, and leaves it where it is', async () => {
    const { store, vault } = await openSeeded(scenes, withWorld());
    vault.failNext('trash', 'Novel/World/Characters/Mara.md');
    expect((await store.trashWorldNote('World/Characters/Mara.md')).status).toBe('failed');
    expect(vault.has('Novel/World/Characters/Mara.md')).toBe(true);
    expect(vault.trashed).toEqual([]);
  });
});

describe('the real vault doorway', () => {
  it('resolves a link through Obsidian\'s own index of links, from the note it is written in', () => {
    const fake = new FakeObsidian();
    fake.addNote('Novel/Novel.md', note({ spellbook: 'project', version: 1, binder: ['Manuscript/Opening.md'] }));
    fake.addNote('Novel/Manuscript/Opening.md', note({ entities: ['[[Mara]]'] }, 'Text.'));
    fake.addNote('Novel/World/Characters/Mara.md', note({ type: 'character' }));
    const vault = new ObsidianVault(fake.app);
    vault.start();
    fake.finishStartup();
    expect(vault.resolveLink('Mara', 'Novel/Manuscript/Opening.md')).toBe('Novel/World/Characters/Mara.md');
    expect(vault.resolveLink('Novel/World/Characters/Mara', 'Novel/Manuscript/Opening.md')).toBe('Novel/World/Characters/Mara.md');
    expect(vault.resolveLink('Nobody', 'Novel/Manuscript/Opening.md')).toBeNull();
    expect(fake.calls).toEqual([]); // looking a link up writes nothing
  });

  it('renames an entity through the real doorway without asking the vault to update links, and the links follow', async () => {
    const fake = new FakeObsidian();
    fake.addNote('Novel/Novel.md', note({ spellbook: 'project', version: 1, binder: ['Manuscript/Opening.md'] }));
    fake.addNote('Novel/Manuscript/Opening.md', note({ entities: ['[[Mara]]'] }, 'Text with [[Mara|her]] in it.\n'));
    fake.addNote('Novel/World/Characters/Mara.md', note({ type: 'character' }));
    fake.addNote('Diary.md', 'About [[Mara]].');
    const vault = new ObsidianVault(fake.app);
    vault.start();
    fake.finishStartup();
    const store = new ProjectStore({ vault, today: () => '2026-01-01', setTimer: () => () => undefined, random: () => 0.5 });
    store.start();
    valueOf(await store.openProject(INDEX));
    const result = valueOf(await store.renameWorldNote('World/Characters/Mara.md', 'Mara Voss'));
    expect(result).toMatchObject({ path: 'World/Characters/Mara Voss.md', links: 2, notes: 1, outside: ['Diary.md'] });
    expect(fake.calls.some((call) => call.startsWith('renameFile'))).toBe(false);
    const text = fake.vault.text.get('Novel/Manuscript/Opening.md') ?? '';
    expect(text).toContain('Text with [[Mara Voss|her]] in it.');
    expect(text).toContain('[[Mara Voss]]');
    expect(fake.vault.text.get('Diary.md')).toBe('About [[Mara]].');
  });
});
