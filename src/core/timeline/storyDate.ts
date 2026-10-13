// Story dates: the dates of the novel's own world.
//
// A story date is known to the year ("1923"), the month ("1923-04") or the
// day ("1923-04-12"), and stands at the first day of its period. Years run
// from 1 to 9999 on the proleptic Gregorian calendar.
//
// Everything here is whole-number arithmetic. No clock and no time zone is
// involved, so a date means the same on every device.

import { formatLocalDate } from './../dates';

/** How exactly a story date is known. */
export type DatePrecision = 'year' | 'month' | 'day';

/** A date in the story. Build one with `storyDate` or `readStoryDate`, never by hand. */
export interface StoryDate {
  readonly precision: DatePrecision;
  /** 1 to 9999. */
  readonly year: number;
  /** 1 to 12; 1 when only the year is known. */
  readonly month: number;
  /** 1 to 31; 1 when the day is not known. */
  readonly day: number;
}

/** When something happens: a start, and an end when it lasts. */
export interface DateRange {
  readonly start: StoryDate;
  /** Later than `start`, or null for a single moment. */
  readonly end: StoryDate | null;
}

/** The first year a story date can have. */
export const MIN_YEAR = 1;
/** The last year a story date can have. */
export const MAX_YEAR = 9999;

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_LENGTHS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const DAYS_BEFORE_MONTH = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
const PRECISION_RANK: Readonly<Record<DatePrecision, number>> = { year: 0, month: 1, day: 2 };
// The dash between the two ends of a range, built from its number so that this file stays plain ASCII.
const EN_DASH = String.fromCharCode(0x2013);

const div = (a: number, b: number): number => Math.floor(a / b);
const isWhole = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value);

/** True for a leap year: every fourth year, except the centuries that 400 does not divide. */
export function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

/** The number of days in a month (`month` is 1 to 12); 0 for a month that does not exist. */
export function daysInMonth(year: number, month: number): number {
  if (month === 2 && isLeapYear(year)) return 29;
  return MONTH_LENGTHS[month - 1] ?? 0;
}

/** Days from the first day of year 1 to the first day of `year`. */
function daysBeforeYear(year: number): number {
  const earlier = year - 1;
  return earlier * 365 + div(earlier, 4) - div(earlier, 100) + div(earlier, 400);
}

// Day numbers count from 1970-01-01, the same day that src/core/dates.ts counts from.
const EPOCH_SHIFT = daysBeforeYear(1970);

function toDayNumber(year: number, month: number, day: number): number {
  const leapDay = month > 2 && isLeapYear(year) ? 1 : 0;
  return daysBeforeYear(year) + (DAYS_BEFORE_MONTH[month - 1] ?? 0) + leapDay + (day - 1) - EPOCH_SHIFT;
}

function toCalendar(dayNumber: number): [number, number, number] {
  const sinceYearOne = dayNumber + EPOCH_SHIFT;
  // 400 years are always 146097 days; the guess is right or one year off.
  let year = div(sinceYearOne * 400, 146097) + 1;
  while (daysBeforeYear(year) > sinceYearOne) year--;
  while (daysBeforeYear(year + 1) <= sinceYearOne) year++;
  let rest = sinceYearOne - daysBeforeYear(year);
  let month = 1;
  while (month < 12 && rest >= daysInMonth(year, month)) {
    rest -= daysInMonth(year, month);
    month++;
  }
  return [year, month, rest + 1];
}

/** The day number of 1 January of year 1, the earliest story date. */
export const MIN_DAY_NUMBER = toDayNumber(MIN_YEAR, 1, 1);
/** The day number of 31 December 9999, the latest story date. */
export const MAX_DAY_NUMBER = toDayNumber(MAX_YEAR, 12, 31);

const MAX_MONTH_INDEX = MAX_YEAR * 12 - 1;

/** Months since January of year 1. */
function monthIndexOf(date: StoryDate): number {
  return (date.year - 1) * 12 + (date.month - 1);
}

function monthDate(index: number): StoryDate {
  const safe = Math.min(MAX_MONTH_INDEX, Math.max(0, index));
  const year = div(safe, 12) + 1;
  return { precision: 'month', year, month: safe - (year - 1) * 12 + 1, day: 1 };
}

function yearDate(year: number): StoryDate {
  return { precision: 'year', year: Math.min(MAX_YEAR, Math.max(MIN_YEAR, year)), month: 1, day: 1 };
}

/** A day number brought into the calendar's range. Anything that is not a number counts as the earliest day. */
function clampDayNumber(dayNumber: number): number {
  if (Number.isNaN(dayNumber)) return MIN_DAY_NUMBER;
  return Math.min(MAX_DAY_NUMBER, Math.max(MIN_DAY_NUMBER, dayNumber));
}

/**
 * Make a story date. Give the year alone, the year and month, or all three;
 * the precision follows from what is given. Returns null for a date that does
 * not exist (month 13, 30 February) or lies outside the years 1 to 9999.
 */
export function storyDate(year: number, month?: number, day?: number): StoryDate | null {
  if (!isWhole(year) || year < MIN_YEAR || year > MAX_YEAR) return null;
  if (month === undefined) return day === undefined ? { precision: 'year', year, month: 1, day: 1 } : null;
  if (!isWhole(month) || month < 1 || month > 12) return null;
  if (day === undefined) return { precision: 'month', year, month, day: 1 };
  if (!isWhole(day) || day < 1 || day > daysInMonth(year, month)) return null;
  return { precision: 'day', year, month, day };
}

/** A property value that was understood as a date, with what is needed to write a new date the same way. */
export interface ParsedDateValue {
  readonly date: StoryDate;
  /** Whether the value was a bare number (a year) or text. */
  readonly form: 'number' | 'text';
  /** The time of day that followed the date, exactly as written ("T10:30:00Z"); "" when there was none. */
  readonly suffix: string;
}

const DATE_TEXT = /^(\d{1,4})(?:-(\d{1,2})(?:-(\d{1,2}))?)?$/;
// A date followed by a time of day: "1923-04-12T10:30", "1923-04-12 10:30:00.5Z", "1923-04-12T10:30:00+02:00".
const DATE_TIME_TEXT =
  /^(\d{1,4})-(\d{1,2})-(\d{1,2})([Tt ]\d{1,2}(?::?\d{2}){0,2}(?:[.,]\d+)?(?: ?(?:[Zz]|[+-]\d{2}(?::?\d{2})?))?)$/;

/** The ISO text of a calendar object, as some YAML readers make from a date. Null for anything else. */
function isoTextOf(value: unknown): string | null {
  if (typeof value !== 'object' || value === null) return null;
  const toIso: unknown = (value as { toISOString?: unknown }).toISOString;
  if (typeof toIso !== 'function') return null;
  try {
    const text: unknown = toIso.call(value);
    return typeof text === 'string' ? text : null;
  } catch {
    return null;
  }
}

function parseDateText(text: string): ParsedDateValue | null {
  const trimmed = text.trim();
  const plain = DATE_TEXT.exec(trimmed);
  if (plain) {
    const [year, month, day] = [plain[1], plain[2], plain[3]].map((part) => (part === undefined ? undefined : Number(part)));
    const date = year === undefined ? null : storyDate(year, month, day);
    return date === null ? null : { date, form: 'text', suffix: '' };
  }
  const timed = DATE_TIME_TEXT.exec(trimmed);
  if (timed) {
    const date = storyDate(Number(timed[1]), Number(timed[2]), Number(timed[3]));
    return date === null ? null : { date, form: 'text', suffix: timed[4] ?? '' };
  }
  return null;
}

/** Read a date property, keeping how it was written. Null when it is not a date. */
export function parseDateValue(value: unknown): ParsedDateValue | null {
  if (typeof value === 'number') {
    const date = storyDate(value);
    return date === null ? null : { date, form: 'number', suffix: '' };
  }
  if (typeof value === 'string') return parseDateText(value);
  const iso = isoTextOf(value);
  if (iso === null) return null;
  const parsed = parseDateText(iso);
  return parsed === null ? null : { date: parsed.date, form: 'text', suffix: '' };
}

/** True for a property that is not there or was left empty. */
export function isBlankValue(value: unknown): boolean {
  return value === undefined || value === null || (typeof value === 'string' && value.trim() === '');
}

/**
 * Read a date from a property value. The value may be a number (1923), text
 * in one of the three forms ("1923", "1923-04", "1923-04-12"), or a full
 * date and time ("1923-04-12T10:30:00Z"), of which the date part is used.
 * Never throws: anything else, a date that does not exist, and a year outside
 * 1 to 9999 all give null, which the timeline shows as "undated".
 */
export function readStoryDate(value: unknown): StoryDate | null {
  return parseDateValue(value)?.date ?? null;
}

/** A story date as text: "1923", "1923-04" or "1923-04-12", always with a four-digit year. */
export function storyDateToText(date: StoryDate): string {
  const full = formatLocalDate(date.year, date.month, date.day);
  if (date.precision === 'year') return full.slice(0, 4);
  return date.precision === 'month' ? full.slice(0, 7) : full;
}

/**
 * A story date as the value to store in a note's properties: a bare number
 * for a year (1923), text for a month or a day ("1923-04", "1923-04-12").
 */
export function storyDateToFrontmatter(date: StoryDate): string | number {
  return date.precision === 'year' ? date.year : storyDateToText(date);
}

/** A story date in English: "12 Apr 1923", "Apr 1923" or "1923". */
export function formatStoryDate(date: StoryDate): string {
  if (date.precision === 'year') return String(date.year);
  const month = MONTH_NAMES[date.month - 1] ?? '';
  return date.precision === 'month' ? `${month} ${date.year}` : `${date.day} ${month} ${date.year}`;
}

/**
 * Two story dates as a range in English, joined by an en dash with a space
 * on each side: "Apr 1923" to "1925". With no end, or an end equal to the
 * start, just the start.
 */
export function formatStoryDateRange(start: StoryDate, end: StoryDate | null): string {
  if (end === null || sameStoryDate(start, end)) return formatStoryDate(start);
  return `${formatStoryDate(start)} ${EN_DASH} ${formatStoryDate(end)}`;
}

/**
 * The whole day number of a story date: days since 1 January 1970, negative
 * before it. A year or a month counts as its first day.
 */
export function storyDateToDayNumber(date: StoryDate): number {
  return toDayNumber(date.year, date.month, date.day);
}

/**
 * The story date that holds a day number, at the precision asked for: the
 * day itself, or the month or year it falls in. Fractions are dropped, and a
 * number outside the calendar is brought to its nearest end.
 */
export function dayNumberToStoryDate(dayNumber: number, precision: DatePrecision = 'day'): StoryDate {
  const [year, month, day] = toCalendar(Math.floor(clampDayNumber(dayNumber)));
  if (precision === 'year') return { precision, year, month: 1, day: 1 };
  if (precision === 'month') return { precision, year, month, day: 1 };
  return { precision, year, month, day };
}

/** True when two story dates are the same day at the same precision. */
export function sameStoryDate(a: StoryDate, b: StoryDate): boolean {
  return a.precision === b.precision && a.year === b.year && a.month === b.month && a.day === b.day;
}

/**
 * Order two story dates for sorting: earlier first. Dates that stand on the
 * same day ("1923" and "1923-01-01") sort the less exact one first.
 */
export function compareStoryDates(a: StoryDate, b: StoryDate): number {
  return storyDateToDayNumber(a) - storyDateToDayNumber(b) || PRECISION_RANK[a.precision] - PRECISION_RANK[b.precision];
}

/**
 * A story date moved by whole steps of its own precision: years for a year,
 * months for a month, days for a day. Negative steps go back. The result
 * stops at the ends of the calendar.
 */
export function shiftStoryDate(date: StoryDate, steps: number): StoryDate {
  if (!Number.isFinite(steps)) return date;
  const whole = Math.trunc(steps);
  if (date.precision === 'year') return yearDate(date.year + whole);
  if (date.precision === 'month') return monthDate(monthIndexOf(date) + whole);
  return dayNumberToStoryDate(clampDayNumber(storyDateToDayNumber(date) + whole), 'day');
}

/**
 * The story date nearest to a (possibly fractional) day number, at the
 * precision asked for: the nearest day, the nearest first of a month, or the
 * nearest 1 January. This is what a dragged event snaps to.
 */
export function snapDayNumber(dayNumber: number, precision: DatePrecision): StoryDate {
  const clamped = clampDayNumber(dayNumber);
  if (precision === 'day') return dayNumberToStoryDate(clampDayNumber(Math.round(clamped)), 'day');
  const before = dayNumberToStoryDate(clamped, precision);
  const after = shiftStoryDate(before, 1);
  if (sameStoryDate(after, before)) return before;
  return storyDateToDayNumber(after) - clamped <= clamped - storyDateToDayNumber(before) ? after : before;
}

/**
 * Move a start date to `target` and bring the end along, so a span keeps its
 * length. The end keeps its own precision and moves by the same amount in its
 * own units: days for a day, months for a month, years for a year.
 *
 * When the end would pass the last day of year 9999, the start is held back
 * so that the whole span still fits. An end that is not later than the start
 * is no span: it is left out of the result.
 */
export function moveDates(start: StoryDate, end: StoryDate | null, target: StoryDate): DateRange {
  const startDay = storyDateToDayNumber(start);
  if (end === null || storyDateToDayNumber(end) <= startDay) return { start: target, end: null };

  // The last day the new start may fall on for the end to stay in the calendar.
  let lastStartDay: number;
  if (end.precision === 'day') {
    lastStartDay = startDay + (MAX_DAY_NUMBER - storyDateToDayNumber(end));
  } else if (end.precision === 'month') {
    const lastMonth = monthIndexOf(start) + (MAX_MONTH_INDEX - monthIndexOf(end));
    lastStartDay = lastMonth >= MAX_MONTH_INDEX ? MAX_DAY_NUMBER : storyDateToDayNumber(monthDate(lastMonth + 1)) - 1;
  } else {
    const lastYear = start.year + (MAX_YEAR - end.year);
    lastStartDay = lastYear >= MAX_YEAR ? MAX_DAY_NUMBER : toDayNumber(lastYear + 1, 1, 1) - 1;
  }
  const moved =
    storyDateToDayNumber(target) <= lastStartDay ? target : dayNumberToStoryDate(lastStartDay, target.precision);

  let movedEnd: StoryDate;
  if (end.precision === 'day') {
    const day = storyDateToDayNumber(end) + storyDateToDayNumber(moved) - startDay;
    movedEnd = dayNumberToStoryDate(clampDayNumber(day), 'day');
  } else if (end.precision === 'month') {
    movedEnd = monthDate(monthIndexOf(end) + monthIndexOf(moved) - monthIndexOf(start));
  } else {
    movedEnd = yearDate(end.year + moved.year - start.year);
  }
  return { start: moved, end: movedEnd };
}
