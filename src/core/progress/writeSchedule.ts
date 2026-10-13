// When to count and when to save, decided from timestamps alone.
//
//  - A note is measured (its words counted) once typing in it has paused for
//    2 seconds: one measurement per pause, not one per keystroke.
//  - The log is saved after 8 seconds of quiet: no typing and no new counts.
//  - Nothing stays unsaved for longer than 2 minutes, however busy the writer.
//  - When the date changes, yesterday's words are measured and saved at once.
//  - When the plugin unloads, everything is measured and saved at once.
//
// This file starts no timers and reads no clock. The caller hands in the time
// and is told what is due now and how long it may sleep.

/** Typing must pause this long before a note is measured. */
export const MEASURE_AFTER_MS = 2000;

/** The log is saved after this much quiet. */
export const WRITE_AFTER_QUIET_MS = 8000;

/** Changes never wait longer than this to be saved. */
export const MAX_UNWRITTEN_MS = 120000;

/** After a save that failed, the next try waits this long. */
export const WRITE_RETRY_MS = 8000;

/** A note that has been typed in and not measured since. */
export interface TypingNote {
  /** The note's vault path. */
  readonly path: string;
  /** The local date (YYYY-MM-DD) on which this stretch of typing began. */
  readonly date: string;
  /** When this stretch of typing began, in milliseconds. */
  readonly firstTypedAt: number;
  /** When the last keystroke arrived, in milliseconds. */
  readonly lastTypedAt: number;
}

/** Counted words that are not in the log file yet. */
export interface UnwrittenWords {
  /** When the oldest of them was counted, in milliseconds. */
  readonly since: number;
  /** When the newest of them was counted, in milliseconds. */
  readonly lastChangeAt: number;
  /** The dates (YYYY-MM-DD) they belong to. */
  readonly dates: readonly string[];
}

/** Everything the decision needs: the time now, and what is waiting. */
export interface WriteScheduleInput {
  /** The time now, in milliseconds (any steady count, for example since 1970). */
  readonly now: number;
  /** Today's local date, as YYYY-MM-DD. */
  readonly today: string;
  /** Notes typed in and not measured since. */
  readonly typing: readonly TypingNote[];
  /** Counted words not yet saved; null when there are none. */
  readonly unwritten: UnwrittenWords | null;
  /** True when the plugin is unloading: everything is due at once. */
  readonly unloading?: boolean;
  /** Do not save before this time (set after a save failed); null or left out for no such limit. */
  readonly notBefore?: number | null;
}

/** What is due now. */
export interface WritePlan {
  /** Notes to measure now, as vault paths. Measure these first. */
  readonly measure: readonly string[];
  /** Whether to save the log now (after the measuring). */
  readonly write: boolean;
  /**
   * Milliseconds until something else falls due, if nothing new happens;
   * null when nothing is waiting. After acting on a plan, ask for a new one.
   */
  readonly wait: number | null;
}

/** Time gone by since `then`. A clock that was set back counts as "long ago", so nothing waits forever. */
const since = (now: number, then: number): number => (now < then ? Number.POSITIVE_INFINITY : now - then);

/** Decide what to measure and whether to save, from the time now and what is waiting. */
export function planWrites(input: WriteScheduleInput): WritePlan {
  const { now, today, typing, unwritten } = input;

  if (input.unloading) {
    return {
      measure: typing.map((note) => note.path),
      write: unwritten !== null || typing.length > 0,
      wait: null,
    };
  }

  const measure: string[] = [];
  const waits: number[] = [];
  let urgent = false;
  let lastTypedAt = Number.NEGATIVE_INFINITY;

  for (const note of typing) {
    lastTypedAt = Math.max(lastTypedAt, note.lastTypedAt);
    const paused = since(now, note.lastTypedAt);
    const held = since(now, note.firstTypedAt);
    const rolledOver = note.date !== today;
    const tooLong = held >= MAX_UNWRITTEN_MS;
    if (rolledOver || tooLong) {
      // Not waiting for a pause: these words must reach the log now.
      measure.push(note.path);
      urgent = true;
    } else if (paused >= MEASURE_AFTER_MS) {
      measure.push(note.path);
    } else {
      waits.push(MEASURE_AFTER_MS - paused, MAX_UNWRITTEN_MS - held);
    }
  }

  let write = urgent;
  if (unwritten !== null) {
    // Typing that is still going on is not quiet, even before it is measured.
    const quiet = since(now, Math.max(unwritten.lastChangeAt, lastTypedAt));
    const age = since(now, unwritten.since);
    const rolledOver = unwritten.dates.some((date) => date !== today);
    if (rolledOver || age >= MAX_UNWRITTEN_MS || quiet >= WRITE_AFTER_QUIET_MS) {
      write = true;
    } else {
      waits.push(WRITE_AFTER_QUIET_MS - quiet, MAX_UNWRITTEN_MS - age);
    }
  }

  const notBefore = input.notBefore ?? null;
  if (write && notBefore !== null && now < notBefore && notBefore - now <= WRITE_RETRY_MS) {
    // A save has just failed: hold off for a moment instead of trying in a loop.
    write = false;
    waits.push(notBefore - now);
  }

  return { measure, write, wait: waits.length === 0 ? null : Math.max(0, Math.min(...waits)) };
}
