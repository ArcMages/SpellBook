// Where the revision notes are kept: one file per project, "Revision
// notes.json", outside the scenes. What is in it, how notes follow a scene
// that is renamed or moved, how notes kept the old way (in the scene's
// properties) are moved into it, two projects in one vault, two saves at
// once, and a file that cannot be read.

import { afterEach, describe, expect, it } from 'vitest';
import type { Plugin as ObsidianPlugin } from 'obsidian';
import {
  editScene,
  emptyNotesFile,
  findEntry,
  mergeIntoScene,
  parseNotesFile,
  renameScenes,
  sceneNotes,
  serialiseNotesFile,
} from '../../../src/core/revision/index';
import type { IdAt, NotesFile } from '../../../src/core/revision/index';
import { WordCountCache } from '../../../src/core/wordCountCache';
import { registerFeatures } from '../../../src/features/registry';
import type { FeatureContext } from '../../../src/features/registry';
import { RevisionKeeper, RevisionNotesBook, UNREADABLE_NOTES_TEXT, revisionFeature } from '../../../src/features/revision/index';
import { FakeObsidian } from '../../fakeObsidianApp';
import type { MemoryVault } from '../../memoryVault';
import { Plugin as StubPlugin } from '../../obsidianStub';
import { MemoryDeviceStorage, makeStore } from '../../storeHarness';
import { CLOSING, NIGHT, NOON, NOVEL_INDEX, OPENING, calm, inNovel, novelVault } from '../snapshots/stage';

const NOTES = 'Novel/Revision notes.json';
const SECOND_INDEX = 'Second/Second.md';
const SECOND_SCENE = 'Manuscript/Harbour.md';

const note = (passage: string, words = '', done = false): Record<string, unknown> => ({ passage, note: words, created: '2026-10-14', done });

function fileOf(vault: MemoryVault, path = NOTES): { scenes: Array<Record<string, unknown>> } & Record<string, unknown> {
  return JSON.parse(vault.textOf(path)) as { scenes: Array<Record<string, unknown>> } & Record<string, unknown>;
}

/** The passages of each scene in a notes file, by the scene's path. */
function passagesIn(vault: MemoryVault, path = NOTES): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const entry of fileOf(vault, path).scenes) {
    out[entry['scene'] as string] = (entry['notes'] as Array<{ passage: string }>).map((item) => item.passage);
  }
  return out;
}

function secondProject(vault: MemoryVault): MemoryVault {
  vault.seed(SECOND_INDEX, { frontmatter: { spellbook: 'project', version: 1, title: 'Second', binder: [SECOND_SCENE] }, body: '' });
  vault.seed(`Second/${SECOND_SCENE}`, { frontmatter: { order: 1024 }, body: 'The harbour of the second book.\n' });
  return vault;
}

const stops: Array<() => void> = [];
afterEach(() => {
  for (const stop of stops.splice(0)) stop();
});

/** The revision feature on a store and a memory vault; `keeper` has a book of its own, as a second screen would. */
async function stage(vault: MemoryVault = novelVault(), open: string | null = NOVEL_INDEX) {
  const { store, timers } = makeStore(vault);
  if (open !== null) {
    const opened = await store.openProject(open);
    if (opened.status !== 'done') throw new Error('the project did not open');
  }
  const fake = new FakeObsidian();
  const plugin = new StubPlugin(fake.app, { id: 'spellbook-novel-writer' });
  const wordCounts = new WordCountCache({ vault, setTimer: timers.set });
  const clock = { today: () => '2026-10-14', now: () => NOON, setTimer: timers.set, nextFrame: (callback: (time: number) => void) => timers.set(() => callback(16), 16) };
  const host = {
    plugin: plugin as unknown as ObsidianPlugin,
    app: fake.app,
    store,
    vault,
    storage: new MemoryDeviceStorage(),
    deviceId: () => 'testdevice',
    clock,
    wordCounts,
    openNote: async () => true,
  };
  const features = registerFeatures([revisionFeature], host);
  const context: FeatureContext = { ...host, deviceId: 'testdevice', services: features.services, addSettingsSection: () => undefined, onUnload: () => undefined };
  const keeper = new RevisionKeeper(context);
  stops.push(() => {
    keeper.dispose();
    features.release();
    plugin.unload();
    wordCounts.dispose();
    store.dispose();
  });
  /** Let renames and the moving of old notes run, and everything settle. */
  const rest = async (): Promise<void> => {
    for (let round = 0; round < 3; round++) {
      await calm({ store, timers });
      timers.advance(1000);
      await calm({ store, timers });
      await keeper.book.idle();
    }
  };
  return { vault, store, timers, keeper, context, rest };
}

// ---------------------------------------------------------------- the file

describe('the revision notes file', () => {
  const noIds: IdAt = () => undefined;

  it('reads as no notes when it is missing or empty, and not at all when it is cut short, laid out otherwise, or newer', () => {
    expect(parseNotesFile(null)?.data['scenes']).toEqual([]);
    expect(parseNotesFile('  \n')?.data['scenes']).toEqual([]);
    expect(parseNotesFile('{"spellbook-revision-notes": 1, "scenes": [')).toBeNull();
    expect(parseNotesFile('[]')).toBeNull();
    expect(parseNotesFile('{"scenes": "many"}')).toBeNull();
    expect(parseNotesFile('{"spellbook-revision-notes": 2, "scenes": []}')).toBeNull();
    expect(parseNotesFile('{"other": true}')?.data).toEqual({ other: true, scenes: [] });
  });

  it('is written one field to a line, marked as Spellbook\'s, with a line for whoever opens it', () => {
    const file = emptyNotesFile();
    editScene(file, { path: OPENING, id: null }, noIds, (list) => list.push(note('dark night', 'Colder.')) > 0);
    const text = serialiseNotesFile(file);
    expect(text.split('\n').length).toBeGreaterThan(10);
    expect(text.endsWith('}\n')).toBe(true);
    const data = JSON.parse(text) as Record<string, unknown>;
    expect(Object.keys(data)).toEqual(['spellbook-revision-notes', 'about', 'scenes']);
    expect(data['scenes']).toEqual([{ scene: OPENING, notes: [note('dark night', 'Colder.')] }]);
  });

  it('keeps whatever it does not know, in the file, in an entry and in a note', () => {
    const file = parseNotesFile(
      JSON.stringify({ 'spellbook-revision-notes': 1, later: 'kept', scenes: [{ scene: OPENING, colour: 'red', notes: [{ ...note('dark night'), extra: 1 }] }] }),
    ) as NotesFile;
    editScene(file, { path: OPENING, id: null }, noIds, (list) => list.push(note('walked alone')) > 0);
    expect(file.data['later']).toBe('kept');
    expect(file.data['scenes']).toEqual([{ scene: OPENING, colour: 'red', notes: [{ ...note('dark night'), extra: 1 }, note('walked alone')] }]);
  });

  it('drops a scene\'s entry once its last note goes, and makes none for nothing', () => {
    const file = emptyNotesFile();
    expect(editScene(file, { path: OPENING, id: null }, noIds, () => false)).toBe(false);
    editScene(file, { path: OPENING, id: null }, noIds, (list) => list.push(note('a')) > 0);
    expect(editScene(file, { path: OPENING, id: null }, noIds, (list) => list.splice(0, 1).length > 0)).toBe(true);
    expect(file.data['scenes']).toEqual([]);
  });

  it('finds a scene by its path, and by its snapshot id when it was renamed where the notes could not follow', () => {
    const file = emptyNotesFile();
    editScene(file, { path: 'Manuscript/Old.md', id: 'abc1' }, noIds, (list) => list.push(note('a')) > 0);
    // Renamed elsewhere: nothing is at the old path any more.
    const renamed: IdAt = (path) => (path === 'Manuscript/New.md' ? 'abc1' : undefined);
    expect(sceneNotes(file, { path: 'Manuscript/New.md', id: 'abc1' }, renamed).map((item) => item.passage)).toEqual(['a']);
    // A copy that carries the same id: the original is still at the old path, and keeps its notes to itself.
    const copied: IdAt = (path) => (path === 'Manuscript/Old.md' || path === 'Manuscript/Copy.md' ? 'abc1' : undefined);
    expect(sceneNotes(file, { path: 'Manuscript/Copy.md', id: 'abc1' }, copied)).toEqual([]);
    // Another scene that took the old name has another id: the notes are not its.
    expect(findEntry(file, { path: 'Manuscript/Old.md', id: 'zzz9' }, noIds)).toBe(-1);
    // Writing through the id brings the path up to date.
    editScene(file, { path: 'Manuscript/New.md', id: 'abc1' }, renamed, (list) => list.push(note('b')) > 0);
    expect(file.data['scenes']).toEqual([{ scene: 'Manuscript/New.md', 'scene-id': 'abc1', notes: [note('a'), note('b')] }]);
  });

  it('follows chains of renames, two scenes trading names, and a change of capitals', () => {
    const file = emptyNotesFile();
    editScene(file, { path: 'A.md', id: null }, noIds, (list) => list.push(note('a')) > 0);
    editScene(file, { path: 'B.md', id: null }, noIds, (list) => list.push(note('b')) > 0);
    renameScenes(file, [
      { from: 'A.md', to: 'T.md' },
      { from: 'B.md', to: 'A.md' },
      { from: 'T.md', to: 'B.md' },
      { from: 'B.md', to: 'b.md' },
    ]);
    expect((file.data['scenes'] as Array<Record<string, unknown>>).map((entry) => [entry['scene'], (entry['notes'] as Array<{ passage: string }>)[0]?.passage])).toEqual([
      ['A.md', 'b'],
      ['b.md', 'a'],
    ]);
  });

  it('adds notes kept the old way once, however often it is asked', () => {
    const file = emptyNotesFile();
    const old = [note('dark night', 'Colder.'), 'not a note', { ...note('walked alone', 'Why?', true), extra: 'kept' }];
    expect(mergeIntoScene(file, { path: OPENING, id: null }, noIds, old)).toBe(true);
    expect(mergeIntoScene(file, { path: OPENING, id: null }, noIds, old)).toBe(false);
    expect(file.data['scenes']).toEqual([{ scene: OPENING, notes: [note('dark night', 'Colder.'), { ...note('walked alone', 'Why?', true), extra: 'kept' }] }]);
  });
});

// ------------------------------------------------------------ in the plugin

describe('revision notes kept in the project\'s file', () => {
  it('are kept out of the scenes, and nothing that lists, counts or exports notes sees the file', async () => {
    const { keeper, vault, store, rest } = await stage();
    expect(await keeper.addNote(OPENING, 'dark night', 'Colder.')).toBeNull();
    await rest();
    expect(vault.has(NOTES)).toBe(true);
    expect(vault.frontmatterOf(inNovel(OPENING))).not.toHaveProperty('revision-notes');
    expect(vault.listMarkdownFiles('Novel').map((file) => file.path)).not.toContain(NOTES);
    expect(store.projectNotes().map((file) => file.path)).not.toContain('Revision notes.json');
    const project = store.project;
    expect([...(project?.unfiled ?? []), ...(project?.research ?? []), ...(project?.missing ?? [])]).toEqual(['Research/Harbours.md']);
    expect(project?.notes).toEqual([]);
  });

  it('both arrive when two are saved at once', async () => {
    const { keeper, vault, rest } = await stage();
    const results = await Promise.all([keeper.addNote(OPENING, 'dark night', 'one'), keeper.addNote(OPENING, 'walked alone', 'two'), keeper.addNote(NIGHT, 'הים שקט', 'שלוש')]);
    expect(results).toEqual([null, null, null]);
    await rest();
    expect(passagesIn(vault)).toEqual({ [OPENING]: ['dark night', 'walked alone'], [NIGHT]: ['הים שקט'] });
    // A tick and a change made at once both arrive as well.
    const [first, second] = keeper.notesOf(OPENING);
    await Promise.all([keeper.changeNote(OPENING, first!, { done: true }), keeper.changeNote(OPENING, second!, { note: 'two, again' })]);
    expect(keeper.notesOf(OPENING).map((item) => [item.note, item.done])).toEqual([
      ['one', true],
      ['two, again', false],
    ]);
  });

  it('are read again when the file changes on another device', async () => {
    const { keeper, vault, rest } = await stage();
    await keeper.addNote(OPENING, 'dark night', 'Colder.');
    await rest();
    const data = fileOf(vault);
    (data.scenes[0]!['notes'] as unknown[]).push(note('walked alone', 'from the phone'));
    vault.external.write(NOTES, { body: JSON.stringify(data) });
    await rest();
    expect(keeper.notesOf(OPENING).map((item) => item.note)).toEqual(['Colder.', 'from the phone']);
  });

  it('are never written over when the file cannot be read, and the writer is told why', async () => {
    const vault = novelVault();
    vault.seed(NOTES, { body: '{"spellbook-revision-notes": 1, "scenes": [{"scene": "Manu' });
    const { keeper, rest } = await stage(vault);
    await rest();
    expect(await keeper.addNote(OPENING, 'dark night', 'Colder.')).toBe(UNREADABLE_NOTES_TEXT);
    expect(vault.textOf(NOTES)).toBe('{"spellbook-revision-notes": 1, "scenes": [{"scene": "Manu');
    expect(vault.writes.filter((write) => write.path === NOTES)).toEqual([]);
  });

  it('follow a scene renamed in the binder, and a scene and a folder renamed in Obsidian', async () => {
    const { keeper, vault, store, rest } = await stage();
    await keeper.addNote(OPENING, 'dark night', 'Colder.');
    await keeper.addNote(NIGHT, 'הים שקט', 'למה?');
    const renamed = await store.renameScene(OPENING, 'Arrival');
    expect(renamed.status).toBe('done');
    await rest();
    expect(passagesIn(vault)).toEqual({ 'Manuscript/Arrival.md': ['dark night'], [NIGHT]: ['הים שקט'] });
    expect(keeper.notesOf('Manuscript/Arrival.md').map((item) => item.note)).toEqual(['Colder.']);

    vault.external.rename(inNovel(NIGHT), inNovel('Manuscript/Part one/לילה.md'));
    vault.external.rename('Novel/Manuscript', 'Novel/Draft');
    await rest();
    expect(passagesIn(vault)).toEqual({ 'Draft/Arrival.md': ['dark night'], 'Draft/Part one/לילה.md': ['הים שקט'] });
  });

  it('stay in the file when their scene is deleted, and are back when it is put back', async () => {
    const { keeper, vault, store, rest } = await stage();
    await keeper.addNote(CLOSING, 'end came', 'Softer.');
    const deleted = await store.deleteScene(CLOSING);
    expect(deleted.status).toBe('done');
    await rest();
    expect(keeper.allNotes()).toEqual([]);
    expect(passagesIn(vault)).toEqual({ [CLOSING]: ['end came'] });
    // Back from the trash, under its name.
    vault.external.create(inNovel(CLOSING), { body: 'The end came quietly.\n' });
    await rest();
    expect(keeper.notesOf(CLOSING).map((item) => item.note)).toEqual(['Softer.']);
  });

  it('go with a scene moved into another project, and stay behind when it leaves every project', async () => {
    const { keeper, vault, rest } = await stage(secondProject(novelVault()));
    await keeper.addNote(OPENING, 'dark night', 'Colder.');
    await keeper.addNote(CLOSING, 'end came', 'Softer.');
    vault.external.rename(inNovel(OPENING), `Second/Manuscript/Opening.md`);
    vault.external.rename(inNovel(CLOSING), 'Notes/Closing.md');
    await rest();
    expect(passagesIn(vault)).toEqual({ [CLOSING]: ['end came'] });
    expect(passagesIn(vault, 'Second/Revision notes.json')).toEqual({ 'Manuscript/Opening.md': ['dark night'] });
  });

  it('keep two projects of one vault apart, and follow renames in a project that is not open', async () => {
    const vault = secondProject(novelVault());
    vault.seed('Second/Revision notes.json', {
      body: JSON.stringify({ 'spellbook-revision-notes': 1, scenes: [{ scene: SECOND_SCENE, notes: [note('second book', 'Theirs.')] }] }),
    });
    const { keeper, vault: v, rest } = await stage(vault);
    await keeper.addNote(OPENING, 'dark night', 'Ours.');
    await rest();
    expect(keeper.allNotes().map((entry) => [entry.scene.path, entry.notes.map((item) => item.note)])).toEqual([[OPENING, ['Ours.']]]);
    // The file of a project that is not open is read the first time a scene of it is shown.
    expect(keeper.book.notesAtVaultPath(`Second/${SECOND_SCENE}`)).toEqual([]);
    await keeper.book.idle();
    expect(keeper.book.notesAtVaultPath(`Second/${SECOND_SCENE}`).map((item) => item.note)).toEqual(['Theirs.']);
    expect(keeper.book.notesAtVaultPath(inNovel(OPENING)).map((item) => item.note)).toEqual(['Ours.']);
    expect(keeper.book.notesAtVaultPath('Notes/Plain.md')).toEqual([]);
    v.external.rename(`Second/${SECOND_SCENE}`, 'Second/Manuscript/Port.md');
    await rest();
    expect(passagesIn(v, 'Second/Revision notes.json')).toEqual({ 'Manuscript/Port.md': ['second book'] });
    expect(passagesIn(v)).toEqual({ [OPENING]: ['dark night'] });
  });
});

// --------------------------------------------------------------- migration

describe('notes kept the old way, in a scene\'s properties', () => {
  const OLD = [note('dark night', 'Colder.'), { ...note('walked alone', 'Why?', true), extra: 'kept' }];

  function oldVault(): MemoryVault {
    const vault = novelVault();
    vault.seed(inNovel(OPENING), {
      frontmatter: { synopsis: 'Anna arrives.', order: 1024, 'snapshot-id': 'abc1', 'revision-notes': OLD },
      body: 'It was a dark night. Anna walked alone.\n',
    });
    vault.seed(inNovel(CLOSING), { frontmatter: { 'revision-notes': 'my own text, not notes' }, body: 'The end came quietly.\n' });
    return vault;
  }

  it('move into the project\'s file when it is opened, and the property leaves the scene; nothing else changes', async () => {
    const vault = oldVault();
    const body = vault.bodyOf(inNovel(OPENING));
    const { keeper, rest } = await stage(vault);
    await rest();
    expect(fileOf(vault).scenes).toEqual([{ scene: OPENING, 'scene-id': 'abc1', notes: OLD }]);
    expect(vault.frontmatterOf(inNovel(OPENING))).toEqual({ synopsis: 'Anna arrives.', order: 1024, 'snapshot-id': 'abc1' });
    expect(vault.bodyOf(inNovel(OPENING))).toBe(body);
    expect(keeper.notesOf(OPENING).map((item) => [item.passage, item.done])).toEqual([
      ['dark night', false],
      ['walked alone', true],
    ]);
    // A property that holds something other than notes is the writer's: left as it is.
    expect(vault.frontmatterOf(inNovel(CLOSING))).toEqual({ 'revision-notes': 'my own text, not notes' });
  });

  it('move once: doing it again changes nothing', async () => {
    const vault = oldVault();
    const { rest } = await stage(vault);
    await rest();
    vault.clearWrites();
    vault.refresh();
    await rest();
    expect(vault.writes).toEqual([]);
  });

  it('are moved safely when it stops half way: nothing is lost, and nothing comes twice', async () => {
    const vault = oldVault();
    vault.failNext('updateFrontmatter', inNovel(OPENING));
    const { rest } = await stage(vault);
    await rest();
    // In the file, and still in the scene.
    expect(passagesIn(vault)).toEqual({ [OPENING]: ['dark night', 'walked alone'] });
    expect(vault.frontmatterOf(inNovel(OPENING))?.['revision-notes']).toEqual(OLD);
    // The next time (here: the vault is looked at again), it finishes, adding nothing twice.
    vault.refresh();
    await rest();
    expect(passagesIn(vault)).toEqual({ [OPENING]: ['dark night', 'walked alone'] });
    expect(vault.frontmatterOf(inNovel(OPENING))).not.toHaveProperty('revision-notes');
  });

  it('that arrive later (a device not yet updated, a snapshot restored with its properties) move too, without coming twice', async () => {
    const { keeper, vault, store, rest } = await stage();
    await keeper.addNote(OPENING, 'dark night', 'Colder.');
    await rest();
    const [first] = keeper.notesOf(OPENING);
    await keeper.changeNote(OPENING, first!, { done: true });
    // The properties of an earlier time come back with the note as it was then, and one the file does not have.
    const text = vault.textOf(inNovel(OPENING));
    const restored = await store.replaceSceneText(OPENING, () =>
      text.replace('---\n', `---\nrevision-notes: ${JSON.stringify([note('dark night', 'Colder.'), note('Who is there', 'Louder.')])}\n`),
    );
    expect(restored.status).toBe('done');
    await rest();
    expect(vault.frontmatterOf(inNovel(OPENING))).not.toHaveProperty('revision-notes');
    expect(keeper.notesOf(OPENING).map((item) => [item.passage, item.done])).toEqual([
      ['dark night', true],
      ['Who is there', false],
    ]);
  });

  it('are left in a project that is not open, and still underlined there', async () => {
    const vault = secondProject(novelVault());
    vault.seed(`Second/${SECOND_SCENE}`, { frontmatter: { 'revision-notes': [note('second book', 'Theirs.')] }, body: 'The harbour of the second book.\n' });
    const { keeper, rest } = await stage(vault);
    await rest();
    expect(vault.has('Second/Revision notes.json')).toBe(false);
    expect(vault.frontmatterOf(`Second/${SECOND_SCENE}`)).toHaveProperty('revision-notes');
    expect(keeper.book.notesAtVaultPath(`Second/${SECOND_SCENE}`).map((item) => item.note)).toEqual(['Theirs.']);
  });

  it('keep their scene when a restore puts back the text of an earlier time', async () => {
    const { keeper, vault, store, rest } = await stage();
    await keeper.addNote(OPENING, 'dark night', 'Colder.');
    await rest();
    const restored = await store.replaceSceneText(OPENING, (current) => current.replace('It was a dark night.', 'It was a long night.'));
    expect(restored.status).toBe('done');
    await rest();
    expect(keeper.notesOf(OPENING).map((item) => item.note)).toEqual(['Colder.']);
    expect(passagesIn(vault)).toEqual({ [OPENING]: ['dark night'] });
  });
});

describe('the book of a second screen', () => {
  it('follows what the feature\'s book writes, and moves nothing itself', async () => {
    const { context, keeper, vault, rest } = await stage();
    const other = new RevisionNotesBook(context, { keep: false });
    other.start();
    stops.push(() => other.dispose());
    const project = { indexPath: NOVEL_INDEX, folder: 'Novel' };
    expect(other.notesOf(project, OPENING)).toEqual([]);
    await keeper.addNote(OPENING, 'dark night', 'Colder.');
    await rest();
    await other.idle();
    expect(other.notesOf(project, OPENING).map((item) => item.note)).toEqual(['Colder.']);
    expect(vault.has(NOTES)).toBe(true);
  });
});
