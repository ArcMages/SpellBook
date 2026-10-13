import { describe, expect, it } from 'vitest';
import { addDays, formatLocalDate, isDateText } from '../../src/core/dates';
import {
  MONTH_NAMES,
  WEEKDAY_NAMES,
  WEEKDAY_SHORT_NAMES,
  dayTitle,
  daysInMonth,
  monthGrid,
  monthOf,
  monthRange,
  monthTitle,
  nextMonth,
  previousMonth,
  weekdayOf,
} from '../../src/core/planner';
import type { MonthGrid } from '../../src/core/planner';
import { fixedRandom } from '../storeHarness';

/** The weekday by JavaScript's own calendar, in UTC so no time zone is involved. */
function weekdayWithDate(date: string): number {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  const moment = new Date(Date.UTC(2000, month - 1, day));
  moment.setUTCFullYear(year); // Date.UTC would read years 0 to 99 as 1900 to 1999
  return moment.getUTCDay();
}

const dates = (grid: MonthGrid): string[][] => grid.weeks.map((week) => week.map((day) => day.date));

describe('weekdayOf', () => {
  it('knows some days', () => {
    expect(weekdayOf('2026-10-13')).toBe(2); // a Tuesday
    expect(weekdayOf('2026-10-01')).toBe(4); // a Thursday
    expect(weekdayOf('2026-01-01')).toBe(4);
    expect(weekdayOf('2024-02-29')).toBe(4);
    expect(weekdayOf('2000-01-01')).toBe(6); // a Saturday
    expect(weekdayOf('1970-01-01')).toBe(4);
    expect(weekdayOf('1900-03-01')).toBe(4);
    expect(weekdayOf('2100-02-28')).toBe(0); // a Sunday
  });

  it("agrees with JavaScript's own calendar for three thousand random dates", () => {
    const random = fixedRandom(3);
    for (let i = 0; i < 3000; i++) {
      const year = Math.floor(random() * 9998) + 1;
      const month = 1 + Math.floor(random() * 12);
      const day = 1 + Math.floor(random() * daysInMonth(year, month));
      const date = formatLocalDate(year, month, day);
      expect(weekdayOf(date), date).toBe(weekdayWithDate(date));
    }
  });

  it('moves on by one each day, through years and leap days', () => {
    let date = '1899-12-25';
    let weekday = weekdayOf(date) as number;
    for (let i = 0; i < 2000; i++) {
      date = addDays(date, 1);
      weekday = (weekday + 1) % 7;
      expect(weekdayOf(date), date).toBe(weekday);
    }
  });

  it('is null for text that is not a real date', () => {
    for (const text of ['', 'today', '2026-02-30', '2026-13-01', '2026-10-13T10:00', ' 2026-10-13']) {
      expect(weekdayOf(text), text).toBeNull();
    }
  });
});

describe('daysInMonth', () => {
  it('knows the months and the leap years, century rule included', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((month) => daysInMonth(2026, month))).toEqual([31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]);
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(daysInMonth(2000, 2)).toBe(29);
    expect(daysInMonth(1900, 2)).toBe(28);
    expect(daysInMonth(2100, 2)).toBe(28);
  });

  it('always names the last real day of the month', () => {
    for (let year = 1995; year <= 2105; year++) {
      for (let month = 1; month <= 12; month++) {
        const last = daysInMonth(year, month);
        expect(isDateText(formatLocalDate(year, month, last))).toBe(true);
        expect(isDateText(formatLocalDate(year, month, last + 1))).toBe(false);
      }
    }
  });
});

describe('monthGrid', () => {
  it('lays out October 2026 with weeks starting on Sunday', () => {
    const grid = monthGrid(2026, 10);
    expect(dates(grid)).toEqual([
      ['2026-09-27', '2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03'],
      ['2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10'],
      ['2026-10-11', '2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17'],
      ['2026-10-18', '2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24'],
      ['2026-10-25', '2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31'],
    ]);
    expect(grid.weeks[0]?.map((day) => day.inMonth)).toEqual([false, false, false, false, true, true, true]);
    expect(grid.weeks[0]?.map((day) => day.day)).toEqual([27, 28, 29, 30, 1, 2, 3]);
    expect(grid.weeks[0]?.map((day) => day.weekday)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(grid.weeks[4]?.every((day) => day.inMonth)).toBe(true);
    expect([grid.year, grid.month, grid.firstDayOfWeek, grid.from, grid.to]).toEqual([2026, 10, 0, '2026-09-27', '2026-10-31']);
    expect(grid.weekdays).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it('lays out the same month with weeks starting on Monday, and on Saturday', () => {
    const monday = monthGrid(2026, 10, 1);
    expect(dates(monday)[0]).toEqual(['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04']);
    expect(monday.weeks).toHaveLength(5);
    expect([monday.from, monday.to]).toEqual(['2026-09-28', '2026-11-01']);
    expect(monday.weekdays).toEqual([1, 2, 3, 4, 5, 6, 0]);
    expect(monday.weeks[4]?.map((day) => day.inMonth)).toEqual([true, true, true, true, true, true, false]);

    const saturday = monthGrid(2026, 10, 6);
    expect(dates(saturday)[0]).toEqual(['2026-09-26', '2026-09-27', '2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02']);
    expect(saturday.weeks).toHaveLength(6);
    expect([saturday.from, saturday.to]).toEqual(['2026-09-26', '2026-11-06']);
    expect(saturday.weekdays).toEqual([6, 0, 1, 2, 3, 4, 5]);
  });

  it('uses four, five or six weeks, as the month needs', () => {
    // February 2026 starts on a Sunday and has 28 days.
    const february = monthGrid(2026, 2, 0);
    expect(february.weeks).toHaveLength(4);
    expect([february.from, february.to]).toEqual(['2026-02-01', '2026-02-28']);
    expect(february.weeks.flat().every((day) => day.inMonth)).toBe(true);
    expect(monthGrid(2026, 2, 1).weeks).toHaveLength(5);
    // August 2026 starts on a Saturday and has 31 days.
    const august = monthGrid(2026, 8, 0);
    expect(august.weeks).toHaveLength(6);
    expect([august.from, august.to]).toEqual(['2026-07-26', '2026-09-05']);
    // A leap February.
    const leap = monthGrid(2024, 2, 0);
    expect(leap.weeks.flat().filter((day) => day.inMonth).map((day) => day.day)).toEqual(Array.from({ length: 29 }, (_, i) => i + 1));
    expect([leap.from, leap.to]).toEqual(['2024-01-28', '2024-03-02']);
  });

  it('crosses the year at both ends', () => {
    const december = monthGrid(2026, 12, 1);
    expect([december.from, december.to]).toEqual(['2026-11-30', '2027-01-03']);
    const january = monthGrid(2027, 1, 0);
    expect([january.from, january.to]).toEqual(['2026-12-27', '2027-02-06']);
  });

  it('holds for every month of eight years (leap, common, century) and every first day of the week', () => {
    for (const year of [1900, 2000, 2024, 2025, 2026, 2027, 2028, 2100]) {
      for (let month = 1; month <= 12; month++) {
        for (let weekStart = 0; weekStart <= 6; weekStart++) {
          const grid = monthGrid(year, month, weekStart);
          const days = grid.weeks.flat();
          const label = `${year}-${month} starting on ${weekStart}`;
          // whole weeks of seven, each day following the one before
          expect(grid.weeks.every((week) => week.length === 7), label).toBe(true);
          expect(days.length % 7).toBe(0);
          days.forEach((day, i) => {
            if (i > 0) expect(day.date, label).toBe(addDays(days[i - 1]?.date ?? '', 1));
          });
          expect([days[0]?.date, days[days.length - 1]?.date]).toEqual([grid.from, grid.to]);
          // the columns are the weekdays, starting from the one asked for
          expect(grid.weekdays[0]).toBe(weekStart);
          for (const day of days) {
            expect(day.weekday, `${label} ${day.date}`).toBe(weekdayOf(day.date));
            expect(day.day).toBe(Number(day.date.slice(8)));
            expect(day.inMonth).toBe(day.date.slice(0, 7) === formatLocalDate(year, month, 1).slice(0, 7));
          }
          for (const week of grid.weeks) expect(week.map((day) => day.weekday)).toEqual(grid.weekdays);
          // exactly the month, and no week without a day of it
          const inside = days.filter((day) => day.inMonth);
          expect(inside.map((day) => day.day), label).toEqual(Array.from({ length: daysInMonth(year, month) }, (_, i) => i + 1));
          expect(grid.weeks.every((week) => week.some((day) => day.inMonth)), label).toBe(true);
          expect(grid.weeks.length).toBeGreaterThanOrEqual(4);
          expect(grid.weeks.length).toBeLessThanOrEqual(6);
        }
      }
    }
  });

  it('never repeats or skips a day where the clocks change', () => {
    // Spring and autumn clock changes of 2026, in Israel, Europe and North America.
    for (const [year, month] of [[2026, 3], [2026, 10], [2026, 11]] as const) {
      const days = monthGrid(year, month, 0).weeks.flat().map((day) => day.date);
      expect(new Set(days).size).toBe(days.length);
      expect(days).toContain(formatLocalDate(year, month, 1));
    }
    expect(dates(monthGrid(2026, 3, 0))[4]).toEqual(['2026-03-29', '2026-03-30', '2026-03-31', '2026-04-01', '2026-04-02', '2026-04-03', '2026-04-04']);
  });

  it('tidies a first day of the week and a month that are out of range', () => {
    expect(monthGrid(2026, 10, 7).firstDayOfWeek).toBe(0);
    expect(monthGrid(2026, 10, -1).firstDayOfWeek).toBe(6);
    expect(monthGrid(2026, 10, 1.9).firstDayOfWeek).toBe(1);
    expect(monthGrid(2026, 10, Number.NaN).firstDayOfWeek).toBe(0);
    expect(dates(monthGrid(2026, 10, 8))).toEqual(dates(monthGrid(2026, 10, 1)));

    expect([monthGrid(2026, 13).year, monthGrid(2026, 13).month]).toEqual([2027, 1]);
    expect([monthGrid(2026, 0).year, monthGrid(2026, 0).month]).toEqual([2025, 12]);
    expect(() => monthGrid(Number.NaN, Number.NaN, Number.NaN)).not.toThrow();
    // the ends of what can be written with a four-digit year
    const first = monthGrid(-50, 1);
    expect([first.year, first.month]).toEqual([1, 1]);
    expect(new Set(first.weeks.flat().map((day) => day.date)).size).toBe(first.weeks.length * 7);
    const last = monthGrid(123456, 5, 3);
    expect([last.year, last.month]).toEqual([9998, 12]);
    expect(new Set(last.weeks.flat().map((day) => day.date)).size).toBe(last.weeks.length * 7);
    expect(last.weeks.flat().every((day) => isDateText(day.date))).toBe(true);
  });
});

describe('moving between months', () => {
  it('steps forwards and backwards across the year', () => {
    expect(nextMonth({ year: 2026, month: 10 })).toEqual({ year: 2026, month: 11 });
    expect(nextMonth({ year: 2026, month: 12 })).toEqual({ year: 2027, month: 1 });
    expect(previousMonth({ year: 2026, month: 10 })).toEqual({ year: 2026, month: 9 });
    expect(previousMonth({ year: 2026, month: 1 })).toEqual({ year: 2025, month: 12 });
  });

  it('goes there and back again for twenty years', () => {
    let month = { year: 2020, month: 1 };
    const seen: string[] = [];
    for (let i = 0; i < 240; i++) {
      seen.push(`${month.year}-${month.month}`);
      expect(previousMonth(nextMonth(month))).toEqual(month);
      month = nextMonth(month);
    }
    expect(month).toEqual({ year: 2040, month: 1 });
    expect(new Set(seen).size).toBe(240);
  });

  it('takes a month grid, so a screen can step from the grid it is showing', () => {
    const grid = monthGrid(2026, 12, 1);
    const next = nextMonth(grid);
    expect(next).toEqual({ year: 2027, month: 1 });
    expect(monthGrid(next.year, next.month, grid.firstDayOfWeek).from).toBe('2026-12-28');
    expect(previousMonth(grid)).toEqual({ year: 2026, month: 11 });
  });

  it('stops at the first and last month it can show', () => {
    expect(previousMonth({ year: 1, month: 1 })).toEqual({ year: 1, month: 1 });
    expect(nextMonth({ year: 9998, month: 12 })).toEqual({ year: 9998, month: 12 });
  });
});

describe('monthOf and monthRange', () => {
  it('finds the month of a date', () => {
    expect(monthOf('2026-10-13')).toEqual({ year: 2026, month: 10 });
    expect(monthOf('2024-02-29')).toEqual({ year: 2024, month: 2 });
    expect(monthOf('2026-02-29')).toBeNull();
    expect(monthOf('October')).toBeNull();
  });

  it('gives the first and last day of a month', () => {
    expect(monthRange(2026, 10)).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    expect(monthRange(2026, 2)).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(monthRange(2024, 2)).toEqual({ from: '2024-02-01', to: '2024-02-29' });
    expect(monthRange(2026, 13)).toEqual({ from: '2027-01-01', to: '2027-01-31' });
  });
});

describe('names', () => {
  it('are English', () => {
    expect(WEEKDAY_NAMES).toEqual(['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']);
    expect(WEEKDAY_SHORT_NAMES).toEqual(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);
    expect(MONTH_NAMES).toHaveLength(12);
    expect([MONTH_NAMES[0], MONTH_NAMES[9], MONTH_NAMES[11]]).toEqual(['January', 'October', 'December']);
  });

  it('give the column headings for any first day of the week', () => {
    expect(monthGrid(2026, 10, 1).weekdays.map((weekday) => WEEKDAY_SHORT_NAMES[weekday])).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
    expect(monthGrid(2026, 10, 0).weekdays.map((weekday) => WEEKDAY_NAMES[weekday])[0]).toBe('Sunday');
  });

  it('title a month and a day', () => {
    expect(monthTitle(2026, 10)).toBe('October 2026');
    expect(monthTitle(2027, 1)).toBe('January 2027');
    expect(monthTitle(2026, 13)).toBe('January 2027');
    expect(dayTitle('2026-10-20')).toBe('Tuesday, 20 October 2026');
    expect(dayTitle('2026-10-13')).toBe('Tuesday, 13 October 2026');
    expect(dayTitle('2024-02-29')).toBe('Thursday, 29 February 2024');
    expect(dayTitle('2027-01-03')).toBe('Sunday, 3 January 2027');
    expect(dayTitle('not a date')).toBe('not a date');
    expect(dayTitle('2026-02-30')).toBe('2026-02-30');
  });
});
