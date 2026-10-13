// Day marks: a colour and a short label on a day of the calendar.
//
// They live in the project index, under one extra key:
//
//   marks:
//     2026-10-20:
//       color: red
//       label: Deadline
//
// The index may have been edited by hand or written by a newer version of the
// plugin on another device. Reading keeps what it understands and says what
// it could not read. Writing changes the one day it was asked about and hands
// everything else back exactly as it was found, understood or not.

import { isDateText } from './fromCore';

/** The key in the project index that holds the day marks. */
export const MARKS_KEY = 'marks';

/** The colours a mark can have. On screen each maps to Obsidian's own colour of that name. */
export const MARK_COLORS = ['red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'purple', 'pink'] as const;

/** One of the colour names in MARK_COLORS. */
export type MarkColor = (typeof MARK_COLORS)[number];

/** The mark on one day. */
export interface DayMark {
  /** Null when the mark has no colour, or one this version does not know. */
  readonly color: MarkColor | null;
  /** Free text in any language; "" when the mark has no label. */
  readonly label: string;
}

/** The marks of a project as read from its index. */
export interface ParsedMarks {
  /** The marks that were understood, by day (YYYY-MM-DD). */
  readonly marks: ReadonlyMap<string, DayMark>;
  /** What could not be read, in plain English. Nothing listed here was thrown away: it stays in the index. */
  readonly notes: readonly string[];
  /**
   * False when the whole "marks" value is something other than a group of
   * days. It is then left alone: setMark and removeMark refuse to replace it.
   */
  readonly writable: boolean;
}

/** What to change about a day's mark. A part that is left out stays as it is. */
export interface MarkChange {
  /** A colour to set; null to take the colour away. */
  readonly color?: MarkColor | null;
  /** A label to set; "" to take the label away. Line breaks become spaces. */
  readonly label?: string;
}

/**
 * What a change to the marks came to.
 *  - done:    `marks` is the new value to store under the index's "marks" key.
 *  - noop:    nothing to store: the mark already is as asked ("unchanged"),
 *             or there is no mark on that day to remove ("not-found").
 *  - refused: nothing to store: the day is not a real date ("invalid-date"),
 *             the colour is not one of MARK_COLORS ("invalid-color"), or the
 *             stored "marks" value is not a group of days and replacing it
 *             would throw away what is there ("unreadable").
 * `message` says the same in plain English.
 */
export type MarksEdit =
  | { readonly status: 'done'; readonly marks: Record<string, unknown> }
  | { readonly status: 'noop'; readonly reason: 'unchanged' | 'not-found'; readonly message: string }
  | {
      readonly status: 'refused';
      readonly reason: 'invalid-date' | 'invalid-color' | 'unreadable';
      readonly message: string;
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** True for one of the eight colour names, written exactly (lower case). */
export function isMarkColor(value: unknown): value is MarkColor {
  return typeof value === 'string' && (MARK_COLORS as readonly string[]).includes(value);
}

/** A stored colour as the reader takes it: capitals and spaces around the name are forgiven. */
function readColor(value: unknown): MarkColor | null {
  if (typeof value !== 'string') return null;
  const name = value.trim().toLowerCase();
  return isMarkColor(name) ? name : null;
}

/** A stored label as the reader takes it: text as it is, a number as its digits, anything else as no label. */
function readLabel(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
}

function describe(value: unknown): string {
  if (value === null || value === undefined) return 'empty';
  if (Array.isArray(value)) return 'a list';
  if (typeof value === 'object') return 'a group of properties';
  return `the ${typeof value} ${JSON.stringify(value)}`;
}

const notAGroupOfDays = (value: unknown): string =>
  `The "${MARKS_KEY}" property should be a group of days, but it is ${describe(value)}. It was left as it is.`;

/**
 * The stored value as a group of days, or null when it is something else that
 * must not be replaced. Nothing stored (or an empty list) is an empty group.
 */
function daysOf(raw: unknown): Record<string, unknown> | null {
  if (raw === undefined || raw === null) return {};
  if (Array.isArray(raw)) return raw.length === 0 ? {} : null;
  return isRecord(raw) ? raw : null;
}

/**
 * Read the value stored under the index's "marks" key.
 *
 * Never throws. A day that is not a real date, or whose mark is not a group
 * of properties, is left out of `marks` and described in `notes`; it stays in
 * the index. A colour that is not one of MARK_COLORS reads as no colour.
 */
export function parseMarks(raw: unknown): ParsedMarks {
  const days = daysOf(raw);
  if (days === null) return { marks: new Map<string, DayMark>(), notes: [notAGroupOfDays(raw)], writable: false };

  const marks = new Map<string, DayMark>();
  const notes: string[] = [];
  for (const [day, value] of Object.entries(days)) {
    if (!isDateText(day)) {
      notes.push(`"${day}" in "${MARKS_KEY}" is not a date written as YYYY-MM-DD. It was left as it is.`);
      continue;
    }
    if (!isRecord(value)) {
      notes.push(`The mark for ${day} could not be read: it is ${describe(value)}. It was left as it is.`);
      continue;
    }
    const color = readColor(value['color']);
    const stored = value['color'];
    if (color === null && stored !== undefined && stored !== null && stored !== '') {
      notes.push(`The mark for ${day} has a colour this version does not know (${describe(stored)}), so it is shown without one.`);
    }
    marks.set(day, { color, label: readLabel(value['label']) });
  }
  return { marks, notes, writable: true };
}

const invalidDate = (date: string): MarksEdit => ({
  status: 'refused',
  reason: 'invalid-date',
  message: `"${date}" is not a date written as YYYY-MM-DD.`,
});

const unreadable = (raw: unknown): MarksEdit => ({
  status: 'refused',
  reason: 'unreadable',
  message: notAGroupOfDays(raw),
});

/**
 * Put a mark on a day, or change the one that is there.
 *
 * @param raw    the value now stored under the index's "marks" key (read it again just before)
 * @param date   the day, as YYYY-MM-DD
 * @param change the colour and/or label to set; a part left out stays as it is
 *
 * Only that day's entry changes. A part of the entry that is not being
 * changed is kept exactly as stored, including a colour this version does not
 * know and any properties it has never heard of. When nothing at all is left
 * (no colour, no label, nothing else) the day's entry is removed.
 */
export function setMark(raw: unknown, date: string, change: MarkChange): MarksEdit {
  if (!isDateText(date)) return invalidDate(date);
  const { color, label } = change;
  if (color !== undefined && color !== null && !isMarkColor(color)) {
    return {
      status: 'refused',
      reason: 'invalid-color',
      message: `${describe(color)} is not one of the mark colours: ${MARK_COLORS.join(', ')}.`,
    };
  }
  const days = daysOf(raw);
  if (days === null) return unreadable(raw);

  const stored = Object.prototype.hasOwnProperty.call(days, date) ? days[date] : undefined;
  const entry: Record<string, unknown> = isRecord(stored) ? { ...stored } : {};
  if (color === null) delete entry['color'];
  else if (color !== undefined) entry['color'] = color;
  if (label !== undefined) {
    const text = label.replace(/[\r\n\u{2028}\u{2029}]+/gu, ' ').trim();
    if (text === '') delete entry['label'];
    else entry['label'] = text;
  }

  const same =
    isRecord(stored) &&
    Object.keys(stored).length === Object.keys(entry).length &&
    stored['color'] === entry['color'] &&
    stored['label'] === entry['label'];
  const nothingLeft = Object.keys(entry).length === 0;
  // An empty change never removes something that could not be read.
  if (same || (nothingLeft && !isRecord(stored))) {
    return { status: 'noop', reason: 'unchanged', message: `The mark for ${date} is already like that.` };
  }

  const marks: Record<string, unknown> = { ...days };
  if (nothingLeft) delete marks[date];
  else marks[date] = entry;
  return { status: 'done', marks };
}

/**
 * Take the mark off a day.
 *
 * @param raw  the value now stored under the index's "marks" key (read it again just before)
 * @param date the day, as YYYY-MM-DD
 *
 * Only that day's entry goes; every other entry is handed back as it was.
 */
export function removeMark(raw: unknown, date: string): MarksEdit {
  if (!isDateText(date)) return invalidDate(date);
  const days = daysOf(raw);
  if (days === null) return unreadable(raw);
  if (!Object.prototype.hasOwnProperty.call(days, date)) {
    return { status: 'noop', reason: 'not-found', message: `There is no mark on ${date}.` };
  }
  const marks: Record<string, unknown> = { ...days };
  delete marks[date];
  return { status: 'done', marks };
}
