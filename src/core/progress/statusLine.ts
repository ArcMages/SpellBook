// The line of figures shown for the open scene: in the bottom bar on desktop,
// at the top of the inspector on a phone or tablet.
//
//   Words 1,234 / 2,000 · Started 2 Oct 2026 · Edited 13 Oct 2026 ·
//   Session 350 · Project 45,200 / 80,000 · Today 350 / 500
//
// Which pieces there are, and in what order, is the writer's choice (see
// barLayout.ts); the line above is what a device starts with.
//
// This file only decides what the pieces are and how they read. Drawing them
// is up to the screen.

import type { BarItemId } from './barLayout';
import { DEFAULT_BAR_LAYOUT, barItemIds } from './barLayout';
import { readDateProperty } from './calendar';
import { formatDisplayDate, formatNumber } from './format';

/** The names of the pieces of the line: the figures the writer can choose from. */
export type StatusSegmentId = BarItemId;

/** One piece of the line. */
export interface StatusSegment {
  readonly id: StatusSegmentId;
  /** A short English label, for example "Words". */
  readonly label: string;
  /** The value as it reads on screen, for example "1,234 / 2,000" or "13 Oct 2026". */
  readonly value: string;
  /** Present only when the piece has a target: whether the target is reached. */
  readonly met?: boolean;
  /** Present only when the piece shows progress: how far, from 0 to 1. */
  readonly fraction?: number;
  /**
   * True when the value is the writer's own text (a status name, a scene's
   * title), which may be in any language: the screen lets such text choose
   * its own direction. Left out for numbers and dates.
   */
  readonly ownText?: true;
  /** Present only when the piece has a colour: one of the eight colour names (see core/cards). */
  readonly color?: string;
  /** True when the piece asks for attention (a to-do is late). Left out otherwise. */
  readonly late?: true;
}

/**
 * The figures the line is built from. Leave a figure out (or give null) when
 * there is nothing to show for it: its piece is then left out of the line.
 */
export interface StatusLineInput {
  /** The open scene's word count. */
  readonly sceneWords?: number | null;
  /** The open scene's own target (its "target" property). */
  readonly sceneTarget?: number | null;
  /** The day the scene was started, as YYYY-MM-DD. */
  readonly started?: string | null;
  /** The day the scene was last edited, as YYYY-MM-DD. */
  readonly edited?: string | null;
  /** Net words typed since the plugin loaded. */
  readonly sessionWords?: number | null;
  /** The whole manuscript's word count. */
  readonly projectWords?: number | null;
  /** The project target, in words. */
  readonly projectTarget?: number | null;
  /** Net words written today. */
  readonly todayWords?: number | null;
  /** The daily target, in words. */
  readonly dailyTarget?: number | null;
  /** The open scene's title. */
  readonly sceneTitle?: string | null;
  /** The open scene's status: its name, and its colour when it has one. */
  readonly status?: { readonly name: string; readonly color?: string | null } | null;
  /** The to-dos that are not done: how many are due today, and how many were due before today. */
  readonly todos?: { readonly dueToday: number; readonly late: number } | null;
}

/** How many words a reader reads in a minute, for the reading time. */
export const READING_WORDS_PER_MINUTE = 238;

const isCount = (value: number | null | undefined): value is number =>
  value !== null && value !== undefined && Number.isFinite(value);

const isTarget = (value: number | null | undefined): value is number => isCount(value) && value > 0;

/** A count, on its own or against its target. */
function counted(id: StatusSegmentId, label: string, words: number, target: number | null | undefined): StatusSegment {
  if (!isTarget(target)) return { id, label, value: formatNumber(words) };
  return {
    id,
    label,
    value: `${formatNumber(words)} / ${formatNumber(target)}`,
    met: Math.round(words) >= Math.round(target),
  };
}

function dated(id: StatusSegmentId, label: string, date: string | null | undefined): StatusSegment | null {
  const read = readDateProperty(date);
  const value = read === null ? null : formatDisplayDate(read);
  return value === null ? null : { id, label, value };
}

/**
 * About how long a text of so many words takes to read: "0 min" for none,
 * "<1 min", "12 min", and from an hour on "1h 05m".
 */
export function formatReadingTime(words: number): string {
  if (!Number.isFinite(words) || words <= 0) return '0 min';
  const minutes = Math.round(words / READING_WORDS_PER_MINUTE);
  if (minutes < 1) return '<1 min';
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`;
}

/** How far a scene is toward its own target: "62% of 2,000". */
function towardTarget(words: number, target: number): StatusSegment {
  const written = Math.max(0, Math.round(words));
  return {
    id: 'target',
    label: 'Target',
    // Rounded down, so that 100% shows only once the target is reached.
    value: `${formatNumber(Math.floor((written * 100) / target))}% of ${formatNumber(target)}`,
    met: written >= Math.round(target),
    fraction: Math.min(1, written / target),
  };
}

const DEFAULT_ITEMS: readonly BarItemId[] = barItemIds(DEFAULT_BAR_LAYOUT);

/** One piece of the line, or null when there is nothing to show for it. */
function piece(id: BarItemId, input: StatusLineInput, withTarget: boolean): StatusSegment | null {
  switch (id) {
    case 'scene':
      if (!isCount(input.sceneWords)) return null;
      // With the target shown as a piece of its own, the words stand alone.
      return counted('scene', 'Words', input.sceneWords, withTarget ? null : input.sceneTarget);
    case 'target':
      return isCount(input.sceneWords) && isTarget(input.sceneTarget) ? towardTarget(input.sceneWords, input.sceneTarget) : null;
    case 'started':
      return dated('started', 'Started', input.started);
    case 'edited':
      return dated('edited', 'Edited', input.edited);
    case 'session':
      return isCount(input.sessionWords) ? { id, label: 'Session', value: formatNumber(input.sessionWords) } : null;
    case 'project':
      return isCount(input.projectWords) ? counted('project', 'Project', input.projectWords, input.projectTarget) : null;
    case 'today':
      return isCount(input.todayWords) ? counted('today', 'Today', input.todayWords, input.dailyTarget) : null;
    case 'reading':
      return isCount(input.sceneWords) ? { id, label: 'Reading', value: formatReadingTime(input.sceneWords) } : null;
    case 'status': {
      const status = input.status;
      if (status === null || status === undefined || typeof status.name !== 'string' || status.name.trim() === '') return null;
      const segment: StatusSegment = { id, label: 'Status', value: status.name.trim(), ownText: true };
      return typeof status.color === 'string' && status.color !== '' ? { ...segment, color: status.color } : segment;
    }
    case 'todos': {
      const todos = input.todos;
      if (todos === null || todos === undefined || !isCount(todos.dueToday) || !isCount(todos.late)) return null;
      const late = Math.max(0, Math.round(todos.late));
      const due = Math.max(0, Math.round(todos.dueToday)) + late;
      if (late === 0) return { id, label: 'To-dos due', value: formatNumber(due) };
      return { id, label: 'To-dos due', value: `${formatNumber(due)} (${formatNumber(late)} late)`, late: true };
    }
    case 'title': {
      const title = input.sceneTitle;
      return typeof title === 'string' && title.trim() !== '' ? { id, label: 'Scene', value: title.trim(), ownText: true } : null;
    }
    default:
      return null;
  }
}

/**
 * The pieces of the line for the open scene, in the order of `items`. Left
 * out, that is the order a device starts with: the scene's words (and its
 * target when it has one), the day it was started, the day it was last
 * edited, the words of this session, the project's total against the project
 * target, and today's words against the daily target.
 *
 * Numbers get thousands separators and dates read like "13 Oct 2026". A piece
 * with nothing to show is left out; with nothing at all the list is empty.
 * A piece asked for twice is given once.
 */
export function buildStatusLine(input: StatusLineInput, items: readonly BarItemId[] = DEFAULT_ITEMS): StatusSegment[] {
  const withTarget = items.includes('target');
  const segments: StatusSegment[] = [];
  const seen = new Set<BarItemId>();
  for (const id of items) {
    if (seen.has(id)) continue;
    seen.add(id);
    const segment = piece(id, input, withTarget);
    if (segment !== null) segments.push(segment);
  }
  return segments;
}
