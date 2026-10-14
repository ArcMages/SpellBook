// The project store's side of templates, on the memory vault: a scene made
// with what a template gives, reading templates, saving and trashing them in
// the two places they may be, and nothing anywhere else. Also: a project
// created from a starting structure, and the word counts that leave
// templates out.

import { describe, expect, it } from 'vitest';
import { createStarterProject } from '../../src/core/newProject';
import { classifyNote } from '../../src/core/progress';
import { LIBRARY_FOLDER, findStructure, projectTemplateNote, readProjectTemplate, sceneStart, seedOfParts } from '../../src/core/templates';
import { MemoryVault } from '../memoryVault';
import { TODAY, makeStore, openSeeded, picture, project, settle, valueOf } from '../storeHarness';

describe('a new scene made from a template', () => {
  it('starts with the template\'s properties and text, but its own order and creation day', async () => {
    const { store, vault } = await openSeeded({ scenes: { Opening: 1024 } });
    const start = sceneStart(
      { frontmatter: { synopsis: 'About {{title}}', status: 'First draft', pov: 'Mara', order: 1, created: '2000-01-01', spellbook: 'project' }, body: '# {{title}}\n\n{{project}}, {{date}}\n' },
      { title: 'לילה', date: store.today(), project: 'My Novel' },
    );
    const made = valueOf(await store.addScene('לילה', undefined, undefined, start));
    expect(made.path).toBe('Manuscript/לילה.md');
    expect(vault.frontmatterOf('Novel/Manuscript/לילה.md')).toEqual({
      synopsis: 'About לילה',
      status: 'First draft',
      label: '',
      compile: true,
      order: 2048,
      created: TODAY,
      pov: 'Mara',
    });
    expect(vault.bodyOf('Novel/Manuscript/לילה.md')).toBe(`# לילה\n\nMy Novel, ${TODAY}\n`);
    expect(picture(store)).toBe('Opening לילה');
  });

  it('is the same as ever without one', async () => {
    const { store, vault } = await openSeeded({ scenes: { Opening: 1024 } });
    valueOf(await store.addScene('Plain'));
    expect(vault.frontmatterOf('Novel/Manuscript/Plain.md')).toEqual({ synopsis: '', status: 'To do', label: '', compile: true, order: 2048, created: TODAY });
    expect(vault.bodyOf('Novel/Manuscript/Plain.md')).toBe('');
  });

  it('knows today', () => {
    expect(makeStore().store.today()).toBe(TODAY);
  });
});

describe('templates of a project', () => {
  it('are saved in Templates/Scenes and Templates/World/<type>, folders made as needed, and read back', async () => {
    const { store, vault, indexPath } = await openSeeded({ scenes: { Opening: 1024 } });
    const scene = valueOf(await store.createTemplateNote('Scenes', 'Action', { status: 'To do', mood: 'tense' }, '## Beat\n', indexPath));
    expect(scene.path).toBe('Templates/Scenes/Action.md');
    expect(vault.hasFolder('Novel/Templates')).toBe(true);
    expect(vault.frontmatterOf('Novel/Templates/Scenes/Action.md')).toEqual({ status: 'To do', mood: 'tense' });
    const hero = valueOf(await store.createTemplateNote('World/Characters', 'גיבור', { type: 'character', role: '' }, 'Who?\n'));
    expect(hero.path).toBe('Templates/World/Characters/גיבור.md');
    await settle(store);

    expect(store.templateNotes().map((note) => note.path)).toEqual(['Templates/Scenes/Action.md', 'Templates/World/Characters/גיבור.md']);
    expect(valueOf(await store.readTemplate('Templates/World/Characters/גיבור.md', 'project'))).toEqual({ frontmatter: { type: 'character', role: '' }, body: 'Who?\n' });
    expect(valueOf(await store.readTemplate('Templates/Scenes/Action.md', 'project')).body).toBe('## Beat\n');
  });

  it('never replace a note, and are never made anywhere else', async () => {
    const { store, vault } = await openSeeded({ scenes: { Opening: 1024 } });
    valueOf(await store.createTemplateNote('Scenes', 'Action', {}, 'first'));
    vault.clearWrites();
    const again = await store.createTemplateNote('Scenes', 'action', {}, 'second');
    expect(again.status).toBe('refused');
    expect(vault.bodyOf('Novel/Templates/Scenes/Action.md')).toBe('first');
    for (const [folder, name] of [
      ['../Manuscript', 'Opening'],
      ['Manuscript', 'Opening'],
      ['Scenes/Deep', 'A'],
      ['World', 'A'],
      ['World/Characters/Deep', 'A'],
      ['Scenes', 'a:b'],
      ['Scenes', ''],
      ['Other', 'A'],
    ] as const) {
      const result = await store.createTemplateNote(folder, name, {}, '');
      expect(result.status, `${folder}/${name}`).toBe('refused');
    }
    const marked = await store.createTemplateNote('Scenes', 'Index', { spellbook: 'project' }, '');
    expect(marked.status).toBe('refused');
    expect(vault.writes).toEqual([]);
  });

  it('refuse a path the binder lists, and anything outside the Templates folder, when read or trashed', async () => {
    const { store, vault } = await openSeeded({ scenes: { Opening: 1024 }, binder: ['Manuscript/Opening.md', 'Templates/Scenes/Listed.md'] });
    vault.seed('Novel/Templates/Scenes/Listed.md', { frontmatter: { status: 'To do' }, body: 'listed' });
    await settle(store);
    expect((await store.readTemplate('Templates/Scenes/Listed.md', 'project')).status).toBe('refused');
    expect((await store.readTemplate('Manuscript/Opening.md', 'project')).status).toBe('refused');
    expect((await store.trashTemplateNote('Manuscript/Opening.md')).status).toBe('refused');
    expect((await store.trashTemplateNote('Templates/Scenes/Listed.md')).status).toBe('refused');
    expect(vault.trashed).toEqual([]);
  });

  it('are moved to the trash, never deleted', async () => {
    const { store, vault } = await openSeeded({ scenes: { Opening: 1024 } });
    valueOf(await store.createTemplateNote('Scenes', 'Action', {}, ''));
    await settle(store);
    valueOf(await store.trashTemplateNote('Templates/Scenes/Action.md'));
    expect(vault.trashed).toEqual(['Novel/Templates/Scenes/Action.md']);
    expect((await store.trashTemplateNote('Templates/Scenes/Action.md')).status).toBe('noop');
    expect((await store.readTemplate('Templates/Scenes/Action.md', 'project')).status).toBe('noop');
  });

  it('cannot be read or saved without an open project, or in a read-only one', async () => {
    const { store } = makeStore();
    expect((await store.readTemplate('Templates/Scenes/A.md', 'project')).status).toBe('refused');
    expect((await store.createTemplateNote('Scenes', 'A', {}, '')).status).toBe('refused');
    const broken = await openSeeded({ binder: 'not a list' });
    expect(project(broken.store).readOnly).toBe(true);
    expect((await broken.store.createTemplateNote('Scenes', 'A', {}, '')).status).toBe('refused');
  });

  it('are not scenes: not unfiled, not research, not in the binder', async () => {
    const { store, vault } = await openSeeded({ scenes: { Opening: 1024 } });
    valueOf(await store.createTemplateNote('Scenes', 'Action', { status: 'To do' }, 'words words'));
    vault.seed('Novel/Templates/Scenes/Loose.md', { body: 'x' });
    await settle(store);
    const snapshot = project(store);
    expect(snapshot.unfiled).toEqual([]);
    expect(snapshot.research).toEqual([]);
    expect(picture(store)).toBe('Opening');
    expect(store.worldNotes()).toEqual([]);
    expect(store.timelineNotes()).toEqual([]);
  });
});

describe('project templates of the vault', () => {
  const note = projectTemplateNote('Mine', [{ folder: 'Part', children: [{ title: 'One', synopsis: 'First' }] }]);

  it('are saved at the top of the vault, the folder made as needed, without an open project, and read back', async () => {
    const { store, vault } = makeStore();
    const made = valueOf(await store.createLibraryTemplate('Shape', note.frontmatter, note.body));
    expect(made.path).toBe(`${LIBRARY_FOLDER}/Shape.md`);
    expect(vault.hasFolder(LIBRARY_FOLDER)).toBe(true);
    expect(store.libraryNotes().map((file) => file.path)).toEqual([`${LIBRARY_FOLDER}/Shape.md`]);
    const read = valueOf(await store.readTemplate(made.path, 'library'));
    expect(readProjectTemplate(read.frontmatter)?.parts).toEqual([{ folder: 'Part', children: [{ title: 'One', synopsis: 'First' }] }]);
    expect(read.body).toBe(note.body);
  });

  it('never replace a note, never go anywhere else, and are moved to the trash', async () => {
    const { store, vault } = makeStore();
    vault.seed(`${LIBRARY_FOLDER}/Taken.md`, { body: 'mine' });
    vault.seed('Notes/Other.md', { body: 'not a template' });
    vault.clearWrites();
    expect((await store.createLibraryTemplate('taken', note.frontmatter, note.body)).status).toBe('refused');
    expect((await store.createLibraryTemplate('a/b', note.frontmatter, note.body)).status).toBe('refused');
    expect((await store.createLibraryTemplate('Index', { spellbook: 'project' }, '')).status).toBe('refused');
    expect((await store.trashLibraryTemplate('Notes/Other.md')).status).toBe('refused');
    expect((await store.trashLibraryTemplate(`${LIBRARY_FOLDER}/../Notes/Other.md`)).status).toBe('refused');
    expect((await store.readTemplate('Notes/Other.md', 'library')).status).toBe('refused');
    expect(vault.writes).toEqual([]);
    expect(vault.bodyOf(`${LIBRARY_FOLDER}/Taken.md`)).toBe('mine');

    valueOf(await store.trashLibraryTemplate(`${LIBRARY_FOLDER}/Taken.md`));
    expect(vault.trashed).toEqual([`${LIBRARY_FOLDER}/Taken.md`]);
    expect((await store.trashLibraryTemplate(`${LIBRARY_FOLDER}/Taken.md`)).status).toBe('noop');
  });

  it('are refused when the folder belongs to a project', async () => {
    const vault = new MemoryVault();
    vault.seed(`${LIBRARY_FOLDER}/${LIBRARY_FOLDER}.md`, { frontmatter: { spellbook: 'project', version: 1, binder: [] } });
    const { store } = makeStore(vault);
    await settle(store);
    expect((await store.createLibraryTemplate('Shape', note.frontmatter, note.body)).status).toBe('refused');
    expect(store.libraryNotes()).toEqual([]);
  });

  it('are not offered as a place to create a project in', () => {
    const vault = new MemoryVault();
    vault.seedFolder(LIBRARY_FOLDER);
    vault.seedFolder(`${LIBRARY_FOLDER}/Inner`);
    vault.seedFolder('Writing');
    expect(makeStore(vault).store.listParentFolders()).toEqual(['', 'Writing']);
  });
});

describe('a project created from a starting structure', () => {
  it('has the structure\'s folders and scenes in order, each with its synopsis and "To do"', async () => {
    const { store, vault } = makeStore();
    const structure = findStructure('three-acts');
    const made = valueOf(await createStarterProject(store, 'הספר', '', seedOfParts(structure?.parts(1) ?? [])));
    expect(made.project.scenes).toHaveLength(10);
    expect(picture(store)).toBe(
      'Act one: the setup[Everyday life The disturbance The decision] ' +
        'Act two: the struggle[New ground The midpoint Things fall apart The lowest point] ' +
        'Act three: the resolution[Gathering strength The final confrontation After]',
    );
    const first = vault.frontmatterOf('הספר/Manuscript/Everyday life.md');
    expect(first?.['status']).toBe('To do');
    expect(first?.['synopsis']).toMatch(/usual world/);
    expect(made.firstScene).toBe('הספר/Manuscript/Everyday life.md');
  });

  it('chapter by chapter makes as many chapters as asked', async () => {
    const { store } = makeStore();
    valueOf(await createStarterProject(store, 'Book', '', seedOfParts(findStructure('chapters')?.parts(3) ?? [])));
    expect(picture(store)).toBe('Chapter 1[Chapter 1, scene 1] Chapter 2[Chapter 2, scene 1] Chapter 3[Chapter 3, scene 1]');
  });

  it('with no structure is what it always was', async () => {
    const { store, vault } = makeStore();
    valueOf(await createStarterProject(store, 'Book'));
    expect(picture(store)).toBe('Scene 1');
    expect(vault.bodyOf('Book/Manuscript/Scene 1.md')).toBe('');
  });
});

describe('word counts', () => {
  it('leave templates out, in a project and at the top of the vault', () => {
    const projects = { folders: ['Novel'], active: 'Novel' };
    expect(classifyNote('Novel/Templates/Scenes/Action.md', projects)).toBeNull();
    expect(classifyNote('Novel/Templates/World/Characters/Hero.md', projects)).toBeNull();
    expect(classifyNote(`${LIBRARY_FOLDER}/Shape.md`, projects)).toBeNull();
    // Everything else is as it was.
    expect(classifyNote('Novel/Manuscript/Opening.md', projects)).toEqual({ project: 'Novel', bucket: 'manuscript' });
    expect(classifyNote('Novel/Research/Notes.md', projects)).toEqual({ project: 'Novel', bucket: 'other' });
    expect(classifyNote('Novel/Templatesque.md', projects)).toEqual({ project: 'Novel', bucket: 'other' });
  });
});
