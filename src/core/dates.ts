// Calendar arithmetic on dates written as YYYY-MM-DD.
//
// The core never reads the clock: today's date is handed in as text, and
// these helpers work on that text with plain whole-number arithmetic (the
// proleptic Gregorian calendar), so the result does not depend on the
// device's time zone.

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

const div = (a: number, b: number): number => Math.floor(a / b);

/** Days from 1970-01-01 to the given date. `month` is 1 to 12. */
export function daysFromCivil(year: number, month: number, day: number): number {
  const y = month <= 2 ? year - 1 : year;
  const era = div(y, 400);
  const yearOfEra = y - era * 400;
  const dayOfYear = div(153 * (month > 2 ? month - 3 : month + 9) + 2, 5) + day - 1;
  const dayOfEra = yearOfEra * 365 + div(yearOfEra, 4) - div(yearOfEra, 100) + dayOfYear;
  return era * 146097 + dayOfEra - 719468;
}

/** The date that is `days` days after 1970-01-01, as [year, month, day]. */
export function civilFromDays(days: number): [number, number, number] {
  const z = days + 719468;
  const era = div(z, 146097);
  const dayOfEra = z - era * 146097;
  const yearOfEra = div(dayOfEra - div(dayOfEra, 1460) + div(dayOfEra, 36524) - div(dayOfEra, 146096), 365);
  const dayOfYear = dayOfEra - (365 * yearOfEra + div(yearOfEra, 4) - div(yearOfEra, 100));
  const monthIndex = div(5 * dayOfYear + 2, 153);
  const day = dayOfYear - div(153 * monthIndex + 2, 5) + 1;
  const month = monthIndex < 10 ? monthIndex + 3 : monthIndex - 9;
  const year = yearOfEra + era * 400 + (month <= 2 ? 1 : 0);
  return [year, month, day];
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, '0');
}

/** Format a calendar date as YYYY-MM-DD. `month` is 1 to 12. */
export function formatLocalDate(year: number, month: number, day: number): string {
  return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;
}

/** True for a real calendar date written as YYYY-MM-DD. */
export function isDateText(text: string): boolean {
  const match = DATE_PATTERN.exec(text);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const [y, m, d] = civilFromDays(daysFromCivil(year, month, day));
  return y === year && m === month && d === day;
}

/**
 * The day number of a date written as YYYY-MM-DD: the days from 1970-01-01
 * to it (negative before then). Null for text that is not a real date.
 */
export function dayNumber(date: string): number | null {
  const match = DATE_PATTERN.exec(date);
  if (!match || !isDateText(date)) return null;
  return daysFromCivil(Number(match[1]), Number(match[2]), Number(match[3]));
}

/** The date with this day number, as YYYY-MM-DD. Null when it is not a whole number or falls outside the years 0 to 9999. */
export function dateOfDayNumber(day: number): string | null {
  if (!Number.isInteger(day)) return null;
  const [year, month, dayOfMonth] = civilFromDays(day);
  if (year < 0 || year > 9999) return null;
  return formatLocalDate(year, month, dayOfMonth);
}

/**
 * How many days lie from one date to another, both written as YYYY-MM-DD:
 * 0 for the same day, negative when `to` is the earlier one. Null when
 * either is not a real date.
 */
export function daysBetween(from: string, to: string): number | null {
  const start = dayNumber(from);
  const end = dayNumber(to);
  return start === null || end === null ? null : end - start;
}

/**
 * The date `days` days after (or, when negative, before) a date written as
 * YYYY-MM-DD. Text that is not a real date is returned unchanged.
 */
export function addDays(date: string, days: number): string {
  const match = DATE_PATTERN.exec(date);
  if (!match || !isDateText(date) || !Number.isFinite(days)) return date;
  const start = daysFromCivil(Number(match[1]), Number(match[2]), Number(match[3]));
  const [year, month, day] = civilFromDays(start + Math.trunc(days));
  if (year < 0 || year > 9999) return date;
  return formatLocalDate(year, month, day);
}
