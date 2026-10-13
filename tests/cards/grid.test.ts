// How many cards fit side by side.

import { describe, expect, it } from 'vitest';
import { CARD_GAP, CARD_MIN_WIDTH, CARD_SIZES, DEFAULT_CARD_SIZE, gridLayout, readCardSize } from '../../src/core/cards';

describe('card sizes', () => {
  it('are small, medium and large, each wider than the last', () => {
    expect([...CARD_SIZES]).toEqual(['small', 'medium', 'large']);
    expect(CARD_MIN_WIDTH.small).toBeLessThan(CARD_MIN_WIDTH.medium);
    expect(CARD_MIN_WIDTH.medium).toBeLessThan(CARD_MIN_WIDTH.large);
  });

  it('make a medium card at least about 220 pixels wide', () => {
    expect(CARD_MIN_WIDTH.medium).toBe(220);
    expect(DEFAULT_CARD_SIZE).toBe('medium');
  });

  it('are read back from storage, with medium for anything unknown', () => {
    expect(readCardSize('small')).toBe('small');
    expect(readCardSize('medium')).toBe('medium');
    expect(readCardSize('large')).toBe('large');
    for (const odd of ['huge', 'Small', '', null, undefined, 2, {}, ['small']]) {
      expect(readCardSize(odd), String(odd)).toBe('medium');
    }
  });
});

describe('gridLayout', () => {
  it('gives one column in a pane just wide enough for one card', () => {
    expect(gridLayout(220)).toEqual({ columns: 1, cardWidth: 220, gap: 12 });
    expect(gridLayout(300)).toEqual({ columns: 1, cardWidth: 300, gap: 12 });
  });

  it('adds a column only when another whole card and its gap fit', () => {
    // Two medium cards need 220 + 12 + 220 = 452.
    expect(gridLayout(451)).toEqual({ columns: 1, cardWidth: 451, gap: 12 });
    expect(gridLayout(452)).toEqual({ columns: 2, cardWidth: 220, gap: 12 });
    // Three need 3 * 220 + 2 * 12 = 684.
    expect(gridLayout(683).columns).toBe(2);
    expect(gridLayout(684)).toEqual({ columns: 3, cardWidth: 220, gap: 12 });
  });

  it('shares the width evenly among the columns', () => {
    expect(gridLayout(1000)).toEqual({ columns: 4, cardWidth: 241, gap: 12 });
    expect(gridLayout(500)).toEqual({ columns: 2, cardWidth: 244, gap: 12 });
  });

  it('uses the minimum width of the size asked for', () => {
    expect(gridLayout(1000, 'small')).toEqual({ columns: 5, cardWidth: 190, gap: 12 });
    expect(gridLayout(1000, 'medium').columns).toBe(4);
    expect(gridLayout(1000, 'large')).toEqual({ columns: 3, cardWidth: 325, gap: 12 });
  });

  it('never has fewer columns for a smaller card size', () => {
    for (let width = 100; width <= 2000; width += 37) {
      expect(gridLayout(width, 'small').columns).toBeGreaterThanOrEqual(gridLayout(width, 'medium').columns);
      expect(gridLayout(width, 'medium').columns).toBeGreaterThanOrEqual(gridLayout(width, 'large').columns);
    }
  });

  it('fits two small cards across a phone, and one medium card', () => {
    // An iPhone is 375 to 430 points wide; the board keeps some of that as padding.
    expect(gridLayout(343, 'small').columns).toBe(2);
    expect(gridLayout(343, 'medium').columns).toBe(1);
    expect(gridLayout(343, 'large')).toEqual({ columns: 1, cardWidth: 343, gap: 12 });
  });

  it('lets the one card take what there is in a pane narrower than a card', () => {
    expect(gridLayout(150)).toEqual({ columns: 1, cardWidth: 150, gap: 12 });
    expect(gridLayout(150.7, 'large')).toEqual({ columns: 1, cardWidth: 150, gap: 12 });
    expect(gridLayout(0.4)).toEqual({ columns: 1, cardWidth: 1, gap: 12 });
  });

  it('gives one column of the minimum width for a hidden pane or a width that is not a number', () => {
    for (const width of [0, -50, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(gridLayout(width), String(width)).toEqual({ columns: 1, cardWidth: 220, gap: 12 });
    }
    expect(gridLayout(0, 'small')).toEqual({ columns: 1, cardWidth: 160, gap: 12 });
  });

  it('always fills the width without overflowing it, at every width and size', () => {
    for (const size of CARD_SIZES) {
      const minimum = CARD_MIN_WIDTH[size];
      for (let width = 1; width <= 2400; width += 1) {
        const { columns, cardWidth, gap } = gridLayout(width, size);
        const used = columns * cardWidth + (columns - 1) * gap;
        const what = `${size} at ${width}`;
        expect(Number.isInteger(columns) && columns >= 1, what).toBe(true);
        expect(Number.isInteger(cardWidth) && cardWidth >= 1, what).toBe(true);
        expect(used, what).toBeLessThanOrEqual(width);
        expect(width - used, what).toBeLessThan(columns); // less than a pixel per column is left over
        if (width >= minimum) {
          expect(cardWidth, what).toBeGreaterThanOrEqual(minimum);
          // One more column would push the cards under the minimum.
          expect((width - columns * gap) / (columns + 1), what).toBeLessThan(minimum);
        } else {
          expect(columns, what).toBe(1);
        }
      }
    }
  });

  it('takes another gap when given one, and the usual gap when the one given makes no sense', () => {
    expect(CARD_GAP).toBe(12);
    expect(gridLayout(460, 'medium', 20)).toEqual({ columns: 2, cardWidth: 220, gap: 20 });
    expect(gridLayout(459, 'medium', 20).columns).toBe(1);
    expect(gridLayout(440, 'medium', 0)).toEqual({ columns: 2, cardWidth: 220, gap: 0 });
    expect(gridLayout(452, 'medium', -4).gap).toBe(12);
    expect(gridLayout(452, 'medium', Number.NaN).gap).toBe(12);
  });

  it('uses medium cards for a size it does not know', () => {
    expect(gridLayout(1000, 'enormous' as never)).toEqual(gridLayout(1000, 'medium'));
  });
});
