// The lanes of the timeline.
//
// The project index keeps them, in the order they are shown, under one key:
//
//   timelines:
//     - name: Main plot
//       color: purple
//     - name: Backstory
//
// Two lanes are built in. "Manuscript" holds every scene that has a date and
// comes first; "Other" collects the events that name a timeline the project
// does not list, and comes last, only when there is something in it. Either
// can be listed like any lane, which gives it a colour and a place of its own.
//
// Every function that changes the lanes takes the stored value as it is and
// returns the value to store. Entries it does not understand, and properties
// of a lane it does not know, come back untouched.

import { tidyDisplayName } from './../names';
import {
  MANUSCRIPT_KEY,
  MANUSCRIPT_LANE,
  OTHER_KEY,
  OTHER_LANE,
  isEmptyPatch,
  isRecord,
  laneKey,
  readLaneColor,
  readName,
} from './common';
import type { FrontmatterPatch, Lane, LaneColor } from './common';
import { laneAssigner, renameLaneInEventPatch } from './eventLanes';
import type { TimelineEvent, TimelineNote } from './events';

/** The lanes read from the project index. */
export interface LaneList {
  /** The lanes the index lists, in order, each name once. The built-in lanes are here only if the index lists them. */
  readonly lanes: readonly Lane[];
  /** What was skipped while reading, in plain English; empty when all is well. */
  readonly problems: readonly string[];
  /** False when the stored value is not a list of lanes at all. Changes are then refused, so nothing is overwritten. */
  readonly readable: boolean;
}

/** Whether a lane is the built-in Manuscript lane, the built-in Other lane, or one of the writer's own. */
export type LaneKind = 'manuscript' | 'lane' | 'other';

/** A lane as the screen shows it. */
export interface DisplayLane extends Lane {
  /** What the lane is looked up by (see `laneKey`). */
  readonly key: string;
  readonly kind: LaneKind;
}

/**
 * Why a change to the lanes was refused.
 *  - unreadable: the stored value is not a list of lanes; nothing may be written over it.
 *  - empty-name: the name is empty.
 *  - name-taken: another lane has the name (capitals do not count), or it is a built-in lane's.
 *  - not-found:  there is no lane of that name.
 *  - built-in:   Manuscript and Other cannot be renamed or removed.
 */
export type LaneRefusal = 'unreadable' | 'empty-name' | 'name-taken' | 'not-found' | 'built-in';

/** What a change to the lanes came to. */
export type LaneChange =
  | {
      readonly ok: true;
      /** False when the lanes were already as asked; nothing needs writing then. */
      readonly changed: boolean;
      /** The value to store under the index's "timelines" key. */
      readonly value: unknown[];
      /** The lanes as they now read. */
      readonly lanes: readonly Lane[];
    }
  | {
      readonly ok: false;
      readonly reason: LaneRefusal;
      /** The reason in plain English. */
      readonly message: string;
    };

/** The change one event note needs. */
export interface EventPatch {
  readonly path: string;
  readonly patch: FrontmatterPatch;
}

/** What renaming a lane came to: the lanes, and the change for every event that names the lane. */
export type LaneRename =
  | (Extract<LaneChange, { readonly ok: true }> & { readonly eventPatches: readonly EventPatch[] })
  | Extract<LaneChange, { readonly ok: false }>;

// ------------------------------------------------------------------ reading

type Slot =
  | {
      readonly kind: 'lane';
      readonly key: string;
      readonly name: string;
      readonly color: LaneColor | null;
      readonly raw: unknown;
      /** False for a later entry that repeats an earlier lane's name. */
      readonly first: boolean;
    }
  | { readonly kind: 'opaque'; readonly raw: unknown };

type LaneSlot = Extract<Slot, { readonly kind: 'lane' }>;

interface Slots {
  readonly slots: Slot[];
  readonly problems: string[];
}

/** The stored value as a row of slots, or null when it is not a list of lanes at all. */
function readSlots(value: unknown): Slots | null {
  if (value === undefined || value === null) return { slots: [], problems: [] };
  let entries: readonly unknown[];
  if (Array.isArray(value)) entries = value;
  else if (typeof value === 'string' || isRecord(value)) entries = [value];
  else return null;

  const slots: Slot[] = [];
  const problems: string[] = [];
  const seen = new Set<string>();
  entries.forEach((raw: unknown, index) => {
    const name = isRecord(raw) ? readName(raw['name']) : typeof raw === 'string' ? readName(raw) : null;
    if (name === null) {
      problems.push(`Entry ${index + 1} of the timelines is not a lane with a name; it was left as it is.`);
      slots.push({ kind: 'opaque', raw });
      return;
    }
    const key = laneKey(name);
    const first = !seen.has(key);
    seen.add(key);
    if (!first) problems.push(`Two timelines are named "${name}"; only the first one is used.`);
    slots.push({ kind: 'lane', key, name, color: isRecord(raw) ? readLaneColor(raw['color']) : null, raw, first });
  });
  return { slots, problems };
}

const isShown = (slot: Slot): slot is LaneSlot => slot.kind === 'lane' && slot.first;

function lanesOf(slots: readonly Slot[]): Lane[] {
  return slots.filter(isShown).map((slot): Lane => ({ name: slot.name, color: slot.color }));
}

/**
 * Read the "timelines" key of the project index. Never throws. Each entry is
 * a name with an optional colour; a bare name is accepted too. An entry that
 * is not understood is skipped and reported, and so is a second lane with a
 * name already seen (capitals do not count). A colour that is not one of the
 * eight names reads as no colour.
 */
export function readLanes(value: unknown): LaneList {
  const read = readSlots(value);
  if (read === null) {
    return {
      lanes: [],
      problems: ['The "timelines" property of the project is not a list of lanes, so it was left as it is.'],
      readable: false,
    };
  }
  return { lanes: lanesOf(read.slots), problems: read.problems, readable: true };
}

// ------------------------------------------------------------------ changing

function refuse(reason: LaneRefusal, message: string): Extract<LaneChange, { readonly ok: false }> {
  return { ok: false, reason, message };
}

const UNREADABLE = refuse(
  'unreadable',
  'The "timelines" property of the project is not a list of lanes. Mend it by hand first; nothing was changed.',
);

function done(slots: readonly Slot[], changed: boolean): Extract<LaneChange, { readonly ok: true }> {
  return { ok: true, changed, value: slots.map((slot) => slot.raw), lanes: lanesOf(slots) };
}

function laneSlot(name: string, color: LaneColor | null, first = true): LaneSlot {
  const raw = color === null ? { name } : { name, color };
  return { kind: 'lane', key: laneKey(name), name, color, raw, first };
}

function withName(slot: LaneSlot, name: string): LaneSlot {
  const raw = isRecord(slot.raw) ? { ...slot.raw, name } : name;
  return { ...slot, name, raw };
}

function withColor(slot: LaneSlot, color: LaneColor | null): LaneSlot {
  let raw: unknown;
  if (isRecord(slot.raw)) {
    const copy: Record<string, unknown> = { ...slot.raw };
    if (color === null) delete copy['color'];
    else copy['color'] = color;
    raw = copy;
  } else {
    raw = color === null ? slot.raw : { name: slot.name, color };
  }
  return { ...slot, color, raw };
}

const isBuiltIn = (key: string): boolean => key === MANUSCRIPT_KEY || key === OTHER_KEY;
const builtInName = (key: string): string => (key === MANUSCRIPT_KEY ? MANUSCRIPT_LANE : OTHER_LANE);
const hasLane = (slots: readonly Slot[], key: string): boolean => slots.some((slot) => isShown(slot) && slot.key === key);

/**
 * Add a lane after the others: at the end of the list, or just before Other
 * when the index lists Other last (as it does once Other has a colour), so
 * that Other stays after the rest. The name is tidied (spaces at the ends
 * and runs of spaces go). Refused when the name is empty or taken.
 *
 * @param value the index's "timelines" value as it is now
 */
export function addLane(value: unknown, name: string, color: LaneColor | null = null): LaneChange {
  const read = readSlots(value);
  if (read === null) return UNREADABLE;
  const tidy = tidyDisplayName(name);
  if (tidy === '') return refuse('empty-name', 'A lane needs a name.');
  const key = laneKey(tidy);
  if (isBuiltIn(key)) return refuse('name-taken', `"${builtInName(key)}" is a built-in lane. Choose another name.`);
  if (hasLane(read.slots, key)) return refuse('name-taken', `There is already a lane named "${tidy}".`);
  const added = laneSlot(tidy, readLaneColor(color));
  const shown = read.slots.filter(isShown);
  const last = shown[shown.length - 1];
  if (last === undefined || last.key !== OTHER_KEY) return done([...read.slots, added], true);
  const place = read.slots.indexOf(last);
  return done([...read.slots.slice(0, place), added, ...read.slots.slice(place)], true);
}

/**
 * Rename a lane, and work out the change for every event that names it.
 *
 * The event changes in the result are made from the properties passed in.
 * When writing a note, read its properties again and use
 * `renameLaneInEventPatch` on them, since another device may have changed it.
 *
 * @param value the index's "timelines" value as it is now
 * @param notes every note that may name the lane: the events, and the scenes
 */
export function renameLane(value: unknown, from: string, to: string, notes: readonly TimelineNote[] = []): LaneRename {
  const read = readSlots(value);
  if (read === null) return UNREADABLE;
  const fromKey = laneKey(from);
  if (isBuiltIn(fromKey)) return refuse('built-in', `The ${builtInName(fromKey)} lane cannot be renamed.`);
  if (!hasLane(read.slots, fromKey)) return refuse('not-found', `There is no lane named "${from.trim()}".`);
  const tidy = tidyDisplayName(to);
  if (tidy === '') return refuse('empty-name', 'A lane needs a name.');
  const toKey = laneKey(tidy);
  if (isBuiltIn(toKey)) return refuse('name-taken', `"${builtInName(toKey)}" is a built-in lane. Choose another name.`);
  if (toKey !== fromKey && hasLane(read.slots, toKey)) {
    return refuse('name-taken', `There is already a lane named "${tidy}".`);
  }

  let changed = false;
  const slots = read.slots.map((slot): Slot => {
    if (slot.kind !== 'lane' || slot.key !== fromKey || slot.name === tidy) return slot;
    changed = true;
    return { ...withName(slot, tidy), key: toKey };
  });
  const eventPatches: EventPatch[] = [];
  for (const note of notes) {
    const patch = renameLaneInEventPatch(note.frontmatter, from, tidy);
    if (!isEmptyPatch(patch)) eventPatches.push({ path: note.path, patch });
  }
  return { ...done(slots, changed), eventPatches };
}

/**
 * Give a lane a colour, or none (null). An unknown colour that was written
 * by hand stays until a real one replaces it. Recolouring a built-in lane
 * that the index does not list yet lists it.
 */
export function recolourLane(value: unknown, name: string, color: LaneColor | null): LaneChange {
  const read = readSlots(value);
  if (read === null) return UNREADABLE;
  const key = laneKey(name);
  const wanted = readLaneColor(color);
  if (!hasLane(read.slots, key)) {
    if (!isBuiltIn(key)) return refuse('not-found', `There is no lane named "${name.trim()}".`);
    if (wanted === null) return done(read.slots, false);
    const slot = laneSlot(builtInName(key), wanted);
    return done(key === MANUSCRIPT_KEY ? [slot, ...read.slots] : [...read.slots, slot], true);
  }
  let changed = false;
  const slots = read.slots.map((slot): Slot => {
    if (!isShown(slot) || slot.key !== key || slot.color === wanted) return slot;
    changed = true;
    return withColor(slot, wanted);
  });
  return done(slots, changed);
}

/**
 * Move a lane to another place in the order. Entries that repeat its name
 * go with it, so the lane reads the same after the move as before.
 *
 * @param toIndex the place it should take, counted from 0 in the list that
 *   `displayLanes` gives (Manuscript first unless the index lists it
 *   elsewhere). A place past the end means last.
 */
export function moveLane(value: unknown, name: string, toIndex: number): LaneChange {
  const read = readSlots(value);
  if (read === null) return UNREADABLE;
  const key = laneKey(name);

  // The built-in lanes take part in the order even when the index does not list them.
  const manuscriptAdded = !hasLane(read.slots, MANUSCRIPT_KEY);
  const otherAdded = key === OTHER_KEY && !hasLane(read.slots, OTHER_KEY);
  let slots: Slot[] = [...read.slots];
  if (manuscriptAdded) slots.unshift(laneSlot(MANUSCRIPT_LANE, null));
  if (otherAdded) slots.push(laneSlot(OTHER_LANE, null));

  const moving = slots.find((slot): slot is LaneSlot => isShown(slot) && slot.key === key);
  if (moving === undefined) return refuse('not-found', `There is no lane named "${name.trim()}".`);

  const shownBefore = slots.filter(isShown);
  const last = shownBefore.length - 1;
  const target = Number.isFinite(toIndex) ? Math.min(last, Math.max(0, Math.trunc(toIndex))) : last;
  if (shownBefore.indexOf(moving) === target) return done(read.slots, false);

  // Every entry of the name goes along, the one that is read first. Left
  // behind, a repeated entry would come before it and be read in its place.
  const named = slots.filter((slot) => slot.kind === 'lane' && slot.key === key);
  slots = slots.filter((slot) => !named.includes(slot));
  const next = slots.filter(isShown)[target];
  if (next === undefined) slots.push(...named);
  else slots.splice(slots.indexOf(next), 0, ...named);

  // A built-in lane still in its usual place need not be written down.
  const shown = slots.filter(isShown);
  const first = shown[0];
  const final = shown[shown.length - 1];
  if (manuscriptAdded && first !== undefined && first.key === MANUSCRIPT_KEY) slots = slots.filter((slot) => slot !== first);
  if (otherAdded && final !== undefined && final.key === OTHER_KEY) slots = slots.filter((slot) => slot !== final);

  const changed = slots.length !== read.slots.length || slots.some((slot, index) => slot !== read.slots[index]);
  return done(slots, changed);
}

/**
 * Remove a lane from the list. Its events are not touched: they still name
 * it, and show in the Other lane from then on.
 */
export function removeLane(value: unknown, name: string): LaneChange {
  const read = readSlots(value);
  if (read === null) return UNREADABLE;
  const key = laneKey(name);
  if (isBuiltIn(key)) return refuse('built-in', `The ${builtInName(key)} lane cannot be removed.`);
  if (!hasLane(read.slots, key)) return refuse('not-found', `There is no lane named "${name.trim()}".`);
  return done(
    read.slots.filter((slot) => slot.kind !== 'lane' || slot.key !== key),
    true,
  );
}

// ------------------------------------------------------------------- showing

/**
 * The lanes to show, in order: the ones the index lists, with Manuscript put
 * first when the index does not list it, and Other put last when the index
 * does not list it and some event belongs there.
 *
 * @param lanes  the lanes of the index (see `readLanes`)
 * @param events the events of the timeline; they decide whether Other is needed
 */
export function displayLanes(lanes: readonly Lane[], events: readonly TimelineEvent[] = []): DisplayLane[] {
  const shown: DisplayLane[] = [];
  const seen = new Set<string>();
  for (const lane of lanes) {
    const key = laneKey(lane.name);
    if (seen.has(key)) continue;
    seen.add(key);
    if (key === MANUSCRIPT_KEY) shown.push({ name: MANUSCRIPT_LANE, color: lane.color, key, kind: 'manuscript' });
    else if (key === OTHER_KEY) shown.push({ name: OTHER_LANE, color: lane.color, key, kind: 'other' });
    else shown.push({ name: lane.name, color: lane.color, key, kind: 'lane' });
  }
  if (!seen.has(MANUSCRIPT_KEY)) {
    shown.unshift({ name: MANUSCRIPT_LANE, color: null, key: MANUSCRIPT_KEY, kind: 'manuscript' });
  }
  if (!seen.has(OTHER_KEY)) {
    const keysOf = laneAssigner(lanes);
    if (events.some((event) => keysOf(event).includes(OTHER_KEY))) {
      shown.push({ name: OTHER_LANE, color: null, key: OTHER_KEY, kind: 'other' });
    }
  }
  return shown;
}

/**
 * Leave out the lanes this device has hidden.
 *
 * @param hidden the names (or keys) of the hidden lanes; capitals do not count
 */
export function visibleLanes<T extends { readonly name: string }>(lanes: readonly T[], hidden: Iterable<string>): T[] {
  const hiddenKeys = new Set<string>();
  for (const name of hidden) hiddenKeys.add(laneKey(name));
  return lanes.filter((lane) => !hiddenKeys.has(laneKey(lane.name)));
}
