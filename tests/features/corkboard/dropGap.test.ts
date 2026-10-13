// Finding the gap between cards that a pointer is at.

import { describe, expect, it } from 'vitest';
import { CARD_EDGE_SHARE, cardAt, gapAt } from '../../../src/features/corkboard/dropGap';
import type { CardBox } from '../../../src/features/corkboard/dropGap';

/** Cards of 100 by 80 with 10 between them, in rows of `columns`, starting at the left or (rtl) at the right. */
function boxes(count: number, columns: number, rtl = false): CardBox[] {
  const width = columns * 100 + (columns - 1) * 10;
  return Array.from({ length: count }, (_, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const start = column * 110;
    const left = rtl ? width - start - 100 : start;
    return { top: row * 90, bottom: row * 90 + 80, left, right: left + 100 };
  });
}

describe('gapAt', () => {
  it('has no gap on a board without cards, or for a place that is not a number', () => {
    expect(gapAt([], 10, 10, false)).toBeNull();
    expect(gapAt(boxes(3, 3), Number.NaN, 10, false)).toBeNull();
    expect(gapAt(boxes(3, 3), 10, Number.NaN, false)).toBeNull();
  });

  it('goes by the middle of the card under the pointer', () => {
    const row = boxes(3, 3);
    expect(gapAt(row, 10, 40, false)).toBe(0);
    expect(gapAt(row, 49, 40, false)).toBe(0);
    expect(gapAt(row, 51, 40, false)).toBe(1);
    expect(gapAt(row, 105, 40, false)).toBe(1); // in the space between the first two
    expect(gapAt(row, 161, 40, false)).toBe(2);
    expect(gapAt(row, 300, 40, false)).toBe(3); // past the middle of the last card: the end
  });

  it('reads row by row', () => {
    const grid = boxes(5, 3);
    expect(gapAt(grid, 10, -20, false)).toBe(0); // above the board: the start
    expect(gapAt(grid, 300, 40, false)).toBe(3); // the end of the first row
    expect(gapAt(grid, 200, 85, false)).toBe(3); // between the rows: the end of the row above
    expect(gapAt(grid, 10, 120, false)).toBe(3); // the start of the second row is the same gap
    expect(gapAt(grid, 60, 120, false)).toBe(4);
    expect(gapAt(grid, 300, 120, false)).toBe(5); // beside the last card of a short row: the end
    expect(gapAt(grid, 10, 500, false)).toBe(5); // below the board: the end
  });

  it('starts a row at the right when the app reads right to left', () => {
    const row = boxes(3, 3, true);
    // The first card is the rightmost: from 220 to 320, with its middle at 270.
    expect(gapAt(row, 310, 40, true)).toBe(0);
    expect(gapAt(row, 271, 40, true)).toBe(0);
    expect(gapAt(row, 269, 40, true)).toBe(1);
    expect(gapAt(row, 10, 40, true)).toBe(3);
  });

  it('goes by the height of the pointer in a single column, as on a phone', () => {
    const column = boxes(3, 1);
    // Above the middle of a card is in front of it, below is after it, wherever across the pointer is.
    expect(gapAt(column, 10, 30, false)).toBe(0);
    expect(gapAt(column, 90, 30, false)).toBe(0);
    expect(gapAt(column, 10, 50, false)).toBe(1);
    expect(gapAt(column, 90, 85, false)).toBe(1); // in the space between the first two
    expect(gapAt(column, 10, 140, false)).toBe(2);
    expect(gapAt(column, 10, 500, false)).toBe(3);
    // The same when the app reads right to left.
    expect(gapAt(boxes(3, 1, true), 50, 50, true)).toBe(1);
    // A board with one card on it.
    expect(gapAt(boxes(1, 3), 0, 10, false)).toBe(0);
    expect(gapAt(boxes(1, 3), 0, 70, false)).toBe(1);
  });
});

describe('cardAt: the card a pointer is on', () => {
  it('is on no card on a board without cards, or for a place that is not a number', () => {
    expect(cardAt([], 10, 10)).toBeNull();
    expect(cardAt(boxes(3, 3), Number.NaN, 10)).toBeNull();
    expect(cardAt(boxes(3, 3), 10, Number.NaN)).toBeNull();
  });

  it('side by side: the middle half of a card\'s width is the card, its two ends are the gaps beside it', () => {
    const row = boxes(3, 3); // cards at 0-100, 110-210, 220-320
    expect(CARD_EDGE_SHARE).toBe(0.25);
    expect(cardAt(row, 24, 40)).toBeNull();
    expect(cardAt(row, 25, 40)).toBe(0);
    expect(cardAt(row, 50, 40)).toBe(0);
    expect(cardAt(row, 75, 40)).toBe(0);
    expect(cardAt(row, 76, 40)).toBeNull();
    expect(cardAt(row, 160, 5)).toBe(1); // anywhere down the card's height
    expect(cardAt(row, 160, 79)).toBe(1);
    expect(cardAt(row, 270, 40)).toBe(2);
    // Between two cards, above the row and below it: on no card.
    expect(cardAt(row, 105, 40)).toBeNull();
    expect(cardAt(row, 160, -1)).toBeNull();
    expect(cardAt(row, 160, 81)).toBeNull();
    // The second row.
    expect(cardAt(boxes(5, 3), 160, 130)).toBe(4);
    // It makes no difference which way the app reads: a card's middle is its middle.
    expect(cardAt(boxes(3, 3, true), 270, 40)).toBe(0);
  });

  it('in a single column: the middle half of a card\'s height', () => {
    const column = boxes(3, 1); // cards at 0-80, 90-170, 180-260
    expect(cardAt(column, 50, 19)).toBeNull();
    expect(cardAt(column, 50, 20)).toBe(0);
    expect(cardAt(column, 5, 40)).toBe(0); // anywhere across the card's width
    expect(cardAt(column, 95, 60)).toBe(0);
    expect(cardAt(column, 50, 61)).toBeNull();
    expect(cardAt(column, 50, 130)).toBe(1);
    expect(cardAt(column, 50, 85)).toBeNull(); // between two cards
    expect(cardAt(column, 101, 40)).toBeNull(); // beside the column
  });

  it('leaves the ends of every card to the gaps, so a card can always be put before or after another', () => {
    const row = boxes(4, 4);
    for (let x = 0; x <= 430; x++) {
      const on = cardAt(row, x, 40);
      const gap = gapAt(row, x, 40, false);
      expect(gap).not.toBeNull();
      // Where the pointer is on a card, the gap it would otherwise mean is one of the two beside that card.
      if (on !== null) expect([on, on + 1]).toContain(gap);
    }
    for (const box of row) {
      expect(cardAt(row, box.left + 1, 40)).toBeNull();
      expect(cardAt(row, box.right - 1, 40)).toBeNull();
    }
  });
});
