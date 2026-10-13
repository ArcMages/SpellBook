import { describe, expect, it } from 'vitest';
import { MAX_UNWRITTEN_MS, MEASURE_AFTER_MS, WRITE_AFTER_QUIET_MS, WRITE_RETRY_MS, planWrites } from '../../src/core/progress';
import type { TypingNote, UnwrittenWords, WriteScheduleInput } from '../../src/core/progress';

const TODAY = '2026-10-13';
const YESTERDAY = '2026-10-12';
/** An arbitrary moment; every time below is counted from it. */
const T0 = 1_000_000;

const typing = (path: string, firstTypedAt: number, lastTypedAt = firstTypedAt, date = TODAY): TypingNote => ({
  path,
  date,
  firstTypedAt,
  lastTypedAt,
});

const unwritten = (since: number, lastChangeAt = since, dates: string[] = [TODAY]): UnwrittenWords => ({ since, lastChangeAt, dates });

const plan = (now: number, parts: Partial<WriteScheduleInput> = {}) =>
  planWrites({ now, today: TODAY, typing: [], unwritten: null, ...parts });

describe('the numbers', () => {
  it('are the ones the design asks for', () => {
    expect(MEASURE_AFTER_MS).toBe(2000);
    expect(WRITE_AFTER_QUIET_MS).toBe(8000);
    expect(MAX_UNWRITTEN_MS).toBe(120000);
    expect(WRITE_RETRY_MS).toBe(8000);
  });
});

describe('planWrites', () => {
  it('has nothing to do and nothing to wait for when nothing is waiting', () => {
    expect(plan(T0)).toEqual({ measure: [], write: false, wait: null });
  });

  it('measures a note once typing has paused for 2 seconds, not before', () => {
    const scene = typing('Novel/Manuscript/Opening.md', T0);
    expect(plan(T0, { typing: [scene] })).toEqual({ measure: [], write: false, wait: 2000 });
    expect(plan(T0 + 1999, { typing: [scene] })).toEqual({ measure: [], write: false, wait: 1 });
    expect(plan(T0 + 2000, { typing: [scene] })).toEqual({ measure: [scene.path], write: false, wait: null });
    expect(plan(T0 + 60000, { typing: [scene] }).measure).toEqual([scene.path]);
  });

  it('starts the 2 seconds again with every keystroke', () => {
    // Typing began at T0 and the last key was pressed 5 seconds later.
    const scene = typing('Novel/Manuscript/Opening.md', T0, T0 + 5000);
    expect(plan(T0 + 6000, { typing: [scene] })).toEqual({ measure: [], write: false, wait: 1000 });
    expect(plan(T0 + 7000, { typing: [scene] }).measure).toEqual([scene.path]);
  });

  it('measures each note on its own pause', () => {
    const first = typing('Novel/Manuscript/פתיחה.md', T0);
    const second = typing('Novel/Manuscript/Letter.md', T0 + 1500);
    expect(plan(T0 + 2100, { typing: [first, second] })).toEqual({ measure: [first.path], write: false, wait: 1400 });
    expect(plan(T0 + 3500, { typing: [first, second] }).measure).toEqual([first.path, second.path]);
  });

  it('saves after 8 seconds of quiet, not before', () => {
    const words = unwritten(T0);
    expect(plan(T0, { unwritten: words })).toEqual({ measure: [], write: false, wait: 8000 });
    expect(plan(T0 + 7999, { unwritten: words })).toEqual({ measure: [], write: false, wait: 1 });
    expect(plan(T0 + 8000, { unwritten: words })).toEqual({ measure: [], write: true, wait: null });
  });

  it('starts the 8 seconds again with every new count', () => {
    // First counted at T0, last counted 30 seconds later.
    const words = unwritten(T0, T0 + 30000);
    expect(plan(T0 + 35000, { unwritten: words })).toEqual({ measure: [], write: false, wait: 3000 });
    expect(plan(T0 + 38000, { unwritten: words }).write).toBe(true);
  });

  it('does not call it quiet while the writer is still typing', () => {
    // Words were counted 9 seconds ago, but a key was pressed half a second ago.
    const words = unwritten(T0);
    const scene = typing('Novel/Manuscript/Opening.md', T0 + 8000, T0 + 8500);
    expect(plan(T0 + 9000, { typing: [scene], unwritten: words })).toEqual({ measure: [], write: false, wait: 1500 });
    // Once the typing has paused, the note is measured, and the save waits for quiet from the last key.
    expect(plan(T0 + 10500, { typing: [scene], unwritten: words })).toEqual({ measure: [scene.path], write: false, wait: 6000 });
    expect(plan(T0 + 16500, { typing: [scene], unwritten: words })).toEqual({ measure: [scene.path], write: true, wait: null });
  });

  it('never lets counted words wait longer than 2 minutes', () => {
    // A writer who never stops for 8 seconds: counted at T0, counted again just now.
    const now = T0 + 120000;
    const words = unwritten(T0, now - 100);
    expect(plan(now - 1, { unwritten: unwritten(T0, now - 100) })).toEqual({ measure: [], write: false, wait: 1 });
    expect(plan(now, { unwritten: words })).toEqual({ measure: [], write: true, wait: null });
  });

  it('never lets typing go unmeasured for longer than 2 minutes either', () => {
    // A writer who never pauses for 2 seconds: typing since T0, last key just now.
    const now = T0 + 120000;
    const scene = typing('Novel/Manuscript/Opening.md', T0, now - 50);
    expect(plan(now - 1, { typing: [typing(scene.path, T0, now - 50)] })).toEqual({ measure: [], write: false, wait: 1 });
    expect(plan(now, { typing: [scene] })).toEqual({ measure: [scene.path], write: true, wait: null });
  });

  it('measures and saves at once when the date has changed', () => {
    // Typed just before midnight; it is now a few moments into the next day.
    const scene = typing('Novel/Manuscript/Opening.md', T0, T0, YESTERDAY);
    expect(plan(T0 + 100, { typing: [scene] })).toEqual({ measure: [scene.path], write: true, wait: null });
    // Words of yesterday that were counted but not saved.
    expect(plan(T0 + 100, { unwritten: unwritten(T0, T0, [YESTERDAY]) })).toEqual({ measure: [], write: true, wait: null });
    expect(plan(T0 + 100, { unwritten: unwritten(T0, T0, [YESTERDAY, TODAY]) }).write).toBe(true);
    // Today's typing waits for its pause as usual, even while yesterday's is rushed.
    const fresh = typing('Novel/Manuscript/Letter.md', T0 + 50);
    expect(plan(T0 + 100, { typing: [scene, fresh] })).toEqual({ measure: [scene.path], write: true, wait: 1950 });
  });

  it('measures and saves everything at once when the plugin unloads', () => {
    const scene = typing('Novel/Manuscript/Opening.md', T0);
    const other = typing('Notes/רעיונות.md', T0);
    expect(plan(T0, { typing: [scene, other], unloading: true })).toEqual({ measure: [scene.path, other.path], write: true, wait: null });
    expect(plan(T0, { unwritten: unwritten(T0), unloading: true })).toEqual({ measure: [], write: true, wait: null });
    // With nothing waiting there is nothing to save.
    expect(plan(T0, { unloading: true })).toEqual({ measure: [], write: false, wait: null });
  });

  it('waits for whichever comes first', () => {
    const scene = typing('Novel/Manuscript/Opening.md', T0 + 4000, T0 + 4500);
    const words = unwritten(T0, T0 + 1000);
    // The note is due in 1.5 s; quiet (from the last key) in 7.5 s; the ceilings much later.
    expect(plan(T0 + 5000, { typing: [scene], unwritten: words }).wait).toBe(1500);
  });

  it('holds off after a failed save, then tries again', () => {
    const words = unwritten(T0);
    const failedAt = T0 + 8000;
    const notBefore = failedAt + WRITE_RETRY_MS;
    expect(plan(failedAt, { unwritten: words, notBefore })).toEqual({ measure: [], write: false, wait: 8000 });
    expect(plan(notBefore - 1, { unwritten: words, notBefore })).toEqual({ measure: [], write: false, wait: 1 });
    expect(plan(notBefore, { unwritten: words, notBefore }).write).toBe(true);
    // Unloading does not wait for anything.
    expect(plan(failedAt, { unwritten: words, notBefore, unloading: true }).write).toBe(true);
    // Measuring is not held back by a failed save.
    const scene = typing('Novel/Manuscript/Opening.md', T0);
    expect(plan(failedAt, { typing: [scene], unwritten: words, notBefore }).measure).toEqual([scene.path]);
  });

  it('is not stopped for ever by a clock that was set back', () => {
    // Everything was stamped "an hour from now": the clock has gone back.
    const later = T0 + 3600000;
    const scene = typing('Novel/Manuscript/Opening.md', later);
    expect(plan(T0, { typing: [scene] }).measure).toEqual([scene.path]);
    expect(plan(T0, { unwritten: unwritten(later) }).write).toBe(true);
    // A "not before" that far away is not believed.
    expect(plan(T0 + 8000, { unwritten: unwritten(T0), notBefore: later }).write).toBe(true);
  });
});
