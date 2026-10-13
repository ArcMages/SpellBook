import { describe, expect, it } from 'vitest';
import {
  childrenOf,
  dropDuplicateScenes,
  findFolder,
  flattenScenes,
  folderIds,
  folderRef,
  hasScene,
  insertNode,
  locate,
  moveNode,
  placementOf,
  removeFolderKeepChildren,
  removeNode,
  renameFolder,
  replaceScenePath,
  replaceScenePaths,
  resolvePlacement,
  sceneRef,
  scenesIn,
} from '../src/core/binderTree';
import type { Binder, BinderNode, FolderNode } from '../src/core/types';

const scene = (path: string): BinderNode => ({ kind: 'scene', path });
const folder = (id: string, name: string, children: BinderNode[] = []): FolderNode => ({
  kind: 'folder',
  id,
  name,
  children,
});

/**
 * a
 * P1 [ b, P1a [ c ], d ]
 * e
 * P2 [ ]
 */
function sample(): Binder {
  return [
    scene('a.md'),
    folder('p1', 'Part one', [scene('b.md'), folder('p1a', 'Chapter', [scene('c.md')]), scene('d.md')]),
    scene('e.md'),
    folder('p2', 'Part two'),
  ];
}

/** A compact picture of a tree, e.g. "a p1[b p1a[c] d] e p2[]". */
function draw(binder: Binder): string {
  return binder
    .map((node) =>
      node.kind === 'scene' ? node.path.replace(/\.md$/, '') : `${node.id}[${draw(node.children)}]`,
    )
    .join(' ');
}

function moved(binder: Binder, ...args: Parameters<typeof moveNode> extends [Binder, ...infer R] ? R : never): string {
  const result = moveNode(binder, ...args);
  if (!result.ok) throw new Error(`move refused: ${result.reason}`);
  return draw(result.binder);
}

describe('finding nodes', () => {
  it('locates scenes and folders at any depth with their parent and position', () => {
    const tree = sample();
    expect(locate(tree, sceneRef('a.md'))).toMatchObject({ parentId: null, index: 0 });
    expect(locate(tree, sceneRef('c.md'))).toMatchObject({ parentId: 'p1a', index: 0 });
    expect(locate(tree, sceneRef('d.md'))).toMatchObject({ parentId: 'p1', index: 2 });
    expect(locate(tree, folderRef('p1a'))).toMatchObject({ parentId: 'p1', index: 1 });
    expect(locate(tree, folderRef('p2'))).toMatchObject({ parentId: null, index: 3 });
  });

  it('returns null for something that is not there', () => {
    const tree = sample();
    expect(locate(tree, sceneRef('zzz.md'))).toBeNull();
    expect(locate(tree, folderRef('a.md'))).toBeNull(); // a scene path is not a folder id
    expect(locate(tree, sceneRef('p1'))).toBeNull(); // and a folder id is not a scene
    expect(findFolder(tree, 'nope')).toBeNull();
    expect(childrenOf(tree, 'nope')).toBeNull();
  });

  it('answers simple questions', () => {
    const tree = sample();
    expect(hasScene(tree, 'c.md')).toBe(true);
    expect(hasScene(tree, 'C.md')).toBe(false);
    expect(findFolder(tree, 'p1')?.name).toBe('Part one');
    expect(childrenOf(tree, null)).toBe(tree);
    expect(childrenOf(tree, 'p2')).toEqual([]);
    expect(folderIds(tree)).toEqual(['p1', 'p1a', 'p2']);
  });

  it('treats two Unicode spellings of the same name as the same scene', () => {
    const composed = 'Café.md'.normalize('NFC');
    const decomposed = composed.normalize('NFD');
    expect(composed).not.toBe(decomposed);
    expect(hasScene([scene(composed)], decomposed)).toBe(true);
  });
});

describe('flattenScenes', () => {
  it('lists scenes depth-first, in manuscript order', () => {
    expect(flattenScenes(sample())).toEqual(['a.md', 'b.md', 'c.md', 'd.md', 'e.md']);
  });

  it('is empty for an empty binder and for folders without scenes', () => {
    expect(flattenScenes([])).toEqual([]);
    expect(flattenScenes([folder('x', 'X', [folder('y', 'Y')])])).toEqual([]);
  });

  it('lists what one node stands for', () => {
    const tree = sample();
    expect(scenesIn(tree[1] as BinderNode)).toEqual(['b.md', 'c.md', 'd.md']);
    expect(scenesIn(tree[0] as BinderNode)).toEqual(['a.md']);
  });
});

describe('insertNode', () => {
  it('inserts at the top level and inside folders at the given position', () => {
    const top = insertNode(sample(), scene('n.md'), null, 1);
    expect(top.ok && draw(top.binder)).toBe('a n p1[b p1a[c] d] e p2[]');
    const nested = insertNode(sample(), scene('n.md'), 'p1a', 0);
    expect(nested.ok && draw(nested.binder)).toBe('a p1[b p1a[n c] d] e p2[]');
    const empty = insertNode(sample(), scene('n.md'), 'p2', 0);
    expect(empty.ok && draw(empty.binder)).toBe('a p1[b p1a[c] d] e p2[n]');
  });

  it('clamps a position that is out of range', () => {
    const far = insertNode(sample(), scene('n.md'), 'p1', 99);
    expect(far.ok && draw(far.binder)).toBe('a p1[b p1a[c] d n] e p2[]');
    const negative = insertNode(sample(), scene('n.md'), null, -5);
    expect(negative.ok && draw(negative.binder)).toBe('n a p1[b p1a[c] d] e p2[]');
  });

  it('refuses a folder that is not there', () => {
    expect(insertNode(sample(), scene('n.md'), 'nope', 0)).toEqual({ ok: false, reason: 'parent-missing' });
  });

  it('refuses a scene path or folder id that is already in the binder', () => {
    expect(insertNode(sample(), scene('c.md'), null, 0)).toEqual({ ok: false, reason: 'duplicate' });
    expect(insertNode(sample(), folder('p1a', 'Again'), null, 0)).toEqual({ ok: false, reason: 'duplicate' });
    // a folder that brings a duplicate inside it
    expect(insertNode(sample(), folder('new', 'New', [scene('e.md')]), null, 0)).toEqual({
      ok: false,
      reason: 'duplicate',
    });
  });

  it('does not change the tree it was given', () => {
    const tree = sample();
    const before = JSON.stringify(tree);
    const result = insertNode(tree, scene('n.md'), 'p1a', 0);
    expect(result.ok).toBe(true);
    expect(JSON.stringify(tree)).toBe(before);
    // untouched branches are shared, not copied
    if (result.ok) expect(result.binder[3]).toBe(tree[3]);
  });
});

describe('removeNode', () => {
  it('removes a scene', () => {
    const result = removeNode(sample(), sceneRef('c.md'));
    expect(result && draw(result.binder)).toBe('a p1[b p1a[] d] e p2[]');
    expect(result?.node).toEqual(scene('c.md'));
  });

  it('removes a folder together with everything in it', () => {
    const result = removeNode(sample(), folderRef('p1'));
    expect(result && draw(result.binder)).toBe('a e p2[]');
    expect(result && scenesIn(result.node)).toEqual(['b.md', 'c.md', 'd.md']);
  });

  it('returns null when the node is not there, and leaves the input alone', () => {
    const tree = sample();
    const before = JSON.stringify(tree);
    expect(removeNode(tree, sceneRef('zzz.md'))).toBeNull();
    removeNode(tree, sceneRef('a.md'));
    expect(JSON.stringify(tree)).toBe(before);
  });
});

describe('resolvePlacement', () => {
  it('turns every kind of placement into a folder and a position', () => {
    const tree = sample();
    expect(resolvePlacement(tree, { at: 'start', parentId: null })).toEqual({ parentId: null, index: 0 });
    expect(resolvePlacement(tree, { at: 'end', parentId: null })).toEqual({ parentId: null, index: 4 });
    expect(resolvePlacement(tree, { at: 'end', parentId: 'p1' })).toEqual({ parentId: 'p1', index: 3 });
    expect(resolvePlacement(tree, { at: 'before', sibling: sceneRef('d.md') })).toEqual({ parentId: 'p1', index: 2 });
    expect(resolvePlacement(tree, { at: 'after', sibling: folderRef('p1a') })).toEqual({ parentId: 'p1', index: 2 });
  });

  it('returns null when the folder or sibling is not there', () => {
    const tree = sample();
    expect(resolvePlacement(tree, { at: 'end', parentId: 'nope' })).toBeNull();
    expect(resolvePlacement(tree, { at: 'before', sibling: sceneRef('zzz.md') })).toBeNull();
  });
});

describe('moveNode', () => {
  it('reorders within the same folder, in both directions', () => {
    expect(moved(sample(), sceneRef('e.md'), { at: 'before', sibling: sceneRef('a.md') })).toBe(
      'e a p1[b p1a[c] d] p2[]',
    );
    expect(moved(sample(), sceneRef('a.md'), { at: 'after', sibling: sceneRef('e.md') })).toBe(
      'p1[b p1a[c] d] e a p2[]',
    );
    expect(moved(sample(), sceneRef('b.md'), { at: 'end', parentId: 'p1' })).toBe('a p1[p1a[c] d b] e p2[]');
    expect(moved(sample(), sceneRef('d.md'), { at: 'start', parentId: 'p1' })).toBe('a p1[d b p1a[c]] e p2[]');
  });

  it('moves a scene into, out of and between folders', () => {
    expect(moved(sample(), sceneRef('a.md'), { at: 'end', parentId: 'p2' })).toBe('p1[b p1a[c] d] e p2[a]');
    expect(moved(sample(), sceneRef('c.md'), { at: 'start', parentId: null })).toBe('c a p1[b p1a[] d] e p2[]');
    expect(moved(sample(), sceneRef('c.md'), { at: 'after', sibling: sceneRef('e.md') })).toBe(
      'a p1[b p1a[] d] e c p2[]',
    );
    expect(moved(sample(), sceneRef('e.md'), { at: 'before', sibling: sceneRef('c.md') })).toBe(
      'a p1[b p1a[e c] d] p2[]',
    );
  });

  it('moves a folder with everything in it', () => {
    expect(moved(sample(), folderRef('p1'), { at: 'end', parentId: 'p2' })).toBe('a e p2[p1[b p1a[c] d]]');
    expect(moved(sample(), folderRef('p1a'), { at: 'start', parentId: null })).toBe('p1a[c] a p1[b d] e p2[]');
    expect(moved(sample(), folderRef('p2'), { at: 'before', sibling: sceneRef('b.md') })).toBe(
      'a p1[p2[] b p1a[c] d] e',
    );
  });

  it('refuses to move a folder into itself', () => {
    expect(moveNode(sample(), folderRef('p1'), { at: 'end', parentId: 'p1' })).toEqual({
      ok: false,
      reason: 'into-itself',
    });
    expect(moveNode(sample(), folderRef('p1'), { at: 'start', parentId: 'p1' })).toEqual({
      ok: false,
      reason: 'into-itself',
    });
  });

  it('refuses to move a folder into one of its own folders, however deep', () => {
    expect(moveNode(sample(), folderRef('p1'), { at: 'end', parentId: 'p1a' })).toEqual({
      ok: false,
      reason: 'into-itself',
    });
    // next to something that is inside it
    expect(moveNode(sample(), folderRef('p1'), { at: 'before', sibling: sceneRef('c.md') })).toEqual({
      ok: false,
      reason: 'into-itself',
    });
    expect(moveNode(sample(), folderRef('p1'), { at: 'after', sibling: folderRef('p1a') })).toEqual({
      ok: false,
      reason: 'into-itself',
    });
    const deep: Binder = [folder('x', 'X', [folder('y', 'Y', [folder('z', 'Z')])])];
    expect(moveNode(deep, folderRef('x'), { at: 'end', parentId: 'z' })).toEqual({ ok: false, reason: 'into-itself' });
    // the other way round is fine
    expect(moved(deep, folderRef('z'), { at: 'end', parentId: 'x' })).toBe('x[y[] z[]]');
  });

  it('reports a node that is not there', () => {
    expect(moveNode(sample(), sceneRef('zzz.md'), { at: 'end', parentId: null })).toEqual({
      ok: false,
      reason: 'not-found',
    });
    expect(moveNode(sample(), folderRef('nope'), { at: 'end', parentId: null })).toEqual({
      ok: false,
      reason: 'not-found',
    });
  });

  it('reports a destination that is not there', () => {
    expect(moveNode(sample(), sceneRef('a.md'), { at: 'end', parentId: 'nope' })).toEqual({
      ok: false,
      reason: 'target-missing',
    });
    expect(moveNode(sample(), sceneRef('a.md'), { at: 'after', sibling: sceneRef('zzz.md') })).toEqual({
      ok: false,
      reason: 'target-missing',
    });
  });

  it('reports a move that would change nothing', () => {
    const unchanged = { ok: false, reason: 'unchanged' };
    expect(moveNode(sample(), sceneRef('a.md'), { at: 'start', parentId: null })).toEqual(unchanged);
    expect(moveNode(sample(), folderRef('p2'), { at: 'end', parentId: null })).toEqual(unchanged);
    expect(moveNode(sample(), sceneRef('b.md'), { at: 'before', sibling: folderRef('p1a') })).toEqual(unchanged);
    expect(moveNode(sample(), sceneRef('d.md'), { at: 'after', sibling: folderRef('p1a') })).toEqual(unchanged);
    expect(moveNode(sample(), sceneRef('c.md'), { at: 'end', parentId: 'p1a' })).toEqual(unchanged);
    expect(moveNode(sample(), sceneRef('a.md'), { at: 'before', sibling: sceneRef('a.md') })).toEqual(unchanged);
    expect(moveNode(sample(), folderRef('p1'), { at: 'after', sibling: folderRef('p1') })).toEqual(unchanged);
  });

  it('keeps every scene exactly once, and does not change its input', () => {
    const tree = sample();
    const before = JSON.stringify(tree);
    const result = moveNode(tree, folderRef('p1a'), { at: 'end', parentId: 'p2' });
    expect(result.ok).toBe(true);
    if (result.ok) expect(flattenScenes(result.binder).sort()).toEqual(flattenScenes(tree).sort());
    expect(JSON.stringify(tree)).toBe(before);
  });
});

describe('renameFolder', () => {
  it('changes only the name of that folder', () => {
    const tree = sample();
    const next = renameFolder(tree, 'p1a', 'פרק ראשון');
    expect(next && findFolder(next, 'p1a')?.name).toBe('פרק ראשון');
    expect(next && draw(next)).toBe(draw(tree));
    expect(findFolder(tree, 'p1a')?.name).toBe('Chapter'); // input untouched
  });

  it('keeps properties it does not know about', () => {
    const tree: Binder = [{ kind: 'folder', id: 'x', name: 'X', children: [], extra: { colour: 'red' } }];
    expect(renameFolder(tree, 'x', 'Y')).toEqual([
      { kind: 'folder', id: 'x', name: 'Y', children: [], extra: { colour: 'red' } },
    ]);
  });

  it('returns null when the folder is not there', () => {
    expect(renameFolder(sample(), 'nope', 'X')).toBeNull();
    expect(renameFolder(sample(), 'a.md', 'X')).toBeNull();
  });
});

describe('removeFolderKeepChildren', () => {
  it('moves the children up to where the folder was', () => {
    const next = removeFolderKeepChildren(sample(), 'p1');
    expect(next && draw(next)).toBe('a b p1a[c] d e p2[]');
  });

  it('works for a nested folder and for an empty one', () => {
    const nested = removeFolderKeepChildren(sample(), 'p1a');
    expect(nested && draw(nested)).toBe('a p1[b c d] e p2[]');
    const empty = removeFolderKeepChildren(sample(), 'p2');
    expect(empty && draw(empty)).toBe('a p1[b p1a[c] d] e');
  });

  it('never changes manuscript order', () => {
    for (const id of ['p1', 'p1a', 'p2']) {
      const next = removeFolderKeepChildren(sample(), id);
      expect(next && flattenScenes(next)).toEqual(flattenScenes(sample()));
    }
  });

  it('returns null when the folder is not there', () => {
    expect(removeFolderKeepChildren(sample(), 'nope')).toBeNull();
  });
});

describe('replaceScenePath', () => {
  it('points one entry at a new path, in place', () => {
    const next = replaceScenePath(sample(), 'c.md', 'sub/renamed.md');
    expect(next && flattenScenes(next)).toEqual(['a.md', 'b.md', 'sub/renamed.md', 'd.md', 'e.md']);
    expect(next && locate(next, sceneRef('sub/renamed.md'))).toMatchObject({ parentId: 'p1a', index: 0 });
  });

  it('returns null when the old path is not listed', () => {
    expect(replaceScenePath(sample(), 'zzz.md', 'x.md')).toBeNull();
  });

  it('returns null rather than list a path twice', () => {
    expect(replaceScenePath(sample(), 'a.md', 'e.md')).toBeNull();
  });

  it('applies several renames at once and skips the ones that do not apply', () => {
    const result = replaceScenePaths(sample(), [
      ['b.md', 'x/b.md'],
      ['zzz.md', 'x/zzz.md'], // not listed
      ['d.md', 'e.md'], // would list e.md twice
      ['c.md', 'x/c.md'],
    ]);
    expect(result.changed).toBe(true);
    expect(flattenScenes(result.binder)).toEqual(['a.md', 'x/b.md', 'x/c.md', 'd.md', 'e.md']);
    const nothing = replaceScenePaths(sample(), [['zzz.md', 'y.md']]);
    expect(nothing.changed).toBe(false);
    expect(draw(nothing.binder)).toBe(draw(sample()));
  });
});

describe('replaceScenePaths', () => {
  const after = (renames: Array<[string, string]>): string => draw(replaceScenePaths(sample(), renames).binder);

  it('follows two notes that swapped names', () => {
    const result = replaceScenePaths(sample(), [
      ['a.md', 'b.md'],
      ['b.md', 'a.md'],
    ]);
    expect(result.changed).toBe(true);
    expect(draw(result.binder)).toBe('b p1[a p1a[c] d] e p2[]');
  });

  it('follows three notes that passed their names round in a circle', () => {
    expect(
      after([
        ['a.md', 'c.md'],
        ['c.md', 'e.md'],
        ['e.md', 'a.md'],
      ]),
    ).toBe('c p1[b p1a[e] d] a p2[]');
  });

  it('follows a note into a name another note has just left, in whatever order the two are given', () => {
    expect(after([['a.md', 'b.md'], ['b.md', 'x.md']])).toBe('b p1[x p1a[c] d] e p2[]');
    expect(after([['b.md', 'x.md'], ['a.md', 'b.md']])).toBe('b p1[x p1a[c] d] e p2[]');
  });

  it('never lists a path twice', () => {
    // e.md stays where it is, so nothing may be renamed onto it ...
    expect(after([['a.md', 'e.md']])).toBe(draw(sample()));
    // ... and then b.md does not move away either, so a.md cannot take its name.
    const blocked = replaceScenePaths(sample(), [
      ['a.md', 'b.md'],
      ['b.md', 'e.md'],
    ]);
    expect(blocked.changed).toBe(false);
    expect(draw(blocked.binder)).toBe(draw(sample()));
    // Two notes cannot both end up with the same new name: the first one given gets it.
    expect(after([['a.md', 'x.md'], ['b.md', 'x.md']])).toBe('x p1[b p1a[c] d] e p2[]');
  });

  it('keeps every scene exactly once, and does not change its input', () => {
    const before = sample();
    const result = replaceScenePaths(before, [
      ['a.md', 'b.md'],
      ['b.md', 'a.md'],
      ['d.md', 'sub/d.md'],
    ]);
    expect(draw(before)).toBe(draw(sample()));
    expect(flattenScenes(result.binder).sort()).toEqual(['a.md', 'b.md', 'c.md', 'e.md', 'sub/d.md']);
    expect(folderIds(result.binder)).toEqual(folderIds(before));
  });

  it('ignores a rename that only changes the Unicode spelling of a path', () => {
    const composed = 'Café.md'.normalize('NFC');
    const decomposed = composed.normalize('NFD');
    const binder: Binder = [scene(composed)];
    const result = replaceScenePaths(binder, [[composed, decomposed]]);
    expect(result.changed).toBe(false);
    expect(result.binder).toBe(binder);
  });
});

describe('placementOf', () => {
  it('names the place of a node so that it can be put back there', () => {
    expect(placementOf(sample(), sceneRef('a.md'))).toEqual({ at: 'start', parentId: null });
    expect(placementOf(sample(), sceneRef('b.md'))).toEqual({ at: 'start', parentId: 'p1' });
    expect(placementOf(sample(), sceneRef('d.md'))).toEqual({ at: 'after', sibling: folderRef('p1a') });
    expect(placementOf(sample(), sceneRef('e.md'))).toEqual({ at: 'after', sibling: folderRef('p1') });
    expect(placementOf(sample(), folderRef('p2'))).toEqual({ at: 'after', sibling: sceneRef('e.md') });
    expect(placementOf(sample(), sceneRef('zzz.md'))).toBeNull();
  });

  it('puts every node back exactly where it was taken from', () => {
    for (const ref of [sceneRef('a.md'), sceneRef('b.md'), sceneRef('c.md'), sceneRef('d.md'), sceneRef('e.md'), folderRef('p1'), folderRef('p1a'), folderRef('p2')]) {
      const where = placementOf(sample(), ref);
      const removed = removeNode(sample(), ref);
      if (!where || !removed) throw new Error('the node should be in the sample');
      const target = resolvePlacement(removed.binder, where);
      if (!target) throw new Error('the place should still be there');
      const back = insertNode(removed.binder, removed.node, target.parentId, target.index);
      expect(back.ok && draw(back.binder), JSON.stringify(ref)).toBe(draw(sample()));
    }
  });
});

describe('dropDuplicateScenes', () => {
  it('keeps the first of each path in manuscript order, at any depth', () => {
    const tree: Binder = [
      scene('a.md'),
      folder('f', 'F', [scene('b.md'), scene('a.md'), folder('g', 'G', [scene('b.md'), scene('c.md')])]),
      scene('c.md'),
      scene('a.md'),
    ];
    const result = dropDuplicateScenes(tree);
    expect(draw(result.binder)).toBe('a f[b g[c]]');
    expect(result.dropped).toEqual(['a.md', 'b.md', 'c.md', 'a.md']);
  });

  it('returns the same tree when nothing is repeated', () => {
    const tree = sample();
    const result = dropDuplicateScenes(tree);
    expect(result.binder).toBe(tree);
    expect(result.dropped).toEqual([]);
  });
});
