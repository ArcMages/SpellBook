// Calendar sums the writing-progress engine needs on top of src/core/dates.ts:
// how many days lie between two dates, which day of the week a date is, and
// which month it belongs to.
//
// Dates are text written as YYYY-MM-DD. Everything is whole-number arithmetic
// on the proleptic Gregorian calendar, so no time zone and no daylight saving
// change can move a result.

import { addDays, formatLocalDate, isDateText } from './../dates';

const MONTH_PATTERN = /^(\d{4})-(\d{2})$/;

/** Julian day number of 1970-01-01, the day this file counts from. */
const EPOCH_JULIAN_DAY = 2440588;

/**
 * Days from 1970-01-01 to a date (negative before it). Null when the text is
 * not a real date.
 */
export function dayNumber(date: string): number | null {
  if (!isDateText(date)) return null;
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const day = Number(date.slice(8, 10));
  // The usual Julian-day sum: January and February count as months 13 and 14
  // of the year before, so the leap day falls at the very end.
  const shift = month <= 2 ? 1 : 0;
  const y = year + 4800 - shift;
  const m = month + 12 * shift - 3;
  const julian =
    day +
    Math.floor((153 * m + 2) / 5) +
    365 * y +
    Math.floor(y / 4) -
    Math.floor(y / 100) +
    Math.floor(y / 400) -
    32045;
  return julian - EPOCH_JULIAN_DAY;
}

/**
 * How many days `to` is after `from` (negative when it is before). Null when
 * either is not a real date.
 */
export function daysBetween(from: string, to: string): number | null {
  const start = dayNumber(from);
  const end = dayNumber(to);
  return start === null || end === null ? null : end - start;
}

/** The day of the week: 0 is Sunday, 6 is Saturday. Null when the text is not a real date. */
export function dayOfWeek(date: string): number | null {
  const days = dayNumber(date);
  // 1970-01-01 was a Thursday.
  return days === null ? null : (((days + 4) % 7) + 7) % 7;
}

/** True for a month written as YYYY-MM, for example "2026-10". */
export function isMonthText(text: string): boolean {
  const match = MONTH_PATTERN.exec(text);
  if (!match) return false;
  const month = Number(match[2]);
  return month >= 1 && month <= 12;
}

/** The month a date belongs to, as YYYY-MM. Null when the text is not a real date. */
export function monthOf(date: string): string | null {
  return isDateText(date) ? date.slice(0, 7) : null;
}

/**
 * Read a date property: text that is, or begins with, a real date written as
 * YYYY-MM-DD ("2026-10-13" or "2026-10-13T08:30"), or a date value as some
 * YAML readers hand it over. Null for anything else.
 */
export function readDateProperty(value: unknown): string | null {
  if (typeof value === 'string') {
    const text = value.trim();
    const date = text.slice(0, 10);
    if (!isDateText(date)) return null;
    const rest = text.slice(10);
    return rest === '' || /^[T ]/.test(rest) ? date : null;
  }
  if (value instanceof Date) {
    // A bare date in YAML is midnight in universal time.
    const year = value.getUTCFullYear();
    if (!Number.isFinite(year) || year < 0 || year > 9999) return null;
    const text = formatLocalDate(year, value.getUTCMonth() + 1, value.getUTCDate());
    return isDateText(text) ? text : null;
  }
  return null;
}

/** The first and the last day of a span of days, both included. */
export interface DateRange {
  readonly from: string;
  readonly to: string;
}

/**
 * The week a date falls in.
 *
 * @param weekStartsOn the day a week begins with: 0 Sunday, 1 Monday (the default), up to 6 Saturday
 */
export function weekRange(date: string, weekStartsOn = 1): DateRange | null {
  const weekday = dayOfWeek(date);
  if (weekday === null) return null;
  const first = Number.isFinite(weekStartsOn) ? ((Math.trunc(weekStartsOn) % 7) + 7) % 7 : 1;
  const from = addDays(date, -((weekday - first + 7) % 7));
  return { from, to: addDays(from, 6) };
}
