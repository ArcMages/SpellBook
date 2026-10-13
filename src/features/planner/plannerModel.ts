// What the planner screen works out before it draws: which layout fits the
// pane, how a number is written in a small cell, what a day's dots are, which
// to-do comes before which. Plain values in, plain values out; nothing here
// touches the screen.
//
// Dates, To-do.md, the month grid, the marks and the tint are the engine's
// (src/core/planner). Nothing here works them out again.

import { describeCount, formatCount } from '../../core/binderModel';
import { addDays } from '../../core/dates';
import { MARK_COLORS, MONTH_NAMES, dayTitle } from '../../core/planner';
import type { DaySummary, DayWords, MarkColor, TodoFile, TodoTask } from '../../core/planner';
import type { PlannerStats } from './plannerHost';

// ------------------------------------------------------------------ layout
//
// Every layout choice goes by a measured width, never by the kind of device.
// Each has two figures with a gap between them, so that a pane resting at the
// edge does not flicker between two layouts.

/** From this pane width on, the calendar and the to-do list sit side by side. */
export const SIDE_BY_SIDE_FROM = 720;
/** Below this pane width they become two tabs again. */
export const TABS_BELOW = 680;

/** From this width of the calendar on, a day's detail sits beside the month. */
export const DETAIL_BESIDE_FROM = 780;
/** Below this width of the calendar it goes under the month again. */
export const DETAIL_UNDER_BELOW = 740;

/** From this width of the month on, a day's cell is wide enough for its two word numbers. */
export const NUMBERS_FROM = 420;
/** Below this width of the month the cells show their tint only. */
export const NUMBERS_BELOW = 390;

/** From this width of the month on, a day's cell has room for the label of its mark. */
export const LABELS_FROM = 560;
/** Below this width of the month only the mark's coloured corner is shown. */
export const LABELS_BELOW = 520;

/**
 * Whether something is wide enough for the roomier of two layouts.
 *
 * @param width what was measured, in CSS pixels; zero means it is hidden, and nothing changes
 * @param was   whether the roomier layout is in use now
 * @param from  the width at which the roomier layout comes in
 * @param below the width under which it goes again (smaller than `from`)
 */
export function isWideEnough(width: number, was: boolean, from: number, below: number): boolean {
  if (!(width > 0)) return was;
  return was ? width >= below : width >= from;
}

// ------------------------------------------------------------------- words

const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/** A number of words in full, with commas: "12,345". Words taken away in a day show as "-120". */
export function formatWords(count: number): string {
  const whole = isNumber(count) ? Math.round(count) : 0;
  return whole < 0 ? `-${formatCount(-whole)}` : formatCount(whole);
}

/** The same said in full, for screen readers: "1 word", "12,345 words", "-120 words". */
export function describeWords(count: number): string {
  const whole = isNumber(count) ? Math.round(count) : 0;
  return whole < 0 ? `-${describeCount(-whole)}` : describeCount(whole);
}

/** One decimal at most, cut and not rounded up, so that 999,999 never reads as a million. */
function shortened(value: number, unit: number, letter: string): string {
  const tenths = Math.floor((value * 10) / unit);
  const whole = Math.floor(tenths / 10);
  const rest = tenths % 10;
  return `${whole}${whole < 10 && rest !== 0 ? `.${rest}` : ''}${letter}`;
}

/** A number of words short enough for a day's cell: "850", "1.2k", "12k", "1.5m". */
export function compactWords(count: number): string {
  const whole = isNumber(count) ? Math.round(count) : 0;
  const size = Math.abs(whole);
  const sign = whole < 0 ? '-' : '';
  if (size < 1000) return `${sign}${size}`;
  if (size < 1000000) return `${sign}${shortened(size, 1000, 'k')}`;
  return `${sign}${shortened(size, 1000000, 'm')}`;
}

// ------------------------------------------------------------------- dates

/**
 * A due date as a to-do's chip shows it: "Today", "Tomorrow", "Yesterday",
 * otherwise the day and the month ("20 Oct"), with the year when it is not
 * this year ("3 Jan 2027").
 */
export function dueLabel(due: string, today: string): string {
  if (due === today) return 'Today';
  if (due === addDays(today, 1)) return 'Tomorrow';
  if (due === addDays(today, -1)) return 'Yesterday';
  const month = (MONTH_NAMES[Number(due.slice(5, 7)) - 1] ?? '').slice(0, 3);
  const short = `${Number(due.slice(8, 10))} ${month}`;
  return due.slice(0, 4) === today.slice(0, 4) ? short : `${short} ${Number(due.slice(0, 4))}`;
}

// ------------------------------------------------------------------ to-dos

/** The to-dos of the file as the list shows them: the open ones, then the done ones, each in file order. */
export interface TaskGroups {
  readonly open: readonly TodoTask[];
  readonly done: readonly TodoTask[];
}

export function groupTasks(todo: TodoFile): TaskGroups {
  const open: TodoTask[] = [];
  const done: TodoTask[] = [];
  for (const task of todo.tasks) (task.done ? done : open).push(task);
  return { open, done };
}

/** A to-do with a name that stays the same from one drawing to the next. */
export interface KeyedTask {
  readonly key: string;
  readonly task: TodoTask;
}

/**
 * Name each to-do of a list by what its line says, so that its row can be
 * used again after other lines were added, moved or removed (which changes
 * line numbers, but not what the line says). Lines that say exactly the same
 * are told apart by their order.
 */
export function keyTasks(tasks: readonly TodoTask[]): KeyedTask[] {
  const seen = new Map<string, number>();
  return tasks.map((task) => {
    const count = seen.get(task.raw) ?? 0;
    seen.set(task.raw, count + 1);
    // A line never holds a line break, so this cannot be mistaken for another line's name.
    return { key: `${count}\n${task.raw}`, task };
  });
}

/** The to-do straight above (-1) or below (1) another in a list, or null at the end of it. */
export function neighbourOf(tasks: readonly TodoTask[], task: TodoTask, step: 1 | -1): TodoTask | null {
  const at = tasks.findIndex((other) => other.line === task.line && other.raw === task.raw);
  return at < 0 ? null : (tasks[at + step] ?? null);
}

// ---------------------------------------------------------------- dragging

/** Where a row is, top to bottom, in any one frame of reference. */
export interface RowSpan {
  readonly top: number;
  readonly bottom: number;
}

/** Where something dragged would be put: before or after the row at `index`. */
export interface DropPlace {
  readonly index: number;
  readonly where: 'before' | 'after';
}

/**
 * The place a height points at among rows listed top to bottom: the upper
 * half of a row means before it, the lower half after it. Above the first row
 * is before it, below the last one after it. Null for an empty list.
 */
export function dropPlace(rows: readonly RowSpan[], y: number): DropPlace | null {
  if (rows.length === 0) return null;
  let low = 0;
  let high = rows.length - 1;
  while (low < high) {
    const middle = (low + high) >> 1;
    if ((rows[middle]?.bottom ?? 0) <= y) low = middle + 1;
    else high = middle;
  }
  const row = rows[low];
  if (!row) return null;
  return { index: low, where: y < (row.top + row.bottom) / 2 ? 'before' : 'after' };
}

/** False when putting the row at `dragged` at a place would leave the list as it is. */
export function movesAnything(place: DropPlace, dragged: number): boolean {
  const gap = place.where === 'before' ? place.index : place.index + 1;
  return gap !== dragged && gap !== dragged + 1;
}

// ---------------------------------------------------------------- calendar

/** How many dots a day's cell shows at most, before it says "+N". */
export const MAX_DOTS = 3;

/** What a day's cell shows for its to-dos. */
export interface DayDots {
  /** A tick: there are to-dos due that day and every one is done. */
  readonly tick: boolean;
  /** One dot for each open to-do due that day, up to MAX_DOTS. */
  readonly dots: number;
  /** How many open to-dos there are beyond the dots; shown as "+N". */
  readonly more: number;
}

export function dayDots(summary: Pick<DaySummary, 'openTasks' | 'allTasksDone'>): DayDots {
  if (summary.allTasksDone) return { tick: true, dots: 0, more: 0 };
  const open = Math.max(0, summary.openTasks);
  return { tick: false, dots: Math.min(open, MAX_DOTS), more: Math.max(0, open - MAX_DOTS) };
}

/** The class a day's cell carries for each tint level, 0 to 4. */
export const TINT_CLASSES = [
  'spellbook-tint-0',
  'spellbook-tint-1',
  'spellbook-tint-2',
  'spellbook-tint-3',
  'spellbook-tint-4',
] as const;

/** The class that gives something the colour of a mark. The stylesheet maps it to Obsidian's own colour of that name. */
export function markClass(color: MarkColor): string {
  return `spellbook-mark-${color}`;
}

/** Every class markClass can give. */
export const MARK_CLASSES: readonly string[] = MARK_COLORS.map(markClass);

/** A colour's name as a button says it: "Red". */
export function colorName(color: MarkColor): string {
  return color.charAt(0).toUpperCase() + color.slice(1);
}

/**
 * A day said in full, for screen readers and as the cell's tooltip: the date,
 * then whatever the cell shows without words.
 *
 * @param isToday   the day is today
 * @param withWords the calendar has word counts to show
 */
export function describeDay(summary: DaySummary, isToday: boolean, withWords: boolean): string {
  const parts = [dayTitle(summary.date)];
  if (isToday) parts.push('today');
  if (withWords && (summary.manuscriptWords !== 0 || summary.allWords !== 0)) {
    parts.push(`${describeWords(summary.manuscriptWords)} in the manuscript`);
    parts.push(`${describeWords(summary.allWords)} in all notes`);
  }
  const due = summary.tasks.length;
  if (summary.allTasksDone) parts.push(due === 1 ? 'its to-do is done' : `all ${due} to-dos are done`);
  else if (summary.openTasks > 0) parts.push(`${summary.openTasks} ${summary.openTasks === 1 ? 'to-do' : 'to-dos'} due`);
  const mark = summary.mark;
  if (mark) {
    if (mark.label !== '') parts.push(`marked: ${mark.label}`);
    else parts.push(mark.color === null ? 'marked' : `marked ${mark.color}`);
  }
  return parts.join(', ');
}

/** One line of the numbers under the calendar. */
export interface StatLine {
  readonly id: 'month' | 'week' | 'streak' | 'average' | 'target';
  /** What the number is: "This week". */
  readonly label: string;
  /** The number itself: "1,250". */
  readonly value: string;
  /** What is said next to it in a quieter voice: "3,400 in all notes"; "" for nothing. */
  readonly detail: string;
  /** For the daily target: whether it is met. */
  readonly met?: boolean;
}

function wordsLine(id: 'month' | 'week', label: string, words: DayWords | null | undefined): StatLine[] {
  if (!words || !isNumber(words.manuscript)) return [];
  const detail = isNumber(words.all) ? `${formatWords(words.all)} in all notes` : '';
  return [{ id, label, value: formatWords(words.manuscript), detail }];
}

/**
 * The lines under the calendar, for the numbers the host gave. A number that
 * was not given (or is not a number) gets no line.
 *
 * @param monthName the month on show, as its heading says it ("October 2026")
 */
export function statLines(stats: PlannerStats | null, monthName: string): StatLine[] {
  if (!stats) return [];
  const lines: StatLine[] = [...wordsLine('month', monthName, stats.month), ...wordsLine('week', 'This week', stats.week)];
  if (isNumber(stats.streak)) {
    const days = Math.max(0, Math.round(stats.streak));
    lines.push({ id: 'streak', label: 'Streak', value: `${days} ${days === 1 ? 'day' : 'days'}`, detail: '' });
  }
  if (isNumber(stats.average)) {
    lines.push({ id: 'average', label: 'Daily average', value: formatWords(stats.average), detail: 'words a day' });
  }
  const target = stats.target;
  if (target && isNumber(target.goal) && isNumber(target.written)) {
    lines.push({
      id: 'target',
      label: "Today's target",
      value: `${formatWords(target.written)} of ${formatWords(target.goal)}`,
      detail: target.met ? 'Met' : 'Not met yet',
      met: target.met,
    });
  }
  return lines;
}
