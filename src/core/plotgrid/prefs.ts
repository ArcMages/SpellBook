// What this device remembers about the plot grid: what the columns are, the
// entities picked for each project, the folders folded shut in each project,
// whether a scene's synopsis shows on a second line, how long a gap has
// to be before it is marked, and whether the scenes outside each plotline's
// span are shaded.
//
// It is saved as JSON text, and checked when it is read back, because it can
// be anything: an older version's, or something edited by hand.

import { isColumnKind } from './columns';
import type { ColumnKind } from './columns';
import { DEFAULT_GAP_LENGTH, readGapLength } from './grid';

/** No more than this many projects are remembered. */
const MAX_PROJECTS = 40;
/** No more than this many entities or folders are remembered per project. */
const MAX_ITEMS = 500;

export interface PlotGridPrefs {
  readonly kind: ColumnKind;
  readonly synopsisLine: boolean;
  /** How many scenes in a row make a gap worth marking; 0 for no marks. */
  readonly gapLength: number;
  /** Whether the scenes before a plotline's first scene and after its last are shaded. */
  readonly shadeOutside: boolean;
  /** The entities picked for the "Chosen entities" columns, by project index path. */
  readonly chosen: Readonly<Record<string, readonly string[]>>;
  /** The folded folders, by project index path. */
  readonly folded: Readonly<Record<string, readonly string[]>>;
}

export const DEFAULT_PREFS: PlotGridPrefs = Object.freeze({
  kind: 'lanes',
  synopsisLine: false,
  gapLength: DEFAULT_GAP_LENGTH,
  shadeOutside: true,
  chosen: Object.freeze({}),
  folded: Object.freeze({}),
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readLists(value: unknown): Record<string, string[]> {
  const lists: Record<string, string[]> = {};
  if (!isRecord(value)) return lists;
  for (const [project, list] of Object.entries(value).slice(0, MAX_PROJECTS)) {
    if (!Array.isArray(list)) continue;
    lists[project] = list.filter((item): item is string => typeof item === 'string' && item !== '').slice(0, MAX_ITEMS);
  }
  return lists;
}

/** What was saved, or the defaults for whatever cannot be read. */
export function readPrefs(stored: unknown): PlotGridPrefs {
  let value: unknown = stored;
  if (typeof stored === 'string') {
    try {
      value = JSON.parse(stored);
    } catch {
      value = null;
    }
  }
  if (!isRecord(value)) return DEFAULT_PREFS;
  return {
    kind: isColumnKind(value['kind']) ? value['kind'] : DEFAULT_PREFS.kind,
    synopsisLine: value['synopsisLine'] === true,
    gapLength: value['gapLength'] === undefined ? DEFAULT_GAP_LENGTH : readGapLength(value['gapLength']),
    shadeOutside: value['shadeOutside'] !== false,
    chosen: readLists(value['chosen']),
    folded: readLists(value['folded']),
  };
}

/** The text to save. */
export function writePrefs(prefs: PlotGridPrefs): string {
  return JSON.stringify(prefs);
}

function withList(
  lists: Readonly<Record<string, readonly string[]>>,
  project: string,
  list: readonly string[],
): Record<string, readonly string[]> {
  const next: Record<string, readonly string[]> = {};
  // The project goes last, so that the projects used longest ago are the first to be forgotten.
  for (const [key, value] of Object.entries(lists)) if (key !== project) next[key] = value;
  if (list.length > 0) next[project] = [...new Set(list)].slice(0, MAX_ITEMS);
  const keys = Object.keys(next);
  for (const key of keys.slice(0, Math.max(0, keys.length - MAX_PROJECTS))) delete next[key];
  return next;
}

export function chosenOf(prefs: PlotGridPrefs, project: string): readonly string[] {
  return prefs.chosen[project] ?? [];
}

export function withChosen(prefs: PlotGridPrefs, project: string, chosen: readonly string[]): PlotGridPrefs {
  return { ...prefs, chosen: withList(prefs.chosen, project, chosen) };
}

export function foldedOf(prefs: PlotGridPrefs, project: string): ReadonlySet<string> {
  return new Set(prefs.folded[project] ?? []);
}

export function withFolded(prefs: PlotGridPrefs, project: string, folded: Iterable<string>): PlotGridPrefs {
  return { ...prefs, folded: withList(prefs.folded, project, [...folded]) };
}

/** The same project at another path: what was remembered under the old one goes with it. */
export function movePrefs(prefs: PlotGridPrefs, from: string, to: string): PlotGridPrefs {
  if (from === to) return prefs;
  let next = prefs;
  if (prefs.chosen[from] !== undefined) next = withChosen(withChosen(next, from, []), to, prefs.chosen[from] ?? []);
  if (prefs.folded[from] !== undefined) next = withFolded(withFolded(next, from, []), to, prefs.folded[from] ?? []);
  return next;
}

/**
 * A chosen entity was renamed or moved: its new path takes the old one's
 * place in every list of chosen entities of the project.
 */
export function renameChosen(prefs: PlotGridPrefs, project: string, from: string, to: string): PlotGridPrefs {
  const list = prefs.chosen[project];
  if (list === undefined || !list.includes(from)) return prefs;
  return withChosen(prefs, project, list.map((path) => (path === from ? to : path)));
}
