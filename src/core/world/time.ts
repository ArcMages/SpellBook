// Time in the world: when an entity begins and ends, and the moments of its
// life between.
//
// An entity note says it in three properties, all optional:
//
//   date: 1889-04-17            when it begins: a birth, a founding, when a legend is set
//   end: 1923-03                when it ends: a death, a fall, when it was lost
//   moments:
//     - "1911 | qualifies as a chart maker"
//     - "1923-10-13 | is sent to Saltwick"
//
// "date" and "end" are written exactly like a timeline event's, so that one
// rule covers everything: a year, a year and month or a full date in the
// real-world calendar (1923, 1923-04, 1923-04-12), or the calendar's own
// form in a project with an invented one ("1203-04-17 AE"). A moment is one
// line of text: a date in that same form, a bar, and a short label. The bar
// and the label may be left out.
//
// What the two dates are called depends on the type: a character is born
// and dies, a place is founded and abandoned. A type the writer made says
// "From" and "Until" unless the writer chose other words.
//
// Reading never throws and never guesses: a date that cannot be read is
// kept as it is written and reported, so that the sheet can show it and the
// writer can put it right. Nothing here reads or writes a file: the
// functions that change a note are given its properties, inside the store's
// read-change-save step, and each changes one property only.

import {
  compareStoryDates,
  formatStoryDate,
  formatStoryDateRange,
  readStoryDate,
  sameStoryDate,
  storyDateToDayNumber,
  storyDateToFrontmatter,
  storyDateToText,
} from '../timeline';
import type { StoryCalendar, StoryDate } from '../timeline';
import type { Frontmatter } from '../types';
import { DATE_KEY, END_KEY, MOMENTS_KEY } from './types';
import type { DateWords, EntityType } from './types';

/** What stands between a moment's date and its label. */
export const MOMENT_SEPARATOR = '|';
/** No moment's label is longer than this many characters. */
export const MOMENT_LABEL_MAX = 80;

/** What the two dates of an entity of a type the writer made are called, unless the writer chose other words. */
export const DEFAULT_DATE_WORDS: DateWords = Object.freeze({ from: 'From', until: 'Until' });

/** What the two dates of an entity of a built-in type are called. */
const BUILT_IN_DATE_WORDS: Readonly<Record<string, DateWords>> = {
  character: { from: 'Born', until: 'Died' },
  place: { from: 'Founded', until: 'Abandoned' },
  faction: { from: 'Founded', until: 'Dissolved' },
  item: { from: 'Made', until: 'Lost' },
  lore: { from: 'Set in', until: 'Until' },
  creature: { from: 'First known', until: 'Last known' },
  culture: { from: 'First known', until: 'Last known' },
};

/**
 * What the two dates of an entity of a type are called: the words the
 * writer chose for the type, or else the usual ones ("Born" and "Died" for a
 * character, "From" and "Until" for a type of the writer's own and for an
 * entity without a type).
 */
export function dateWords(type: EntityType | null): DateWords {
  if (type === null) return DEFAULT_DATE_WORDS;
  return type.dateWords ?? BUILT_IN_DATE_WORDS[type.id] ?? DEFAULT_DATE_WORDS;
}

/** The usual words for a type, whatever the writer chose: what the window of types offers to go back to. */
export function usualDateWords(type: EntityType | null): DateWords {
  return type === null ? DEFAULT_DATE_WORDS : (BUILT_IN_DATE_WORDS[type.id] ?? DEFAULT_DATE_WORDS);
}

// ------------------------------------------------------------------ reading

/** One moment of an entity's life, as its note lists it. */
export interface Moment {
  /** Its place in the note's list, from 0. */
  readonly index: number;
  /** The entry as it is written, as text: what it is found again by. */
  readonly text: string;
  /** When it is; null for an entry whose date cannot be read in the project's calendar. */
  readonly date: StoryDate | null;
  /** What happens; "" when the entry says only a date. For an entry that cannot be read: the whole entry. */
  readonly label: string;
}

/** What was understood of a property that should hold a date. */
export interface ReadDate {
  /** The date; null when there is none, or it cannot be read. */
  readonly date: StoryDate | null;
  /** What is written there when it cannot be read as a date of the project's calendar; "" otherwise. */
  readonly unread: string;
}

/** When an entity is: its two dates and its moments. */
export interface EntityTime {
  /** When it begins; null when its note does not say, or what it says cannot be read. */
  readonly start: StoryDate | null;
  /**
   * When it ends; null when its note does not say, when what it says cannot
   * be read, and when it is not later than the start (an end must be).
   */
  readonly end: StoryDate | null;
  /** What "date" holds when it cannot be read; "" otherwise. */
  readonly unreadStart: string;
  /** What "end" holds when it cannot be read, or is not later than the start; "" otherwise. */
  readonly unreadEnd: string;
  /** The moments, in the order the note lists them. */
  readonly moments: readonly Moment[];
}

const NO_TIME: EntityTime = Object.freeze({ start: null, end: null, unreadStart: '', unreadEnd: '', moments: Object.freeze([]) });

function isBlank(value: unknown): boolean {
  return value === undefined || value === null || (typeof value === 'string' && value.trim() === '');
}

/** A property's value as the text a writer would recognise. */
function textOf(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (value === undefined || value === null) return '';
  try {
    return JSON.stringify(value) ?? '';
  } catch {
    return '';
  }
}

/** Read a property that should hold a date. */
export function readDateProperty(value: unknown, calendar: StoryCalendar | null): ReadDate {
  if (isBlank(value)) return { date: null, unread: '' };
  const date = readStoryDate(value, calendar);
  return date === null ? { date: null, unread: textOf(value) } : { date, unread: '' };
}

/** A label as it is stored: on one line, not too long. */
export function tidyMomentLabel(label: string): string {
  return label.replace(/\s+/g, ' ').trim().slice(0, MOMENT_LABEL_MAX).trim();
}

/**
 * Read one entry of a "moments" list: "1921-03 | comes to Saltwick", or a
 * date alone ("1921", also written as a number). In a project with an
 * invented calendar the date is in that calendar's form: "1203-04 AE | the
 * flood". Null when the part before the bar is not a date.
 */
export function parseMoment(value: unknown, calendar: StoryCalendar | null): { readonly date: StoryDate; readonly label: string } | null {
  if (typeof value === 'number') {
    const year = readStoryDate(value, calendar);
    return year === null ? null : { date: year, label: '' };
  }
  if (typeof value !== 'string') return null;
  const bar = value.indexOf(MOMENT_SEPARATOR);
  const before = (bar < 0 ? value : value.slice(0, bar)).trim();
  const after = bar < 0 ? '' : value.slice(bar + 1);
  const date = before === '' ? null : readStoryDate(before, calendar);
  return date === null ? null : { date, label: tidyMomentLabel(after) };
}

/** The entry to write for a moment: "1921-03 | comes to Saltwick", or the date alone when there is no label. */
export function momentText(date: StoryDate, label: string): string {
  const tidy = tidyMomentLabel(label);
  return tidy === '' ? storyDateToText(date) : `${storyDateToText(date)} ${MOMENT_SEPARATOR} ${tidy}`;
}

/** The entries of a "moments" property: a list, or one entry on its own. */
function momentEntries(raw: unknown): unknown[] {
  if (isBlank(raw)) return [];
  return Array.isArray(raw) ? raw : [raw];
}

/** The moments a note lists, in the order it lists them. Empty entries are passed over. */
export function readMoments(frontmatter: Readonly<Frontmatter> | null | undefined, calendar: StoryCalendar | null): Moment[] {
  const moments: Moment[] = [];
  momentEntries(frontmatter?.[MOMENTS_KEY]).forEach((entry, index) => {
    if (isBlank(entry)) return;
    const text = textOf(entry);
    const read = parseMoment(entry, calendar);
    moments.push(read === null ? { index, text, date: null, label: text } : { index, text, date: read.date, label: read.label });
  });
  return moments;
}

/**
 * When an entity is, from its note's properties. Never throws: whatever
 * cannot be read is left out and kept as text, for the sheet to show.
 *
 * @param calendar the project's invented calendar, or null for the real-world one
 */
export function readEntityTime(frontmatter: Readonly<Frontmatter> | null | undefined, calendar: StoryCalendar | null): EntityTime {
  if (frontmatter === null || frontmatter === undefined) return NO_TIME;
  const from = readDateProperty(frontmatter[DATE_KEY], calendar);
  const until = readDateProperty(frontmatter[END_KEY], calendar);
  let end = until.date;
  let unreadEnd = until.unread;
  // As for an event: an end must be later than the date it ends.
  if (end !== null && from.date !== null && storyDateToDayNumber(end) <= storyDateToDayNumber(from.date)) {
    unreadEnd = textOf(frontmatter[END_KEY]);
    end = null;
  }
  return { start: from.date, end, unreadStart: from.unread, unreadEnd, moments: readMoments(frontmatter, calendar) };
}

/** True when an entity has any date at all that can be read: it has a place in time. */
export function isDated(time: EntityTime): boolean {
  return time.start !== null || time.end !== null || time.moments.some((moment) => moment.date !== null);
}

/** The moments that have a date, earliest first; moments on the same day stay in the order they are written. */
export function datedMoments(time: EntityTime): Array<Moment & { readonly date: StoryDate }> {
  const dated = time.moments.filter((moment): moment is Moment & { readonly date: StoryDate } => moment.date !== null);
  return dated.sort((a, b) => compareStoryDates(a.date, b.date) || a.index - b.index);
}

/** The first date an entity has: when it begins, or else its earliest moment, or else when it ends. Null for none. */
export function firstDate(time: EntityTime): StoryDate | null {
  return time.start ?? datedMoments(time)[0]?.date ?? time.end;
}

/** An entity's two dates as one line: "1889", "1841 - 1922" (with a dash), "until 1723"; "" when it has neither. */
export function spanText(time: EntityTime): string {
  if (time.start !== null) return formatStoryDateRange(time.start, time.end);
  return time.end === null ? '' : `until ${formatStoryDate(time.end)}`;
}

/**
 * Order two entities by date, earliest first: by when each begins (or its
 * first date of any kind). One without a date comes after every one that
 * has one. Entities that are equal here are left for the caller to order.
 */
export function compareByDate(a: EntityTime, b: EntityTime): number {
  const first = firstDate(a);
  const second = firstDate(b);
  if (first === null || second === null) return first === second ? 0 : first === null ? 1 : -1;
  return compareStoryDates(first, second);
}

// ------------------------------------------------------------------ writing

/** What changing a note's dates or moments came to. */
export type TimeChange = 'changed' | 'unchanged' | 'unreadable';

/** Why two dates cannot stand together, in plain English; null when they can. */
export function checkEntityDates(start: StoryDate | null, end: StoryDate | null, words: DateWords = DEFAULT_DATE_WORDS): string | null {
  if (start === null || end === null) return null;
  if (storyDateToDayNumber(end) <= storyDateToDayNumber(start)) return `"${words.until}" must be later than "${words.from}".`;
  return null;
}

/**
 * Set one of an entity's two dates, in place, or take it away (null). Only
 * that property is touched. Nothing changes when it already says that date.
 * A date is written the way the timeline writes an event's: a bare number
 * for a year of the real-world calendar, text for everything else.
 *
 * @param key "date" or "end"
 */
export function setEntityDate(frontmatter: Frontmatter, key: typeof DATE_KEY | typeof END_KEY, date: StoryDate | null): TimeChange {
  const current: unknown = frontmatter[key];
  if (date === null) {
    if (current === undefined) return 'unchanged';
    delete frontmatter[key];
    return 'changed';
  }
  const had = readStoryDate(current, date.calendar ?? null);
  if (had !== null && sameStoryDate(had, date)) return 'unchanged';
  frontmatter[key] = storyDateToFrontmatter(date);
  return 'changed';
}

/** Whether a "moments" property can be changed: nothing, one entry, or a list. Anything else is left alone. */
function momentList(frontmatter: Frontmatter): unknown[] | null {
  const raw: unknown = frontmatter[MOMENTS_KEY];
  if (isBlank(raw)) return [];
  if (Array.isArray(raw)) return raw;
  return typeof raw === 'string' || typeof raw === 'number' ? [raw] : null;
}

/** Where an entry is in a list: at the place it was read from when it still says the same, or else wherever it says that. */
function findMoment(list: readonly unknown[], index: number, text: string): number {
  if (textOf(list[index]) === text && !isBlank(list[index])) return index;
  return list.findIndex((entry) => !isBlank(entry) && textOf(entry) === text);
}

/**
 * Add a moment to a note's "moments" property, in place, at the end of the
 * list. Nothing changes when the list already has that very entry.
 */
export function addMoment(frontmatter: Frontmatter, date: StoryDate, label: string): TimeChange {
  const list = momentList(frontmatter);
  if (list === null) return 'unreadable';
  const entry = momentText(date, label);
  if (list.some((other) => textOf(other) === entry)) return 'unchanged';
  frontmatter[MOMENTS_KEY] = [...list, entry];
  return 'changed';
}

/**
 * Give one moment of a note another date or label, in place. The moment is
 * found by where it was and how it is written; every other entry stays as
 * it is, in its place. A moment that is no longer there changes nothing.
 *
 * @param index where the moment was in the list when it was read
 * @param text  the entry as it was written
 */
export function changeMoment(frontmatter: Frontmatter, index: number, text: string, date: StoryDate, label: string): TimeChange {
  const list = momentList(frontmatter);
  if (list === null) return 'unreadable';
  const at = findMoment(list, index, text);
  const entry = momentText(date, label);
  if (at < 0 || textOf(list[at]) === entry) return 'unchanged';
  const next = [...list];
  next[at] = entry;
  frontmatter[MOMENTS_KEY] = next;
  return 'changed';
}

/**
 * Take one moment out of a note's "moments" property, in place. A list that
 * comes out empty is taken away with its key.
 */
export function removeMoment(frontmatter: Frontmatter, index: number, text: string): TimeChange {
  const list = momentList(frontmatter);
  if (list === null) return 'unreadable';
  const at = findMoment(list, index, text);
  if (at < 0) return 'unchanged';
  const next = list.filter((_entry, place) => place !== at);
  if (next.length === 0) delete frontmatter[MOMENTS_KEY];
  else frontmatter[MOMENTS_KEY] = next;
  return 'changed';
}

// ------------------------------------------------------------------ history

/** What a line of an entity's history is: one of its own dates, a moment of its own, an event or a scene it is in. */
export type HistoryKind = 'from' | 'until' | 'moment' | 'event' | 'scene';

/** One line of an entity's history. */
export interface HistoryLine {
  readonly kind: HistoryKind;
  /** When it is; null for something without a date that can be read. */
  readonly date: StoryDate | null;
  /** When it ends, for an event that lasts; null otherwise. */
  readonly end: StoryDate | null;
  /** What it says: "Born", a moment's label, an event's or a scene's title. May be the writer's own text. */
  readonly label: string;
  /** The note it comes from, to open: the entity's own for its dates and moments, or the event's or the scene's. */
  readonly path: string;
}

/** Everything dated that concerns an entity, and what concerns it without a date. */
export interface EntityHistory {
  /** Earliest first. */
  readonly dated: readonly HistoryLine[];
  /** Moments whose date cannot be read, then events, then scenes, each in the order given. */
  readonly undated: readonly HistoryLine[];
}

/** A scene or an event an entity is in, as its history is worked out from it. */
export interface HistoryNote {
  /** Path relative to the project folder. */
  readonly path: string;
  readonly title: string;
  readonly frontmatter: Readonly<Frontmatter> | null;
}

/** What an entity's history is worked out from. */
export interface HistorySources {
  /** The entity's own note, relative to the project folder. */
  readonly entityPath: string;
  readonly time: EntityTime;
  /** What its two dates are called (see `dateWords`). */
  readonly words: DateWords;
  /** The timeline events that list it. */
  readonly events: readonly HistoryNote[];
  /** The scenes that list it, in binder order. */
  readonly scenes: readonly HistoryNote[];
  /** The project's invented calendar, or null for the real-world one. */
  readonly calendar: StoryCalendar | null;
}

/** On one and the same day: what begins comes first, what ends comes last. */
const KIND_ORDER: Readonly<Record<HistoryKind, number>> = { from: 0, moment: 1, event: 2, scene: 3, until: 4 };

/**
 * An entity's history: its own dates and moments, the timeline events that
 * list it and the scenes it is in, as one list in order of time. Whatever
 * has no date that can be read is listed after, never left out.
 */
export function entityHistory(sources: HistorySources): EntityHistory {
  const { entityPath, time, words, calendar } = sources;
  const lines: HistoryLine[] = [];
  const undated: HistoryLine[] = [];
  if (time.start !== null) lines.push({ kind: 'from', date: time.start, end: null, label: words.from, path: entityPath });
  if (time.end !== null) lines.push({ kind: 'until', date: time.end, end: null, label: words.until, path: entityPath });
  for (const moment of time.moments) {
    const line: HistoryLine = { kind: 'moment', date: moment.date, end: null, label: moment.label, path: entityPath };
    (moment.date === null ? undated : lines).push(line);
  }
  const add = (kind: 'event' | 'scene', notes: readonly HistoryNote[]): void => {
    for (const note of notes) {
      const read = readEntityTime(note.frontmatter, calendar);
      const line: HistoryLine = { kind, date: read.start, end: read.start === null ? null : read.end, label: note.title, path: note.path };
      (read.start === null ? undated : lines).push(line);
    }
  };
  add('event', sources.events);
  add('scene', sources.scenes);
  const dated = lines
    .map((line, index) => ({ line, index }))
    .sort(
      (a, b) =>
        compareStoryDates(a.line.date as StoryDate, b.line.date as StoryDate) ||
        KIND_ORDER[a.line.kind] - KIND_ORDER[b.line.kind] ||
        a.index - b.index,
    )
    .map((entry) => entry.line);
  return { dated, undated };
}
