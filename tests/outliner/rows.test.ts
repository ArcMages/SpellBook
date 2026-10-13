import { describe, expect, it } from 'vitest';
import { NO_TASKS, buildOutline, rowRef, sameSums, sumScenes } from '../../src/core/outliner';
import type { SceneFacts } from '../../src/core/outliner';
import {
  HEBREW,
  folder,
  folderWithId,
  keys,
  lookup,
  novelFacts,
  novelOutline,
  novelTree,
  pathOf,
  sampleLists,
  scene,
  sceneNamed,
  titles,
} from './helpers';

/** The small novel with every scene counted and read. */
function finishedFacts(): Record<string, SceneFacts> {
  const facts = novelFacts();
  return { ...facts, Closing: { ...facts['Closing'], words: 100, tasks: NO_TASKS } };
}

describe('the rows of the table follow the binder', () => {
  it('shows the manuscript first, then every folder with its scenes under it, in binder order', () => {
    const outline = novelOutline();
    expect(keys(outline.rows)).toEqual([
      'manuscript',
      `scene:${pathOf('Opening')}`,
      'folder:f-one',
      `scene:${pathOf('Letter')}`,
      'folder:f-inner',
      `scene:${pathOf('Night')}`,
      `scene:${pathOf('Ghost')}`,
      `scene:${pathOf('Closing')}`,
    ]);
    expect(outline.flat).toBe(false);
    expect(outline.filtered).toBe(false);
    expect(outline.rows.map((row) => row.depth)).toEqual([0, 1, 1, 2, 2, 3, 1, 1]);
  });

  it('numbers the scenes in manuscript order, and knows which folder each row sits in', () => {
    const outline = novelOutline();
    expect(outline.scenes.map((row) => [row.title, row.number, row.parentId])).toEqual([
      ['Opening', 1, null],
      ['Letter', 2, 'f-one'],
      ['Night', 3, 'f-inner'],
      ['Ghost', 4, null],
      ['Closing', 5, null],
    ]);
    expect(folderWithId(outline, 'f-one').parentId).toBeNull();
    expect(folderWithId(outline, 'f-inner').parentId).toBe('f-one');
    expect(rowRef(sceneNamed(outline, 'Night'))).toEqual({ kind: 'scene', path: pathOf('Night') });
    expect(rowRef(folderWithId(outline, 'f-inner'))).toEqual({ kind: 'folder', id: 'f-inner' });
    const [manuscript] = outline.rows;
    expect(manuscript && rowRef(manuscript)).toBeNull();
  });

  it('reads what each scene says: status and label with their colours, target, synopsis, tags, dates', () => {
    const outline = novelOutline();
    expect(sceneNamed(outline, 'Opening')).toMatchObject({
      kind: 'scene',
      path: pathOf('Opening'),
      title: 'Opening',
      missing: false,
      status: { name: 'To do', color: 'red', listed: true },
      label: { name: 'Anna', color: 'purple', listed: true },
      target: 1000,
      words: 500,
      synopsis: 'Anna arrives in the old town.',
      tags: ['draft', 'act-one'],
      tasks: { done: 1, total: 3 },
      compile: true,
      created: '2026-10-01',
      edited: '2026-10-13',
    });
    // A status the list has takes the list's spelling; one it lacks is kept, without a colour.
    expect(sceneNamed(outline, 'Letter').status).toEqual({ name: 'First draft', color: 'orange', listed: true });
    expect(sceneNamed(outline, 'Closing').status).toEqual({ name: 'Sent off', color: null, listed: false });
    expect(sceneNamed(outline, 'Closing').compile).toBe(false);
    expect(sceneNamed(outline, 'Night')).toMatchObject({
      status: { name: HEBREW.final, color: 'green' },
      label: { name: HEBREW.daniel, color: 'cyan' },
      synopsis: HEBREW.synopsis,
    });
    expect(sceneNamed(outline, 'Letter')).toMatchObject({ label: null, synopsis: '', tags: [], created: null, edited: null });
    // The properties themselves are handed on, for the columns that show one of the others.
    expect(sceneNamed(outline, 'Opening').frontmatter?.['pov']).toBe('Anna');
  });

  it('keeps a scene whose note is missing, with nothing known about it', () => {
    const facts = { ...novelFacts(), Ghost: { frontmatter: { status: 'To do', target: 900 }, words: 77, tasks: { done: 1, total: 1 } } };
    const ghost = sceneNamed(novelOutline({}, facts), 'Ghost');
    expect(ghost).toMatchObject({ missing: true, words: null, tasks: null, status: null, target: null, frontmatter: null, compile: true });
  });

  it('tells a scene that cannot be read (null) from one that is still waiting (undefined)', () => {
    const facts = { ...novelFacts(), Letter: { frontmatter: null, words: null, tasks: null } };
    const outline = novelOutline({}, facts);
    expect(sceneNamed(outline, 'Letter')).toMatchObject({ words: null, tasks: null });
    expect(sceneNamed(outline, 'Closing').words).toBeUndefined();
    expect(sceneNamed(outline, 'Closing').tasks).toBeUndefined();
    // A count that is not a number of words adds nothing; a fraction is rounded.
    const odd = novelOutline({}, { ...novelFacts(), Letter: { words: Number.NaN }, Night: { words: 249.6 } });
    expect(sceneNamed(odd, 'Letter').words).toBeNull();
    expect(sceneNamed(odd, 'Night').words).toBe(250);
  });

  it('shows a scene the binder lists twice only once', () => {
    const outline = buildOutline({
      tree: [scene('Opening'), folder('f', 'Part', [scene('Opening'), scene('Letter')])],
      sceneOf: lookup(novelFacts()),
      lists: sampleLists(),
    });
    expect(titles(outline.rows)).toEqual(['Opening', 'Letter']);
    expect(outline.total.scenes).toBe(2);
  });

  it('copes with an empty binder and with a scene nothing is known about', () => {
    const empty = buildOutline({ tree: [], sceneOf: () => undefined, lists: sampleLists() });
    expect(keys(empty.rows)).toEqual(['manuscript']);
    expect(empty.total).toEqual({ scenes: 0, missing: 0, words: 0, target: 0, targetWords: 0, tasks: NO_TASKS });
    const bare = buildOutline({ tree: [scene('Opening')], sceneOf: () => null, lists: sampleLists() });
    expect(sceneNamed(bare, 'Opening')).toMatchObject({ status: null, label: null, target: null, synopsis: '', compile: true });
    expect(bare.total.words).toBeNull();
  });
});

describe('sums', () => {
  it('adds up each folder, everything inside it included', () => {
    const outline = novelOutline({}, finishedFacts());
    expect(folderWithId(outline, 'f-inner').sums).toEqual({
      scenes: 1,
      missing: 0,
      words: 250,
      target: 0,
      targetWords: 0,
      tasks: { done: 2, total: 2 },
    });
    expect(folderWithId(outline, 'f-one').sums).toEqual({
      scenes: 2,
      missing: 0,
      words: 850,
      // The summed target is measured against the words of the scenes that have a target: Letter's 600.
      target: 400,
      targetWords: 600,
      tasks: { done: 2, total: 2 },
    });
  });

  it('adds up the manuscript: the first row and the Total row say the same', () => {
    const outline = novelOutline({}, finishedFacts());
    const expected = {
      scenes: 5,
      missing: 1,
      words: 500 + 600 + 250 + 100,
      target: 1400,
      targetWords: 1100,
      tasks: { done: 3, total: 5 },
    };
    expect(outline.total).toEqual(expected);
    expect(outline.whole).toEqual(expected);
    const [manuscript] = outline.rows;
    expect(manuscript).toMatchObject({ kind: 'manuscript', sums: expected });
    expect(sumScenes(outline.scenes)).toEqual(expected);
  });

  it('never shows a half-made sum: words and to-do lines are unknown while a scene is still waiting', () => {
    const outline = novelOutline();
    // Closing has not been counted or read yet.
    expect(outline.total).toMatchObject({ scenes: 5, missing: 1, words: null, tasks: null, target: 1400, targetWords: 1100 });
    // The folder it is not in is not held up by it.
    expect(folderWithId(outline, 'f-one').sums.words).toBe(850);
    // A scene with a target that is still being counted: what was written toward the targets is not known either.
    const waiting = novelOutline({}, { ...finishedFacts(), Letter: { frontmatter: { target: 400 } } });
    expect(waiting.total).toMatchObject({ target: 1400, targetWords: null, words: null });
  });

  it('lets a scene that cannot be read add nothing', () => {
    const outline = novelOutline({}, { ...finishedFacts(), Night: { frontmatter: { target: 300 }, words: null, tasks: null } });
    expect(outline.total).toMatchObject({ words: 1200, target: 1700, targetWords: 1100, tasks: { done: 1, total: 3 } });
  });

  it('tells equal sums from different ones', () => {
    const outline = novelOutline({}, finishedFacts());
    expect(sameSums(outline.total, { ...outline.total, tasks: { done: 3, total: 5 } })).toBe(true);
    expect(sameSums(outline.total, { ...outline.total, words: 1 })).toBe(false);
    expect(sameSums(outline.total, { ...outline.total, tasks: null })).toBe(false);
    expect(sameSums(outline.total, { ...outline.total, tasks: { done: 4, total: 5 } })).toBe(false);
    expect(sameSums(outline.total, { ...outline.total, targetWords: null })).toBe(false);
  });
});

describe('folded folders', () => {
  it('hides what is inside a folder that is folded shut, and still sums it', () => {
    const open = novelOutline({}, finishedFacts());
    const shut = novelOutline({ collapsed: new Set(['f-one']) }, finishedFacts());
    expect(keys(shut.rows)).toEqual([
      'manuscript',
      `scene:${pathOf('Opening')}`,
      'folder:f-one',
      `scene:${pathOf('Ghost')}`,
      `scene:${pathOf('Closing')}`,
    ]);
    expect(folderWithId(shut, 'f-one').collapsed).toBe(true);
    expect(folderWithId(shut, 'f-one').sums).toEqual(folderWithId(open, 'f-one').sums);
    expect(shut.total).toEqual(open.total);
    // The scenes inside are still known, and keep their numbers.
    expect(sceneNamed(shut, 'Night').number).toBe(3);
  });

  it('folds an inner folder on its own', () => {
    const outline = novelOutline({ collapsed: new Set(['f-inner', 'f-gone']) });
    expect(titles(outline.rows)).toEqual(['Opening', 'Letter', 'Ghost', 'Closing']);
    expect(folderWithId(outline, 'f-inner').collapsed).toBe(true);
    expect(folderWithId(outline, 'f-one').collapsed).toBe(false);
  });
});

describe('a filter', () => {
  it('leaves out the scenes that do not pass, and the folders that then have nothing to show', () => {
    const outline = novelOutline({ filter: { text: 'ANNA', statuses: [], labels: [] } }, finishedFacts());
    // Only the Opening's synopsis names Anna in English.
    expect(keys(outline.rows)).toEqual(['manuscript', `scene:${pathOf('Opening')}`]);
    expect(outline.filtered).toBe(true);
  });

  it('keeps the folders above a scene that passes', () => {
    const outline = novelOutline({ filter: { text: '', statuses: [HEBREW.final], labels: [] } }, finishedFacts());
    expect(keys(outline.rows)).toEqual(['manuscript', 'folder:f-one', 'folder:f-inner', `scene:${pathOf('Night')}`]);
  });

  it('sums what is shown, and keeps the sums of the whole manuscript beside them', () => {
    const outline = novelOutline({ filter: { text: '', statuses: ['first draft', HEBREW.final], labels: [] } }, finishedFacts());
    expect(titles(outline.rows)).toEqual(['Letter', 'Night']);
    expect(outline.total).toMatchObject({ scenes: 2, missing: 0, words: 850, target: 400, tasks: { done: 2, total: 2 } });
    expect(folderWithId(outline, 'f-one').sums.words).toBe(850);
    expect(outline.whole).toMatchObject({ scenes: 5, missing: 1, words: 1450 });
    // The scenes keep their numbers in the manuscript.
    expect(outline.rows.flatMap((row) => (row.kind === 'scene' ? [row.number] : []))).toEqual([2, 3]);
  });

  it('can leave nothing at all', () => {
    const outline = novelOutline({ filter: { text: 'no such words', statuses: [], labels: [] } });
    expect(keys(outline.rows)).toEqual(['manuscript']);
    expect(outline.total.scenes).toBe(0);
    expect(outline.scenes).toHaveLength(5);
  });

  it('still hides what is inside a folded folder', () => {
    const outline = novelOutline({ filter: { text: '', statuses: [HEBREW.final], labels: [] }, collapsed: new Set(['f-one']) });
    expect(keys(outline.rows)).toEqual(['manuscript', 'folder:f-one']);
    expect(folderWithId(outline, 'f-one').sums.scenes).toBe(1);
  });
});

describe('a sort', () => {
  it('makes the table a flat list of scenes, without folder rows', () => {
    const outline = novelOutline({ sort: { column: 'words', direction: 'desc' } }, finishedFacts());
    expect(outline.flat).toBe(true);
    expect(outline.rows.every((row) => row.kind === 'scene')).toBe(true);
    // The entry without a note has no words: it comes last.
    expect(titles(outline.rows)).toEqual(['Letter', 'Opening', 'Night', 'Closing', 'Ghost']);
    // The Total row is still the whole manuscript.
    expect(outline.total).toMatchObject({ scenes: 5, words: 1450 });
  });

  it('shows the scenes inside folded folders too: there are no folders to fold', () => {
    const outline = novelOutline({ sort: { column: 'name', direction: 'asc' }, collapsed: new Set(['f-one']) }, finishedFacts());
    expect(titles(outline.rows)).toEqual(['Closing', 'Ghost', 'Letter', 'Night', 'Opening']);
  });

  it('sorts only what passes the filter', () => {
    const outline = novelOutline(
      { sort: { column: 'words', direction: 'asc' }, filter: { text: '', statuses: ['To do', 'First draft'], labels: [] } },
      finishedFacts(),
    );
    expect(titles(outline.rows)).toEqual(['Opening', 'Letter']);
    expect(outline.total.scenes).toBe(2);
  });
});

describe('working the rows out again', () => {
  it('hands out the very same row for a scene that has not changed', () => {
    const facts = finishedFacts();
    const lists = sampleLists();
    const tree = novelTree();
    const first = buildOutline({ tree, sceneOf: lookup(facts), lists });
    const second = buildOutline({ tree, sceneOf: lookup(facts), lists, previous: first });
    for (const row of first.scenes) expect(sceneNamed(second, row.title)).toBe(row);

    // One scene was counted again: only its row is a new one.
    const changed = { ...facts, Letter: { ...facts['Letter'], words: 601 } };
    const third = buildOutline({ tree, sceneOf: lookup(changed), lists, previous: second });
    expect(sceneNamed(third, 'Letter')).not.toBe(sceneNamed(second, 'Letter'));
    expect(sceneNamed(third, 'Letter').words).toBe(601);
    for (const name of ['Opening', 'Night', 'Ghost', 'Closing']) expect(sceneNamed(third, name)).toBe(sceneNamed(second, name));
    expect(third.total.words).toBe(1451);
  });

  it('makes new rows when a scene moves, when its properties change, and when the lists change', () => {
    const facts = finishedFacts();
    const lists = sampleLists();
    const first = buildOutline({ tree: novelTree(), sceneOf: lookup(facts), lists });

    // Closing moves to the top: every scene has another number.
    const moved = [scene('Closing'), ...novelTree().slice(0, 3)];
    const second = buildOutline({ tree: moved, sceneOf: lookup(facts), lists, previous: first });
    expect(sceneNamed(second, 'Closing').number).toBe(1);
    expect(sceneNamed(second, 'Opening').number).toBe(2);
    expect(sceneNamed(second, 'Opening')).not.toBe(sceneNamed(first, 'Opening'));

    const edited = { ...facts, Opening: { ...facts['Opening'], frontmatter: { ...facts['Opening']?.frontmatter, status: 'First draft' } } };
    const third = buildOutline({ tree: novelTree(), sceneOf: lookup(edited), lists, previous: first });
    expect(sceneNamed(third, 'Opening').status?.name).toBe('First draft');
    expect(sceneNamed(third, 'Letter')).toBe(sceneNamed(first, 'Letter'));

    // Other lists (a status got another colour, say): every row is worked out again.
    const fourth = buildOutline({ tree: novelTree(), sceneOf: lookup(facts), lists: sampleLists(), previous: first });
    expect(sceneNamed(fourth, 'Letter')).not.toBe(sceneNamed(first, 'Letter'));
    expect(sceneNamed(fourth, 'Letter')).toEqual(sceneNamed(first, 'Letter'));
  });

  it('keeps the same rows through a sort, a filter and a fold', () => {
    const facts = finishedFacts();
    const lists = sampleLists();
    const tree = novelTree();
    const first = buildOutline({ tree, sceneOf: lookup(facts), lists });
    const second = buildOutline({
      tree,
      sceneOf: lookup(facts),
      lists,
      previous: first,
      sort: { column: 'words', direction: 'asc' },
      filter: { text: '', statuses: ['To do'], labels: [] },
      collapsed: new Set(['f-one']),
    });
    for (const row of first.scenes) expect(sceneNamed(second, row.title)).toBe(row);
  });

  it('changes nothing it was given', () => {
    const tree = novelTree();
    const facts = novelFacts();
    const before = JSON.stringify([tree, facts]);
    novelOutline({ sort: { column: 'status', direction: 'desc' }, filter: { text: 'a', statuses: [], labels: [] } }, facts);
    buildOutline({ tree, sceneOf: lookup(facts), lists: sampleLists(), collapsed: new Set(['f-one']) });
    expect(JSON.stringify([tree, facts])).toBe(before);
  });
});
