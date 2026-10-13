// Moving cards on the corkboard.
//
// The board is a picture of the binder, so a card is moved by moving its
// binder row: each function here works out the node and the Placement that
// the project store's moveNode expects. Nothing is moved here.

import { folderRef, sameRef, sceneRef } from './coreImports';
import type { NodeRef, Placement } from './coreImports';
import type { Board, BoardCard } from './board';

/** A move for the project store: `store.moveNode(move.ref, move.placement)`. */
export interface CardMove {
  /** The binder node to move: a scene, or a folder with everything in it. */
  readonly ref: NodeRef;
  /** Where it goes. */
  readonly placement: Placement;
}

/** The binder node a card stands for: a scene by its path, a folder by its id. */
export function cardRef(card: BoardCard): NodeRef {
  return card.kind === 'scene' ? sceneRef(card.path) : folderRef(card.id);
}

/** Where a card is on the board, counting from 0; -1 when it is not on it. */
export function cardIndex(board: Board, card: NodeRef): number {
  return board.cards.findIndex((other) => sameRef(cardRef(other), card));
}

/**
 * The move that puts a card one place earlier on the board. Null when it is
 * already first, or is not on the board.
 *
 * @param card the card itself, or a reference to its binder node
 */
export function moveEarlier(board: Board, card: NodeRef): CardMove | null {
  const from = cardIndex(board, card);
  const moving = board.cards[from];
  const neighbour = board.cards[from - 1];
  if (from < 1 || !moving || !neighbour) return null;
  return { ref: cardRef(moving), placement: { at: 'before', sibling: cardRef(neighbour) } };
}

/**
 * The move that puts a card one place later on the board. Null when it is
 * already last, or is not on the board.
 *
 * @param card the card itself, or a reference to its binder node
 */
export function moveLater(board: Board, card: NodeRef): CardMove | null {
  const from = cardIndex(board, card);
  const moving = board.cards[from];
  const neighbour = board.cards[from + 1];
  if (from < 0 || !moving || !neighbour) return null;
  return { ref: cardRef(moving), placement: { at: 'after', sibling: cardRef(neighbour) } };
}

/**
 * The move for a card dropped into a gap between the cards.
 *
 * Gaps are counted on the board as it is shown, with the moving card still in
 * its place: gap 0 is in front of the first card, gap 1 between the first and
 * the second, and gap `board.cards.length` after the last. A gap past the end
 * counts as the last one, and a gap before the start as the first.
 *
 * Null when there is nothing to move: the card is not on the board, the gap
 * is one of the two beside the card itself (dropping it there changes
 * nothing), or the gap is not a number at all (NaN, as a drop that landed on
 * no gap may produce).
 *
 * @param card the card itself, or a reference to its binder node
 */
export function dropAt(board: Board, card: NodeRef, gap: number): CardMove | null {
  const from = cardIndex(board, card);
  const moving = board.cards[from];
  if (from < 0 || !moving) return null;
  // Not a place on the board: guessing one would reorder the binder unasked.
  if (typeof gap !== 'number' || Number.isNaN(gap)) return null;
  const count = board.cards.length;
  const at = Math.max(0, Math.min(count, Math.trunc(gap)));
  if (at === from || at === from + 1) return null;

  const ref = cardRef(moving);
  if (at === 0) return { ref, placement: { at: 'start', parentId: board.parentId } };
  if (at === count) return { ref, placement: { at: 'end', parentId: board.parentId } };
  const before = board.cards[at - 1];
  if (!before) return null;
  return { ref, placement: { at: 'after', sibling: cardRef(before) } };
}

/**
 * The move for a scene's card dropped onto a folder's card: the scene goes
 * into that folder, at its end. It is the binder's own "move into folder",
 * so the store treats it the same.
 *
 * Null when there is nothing to move: one of the two is not on the board,
 * the card that is moved is not a scene (a folder is put into another one
 * from the binder, where its whole contents can be seen), or what it is
 * dropped onto is not a folder.
 *
 * @param card the card that is moved, or a reference to its binder node
 * @param onto the card it is dropped onto, or a reference to its binder node
 */
export function dropInto(board: Board, card: NodeRef, onto: NodeRef): CardMove | null {
  const moving = board.cards[cardIndex(board, card)];
  const target = board.cards[cardIndex(board, onto)];
  if (!moving || !target || moving.kind !== 'scene' || target.kind !== 'folder') return null;
  return { ref: cardRef(moving), placement: { at: 'end', parentId: target.id } };
}
