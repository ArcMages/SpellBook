// The daily word log, as it is kept in the vault.
//
// Every device writes its own file for each month, so that two devices never
// write the same file:
//
//   <Project>/Stats/2026-10 k3x9q2ab.md
//
//   ---
//   spellbook: stats
//   device: "k3x9q2ab"
//   deviceName: "Dana's iPhone"
//   month: "2026-10"
//   ---
//
//   | Date | Manuscript added | Manuscript deleted | Other added | Other deleted |
//   | --- | ---: | ---: | ---: | ---: |
//   | 2026-10-13 | 1200 | 30 | 45 | 0 |
//
// One row per day that had activity; a day with nothing is not stored.
//
// The file may have been edited by hand, cut short by a sync, or written by a
// newer version of the plugin. So reading never throws: it keeps what it
// understands and reports the rest. And writing never loses anything: lines
// and table cells that were not understood are put back exactly as they were.

import { isDateText } from './../dates';
import { baseName, isMarkdownPath, joinPath } from './../paths';
import { INDEX_MARKER_KEY } from './../projectIndex';
import { isMonthText, monthOf } from './calendar';

/** The folder of a project that holds its daily word logs. */
export const STATS_FOLDER = 'Stats';

/** What the "spellbook" property of a daily log file says. */
export const STATS_MARKER_VALUE = 'stats';

const DEVICE_KEY = 'device';
const DEVICE_NAME_KEY = 'deviceName';
const MONTH_KEY = 'month';

const HEADER_CELLS = ['Date', 'Manuscript added', 'Manuscript deleted', 'Other added', 'Other deleted'] as const;
/** The cells of a row this version understands: the date and four counts. */
const KNOWN_CELLS = HEADER_CELLS.length;

const DEVICE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const DEVICE_ID_LETTERS = 'abcdefghijklmnopqrstuvwxyz0123456789';
const DEVICE_ID_LENGTH = 8;

// ------------------------------------------------------------------- the model

/** The four numbers kept for one day: words added and deleted, in the manuscript and in other notes. */
export interface DayCounts {
  readonly manuscriptAdded: number;
  readonly manuscriptDeleted: number;
  readonly otherAdded: number;
  readonly otherDeleted: number;
}

/** A day on which nothing was written. */
export const NO_WORDS: DayCounts = Object.freeze({
  manuscriptAdded: 0,
  manuscriptDeleted: 0,
  otherAdded: 0,
  otherDeleted: 0,
});

/** One row of a daily log: a date and its four numbers. */
export interface StatsDay extends DayCounts {
  /** The day, as YYYY-MM-DD. */
  readonly date: string;
  /** Cells of columns this version does not know, exactly as found; kept on every write. */
  readonly extraCells?: readonly string[];
}

/** Which device and month a daily log file belongs to. */
export interface StatsIdentity {
  /** The device's id: letters, digits, "-" and "_" (see isDeviceId). */
  readonly device: string;
  /** The device's name as the writer knows it, in any language. */
  readonly deviceName: string;
  /** The month, as YYYY-MM. */
  readonly month: string;
}

/** What kind of thing could not be read in a daily log file. */
export type StatsProblemKind = 'unreadable-row' | 'duplicate-date' | 'other-month' | 'not-stats' | 'properties';

/** Something in a daily log file that could not be read as expected. Nothing is lost because of it. */
export interface StatsProblem {
  readonly kind: StatsProblemKind;
  /** The line it is about, counted from 1; null when it is about the file as a whole. */
  readonly line: number | null;
  /** That line, exactly as found ("" when it is about the file as a whole). */
  readonly text: string;
  /** What is wrong, in plain English. */
  readonly message: string;
}

/**
 * The parts of a daily log file that were not understood. They are written
 * back exactly as they were found. Treat this as sealed: pass it along, do
 * not build or change it.
 */
export interface StatsKept {
  /** The lines of the properties block, without its two "---" lines; null when the file has none. */
  readonly properties: readonly string[] | null;
  /** Lines of text found above the table. */
  readonly before: readonly string[];
  /** Table rows that could not be read. */
  readonly rows: readonly string[];
  /** Lines of text found below (or in between) the table rows. */
  readonly after: readonly string[];
  /** Header cells of columns this version does not know. */
  readonly headerExtra: readonly string[];
  /** The line ending the file uses. */
  readonly lineEnd: '\n' | '\r\n';
}

/** A daily log file, read into memory. Treated as immutable. */
export interface StatsFile extends StatsIdentity {
  /** The days that had activity, sorted by date, one entry per date. */
  readonly days: readonly StatsDay[];
  /** What could not be read as expected. Empty for a tidy file. */
  readonly problems: readonly StatsProblem[];
  /** What was not understood, kept so that writing the file back loses nothing. */
  readonly kept: StatsKept;
}

/** A change to one day of a daily log: numbers to add to its row (negative numbers take away). */
export interface StatsChange {
  /** The day, as YYYY-MM-DD. */
  readonly date: string;
  readonly counts: Partial<DayCounts>;
}

/** What updateStatsText decided. */
export type StatsUpdate =
  /** Save `text` as the whole file (create the file when it does not exist yet). */
  | { readonly status: 'write'; readonly text: string; readonly file: StatsFile }
  /** Nothing needs saving. */
  | { readonly status: 'unchanged' }
  /** The file must not be written; `reason` says why, in plain English. */
  | { readonly status: 'refused'; readonly reason: string };

const COUNT_KEYS = ['manuscriptAdded', 'manuscriptDeleted', 'otherAdded', 'otherDeleted'] as const;

// ------------------------------------------------------------------ file names

/** True for a usable device id: 1 to 64 letters, digits, "-" or "_", starting with a letter or digit. */
export function isDeviceId(text: string): boolean {
  return DEVICE_ID_PATTERN.test(text);
}

/**
 * A new device id: eight lower-case letters and digits.
 *
 * @param random a source of random numbers from 0 up to (not including) 1
 */
export function newDeviceId(random: () => number): string {
  let id = '';
  for (let i = 0; i < DEVICE_ID_LENGTH; i++) {
    const roll = random();
    const index = Number.isFinite(roll) ? Math.floor(roll * DEVICE_ID_LETTERS.length) : 0;
    id += DEVICE_ID_LETTERS[Math.min(DEVICE_ID_LETTERS.length - 1, Math.max(0, index))] ?? 'a';
  }
  return id;
}

/**
 * The name of a device's daily log file for a month, for example
 * "2026-10 k3x9q2ab.md". Null when the month or the device id is not valid.
 */
export function statsFileName(month: string, device: string): string | null {
  if (!isMonthText(month) || !isDeviceId(device)) return null;
  return `${month} ${device}.md`;
}

/**
 * Read a daily log file's name (or whole path) back into its month and device
 * id. Null for any other file, including the "name 2.md" copies a sync
 * conflict leaves behind.
 */
export function parseStatsFileName(nameOrPath: string): { readonly month: string; readonly device: string } | null {
  const name = baseName(nameOrPath);
  if (!isMarkdownPath(name)) return null;
  const stem = name.slice(0, -3);
  const month = stem.slice(0, 7);
  const device = stem.slice(8);
  if (stem[7] !== ' ' || !isMonthText(month) || !isDeviceId(device)) return null;
  return { month, device };
}

/**
 * The vault path of the daily log file that holds a given day, for one
 * device: "<project>/Stats/<YYYY-MM> <device>.md". Null when the date or the
 * device id is not valid.
 *
 * @param projectFolder the project folder's vault path ("" for a project at the top of the vault)
 * @param date          the day, as YYYY-MM-DD
 */
export function statsFilePath(projectFolder: string, date: string, device: string): string | null {
  const month = monthOf(date);
  const name = month === null ? null : statsFileName(month, device);
  return name === null ? null : joinPath(projectFolder, STATS_FOLDER, name);
}

// ------------------------------------------------------- the properties block

const isFence = (line: string): boolean => line.replace(/[ \t\r]+$/, '') === '---';

/** Read "\uXXXX"-style hexadecimal digits; null when they are not all there. */
function readHex(text: string, start: number, length: number): string | null {
  const digits = text.slice(start, start + length);
  if (digits.length !== length || !/^[0-9a-fA-F]+$/.test(digits)) return null;
  const code = Number.parseInt(digits, 16);
  return code <= 0x10ffff ? String.fromCodePoint(code) : null;
}

const SIMPLE_ESCAPES: Readonly<Record<string, string>> = {
  n: '\n',
  t: '\t',
  r: '\r',
  '0': '\0',
  '"': '"',
  '\\': '\\',
  '/': '/',
  ' ': ' ',
};

/** The text of a YAML value written in double quotes. A missing closing quote is forgiven. */
function readDoubleQuoted(text: string): string {
  let out = '';
  for (let i = 1; i < text.length; i++) {
    const character = text[i] as string;
    if (character === '"') break;
    if (character !== '\\' || i + 1 >= text.length) {
      out += character;
      continue;
    }
    const next = text[i + 1] as string;
    i++;
    const simple = SIMPLE_ESCAPES[next];
    if (simple !== undefined) {
      out += simple;
      continue;
    }
    const length = next === 'x' ? 2 : next === 'u' ? 4 : next === 'U' ? 8 : 0;
    const decoded = length > 0 ? readHex(text, i + 1, length) : null;
    if (decoded === null) {
      out += next;
    } else {
      out += decoded;
      i += length;
    }
  }
  return out;
}

/** The text of a YAML value written in single quotes ('' stands for one quote). */
function readSingleQuoted(text: string): string {
  let out = '';
  for (let i = 1; i < text.length; i++) {
    const character = text[i] as string;
    if (character !== "'") {
      out += character;
    } else if (text[i + 1] === "'") {
      out += "'";
      i++;
    } else {
      break;
    }
  }
  return out;
}

/** The text of a simple YAML value; null when it is empty. */
function readScalar(raw: string): string | null {
  const text = raw.trim();
  if (text === '' || text === '~' || text === 'null') return null;
  if (text.startsWith('"')) return readDoubleQuoted(text);
  if (text.startsWith("'")) return readSingleQuoted(text);
  const comment = text.search(/[ \t]#/);
  return (comment < 0 ? text : text.slice(0, comment)).trim();
}

/** A YAML value in double quotes, safe for any text in any language. */
function writeScalar(text: string): string {
  let out = '"';
  for (const character of text) {
    const code = character.codePointAt(0) as number;
    if (character === '\\') out += '\\\\';
    else if (character === '"') out += '\\"';
    else if (character === '\n') out += '\\n';
    else if (character === '\r') out += '\\r';
    else if (character === '\t') out += '\\t';
    else if (code < 0x20 || code === 0x7f || code === 0x85 || code === 0x2028 || code === 0x2029 || code === 0xfeff) {
      out += `\\u${code.toString(16).padStart(4, '0')}`;
    } else out += character;
  }
  return `${out}"`;
}

interface FoundProperty {
  /** Its line within the block. */
  readonly index: number;
  /** Its value; null when empty or when it is not a simple value. */
  readonly value: string | null;
  /** True when the value runs over the following lines (a list, a group, a text block). */
  readonly nested: boolean;
}

/** Find a top-level property of the block by its name. */
function findProperty(lines: readonly string[], key: string): FoundProperty | null {
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index] as string;
    if (!line.startsWith(key)) continue;
    const match = /^[ \t]*:[ \t]*(.*)$/.exec(line.slice(key.length));
    if (!match) continue;
    const next = lines[index + 1];
    const rest = (match[1] ?? '').trim();
    const nested = next !== undefined && (/^[ \t]+\S/.test(next) || (rest === '' && next.startsWith('-')));
    return { index, value: nested ? null : readScalar(rest), nested };
  }
  return null;
}

/** The properties block of a file, brought up to date with the model. Lines that already say the right thing are untouched. */
function propertyLines(file: StatsFile): string[] {
  const lines = file.kept.properties === null ? [] : [...file.kept.properties];

  const marker = findProperty(lines, INDEX_MARKER_KEY);
  if (!marker) {
    lines.splice(0, 0, `${INDEX_MARKER_KEY}: ${STATS_MARKER_VALUE}`);
  } else if (!marker.nested && marker.value === null) {
    lines[marker.index] = `${INDEX_MARKER_KEY}: ${STATS_MARKER_VALUE}`;
  }
  // A marker that says something else is left alone: such a file is never claimed.

  const wanted: ReadonlyArray<readonly [string, string]> = [
    [DEVICE_KEY, file.device],
    [DEVICE_NAME_KEY, file.deviceName],
    [MONTH_KEY, file.month],
  ];
  for (const [key, value] of wanted) {
    // Nothing is known about it: whatever the file says stays.
    if (value === '') continue;
    const found = findProperty(lines, key);
    if (!found) {
      lines.push(`${key}: ${writeScalar(value)}`);
    } else if (!found.nested && found.value !== value) {
      lines[found.index] = `${key}: ${writeScalar(value)}`;
    }
  }
  return lines;
}

// ------------------------------------------------------------------ the table

/**
 * The cells of a table row, exactly as written between the bars. Null when
 * the line is not a table row. A bar written as "\|" does not end a cell.
 */
function splitRow(line: string): string[] | null {
  const text = line.trim();
  if (!text.startsWith('|')) return null;
  const cells: string[] = [];
  let cell = '';
  for (let i = 1; i < text.length; i++) {
    const character = text[i] as string;
    if (character === '\\' && i + 1 < text.length) {
      cell += character + (text[i + 1] as string);
      i++;
    } else if (character === '|') {
      cells.push(cell);
      cell = '';
    } else {
      cell += character;
    }
  }
  // A row that was not closed with a bar still has a last cell.
  if (cell.trim() !== '') cells.push(cell);
  return cells;
}

const isHeaderRow = (cells: readonly string[]): boolean =>
  cells.length >= KNOWN_CELLS && (cells[0] ?? '').trim().toLowerCase() === 'date';

const isSeparatorRow = (cells: readonly string[]): boolean =>
  cells.length > 0 && cells.every((cell) => /^:?-+:?$/.test(cell.trim()));

/** A count as written in a cell: a whole number, with or without thousands commas. An empty cell is 0. */
function readCount(cell: string): number | null {
  const text = cell.trim();
  if (text === '') return 0;
  if (!/^\d+$/.test(text) && !/^\d{1,3}(?:,\d{3})+$/.test(text)) return null;
  const value = Number(text.replace(/,/g, ''));
  return Number.isSafeInteger(value) ? value : null;
}

function readDay(cells: readonly string[]): StatsDay | null {
  if (cells.length < KNOWN_CELLS) return null;
  const date = (cells[0] ?? '').trim();
  if (!isDateText(date)) return null;
  const counts: number[] = [];
  for (let index = 1; index < KNOWN_CELLS; index++) {
    const count = readCount(cells[index] ?? '');
    if (count === null) return null;
    counts.push(count);
  }
  const day = {
    date,
    manuscriptAdded: counts[0] ?? 0,
    manuscriptDeleted: counts[1] ?? 0,
    otherAdded: counts[2] ?? 0,
    otherDeleted: counts[3] ?? 0,
  };
  return cells.length > KNOWN_CELLS ? { ...day, extraCells: cells.slice(KNOWN_CELLS) } : day;
}

const hasWords = (counts: DayCounts): boolean => COUNT_KEYS.some((key) => counts[key] > 0);

const hasExtraCells = (day: StatsDay): boolean => (day.extraCells?.length ?? 0) > 0;

const byDate = (a: StatsDay, b: StatsDay): number => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0);

function trimBlankEnd(lines: string[]): void {
  while (lines.length > 0 && (lines[lines.length - 1] as string).trim() === '') lines.pop();
}

const EMPTY_KEPT: StatsKept = Object.freeze({
  properties: null,
  before: [],
  rows: [],
  after: [],
  headerExtra: [],
  lineEnd: '\n',
});

// --------------------------------------------------------------------- reading

/**
 * Read the whole text of a daily log file. Never throws: rows that cannot be
 * read are kept as they are and listed under `problems`.
 *
 * Two rows for the same date are read as one, taking the larger of each
 * number (a day's numbers only grow, so the larger one is the later one).
 *
 * @param text     the file's text, properties block included
 * @param fileName the file's name or path; used for the device and month when the properties do not say
 */
export function parseStatsFile(text: string, fileName?: string): StatsFile {
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  // The first line break tells which kind the file uses.
  const firstBreak = source.indexOf('\n');
  const lineEnd = firstBreak > 0 && source[firstBreak - 1] === '\r' ? '\r\n' : '\n';
  const lines =
    lineEnd === '\n'
      ? source.split('\n')
      : source.split('\n').map((line) => (line.endsWith('\r') ? line.slice(0, -1) : line));
  // Text that ends with a line break has one empty piece after it: not a line.
  if (lines[lines.length - 1] === '') lines.pop();

  const problems: StatsProblem[] = [];

  let properties: string[] | null = null;
  let bodyStart = 0;
  if (lines.length > 0 && isFence(lines[0] as string)) {
    for (let i = 1; i < lines.length; i++) {
      if (!isFence(lines[i] as string)) continue;
      properties = lines.slice(1, i);
      bodyStart = i + 1;
      break;
    }
  }

  let device = '';
  let deviceName = '';
  let month = '';
  if (properties === null) {
    problems.push({
      kind: 'properties',
      line: null,
      text: '',
      message: 'The file has no properties block, so it does not say which device and month it belongs to.',
    });
  } else {
    const marker = findProperty(properties, INDEX_MARKER_KEY);
    if (!marker || marker.value === null) {
      problems.push({
        kind: 'properties',
        line: null,
        text: '',
        message: `The properties do not say "${INDEX_MARKER_KEY}: ${STATS_MARKER_VALUE}".`,
      });
    } else if (marker.value !== STATS_MARKER_VALUE) {
      problems.push({
        kind: 'not-stats',
        line: marker.index + 2,
        text: properties[marker.index] ?? '',
        message: `The properties say this note is "${marker.value}", not a Spellbook word log.`,
      });
    }
    device = findProperty(properties, DEVICE_KEY)?.value ?? '';
    deviceName = findProperty(properties, DEVICE_NAME_KEY)?.value ?? '';
    const foundMonth = findProperty(properties, MONTH_KEY);
    month = foundMonth?.value ?? '';
    if (foundMonth && month !== '' && !isMonthText(month)) {
      problems.push({
        kind: 'properties',
        line: foundMonth.index + 2,
        text: properties[foundMonth.index] ?? '',
        message: `The month should be written as YYYY-MM, but it is "${month}".`,
      });
    }
  }
  const named = fileName === undefined ? null : parseStatsFileName(fileName);
  if (named) {
    if (device === '') device = named.device;
    if (month === '') month = named.month;
  }

  const before: string[] = [];
  const after: string[] = [];
  const rows: string[] = [];
  let headerExtra: string[] = [];
  let sawTable = false;
  let sawHeader = false;
  let lastRowKept = false;
  const days = new Map<string, StatsDay>();
  const lineOfDate = new Map<string, number>();

  for (let i = bodyStart; i < lines.length; i++) {
    const line = lines[i] as string;
    const cells = splitRow(line);
    if (cells === null) {
      lastRowKept = false;
      const block = sawTable ? after : before;
      // Blank lines before the first words are spacing, not content.
      if (line.trim() !== '' || block.length > 0) block.push(line);
      continue;
    }
    sawTable = true;
    if (isHeaderRow(cells)) {
      if (!sawHeader) headerExtra = cells.slice(KNOWN_CELLS);
      sawHeader = true;
      lastRowKept = false;
      continue;
    }
    if (isSeparatorRow(cells)) {
      // The rule under a heading row that was not understood stays with it.
      if (lastRowKept) rows.push(line);
      continue;
    }
    const day = readDay(cells);
    if (day === null) {
      rows.push(line);
      lastRowKept = true;
      problems.push({
        kind: 'unreadable-row',
        line: i + 1,
        text: line,
        message:
          'This row could not be read. A row needs a date written as YYYY-MM-DD and four whole numbers. It is kept as it is.',
      });
      continue;
    }
    lastRowKept = false;
    const earlier = days.get(day.date);
    if (!earlier) {
      days.set(day.date, day);
      lineOfDate.set(day.date, i + 1);
      continue;
    }
    if (hasExtraCells(earlier) || hasExtraCells(day)) {
      // Cells of unknown columns cannot be merged: the second row stays as it is.
      rows.push(line);
      lastRowKept = true;
      problems.push({
        kind: 'duplicate-date',
        line: i + 1,
        text: line,
        message: `There is more than one row for ${day.date}. This one is kept as it is and not counted.`,
      });
      continue;
    }
    days.set(day.date, {
      date: day.date,
      manuscriptAdded: Math.max(earlier.manuscriptAdded, day.manuscriptAdded),
      manuscriptDeleted: Math.max(earlier.manuscriptDeleted, day.manuscriptDeleted),
      otherAdded: Math.max(earlier.otherAdded, day.otherAdded),
      otherDeleted: Math.max(earlier.otherDeleted, day.otherDeleted),
    });
    problems.push({
      kind: 'duplicate-date',
      line: i + 1,
      text: line,
      message: `There is more than one row for ${day.date}. They were read as one row, with the larger of each number.`,
    });
  }
  trimBlankEnd(before);
  trimBlankEnd(after);

  const sorted = [...days.values()].sort(byDate);
  if (isMonthText(month)) {
    for (const day of sorted) {
      if (monthOf(day.date) === month) continue;
      problems.push({
        kind: 'other-month',
        line: lineOfDate.get(day.date) ?? null,
        text: lines[(lineOfDate.get(day.date) ?? 0) - 1] ?? '',
        message: `The row for ${day.date} is in the file for ${month}. It is still counted.`,
      });
    }
  }

  return {
    device,
    deviceName,
    month,
    days: sorted,
    problems,
    kept: { properties, before, rows, after, headerExtra, lineEnd },
  };
}

// --------------------------------------------------------------------- writing

/** An empty daily log for a device and a month. */
export function newStatsFile(identity: StatsIdentity): StatsFile {
  return {
    device: identity.device,
    deviceName: identity.deviceName,
    month: identity.month,
    days: [],
    problems: [],
    kept: EMPTY_KEPT,
  };
}

function rowLine(day: StatsDay): string {
  const known = [day.date, ...COUNT_KEYS.map((key) => String(day[key]))].join(' | ');
  return `| ${known} |${(day.extraCells ?? []).map((cell) => `${cell}|`).join('')}`;
}

/**
 * The whole text of a daily log file: the properties block, then one table
 * with its rows sorted by date. Everything that was not understood when the
 * file was read is written back as it was: unknown properties, text above
 * and below the table, rows that could not be read, and cells of unknown
 * columns. A day with four zeros is left out.
 */
export function serialiseStatsFile(file: StatsFile): string {
  const { kept } = file;
  const lines: string[] = ['---', ...propertyLines(file), '---', ''];
  if (kept.before.length > 0) lines.push(...kept.before, '');
  lines.push(`| ${HEADER_CELLS.join(' | ')} |${kept.headerExtra.map((cell) => `${cell}|`).join('')}`);
  lines.push(`| --- | ---: | ---: | ---: | ---: |${kept.headerExtra.map(() => ' --- |').join('')}`);
  for (const day of [...file.days].sort(byDate)) {
    if (hasWords(day) || hasExtraCells(day)) lines.push(rowLine(day));
  }
  lines.push(...kept.rows);
  if (kept.after.length > 0) lines.push('', ...kept.after);
  return lines.join(kept.lineEnd) + kept.lineEnd;
}

/** A number of words to add: a whole number, or 0 for anything else. */
function wholeNumber(value: number | undefined): number {
  return value !== undefined && Number.isFinite(value) ? Math.trunc(value) : 0;
}

/**
 * Add numbers to one day of a daily log. Negative numbers take away, and no
 * number of a day ever goes below zero. A day that ends up with four zeros is
 * removed. Every other day, and everything else in the file, stays as it is.
 *
 * Returns the same object when nothing changed (also for a date that is not
 * a real date).
 */
export function applyDayChange(file: StatsFile, date: string, change: Partial<DayCounts>): StatsFile {
  if (!isDateText(date)) return file;
  const current = file.days.find((day) => day.date === date);
  const base: DayCounts = current ?? NO_WORDS;
  const next = {
    manuscriptAdded: Math.max(0, base.manuscriptAdded + wholeNumber(change.manuscriptAdded)),
    manuscriptDeleted: Math.max(0, base.manuscriptDeleted + wholeNumber(change.manuscriptDeleted)),
    otherAdded: Math.max(0, base.otherAdded + wholeNumber(change.otherAdded)),
    otherDeleted: Math.max(0, base.otherDeleted + wholeNumber(change.otherDeleted)),
  };
  if (COUNT_KEYS.every((key) => next[key] === base[key])) return file;

  const others = file.days.filter((day) => day.date !== date);
  const extraCells = current?.extraCells;
  const keepsRow = hasWords(next) || (extraCells?.length ?? 0) > 0;
  const day: StatsDay = extraCells ? { date, ...next, extraCells } : { date, ...next };
  return { ...file, days: keepsRow ? [...others, day].sort(byDate) : others };
}

/**
 * The one step a save needs: take the file's text as it is on disk right now
 * (null when there is no file yet), add the given numbers, and get back the
 * text to save.
 *
 * It refuses, without changing anything, when the file on disk belongs to
 * another device or another month, when its properties say it is not a word
 * log, or when a change is for a day outside the month.
 *
 * @param text     the file's current text, or null when the file does not exist
 * @param identity this device and the month of the file
 * @param changes  numbers to add, per day
 */
export function updateStatsText(
  text: string | null,
  identity: StatsIdentity,
  changes: readonly StatsChange[],
): StatsUpdate {
  if (!isDeviceId(identity.device)) {
    return { status: 'refused', reason: `"${identity.device}" is not a usable device id.` };
  }
  if (!isMonthText(identity.month)) {
    return { status: 'refused', reason: `"${identity.month}" is not a month written as YYYY-MM.` };
  }
  for (const change of changes) {
    if (monthOf(change.date) !== identity.month) {
      return { status: 'refused', reason: `${change.date} is not a day of ${identity.month}.` };
    }
  }

  const existing = text === null ? null : parseStatsFile(text);
  if (existing) {
    if (existing.problems.some((problem) => problem.kind === 'not-stats')) {
      return { status: 'refused', reason: 'The note at this path says it is something other than a Spellbook word log.' };
    }
    if (existing.device !== '' && existing.device !== identity.device) {
      return { status: 'refused', reason: `This word log belongs to another device ("${existing.device}").` };
    }
    if (existing.month !== '' && existing.month !== identity.month) {
      return { status: 'refused', reason: `This word log is for another month ("${existing.month}").` };
    }
  }

  const start = existing ?? newStatsFile(identity);
  let next = start;
  for (const change of changes) next = applyDayChange(next, change.date, change.counts);
  // No day changed: the file is left exactly as it is (and is not created just to hold an empty table).
  if (next === start) return { status: 'unchanged' };

  // The file is being saved anyway, so its properties are brought up to date:
  // a missing device or month is filled in, and a new device name replaces the old one.
  next = {
    ...next,
    device: identity.device,
    deviceName: identity.deviceName !== '' ? identity.deviceName : next.deviceName,
    month: identity.month,
  };
  return { status: 'write', text: serialiseStatsFile(next), file: next };
}
