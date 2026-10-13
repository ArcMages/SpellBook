// How many cards fit side by side on the corkboard.
//
// The board measures its own width and asks here for the number of columns.
// Cards never get narrower than the minimum for their size, except in a pane
// that is narrower than one card, where the single column takes what there is.

/** The three sizes a writer can choose for the cards. */
export type CardSize = 'small' | 'medium' | 'large';

/** The card sizes, smallest first. */
export const CARD_SIZES: readonly CardSize[] = ['small', 'medium', 'large'];

/** The size cards have until the writer chooses another. */
export const DEFAULT_CARD_SIZE: CardSize = 'medium';

/** The narrowest a card of each size may be, in CSS pixels. */
export const CARD_MIN_WIDTH: Readonly<Record<CardSize, number>> = { small: 160, medium: 220, large: 300 };

/** The space between two cards, across and down, in CSS pixels. */
export const CARD_GAP = 12;

/** How the cards are laid out for one width. */
export interface GridLayout {
  /** How many cards go side by side; at least 1. */
  readonly columns: number;
  /** The width of each card, in whole CSS pixels. */
  readonly cardWidth: number;
  /** The space between cards, in CSS pixels. */
  readonly gap: number;
}

/** Read a stored card size; anything that is not one of the three gives the default. */
export function readCardSize(value: unknown): CardSize {
  return CARD_SIZES.find((size) => size === value) ?? DEFAULT_CARD_SIZE;
}

/**
 * The number of columns and the card width for a board of a given width.
 *
 * As many columns as fit without any card going under the minimum width for
 * its size; the cards then share the width evenly. A width of zero or less
 * (a hidden pane) gives one column of the minimum width.
 *
 * @param containerWidth the width the cards have to share, in CSS pixels, without the board's own padding
 * @param size           the card size the writer chose
 * @param gap            the space between cards
 */
export function gridLayout(
  containerWidth: number,
  size: CardSize = DEFAULT_CARD_SIZE,
  gap: number = CARD_GAP,
): GridLayout {
  const minimum = CARD_MIN_WIDTH[readCardSize(size)];
  const space = Number.isFinite(gap) && gap >= 0 ? gap : CARD_GAP;
  if (!Number.isFinite(containerWidth) || containerWidth <= 0) {
    return { columns: 1, cardWidth: minimum, gap: space };
  }
  const columns = Math.max(1, Math.floor((containerWidth + space) / (minimum + space)));
  const cardWidth = Math.max(1, Math.floor((containerWidth - space * (columns - 1)) / columns));
  return { columns, cardWidth, gap: space };
}
