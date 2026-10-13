// What the bottom bar holds, and in what order: the writer's own choice of
// figures ("items") and of shortcut buttons that run a command.
//
// A layout is a plain list. It is kept on the device as text (JSON) and read
// back with parseBarLayout, which trusts nothing: whatever is stored (an older
// version's layout, something edited by hand) comes out as a layout that can
// be shown. Every change gives a new layout; nothing here is changed in place.
//
// Nothing here draws anything or stores anything.

/** The figures the bar can show. */
export type BarItemId =
  | 'scene'
  | 'target'
  | 'session'
  | 'today'
  | 'project'
  | 'reading'
  | 'started'
  | 'edited'
  | 'status'
  | 'todos'
  | 'title';

/** One figure the writer can choose, as the settings name it. */
export interface BarItemInfo {
  readonly id: BarItemId;
  /** Its name in the settings, for example "Scene words". */
  readonly name: string;
  /** One sentence on what it shows. */
  readonly description: string;
}

/** Every figure there is, in the order the settings offer them. */
export const BAR_ITEMS: readonly BarItemInfo[] = [
  { id: 'scene', name: 'Scene words', description: 'The words of the open scene.' },
  { id: 'target', name: 'Scene target', description: 'How far the open scene is toward its own target, with a small progress bar.' },
  { id: 'session', name: 'Session words', description: 'Net words written since Obsidian was opened.' },
  { id: 'today', name: 'Words today', description: 'Net words written today, against the daily target.' },
  { id: 'project', name: 'Project words', description: 'The words of the whole manuscript, against the project target.' },
  { id: 'reading', name: 'Reading time', description: 'About how long the open scene takes to read.' },
  { id: 'started', name: 'Date started', description: 'The day the open scene was started.' },
  { id: 'edited', name: 'Date last edited', description: 'The day the open scene was last edited.' },
  { id: 'status', name: 'Status', description: 'The status of the open scene.' },
  { id: 'todos', name: 'To-dos due', description: 'How many open to-dos are due today or are late.' },
  { id: 'title', name: 'Scene title', description: 'The name of the open scene.' },
];

const ITEM_IDS: ReadonlySet<string> = new Set(BAR_ITEMS.map((item) => item.id));

/** True when a value is the id of a figure. */
export function isBarItemId(value: unknown): value is BarItemId {
  return typeof value === 'string' && ITEM_IDS.has(value);
}

/** The name of a figure as the settings show it. */
export function barItemName(id: BarItemId): string {
  return BAR_ITEMS.find((item) => item.id === id)?.name ?? id;
}

/** A figure in the bar. */
export interface BarItemEntry {
  readonly kind: 'item';
  readonly id: BarItemId;
}

/** A shortcut button in the bar: it runs one command of Obsidian or of a plugin. */
export interface BarButtonEntry {
  readonly kind: 'button';
  /** The command's full id, for example "spellbook-novel-writer:toggle-zen-mode". */
  readonly command: string;
  /** What the button says; "" for a button that shows the command's own name (or only its icon). */
  readonly label: string;
  /** The name of the icon the button shows, or null for none. */
  readonly icon: string | null;
}

/** One thing in the bar: a figure or a shortcut button. */
export type BarEntry = BarItemEntry | BarButtonEntry;

/** What the bar holds, in order. */
export interface BarLayout {
  readonly entries: readonly BarEntry[];
}

/** No more than this many buttons and figures are kept; more would not fit any screen. */
export const MAX_BAR_ENTRIES = 40;
/** The longest label a button can have. */
export const MAX_LABEL_LENGTH = 40;
/** The longest command id or icon name that is taken for one. */
const MAX_ID_LENGTH = 200;

const items = (...ids: BarItemId[]): BarLayout => ({ entries: ids.map((id) => ({ kind: 'item', id })) });

/** The bar as it was before it could be changed: the layout a device starts with. */
export const DEFAULT_BAR_LAYOUT: BarLayout = items('scene', 'started', 'edited', 'session', 'project', 'today');

/** A ready-made layout the writer can choose with one tap. */
export interface BarPreset {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly layout: BarLayout;
}

/** The ready-made layouts, in the order the settings offer them. */
export const BAR_PRESETS: readonly BarPreset[] = [
  {
    id: 'minimal',
    name: 'Minimal',
    description: 'Scene words and words today.',
    layout: items('scene', 'today'),
  },
  {
    id: 'drafting',
    name: 'Drafting',
    description: 'Scene words and target, session, today and reading time.',
    layout: items('scene', 'target', 'session', 'today', 'reading'),
  },
  {
    id: 'everything',
    name: 'Everything',
    description: 'Every figure there is.',
    layout: items('title', 'status', 'scene', 'target', 'reading', 'started', 'edited', 'session', 'today', 'project', 'todos'),
  },
];

/** The icons the settings offer for a button. Names from Obsidian's own icon set. */
export const BAR_BUTTON_ICONS: readonly string[] = [
  'eye',
  'maximize',
  'minimize',
  'type',
  'pencil',
  'feather',
  'book-open',
  'star',
  'target',
  'clock',
  'calendar',
  'list-checks',
  'layout-grid',
  'search',
  'save',
  'moon',
  'sun',
  'keyboard',
  'zap',
  'settings',
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A label as it is kept: on one line, without spaces at either end, and not too long. */
export function tidyLabel(label: string): string {
  return label.replace(/\s+/g, ' ').trim().slice(0, MAX_LABEL_LENGTH);
}

function readEntry(value: unknown): BarEntry | null {
  if (!isRecord(value)) return null;
  if (value['kind'] === 'item') {
    return isBarItemId(value['id']) ? { kind: 'item', id: value['id'] } : null;
  }
  if (value['kind'] === 'button') {
    const command = value['command'];
    if (typeof command !== 'string' || command.trim() === '' || command.length > MAX_ID_LENGTH) return null;
    const label = typeof value['label'] === 'string' ? tidyLabel(value['label']) : '';
    const icon = value['icon'];
    return {
      kind: 'button',
      command: command.trim(),
      label,
      icon: typeof icon === 'string' && icon.trim() !== '' && icon.length <= MAX_ID_LENGTH ? icon.trim() : null,
    };
  }
  return null;
}

/** A list of entries as a layout: each figure once (the first time it comes), and not too many. */
function layoutOf(entries: readonly BarEntry[]): BarLayout {
  const seen = new Set<BarItemId>();
  const kept: BarEntry[] = [];
  for (const entry of entries) {
    if (kept.length >= MAX_BAR_ENTRIES) break;
    if (entry.kind === 'item') {
      if (seen.has(entry.id)) continue;
      seen.add(entry.id);
    }
    kept.push(entry);
  }
  return { entries: kept };
}

/**
 * Read a stored layout. Takes the text that serializeBarLayout made (or what
 * it was made from); gives the default layout for nothing, and for anything
 * that is not a layout. An entry that makes no sense is left out and the
 * others are kept. A layout the writer emptied on purpose stays empty.
 * Never throws.
 */
export function parseBarLayout(stored: unknown): BarLayout {
  let value: unknown = stored;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value) as unknown;
    } catch {
      return DEFAULT_BAR_LAYOUT;
    }
  }
  if (!isRecord(value) || !Array.isArray(value['entries'])) return DEFAULT_BAR_LAYOUT;
  const entries: BarEntry[] = [];
  for (const raw of value['entries'] as unknown[]) {
    const entry = readEntry(raw);
    if (entry !== null) entries.push(entry);
  }
  return layoutOf(entries);
}

/** A layout as text, to keep on the device. */
export function serializeBarLayout(layout: BarLayout): string {
  return JSON.stringify({ version: 1, entries: layout.entries });
}

/** True when two layouts hold the same things in the same order. */
export function sameBarLayout(a: BarLayout, b: BarLayout): boolean {
  return serializeBarLayout(a) === serializeBarLayout(b);
}

/** The figures of a layout, in order. */
export function barItemIds(layout: BarLayout): BarItemId[] {
  return layout.entries.flatMap((entry) => (entry.kind === 'item' ? [entry.id] : []));
}

/** The figures a layout does not hold yet, in the order the settings offer them. */
export function missingBarItems(layout: BarLayout): BarItemInfo[] {
  const there = new Set(barItemIds(layout));
  return BAR_ITEMS.filter((item) => !there.has(item.id));
}

/** Put a figure at the end. A figure that is there already stays where it is. */
export function addBarItem(layout: BarLayout, id: BarItemId): BarLayout {
  if (!isBarItemId(id) || barItemIds(layout).includes(id)) return layout;
  return layoutOf([...layout.entries, { kind: 'item', id }]);
}

/** Put a button for a command at the end. */
export function addBarButton(layout: BarLayout, command: string, label = '', icon: string | null = null): BarLayout {
  const entry = readEntry({ kind: 'button', command, label, icon });
  if (entry === null || layout.entries.length >= MAX_BAR_ENTRIES) return layout;
  return layoutOf([...layout.entries, entry]);
}

/** Take out the entry at a place. A place that is not there changes nothing. */
export function removeBarEntry(layout: BarLayout, index: number): BarLayout {
  if (!Number.isInteger(index) || index < 0 || index >= layout.entries.length) return layout;
  return { entries: layout.entries.filter((_, at) => at !== index) };
}

/**
 * Move the entry at a place one step: -1 toward the start of the bar, 1
 * toward its end. At the edge, or for a place that is not there, nothing
 * changes.
 */
export function moveBarEntry(layout: BarLayout, index: number, step: -1 | 1): BarLayout {
  const to = index + step;
  const count = layout.entries.length;
  if (!Number.isInteger(index) || index < 0 || index >= count || to < 0 || to >= count) return layout;
  const entries = [...layout.entries];
  const moved = entries[index] as BarEntry;
  entries[index] = entries[to] as BarEntry;
  entries[to] = moved;
  return { entries };
}

/** Change what a button says or which icon it shows. Changes nothing when the place holds no button. */
export function editBarButton(
  layout: BarLayout,
  index: number,
  change: { readonly label?: string; readonly icon?: string | null },
): BarLayout {
  const entry = layout.entries[index];
  if (entry === undefined || entry.kind !== 'button') return layout;
  const next = readEntry({
    kind: 'button',
    command: entry.command,
    label: change.label ?? entry.label,
    icon: change.icon === undefined ? entry.icon : change.icon,
  });
  if (next === null) return layout;
  return { entries: layout.entries.map((other, at) => (at === index ? next : other)) };
}
