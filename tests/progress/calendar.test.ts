import { afterEach, describe, expect, it } from 'vitest';
import { addDays, formatLocalDate } from '../../src/core/dates';
import { dayNumber, dayOfWeek, daysBetween, isMonthText, monthOf, readDateProperty, weekRange } from '../../src/core/progress/calendar';
import { fixedRandom } from '../storeHarness';

const MS_PER_DAY = 86400000;

describe('dayNumber and daysBetween', () => {
  it('counts days from 1970-01-01', () => {
    expect(dayNumber('1970-01-01')).toBe(0);
    expect(dayNumber('1970-01-02')).toBe(1);
    expect(dayNumber('1969-12-31')).toBe(-1);
    expect(dayNumber('2000-03-01')).toBe(11017);
  });

  it("agrees with JavaScript's own calendar for two thousand random dates", () => {
    const random = fixedRandom(11);
    for (let i = 0; i < 2000; i++) {
      const year = 1600 + Math.floor(random() * 900);
      const month = 1 + Math.floor(random() * 12);
      const day = 1 + Math.floor(random() * 28);
      const date = formatLocalDate(year, month, day);
      expect(dayNumber(date), date).toBe(Date.UTC(year, month - 1, day) / MS_PER_DAY);
    }
  });

  it('agrees with addDays from the core, there and back', () => {
    const random = fixedRandom(5);
    for (let i = 0; i < 1000; i++) {
      const start = formatLocalDate(1900 + Math.floor(random() * 300), 1 + Math.floor(random() * 12), 1 + Math.floor(random() * 28));
      const days = Math.floor(random() * 20000) - 10000;
      expect(daysBetween(start, addDays(start, days)), `${start} + ${days}`).toBe(days);
      expect(daysBetween(addDays(start, days), start)).toBe(-days);
    }
  });

  it('knows leap years, including the century rule', () => {
    expect(daysBetween('2024-02-28', '2024-03-01')).toBe(2);
    expect(daysBetween('2026-02-28', '2026-03-01')).toBe(1);
    expect(daysBetween('2100-02-28', '2100-03-01')).toBe(1);
    expect(daysBetween('2000-02-28', '2000-03-01')).toBe(2);
    expect(daysBetween('2026-01-01', '2027-01-01')).toBe(365);
    expect(daysBetween('2024-01-01', '2025-01-01')).toBe(366);
  });

  it('gives null for anything that is not a real date', () => {
    for (const text of ['', 'today', '2026-02-30', '2026-13-01', '2026-10-13T10:00', ' 2026-10-13']) {
      expect(dayNumber(text), text).toBeNull();
      expect(daysBetween(text, '2026-10-13'), text).toBeNull();
      expect(daysBetween('2026-10-13', text), text).toBeNull();
      expect(dayOfWeek(text), text).toBeNull();
      expect(monthOf(text), text).toBeNull();
      expect(weekRange(text), text).toBeNull();
    }
  });
});

describe('dayOfWeek', () => {
  it('names the day, Sunday being 0', () => {
    expect(dayOfWeek('1970-01-01')).toBe(4); // a Thursday
    expect(dayOfWeek('2026-10-13')).toBe(2); // a Tuesday
    expect(dayOfWeek('2026-10-11')).toBe(0);
    expect(dayOfWeek('2026-10-17')).toBe(6);
    expect(dayOfWeek('1969-12-28')).toBe(0); // before 1970 as well
  });

  it("agrees with JavaScript's own calendar", () => {
    const random = fixedRandom(3);
    for (let i = 0; i < 1000; i++) {
      const year = 1700 + Math.floor(random() * 600);
      const month = 1 + Math.floor(random() * 12);
      const day = 1 + Math.floor(random() * 28);
      expect(dayOfWeek(formatLocalDate(year, month, day))).toBe(new Date(Date.UTC(year, month - 1, day)).getUTCDay());
    }
  });
});

describe('weekRange', () => {
  it('starts the week on Monday unless told otherwise', () => {
    expect(weekRange('2026-10-13')).toEqual({ from: '2026-10-12', to: '2026-10-18' });
    expect(weekRange('2026-10-12')).toEqual({ from: '2026-10-12', to: '2026-10-18' });
    expect(weekRange('2026-10-18')).toEqual({ from: '2026-10-12', to: '2026-10-18' });
  });

  it('can start the week on Sunday or any other day', () => {
    expect(weekRange('2026-10-13', 0)).toEqual({ from: '2026-10-11', to: '2026-10-17' });
    expect(weekRange('2026-10-11', 0)).toEqual({ from: '2026-10-11', to: '2026-10-17' });
    expect(weekRange('2026-10-13', 6)).toEqual({ from: '2026-10-10', to: '2026-10-16' });
    expect(weekRange('2026-10-13', 2)).toEqual({ from: '2026-10-13', to: '2026-10-19' });
    expect(weekRange('2026-10-13', 7)).toEqual(weekRange('2026-10-13', 0)); // 7 is Sunday again
    expect(weekRange('2026-10-13', Number.NaN)).toEqual(weekRange('2026-10-13', 1));
  });

  it('crosses months and years', () => {
    expect(weekRange('2026-01-01')).toEqual({ from: '2025-12-29', to: '2026-01-04' });
    expect(weekRange('2024-02-29', 0)).toEqual({ from: '2024-02-25', to: '2024-03-02' });
  });
});

describe('monthOf and isMonthText', () => {
  it('reads the month of a date', () => {
    expect(monthOf('2026-10-13')).toBe('2026-10');
    expect(monthOf('2024-02-29')).toBe('2024-02');
  });

  it('accepts months written as YYYY-MM only', () => {
    for (const text of ['2026-10', '2026-01', '2026-12', '0999-06']) expect(isMonthText(text), text).toBe(true);
    for (const text of ['2026-00', '2026-13', '2026-1', '26-10', '2026-10-13', '2026/10', '', ' 2026-10']) {
      expect(isMonthText(text), text).toBe(false);
    }
  });
});

describe('readDateProperty', () => {
  const realZone = process.env.TZ;
  afterEach(() => {
    if (realZone === undefined) delete process.env.TZ;
    else process.env.TZ = realZone;
  });

  it('reads a date, with or without a time after it', () => {
    expect(readDateProperty('2026-10-13')).toBe('2026-10-13');
    expect(readDateProperty('  2026-10-13  ')).toBe('2026-10-13');
    expect(readDateProperty('2026-10-13T08:30')).toBe('2026-10-13');
    expect(readDateProperty('2026-10-13 08:30:00')).toBe('2026-10-13');
    expect(readDateProperty('2026-10-13T00:00:00.000Z')).toBe('2026-10-13');
  });

  it('gives null for anything else', () => {
    for (const value of ['', 'last spring', 'אתמול', '2026-02-30', '2026-10-131', '2026-10-13x', '13/10/2026', 20261013, true, null, undefined, {}, []]) {
      expect(readDateProperty(value), String(value)).toBeNull();
    }
    expect(readDateProperty(new Date(Number.NaN))).toBeNull();
  });

  it('reads a date value the same in every time zone', () => {
    for (const zone of ['Pacific/Kiritimati', 'Pacific/Pago_Pago', 'Asia/Jerusalem', 'UTC']) {
      process.env.TZ = zone;
      expect(readDateProperty(new Date(Date.UTC(2026, 9, 13))), zone).toBe('2026-10-13');
      expect(readDateProperty(new Date(Date.UTC(2024, 1, 29))), zone).toBe('2024-02-29');
    }
  });
});

describe('time zones and daylight saving', () => {
  const realZone = process.env.TZ;
  afterEach(() => {
    if (realZone === undefined) delete process.env.TZ;
    else process.env.TZ = realZone;
  });

  it('cannot move any result: the sums are the same wherever the device is', () => {
    const answers = (): unknown[] => [
      daysBetween('2026-03-27', '2026-03-30'), // across the spring clock change in Israel and in Europe
      daysBetween('2026-10-24', '2026-10-26'), // across the autumn one
      dayOfWeek('2026-03-29'),
      weekRange('2026-10-25', 0),
      dayNumber('2026-11-01'),
    ];
    process.env.TZ = 'UTC';
    const expected = answers();
    expect(expected).toEqual([3, 2, 0, { from: '2026-10-25', to: '2026-10-31' }, 20758]);
    for (const zone of ['Asia/Jerusalem', 'Europe/London', 'America/New_York', 'Pacific/Kiritimati', 'Pacific/Pago_Pago']) {
      process.env.TZ = zone;
      expect(answers(), zone).toEqual(expected);
    }
  });
});
