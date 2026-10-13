// The line of figures shown for the open scene: in the bottom bar on desktop,
// at the top of the inspector on a phone or tablet.
//
//   Words 1,234 / 2,000 · Started 2 Oct 2026 · Edited 13 Oct 2026 ·
//   Session 350 · Project 45,200 / 80,000 · Today 350 / 500
//
// This file only decides what the pieces are and how they read. Drawing them
// is up to the screen.

import { readDateProperty } from './calendar';
import { formatDisplayDate, formatNumber } from './format';

/** The names of the pieces of the line, in the order they are shown. */
export type StatusSegmentId = 'scene' | 'started' | 'edited' | 'session' | 'project' | 'today';

/** One piece of the line. */
export interface StatusSegment {
  readonly id: StatusSegmentId;
  /** A short English label, for example "Words". */
  readonly label: string;
  /** The value as it reads on screen, for example "1,234 / 2,000" or "13 Oct 2026". */
  readonly value: string;
  /** Present only when the piece has a target: whether the target is reached. */
  readonly met?: boolean;
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
}

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
 * The pieces of the line for the open scene, in order: the scene's words (and
 * its target when it has one), the day it was started, the day it was last
 * edited, the words of this session, the project's total against the project
 * target, and today's words against the daily target.
 *
 * Numbers get thousands separators and dates read like "13 Oct 2026". A piece
 * with nothing to show is left out; with nothing at all the list is empty.
 */
export function buildStatusLine(input: StatusLineInput): StatusSegment[] {
  const segments: StatusSegment[] = [];

  if (isCount(input.sceneWords)) segments.push(counted('scene', 'Words', input.sceneWords, input.sceneTarget));

  const started = dated('started', 'Started', input.started);
  if (started) segments.push(started);

  const edited = dated('edited', 'Edited', input.edited);
  if (edited) segments.push(edited);

  if (isCount(input.sessionWords)) {
    segments.push({ id: 'session', label: 'Session', value: formatNumber(input.sessionWords) });
  }

  if (isCount(input.projectWords)) {
    segments.push(counted('project', 'Project', input.projectWords, input.projectTarget));
  }

  if (isCount(input.todayWords)) segments.push(counted('today', 'Today', input.todayWords, input.dailyTarget));

  return segments;
}
