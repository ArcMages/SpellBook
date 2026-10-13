// Creating a project that starts with something in it: createProject() with a
// seed, the "Sample Novel 2" numbering, and the list of folders a project can
// be created in. All through the memory vault.

import { describe, expect, it } from 'vitest';
import { createStarterProject } from '../src/core/newProject';
import { ProjectStore } from '../src/core/projectStore';
import { countSeedScenes, FIRST_SCENE_TITLE, starterProject } from '../src/core/projectSeed';
import type { ProjectSeed } from '../src/core/projectSeed';
import { ManualTimers, MemoryVault } from './memoryVault';
import { binderOnDisk, draw, makeStore, picture, project, seedProject, settle, TODAY, valueOf } from './storeHarness';

/** A small seed with every kind of thing in it. */
const SEED: ProjectSeed = {
  binder: [
    { title: 'Opening', body: 'It begins.\n', synopsis: 'How it begins', status: 'Final', label: 'Mara' },
    {
      folder: 'Part one',
      children: [
        { title: 'The Letter' },
        { folder: 'Night', children: [{ title: 'Night Train', body: 'Wheels.\n', status: 'Revised' }] },
      ],
    },
    { folder: 'Empty part', children: [] },
    { title: 'Ending', synopsis: 'How it ends' },
  ],
  unfiled: [{ title: 'Stray idea', body: 'Not in the binder.\n' }],
  research: [{ title: 'Trains', body: '# Trains\n' }],
  todo: '- [ ] Write the book\n',
};

interface FolderOnDisk {
  folder: string;
  id: string;
  children: unknown[];
}

describe('createProject with a seed', () => {
  it('creates an ordinary project with a first scene, "Scene 1", in the binder', async () => {
    const { store, vault } = makeStore();

    const created = valueOf(await store.createProject('My Novel', '', { seed: starterProject() }));

    expect(created).toEqual({
      indexPath: 'My Novel/My Novel.md',
      folder: 'My Novel',
      title: 'My Novel',
      scenes: ['Manuscript/Scene 1.md'],
    });
    expect(FIRST_SCENE_TITLE).toBe('Scene 1');
    expect(vault.paths()).toEqual(['My Novel/Manuscript/Scene 1.md', 'My Novel/My Novel.md', 'My Novel/To-do.md']);
    for (const sub of ['Manuscript', 'Timeline', 'Research', 'Stats']) {
      expect(vault.hasFolder(`My Novel/${sub}`), sub).toBe(true);
    }
    expect(vault.frontmatterOf('My Novel/My Novel.md')).toEqual({
      spellbook: 'project',
      version: 1,
      title: 'My Novel',
      binder: ['Manuscript/Scene 1.md'],
    });
    expect(vault.bodyOf('My Novel/To-do.md')).toBe('');

    const scene = vault.frontmatterOf('My Novel/Manuscript/Scene 1.md');
    expect(scene).toEqual({ synopsis: '', status: 'To do', label: '', compile: true, order: 1024, created: TODAY });
    expect(Object.keys(scene ?? {})).toEqual(['synopsis', 'status', 'label', 'compile', 'order', 'created']);
    expect(vault.bodyOf('My Novel/Manuscript/Scene 1.md')).toBe('');
  });

  it('only creates, then lists the scenes in the index with one read-modify-write', async () => {
    const vault = new MemoryVault().seed('Elsewhere/Note.md', { frontmatter: { keep: 1 }, body: 'mine' });
    const { store } = makeStore(vault);

    valueOf(await store.createProject('Novel', '', { seed: SEED }));

    expect(vault.writes.map((write) => `${write.op} ${write.path}`)).toEqual([
      'createFolder Novel',
      'createFile Novel/Novel.md',
      'createFolder Novel/Manuscript',
      'createFolder Novel/Timeline',
      'createFolder Novel/Research',
      'createFolder Novel/Stats',
      'createFile Novel/To-do.md',
      'createFile Novel/Manuscript/Opening.md',
      'createFile Novel/Manuscript/The Letter.md',
      'createFile Novel/Manuscript/Night Train.md',
      'createFile Novel/Manuscript/Ending.md',
      'createFile Novel/Manuscript/Stray idea.md',
      'createFile Novel/Research/Trains.md',
      'updateFrontmatter Novel/Novel.md',
    ]);
    expect(vault.trashed).toEqual([]);
    // nothing outside the new project folder was touched
    expect(vault.frontmatterOf('Elsewhere/Note.md')).toEqual({ keep: 1 });
    expect(vault.bodyOf('Elsewhere/Note.md')).toBe('mine');
  });

  it('writes the binder with virtual folders, each with its own id', async () => {
    const { store, vault } = makeStore();
    const created = valueOf(await store.createProject('Novel', '', { seed: SEED }));

    expect(created.scenes).toEqual([
      'Manuscript/Opening.md',
      'Manuscript/The Letter.md',
      'Manuscript/Night Train.md',
      'Manuscript/Ending.md',
    ]);
    const binder = binderOnDisk(vault, 'Novel/Novel.md') as [string, FolderOnDisk, FolderOnDisk, string];
    expect(binder[0]).toBe('Manuscript/Opening.md');
    expect(binder[3]).toBe('Manuscript/Ending.md');
    expect(binder[1].folder).toBe('Part one');
    expect(binder[1].children[0]).toBe('Manuscript/The Letter.md');
    const night = binder[1].children[1] as FolderOnDisk;
    expect(night).toMatchObject({ folder: 'Night', children: ['Manuscript/Night Train.md'] });
    expect(binder[2]).toMatchObject({ folder: 'Empty part', children: [] });

    const ids = [binder[1].id, night.id, binder[2].id];
    for (const id of ids) expect(id).toMatch(/^f-[a-z0-9]{6}$/);
    expect(new Set(ids).size).toBe(3);
    // binder folders are virtual: no folder on disk is named after them
    expect(vault.hasFolder('Novel/Part one')).toBe(false);
    expect(vault.hasFolder('Novel/Manuscript/Part one')).toBe(false);
  });

  it('gives every folder its own id even when the random source is stuck', async () => {
    const vault = new MemoryVault();
    const store = new ProjectStore({ vault, today: () => TODAY, setTimer: new ManualTimers().set, random: () => 0 });
    store.start();
    valueOf(await store.createProject('Novel', '', { seed: SEED }));

    const binder = binderOnDisk(vault, 'Novel/Novel.md') as [string, FolderOnDisk, FolderOnDisk, string];
    const ids = [binder[1].id, (binder[1].children[1] as FolderOnDisk).id, binder[2].id];
    expect(new Set(ids).size).toBe(3);
    expect(ids[0]).toBe('f-aaaaaa');
    // and the project opens cleanly: no folder had to be given a new id while reading
    expect(valueOf(await store.openProject('Novel/Novel.md')).notes).toEqual([]);
  });

  it('gives each scene its text and properties, with order keys 1024 apart in manuscript order', async () => {
    const { store, vault } = makeStore();
    valueOf(await store.createProject('Novel', '', { seed: SEED }));

    expect(vault.frontmatterOf('Novel/Manuscript/Opening.md')).toEqual({
      synopsis: 'How it begins',
      status: 'Final',
      label: 'Mara',
      compile: true,
      order: 1024,
      created: TODAY,
    });
    expect(vault.bodyOf('Novel/Manuscript/Opening.md')).toBe('It begins.\n');
    expect(vault.frontmatterOf('Novel/Manuscript/The Letter.md')).toEqual({
      synopsis: '',
      status: 'To do',
      label: '',
      compile: true,
      order: 2048,
      created: TODAY,
    });
    expect(vault.frontmatterOf('Novel/Manuscript/Night Train.md')).toMatchObject({ status: 'Revised', order: 3072 });
    expect(vault.frontmatterOf('Novel/Manuscript/Ending.md')).toMatchObject({ synopsis: 'How it ends', order: 4096 });
    for (const path of vault.paths().filter((candidate) => candidate.startsWith('Novel/Manuscript/') && !candidate.includes('Stray'))) {
      expect(Object.keys(vault.frontmatterOf(path) ?? {}), path).toEqual(['synopsis', 'status', 'label', 'compile', 'order', 'created']);
    }
  });

  it('creates the to-do text, the research notes and the unfiled note as plain notes', async () => {
    const { store, vault } = makeStore();
    const created = valueOf(await store.createProject('Novel', '', { seed: SEED }));

    expect(vault.bodyOf('Novel/To-do.md')).toBe('- [ ] Write the book\n');
    expect(vault.frontmatterOf('Novel/To-do.md')).toBeNull();
    expect(vault.bodyOf('Novel/Research/Trains.md')).toBe('# Trains\n');
    expect(vault.frontmatterOf('Novel/Research/Trains.md')).toBeNull();
    expect(vault.bodyOf('Novel/Manuscript/Stray idea.md')).toBe('Not in the binder.\n');
    expect(vault.frontmatterOf('Novel/Manuscript/Stray idea.md')).toBeNull();

    // the unfiled note is in the folder but not in the binder, so it shows as Unfiled
    const snapshot = valueOf(await store.openProject(created.indexPath));
    expect(draw(snapshot.tree)).toBe('Opening Part one[The Letter Night[Night Train]] Empty part[] Ending');
    expect(snapshot.unfiled).toEqual(['Manuscript/Stray idea.md']);
    expect(snapshot.missing).toEqual([]);
    expect(snapshot.readOnly).toBe(false);
  });

  it('does not open the new project or disturb the one that is open', async () => {
    const vault = new MemoryVault();
    const openIndex = seedProject(vault, { folder: 'Other', title: 'Other', scenes: { A: 1024 } });
    const { store } = makeStore(vault);
    valueOf(await store.openProject(openIndex));

    valueOf(await store.createProject('Novel', '', { seed: SEED }));

    expect(project(store).indexPath).toBe(openIndex);
    expect(picture(store)).toBe('A');
    expect(store.listProjects().map((p) => p.title)).toEqual(['Novel', 'Other']);
  });

  it('gives scenes with the same or an unusable title their own file names', async () => {
    const { store, vault } = makeStore();
    const created = valueOf(
      await store.createProject('Novel', '', {
        seed: {
          binder: [
            { title: 'Scene' },
            { title: 'scene' },
            { title: 'Scene' },
            { title: 'Who: Me?' },
            { title: '???' },
            { title: '' },
            { title: 'מכתב לאחותי' },
          ],
          unfiled: [{ title: 'Scene', body: '' }],
          research: [{ title: 'Scene', body: '' }, { title: '', body: '' }],
        },
      }),
    );
    expect(created.scenes).toEqual([
      'Manuscript/Scene.md',
      'Manuscript/scene 2.md',
      'Manuscript/Scene 3.md',
      'Manuscript/Who Me.md',
      'Manuscript/Untitled scene.md',
      'Manuscript/Untitled scene 2.md',
      'Manuscript/מכתב לאחותי.md',
    ]);
    expect(vault.has('Novel/Manuscript/Scene 4.md')).toBe(true); // the unfiled one
    expect(vault.has('Novel/Research/Scene.md')).toBe(true); // another folder: no clash
    expect(vault.has('Novel/Research/Untitled.md')).toBe(true);
    expect(binderOnDisk(vault, 'Novel/Novel.md')).toEqual(created.scenes);
  });

  it('names a folder that has no usable name', async () => {
    const { store, vault } = makeStore();
    valueOf(await store.createProject('Novel', '', { seed: { binder: [{ folder: '  \n ', children: [] }, { folder: ' Part   two ', children: [] }] } }));
    const binder = binderOnDisk(vault, 'Novel/Novel.md') as FolderOnDisk[];
    expect(binder.map((folder) => folder.folder)).toEqual(['Untitled folder', 'Part two']);
  });

  it('leaves the index alone when the seed has no scenes or folders', async () => {
    const { store, vault } = makeStore();
    const created = valueOf(await store.createProject('Novel', '', { seed: { binder: [], todo: 'x' } }));
    expect(created.scenes).toEqual([]);
    expect(vault.writes.filter((write) => write.op === 'updateFrontmatter')).toEqual([]);
    expect(binderOnDisk(vault, 'Novel/Novel.md')).toEqual([]);
    expect(vault.bodyOf('Novel/To-do.md')).toBe('x');
  });

  it('gives a scene its date in the story, creates the events in Timeline, and adds the screens\' data to the index', async () => {
    const { store, vault } = makeStore();
    const frontmatter = { spellbook: 'event', date: '1923-10-12', timelines: ['Main plot'], scenes: ['[[Opening]]'] };
    const data = { timelines: [{ name: 'Main plot', color: 'purple' }], targets: { daily: 500 } };
    const created = valueOf(
      await store.createProject('Novel', '', {
        seed: {
          binder: [{ title: 'Opening', date: '1923-10-12' }, { title: 'Ending' }, { title: 'Undated', date: '' }],
          events: [
            { title: 'The storm', frontmatter, body: 'It rains.\n' },
            { title: 'The storm', frontmatter: { spellbook: 'event', date: '1924' } }, // the same title: a file name of its own
            { title: ' / ', frontmatter: { spellbook: 'event', date: null } }, // no usable title
          ],
          data,
        },
      }),
    );
    expect(Object.keys(vault.frontmatterOf('Novel/Manuscript/Opening.md') ?? {})).toEqual([
      'synopsis',
      'status',
      'label',
      'compile',
      'order',
      'created',
      'date',
    ]);
    expect(vault.frontmatterOf('Novel/Manuscript/Opening.md')?.['date']).toBe('1923-10-12');
    // A scene without a date gets no such property at all.
    for (const scene of ['Ending', 'Undated']) {
      expect(Object.keys(vault.frontmatterOf(`Novel/Manuscript/${scene}.md`) ?? {}), scene).not.toContain('date');
    }

    expect(vault.paths().filter((path) => path.startsWith('Novel/Timeline/'))).toEqual([
      'Novel/Timeline/The storm 2.md',
      'Novel/Timeline/The storm.md',
      'Novel/Timeline/Untitled event.md',
    ]);
    expect(vault.frontmatterOf('Novel/Timeline/The storm.md')).toEqual(frontmatter);
    expect(vault.bodyOf('Novel/Timeline/The storm.md')).toBe('It rains.\n');
    expect(vault.bodyOf('Novel/Timeline/The storm 2.md')).toBe('');
    // The events are not scenes: the binder lists the three scenes and nothing else.
    expect(created.scenes).toEqual(['Manuscript/Opening.md', 'Manuscript/Ending.md', 'Manuscript/Undated.md']);
    expect(binderOnDisk(vault, 'Novel/Novel.md')).toEqual(created.scenes);

    // The data sits in the index after its own properties, written together with the binder in one go.
    const index = vault.frontmatterOf('Novel/Novel.md') ?? {};
    expect(Object.keys(index)).toEqual(['spellbook', 'version', 'title', 'binder', 'timelines', 'targets']);
    expect(index['timelines']).toEqual(data.timelines);
    expect(index['targets']).toEqual(data.targets);
    expect(vault.writes.filter((write) => write.op === 'updateFrontmatter')).toEqual([{ op: 'updateFrontmatter', path: 'Novel/Novel.md' }]);
    // The note holds copies: changing the seed afterwards changes nothing in it.
    data.timelines.push({ name: 'Later', color: 'red' });
    expect(vault.frontmatterOf('Novel/Novel.md')?.['timelines']).toHaveLength(1);
  });

  it('gives a scene its word target, after its label, and no such property to a scene without one', async () => {
    const { store, vault } = makeStore();
    valueOf(
      await store.createProject('Novel', '', {
        seed: {
          binder: [
            { title: 'Opening', target: 1200, date: '1923-10-12' },
            { title: 'Ending' },
            { title: 'Nothing', target: 0 },
            { title: 'Half a word', target: 12.5 },
          ],
        },
      }),
    );
    const standard = ['synopsis', 'status', 'label', 'compile', 'order', 'created'];
    expect(Object.keys(vault.frontmatterOf('Novel/Manuscript/Opening.md') ?? {})).toEqual([
      'synopsis',
      'status',
      'label',
      'target',
      'compile',
      'order',
      'created',
      'date',
    ]);
    expect(vault.frontmatterOf('Novel/Manuscript/Opening.md')?.['target']).toBe(1200);
    // No target, or one that is not a whole number of words above nothing: no such property at all.
    for (const scene of ['Ending', 'Nothing', 'Half a word']) {
      expect(Object.keys(vault.frontmatterOf(`Novel/Manuscript/${scene}.md`) ?? {}), scene).toEqual(standard);
    }
  });

  it('never lets a seed set the index\'s own properties, and writes the data of a seed that has no scenes', async () => {
    const { store, vault } = makeStore();
    valueOf(
      await store.createProject('Novel', '', {
        seed: {
          binder: [],
          data: {
            spellbook: 'something else',
            version: 99,
            title: 'Another title',
            binder: ['Manuscript/Ghost.md'],
            ' padded ': 1,
            '': 2,
            marks: { '2026-10-15': { color: 'blue', label: 'Writing group' } },
            nothing: undefined,
          },
        },
      }),
    );
    const index = vault.frontmatterOf('Novel/Novel.md') ?? {};
    expect(index).toEqual({
      spellbook: 'project',
      version: 1,
      title: 'Novel',
      binder: [],
      marks: { '2026-10-15': { color: 'blue', label: 'Writing group' } },
    });
    valueOf(await store.openProject('Novel/Novel.md'));
    expect(store.project).toMatchObject({ title: 'Novel', readOnly: false, error: null });
    expect(store.projectData('marks')).toEqual({ '2026-10-15': { color: 'blue', label: 'Writing group' } });
  });

  it('creates order keys that need no correcting: a later move rewrites one scene only', async () => {
    const { store, vault, timers } = makeStore();
    const created = valueOf(await store.createProject('Novel', '', { seed: SEED }));
    valueOf(await store.openProject(created.indexPath));
    vault.clearWrites();

    valueOf(await store.moveNode({ kind: 'scene', path: 'Manuscript/Ending.md' }, { at: 'start', parentId: null }));
    timers.advance(5000);
    await settle(store);

    expect(vault.writes.map((write) => `${write.op} ${write.path}`)).toEqual([
      'updateFrontmatter Novel/Novel.md',
      'updateFrontmatter Novel/Manuscript/Ending.md',
    ]);
    expect(vault.frontmatterOf('Novel/Manuscript/Ending.md')?.['order']).toBe(512);
    expect(vault.bodyOf('Novel/Manuscript/Opening.md')).toBe('It begins.\n');
  });

  it('counts the scenes of a seed', () => {
    expect(countSeedScenes(SEED.binder)).toBe(4);
    expect(countSeedScenes(starterProject().binder)).toBe(1);
    expect(countSeedScenes([])).toBe(0);
  });
});

describe('createProject with a seed, when something goes wrong', () => {
  it('stops at the first note that cannot be created, says which, and deletes nothing', async () => {
    const { store, vault } = makeStore();
    vault.failNext('createFile', 'Novel/Manuscript/Night Train.md');

    const result = await store.createProject('Novel', '', { seed: SEED });

    expect(result.status).toBe('failed');
    if (result.status !== 'failed') return;
    expect(result.message).toMatch(/only partly created/);
    expect(result.message).toMatch(/"Manuscript\/Night Train\.md"/);
    expect(result.message).toMatch(/disk is not available/);
    expect(result.message).toMatch(/Nothing was deleted/);
    // what was made before the failure is still there, and nothing after it was attempted
    expect(vault.has('Novel/Manuscript/Opening.md')).toBe(true);
    expect(vault.has('Novel/Manuscript/The Letter.md')).toBe(true);
    expect(vault.has('Novel/Manuscript/Night Train.md')).toBe(false);
    expect(vault.has('Novel/Manuscript/Ending.md')).toBe(false);
    expect(vault.trashed).toEqual([]);
    expect(vault.writes.every((write) => write.op === 'createFile' || write.op === 'createFolder')).toBe(true);

    // The half-made project is still a project: its notes show as Unfiled, none as Missing.
    expect(binderOnDisk(vault, 'Novel/Novel.md')).toEqual([]);
    const snapshot = valueOf(await store.openProject('Novel/Novel.md'));
    expect(snapshot.unfiled).toEqual(['Manuscript/Opening.md', 'Manuscript/The Letter.md']);
    expect(snapshot.missing).toEqual([]);
  });

  it('says so when the notes were created but the binder could not be saved', async () => {
    const { store, vault } = makeStore();
    vault.failNext('updateFrontmatter', 'Novel/Novel.md');

    const result = await store.createProject('Novel', '', { seed: SEED });

    expect(result.status).toBe('failed');
    if (result.status !== 'failed') return;
    expect(result.message).toMatch(/binder could not be saved/);
    expect(result.message).toMatch(/disk is not available/);
    expect(result.message).toMatch(/Unfiled/);
    expect(vault.has('Novel/Manuscript/Ending.md')).toBe(true);
    expect(binderOnDisk(vault, 'Novel/Novel.md')).toEqual([]);
    expect(vault.trashed).toEqual([]);
  });

  it('never writes an index it can no longer understand', async () => {
    // Another device rewrites the brand-new index while the scenes are still being created.
    for (const damage of ['not a project any more', 'a binder that makes no sense', 'broken YAML'] as const) {
      const { store, vault } = makeStore();
      vault.on((event) => {
        if (event.type !== 'create' || event.path !== 'Novel/Research/Trains.md') return;
        if (damage === 'not a project any more') {
          vault.external.write('Novel/Novel.md', { frontmatter: { title: 'Mine now' } }, { silent: true });
        } else if (damage === 'a binder that makes no sense') {
          vault.external.editFrontmatter('Novel/Novel.md', (frontmatter) => { frontmatter['binder'] = 'oops'; }, { silent: true });
        } else {
          vault.external.corrupt('Novel/Novel.md', { silent: true });
        }
      });

      const result = await store.createProject('Novel', '', { seed: SEED });

      expect(result.status, damage).toBe('failed');
      if (result.status !== 'failed') return;
      expect(result.message, damage).toMatch(/binder could not be saved/);
      expect(vault.writes.filter((write) => write.op === 'updateFrontmatter'), damage).toEqual([]);
      expect(vault.has('Novel/Manuscript/Ending.md'), damage).toBe(true);
    }
  });

  it('keeps what another device already listed in the new index', async () => {
    const { store, vault } = makeStore();
    vault.on((event) => {
      if (event.type !== 'create' || event.path !== 'Novel/Manuscript/Scene 1.md') return;
      vault.external.editFrontmatter(
        'Novel/Novel.md',
        (frontmatter) => {
          frontmatter['binder'] = ['Manuscript/From the phone.md'];
          frontmatter['theirs'] = true;
        },
        { silent: true },
      );
    });

    valueOf(await store.createProject('Novel', '', { seed: starterProject() }));

    expect(vault.frontmatterOf('Novel/Novel.md')).toMatchObject({
      theirs: true,
      binder: ['Manuscript/From the phone.md', 'Manuscript/Scene 1.md'],
    });
  });
});

describe('createProject when the name is taken', () => {
  it('refuses by default, and writes nothing', async () => {
    const { store, vault } = makeStore();
    valueOf(await store.createProject('Novel', '', { seed: starterProject() }));
    vault.clearWrites();

    const again = await store.createProject('Novel', '', { seed: starterProject() });

    expect(again).toMatchObject({ status: 'refused', reason: 'exists' });
    if (again.status !== 'refused') return;
    expect(again.message).toBe('There is already something called "Novel" here. Choose another name.');
    expect(vault.writes).toEqual([]);
  });

  it('numbers the project instead when asked: "Sample 2", "Sample 3"', async () => {
    const { store, vault } = makeStore();
    const options = { seed: starterProject(), numberIfTaken: true };

    const first = valueOf(await store.createProject('Sample', '', options));
    const firstWrites = vault.writes.length;
    const second = valueOf(await store.createProject('Sample', '', options));
    const third = valueOf(await store.createProject('sample', '', options));

    expect(first).toMatchObject({ folder: 'Sample', title: 'Sample', indexPath: 'Sample/Sample.md' });
    expect(second).toMatchObject({ folder: 'Sample 2', title: 'Sample 2', indexPath: 'Sample 2/Sample 2.md' });
    expect(third).toMatchObject({ folder: 'sample 3', title: 'sample 3' });
    expect(vault.frontmatterOf('Sample 2/Sample 2.md')?.['title']).toBe('Sample 2');
    expect(store.listProjects().map((p) => p.title)).toEqual(['Sample', 'Sample 2', 'sample 3']);
    // the first project was not touched by the later ones
    expect(vault.writes.slice(firstWrites).every((write) => !write.path.startsWith('Sample/'))).toBe(true);
  });

  it('numbers past anything with that name, a plain folder or a note included', async () => {
    const vault = new MemoryVault().seedFolder('Writing/Sample').seed('Writing/sample 2', { body: 'a file' });
    const { store } = makeStore(vault);
    const created = valueOf(await store.createProject('Sample', 'Writing', { numberIfTaken: true }));
    expect(created.folder).toBe('Writing/Sample 3');
    expect(created.title).toBe('Sample 3');
  });

  it('keeps the title as typed when numbering a name that had to be cleaned', async () => {
    const { store } = makeStore();
    valueOf(await store.createProject('Who: Me?', '', { numberIfTaken: true }));
    const second = valueOf(await store.createProject('Who: Me?', '', { numberIfTaken: true }));
    expect(second).toMatchObject({ folder: 'Who Me 2', title: 'Who: Me? 2' });
  });
});

describe('listParentFolders', () => {
  it('offers the top of the vault first, then every folder that is not part of a project', () => {
    const vault = new MemoryVault().seedFolder('Writing/Drafts').seedFolder('Archive').seedFolder('writing notes');
    seedProject(vault, { folder: 'Writing/Novel', scenes: { A: 1024 } });
    vault.seedFolder('Writing/Novel/Research');
    const { store } = makeStore(vault);

    expect(store.listParentFolders()).toEqual(['', 'Archive', 'Writing', 'Writing/Drafts', 'writing notes']);
  });

  it('offers only the top of the vault when there are no folders', () => {
    expect(makeStore().store.listParentFolders()).toEqual(['']);
  });

  it('stops offering a folder once a project is created in it, and every offer can be used', async () => {
    const vault = new MemoryVault().seedFolder('Writing').seedFolder('Other');
    const { store } = makeStore(vault);
    valueOf(await store.createProject('Novel', 'Writing'));

    const offered = store.listParentFolders();
    expect(offered).toEqual(['', 'Other', 'Writing']);
    for (const [index, folder] of offered.entries()) {
      expect((await store.createProject(`Book ${index}`, folder)).status, folder).toBe('done');
    }
  });

  it('still offers folders when a project index sits loose at the top of the vault', () => {
    const vault = new MemoryVault().seedFolder('Writing');
    vault.seed('Loose.md', { frontmatter: { spellbook: 'project', version: 1, binder: [] } });
    const { store } = makeStore(vault);
    expect(store.listParentFolders()).toEqual(['', 'Writing']);
  });
});

describe('createStarterProject', () => {
  it('creates the project, opens it and says where its first scene is', async () => {
    const vault = new MemoryVault().seedFolder('Writing');
    const { store, changes } = makeStore(vault);

    const made = valueOf(await createStarterProject(store, 'My Novel', 'Writing'));

    expect(made.firstScene).toBe('Writing/My Novel/Manuscript/Scene 1.md');
    expect(made.project).toMatchObject({ indexPath: 'Writing/My Novel/My Novel.md', title: 'My Novel' });
    expect(vault.has(made.firstScene as string)).toBe(true);
    expect(project(store)).toMatchObject({ indexPath: 'Writing/My Novel/My Novel.md', title: 'My Novel', readOnly: false, unfiled: [], missing: [] });
    expect(picture(store)).toBe('Scene 1');
    expect(changes).toContainEqual({ type: 'projects' });
    expect(changes).toContainEqual({ type: 'project' });
  });

  it('creates in the top of the vault by default', async () => {
    const { store } = makeStore();
    const made = valueOf(await createStarterProject(store, 'Novel'));
    expect(made.firstScene).toBe('Novel/Manuscript/Scene 1.md');
  });

  it('refuses when the folder already exists, and leaves the open project as it was', async () => {
    const vault = new MemoryVault().seedFolder('Taken');
    const openIndex = seedProject(vault, { folder: 'Other', scenes: { A: 1024 } });
    const { store } = makeStore(vault);
    valueOf(await store.openProject(openIndex));
    vault.clearWrites();

    const result = await createStarterProject(store, 'Taken');

    expect(result).toMatchObject({ status: 'refused', reason: 'exists' });
    expect(vault.writes).toEqual([]);
    expect(project(store).indexPath).toBe(openIndex);
  });

  it('passes on a refusal for an empty name', async () => {
    const { store, vault } = makeStore();
    expect(await createStarterProject(store, '   ')).toMatchObject({ status: 'refused', reason: 'invalid-name' });
    expect(vault.writes).toEqual([]);
    expect(store.project).toBeNull();
  });

  it('does not open a project that was only partly created', async () => {
    const { store, vault } = makeStore();
    vault.failNext('createFile', 'Novel/Manuscript/Scene 1.md');
    const result = await createStarterProject(store, 'Novel');
    expect(result.status).toBe('failed');
    expect(store.project).toBeNull();
  });
});
