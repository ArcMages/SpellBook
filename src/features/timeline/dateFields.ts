// A date of an invented calendar, picked rather than typed: the era, the
// year, the month and the day, each in a field of its own.
//
// The month and the day may be left out (a date known to the year or to the
// month), and the year may be left empty for no date at all. What the fields
// say is put together as the text a note would hold ("1203-04-17 AE") and
// read back by the timeline engine, so that a date picked here is checked by
// the very rule that reads it from a note.

import {
  calendarDaysInMonth,
  calendarWeekday,
  eraYearOf,
  formatStoryDate,
  readStoryDate,
  runningYearOf,
  storyDateToDayNumber,
} from '../../core/timeline';
import type { StoryCalendar, StoryDate } from '../../core/timeline';

export const NO_MONTH_LABEL = '(no month)';
export const NO_DAY_LABEL = '(no day)';
export const NOT_A_DATE = 'That date does not exist in this calendar.';

/** What the four fields hold. */
export interface DateParts {
  /** The era: its place in the calendar's eras, or -1 for the "before" era. */
  readonly era: number;
  /** The year as typed; "" for none. */
  readonly year: string;
  /** The month, counted from 1; 0 for none. */
  readonly month: number;
  /** The day, counted from 1; 0 for none. */
  readonly day: number;
}

/** The fields for a date: the date's own parts, or empty fields in the calendar's latest era. */
export function datePartsOf(calendar: StoryCalendar, date: StoryDate | null): DateParts {
  if (date === null) return { era: calendar.eras.length - 1, year: '', month: 0, day: 0 };
  const own = eraYearOf(calendar, date.year);
  return {
    era: own.era,
    year: String(own.year),
    month: date.precision === 'year' ? 0 : date.month,
    day: date.precision === 'day' ? date.day : 0,
  };
}

/**
 * What the fields say, as the text a note would hold: "1203 AE",
 * "1203-04 AE" or "1203-04-17 AE"; "" when nothing was filled in. Text that
 * makes no date (a day without a month, a year that is not a number) is put
 * together all the same: reading it back then fails, which is the answer.
 */
export function datePartsText(calendar: StoryCalendar, parts: DateParts): string {
  const year = parts.year.trim();
  if (year === '' && parts.month === 0 && parts.day === 0) return '';
  const short = parts.era === -1 ? (calendar.before?.short ?? '?') : (calendar.eras[parts.era]?.short ?? '?');
  let text = year === '' ? '?' : year;
  if (parts.month > 0 || parts.day > 0) text += `-${parts.month > 0 ? String(parts.month) : '?'}`;
  if (parts.day > 0) text += `-${parts.day}`;
  return `${text} ${short}`;
}

/** How a picked date reads, with its day of the week when the calendar has a week: "Moonrise, 17 Thaw 1203 AE". */
export function describePickedDate(calendar: StoryCalendar, date: StoryDate): string {
  const day = date.precision === 'day' ? calendarWeekday(calendar, storyDateToDayNumber(date)) : '';
  return day === '' ? formatStoryDate(date) : `${day}, ${formatStoryDate(date)}`;
}

/** The fields of one date, on the page. */
export interface DateFields {
  /** What the fields say, as the text a note would hold; "" when nothing was filled in. */
  text(): string;
  /** Put the keyboard in the year field. */
  focus(): void;
}

/**
 * Draw the fields for one date.
 *
 * @param label    what the date is: "Date", "End date (optional)"
 * @param cls      a class for the group, so that the two dates of a window can be told apart
 * @param onChange called whenever the writer changes a field
 */
export function drawDateFields(
  parent: HTMLElement,
  calendar: StoryCalendar,
  label: string,
  cls: string,
  initial: StoryDate | null,
  onChange: () => void,
): DateFields {
  let parts = datePartsOf(calendar, initial);
  const group = parent.createDiv({ cls: ['spellbook-prompt-field', 'spellbook-timeline-date-fields', cls], attr: { role: 'group', 'aria-label': label } });
  group.createDiv({ cls: 'spellbook-timeline-field-label', text: label });
  const row = group.createDiv({ cls: 'spellbook-timeline-date-row' });

  const era = row.createEl('select', { cls: ['dropdown', 'spellbook-timeline-era-select'], attr: { 'aria-label': `${label}: era` } });
  const eraOption = (index: number, name: string, short: string): void => {
    const value = String(index);
    era.createEl('option', { text: `${name} (${short})`, value, attr: { value, dir: 'auto' } });
  };
  calendar.eras.forEach((entry, index) => {
    eraOption(index, entry.name, entry.short);
  });
  if (calendar.before !== null) eraOption(-1, calendar.before.name, calendar.before.short);
  era.value = String(parts.era);

  const year = row.createEl('input', {
    cls: ['spellbook-prompt-input', 'spellbook-timeline-year-input'],
    attr: { type: 'text', inputmode: 'numeric', placeholder: 'Year', 'aria-label': `${label}: year`, enterkeyhint: 'done' },
  });
  year.value = parts.year;

  const month = row.createEl('select', { cls: ['dropdown', 'spellbook-timeline-month-select'], attr: { 'aria-label': `${label}: month` } });
  month.createEl('option', { text: NO_MONTH_LABEL, value: '0', attr: { value: '0' } });
  calendar.months.forEach((entry, index) => {
    const value = String(index + 1);
    month.createEl('option', { text: entry.name, value, attr: { value, dir: 'auto' } });
  });
  month.value = String(parts.month);

  const day = row.createEl('select', { cls: ['dropdown', 'spellbook-timeline-day-select'], attr: { 'aria-label': `${label}: day` } });
  // The names of months and eras are the writer's own text: the line that reads the date out takes their direction.
  const reading = group.createDiv({ cls: 'spellbook-timeline-date-reading', attr: { dir: 'auto', 'aria-live': 'polite' } });

  /** The days the chosen month has: in the chosen year when that is a year of the era, otherwise in an ordinary year. */
  const drawDays = (): void => {
    day.empty();
    day.createEl('option', { text: NO_DAY_LABEL, value: '0', attr: { value: '0' } });
    const running = runningYearOf(calendar, parts.era, Number(parts.year.trim() === '' ? Number.NaN : parts.year));
    const count =
      parts.month === 0
        ? 0
        : running === null
          ? (calendar.months[parts.month - 1]?.days ?? 0)
          : calendarDaysInMonth(calendar, running, parts.month);
    for (let number = 1; number <= count; number++) {
      const value = String(number);
      day.createEl('option', { text: value, value, attr: { value } });
    }
    // A day the month does not have is let go of, where it can be seen.
    if (parts.day > count) parts = { ...parts, day: 0 };
    day.value = String(parts.day);
    day.disabled = parts.month === 0;
  };

  const drawReading = (): void => {
    const text = datePartsText(calendar, parts);
    const date = text === '' ? null : readStoryDate(text, calendar);
    reading.setText(text === '' ? '' : date === null ? NOT_A_DATE : describePickedDate(calendar, date));
  };

  const changed = (): void => {
    parts = {
      era: Number(era.value),
      year: year.value,
      month: Number(month.value) || 0,
      day: Number(day.value) || 0,
    };
    drawDays();
    drawReading();
    onChange();
  };
  era.addEventListener('change', changed);
  month.addEventListener('change', changed);
  day.addEventListener('change', changed);
  year.addEventListener('input', changed);

  drawDays();
  drawReading();
  return {
    text: () => datePartsText(calendar, parts),
    focus: () => {
      year.focus();
      year.select();
    },
  };
}
