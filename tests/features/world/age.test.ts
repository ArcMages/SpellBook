// Ages, as the engine works them out: at death, at the story's present and
// at a scene's date, in the real-world calendar and in an invented one, with
// dates known to the year, the month or the day, and with dates missing or
// in the wrong order.

import { describe, expect, it } from 'vitest';
import { CALENDAR_PRESETS, readStoryDate } from '../../../src/core/timeline';
import type { StoryCalendar, StoryDate } from '../../../src/core/timeline';
import {
  BUILT_IN_TYPES,
  addType,
  ageAt,
  changeType,
  compareKnown,
  findType,
  latestDate,
  lifeAge,
  lifeYears,
  readEntityTime,
  readStoryPresent,
  showsAge,
  storyPresent,
  storyPresentValue,
  typedAgeShown,
  yearsBetween,
} from '../../../src/core/world';
import type { EntityTime, EntityType, StoryPresent } from '../../../src/core/world';

/** The ten-month calendar the Calendar window offers as an example: 36 days a month, "1203-04-17 AE". */
const EMBER = CALENDAR_PRESETS.find((preset) => preset.id === 'ten-months')?.calendar as StoryCalendar;

/** A date that must exist, in the real-world calendar or the one given. */
function at(written: string | number, calendar: StoryCalendar | null = null): StoryDate {
  const read = readStoryDate(written, calendar);
  if (read === null) throw new Error(`the test asked for a date that cannot be read: ${written}`);
  return read;
}

const life = (properties: Record<string, unknown>, calendar: StoryCalendar | null = null): EntityTime => readEntityTime(properties, calendar);
const present = (written: string | number, source: StoryPresent['source'] = 'set', calendar: StoryCalendar | null = null): StoryPresent => ({
  date: at(written, calendar),
  source,
});
const typeOf = (id: string): EntityType => findType(BUILT_IN_TYPES, id) as EntityType;

describe('years between two dates', () => {
  it('counts whole years, the birthday counting only once it has come', () => {
    expect(yearsBetween(at('1889-04-17'), at('1923-04-16'))).toBe(33);
    expect(yearsBetween(at('1889-04-17'), at('1923-04-17'))).toBe(34);
    expect(yearsBetween(at('1889-04-17'), at('1923-03'))).toBe(33);
    expect(yearsBetween(at('1889-04-17'), at('1923-05'))).toBe(34);
    expect(yearsBetween(at('2000-02-29'), at('2001-02-28'))).toBe(0);
    expect(yearsBetween(at('2000-02-29'), at('2001-03-01'))).toBe(1);
  });

  it('counts the years alone when either date is known only to the year', () => {
    expect(yearsBetween(at(1889), at('1923-01-02'))).toBe(34);
    expect(yearsBetween(at('1889-12-31'), at(1923))).toBe(34);
    // The month counts when both give it; the day does not when one gives only the month.
    expect(yearsBetween(at('1889-04'), at('1923-04-01'))).toBe(34);
    expect(yearsBetween(at('1889-04-30'), at('1923-04'))).toBe(34);
  });

  it('gives null for a date before the first, and 0 within the same year', () => {
    expect(yearsBetween(at('1889-04-17'), at('1889-04-16'))).toBeNull();
    expect(yearsBetween(at(1889), at(1888))).toBeNull();
    expect(yearsBetween(at('1889-04-17'), at(1889))).toBe(0);
    expect(yearsBetween(at('1889-04-17'), at('1889-04-17'))).toBe(0);
  });

  it('compares dates only as exactly as both are known', () => {
    expect(compareKnown(at(1889), at('1889-04-17'))).toBe(0);
    expect(compareKnown(at('1889-03'), at('1889-04-17'))).toBeLessThan(0);
    expect(compareKnown(at('1889-04'), at('1889-04-17'))).toBe(0);
    expect(compareKnown(at('1889-04-18'), at('1889-04-17'))).toBeGreaterThan(0);
  });

  it('counts the years of an invented calendar in its own months and eras', () => {
    expect(yearsBetween(at('1180-04-17 AE', EMBER), at('1203-04-16 AE', EMBER))).toBe(22);
    expect(yearsBetween(at('1180-04-17 AE', EMBER), at('1203-04-17 AE', EMBER))).toBe(23);
    // The tenth month exists, and its 38th day in a leap year: still before the next year's birthday.
    expect(yearsBetween(at('1180-10-36 AE', EMBER), at('1204-10-38 AE', EMBER))).toBe(24);
    expect(yearsBetween(at('1180-10-36 AE', EMBER), at('1203-01 AE', EMBER))).toBe(22);
    // Across the eras: from 12 before the Embers to 10 of them, with no year 0 between.
    expect(yearsBetween(at('12 BE', EMBER), at('10 AE', EMBER))).toBe(21);
    expect(yearsBetween(at('1203 AE', EMBER), at('1180 AE', EMBER))).toBeNull();
  });
});

describe('which types have an age', () => {
  it('is a character, whatever its dates are called, and any type whose first date is "Born"', () => {
    expect(BUILT_IN_TYPES.filter((type) => showsAge(type)).map((type) => type.id)).toEqual(['character']);
    expect(showsAge(null)).toBe(false);
    const hebrew = changeType(BUILT_IN_TYPES, 'character', { dateWords: 'נולדה, נפטרה' });
    if (!hebrew.ok) throw new Error(hebrew.message);
    expect(showsAge(findType(hebrew.types, 'character'))).toBe(true);
    // A creature is "First known" until the writer says it is born.
    expect(showsAge(typeOf('creature'))).toBe(false);
    const born = changeType(BUILT_IN_TYPES, 'creature', { dateWords: 'born, died' });
    if (!born.ok) throw new Error(born.message);
    expect(showsAge(findType(born.types, 'creature'))).toBe(true);
    const vessel = addType(BUILT_IN_TYPES, { name: 'Vessel' });
    if (!vessel.ok) throw new Error(vessel.message);
    expect(showsAge(findType(vessel.types, 'vessel'))).toBe(false);
    // A place keeps "Founded".
    expect(showsAge(typeOf('place'))).toBe(false);
  });
});

describe('the story\'s present', () => {
  it('is the date the index names, or else the latest date in the story', () => {
    const latest = latestDate([at('1923-10-14'), null, at(1890), at('1923-11')]);
    expect(latest).toEqual(at('1923-11'));
    expect(latestDate([])).toBeNull();
    expect(storyPresent(null, latest)).toEqual({ date: at('1923-11'), source: 'latest' });
    expect(storyPresent(at(1930), latest)).toEqual({ date: at(1930), source: 'set' });
    expect(storyPresent(null, null)).toBeNull();
  });

  it('is stored like an event\'s date and read in the project\'s calendar', () => {
    expect(storyPresentValue(at(1923))).toBe(1923);
    expect(storyPresentValue(at('1923-10-14'))).toBe('1923-10-14');
    expect(storyPresentValue(at('1203-04 AE', EMBER))).toBe('1203-04 AE');
    expect(storyPresentValue(null)).toBeUndefined();
    expect(readStoryPresent('1203-04 AE', EMBER)).toEqual(at('1203-04 AE', EMBER));
    expect(readStoryPresent('soon', null)).toBeNull();
    expect(readStoryPresent(undefined, null)).toBeNull();
  });
});

describe('an age on the sheet', () => {
  it('is the age at death when there is a death', () => {
    const age = lifeAge(life({ date: '1860-02-01', end: '1923-03' }), present(1930));
    expect(age).toEqual({ kind: 'died', years: 63 });
    expect(lifeYears(age)).toBe(63);
  });

  it('is the age at the story\'s present otherwise, or "not born yet" before the birth', () => {
    const now = present('1923-10-14', 'latest');
    expect(lifeAge(life({ date: '1889-04-17' }), now)).toEqual({ kind: 'alive', years: 34, present: now });
    const early = present(1880);
    expect(lifeAge(life({ date: '1889-04-17' }), early)).toEqual({ kind: 'unborn', present: early });
    expect(lifeYears(lifeAge(life({ date: '1889-04-17' }), early))).toBeNull();
  });

  it('says what is missing: no birth date, no present, a death that is not after the birth', () => {
    expect(lifeAge(life({}), present(1923))).toEqual({ kind: 'unknown' });
    expect(lifeAge(life({ end: 1923 }), present(1923))).toEqual({ kind: 'unknown' });
    expect(lifeAge(life({ date: 1889 }), null)).toEqual({ kind: 'no-present' });
    // Died before born: the death is not used, and no age is made up.
    expect(lifeAge(life({ date: 1889, end: 1850 }), present(1923))).toEqual({ kind: 'problem' });
    expect(lifeAge(life({ date: 1889, end: 'one day' }), present(1923))).toEqual({ kind: 'problem' });
    // A birth that cannot be read is no birth.
    expect(lifeAge(life({ date: 'long ago' }), present(1923))).toEqual({ kind: 'unknown' });
  });

  it('works in an invented calendar', () => {
    const time = life({ date: '1180-04-17 AE' }, EMBER);
    expect(lifeAge(time, present('1203-04-16 AE', 'set', EMBER))).toMatchObject({ kind: 'alive', years: 22 });
    expect(lifeAge(life({ date: '1180 AE', end: '1243-02 AE' }, EMBER), null)).toEqual({ kind: 'died', years: 63 });
    // A real-world date in a project with an invented calendar cannot be read: no age is guessed.
    expect(lifeAge(life({ date: '1889-04-17' }, EMBER), present('1203 AE', 'set', EMBER))).toEqual({ kind: 'unknown' });
  });
});

describe('an age in a scene', () => {
  const wren = life({ date: '1909-06-02', end: '1950' });

  it('is the age at the scene\'s date', () => {
    expect(ageAt(wren, at('1923-10-14'))).toEqual({ kind: 'age', years: 14 });
    expect(ageAt(wren, at('1923-06-01'))).toEqual({ kind: 'age', years: 13 });
    expect(ageAt(wren, at(1909))).toEqual({ kind: 'age', years: 0 });
    // The year of the death, known only to the year, still counts as within the life.
    expect(ageAt(wren, at('1950-12-31'))).toEqual({ kind: 'age', years: 41 });
  });

  it('warns when the scene is before the birth or after the death', () => {
    expect(ageAt(wren, at('1909-06-01'))).toEqual({ kind: 'unborn' });
    expect(ageAt(wren, at(1900))).toEqual({ kind: 'unborn' });
    expect(ageAt(wren, at(1951))).toEqual({ kind: 'dead' });
  });

  it('says only what it can without a birth date, and nothing without any date', () => {
    const deathOnly = life({ end: '1923-03' });
    expect(ageAt(deathOnly, at('1923-10'))).toEqual({ kind: 'dead' });
    expect(ageAt(deathOnly, at('1920'))).toBeNull();
    expect(ageAt(life({}), at(1923))).toBeNull();
    // A death before the birth is not used: the birth alone counts.
    expect(ageAt(life({ date: 1889, end: 1850 }), at(1923))).toEqual({ kind: 'age', years: 34 });
  });

  it('works in an invented calendar', () => {
    const time = life({ date: '1190-05 AE', end: '1240 AE' }, EMBER);
    expect(ageAt(time, at('1203-04-17 AE', EMBER))).toEqual({ kind: 'age', years: 12 });
    expect(ageAt(time, at('1190-04 AE', EMBER))).toEqual({ kind: 'unborn' });
    expect(ageAt(time, at('1241 AE', EMBER))).toEqual({ kind: 'dead' });
  });
});

describe('the typed age beside the worked-out one', () => {
  it('is shown as always without a worked-out age, hidden when it says the same or nothing, and "typed" when it differs', () => {
    expect(typedAgeShown('34', null)).toBe('field');
    expect(typedAgeShown('', null)).toBe('field');
    expect(typedAgeShown('', 34)).toBe('hidden');
    expect(typedAgeShown(' 34 ', 34)).toBe('hidden');
    expect(typedAgeShown('about forty', 34)).toBe('typed');
    expect(typedAgeShown('בערך ארבעים', 34)).toBe('typed');
  });
});
