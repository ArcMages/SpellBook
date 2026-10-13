// What a device remembers about how the outliner was left for each project:
// the column it is sorted by, the filter, and the folders folded shut.
//
// Kept per project, because a status to filter by or a folder to fold belongs
// to one project. Whatever comes back from the storage is checked before it
// is used: it can be anything (an older version's, or edited by hand).

import { parseStored } from './columns';
import { NO_FILTER, isFilterOn, readFilter } from './filter';
import type { OutlineFilter } from './filter';
import { readSort } from './sort';
import type { OutlineSort } from './sort';

/** How the outliner was left for one project. */
export interface ViewChoice {
  readonly sort: OutlineSort | null;
  readonly filter: OutlineFilter;
  /** The ids of the binder folders that are folded shut. */
  readonly collapsed: readonly string[];
}

/** How the outliner shows a project until the writer changes something. */
export const DEFAULT_VIEW: ViewChoice = Object.freeze({
  sort: null,
  filter: NO_FILTER,
  collapsed: Object.freeze([] as string[]),
});

/** How each project was left, by the project's index path; the one changed last comes last. */
export type ViewPrefs = ReadonlyMap<string, ViewChoice>;

export const VIEW_PREFS_VERSION = 1;

/** No more than this many projects are remembered, and this many folded folders in each. */
export const MAX_VIEW_PROJECTS = 20;
const MAX_COLLAPSED = 500;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** True when nothing about a project needs remembering. */
export function isDefaultView(choice: ViewChoice): boolean {
  return choice.sort === null && !isFilterOn(choice.filter) && choice.collapsed.length === 0;
}

/** Read how one project was left. Never throws. */
export function readViewChoice(saved: unknown): ViewChoice {
  if (!isRecord(saved)) return DEFAULT_VIEW;
  const folded = Array.isArray(saved['collapsed'])
    ? [...new Set(saved['collapsed'].filter((id): id is string => typeof id === 'string' && id !== ''))].slice(-MAX_COLLAPSED)
    : [];
  const choice: ViewChoice = { sort: readSort(saved['sort']), filter: readFilter(saved['filter']), collapsed: folded };
  return isDefaultView(choice) ? DEFAULT_VIEW : choice;
}

/** Read what a device saved. Never throws; anything unreadable is as if nothing had been saved. */
export function readViewPrefs(stored: unknown): Map<string, ViewChoice> {
  const prefs = new Map<string, ViewChoice>();
  const parsed = parseStored(stored);
  const projects: unknown = isRecord(parsed) ? parsed['projects'] : undefined;
  // A list of [index path, choice] pairs, so that the order is kept and no path can be mistaken for a built-in name.
  if (!Array.isArray(projects)) return prefs;
  for (const entry of projects) {
    if (!Array.isArray(entry)) continue;
    const [path, saved] = entry as unknown[];
    if (typeof path !== 'string' || path === '') continue;
    const choice = readViewChoice(saved);
    prefs.delete(path);
    if (!isDefaultView(choice)) prefs.set(path, choice);
  }
  while (prefs.size > MAX_VIEW_PROJECTS) {
    const oldest = prefs.keys().next();
    if (oldest.done === true) break;
    prefs.delete(oldest.value);
  }
  return prefs;
}

/** The text to save; null (nothing to keep) when no project needs remembering. */
export function writeViewPrefs(prefs: ViewPrefs): string | null {
  if (prefs.size === 0) return null;
  const projects = [...prefs].map(([path, choice]) => [
    path,
    { sort: choice.sort, filter: choice.filter, collapsed: choice.collapsed },
  ]);
  return JSON.stringify({ v: VIEW_PREFS_VERSION, projects });
}

/** How a project was left; the usual view when nothing is remembered about it. */
export function viewOf(prefs: ViewPrefs, project: string): ViewChoice {
  return prefs.get(project) ?? DEFAULT_VIEW;
}

/**
 * Remember how a project was left. It becomes the newest; when too many
 * projects are remembered, the oldest are forgotten. A project left in the
 * usual view is not remembered at all.
 */
export function withView(prefs: ViewPrefs, project: string, choice: ViewChoice): Map<string, ViewChoice> {
  const next = new Map(prefs);
  next.delete(project);
  if (!isDefaultView(choice)) {
    next.set(project, { ...choice, collapsed: choice.collapsed.slice(-MAX_COLLAPSED) });
  }
  while (next.size > MAX_VIEW_PROJECTS) {
    const oldest = next.keys().next();
    if (oldest.done === true) break;
    next.delete(oldest.value);
  }
  return next;
}

/**
 * A project's index note is at another path now (it, or its folder, was
 * renamed or moved): what was remembered goes with it.
 */
export function moveView(prefs: ViewPrefs, from: string, to: string): Map<string, ViewChoice> {
  const next = new Map(prefs);
  const choice = next.get(from);
  if (from === to || choice === undefined) return next;
  next.delete(from);
  next.delete(to);
  next.set(to, choice);
  return next;
}
