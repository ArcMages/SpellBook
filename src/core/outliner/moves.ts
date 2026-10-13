// Moving a row of the outliner one place up or down, without dragging.
//
// A row is a binder row, so the move is a binder move: the cards engine works
// out the node and the placement for the project store's moveNode. Nothing is
// moved here.

import { folderRef } from '../binderTree';
import { MANUSCRIPT_SCOPE, buildBoard, cardIndex, folderScope, moveEarlier, moveLater } from '../cards';
import type { CardLists, CardMove } from '../cards';
import type { TreeNode } from '../types';
import { rowRef } from './rows';
import type { FolderRow, SceneRow } from './rows';

/**
 * The move that puts a scene or a folder one place up or down among the
 * rows of its own folder. At the edge of its folder it steps out of it: to
 * just before the folder when going up, just after it when going down (as in
 * the binder). Null when there is nowhere to go: the first row of the top
 * level going up, the last going down, or a row that is no longer in the binder.
 */
export function stepMove(
  tree: readonly TreeNode[],
  lists: CardLists,
  row: SceneRow | FolderRow,
  direction: 'up' | 'down',
): CardMove | null {
  const ref = rowRef(row);
  if (ref === null) return null;
  // The rows the moving one stands among: the engine's board of its folder.
  const board = buildBoard({
    tree,
    scope: row.parentId === null ? MANUSCRIPT_SCOPE : folderScope(row.parentId),
    sceneOf: () => undefined,
    lists,
  });
  if (!board.scopeFound || cardIndex(board, ref) < 0) return null;
  const move = direction === 'up' ? moveEarlier(board, ref) : moveLater(board, ref);
  if (move !== null || row.parentId === null) return move;
  return { ref, placement: { at: direction === 'up' ? 'before' : 'after', sibling: folderRef(row.parentId) } };
}
