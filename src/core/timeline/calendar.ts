// Invented calendars: the months, weeks and eras of the novel's own world.
//
// A project may define one calendar, stored under the "calendar" key of its
// index note:
//
//   calendar:
//     name: Saltwick reckoning
//     months:
//       - { name: Thaw, days: 36 }
//       - { name: Seedfall, days: 36 }
//     weekdays: [Sunrest, Moonrise]            optional
//     eras:
//       - { name: Age of Embers, short: AE, start: 1 }
//       - { name: Age of Tides, short: AT, start: 1204 }
//     before: { name: Before the Embers, short: BE }   optional
//     yearZero: false
//     leap: { month: 2, days: 1, every: 4 }    optional
//
// A project without one uses the real-world calendar, exactly as before.
//
// How years are counted. One running count of years underlies everything; it
// is the first era's own count, so the first era starts at year 1 (or at
// year 0 when the calendar has a year zero). A later era's "start" is the
// year of that running count in which it begins, and its own years are then
// counted afresh from 1 (or 0). The "before" era, when there is one, counts
// backwards from the year before the first era: 1, 2, 3 and so on.
//
// The leap rule is kept simple: one month gains so many days in every year of
// the running count that "every" divides.
//
// How a date is written in a note: the year within its era in four digits,
// then the month and the day when they are known, then a space and the era's
// short form. "1203 AE", "1203-04 AE", "1203-04-17 AE". Within one era the
// text sorts in date order, and it reads plainly without the plugin.
//
// Everything here is whole-number arithmetic on plain values.

import { clashKey } from './../paths';
import { isRecord } from './common';

/** One month of an invented calendar. */
export interface CalendarMonth {
  /** The writer's name for it, in any language. */
  readonly name: string;
  /** How many days it has in an ordinary year: 1 to 999. */
  readonly days: number;
}

/** One era of an invented calendar. */
export interface CalendarEra {
  /** The writer's name for it: "Age of Embers". */
  readonly name: string;
  /** The short form written after a date: "AE". No spaces, and it does not begin with a digit. */
  readonly short: string;
  /** The year of the running count in which the era begins. The first era's is 1, or 0 with a year zero. */
  readonly start: number;
}

/** The era that counts backwards from before the first era. */
export interface CalendarBefore {
  readonly name: string;
  readonly short: string;
}

/** The leap rule: one month gains days in every year that `every` divides. */
export interface CalendarLeap {
  /** Which month gains the days, counted from 1. */
  readonly month: number;
  /** How many days it gains: 1 to 99. */
  readonly days: number;
  /** Every how many years: 2 to 9999. */
  readonly every: number;
}

/** An invented calendar. Build one with `readCalendar`, which checks it; never by hand. */
export interface StoryCalendar {
  readonly name: string;
  /** At least one, at most 99. */
  readonly months: readonly CalendarMonth[];
  /** The days of the week, in order; empty when the calendar has no week. */
  readonly weekdays: readonly string[];
  /** At least one, in order of their start. */
  readonly eras: readonly CalendarEra[];
  readonly before: CalendarBefore | null;
  /** True when eras count their years from 0 instead of from 1. */
  readonly yearZero: boolean;
  readonly leap: CalendarLeap | null;
}

/** What reading the "calendar" key of a project index came to. */
export interface CalendarReading {
  /** The calendar, or null when the project has none (or it could not be used). */
  readonly calendar: StoryCalendar | null;
  /** Why a stored calendar could not be used, in plain English; null when all is well. */
  readonly problem: string | null;
}

/** The key of the project index that holds the calendar. */
export const CALENDAR_KEY = 'calendar';

/** The most months a calendar can have. */
export const MAX_MONTHS = 99;
/** The most days a month can have. */
export const MAX_MONTH_DAYS = 999;
/** The most days a week can have. */
export const MAX_WEEKDAYS = 99;
/** The most eras a calendar can have. */
export const MAX_ERAS = 20;
/** The highest year an era can count to, so that a year is always written in four digits. */
export const MAX_ERA_YEAR = 9999;

const div = (a: number, b: number): number => Math.floor(a / b);
const isWhole = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value);

function textOf(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return typeof value === 'string' ? value.trim() : '';
}

/** A stored number: a number, or digits written as text. NaN for anything else. */
function numberOf(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && /^-?\d+$/.test(value.trim())) return Number(value.trim());
  return Number.NaN;
}

function shortProblem(short: string, what: string): string | null {
  if (short === '') return `${what} needs a short form, such as "AE".`;
  if (/\s/.test(short)) return `The short form "${short}" must not have a space in it.`;
  if (/^[\d-]/.test(short)) return `The short form "${short}" must not begin with a digit or a dash.`;
  if (short.length > 12) return `The short form "${short}" is too long: 12 characters at most.`;
  return null;
}

/** The first year an era counts: 0 with a year zero, otherwise 1. */
function firstYearOf(calendar: StoryCalendar): number {
  return calendar.yearZero ? 0 : 1;
}

/**
 * Check a calendar. Returns what is wrong with it in plain English, for the
 * writer to put right, or null when it can be used.
 */
export function checkCalendar(calendar: StoryCalendar): string | null {
  if (calendar.name.trim() === '') return 'Give the calendar a name.';
  if (calendar.months.length === 0) return 'A calendar needs at least one month.';
  if (calendar.months.length > MAX_MONTHS) return `A calendar can have ${MAX_MONTHS} months at most.`;
  for (const [index, month] of calendar.months.entries()) {
    if (month.name.trim() === '') return `Month ${index + 1} needs a name.`;
    if (!isWhole(month.days) || month.days < 1 || month.days > MAX_MONTH_DAYS) {
      return `The month "${month.name}" needs a whole number of days, from 1 to ${MAX_MONTH_DAYS}.`;
    }
  }
  if (calendar.weekdays.length > MAX_WEEKDAYS) return `A week can have ${MAX_WEEKDAYS} days at most.`;
  for (const [index, day] of calendar.weekdays.entries()) {
    if (day.trim() === '') return `Day ${index + 1} of the week needs a name.`;
  }
  if (calendar.eras.length === 0) return 'A calendar needs at least one era.';
  if (calendar.eras.length > MAX_ERAS) return `A calendar can have ${MAX_ERAS} eras at most.`;
  const first = firstYearOf(calendar);
  const shorts = new Set<string>();
  let previous: CalendarEra | null = null;
  for (const [index, era] of calendar.eras.entries()) {
    if (era.name.trim() === '') return `Era ${index + 1} needs a name.`;
    const problem = shortProblem(era.short, `The era "${era.name}"`);
    if (problem !== null) return problem;
    if (shorts.has(clashKey(era.short))) return `Two eras share the short form "${era.short}". Each needs its own.`;
    shorts.add(clashKey(era.short));
    if (!isWhole(era.start)) return `The era "${era.name}" needs the year it begins in, as a whole number.`;
    if (previous === null) {
      if (era.start !== first) return `The first era begins in year ${first}.`;
    } else {
      if (era.start <= previous.start) {
        return `The era "${era.name}" must begin later than "${previous.name}", which begins in year ${previous.start}.`;
      }
      if (era.start - previous.start > MAX_ERA_YEAR) {
        return `The era "${previous.name}" would last more than ${MAX_ERA_YEAR} years. Begin "${era.name}" earlier.`;
      }
    }
    previous = era;
  }
  if (calendar.before !== null) {
    if (calendar.before.name.trim() === '') return 'The era before the first needs a name.';
    const problem = shortProblem(calendar.before.short, 'The era before the first');
    if (problem !== null) return problem;
    if (shorts.has(clashKey(calendar.before.short))) {
      return `Two eras share the short form "${calendar.before.short}". Each needs its own.`;
    }
  }
  const leap = calendar.leap;
  if (leap !== null) {
    if (!isWhole(leap.month) || leap.month < 1 || leap.month > calendar.months.length) {
      return 'Choose the month that gains days in a leap year.';
    }
    if (!isWhole(leap.days) || leap.days < 1 || leap.days > 99) return 'A leap year adds a whole number of days, from 1 to 99.';
    if (!isWhole(leap.every) || leap.every < 2 || leap.every > 9999) {
      return 'A leap year comes every so many years: a whole number from 2 to 9999.';
    }
  }
  return null;
}

function readNamed(value: unknown): { name: string; short: string; start: number } | null {
  if (!isRecord(value)) return null;
  return { name: textOf(value['name']), short: textOf(value['short']), start: numberOf(value['start']) };
}

/**
 * Read the "calendar" key of a project index. Never throws. Nothing stored
 * gives no calendar and no problem: the project uses the real-world calendar.
 * A value that cannot be used gives no calendar either, and says why.
 */
export function readCalendar(value: unknown): CalendarReading {
  if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) {
    return { calendar: null, problem: null };
  }
  const refuse = (why: string): CalendarReading => ({
    calendar: null,
    problem: `The story calendar in the project index could not be used, so dates follow the real-world calendar. ${why}`,
  });
  if (!isRecord(value)) return refuse('It should be a group of properties: a name, months and eras.');

  const rawMonths = value['months'];
  if (!Array.isArray(rawMonths)) return refuse('Its "months" should be a list.');
  const months: CalendarMonth[] = [];
  for (const entry of rawMonths as readonly unknown[]) {
    if (!isRecord(entry)) return refuse('Each month should have a name and a number of days.');
    months.push({ name: textOf(entry['name']), days: numberOf(entry['days']) });
  }

  const rawWeek = value['weekdays'];
  if (rawWeek !== undefined && rawWeek !== null && !Array.isArray(rawWeek)) return refuse('Its "weekdays" should be a list of names.');
  const weekdays = Array.isArray(rawWeek) ? (rawWeek as readonly unknown[]).map(textOf) : [];

  const yearZero = value['yearZero'] === true;
  const rawEras = value['eras'];
  if (!Array.isArray(rawEras)) return refuse('Its "eras" should be a list.');
  const eras: CalendarEra[] = [];
  for (const [index, entry] of (rawEras as readonly unknown[]).entries()) {
    const era = readNamed(entry);
    if (era === null) return refuse('Each era should have a name, a short form and the year it begins in.');
    // The first era's start follows from the year zero; it need not be written.
    eras.push(index === 0 && Number.isNaN(era.start) ? { ...era, start: yearZero ? 0 : 1 } : era);
  }

  const rawBefore = value['before'];
  let before: CalendarBefore | null = null;
  if (rawBefore !== undefined && rawBefore !== null) {
    const read = readNamed(rawBefore);
    if (read === null) return refuse('Its "before" should have a name and a short form.');
    before = { name: read.name, short: read.short };
  }

  const rawLeap = value['leap'];
  let leap: CalendarLeap | null = null;
  if (rawLeap !== undefined && rawLeap !== null) {
    if (!isRecord(rawLeap)) return refuse('Its "leap" should have a month, a number of days and "every".');
    leap = { month: numberOf(rawLeap['month']), days: numberOf(rawLeap['days']), every: numberOf(rawLeap['every']) };
  }

  const calendar: StoryCalendar = { name: textOf(value['name']), months, weekdays, eras, before, yearZero, leap };
  const problem = checkCalendar(calendar);
  return problem === null ? { calendar, problem: null } : refuse(problem);
}

/** A calendar as plain data, ready to be stored under the "calendar" key of the project index. */
export function calendarToIndexValue(calendar: StoryCalendar): Record<string, unknown> {
  const value: Record<string, unknown> = {
    name: calendar.name,
    months: calendar.months.map((month) => ({ name: month.name, days: month.days })),
  };
  if (calendar.weekdays.length > 0) value['weekdays'] = [...calendar.weekdays];
  value['eras'] = calendar.eras.map((era) => ({ name: era.name, short: era.short, start: era.start }));
  if (calendar.before !== null) value['before'] = { name: calendar.before.name, short: calendar.before.short };
  value['yearZero'] = calendar.yearZero;
  if (calendar.leap !== null) {
    value['leap'] = { month: calendar.leap.month, days: calendar.leap.days, every: calendar.leap.every };
  }
  return value;
}

// ------------------------------------------------------------- starting points

/** A ready-made calendar to start from. */
export interface CalendarPreset {
  /** A name no other starting point has. */
  readonly id: string;
  /** What the list of starting points calls it. */
  readonly label: string;
  /** The calendar, or null for the real-world one (a project then stores none). */
  readonly calendar: StoryCalendar | null;
}

const numbered = (word: string, count: number): string[] => Array.from({ length: count }, (_, index) => `${word} ${index + 1}`);

/** The starting points the Calendar window offers: the real world, twelve months of thirty days, and a ten-month example. */
export const CALENDAR_PRESETS: readonly CalendarPreset[] = [
  { id: 'real', label: 'Real world', calendar: null },
  {
    id: 'twelve-thirty',
    label: 'Twelve months of thirty days',
    calendar: {
      name: 'Twelve months of thirty days',
      months: numbered('Month', 12).map((name) => ({ name, days: 30 })),
      weekdays: numbered('Day', 7),
      eras: [{ name: 'First Era', short: 'FE', start: 1 }],
      before: null,
      yearZero: false,
      leap: null,
    },
  },
  {
    id: 'ten-months',
    label: 'Ten months (an example)',
    calendar: {
      name: 'Ember reckoning',
      months: ['Thaw', 'Seedfall', 'Greening', 'Highsun', 'Goldwane', 'Harvest', 'Mistfall', 'Frost', 'Deepnight', 'Turning'].map(
        (name) => ({ name, days: 36 }),
      ),
      weekdays: ['Sunrest', 'Moonrise', 'Tidesday', 'Windsday', 'Fireday', 'Stoneday'],
      eras: [{ name: 'Age of Embers', short: 'AE', start: 1 }],
      before: { name: 'Before the Embers', short: 'BE' },
      yearZero: false,
      leap: { month: 10, days: 5, every: 4 },
    },
  },
];

// ------------------------------------------------------------------ the years

/** A year as its era counts it. */
export interface EraYear {
  /** Which era: its place in `eras`, or -1 for the "before" era. */
  readonly era: number;
  /** The year within that era. */
  readonly year: number;
}

/** The first year of the running count that a date can have. */
export function firstCalendarYear(calendar: StoryCalendar): number {
  const first = firstYearOf(calendar);
  return calendar.before === null ? first : first - MAX_ERA_YEAR;
}

/** The last year of the running count that a date can have. */
export function lastCalendarYear(calendar: StoryCalendar): number {
  const last = calendar.eras[calendar.eras.length - 1];
  return (last?.start ?? 1) + MAX_ERA_YEAR - firstYearOf(calendar);
}

/** The era a year of the running count falls in, and the year as that era counts it. */
export function eraYearOf(calendar: StoryCalendar, year: number): EraYear {
  const first = firstYearOf(calendar);
  if (year < first) return { era: -1, year: first - year };
  let index = 0;
  for (let next = 1; next < calendar.eras.length; next++) {
    if ((calendar.eras[next]?.start ?? Number.POSITIVE_INFINITY) <= year) index = next;
  }
  return { era: index, year: year - (calendar.eras[index]?.start ?? first) + first };
}

/**
 * The year of the running count for a year as an era counts it. Null when
 * that era has no such year: before its first, after the next era began,
 * past 9999, or in a "before" era the calendar does not have.
 *
 * @param era  the era's place in `eras`, or -1 for the "before" era
 * @param year the year within the era
 */
export function runningYearOf(calendar: StoryCalendar, era: number, year: number): number | null {
  if (!isWhole(year) || !isWhole(era)) return null;
  const first = firstYearOf(calendar);
  if (era === -1) {
    if (calendar.before === null || year < 1 || year > MAX_ERA_YEAR) return null;
    return first - year;
  }
  const own = calendar.eras[era];
  if (own === undefined || year < first || year > MAX_ERA_YEAR) return null;
  const running = own.start + year - first;
  const next = calendar.eras[era + 1];
  return next !== undefined && running >= next.start ? null : running;
}

/** The short form of an era: its place in `eras`, or -1 for the "before" era. "" when there is none. */
export function eraShort(calendar: StoryCalendar, era: number): string {
  return era === -1 ? (calendar.before?.short ?? '') : (calendar.eras[era]?.short ?? '');
}

/** The era a short form names, whatever its capitals: its place in `eras`, -1 for the "before" era, or null. */
export function eraByShort(calendar: StoryCalendar, short: string): number | null {
  const key = clashKey(short.trim());
  const index = calendar.eras.findIndex((era) => clashKey(era.short) === key);
  if (index >= 0) return index;
  return calendar.before !== null && clashKey(calendar.before.short) === key ? -1 : null;
}

// ------------------------------------------------------------------- the days

/** True for a year of the running count in which the leap month gains its days. */
export function isCalendarLeapYear(calendar: StoryCalendar, year: number): boolean {
  const leap = calendar.leap;
  return leap !== null && year - div(year, leap.every) * leap.every === 0;
}

/** The number of days in a month of a year (`month` counts from 1); 0 for a month that does not exist. */
export function calendarDaysInMonth(calendar: StoryCalendar, year: number, month: number): number {
  const days = calendar.months[month - 1]?.days;
  if (days === undefined) return 0;
  return days + (calendar.leap !== null && calendar.leap.month === month && isCalendarLeapYear(calendar, year) ? calendar.leap.days : 0);
}

/** The number of days in an ordinary year. */
export function calendarYearLength(calendar: StoryCalendar): number {
  let days = 0;
  for (const month of calendar.months) days += month.days;
  return days;
}

/** The fewest days any month has. */
export function shortestCalendarMonth(calendar: StoryCalendar): number {
  let least = Number.POSITIVE_INFINITY;
  for (const month of calendar.months) least = Math.min(least, month.days);
  return Number.isFinite(least) ? least : 1;
}

/** Days from the first day of year 1 of the running count to the first day of `year`. */
function daysBeforeYear(calendar: StoryCalendar, year: number): number {
  const earlier = year - 1;
  const leap = calendar.leap;
  return earlier * calendarYearLength(calendar) + (leap === null ? 0 : leap.days * div(earlier, leap.every));
}

/**
 * The day number of a date of an invented calendar: whole days since the
 * first day of year 1 of the running count, negative before it.
 */
export function calendarDayNumber(calendar: StoryCalendar, year: number, month: number, day: number): number {
  let days = daysBeforeYear(calendar, year);
  for (let index = 1; index < month; index++) days += calendarDaysInMonth(calendar, year, index);
  return days + (day - 1);
}

/** The year, month and day that hold a whole day number of an invented calendar. */
export function calendarDateOfDay(calendar: StoryCalendar, dayNumber: number): [number, number, number] {
  const leap = calendar.leap;
  const average = calendarYearLength(calendar) + (leap === null ? 0 : leap.days / leap.every);
  // The guess is right or a year off.
  let year = div(dayNumber, average) + 1;
  while (daysBeforeYear(calendar, year) > dayNumber) year--;
  while (daysBeforeYear(calendar, year + 1) <= dayNumber) year++;
  let rest = dayNumber - daysBeforeYear(calendar, year);
  let month = 1;
  while (month < calendar.months.length && rest >= calendarDaysInMonth(calendar, year, month)) {
    rest -= calendarDaysInMonth(calendar, year, month);
    month++;
  }
  return [year, month, rest + 1];
}

/** The name of the day of the week a day number falls on; "" when the calendar has no week. Day 0 is the first day of the week. */
export function calendarWeekday(calendar: StoryCalendar, dayNumber: number): string {
  const count = calendar.weekdays.length;
  if (count === 0) return '';
  const whole = Math.floor(dayNumber);
  return calendar.weekdays[whole - div(whole, count) * count] ?? '';
}

// ------------------------------------------------------------------- the text

const pad = (value: number, width: number): string => String(value).padStart(width, '0');

/** How many digits the day of the month is written in: two, or three when a month can have a hundred days. */
function dayWidth(calendar: StoryCalendar): number {
  let longest = 0;
  for (let month = 1; month <= calendar.months.length; month++) {
    const extra = calendar.leap !== null && calendar.leap.month === month ? calendar.leap.days : 0;
    longest = Math.max(longest, (calendar.months[month - 1]?.days ?? 0) + extra);
  }
  return longest > 99 ? 3 : 2;
}

/**
 * A date of an invented calendar as it is written in a note: "1203 AE",
 * "1203-04 AE" or "1203-04-17 AE".
 *
 * @param year      the year of the running count
 * @param precision how much of the date is known
 */
export function calendarDateText(
  calendar: StoryCalendar,
  precision: 'year' | 'month' | 'day',
  year: number,
  month: number,
  day: number,
): string {
  const own = eraYearOf(calendar, year);
  let text = pad(own.year, 4);
  if (precision !== 'year') text += `-${pad(month, 2)}`;
  if (precision === 'day') text += `-${pad(day, dayWidth(calendar))}`;
  return `${text} ${eraShort(calendar, own.era)}`;
}

/** The parts of a date read from text: the year of the running count, and the month and day when they were written. */
export interface CalendarDateParts {
  readonly year: number;
  readonly month?: number;
  readonly day?: number;
}

const CALENDAR_DATE_TEXT = /^(\d{1,4})(?:-(\d{1,2})(?:-(\d{1,3}))?)?\s+(\S+)$/;

/**
 * Read a date of an invented calendar from text: "1203 AE", "1203-04 AE" or
 * "1203-04-17 AE". Null for anything else, for an era the calendar does not
 * have, and for a year, month or day that does not exist in it. A date with
 * no era is never read: it may be a real-world date from before the project
 * took this calendar, and is not to be taken for something else.
 */
export function readCalendarDateText(calendar: StoryCalendar, text: string): CalendarDateParts | null {
  const match = CALENDAR_DATE_TEXT.exec(text.trim());
  if (!match) return null;
  const era = eraByShort(calendar, match[4] ?? '');
  if (era === null) return null;
  const year = runningYearOf(calendar, era, Number(match[1]));
  if (year === null) return null;
  if (match[2] === undefined) return { year };
  const month = Number(match[2]);
  if (month < 1 || month > calendar.months.length) return null;
  if (match[3] === undefined) return { year, month };
  const day = Number(match[3]);
  if (day < 1 || day > calendarDaysInMonth(calendar, year, month)) return null;
  return { year, month, day };
}

/**
 * A date of an invented calendar as the screen shows it: "17 Thaw 1203 AE",
 * "Thaw 1203 AE" or "1203 AE".
 */
export function formatCalendarDate(
  calendar: StoryCalendar,
  precision: 'year' | 'month' | 'day',
  year: number,
  month: number,
  day: number,
): string {
  const own = eraYearOf(calendar, year);
  const yearText = `${own.year} ${eraShort(calendar, own.era)}`;
  if (precision === 'year') return yearText;
  const name = calendar.months[month - 1]?.name ?? '';
  return precision === 'month' ? `${name} ${yearText}` : `${day} ${name} ${yearText}`;
}

/** An example of a written date in a calendar, for messages: the first day of the third year of its last era, "0003-01-01 AE". */
export function calendarExampleText(calendar: StoryCalendar): string {
  const last = calendar.eras[calendar.eras.length - 1];
  return calendarDateText(calendar, 'day', (last?.start ?? firstYearOf(calendar)) + 2, 1, 1);
}
