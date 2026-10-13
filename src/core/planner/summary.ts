// What the calendar shows in each day's cell: the words written that day, the
// to-dos due, the day's mark, and how strongly to tint the cell.

import { addDays, isDateText } from './fromCore';
import { monthRange } from './calendar';
import type { DayMark } from './marks';
import type { TodoFile, TodoTask } from './todo';

/** The words written on one day: net of what was deleted, so a number may be negative. */
export interface DayWords {
  /** Words in the manuscript. */
  manuscript: number;
  /** Words in all the project's notes, the manuscript included. */
  all: number;
}

/** Where the calendar gets its word counts. The word log provides one. */
export interface DayWordsSource {
  /**
   * The words of every day from `from` to `to` (both YYYY-MM-DD, both
   * included). A day with nothing logged may be left out of the map.
   */
  wordsByDay(from: string, to: string): Promise<ReadonlyMap<string, DayWords>>;
}

/** How strongly a day is tinted: 0 for no writing, 1 (a little) to 4 (a big day). */
export type TintLevel = 0 | 1 | 2 | 3 | 4;

/** Everything one day's cell shows. */
export interface DaySummary {
  /** The day, as YYYY-MM-DD. */
  readonly date: string;
  /** Net manuscript words that day; 0 when nothing was logged. */
  readonly manuscriptWords: number;
  /** Net words in all notes that day; 0 when nothing was logged. */
  readonly allWords: number;
  /** The to-dos due that day, done or not, in file order. */
  readonly tasks: readonly TodoTask[];
  /** How many of them are not done. */
  readonly openTasks: number;
  /** True when at least one to-do is due that day and every one of them is done. */
  readonly allTasksDone: boolean;
  /** The day's mark, or null. */
  readonly mark: DayMark | null;
  /** How strongly to tint the day for its manuscript words, measured against the other days in the same summary. */
  readonly tint: TintLevel;
}

const countOf = (value: number | undefined): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : 0;

/**
 * The number of words that counts as a full-strength day among the days being
 * shown: the 90th percentile of the days with any words. Measuring against
 * this, and not against the best day, keeps one huge day from making every
 * other day look empty.
 *
 * Exactly: the days with more than zero words are sorted, and the one nine
 * tenths of the way up the list is taken, rounding down to a day on the list.
 * So with two or more writing days the single biggest day never sets the
 * scale. Returns 0 when no day has words.
 */
export function tintScale(words: Iterable<number>): number {
  const written = [...words].filter((count) => Number.isFinite(count) && count > 0).sort((a, b) => a - b);
  if (written.length === 0) return 0;
  // In whole numbers: nine tenths of the way from the first place to the last, rounded down.
  const place = Math.floor(((written.length - 1) * 9) / 10);
  return written[place] ?? 0;
}

/**
 * The tint of a day with `words` manuscript words, against a scale from
 * tintScale. No words (or fewer than none) is 0. Any writing at all is at
 * least 1; a quarter of the scale or less is 1, up to a half is 2, up to
 * three quarters is 3, more is 4.
 */
export function tintLevel(words: number, scale: number): TintLevel {
  if (!(words > 0)) return 0;
  if (!(scale > 0)) return 4;
  const level = Math.ceil((words * 4) / scale);
  if (level <= 1) return 1;
  if (level === 2) return 2;
  if (level === 3) return 3;
  return 4;
}

/**
 * One summary for every day from `from` to `to` (both YYYY-MM-DD, both
 * included), in order, by date. Pass a month grid's `from` and `to` to cover
 * every cell it shows, the days of the neighbouring months included.
 *
 * @param words the words of each day, as the word log gives them; a day that is missing counts as 0
 * @param todo  To-do.md as read by parseTodo
 * @param marks the day marks as read by parseMarks (its `marks`)
 *
 * The result is empty when either end is not a real date or `from` is after `to`.
 */
export function summariseDays(
  from: string,
  to: string,
  words: ReadonlyMap<string, DayWords>,
  todo: TodoFile,
  marks: ReadonlyMap<string, DayMark>,
): Map<string, DaySummary> {
  const summaries = new Map<string, DaySummary>();
  if (!isDateText(from) || !isDateText(to) || from > to) return summaries;

  const dueOn = new Map<string, TodoTask[]>();
  for (const task of todo.tasks) {
    if (task.due === null) continue;
    const list = dueOn.get(task.due);
    if (list === undefined) dueOn.set(task.due, [task]);
    else list.push(task);
  }

  const days: string[] = [];
  for (let date = from; ; date = addDays(date, 1)) {
    days.push(date);
    if (date >= to) break;
  }
  const scale = tintScale(days.map((date) => countOf(words.get(date)?.manuscript)));

  for (const date of days) {
    const logged = words.get(date);
    const manuscriptWords = countOf(logged?.manuscript);
    const tasks = dueOn.get(date) ?? [];
    const openTasks = tasks.reduce((count, task) => (task.done ? count : count + 1), 0);
    summaries.set(date, {
      date,
      manuscriptWords,
      allWords: countOf(logged?.all),
      tasks,
      openTasks,
      allTasksDone: tasks.length > 0 && openTasks === 0,
      mark: marks.get(date) ?? null,
      tint: tintLevel(manuscriptWords, scale),
    });
  }
  return summaries;
}

/**
 * One summary for every day of a month, from the 1st to the last, in order,
 * by date. The tint is measured against the days of that month only.
 *
 * @param year  for example 2026
 * @param month 1 (January) to 12 (December)
 */
export function summariseMonth(
  year: number,
  month: number,
  words: ReadonlyMap<string, DayWords>,
  todo: TodoFile,
  marks: ReadonlyMap<string, DayMark>,
): Map<string, DaySummary> {
  const { from, to } = monthRange(year, month);
  return summariseDays(from, to, words, todo, marks);
}
