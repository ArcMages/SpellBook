import { describe, expect, it } from 'vitest';
import { addDays } from '../../src/core/dates';
import {
  MAX_DAY_NUMBER,
  MAX_YEAR,
  MIN_DAY_NUMBER,
  MIN_YEAR,
  compareStoryDates,
  dayNumberToStoryDate,
  daysInMonth,
  formatStoryDate,
  formatStoryDateRange,
  isLeapYear,
  moveDates,
  readStoryDate,
  sameStoryDate,
  shiftStoryDate,
  storyDate,
  storyDateToDayNumber,
  storyDateToFrontmatter,
  storyDateToText,
} from '../../src/core/timeline';
import type { StoryDate } from '../../src/core/timeline';
import { date, dayOf, utcDay } from './helpers';

describe('storyDate', () => {
  it('takes its precision from what it is given', () => {
    expect(storyDate(1923)).toEqual({ precision: 'year', year: 1923, month: 1, day: 1 });
    expect(storyDate(1923, 4)).toEqual({ precision: 'month', year: 1923, month: 4, day: 1 });
    expect(storyDate(1923, 4, 12)).toEqual({ precision: 'day', year: 1923, month: 4, day: 12 });
  });

  it('allows the years 1 to 9999 and nothing outside them', () => {
    expect(MIN_YEAR).toBe(1);
    expect(MAX_YEAR).toBe(9999);
    expect(storyDate(1)).not.toBeNull();
    expect(storyDate(9999, 12, 31)).not.toBeNull();
    for (const year of [0, -1, -44, 10000, 1923.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(storyDate(year), String(year)).toBeNull();
    }
  });

  it('refuses months and days that do not exist', () => {
    expect(storyDate(1923, 0)).toBeNull();
    expect(storyDate(1923, 13)).toBeNull();
    expect(storyDate(1923, 4.5)).toBeNull();
    expect(storyDate(1923, 4, 0)).toBeNull();
    expect(storyDate(1923, 4, 31)).toBeNull(); // April has 30 days
    expect(storyDate(1923, 2, 29)).toBeNull();
    expect(storyDate(1923, 2, 28.5)).toBeNull();
    expect(storyDate(1923, undefined, 12)).toBeNull(); // a day without a month
  });

  it('knows the leap day: 2000 has one, 1900 does not', () => {
    expect(storyDate(2000, 2, 29)).not.toBeNull();
    expect(storyDate(2024, 2, 29)).not.toBeNull();
    expect(storyDate(1900, 2, 29)).toBeNull();
    expect(storyDate(2100, 2, 29)).toBeNull();
    expect(storyDate(2023, 2, 29)).toBeNull();
    expect(storyDate(4, 2, 29)).not.toBeNull();
    expect(storyDate(1, 2, 29)).toBeNull();
  });
});

describe('isLeapYear and daysInMonth', () => {
  it('follows the Gregorian rule, centuries included', () => {
    const leap = [4, 400, 1600, 1904, 1996, 2000, 2024, 2400, 9996];
    const common = [1, 100, 1700, 1800, 1900, 2023, 2100, 2200, 9999];
    for (const year of leap) expect(isLeapYear(year), String(year)).toBe(true);
    for (const year of common) expect(isLeapYear(year), String(year)).toBe(false);
  });

  it('gives every month its length', () => {
    const lengths = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((month) => daysInMonth(2023, month));
    expect(lengths).toEqual([31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]);
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(daysInMonth(2000, 2)).toBe(29);
    expect(daysInMonth(1900, 2)).toBe(28);
    expect(daysInMonth(2023, 0)).toBe(0);
    expect(daysInMonth(2023, 13)).toBe(0);
  });
});

describe('readStoryDate', () => {
  it('reads a bare number as a year', () => {
    expect(readStoryDate(1923)).toEqual(date(1923));
    expect(readStoryDate(1)).toEqual(date(1));
    expect(readStoryDate(9999)).toEqual(date(9999));
  });

  it('reads text in each of the three forms', () => {
    expect(readStoryDate('1923')).toEqual(date(1923));
    expect(readStoryDate('1923-04')).toEqual(date(1923, 4));
    expect(readStoryDate('1923-04-12')).toEqual(date(1923, 4, 12));
  });

  it('forgives short years, missing zeros and space around the date', () => {
    expect(readStoryDate('0001')).toEqual(date(1));
    expect(readStoryDate('923')).toEqual(date(923));
    expect(readStoryDate('0923-04')).toEqual(date(923, 4));
    expect(readStoryDate('1923-4-2')).toEqual(date(1923, 4, 2));
    expect(readStoryDate('  1923-04-12\n')).toEqual(date(1923, 4, 12));
  });

  it('uses the date part of a full date and time', () => {
    for (const text of [
      '1923-04-12T10:30:00Z',
      '1923-04-12T10:30',
      '1923-04-12 10:30:00',
      '1923-04-12T10:30:00.250+02:00',
      '1923-04-12t23:59:59z',
      '1923-04-12T1030',
    ]) {
      expect(readStoryDate(text), text).toEqual(date(1923, 4, 12));
    }
  });

  it('reads a calendar object, as some YAML readers make from a date', () => {
    expect(readStoryDate(new Date(Date.UTC(1923, 3, 12)))).toEqual(date(1923, 4, 12));
    expect(readStoryDate(new Date(Number.NaN))).toBeNull();
    expect(
      readStoryDate({
        toISOString() {
          throw new Error('broken');
        },
      }),
    ).toBeNull();
    expect(readStoryDate({ toISOString: () => 42 })).toBeNull();
  });

  it('gives null, and never throws, for anything that is not a date', () => {
    const odd: unknown[] = [
      undefined,
      null,
      '',
      '   ',
      true,
      false,
      [],
      [1923],
      {},
      { year: 1923 },
      () => 1923,
      Symbol('1923'),
      0,
      -44,
      10000,
      1923.5,
      Number.NaN,
      Number.NEGATIVE_INFINITY,
      '0',
      '0000',
      '10000',
      '-44',
      '1923-13',
      '1923-00',
      '1923-04-00',
      '1923-04-31',
      '1923-02-30',
      '1900-02-29',
      '2023-02-29',
      '1923/04/12',
      '12.04.1923',
      '12 Apr 1923',
      'soon',
      'אביב 1923',
      '1923-04-12 or so',
      '1923-04-12Tjunk',
      '1923-04-',
      '1923--12',
      '19230412',
    ];
    for (const value of odd) {
      expect(() => readStoryDate(value)).not.toThrow();
      expect(readStoryDate(value), String(value)).toBeNull();
    }
  });
});

describe('day numbers', () => {
  it('count whole days from 1 January 1970', () => {
    expect(dayOf(1970, 1, 1)).toBe(0);
    expect(dayOf(1970, 1, 2)).toBe(1);
    expect(dayOf(1969, 12, 31)).toBe(-1);
    expect(dayOf(2000, 3, 1)).toBe(11017);
    expect(MIN_DAY_NUMBER).toBe(dayOf(1, 1, 1));
    expect(MIN_DAY_NUMBER).toBe(-719162);
    expect(MAX_DAY_NUMBER).toBe(dayOf(9999, 12, 31));
    expect(MAX_DAY_NUMBER).toBe(2932896);
  });

  it('put a year or a month at its first day', () => {
    expect(storyDateToDayNumber(date(1923))).toBe(dayOf(1923, 1, 1));
    expect(storyDateToDayNumber(date(1923, 1))).toBe(dayOf(1923, 1, 1));
    expect(storyDateToDayNumber(date(1923, 4))).toBe(dayOf(1923, 4, 1));
  });

  it("agree with JavaScript's own calendar at every month end, in ordinary and awkward years", () => {
    for (const year of [1, 2, 4, 99, 100, 400, 1582, 1899, 1900, 1901, 1999, 2000, 2001, 2023, 2024, 2100, 9998, 9999]) {
      for (let month = 1; month <= 12; month++) {
        const last = daysInMonth(year, month);
        expect(dayOf(year, month, 1), `${year}-${month}-1`).toBe(utcDay(year, month, 1));
        expect(dayOf(year, month, last), `${year}-${month}-${last}`).toBe(utcDay(year, month, last));
      }
    }
  });

  it('turn back into the same date, across the whole calendar', () => {
    // Every 97th day from year 1 to year 9999, against JavaScript's own calendar.
    for (let day = MIN_DAY_NUMBER; day <= MAX_DAY_NUMBER; day += 97) {
      const made = dayNumberToStoryDate(day);
      const moment = new Date(day * 86_400_000);
      expect([made.year, made.month, made.day], String(day)).toEqual([
        moment.getUTCFullYear(),
        moment.getUTCMonth() + 1,
        moment.getUTCDate(),
      ]);
      expect(storyDateToDayNumber(made)).toBe(day);
    }
  });

  it('walk day by day through leap days, century years and both ends of the calendar', () => {
    const stretches: Array<[number, number]> = [
      [MIN_DAY_NUMBER, MIN_DAY_NUMBER + 800],
      [MAX_DAY_NUMBER - 800, MAX_DAY_NUMBER],
      [dayOf(1899, 12, 1), dayOf(1900, 3, 31)],
      [dayOf(1999, 12, 1), dayOf(2000, 3, 31)],
      [dayOf(2023, 12, 1), dayOf(2024, 3, 31)],
    ];
    for (const [from, to] of stretches) {
      let previous = dayNumberToStoryDate(from);
      expect(storyDateToDayNumber(previous)).toBe(from);
      for (let day = from + 1; day <= to; day++) {
        const made = dayNumberToStoryDate(day);
        expect(storyDateToDayNumber(made)).toBe(day);
        expect(storyDate(made.year, made.month, made.day), `${made.year}-${made.month}-${made.day}`).not.toBeNull();
        expect(compareStoryDates(previous, made)).toBeLessThan(0);
        previous = made;
      }
    }
    expect(storyDateToText(dayNumberToStoryDate(dayOf(1900, 2, 28) + 1))).toBe('1900-03-01');
    expect(storyDateToText(dayNumberToStoryDate(dayOf(2000, 2, 28) + 1))).toBe('2000-02-29');
  });

  it('agree with the calendar the rest of the plugin uses', () => {
    for (const day of [-719162, -200000, -1, 0, 1, 59, 60, 11016, 11017, 20000, 2932896]) {
      expect(storyDateToText(dayNumberToStoryDate(day)), String(day)).toBe(addDays('1970-01-01', day));
    }
  });

  it('give the month or the year a day falls in', () => {
    const day = dayOf(1923, 4, 12);
    expect(dayNumberToStoryDate(day, 'day')).toEqual(date(1923, 4, 12));
    expect(dayNumberToStoryDate(day, 'month')).toEqual(date(1923, 4));
    expect(dayNumberToStoryDate(day, 'year')).toEqual(date(1923));
    expect(dayNumberToStoryDate(dayOf(1923, 12, 31), 'year')).toEqual(date(1923));
    expect(dayNumberToStoryDate(dayOf(1924, 1, 1), 'year')).toEqual(date(1924));
  });

  it('drop a fraction of a day and stop at the ends of the calendar', () => {
    expect(dayNumberToStoryDate(0.9)).toEqual(date(1970, 1, 1));
    expect(dayNumberToStoryDate(-0.1)).toEqual(date(1969, 12, 31));
    expect(dayNumberToStoryDate(-1e9)).toEqual(date(1, 1, 1));
    expect(dayNumberToStoryDate(1e9)).toEqual(date(9999, 12, 31));
    expect(dayNumberToStoryDate(Number.POSITIVE_INFINITY, 'year')).toEqual(date(9999));
    expect(dayNumberToStoryDate(Number.NEGATIVE_INFINITY, 'month')).toEqual(date(1, 1));
    expect(dayNumberToStoryDate(Number.NaN)).toEqual(date(1, 1, 1));
  });
});

describe('comparing and sorting', () => {
  it('sorts dates of mixed precision by the day they stand on', () => {
    const shuffled = [date(1923, 4, 12), date(1920), date(1923, 4), date(9999, 12, 31), date(1), date(1923, 3, 31)];
    const sorted = [...shuffled].sort(compareStoryDates).map(storyDateToText);
    expect(sorted).toEqual(['0001', '1920', '1923-03-31', '1923-04', '1923-04-12', '9999-12-31']);
  });

  it('puts the less exact date first when two stand on the same day', () => {
    const sameDay = [date(1923, 1, 1), date(1923, 1), date(1923)];
    expect([...sameDay].sort(compareStoryDates).map(storyDateToText)).toEqual(['1923', '1923-01', '1923-01-01']);
    expect(compareStoryDates(date(1923), date(1923))).toBe(0);
  });

  it('tells whether two dates are the same', () => {
    expect(sameStoryDate(date(1923, 4), date(1923, 4))).toBe(true);
    expect(sameStoryDate(date(1923), date(1923, 1))).toBe(false); // same day, different precision
    expect(sameStoryDate(date(1923, 4, 12), date(1923, 4, 13))).toBe(false);
  });
});

describe('formatting', () => {
  it('writes dates in English', () => {
    expect(formatStoryDate(date(1923, 4, 12))).toBe('12 Apr 1923');
    expect(formatStoryDate(date(1923, 4))).toBe('Apr 1923');
    expect(formatStoryDate(date(1923))).toBe('1923');
    expect(formatStoryDate(date(1))).toBe('1');
    expect(formatStoryDate(date(1, 1, 1))).toBe('1 Jan 1');
    expect(formatStoryDate(date(9999, 12, 31))).toBe('31 Dec 9999');
  });

  it('names all twelve months', () => {
    const names = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((month) => formatStoryDate(date(2024, month)));
    expect(names.join(', ')).toBe(
      'Jan 2024, Feb 2024, Mar 2024, Apr 2024, May 2024, Jun 2024, Jul 2024, Aug 2024, Sep 2024, Oct 2024, Nov 2024, Dec 2024',
    );
  });

  it('writes a range with an en dash, and a single date when there is no range', () => {
    const enDash = String.fromCodePoint(0x2013);
    expect(formatStoryDateRange(date(1923, 4), date(1925))).toBe(`Apr 1923 ${enDash} 1925`);
    expect(formatStoryDateRange(date(1923, 4, 12), null)).toBe('12 Apr 1923');
    expect(formatStoryDateRange(date(1923), date(1923))).toBe('1923');
  });

  it('writes the text form with a four-digit year', () => {
    expect(storyDateToText(date(1923))).toBe('1923');
    expect(storyDateToText(date(1923, 4))).toBe('1923-04');
    expect(storyDateToText(date(1923, 4, 2))).toBe('1923-04-02');
    expect(storyDateToText(date(1))).toBe('0001');
    expect(storyDateToText(date(1, 2))).toBe('0001-02');
    expect(storyDateToText(date(923, 4, 12))).toBe('0923-04-12');
  });

  it('stores a year as a number and a month or day as text', () => {
    expect(storyDateToFrontmatter(date(1923))).toBe(1923);
    expect(storyDateToFrontmatter(date(1923, 4))).toBe('1923-04');
    expect(storyDateToFrontmatter(date(1923, 4, 12))).toBe('1923-04-12');
  });

  it('reads back whatever it writes, at both ends of the calendar too', () => {
    const samples: StoryDate[] = [
      date(1),
      date(1, 1),
      date(1, 1, 1),
      date(12, 4),
      date(1923, 4, 12),
      date(2000, 2, 29),
      date(9999),
      date(9999, 12),
      date(9999, 12, 31),
    ];
    for (const sample of samples) {
      expect(readStoryDate(storyDateToFrontmatter(sample)), storyDateToText(sample)).toEqual(sample);
      expect(readStoryDate(storyDateToText(sample)), storyDateToText(sample)).toEqual(sample);
    }
  });
});

describe('shiftStoryDate', () => {
  it('moves a day by days, through month ends and the leap day', () => {
    expect(shiftStoryDate(date(2024, 2, 28), 1)).toEqual(date(2024, 2, 29));
    expect(shiftStoryDate(date(2023, 2, 28), 1)).toEqual(date(2023, 3, 1));
    expect(shiftStoryDate(date(1923, 12, 31), 1)).toEqual(date(1924, 1, 1));
    expect(shiftStoryDate(date(1923, 5, 1), -1)).toEqual(date(1923, 4, 30));
  });

  it('moves a month by months and a year by years, keeping the precision', () => {
    expect(shiftStoryDate(date(1923, 12), 1)).toEqual(date(1924, 1));
    expect(shiftStoryDate(date(1923, 1), -1)).toEqual(date(1922, 12));
    expect(shiftStoryDate(date(1923, 4), 25)).toEqual(date(1925, 5));
    expect(shiftStoryDate(date(1923), 10)).toEqual(date(1933));
    expect(shiftStoryDate(date(1923), -1922)).toEqual(date(1));
  });

  it('stops at the ends of the calendar', () => {
    expect(shiftStoryDate(date(9999), 1)).toEqual(date(9999));
    expect(shiftStoryDate(date(1), -1)).toEqual(date(1));
    expect(shiftStoryDate(date(9999, 12), 5)).toEqual(date(9999, 12));
    expect(shiftStoryDate(date(1, 1), -5)).toEqual(date(1, 1));
    expect(shiftStoryDate(date(9999, 12, 31), 1)).toEqual(date(9999, 12, 31));
    expect(shiftStoryDate(date(1, 1, 1), -1)).toEqual(date(1, 1, 1));
  });

  it('ignores a fraction of a step and anything that is not a number', () => {
    expect(shiftStoryDate(date(1923, 4, 12), 2.9)).toEqual(date(1923, 4, 14));
    expect(shiftStoryDate(date(1923, 4, 12), Number.NaN)).toEqual(date(1923, 4, 12));
    expect(shiftStoryDate(date(1923, 4, 12), Number.POSITIVE_INFINITY)).toEqual(date(1923, 4, 12));
  });
});

describe('moveDates', () => {
  it('moves a single date to the target', () => {
    expect(moveDates(date(1923, 4, 12), null, date(1930, 1, 1))).toEqual({ start: date(1930, 1, 1), end: null });
  });

  it('keeps the length of a span of days', () => {
    // 8 days long; the new span crosses the leap day of 1924.
    expect(moveDates(date(1923, 4, 12), date(1923, 4, 20), date(1924, 2, 25))).toEqual({
      start: date(1924, 2, 25),
      end: date(1924, 3, 4),
    });
  });

  it('keeps the length of a span of months, however long the months are', () => {
    expect(moveDates(date(1923, 1), date(1923, 3), date(1923, 7))).toEqual({ start: date(1923, 7), end: date(1923, 9) });
    expect(moveDates(date(1923, 11), date(1924, 2), date(1922, 12))).toEqual({
      start: date(1922, 12),
      end: date(1923, 3),
    });
  });

  it('keeps the length of a span of years', () => {
    expect(moveDates(date(1914), date(1918), date(1939))).toEqual({ start: date(1939), end: date(1943) });
  });

  it('moves an end of another precision by the same amount, in its own units', () => {
    // Start known to the day, end to the month: one month later, so is the end.
    expect(moveDates(date(1923, 4, 12), date(1923, 6), date(1923, 5, 20))).toEqual({
      start: date(1923, 5, 20),
      end: date(1923, 7),
    });
    expect(moveDates(date(1923, 4, 12), date(1923, 6), date(1923, 4, 30)).end).toEqual(date(1923, 6));
    // Start known to the year, end to the day: two years are 731 days here.
    expect(moveDates(date(1923), date(1923, 3, 15), date(1925))).toEqual({ start: date(1925), end: date(1925, 3, 15) });
  });

  it('holds the start back when the end would pass the last day of 9999', () => {
    expect(moveDates(date(9990), date(9995), date(9998))).toEqual({ start: date(9994), end: date(9999) });
    expect(moveDates(date(9999, 8), date(9999, 10), date(9999, 12))).toEqual({
      start: date(9999, 10),
      end: date(9999, 12),
    });
    expect(moveDates(date(9999, 12, 1), date(9999, 12, 11), date(9999, 12, 30))).toEqual({
      start: date(9999, 12, 21),
      end: date(9999, 12, 31),
    });
  });

  it('moves a span to the very start of the calendar', () => {
    expect(moveDates(date(5), date(10), date(1))).toEqual({ start: date(1), end: date(6) });
    expect(moveDates(date(1923, 4, 12), date(1923, 4, 20), date(1, 1, 1))).toEqual({
      start: date(1, 1, 1),
      end: date(1, 1, 9),
    });
  });

  it('treats an end that is not later than the start as no span', () => {
    expect(moveDates(date(1923, 4, 12), date(1923, 4, 12), date(1924, 1, 1))).toEqual({ start: date(1924, 1, 1), end: null });
    expect(moveDates(date(1923, 4, 12), date(1920), date(1924, 1, 1))).toEqual({ start: date(1924, 1, 1), end: null });
  });
});
