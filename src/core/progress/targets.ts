// Word targets, and how far along the writer is.
//
// The project index holds them under one extra key:
//
//   targets:
//     project: 80000        words the whole manuscript should reach
//     daily: 500            words to write each day
//     deadline: 2026-12-31  the day the project target should be reached
//
// Every part is optional. The value may have been typed by hand, so reading
// it never throws; what cannot be understood reads as "no target" and is
// reported. Writing keeps every part it was not asked to change, including
// parts this version does not know.

import { isDateText } from './../dates';
import { daysBetween, readDateProperty } from './calendar';

/** The key of the project index that holds the targets. */
export const TARGETS_KEY = 'targets';

/** A target is refused above this many words: such a number is a slip of the hand. */
export const MAX_TARGET_WORDS = 100000000;

/** The targets of a project. Null means "not set". */
export interface Targets {
  /** Words the whole manuscript should reach. */
  readonly project: number | null;
  /** Words to write each day. */
  readonly daily: number | null;
  /** The day the project target should be reached, as YYYY-MM-DD. */
  readonly deadline: string | null;
}

/** No targets at all. */
export const NO_TARGETS: Targets = Object.freeze({ project: null, daily: null, deadline: null });

/** Targets as read from the index, with what could not be understood. */
export interface ParsedTargets {
  readonly targets: Targets;
  /** What could not be understood, in plain English. Empty for a tidy value. */
  readonly problems: readonly string[];
}

/** What the writer typed into the targets form; text or numbers, empty for "no target". */
export interface TargetsInput {
  readonly project?: unknown;
  readonly daily?: unknown;
  readonly deadline?: unknown;
}

/** The result of checking a targets form. */
export type TargetsValidation =
  | { readonly ok: true; readonly targets: Targets }
  | {
      readonly ok: false;
      /** One message per field that is wrong, in plain English. */
      readonly errors: { readonly project?: string; readonly daily?: string; readonly deadline?: string };
    };

/**
 * A change to the targets: a new value, null to remove a target, or left out
 * to keep it. Null never removes a stored value that could not be read.
 */
export interface TargetsChange {
  readonly project?: number | null;
  readonly daily?: number | null;
  readonly deadline?: string | null;
}

/** How far along a word target is. */
export interface TargetProgress {
  /** The words so far. */
  readonly words: number;
  readonly target: number;
  /** Whole percent of the target reached, rounded down; more than 100 once the target is passed. */
  readonly percent: number;
  /** Words still to go; 0 once the target is reached. */
  readonly remaining: number;
  readonly met: boolean;
}

/** Where the writer stands against the deadline. */
export interface DeadlineProgress {
  /** The deadline, as YYYY-MM-DD. */
  readonly deadline: string;
  /** Writing days left, counting both today and the deadline day; 0 once the deadline has passed. */
  readonly daysLeft: number;
  /** True when the deadline was before today. */
  readonly passed: boolean;
  /**
   * Words to write each day, from today, to reach the project target on the
   * deadline. Worked out from the words the project had this morning, so it
   * stays the same all day. 0 when the target is already reached; null when
   * there is no project target or the deadline has passed.
   */
  readonly wordsPerDay: number | null;
}

/** Everything the screen shows about targets. A part is null when its target is not set. */
export interface WritingProgress {
  /** The manuscript against the project target. */
  readonly project: TargetProgress | null;
  /** Today's words against the daily target. */
  readonly today: TargetProgress | null;
  readonly deadline: DeadlineProgress | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const isBlank = (value: unknown): boolean =>
  value === undefined || value === null || (typeof value === 'string' && value.trim() === '');

/**
 * Read a number of words that may have been typed by hand: 80000, "80000",
 * "80,000", "80 000" and "80_000" all read as 80000. Null for anything that
 * is not a whole number above zero (a fraction is rounded).
 */
export function readWordTarget(value: unknown): number | null {
  let words: number;
  if (typeof value === 'number') {
    words = value;
  } else if (typeof value === 'string') {
    const text = value.trim();
    if (!/^\d+(?:[,_ ]\d+)*$/.test(text)) return null;
    words = Number(text.replace(/[,_ ]/g, ''));
  } else {
    return null;
  }
  if (!Number.isFinite(words)) return null;
  const whole = Math.round(words);
  return whole >= 1 && whole <= Number.MAX_SAFE_INTEGER ? whole : null;
}

/**
 * Read the "targets" value of a project index. Never throws: a part that
 * cannot be understood reads as not set and is reported.
 */
export function parseTargets(raw: unknown): ParsedTargets {
  if (raw === undefined || raw === null) return { targets: NO_TARGETS, problems: [] };
  if (!isRecord(raw)) {
    return {
      targets: NO_TARGETS,
      problems: ['The "targets" property should be a group of properties (project, daily, deadline).'],
    };
  }
  const problems: string[] = [];
  const words = (key: 'project' | 'daily'): number | null => {
    const value = raw[key];
    if (isBlank(value)) return null;
    const read = readWordTarget(value);
    if (read === null) problems.push(`The ${key} target should be a whole number of words above zero.`);
    return read;
  };
  const project = words('project');
  const daily = words('daily');
  let deadline: string | null = null;
  if (!isBlank(raw['deadline'])) {
    deadline = readDateProperty(raw['deadline']);
    if (deadline === null) problems.push('The deadline should be a date written as YYYY-MM-DD.');
  }
  return { targets: { project, daily, deadline }, problems };
}

/**
 * Check what the writer typed into the targets form. An empty field means
 * "no target". Either every field is fine and the targets come back, or the
 * fields that are wrong each get a message.
 */
export function validateTargets(input: TargetsInput): TargetsValidation {
  const errors: { project?: string; daily?: string; deadline?: string } = {};
  const words = (key: 'project' | 'daily', example: string): number | null => {
    const value = input[key];
    if (isBlank(value)) return null;
    const read = readWordTarget(value);
    if (read === null) {
      errors[key] = `Enter a whole number of words above zero, for example ${example}.`;
    } else if (read > MAX_TARGET_WORDS) {
      errors[key] = 'That is more words than a target can hold.';
    }
    return read;
  };
  const project = words('project', '80000');
  const daily = words('daily', '500');
  let deadline: string | null = null;
  if (!isBlank(input.deadline)) {
    deadline = readDateProperty(input.deadline);
    if (deadline === null) errors.deadline = 'Enter a real date as YYYY-MM-DD, for example 2026-12-31.';
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, targets: { project, daily, deadline } };
}

/**
 * The new value for the "targets" key of the project index, after a change.
 *
 * Only the parts named in the change are touched: a number or date sets a
 * target, null removes it. Every other part stays exactly as it was stored,
 * including parts this version does not know. A new value that is not valid
 * is ignored (check with validateTargets first).
 *
 * What was stored and could not be read is never dropped for a null: it is
 * not a target, so "no target" leaves it alone, and only a new value takes
 * its place. That makes it safe to pass the whole result of validateTargets,
 * where every field left empty is null. The same holds when the stored value
 * is not a group of properties at all (a bare number typed by hand, a list):
 * it comes back as it was unless a target is really set.
 *
 * Returns undefined when nothing is left: the key should then be removed.
 *
 * @param raw the value stored now, as read from the index (anything at all)
 */
export function updateTargets(
  raw: Readonly<Record<string, unknown>> | null | undefined,
  change: TargetsChange,
): Record<string, unknown> | undefined;
export function updateTargets(raw: unknown, change: TargetsChange): unknown;
export function updateTargets(raw: unknown, change: TargetsChange): unknown {
  const next: Record<string, unknown> = isRecord(raw) ? { ...raw } : {};
  let set = false;
  for (const key of ['project', 'daily'] as const) {
    const value = change[key];
    if (value === undefined) continue;
    if (value === null) {
      if (isBlank(next[key]) || readWordTarget(next[key]) !== null) delete next[key];
    } else if (typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= MAX_TARGET_WORDS) {
      next[key] = value;
      set = true;
    }
  }
  const deadline = change.deadline;
  if (deadline === null) {
    if (isBlank(next['deadline']) || readDateProperty(next['deadline']) !== null) delete next['deadline'];
  } else if (typeof deadline === 'string' && isDateText(deadline)) {
    next['deadline'] = deadline;
    set = true;
  }
  // Something that is not a group of properties was not understood either.
  if (!set && raw !== undefined && raw !== null && !isRecord(raw)) return raw;
  return Object.keys(next).length === 0 ? undefined : next;
}

/**
 * How far along a word target is. Null when there is no target.
 *
 * @param words  the words so far (a net count may be negative)
 * @param target the target, or null when none is set
 */
export function targetProgress(words: number, target: number | null): TargetProgress | null {
  if (target === null || !Number.isFinite(target) || target <= 0) return null;
  const count = Number.isFinite(words) ? Math.round(words) : 0;
  return {
    words: count,
    target,
    percent: Math.max(0, Math.floor((count * 100) / target)),
    remaining: Math.max(0, target - count),
    met: count >= target,
  };
}

/**
 * Where the writer stands against the deadline: days left, and the words to
 * write each day to reach the project target in time. Null when there is no
 * deadline (or today's date is not a real date).
 *
 * @param projectWords the manuscript's word count now
 * @param todayWords   the net manuscript words written today, on all devices
 * @param today        today's date, as YYYY-MM-DD
 */
export function deadlineProgress(
  targets: Targets,
  projectWords: number,
  todayWords: number,
  today: string,
): DeadlineProgress | null {
  const deadline = targets.deadline;
  const days = deadline === null ? null : daysBetween(today, deadline);
  if (deadline === null || days === null) return null;
  const passed = days < 0;
  const daysLeft = passed ? 0 : days + 1;
  let wordsPerDay: number | null = null;
  if (targets.project !== null && !passed) {
    const now = Number.isFinite(projectWords) ? Math.round(projectWords) : 0;
    const sinceMorning = Number.isFinite(todayWords) ? Math.round(todayWords) : 0;
    const remainingThisMorning = targets.project - (now - sinceMorning);
    // Cut below a target that was already reached this morning: what is missing now is what counts.
    const toSpread = remainingThisMorning > 0 ? remainingThisMorning : targets.project - now;
    wordsPerDay = now >= targets.project ? 0 : Math.ceil(toSpread / daysLeft);
  }
  return { deadline, daysLeft, passed, wordsPerDay };
}

/**
 * All the progress figures at once.
 *
 * @param input.projectWords the manuscript's word count now
 * @param input.todayWords   the net manuscript words written today, on all devices
 * @param input.today        today's date, as YYYY-MM-DD
 */
export function writingProgress(input: {
  readonly targets: Targets;
  readonly projectWords: number;
  readonly todayWords: number;
  readonly today: string;
}): WritingProgress {
  return {
    project: targetProgress(input.projectWords, input.targets.project),
    today: targetProgress(input.todayWords, input.targets.daily),
    deadline: deadlineProgress(input.targets, input.projectWords, input.todayWords, input.today),
  };
}
