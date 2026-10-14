// Ages: how old a character is, worked out from when it was born.
//
// A character's note says when it was born ("date") and, perhaps, when it
// died ("end"), the two dates of the "Time" part of its sheet. From them:
//
//   - its age at death: "Died at 63";
//   - its age at the story's present: a date the project index may name
//     ("storyPresent"), or else the latest date of any scene or timeline
//     event of the project;
//   - its age in a scene that has a date of its own, and whether it is not
//     born yet, or already dead, at that scene's date: a continuity check.
//
// Ages are counted in whole years of the project's calendar, real or
// invented: a year of an invented calendar is as long as that calendar says.
// Two dates are compared only as exactly as both are known: when one of
// them gives only a year, the age is the difference of the years; when both
// give the month, the month counts too, and the day when both give the day.
// A date known to the year is never called "before" or "after" another date
// of that same year: a scene of 1889 is not "before the birth" of someone
// born in April 1889.
//
// Which types have an age: the built-in character, whatever its two dates are
// called, and any other type whose first date the writer calls "Born" (in
// the window of types: "Born, Died"). A place that is "Founded" has no age.
//
// Plain calculations only: nothing here reads or writes a file.

import { compareStoryDates, readStoryDate, storyDateToFrontmatter } from '../timeline';
import type { StoryCalendar, StoryDate } from '../timeline';
import { dateWords } from './time';
import type { EntityTime } from './time';
import type { EntityType } from './types';

/** The key of the project index that names the story's present: a date written like an event's. */
export const STORY_PRESENT_KEY = 'storyPresent';

/** The word that, as a type's first date word, gives the type an age. */
const BORN_WORD = 'born';

/** Whether entities of a type have an age: characters, and every type whose first date is called "Born". */
export function showsAge(type: EntityType | null): boolean {
  if (type === null) return false;
  if (type.id === 'character') return true;
  return dateWords(type).from.trim().toLowerCase() === BORN_WORD;
}

/**
 * Order two dates only as exactly as both are known: by year, then by month
 * when both give it, then by day when both give it. 0 means "the same, as
 * far as can be told". Both must be of the same calendar.
 */
export function compareKnown(a: StoryDate, b: StoryDate): number {
  if (a.year !== b.year) return a.year - b.year;
  if (a.precision === 'year' || b.precision === 'year') return 0;
  if (a.month !== b.month) return a.month - b.month;
  if (a.precision === 'month' || b.precision === 'month') return 0;
  return a.day - b.day;
}

/**
 * How many whole years lie from one date to a later one: an age. Null when
 * `to` is before `from`. The year is counted in the dates' own calendar; the
 * month and the day count only when both dates give them.
 */
export function yearsBetween(from: StoryDate, to: StoryDate): number | null {
  if (compareKnown(to, from) < 0) return null;
  let years = to.year - from.year;
  if (from.precision !== 'year' && to.precision !== 'year') {
    const monthsBefore = to.month < from.month;
    const daysBefore = to.month === from.month && from.precision === 'day' && to.precision === 'day' && to.day < from.day;
    if (monthsBefore || daysBefore) years -= 1;
  }
  return Math.max(0, years);
}

/** The story's present, and where it comes from. */
export interface StoryPresent {
  readonly date: StoryDate;
  /** "set" when the project index names it; "latest" when it is the latest date in the story. */
  readonly source: 'set' | 'latest';
}

/** Read the story's present the project index names; null when it names none, or what it names is not a date of the calendar. */
export function readStoryPresent(value: unknown, calendar: StoryCalendar | null): StoryDate | null {
  return readStoryDate(value, calendar);
}

/** The value to store in the project index for a story's present; undefined takes it away. */
export function storyPresentValue(date: StoryDate | null): string | number | undefined {
  return date === null ? undefined : storyDateToFrontmatter(date);
}

/** The latest of some dates; null for none. */
export function latestDate(dates: Iterable<StoryDate | null>): StoryDate | null {
  let latest: StoryDate | null = null;
  for (const date of dates) {
    if (date !== null && (latest === null || compareStoryDates(date, latest) > 0)) latest = date;
  }
  return latest;
}

/** The story's present: the one the index names, or else the latest date in the story, or null for neither. */
export function storyPresent(set: StoryDate | null, latest: StoryDate | null): StoryPresent | null {
  if (set !== null) return { date: set, source: 'set' };
  return latest === null ? null : { date: latest, source: 'latest' };
}

/** What can be said of an entity's age on its sheet. */
export type LifeAge =
  /** It has no birth date that can be read. */
  | { readonly kind: 'unknown' }
  /** It has a birth date, and its end cannot be read or is not after it. */
  | { readonly kind: 'problem' }
  /** It died: its age at death. */
  | { readonly kind: 'died'; readonly years: number }
  /** It is alive at the story's present: its age then. */
  | { readonly kind: 'alive'; readonly years: number; readonly present: StoryPresent }
  /** The story's present is before its birth. */
  | { readonly kind: 'unborn'; readonly present: StoryPresent }
  /** It has a birth date, but the story has no present: nothing is dated and none is set. */
  | { readonly kind: 'no-present' };

/** An entity's age, from its dates and the story's present. */
export function lifeAge(time: EntityTime, present: StoryPresent | null): LifeAge {
  const born = time.start;
  if (born === null) return { kind: 'unknown' };
  if (time.end === null && time.unreadEnd !== '') return { kind: 'problem' };
  if (time.end !== null) {
    const years = yearsBetween(born, time.end);
    return years === null ? { kind: 'problem' } : { kind: 'died', years };
  }
  if (present === null) return { kind: 'no-present' };
  const years = yearsBetween(born, present.date);
  return years === null ? { kind: 'unborn', present } : { kind: 'alive', years, present };
}

/** The age that stands for an entity: at death, or at the story's present; null when there is none. */
export function lifeYears(age: LifeAge): number | null {
  return age.kind === 'died' || age.kind === 'alive' ? age.years : null;
}

/** What can be said of an entity at one date, a scene's. */
export type AgeAt =
  | { readonly kind: 'age'; readonly years: number }
  /** The date is before its birth. */
  | { readonly kind: 'unborn' }
  /** The date is after its death. */
  | { readonly kind: 'dead' };

/**
 * An entity at a date: its age then, or that it is not born yet or already
 * dead. Null when nothing can be said: it has no birth date and the date is
 * not after its death. A date in the same year as a birth or a death known
 * only to the year counts as within its life.
 */
export function ageAt(time: EntityTime, when: StoryDate): AgeAt | null {
  if (time.start !== null && compareKnown(when, time.start) < 0) return { kind: 'unborn' };
  if (time.end !== null && compareKnown(when, time.end) > 0) return { kind: 'dead' };
  if (time.start === null) return null;
  const years = yearsBetween(time.start, when);
  return years === null ? { kind: 'unborn' } : { kind: 'age', years };
}

/**
 * How the free-text "age" field of a sheet is shown, next to the age worked
 * out from the dates:
 *   "field"  as always, under its own name: no age is worked out
 *   "hidden" not at all: it is empty, or says the same as the age worked out
 *   "typed"  as "Age (typed)": it says something else
 */
export function typedAgeShown(typed: string, worked: number | null): 'field' | 'hidden' | 'typed' {
  if (worked === null) return 'field';
  const text = typed.trim();
  return text === '' || text === String(worked) ? 'hidden' : 'typed';
}
