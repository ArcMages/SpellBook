// The columns of the outliner: which there are, which are shown, in what
// order, and how that choice is kept on a device.
//
// There are two layouts, because a phone (or a narrow pane) has room for far
// fewer columns than a wide one: each keeps its own choice. A layout lists
// every column there is, shown or not, in the order they stand in.

/** The columns the outliner always knows, in their usual order. */
export const BUILT_IN_COLUMNS = [
  'number',
  'name',
  'status',
  'label',
  'target',
  'words',
  'synopsis',
  'tags',
  'tasks',
  'readTime',
  'compile',
  'created',
  'edited',
] as const;

export type BuiltInColumn = (typeof BUILT_IN_COLUMNS)[number];

/** In front of the id of a column that shows one of the scenes' other properties. */
export const PROPERTY_PREFIX = 'prop:';

/** A column: one of the built-in ones, or "prop:<key>" for another property of the scenes. */
export type ColumnId = BuiltInColumn | `prop:${string}`;

const BUILT_IN = new Set<string>(BUILT_IN_COLUMNS);

const TITLES: Readonly<Record<BuiltInColumn, string>> = {
  number: '#',
  name: 'Name',
  status: 'Status',
  label: 'Label',
  target: 'Target',
  words: 'Words',
  synopsis: 'Synopsis',
  tags: 'Tags',
  tasks: 'Tasks',
  readTime: 'Read time',
  compile: 'Compile',
  created: 'Created',
  edited: 'Edited',
};

/** No property key longer than this becomes a column, and no more than this many of them. */
const MAX_KEY_LENGTH = 200;
const MAX_PROPERTY_COLUMNS = 40;

export function isBuiltInColumn(id: string): id is BuiltInColumn {
  return BUILT_IN.has(id);
}

/** The id of the column that shows a property of the scenes. */
export function propertyColumn(key: string): ColumnId {
  return `${PROPERTY_PREFIX}${key}`;
}

/** The property a column shows; null for a built-in column. */
export function propertyKeyOf(id: string): string | null {
  return !isBuiltInColumn(id) && id.startsWith(PROPERTY_PREFIX) ? id.slice(PROPERTY_PREFIX.length) : null;
}

/** True for anything that can be the id of a column. */
export function isColumnId(id: unknown): id is ColumnId {
  if (typeof id !== 'string') return false;
  if (isBuiltInColumn(id)) return true;
  const key = propertyKeyOf(id);
  return key !== null && key.trim() !== '' && key.length <= MAX_KEY_LENGTH;
}

/** What stands in a column's header. For a property column it is the key, the writer's own text. */
export function columnTitle(id: ColumnId): string {
  return isBuiltInColumn(id) ? TITLES[id] : (propertyKeyOf(id) ?? id);
}

/** True when a column's header is the writer's own text (which chooses its own direction). */
export function isOwnTextTitle(id: ColumnId): boolean {
  return !isBuiltInColumn(id);
}

/** Columns whose cells hold numbers, which stand at the end of the cell. */
export function isNumberColumn(id: ColumnId): boolean {
  return id === 'number' || id === 'words' || id === 'target' || id === 'tasks' || id === 'readTime';
}

/** Columns that show numbers of words (or a time worked out from them): the "Show word counts" setting leaves them out. */
export function isWordColumn(id: ColumnId): boolean {
  return id === 'words' || id === 'target' || id === 'readTime';
}

/** One column of a layout. */
export interface ColumnChoice {
  readonly id: ColumnId;
  readonly shown: boolean;
}

/** Every column there is, shown or not, in the order they stand in. */
export type ColumnLayout = readonly ColumnChoice[];

/** Which of the two layouts: the one for a pane with room, or the one for a phone or a narrow pane. */
export type PaneWidth = 'wide' | 'narrow';

/** Below this width (in CSS pixels) a pane is narrow: it gets the short list of columns. */
export const NARROW_BELOW = 520;
/** From this width on it is wide again. The gap keeps the table from flickering at the edge. */
export const WIDE_FROM = 560;

/**
 * Which layout a pane gets, going by its measured width. A width of zero
 * means the pane is hidden: it keeps what it had.
 */
export function paneWidthFor(width: number, was: PaneWidth): PaneWidth {
  if (!(width > 0)) return was;
  if (was === 'narrow') return width < WIDE_FROM ? 'narrow' : 'wide';
  return width < NARROW_BELOW ? 'narrow' : 'wide';
}

/** The built-in columns that are not shown until the writer asks for them. */
const HIDDEN_WHEN_WIDE = new Set<BuiltInColumn>(['created', 'edited']);
/** All a phone shows until the writer asks for more. */
const SHOWN_WHEN_NARROW = new Set<BuiltInColumn>(['name', 'status', 'target', 'words']);

function shownByDefault(id: ColumnId, width: PaneWidth): boolean {
  if (!isBuiltInColumn(id)) return true;
  return width === 'narrow' ? SHOWN_WHEN_NARROW.has(id) : !HIDDEN_WHEN_WIDE.has(id);
}

/** The layout a pane has until the writer changes it. */
export function defaultLayout(width: PaneWidth): ColumnLayout {
  return BUILT_IN_COLUMNS.map((id) => ({ id, shown: shownByDefault(id, width) }));
}

/** The columns a layout shows, in order. */
export function shownColumns(layout: ColumnLayout): ColumnId[] {
  return layout.filter((column) => column.shown).map((column) => column.id);
}

/** True when a column is in the layout and shown. */
export function isShown(layout: ColumnLayout, id: ColumnId): boolean {
  return layout.some((column) => column.id === id && column.shown);
}

/**
 * Show or hide a column. The Name column cannot be hidden: it is what the
 * rows are known by. A property column that is hidden leaves the layout
 * altogether (it can be added again from the list of properties).
 */
export function setColumnShown(layout: ColumnLayout, id: ColumnId, shown: boolean): ColumnLayout {
  if (id === 'name' && !shown) return layout;
  if (!shown && !isBuiltInColumn(id)) return layout.filter((column) => column.id !== id);
  return layout.map((column) => (column.id === id && column.shown !== shown ? { id, shown } : column));
}

/** Where a column would go when it is moved one place among the columns that are shown; -1 when it cannot. */
function neighbour(layout: ColumnLayout, id: ColumnId, by: -1 | 1): number {
  const from = layout.findIndex((column) => column.id === id);
  if (from < 0 || layout[from]?.shown !== true) return -1;
  for (let at = from + by; at >= 0 && at < layout.length; at += by) {
    if (layout[at]?.shown === true) return at;
  }
  return -1;
}

/** Whether a shown column can be moved one place earlier (-1) or later (1) among the shown ones. */
export function canMoveColumn(layout: ColumnLayout, id: ColumnId, by: -1 | 1): boolean {
  return neighbour(layout, id, by) >= 0;
}

/** Move a shown column one place earlier (-1) or later (1), past the next shown column. */
export function moveColumn(layout: ColumnLayout, id: ColumnId, by: -1 | 1): ColumnLayout {
  const to = neighbour(layout, id, by);
  if (to < 0) return layout;
  const from = layout.findIndex((column) => column.id === id);
  const moving = layout[from];
  if (!moving) return layout;
  const out = layout.filter((column) => column.id !== id);
  // After the column was taken out, the place "past the neighbour" is the neighbour's old place.
  out.splice(to, 0, moving);
  return out;
}

/** Add a column for one of the scenes' other properties, at the end; one that is there already is shown. */
export function addPropertyColumn(layout: ColumnLayout, key: string): ColumnLayout {
  const id = propertyColumn(key);
  if (!isColumnId(id) || isBuiltInColumn(id)) return layout;
  if (layout.some((column) => column.id === id)) return setColumnShown(layout, id, true);
  if (layout.filter((column) => !isBuiltInColumn(column.id)).length >= MAX_PROPERTY_COLUMNS) return layout;
  return [...layout, { id, shown: true }];
}

/** The property keys a layout has a column for. */
export function propertyKeysIn(layout: ColumnLayout): string[] {
  return layout.flatMap((column) => {
    const key = propertyKeyOf(column.id);
    return key === null ? [] : [key];
  });
}

/** True when two layouts show the same columns in the same order and hide the same ones. */
export function sameLayout(a: ColumnLayout, b: ColumnLayout): boolean {
  return a.length === b.length && a.every((column, at) => column.id === b[at]?.id && column.shown === b[at]?.shown);
}

// ----------------------------------------------------------- the saved form

/** The two layouts a device keeps. */
export interface ColumnPrefs {
  readonly wide: ColumnLayout;
  readonly narrow: ColumnLayout;
}

export const COLUMN_PREFS_VERSION = 1;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** What the storage gave back, read as JSON when it is text. Undefined when it is not readable. */
export function parseStored(stored: unknown): unknown {
  if (typeof stored !== 'string') return stored ?? undefined;
  try {
    return JSON.parse(stored) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * Read one saved layout. Whatever cannot be understood is left out, and
 * whatever is missing is put back: a column the saved layout does not know
 * (one that a newer version added, say) comes in after the column it follows
 * in the usual order, shown or hidden as it usually is. The Name column is
 * always shown.
 */
export function readLayout(saved: unknown, width: PaneWidth): ColumnLayout {
  if (!Array.isArray(saved)) return defaultLayout(width);
  const out: ColumnChoice[] = [];
  const seen = new Set<string>();
  let properties = 0;
  for (const entry of saved) {
    // An entry is { id, shown }; a bare id counts as shown.
    const id: unknown = isRecord(entry) ? entry['id'] : entry;
    if (!isColumnId(id) || seen.has(id)) continue;
    if (!isBuiltInColumn(id) && ++properties > MAX_PROPERTY_COLUMNS) continue;
    const flag: unknown = isRecord(entry) ? entry['shown'] : true;
    const shown = typeof flag === 'boolean' ? flag : shownByDefault(id, width);
    seen.add(id);
    // A hidden property column is one that was taken away.
    if (!shown && !isBuiltInColumn(id)) continue;
    out.push({ id, shown: id === 'name' ? true : shown });
  }
  BUILT_IN_COLUMNS.forEach((id, position) => {
    if (seen.has(id)) return;
    // After the nearest column that comes before it in the usual order; at the start when there is none.
    let at = 0;
    for (let before = position - 1; before >= 0; before--) {
      const found = out.findIndex((column) => column.id === BUILT_IN_COLUMNS[before]);
      if (found >= 0) {
        at = found + 1;
        break;
      }
    }
    out.splice(at, 0, { id, shown: shownByDefault(id, width) });
    seen.add(id);
  });
  return out;
}

/** Read what a device saved about the columns. Never throws; anything unreadable gives the usual layouts. */
export function readColumnPrefs(stored: unknown): ColumnPrefs {
  const parsed = parseStored(stored);
  const source = isRecord(parsed) ? parsed : {};
  return { wide: readLayout(source['wide'], 'wide'), narrow: readLayout(source['narrow'], 'narrow') };
}

/** The text to save for the two layouts; null (nothing to keep) when both are the usual ones. */
export function writeColumnPrefs(prefs: ColumnPrefs): string | null {
  const usual = sameLayout(prefs.wide, defaultLayout('wide')) && sameLayout(prefs.narrow, defaultLayout('narrow'));
  if (usual) return null;
  const plain = (layout: ColumnLayout): Array<{ id: string; shown: boolean }> =>
    layout.map((column) => ({ id: column.id, shown: column.shown }));
  return JSON.stringify({ v: COLUMN_PREFS_VERSION, wide: plain(prefs.wide), narrow: plain(prefs.narrow) });
}
