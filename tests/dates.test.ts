import { describe, expect, it } from 'vitest';
import {
  addDays,
  civilFromDays,
  dateOfDayNumber,
  dayNumber,
  daysBetween,
  daysFromCivil,
  formatLocalDate,
  isDateText,
} from '../src/core/dates';
import { fixedRandom } from './storeHarness';

/** The same sum done with JavaScript's own calendar, in UTC so no time zone is involved. */
function addDaysWithDate(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  const moved = new Date(Date.UTC(year, month - 1, day + days));
  return moved.toISOString().slice(0, 10);
}

describe('formatLocalDate', () => {
  it('pads the month, the day and short years', () => {
    expect(formatLocalDate(2026, 10, 13)).toBe('2026-10-13');
    expect(formatLocalDate(2026, 3, 7)).toBe('2026-03-07');
    expect(formatLocalDate(987, 1, 1)).toBe('0987-01-01');
  });
});

describe('isDateText', () => {
  it('accepts real dates written as YYYY-MM-DD', () => {
    for (const date of ['2026-10-13', '2024-02-29', '2000-02-29', '1999-12-31', '2026-01-01']) {
      expect(isDateText(date), date).toBe(true);
    }
  });

  it('refuses dates that do not exist and text in another shape', () => {
    for (const text of ['2026-02-29', '1900-02-29', '2026-13-01', '2026-00-10', '2026-04-31', '2026-10-00', '26-10-13', '2026/10/13', '2026-10-13T00:00', ' 2026-10-13', '', 'today']) {
      expect(isDateText(text), text).toBe(false);
    }
  });
});

describe('addDays', () => {
  it('moves within a month, across months and across years', () => {
    expect(addDays('2026-10-13', 0)).toBe('2026-10-13');
    expect(addDays('2026-10-13', 3)).toBe('2026-10-16');
    expect(addDays('2026-10-13', 10)).toBe('2026-10-23');
    expect(addDays('2026-10-30', 3)).toBe('2026-11-02');
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
  });

  it('knows leap years, including the century rule', () => {
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
    expect(addDays('2024-02-28', 2)).toBe('2024-03-01');
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
    expect(addDays('2000-02-28', 1)).toBe('2000-02-29');
    expect(addDays('2100-02-28', 1)).toBe('2100-03-01');
    expect(addDays('2024-03-01', -1)).toBe('2024-02-29');
  });

  it("agrees with JavaScript's own calendar for a thousand random sums", () => {
    const random = fixedRandom(7);
    for (let i = 0; i < 1000; i++) {
      const year = 1900 + Math.floor(random() * 300);
      const month = 1 + Math.floor(random() * 12);
      const day = 1 + Math.floor(random() * 28);
      const start = formatLocalDate(year, month, day);
      const days = Math.floor(random() * 4000) - 2000;
      expect(addDays(start, days), `${start} + ${days}`).toBe(addDaysWithDate(start, days));
    }
  });

  it('goes there and back again', () => {
    for (const days of [1, 30, 365, 366, 1461, 36524, 146097]) {
      expect(addDays(addDays('2026-10-13', days), -days)).toBe('2026-10-13');
    }
    expect(addDays('2026-10-13', 146097)).toBe('2426-10-13'); // the calendar repeats every 400 years
  });

  it('ignores a fraction of a day', () => {
    expect(addDays('2026-10-13', 2.9)).toBe('2026-10-15');
  });

  it('returns anything that is not a real date unchanged', () => {
    for (const text of ['', 'tomorrow', '2026-02-30', '2026-10-13 ', '13-10-2026']) {
      expect(addDays(text, 5)).toBe(text);
    }
    expect(addDays('2026-10-13', Number.NaN)).toBe('2026-10-13');
    expect(addDays('2026-10-13', Number.POSITIVE_INFINITY)).toBe('2026-10-13');
    expect(addDays('9999-12-31', 1)).toBe('9999-12-31'); // would no longer fit YYYY-MM-DD
  });
});

describe('day numbers', () => {
  it('count the days from the first of January 1970', () => {
    expect(dayNumber('1970-01-01')).toBe(0);
    expect(dayNumber('1970-01-02')).toBe(1);
    expect(dayNumber('1969-12-31')).toBe(-1);
    expect(dayNumber('2000-03-01')).toBe(11017);
    expect(dayNumber('2026-10-13')).toBe(Date.UTC(2026, 9, 13) / 86400000);
    expect(daysFromCivil(2026, 10, 13)).toBe(dayNumber('2026-10-13'));
    expect(civilFromDays(11017)).toEqual([2000, 3, 1]);
  });

  it('go there and back again for every day of a few thousand', () => {
    const start = dayNumber('1890-01-01') as number;
    for (let day = start; day < start + 60000; day += 7) {
      const date = dateOfDayNumber(day) as string;
      expect(isDateText(date), date).toBe(true);
      expect(dayNumber(date), date).toBe(day);
      expect(date).toBe(new Date(day * 86400000).toISOString().slice(0, 10));
    }
  });

  it('are null for anything that is not a real date, or not a whole day', () => {
    for (const text of ['', 'tomorrow', '2026-02-30', '2026-10-13 ', '13-10-2026']) {
      expect(dayNumber(text), text).toBeNull();
      expect(daysBetween(text, '2026-10-13'), text).toBeNull();
      expect(daysBetween('2026-10-13', text), text).toBeNull();
    }
    expect(dateOfDayNumber(1.5)).toBeNull();
    expect(dateOfDayNumber(Number.NaN)).toBeNull();
    expect(dateOfDayNumber(Number.POSITIVE_INFINITY)).toBeNull();
    expect(dateOfDayNumber((dayNumber('9999-12-31') as number) + 1)).toBeNull();
    expect(dateOfDayNumber(dayNumber('9999-12-31') as number)).toBe('9999-12-31');
  });

  it('give the days from one date to another, over months, years and leap days', () => {
    expect(daysBetween('2026-10-13', '2026-10-13')).toBe(0);
    expect(daysBetween('2026-10-13', '2026-10-14')).toBe(1);
    expect(daysBetween('2026-10-14', '2026-10-13')).toBe(-1);
    expect(daysBetween('2024-02-28', '2024-03-01')).toBe(2); // a leap year
    expect(daysBetween('2023-02-28', '2023-03-01')).toBe(1);
    expect(daysBetween('2025-12-31', '2026-01-01')).toBe(1);
    expect(daysBetween('2026-01-01', '2027-01-01')).toBe(365);
    expect(addDays('2026-10-13', daysBetween('2026-10-13', '2031-05-02') as number)).toBe('2031-05-02');
  });
});
