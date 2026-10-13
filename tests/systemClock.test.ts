// The device's clock, as the plugin reads it: today's date, and how long it
// is until the date changes. The tests go by the time zone they run in, as
// the plugin goes by the time zone of the device.

import { describe, expect, it } from 'vitest';
import { localDay, localToday, untilNextDay, untilTomorrow } from '../src/obsidian/systemClock';

const HOUR = 60 * 60 * 1000;

describe('how long until the date changes', () => {
  it('is the time left until the next midnight on this device\'s own calendar', () => {
    const noon = new Date(2026, 9, 13, 12, 0, 0, 0).getTime();
    expect(untilNextDay(noon)).toBe(12 * HOUR);
    expect(localDay(noon)).toBe('2026-10-13');
    // That much later it is the next day; a moment earlier it is not yet.
    expect(localDay(noon + untilNextDay(noon))).toBe('2026-10-14');
    expect(localDay(noon + untilNextDay(noon) - 1)).toBe('2026-10-13');

    const lastSecond = new Date(2026, 9, 13, 23, 59, 59, 0).getTime();
    expect(untilNextDay(lastSecond)).toBe(1000);
    // At midnight itself the whole new day is still to come.
    const midnight = new Date(2026, 9, 14, 0, 0, 0, 0).getTime();
    expect(untilNextDay(midnight)).toBeGreaterThan(22 * HOUR);
    expect(localDay(midnight + untilNextDay(midnight))).toBe('2026-10-15');
  });

  it('crosses the end of a month and of a year', () => {
    const newYearsEve = new Date(2026, 11, 31, 20, 0, 0, 0).getTime();
    expect(untilNextDay(newYearsEve)).toBe(4 * HOUR);
    expect(localDay(newYearsEve + untilNextDay(newYearsEve))).toBe('2027-01-01');
    const leapDay = new Date(2028, 1, 28, 23, 0, 0, 0).getTime();
    expect(localDay(leapDay + untilNextDay(leapDay))).toBe('2028-02-29');
  });

  it('lands on the next day on every day of a year, also when the clocks change', () => {
    for (let day = 0; day < 366; day++) {
      const morning = new Date(2026, 0, 1 + day, 9, 30, 0, 0).getTime();
      const left = untilNextDay(morning);
      expect(left).toBeGreaterThan(12 * HOUR);
      expect(left).toBeLessThan(16 * HOUR);
      const next = new Date(2026, 0, 2 + day, 12, 0, 0, 0).getTime();
      expect(localDay(morning + left), String(day)).toBe(localDay(next));
    }
  });

  it('is asked of the clock as it stands now', () => {
    const left = untilTomorrow();
    expect(left).toBeGreaterThanOrEqual(0);
    expect(left).toBeLessThanOrEqual(25 * HOUR);
    expect(localDay(Date.now() + left + 1000)).not.toBe(localToday());
  });
});
