// Whether the comparison stands in two columns (the old text beside the new)
// or in one, going by the measured width of the pane, never by the kind of
// device. The two limits are a little apart, so that a pane dragged to just
// about that width does not flip back and forth.

/** A pane that shows two columns goes to one below this width, in pixels. */
export const ONE_COLUMN_BELOW = 640;
/** A pane that shows one column goes to two from this width. */
export const TWO_COLUMNS_FROM = 680;

/**
 * Whether a pane is too narrow for two columns. A width of zero means the
 * pane is hidden: it keeps what it had.
 */
export function isNarrowPane(width: number, wasNarrow: boolean): boolean {
  if (!(width > 0)) return wasNarrow;
  return width < (wasNarrow ? TWO_COLUMNS_FROM : ONE_COLUMN_BELOW);
}
