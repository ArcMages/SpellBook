// Project store: making the note of a timeline event.
//
// addTimelineNote is the only way a screen can make a note that is not a
// scene. What is checked hardest: it never replaces anything, it never tidies
// a name behind the caller's back, and it cannot reach outside the open
// project's Timeline folder.

import { describe, expect, it } from 'vitest';
import { TIMELINE_FOLDER } from '../src/core/projectStore';
import { MemoryVault } from './memoryVault';
import { binderOnDisk, makeStore, openSeeded, picture, seedProject, valueOf } from './storeHarness';

const INDEX = 'Novel/Novel.md';
const scenes = { scenes: { A: 1024, B: 2048 } };
const EVENT = { spellbook: 'event', date: '1923-04-12', timelines: ['Main plot'] };

/** A project that already has a Timeline folder with one event in it. */
function withTimeline(): MemoryVault {
  return new MemoryVault().seed('Novel/Timeline/The fire.md', {
    frontmatter: { spellbook: 'event', date: '1890-03-01', timelines: ['Town'] },
    body: 'What happened that night.',
  });
}

describe('addTimelineNote', () => {
  it('makes a note in the Timeline folder with the properties given and no text, in one write', async () => {
    const { store, vault } = await openSeeded(scenes, withTimeline());
    const made = valueOf(await store.addTimelineNote('The war begins', EVENT));
    expect(made).toEqual({ path: 'Timeline/The war begins.md' });
    expect(vault.writes).toEqual([{ op: 'createFile', path: 'Novel/Timeline/The war begins.md' }]);
    expect(vault.frontmatterOf('Novel/Timeline/The war begins.md')).toEqual(EVENT);
    expect(vault.bodyOf('Novel/Timeline/The war begins.md')).toBe('');
    // The store lists it at once, and knows where it is.
    expect(store.timelineNotes().map((note) => note.path)).toEqual(['Timeline/The fire.md', 'Timeline/The war begins.md']);
    expect(store.vaultPathOf('Timeline/The war begins.md')).toBe('Novel/Timeline/The war begins.md');
  });

  it('leaves the binder, the index and every other note exactly as they were', async () => {
    const { store, vault } = await openSeeded(scenes, withTimeline());
    const index = vault.textOf(INDEX);
    const before = picture(store);
    valueOf(await store.addTimelineNote('The war begins', EVENT));
    expect(vault.textOf(INDEX)).toBe(index);
    expect(binderOnDisk(vault, INDEX)).toEqual(['Manuscript/A.md', 'Manuscript/B.md']);
    expect(picture(store)).toBe(before);
    expect(vault.bodyOf('Novel/Timeline/The fire.md')).toBe('What happened that night.');
    expect(store.project?.unfiled).toEqual([]); // an event is not a scene waiting to be filed
  });

  it('makes the Timeline folder first when the project has none', async () => {
    const { store, vault } = await openSeeded(scenes);
    expect(vault.hasFolder('Novel/Timeline')).toBe(false);
    valueOf(await store.addTimelineNote('First', EVENT));
    expect(vault.writes).toEqual([
      { op: 'createFolder', path: 'Novel/Timeline' },
      { op: 'createFile', path: 'Novel/Timeline/First.md' },
    ]);
  });

  it('keeps a name in any language as it was given', async () => {
    const { store, vault } = await openSeeded(scenes, withTimeline());
    const name = 'ילדות'; // a Hebrew word
    expect(valueOf(await store.addTimelineNote(name, { spellbook: 'event', date: null, timelines: [] }))).toEqual({
      path: `Timeline/${name}.md`,
    });
    expect(vault.frontmatterOf(`Novel/Timeline/${name}.md`)).toEqual({ spellbook: 'event', date: null, timelines: [] });
  });

  it('takes a copy of the properties: changing them afterwards changes nothing', async () => {
    const { store, vault } = await openSeeded(scenes, withTimeline());
    const given = { spellbook: 'event', date: '1923', timelines: ['Main plot'] };
    valueOf(await store.addTimelineNote('Later', given));
    given.timelines.push('Changed');
    expect(vault.frontmatterOf('Novel/Timeline/Later.md')).toEqual({ spellbook: 'event', date: '1923', timelines: ['Main plot'] });
  });

  it('REFUSES a name that is taken, whatever its capitals, and replaces nothing', async () => {
    const { store, vault } = await openSeeded(scenes, withTimeline());
    for (const name of ['The fire', 'the FIRE']) {
      expect(await store.addTimelineNote(name, EVENT), name).toMatchObject({ status: 'refused', reason: 'exists' });
    }
    expect(vault.writes).toEqual([]);
    expect(vault.frontmatterOf('Novel/Timeline/The fire.md')).toEqual({ spellbook: 'event', date: '1890-03-01', timelines: ['Town'] });
    expect(vault.bodyOf('Novel/Timeline/The fire.md')).toBe('What happened that night.');
    expect(vault.paths().filter((path) => path.startsWith('Novel/Timeline/'))).toEqual(['Novel/Timeline/The fire.md']);
  });

  it('refuses a name the binder lists there, even while its note has not arrived yet', async () => {
    const vault = withTimeline();
    const { store } = await openSeeded({ ...scenes, binder: ['Manuscript/A.md', 'Timeline/On its way.md'] }, vault);
    expect(store.project?.missing).toEqual(['Timeline/On its way.md']);
    expect(await store.addTimelineNote('On its way', EVENT)).toMatchObject({ status: 'refused', reason: 'exists' });
    expect(vault.writes).toEqual([]);
  });

  it('REFUSES every name that is not a tidy file name as it stands, and never tidies one itself', async () => {
    const vault = withTimeline().seed('Elsewhere/Note.md', { frontmatter: { mine: true }, body: 'not yours' });
    const { store } = await openSeeded(scenes, vault);
    for (const name of [
      '',
      ' ',
      ' padded',
      'padded ',
      'two  spaces',
      '.hidden',
      'ends with a dot.',
      '..',
      '../Manuscript/A',
      '../../Elsewhere/Note',
      '/Elsewhere/Note',
      'sub/folder',
      'back\\slash',
      'a:b',
      'what?',
      'star*',
      'quo"te',
      'a<b>',
      'pipe|',
      'hash#tag',
      'caret^',
      '[link]',
      'line\nbreak',
      'tab\tbed',
      'x'.repeat(201),
      'é', // not in the form names are kept in: tidy it first
    ]) {
      const result = await store.addTimelineNote(name, EVENT);
      expect(result, JSON.stringify(name)).toMatchObject({ status: 'refused', reason: 'invalid-name' });
    }
    expect(vault.writes).toEqual([]);
    expect(vault.paths()).toEqual([
      'Elsewhere/Note.md',
      'Novel/Manuscript/A.md',
      'Novel/Manuscript/B.md',
      'Novel/Novel.md',
      'Novel/Timeline/The fire.md',
    ]);
  });

  it('refuses properties that would make the note a project of its own', async () => {
    const { store, vault } = await openSeeded(scenes, withTimeline());
    const result = await store.addTimelineNote('Sneaky', { spellbook: 'project', version: 1, binder: [] });
    expect(result).toMatchObject({ status: 'refused', reason: 'inside-project' });
    expect(vault.writes).toEqual([]);
    expect(store.listProjects().map((entry) => entry.indexPath)).toEqual([INDEX]);
  });

  it('refuses a read-only project, no project, and another project than the one it was meant for', async () => {
    const vault = new MemoryVault();
    seedProject(vault, { binder: { not: 'a list' }, scenes: { A: 1024 } });
    const { store } = makeStore(vault);
    expect(await store.addTimelineNote('Event', EVENT)).toMatchObject({ status: 'refused', reason: 'no-project' });
    valueOf(await store.openProject(INDEX));
    expect(await store.addTimelineNote('Event', EVENT)).toMatchObject({ status: 'refused', reason: 'read-only' });
    expect(vault.writes).toEqual([]);

    const other = await openSeeded(scenes);
    expect(await other.store.addTimelineNote('Event', EVENT, 'Other/Other.md')).toMatchObject({
      status: 'refused',
      reason: 'other-project',
    });
    expect(other.vault.writes).toEqual([]);
  });

  it('takes its turn in the queue: the second of two notes with one name is refused', async () => {
    const { store, vault } = await openSeeded(scenes, withTimeline());
    const [first, second] = await Promise.all([store.addTimelineNote('Twice', EVENT), store.addTimelineNote('Twice', { ...EVENT, date: '1999' })]);
    expect(first).toMatchObject({ status: 'done' });
    expect(second).toMatchObject({ status: 'refused', reason: 'exists' });
    expect(vault.frontmatterOf('Novel/Timeline/Twice.md')).toEqual(EVENT);
    expect(vault.writesTo('Novel/Timeline/Twice.md')).toHaveLength(1);
  });

  it('says so when the note could not be created, and leaves nothing half made', async () => {
    const { store, vault } = await openSeeded(scenes, withTimeline());
    vault.failNext('createFile', 'Novel/Timeline/Unlucky.md');
    const result = await store.addTimelineNote('Unlucky', EVENT);
    expect(result.status).toBe('failed');
    expect(vault.has('Novel/Timeline/Unlucky.md')).toBe(false);
    // The same name can be used straight afterwards.
    expect(valueOf(await store.addTimelineNote('Unlucky', EVENT))).toEqual({ path: 'Timeline/Unlucky.md' });
  });

  it('follows the project when its folder is renamed', async () => {
    const { store, vault } = await openSeeded(scenes, withTimeline());
    vault.external.rename('Novel', 'Book');
    valueOf(await store.addTimelineNote('After the move', EVENT));
    expect(vault.has(`Book/${TIMELINE_FOLDER}/After the move.md`)).toBe(true);
    expect(vault.has('Novel/Timeline/After the move.md')).toBe(false);
  });
});
