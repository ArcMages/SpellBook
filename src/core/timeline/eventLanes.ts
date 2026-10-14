// Which lanes an event is in, and the changes that put it in another one.
//
// An event names its lanes in its "timelines" property. Every change here
// rewrites that one list and nothing else, and keeps each entry it was not
// asked to change exactly as it was written, including entries it does not
// understand.

import { MANUSCRIPT_KEY, MANUSCRIPT_LANE, OTHER_KEY, OTHER_LANE, isRecord, laneKey, readName } from './common';
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

/**
 * The patch for a new list, or an empty patch when nothing would change. A
 * list that comes out empty takes the property away, rather than leave
 * "timelines: []" in the note.
 */
function patchFor(before: readonly Entry[], after: readonly unknown[]): FrontmatterPatch {
  const same = before.length === after.length && before.every((entry, index) => entry.raw === after[index]);
  if (same) return {};
  return after.length === 0 ? { timelines: undefined } : { timelines: [...after] };
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
 * The name to write in a note for a lane. Give the lane's key (as a drag or
 * `laneAt` reports it) or its name in any capitals: the result is the name
 * as the project spells it, "Manuscript" or "Other" for the built-in lanes,
 * and the text itself, trimmed at its ends, for a lane the project does not
 * list. The changes to an event's lanes use it, so they can be handed a key.
 *
 * @param lane  the lane's key or name
 * @param lanes the lanes the project index lists (see `readLanes`)
 */
export function laneNameFor(lane: string, lanes: readonly Lane[]): string {
  const key = laneKey(lane);
  if (key === MANUSCRIPT_KEY) return MANUSCRIPT_LANE;
  if (key === OTHER_KEY) return OTHER_LANE;
  const listed = lanes.find((candidate) => laneKey(candidate.name) === key);
  return listed === undefined ? lane.trim() : listed.name;
}

/**
 * Tells which entries of "timelines" put the event in the lane `key`. The
 * Other lane holds the names the project does not list, and the name Other
 * itself: the rule `laneAssigner` shows events by, whether or not the
 * project lists a lane named Other.
 */
function inLane(key: string, known: ReadonlySet<string>): (entry: Entry) => boolean {
  if (key === OTHER_KEY) return (entry) => entry.key !== null && (entry.key === OTHER_KEY || !known.has(entry.key));
  return (entry) => entry.key === key;
}

/**
 * The change that adds an event to a lane, keeping the lanes it is in.
 * Empty when a name on the note puts it there already, and for the Other
 * lane when the project lists no lane of that name: Other only collects,
 * nothing can be put in it.
 *
 * @param frontmatter the note's properties as they are now
 * @param lane        the lane's key or name; it is written as the project spells it (see `laneNameFor`)
 */
export function addEventToLanePatch(frontmatter: unknown, lane: string, context: LaneContext): FrontmatterPatch {
  const key = laneKey(lane);
  const known = knownKeys(context.lanes);
  if (key === '' || (key === OTHER_KEY && !known.has(key))) return {};
  if (context.source === 'scene' && key === MANUSCRIPT_KEY) return {};
  const entries = entriesOf(frontmatter);
  if (entries.some(inLane(key, known))) return {};
  return patchFor(entries, [...entries.map((entry) => entry.raw), laneNameFor(lane, context.lanes)]);
}

/**
 * The change that takes an event out of a lane. Taking it out of the Other
 * lane removes every name the project does not list, and the name Other
 * itself. Empty when the event does not name the lane, which is always so
 * for a scene and Manuscript.
 *
 * @param lane the lane's key or name
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
 *
 * @param from the key or name of the lane the event leaves
 * @param to   the key or name of the lane it goes to; it is written as the project spells it (see `laneNameFor`)
 */
export function moveEventToLanePatch(
  frontmatter: unknown,
  from: string,
  to: string,
  context: LaneContext,
): FrontmatterPatch {
  const toKey = laneKey(to);
  const fromKey = laneKey(from);
  const known = knownKeys(context.lanes);
  if (toKey === '' || toKey === fromKey || (toKey === OTHER_KEY && !known.has(toKey))) return {};

  const name = laneNameFor(to, context.lanes);
  const leaving = inLane(fromKey, known);
  const arriving = inLane(toKey, known);
  const entries = entriesOf(frontmatter);
  const isThere = context.source === 'scene' && toKey === MANUSCRIPT_KEY;
  // An entry that is about to go does not keep the event in the new lane.
  let placed = isThere || entries.some((entry) => arriving(entry) && !leaving(entry));
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
