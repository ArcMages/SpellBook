// What the planner is handed from outside its own data, and how it reads it:
// the word counts of the writing-progress screen, the daily target in the
// project index, and the first day of the week of Obsidian's language.
//
// None of it is the planner's own, so nothing here trusts what it is given:
// whatever cannot be read is left out, and the calendar shows the rest.
// Pure functions: plain values in, plain values out.

import { monthRange } from '../../core/planner';
import type { DayWords, YearMonth } from '../../core/planner';
// The service's name and its shape are declared once, in the core, for the
// screen that offers it and for this one that reads it.
import { STATS_SERVICE } from '../../core/progress';
import type { StatsService, StatsSummary } from '../../core/progress';
import type { PlannerStats, TargetProgress } from './plannerHost';

/** The name under which the writing-progress screen offers its numbers to the other screens. */
export const PROGRESS_STATS_SERVICE = STATS_SERVICE;

/** The key of the project index that holds the word targets. The planner only reads its "daily" part. */
export const TARGETS_KEY = 'targets';

/**
 * The numbers the writing-progress screen sums up for a day: the service's
 * own summary. The planner reads it number by number and leaves out whatever
 * is not there or is not what it should be (see statsFrom), because the
 * service is looked up by name and is only as good as whoever provided it.
 */
export type ProgressSummary = Partial<StatsSummary>;

/**
 * What the writing-progress screen offers under PROGRESS_STATS_SERVICE: the
 * service as the core declares it. Only `wordsByDay` is asked for before it
 * is used (see asProgressStats); the other two are checked when they are called.
 */
export type ProgressStats = Pick<StatsService, 'wordsByDay'> & Partial<Pick<StatsService, 'summary' | 'onChange'>>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isCount = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/** A number that was handed over, or null for anything else. */
const countOf = (value: unknown): number | null => (isCount(value) ? value : null);

/** What was found under the service's name, when it can give the words of each day; null otherwise. */
export function asProgressStats(value: unknown): ProgressStats | null {
  if (!isRecord(value) || typeof value['wordsByDay'] !== 'function') return null;
  return value as unknown as ProgressStats;
}

/**
 * The weekday that weeks start on in a language: 0 is Sunday, up to 6 for
 * Saturday. Sunday when it cannot be told. It lives in the core, so that the
 * week totals of the writing progress follow the same rule.
 */
export { firstDayOfWeekOf } from '../../core/progress';

/**
 * The number of words to write each day, from the value stored under the
 * index's "targets" key ({ daily: 500 }). The value may have been typed by
 * hand, so 500, "500", "1,000" and "1 000" all read as numbers. Null when no
 * daily target is set or it cannot be read.
 */
export function dailyTargetOf(targets: unknown): number | null {
  if (!isRecord(targets)) return null;
  const stored = targets['daily'];
  let words: number;
  if (typeof stored === 'number') {
    words = stored;
  } else if (typeof stored === 'string' && /^\d+(?:[,_ ]\d+)*$/.test(stored.trim())) {
    words = Number(stored.trim().replace(/[,_ ]/g, ''));
  } else {
    return null;
  }
  const whole = Math.round(words);
  return Number.isFinite(words) && whole >= 1 && whole <= Number.MAX_SAFE_INTEGER ? whole : null;
}

/** What the service answered for a stretch of days, when it is the map it should be; null otherwise. */
export function asDays(value: unknown): ReadonlyMap<string, DayWords> | null {
  const map = value as { get?: unknown; [Symbol.iterator]?: unknown } | null | undefined;
  if (typeof map !== 'object' || map === null) return null;
  if (typeof map.get !== 'function' || typeof map[Symbol.iterator] !== 'function') return null;
  return value as ReadonlyMap<string, DayWords>;
}

/** The words of one day; a day with nothing logged has none. */
export function wordsOn(days: ReadonlyMap<string, DayWords>, date: string): DayWords {
  const words: unknown = days.get(date);
  if (!isRecord(words)) return { manuscript: 0, all: 0 };
  return { manuscript: countOf(words['manuscript']) ?? 0, all: countOf(words['all']) ?? 0 };
}

/** The words of the days from `from` to `to` (both included), added up. */
export function sumWords(days: ReadonlyMap<string, DayWords>, from: string, to: string): DayWords {
  let manuscript = 0;
  let all = 0;
  for (const [date, words] of days) {
    if (date < from || date > to || !isRecord(words)) continue;
    if (isCount(words.manuscript)) manuscript += words.manuscript;
    if (isCount(words.all)) all += words.all;
  }
  return { manuscript, all };
}

/**
 * A total as the calendar shows one. A plain number is taken as manuscript
 * words: how many words that makes in all notes is then not known, and the
 * calendar leaves that part out.
 */
export function totalOf(total: unknown): DayWords | null {
  if (isCount(total)) return { manuscript: total, all: Number.NaN };
  if (!isRecord(total) || !isCount(total['manuscript'])) return null;
  return { manuscript: total['manuscript'], all: isCount(total['all']) ? total['all'] : Number.NaN };
}

/** Everything statsFrom is made of. A part that could not be had is null. */
export interface StatsParts {
  /** The month on show. */
  readonly month: YearMonth;
  readonly today: string;
  /** The words of each day of the month on show. */
  readonly monthDays: ReadonlyMap<string, DayWords> | null;
  /** The words written today. */
  readonly todayWords: DayWords | null;
  /**
   * What the service's `summary` answered. It should be a ProgressSummary;
   * whatever it is, it is read number by number, and what is not a number
   * (or, for the target being met, not yes or no) is left out.
   */
  readonly summary: ProgressSummary | Readonly<Record<string, unknown>> | null;
  /** The value stored under the index's "targets" key. */
  readonly targets: unknown;
}

/**
 * The numbers under the calendar.
 *
 * The month's total is added up from the very days the calendar shows, so
 * the two always agree, whichever month is on show. The streak, the average
 * and the week come from the summary. The daily target is the one in the
 * project index (or else the summary's own), measured against the manuscript
 * words written today.
 */
export function statsFrom(parts: StatsParts): PlannerStats {
  const summary: Readonly<Record<string, unknown>> = isRecord(parts.summary) ? parts.summary : {};
  const range = monthRange(parts.month.year, parts.month.month);
  const summed = countOf(summary['dailyTarget']);
  const goal = dailyTargetOf(parts.targets) ?? (summed !== null && summed >= 1 ? summed : null);
  const written = countOf(parts.todayWords?.manuscript);
  let target: TargetProgress | null = null;
  if (goal !== null && written !== null) {
    const met = summary['dailyTargetMet'];
    target = { goal, written, met: typeof met === 'boolean' ? met : written >= goal };
  }
  return {
    month: parts.monthDays === null ? null : sumWords(parts.monthDays, range.from, range.to),
    week: totalOf(summary['weekTotal']),
    streak: countOf(summary['streak']),
    average: countOf(summary['average']),
    target,
  };
}
