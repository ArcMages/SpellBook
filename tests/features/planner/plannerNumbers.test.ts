// How the planner reads what it is handed from outside its own data: the
// word counts of the writing-progress screen, the daily target in the project
// index, and the first day of the week of Obsidian's language. None of it is
// the planner's own, so none of it is trusted.

import { describe, expect, it } from 'vitest';
import type { DayWords } from '../../../src/core/planner';
import {
  PROGRESS_STATS_SERVICE,
  TARGETS_KEY,
  asDays,
  asProgressStats,
  dailyTargetOf,
  firstDayOfWeekOf,
  statsFrom,
  sumWords,
  totalOf,
  wordsOn,
} from '../../../src/features/planner/plannerNumbers';

const days = (entries: Record<string, [number, number]>): Map<string, DayWords> =>
  new Map(Object.entries(entries).map(([date, [manuscript, all]]) => [date, { manuscript, all }]));

describe('the names the planner asks by', () => {
  it('are the ones agreed with the writing-progress screen', () => {
    expect(PROGRESS_STATS_SERVICE).toBe('progress.stats');
    expect(TARGETS_KEY).toBe('targets');
  });
});

describe('the first day of the week', () => {
  /** Obsidian's `moment`, as far as it is asked. */
  const language = (first: unknown): unknown => ({ localeData: () => ({ firstDayOfWeek: () => first }) });

  it("is the one of Obsidian's language", () => {
    expect(firstDayOfWeekOf(language(0))).toBe(0);
    expect(firstDayOfWeekOf(language(1))).toBe(1);
    expect(firstDayOfWeekOf(language(6))).toBe(6);
  });

  it('is Sunday whenever it cannot be told', () => {
    for (const odd of [7, -1, 1.5, '1', null, undefined, Number.NaN]) expect(firstDayOfWeekOf(language(odd)), String(odd)).toBe(0);
    for (const nothing of [undefined, null, {}, 'en', 42, { localeData: null }, { localeData: () => null }, { localeData: () => ({}) }]) {
      expect(firstDayOfWeekOf(nothing), JSON.stringify(nothing)).toBe(0);
    }
    const failing = {
      localeData: () => {
        throw new Error('no such language');
      },
    };
    expect(firstDayOfWeekOf(failing)).toBe(0);
  });
});

describe('the daily target in the project index', () => {
  it('is read as a whole number of words, however it was typed', () => {
    expect(dailyTargetOf({ daily: 500 })).toBe(500);
    expect(dailyTargetOf({ project: 80000, daily: 500, deadline: '2026-12-31' })).toBe(500);
    expect(dailyTargetOf({ daily: '500' })).toBe(500);
    expect(dailyTargetOf({ daily: ' 1,000 ' })).toBe(1000);
    expect(dailyTargetOf({ daily: '1 000' })).toBe(1000);
    expect(dailyTargetOf({ daily: '1_000' })).toBe(1000);
    expect(dailyTargetOf({ daily: 499.6 })).toBe(500);
  });

  it('is nothing when it is not set or cannot be read', () => {
    for (const targets of [undefined, null, 500, '500', [500], {}, { project: 80000 }, { daily: null }, { daily: '' }, { daily: 0 }, { daily: -5 }, { daily: 'a lot' }, { daily: '5e3' }, { daily: Number.NaN }, { daily: Infinity }, { daily: [500] }]) {
      expect(dailyTargetOf(targets), JSON.stringify(targets)).toBeNull();
    }
  });
});

describe('what the writing-progress screen offers', () => {
  it('is taken only when it can give the words of each day', () => {
    const service = { wordsByDay: async () => new Map<string, DayWords>() };
    expect(asProgressStats(service)).toBe(service); // the very same thing, so that it can be told from another one
    for (const other of [undefined, null, 'progress', 42, [], {}, { wordsByDay: 'soon' }, { summary: async () => ({}) }]) {
      expect(asProgressStats(other), JSON.stringify(other)).toBeNull();
    }
  });

  it('answers with a map of days, and anything else is left out', () => {
    const map = days({ '2026-10-10': [1200, 1500] });
    expect(asDays(map)).toBe(map);
    for (const other of [undefined, null, 'none', 42, {}, [], { get: () => undefined }]) expect(asDays(other), JSON.stringify(other)).toBeNull();
  });

  it('may leave a day out: nothing was written then', () => {
    const map = days({ '2026-10-10': [1200, 1500] });
    expect(wordsOn(map, '2026-10-10')).toEqual({ manuscript: 1200, all: 1500 });
    expect(wordsOn(map, '2026-10-11')).toEqual({ manuscript: 0, all: 0 });
    const odd = new Map<string, unknown>([['2026-10-12', { manuscript: 'many', all: 7 }], ['2026-10-13', 12]]) as Map<string, DayWords>;
    expect(wordsOn(odd, '2026-10-12')).toEqual({ manuscript: 0, all: 7 });
    expect(wordsOn(odd, '2026-10-13')).toEqual({ manuscript: 0, all: 0 });
  });

  it('is added up over a stretch of days, both ends included', () => {
    const map = days({ '2026-09-30': [10, 10], '2026-10-01': [100, 150], '2026-10-20': [-40, 5], '2026-10-31': [1, 2], '2026-11-01': [1000, 1000] });
    expect(sumWords(map, '2026-10-01', '2026-10-31')).toEqual({ manuscript: 61, all: 157 });
    expect(sumWords(new Map(), '2026-10-01', '2026-10-31')).toEqual({ manuscript: 0, all: 0 });
    const odd = new Map<string, unknown>([['2026-10-02', null], ['2026-10-03', { manuscript: Number.NaN, all: 3 }]]) as Map<string, DayWords>;
    expect(sumWords(odd, '2026-10-01', '2026-10-31')).toEqual({ manuscript: 0, all: 3 });
  });

  it('gives a total as one number or as the manuscript and all notes apart', () => {
    expect(totalOf({ manuscript: 1500, all: 2100 })).toEqual({ manuscript: 1500, all: 2100 });
    // One number is manuscript words; how many that makes in all notes is not known.
    const plain = totalOf(1500);
    expect(plain?.manuscript).toBe(1500);
    expect(Number.isNaN(plain?.all)).toBe(true);
    expect(Number.isNaN(totalOf({ manuscript: 1500 })?.all)).toBe(true);
    for (const other of [undefined, null, '1500', Number.NaN, {}, { all: 5 }, [1500]]) expect(totalOf(other), JSON.stringify(other)).toBeNull();
  });
});

describe('the numbers under the calendar', () => {
  const october = { year: 2026, month: 10 };
  const monthDays = days({ '2026-09-30': [999, 999], '2026-10-10': [1200, 1500], '2026-10-13': [300, 650] });
  const summary = { streak: 3, average: 420, weekTotal: { manuscript: 1500, all: 2150 }, monthTotal: 9999, dailyTarget: 250, dailyTargetMet: false };

  it('are the month added up from its own days, the summary, and today against the daily target', () => {
    const stats = statsFrom({ month: october, today: '2026-10-13', monthDays, todayWords: { manuscript: 300, all: 650 }, summary, targets: { daily: 500 } });
    expect(stats).toEqual({
      month: { manuscript: 1500, all: 2150 }, // the days of October only, whatever the summary says of "this month"
      week: { manuscript: 1500, all: 2150 },
      streak: 3,
      average: 420,
      target: { goal: 500, written: 300, met: false },
    });
  });

  it("takes the summary's word for whether the target is met, and works it out when the summary does not say", () => {
    const base = { month: october, today: '2026-10-13', monthDays, targets: { daily: 300 } };
    expect(statsFrom({ ...base, todayWords: { manuscript: 300, all: 650 }, summary }).target).toEqual({ goal: 300, written: 300, met: false });
    expect(statsFrom({ ...base, todayWords: { manuscript: 300, all: 650 }, summary: {} }).target).toEqual({ goal: 300, written: 300, met: true });
    expect(statsFrom({ ...base, todayWords: { manuscript: 299, all: 650 }, summary: null }).target).toEqual({ goal: 300, written: 299, met: false });
  });

  it("falls back on the summary's own target when the index has none, and shows none when nobody has one", () => {
    const base = { month: october, today: '2026-10-13', monthDays, todayWords: { manuscript: 300, all: 650 } };
    expect(statsFrom({ ...base, summary, targets: undefined }).target).toEqual({ goal: 250, written: 300, met: false });
    expect(statsFrom({ ...base, summary: { dailyTarget: 0 }, targets: { project: 80000 } }).target).toBeNull();
    expect(statsFrom({ ...base, summary: null, targets: null }).target).toBeNull();
    // A target without today's words says nothing.
    expect(statsFrom({ ...base, todayWords: null, summary, targets: { daily: 500 } }).target).toBeNull();
  });

  it('leaves out whatever it was not given', () => {
    expect(statsFrom({ month: october, today: '2026-10-13', monthDays: null, todayWords: null, summary: null, targets: null })).toEqual({
      month: null,
      week: null,
      streak: null,
      average: null,
      target: null,
    });
    const odd = { streak: '3', average: Number.NaN, weekTotal: 'lots', dailyTarget: '500', dailyTargetMet: 'yes' };
    expect(statsFrom({ month: october, today: '2026-10-13', monthDays: null, todayWords: null, summary: odd, targets: [] })).toEqual({
      month: null,
      week: null,
      streak: null,
      average: null,
      target: null,
    });
  });
});
