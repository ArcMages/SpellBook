import { describe, expect, it } from 'vitest';
import { buildOutline, stepMove } from '../../src/core/outliner';
import type { FolderRow, SceneRow } from '../../src/core/outliner';
import type { TreeNode } from '../../src/core/types';
import { folder, folderWithId, novelOutline, novelTree, pathOf, sampleLists, scene, sceneNamed } from './helpers';

const lists = sampleLists();
const sceneRef = (name: string): { kind: 'scene'; path: string } => ({ kind: 'scene', path: pathOf(name) });
const folderRef = (id: string): { kind: 'folder'; id: string } => ({ kind: 'folder', id });

/**
 *   Opening
 *   Part one        [f-one]
 *     Letter
 *     Inner         [f-inner]
 *       Night
 *   Ghost           (missing)
 *   Closing
 */
const tree = novelTree();
const outline = novelOutline();
const row = (name: string): SceneRow => sceneNamed(outline, name);
const folderRow = (id: string): FolderRow => folderWithId(outline, id);

describe('moving a row one place, without dragging', () => {
  it('moves a scene past the row next to it at its own level', () => {
    expect(stepMove(tree, lists, row('Ghost'), 'up')).toEqual({
      ref: sceneRef('Ghost'),
      placement: { at: 'before', sibling: folderRef('f-one') },
    });
    expect(stepMove(tree, lists, row('Ghost'), 'down')).toEqual({
      ref: sceneRef('Ghost'),
      placement: { at: 'after', sibling: sceneRef('Closing') },
    });
    expect(stepMove(tree, lists, row('Opening'), 'down')).toEqual({
      ref: sceneRef('Opening'),
      placement: { at: 'after', sibling: folderRef('f-one') },
    });
  });

  it('moves a folder, with everything in it, among its own neighbours', () => {
    expect(stepMove(tree, lists, folderRow('f-one'), 'up')).toEqual({
      ref: folderRef('f-one'),
      placement: { at: 'before', sibling: sceneRef('Opening') },
    });
    expect(stepMove(tree, lists, folderRow('f-inner'), 'up')).toEqual({
      ref: folderRef('f-inner'),
      placement: { at: 'before', sibling: sceneRef('Letter') },
    });
  });

  it('steps out of its folder at the folder\'s edge: before it going up, after it going down', () => {
    expect(stepMove(tree, lists, row('Letter'), 'up')).toEqual({
      ref: sceneRef('Letter'),
      placement: { at: 'before', sibling: folderRef('f-one') },
    });
    expect(stepMove(tree, lists, folderRow('f-inner'), 'down')).toEqual({
      ref: folderRef('f-inner'),
      placement: { at: 'after', sibling: folderRef('f-one') },
    });
    // The only scene of a folder leaves it either way.
    expect(stepMove(tree, lists, row('Night'), 'up')?.placement).toEqual({ at: 'before', sibling: folderRef('f-inner') });
    expect(stepMove(tree, lists, row('Night'), 'down')?.placement).toEqual({ at: 'after', sibling: folderRef('f-inner') });
  });

  it('has nowhere to go from the first place of the top level going up, or the last going down', () => {
    expect(stepMove(tree, lists, row('Opening'), 'up')).toBeNull();
    expect(stepMove(tree, lists, row('Closing'), 'down')).toBeNull();
  });

  it('moves nothing that is no longer in the binder', () => {
    const smaller: TreeNode[] = [scene('Opening'), scene('Closing')];
    expect(stepMove(smaller, lists, row('Ghost'), 'up')).toBeNull();
    // Its folder is gone: there is nothing to step among, or out of.
    expect(stepMove(smaller, lists, row('Letter'), 'up')).toBeNull();
    expect(stepMove(smaller, lists, folderRow('f-inner'), 'down')).toBeNull();
    // It sits in another folder by now: the row no longer says where it is.
    const elsewhere: TreeNode[] = [folder('f-one', 'Part one', []), folder('f-two', 'Part two', [scene('Letter')])];
    expect(stepMove(elsewhere, lists, row('Letter'), 'down')).toBeNull();
  });

  it('goes by the tree it is given, not by the rows that happen to be on show', () => {
    // Sorted and filtered, the rows are a flat list; a move is still a binder move.
    const flat = buildOutline({
      tree,
      sceneOf: () => undefined,
      lists,
      sort: { column: 'name', direction: 'desc' },
      collapsed: new Set(['f-one']),
    });
    expect(stepMove(tree, lists, sceneNamed(flat, 'Night'), 'up')?.placement).toEqual({ at: 'before', sibling: folderRef('f-inner') });
  });
});
