// Project store: what the screens keep in a project besides the binder.
//
//   - keys of their own in the index note (statuses, labels, targets, marks,
//     timelines),
//   - properties on the project's notes,
//   - the plugin's own two kinds of file: To-do.md and the word logs in Stats.
//
// The promise checked hardest here: the text of a scene, or of any note the
// writer writes in, cannot be written through any of it.

import { describe, expect, it } from 'vitest';
import { RESERVED_INDEX_KEYS, STATS_FOLDER, TIMELINE_FOLDER, TODO_FILE } from '../src/core/projectStore';
import { MemoryVault } from './memoryVault';
import {
  INDEX_BODY,
  binderOnDisk,
  makeStore,
  openSeeded,
  picture,
  sceneBody,
  seedProject,
  settle,
  valueOf,
} from './storeHarness';

const INDEX = 'Novel/Novel.md';
const scenes = { scenes: { A: 1024, B: 2048 } };

/** A project with some data of its own in the index, a to-do list, a word log and a timeline event. */
function furnished(): MemoryVault {
  return new MemoryVault()
    .seed('Novel/To-do.md', { body: '- [ ] write chapter one\n' })
    .seed('Novel/Stats/2026-10 ab12cd34ef.md', { body: '2026-10-12 250 300\n' })
    .seed('Novel/Timeline/The fire.md', { frontmatter: { date: '1890-03-01', timelines: ['Town'] }, body: 'What happened.' })
    .seed('Novel/Research/Trains.md', { body: 'facts' });
}

const withData = { ...scenes, extra: { targets: { project: 80000 }, labels: ['Plot', 'Mood'] } };

describe('projectData', () => {
  it('gives the value of a key of the index note, and undefined for one that is not there', async () => {
    const { store } = await openSeeded(withData);
    expect(store.projectData('targets')).toEqual({ project: 80000 });
    expect(store.projectData('labels')).toEqual(['Plot', 'Mood']);
    expect(store.projectData('marks')).toBeUndefined();
    expect(store.projectData('toString')).toBeUndefined(); // not a key of the note
    expect(store.projectData('__proto__')).toBeUndefined();
  });

  it("keeps the store's own keys to the store", async () => {
    const { store } = await openSeeded(withData);
    expect([...RESERVED_INDEX_KEYS]).toEqual(['spellbook', 'version', 'title', 'binder']);
    for (const key of [...RESERVED_INDEX_KEYS, 'Binder', ' title ']) expect(store.projectData(key), key).toBeUndefined();
  });

  it('is undefined when no project is open', () => {
    const { store } = makeStore(new MemoryVault());
    expect(store.projectData('targets')).toBeUndefined();
  });

  it('cannot be changed by whoever reads it', async () => {
    const { store, vault } = await openSeeded(withData);
    const targets = store.projectData('targets') as { project: number };
    expect(() => {
      targets.project = 1;
    }).toThrow();
    expect(() => {
      (store.projectData('labels') as string[]).push('Mine');
    }).toThrow();
    expect(store.projectData('targets')).toEqual({ project: 80000 });
    expect(vault.writes).toEqual([]);
  });

  it('follows the index when another device changes it, and says that the project changed', async () => {
    const { store, vault, changes } = await openSeeded(withData);
    vault.external.editFrontmatter(INDEX, (frontmatter) => {
      frontmatter['marks'] = { '2026-10-13': { color: 'red', label: 'Deadline' } };
    });
    await settle(store);
    expect(store.projectData('marks')).toEqual({ '2026-10-13': { color: 'red', label: 'Deadline' } });
    expect(changes).toContainEqual({ type: 'project' });
    expect(vault.writes).toEqual([]);
  });

  it('can still be read while the index cannot be understood', async () => {
    const vault = new MemoryVault();
    seedProject(vault, { binder: { not: 'a list' }, scenes: { A: 1024 }, extra: { targets: { project: 5 } } });
    const { store } = makeStore(vault);
    valueOf(await store.openProject(INDEX));
    expect(store.project?.readOnly).toBe(true);
    expect(store.projectData('targets')).toEqual({ project: 5 });
  });
});

describe('updateProjectData', () => {
  it('writes one key in one write of the index, and leaves everything else exactly as it was', async () => {
    const { store, vault, changes } = await openSeeded(withData);
    const before = vault.frontmatterOf(INDEX);

    const result = await store.updateProjectData('targets', (current) => ({ ...(current as object), session: 500 }));

    expect(result).toEqual({ status: 'done', value: undefined });
    expect(vault.writes).toEqual([{ op: 'updateFrontmatter', path: INDEX }]);
    expect(vault.frontmatterOf(INDEX)).toEqual({ ...before, targets: { project: 80000, session: 500 } });
    expect(vault.bodyOf(INDEX)).toBe(INDEX_BODY); // the note's own text is never touched
    expect(store.projectData('targets')).toEqual({ project: 80000, session: 500 });
    expect(picture(store)).toBe('A B');
    expect(changes).toEqual([{ type: 'project' }]); // told once
  });

  it('adds a key that was not there, with undefined as what it was', async () => {
    const { store, vault } = await openSeeded(scenes);
    const seen: unknown[] = [];
    valueOf(
      await store.updateProjectData('statuses', (current) => {
        seen.push(current);
        return ['To do', 'Done'];
      }),
    );
    expect(seen).toEqual([undefined]);
    expect(vault.frontmatterOf(INDEX)?.['statuses']).toEqual(['To do', 'Done']);
    expect(binderOnDisk(vault, INDEX)).toEqual(['Manuscript/A.md', 'Manuscript/B.md']);
  });

  it('removes the key when the change returns undefined', async () => {
    const { store, vault } = await openSeeded(withData);
    valueOf(await store.updateProjectData('targets', () => undefined));
    const after = vault.frontmatterOf(INDEX) ?? {};
    expect('targets' in after).toBe(false);
    expect(after['labels']).toEqual(['Plot', 'Mood']);
    expect(store.projectData('targets')).toBeUndefined();
    // Removing what is not there changes nothing.
    vault.clearWrites();
    expect(await store.updateProjectData('targets', () => undefined)).toMatchObject({ status: 'noop', reason: 'unchanged' });
    expect(vault.writes).toEqual([]);
  });

  it('works on the index as it is on disk at that moment, not on what was last read', async () => {
    const { store, vault } = await openSeeded(withData);
    // Another device has just changed the targets and the binder; this one has not heard.
    vault.external.editFrontmatter(INDEX, (frontmatter) => {
      frontmatter['targets'] = { project: 90000 };
      frontmatter['binder'] = ['Manuscript/B.md', 'Manuscript/A.md'];
      frontmatter['marks'] = { '2026-10-13': { label: 'x' } };
    }, { silent: true });

    valueOf(await store.updateProjectData('targets', (current) => ({ ...(current as object), session: 500 })));

    expect(vault.frontmatterOf(INDEX)?.['targets']).toEqual({ project: 90000, session: 500 });
    // What the other device did is all still there.
    expect(binderOnDisk(vault, INDEX)).toEqual(['Manuscript/B.md', 'Manuscript/A.md']);
    expect(vault.frontmatterOf(INDEX)?.['marks']).toEqual({ '2026-10-13': { label: 'x' } });
    expect(picture(store)).toBe('B A');
  });

  it('writes nothing when the value comes out the same', async () => {
    const { store, vault, changes } = await openSeeded(withData);
    expect(await store.updateProjectData('labels', (current) => current)).toMatchObject({ status: 'noop', reason: 'unchanged' });
    expect(await store.updateProjectData('labels', () => ['Plot', 'Mood'])).toMatchObject({ status: 'noop' });
    expect(vault.writes).toEqual([]);
    expect(changes).toEqual([]);
  });

  it('hands the change a copy: fiddling with it writes nothing unless it is returned', async () => {
    const { store, vault } = await openSeeded(withData);
    await store.updateProjectData('targets', (current) => {
      (current as { project: number }).project = 1;
      return undefined; // remove, as asked: but the copy's edit must not have leaked anywhere first
    });
    expect('targets' in (vault.frontmatterOf(INDEX) ?? {})).toBe(false);
    const kept: { list: string[] } = { list: ['a'] };
    valueOf(await store.updateProjectData('timelines', () => kept));
    kept.list.push('changed afterwards');
    await settle(store);
    expect(store.projectData('timelines')).toEqual({ list: ['a'] });
  });

  it("refuses the store's own keys, whatever the capitals, and anything that is not a name", async () => {
    const { store, vault } = await openSeeded(withData);
    const before = vault.frontmatterOf(INDEX);
    for (const key of ['spellbook', 'version', 'title', 'binder', 'Binder', 'TITLE', '', '  ', ' targets']) {
      const result = await store.updateProjectData(key, () => 'hijacked');
      expect(result, JSON.stringify(key)).toMatchObject({ status: 'refused', reason: 'invalid-key' });
    }
    expect(vault.writes).toEqual([]);
    expect(vault.frontmatterOf(INDEX)).toEqual(before);
  });

  it('refuses a read-only project, and when no project is open', async () => {
    const vault = new MemoryVault();
    seedProject(vault, { binder: { not: 'a list' }, scenes: { A: 1024 } });
    const { store } = makeStore(vault);
    expect(await store.updateProjectData('targets', () => 1)).toMatchObject({ status: 'refused', reason: 'no-project' });
    valueOf(await store.openProject(INDEX));
    vault.clearWrites();
    expect(await store.updateProjectData('targets', () => 1)).toMatchObject({ status: 'refused', reason: 'read-only' });
    expect(vault.writes).toEqual([]);
  });

  it('refuses when the index turned unreadable on disk a moment ago', async () => {
    const { store, vault } = await openSeeded(withData);
    vault.external.editFrontmatter(INDEX, (frontmatter) => {
      frontmatter['binder'] = 'not a list';
    }, { silent: true });
    expect(await store.updateProjectData('targets', () => 1)).toMatchObject({ status: 'refused', reason: 'read-only' });
    expect(vault.writes).toEqual([]);
  });

  it('is refused when another project was opened in the meantime', async () => {
    const vault = new MemoryVault();
    seedProject(vault, { folder: 'Other', title: 'Other Book', scenes: { Elsewhere: 1024 } });
    const { store } = await openSeeded(withData, vault);
    const waiting = store.updateProjectData('targets', () => 1, 'Other/Other.md');
    expect(await waiting).toMatchObject({ status: 'refused', reason: 'other-project' });
    expect(vault.writes).toEqual([]);
  });

  it('takes its turn in the queue: two changes in a row both land', async () => {
    const { store, vault } = await openSeeded(scenes);
    const first = store.updateProjectData('marks', (current) => ({ ...(current as object | undefined), a: 1 }));
    const second = store.updateProjectData('marks', (current) => ({ ...(current as object | undefined), b: 2 }));
    const moved = store.moveNode({ kind: 'scene', path: 'Manuscript/B.md' }, { at: 'start', parentId: null });
    await Promise.all([first, second, moved]);
    expect(vault.frontmatterOf(INDEX)?.['marks']).toEqual({ a: 1, b: 2 });
    expect(binderOnDisk(vault, INDEX)).toEqual(['Manuscript/B.md', 'Manuscript/A.md']);
  });

  it('says so when the index could not be saved, and changes nothing', async () => {
    const { store, vault } = await openSeeded(withData);
    vault.failNext('updateFrontmatter', INDEX);
    const result = await store.updateProjectData('targets', () => 1);
    expect(result.status).toBe('failed');
    expect(vault.frontmatterOf(INDEX)?.['targets']).toEqual({ project: 80000 });
  });
});

describe('updateNoteProperties', () => {
  it("changes a scene's properties in one write of that note, and never its text", async () => {
    const { store, vault } = await openSeeded(scenes, furnished());
    const result = await store.updateNoteProperties('Manuscript/A.md', (frontmatter) => {
      frontmatter['status'] = 'Revised';
      frontmatter['synopsis'] = 'She leaves.';
      return true;
    });
    expect(result).toEqual({ status: 'done', value: undefined });
    expect(vault.writes).toEqual([{ op: 'updateFrontmatter', path: 'Novel/Manuscript/A.md' }]);
    expect(vault.frontmatterOf('Novel/Manuscript/A.md')).toEqual({ status: 'Revised', order: 1024, synopsis: 'She leaves.' });
    expect(vault.bodyOf('Novel/Manuscript/A.md')).toBe(sceneBody('A'));
  });

  it('sees the properties as they are on disk at that moment', async () => {
    const { store, vault } = await openSeeded(scenes);
    vault.holdMetadata();
    vault.external.editFrontmatter('Novel/Manuscript/A.md', (frontmatter) => {
      frontmatter['label'] = 'Plot';
    }, { silent: true });
    valueOf(
      await store.updateNoteProperties('Manuscript/A.md', (frontmatter) => {
        frontmatter['status'] = 'Final';
        return true;
      }),
    );
    expect(vault.frontmatterOf('Novel/Manuscript/A.md')).toMatchObject({ label: 'Plot', status: 'Final' });
  });

  it('writes nothing when the change says no', async () => {
    const { store, vault } = await openSeeded(scenes);
    const result = await store.updateNoteProperties('Manuscript/A.md', (frontmatter) => {
      frontmatter['status'] = 'tampered';
      return false;
    });
    expect(result).toMatchObject({ status: 'noop', reason: 'unchanged' });
    expect(vault.writes).toEqual([]);
    expect(vault.frontmatterOf('Novel/Manuscript/A.md')?.['status']).toBe('To do');
  });

  it('works for any note of the project: a timeline event, a research note', async () => {
    const { store, vault } = await openSeeded(scenes, furnished());
    valueOf(
      await store.updateNoteProperties('Timeline/The fire.md', (frontmatter) => {
        frontmatter['date'] = '1890-03-02';
        return true;
      }),
    );
    expect(vault.frontmatterOf('Novel/Timeline/The fire.md')).toEqual({ date: '1890-03-02', timelines: ['Town'] });
    expect(vault.bodyOf('Novel/Timeline/The fire.md')).toBe('What happened.');
  });

  it('refuses everything that is not a note inside the open project', async () => {
    const vault = furnished().seed('Elsewhere/Note.md', { frontmatter: { mine: true }, body: 'not yours' });
    vault.seed('Novel/Novel 2.md', { frontmatter: { spellbook: 'project', version: 1, binder: [] } });
    seedProject(vault, { folder: 'Other', title: 'Other Book', scenes: { Elsewhere: 1024 } });
    const { store } = await openSeeded(scenes, vault);
    const touch = (frontmatter: Record<string, unknown>): boolean => {
      frontmatter['touched'] = true;
      return true;
    };
    for (const path of [
      '../Elsewhere/Note.md',
      '/Elsewhere/Note.md',
      'Manuscript/../../Elsewhere/Note.md',
      '../Other/Manuscript/Elsewhere.md',
      'Novel.md', // the index note itself
      'Novel 2.md', // a conflicting copy of it
      'Manuscript/cover.png',
      'Stats/2026-10 ab12cd34ef.txt',
      '',
    ]) {
      const result = await store.updateNoteProperties(path, touch);
      expect(result, path).toMatchObject({ status: 'refused', reason: 'invalid-path' });
    }
    expect(await store.updateNoteProperties('Manuscript/Never.md', touch)).toMatchObject({ status: 'refused', reason: 'missing-file' });
    expect(vault.writes).toEqual([]);
    expect(vault.frontmatterOf('Elsewhere/Note.md')).toEqual({ mine: true });
  });

  it('refuses a read-only project, no project, and another project than the one it was meant for', async () => {
    const vault = new MemoryVault();
    seedProject(vault, { binder: { not: 'a list' }, scenes: { A: 1024 } });
    const { store } = makeStore(vault);
    expect(await store.updateNoteProperties('Manuscript/A.md', () => true)).toMatchObject({ status: 'refused', reason: 'no-project' });
    valueOf(await store.openProject(INDEX));
    expect(await store.updateNoteProperties('Manuscript/A.md', () => true)).toMatchObject({ status: 'refused', reason: 'read-only' });
    const other = await openSeeded(scenes);
    expect(await other.store.updateNoteProperties('Manuscript/A.md', () => true, 'Other/Other.md')).toMatchObject({
      status: 'refused',
      reason: 'other-project',
    });
    expect(other.vault.writes).toEqual([]);
  });

  it('says so when the note could not be saved', async () => {
    const { store, vault } = await openSeeded(scenes);
    vault.failNext('updateFrontmatter', 'Novel/Manuscript/A.md');
    expect((await store.updateNoteProperties('Manuscript/A.md', () => true)).status).toBe('failed');
  });
});

describe("updateDataFile: the plugin's own files", () => {
  it('changes To-do.md in one step, against the text as it is on disk at that moment', async () => {
    const { store, vault } = await openSeeded(scenes, furnished());
    vault.external.write('Novel/To-do.md', { body: '- [x] write chapter one\n' }, { silent: true });
    const result = await store.updateDataFile(TODO_FILE, (current) => `${current ?? ''}- [ ] write chapter two\n`);
    expect(result).toEqual({ status: 'done', value: { created: false } });
    expect(vault.textOf('Novel/To-do.md')).toBe('- [x] write chapter one\n- [ ] write chapter two\n');
    expect(vault.writes).toEqual([{ op: 'updateText', path: 'Novel/To-do.md' }]);
  });

  it('creates the file when it is not there yet, and the Stats folder with it', async () => {
    const { store, vault } = await openSeeded(scenes);
    expect(vault.has('Novel/Stats')).toBe(false);
    const seen: Array<string | null> = [];
    const result = await store.updateDataFile(`${STATS_FOLDER}/2026-10 ab12cd34ef.md`, (current) => {
      seen.push(current);
      return '2026-10-13 120 120\n';
    });
    expect(result).toEqual({ status: 'done', value: { created: true } });
    expect(seen).toEqual([null]);
    expect(vault.textOf('Novel/Stats/2026-10 ab12cd34ef.md')).toBe('2026-10-13 120 120\n');
    expect(vault.writes).toEqual([
      { op: 'createFolder', path: 'Novel/Stats' },
      { op: 'updateText', path: 'Novel/Stats/2026-10 ab12cd34ef.md' },
    ]);

    valueOf(await store.updateDataFile('To-do.md', () => '- [ ] first\n'));
    expect(vault.textOf('Novel/To-do.md')).toBe('- [ ] first\n');
  });

  it('keeps a properties block in a word log exactly as it was written', async () => {
    const { store, vault } = await openSeeded(scenes, furnished());
    const text = '---\ndeviceName: "Phone"\n---\n2026-10-13 5 5\n';
    valueOf(await store.updateDataFile('Stats/2026-10 phone.md', () => text));
    expect(valueOf(await store.readDataFile('Stats/2026-10 phone.md'))).toBe(text);
  });

  it('writes nothing when the change gives null or the same text', async () => {
    const { store, vault } = await openSeeded(scenes, furnished());
    expect(await store.updateDataFile('To-do.md', () => null)).toMatchObject({ status: 'noop', reason: 'unchanged' });
    expect(await store.updateDataFile('To-do.md', (current) => current)).toMatchObject({ status: 'noop' });
    expect(await store.updateDataFile('Stats/new.md', () => null)).toMatchObject({ status: 'noop' });
    expect(vault.has('Novel/Stats/new.md')).toBe(false);
    expect(vault.writes).toEqual([]);
  });

  it("REFUSES every other path: a scene's or a note's text cannot be written", async () => {
    const vault = furnished().seed('Elsewhere/To-do.md', { body: 'not yours' });
    vault.seed('Novel/Stats/Deep/inside.md', { body: 'in a folder of its own' });
    vault.seed('Novel/Manuscript/Loose.md', { body: 'an unfiled scene' });
    const { store } = await openSeeded(scenes, vault);
    const before = new Map(vault.paths().map((path) => [path, vault.textOf(path)]));

    for (const path of [
      'Manuscript/A.md', // a scene
      'Manuscript/Loose.md', // a manuscript note the binder does not list
      'Manuscript/New.md', // a scene that does not exist yet
      'Research/Trains.md',
      'Timeline/The fire.md',
      'Novel.md', // the project index
      'Notes.md',
      'to-do.md', // only the plugin's own spelling
      'To-do.txt',
      'Manuscript/To-do.md',
      'Stats/Deep/inside.md', // not directly inside Stats
      'Stats', // the folder itself
      'Stats/',
      'stats/2026-10.md',
      'Statsx/2026-10.md',
      'Stats/../Manuscript/A.md',
      'Stats/../../Elsewhere/To-do.md',
      '../Elsewhere/To-do.md',
      '/Novel/To-do.md',
      'Stats\\2026-10.md',
      '',
      '.',
    ]) {
      const written = await store.updateDataFile(path, () => 'REPLACED');
      expect(written, `write ${JSON.stringify(path)}`).toMatchObject({ status: 'refused', reason: 'invalid-path' });
      const read = await store.readDataFile(path);
      expect(read, `read ${JSON.stringify(path)}`).toMatchObject({ status: 'refused', reason: 'invalid-path' });
    }

    expect(vault.writes).toEqual([]);
    expect(new Map(vault.paths().map((path) => [path, vault.textOf(path)]))).toEqual(before);
    expect(vault.bodyOf('Novel/Manuscript/A.md')).toBe(sceneBody('A'));
  });

  it('refuses a file in Stats, or To-do.md, that the binder lists as a scene', async () => {
    // A writer can file any note of the project as a scene. Its text is then the writer's.
    const vault = furnished().seed('Novel/Stats/A chapter.md', { body: 'Prose.' });
    const { store } = await openSeeded(
      { binder: ['Manuscript/A.md', 'Stats/A chapter.md', 'To-do.md'], scenes: { A: 1024 } },
      vault,
    );
    for (const path of ['Stats/A chapter.md', 'Stats/a CHAPTER.md', 'To-do.md']) {
      expect(await store.updateDataFile(path, () => 'REPLACED'), path).toMatchObject({ status: 'refused', reason: 'invalid-path' });
    }
    expect(vault.bodyOf('Novel/Stats/A chapter.md')).toBe('Prose.');
    expect(vault.writes).toEqual([]);
    // The word log next to it is still the plugin's own.
    expect((await store.updateDataFile('Stats/2026-10 ab12cd34ef.md', () => 'x')).status).toBe('done');
  });

  it('refuses a read-only project, no project, and another project than the one it was meant for', async () => {
    const vault = furnished();
    seedProject(vault, { binder: { not: 'a list' }, scenes: { A: 1024 } });
    const { store } = makeStore(vault);
    expect(await store.updateDataFile('To-do.md', () => 'x')).toMatchObject({ status: 'refused', reason: 'no-project' });
    expect(await store.readDataFile('To-do.md')).toMatchObject({ status: 'refused', reason: 'no-project' });
    valueOf(await store.openProject(INDEX));
    expect(await store.updateDataFile('To-do.md', () => 'x')).toMatchObject({ status: 'refused', reason: 'read-only' });
    expect(valueOf(await store.readDataFile('To-do.md'))).toBe('- [ ] write chapter one\n'); // reading is still fine

    const other = await openSeeded(scenes, furnished());
    expect(await other.store.updateDataFile('To-do.md', () => 'x', 'Other/Other.md')).toMatchObject({
      status: 'refused',
      reason: 'other-project',
    });
    expect(other.vault.writes).toEqual([]);
    expect(vault.writes).toEqual([]);
  });

  it('says so when the file could not be saved, and leaves it as it was', async () => {
    const { store, vault } = await openSeeded(scenes, furnished());
    vault.failNext('updateText', 'Novel/To-do.md');
    const result = await store.updateDataFile('To-do.md', () => 'new text');
    expect(result.status).toBe('failed');
    expect(vault.textOf('Novel/To-do.md')).toBe('- [ ] write chapter one\n');
  });

  it('follows the project when its folder is renamed', async () => {
    const { store, vault } = await openSeeded(scenes, furnished());
    vault.external.rename('Novel', 'Saga');
    await settle(store);
    valueOf(await store.updateDataFile('To-do.md', (current) => `${current ?? ''}- [ ] more\n`));
    expect(vault.textOf('Saga/To-do.md')).toBe('- [ ] write chapter one\n- [ ] more\n');
  });
});

describe('updateStatsFile: the word log of a project named by its index', () => {
  const SECOND = 'Second/Second.md';
  const LOG = 'Stats/2026-10 ab12cd34ef.md';

  /** The furnished novel, open, with a second project next to it that is not. */
  async function twoProjects(second: Parameters<typeof seedProject>[1] = {}): Promise<Awaited<ReturnType<typeof openSeeded>>> {
    const vault = furnished()
      .seed('Second/To-do.md', { body: '- [ ] theirs\n' })
      .seed('Second/Research/Maps.md', { body: 'facts of the second book' });
    seedProject(vault, { folder: 'Second', title: 'Second Book', scenes: { Start: 1024 }, ...second });
    const opened = await openSeeded(scenes, vault);
    vault.clearWrites();
    return opened;
  }

  it('writes a word log of a project that is not open, creating its Stats folder when it has none', async () => {
    const { store, vault } = await twoProjects();
    expect(store.project?.indexPath).toBe(INDEX);
    const seen: Array<string | null> = [];
    const result = await store.updateStatsFile(SECOND, LOG, (current) => {
      seen.push(current);
      return '2026-10-13 3 0\n';
    });
    expect(valueOf(result)).toEqual({ created: true });
    expect(seen).toEqual([null]);
    expect(vault.textOf(`Second/${LOG}`)).toBe('2026-10-13 3 0\n');
    expect(vault.writes).toEqual([
      { op: 'createFolder', path: 'Second/Stats' },
      { op: 'updateText', path: `Second/${LOG}` },
    ]);
    // The open project is still the open one, and its own log of the same name is untouched.
    expect(store.project?.indexPath).toBe(INDEX);
    expect(vault.textOf(`Novel/${LOG}`)).toBe('2026-10-12 250 300\n');

    // Again: against the text as it is on disk then.
    valueOf(await store.updateStatsFile(SECOND, LOG, (current) => `${current ?? ''}2026-10-14 5 0\n`));
    expect(vault.textOf(`Second/${LOG}`)).toBe('2026-10-13 3 0\n2026-10-14 5 0\n');
    expect(await store.updateStatsFile(SECOND, LOG, () => null)).toMatchObject({ status: 'noop', reason: 'unchanged' });
  });

  it('writes the open project\'s log too, exactly as updateDataFile does', async () => {
    const { store, vault } = await twoProjects();
    valueOf(await store.updateStatsFile(INDEX, LOG, (current) => `${current ?? ''}2026-10-13 9 0\n`));
    expect(vault.textOf(`Novel/${LOG}`)).toBe('2026-10-12 250 300\n2026-10-13 9 0\n');
    expect(vault.writes).toEqual([{ op: 'updateText', path: `Novel/${LOG}` }]);
  });

  it("REFUSES everything that is not a file directly inside that project's Stats folder, To-do.md included", async () => {
    const { store, vault } = await twoProjects();
    vault.seed('Second/Stats/Deep/inside.md', { body: 'in a folder of its own' });
    const before = new Map(vault.paths().map((path) => [path, vault.textOf(path)]));
    for (const index of [SECOND, INDEX]) {
      for (const path of [
        'To-do.md', // the to-do list is only ever written for the open project, through updateDataFile
        'Manuscript/Start.md',
        'Manuscript/A.md',
        'Manuscript/New.md',
        'Research/Maps.md',
        'Second.md',
        'Novel.md',
        'Stats/Deep/inside.md',
        'Stats',
        'Stats/',
        'stats/2026-10.md',
        'Stats/../Manuscript/Start.md',
        'Stats/../../Novel/To-do.md',
        '../Novel/Stats/2026-10 ab12cd34ef.md',
        '/Second/Stats/x.md',
        'Stats\\2026-10.md',
        '',
        '.',
      ]) {
        const written = await store.updateStatsFile(index, path, () => 'REPLACED');
        expect(written, `${index}: ${JSON.stringify(path)}`).toMatchObject({ status: 'refused', reason: 'invalid-path' });
      }
    }
    expect(vault.writes).toEqual([]);
    expect(new Map(vault.paths().map((path) => [path, vault.textOf(path)]))).toEqual(before);
  });

  it('refuses a file in Stats that the project\'s binder lists as a scene, going by its index as it is on disk', async () => {
    const { store, vault } = await twoProjects();
    vault.seed('Second/Stats/A chapter.md', { body: 'Prose.' });
    // Filed as a scene on another device, a moment ago: the store has not read this index since it started.
    vault.external.editFrontmatter(SECOND, (frontmatter) => {
      frontmatter['binder'] = ['Manuscript/Start.md', 'Stats/A chapter.md'];
    });
    vault.clearWrites();
    for (const path of ['Stats/A chapter.md', 'Stats/a CHAPTER.md']) {
      expect(await store.updateStatsFile(SECOND, path, () => 'REPLACED'), path).toMatchObject({
        status: 'refused',
        reason: 'invalid-path',
      });
    }
    expect(vault.bodyOf('Second/Stats/A chapter.md')).toBe('Prose.');
    expect(vault.writes).toEqual([]);
    expect((await store.updateStatsFile(SECOND, LOG, () => 'x')).status).toBe('done');
  });

  it('refuses a project whose index cannot be understood, one that is gone, and a note that is no project', async () => {
    const { store, vault } = await twoProjects({ binder: { not: 'a list' } });
    expect(await store.updateStatsFile(SECOND, LOG, () => 'x')).toMatchObject({ status: 'refused', reason: 'read-only' });
    for (const index of ['Ghost/Ghost.md', 'Novel/Research/Trains.md', 'Second/To-do.md', '', '../Second/Second.md']) {
      expect(await store.updateStatsFile(index, LOG, () => 'x'), index).toMatchObject({ status: 'refused', reason: 'not-a-project' });
    }
    // No longer marked as a project on disk, though the store has not caught up yet.
    vault.external.editFrontmatter(SECOND, (frontmatter) => {
      delete frontmatter['spellbook'];
    });
    vault.clearWrites();
    expect(await store.updateStatsFile(SECOND, LOG, () => 'x')).toMatchObject({ status: 'refused', reason: 'not-a-project' });
    expect(vault.writes).toEqual([]);
    expect(vault.hasFolder('Second/Stats')).toBe(false);

    // The open project, read-only: refused as for updateDataFile.
    const broken = furnished();
    seedProject(broken, { binder: { not: 'a list' }, scenes: { A: 1024 } });
    const other = makeStore(broken);
    valueOf(await other.store.openProject(INDEX));
    expect(await other.store.updateStatsFile(INDEX, LOG, () => 'x')).toMatchObject({ status: 'refused', reason: 'read-only' });
    expect(broken.writes).toEqual([]);
  });

  it('never writes into a conflicting copy of an index, and says so when the file could not be saved', async () => {
    const { store, vault } = await twoProjects();
    vault.external.create('Second/Second (conflicted copy).md', {
      frontmatter: { spellbook: 'project', version: 1, title: 'Second Book', binder: [] },
    });
    await settle(store);
    vault.clearWrites();
    expect(store.mainIndexOf('Second/Second (conflicted copy).md')).toBe(SECOND);
    expect(await store.updateStatsFile('Second/Second (conflicted copy).md', LOG, () => 'x')).toMatchObject({
      status: 'refused',
      reason: 'not-a-project',
    });
    expect(vault.writes).toEqual([]);
    vault.failNext('updateText', `Second/${LOG}`);
    expect((await store.updateStatsFile(SECOND, LOG, () => 'new text')).status).toBe('failed');
    expect(vault.has(`Second/${LOG}`)).toBe(false);
  });
});

describe('readDataFile', () => {
  it('gives the whole text of To-do.md and of a word log, and null for one that is not there', async () => {
    const { store, vault } = await openSeeded(scenes, furnished());
    expect(await store.readDataFile('To-do.md')).toEqual({ status: 'done', value: '- [ ] write chapter one\n' });
    expect(valueOf(await store.readDataFile('Stats/2026-10 ab12cd34ef.md'))).toBe('2026-10-12 250 300\n');
    expect(valueOf(await store.readDataFile('Stats/2026-11 ab12cd34ef.md'))).toBeNull();
    expect(vault.writes).toEqual([]);
  });
});

describe('listing what a project holds', () => {
  it('lists the files directly inside Stats, as paths inside the project', async () => {
    const vault = furnished()
      .seed('Novel/Stats/2026-09 ab12cd34ef.md', { body: '' })
      .seed('Novel/Stats/2026-10 zz99.json', { body: '{}' })
      .seed('Novel/Stats/Old/2025-01.md', { body: '' });
    const { store } = await openSeeded(scenes, vault);
    expect(store.statsFiles()).toEqual([
      'Stats/2026-09 ab12cd34ef.md',
      'Stats/2026-10 ab12cd34ef.md',
      'Stats/2026-10 zz99.json',
    ]);
    expect(STATS_FOLDER).toBe('Stats');
  });

  it('lists none when there is no Stats folder, or no project', async () => {
    const { store } = await openSeeded(scenes);
    expect(store.statsFiles()).toEqual([]);
    expect(makeStore(new MemoryVault()).store.statsFiles()).toEqual([]);
  });

  it('lists the notes of the Timeline folder with their properties', async () => {
    const vault = furnished()
      .seed('Novel/Timeline/A wedding.md', { frontmatter: { date: '1889-06-01' } })
      .seed('Novel/Timeline/No date.md', { body: 'just text' })
      .seed('Novel/Timeline/map.png');
    const { store } = await openSeeded(scenes, vault);
    expect(store.timelineNotes()).toEqual([
      { path: 'Timeline/A wedding.md', frontmatter: { date: '1889-06-01' } },
      { path: 'Timeline/No date.md', frontmatter: null },
      { path: 'Timeline/The fire.md', frontmatter: { date: '1890-03-01', timelines: ['Town'] } },
    ]);
    expect(TIMELINE_FOLDER).toBe('Timeline');
    expect(makeStore(new MemoryVault()).store.timelineNotes()).toEqual([]);
  });

  it('follows the vault: a new event is listed, a deleted one is not', async () => {
    const { store, vault } = await openSeeded(scenes, furnished());
    vault.external.create('Novel/Timeline/A flood.md', { frontmatter: { date: '1891-01-01' } });
    vault.external.delete('Novel/Timeline/The fire.md');
    expect(store.timelineNotes()).toEqual([{ path: 'Timeline/A flood.md', frontmatter: { date: '1891-01-01' } }]);
  });

  it('lists the notes of any folder of the project, or all of them, without the index and its copies', async () => {
    const vault = furnished().seed('Novel/Novel 2.md', { frontmatter: { spellbook: 'project', version: 1, binder: [] } });
    const { store } = await openSeeded(scenes, vault);
    expect(store.projectNotes('Manuscript')).toEqual([
      { path: 'Manuscript/A.md', frontmatter: { status: 'To do', order: 1024 } },
      { path: 'Manuscript/B.md', frontmatter: { status: 'To do', order: 2048 } },
    ]);
    expect(store.projectNotes().map((note) => note.path)).toEqual([
      'Manuscript/A.md',
      'Manuscript/B.md',
      'Research/Trains.md',
      'Stats/2026-10 ab12cd34ef.md',
      'Timeline/The fire.md',
      'To-do.md',
    ]);
    expect(store.projectNotes('../Elsewhere')).toEqual([]);
    expect(store.projectNotes('Nowhere')).toEqual([]);
  });

  it('tells the day a note of the project was created, when the vault knows', async () => {
    const vault = new MemoryVault();
    const { store } = await openSeeded(scenes, vault);
    expect(store.noteCreatedDay('Manuscript/A.md')).toBeNull();
    vault.setCreatedDay('Novel/Manuscript/A.md', '2026-09-30');
    expect(store.noteCreatedDay('Manuscript/A.md')).toBe('2026-09-30');
    expect(store.noteCreatedDay('Manuscript/Never.md')).toBeNull();
    expect(store.noteCreatedDay('../Elsewhere/Note.md')).toBeNull();
  });
});
