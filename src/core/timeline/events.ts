// Timeline events.
//
// An event is a note in <Project>/Timeline/. Its properties say when it
// happens and where it shows:
//
//   spellbook: event
//   date: 1923-04-12        a year, a month or a day
//   end: 1923-04-20         optional: makes the event a span
//   timelines: [Main plot]  the lanes it shows in
//   scenes: ["[[Opening]]"] the scenes that tell it
//   entities: ["[[Mara]]"]  the people, places and things of the World folder it involves
//   tags: [war]
//
// A scene with a date is an event too, in the built-in Manuscript lane.
//
// In a project with an invented calendar (see calendar.ts) the dates are
// written in that calendar's own form, "1203-04-17 AE", and only that form
// is read: a real-world date left over from before is reported, not guessed at.
//
// Reading never throws. A note edited by hand or by another device may hold
// anything: what is understood is kept and the rest is reported.

import { clashKey, isInside, isMarkdownPath, noteTitle } from './../paths';
import type { Frontmatter } from './../types';
import { calendarExampleText } from './calendar';
import type { StoryCalendar } from './calendar';
import { isRecord, laneKey, readName } from './common';
import type { FrontmatterPatch } from './common';
import {
  carryStoryDate,
  compareStoryDates,
  dayNumberToStoryDate,
  isBlankValue,
  moveDates,
  parseDateValue,
  sameStoryDate,
  storyDateToDayNumber,
  storyDateToFrontmatter,
  storyDateToText,
} from './storyDate';
import type { ParsedDateValue, StoryDate } from './storyDate';

/** The folder of a project that holds one note per event. */
export const TIMELINE_FOLDER = 'Timeline';

/** The property that marks a note the plugin made as an event... */
export const EVENT_MARKER_KEY = 'spellbook';
/** ...and its value. */
export const EVENT_MARKER_VALUE = 'event';

/** Where an event comes from: a note in Timeline/, or a scene that has a date. */
export type EventSource = 'event' | 'scene';

/**
 * Something in an event's properties that could not be used.
 *  - date-unreadable:  "date" holds something that is not a date; the event is undated.
 *  - end-unreadable:   "end" holds something that is not a date; the event is a point.
 *  - end-before-start: "end" is earlier than "date"; the event is a point at its start.
 *  - end-without-date: there is an "end" but no usable "date"; the event is undated.
 *  - timelines-unreadable: some entry of "timelines" is not a name; it was skipped.
 *  - scenes-unreadable:    some entry of "scenes" is not a link; it was skipped.
 *  - entities-unreadable:  some entry of "entities" is not a link; it was skipped.
 */
export type EventProblem =
  | 'date-unreadable'
  | 'end-unreadable'
  | 'end-before-start'
  | 'end-without-date'
  | 'timelines-unreadable'
  | 'scenes-unreadable'
  | 'entities-unreadable';

/** One event of the timeline. */
export interface TimelineEvent {
  /** The note's path, as it was given to the reader. It is the event's identity. */
  readonly path: string;
  /** The file name without ".md", exactly as it is on disk. */
  readonly title: string;
  readonly source: EventSource;
  /** When it happens; null for an undated event. */
  readonly start: StoryDate | null;
  /** When it ends, for a span; null for a point. Always later than `start`. */
  readonly end: StoryDate | null;
  /** The timelines the note names, as written, each once. A scene's Manuscript lane is not listed here. */
  readonly timelines: readonly string[];
  /** The scenes the note links, as link targets: "Opening", "Manuscript/Opening" or a path. */
  readonly scenes: readonly string[];
  /** The entities the note links (notes of the World folder), as link targets: "Mara" or "World/Mara". */
  readonly entities: readonly string[];
  /** The note's tags, without "#". */
  readonly tags: readonly string[];
  /** What could not be used, for the screen to point out; empty when all is well. */
  readonly problems: readonly EventProblem[];
}

/** A note handed to the reader: its path and its properties (anything, even nothing). */
export interface TimelineNote {
  readonly path: string;
  readonly frontmatter: unknown;
}

/** Every event of a project. */
export interface TimelineModel {
  /** Events with a date, earliest first. */
  readonly dated: readonly TimelineEvent[];
  /** Events without a usable date, in the order the notes were given. */
  readonly undated: readonly TimelineEvent[];
}

/** True for the path (relative to the project folder) of a note in Timeline/, at any depth. */
export function isEventPath(path: string): boolean {
  return isInside(TIMELINE_FOLDER, path) && isMarkdownPath(path);
}

/**
 * An event problem in plain English, for the screen to show.
 *
 * @param calendar the project's invented calendar, when it has one: the advice about dates is then about that calendar
 */
export function describeEventProblem(problem: EventProblem, calendar?: StoryCalendar | null): string {
  switch (problem) {
    case 'date-unreadable':
      if (calendar !== undefined && calendar !== null) {
        return (
          `The date is not a date of the calendar "${calendar.name}", so the event is undated. ` +
          `Nothing was changed in the note. Use "Set date" to pick a date, which is then written like ${calendarExampleText(calendar)}.`
        );
      }
      return 'The date could not be read. Write it as a year, a year and month, or a full date: 1923, 1923-04 or 1923-04-12.';
    case 'end-unreadable':
      return 'The end date could not be read, so the event is shown as a single moment.';
    case 'end-before-start':
      return 'The end date is earlier than the date, so the event is shown as a single moment.';
    case 'end-without-date':
      return 'There is an end date but no date, so the event is undated.';
    case 'timelines-unreadable':
      return 'Some entries of "timelines" are not names of timelines, so they were skipped.';
    case 'scenes-unreadable':
      return 'Some entries of "scenes" are not links to scenes, so they were skipped.';
    case 'entities-unreadable':
      return 'Some entries of "entities" are not links to notes, so they were skipped.';
  }
}

// ------------------------------------------------------------------ reading

/** What was understood of a list property, and whether anything in it had to be skipped. */
interface ReadList {
  readonly items: string[];
  /** True when some entry was neither usable nor simply empty. */
  readonly skipped: boolean;
}

/** Gather every text (and number) in a value, opening up lists inside lists. Returns true when something else was met. */
function collectTexts(value: unknown, into: string[], depth: number): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value))) {
    into.push(String(value));
    return false;
  }
  if (!Array.isArray(value) || depth >= 4) return true;
  let skipped = false;
  for (const item of value) skipped = collectTexts(item, into, depth + 1) || skipped;
  return skipped;
}

/** The names in a "timelines" property: a list, or one name on its own. Each name once. */
function readTimelineNames(value: unknown): ReadList {
  const entries: readonly unknown[] = Array.isArray(value) ? value : [value];
  const items: string[] = [];
  const seen = new Set<string>();
  let skipped = false;
  for (const entry of entries) {
    const name = readName(entry);
    if (name === null) {
      if (!isBlankValue(entry)) skipped = true;
      continue;
    }
    if (seen.has(laneKey(name))) continue;
    seen.add(laneKey(name));
    items.push(name);
  }
  return { items, skipped };
}

const MARKDOWN_LINK = /^\[[^\]]*\]\((.+)\)$/;

function decodePath(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

/**
 * What a link points at: "[[Opening]]", "[[Manuscript/Opening|the start]]",
 * "[[Opening#Part two]]" and "[Opening](Manuscript/Opening.md)" give
 * "Opening", "Manuscript/Opening", "Opening" and "Manuscript/Opening.md".
 * Text that is not a link is taken as a name or path as it stands. Null when
 * nothing is left.
 */
export function linkTarget(link: string): string | null {
  let text = link.trim();
  if (text.startsWith('![[')) text = text.slice(1);
  let isLink = false;
  if (text.startsWith('[[') && text.endsWith(']]')) {
    isLink = true;
    text = text.slice(2, -2);
    const bar = text.indexOf('|');
    if (bar >= 0) text = text.slice(0, bar);
  } else {
    const markdown = MARKDOWN_LINK.exec(text);
    if (markdown) {
      isLink = true;
      text = (markdown[1] ?? '').trim();
      if (text.startsWith('<') && text.endsWith('>')) text = text.slice(1, -1);
      text = decodePath(text);
    }
  }
  if (isLink) {
    const hash = text.indexOf('#');
    if (hash >= 0) text = text.slice(0, hash);
  }
  text = text.trim();
  return text === '' ? null : text;
}

/**
 * Every text in a list of links, as it is written: "[[Mara]]", or just
 * "Mara" for a wikilink that was written without quotes (YAML reads that as
 * a list inside a list, so lists are opened up as deep as they go).
 */
export function linkTexts(value: unknown): string[] {
  const texts: string[] = [];
  collectTexts(value, texts, 0);
  return texts;
}

/**
 * The scenes in a "scenes" property. A wikilink written without quotes is
 * read by YAML as a list inside a list, so lists are opened up as deep as
 * they go.
 */
function readSceneLinks(value: unknown): ReadList {
  const texts: string[] = [];
  const skipped = collectTexts(value, texts, 0);
  const items: string[] = [];
  for (const text of texts) {
    const target = linkTarget(text);
    if (target !== null && !items.includes(target)) items.push(target);
  }
  return { items, skipped };
}

/** The tags in Obsidian's own "tags" property: a list, or one text with commas or spaces between the tags. */
function readTags(value: unknown): string[] {
  const parts: string[] = [];
  if (typeof value === 'string') parts.push(...value.split(/[,\s]+/));
  else if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item === 'string') parts.push(item.trim());
      else if (typeof item === 'number' && Number.isFinite(item)) parts.push(String(item));
    }
  }
  const tags: string[] = [];
  const seen = new Set<string>();
  for (const part of parts) {
    const tag = part.startsWith('#') ? part.slice(1) : part;
    const key = clashKey(tag);
    if (tag === '' || seen.has(key)) continue;
    seen.add(key);
    tags.push(tag);
  }
  return tags;
}

function buildEvent(
  path: string,
  source: EventSource,
  properties: Readonly<Record<string, unknown>>,
  calendar: StoryCalendar | null | undefined,
): TimelineEvent {
  const problems: EventProblem[] = [];
  const rawDate = properties['date'];
  const rawEnd = properties['end'];

  const start = parseDateValue(rawDate, calendar)?.date ?? null;
  if (start === null && !isBlankValue(rawDate)) problems.push('date-unreadable');

  let end: StoryDate | null = null;
  if (!isBlankValue(rawEnd)) {
    const readEnd = parseDateValue(rawEnd, calendar)?.date ?? null;
    if (readEnd === null) problems.push('end-unreadable');
    else if (start === null) problems.push('end-without-date');
    else {
      const length = storyDateToDayNumber(readEnd) - storyDateToDayNumber(start);
      if (length < 0) problems.push('end-before-start');
      else if (length > 0) end = readEnd;
    }
  }

  const timelines = readTimelineNames(properties['timelines']);
  if (timelines.skipped) problems.push('timelines-unreadable');
  const scenes = readSceneLinks(properties['scenes']);
  if (scenes.skipped) problems.push('scenes-unreadable');
  const entities = readSceneLinks(properties['entities']);
  if (entities.skipped) problems.push('entities-unreadable');

  return {
    path,
    title: noteTitle(path),
    source,
    start,
    end,
    timelines: timelines.items,
    scenes: scenes.items,
    entities: entities.items,
    tags: readTags(properties['tags']),
    problems,
  };
}

/**
 * Read a note in Timeline/ as an event. Never throws: with no properties, or
 * properties that make no sense, the result is an undated event that carries
 * the note's title. Any note in Timeline/ is an event, with or without the
 * "spellbook: event" mark, so a note made by hand counts too.
 *
 * @param path        the note's path; kept as the event's identity
 * @param frontmatter the note's properties, whatever they are
 * @param calendar    the project's invented calendar, when it has one
 */
export function readEvent(path: string, frontmatter: unknown, calendar?: StoryCalendar | null): TimelineEvent {
  return buildEvent(path, 'event', isRecord(frontmatter) ? frontmatter : {}, calendar);
}

/**
 * Read a scene as an event. A scene is an event only when it has a "date":
 * without one (or with an empty one) the result is null. A date that cannot
 * be read makes an undated event, so the writer can see it and mend it.
 */
export function readSceneEvent(path: string, frontmatter: unknown, calendar?: StoryCalendar | null): TimelineEvent | null {
  if (!isRecord(frontmatter) || isBlankValue(frontmatter['date'])) return null;
  return buildEvent(path, 'scene', frontmatter, calendar);
}

/**
 * Read every event of a project.
 *
 * @param eventNotes the notes in Timeline/
 * @param sceneNotes the scenes of the manuscript; those without a date are skipped
 * @param calendar   the project's invented calendar, when it has one
 */
export function readTimeline(
  eventNotes: readonly TimelineNote[],
  sceneNotes: readonly TimelineNote[] = [],
  calendar?: StoryCalendar | null,
): TimelineModel {
  const all: TimelineEvent[] = [];
  for (const note of eventNotes) all.push(readEvent(note.path, note.frontmatter, calendar));
  for (const note of sceneNotes) {
    const event = readSceneEvent(note.path, note.frontmatter, calendar);
    if (event !== null) all.push(event);
  }

  const dated: { readonly event: TimelineEvent; readonly start: StoryDate; readonly index: number }[] = [];
  const undated: TimelineEvent[] = [];
  all.forEach((event, index) => {
    if (event.start === null) undated.push(event);
    else dated.push({ event, start: event.start, index });
  });
  dated.sort((a, b) => compareStoryDates(a.start, b.start) || a.index - b.index);
  return { dated: dated.map((entry) => entry.event), undated };
}

/** A date written in a note that a calendar cannot read. */
export interface MisfitDate {
  /** The note's path, as it was given. */
  readonly path: string;
  /** The note's title. */
  readonly title: string;
  /** Which property holds it. */
  readonly property: 'date' | 'end';
  /** What is written there, as text. */
  readonly value: string;
}

/**
 * The dates written in notes that a calendar could not read: what a project
 * would be left with, undated, if it took that calendar. Nothing is changed;
 * this only lists them, for the writer to see before choosing.
 *
 * @param notes    the event notes and the scenes
 * @param calendar the calendar to try them against; null for the real-world one
 */
export function datesOutsideCalendar(notes: readonly TimelineNote[], calendar: StoryCalendar | null): MisfitDate[] {
  const found: MisfitDate[] = [];
  for (const note of notes) {
    if (!isRecord(note.frontmatter)) continue;
    for (const property of ['date', 'end'] as const) {
      const value = note.frontmatter[property];
      if (isBlankValue(value) || parseDateValue(value, calendar) !== null) continue;
      const text = typeof value === 'string' || typeof value === 'number' ? String(value) : JSON.stringify(value) ?? '';
      found.push({ path: note.path, title: noteTitle(note.path), property, value: text });
    }
  }
  return found;
}

// ---------------------------------------------------------- resolving links

function keyParts(text: string): string[] | null {
  const parts = clashKey(text)
    .split('/')
    .filter((part) => part !== '' && part !== '.');
  if (parts.length === 0 || parts.includes('..')) return null;
  const last = parts[parts.length - 1] as string;
  if (last.endsWith('.md') && last.length > 3) parts[parts.length - 1] = last.slice(0, -3);
  return parts;
}

/**
 * Make a function that finds the scene a link points at, among the scene
 * paths given. A link matches a scene by its name ("Opening"), by the end of
 * its path ("Manuscript/Opening") or by a longer path that ends with the
 * scene's own ("My Novel/Manuscript/Opening.md"); capitals and ".md" do not
 * matter. When two scenes share a name, the first one given wins. The
 * function returns the scene's path as it was given, or null.
 */
export function createSceneResolver(scenePaths: readonly string[]): (link: string) => string | null {
  const whole = new Map<string, string>();
  const tails = new Map<string, string>();
  for (const path of scenePaths) {
    const parts = keyParts(path);
    if (parts === null) continue;
    const key = parts.join('/');
    if (!whole.has(key)) whole.set(key, path);
    for (let from = 0; from < parts.length; from++) {
      const tail = parts.slice(from).join('/');
      if (!tails.has(tail)) tails.set(tail, path);
    }
  }
  return (link: string): string | null => {
    const target = linkTarget(link);
    const parts = target === null ? null : keyParts(target);
    if (parts === null) return null;
    const direct = tails.get(parts.join('/'));
    if (direct !== undefined) return direct;
    for (let from = 1; from < parts.length; from++) {
      const found = whole.get(parts.slice(from).join('/'));
      if (found !== undefined) return found;
    }
    return null;
  };
}

// ------------------------------------------------------------------ writing

/**
 * The properties of a new event note, in this order: the "spellbook: event"
 * mark, the date and the timelines.
 *
 * @param date      when it happens; null leaves an empty date for the writer to fill in
 * @param timelines the names of the lanes it starts in, as they are to be written (a lane key is not
 *   a name: see `laneNameFor`); empty and repeated names are left out
 */
export function newEventFrontmatter(date: StoryDate | null, timelines: readonly string[] = []): Frontmatter {
  return {
    [EVENT_MARKER_KEY]: EVENT_MARKER_VALUE,
    date: date === null ? null : storyDateToFrontmatter(date),
    timelines: readTimelineNames(timelines).items,
  };
}

/** A date as a property value, written the way the value it replaces was. */
function encodeLike(date: StoryDate, previous: ParsedDateValue): string | number {
  if (previous.form === 'number' && date.precision === 'year') return date.year;
  return storyDateToText(date) + previous.suffix;
}

/**
 * The change that moves an event (or a dated scene) to a new date.
 *
 *  - The precision is kept: an event dated to the year stays dated to the
 *    year, whatever `target` is. An undated event takes `target` as it is.
 *  - A span keeps its length: its end moves along (see `moveDates`).
 *  - An "end" that makes no span (the same day as the date, or an earlier
 *    one) moves along by the same amount too. Left where it was, it would be
 *    measured against the new date, and an event that read as a single
 *    moment could turn into a span.
 *  - Only "date" and "end" are ever named, and only when their value changes.
 *    An "end" that could not be read is left alone, and so is a time of day
 *    written after a date.
 *
 * @param frontmatter the note's properties as they are now
 * @param target      the wanted start
 */
export function redateEventPatch(frontmatter: unknown, target: StoryDate): FrontmatterPatch {
  const properties = isRecord(frontmatter) ? frontmatter : {};
  // The target says which calendar the project counts in.
  const calendar = target.calendar;
  const current = parseDateValue(properties['date'], calendar);
  if (current === null) return { date: storyDateToFrontmatter(target) };

  const start = current.date;
  const wanted = dayNumberToStoryDate(storyDateToDayNumber(target), start.precision, calendar);
  const end = parseDateValue(properties['end'], calendar);
  const spanEnd = end !== null && storyDateToDayNumber(end.date) > storyDateToDayNumber(start) ? end.date : null;
  const moved = moveDates(start, spanEnd, wanted);

  const patch: Record<string, unknown> = {};
  if (!sameStoryDate(moved.start, start)) patch['date'] = encodeLike(moved.start, current);
  if (end !== null) {
    // The end of a span comes back moved; any other end is taken along here.
    const movedEnd = moved.end ?? carryStoryDate(end.date, start, moved.start);
    if (!sameStoryDate(movedEnd, end.date)) patch['end'] = encodeLike(movedEnd, end);
  }
  return patch;
}
