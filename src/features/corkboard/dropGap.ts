// Which gap between the cards of the board a pointer is at.
//
// The cards sit in a grid and are read row by row. The gap a dragged card
// would be dropped into is found from where the cards are on the screen; what
// a drop into that gap means for the binder is the engine's business
// (dropAt in src/core/cards).

/** Where one card is. Heights and sides must all be measured in the same way. */
export interface CardBox {
  readonly top: number;
  readonly bottom: number;
  /** The physical sides, whichever way the app reads. */
  readonly left: number;
  readonly right: number;
}

/**
 * The gap a pointer is at: 0 is in front of the first card, 1 between the
 * first and the second, and `boxes.length` after the last.
 *
 * Side by side: a pointer above a card's row is in front of that card; within
 * the row, it is in front of the card when it is on the nearer side of the
 * card's middle. So the space between two rows belongs to the end of the row
 * above.
 *
 * In a single column (a phone, a narrow pane) the cards follow each other
 * downwards, and the pointer is in front of the first card whose middle it is
 * above.
 *
 * @param boxes the cards in the order they are read
 * @param rtl   true when the app reads right to left, so that a row starts at the right
 * @returns null when there are no cards, or the place is not a number
 */
export function gapAt(boxes: readonly CardBox[], x: number, y: number, rtl: boolean): number | null {
  const first = boxes[0];
  if (!first || Number.isNaN(x) || Number.isNaN(y)) return null;
  const single = boxes.every((box) => Math.abs(box.left - first.left) < 1);
  for (let index = 0; index < boxes.length; index++) {
    const box = boxes[index];
    if (!box) continue;
    if (single) {
      if (y < (box.top + box.bottom) / 2) return index;
      continue;
    }
    if (y < box.top) return index;
    if (y > box.bottom) continue;
    const middle = (box.left + box.right) / 2;
    if (rtl ? x > middle : x < middle) return index;
  }
  return boxes.length;
}

/**
 * How much of a card, at each of its two ends along the way the cards are
 * read, still belongs to the gap beside it. The half in between is the card
 * itself: a drop there is a drop onto the card.
 */
export const CARD_EDGE_SHARE = 0.25;

/**
 * The card a pointer is on, for dropping one card onto another (a scene onto
 * a folder): the place in `boxes` of the card whose middle part the pointer
 * is over. Null when the pointer is on no card, or only on the edge of one,
 * where a drop goes into the gap beside it (see gapAt).
 *
 * Side by side, the middle part is the middle half of the card's width; in a
 * single column, of its height.
 *
 * @param boxes the cards in the order they are read
 */
export function cardAt(boxes: readonly CardBox[], x: number, y: number): number | null {
  const first = boxes[0];
  if (!first || Number.isNaN(x) || Number.isNaN(y)) return null;
  const single = boxes.every((box) => Math.abs(box.left - first.left) < 1);
  for (let index = 0; index < boxes.length; index++) {
    const box = boxes[index];
    if (!box || x < box.left || x > box.right || y < box.top || y > box.bottom) continue;
    const from = single ? box.top : box.left;
    const to = single ? box.bottom : box.right;
    const at = single ? y : x;
    const edge = (to - from) * CARD_EDGE_SHARE;
    return at >= from + edge && at <= to - edge ? index : null;
  }
  return null;
}
