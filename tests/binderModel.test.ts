// The calculations behind the binder panel: the Research tree, the sums of
// word counts, how numbers are written, and when the pane counts as narrow.

import { describe, expect, it } from 'vitest';
import {
  NARROW_BELOW,
  WIDE_FROM,
  binderTotals,
  compareNames,
  describeCount,
  foldKey,
  formatCount,
  isNarrowPane,
  researchTree,
  scenesWithNotes,
} from '../src/core/binderModel';
import type { ResearchNode } from '../src/core/binderModel';
import type { TreeNode } from '../src/core/types';

function scene(name: string, missing = false): TreeNode {
  return { kind: 'scene', path: `Manuscript/${name}.md`, title: name, missing };
}

function folder(id: string, children: TreeNode[]): TreeNode {
  return { kind: 'folder', id, name: id, children };
}

/** A compact picture of a research tree: "Maps[City Old[Harbour]] Trains". */
function draw(nodes: readonly ResearchNode[]): string {
  return nodes.map((node) => (node.kind === 'note' ? node.title : `${node.name}[${draw(node.children)}]`)).join(' ');
}

describe('compareNames', () => {
  it('sorts alphabetically, whatever the capitals', () => {
    expect(['pear', 'Apple', 'banana'].sort(compareNames)).toEqual(['Apple', 'banana', 'pear']);
  });

  it('sorts numbers by their value', () => {
    expect(['Scene 10', 'Scene 2', 'Scene 1'].sort(compareNames)).toEqual(['Scene 1', 'Scene 2', 'Scene 10']);
  });

  it('sorts Hebrew names among themselves', () => {
    expect(['גימל', 'אלף', 'בית'].sort(compareNames)).toEqual(['אלף', 'בית', 'גימל']);
  });

  it('never calls two different names equal, so the order is always the same', () => {
    expect(compareNames('Apple', 'apple')).not.toBe(0);
    expect(compareNames('Apple', 'apple')).toBe(-compareNames('apple', 'Apple'));
    expect(compareNames('same', 'same')).toBe(0);
  });
});

describe('researchTree', () => {
  it('is empty when there are no notes', () => {
    expect(researchTree([])).toEqual([]);
  });

  it('lists the notes of the Research folder alphabetically', () => {
    const tree = researchTree(['Research/Trains.md', 'Research/harbours.md', 'Research/Bridges.md']);
    expect(draw(tree)).toBe('Bridges harbours Trains');
    expect(tree[0]).toEqual({ kind: 'note', path: 'Research/Bridges.md', title: 'Bridges' });
  });

  it('puts sub-folders first, each with its own notes inside', () => {
    const tree = researchTree([
      'Research/Trains.md',
      'Research/Maps/City.md',
      'Research/Maps/Old/Harbour.md',
      'Research/Maps/Atlas.md',
      'Research/People/Noa.md',
      'Research/Alphabet.md',
    ]);
    expect(draw(tree)).toBe('Maps[Old[Harbour] Atlas City] People[Noa] Alphabet Trains');
    const maps = tree[0];
    expect(maps).toMatchObject({ kind: 'folder', path: 'Research/Maps', name: 'Maps' });
    const old = maps?.kind === 'folder' ? maps.children[0] : undefined;
    expect(old).toMatchObject({ kind: 'folder', path: 'Research/Maps/Old', name: 'Old' });
  });

  it('keeps Hebrew names as they are', () => {
    const tree = researchTree(['Research/מפות/העיר העתיקה.md', 'Research/רכבות.md']);
    expect(draw(tree)).toBe('מפות[העיר העתיקה] רכבות');
  });

  it('leaves out anything that is not inside the Research folder', () => {
    expect(draw(researchTree(['Manuscript/A.md', 'Research.md', 'Researching/B.md', 'Research/C.md']))).toBe('C');
  });
});

describe('binderTotals', () => {
  const tree: TreeNode[] = [
    scene('Opening'),
    folder('part-1', [scene('A'), folder('chapter-1', [scene('B'), scene('C')]), scene('Ghost', true)]),
    folder('empty', []),
    scene('End'),
  ];
  const counts: Record<string, number | null | undefined> = {
    'Manuscript/Opening.md': 100,
    'Manuscript/A.md': 10,
    'Manuscript/B.md': 20,
    'Manuscript/C.md': 30,
    'Manuscript/End.md': 1,
  };

  it('adds up each folder with everything inside it, and the whole manuscript', () => {
    const totals = binderTotals(tree, (path) => counts[path]);
    expect(totals.folders.get('chapter-1')).toBe(50);
    expect(totals.folders.get('part-1')).toBe(60);
    expect(totals.folders.get('empty')).toBe(0);
    expect(totals.manuscript).toBe(161);
  });

  it('counts a missing scene as nothing, even if a count is on offer', () => {
    const totals = binderTotals(tree, (path) => (path === 'Manuscript/Ghost.md' ? 999 : counts[path]));
    expect(totals.folders.get('part-1')).toBe(60);
  });

  it('counts a note that cannot be read as nothing', () => {
    const totals = binderTotals(tree, (path) => (path === 'Manuscript/A.md' ? null : counts[path]));
    expect(totals.folders.get('part-1')).toBe(50);
    expect(totals.manuscript).toBe(151);
  });

  it('gives no sum while a scene inside is still being counted', () => {
    const totals = binderTotals(tree, (path) => (path === 'Manuscript/C.md' ? undefined : counts[path]));
    expect(totals.folders.get('chapter-1')).toBeNull();
    expect(totals.folders.get('part-1')).toBeNull(); // it holds chapter-1
    expect(totals.folders.get('empty')).toBe(0); // nothing to wait for
    expect(totals.manuscript).toBeNull();
  });

  it('is zero for an empty binder', () => {
    const totals = binderTotals([], () => undefined);
    expect(totals.manuscript).toBe(0);
    expect(totals.folders.size).toBe(0);
  });
});

describe('scenesWithNotes', () => {
  it('lists the scenes that have a note, in manuscript order', () => {
    const tree: TreeNode[] = [scene('Opening'), folder('p', [scene('A'), scene('Ghost', true), folder('c', [scene('B')])]), scene('End')];
    expect(scenesWithNotes(tree)).toEqual([
      'Manuscript/Opening.md',
      'Manuscript/A.md',
      'Manuscript/B.md',
      'Manuscript/End.md',
    ]);
  });
});

describe('writing a word count', () => {
  it('puts commas between the thousands', () => {
    expect(formatCount(0)).toBe('0');
    expect(formatCount(7)).toBe('7');
    expect(formatCount(999)).toBe('999');
    expect(formatCount(1000)).toBe('1,000');
    expect(formatCount(12345)).toBe('12,345');
    expect(formatCount(1234567)).toBe('1,234,567');
  });

  it('never shows a fraction or a negative number', () => {
    expect(formatCount(12.6)).toBe('13');
    expect(formatCount(-5)).toBe('0');
  });

  it('says it in full for screen readers', () => {
    expect(describeCount(0)).toBe('0 words');
    expect(describeCount(1)).toBe('1 word');
    expect(describeCount(12345)).toBe('12,345 words');
  });
});

describe('isNarrowPane', () => {
  it('turns narrow below the lower mark and wide again only from the upper one', () => {
    expect(NARROW_BELOW).toBeLessThan(WIDE_FROM);
    expect(isNarrowPane(300, false)).toBe(false);
    expect(isNarrowPane(NARROW_BELOW, false)).toBe(false);
    expect(isNarrowPane(NARROW_BELOW - 1, false)).toBe(true);
    // In between, it stays what it was: no flicker while the pane is dragged.
    expect(isNarrowPane(NARROW_BELOW + 5, true)).toBe(true);
    expect(isNarrowPane(NARROW_BELOW + 5, false)).toBe(false);
    expect(isNarrowPane(WIDE_FROM - 1, true)).toBe(true);
    expect(isNarrowPane(WIDE_FROM, true)).toBe(false);
  });

  it('keeps what it was while the pane is hidden and has no width', () => {
    expect(isNarrowPane(0, true)).toBe(true);
    expect(isNarrowPane(0, false)).toBe(false);
    expect(isNarrowPane(Number.NaN, true)).toBe(true);
  });
});

describe('foldKey', () => {
  it('gives every kind of foldable row its own name', () => {
    const names = [
      foldKey.section('manuscript'),
      foldKey.section('unfiled'),
      foldKey.section('research'),
      foldKey.folder('research'),
      foldKey.research('research'),
    ];
    expect(new Set(names).size).toBe(names.length);
  });
});
