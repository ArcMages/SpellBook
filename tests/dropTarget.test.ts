// Where a dragged row would land: plain geometry, tested with numbers.

import { describe, expect, it } from 'vitest';
import { folderRef, sceneRef } from '../src/core/binderTree';
import {
  AUTO_SCROLL_EDGE,
  AUTO_SCROLL_MAX,
  FOLDER_EDGE,
  autoScrollSpeed,
  canDrop,
  distanceBetween,
  placementKey,
  resolveDrop,
} from '../src/core/dropTarget';
import type { DropRow } from '../src/core/dropTarget';
import type { NodeRef, TreeNode } from '../src/core/types';

const HEIGHT = 40;
const TOP = 100;

type Spec = readonly [name: string, parentId?: string | null];

/**
 * Rows stacked from TOP down, each HEIGHT tall. A name that starts with "f-"
 * is a folder (the name is its id); anything else is a scene.
 */
function stack(...specs: Spec[]): DropRow[] {
  return specs.map(([name, parentId], index) => ({
    ref: name.startsWith('f-') ? folderRef(name) : sceneRef(`Manuscript/${name}.md`),
    parentId: parentId ?? null,
    top: TOP + index * HEIGHT,
    bottom: TOP + (index + 1) * HEIGHT,
  }));
}

/** Bounds that reach from one row's height above the rows to one below. */
function around(rows: readonly DropRow[]): { top: number; bottom: number } {
  return { top: TOP - HEIGHT, bottom: TOP + rows.length * HEIGHT + HEIGHT };
}

const scene = (name: string): NodeRef => sceneRef(`Manuscript/${name}.md`);

//   A
//   f-one (open)
//     B
//     f-inner (open)
//       C
//   f-shut (folded shut, so its rows are not in the list)
//   D
const rows = stack(['A'], ['f-one'], ['B', 'f-one'], ['f-inner', 'f-one'], ['C', 'f-inner'], ['f-shut'], ['D']);
const bounds = around(rows);
/** The height `part` of the way down the row at `index` (0 = its top edge, 1 = its bottom edge). */
const within = (index: number, part: number): number => TOP + index * HEIGHT + part * HEIGHT;

describe('resolveDrop on a scene', () => {
  it('means "before it" on the upper half, with the line along its top edge', () => {
    expect(resolveDrop(rows, within(2, 0.2), bounds)).toEqual({
      placement: { at: 'before', sibling: scene('B') },
      mark: { kind: 'line', y: within(2, 0), alignWith: 2 },
      over: 2,
    });
  });

  it('means "after it" on the lower half, with the line along its bottom edge', () => {
    expect(resolveDrop(rows, within(2, 0.8), bounds)).toEqual({
      placement: { at: 'after', sibling: scene('B') },
      mark: { kind: 'line', y: within(2, 1), alignWith: 2 },
      over: 2,
    });
  });

  it('turns over exactly in the middle', () => {
    expect(resolveDrop(rows, within(0, 0.5) - 0.01, bounds)?.placement).toEqual({ at: 'before', sibling: scene('A') });
    expect(resolveDrop(rows, within(0, 0.5), bounds)?.placement).toEqual({ at: 'after', sibling: scene('A') });
  });
});

describe('resolveDrop on a folder', () => {
  it('means "before it" on the upper quarter', () => {
    expect(resolveDrop(rows, within(5, 0.1), bounds)).toEqual({
      placement: { at: 'before', sibling: folderRef('f-shut') },
      mark: { kind: 'line', y: within(5, 0), alignWith: 5 },
      over: 5,
    });
  });

  it('means "inside it", at its end, in the middle: the folder is highlighted and no line is drawn', () => {
    for (const part of [FOLDER_EDGE, 0.5, 0.74]) {
      expect(resolveDrop(rows, within(5, part), bounds), String(part)).toEqual({
        placement: { at: 'end', parentId: 'f-shut' },
        mark: { kind: 'into', row: 5 },
        over: 5,
      });
    }
  });

  it('means "after it" on the lower quarter of a folder that shows no rows of its own', () => {
    expect(resolveDrop(rows, within(5, 0.9), bounds)).toEqual({
      placement: { at: 'after', sibling: folderRef('f-shut') },
      mark: { kind: 'line', y: within(5, 1), alignWith: 5 },
      over: 5,
    });
  });

  it('means "at its start" on the lower quarter of a folder that is open: the line is set in like its first row', () => {
    expect(resolveDrop(rows, within(1, 0.9), bounds)).toEqual({
      placement: { at: 'start', parentId: 'f-one' },
      mark: { kind: 'line', y: within(1, 1), alignWith: 2 },
      over: 1,
    });
    expect(resolveDrop(rows, within(3, 0.9), bounds)?.placement).toEqual({ at: 'start', parentId: 'f-inner' });
  });

  it('treats an open folder with nothing in it like a closed one', () => {
    const empty = stack(['A'], ['f-empty'], ['B']);
    expect(resolveDrop(empty, within(1, 0.9), around(empty))?.placement).toEqual({
      at: 'after',
      sibling: folderRef('f-empty'),
    });
    // The row after it is not inside it, although both are at the top level.
    expect(resolveDrop(empty, within(1, 0.5), around(empty))?.placement).toEqual({ at: 'end', parentId: 'f-empty' });
  });

  it('uses quarters of the row, whatever its height', () => {
    const tall: DropRow[] = [{ ref: folderRef('f-tall'), parentId: null, top: 0, bottom: 200 }];
    const box = { top: 0, bottom: 200 };
    expect(resolveDrop(tall, 49, box)?.placement.at).toBe('before');
    expect(resolveDrop(tall, 50, box)?.placement.at).toBe('end');
    expect(resolveDrop(tall, 149, box)?.placement.at).toBe('end');
    expect(resolveDrop(tall, 150, box)?.placement.at).toBe('after');
  });
});

describe('resolveDrop around the rows', () => {
  it('means the start of the binder above the first row', () => {
    expect(resolveDrop(rows, TOP - 10, bounds)).toEqual({
      placement: { at: 'start', parentId: null },
      mark: { kind: 'line', y: TOP, alignWith: 0 },
      over: -1,
    });
  });

  it('means the end of the binder below the last row, with the line set in like a top-level row', () => {
    const nested = stack(['A'], ['f-one'], ['B', 'f-one']);
    expect(resolveDrop(nested, TOP + 3 * HEIGHT + 5, around(nested))).toEqual({
      placement: { at: 'end', parentId: null },
      mark: { kind: 'line', y: TOP + 3 * HEIGHT, alignWith: 0 },
      over: -1,
    });
    // On the last row itself, the lower half still means "after that row", inside its folder.
    expect(resolveDrop(nested, within(2, 0.9), around(nested))?.placement).toEqual({ at: 'after', sibling: scene('B') });
  });

  it('does nothing outside the bounds', () => {
    expect(resolveDrop(rows, bounds.top - 1, bounds)).toBeNull();
    expect(resolveDrop(rows, bounds.bottom + 1, bounds)).toBeNull();
    expect(resolveDrop(rows, Number.NaN, bounds)).toBeNull();
    expect(resolveDrop(rows, bounds.top, bounds)).not.toBeNull();
    expect(resolveDrop(rows, bounds.bottom, bounds)).not.toBeNull();
  });

  it('goes into a binder that shows no rows: there is nothing to draw a line next to', () => {
    expect(resolveDrop([], 50, { top: 0, bottom: 100 })).toEqual({
      placement: { at: 'end', parentId: null },
      mark: { kind: 'tree' },
      over: -1,
    });
    expect(resolveDrop([], 150, { top: 0, bottom: 100 })).toBeNull();
  });

  it('counts the thin gap between two rows as the bottom edge of the upper one', () => {
    const gapped: DropRow[] = [
      { ref: scene('A'), parentId: null, top: 0, bottom: 30 },
      { ref: scene('B'), parentId: null, top: 34, bottom: 64 },
    ];
    const box = { top: 0, bottom: 64 };
    expect(resolveDrop(gapped, 32, box)).toEqual({
      placement: { at: 'after', sibling: scene('A') },
      mark: { kind: 'line', y: 30, alignWith: 0 },
      over: 0,
    });
    expect(resolveDrop(gapped, 35, box)?.placement).toEqual({ at: 'before', sibling: scene('B') });
  });
});

describe('resolveDrop in a long binder', () => {
  it('finds the row under the pointer among 500', () => {
    const many = stack(...Array.from({ length: 500 }, (_, index): Spec => [`Scene ${index}`]));
    const box = around(many);
    for (const index of [0, 1, 2, 137, 250, 498, 499]) {
      expect(resolveDrop(many, within(index, 0.25), box)?.over, String(index)).toBe(index);
      expect(resolveDrop(many, within(index, 0.25), box)?.placement, String(index)).toEqual({
        at: 'before',
        sibling: scene(`Scene ${index}`),
      });
      expect(resolveDrop(many, within(index, 0.75), box)?.placement, String(index)).toEqual({
        at: 'after',
        sibling: scene(`Scene ${index}`),
      });
    }
  });

  it('never changes the rows it is given', () => {
    const before = JSON.stringify(rows);
    for (let y = bounds.top; y <= bounds.bottom; y += 7) resolveDrop(rows, y, bounds);
    expect(JSON.stringify(rows)).toBe(before);
  });
});

describe('canDrop', () => {
  const s = (name: string): TreeNode => ({ kind: 'scene', path: `Manuscript/${name}.md`, title: name, missing: false });
  const f = (id: string, ...children: TreeNode[]): TreeNode => ({ kind: 'folder', id, name: id, children });
  const tree: TreeNode[] = [s('A'), f('f-one', s('B'), f('f-inner', s('C'))), s('D')];

  it('is true for a place the entry is not in yet', () => {
    expect(canDrop(tree, scene('A'), { at: 'end', parentId: 'f-inner' })).toBe(true);
    expect(canDrop(tree, scene('C'), { at: 'start', parentId: null })).toBe(true);
    expect(canDrop(tree, folderRef('f-inner'), { at: 'after', sibling: scene('D') })).toBe(true);
    expect(canDrop(tree, folderRef('f-one'), { at: 'before', sibling: scene('A') })).toBe(true);
  });

  it('is false for the place the entry is already in', () => {
    expect(canDrop(tree, scene('A'), { at: 'before', sibling: scene('A') })).toBe(false);
    expect(canDrop(tree, scene('A'), { at: 'after', sibling: scene('A') })).toBe(false);
    expect(canDrop(tree, scene('A'), { at: 'start', parentId: null })).toBe(false);
    expect(canDrop(tree, scene('A'), { at: 'before', sibling: folderRef('f-one') })).toBe(false);
    expect(canDrop(tree, scene('D'), { at: 'end', parentId: null })).toBe(false);
    expect(canDrop(tree, scene('C'), { at: 'end', parentId: 'f-inner' })).toBe(false);
  });

  it('never lets a folder go into itself or into a folder inside it', () => {
    expect(canDrop(tree, folderRef('f-one'), { at: 'end', parentId: 'f-one' })).toBe(false);
    expect(canDrop(tree, folderRef('f-one'), { at: 'start', parentId: 'f-inner' })).toBe(false);
    expect(canDrop(tree, folderRef('f-one'), { at: 'before', sibling: scene('B') })).toBe(false);
    expect(canDrop(tree, folderRef('f-one'), { at: 'after', sibling: scene('C') })).toBe(false);
    // The other way round is fine: the inner folder can leave the outer one.
    expect(canDrop(tree, folderRef('f-inner'), { at: 'start', parentId: null })).toBe(true);
  });

  it('is false for what is not in the binder, and for a place that is not', () => {
    expect(canDrop(tree, scene('Nowhere'), { at: 'end', parentId: null })).toBe(false);
    expect(canDrop(tree, scene('A'), { at: 'end', parentId: 'f-gone' })).toBe(false);
    expect(canDrop(tree, scene('A'), { at: 'after', sibling: scene('Nowhere') })).toBe(false);
  });
});

describe('placementKey', () => {
  it('gives one name to one place, and different names to different places', () => {
    const places = [
      { at: 'start', parentId: null },
      { at: 'end', parentId: null },
      { at: 'start', parentId: 'f-one' },
      { at: 'end', parentId: 'f-one' },
      { at: 'before', sibling: scene('A') },
      { at: 'after', sibling: scene('A') },
      { at: 'before', sibling: folderRef('f-one') },
      { at: 'after', sibling: folderRef('f-one') },
    ] as const;
    const keys = places.map(placementKey);
    expect(new Set(keys).size).toBe(places.length);
    expect(placementKey({ at: 'after', sibling: scene('A') })).toBe(keys[5]);
  });
});

describe('distanceBetween', () => {
  it('measures in a straight line, in any direction', () => {
    expect(distanceBetween({ x: 10, y: 10 }, { x: 10, y: 10 })).toBe(0);
    expect(distanceBetween({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
    expect(distanceBetween({ x: 3, y: 4 }, { x: 0, y: 0 })).toBe(5);
    expect(distanceBetween({ x: -2, y: 5 }, { x: -2, y: -3 })).toBe(8);
  });
});

describe('autoScrollSpeed', () => {
  const top = 100;
  const bottom = 500;

  it('is nothing away from the edges', () => {
    expect(autoScrollSpeed(300, top, bottom)).toBe(0);
    expect(autoScrollSpeed(top + AUTO_SCROLL_EDGE, top, bottom)).toBe(0);
    expect(autoScrollSpeed(bottom - AUTO_SCROLL_EDGE, top, bottom)).toBe(0);
  });

  it('scrolls up near the top edge and down near the bottom edge, faster the nearer', () => {
    const slow = autoScrollSpeed(top + 30, top, bottom);
    const fast = autoScrollSpeed(top + 5, top, bottom);
    expect(slow).toBeLessThan(0);
    expect(fast).toBeLessThan(slow);
    expect(autoScrollSpeed(top + AUTO_SCROLL_EDGE / 2, top, bottom)).toBeCloseTo(-AUTO_SCROLL_MAX / 2);

    expect(autoScrollSpeed(bottom - 30, top, bottom)).toBeGreaterThan(0);
    expect(autoScrollSpeed(bottom - 5, top, bottom)).toBeGreaterThan(autoScrollSpeed(bottom - 30, top, bottom));
    expect(autoScrollSpeed(bottom - AUTO_SCROLL_EDGE / 2, top, bottom)).toBeCloseTo(AUTO_SCROLL_MAX / 2);
  });

  it('is as fast as it gets at the edge and past it', () => {
    expect(autoScrollSpeed(top, top, bottom)).toBe(-AUTO_SCROLL_MAX);
    expect(autoScrollSpeed(top - 200, top, bottom)).toBe(-AUTO_SCROLL_MAX);
    expect(autoScrollSpeed(bottom, top, bottom)).toBe(AUTO_SCROLL_MAX);
    expect(autoScrollSpeed(bottom + 200, top, bottom)).toBe(AUTO_SCROLL_MAX);
  });

  it('leaves a calm middle in a list that is shorter than two edges', () => {
    // 60 pixels high: each zone is a third of it.
    expect(autoScrollSpeed(30, 0, 60)).toBe(0);
    expect(autoScrollSpeed(5, 0, 60)).toBeLessThan(0);
    expect(autoScrollSpeed(55, 0, 60)).toBeGreaterThan(0);
  });

  it('does nothing for a list without height', () => {
    expect(autoScrollSpeed(10, 100, 100)).toBe(0);
    expect(autoScrollSpeed(10, 100, 50)).toBe(0);
  });
});
