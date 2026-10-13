// Dragging cards on the corkboard: with a mouse, and with a finger after a
// long press. The stand-in elements lay nothing out, so each test gives the
// cards their places first.

import { beforeEach, describe, expect, it } from 'vitest';
import { buildBoard, dropAt, dropInto, folderScope } from '../../../src/core/cards';
import type { Board } from '../../../src/core/cards';
import { DROP_AFTER_CLASS, DROP_BEFORE_CLASS, DROP_INTO_CLASS } from '../../../src/features/corkboard/corkboardView';
import { DRAGGED_CLASS, DRAG_ACTIVE_CLASS, GHOST_CLASS, TOUCH_HOLD_MS } from '../../../src/ui/dragDrop';
import { point } from '../../binderScreen';
import { fakeDocument } from '../../obsidianStub';
import type { FakeElement } from '../../obsidianStub';
import {
  CLOSING,
  FakeHost,
  INNER_NAME,
  OPENING,
  cardOf,
  cardsOf,
  clearScreen,
  novelHost,
  novelIndex,
  novelTree,
  one,
  openBoard,
  rest,
  titles,
} from './stage';

beforeEach(() => {
  clearScreen();
});

const CARD_WIDTH = 200;
const CARD_HEIGHT = 100;
const GAP = 12;
const BOARD_TOP = 100;
const PADDING = 20;

/**
 * Give the board and its cards places on the screen, as a browser's layout
 * would: `columns` cards side by side, starting at the left (or, for an app
 * that reads right to left, at the right).
 */
function layOut(pane: FakeElement, columns: number, rtl = false): void {
  const scroll = one(pane, 'spellbook-board-scroll');
  const width = columns * CARD_WIDTH + (columns - 1) * GAP + 2 * PADDING;
  scroll.rect = { top: BOARD_TOP, bottom: BOARD_TOP + 600, left: 0, right: width, width, height: 600 };
  cardsOf(pane).forEach((card, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const start = PADDING + column * (CARD_WIDTH + GAP);
    const left = rtl ? width - start - CARD_WIDTH : start;
    const top = BOARD_TOP + PADDING + row * (CARD_HEIGHT + GAP) - scroll.scrollTop;
    card.rect = { top, bottom: top + CARD_HEIGHT, left, right: left + CARD_WIDTH, width: CARD_WIDTH, height: CARD_HEIGHT };
  });
}

const middle = (card: FakeElement): { x: number; y: number } => ({
  x: (card.rect.left + card.rect.right) / 2,
  y: (card.rect.top + card.rect.bottom) / 2,
});

/** Where a press on a card lands: on its title. */
const gripOf = (card: FakeElement): FakeElement => one(card, 'spellbook-card-title');

/** Pick a card up with the mouse and carry it to a place on the screen, without letting go. */
function carry(card: FakeElement, x: number, y: number): void {
  const from = middle(card);
  point(gripOf(card), 'pointerdown', from.x, from.y);
  // The first move starts the drag; the second is the place itself.
  point(gripOf(card), 'pointermove', from.x + 6, from.y);
  point(gripOf(card), 'pointermove', x, y);
}

function letGo(card: FakeElement, x: number, y: number): void {
  point(gripOf(card), 'pointerup', x, y);
}

/** The cards that carry a mark for the place a drop would go to, as "title: mark". */
function marks(pane: FakeElement): string[] {
  return cardsOf(pane).flatMap((card) => {
    const title = card.withClass('spellbook-card-title')[0]?.text ?? '';
    if (card.hasClass(DROP_BEFORE_CLASS)) return [`${title}: before`];
    if (card.hasClass(DROP_AFTER_CLASS)) return [`${title}: after`];
    return [];
  });
}

/** The titles of the folder cards that are marked as where a drop would put the scene into. */
function into(pane: FakeElement): string[] {
  return cardsOf(pane)
    .filter((card) => card.hasClass(DROP_INTO_CLASS))
    .map((card) => card.withClass('spellbook-card-title')[0]?.text ?? '');
}

function boardOf(host: FakeHost, scope = undefined as ReturnType<typeof folderScope> | undefined): Board {
  return buildBoard({ tree: host.project!.tree, scope, sceneOf: () => null, lists: host.project!.lists });
}

describe('dragging a card with the mouse', () => {
  it('shows where it would go, and asks the host for the move the engine works out', async () => {
    const host = novelHost();
    const { pane } = await openBoard(host);
    layOut(pane, 4);
    const card = cardOf(pane, 'Opening');
    const closing = cardOf(pane, 'Closing');
    const at = { x: closing.rect.left + 10, y: middle(closing).y };

    carry(card, at.x, at.y);
    expect(card.hasClass(DRAGGED_CLASS)).toBe(true);
    expect(one(pane, 'spellbook-board-scroll').hasClass(DRAG_ACTIVE_CLASS)).toBe(true);
    const ghost = fakeDocument.body.withClass(GHOST_CLASS);
    expect(ghost).toHaveLength(1);
    // The ghost shows the card's title, which is the writer's own text.
    expect(ghost[0]?.children.map((child) => [child.text, child.attrs['dir']])).toEqual([['Opening', 'auto']]);
    // In front of the last card.
    expect(marks(pane)).toEqual(['Closing: before']);
    expect(host.moves).toEqual([]);

    const before = boardOf(host);
    letGo(card, at.x, at.y);
    expect(host.moves).toEqual([dropAt(before, { kind: 'scene', path: OPENING }, 3)]);
    expect(host.moves[0]?.placement).toEqual({ at: 'after', sibling: { kind: 'scene', path: 'Manuscript/Ghost.md' } });
    // Everything the drag put on the screen is gone again.
    expect(marks(pane)).toEqual([]);
    expect(card.hasClass(DRAGGED_CLASS)).toBe(false);
    expect(fakeDocument.body.withClass(GHOST_CLASS)).toEqual([]);

    await rest(host);
    expect(titles(pane)).toEqual(['Part one', 'Ghost', 'Opening', 'Closing']);
    // The click that the same press brings is the drag's: it opens nothing.
    card.fire('click', { button: 0 });
    expect(host.opened).toEqual([]);
  });

  it('puts a card at the end when it is dropped past the last card', async () => {
    const host = novelHost();
    const { pane } = await openBoard(host);
    layOut(pane, 4);
    const closing = cardOf(pane, 'Closing');
    const at = { x: closing.rect.right - 10, y: middle(closing).y };
    carry(cardOf(pane, 'Opening'), at.x, at.y);
    expect(marks(pane)).toEqual(['Closing: after']);
    letGo(cardOf(pane, 'Opening'), at.x, at.y);
    expect(host.moves.map((move) => move.placement)).toEqual([{ at: 'end', parentId: null }]);
  });

  it('follows the pointer from gap to gap, and marks nothing where a drop would change nothing', async () => {
    const host = novelHost();
    const { pane } = await openBoard(host);
    layOut(pane, 2);
    const card = cardOf(pane, 'Part one');
    const ghost = cardOf(pane, 'Ghost');
    // Onto the first half of the card below: in front of it, which is at the start of the second row.
    carry(card, ghost.rect.left + 10, middle(ghost).y);
    expect(marks(pane)).toEqual([]); // that is where "Part one" already ends: nothing would change
    // The first half of the first card: the start of the board.
    point(gripOf(card), 'pointermove', cardOf(pane, 'Opening').rect.left + 10, middle(card).y);
    expect(marks(pane)).toEqual(['Opening: before']);
    // The second half of the card below: between "Ghost" and "Closing".
    point(gripOf(card), 'pointermove', ghost.rect.right - 10, middle(ghost).y);
    expect(marks(pane)).toEqual(['Closing: before']);
    // Beside the board is nowhere.
    point(gripOf(card), 'pointermove', 5000, middle(ghost).y);
    expect(marks(pane)).toEqual([]);
    letGo(card, 5000, middle(ghost).y);
    expect(host.moves).toEqual([]);
  });

  it('moves a folder card too, inside the folder the board shows', async () => {
    const host = novelHost();
    const { pane, view } = await openBoard(host);
    view.showScope(folderScope('f-one'));
    layOut(pane, 3);
    const folder = cardOf(pane, INNER_NAME);
    const letter = cardOf(pane, 'The Letter');
    carry(folder, letter.rect.left + 10, middle(letter).y);
    expect(marks(pane)).toEqual(['The Letter: before']);
    letGo(folder, letter.rect.left + 10, middle(letter).y);
    expect(host.moves).toEqual([{ ref: { kind: 'folder', id: 'f-inner' }, placement: { at: 'start', parentId: 'f-one' } }]);
    await rest(host);
    expect(titles(pane)).toEqual([INNER_NAME, 'The Letter']);
  });

  it('puts a scene into a folder when it is dropped onto the middle of the folder\'s card', async () => {
    const host = novelHost();
    const { pane } = await openBoard(host);
    layOut(pane, 4);
    const card = cardOf(pane, 'Closing');
    const folder = cardOf(pane, 'Part one');
    const at = middle(folder);

    carry(card, at.x, at.y);
    // The folder itself is marked, and no gap is.
    expect(into(pane)).toEqual(['Part one']);
    expect(marks(pane)).toEqual([]);
    // On to the edge of the folder's card: that is the gap beside it, as before.
    point(gripOf(card), 'pointermove', folder.rect.left + 10, at.y);
    expect(into(pane)).toEqual([]);
    expect(marks(pane)).toEqual(['Part one: before']);
    point(gripOf(card), 'pointermove', folder.rect.right - 10, at.y);
    expect(into(pane)).toEqual([]);
    expect(marks(pane)).toEqual(['Ghost: before']);
    // And back onto its middle.
    point(gripOf(card), 'pointermove', at.x + 20, at.y - 30);
    expect(into(pane)).toEqual(['Part one']);
    expect(marks(pane)).toEqual([]);
    expect(host.moves).toEqual([]);

    const before = boardOf(host);
    letGo(card, at.x + 20, at.y - 30);
    // The move the binder itself makes for "move into folder": the end of that folder.
    expect(host.moves).toEqual([dropInto(before, { kind: 'scene', path: CLOSING }, { kind: 'folder', id: 'f-one' })]);
    expect(host.moves).toEqual([{ ref: { kind: 'scene', path: CLOSING }, placement: { at: 'end', parentId: 'f-one' } }]);
    expect(into(pane)).toEqual([]);
    expect(fakeDocument.body.withClass(GHOST_CLASS)).toEqual([]);

    await rest(host);
    // It is off the manuscript's own level now: it is inside the folder.
    expect(titles(pane)).toEqual(['Opening', 'Part one', 'Ghost']);
  });

  it('shows the scene inside the folder afterwards, at its end', async () => {
    const host = novelHost();
    const { pane, view } = await openBoard(host);
    layOut(pane, 4);
    const card = cardOf(pane, 'Opening');
    const at = middle(cardOf(pane, 'Part one'));
    carry(card, at.x, at.y);
    letGo(card, at.x, at.y);
    await rest(host);
    view.showScope(folderScope('f-one'));
    await rest(host);
    expect(titles(pane)).toEqual(['The Letter', INNER_NAME, 'Opening']);
  });

  it('only takes a scene onto a folder: a scene on the middle of a scene goes into the gap, as it did', async () => {
    const host = novelHost();
    const { pane } = await openBoard(host);
    layOut(pane, 4);
    const card = cardOf(pane, 'Closing');
    const opening = cardOf(pane, 'Opening');
    carry(card, middle(opening).x - 1, middle(opening).y);
    expect(into(pane)).toEqual([]);
    expect(marks(pane)).toEqual(['Opening: before']);
    letGo(card, middle(opening).x - 1, middle(opening).y);
    expect(host.moves.map((move) => move.placement)).toEqual([{ at: 'start', parentId: null }]);
  });

  it('puts a scene into a folder inside the folder the board shows', async () => {
    const host = novelHost();
    const { pane, view } = await openBoard(host);
    view.showScope(folderScope('f-one'));
    layOut(pane, 3);
    const letter = cardOf(pane, 'The Letter');
    const inner = cardOf(pane, INNER_NAME);
    carry(letter, middle(inner).x, middle(inner).y);
    expect(into(pane)).toEqual([INNER_NAME]);
    letGo(letter, middle(inner).x, middle(inner).y);
    expect(host.moves).toEqual([{ ref: { kind: 'scene', path: 'Manuscript/The Letter.md' }, placement: { at: 'end', parentId: 'f-inner' } }]);
    // A folder's own card held over itself, or over nothing it can go into, marks no folder.
    await rest(host);
    layOut(pane, 3);
    const folder = cardOf(pane, INNER_NAME);
    carry(folder, middle(folder).x, middle(folder).y);
    expect(into(pane)).toEqual([]);
    letGo(folder, middle(folder).x, middle(folder).y);
    expect(host.moves).toHaveLength(1);
  });

  it('drops nothing when Escape is pressed', async () => {
    const host = novelHost();
    const { pane } = await openBoard(host);
    layOut(pane, 4);
    const card = cardOf(pane, 'Opening');
    const closing = cardOf(pane, 'Closing');
    // Held over a folder: the mark goes with the drag.
    carry(card, middle(cardOf(pane, 'Part one')).x, middle(closing).y);
    expect(into(pane)).toEqual(['Part one']);
    point(gripOf(card), 'pointermove', closing.rect.left + 10, middle(closing).y);
    expect(into(pane)).toEqual([]);
    expect(marks(pane)).toEqual(['Closing: before']);
    card.fire('keydown', { key: 'Escape' });
    expect(marks(pane)).toEqual([]);
    expect(card.hasClass(DRAGGED_CLASS)).toBe(false);
    letGo(card, closing.rect.left + 10, middle(closing).y);
    expect(host.moves).toEqual([]);
  });

  it('goes by the height of the pointer in a single column, as on a phone', async () => {
    const host = novelHost();
    const { pane } = await openBoard(host);
    layOut(pane, 1);
    const card = cardOf(pane, 'Closing');
    const folder = cardOf(pane, 'Part one');
    // The upper half of the second card: in front of it.
    carry(card, folder.rect.right - 5, folder.rect.top + 10);
    expect(marks(pane)).toEqual(['Part one: before']);
    // Its lower half: after it.
    point(gripOf(card), 'pointermove', folder.rect.left + 5, folder.rect.bottom - 10);
    expect(marks(pane)).toEqual(['Ghost: before']);
    letGo(card, folder.rect.left + 5, folder.rect.bottom - 10);
    expect(host.moves.map((move) => move.placement)).toEqual([{ at: 'after', sibling: { kind: 'folder', id: 'f-one' } }]);
  });

  it('starts a row at the right when Obsidian reads right to left', async () => {
    const host = novelHost();
    const { pane } = await openBoard(host);
    pane.setAttr('dir', 'rtl');
    layOut(pane, 4, true);
    const card = cardOf(pane, 'Closing');
    const opening = cardOf(pane, 'Opening');
    // The first card is the rightmost one; its right half is its start.
    carry(card, opening.rect.right - 10, middle(opening).y);
    expect(marks(pane)).toEqual(['Opening: before']);
    letGo(card, opening.rect.right - 10, middle(opening).y);
    expect(host.moves.map((move) => move.placement)).toEqual([{ at: 'start', parentId: null }]);
  });
});

describe('what cannot be dragged', () => {
  it('leaves a press on the "more" button to the button', async () => {
    const host = novelHost();
    const { pane } = await openBoard(host);
    layOut(pane, 4);
    const card = cardOf(pane, 'Opening');
    const more = one(card, 'spellbook-card-more');
    const from = middle(card);
    point(more, 'pointerdown', from.x, from.y);
    point(more, 'pointermove', from.x + 60, from.y);
    expect(card.hasClass(DRAGGED_CLASS)).toBe(false);
    expect(fakeDocument.body.withClass(GHOST_CLASS)).toEqual([]);
  });

  it('moves nothing in a read-only project, and does not pick up a scene whose note is missing', async () => {
    const host = novelHost();
    const { pane } = await openBoard(host);
    layOut(pane, 4);
    const missing = cardOf(pane, 'Ghost');
    carry(missing, cardOf(pane, 'Opening').rect.left + 10, middle(missing).y);
    expect(missing.hasClass(DRAGGED_CLASS)).toBe(false);
    letGo(missing, 0, 0);

    host.open(novelTree(), novelIndex(), { readOnly: true });
    await rest(host);
    layOut(pane, 4);
    const card = cardOf(pane, 'Closing');
    carry(card, cardOf(pane, 'Opening').rect.left + 10, middle(card).y);
    expect(card.hasClass(DRAGGED_CLASS)).toBe(false);
    letGo(card, 0, 0);
    expect(host.moves).toEqual([]);
  });
});

describe('dragging a card with a finger', () => {
  it('picks the card up after a long press, and drops it like the mouse does', async () => {
    const host = novelHost();
    const { pane } = await openBoard(host);
    layOut(pane, 1);
    const card = cardOf(pane, 'Closing');
    const opening = cardOf(pane, 'Opening');
    const from = middle(card);
    point(gripOf(card), 'pointerdown', from.x, from.y, 'touch');
    expect(card.hasClass(DRAGGED_CLASS)).toBe(false);
    host.timers.advance(TOUCH_HOLD_MS);
    expect(card.hasClass(DRAGGED_CLASS)).toBe(true);

    point(gripOf(card), 'pointermove', from.x, opening.rect.top + 10, 'touch');
    expect(marks(pane)).toEqual(['Opening: before']);
    point(gripOf(card), 'pointerup', from.x, opening.rect.top + 10, 'touch');
    expect(host.moves).toEqual([{ ref: { kind: 'scene', path: CLOSING }, placement: { at: 'start', parentId: null } }]);
    await rest(host);
    expect(titles(pane)).toEqual(['Closing', 'Opening', 'Part one', 'Ghost']);
  });

  it('takes a finger that moves before the long press is over for scrolling', async () => {
    const host = novelHost();
    const { pane } = await openBoard(host);
    layOut(pane, 1);
    const card = cardOf(pane, 'Closing');
    const from = middle(card);
    point(gripOf(card), 'pointerdown', from.x, from.y, 'touch');
    point(gripOf(card), 'pointermove', from.x, from.y - 40, 'touch');
    host.timers.advance(TOUCH_HOLD_MS);
    expect(card.hasClass(DRAGGED_CLASS)).toBe(false);
    point(gripOf(card), 'pointerup', from.x, from.y - 40, 'touch');
    expect(host.moves).toEqual([]);
  });
});
