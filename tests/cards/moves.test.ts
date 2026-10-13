// Moving cards: every move is checked by handing its placement to the real
// binder code (the same moveNode the project store uses) and looking at the
// order that comes out.

import { describe, expect, it } from 'vitest';
import { buildBoard, cardIndex, cardRef, dropAt, folderScope, moveEarlier, moveLater } from '../../src/core/cards';
import type { Board, BoardScope, CardMove } from '../../src/core/cards';
import { childrenOf, flattenScenes, folderRef, moveNode, sceneRef } from '../../src/core/binderTree';
import type { Binder, BinderNode, NodeRef } from '../../src/core/types';
import { HEBREW, deepFreeze, folderNode, sampleLists, sceneNode, treeOf } from './helpers';

const lists = sampleLists();

// Manuscript
//   A
//   Part one   (folder)
//     C
//     Inner    (folder)
//       E
//     <Hebrew: The letter>
//     F
//   B
//   Part two   (folder)
//     G
//   D
const binder: Binder = deepFreeze([
  sceneNode('A'),
  folderNode('Part one', [sceneNode('C'), folderNode('Inner', [sceneNode('E')]), sceneNode(HEBREW.letter), sceneNode('F')]),
  sceneNode('B'),
  folderNode('Part two', [sceneNode('G')]),
  sceneNode('D'),
]);

const TOP = ['A', '[Part one]', 'B', '[Part two]', 'D'];
const PART_ONE = ['C', '[Inner]', HEBREW.letter, 'F'];
const PART_ONE_SCOPE = folderScope('f-Part one');

function boardOf(tree: Binder, scope?: BoardScope): Board {
  return buildBoard({ tree: treeOf(tree), scope, sceneOf: () => undefined, lists });
}

function label(node: BinderNode): string {
  return node.kind === 'folder' ? `[${node.name}]` : node.path.slice('Manuscript/'.length, -3);
}

/** The order of one binder folder (null for the top level), as short labels. */
function orderIn(tree: Binder, parentId: string | null): string[] {
  const children = childrenOf(tree, parentId);
  if (children === null) throw new Error(`no folder ${String(parentId)}`);
  return children.map(label);
}

/** Apply a move with the binder's own code and return the new tree. */
function apply(tree: Binder, move: CardMove | null): Binder {
  if (move === null) throw new Error('expected a move');
  const result = moveNode(tree, move.ref, move.placement);
  if (!result.ok) throw new Error(`the binder refused the move: ${result.reason}`);
  return result.binder;
}

function ref(name: string): NodeRef {
  return name.startsWith('[') ? folderRef(`f-${name.slice(1, -1)}`) : sceneRef(`Manuscript/${name}.md`);
}

describe('cardRef and cardIndex', () => {
  it('names the binder node behind a card: a scene by path, a folder by id', () => {
    const board = boardOf(binder);
    expect(board.cards.map(cardRef)).toEqual([
      { kind: 'scene', path: 'Manuscript/A.md' },
      { kind: 'folder', id: 'f-Part one' },
      { kind: 'scene', path: 'Manuscript/B.md' },
      { kind: 'folder', id: 'f-Part two' },
      { kind: 'scene', path: 'Manuscript/D.md' },
    ]);
  });

  it('finds a card by the card itself or by a reference to its node', () => {
    const board = boardOf(binder);
    board.cards.forEach((card, position) => {
      expect(cardIndex(board, card)).toBe(position);
      expect(cardIndex(board, cardRef(card))).toBe(position);
    });
    expect(cardIndex(board, sceneRef('Manuscript/C.md'))).toBe(-1); // inside a folder, not on this board
    expect(cardIndex(board, folderRef('f-Inner'))).toBe(-1);
    expect(cardIndex(board, sceneRef('Manuscript/Nowhere.md'))).toBe(-1);
  });

  it('finds a Hebrew scene however its name is stored', () => {
    // A pointed letter may be stored as one code or as a letter and a mark.
    const stored = '\u{5E9}\u{5C1}\u{5DC}\u{5D5}\u{5DD}';
    const typed = '\u{FB2A}\u{5DC}\u{5D5}\u{5DD}';
    expect(typed).not.toBe(stored);
    const board = boardOf([sceneNode('A'), sceneNode(stored)]);
    expect(cardIndex(board, sceneRef(`Manuscript/${typed}.md`))).toBe(1);
  });
});

describe('moveEarlier', () => {
  it('swaps a card with the one before it', () => {
    const board = boardOf(binder);
    expect(orderIn(apply(binder, moveEarlier(board, ref('B'))), null)).toEqual(['A', 'B', '[Part one]', '[Part two]', 'D']);
    expect(orderIn(apply(binder, moveEarlier(board, ref('D'))), null)).toEqual(['A', '[Part one]', 'B', 'D', '[Part two]']);
  });

  it('gives a placement before the previous card', () => {
    expect(moveEarlier(boardOf(binder), ref('B'))).toEqual({
      ref: { kind: 'scene', path: 'Manuscript/B.md' },
      placement: { at: 'before', sibling: { kind: 'folder', id: 'f-Part one' } },
    });
  });

  it('has nothing to do for the first card, or for a card that is not on the board', () => {
    const board = boardOf(binder);
    expect(moveEarlier(board, ref('A'))).toBeNull();
    expect(moveEarlier(board, ref('C'))).toBeNull();
    expect(moveEarlier(board, ref('Nowhere'))).toBeNull();
    expect(moveEarlier(boardOf([]), ref('A'))).toBeNull();
  });

  it('accepts the card itself in place of a reference', () => {
    const board = boardOf(binder);
    const card = board.cards[2];
    if (!card) throw new Error('no card');
    expect(moveEarlier(board, card)).toEqual(moveEarlier(board, ref('B')));
    // The reference handed to the store is clean: it carries nothing of the card.
    expect(moveEarlier(board, card)?.ref).toEqual({ kind: 'scene', path: 'Manuscript/B.md' });
  });

  it('moves within a folder without leaving it', () => {
    const board = boardOf(binder, PART_ONE_SCOPE);
    const moved = apply(binder, moveEarlier(board, ref(HEBREW.letter)));
    expect(orderIn(moved, 'f-Part one')).toEqual(['C', HEBREW.letter, '[Inner]', 'F']);
    expect(orderIn(moved, null)).toEqual(TOP);
    expect(orderIn(moved, 'f-Inner')).toEqual(['E']);
  });
});

describe('moveLater', () => {
  it('swaps a card with the one after it', () => {
    const board = boardOf(binder);
    expect(orderIn(apply(binder, moveLater(board, ref('A'))), null)).toEqual(['[Part one]', 'A', 'B', '[Part two]', 'D']);
    expect(orderIn(apply(binder, moveLater(board, ref('B'))), null)).toEqual(['A', '[Part one]', '[Part two]', 'B', 'D']);
  });

  it('gives a placement after the next card', () => {
    expect(moveLater(boardOf(binder), ref('B'))).toEqual({
      ref: { kind: 'scene', path: 'Manuscript/B.md' },
      placement: { at: 'after', sibling: { kind: 'folder', id: 'f-Part two' } },
    });
  });

  it('has nothing to do for the last card, or for a card that is not on the board', () => {
    const board = boardOf(binder);
    expect(moveLater(board, ref('D'))).toBeNull();
    expect(moveLater(board, ref('G'))).toBeNull();
    expect(moveLater(board, ref('Nowhere'))).toBeNull();
    expect(moveLater(boardOf([sceneNode('A')]), ref('A'))).toBeNull();
  });

  it('moves a Hebrew scene within its folder', () => {
    const board = boardOf(binder, PART_ONE_SCOPE);
    expect(orderIn(apply(binder, moveLater(board, ref(HEBREW.letter))), 'f-Part one')).toEqual(['C', '[Inner]', 'F', HEBREW.letter]);
  });

  it('undoes moveEarlier', () => {
    const board = boardOf(binder);
    const earlier = apply(binder, moveEarlier(board, ref('B')));
    const back = apply(earlier, moveLater(boardOf(earlier), ref('B')));
    expect(back).toEqual(binder);
  });
});

describe('a folder card', () => {
  it('moves the whole folder, with everything in it, in one step', () => {
    const board = boardOf(binder);
    const moved = apply(binder, moveLater(board, ref('[Part one]')));
    expect(orderIn(moved, null)).toEqual(['A', 'B', '[Part one]', '[Part two]', 'D']);
    expect(orderIn(moved, 'f-Part one')).toEqual(PART_ONE);
    expect(orderIn(moved, 'f-Inner')).toEqual(['E']);
    // The manuscript order follows: everything in the folder now comes after B.
    expect(flattenScenes(moved).map((path) => path.slice('Manuscript/'.length, -3))).toEqual(['A', 'B', 'C', 'E', HEBREW.letter, 'F', 'G', 'D']);
  });

  it('is moved by its folder id', () => {
    const move = dropAt(boardOf(binder), ref('[Part two]'), 0);
    expect(move).toEqual({ ref: { kind: 'folder', id: 'f-Part two' }, placement: { at: 'start', parentId: null } });
    expect(orderIn(apply(binder, move), null)).toEqual(['[Part two]', 'A', '[Part one]', 'B', 'D']);
  });

  it('can be dropped anywhere among the cards of a folder', () => {
    const board = boardOf(binder, PART_ONE_SCOPE);
    const moved = apply(binder, dropAt(board, ref('[Inner]'), 4));
    expect(orderIn(moved, 'f-Part one')).toEqual(['C', HEBREW.letter, 'F', '[Inner]']);
    expect(orderIn(moved, 'f-Inner')).toEqual(['E']);
  });
});

describe('dropAt', () => {
  /** What the order should be after dropping card `from` into gap `gap`. */
  function expected(order: readonly string[], from: number, gap: number): string[] {
    const without = order.filter((_, index) => index !== from);
    without.splice(gap > from ? gap - 1 : gap, 0, order[from] as string);
    return without;
  }

  for (const [where, scope, parentId, order] of [
    ['the manuscript', undefined, null, TOP],
    ['a folder', PART_ONE_SCOPE, 'f-Part one', PART_ONE],
  ] as const) {
    it(`puts any card of ${where} into any gap, exactly where it was dropped`, () => {
      const board = boardOf(binder, scope);
      expect(board.cards).toHaveLength(order.length);
      for (let from = 0; from < order.length; from++) {
        for (let gap = 0; gap <= order.length; gap++) {
          const move = dropAt(board, ref(order[from] as string), gap);
          const what = `${order[from]} into gap ${gap}`;
          if (gap === from || gap === from + 1) {
            // The two gaps beside the card itself: nothing to do.
            expect(move, what).toBeNull();
            continue;
          }
          const moved = apply(binder, move);
          expect(orderIn(moved, parentId), what).toEqual(expected(order, from, gap));
          // Nothing left the folder or came into it, and nothing else moved.
          expect(flattenScenes(moved).sort(), what).toEqual(flattenScenes(binder).sort());
          const other = parentId === null ? 'f-Part one' : null;
          expect(orderIn(moved, other), what).toEqual(orderIn(binder, other));
        }
      }
    });
  }

  it('uses the start and the end of the folder for the first and the last gap', () => {
    const board = boardOf(binder, PART_ONE_SCOPE);
    expect(dropAt(board, ref('F'), 0)?.placement).toEqual({ at: 'start', parentId: 'f-Part one' });
    expect(dropAt(board, ref('C'), 4)?.placement).toEqual({ at: 'end', parentId: 'f-Part one' });
    const top = boardOf(binder);
    expect(dropAt(top, ref('D'), 0)?.placement).toEqual({ at: 'start', parentId: null });
    expect(dropAt(top, ref('A'), 5)?.placement).toEqual({ at: 'end', parentId: null });
  });

  it('places a card after the card in front of the gap', () => {
    expect(dropAt(boardOf(binder), ref('D'), 2)).toEqual({
      ref: { kind: 'scene', path: 'Manuscript/D.md' },
      placement: { at: 'after', sibling: { kind: 'folder', id: 'f-Part one' } },
    });
  });

  it('takes a gap past the end as the end, and one before the start as the start', () => {
    const board = boardOf(binder);
    expect(dropAt(board, ref('A'), 99)?.placement).toEqual({ at: 'end', parentId: null });
    expect(dropAt(board, ref('A'), Number.POSITIVE_INFINITY)?.placement).toEqual({ at: 'end', parentId: null });
    expect(dropAt(board, ref('A'), Number.NaN)?.placement).toEqual({ at: 'end', parentId: null });
    expect(dropAt(board, ref('D'), -3)?.placement).toEqual({ at: 'start', parentId: null });
    expect(dropAt(board, ref('D'), 99)).toBeNull(); // the last card is already at the end
    expect(dropAt(board, ref('A'), -3)).toBeNull();
    // A gap that is not a whole number counts as the gap below it.
    expect(dropAt(board, ref('D'), 2.9)?.placement).toEqual({ at: 'after', sibling: { kind: 'folder', id: 'f-Part one' } });
  });

  it('has nothing to do for a card that is not on the board', () => {
    const board = boardOf(binder);
    expect(dropAt(board, ref('C'), 0)).toBeNull();
    expect(dropAt(board, ref('Nowhere'), 2)).toBeNull();
    expect(dropAt(boardOf([]), ref('A'), 0)).toBeNull();
  });

  it('has nothing to do on a board with a single card', () => {
    const board = boardOf([sceneNode('A')]);
    expect(dropAt(board, ref('A'), 0)).toBeNull();
    expect(dropAt(board, ref('A'), 1)).toBeNull();
  });

  it('agrees with moveEarlier and moveLater about where a card ends up', () => {
    const board = boardOf(binder);
    for (let from = 0; from < TOP.length; from++) {
      const card = ref(TOP[from] as string);
      const earlier = moveEarlier(board, card);
      const later = moveLater(board, card);
      if (earlier) expect(orderIn(apply(binder, earlier), null)).toEqual(orderIn(apply(binder, dropAt(board, card, from - 1)), null));
      if (later) expect(orderIn(apply(binder, later), null)).toEqual(orderIn(apply(binder, dropAt(board, card, from + 2)), null));
    }
  });

  it('never changes the board it reads', () => {
    const board = deepFreeze(boardOf(binder));
    expect(() => dropAt(board, ref('A'), 3)).not.toThrow();
    expect(() => moveEarlier(board, ref('B'))).not.toThrow();
    expect(() => moveLater(board, ref('B'))).not.toThrow();
  });
});
