// Project store: every rename and move Spellbook makes (renameScene,
// renameBoardFile, renameWorldNote, moveInProject) goes through one routine
// that renames without the vault's own link updating (which can stop to ask
// the writer) and then points the links at the new place itself: in notes'
// text and properties, and in boards' file cards and text cards. How far it
// reaches follows the link scope: the open project only, or the whole vault.

import { describe, expect, it } from 'vitest';
import type { LinkScope } from '../src/core/links';
import { ProjectStore } from '../src/core/projectStore';
import { ObsidianVault } from '../src/obsidian/obsidianVault';
import { FakeObsidian, note } from './fakeObsidianApp';
import { MemoryVault } from './memoryVault';
import { binderOnDisk, fixedRandom, openSeeded, picture, valueOf } from './storeHarness';

const MIDDLE = 'Novel/Manuscript/Middle.md';
const BOARD = 'Novel/Boards/Plot.canvas';
const OUTSIDE_BOARD = 'Elsewhere/Map.canvas';

/** A board with a file card for a note and a text card that links to it. */
function boardFor(file: string, link: string): string {
  return (
    '{\n\t"nodes":[\n' +
    `\t\t{"id":"f1","type":"file","file":"${file}","x":0,"y":0,"width":260,"height":120},\n` +
    `\t\t{"id":"t1","type":"text","text":"Then [[${link}#Storm|the storm]].","x":300,"y":0,"width":260,"height":120}\n` +
    '\t],\n\t"edges":[\n\t\t{"id":"e1","fromNode":"t1","toNode":"f1"}\n\t]\n}\n'
  );
}

function cardsOf(vault: MemoryVault, path: string): { file: unknown; text: unknown; ids: unknown[] } {
  const board = JSON.parse(vault.textOf(path)) as { nodes: Array<Record<string, unknown>> };
  return {
    file: board.nodes.find((node) => node['type'] === 'file')?.['file'],
    text: board.nodes.find((node) => node['type'] === 'text')?.['text'],
    ids: board.nodes.map((node) => node['id']),
  };
}

/** A project with three scenes, a research note, a board and notes outside it that all link to "Middle". */
function linked(): MemoryVault {
  return new MemoryVault()
    .seed('Novel/Manuscript/Opening.md', {
      frontmatter: { order: 1024, related: ['[[Middle]]', '[[Ending]]'] },
      body: 'Before [[Middle]], see [[Middle#The storm|the storm]], ![[Middle]], [[Middle^b1]], [it](Middle.md) and [[Ending]].\nIn code: `[[Middle]]`.',
    })
    .seed(MIDDLE, { frontmatter: { order: 2048 }, body: 'The middle. Back to [[Opening]].' })
    .seed('Novel/Manuscript/Ending.md', { frontmatter: { order: 3072 }, body: 'After [[Manuscript/Middle|the middle]].' })
    .seed('Novel/Research/Plan.md', { body: '| scene | [[Middle\\|M]] |' })
    .seed(BOARD, { body: boardFor(MIDDLE, 'Middle') })
    .seed('Elsewhere/Diary.md', { body: 'Wrote [[Middle]] today.' })
    .seed(OUTSIDE_BOARD, { body: boardFor(MIDDLE, 'Middle') });
}

const SCENES = { binder: ['Manuscript/Opening.md', 'Manuscript/Middle.md', 'Manuscript/Ending.md'] };

async function open(scope: LinkScope = 'project', vault: MemoryVault = linked()) {
  return openSeeded(SCENES, vault, () => scope);
}

describe('renaming a scene', () => {
  it('points every link to it in the project at the new name, keeping headings, blocks, shown texts and embeds', async () => {
    const { store, vault } = await open();
    const renamed = valueOf(await store.renameScene('Manuscript/Middle.md', 'Crossing'));
    expect(renamed).toEqual({
      path: 'Manuscript/Crossing.md',
      links: 10,
      notes: 4,
      scope: 'project',
      outside: ['Elsewhere/Diary.md', OUTSIDE_BOARD],
      missed: [],
    });
    expect(vault.bodyOf('Novel/Manuscript/Opening.md')).toBe(
      'Before [[Crossing]], see [[Crossing#The storm|the storm]], ![[Crossing]], [[Crossing^b1]], [it](Crossing.md) and [[Ending]].\nIn code: `[[Middle]]`.',
    );
    expect(vault.frontmatterOf('Novel/Manuscript/Opening.md')).toEqual({ order: 1024, related: ['[[Crossing]]', '[[Ending]]'] });
    expect(vault.bodyOf('Novel/Manuscript/Ending.md')).toBe('After [[Manuscript/Crossing|the middle]].');
    expect(vault.bodyOf('Novel/Research/Plan.md')).toBe('| scene | [[Crossing\\|M]] |');
    expect(cardsOf(vault, BOARD)).toEqual({ file: 'Novel/Manuscript/Crossing.md', text: 'Then [[Crossing#Storm|the storm]].', ids: ['f1', 't1'] });
    // The binder follows, and the scene's own text is as it was.
    expect(picture(store)).toBe('Opening Crossing Ending');
    expect(vault.bodyOf('Novel/Manuscript/Crossing.md')).toBe('The middle. Back to [[Opening]].');
  });

  it('leaves notes and boards outside the project alone with "this project only", and lists them', async () => {
    const { store, vault } = await open('project');
    await store.renameScene('Manuscript/Middle.md', 'Crossing');
    expect(vault.bodyOf('Elsewhere/Diary.md')).toBe('Wrote [[Middle]] today.');
    expect(cardsOf(vault, OUTSIDE_BOARD).file).toBe(MIDDLE);
    expect(vault.writes.every((write) => write.path.startsWith('Novel/'))).toBe(true);
    expect(store.linksFromOutside('Manuscript/Crossing.md')).toEqual([]);
  });

  it('brings notes and boards outside the project up to date too with "the whole vault"', async () => {
    const { store, vault } = await open('vault');
    const renamed = valueOf(await store.renameScene('Manuscript/Middle.md', 'Crossing'));
    expect(renamed).toMatchObject({ scope: 'vault', outside: [], links: 13, notes: 6, missed: [] });
    expect(vault.bodyOf('Elsewhere/Diary.md')).toBe('Wrote [[Crossing]] today.');
    expect(cardsOf(vault, OUTSIDE_BOARD)).toEqual({ file: 'Novel/Manuscript/Crossing.md', text: 'Then [[Crossing#Storm|the storm]].', ids: ['f1', 't1'] });
  });

  it('asks the setting at each rename', async () => {
    let scope: LinkScope = 'project';
    const { store, vault } = await openSeeded(SCENES, linked(), () => scope);
    expect(store.linkScope).toBe('project');
    await store.renameScene('Manuscript/Middle.md', 'Crossing');
    expect(vault.bodyOf('Elsewhere/Diary.md')).toBe('Wrote [[Middle]] today.');
    scope = 'vault';
    expect(store.linkScope).toBe('vault');
    await store.renameScene('Manuscript/Ending.md', 'Close');
    expect(vault.bodyOf('Novel/Manuscript/Opening.md')).toContain('and [[Close]].');
  });

  it('renames without the vault\'s own rename, and moves the file before it changes any link', async () => {
    const { store, vault } = await open();
    await store.renameScene('Manuscript/Middle.md', 'Crossing');
    const ops = vault.writes.map((write) => write.op);
    expect(ops[0]).toBe('moveFile');
    expect(ops.filter((op) => op === 'moveFile')).toHaveLength(1);
    expect(new Set(ops)).toEqual(new Set(['moveFile', 'updateLinks', 'updateFrontmatter', 'updateBoardText']));
  });

  it('names the note that could not be brought up to date, and does the rest', async () => {
    const { store, vault } = await open();
    vault.failNext('updateLinks', 'Novel/Research/Plan.md');
    const renamed = valueOf(await store.renameScene('Manuscript/Middle.md', 'Crossing'));
    expect(renamed.missed).toEqual(['Plan']);
    expect(vault.bodyOf('Novel/Research/Plan.md')).toBe('| scene | [[Middle\\|M]] |');
    expect(vault.bodyOf('Novel/Manuscript/Ending.md')).toBe('After [[Manuscript/Crossing|the middle]].');
  });

  it('works for Hebrew names', async () => {
    const vault = new MemoryVault()
      .seed('Novel/Manuscript/פתיחה.md', { frontmatter: { order: 1024 }, body: 'ראו [[אמצע|את האמצע]].' })
      .seed('Novel/Manuscript/אמצע.md', { frontmatter: { order: 2048 }, body: 'האמצע.' });
    const { store } = await openSeeded({ binder: ['Manuscript/פתיחה.md', 'Manuscript/אמצע.md'] }, vault);
    expect(valueOf(await store.renameScene('Manuscript/אמצע.md', 'מעבר')).links).toBe(1);
    expect(vault.bodyOf('Novel/Manuscript/פתיחה.md')).toBe('ראו [[מעבר|את האמצע]].');
  });
});

describe('renaming a board', () => {
  it('points the links to it at the new name, in notes and on other boards', async () => {
    const vault = linked()
      .seed('Novel/Research/Boards list.md', { body: 'See [[Plot.canvas]] and ![[Boards/Plot.canvas]].' })
      .seed('Novel/Boards/All.canvas', { body: boardFor(BOARD, 'Plot.canvas') });
    const { store } = await open('project', vault);
    const renamed = valueOf(await store.renameBoardFile('Boards/Plot.canvas', 'Story'));
    expect(renamed).toMatchObject({ path: 'Boards/Story.canvas', links: 4, notes: 2, outside: [], missed: [] });
    expect(vault.bodyOf('Novel/Research/Boards list.md')).toBe('See [[Story.canvas]] and ![[Boards/Story.canvas]].');
    expect(cardsOf(vault, 'Novel/Boards/All.canvas')).toMatchObject({ file: 'Novel/Boards/Story.canvas', text: 'Then [[Story.canvas#Storm|the storm]].' });
    // The board itself is moved as it is.
    expect(cardsOf(vault, 'Novel/Boards/Story.canvas').file).toBe(MIDDLE);
  });
});

describe('renaming a World note', () => {
  it('follows the setting too', async () => {
    const vault = linked().seed('Novel/World/Characters/Mara.md', { body: 'Her story.' }).seed('Elsewhere/Mara notes.md', { body: '[[Mara]]' });
    const project = await open('project', vault);
    expect(valueOf(await project.store.renameWorldNote('World/Characters/Mara.md', 'Mara Voss')).outside).toEqual(['Elsewhere/Mara notes.md']);
    expect(vault.bodyOf('Elsewhere/Mara notes.md')).toBe('[[Mara]]');
    project.store.dispose();
    const whole = await open('vault', vault);
    expect(valueOf(await whole.store.renameWorldNote('World/Characters/Mara Voss.md', 'Mara')).outside).toEqual([]);
    // The note outside still named the very first name, which leads to the note again.
    expect(vault.bodyOf('Elsewhere/Mara notes.md')).toBe('[[Mara]]');
  });
});

describe('moveInProject', () => {
  /** A project with a World folder whose notes are linked to in several ways. */
  function world(): MemoryVault {
    return linked()
      .seed('Novel/World/Characters/Mara.md', { body: 'Sister of [[Joss]], see [[Characters/Joss|him]].' })
      .seed('Novel/World/Characters/Joss.md', { frontmatter: { friend: '[[World/Characters/Mara|M]]' }, body: 'Brother.' })
      .seed('Novel/World/Characters/Portraits/Mara.png', { bytes: new Uint8Array([1, 2, 3]) })
      .seed('Novel/Research/Cast.md', {
        body: '[[Mara]], [[World/Characters/Mara#Youth|young Mara]], ![[Characters/Portraits/Mara.png]], [J](World/Characters/Joss.md)',
      })
      .seed('Novel/Boards/Cast.canvas', { body: boardFor('Novel/World/Characters/Joss.md', 'Characters/Joss') })
      .seed('Elsewhere/Cast.md', { body: '[[World/Characters/Joss]]' });
  }

  it('moves a folder with everything in it, and points the links to every note inside it at the new place', async () => {
    const { store, vault } = await open('project', world());
    const moved = valueOf(await store.moveInProject('World/Characters', 'World/People'));
    expect(moved).toMatchObject({ path: 'World/People', scope: 'project', outside: ['Elsewhere/Cast.md'], missed: [] });
    expect(vault.has('Novel/World/People/Mara.md')).toBe(true);
    expect(vault.has('Novel/World/People/Portraits/Mara.png')).toBe(true);
    expect(vault.has('Novel/World/Characters/Mara.md')).toBe(false);
    // A bare name still leads to the note, and stays as it is; a path names the new folder, with as many steps as before.
    expect(vault.bodyOf('Novel/Research/Cast.md')).toBe(
      '[[Mara]], [[World/People/Mara#Youth|young Mara]], ![[People/Portraits/Mara.png]], [J](World/People/Joss.md)',
    );
    // Links between notes inside the folder, in their text and in their properties.
    expect(vault.bodyOf('Novel/World/People/Mara.md')).toBe('Sister of [[Joss]], see [[People/Joss|him]].');
    expect(vault.frontmatterOf('Novel/World/People/Joss.md')).toEqual({ friend: '[[World/People/Mara|M]]' });
    expect(cardsOf(vault, 'Novel/Boards/Cast.canvas')).toMatchObject({ file: 'Novel/World/People/Joss.md', text: 'Then [[People/Joss#Storm|the storm]].' });
    expect(vault.bodyOf('Elsewhere/Cast.md')).toBe('[[World/Characters/Joss]]');
  });

  it('brings the notes outside the project up to date as well with "the whole vault"', async () => {
    const { store, vault } = await open('vault', world());
    expect(valueOf(await store.moveInProject('World/Characters', 'World/People')).outside).toEqual([]);
    expect(vault.bodyOf('Elsewhere/Cast.md')).toBe('[[World/People/Joss]]');
  });

  it('moves a folder of scenes, and the binder follows', async () => {
    const vault = new MemoryVault()
      .seed('Novel/Manuscript/Act 1/One.md', { frontmatter: { order: 1024 }, body: 'Then [[Manuscript/Act 1/Two]].' })
      .seed('Novel/Manuscript/Act 1/Two.md', { frontmatter: { order: 2048 }, body: 'Back to [[Act 1/One|one]].' })
      .seed('Novel/Research/Plan.md', { body: '[[Two]] and [[Act 1/Two.md]].' });
    const { store, indexPath } = await openSeeded({ binder: ['Manuscript/Act 1/One.md', 'Manuscript/Act 1/Two.md'] }, vault);
    const moved = valueOf(await store.moveInProject('Manuscript/Act 1', 'Manuscript/Part one'));
    expect(moved).toMatchObject({ path: 'Manuscript/Part one', links: 3, notes: 3 });
    expect(binderOnDisk(vault, indexPath)).toEqual(['Manuscript/Part one/One.md', 'Manuscript/Part one/Two.md']);
    expect(picture(store)).toBe('One Two');
    expect(vault.bodyOf('Novel/Manuscript/Part one/One.md')).toBe('Then [[Manuscript/Part one/Two]].');
    expect(vault.bodyOf('Novel/Manuscript/Part one/Two.md')).toBe('Back to [[Part one/One|one]].');
    expect(vault.bodyOf('Novel/Research/Plan.md')).toBe('[[Two]] and [[Part one/Two.md]].');
  });

  it('moves a single note into a new folder, making the folder', async () => {
    const { store, vault } = await open();
    const moved = valueOf(await store.moveInProject('Research/Plan.md', 'Research/Old/Plan.md'));
    expect(moved.path).toBe('Research/Old/Plan.md');
    expect(vault.writes.slice(0, 2)).toEqual([
      { op: 'createFolder', path: 'Novel/Research/Old' },
      { op: 'moveFile', path: 'Novel/Research/Plan.md', to: 'Novel/Research/Old/Plan.md' },
    ]);
  });

  it('refuses what it must not move, and replaces nothing', async () => {
    const { store, vault } = await open('project', world());
    expect(await store.moveInProject('Novel.md', 'Book.md')).toMatchObject({ status: 'refused', reason: 'invalid-path' });
    expect(await store.moveInProject('World', 'World/Inner/World')).toMatchObject({ status: 'refused', reason: 'invalid-move' });
    expect(await store.moveInProject('World/Characters/Mara.md', 'World/Characters/Joss.md')).toMatchObject({ status: 'refused', reason: 'exists' });
    expect(await store.moveInProject('World/Characters/Mara.md', 'World/Characters/Mara.txt')).toMatchObject({ status: 'refused', reason: 'invalid-name' });
    expect(await store.moveInProject('../Elsewhere/Cast.md', 'Research/Cast 2.md')).toMatchObject({ status: 'refused', reason: 'invalid-path' });
    expect(await store.moveInProject('Research/Plan.md', '../Plan.md')).toMatchObject({ status: 'refused', reason: 'invalid-path' });
    expect(await store.moveInProject('Research/Nothing.md', 'Research/Else.md')).toMatchObject({ status: 'noop', reason: 'not-found' });
    expect(await store.moveInProject('Research/Plan.md', 'Research/Plan.md')).toMatchObject({ status: 'noop', reason: 'unchanged' });
    expect(vault.writes).toEqual([]);
  });

  it('refuses a folder that holds another project', async () => {
    const vault = world()
      .seed('Novel/Inner/Inner.md', { frontmatter: { spellbook: 'project', version: 1, binder: [] }, body: '' });
    const { store } = await open('project', vault);
    expect(await store.moveInProject('Inner', 'Elsewhere inside')).toMatchObject({ status: 'refused', reason: 'invalid-path' });
  });
});

describe('on top of Obsidian', () => {
  function started(scope: LinkScope): { fake: FakeObsidian; store: ProjectStore } {
    const fake = new FakeObsidian();
    fake.addNote('Novel/Novel.md', note({ spellbook: 'project', version: 1, binder: ['Manuscript/Opening.md', 'Manuscript/Middle.md'] }, ''));
    fake.addNote('Novel/Manuscript/Opening.md', note({ order: 1024, next: '[[Middle]]' }, 'On to [[Middle#Storm|the storm]] and ![[Middle]].'));
    fake.addNote(MIDDLE, note({ order: 2048 }, 'The middle.'));
    fake.addNote('Novel/World/Characters/Mara.md', 'Her.');
    fake.addNote('Novel/Research/Cast.md', '[[World/Characters/Mara|M]]');
    fake.addNote(BOARD, boardFor(MIDDLE, 'Middle'));
    fake.addNote('Elsewhere/Diary.md', 'Wrote [[Middle]].');
    const vault = new ObsidianVault(fake.app);
    const store = new ProjectStore({ vault, today: () => '2026-10-14', setTimer: () => () => undefined, random: fixedRandom(), linkScope: () => scope });
    store.start();
    return { fake, store };
  }

  it('renames a scene with vault.rename only, never asking about links, and changes the links itself', async () => {
    const { fake, store } = started('project');
    await store.openProject('Novel/Novel.md');
    fake.calls.length = 0;
    const renamed = valueOf(await store.renameScene('Manuscript/Middle.md', 'Crossing'));
    expect(renamed).toMatchObject({ path: 'Manuscript/Crossing.md', outside: ['Elsewhere/Diary.md'], missed: [] });
    expect(fake.calls[0]).toBe('vault.rename Novel/Manuscript/Middle.md -> Novel/Manuscript/Crossing.md');
    expect(fake.calls.some((call) => call.startsWith('renameFile'))).toBe(false);
    expect(fake.textOf('Novel/Manuscript/Opening.md')).toContain('On to [[Crossing#Storm|the storm]] and ![[Crossing]].');
    expect(fake.textOf('Novel/Manuscript/Opening.md')).not.toContain('[[Middle');
    expect(fake.textOf('Novel/Manuscript/Opening.md')).toMatch(/"?next"?: "\[\[Crossing\]\]"/);
    expect(JSON.parse(fake.textOf(BOARD)).nodes[0].file).toBe('Novel/Manuscript/Crossing.md');
    expect(fake.textOf('Elsewhere/Diary.md')).toBe('Wrote [[Middle]].');
    store.dispose();
  });

  it('changes the notes outside the project too with "the whole vault"', async () => {
    const { fake, store } = started('vault');
    await store.openProject('Novel/Novel.md');
    await store.renameScene('Manuscript/Middle.md', 'Crossing');
    expect(fake.textOf('Elsewhere/Diary.md')).toBe('Wrote [[Crossing]].');
    store.dispose();
  });

  it('moves a folder with vault.rename, and the links to the notes inside it follow', async () => {
    const { fake, store } = started('project');
    await store.openProject('Novel/Novel.md');
    fake.calls.length = 0;
    const moved = valueOf(await store.moveInProject('World/Characters', 'World/People'));
    expect(moved).toMatchObject({ path: 'World/People', links: 1, notes: 1 });
    expect(fake.calls[0]).toBe('vault.rename Novel/World/Characters -> Novel/World/People');
    expect(fake.textOf('Novel/World/People/Mara.md')).toBe('Her.');
    expect(fake.textOf('Novel/Research/Cast.md')).toBe('[[World/People/Mara|M]]');
    store.dispose();
  });
});
