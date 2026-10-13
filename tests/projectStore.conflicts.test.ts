// Project store: a conflicting copy of the project's index, left next to it
// by a sync service ("Novel 2.md" beside "Novel.md").

import { describe, expect, it } from 'vitest';
import { ACTIVE_PROJECT_KEY, DevicePrefs } from '../src/core/devicePrefs';
import { ORDER_DEBOUNCE_MS } from '../src/core/projectStore';
import { ProjectSession } from '../src/core/projectSession';
import type { Frontmatter } from '../src/core/types';
import { MemoryVault } from './memoryVault';
import {
  INDEX_BODY,
  MemoryDeviceStorage,
  binderOnDisk,
  makeStore,
  openSeeded,
  picture,
  project,
  quiet,
  sceneBody,
  seedProject,
  settle,
  valueOf,
} from './storeHarness';

const INDEX = 'Novel/Novel.md';
const COPY = 'Novel/Novel 2.md';

/** The frontmatter of a copy of the index, with its own binder. */
function copyOf(binder: unknown, extra: Frontmatter = {}): Frontmatter {
  return { spellbook: 'project', version: 1, title: 'My Novel', binder, ...extra };
}

/**
 * A project with scenes A, B and C, and a conflicting copy of its index. The
 * copy has the same text as the index note; only its binder is its own.
 */
function withCopy(
  binder: unknown = ['Manuscript/A.md', 'Manuscript/D.md', 'Manuscript/B.md'],
  body: string = INDEX_BODY,
): MemoryVault {
  const vault = new MemoryVault();
  vault.seed(COPY, { frontmatter: copyOf(binder), body });
  vault.seed('Novel/Manuscript/D.md', { frontmatter: { status: 'To do' }, body: sceneBody('D') });
  return vault;
}

const threeScenes = { scenes: { A: 1024, B: 2048, C: 3072 } };

describe('finding a conflicting copy', () => {
  it('reports the copy with the project, and does not list it as a project of its own', async () => {
    const { store, vault } = await openSeeded(threeScenes, withCopy());
    expect(project(store).conflicts).toEqual([COPY]);
    expect(store.listProjects().map((entry) => entry.indexPath)).toEqual([INDEX]);
    expect(store.mainIndexOf(COPY)).toBe(INDEX);
    expect(store.mainIndexOf(INDEX)).toBeNull();
    expect(vault.writes).toEqual([]); // looking changes nothing
  });

  it('reports no copies for an ordinary project', async () => {
    const { store } = await openSeeded(threeScenes);
    expect(project(store).conflicts).toEqual([]);
  });

  it('notices a copy that arrives while the project is open, and one that goes away again', async () => {
    const { store, vault, changes } = await openSeeded(threeScenes);
    vault.external.create(COPY, { frontmatter: copyOf(['Manuscript/A.md']) });
    await settle(store);
    expect(project(store).conflicts).toEqual([COPY]);
    expect(changes).toContainEqual({ type: 'project' });
    expect(store.listProjects()).toHaveLength(1);

    vault.external.delete(COPY);
    await settle(store);
    expect(project(store).conflicts).toEqual([]);
    expect(vault.writes).toEqual([]);
  });

  it('reports several copies, in order', async () => {
    const vault = withCopy();
    vault.seed('Novel/Novel 3.md', { frontmatter: copyOf([]) });
    const { store } = await openSeeded(threeScenes, vault);
    expect(project(store).conflicts).toEqual([COPY, 'Novel/Novel 3.md']);
  });

  it('leaves a second index with a name of its own alone: that is another project', async () => {
    const vault = new MemoryVault();
    vault.seed('Novel/Sequel.md', { frontmatter: copyOf([], { title: 'The Sequel' }) });
    const { store } = await openSeeded(threeScenes, vault);
    expect(project(store).conflicts).toEqual([]);
    expect(store.listProjects().map((entry) => entry.title)).toEqual(['My Novel', 'The Sequel']);
  });

  it('finds a copy whose title is not the index note\'s: the title may be the very thing one device changed', async () => {
    // On one device the writer retitled the project; on another, offline, a
    // scene was added. The sync service kept both versions of the index.
    const vault = new MemoryVault();
    vault.seed(COPY, { frontmatter: copyOf(['Manuscript/A.md', 'Manuscript/D.md'], { title: 'My Novel, draft 2' }) });
    vault.seed('Novel/Manuscript/D.md', { body: sceneBody('D') });
    const { store } = await openSeeded(threeScenes, vault);
    expect(project(store).conflicts).toEqual([COPY]);
    // It is not offered as a second project in the same folder.
    expect(store.listProjects().map((entry) => entry.indexPath)).toEqual([INDEX]);

    // Merging keeps the project's own title, and says what the copy's was.
    expect(valueOf(await store.mergeConflictCopy(COPY))).toEqual({
      added: ['Manuscript/D.md'],
      data: [],
      textDiffers: true,
      otherTitle: 'My Novel, draft 2',
    });
    expect(vault.frontmatterOf(INDEX)?.['title']).toBe('My Novel');
    expect(vault.trashed).toEqual([COPY]);
  });

  it('does not let a session open such a copy in place of the project', async () => {
    const vault = new MemoryVault();
    // The copy's title sorts before the project's own.
    vault.seed(COPY, { frontmatter: copyOf(['Manuscript/Z.md'], { title: 'A new title' }) });
    seedProject(vault, threeScenes);
    const { store } = makeStore(vault);
    const session = new ProjectSession(store, new DevicePrefs(new MemoryDeviceStorage()));
    session.start();
    await quiet(store);
    expect(project(store).indexPath).toBe(INDEX);
    expect(project(store).conflicts).toEqual([COPY]);
    expect(vault.writes).toEqual([]);
  });

  it('does not take a note for a copy that is not marked as a project', async () => {
    const vault = new MemoryVault();
    vault.seed(COPY, { frontmatter: { title: 'Just notes' }, body: 'Not an index at all.' });
    const { store } = await openSeeded(threeScenes, vault);
    expect(project(store).conflicts).toEqual([]);
  });

  it('keeps the copy out of Unfiled and out of the binder', async () => {
    const { store } = await openSeeded(threeScenes, withCopy());
    // D is a manuscript note that only the copy lists: for the project itself it is unfiled.
    expect(project(store).unfiled).toEqual(['Manuscript/D.md']);
    expect(picture(store)).toBe('A B C');
  });
});

describe('merging a conflicting copy', () => {
  it('adds what only the copy lists to the end of the binder, in one write, and trashes the copy', async () => {
    const { store, vault, indexPath } = await openSeeded(threeScenes, withCopy());
    const result = await store.mergeConflictCopy(COPY);

    expect(valueOf(result)).toEqual({ added: ['Manuscript/D.md'], data: [], textDiffers: false, otherTitle: null });
    expect(binderOnDisk(vault, indexPath)).toEqual([
      'Manuscript/A.md',
      'Manuscript/B.md',
      'Manuscript/C.md',
      'Manuscript/D.md',
    ]);
    expect(vault.writes).toEqual([
      { op: 'updateFrontmatter', path: indexPath },
      { op: 'trash', path: COPY },
    ]);
    expect(vault.trashed).toEqual([COPY]);
    expect(vault.has(COPY)).toBe(false);

    expect(picture(store)).toBe('A B C D');
    expect(project(store).conflicts).toEqual([]);
    expect(project(store).unfiled).toEqual([]);
    expect(store.listProjects()).toHaveLength(1);
  });

  it('never removes or moves what the index lists, whatever the copy says', async () => {
    // The copy lists the scenes the other way round, and has lost C.
    const { store, vault, indexPath } = await openSeeded(
      { binder: ['Manuscript/A.md', { folder: 'Part one', id: 'f-one', children: ['Manuscript/B.md'] }, 'Manuscript/C.md'], scenes: { A: 1024, B: 2048, C: 3072 } },
      withCopy(['Manuscript/B.md', { folder: 'Their part', id: 'f-theirs', children: ['Manuscript/D.md'] }, 'Manuscript/A.md']),
    );
    valueOf(await store.mergeConflictCopy(COPY));
    expect(binderOnDisk(vault, indexPath)).toEqual([
      'Manuscript/A.md',
      { folder: 'Part one', id: 'f-one', children: ['Manuscript/B.md'] },
      'Manuscript/C.md',
      'Manuscript/D.md',
    ]);
  });

  it('touches nothing but the binder: the index\'s text and its other properties stay', async () => {
    const { store, vault, indexPath } = await openSeeded(
      { ...threeScenes, extra: { targets: { draft: 80000 }, somethingNew: ['kept'] } },
      withCopy(),
    );
    valueOf(await store.mergeConflictCopy(COPY));
    const frontmatter = vault.frontmatterOf(indexPath);
    expect(frontmatter?.['targets']).toEqual({ draft: 80000 });
    expect(frontmatter?.['somethingNew']).toEqual(['kept']);
    expect(frontmatter?.['title']).toBe('My Novel');
    expect(vault.bodyOf(indexPath)).toBe(INDEX_BODY);
    // No scene note was touched either.
    for (const name of ['A', 'B', 'C', 'D']) expect(vault.bodyOf(`Novel/Manuscript/${name}.md`)).toBe(sceneBody(name));
  });

  it('adds a scene whose note is not in the vault as a missing entry: it may still be on its way', async () => {
    const { store, vault, indexPath } = await openSeeded(threeScenes, withCopy(['Manuscript/A.md', 'Manuscript/Not here yet.md']));
    expect(valueOf(await store.mergeConflictCopy(COPY)).added).toEqual(['Manuscript/Not here yet.md']);
    expect(picture(store)).toBe('A B C Not here yet?');
    expect(binderOnDisk(vault, indexPath)).toContain('Manuscript/Not here yet.md');
  });

  it('does not write the index when the copy lists nothing new, but still trashes the copy', async () => {
    const { store, vault } = await openSeeded(threeScenes, withCopy(['Manuscript/C.md', 'Manuscript/A.md']));
    expect(valueOf(await store.mergeConflictCopy(COPY)).added).toEqual([]);
    expect(vault.writes).toEqual([{ op: 'trash', path: COPY }]);
    expect(picture(store)).toBe('A B C');
    expect(project(store).conflicts).toEqual([]);
  });

  it('gives the added scenes an order key, a moment later, and writes no other note', async () => {
    const { store, vault, timers } = await openSeeded(threeScenes, withCopy());
    valueOf(await store.mergeConflictCopy(COPY));
    vault.clearWrites();
    timers.advance(ORDER_DEBOUNCE_MS);
    await settle(store);
    expect(vault.writes).toEqual([{ op: 'updateFrontmatter', path: 'Novel/Manuscript/D.md' }]);
    expect(vault.frontmatterOf('Novel/Manuscript/D.md')?.['order']).toBe(4096);
  });

  it('reads the copy from the file itself, not from an index that lags behind', async () => {
    const { store, vault, indexPath } = await openSeeded(threeScenes, withCopy(['Manuscript/A.md']));
    // The copy changes on disk, and Obsidian has not noticed yet.
    vault.holdMetadata();
    vault.external.write(COPY, { frontmatter: copyOf(['Manuscript/A.md', 'Manuscript/D.md']) }, { silent: true });
    expect(valueOf(await store.mergeConflictCopy(COPY)).added).toEqual(['Manuscript/D.md']);
    expect(binderOnDisk(vault, indexPath)).toContain('Manuscript/D.md');
  });

  it('does not decide what a copy is by a title that an index lagging behind remembers', async () => {
    // What makes a note a copy is its place and its name, which are always
    // known, and its project marker, which is read from the file itself. A
    // title that changed on disk a moment ago cannot change the answer, in
    // either direction: the title the merge reports is the one on disk.
    const { store, vault, indexPath } = await openSeeded(threeScenes, withCopy(['Manuscript/A.md', 'Manuscript/D.md']));
    vault.holdMetadata();
    vault.external.write(
      COPY,
      { frontmatter: copyOf(['Manuscript/A.md', 'Manuscript/D.md'], { title: 'My Novel, book two' }) },
      { silent: true },
    );
    expect(valueOf(await store.mergeConflictCopy(COPY))).toMatchObject({
      added: ['Manuscript/D.md'],
      otherTitle: 'My Novel, book two',
    });
    expect(vault.frontmatterOf(indexPath)?.['title']).toBe('My Novel');
    // And the index note's own title is the one on disk at that moment, too.
    const second = await openSeeded(threeScenes, withCopy());
    second.vault.holdMetadata();
    second.vault.external.editFrontmatter(second.indexPath, (frontmatter) => {
      frontmatter['title'] = 'Retitled here';
    }, { silent: true });
    expect(valueOf(await second.store.mergeConflictCopy(COPY)).otherTitle).toBe('My Novel');
  });

  it('merges against the index as it is on disk at that moment', async () => {
    const { store, vault, indexPath } = await openSeeded(threeScenes, withCopy());
    // Another device has just filed D itself, and added E; this device has not heard yet.
    vault.external.editFrontmatter(indexPath, (frontmatter) => {
      frontmatter['binder'] = ['Manuscript/D.md', 'Manuscript/A.md', 'Manuscript/B.md', 'Manuscript/C.md', 'Manuscript/E.md'];
    }, { silent: true });
    expect(valueOf(await store.mergeConflictCopy(COPY)).added).toEqual([]);
    expect(binderOnDisk(vault, indexPath)).toEqual([
      'Manuscript/D.md',
      'Manuscript/A.md',
      'Manuscript/B.md',
      'Manuscript/C.md',
      'Manuscript/E.md',
    ]);
    expect(vault.trashed).toEqual([COPY]);
  });

  it('says whether the copy\'s own text was different from the index note\'s, which is not merged', async () => {
    const other = 'Notes about the novel, as the other device left them.';
    const differing = await openSeeded(threeScenes, withCopy(undefined, other));
    expect(valueOf(await differing.store.mergeConflictCopy(COPY))).toEqual({
      added: ['Manuscript/D.md'],
      data: [],
      textDiffers: true,
      otherTitle: null,
    });
    // The index note keeps its own text; the copy, with the other text, is in the trash.
    expect(differing.vault.bodyOf(INDEX)).toBe(INDEX_BODY);
    expect(differing.vault.trashed).toEqual([COPY]);

    // Blank lines at the ends are not a difference.
    const same = await openSeeded(threeScenes, withCopy(undefined, `\n${INDEX_BODY}\n\n`));
    expect(valueOf(await same.store.mergeConflictCopy(COPY)).textDiffers).toBe(false);
  });

  it('merges several copies one after the other', async () => {
    const vault = withCopy();
    vault.seed('Novel/Novel 3.md', { frontmatter: copyOf(['Manuscript/E.md', 'Manuscript/D.md']) });
    const { store, indexPath } = await openSeeded(threeScenes, vault);
    for (const copy of project(store).conflicts) valueOf(await store.mergeConflictCopy(copy));
    expect(binderOnDisk(vault, indexPath)).toEqual([
      'Manuscript/A.md',
      'Manuscript/B.md',
      'Manuscript/C.md',
      'Manuscript/D.md',
      'Manuscript/E.md',
    ]);
    expect(vault.trashed).toEqual([COPY, 'Novel/Novel 3.md']);
    expect(project(store).conflicts).toEqual([]);
  });
});

describe('merging what the other screens keep in a conflicting copy', () => {
  // What this device's index holds, and what the other device's version of it holds.
  const mine = {
    statuses: [{ name: 'To do', color: 'red' }, { name: 'Final', color: 'green' }],
    labels: [{ name: 'Mara', color: 'purple' }],
    timelines: [{ name: 'Main plot', color: 'purple' }],
    marks: { '2026-10-15': { color: 'blue', label: 'Writing group' } },
    targets: { project: 80000 },
    theme: 'left alone',
  };
  const theirs = {
    statuses: [{ name: 'To do', color: 'pink' }, { name: 'Revised', color: 'blue' }],
    labels: [{ name: 'mara', color: 'cyan' }, { name: 'Noa', color: 'pink' }],
    timelines: [{ name: 'Backstory', color: 'orange' }, { name: 'Main plot', color: 'red' }],
    marks: { '2026-10-15': { color: 'red', label: 'Deadline' }, '2026-10-19': { color: 'green', label: 'Day off' } },
    targets: { project: 50000, daily: 1000, deadline: '2027-03-12' },
    theme: 'the other device',
    somethingElse: 'not one of the screens',
  };

  function withData(copyExtra: Frontmatter, binder: unknown = ['Manuscript/A.md', 'Manuscript/B.md', 'Manuscript/C.md']): MemoryVault {
    const vault = new MemoryVault();
    vault.seed(COPY, { frontmatter: copyOf(binder, copyExtra), body: INDEX_BODY });
    return vault;
  }

  it('adds the statuses, labels, timelines, marks and targets the index lacks, and writes over nothing it has', async () => {
    const { store, vault, indexPath } = await openSeeded({ ...threeScenes, extra: mine }, withData(theirs));
    const result = valueOf(await store.mergeConflictCopy(COPY));

    expect(result.added).toEqual([]); // the binders agreed
    expect(result.data).toEqual([
      { key: 'statuses', items: ['Revised'] },
      { key: 'labels', items: ['Noa'] },
      { key: 'timelines', items: ['Backstory'] },
      { key: 'marks', items: ['2026-10-19'] },
      { key: 'targets', items: ['daily', 'deadline'] },
    ]);
    const index = vault.frontmatterOf(indexPath) ?? {};
    // Everything the index had is as it was, in its place; what was new comes after it.
    expect(index['statuses']).toEqual([...mine.statuses, { name: 'Revised', color: 'blue' }]);
    expect(index['labels']).toEqual([{ name: 'Mara', color: 'purple' }, { name: 'Noa', color: 'pink' }]);
    expect(index['timelines']).toEqual([{ name: 'Main plot', color: 'purple' }, { name: 'Backstory', color: 'orange' }]);
    expect(index['marks']).toEqual({
      '2026-10-15': { color: 'blue', label: 'Writing group' },
      '2026-10-19': { color: 'green', label: 'Day off' },
    });
    expect(index['targets']).toEqual({ project: 80000, daily: 1000, deadline: '2027-03-12' });
    // Keys that are not the screens' are neither merged nor taken over.
    expect(index['theme']).toBe('left alone');
    expect(index).not.toHaveProperty('somethingElse');
    expect(binderOnDisk(vault, indexPath)).toEqual(['Manuscript/A.md', 'Manuscript/B.md', 'Manuscript/C.md']);

    // One write of the index, then the copy goes to the trash.
    expect(vault.writes).toEqual([
      { op: 'updateFrontmatter', path: indexPath },
      { op: 'trash', path: COPY },
    ]);
    // The screens see it at once.
    expect(store.projectData('labels')).toEqual(index['labels']);
    expect(store.projectData('targets')).toEqual(index['targets']);
  });

  it('brings scenes and data over together, in the same single write', async () => {
    const vault = withData({ labels: [{ name: 'Noa', color: 'pink' }] }, ['Manuscript/A.md', 'Manuscript/D.md']);
    vault.seed('Novel/Manuscript/D.md', { frontmatter: { status: 'To do' }, body: sceneBody('D') });
    const { store, indexPath } = await openSeeded(threeScenes, vault);
    const result = valueOf(await store.mergeConflictCopy(COPY));
    expect(result.added).toEqual(['Manuscript/D.md']);
    expect(result.data).toEqual([{ key: 'labels', items: ['Noa'] }]);
    expect(vault.writes.filter((write) => write.path === indexPath)).toEqual([{ op: 'updateFrontmatter', path: indexPath }]);
    expect(vault.frontmatterOf(indexPath)?.['labels']).toEqual([{ name: 'Noa', color: 'pink' }]);
    expect(binderOnDisk(vault, indexPath)).toContain('Manuscript/D.md');
  });

  it('does not write the index at all when the copy has nothing the index lacks', async () => {
    const { store, vault } = await openSeeded({ ...threeScenes, extra: mine }, withData({ labels: [{ name: 'MARA', color: 'red' }], targets: { project: 1 } }));
    const result = valueOf(await store.mergeConflictCopy(COPY));
    expect(result).toMatchObject({ added: [], data: [] });
    expect(vault.writes).toEqual([{ op: 'trash', path: COPY }]);
  });

  it('merges against the index as it is on disk at that moment, not as it was last read', async () => {
    const { store, vault, indexPath } = await openSeeded({ ...threeScenes, extra: { labels: [{ name: 'Mara', color: 'purple' }] } }, withData({ labels: [{ name: 'Noa', color: 'pink' }, { name: 'Tobias', color: 'cyan' }] }));
    // Another device added Noa to the index itself a moment ago, in its own colour.
    vault.external.editFrontmatter(indexPath, (frontmatter) => {
      (frontmatter['labels'] as unknown[]).push({ name: 'Noa', color: 'green' });
    });
    const result = valueOf(await store.mergeConflictCopy(COPY));
    expect(result.data).toEqual([{ key: 'labels', items: ['Tobias'] }]);
    expect(vault.frontmatterOf(indexPath)?.['labels']).toEqual([
      { name: 'Mara', color: 'purple' },
      { name: 'Noa', color: 'green' },
      { name: 'Tobias', color: 'cyan' },
    ]);
  });

  it('leaves alone a value in the index that is not what it should be', async () => {
    const odd = { labels: 'Plot, Mood', marks: ['not', 'days'], targets: 80000 };
    const { store, vault, indexPath } = await openSeeded({ ...threeScenes, extra: odd }, withData(theirs));
    const result = valueOf(await store.mergeConflictCopy(COPY));
    // What the index does not have at all is taken over; what it has in a form of its own is not touched.
    expect(result.data.map((entry) => entry.key)).toEqual(['statuses', 'timelines']);
    const index = vault.frontmatterOf(indexPath) ?? {};
    expect(index['labels']).toBe('Plot, Mood');
    expect(index['marks']).toEqual(['not', 'days']);
    expect(index['targets']).toBe(80000);
    expect(index['statuses']).toEqual(theirs.statuses);
    expect(index['timelines']).toEqual(theirs.timelines);
  });

  it('merges nothing and trashes nothing when the index cannot be saved', async () => {
    const { store, vault, indexPath } = await openSeeded(threeScenes, withData(theirs));
    vault.failNext('updateFrontmatter', indexPath);
    const result = await store.mergeConflictCopy(COPY);
    expect(result.status).toBe('failed');
    expect(vault.trashed).toEqual([]);
    expect(vault.has(COPY)).toBe(true);
    expect(vault.frontmatterOf(indexPath)).not.toHaveProperty('labels');
  });
});

describe('a copy that cannot be merged', () => {
  it('is left where it is when its properties cannot be read', async () => {
    const { store, vault } = await openSeeded(threeScenes, withCopy());
    vault.external.corrupt(COPY, { silent: true });
    const result = await store.mergeConflictCopy(COPY);
    expect(result).toMatchObject({ status: 'refused', reason: 'unreadable-copy' });
    expect(result.status === 'refused' && result.message).toMatch(/could not be read/);
    expect(vault.writes).toEqual([]);
    expect(vault.has(COPY)).toBe(true);
    expect(picture(store)).toBe('A B C');
  });

  it('is left where it is when its binder cannot be understood', async () => {
    const { store, vault } = await openSeeded(threeScenes, withCopy({ not: 'a list' }));
    const result = await store.mergeConflictCopy(COPY);
    expect(result).toMatchObject({ status: 'refused', reason: 'unreadable-copy' });
    expect(result.status === 'refused' && result.message).toMatch(/could not be understood/);
    expect(result.status === 'refused' && result.message).toMatch(/left where it is/);
    expect(vault.writes).toEqual([]);
    expect(vault.has(COPY)).toBe(true);
  });

  it('is left alone when it lists a path that leaves the project folder', async () => {
    const { store, vault } = await openSeeded(threeScenes, withCopy(['../Elsewhere/Secret.md']));
    expect(await store.mergeConflictCopy(COPY)).toMatchObject({ status: 'refused', reason: 'unreadable-copy' });
    expect(vault.writes).toEqual([]);
  });

  it('is left alone when it is no longer marked as a project by the time it is read', async () => {
    const { store, vault } = await openSeeded(threeScenes, withCopy());
    vault.holdMetadata();
    vault.external.write(COPY, { frontmatter: { title: 'Now just a note' } }, { silent: true });
    expect(await store.mergeConflictCopy(COPY)).toMatchObject({ status: 'refused', reason: 'not-a-copy' });
    expect(vault.writes).toEqual([]);
    expect(vault.has(COPY)).toBe(true);
  });

  it('never merges or trashes a note that is not a copy of this project\'s index', async () => {
    const vault = withCopy();
    seedProject(vault, { folder: 'Other', title: 'Other Book', scenes: { Elsewhere: 1024 } });
    vault.seed('Novel/Sequel.md', { frontmatter: copyOf(['Manuscript/Z.md'], { title: 'The Sequel' }) });
    const { store, indexPath } = await openSeeded(threeScenes, vault);
    for (const path of ['Novel/Manuscript/A.md', 'Novel/To-do.md', 'Other/Other.md', 'Novel/Sequel.md', indexPath]) {
      const result = await store.mergeConflictCopy(path);
      expect(result.status, path).not.toBe('done');
      expect(result.status === 'refused' || result.status === 'noop', path).toBe(true);
    }
    expect(vault.writes).toEqual([]);
    expect(vault.trashed).toEqual([]);
  });

  it('says so when the copy has already gone', async () => {
    const { store, vault } = await openSeeded(threeScenes, withCopy());
    vault.external.delete(COPY, { silent: true });
    expect(await store.mergeConflictCopy(COPY)).toMatchObject({ status: 'noop', reason: 'not-found' });
    expect(await store.mergeConflictCopy('Novel/Novel 9.md')).toMatchObject({ status: 'noop', reason: 'not-found' });
    expect(vault.writes).toEqual([]);
  });

  it('is not trashed when the index could not be saved', async () => {
    const { store, vault, indexPath } = await openSeeded(threeScenes, withCopy());
    vault.failNext('updateFrontmatter', indexPath);
    const result = await store.mergeConflictCopy(COPY);
    expect(result.status).toBe('failed');
    expect(vault.trashed).toEqual([]);
    expect(vault.has(COPY)).toBe(true);
    expect(binderOnDisk(vault, indexPath)).toEqual(['Manuscript/A.md', 'Manuscript/B.md', 'Manuscript/C.md']);
    // Nothing is lost: the merge can simply be asked for again.
    expect(valueOf(await store.mergeConflictCopy(COPY)).added).toEqual(['Manuscript/D.md']);
  });

  it('says where the copy is when it was merged but could not be moved to the trash', async () => {
    const { store, vault, indexPath } = await openSeeded(threeScenes, withCopy());
    vault.failNext('trash', COPY);
    const result = await store.mergeConflictCopy(COPY);
    expect(result.status).toBe('failed');
    expect(result.status === 'failed' && result.message).toMatch(/were added to the binder/);
    expect(result.status === 'failed' && result.message).toContain(COPY);
    expect(binderOnDisk(vault, indexPath)).toContain('Manuscript/D.md');
    expect(vault.has(COPY)).toBe(true);
    // Asked again, there is nothing left to add, and the copy goes.
    expect(valueOf(await store.mergeConflictCopy(COPY)).added).toEqual([]);
    expect(vault.has(COPY)).toBe(false);
  });

  it('is refused while the project is read-only: an index that cannot be understood is never written', async () => {
    const { store, vault } = await openSeeded({ binder: { not: 'a list' }, scenes: { A: 1024 } }, withCopy());
    expect(project(store).readOnly).toBe(true);
    expect(await store.mergeConflictCopy(COPY)).toMatchObject({ status: 'refused', reason: 'read-only' });
    expect(vault.writes).toEqual([]);
    expect(vault.has(COPY)).toBe(true);
  });

  it('is refused when another project was opened in the meantime', async () => {
    const vault = withCopy();
    const other = seedProject(vault, { folder: 'Other', title: 'Other Book' });
    const { store, indexPath } = await openSeeded(threeScenes, vault);
    await store.openProject(other);
    expect(await store.mergeConflictCopy(COPY, indexPath)).toMatchObject({ status: 'refused', reason: 'other-project' });
    expect(vault.writes).toEqual([]);
  });
});

describe('which of two indexes is the project', () => {
  it('opens the project itself, never its copy, when Obsidian starts', async () => {
    const vault = withCopy();
    seedProject(vault, threeScenes);
    const { store } = makeStore(vault);
    const session = new ProjectSession(store, new DevicePrefs(new MemoryDeviceStorage()));
    session.start();
    await quiet(store);
    expect(store.project?.indexPath).toBe(INDEX);
    expect(store.project?.conflicts).toEqual([COPY]);
  });

  it('moves over to the project when the copy was all there was and the original arrives later', async () => {
    // A device that is still downloading the vault: the copy came first.
    const vault = new MemoryVault();
    vault.seed(COPY, { frontmatter: copyOf(['Manuscript/A.md']) });
    const storage = new MemoryDeviceStorage();
    const { store } = makeStore(vault);
    const session = new ProjectSession(store, new DevicePrefs(storage));
    session.start();
    await quiet(store);
    expect(store.project?.indexPath).toBe(COPY);

    vault.external.create(INDEX, { frontmatter: copyOf(['Manuscript/A.md', 'Manuscript/B.md']) });
    await quiet(store);
    expect(store.project?.indexPath).toBe(INDEX);
    expect(store.project?.conflicts).toEqual([COPY]);
    expect(storage.saves).toEqual([]); // nobody chose anything
    expect(vault.writes).toEqual([]);
  });

  it('takes a choice that points at a copy to mean the project it is a copy of', async () => {
    const vault = withCopy();
    seedProject(vault, threeScenes);
    seedProject(vault, { folder: 'Alpha', title: 'Alpha' });
    const storage = new MemoryDeviceStorage();
    storage.save(ACTIVE_PROJECT_KEY, COPY);
    const { store } = makeStore(vault);
    const session = new ProjectSession(store, new DevicePrefs(storage));
    session.start();
    await quiet(store);
    expect(store.project?.indexPath).toBe(INDEX); // not Alpha, the first in the list
  });
});
