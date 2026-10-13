// One column or several: decided by the measured width of the pane, never by
// the kind of device.

/** Below this width (in CSS pixels) the figures stand in a single column. */
export const NARROW_BELOW = 480;
/** From this width on there is room for several again. The gap keeps the pane from flickering at the edge. */
export const WIDE_FROM = 520;

/**
 * Whether a pane is narrow, going by its measured width. A width of zero
 * means the pane is hidden: it keeps what it had.
 */
export function isNarrowPane(width: number, wasNarrow: boolean): boolean {
  if (!(width > 0)) return wasNarrow;
  return width < (wasNarrow ? WIDE_FROM : NARROW_BELOW);
}
