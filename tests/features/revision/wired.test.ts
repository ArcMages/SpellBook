// The revision tools on a real project store and memory vault, with the real
// snapshots feature beside them: notes, searching across scenes in English
// and Hebrew, replacing only what is ticked, a snapshot before every
// replace, refusing a scene that changed, and renaming an entity everywhere.

import { afterEach, describe, expect, it } from 'vitest';
import type { Plugin as ObsidianPlugin } from 'obsidian';
import { WordCountCache } from '../../../src/core/wordCountCache';
import { registerFeatures } from '../../../src/features/registry';
import type { FeatureContext, FeatureServices } from '../../../src/features/registry';
import { RevisionKeeper, SNAPSHOTS_SERVICE_NAME, TickedResults, replaceSnapshotName, revisionFeature } from '../../../src/features/revision/index';
import { linksText } from '../../../src/features/revision/reports';
import { SNAPSHOTS_SERVICE, snapshotsFeature } from '../../../src/features/snapshots/index';
import { FakeObsidian } from '../../fakeObsidianApp';
import { MemoryVault } from '../../memoryVault';
import { Menu as StubMenu, Plugin as StubPlugin } from '../../obsidianStub';
import { MemoryDeviceStorage, makeStore } from '../../storeHarness';
import { CLOSING, NIGHT, NOON, NOVEL_INDEX, OPENING, calm, inNovel, novelVault } from '../snapshots/stage';

const ANNA = 'World/Characters/Anna.md';
const plain = { matchCase: false, wholeWords: false, wildcards: false };

function vaultWithWorld(): MemoryVault {
  const vault = novelVault();
  vault.seed(inNovel(ANNA), { frontmatter: { type: 'character', aliases: [] }, body: 'Anna keeps the light.\n' });
  return vault;
}

async function stage(options: { snapshots?: boolean; vault?: MemoryVault } = {}) {
  const vault = options.vault ?? vaultWithWorld();
  const { store, timers } = makeStore(vault);
  const opened = await store.openProject(NOVEL_INDEX);
  if (opened.status !== 'done') throw new Error('the project did not open');
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
  const features = registerFeatures(options.snapshots === false ? [revisionFeature] : [snapshotsFeature, revisionFeature], host);
  const services: FeatureServices = features.services;
  const context: FeatureContext = { ...host, deviceId: 'testdevice', services, addSettingsSection: () => undefined, onUnload: () => undefined };
  const keeper = new RevisionKeeper(context);
  const s = { vault, store, timers, fake, plugin, features, keeper, services };
  stops.push(() => {
    keeper.dispose();
    features.release();
    plugin.unload();
    wordCounts.dispose();
    store.dispose();
  });
  return s;
}

const stops: Array<() => void> = [];
afterEach(() => {
  for (const stop of stops.splice(0)) stop();
});

const snapshotsIn = (vault: MemoryVault): string[] => vault.paths().filter((path) => path.startsWith('Novel/Snapshots/'));

describe('the feature', () => {
  it('adds its four commands, its pane, its ribbon button, its place in the editor and the editor\'s menu', async () => {
    const { plugin, fake } = await stage();
    expect(plugin.commands.map((command) => [command.id, command.name])).toEqual(
      expect.arrayContaining([
        ['add-revision-note', 'Add revision note'],
        ['open-revision', 'Open revision notes'],
        ['find-and-replace', 'Find and replace in the manuscript'],
        ['rename-everywhere', 'Rename everywhere'],
      ]),
    );
    expect(plugin.viewTypes).toContain('spellbook-revision');
    expect(plugin.ribbonIcons.map((icon) => icon.title)).toContain('Open Spellbook revision notes');
    expect(plugin.editorExtensions.length).toBeGreaterThanOrEqual(1);
    expect(fake.workspace.listenerCount('editor-menu')).toBe(1);
    plugin.unload();
    expect(fake.workspace.listenerCount('editor-menu')).toBe(0);
  });

  it('asks the snapshots by the name they offer their actions under', () => {
    expect(SNAPSHOTS_SERVICE_NAME).toBe(SNAPSHOTS_SERVICE);
  });

  it('offers "Add revision note" in the editor\'s menu for words selected in a scene, and only there', async () => {
    const { fake } = await stage();
    const body = 'It was a dark night.';
    const editor = {
      getSelection: () => 'dark night',
      getValue: () => `---\norder: 1\n---\n${body}`,
      getCursor: () => ({ line: 3, ch: 9 }),
      posToOffset: () => 30,
    };
    const inScene = new StubMenu();
    fake.workspace.trigger('editor-menu', inScene, editor, { file: { path: inNovel(OPENING) } });
    expect(inScene.outline).toEqual(['Add revision note']);
    const elsewhere = new StubMenu();
    fake.workspace.trigger('editor-menu', elsewhere, editor, { file: { path: 'Novel/Research/Harbours.md' } });
    expect(elsewhere.outline).toEqual([]);
    const nothingSelected = new StubMenu();
    fake.workspace.trigger('editor-menu', nothingSelected, { ...editor, getSelection: () => '  ' }, { file: { path: inNovel(OPENING) } });
    expect(nothingSelected.outline).toEqual([]);
  });
});

describe('revision notes', () => {
  it('are added to the project\'s revision notes file, changed, ticked done and taken away; the scene is never touched', async () => {
    const { keeper, vault, store } = await stage();
    const before = vault.textOf(inNovel(NIGHT));
    expect(await keeper.addNote(NIGHT, ' מן הנמל! ', 'למה הנמל?')).toBeNull();
    expect(await keeper.addNote(NIGHT, 'הים שקט', '')).toBeNull();
    await store.idle();
    const file = JSON.parse(vault.textOf('Novel/Revision notes.json')) as { scenes: unknown[] };
    expect(file.scenes).toEqual([
      {
        scene: NIGHT,
        notes: [
          { passage: 'מן הנמל!', note: 'למה הנמל?', created: '2026-10-14', done: false },
          { passage: 'הים שקט', note: '', created: '2026-10-14', done: false },
        ],
      },
    ]);
    expect(vault.textOf(inNovel(NIGHT))).toBe(before);
    expect(vault.writes.filter((write) => write.path === inNovel(NIGHT))).toEqual([]);
    let notes = keeper.notesOf(NIGHT);
    expect(await keeper.changeNote(NIGHT, notes[0]!, { done: true })).toBeNull();
    expect(await keeper.changeNote(NIGHT, notes[1]!, { note: 'שקט מדי' })).toBeNull();
    notes = keeper.notesOf(NIGHT);
    expect(notes.map((note) => [note.note, note.done])).toEqual([
      ['למה הנמל?', true],
      ['שקט מדי', false],
    ]);
    expect(keeper.allNotes().map((entry) => entry.scene.path)).toEqual([NIGHT]);
    expect(await keeper.removeNote(NIGHT, notes[0]!)).toBeNull();
    expect(await keeper.removeNote(NIGHT, notes[0]!)).not.toBeNull(); // gone already
    expect(keeper.notesOf(NIGHT).map((note) => note.passage)).toEqual(['הים שקט']);
    expect(vault.textOf(inNovel(NIGHT))).toBe(before);
    expect(vault.writes.some((write) => write.op === 'replaceText')).toBe(false);
  });

  it('are refused for a note that is no scene, and for nothing selected', async () => {
    const { keeper } = await stage();
    expect(await keeper.addNote('Research/Harbours.md', 'harbours', 'x')).not.toBeNull();
    expect(await keeper.addNote(OPENING, '   ', 'x')).not.toBeNull();
  });

  it('say "passage changed" once their words are gone from the text', async () => {
    const { keeper, vault } = await stage();
    await keeper.addNote(OPENING, 'dark night', 'colder');
    await keeper.addNote(OPENING, 'walked alone', 'why?');
    vault.external.write(inNovel(OPENING), { body: vault.bodyOf(inNovel(OPENING)).replace('dark night', 'black night') });
    const text = await keeper.sceneText(OPENING);
    const notes = keeper.notesOf(OPENING);
    const changed = RevisionKeeper.changedPassages(text ?? '', notes);
    expect(notes.filter((note) => changed.has(note.index)).map((note) => note.passage)).toEqual(['dark night']);
  });
});

describe('find and replace across the manuscript', () => {
  it('finds words in every scene, in binder order, in English and in Hebrew, never in the properties', async () => {
    const { keeper } = await stage();
    const found = await keeper.search('the', plain, null);
    expect(found.map((entry) => [entry.scene.path, entry.matches.length])).toEqual([
      [OPENING, 2],
      [CLOSING, 1],
    ]);
    // The synopsis in Opening's properties says "the old town": not found.
    expect((await keeper.search('old town', plain, null)).length).toBe(0);
    expect((await keeper.search('הנמל', { ...plain, wholeWords: true }, null)).map((entry) => entry.scene.path)).toEqual([NIGHT]);
    // With whole words, "הנמל" ("the harbour") is shown for "נמל" ("harbour"), marked as joined: it starts unticked.
    const joined = await keeper.search('נמל', { ...plain, wholeWords: true }, null);
    expect(joined.map((entry) => entry.matches.map((match) => [match.text, match.joined]))).toEqual([[['נמל', true]]]);
    expect((await keeper.search('נמל', plain, null))[0]?.matches.length).toBe(1);
  });

  it('looks in one binder folder when asked', async () => {
    const { keeper } = await stage();
    expect(keeper.folders().map((folder) => folder.name)).toEqual(['Part one']);
    expect((await keeper.search('.', plain, 'f-one')).map((entry) => entry.scene.path)).toEqual([NIGHT]);
  });

  it('replaces only the ticked places, after a snapshot of each scene, and keeps the properties', async () => {
    const { keeper, vault, store } = await stage();
    const found = await keeper.search('was', { ...plain, wholeWords: true }, null);
    const ticked = new TickedResults(found);
    expect(ticked.ticked).toEqual({ changes: 2, scenes: 1 });
    ticked.setTicked(0, 0, false); // "It was a dark night" stays
    const before = vault.textOf(inNovel(OPENING));
    vault.clearWrites();
    const report = await keeper.replace(ticked.plans('is'), replaceSnapshotName('was', 'is'));
    await store.idle();
    expect(report).toEqual({ scenes: 1, changes: 1, problems: [] });
    expect(vault.bodyOf(inNovel(OPENING))).toContain('It was a dark night. The harbour is empty');
    expect(vault.frontmatterOf(inNovel(OPENING))).toMatchObject({ synopsis: 'Anna arrives in the old town.', status: 'First draft', label: 'Blue', order: 1024 });

    // The snapshot came first, and holds the text from before.
    const snapshots = snapshotsIn(vault);
    expect(snapshots).toHaveLength(1);
    const snapshot = snapshots[0] ?? '';
    expect(vault.frontmatterOf(snapshot)?.['name'] ?? JSON.stringify(vault.frontmatterOf(snapshot))).toContain('Before replace: was → is');
    expect(vault.bodyOf(snapshot)).toContain(vault.bodyOf(inNovel(OPENING)).replace('harbour is empty', 'harbour was empty'));
    expect(before).toContain('harbour was empty');
    const created = vault.writes.findIndex((write) => write.op === 'createFile' && write.path === snapshot);
    const replaced = vault.writes.findIndex((write) => write.op === 'replaceText');
    expect(created).toBeGreaterThanOrEqual(0);
    expect(replaced).toBeGreaterThan(created);
    expect(vault.writes.filter((write) => write.op === 'replaceText').map((write) => write.path)).toEqual([inNovel(OPENING)]);
  });

  it('takes one snapshot for every scene it changes, and changes Hebrew as well as English', async () => {
    const { keeper, vault } = await stage();
    const found = await keeper.search('!', plain, null);
    expect(found.map((entry) => entry.scene.path)).toEqual([OPENING, NIGHT]);
    const report = await keeper.replace(new TickedResults(found).plans('.'), replaceSnapshotName('!', '.'));
    expect(report).toEqual({ scenes: 2, changes: 2, problems: [] });
    expect(snapshotsIn(vault)).toHaveLength(2);
    expect(vault.bodyOf(inNovel(NIGHT))).toContain('מן הנמל.');
  });

  it('leaves a scene that changed since the search exactly as it is', async () => {
    const { keeper, vault } = await stage();
    const found = await keeper.search('Anna', plain, null);
    vault.external.write(inNovel(OPENING), { body: vault.bodyOf(inNovel(OPENING)).replace('Chapter One', 'Chapter 1') });
    const changed = vault.textOf(inNovel(OPENING));
    vault.clearWrites();
    const report = await keeper.replace(new TickedResults(found).plans('Dina'), replaceSnapshotName('Anna', 'Dina'));
    expect(report.scenes).toBe(0);
    expect(report.problems.map((problem) => problem.title)).toEqual(['Opening']);
    expect(report.problems[0]?.message).toMatch(/changed since the search/);
    expect(vault.textOf(inNovel(OPENING))).toBe(changed);
    expect(vault.writes.some((write) => write.op === 'replaceText')).toBe(false);
  });

  it('replaces nothing when no snapshot can be taken first', async () => {
    const { keeper, vault } = await stage({ snapshots: false });
    const found = await keeper.search('Anna', plain, null);
    const report = await keeper.replace(new TickedResults(found).plans('Dina'), 'Before replace: Anna → Dina');
    expect(report.scenes).toBe(0);
    expect(report.problems[0]?.message).toMatch(/Snapshots are not available/);
    expect(vault.bodyOf(inNovel(OPENING))).toContain('Anna walked alone');
  });

  it('the store itself refuses a scene whose text is not the one searched, and every note that is no scene', async () => {
    const { store, vault } = await stage();
    const body = vault.bodyOf(inNovel(CLOSING));
    const edit = { from: 0, to: 3, expect: 'The', insert: 'An' };
    const refused = await store.replaceInSceneBody(CLOSING, `${body}x`, [edit]);
    expect(refused.status === 'refused' && refused.reason).toBe('scene-changed');
    const wrongWords = await store.replaceInSceneBody(CLOSING, body, [{ ...edit, expect: 'Thx' }]);
    expect(wrongWords.status === 'refused' && wrongWords.reason).toBe('scene-changed');
    for (const path of ['Research/Harbours.md', 'To-do.md', 'Novel.md', '../Notes/Plain.md']) {
      const result = await store.replaceInSceneBody(path, 'x', [edit]);
      expect(result.status, path).toBe('refused');
    }
    expect(vault.bodyOf(inNovel(CLOSING))).toBe(body);
    const done = await store.replaceInSceneBody(CLOSING, body, [edit]);
    expect(done.status).toBe('done');
    expect(vault.bodyOf(inNovel(CLOSING))).toBe('An end came quietly.\n');
  });
});

describe('rename everywhere', () => {
  it('shows where the old name stands, then renames the note, keeps the old name as another name, and changes the ticked places', async () => {
    const { keeper, vault, store, timers } = await stage();
    expect(keeper.entity(ANNA)).toEqual({ path: ANNA, name: 'Anna', aliases: [] });
    const found = await keeper.findName('Anna');
    expect(found.map((entry) => [entry.scene.path, entry.matches.map((match) => match.text)])).toEqual([[OPENING, ['Anna']]]);
    const report = await keeper.renameEverywhere(ANNA, 'Dina', true, new TickedResults(found).plans('Dina'));
    await calm({ store, timers });
    if (typeof report === 'string') throw new Error(report);
    expect(report.path).toBe('World/Characters/Dina.md');
    expect(report.aliasProblem).toBeNull();
    expect(report.replaced).toEqual({ scenes: 1, changes: 1, problems: [] });
    expect(vault.has(inNovel(ANNA))).toBe(false);
    expect(vault.frontmatterOf(inNovel('World/Characters/Dina.md'))?.['aliases']).toEqual(['Anna']);
    expect(vault.bodyOf(inNovel(OPENING))).toContain('Dina walked alone');
    const snapshots = snapshotsIn(vault);
    expect(snapshots).toHaveLength(1);
    expect(JSON.stringify(vault.frontmatterOf(snapshots[0] ?? ''))).toContain('Before rename: Anna → Dina');
  });

  it('turns down a name that is taken, and changes nothing then', async () => {
    const vault = vaultWithWorld();
    vault.seed(inNovel('World/Characters/Dina.md'), { frontmatter: { type: 'character' }, body: '' });
    const { keeper } = await stage({ vault });
    const found = await keeper.findName('Anna');
    const report = await keeper.renameEverywhere(ANNA, 'Dina', true, new TickedResults(found).plans('Dina'));
    expect(typeof report).toBe('string');
    expect(vault.bodyOf(inNovel(OPENING))).toContain('Anna walked alone');
    expect(snapshotsIn(vault)).toEqual([]);
  });

  it('keeps the old name first, then changes the text, then renames the note and points every link in the project at it, asking the vault nothing', async () => {
    const vault = vaultWithWorld();
    vault.seed(inNovel(CLOSING), { body: 'The end came quietly. [[Anna|She]] smiled. See [[Anna]].\n' });
    vault.seed('Notes/Diary.md', { body: 'Met [[Anna]].' });
    const { keeper, store, timers } = await stage({ vault });
    expect(keeper.linksFromOutside(ANNA)).toEqual(['Notes/Diary.md']);
    const found = await keeper.findName('Anna');
    // The links are not places of the text: they follow the note.
    expect(found.map((entry) => entry.scene.path)).toEqual([OPENING]);
    vault.writes.length = 0;
    const report = await keeper.renameEverywhere(ANNA, 'Dina', true, new TickedResults(found).plans('Dina'));
    await calm({ store, timers });
    if (typeof report === 'string') throw new Error(report);
    expect(report.links).toEqual({ changed: 2, notes: 1, outside: ['Notes/Diary.md'], missed: [] });
    expect(vault.bodyOf(inNovel(CLOSING))).toBe('The end came quietly. [[Dina|She]] smiled. See [[Dina]].\n');
    expect(vault.bodyOf('Notes/Diary.md')).toBe('Met [[Anna]].');
    expect(vault.frontmatterOf(inNovel('World/Characters/Dina.md'))?.['aliases']).toEqual(['Anna']);
    const ops = vault.writes.map((write) => `${write.op} ${write.path}`);
    expect(ops).not.toContain(`rename ${inNovel(ANNA)}`);
    const alias = ops.indexOf(`updateFrontmatter ${inNovel(ANNA)}`);
    const text = ops.indexOf(`replaceText ${inNovel(OPENING)}`);
    const move = ops.indexOf(`moveFile ${inNovel(ANNA)}`);
    const links = ops.indexOf(`updateLinks ${inNovel(CLOSING)}`);
    expect(alias).toBeGreaterThanOrEqual(0);
    expect(alias).toBeLessThan(text);
    expect(text).toBeLessThan(move);
    expect(move).toBeLessThan(links);
  });

  it('says what was done when the note itself cannot be renamed', async () => {
    const { keeper, vault } = await stage();
    const found = await keeper.findName('Anna');
    vault.failNext('moveFile', inNovel(ANNA));
    const report = await keeper.renameEverywhere(ANNA, 'Dina', true, new TickedResults(found).plans('Dina'));
    expect(typeof report).toBe('string');
    expect(report).toMatch(/could not be renamed/);
    expect(report).toMatch(/The text was changed in 1 scene\./);
    expect(report).toMatch(/"Anna" was added to its other names\./);
    expect(vault.has(inNovel(ANNA))).toBe(true);
  });
});

describe('what the writer is told about the links', () => {
  it('counts the links changed, and says why links from outside the project keep the old name', () => {
    expect(linksText({ changed: 0, notes: 0, outside: [], missed: [] })).toBeNull();
    expect(linksText({ changed: 1, notes: 1, outside: [], missed: [] })).toBe('1 link in 1 note now leads to the new name.');
    expect(linksText({ changed: 3, notes: 2, outside: ['a.md', 'b.md'], missed: ['Closing'] })).toBe(
      '3 links in 2 notes now lead to the new name.\nThe links in these notes could not be changed: Closing.\n2 notes outside the project link to it, and those links keep the old name: links are changed in this project only. ' +
        'To change them too, choose "The whole vault" under "When a note is renamed, update links in" in Spellbook\'s settings.',
    );
  });
});

describe('review: long changes that something gets in the way of', () => {
  it('a rename everywhere keeps to the project it began in, when another project is opened half way', async () => {
    const vault = vaultWithWorld();
    vault.seed('Second/Second.md', { frontmatter: { spellbook: 'project', version: 1, title: 'Second', binder: [] }, body: '' });
    vault.seed(`Second/${ANNA}`, { frontmatter: { type: 'character' }, body: 'The other Anna.\n' });
    const { keeper, store, timers } = await stage({ vault });
    const found = await keeper.findName('Anna');
    const renaming = keeper.renameEverywhere(ANNA, 'Dina', true, new TickedResults(found).plans('Dina'));
    const opening = store.openProject('Second/Second.md');
    const report = await renaming;
    expect((await opening).status).toBe('done');
    await calm({ store, timers });
    // The other project's Anna is not touched.
    expect(vault.has(`Second/${ANNA}`)).toBe(true);
    expect(vault.has('Second/World/Characters/Dina.md')).toBe(false);
    expect(typeof report).toBe('string');
  });

  it('a snapshot that fails by throwing leaves that scene alone, says so, and goes on with the others', async () => {
    const { keeper, vault, services } = await stage({ snapshots: false });
    let calls = 0;
    services.provide(SNAPSHOTS_SERVICE_NAME, {
      takeNamed: async () => {
        calls++;
        if (calls === 1) throw new Error('the disk is full');
        return null;
      },
    });
    const found = await keeper.search('dark', plain, null);
    const found2 = await keeper.search('end', plain, null);
    const plans = [...new TickedResults(found).plans('light'), ...new TickedResults(found2).plans('start')];
    expect(plans.length).toBe(2);
    const report = await keeper.replace(plans, 'test');
    expect(report.scenes).toBe(1);
    expect(report.problems).toHaveLength(1);
    expect(report.problems[0]?.message).toContain('the disk is full');
    expect(vault.bodyOf(inNovel(OPENING))).toContain('dark');
  });
});
