// Reading the properties of a scene note.
//
// The properties may have been typed by hand or written by another device,
// so every reader here is forgiving: it takes what it understands, falls back
// to a sensible value for the rest, and says in plain words what it could not
// read. Nothing here throws, and nothing here writes.

import { isDateText, tidyDisplayName } from './coreImports';
import type { Frontmatter } from './coreImports';

/** The largest target a scene can be given, in words. Anything above it is taken for a slip of the finger. */
export const MAX_TARGET = 10000000;

/** What the cards and the inspector need from a scene's properties. */
export interface SceneFields {
  /** The synopsis exactly as stored; "" when there is none. */
  readonly synopsis: string;
  /** The status name with tidy spacing; null when the scene has none. */
  readonly status: string | null;
  /** The label name with tidy spacing; null when the scene has none. */
  readonly label: string | null;
  /** The word target, a whole number of at least 1; null when none is set. */
  readonly target: number | null;
  /** Whether the scene goes into the compiled manuscript. True unless the scene says otherwise. */
  readonly compile: boolean;
  /** The date the scene was created, as YYYY-MM-DD; null when not known. */
  readonly created: string | null;
  /** The date the scene was last edited, as YYYY-MM-DD; null when not known. */
  readonly edited: string | null;
  /** Properties that could not be understood, each described in a plain sentence. */
  readonly problems: readonly string[];
}

function describe(value: unknown): string {
  if (Array.isArray(value)) return 'a list';
  if (typeof value === 'object') return 'a group of properties';
  if (typeof value === 'string') return `"${value}"`;
  return String(value);
}

/** A reading of one property: the value, and whether what was stored made no sense. */
interface Reading<T> {
  readonly value: T;
  readonly odd: boolean;
}

const understood = <T>(value: T): Reading<T> => ({ value, odd: false });
const notUnderstood = <T>(fallback: T): Reading<T> => ({ value: fallback, odd: true });

/**
 * Read a status or label name. Text is taken with tidy spacing, and a number
 * as its digits (an unquoted "1984" in the properties is a number). Empty
 * means none.
 */
export function readName(value: unknown): Reading<string | null> {
  if (value === undefined || value === null) return understood(null);
  if (typeof value === 'string') {
    const name = tidyDisplayName(value);
    return understood(name === '' ? null : name);
  }
  if (typeof value === 'number' && Number.isFinite(value)) return understood(String(value));
  return notUnderstood(null);
}

function readSynopsis(value: unknown): Reading<string> {
  if (value === undefined || value === null) return understood('');
  if (typeof value === 'string') return understood(value);
  if (typeof value === 'number' && Number.isFinite(value)) return understood(String(value));
  return notUnderstood('');
}

/**
 * Read a target typed as text: digits, with or without commas between the
 * thousands ("1500", "1,500"). Returns the number, null for "no target"
 * (nothing typed, or zero), or 'invalid'.
 */
export function parseTargetText(text: string): number | null | 'invalid' {
  const typed = text.trim();
  if (typed === '') return null;
  let digits: string;
  if (/^\d+$/.test(typed)) digits = typed;
  else if (/^\d{1,3}(,\d{3})+$/.test(typed)) digits = typed.split(',').join('');
  else return 'invalid';
  const value = Number(digits);
  if (!Number.isFinite(value) || value > MAX_TARGET) return 'invalid';
  return value === 0 ? null : value;
}

function readTarget(value: unknown): Reading<number | null> {
  if (value === undefined || value === null) return understood(null);
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0 || value > MAX_TARGET) return notUnderstood(null);
    const whole = Math.round(value);
    return understood(whole === 0 ? null : whole);
  }
  if (typeof value === 'string') {
    const parsed = parseTargetText(value);
    return parsed === 'invalid' ? notUnderstood(null) : understood(parsed);
  }
  return notUnderstood(null);
}

const YES = new Set(['true', 'yes', 'y', 'on']);
const NO = new Set(['false', 'no', 'n', 'off']);

function readCompile(value: unknown): Reading<boolean> {
  if (value === undefined || value === null) return understood(true);
  if (typeof value === 'boolean') return understood(value);
  if (typeof value === 'string') {
    const word = value.trim().toLowerCase();
    if (word === '' || YES.has(word)) return understood(true);
    if (NO.has(word)) return understood(false);
    return notUnderstood(true);
  }
  if (value === 1) return understood(true);
  if (value === 0) return understood(false);
  return notUnderstood(true);
}

function readDate(value: unknown): Reading<string | null> {
  if (value === undefined || value === null) return understood(null);
  if (typeof value !== 'string') return notUnderstood(null);
  const text = value.trim();
  if (text === '') return understood(null);
  // A date, or a date followed by a time of day ("2026-10-13T08:30").
  const day = text.slice(0, 10);
  const rest = text.charAt(10);
  if (isDateText(day) && (rest === '' || rest === 'T' || rest === ' ')) return understood(day);
  return notUnderstood(null);
}

/**
 * Read a scene's properties. Never throws: a property that is missing or
 * makes no sense gets its usual value (no synopsis, no status, no label, no
 * target, included in compile, no date) and, when it made no sense, a line in
 * `problems`.
 */
export function readSceneFields(frontmatter: Readonly<Frontmatter> | null | undefined): SceneFields {
  const source: Readonly<Frontmatter> =
    typeof frontmatter === 'object' && frontmatter !== null && !Array.isArray(frontmatter) ? frontmatter : {};
  const problems: string[] = [];
  const take = <T>(key: string, reading: Reading<T>, expected: string): T => {
    if (reading.odd) {
      problems.push(`The "${key}" property should be ${expected}, but it is ${describe(source[key])}. It is left as it is.`);
    }
    return reading.value;
  };
  return {
    synopsis: take('synopsis', readSynopsis(source['synopsis']), 'text'),
    status: take('status', readName(source['status']), 'text'),
    label: take('label', readName(source['label']), 'text'),
    target: take('target', readTarget(source['target']), 'a whole number of words'),
    compile: take('compile', readCompile(source['compile']), 'yes or no'),
    created: take('created', readDate(source['created']), 'a date written as YYYY-MM-DD'),
    edited: take('edited', readDate(source['edited']), 'a date written as YYYY-MM-DD'),
    problems,
  };
}

/** True when a scene has a synopsis of its own, so that no preview has to be made from its text. */
export function hasSynopsis(frontmatter: Readonly<Frontmatter> | null | undefined): boolean {
  return readSceneFields(frontmatter).synopsis.trim() !== '';
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

/**
 * A date as the inspector shows it: "13 Oct 2026" for "2026-10-13". Text that
 * is not a real date gives "". Worked out from the digits alone, so the
 * device's time zone plays no part.
 */
export function formatDisplayDate(date: string | null | undefined): string {
  if (typeof date !== 'string' || !isDateText(date)) return '';
  const year = Number(date.slice(0, 4));
  const month = MONTHS[Number(date.slice(5, 7)) - 1];
  const day = Number(date.slice(8, 10));
  return month === undefined ? '' : `${day} ${month} ${year}`;
}
