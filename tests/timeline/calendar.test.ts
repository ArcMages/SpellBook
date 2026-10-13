// Invented calendars: reading and checking one, counting its days, writing
// and reading its dates, and everything the timeline does with a date (the
// axis, a drag, moving a span) done in such a calendar.

import { describe, expect, it } from 'vitest';
import {
  CALENDAR_PRESETS,
  calendarDaysInMonth,
  calendarExampleText,
  calendarToIndexValue,
  calendarWeekday,
  checkCalendar,
  compareStoryDates,
  dateAtPosition,
  datesOutsideCalendar,
  dayNumberLimits,
  dayNumberToStoryDate,
  dayToPosition,
  describeEventProblem,
  dragDates,
  eraYearOf,
  fitAll,
  formatStoryDate,
  formatStoryDateRange,
  makeScale,
  moveDates,
  precisionForScale,
  readCalendar,
  readEvent,
  readStoryDate,
  readTimeline,
  redateEventPatch,
  runningYearOf,
  shiftStoryDate,
  storyDate,
  storyDateToDayNumber,
  storyDateToFrontmatter,
  storyDateToText,
  ticksFor,
  timelineExtent,
} from '../../src/core/timeline';
import type { StoryCalendar, StoryDate } from '../../src/core/timeline';
import { deepFreeze } from './helpers';

/** Read a calendar that must be usable. */
function calendarOf(value: unknown): StoryCalendar {
  const reading = readCalendar(value);
  if (reading.calendar === null) throw new Error(`The test's calendar could not be used: ${reading.problem}`);
  return reading.calendar;
}

/** Ten months of 36 days; the last gains 5 days every 4th year; two eras and one before them. */
const EMBER = calendarOf({
  name: 'Ember reckoning',
  months: ['Thaw', 'Seedfall', 'Greening', 'Highsun', 'Goldwane', 'Harvest', 'Mistfall', 'Frost', 'Deepnight', 'Turning'].map(
    (name) => ({ name, days: 36 }),
  ),
  weekdays: ['Sunrest', 'Moonrise', 'Tidesday', 'Windsday', 'Fireday', 'Stoneday'],
  eras: [
    { name: 'Age of Embers', short: 'AE', start: 1 },
    { name: 'Age of Tides', short: 'AT', start: 1204 },
  ],
  before: { name: 'Before the Embers', short: 'BE' },
  yearZero: false,
  leap: { month: 10, days: 5, every: 4 },
});

/** Hebrew month and era names, two months, no week, no leap years. */
const HEBREW_CALENDAR = calendarOf({
  name: 'לוח הממלכה',
  months: [
    { name: 'ניסן', days: 30 },
    { name: 'אייר', days: 29 },
  ],
  eras: [{ name: 'עידן המלכים', short: 'ע״מ' }],
});

function on(calendar: StoryCalendar, text: string): StoryDate {
  const date = readStoryDate(text, calendar);
  if (date === null) throw new Error(`The test asked for a date that does not exist: ${text}`);
  return date;
}

describe('reading a calendar from the project index', () => {
  it('is no calendar, and no problem, when nothing is stored', () => {
    for (const nothing of [undefined, null, '', '   ']) expect(readCalendar(nothing)).toEqual({ calendar: null, problem: null });
  });

  it('reads the name, months, week, eras, the era before, the year zero and the leap rule', () => {
    expect(EMBER.name).toBe('Ember reckoning');
    expect(EMBER.months).toHaveLength(10);
    expect(EMBER.months[0]).toEqual({ name: 'Thaw', days: 36 });
    expect(EMBER.weekdays).toHaveLength(6);
    expect(EMBER.eras.map((era) => [era.short, era.start])).toEqual([['AE', 1], ['AT', 1204]]);
    expect(EMBER.before).toEqual({ name: 'Before the Embers', short: 'BE' });
    expect(EMBER.yearZero).toBe(false);
    expect(EMBER.leap).toEqual({ month: 10, days: 5, every: 4 });
  });

  it('needs neither a week, nor an era before, nor leap years, nor the first era\'s start', () => {
    expect(HEBREW_CALENDAR.weekdays).toEqual([]);
    expect(HEBREW_CALENDAR.before).toBeNull();
    expect(HEBREW_CALENDAR.leap).toBeNull();
    expect(HEBREW_CALENDAR.eras[0]?.start).toBe(1);
    const zero = calendarOf({ name: 'Z', months: [{ name: 'M', days: 10 }], eras: [{ name: 'Era', short: 'E' }], yearZero: true });
    expect(zero.eras[0]?.start).toBe(0);
  });

  it('stores a calendar as plain data that reads back the same', () => {
    for (const calendar of [EMBER, HEBREW_CALENDAR]) {
      const stored = calendarToIndexValue(calendar);
      expect(JSON.parse(JSON.stringify(stored))).toEqual(stored);
      expect(readCalendar(stored)).toEqual({ calendar, problem: null });
    }
    expect(Object.keys(calendarToIndexValue(HEBREW_CALENDAR))).toEqual(['name', 'months', 'eras', 'yearZero']);
  });

  it('never throws, and says in plain words why a stored calendar cannot be used', () => {
    const base = { name: 'C', months: [{ name: 'M', days: 30 }], eras: [{ name: 'Era', short: 'E', start: 1 }] };
    const broken: Array<[unknown, RegExp]> = [
      ['a calendar', /group of properties/],
      [[1, 2], /group of properties/],
      [{ ...base, months: 'twelve' }, /"months" should be a list/],
      [{ ...base, months: [] }, /at least one month/],
      [{ ...base, months: [{ name: 'M', days: 0 }] }, /whole number of days/],
      [{ ...base, months: [{ name: 'M', days: 2.5 }] }, /whole number of days/],
      [{ ...base, months: [{ name: '', days: 30 }] }, /Month 1 needs a name/],
      [{ ...base, months: Array.from({ length: 100 }, () => ({ name: 'M', days: 1 })) }, /99 months at most/],
      [{ ...base, name: '' }, /Give the calendar a name/],
      [{ ...base, eras: [] }, /at least one era/],
      [{ ...base, eras: [{ name: 'Era', short: 'A E', start: 1 }] }, /must not have a space/],
      [{ ...base, eras: [{ name: 'Era', short: '2E', start: 1 }] }, /must not begin with a digit/],
      [{ ...base, eras: [{ name: 'Era', short: '', start: 1 }] }, /needs a short form/],
      [{ ...base, eras: [{ name: 'Era', short: 'E', start: 5 }] }, /first era begins in year 1/],
      [{ ...base, eras: [{ name: 'One', short: 'E', start: 1 }, { name: 'Two', short: 'e', start: 9 }] }, /share the short form/],
      [{ ...base, eras: [{ name: 'One', short: 'A', start: 1 }, { name: 'Two', short: 'B', start: 1 }] }, /must begin later/],
      [{ ...base, eras: [{ name: 'One', short: 'A', start: 1 }, { name: 'Two', short: 'B', start: 20000 }] }, /more than 9999 years/],
      [{ ...base, before: { name: 'Before', short: 'E' } }, /share the short form/],
      [{ ...base, leap: { month: 2, days: 1, every: 4 } }, /month that gains days/],
      [{ ...base, leap: { month: 1, days: 1, every: 1 } }, /every so many years/],
      [{ ...base, weekdays: 'Monday' }, /"weekdays" should be a list/],
    ];
    for (const [value, why] of broken) {
      const reading = readCalendar(deepFreeze(value));
      expect(reading.calendar, JSON.stringify(value)).toBeNull();
      expect(reading.problem, JSON.stringify(value)).toMatch(why);
      expect(reading.problem).toMatch(/^The story calendar in the project index could not be used/);
    }
  });

  it('offers three starting points: the real world, twelve months of thirty days, and a ten-month example', () => {
    expect(CALENDAR_PRESETS.map((preset) => preset.label)).toEqual([
      'Real world',
      'Twelve months of thirty days',
      'Ten months (an example)',
    ]);
    expect(CALENDAR_PRESETS[0]?.calendar).toBeNull();
    for (const preset of CALENDAR_PRESETS.slice(1)) {
      const calendar = preset.calendar as StoryCalendar;
      expect(checkCalendar(calendar), preset.label).toBeNull();
      expect(readCalendar(calendarToIndexValue(calendar)).calendar).toEqual(calendar);
    }
    expect(CALENDAR_PRESETS[1]?.calendar?.months.map((month) => month.days)).toEqual(Array.from({ length: 12 }, () => 30));
    expect(CALENDAR_PRESETS[2]?.calendar?.months).toHaveLength(10);
  });
});

describe('eras', () => {
  it('counts each era\'s years afresh, and the era before backwards', () => {
    expect(eraYearOf(EMBER, 1)).toEqual({ era: 0, year: 1 });
    expect(eraYearOf(EMBER, 1203)).toEqual({ era: 0, year: 1203 });
    expect(eraYearOf(EMBER, 1204)).toEqual({ era: 1, year: 1 });
    expect(eraYearOf(EMBER, 1250)).toEqual({ era: 1, year: 47 });
    expect(eraYearOf(EMBER, 0)).toEqual({ era: -1, year: 1 });
    expect(eraYearOf(EMBER, -11)).toEqual({ era: -1, year: 12 });
    for (const year of [-9998, -1, 0, 1, 600, 1203, 1204, 5000]) {
      const own = eraYearOf(EMBER, year);
      expect(runningYearOf(EMBER, own.era, own.year)).toBe(year);
    }
  });

  it('knows which years an era does not have', () => {
    expect(runningYearOf(EMBER, 0, 1204)).toBeNull(); // the Age of Tides had begun
    expect(runningYearOf(EMBER, 0, 0)).toBeNull();
    expect(runningYearOf(EMBER, 1, 9999)).toBe(1203 + 9999);
    expect(runningYearOf(EMBER, 1, 10000)).toBeNull();
    expect(runningYearOf(EMBER, -1, 0)).toBeNull();
    expect(runningYearOf(EMBER, 2, 1)).toBeNull();
    expect(runningYearOf(HEBREW_CALENDAR, -1, 5)).toBeNull(); // no era before
    expect(runningYearOf(EMBER, 0, 1.5)).toBeNull();
  });

  it('with a year zero, counts every era from 0', () => {
    const zero = calendarOf({
      name: 'Z',
      months: [{ name: 'M', days: 10 }],
      eras: [{ name: 'One', short: 'A' }, { name: 'Two', short: 'B', start: 100 }],
      before: { name: 'Before', short: 'BB' },
      yearZero: true,
    });
    expect(eraYearOf(zero, 0)).toEqual({ era: 0, year: 0 });
    expect(eraYearOf(zero, -1)).toEqual({ era: -1, year: 1 });
    expect(eraYearOf(zero, 100)).toEqual({ era: 1, year: 0 });
    expect(storyDateToText(on(zero, '0000-01-01 A'))).toBe('0000-01-01 A');
    expect(storyDateToDayNumber(on(zero, '0001 BB'))).toBe(-20);
    expect(storyDateToDayNumber(on(zero, '0000 B')) - storyDateToDayNumber(on(zero, '0000 A'))).toBe(1000);
  });
});

describe('counting days', () => {
  it('gives the leap month its extra days in every year the rule names', () => {
    expect(calendarDaysInMonth(EMBER, 3, 10)).toBe(36);
    expect(calendarDaysInMonth(EMBER, 4, 10)).toBe(41);
    expect(calendarDaysInMonth(EMBER, 4, 9)).toBe(36);
    expect(calendarDaysInMonth(EMBER, 0, 10)).toBe(41);
    expect(calendarDaysInMonth(EMBER, -4, 10)).toBe(41);
    expect(calendarDaysInMonth(EMBER, 4, 11)).toBe(0);
    expect(storyDate(4, 10, 41, EMBER)).not.toBeNull();
    expect(storyDate(3, 10, 37, EMBER)).toBeNull();
  });

  it('numbers the days from the first day of year 1, one after another without a gap', () => {
    expect(storyDateToDayNumber(on(EMBER, '0001-01-01 AE'))).toBe(0);
    expect(storyDateToDayNumber(on(EMBER, '0001-02-01 AE'))).toBe(36);
    expect(storyDateToDayNumber(on(EMBER, '0002 AE'))).toBe(360);
    expect(storyDateToDayNumber(on(EMBER, '0005 AE'))).toBe(4 * 360 + 5);
    expect(storyDateToDayNumber(on(EMBER, '0001 BE'))).toBe(-365); // year 0 is a leap year
    // Walk seven years day by day, across the era before and two leap years.
    let expected = storyDateToDayNumber(on(EMBER, '0003-01-01 BE'));
    for (let year = -2; year <= 5; year++) {
      for (let month = 1; month <= 10; month++) {
        for (let day = 1; day <= calendarDaysInMonth(EMBER, year, month); day++) {
          const date = storyDate(year, month, day, EMBER) as StoryDate;
          expect(storyDateToDayNumber(date)).toBe(expected);
          const back = dayNumberToStoryDate(expected, 'day', EMBER);
          expect([back.year, back.month, back.day]).toEqual([year, month, day]);
          expected++;
        }
      }
    }
  });

  it('turns any day number back into its date, however far from year 1', () => {
    for (const text of ['9999-10-36 BE', '0001-01-01 BE', '1203-10-36 AE', '0001-01-01 AT', '9999-10-36 AT', '0400-10-41 AE']) {
      const date = on(EMBER, text);
      const back = dayNumberToStoryDate(storyDateToDayNumber(date), 'day', EMBER);
      expect(storyDateToText(back), text).toBe(text);
      expect(back.calendar).toBe(EMBER);
    }
    const limits = dayNumberLimits(EMBER);
    expect(storyDateToText(dayNumberToStoryDate(limits.first, 'day', EMBER))).toBe('9999-01-01 BE');
    expect(storyDateToText(dayNumberToStoryDate(limits.last, 'day', EMBER))).toBe('9999-10-36 AT');
    // Beyond the calendar: the nearest end.
    expect(storyDateToText(dayNumberToStoryDate(limits.last + 5000, 'day', EMBER))).toBe('9999-10-36 AT');
    expect(storyDateToText(dayNumberToStoryDate(Number.NaN, 'year', EMBER))).toBe('9999 BE');
  });

  it('names the day of the week, when the calendar has a week', () => {
    expect(calendarWeekday(EMBER, 0)).toBe('Sunrest');
    expect(calendarWeekday(EMBER, 7)).toBe('Moonrise');
    expect(calendarWeekday(EMBER, -1)).toBe('Stoneday');
    expect(calendarWeekday(HEBREW_CALENDAR, 3)).toBe('');
  });

  it('leaves the real-world calendar exactly as it was', () => {
    expect(dayNumberLimits()).toEqual({ first: -719162, last: 2932896 });
    expect(dayNumberLimits(null)).toEqual(dayNumberLimits());
    const date = storyDate(1923, 4, 12);
    expect(date).toEqual({ precision: 'day', year: 1923, month: 4, day: 12 });
    expect(Object.keys(date as StoryDate)).toEqual(['precision', 'year', 'month', 'day']);
    expect(storyDate(1923, 4, 12, null)).toEqual(date);
  });
});

describe('a date as text', () => {
  it('is written as the year in its era, the month and the day, and the era\'s short form', () => {
    expect(storyDateToText(storyDate(1203, 4, 17, EMBER) as StoryDate)).toBe('1203-04-17 AE');
    expect(storyDateToText(storyDate(1203, 4, undefined, EMBER) as StoryDate)).toBe('1203-04 AE');
    expect(storyDateToText(storyDate(1203, undefined, undefined, EMBER) as StoryDate)).toBe('1203 AE');
    expect(storyDateToText(storyDate(1215, 1, 2, EMBER) as StoryDate)).toBe('0012-01-02 AT');
    expect(storyDateToText(storyDate(-11, 3, 1, EMBER) as StoryDate)).toBe('0012-03-01 BE');
    // Always text in a note, a year included: its era is part of it.
    expect(storyDateToFrontmatter(on(EMBER, '1203 AE'))).toBe('1203 AE');
    expect(storyDateToFrontmatter(storyDate(1923) as StoryDate)).toBe(1923);
    expect(calendarExampleText(EMBER)).toBe('0003-01-01 AT');
  });

  it('writes the day in three digits where a month can have a hundred days', () => {
    const long = calendarOf({ name: 'L', months: [{ name: 'Only', days: 360 }], eras: [{ name: 'Era', short: 'E' }] });
    expect(storyDateToText(on(long, '12-1-7 E'))).toBe('0012-01-007 E');
    expect(storyDateToText(on(long, '0012-01-360 E'))).toBe('0012-01-360 E');
    expect(readStoryDate('0012-01-361 E', long)).toBeNull();
  });

  it('sorts as text in date order within an era', () => {
    const texts = ['1203-04-17 AE', '0001 AE', '0999-10-36 AE', '1000-01-01 AE', '0001-01 AE', '0001-01-02 AE'];
    const byDate = [...texts].sort((a, b) => compareStoryDates(on(EMBER, a), on(EMBER, b)));
    expect(byDate).toEqual([...texts].sort());
  });

  it('reads back what it writes, whatever the capitals of the era', () => {
    for (const text of ['1203-04-17 AE', '1203-04 AE', '1203 AE', '0012-01-02 AT', '0012-03-01 BE']) {
      expect(storyDateToText(on(EMBER, text))).toBe(text);
    }
    expect(storyDateToText(on(EMBER, ' 1203-4-7  ae '))).toBe('1203-04-07 AE');
    expect(on(EMBER, '1203-04 AE')).toEqual({ precision: 'month', year: 1203, month: 4, day: 1, calendar: EMBER });
  });

  it('reads nothing but a date of the calendar: never a real-world date, never a date that does not exist', () => {
    const not: unknown[] = [
      '1923-04-12', // no era: a real-world date from before
      1923,
      '1203',
      '1203-04-17',
      '1203-04-17 XX', // no such era
      '1204 AE', // the Age of Tides had begun
      '0000 AE',
      '1203-11-01 AE', // no eleventh month
      '1203-04-37 AE',
      '1203-10-37 AE', // 1203 is not a leap year
      '1203-00-01 AE',
      '12345 AE',
      '1203-04-17T10:30 AE',
      'AE 1203',
      null,
      undefined,
      ['1203 AE'],
      { year: 1203 },
    ];
    for (const value of not) expect(readStoryDate(value, EMBER), JSON.stringify(value)).toBeNull();
    expect(readStoryDate('1204-10-41 AE', EMBER)).toBeNull();
    expect(readStoryDate('1200-10-41 AE', EMBER)).not.toBeNull();
    // And the other way round: a date with an era is not a real-world date.
    expect(readStoryDate('1203-04-17 AE')).toBeNull();
  });

  it('is shown with the calendar\'s own month and era names, Hebrew ones included', () => {
    expect(formatStoryDate(on(EMBER, '1203-04-17 AE'))).toBe('17 Highsun 1203 AE');
    expect(formatStoryDate(on(EMBER, '1203-04 AE'))).toBe('Highsun 1203 AE');
    expect(formatStoryDate(on(EMBER, '0012 BE'))).toBe('12 BE');
    expect(formatStoryDateRange(on(EMBER, '1203-10 AE'), on(EMBER, '0002 AT'))).toBe('Turning 1203 AE – 2 AT');
    const date = on(HEBREW_CALENDAR, '0012-02-29 ע״מ');
    expect(storyDateToText(date)).toBe('0012-02-29 ע״מ');
    expect(formatStoryDate(date)).toBe('29 אייר 12 ע״מ');
    expect(readStoryDate('0012-02-30 ע״מ', HEBREW_CALENDAR)).toBeNull();
  });
});

describe('moving dates in an invented calendar', () => {
  it('steps by the date\'s own unit: a day, a month of the calendar, a year', () => {
    expect(storyDateToText(shiftStoryDate(on(EMBER, '1203-10-36 AE'), 1))).toBe('0001-01-01 AT');
    expect(storyDateToText(shiftStoryDate(on(EMBER, '0001-01-01 AE'), -1))).toBe('0001-10-41 BE');
    expect(storyDateToText(shiftStoryDate(on(EMBER, '1203-10 AE'), 1))).toBe('0001-01 AT');
    expect(storyDateToText(shiftStoryDate(on(EMBER, '0005-03 AE'), -13))).toBe('0003-10 AE');
    expect(storyDateToText(shiftStoryDate(on(EMBER, '0001 AE'), -1))).toBe('0001 BE');
    expect(storyDateToText(shiftStoryDate(on(EMBER, '9999 AT'), 1))).toBe('9999 AT');
    expect(storyDateToText(shiftStoryDate(on(EMBER, '9999-01 BE'), -1))).toBe('9999-01 BE');
  });

  it('keeps a span\'s length when its start moves, in the end\'s own unit', () => {
    const moved = moveDates(on(EMBER, '0010-02-01 AE'), on(EMBER, '0010-02-11 AE'), on(EMBER, '1203-10-30 AE'));
    expect(storyDateToText(moved.start)).toBe('1203-10-30 AE');
    expect(storyDateToText(moved.end as StoryDate)).toBe('0001-01-04 AT');
    const months = moveDates(on(EMBER, '0010-02 AE'), on(EMBER, '0010-05 AE'), on(EMBER, '0010-09 AE'));
    expect(storyDateToText(months.end as StoryDate)).toBe('0011-02 AE');
    // Held back so that the end stays inside the calendar.
    const late = moveDates(on(EMBER, '0010 AE'), on(EMBER, '0012 AE'), on(EMBER, '9999 AT'));
    expect([storyDateToText(late.start), storyDateToText(late.end as StoryDate)]).toEqual(['9997 AT', '9999 AT']);
  });

  it('snaps a drag to the event\'s own precision, counting in the calendar', () => {
    const scale = makeScale(2, 0);
    const day = dragDates(on(EMBER, '0001-01-01 AE'), null, 80, scale);
    expect(storyDateToText(day.start)).toBe('0001-02-05 AE');
    const month = dragDates(on(EMBER, '0001-01 AE'), null, 80, scale);
    expect(storyDateToText(month.start)).toBe('0001-02 AE');
    const year = dragDates(on(EMBER, '0001 AE'), on(EMBER, '0003 AE'), -400, scale);
    expect([storyDateToText(year.start), storyDateToText(year.end as StoryDate)]).toEqual(['0001 BE', '0002 AE']);
    expect(year.start.calendar).toBe(EMBER);
  });

  it('dates a tap by the calendar, at a precision that suits the zoom and the length of its months', () => {
    expect(storyDateToText(dateAtPosition(makeScale(10, 0), 362, 'day', EMBER))).toBe('0001-02-01 AE');
    expect(storyDateToText(dateAtPosition(makeScale(1, 0), 700, 'year', EMBER))).toBe('0003 AE');
    expect(dateAtPosition(makeScale(10, 0), 362, 'day')).toEqual({ precision: 'day', year: 1970, month: 2, day: 6 });
    const long = calendarOf({ name: 'L', months: [{ name: 'Only', days: 360 }], eras: [{ name: 'Era', short: 'E' }] });
    expect(precisionForScale(makeScale(0.1, 0))).toBe('year');
    expect(precisionForScale(makeScale(0.1, 0), long)).toBe('month');
    expect(precisionForScale(makeScale(8, 0), long)).toBe('day');
  });
});

describe('the axis in an invented calendar', () => {
  const labels = (pxPerDay: number, origin: number, length = 800): string[] =>
    ticksFor(makeScale(pxPerDay, origin), length, 80, EMBER).ticks.map((tick) => tick.label);

  it('marks the calendar\'s own days, months and years, by how far the view is zoomed in', () => {
    const days = ticksFor(makeScale(100, 34), 400, 80, EMBER);
    expect(days.unit).toBe('day');
    expect(days.ticks.map((tick) => tick.label)).toEqual(['35 Thaw 1 AE', '36 Thaw 1 AE', '1 Seedfall 1 AE', '2 Seedfall 1 AE', '3 Seedfall 1 AE']);
    expect(days.ticks.map((tick) => tick.position)).toEqual([0, 100, 200, 300, 400]);

    const months = ticksFor(makeScale(3, 300), 400, 80, EMBER);
    expect(months.unit).toBe('month');
    expect(months.ticks.map((tick) => tick.label)).toEqual(['Deepnight 1 AE', 'Turning 1 AE', 'Thaw 2 AE', 'Seedfall 2 AE', 'Greening 2 AE']);
    expect(months.ticks.map((tick) => tick.day)).toEqual([288, 324, 360, 396, 432]);

    const years = ticksFor(makeScale(0.25, 0), 200, 80, EMBER);
    expect(years.unit).toBe('year');
    expect(years.ticks.map((tick) => tick.label)).toEqual(['1 AE', '2 AE', '3 AE']);
    expect(years.ticks.map((tick) => tick.day)).toEqual([0, 360, 720]);
  });

  it('steps by a year when a year is wide enough, however long the calendar\'s year is', () => {
    const short = calendarOf({
      name: 'S',
      months: [{ name: 'One', days: 5 }, { name: 'Two', days: 5 }],
      eras: [{ name: 'Era', short: 'E' }],
    });
    // A year of ten days at 10 pixels a day is 100 pixels: a mark a year, where the real world would mark months.
    expect(ticksFor(makeScale(10, 0), 300, 80, short).unit).toBe('year');
    expect(ticksFor(makeScale(10, 0), 300, 80).unit).toBe('month');
    expect(ticksFor(makeScale(1, 0), 300, 80, short).unit).toBe('decade');
  });

  it('marks round years as each era counts them, the era before counting backwards', () => {
    const origin = storyDateToDayNumber(on(EMBER, '0025 BE'));
    expect(labels(0.03, origin, 600)).toEqual(['30 BE', '20 BE', '10 BE', '1 AE', '10 AE', '20 AE', '30 AE']);
    const days = ticksFor(makeScale(0.03, origin), 600, 80, EMBER).ticks.map((tick) => tick.day);
    expect(days).toEqual([...days].sort((a, b) => a - b));
  });

  it('marks the first year of every era, and drops a round year that would crowd it', () => {
    const origin = storyDateToDayNumber(on(EMBER, '1190 AE'));
    const found = labels(0.03, origin, 600);
    expect(found).toContain('1 AT');
    expect(found).not.toContain('1200 AE'); // four years before the new era: too close to read both
    expect(found).toEqual(['1190 AE', '1 AT', '10 AT', '20 AT', '30 AT', '40 AT']);
  });

  it('stops at the ends of the calendar, and never makes more marks than a screen can hold', () => {
    const limits = dayNumberLimits(EMBER);
    const far = ticksFor(makeScale(0.00005, limits.first - 1e6), 1200, 80, EMBER);
    expect(far.unit).toBe('5-millennia');
    expect(far.ticks.length).toBeLessThan(20);
    for (const tick of far.ticks) expect(tick.day).toBeGreaterThanOrEqual(limits.first);
    expect(ticksFor(makeScale(1, limits.last + 10), 800, 80, EMBER).ticks).toEqual([]);
    expect(labels(0.03, limits.last - 100, 600)).toEqual(['9990 AT']);
  });

  it('labels with Hebrew month and era names', () => {
    const ticks = ticksFor(makeScale(3, 0), 240, 60, HEBREW_CALENDAR);
    expect(ticks.ticks.map((tick) => tick.label)).toEqual(['ניסן 1 ע״מ', 'אייר 1 ע״מ', 'ניסן 2 ע״מ']);
  });

  it('fits the events by their day numbers, as with any calendar', () => {
    const model = readTimeline(
      [
        { path: 'Timeline/A.md', frontmatter: { date: '0001-01-01 AE' } },
        { path: 'Timeline/B.md', frontmatter: { date: '0003 AE', end: '0003-10-36 AE' } },
      ],
      [],
      EMBER,
    );
    const extent = timelineExtent(model.dated);
    expect(extent).toEqual({ firstDay: 0, lastDay: 720 + 359 });
    const scale = fitAll(extent, 1127, { paddingStart: 24, paddingEnd: 24 });
    expect(dayToPosition(scale, 0)).toBeCloseTo(24);
    expect(dayToPosition(scale, 1079)).toBeCloseTo(1103);
  });
});

describe('events in a project with an invented calendar', () => {
  it('reads dates written in the calendar, and sorts them across eras', () => {
    const model = readTimeline(
      [
        { path: 'Timeline/Flood.md', frontmatter: { date: '0002 AT' } },
        { path: 'Timeline/Founding.md', frontmatter: { date: '0001-01-01 AE' } },
        { path: 'Timeline/Omen.md', frontmatter: { date: '0003 BE' } },
        { path: 'Timeline/Siege.md', frontmatter: { date: '1203-09 AE', end: '0001-02 AT' } },
      ],
      [{ path: 'Manuscript/Opening.md', frontmatter: { date: '1203-09-12 AE' } }],
      EMBER,
    );
    expect(model.dated.map((event) => event.title)).toEqual(['Omen', 'Founding', 'Siege', 'Opening', 'Flood']);
    expect(model.undated).toEqual([]);
    expect(model.dated[2]?.end).toEqual(on(EMBER, '0001-02 AT'));
    expect(model.dated.every((event) => event.start?.calendar === EMBER && event.problems.length === 0)).toBe(true);
  });

  it('never takes a real-world date for one of the calendar: the event is undated, and says why', () => {
    const event = readEvent('Timeline/Old.md', { date: '1923-04-12', end: 1924 }, EMBER);
    expect(event.start).toBeNull();
    expect(event.end).toBeNull();
    expect(event.problems).toEqual(['date-unreadable', 'end-unreadable']);
    const sentence = describeEventProblem('date-unreadable', EMBER);
    expect(sentence).toMatch(/not a date of the calendar "Ember reckoning"/);
    expect(sentence).toMatch(/Nothing was changed in the note/);
    expect(sentence).toMatch(/0003-01-01 AT/);
    expect(describeEventProblem('date-unreadable')).toMatch(/1923-04-12/);
    expect(describeEventProblem('date-unreadable', null)).toBe(describeEventProblem('date-unreadable'));
    // The same notes without a calendar are what they always were.
    expect(readEvent('Timeline/Old.md', { date: '1923-04-12', end: 1924 }).problems).toEqual([]);
  });

  it('lists the dates a calendar could not read, and changes nothing', () => {
    const notes = deepFreeze([
      { path: 'Timeline/Old.md', frontmatter: { date: '1923-04-12', end: 1924 } },
      { path: 'Timeline/New.md', frontmatter: { date: '0012-03 AE' } },
      { path: 'Timeline/Empty.md', frontmatter: { date: null, end: '' } },
      { path: 'Timeline/None.md', frontmatter: null },
      { path: 'Manuscript/Opening.md', frontmatter: { date: 'spring', synopsis: 'x' } },
    ]);
    expect(datesOutsideCalendar(notes, EMBER)).toEqual([
      { path: 'Timeline/Old.md', title: 'Old', property: 'date', value: '1923-04-12' },
      { path: 'Timeline/Old.md', title: 'Old', property: 'end', value: '1924' },
      { path: 'Manuscript/Opening.md', title: 'Opening', property: 'date', value: 'spring' },
    ]);
    // Going back to the real-world calendar, it is the invented dates that do not fit.
    expect(datesOutsideCalendar(notes, null)).toEqual([
      { path: 'Timeline/New.md', title: 'New', property: 'date', value: '0012-03 AE' },
      { path: 'Manuscript/Opening.md', title: 'Opening', property: 'date', value: 'spring' },
    ]);
    // Renaming a month changes how dates read, not whether they do.
    const renamed = calendarOf({ ...calendarToIndexValue(EMBER), months: EMBER.months.map((month) => ({ ...month, name: `${month.name}!` })) });
    expect(datesOutsideCalendar([{ path: 'Timeline/New.md', frontmatter: { date: '0012-03 AE' } }], renamed)).toEqual([]);
  });

  it('re-dates an event in the calendar: its precision kept, its span kept, written as the calendar writes', () => {
    const target = on(EMBER, '0001-01-10 AT');
    expect(redateEventPatch({ date: '1203-09-12 AE' }, target)).toEqual({ date: '0001-01-10 AT' });
    expect(redateEventPatch({ date: '1203-09 AE', end: '1203-10 AE' }, target)).toEqual({ date: '0001-01 AT', end: '0001-02 AT' });
    expect(redateEventPatch({ date: '1203 AE' }, target)).toEqual({ date: '0001 AT' });
    expect(redateEventPatch({ date: '0001-01-10 AT' }, target)).toEqual({});
    // A real-world date left in the note is not a date here: the event simply takes the new one, its old end untouched.
    expect(redateEventPatch({ date: '1923-04-12', end: '1923-05-01' }, target)).toEqual({ date: '0001-01-10 AT' });
    expect(redateEventPatch({}, on(EMBER, '0004 AE'))).toEqual({ date: '0004 AE' });
  });
});
