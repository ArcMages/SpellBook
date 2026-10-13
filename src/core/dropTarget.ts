// Where a dragged row would land.
//
// The binder hands over its rows as plain rectangles (where each one is on
// the screen and what it stands for) and the place of the pointer; these
// functions answer with the place in the binder a drop would put the dragged
// thing, and with what to draw so that the writer can see it. Nothing here
// knows about the screen itself, so it can all be tested with numbers.
//
// The rules:
//   - on a scene, the upper half means "before it" and the lower half "after it";
//   - on a folder, the upper quarter means "before it", the lower quarter
//     "after it", and the middle "inside it" (at its end);
//   - on the lower quarter of a folder that is open with rows showing under
//     it, the drop goes to the start of the folder: that is where the line
//     under the folder's row is;
//   - above the first row means the start of the binder, below the last row
//     its end.

import { moveNode } from './binderTree';
import type { NodeRef, Placement, TreeNode } from './types';

/** One row of the binder as it is laid out on the screen. */
export interface DropRow {
  /** What the row stands for: a scene (also one whose note is missing) or a binder folder. */
  readonly ref: NodeRef;
  /** The id of the folder the row sits in; null for the top level. */
  readonly parentId: string | null;
  /** Its top and bottom edge. Any unit and origin will do, as long as the pointer and the bounds use the same. */
  readonly top: number;
  readonly bottom: number;
}

/** The part of the screen in which a drop counts: from above the first row to a little below the last. */
export interface DropBounds {
  readonly top: number;
  readonly bottom: number;
}

/** What to draw for the place a drop would land. */
export type DropMark =
  /** A line at height `y`, set in as far as the row at `alignWith` (a position in the list of rows). */
  | { readonly kind: 'line'; readonly y: number; readonly alignWith: number }
  /** A highlight on the folder at `row` (a position in the list of rows): the drop goes inside it. */
  | { readonly kind: 'into'; readonly row: number }
  /** A highlight on the binder as a whole: it shows no rows, and the drop goes into it. */
  | { readonly kind: 'tree' };

export interface DropSpot {
  /** Where the dragged thing would go. */
  readonly placement: Placement;
  readonly mark: DropMark;
  /** The row the pointer is on, as a position in the list of rows; -1 when it is above or below all of them. */
  readonly over: number;
}

/** How much of a folder's row, at its top and at its bottom, means "before" and "after". */
export const FOLDER_EDGE = 0.25;

const START_OF_BINDER: Placement = { at: 'start', parentId: null };
const END_OF_BINDER: Placement = { at: 'end', parentId: null };

/**
 * Work out where a drop at height `y` would land.
 *
 * @param rows the rows that can be seen, top to bottom (rows inside a folder
 *             that is folded shut are left out)
 * @returns null when the pointer is outside the bounds: a drop there does nothing
 */
export function resolveDrop(rows: readonly DropRow[], y: number, bounds: DropBounds): DropSpot | null {
  if (!(y >= bounds.top && y <= bounds.bottom)) return null;
  const first = rows[0];
  const last = rows[rows.length - 1];
  if (!first || !last) return { placement: END_OF_BINDER, mark: { kind: 'tree' }, over: -1 };
  if (y < first.top) {
    return { placement: START_OF_BINDER, mark: { kind: 'line', y: first.top, alignWith: 0 }, over: -1 };
  }
  if (y >= last.bottom) {
    return { placement: END_OF_BINDER, mark: { kind: 'line', y: last.bottom, alignWith: 0 }, over: -1 };
  }

  // The last row that starts at or above the pointer. A pointer in the thin
  // gap between two rows counts as the bottom edge of the upper one.
  let low = 0;
  let high = rows.length - 1;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if ((rows[middle] as DropRow).top <= y) low = middle;
    else high = middle - 1;
  }
  const index = low;
  const row = rows[index] as DropRow;
  const height = row.bottom - row.top;
  const before: DropSpot = {
    placement: { at: 'before', sibling: row.ref },
    mark: { kind: 'line', y: row.top, alignWith: index },
    over: index,
  };
  const after: DropSpot = {
    placement: { at: 'after', sibling: row.ref },
    mark: { kind: 'line', y: row.bottom, alignWith: index },
    over: index,
  };

  if (row.ref.kind !== 'folder') return y < row.top + height / 2 ? before : after;

  const edge = height * FOLDER_EDGE;
  if (y < row.top + edge) return before;
  if (y < row.bottom - edge) {
    return { placement: { at: 'end', parentId: row.ref.id }, mark: { kind: 'into', row: index }, over: index };
  }
  // Open, with rows of its own showing: the line under the folder's row is
  // the start of the folder, so that is where the drop goes.
  if (rows[index + 1]?.parentId === row.ref.id) {
    return {
      placement: { at: 'start', parentId: row.ref.id },
      mark: { kind: 'line', y: row.bottom, alignWith: index + 1 },
      over: index,
    };
  }
  return after;
}

/**
 * Whether moving a binder entry to a place would change anything. It would
 * not when the entry is already exactly there, when a folder would end up
 * inside itself, or when the entry or the place is not in the binder.
 */
export function canDrop(tree: readonly TreeNode[], dragged: NodeRef, placement: Placement): boolean {
  return moveNode(tree, dragged, placement).ok;
}

/** A name for a placement, to tell whether two of them are the same place. */
export function placementKey(placement: Placement): string {
  if (placement.at === 'start' || placement.at === 'end') return `${placement.at}:${placement.parentId ?? ''}`;
  const sibling = placement.sibling;
  return `${placement.at}:${sibling.kind}:${sibling.kind === 'scene' ? sibling.path : sibling.id}`;
}

// ------------------------------------------------------------- the gesture

/** A place on the screen. */
export interface ScreenPoint {
  readonly x: number;
  readonly y: number;
}

/** How far two places are apart, in a straight line. */
export function distanceBetween(a: ScreenPoint, b: ScreenPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** How near the top or bottom edge of a list the pointer must be for the list to scroll by itself. */
export const AUTO_SCROLL_EDGE = 40;
/** The fastest a list scrolls by itself, in pixels per second. */
export const AUTO_SCROLL_MAX = 900;

/**
 * How fast a list should scroll by itself while something is dragged near its
 * top or bottom edge: in pixels per second, negative for upwards, 0 when the
 * pointer is not near an edge. The nearer the edge, the faster; past the edge
 * it is as fast as it gets.
 *
 * @param y      where the pointer is
 * @param top    the top edge of the list
 * @param bottom the bottom edge of the list
 */
export function autoScrollSpeed(y: number, top: number, bottom: number): number {
  const height = bottom - top;
  if (!(height > 0)) return 0;
  // In a very short list the two zones must not meet in the middle.
  const edge = Math.min(AUTO_SCROLL_EDGE, height / 3);
  const into = (depth: number): number => AUTO_SCROLL_MAX * Math.max(0, Math.min(1, depth / edge));
  if (y < top + edge) return -into(top + edge - y);
  if (y > bottom - edge) return into(y - (bottom - edge));
  return 0;
}
