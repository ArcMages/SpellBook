import { describe, expect, it } from 'vitest';
import {
  NO_FILTER,
  NO_TAG,
  buildOutline,
  compareKeys,
  describeSort,
  hasFilterTag,
  isFilterOn,
  matchesFilter,
  nextSort,
  prepareFilter,
  readFilter,
  readSort,
  sortScenes,
  tagFilterKey,
  toggleFilterTag,
} from '../../src/core/outliner';
import type { ColumnId, OutlineSort, SceneFacts, SceneRow } from '../../src/core/outliner';
import { HEBREW, lookup, sampleLists, scene } from './helpers';

// Compared the English way, so that the tests do not depend on the language of the machine they run on.
const english = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
const lists = sampleLists();

/** Scenes at the top level of a binder, in the order given, with what is known about each. */
function scenesOf(facts: Record<string, SceneFacts>): readonly SceneRow[] {
  return buildOutline({ tree: Object.keys(facts).map((name) => scene(name)), sceneOf: lookup(facts), lists }).scenes;
}

function sorted(facts: Record<string, SceneFacts>, column: ColumnId, direction: OutlineSort['direction'] = 'asc'): string[] {
  return sortScenes(scenesOf(facts), { column, direction }, lists, english).map((row) => row.title);
}

describe('sorting by a column', () => {
  it('compares numbers as numbers, not as text', () => {
    const facts = { A: { words: 1000 }, B: { words: 90 }, C: { words: 100 }, D: { words: 9 } };
    expect(sorted(facts, 'words')).toEqual(['D', 'B', 'C', 'A']);
    expect(sorted(facts, 'words', 'desc')).toEqual(['A', 'C', 'B', 'D']);
    // The reading time is worked out from the words: the same order.
    expect(sorted(facts, 'readTime', 'desc')).toEqual(['A', 'C', 'B', 'D']);
  });

  it('compares titles the way a dictionary would: capitals alike, numbers inside by their value, Hebrew among itself', () => {
    const facts = { banana: {}, 'Scene 10': {}, [HEBREW.house]: {}, Apple: {}, 'Scene 9': {}, [HEBREW.father]: {}, cherry: {} };
    expect(sorted(facts, 'name')).toEqual(['Apple', 'banana', 'cherry', 'Scene 9', 'Scene 10', HEBREW.father, HEBREW.house]);
    expect(sorted(facts, 'name', 'desc')).toEqual([HEBREW.house, HEBREW.father, 'Scene 10', 'Scene 9', 'cherry', 'banana', 'Apple']);
  });

  it('puts a scene with nothing in the column last, whichever way it is sorted', () => {
    const facts = {
      A: { frontmatter: { synopsis: 'Zebra crossing.' }, words: 5 },
      B: { frontmatter: { synopsis: '   ' } },
      C: { frontmatter: { synopsis: 'Apple cart.' }, words: 7 },
      D: { frontmatter: null },
    };
    expect(sorted(facts, 'synopsis')).toEqual(['C', 'A', 'B', 'D']);
    expect(sorted(facts, 'synopsis', 'desc')).toEqual(['A', 'C', 'B', 'D']);
    // Words: a scene that is still waiting, or cannot be read, has none.
    expect(sorted({ ...facts, D: { words: null } }, 'words', 'desc')).toEqual(['C', 'A', 'B', 'D']);
  });

  it('keeps scenes that are equal in the column in manuscript order, both ways', () => {
    const facts = { A: { words: 5 }, B: { words: 5 }, C: { words: 1 }, D: { words: 5 } };
    expect(sorted(facts, 'words')).toEqual(['C', 'A', 'B', 'D']);
    expect(sorted(facts, 'words', 'desc')).toEqual(['A', 'B', 'D', 'C']);
  });

  it('sorts by the row number: manuscript order, or its reverse', () => {
    const facts = { C: {}, A: {}, B: {} };
    expect(sorted(facts, 'number')).toEqual(['C', 'A', 'B']);
    expect(sorted(facts, 'number', 'desc')).toEqual(['B', 'A', 'C']);
  });

  it('sorts statuses and labels by their place in the project\'s list, then the names the list lacks, then none', () => {
    const facts = {
      A: { frontmatter: { status: HEBREW.final, label: HEBREW.daniel } },
      B: { frontmatter: { status: 'Zzz unlisted' } },
      C: { frontmatter: { status: 'To do', label: 'Anna' } },
      D: { frontmatter: {} },
      E: { frontmatter: { status: 'first draft', label: 'Bea (unlisted)' } },
      F: { frontmatter: { status: 'Abc unlisted' } },
    };
    expect(sorted(facts, 'status')).toEqual(['C', 'E', 'A', 'F', 'B', 'D']);
    expect(sorted(facts, 'status', 'desc')).toEqual(['B', 'F', 'A', 'E', 'C', 'D']);
    expect(sorted(facts, 'label')).toEqual(['C', 'A', 'E', 'B', 'D', 'F']);
  });

  it('sorts targets by how far along they are, and leaves scenes without a target last', () => {
    const facts = {
      A: { frontmatter: { target: 1000 }, words: 900 },
      B: { frontmatter: {}, words: 5000 },
      C: { frontmatter: { target: 100 }, words: 150 },
      D: { frontmatter: { target: 400 }, words: 100 },
    };
    expect(sorted(facts, 'target')).toEqual(['D', 'A', 'C', 'B']);
    expect(sorted(facts, 'target', 'desc')).toEqual(['C', 'A', 'D', 'B']);
  });

  it('sorts to-do lines by how many are still open', () => {
    const facts = {
      A: { tasks: { done: 0, total: 3 } },
      B: { tasks: { done: 2, total: 2 } },
      C: { tasks: { done: 0, total: 0 } },
      D: { tasks: { done: 4, total: 5 } },
      E: {},
    };
    expect(sorted(facts, 'tasks')).toEqual(['B', 'D', 'A', 'C', 'E']);
    expect(sorted(facts, 'tasks', 'desc')).toEqual(['A', 'D', 'B', 'C', 'E']);
  });

  it('sorts tags, dates and the tick of "compile"', () => {
    const facts = {
      A: { frontmatter: { tags: ['night'], created: '2026-10-13', compile: false } },
      B: { frontmatter: { tags: ['act-one', 'draft'], created: '2026-02-01' } },
      C: { frontmatter: { created: 'not a date', compile: 'no' } },
      D: { frontmatter: { tags: ['draft'], created: '2025-12-31', edited: '2026-01-01' } },
    };
    expect(sorted(facts, 'tags')).toEqual(['B', 'D', 'A', 'C']);
    expect(sorted(facts, 'created')).toEqual(['D', 'B', 'A', 'C']);
    expect(sorted(facts, 'created', 'desc')).toEqual(['A', 'B', 'D', 'C']);
    expect(sorted(facts, 'edited')).toEqual(['D', 'A', 'B', 'C']);
    // Compiled scenes first.
    expect(sorted(facts, 'compile')).toEqual(['B', 'D', 'A', 'C']);
  });

  it('sorts another property: numbers (also written as text) before words, each in its own way', () => {
    const facts = {
      A: { frontmatter: { chapter: 10 } },
      B: { frontmatter: { chapter: '9' } },
      C: { frontmatter: { chapter: 'Epilogue' } },
      D: { frontmatter: {} },
      E: { frontmatter: { chapter: 2.5 } },
      F: { frontmatter: { chapter: ['Alpha', 'Beta'] } },
      G: { frontmatter: { chapter: true } },
    };
    expect(sorted(facts, 'prop:chapter')).toEqual(['G', 'E', 'B', 'A', 'F', 'C', 'D']);
    expect(sorted(facts, 'prop:chapter', 'desc')).toEqual(['C', 'F', 'A', 'B', 'E', 'G', 'D']);
    // A property no scene has: manuscript order.
    expect(sorted(facts, 'prop:mood')).toEqual(['A', 'B', 'C', 'D', 'E', 'F', 'G']);
  });

  it('leaves the list it was given as it was', () => {
    const scenes = scenesOf({ B: { words: 2 }, A: { words: 1 } });
    const before = scenes.map((row) => row.title);
    sortScenes(scenes, { column: 'words', direction: 'asc' }, lists, english);
    expect(scenes.map((row) => row.title)).toEqual(before);
  });

  it('compares keys part by part, numbers before text', () => {
    expect(compareKeys([1], [2], english)).toBeLessThan(0);
    expect(compareKeys([2], [10], english)).toBeLessThan(0);
    expect(compareKeys([0, 5], [1, 'a'], english)).toBeLessThan(0);
    expect(compareKeys([1, 'b'], [1, 'a'], english)).toBeGreaterThan(0);
    expect(compareKeys([7], ['7'], english)).toBeLessThan(0);
    expect(compareKeys(['a'], ['A'], english)).toBe(0);
    expect(compareKeys([1], [1, 2], english)).toBeLessThan(0);
  });
});

describe('the sort a click on a header leads to', () => {
  it('goes ascending, descending, off', () => {
    const first = nextSort(null, 'words');
    expect(first).toEqual({ column: 'words', direction: 'asc' });
    const second = nextSort(first, 'words');
    expect(second).toEqual({ column: 'words', direction: 'desc' });
    expect(nextSort(second, 'words')).toBeNull();
    // Another column starts over.
    expect(nextSort(second, 'name')).toEqual({ column: 'name', direction: 'asc' });
  });

  it('is said in words', () => {
    expect(describeSort({ column: 'words', direction: 'desc' })).toBe('Sorted by Words, descending');
    expect(describeSort({ column: 'readTime', direction: 'asc' })).toBe('Sorted by Read time, ascending');
    expect(describeSort({ column: 'prop:pov', direction: 'asc' })).toBe('Sorted by pov, ascending');
  });

  it('is read back from what was saved, whatever that is', () => {
    expect(readSort({ column: 'words', direction: 'desc' })).toEqual({ column: 'words', direction: 'desc' });
    expect(readSort({ column: 'prop:pov', direction: 'asc' })).toEqual({ column: 'prop:pov', direction: 'asc' });
    // An unknown direction is ascending; an unknown column is no sort.
    expect(readSort({ column: 'name', direction: 'sideways' })).toEqual({ column: 'name', direction: 'asc' });
    for (const saved of [null, undefined, 'words', 7, [], ['words', 'asc'], {}, { column: 'nonsense' }, { column: 5 }, { column: 'prop:' }]) {
      expect(readSort(saved)).toBeNull();
    }
  });
});

describe('the filter', () => {
  const opening = {
    title: 'Opening',
    synopsis: 'Anna arrives in the Old Town.',
    status: { name: 'To do' },
    label: { name: 'Anna' },
  };
  const hebrew = { title: HEBREW.letter, synopsis: HEBREW.synopsis, status: null, label: { name: HEBREW.daniel } };
  const passes = (scene: typeof opening | typeof hebrew, filter: Parameters<typeof prepareFilter>[0]): boolean =>
    matchesFilter(scene, prepareFilter(filter));

  it('is off until something is asked for', () => {
    expect(isFilterOn(NO_FILTER)).toBe(false);
    expect(isFilterOn({ text: '   ', statuses: [], labels: [] })).toBe(false);
    expect(isFilterOn({ text: 'a', statuses: [], labels: [] })).toBe(true);
    expect(isFilterOn({ text: '', statuses: [NO_TAG], labels: [] })).toBe(true);
    expect(isFilterOn({ text: '', statuses: [], labels: ['Anna'] })).toBe(true);
    expect(passes(opening, NO_FILTER)).toBe(true);
  });

  it('finds text in the title and in the synopsis, whatever the capitals', () => {
    expect(passes(opening, { ...NO_FILTER, text: 'open' })).toBe(true);
    expect(passes(opening, { ...NO_FILTER, text: '  OLD TOWN ' })).toBe(true);
    expect(passes(opening, { ...NO_FILTER, text: 'harbour' })).toBe(false);
    // Not in the status or the label: those have menus of their own.
    expect(passes(opening, { ...NO_FILTER, text: 'to do' })).toBe(false);
  });

  it('finds Hebrew text', () => {
    expect(passes(hebrew, { ...NO_FILTER, text: 'מכתב' })).toBe(true);
    expect(passes(hebrew, { ...NO_FILTER, text: 'במגירה' })).toBe(true);
    expect(passes(opening, { ...NO_FILTER, text: 'מכתב' })).toBe(false);
  });

  it('shows only the chosen statuses and labels, capitals and extra spaces aside', () => {
    expect(passes(opening, { ...NO_FILTER, statuses: ['to  DO'] })).toBe(true);
    expect(passes(opening, { ...NO_FILTER, statuses: ['Done', 'First draft'] })).toBe(false);
    expect(passes(opening, { ...NO_FILTER, labels: [HEBREW.daniel, 'anna'] })).toBe(true);
    expect(passes(hebrew, { ...NO_FILTER, labels: [HEBREW.daniel] })).toBe(true);
    expect(passes(hebrew, { ...NO_FILTER, labels: ['Anna'] })).toBe(false);
  });

  it('can ask for the scenes that have no status, or no label', () => {
    expect(passes(hebrew, { ...NO_FILTER, statuses: [NO_TAG] })).toBe(true);
    expect(passes(opening, { ...NO_FILTER, statuses: [NO_TAG] })).toBe(false);
    expect(passes(opening, { ...NO_FILTER, statuses: [NO_TAG, 'To do'] })).toBe(true);
  });

  it('asks for every part that is set at once', () => {
    expect(passes(opening, { text: 'anna', statuses: ['To do'], labels: ['Anna'] })).toBe(true);
    expect(passes(opening, { text: 'anna', statuses: ['Done'], labels: ['Anna'] })).toBe(false);
    expect(passes(opening, { text: 'harbour', statuses: ['To do'], labels: ['Anna'] })).toBe(false);
  });

  it('puts a name into a list, or takes it out when it was in', () => {
    expect(toggleFilterTag([], 'To do')).toEqual(['To do']);
    expect(toggleFilterTag(['To do', 'Done'], 'to DO')).toEqual(['Done']);
    expect(toggleFilterTag(['Done'], null)).toEqual(['Done', NO_TAG]);
    expect(toggleFilterTag(['Done', NO_TAG], null)).toEqual(['Done']);
    expect(hasFilterTag(['To do'], ' to do ')).toBe(true);
    expect(hasFilterTag(['To do'], null)).toBe(false);
    expect(hasFilterTag([NO_TAG], null)).toBe(true);
    expect(tagFilterKey('  First   DRAFT ')).toBe('first draft');
    expect(tagFilterKey(null)).toBe(NO_TAG);
  });

  it('is read back from what was saved, whatever that is', () => {
    expect(readFilter({ text: 'anna', statuses: ['To do', NO_TAG], labels: [HEBREW.daniel] })).toEqual({
      text: 'anna',
      statuses: ['To do', NO_TAG],
      labels: [HEBREW.daniel],
    });
    // What is not understood is left out; the same name twice is kept once.
    expect(readFilter({ text: 7, statuses: ['Done', 5, null, 'done', ' Done '], labels: 'Anna' })).toEqual({
      text: '',
      statuses: ['Done'],
      labels: [],
    });
    for (const saved of [null, undefined, 'anna', 3, [], {}, { text: '', statuses: [], labels: [] }, { statuses: {} }]) {
      expect(readFilter(saved)).toBe(NO_FILTER);
    }
    expect(readFilter({ text: 'x'.repeat(500) }).text).toHaveLength(200);
  });
});
