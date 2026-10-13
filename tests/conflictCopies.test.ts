// Conflicting copies of a project's index: telling the copy from the
// original, merging a copy's binder into the index's, and merging what the
// other screens keep there (statuses, labels, timelines, marks, targets).

import { describe, expect, it } from 'vitest';
import { flattenScenes } from '../src/core/binderTree';
import { TAG_INDEX_KEYS } from '../src/core/cards';
import {
  MERGED_GROUP_KEYS,
  MERGED_LIST_KEYS,
  conflictCopies,
  mergeConflictCopy,
  mergeConflictData,
} from '../src/core/conflictCopies';
import { MARKS_KEY } from '../src/core/planner';
import { TARGETS_KEY } from '../src/core/progress';
import type { Binder } from '../src/core/types';
import { TIMELINES_KEY } from '../src/features/timeline/timelineWiring';

/** The copies among index notes at these paths. */
const copiesOf = (...paths: string[]): Record<string, string> =>
  Object.fromEntries(conflictCopies(paths.map((indexPath) => ({ indexPath }))));

describe('conflictCopies', () => {
  it('takes "<Project> 2" next to "<Project>" for a copy of it', () => {
    expect(copiesOf('Novel/Novel.md', 'Novel/Novel 2.md')).toEqual({ 'Novel/Novel 2.md': 'Novel/Novel.md' });
  });

  it('comes to the same answer in whatever order the notes are found', () => {
    expect(copiesOf('Novel/Novel 2.md', 'Novel/Novel.md')).toEqual({ 'Novel/Novel 2.md': 'Novel/Novel.md' });
  });

  it('finds several copies of one index, each pointing at the original', () => {
    expect(copiesOf('Novel/Novel 3.md', 'Novel/Novel.md', 'Novel/Novel 2.md', 'Novel/Novel 2 2.md')).toEqual({
      'Novel/Novel 2.md': 'Novel/Novel.md',
      'Novel/Novel 3.md': 'Novel/Novel.md',
      // A copy of a copy is a copy of the original too.
      'Novel/Novel 2 2.md': 'Novel/Novel.md',
    });
  });

  it('knows the names other sync services give their copies', () => {
    const main = 'Novel/Novel.md';
    for (const copy of [
      'Novel/Novel (conflicted copy 2026-10-13).md',
      "Novel/Novel (Dana's conflicted copy).md",
      'Novel/Novel.sync-conflict-20261013-120000-ABCDEFG.md',
      'Novel/Novel-conflict.md',
      'Novel/Novel_2.md',
    ]) {
      expect(copiesOf(main, copy), copy).toEqual({ [copy]: main });
    }
  });

  it('does not mind capitals, or which Unicode form a name is in', () => {
    expect(copiesOf('Novel/novel.md', 'Novel/NOVEL 2.md')).toEqual({ 'Novel/NOVEL 2.md': 'Novel/novel.md' });
    const composed = 'Café'.normalize('NFC');
    const decomposed = composed.normalize('NFD');
    expect(copiesOf(`Book/${composed}.md`, `Book/${decomposed} 2.md`)).toEqual({
      [`Book/${decomposed} 2.md`]: `Book/${composed}.md`,
    });
  });

  it('works for names in Hebrew', () => {
    expect(copiesOf('הרומן/הרומן.md', 'הרומן/הרומן 2.md')).toEqual({ 'הרומן/הרומן 2.md': 'הרומן/הרומן.md' });
  });

  it('leaves two indexes alone whose names have nothing to do with each other', () => {
    expect(copiesOf('Shelf/Book A.md', 'Shelf/Book B.md')).toEqual({});
    // A longer word is another name, not the same name with something added.
    expect(copiesOf('Novel/Novel.md', 'Novel/Novelty.md')).toEqual({});
    expect(copiesOf('Novel/Novel.md', 'Novel/Novel2.md')).toEqual({});
  });

  it('only looks at notes in one and the same folder', () => {
    expect(copiesOf('Novel/Novel.md', 'Novel 2/Novel 2.md')).toEqual({});
    expect(copiesOf('Novel/Novel.md', 'Novel/Drafts/Novel 2.md')).toEqual({});
    expect(copiesOf('Novel/Novel.md', 'Other/Novel 2.md')).toEqual({});
  });

  it('works at the top of the vault as well', () => {
    expect(copiesOf('Novel.md', 'Novel 2.md', 'Poems.md')).toEqual({ 'Novel 2.md': 'Novel.md' });
  });

  it('finds none where there is one index, or none at all', () => {
    expect(copiesOf('Novel/Novel.md')).toEqual({});
    expect(copiesOf()).toEqual({});
  });

  it('goes by where the notes are and what they are called, never by what they say', () => {
    // A copy is the other device's version of the index. What that device
    // changed may be the title itself, so the titles of the two say nothing:
    // whatever else each note carries, the answer is the same.
    const withTitles = (main: string | null, copy: string | null): Array<[string, string]> => {
      const notes = [
        { indexPath: 'Novel/Novel.md', explicitTitle: main },
        { indexPath: 'Novel/Novel 2.md', explicitTitle: copy },
      ];
      return [...conflictCopies(notes)];
    };
    const found = [['Novel/Novel 2.md', 'Novel/Novel.md']];
    expect(withTitles('My Novel', 'My Novel')).toEqual(found);
    expect(withTitles('My Novel, draft 2', 'My Novel')).toEqual(found); // one device changed the title
    expect(withTitles('My Novel', null)).toEqual(found);
    expect(withTitles(null, null)).toEqual(found);
  });

  it('takes a copy of a copy for a copy of the original, the shortest name it is built on', () => {
    expect(copiesOf('Novel/Novel.md', 'Novel/Novel 2.md', 'Novel/Novel 2 (conflicted copy).md')).toEqual({
      'Novel/Novel 2.md': 'Novel/Novel.md',
      'Novel/Novel 2 (conflicted copy).md': 'Novel/Novel.md',
    });
  });
});

describe('mergeConflictCopy', () => {
  const main: Binder = [
    { kind: 'scene', path: 'Manuscript/Opening.md' },
    {
      kind: 'folder',
      id: 'f-one',
      name: 'Part one',
      children: [
        { kind: 'scene', path: 'Manuscript/The Letter.md' },
        { kind: 'scene', path: 'Manuscript/Night Train.md' },
      ],
    },
    { kind: 'scene', path: 'Manuscript/Ending.md' },
  ];

  it('adds every scene that only the copy lists to the end of the top level, in the copy\'s order', () => {
    const copy: Binder = [
      { kind: 'scene', path: 'Manuscript/New first.md' },
      { kind: 'scene', path: 'Manuscript/Opening.md' },
      {
        kind: 'folder',
        id: 'f-other',
        name: 'Part two',
        children: [
          { kind: 'scene', path: 'Manuscript/Night Train.md' },
          { kind: 'scene', path: 'Manuscript/New inside.md' },
        ],
      },
      { kind: 'scene', path: 'Manuscript/New last.md' },
    ];
    const merged = mergeConflictCopy(main, copy);
    expect(merged.added).toEqual(['Manuscript/New first.md', 'Manuscript/New inside.md', 'Manuscript/New last.md']);
    expect(merged.binder).toEqual([
      ...main,
      { kind: 'scene', path: 'Manuscript/New first.md' },
      { kind: 'scene', path: 'Manuscript/New inside.md' },
      { kind: 'scene', path: 'Manuscript/New last.md' },
    ]);
  });

  it('never removes or moves anything the index lists, whatever the copy says', () => {
    // The copy has lost a scene, renamed nothing, and put everything in another order.
    const copy: Binder = [
      { kind: 'scene', path: 'Manuscript/Ending.md' },
      { kind: 'scene', path: 'Manuscript/Night Train.md' },
      { kind: 'scene', path: 'Manuscript/Opening.md' },
    ];
    const merged = mergeConflictCopy(main, copy);
    expect(merged.added).toEqual([]);
    expect(merged.binder).toBe(main); // the very same binder: nothing to write
  });

  it('keeps the index\'s folders as they are and does not take over the copy\'s', () => {
    const copy: Binder = [
      { kind: 'folder', id: 'f-new', name: 'A folder only the copy has', children: [{ kind: 'scene', path: 'Manuscript/X.md' }] },
      { kind: 'folder', id: 'f-one', name: 'Renamed in the copy', children: [] },
    ];
    const merged = mergeConflictCopy(main, copy);
    expect(merged.binder.slice(0, main.length)).toEqual(main);
    expect(merged.binder.slice(main.length)).toEqual([{ kind: 'scene', path: 'Manuscript/X.md' }]);
    expect(merged.binder.filter((node) => node.kind === 'folder')).toHaveLength(1);
  });

  it('adds a scene once, even when the copy lists it twice', () => {
    const copy: Binder = [
      { kind: 'scene', path: 'Manuscript/Twice.md' },
      { kind: 'folder', id: 'f-x', name: 'X', children: [{ kind: 'scene', path: 'Manuscript/Twice.md' }] },
    ];
    expect(mergeConflictCopy(main, copy).added).toEqual(['Manuscript/Twice.md']);
  });

  it('knows a scene by its path in either Unicode form', () => {
    const composed = `Manuscript/${'Café'.normalize('NFC')}.md`;
    const decomposed = `Manuscript/${'Café'.normalize('NFD')}.md`;
    const merged = mergeConflictCopy([{ kind: 'scene', path: composed }], [{ kind: 'scene', path: decomposed }]);
    expect(merged.added).toEqual([]);
  });

  it('merges into an empty binder, and merges an empty copy into anything', () => {
    const copy: Binder = [{ kind: 'scene', path: 'Manuscript/Only.md' }];
    expect(mergeConflictCopy([], copy).binder).toEqual(copy);
    expect(mergeConflictCopy(main, [])).toEqual({ binder: main, added: [] });
    expect(mergeConflictCopy([], [])).toEqual({ binder: [], added: [] });
  });

  it('changes neither of the binders it is given', () => {
    const copy: Binder = [{ kind: 'scene', path: 'Manuscript/Extra.md' }];
    const mainBefore = JSON.stringify(main);
    const copyBefore = JSON.stringify(copy);
    const merged = mergeConflictCopy(main, copy);
    expect(JSON.stringify(main)).toBe(mainBefore);
    expect(JSON.stringify(copy)).toBe(copyBefore);
    expect(flattenScenes(merged.binder)).toHaveLength(flattenScenes(main).length + 1);
  });

  it('gives the same result when the same copy is merged twice', () => {
    const copy: Binder = [{ kind: 'scene', path: 'Manuscript/Extra.md' }];
    const once = mergeConflictCopy(main, copy);
    const twice = mergeConflictCopy(once.binder, copy);
    expect(twice.added).toEqual([]);
    expect(twice.binder).toBe(once.binder);
  });
});

describe('mergeConflictData: what the other screens keep in the index', () => {
  /** Apply a merge the way the store does: every changed key gets its new value, nothing else is touched. */
  const applied = (index: Record<string, unknown>, copy: Record<string, unknown>): Record<string, unknown> => ({
    ...index,
    ...mergeConflictData(index, copy).changes,
  });

  it('merges exactly the five things the screens keep there, under the names they read them by', () => {
    expect(MERGED_LIST_KEYS).toEqual([TAG_INDEX_KEYS.status, TAG_INDEX_KEYS.label, TIMELINES_KEY]);
    expect(MERGED_GROUP_KEYS).toEqual([MARKS_KEY, TARGETS_KEY]);
  });

  it('adds a status, a label and a timeline the index does not list, at the end, as the copy has them', () => {
    const index = {
      statuses: [{ name: 'To do', color: 'red' }, { name: 'Final', color: 'green' }],
      labels: [{ name: 'Mara', color: 'purple' }],
      timelines: [{ name: 'Main plot', color: 'purple' }],
    };
    const copy = {
      statuses: [{ name: 'Revised', color: 'blue' }, { name: 'To do', color: 'red' }, { name: 'First draft' }],
      labels: [{ name: 'Noa', color: 'pink' }, { name: 'Mara', color: 'purple' }],
      timelines: [{ name: 'Backstory', color: 'orange' }, { name: 'Main plot', color: 'purple' }],
    };
    const merged = mergeConflictData(index, copy);
    expect(merged.added).toEqual([
      { key: 'statuses', items: ['Revised', 'First draft'] },
      { key: 'labels', items: ['Noa'] },
      { key: 'timelines', items: ['Backstory'] },
    ]);
    expect(merged.changes).toEqual({
      statuses: [...index.statuses, { name: 'Revised', color: 'blue' }, { name: 'First draft' }],
      labels: [...index.labels, { name: 'Noa', color: 'pink' }],
      timelines: [...index.timelines, { name: 'Backstory', color: 'orange' }],
    });
  });

  it('keeps the index\'s own version where both have the same name, whatever the copy says about it', () => {
    const index = { labels: [{ name: 'Mara', color: 'purple' }, { name: 'Tobias' }, 'Noa'] };
    const copy = {
      labels: [
        { name: 'mara', color: 'red' }, // other capitals, another colour
        { name: '  Tobias ', color: 'cyan' }, // a colour the index's entry does not have
        { name: 'NOA', color: 'pink' }, // the index lists it as plain text
        { name: 'Dana', color: 'green' },
      ],
    };
    const merged = mergeConflictData(index, copy);
    expect(merged.added).toEqual([{ key: 'labels', items: ['Dana'] }]);
    expect(merged.changes['labels']).toEqual([...index.labels, { name: 'Dana', color: 'green' }]);
  });

  it('tells the same name apart by neither capitals nor the way an accent or a Hebrew point is stored', () => {
    const composed = 'Zoë';
    const decomposed = 'Zoë';
    const index = { labels: [{ name: composed, color: 'red' }, { name: 'נועה', color: 'pink' }] };
    const copy = { labels: [{ name: decomposed.toUpperCase(), color: 'blue' }, { name: 'נועה', color: 'cyan' }, { name: 'דנה' }] };
    expect(mergeConflictData(index, copy).added).toEqual([{ key: 'labels', items: ['דנה'] }]);
  });

  it('adds each new name once, and leaves out entries that have no name', () => {
    const copy = { labels: [{ name: 'Noa' }, 'noa', { name: 'NOA', color: 'red' }, { color: 'blue' }, 42, null, { name: '  ' }, 'Dana'] };
    const merged = mergeConflictData({ labels: [] }, copy);
    expect(merged.added).toEqual([{ key: 'labels', items: ['Noa', 'Dana'] }]);
    expect(merged.changes['labels']).toEqual([{ name: 'Noa' }, 'Dana']);
  });

  it('adds the mark of a day the index has none for, and keeps its own mark where both have one', () => {
    const index = { marks: { '2026-10-15': { color: 'blue', label: 'Writing group' } } };
    const copy = {
      marks: {
        '2026-10-15': { color: 'red', label: 'Deadline' },
        '2026-10-19': { color: 'green', label: 'Day off' },
        '2026-10-20': { label: 'יום הולדת' },
      },
    };
    const merged = mergeConflictData(index, copy);
    expect(merged.added).toEqual([{ key: 'marks', items: ['2026-10-19', '2026-10-20'] }]);
    expect(merged.changes['marks']).toEqual({
      '2026-10-15': { color: 'blue', label: 'Writing group' },
      '2026-10-19': { color: 'green', label: 'Day off' },
      '2026-10-20': { label: 'יום הולדת' },
    });
  });

  it('adds a target the index has not set, and never changes one it has', () => {
    const index = { targets: { project: 80000, daily: null, deadline: '' } };
    const copy = { targets: { project: 50000, daily: 1000, deadline: '2027-03-12', note: null } };
    const merged = mergeConflictData(index, copy);
    expect(merged.added).toEqual([{ key: 'targets', items: ['daily', 'deadline'] }]);
    expect(merged.changes['targets']).toEqual({ project: 80000, daily: 1000, deadline: '2027-03-12' });
    // A target of nought is a target that was set: it is kept.
    expect(mergeConflictData({ targets: { daily: 0 } }, { targets: { daily: 500 } })).toEqual({ changes: {}, added: [] });
  });

  it('takes over a whole list or group the index does not have at all', () => {
    const copy = {
      statuses: [{ name: 'To do', color: 'red' }],
      labels: [{ name: 'Mara', color: 'purple' }],
      timelines: [{ name: 'Main plot', color: 'purple' }],
      marks: { '2026-10-15': { color: 'blue', label: 'Writing group' } },
      targets: { daily: 1000 },
    };
    for (const index of [{}, { statuses: null, labels: '', timelines: undefined, marks: null, targets: '  ' }]) {
      const merged = mergeConflictData(index, copy);
      expect(merged.changes).toEqual(copy);
      expect(merged.added.map((entry) => entry.key)).toEqual(['statuses', 'labels', 'timelines', 'marks', 'targets']);
    }
    // An empty list or group in the index is the index's own: the copy's entries are added to it all the same.
    expect(mergeConflictData({ labels: [], marks: {} }, copy).added.map((entry) => entry.key)).toEqual([
      'statuses',
      'labels',
      'timelines',
      'marks',
      'targets',
    ]);
  });

  it('never removes, reorders or rewrites anything the index has', () => {
    const index = {
      statuses: [{ name: 'Final', color: 'green' }, { name: 'To do', color: 'red' }, { odd: true }, 'Loose'],
      labels: [{ name: 'Only here', color: 'yellow' }],
      timelines: [{ name: 'Main plot', color: 'purple' }],
      marks: { '2026-10-15': { color: 'blue', label: 'Writing group' }, 'not a day': 'kept as it is' },
      targets: { project: 80000, somethingOfMine: 'kept' },
    };
    const copy = {
      statuses: [{ name: 'To do', color: 'red' }, { name: 'Revised', color: 'blue' }],
      labels: [],
      timelines: [{ name: 'Backstory', color: 'orange' }],
      marks: { '2026-10-19': { color: 'green', label: 'Day off' } },
      targets: { daily: 1000 },
    };
    const after = applied(index, copy);
    for (const key of ['statuses', 'timelines'] as const) {
      const list = after[key] as unknown[];
      expect(list.slice(0, index[key].length), key).toEqual(index[key]); // the same entries, in the same order, first
    }
    expect(after['labels']).toBe(index.labels); // the copy had none to add: not even rewritten
    expect(after['marks']).toMatchObject(index.marks);
    expect(after['targets']).toMatchObject(index.targets);
    // Whatever the copy holds, each key of the index holds at least what it held.
    const noisy = { statuses: [], labels: null, timelines: 'x', marks: {}, targets: [] };
    expect(mergeConflictData(index, noisy)).toEqual({ changes: {}, added: [] });
    expect(applied(index, noisy)).toEqual(index);
  });

  it('leaves alone a value in the index that is not what it should be, and ignores one in the copy', () => {
    const copy = {
      statuses: [{ name: 'To do' }],
      labels: [{ name: 'Mara' }],
      marks: { '2026-10-15': { label: 'x' } },
      targets: { daily: 1000 },
    };
    // A text where a list belongs, a list where a group belongs, a number: not understood, so not touched.
    const odd = { statuses: 'To do, Done', labels: { Mara: 'purple' }, marks: ['2026-10-15'], targets: 80000 };
    expect(mergeConflictData(odd, copy)).toEqual({ changes: {}, added: [] });
    const good = { statuses: [{ name: 'Final' }], marks: { '2026-10-19': { label: 'y' } } };
    expect(mergeConflictData(good, { statuses: 'To do', labels: 7, timelines: {}, marks: [1], targets: 'many' })).toEqual({
      changes: {},
      added: [],
    });
  });

  it('ignores every other key of the copy', () => {
    const copy = { title: 'Another title', binder: ['Manuscript/X.md'], spellbook: 'project', theme: 'dark', notes: ['a'] };
    expect(mergeConflictData({ theme: 'light' }, copy)).toEqual({ changes: {}, added: [] });
  });

  it('changes neither of the two it is given, and hands back copies of its own', () => {
    const index = { labels: [{ name: 'Mara', color: 'purple' }], marks: { '2026-10-15': { label: 'a' } } };
    const copy = { labels: [{ name: 'Noa', color: 'pink' }], marks: { '2026-10-19': { label: 'b' } } };
    const before = JSON.stringify([index, copy]);
    const frozen = (value: unknown): unknown => {
      if (typeof value === 'object' && value !== null) Object.values(value).forEach(frozen);
      return Object.freeze(value);
    };
    frozen(index);
    frozen(copy);
    const merged = mergeConflictData(index, copy);
    expect(JSON.stringify([index, copy])).toBe(before);
    const labels = merged.changes['labels'] as Array<{ name: string }>;
    expect(labels[0]).not.toBe(index.labels[0]);
    expect(labels[1]).not.toBe(copy.labels[0]);
    expect(Object.isFrozen(labels)).toBe(false);
    expect(Object.isFrozen(merged.changes['marks'])).toBe(false);
  });

  it('has nothing more to add when the same copy is merged a second time', () => {
    const index = { labels: [{ name: 'Mara' }], targets: { project: 80000 } };
    const copy = { labels: [{ name: 'Noa' }], marks: { '2026-10-19': { label: 'b' } }, targets: { daily: 1000 } };
    const once = applied(index, copy);
    expect(mergeConflictData(once, copy)).toEqual({ changes: {}, added: [] });
    // Merged the other way round, the other device comes to the same things, each side keeping its own order.
    const other = applied(copy, index);
    expect((other['labels'] as unknown[]).length).toBe((once['labels'] as unknown[]).length);
    expect(other['targets']).toEqual(once['targets']);
  });
});
