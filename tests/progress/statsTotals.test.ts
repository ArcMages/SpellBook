import { describe, expect, it } from 'vitest';
import {
  NO_WORDS,
  addToTotals,
  countsOn,
  parseStatsFile,
  sumDeviceLogs,
  summariseWords,
  totalsForMonth,
  totalsForRange,
  totalsForWeek,
  writingAverage,
  writingStreak,
} from '../../src/core/progress';
import type { DailyTotals, DayCounts, StatsDay } from '../../src/core/progress';

const day = (date: string, a: number, b = 0, c = 0, d = 0): StatsDay => ({
  date,
  manuscriptAdded: a,
  manuscriptDeleted: b,
  otherAdded: c,
  otherDeleted: d,
});

const counts = (a: number, b = 0, c = 0, d = 0): DayCounts => ({
  manuscriptAdded: a,
  manuscriptDeleted: b,
  otherAdded: c,
  otherDeleted: d,
});

const log = (device: string, ...days: StatsDay[]) => ({ device, days });

/** Totals for one device with the given days. */
const totalsOf = (...days: StatsDay[]): DailyTotals => sumDeviceLogs([log('desk', ...days)]);

describe('sumDeviceLogs', () => {
  it('adds the same day of different devices together', () => {
    const totals = sumDeviceLogs([
      log('phone', day('2026-10-12', 100, 5), day('2026-10-13', 200, 0, 10, 1)),
      log('desk', day('2026-10-13', 1000, 50, 0, 2), day('2026-10-14', 7)),
      log('ipad', day('2026-10-13', 30)),
    ]);
    expect([...totals]).toEqual([
      ['2026-10-12', counts(100, 5)],
      ['2026-10-13', counts(1230, 50, 10, 3)],
      ['2026-10-14', counts(7)],
    ]);
  });

  it('adds the months of one device together without mixing their days', () => {
    const totals = sumDeviceLogs([log('desk', day('2026-09-30', 10)), log('desk', day('2026-10-01', 20))]);
    expect([...totals]).toEqual([
      ['2026-09-30', counts(10)],
      ['2026-10-01', counts(20)],
    ]);
  });

  it("does not count a sync-conflict copy of one device's file twice", () => {
    // Two files that both say they are the desk's October: an older copy and the current one.
    const totals = sumDeviceLogs([
      log('desk', day('2026-10-13', 900, 40), day('2026-10-12', 500)),
      log('desk', day('2026-10-13', 1000, 30, 5)),
      log('phone', day('2026-10-13', 1)),
    ]);
    expect(countsOn(totals, '2026-10-13')).toEqual(counts(1001, 40, 5, 0));
    expect(countsOn(totals, '2026-10-12')).toEqual(counts(500));
  });

  it('counts each file that does not say its device as a device of its own', () => {
    const totals = sumDeviceLogs([log('', day('2026-10-13', 10)), log('', day('2026-10-13', 10))]);
    expect(countsOn(totals, '2026-10-13')).toEqual(counts(20));
  });

  it('gives the days in date order and leaves out days with nothing', () => {
    const totals = sumDeviceLogs([log('a', day('2026-10-13', 1), day('2026-10-02', 0)), log('b', day('2026-10-01', 2), day('2025-12-31', 3))]);
    expect([...totals.keys()]).toEqual(['2025-12-31', '2026-10-01', '2026-10-13']);
  });

  it('ignores a day whose date is not a real date, and copes with nothing at all', () => {
    expect([...sumDeviceLogs([log('a', day('2026-02-30', 5), day('soon', 5))])]).toEqual([]);
    expect([...sumDeviceLogs([])]).toEqual([]);
  });

  it('adds up files read from text, unknown columns and all', () => {
    const header = '| Date | Manuscript added | Manuscript deleted | Other added | Other deleted |';
    const phone = parseStatsFile(['---', 'device: phone', '---', header, '| 2026-10-13 | 200 | 0 | 10 | 1 | 45 |'].join('\n'));
    const desk = parseStatsFile(['---', 'device: desk', '---', header, '| 2026-10-13 | 1,000 | 50 | 0 | 2 |', '| broken |'].join('\n'));
    const totals = sumDeviceLogs([phone, desk]);
    expect(countsOn(totals, '2026-10-13')).toEqual(counts(1200, 50, 10, 3));
  });
});

describe('countsOn', () => {
  it('gives four zeros for a day with nothing', () => {
    expect(countsOn(totalsOf(day('2026-10-13', 5)), '2026-10-14')).toEqual(NO_WORDS);
    expect(countsOn(totalsOf(), 'whenever')).toEqual(NO_WORDS);
  });
});

describe('summariseWords', () => {
  it('works out the net, and "all" as manuscript plus other', () => {
    expect(summariseWords(counts(1200, 300, 45, 5))).toEqual({
      manuscript: { added: 1200, deleted: 300, net: 900 },
      other: { added: 45, deleted: 5, net: 40 },
      all: { added: 1245, deleted: 305, net: 940 },
    });
  });

  it('gives a negative net for a day of cutting', () => {
    expect(summariseWords(counts(10, 400)).manuscript.net).toBe(-390);
    expect(summariseWords(counts(10, 400, 0, 20)).all.net).toBe(-410);
    expect(summariseWords(NO_WORDS).all).toEqual({ added: 0, deleted: 0, net: 0 });
  });
});

describe('totals for a range, a week and a month', () => {
  const totals = sumDeviceLogs([
    log('desk', day('2026-09-30', 1), day('2026-10-01', 10, 1), day('2026-10-11', 100), day('2026-10-12', 1000, 0, 5), day('2026-10-13', 10000)),
    log('phone', day('2026-10-18', 20, 2, 0, 3), day('2026-10-19', 300), day('2026-10-31', 4000), day('2026-11-01', 50000)),
  ]);

  it('adds up a range, both ends included', () => {
    expect(totalsForRange(totals, '2026-10-11', '2026-10-13')).toEqual(counts(11100, 0, 5, 0));
    expect(totalsForRange(totals, '2026-10-13', '2026-10-13')).toEqual(counts(10000));
    expect(totalsForRange(totals, '2026-10-14', '2026-10-17')).toEqual(NO_WORDS);
    expect(totalsForRange(totals, '2026-01-01', '2026-12-31')).toEqual(counts(65431, 3, 5, 3));
  });

  it('gives nothing for a range that runs backwards or is not made of real dates', () => {
    expect(totalsForRange(totals, '2026-10-13', '2026-10-11')).toEqual(NO_WORDS);
    expect(totalsForRange(totals, '', '2026-10-13')).toEqual(NO_WORDS);
    expect(totalsForRange(totals, '2026-10-01', 'later')).toEqual(NO_WORDS);
  });

  it('adds up the week of a date, from Monday', () => {
    // 2026-10-13 is a Tuesday: its week runs from Monday the 12th to Sunday the 18th.
    expect(totalsForWeek(totals, '2026-10-13')).toEqual(counts(11020, 2, 5, 3));
    expect(totalsForWeek(totals, '2026-10-18')).toEqual(counts(11020, 2, 5, 3));
    expect(totalsForWeek(totals, '2026-10-19')).toEqual(counts(300));
  });

  it('adds up the week of a date, from Sunday', () => {
    // From Sunday the 11th to Saturday the 17th.
    expect(totalsForWeek(totals, '2026-10-13', 0)).toEqual(counts(11100, 0, 5, 0));
    expect(totalsForWeek(totals, '2026-10-18', 0)).toEqual(counts(320, 2, 0, 3));
  });

  it('adds up a month, and only that month', () => {
    expect(totalsForMonth(totals, '2026-10')).toEqual(counts(15430, 3, 5, 3));
    expect(totalsForMonth(totals, '2026-09')).toEqual(counts(1));
    expect(totalsForMonth(totals, '2026-11')).toEqual(counts(50000));
    expect(totalsForMonth(totals, '2026-12')).toEqual(NO_WORDS);
  });

  it('gives nothing for a month or a date that is not valid', () => {
    expect(totalsForMonth(totals, '2026-1')).toEqual(NO_WORDS);
    expect(totalsForMonth(totals, '2026')).toEqual(NO_WORDS);
    expect(totalsForWeek(totals, 'this week')).toEqual(NO_WORDS);
  });
});

describe('addToTotals', () => {
  const saved = totalsOf(day('2026-10-12', 500), day('2026-10-13', 100, 10));

  it('adds words that were counted but not saved yet', () => {
    const shown = addToTotals(saved, [
      { date: '2026-10-13', counts: { manuscriptAdded: 40, otherAdded: 3 } },
      { date: '2026-10-14', counts: { manuscriptDeleted: 2 } },
    ]);
    expect([...shown]).toEqual([
      ['2026-10-12', counts(500)],
      ['2026-10-13', counts(140, 10, 3, 0)],
      ['2026-10-14', counts(0, 2)],
    ]);
    expect(countsOn(saved, '2026-10-13')).toEqual(counts(100, 10)); // what it was given is not changed
  });

  it('takes back what an undo took back, never below zero', () => {
    const shown = addToTotals(saved, [{ date: '2026-10-13', counts: { manuscriptAdded: -30, manuscriptDeleted: -99 } }]);
    expect(countsOn(shown, '2026-10-13')).toEqual(counts(70, 0));
    const emptied = addToTotals(saved, [{ date: '2026-10-12', counts: { manuscriptAdded: -500 } }]);
    expect([...emptied.keys()]).toEqual(['2026-10-13']);
  });

  it('ignores a date that is not a real date', () => {
    expect([...addToTotals(saved, [{ date: 'now', counts: { manuscriptAdded: 5 } }])]).toEqual([...saved]);
  });
});

describe('writingStreak', () => {
  it('counts the days in a row up to today', () => {
    const totals = totalsOf(day('2026-10-10', 5), day('2026-10-11', 5), day('2026-10-12', 5), day('2026-10-13', 5));
    expect(writingStreak(totals, '2026-10-13')).toEqual({ current: 4, longest: 4, writtenToday: true });
  });

  it('gives today grace: nothing written yet today does not break the streak', () => {
    const totals = totalsOf(day('2026-10-10', 5), day('2026-10-11', 5), day('2026-10-12', 5));
    expect(writingStreak(totals, '2026-10-13')).toEqual({ current: 3, longest: 3, writtenToday: false });
  });

  it('is broken by a whole day without writing', () => {
    const totals = totalsOf(day('2026-10-09', 5), day('2026-10-10', 5), day('2026-10-11', 5));
    // The 12th was missed, and today (the 13th) has nothing yet.
    expect(writingStreak(totals, '2026-10-13')).toEqual({ current: 0, longest: 3, writtenToday: false });
    // Writing today starts a new one.
    const again = totalsOf(day('2026-10-09', 5), day('2026-10-10', 5), day('2026-10-11', 5), day('2026-10-13', 1));
    expect(writingStreak(again, '2026-10-13')).toEqual({ current: 1, longest: 3, writtenToday: true });
  });

  it('counts a day of only deleting as a day written', () => {
    const totals = totalsOf(day('2026-10-11', 5), day('2026-10-12', 0, 300), day('2026-10-13', 5));
    expect(writingStreak(totals, '2026-10-13').current).toBe(3);
  });

  it('finds the longest streak wherever it is', () => {
    const totals = totalsOf(
      day('2026-01-01', 1),
      day('2026-01-02', 1),
      day('2026-03-01', 1),
      day('2026-03-02', 1),
      day('2026-03-03', 1),
      day('2026-03-04', 1),
      day('2026-03-05', 1),
      day('2026-10-13', 1),
    );
    expect(writingStreak(totals, '2026-10-13')).toEqual({ current: 1, longest: 5, writtenToday: true });
  });

  it('runs across the end of a month, a year and a leap day', () => {
    const month = totalsOf(day('2026-09-29', 1), day('2026-09-30', 1), day('2026-10-01', 1));
    expect(writingStreak(month, '2026-10-01').current).toBe(3);
    const year = totalsOf(day('2025-12-30', 1), day('2025-12-31', 1), day('2026-01-01', 1), day('2026-01-02', 1));
    expect(writingStreak(year, '2026-01-02').current).toBe(4);
    const leap = totalsOf(day('2024-02-28', 1), day('2024-02-29', 1), day('2024-03-01', 1));
    expect(writingStreak(leap, '2024-03-01')).toEqual({ current: 3, longest: 3, writtenToday: true });
    const noLeap = totalsOf(day('2026-02-28', 1), day('2026-03-01', 1));
    expect(writingStreak(noLeap, '2026-03-01').current).toBe(2);
  });

  it('can look at the manuscript alone', () => {
    const totals = totalsOf(day('2026-10-11', 5), day('2026-10-12', 0, 0, 40), day('2026-10-13', 5));
    expect(writingStreak(totals, '2026-10-13', 'all').current).toBe(3);
    expect(writingStreak(totals, '2026-10-13', 'manuscript')).toEqual({ current: 1, longest: 1, writtenToday: true });
  });

  it('adds the devices up first: a day on the phone and a day on the desk make two days in a row', () => {
    const totals = sumDeviceLogs([log('phone', day('2026-10-12', 5)), log('desk', day('2026-10-13', 5))]);
    expect(writingStreak(totals, '2026-10-13').current).toBe(2);
  });

  it('does not count days after today as part of the streak up to today', () => {
    const totals = totalsOf(day('2026-10-13', 5), day('2026-10-14', 5), day('2026-10-15', 5));
    expect(writingStreak(totals, '2026-10-13')).toEqual({ current: 1, longest: 3, writtenToday: true });
  });

  it('gives no streak for nothing, or for a today that is not a real date', () => {
    expect(writingStreak(totalsOf(), '2026-10-13')).toEqual({ current: 0, longest: 0, writtenToday: false });
    expect(writingStreak(totalsOf(day('2026-10-13', 5)), 'today')).toEqual({ current: 0, longest: 1, writtenToday: false });
  });
});

describe('writingAverage', () => {
  it('divides by the days actually written, not by the days of the calendar', () => {
    // Three days written in a month of thirty-one.
    const totals = totalsOf(day('2026-10-01', 900), day('2026-10-15', 600, 300), day('2026-10-31', 300));
    expect(writingAverage(totals)).toEqual({ daysWritten: 3, added: 1800, deleted: 300, net: 1500, averageNet: 500, averageAdded: 600 });
  });

  it('counts a day of only deleting as a day written', () => {
    const totals = totalsOf(day('2026-10-01', 1000), day('2026-10-02', 0, 400));
    expect(writingAverage(totals)).toMatchObject({ daysWritten: 2, net: 600, averageNet: 300, averageAdded: 500 });
  });

  it('can be limited to a range of days', () => {
    const totals = totalsOf(day('2026-09-30', 5000), day('2026-10-01', 100), day('2026-10-02', 300), day('2026-11-01', 9000));
    expect(writingAverage(totals, 'all', { from: '2026-10-01', to: '2026-10-31' })).toMatchObject({ daysWritten: 2, net: 400, averageNet: 200 });
  });

  it('can look at the manuscript alone', () => {
    const totals = totalsOf(day('2026-10-01', 100, 0, 900), day('2026-10-02', 0, 0, 50));
    expect(writingAverage(totals, 'all')).toMatchObject({ daysWritten: 2, added: 1050, averageAdded: 525 });
    expect(writingAverage(totals, 'manuscript')).toMatchObject({ daysWritten: 1, added: 100, averageAdded: 100 });
  });

  it('rounds, and gives zero rather than dividing by nothing', () => {
    const totals = totalsOf(day('2026-10-01', 10), day('2026-10-02', 11), day('2026-10-03', 11));
    expect(writingAverage(totals).averageNet).toBe(11); // 32 / 3 = 10.67
    expect(writingAverage(totalsOf())).toEqual({ daysWritten: 0, added: 0, deleted: 0, net: 0, averageNet: 0, averageAdded: 0 });
  });
});
