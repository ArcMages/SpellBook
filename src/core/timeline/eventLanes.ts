// Which lanes an event is in, and the changes that put it in another one.
//
// An event names its lanes in its "timelines" property. Every change here
// rewrites that one list and nothing else, and keeps each entry it was not
// asked to change exactly as it was written, including entries it does not
// understand.

import { MANUSCRIPT_KEY, OTHER_KEY, isRecord, laneKey, readName } from './common';
import type { FrontmatterPatch, Lane } from './common';
import type { EventSource, TimelineEvent } from './events';

/** What a lane change needs to know besides the note's properties. */
export interface LaneContext {
  /** The lanes the project index lists (see `readLanes`). */
  readonly lanes: readonly Lane[];
  /**
   * 'scene' when the note is a scene. A scene is always in the Manuscript
   * lane: it cannot be taken out of it and need not be put in it.
   */
  readonly source?: EventSource;
}

interface Entry {
  readonly raw: unknown;
  /** The lane the entry names; null for an entry that names none. */
  readonly key: string | null;
}

function entriesOf(frontmatter: unknown): Entry[] {
  const value: unknown = isRecord(frontmatter) ? frontmatter['timelines'] : undefined;
  if (value === undefined || value === null) return [];
  const list: readonly unknown[] = Array.isArray(value) ? value : [value];
  return list.map((raw): Entry => {
    const name = readName(raw);
    return { raw, key: name === null ? null : laneKey(name) };
  });
}

function knownKeys(lanes: readonly Lane[]): Set<string> {
  const known = new Set(lanes.map((lane) => laneKey(lane.name)));
  known.add(MANUSCRIPT_KEY);
  return known;
}

/** The patch for a new list, or an empty patch when nothing would change. */
function patchFor(before: readonly Entry[], after: readonly unknown[]): FrontmatterPatch {
  const same = before.length === after.length && before.every((entry, index) => entry.raw === after[index]);
  return same ? {} : { timelines: [...after] };
}

/**
 * The lanes an event shows in, as lane keys (see `laneKey`). A scene is in
 * the Manuscript lane. A name the project does not list, and an event that
 * names no lane at all, land in the Other lane. An event can be in several
 * lanes; each key comes once.
 */
export function eventLaneKeys(event: TimelineEvent, lanes: readonly Lane[]): string[] {
  return laneAssigner(lanes)(event);
}

/** `eventLaneKeys` for many events: the lane list is looked through only once. */
export function laneAssigner(lanes: readonly Lane[]): (event: TimelineEvent) => string[] {
  const known = knownKeys(lanes);
  return (event: TimelineEvent): string[] => {
    const keys: string[] = [];
    const add = (key: string): void => {
      if (!keys.includes(key)) keys.push(key);
    };
    if (event.source === 'scene') add(MANUSCRIPT_KEY);
    for (const name of event.timelines) {
      const key = laneKey(name);
      add(known.has(key) ? key : OTHER_KEY);
    }
    if (keys.length === 0) add(OTHER_KEY);
    return keys;
  };
}

/**
 * The change that adds an event to a lane, keeping the lanes it is in.
 * Empty when it is there already, and for the Other lane when the project
 * lists no lane of that name: Other only collects, nothing can be put in it.
 *
 * @param frontmatter the note's properties as they are now
 * @param lane        the lane's name
 */
export function addEventToLanePatch(frontmatter: unknown, lane: string, context: LaneContext): FrontmatterPatch {
  const name = lane.trim();
  const key = laneKey(name);
  const known = knownKeys(context.lanes);
  if (name === '' || (key === OTHER_KEY && !known.has(key))) return {};
  if (context.source === 'scene' && key === MANUSCRIPT_KEY) return {};
  const entries = entriesOf(frontmatter);
  if (entries.some((entry) => entry.key === key)) return {};
  return patchFor(entries, [...entries.map((entry) => entry.raw), name]);
}

/** Tells which entries put the event in the lane `key`. For the Other lane those are the unlisted names. */
function inLane(key: string, known: ReadonlySet<string>): (entry: Entry) => boolean {
  if (key === OTHER_KEY && !known.has(key)) return (entry) => entry.key !== null && !known.has(entry.key);
  return (entry) => entry.key === key;
}

/**
 * The change that takes an event out of a lane. Taking it out of the Other
 * lane removes every name the project does not list. Empty when the event
 * does not name the lane, which is always so for a scene and Manuscript.
 */
export function removeEventFromLanePatch(frontmatter: unknown, lane: string, context: LaneContext): FrontmatterPatch {
  const leaving = inLane(laneKey(lane), knownKeys(context.lanes));
  const entries = entriesOf(frontmatter);
  return patchFor(
    entries,
    entries.filter((entry) => !leaving(entry)).map((entry) => entry.raw),
  );
}

/**
 * The change that moves an event from one lane to another: `to` takes the
 * place `from` had in the list. The other lanes it is in are kept. Empty when
 * the two are the same lane, or when `to` is the Other lane and the project
 * lists no lane of that name.
 *
 * A scene always stays in Manuscript: moved from it, the scene is only added
 * to `to`; moved to it, the scene is only taken out of `from`.
 */
export function moveEventToLanePatch(
  frontmatter: unknown,
  from: string,
  to: string,
  context: LaneContext,
): FrontmatterPatch {
  const name = to.trim();
  const toKey = laneKey(name);
  const fromKey = laneKey(from);
  const known = knownKeys(context.lanes);
  if (name === '' || toKey === fromKey || (toKey === OTHER_KEY && !known.has(toKey))) return {};

  const leaving = inLane(fromKey, known);
  const entries = entriesOf(frontmatter);
  const isThere = context.source === 'scene' && toKey === MANUSCRIPT_KEY;
  let placed = isThere || entries.some((entry) => entry.key === toKey);
  const after: unknown[] = [];
  for (const entry of entries) {
    if (!leaving(entry)) after.push(entry.raw);
    else if (!placed) {
      after.push(name);
      placed = true;
    }
  }
  if (!placed) after.push(name);
  return patchFor(entries, after);
}

/**
 * The change one event needs when a lane is renamed: the new name takes the
 * old one's place in its "timelines". Empty when the event does not name the
 * lane, or already names it exactly as `to`.
 */
export function renameLaneInEventPatch(frontmatter: unknown, from: string, to: string): FrontmatterPatch {
  const name = to.trim();
  const fromKey = laneKey(from);
  const toKey = laneKey(name);
  if (name === '') return {};
  const entries = entriesOf(frontmatter);
  let placed = toKey !== fromKey && entries.some((entry) => entry.key === toKey);
  const after: unknown[] = [];
  for (const entry of entries) {
    if (entry.key !== fromKey) after.push(entry.raw);
    else if (!placed) {
      after.push(name);
      placed = true;
    }
  }
  return patchFor(entries, after);
}
