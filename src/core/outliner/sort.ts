// Putting the scenes in the order of one column.
//
// Numbers are compared as numbers and text the way a dictionary of the
// device's language would (Intl.Collator), so that Hebrew and English titles
// both come out in a sensible order and "Scene 10" follows "Scene 9". A scene
// that has nothing in the column comes last, whichever way the column is
// sorted. Scenes that are equal in the column keep their manuscript order.

import type { CardLists, CardTag, TagList } from '../cards';
import { dayNumber } from '../dates';
import { columnTitle, isColumnId, propertyKeyOf } from './columns';
import type { ColumnId } from './columns';
import { targetCell } from './progress';
import { propertyText, readProperty } from './properties';
import type { SceneRow } from './rows';

/** The column the scenes are sorted by, and which way. */
export interface OutlineSort {
  readonly column: ColumnId;
  readonly direction: 'asc' | 'desc';
}

/**
 * What a scene is sorted by: one or more numbers and pieces of text, compared
 * in turn. Where a number meets a piece of text, the number comes first.
 */
export type SortKey = ReadonlyArray<number | string>;

/** What compares two pieces of text. */
export type TextCompare = Pick<Intl.Collator, 'compare'>;

/** The comparison the outliner uses for text: the device's own, numbers inside text by their value, capitals alike. */
export function defaultCollator(): TextCompare {
  return new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
}

const NUMBER_TEXT = /^[+-]?(?:\d+\.?\d*|\.\d+)$/;

/** A status or a label: by its place in the project's list, then the ones the list lacks, by name. */
function tagKey(tag: CardTag | null, places: ReadonlyMap<string, number>): SortKey | null {
  if (tag === null) return null;
  const place = tag.listed ? places.get(tag.name) : undefined;
  return place === undefined ? [1, tag.name] : [0, place];
}

function textKey(text: string): SortKey | null {
  return text.trim() === '' ? null : [text];
}

function propertyKey(value: unknown): SortKey | null {
  if (typeof value === 'number') return Number.isFinite(value) ? [0, value] : null;
  if (typeof value === 'boolean') return [0, value ? 1 : 0];
  const text = propertyText(value).trim();
  if (text === '') return null;
  return NUMBER_TEXT.test(text) ? [0, Number(text)] : [1, text];
}

/** The place of each name of a list, counting from 0. */
function placesIn(list: TagList): Map<string, number> {
  const places = new Map<string, number>();
  list.tags.forEach((tag, position) => {
    if (!places.has(tag.name)) places.set(tag.name, position);
  });
  return places;
}

/** Works out what each scene is sorted by in one column. */
export type SortKeyOf = (scene: SceneRow) => SortKey | null;

/**
 * What the scenes are sorted by in a column; null for a scene that has
 * nothing there (it comes last).
 *
 *   #          the scene's number in the manuscript
 *   Status     its place in the project's list of statuses (so "To do" comes
 *   Label      before "Done", as the list has it); names the list lacks follow, by name
 *   Target     how far along it is, in per cent
 *   Tasks      how many to-do lines are still open, then how many there are
 *   Read time  the words (the reading time is worked out from them)
 *   Compile    the scenes that are compiled first
 */
export function sortKeyFor(column: ColumnId, lists: CardLists): SortKeyOf {
  const property = propertyKeyOf(column);
  if (property !== null) return (scene) => propertyKey(readProperty(scene.frontmatter, property));
  switch (column) {
    case 'number':
      return (scene) => [scene.number];
    case 'name':
      return (scene) => textKey(scene.title);
    case 'status': {
      const places = placesIn(lists.statuses);
      return (scene) => tagKey(scene.status, places);
    }
    case 'label': {
      const places = placesIn(lists.labels);
      return (scene) => tagKey(scene.label, places);
    }
    case 'target':
      return (scene) => {
        const cell = targetCell(scene.words, scene.target);
        return cell === null ? null : [cell.percent ?? 0, cell.target];
      };
    case 'words':
    case 'readTime':
      return (scene) => (typeof scene.words === 'number' ? [scene.words] : null);
    case 'synopsis':
      return (scene) => textKey(scene.synopsis);
    case 'tags':
      return (scene) => textKey(scene.tags.join(' '));
    case 'tasks':
      return (scene) => {
        const tasks = scene.tasks;
        return !tasks || tasks.total === 0 ? null : [tasks.total - tasks.done, tasks.total];
      };
    case 'compile':
      return (scene) => (scene.missing ? null : [scene.compile ? 0 : 1]);
    case 'created':
    case 'edited':
      return (scene) => {
        const day = scene[column] === null ? null : dayNumber(scene[column] ?? '');
        return day === null ? null : [day];
      };
    default:
      return () => null;
  }
}

/** Compare two sort keys, part by part. */
export function compareKeys(a: SortKey, b: SortKey, collator: TextCompare): number {
  const parts = Math.min(a.length, b.length);
  for (let at = 0; at < parts; at++) {
    const left = a[at];
    const right = b[at];
    if (left === right || left === undefined || right === undefined) continue;
    if (typeof left === 'number' && typeof right === 'number') {
      if (left !== right) return left < right ? -1 : 1;
      continue;
    }
    if (typeof left === 'number') return -1;
    if (typeof right === 'number') return 1;
    const order = collator.compare(left, right);
    if (order !== 0) return order;
  }
  return a.length - b.length;
}

/**
 * The scenes in the order of a column. The list handed in is left as it is.
 *
 * @param collator how text is compared; left out, the device's own way
 */
export function sortScenes(
  scenes: readonly SceneRow[],
  sort: OutlineSort,
  lists: CardLists,
  collator: TextCompare = defaultCollator(),
): SceneRow[] {
  const keyOf = sortKeyFor(sort.column, lists);
  const turn = sort.direction === 'desc' ? -1 : 1;
  return scenes
    .map((scene) => ({ scene, key: keyOf(scene) }))
    .sort((a, b) => {
      // Nothing in the column: last, whichever way it is sorted.
      if (a.key === null || b.key === null) {
        if (a.key !== null) return -1;
        if (b.key !== null) return 1;
        return a.scene.number - b.scene.number;
      }
      return turn * compareKeys(a.key, b.key, collator) || a.scene.number - b.scene.number;
    })
    .map((entry) => entry.scene);
}

/** What a click on a column's header leads to: ascending, then descending, then no sort at all. */
export function nextSort(current: OutlineSort | null, column: ColumnId): OutlineSort | null {
  if (current === null || current.column !== column) return { column, direction: 'asc' };
  return current.direction === 'asc' ? { column, direction: 'desc' } : null;
}

/** A sort in words, for the chip above the table: "Sorted by Words, descending". */
export function describeSort(sort: OutlineSort): string {
  return `Sorted by ${columnTitle(sort.column)}, ${sort.direction === 'desc' ? 'descending' : 'ascending'}`;
}

/** Read a saved sort. Never throws; whatever cannot be understood counts as "not sorted". */
export function readSort(saved: unknown): OutlineSort | null {
  if (typeof saved !== 'object' || saved === null || Array.isArray(saved)) return null;
  const { column, direction } = saved as { column?: unknown; direction?: unknown };
  if (!isColumnId(column)) return null;
  return { column, direction: direction === 'desc' ? 'desc' : 'asc' };
}
