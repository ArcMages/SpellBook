// Saved views of the timeline: a combination of what one screen shows (the
// lanes hidden, the world lanes on or off and which of their types are
// hidden, and the filter by tags) kept under a name, to switch back to.
//
// Two views are built in and are never stored:
//   Story          the manuscript and the timelines; no world lanes, no filter
//   World history  the world lanes and the events; the manuscript hidden, no filter
// Both change only what they are about: a lane the writer hid on purpose
// stays hidden, and so does a type of the world. Switching back to Story
// always shows the Manuscript lane again, so the scenes are never "lost".
//
// Pure: no page, no vault. Views are choices of one device, so whatever comes
// back from storage is checked here before it is used.

import { tidyDisplayName } from './../names';
import { MANUSCRIPT_LANE, laneKey } from './common';
import { NO_TAG_FILTER, readTagFilter, sameTagFilter } from './tagFilter';
import type { TagFilter } from './tagFilter';

/** What the world lanes show: on or off, and the ids of the types whose lanes are hidden. */
export interface WorldChoice {
  readonly on: boolean;
  readonly hidden: readonly string[];
}

/** Everything a view sets. */
export interface ViewState {
  /** The names of the lanes hidden. */
  readonly hiddenLanes: readonly string[];
  readonly world: WorldChoice;
  readonly filter: TagFilter;
}

/** A view the writer saved. */
export interface SavedView extends ViewState {
  /** The writer's own text. */
  readonly name: string;
}

/** The built-in view of the story: the manuscript and the timelines, no world lanes. */
export const STORY_VIEW = 'Story';
/** The built-in view of the world's history: the world lanes and the events, the manuscript hidden. */
export const WORLD_HISTORY_VIEW = 'World history';
/** The names of the two built-in views, in the order the list of views shows them. */
export const BUILT_IN_VIEWS: readonly string[] = Object.freeze([STORY_VIEW, WORLD_HISTORY_VIEW]);

/** No more than this many views are kept per project. */
export const MAX_VIEWS = 30;
/** A view's name is cut to this many characters. */
export const MAX_VIEW_NAME = 60;

const nameKey = (name: string): string => name.normalize('NFC').toLowerCase();
const isManuscript = (name: string): boolean => laneKey(name) === laneKey(MANUSCRIPT_LANE);

/** True for the name of a built-in view, whatever its capitals. */
export function isBuiltInView(name: string): boolean {
  return BUILT_IN_VIEWS.some((builtIn) => nameKey(builtIn) === nameKey(tidyDisplayName(name)));
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const kept: string[] = [];
  for (const item of value) if (typeof item === 'string' && item !== '' && !kept.includes(item)) kept.push(item);
  return kept;
}

/** The world choice stored with a view, checked. */
function readWorld(value: unknown): WorldChoice {
  if (typeof value !== 'object' || value === null) return { on: false, hidden: [] };
  const record = value as Record<string, unknown>;
  return { on: record['on'] === true, hidden: stringList(record['hidden']) };
}

/** The views as they may be kept: checked, no name twice (whatever its capitals), no built-in name, not too many. */
export function readSavedViews(value: unknown): SavedView[] {
  if (!Array.isArray(value)) return [];
  const views: SavedView[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== 'object' || item === null) continue;
    const record = item as Record<string, unknown>;
    const name = typeof record['name'] === 'string' ? tidyDisplayName(record['name']).slice(0, MAX_VIEW_NAME) : '';
    if (name === '' || isBuiltInView(name) || seen.has(nameKey(name))) continue;
    seen.add(nameKey(name));
    views.push({
      name,
      hiddenLanes: stringList(record['hiddenLanes']),
      world: readWorld(record['world']),
      filter: readTagFilter(record['filter']),
    });
    if (views.length >= MAX_VIEWS) break;
  }
  return views;
}

/** What a built-in view makes of the screen as it is now. Null for a name that is not built in. */
export function builtInViewState(name: string, now: ViewState): ViewState | null {
  const others = now.hiddenLanes.filter((lane) => !isManuscript(lane));
  if (nameKey(name) === nameKey(STORY_VIEW)) {
    return { hiddenLanes: others, world: { on: false, hidden: now.world.hidden }, filter: NO_TAG_FILTER };
  }
  if (nameKey(name) === nameKey(WORLD_HISTORY_VIEW)) {
    return { hiddenLanes: [...others, MANUSCRIPT_LANE], world: { on: true, hidden: now.world.hidden }, filter: NO_TAG_FILTER };
  }
  return null;
}

const laneSet = (names: readonly string[]): string => [...new Set(names.map(laneKey))].sort().join('\n');
const idSet = (ids: readonly string[]): string => [...new Set(ids)].sort().join('\n');

/** True when two states show the same. While the world lanes are off, which of their types are hidden makes no difference. */
export function sameViewState(a: ViewState, b: ViewState): boolean {
  if (laneSet(a.hiddenLanes) !== laneSet(b.hiddenLanes)) return false;
  if (a.world.on !== b.world.on) return false;
  if (a.world.on && idSet(a.world.hidden) !== idSet(b.world.hidden)) return false;
  return sameTagFilter(a.filter, b.filter);
}

/**
 * The name of the view the screen shows now: the first saved view that is
 * exactly what is shown, else the built-in view whose idea it matches
 * (Story: no world lanes, the manuscript shown, no filter; World history:
 * the world lanes on, the manuscript hidden, no filter). Null for none.
 */
export function currentViewName(now: ViewState, saved: readonly SavedView[]): string | null {
  const own = saved.find((view) => sameViewState(view, now));
  if (own !== undefined) return own.name;
  for (const name of BUILT_IN_VIEWS) {
    const state = builtInViewState(name, now);
    if (state !== null && sameViewState(state, now)) return name;
  }
  return null;
}

/** What saving a view came to: the new list, or why not. */
export type SaveViewResult =
  | { readonly ok: true; readonly views: SavedView[]; readonly replaced: boolean }
  | { readonly ok: false; readonly message: string };

/**
 * Save the screen as it is under a name. A view of the same name (whatever
 * its capitals) is replaced in its place; a new one goes at the end.
 */
export function saveView(views: readonly SavedView[], name: string, state: ViewState): SaveViewResult {
  const tidy = tidyDisplayName(name).slice(0, MAX_VIEW_NAME);
  if (tidy === '') return { ok: false, message: 'A view needs a name.' };
  if (isBuiltInView(tidy)) return { ok: false, message: `"${tidy}" is a built-in view. Choose another name.` };
  const view: SavedView = {
    name: tidy,
    hiddenLanes: [...state.hiddenLanes],
    world: { on: state.world.on, hidden: [...state.world.hidden] },
    filter: { tags: [...state.filter.tags], match: state.filter.match, kinds: [...state.filter.kinds] },
  };
  const at = views.findIndex((existing) => nameKey(existing.name) === nameKey(tidy));
  if (at >= 0) return { ok: true, views: views.map((existing, index) => (index === at ? view : existing)), replaced: true };
  if (views.length >= MAX_VIEWS) return { ok: false, message: `No more than ${MAX_VIEWS} views can be saved. Delete one first.` };
  return { ok: true, views: [...views, view], replaced: false };
}

/** The views without the one of this name. */
export function deleteView(views: readonly SavedView[], name: string): SavedView[] {
  return views.filter((view) => nameKey(view.name) !== nameKey(name));
}
