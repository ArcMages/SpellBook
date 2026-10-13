// The calendar's month grid.
//
// Everything here works on dates written as YYYY-MM-DD and on whole numbers.
// The clock is never read and no time of day is involved, so a time zone or a
// change to summer time cannot move a day.
//
// Months run from January of the year 1 to December 9998. Every function
// here tidies what it is given in the same way: a month outside 1 to 12 rolls
// over into the next or previous year, and a year outside that range is
// brought to the nearest end of it.

import { addDays, formatLocalDate, isDateText } from './fromCore';

/** A month of a year. `month` is 1 (January) to 12 (December). */
export interface YearMonth {
  readonly year: number;
  readonly month: number;
}

/** One cell of the month grid. */
export interface CalendarDay {
  /** The day as YYYY-MM-DD. */
  readonly date: string;
  /** The day of the month, 1 to 31. */
  readonly day: number;
  /** The day of the week: 0 is Sunday, 6 is Saturday. */
  readonly weekday: number;
  /** False for the days of the month before or after that fill the first and last week. */
  readonly inMonth: boolean;
}

/** A month laid out as weeks. It is also a YearMonth, so it can be handed to nextMonth and previousMonth. */
export interface MonthGrid extends YearMonth {
  /** The weekday the weeks start on: 0 is Sunday, 1 is Monday, up to 6 for Saturday. */
  readonly firstDayOfWeek: number;
  /** The weekday of each of the seven columns, in order. Use with WEEKDAY_NAMES for the headings. */
  readonly weekdays: readonly number[];
  /** The weeks the month touches (four to six), each of seven days. */
  readonly weeks: readonly (readonly CalendarDay[])[];
  /** The first day shown: the top corner of the grid. May belong to the month before. */
  readonly from: string;
  /** The last day shown. May belong to the month after. */
  readonly to: string;
}

/** The days of the week in English; position 0 is Sunday. */
export const WEEKDAY_NAMES: readonly string[] = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

/** Three-letter names of the days of the week; position 0 is "Sun". */
export const WEEKDAY_SHORT_NAMES: readonly string[] = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** The months in English; position 0 is January. */
export const MONTH_NAMES: readonly string[] = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

// The grid of a month also shows a few days of its neighbours, and dates are
// written with a four-digit year, so the first and last years are left out.
const FIRST_YEAR = 1;
const LAST_YEAR = 9998;

const floorDiv = (a: number, b: number): number => Math.floor(a / b);

const whole = (value: number, fallback: number): number => (Number.isFinite(value) ? Math.trunc(value) : fallback);

/**
 * Tidy a year and month. A month outside 1 to 12 rolls over into the years
 * next to it (month 13 is January of the next year, month 0 is December of
 * the year before); years stop at 1 and 9998. Anything that is not a number
 * counts as the first year or the first month.
 */
function tidyMonth(year: number, month: number): YearMonth {
  const count = whole(year, FIRST_YEAR) * 12 + (whole(month, 1) - 1);
  const kept = Math.min(Math.max(count, FIRST_YEAR * 12), LAST_YEAR * 12 + 11);
  return { year: floorDiv(kept, 12), month: (kept % 12) + 1 };
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** How many days a month has. `month` is 1 to 12. */
export function daysInMonth(year: number, month: number): number {
  const tidy = tidyMonth(year, month);
  if (tidy.month === 2) return isLeapYear(tidy.year) ? 29 : 28;
  return [4, 6, 9, 11].includes(tidy.month) ? 30 : 31;
}

// Offsets that turn a month into its place in the week (Sakamoto's method).
const MONTH_OFFSETS: readonly number[] = [0, 3, 2, 5, 0, 3, 5, 1, 4, 6, 2, 4];

function weekdayOfCivil(year: number, month: number, day: number): number {
  const y = month < 3 ? year - 1 : year;
  const sum = y + floorDiv(y, 4) - floorDiv(y, 100) + floorDiv(y, 400) + (MONTH_OFFSETS[month - 1] ?? 0) + day;
  return ((sum % 7) + 7) % 7;
}

/** The day of the week of a date (YYYY-MM-DD): 0 is Sunday, 6 is Saturday. Null for text that is not a real date. */
export function weekdayOf(date: string): number | null {
  if (!isDateText(date)) return null;
  return weekdayOfCivil(Number(date.slice(0, 4)), Number(date.slice(5, 7)), Number(date.slice(8, 10)));
}

/** The month a date (YYYY-MM-DD) falls in. Null for text that is not a real date. */
export function monthOf(date: string): YearMonth | null {
  if (!isDateText(date)) return null;
  return { year: Number(date.slice(0, 4)), month: Number(date.slice(5, 7)) };
}

/** The month after. December is followed by January of the next year. */
export function nextMonth(month: YearMonth): YearMonth {
  return tidyMonth(month.year, month.month + 1);
}

/** The month before. January is preceded by December of the year before. */
export function previousMonth(month: YearMonth): YearMonth {
  return tidyMonth(month.year, month.month - 1);
}

/** The first and the last day of a month, as YYYY-MM-DD. `month` is 1 to 12. */
export function monthRange(year: number, month: number): { readonly from: string; readonly to: string } {
  const tidy = tidyMonth(year, month);
  return {
    from: formatLocalDate(tidy.year, tidy.month, 1),
    to: formatLocalDate(tidy.year, tidy.month, daysInMonth(tidy.year, tidy.month)),
  };
}

/** Bring any number to a weekday, 0 to 6 (7 is Sunday again; anything that is not a number is Sunday). */
function tidyWeekday(value: number): number {
  return ((whole(value, 0) % 7) + 7) % 7;
}

/**
 * Lay a month out as weeks.
 *
 * @param year           for example 2026
 * @param month          1 (January) to 12 (December)
 * @param firstDayOfWeek the weekday the weeks start on: 0 Sunday (the default), 1 Monday, up to 6 Saturday
 */
export function monthGrid(year: number, month: number, firstDayOfWeek = 0): MonthGrid {
  const tidy = tidyMonth(year, month);
  const weekStart = tidyWeekday(firstDayOfWeek);
  const first = formatLocalDate(tidy.year, tidy.month, 1);
  const prefix = first.slice(0, 8);
  // How many days of the month before come first, to fill the first week.
  const lead = (weekdayOfCivil(tidy.year, tidy.month, 1) - weekStart + 7) % 7;
  const weekCount = Math.ceil((lead + daysInMonth(tidy.year, tidy.month)) / 7);
  const from = addDays(first, -lead);

  const weeks: CalendarDay[][] = [];
  for (let week = 0; week < weekCount; week++) {
    const days: CalendarDay[] = [];
    for (let column = 0; column < 7; column++) {
      const date = addDays(from, week * 7 + column);
      days.push({
        date,
        day: Number(date.slice(8, 10)),
        weekday: (weekStart + column) % 7,
        inMonth: date.startsWith(prefix),
      });
    }
    weeks.push(days);
  }
  return {
    year: tidy.year,
    month: tidy.month,
    firstDayOfWeek: weekStart,
    weekdays: [0, 1, 2, 3, 4, 5, 6].map((column) => (weekStart + column) % 7),
    weeks,
    from,
    to: addDays(from, weekCount * 7 - 1),
  };
}

/** A month's heading, for example "October 2026". */
export function monthTitle(year: number, month: number): string {
  const tidy = tidyMonth(year, month);
  return `${MONTH_NAMES[tidy.month - 1] ?? ''} ${tidy.year}`;
}

/** A day's heading, for example "Tuesday, 20 October 2026". Text that is not a real date comes back as it is. */
export function dayTitle(date: string): string {
  const weekday = weekdayOf(date);
  if (weekday === null) return date;
  const month = Number(date.slice(5, 7));
  return `${WEEKDAY_NAMES[weekday] ?? ''}, ${Number(date.slice(8, 10))} ${MONTH_NAMES[month - 1] ?? ''} ${Number(date.slice(0, 4))}`;
}
