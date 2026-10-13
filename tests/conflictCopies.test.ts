// Conflicting copies of a project's index: telling the copy from the
// original, and merging a copy's binder into the index's.

import { describe, expect, it } from 'vitest';
import { flattenScenes } from '../src/core/binderTree';
import { conflictCopies, mergeConflictCopy } from '../src/core/conflictCopies';
import type { Binder } from '../src/core/types';

/** The copies among index notes that all carry the same title. */
const copiesOf = (...paths: string[]): Record<string, string> =>
  Object.fromEntries(conflictCopies(paths.map((indexPath) => ({ indexPath, explicitTitle: 'My Novel' }))));

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

  it('takes two indexes with titles of their own for two projects, whatever their names', () => {
    // "Book 2" next to "Book" at the top of a vault: a sequel, not a copy.
    const sequel = conflictCopies([
      { indexPath: 'Book.md', explicitTitle: 'Book' },
      { indexPath: 'Book 2.md', explicitTitle: 'Book 2' },
    ]);
    expect([...sequel]).toEqual([]);
    const untitled = conflictCopies([
      { indexPath: 'Novel/Novel.md', explicitTitle: 'My Novel' },
      { indexPath: 'Novel/Novel 2.md', explicitTitle: null },
    ]);
    expect([...untitled]).toEqual([]);
  });

  it('takes a copy for a copy when neither note has a title property', () => {
    const copies = conflictCopies([
      { indexPath: 'Novel/Novel 2.md', explicitTitle: null },
      { indexPath: 'Novel/Novel.md', explicitTitle: null },
    ]);
    expect([...copies]).toEqual([['Novel/Novel 2.md', 'Novel/Novel.md']]);
  });

  it('picks, among several notes a copy is named after, one that has its title', () => {
    const copies = conflictCopies([
      { indexPath: 'Novel/Novel.md', explicitTitle: 'Another book' },
      { indexPath: 'Novel/Novel 2.md', explicitTitle: 'My Novel' },
      { indexPath: 'Novel/Novel 2 (conflicted copy).md', explicitTitle: 'My Novel' },
    ]);
    expect([...copies]).toEqual([['Novel/Novel 2 (conflicted copy).md', 'Novel/Novel 2.md']]);
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
