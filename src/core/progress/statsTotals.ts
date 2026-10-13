// Adding up the daily word logs of every device: totals per day, per week
// and per month, the writing streak, and the average.

import { addDays, isDateText } from './../dates';
import { isMonthText, weekRange } from './calendar';
import { NO_WORDS } from './statsFile';
import type { DayCounts, StatsFile } from './statsFile';

/** The words of every device together, by day (YYYY-MM-DD), in date order. Days with nothing are absent. */
export type DailyTotals = ReadonlyMap<string, DayCounts>;

/** Words added, words deleted, and the difference between them. */
export interface WordTally {
  readonly added: number;
  readonly deleted: number;
  /** Added minus deleted; negative when more was deleted than written. */
  readonly net: number;
}

/** A day's (or a longer span's) words three ways: the manuscript, other notes, and all notes together. */
export interface WordSummary {
  readonly manuscript: WordTally;
  readonly other: WordTally;
  /** Manuscript plus other. */
  readonly all: WordTally;
}

/** Which words a figure is about: only the manuscript, or all notes. */
export type WordScope = 'manuscript' | 'all';

/** How many days in a row the writer has written. */
export interface WritingStreak {
  /** Days in a row up to today. A today with nothing written yet does not break it. */
  readonly current: number;
  /** The longest run of days in a row there has ever been. */
  readonly longest: number;
  /** Whether anything was written (or deleted) today. */
  readonly writtenToday: boolean;
}

/** Totals and averages over the days that were actually written on. */
export interface WritingAverage {
  /** How many days had any writing or deleting. */
  readonly daysWritten: number;
  readonly added: number;
  readonly deleted: number;
  readonly net: number;
  /** Net words per day written, rounded; 0 when no day was written on. */
  readonly averageNet: number;
  /** Words added per day written, rounded; 0 when no day was written on. */
  readonly averageAdded: number;
}

const add = (a: DayCounts, b: DayCounts): DayCounts => ({
  manuscriptAdded: a.manuscriptAdded + b.manuscriptAdded,
  manuscriptDeleted: a.manuscriptDeleted + b.manuscriptDeleted,
  otherAdded: a.otherAdded + b.otherAdded,
  otherDeleted: a.otherDeleted + b.otherDeleted,
});

const larger = (a: DayCounts, b: DayCounts): DayCounts => ({
  manuscriptAdded: Math.max(a.manuscriptAdded, b.manuscriptAdded),
  manuscriptDeleted: Math.max(a.manuscriptDeleted, b.manuscriptDeleted),
  otherAdded: Math.max(a.otherAdded, b.otherAdded),
  otherDeleted: Math.max(a.otherDeleted, b.otherDeleted),
});

const plain = (counts: DayCounts): DayCounts => ({
  manuscriptAdded: counts.manuscriptAdded,
  manuscriptDeleted: counts.manuscriptDeleted,
  otherAdded: counts.otherAdded,
  otherDeleted: counts.otherDeleted,
});

const isEmpty = (counts: DayCounts): boolean =>
  counts.manuscriptAdded === 0 && counts.manuscriptDeleted === 0 && counts.otherAdded === 0 && counts.otherDeleted === 0;

function inDateOrder(days: Map<string, DayCounts>): DailyTotals {
  return new Map([...days].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

/**
 * Add up the daily logs of several devices into one total per day.
 *
 * Different devices are added together. Two files of the same device that
 * hold the same day (a copy left by a sync conflict, say) are not added: the
 * larger of each number is used, so nothing is counted twice. A file that
 * does not say which device it is from counts as a device of its own.
 */
export function sumDeviceLogs(files: ReadonlyArray<Pick<StatsFile, 'device' | 'days'>>): DailyTotals {
  const byDevice = new Map<string, Map<string, DayCounts>>();
  files.forEach((file, index) => {
    const key = file.device !== '' ? `device ${file.device}` : `file ${index}`;
    let days = byDevice.get(key);
    if (!days) {
      days = new Map();
      byDevice.set(key, days);
    }
    for (const day of file.days) {
      if (!isDateText(day.date)) continue;
      const seen = days.get(day.date);
      days.set(day.date, seen ? larger(seen, day) : plain(day));
    }
  });

  const totals = new Map<string, DayCounts>();
  for (const days of byDevice.values()) {
    for (const [date, counts] of days) {
      const seen = totals.get(date);
      totals.set(date, seen ? add(seen, counts) : counts);
    }
  }
  for (const [date, counts] of [...totals]) {
    if (isEmpty(counts)) totals.delete(date);
  }
  return inDateOrder(totals);
}

/**
 * Totals with extra numbers added in: used to show words that this device has
 * counted but not yet saved to its log. Negative numbers take away; no number
 * goes below zero.
 */
export function addToTotals(
  totals: DailyTotals,
  changes: ReadonlyArray<{ readonly date: string; readonly counts: Partial<DayCounts> }>,
): DailyTotals {
  const next = new Map(totals);
  for (const change of changes) {
    if (!isDateText(change.date)) continue;
    const base = next.get(change.date) ?? NO_WORDS;
    const part = (key: keyof DayCounts): number => {
      const value = change.counts[key];
      return Math.max(0, base[key] + (value !== undefined && Number.isFinite(value) ? Math.trunc(value) : 0));
    };
    const sum: DayCounts = {
      manuscriptAdded: part('manuscriptAdded'),
      manuscriptDeleted: part('manuscriptDeleted'),
      otherAdded: part('otherAdded'),
      otherDeleted: part('otherDeleted'),
    };
    if (isEmpty(sum)) next.delete(change.date);
    else next.set(change.date, sum);
  }
  return inDateOrder(next);
}

/** The numbers for one day; four zeros for a day with nothing. */
export function countsOn(totals: DailyTotals, date: string): DayCounts {
  return totals.get(date) ?? NO_WORDS;
}

/** The numbers of every day from `from` to `to` (both included, as YYYY-MM-DD), added up. */
export function totalsForRange(totals: DailyTotals, from: string, to: string): DayCounts {
  let sum: DayCounts = NO_WORDS;
  if (!isDateText(from) || !isDateText(to)) return sum;
  for (const [date, counts] of totals) {
    if (date >= from && date <= to) sum = add(sum, counts);
  }
  return sum;
}

/**
 * The numbers of the week a date falls in, added up.
 *
 * @param weekStartsOn the day a week begins with: 0 Sunday, 1 Monday (the default), up to 6 Saturday
 */
export function totalsForWeek(totals: DailyTotals, date: string, weekStartsOn = 1): DayCounts {
  const week = weekRange(date, weekStartsOn);
  return week === null ? NO_WORDS : totalsForRange(totals, week.from, week.to);
}

/** The numbers of a month (written as YYYY-MM), added up. */
export function totalsForMonth(totals: DailyTotals, month: string): DayCounts {
  let sum: DayCounts = NO_WORDS;
  if (!isMonthText(month)) return sum;
  for (const [date, counts] of totals) {
    if (date.startsWith(`${month}-`)) sum = add(sum, counts);
  }
  return sum;
}

const tally = (added: number, deleted: number): WordTally => ({ added, deleted, net: added - deleted });

/** Turn the four stored numbers into added, deleted and net, for the manuscript, for other notes, and for all notes. */
export function summariseWords(counts: DayCounts): WordSummary {
  return {
    manuscript: tally(counts.manuscriptAdded, counts.manuscriptDeleted),
    other: tally(counts.otherAdded, counts.otherDeleted),
    all: tally(counts.manuscriptAdded + counts.otherAdded, counts.manuscriptDeleted + counts.otherDeleted),
  };
}

const scoped = (counts: DayCounts, scope: WordScope): WordTally => summariseWords(counts)[scope];

/** A day counts as written when anything was added or deleted on it. */
const isActive = (counts: DayCounts | undefined, scope: WordScope): boolean => {
  if (!counts) return false;
  const words = scoped(counts, scope);
  return words.added + words.deleted > 0;
};

/**
 * The writing streak. A day counts when words were added or deleted on it
 * (a day of only cutting keeps the streak alive). Today has grace: while
 * nothing has been written yet today, the streak still runs up to yesterday.
 *
 * @param today today's date, as YYYY-MM-DD
 * @param scope which words count: all notes (the default) or only the manuscript
 */
export function writingStreak(totals: DailyTotals, today: string, scope: WordScope = 'all'): WritingStreak {
  let longest = 0;
  let run = 0;
  let previous: string | null = null;
  for (const [date, counts] of totals) {
    if (!isActive(counts, scope)) continue;
    run = previous !== null && addDays(previous, 1) === date ? run + 1 : 1;
    longest = Math.max(longest, run);
    previous = date;
  }

  if (!isDateText(today)) return { current: 0, longest, writtenToday: false };
  const writtenToday = isActive(totals.get(today), scope);
  let current = 0;
  let day = writtenToday ? today : addDays(today, -1);
  while (isActive(totals.get(day), scope)) {
    current++;
    const earlier = addDays(day, -1);
    if (earlier === day) break;
    day = earlier;
  }
  return { current, longest, writtenToday };
}

/**
 * Totals and averages over the days that were written on. The average divides
 * by the days actually written, not by the days of the calendar.
 *
 * @param scope which words count: all notes (the default) or only the manuscript
 * @param range limit the sum to these days (both included); leave out for all time
 */
export function writingAverage(
  totals: DailyTotals,
  scope: WordScope = 'all',
  range?: { readonly from: string; readonly to: string },
): WritingAverage {
  let daysWritten = 0;
  let added = 0;
  let deleted = 0;
  for (const [date, counts] of totals) {
    if (range && (date < range.from || date > range.to)) continue;
    if (!isActive(counts, scope)) continue;
    const words = scoped(counts, scope);
    daysWritten++;
    added += words.added;
    deleted += words.deleted;
  }
  const net = added - deleted;
  return {
    daysWritten,
    added,
    deleted,
    net,
    averageNet: daysWritten === 0 ? 0 : Math.round(net / daysWritten),
    averageAdded: daysWritten === 0 ? 0 : Math.round(added / daysWritten),
  };
}
