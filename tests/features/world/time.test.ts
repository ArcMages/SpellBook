// Time in the world, as the engine works it out: when an entity begins and
// ends, the moments of its life, what the two dates are called for each
// type, its history in order of time, and the browser's order by date.
// Everything is checked in the real-world calendar and in an invented one,
// and every function that changes a note is checked to change one property
// and nothing else.

import { describe, expect, it } from 'vitest';
import { CALENDAR_PRESETS, formatStoryDate, storyDateToText } from '../../../src/core/timeline';
import type { StoryCalendar, StoryDate } from '../../../src/core/timeline';
import {
  BUILT_IN_TYPES,
  DEFAULT_DATE_WORDS,
  DEFAULT_SORT,
  MOMENT_LABEL_MAX,
  addMoment,
  addType,
  changeMoment,
  changeType,
  checkEntityDates,
  compareByDate,
  dateWords,
  datedMoments,
  entityFields,
  entityHistory,
  findType,
  firstDate,
  isDated,
  momentText,
  nextSort,
  parseMoment,
  readDateWords,
  readEntities,
  readEntityTime,
  readEntityTypes,
  readFields,
  readMoments,
  redateEntityPatch,
  removeMoment,
  setEntityDate,
  setEntityField,
  sheetFields,
  sortByDate,
  spanText,
  tableRows,
  usualDateWords,
  writeEntityTypes,
} from '../../../src/core/world';
import type { EntityType } from '../../../src/core/world';
import type { Frontmatter } from '../../../src/core/types';
import { date } from '../../timeline/helpers';

/** The ten-month calendar the Calendar window offers as an example: "1203-04-17 AE". */
const EMBER = CALENDAR_PRESETS.find((preset) => preset.id === 'ten-months')?.calendar as StoryCalendar;

const text = (value: StoryDate | null): string | null => (value === null ? null : storyDateToText(value));
const typeOf = (id: string): EntityType => findType(BUILT_IN_TYPES, id) as EntityType;

/** A date of the invented calendar that must exist. */
function ember(written: string): StoryDate {
  const read = readEntityTime({ date: written }, EMBER).start;
  if (read === null) throw new Error(`the test asked for a date the calendar does not have: ${written}`);
  return read;
}

describe('what the two dates are called', () => {
  it('has its own words for every built-in type', () => {
    expect(Object.fromEntries(BUILT_IN_TYPES.map((type) => [type.id, dateWords(type)]))).toEqual({
      character: { from: 'Born', until: 'Died' },
      place: { from: 'Founded', until: 'Abandoned' },
      faction: { from: 'Founded', until: 'Dissolved' },
      item: { from: 'Made', until: 'Lost' },
      lore: { from: 'Set in', until: 'Until' },
      creature: { from: 'First known', until: 'Last known' },
      culture: { from: 'First known', until: 'Last known' },
    });
  });

  it('says "From" and "Until" for a type of the writer\'s own, and for an entity without a type', () => {
    const added = addType(BUILT_IN_TYPES, { name: 'Vessel' });
    if (!added.ok) throw new Error(added.message);
    expect(dateWords(findType(added.types, 'vessel'))).toEqual({ from: 'From', until: 'Until' });
    expect(dateWords(null)).toEqual(DEFAULT_DATE_WORDS);
    expect(DEFAULT_DATE_WORDS).toEqual({ from: 'From', until: 'Until' });
  });

  it('takes the words the writer chose for a type, stores them in the index and reads them back', () => {
    const added = addType(BUILT_IN_TYPES, { name: 'Vessel' });
    if (!added.ok) throw new Error(added.message);
    const changed = changeType(added.types, 'vessel', { dateWords: ' Launched ,  Wrecked ' });
    if (!changed.ok) throw new Error(changed.message);
    const vessel = findType(changed.types, 'vessel');
    expect(dateWords(vessel)).toEqual({ from: 'Launched', until: 'Wrecked' });
    // In the index: a list of two, and only on the type whose words were chosen.
    const stored = writeEntityTypes(changed.types) as Array<Record<string, unknown>>;
    expect(stored.find((item) => item['id'] === 'vessel')?.['dateWords']).toEqual(['Launched', 'Wrecked']);
    expect(stored.filter((item) => 'dateWords' in item)).toHaveLength(1);
    expect(dateWords(findType(readEntityTypes(stored), 'vessel'))).toEqual({ from: 'Launched', until: 'Wrecked' });
    // A built-in type can be given other words too, and the usual ones are still known.
    const hebrew = changeType(changed.types, 'character', { dateWords: { from: 'נולד', until: 'נפטר' } });
    if (!hebrew.ok) throw new Error(hebrew.message);
    expect(dateWords(findType(hebrew.types, 'character'))).toEqual({ from: 'נולד', until: 'נפטר' });
    expect(usualDateWords(findType(hebrew.types, 'character'))).toEqual({ from: 'Born', until: 'Died' });
    // Everything else about the type stays as it was.
    expect({ ...findType(hebrew.types, 'character'), dateWords: undefined }).toEqual({ ...typeOf('character'), dateWords: undefined });
  });

  it('goes back to the usual words when the field is emptied, and turns down what is not two words', () => {
    const chosen = changeType(BUILT_IN_TYPES, 'place', { dateWords: 'Raised, Razed' });
    if (!chosen.ok) throw new Error(chosen.message);
    const back = changeType(chosen.types, 'place', { dateWords: '  ' });
    if (!back.ok) throw new Error(back.message);
    expect(findType(back.types, 'place')).toEqual(typeOf('place'));
    expect(dateWords(findType(back.types, 'place'))).toEqual({ from: 'Founded', until: 'Abandoned' });
    for (const bad of ['Born', 'Born, ', 'a, b, c']) {
      const refused = changeType(BUILT_IN_TYPES, 'place', { dateWords: bad });
      expect(refused.ok, bad).toBe(false);
      if (!refused.ok) expect(refused.message).toContain('two words');
    }
    expect(readDateWords(['Born', 'Died'])).toEqual({ from: 'Born', until: 'Died' });
    expect(readDateWords({ from: 'A', until: 'B' })).toEqual({ from: 'A', until: 'B' });
    for (const bad of [null, 7, ['one'], ['a', 5], {}]) expect(readDateWords(bad)).toBeNull();
  });

  it('keeps the dates and the moments out of a type\'s fields and off the sheet\'s lines: they have a part of their own', () => {
    expect(readFields('role, date, End, moments, age')).toEqual(['role', 'age']);
    const [entity] = readEntities(
      [{ path: 'World/Characters/Mara.md', frontmatter: { type: 'character', role: 'Keeper', date: 1889, end: '1923-03', moments: ['1911 | qualifies'], shoe: 'left' } }],
      BUILT_IN_TYPES,
    );
    if (!entity) throw new Error('no entity');
    expect(sheetFields(entity, typeOf('character')).map((field) => field.name)).not.toEqual(expect.arrayContaining(['date', 'end', 'moments']));
    expect(sheetFields(entity, typeOf('character')).map((field) => field.name)).toContain('shoe');
    expect(entityFields(entity, typeOf('character')).map((field) => field.name)).toEqual(['role', 'shoe']);
    // A date is never typed in as a plain field: it goes through the calendar.
    const frontmatter: Frontmatter = { date: 1889 };
    for (const key of ['date', 'end', 'moments']) expect(setEntityField(frontmatter, key, 'whenever')).toBe('unreadable');
    expect(frontmatter).toEqual({ date: 1889 });
  });
});

describe('reading when an entity is, in the real-world calendar', () => {
  it('reads a date and an end the way an event\'s are read: a year, a month or a day', () => {
    const born = readEntityTime({ date: 1889, end: '1923-03' }, null);
    expect([text(born.start), text(born.end)]).toEqual(['1889', '1923-03']);
    expect([born.start?.precision, born.end?.precision]).toEqual(['year', 'month']);
    const day = readEntityTime({ date: '1889-04-17' }, null);
    expect([text(day.start), day.end, day.unreadStart, day.unreadEnd]).toEqual(['1889-04-17', null, '', '']);
    expect(isDated(day)).toBe(true);
    expect(spanText(born)).toBe(`1889 ${String.fromCharCode(0x2013)} Mar 1923`);
    expect(spanText(day)).toBe('17 Apr 1889');
  });

  it('has no date for a note without one, and never throws on what makes no sense', () => {
    for (const nothing of [null, undefined, {}, { date: '' }, { date: null, end: '  ', moments: [] }]) {
      const time = readEntityTime(nothing as Frontmatter | null, null);
      expect([time.start, time.end, time.unreadStart, time.unreadEnd, time.moments]).toEqual([null, null, '', '', []]);
      expect(isDated(time)).toBe(false);
      expect(spanText(time)).toBe('');
      expect(firstDate(time)).toBeNull();
    }
  });

  it('keeps what cannot be read as text, for the sheet to show, and guesses nothing', () => {
    const time = readEntityTime({ date: 'long ago', end: '1923-02-30' }, null);
    expect([time.start, time.end]).toEqual([null, null]);
    expect([time.unreadStart, time.unreadEnd]).toEqual(['long ago', '1923-02-30']);
    expect(isDated(time)).toBe(false);
    expect(readEntityTime({ date: { year: 1 } }, null).unreadStart).toBe('{"year":1}');
  });

  it('takes an end only when it is later than the date; an end alone still counts', () => {
    const backwards = readEntityTime({ date: 1900, end: 1850 }, null);
    expect([text(backwards.start), backwards.end, backwards.unreadEnd]).toEqual(['1900', null, '1850']);
    const same = readEntityTime({ date: '1900-01-01', end: 1900 }, null);
    expect([text(same.start), same.end, same.unreadEnd]).toEqual(['1900-01-01', null, '1900']);
    // A thing whose making nobody knows, but whose loss is on record.
    const lost = readEntityTime({ end: 1723 }, null);
    expect([lost.start, text(lost.end)]).toEqual([null, '1723']);
    expect(isDated(lost)).toBe(true);
    expect(spanText(lost)).toBe('until 1723');
    expect(text(firstDate(lost))).toBe('1723');
  });

  it('reads a moment as a date, a bar and a short label; the bar and the label may be left out', () => {
    const read = (value: unknown): [string, string] | null => {
      const moment = parseMoment(value, null);
      return moment === null ? null : [storyDateToText(moment.date), moment.label];
    };
    expect(read('1921-03 | comes to Saltwick')).toEqual(['1921-03', 'comes to Saltwick']);
    expect(read('1921-03-04|comes   to\nSaltwick ')).toEqual(['1921-03-04', 'comes to Saltwick']);
    expect(read('1921')).toEqual(['1921', '']);
    expect(read(1921)).toEqual(['1921', '']);
    expect(read('1921 |')).toEqual(['1921', '']);
    // A bar inside the label stays part of it.
    expect(read('1921 | left | or right')).toEqual(['1921', 'left | or right']);
    expect(read('1921 | הגיעה לעיירה')).toEqual(['1921', 'הגיעה לעיירה']);
    for (const bad of ['comes to Saltwick', '| nothing', 'spring 1921 | x', '', null, ['1921'], { date: 1921 }]) expect(read(bad)).toBeNull();
    expect(read(`1921 | ${'x'.repeat(200)}`)?.[1]).toHaveLength(MOMENT_LABEL_MAX);
  });

  it('lists the moments in the order they are written, and in order of time when asked', () => {
    const frontmatter = { moments: ['1923-10-13 | is sent to Saltwick', 'one day | meets Tobias', '', 1911, '1911 | qualifies'] };
    const moments = readMoments(frontmatter, null);
    expect(moments.map((moment) => [moment.index, text(moment.date), moment.label])).toEqual([
      [0, '1923-10-13', 'is sent to Saltwick'],
      // What cannot be read keeps its whole text, so that nothing the writer typed is lost.
      [1, null, 'one day | meets Tobias'],
      [3, '1911', ''],
      [4, '1911', 'qualifies'],
    ]);
    const time = readEntityTime(frontmatter, null);
    expect(datedMoments(time).map((moment) => moment.index)).toEqual([3, 4, 0]);
    expect(isDated(time)).toBe(true);
    expect(text(firstDate(time))).toBe('1911');
    // One entry on its own is a list of one.
    expect(readMoments({ moments: '1911 | qualifies' }, null).map((moment) => moment.label)).toEqual(['qualifies']);
    expect(readMoments({ moments: { a: 1 } }, null).map((moment) => moment.date)).toEqual([null]);
  });
});

describe('reading when an entity is, in an invented calendar', () => {
  it('reads the calendar\'s own form, with its era, for the dates and for the moments', () => {
    const time = readEntityTime({ date: '1203-04-17 AE', end: '1260 AE', moments: ['1210-02 AE | the flood', '0003 BE | הנבואה'] }, EMBER);
    expect([text(time.start), text(time.end)]).toEqual(['1203-04-17 AE', '1260 AE']);
    expect(formatStoryDate(time.start as StoryDate)).toBe('17 Highsun 1203 AE');
    expect(time.moments.map((moment) => [text(moment.date), moment.label])).toEqual([
      ['1210-02 AE', 'the flood'],
      ['0003 BE', 'הנבואה'],
    ]);
    // Before the first era comes first: the prophecy is the earliest thing known of it.
    expect(datedMoments(time).map((moment) => moment.label)).toEqual(['הנבואה', 'the flood']);
    expect(momentText(ember('1210-02 AE'), ' the  flood ')).toBe('1210-02 AE | the flood');
  });

  it('does not take a real-world date for a date of the invented calendar: it is reported, not guessed at', () => {
    const time = readEntityTime({ date: 1889, end: '1923-03', moments: ['1911 | qualifies'] }, EMBER);
    expect([time.start, time.end, time.unreadStart, time.unreadEnd]).toEqual([null, null, '1889', '1923-03']);
    expect(time.moments.map((moment) => [moment.date, moment.label])).toEqual([[null, '1911 | qualifies']]);
    expect(isDated(time)).toBe(false);
    // ...nor a date of the invented calendar for a real-world one.
    expect(readEntityTime({ date: '1203-04-17 AE' }, null).unreadStart).toBe('1203-04-17 AE');
    // A day the month does not have (it has 36) is no date.
    expect(readEntityTime({ date: '1203-04-37 AE' }, EMBER).start).toBeNull();
  });
});

describe('writing a date', () => {
  it('sets one property and no other, the way the timeline writes an event\'s date', () => {
    const frontmatter: Frontmatter = { type: 'character', role: 'Keeper', aliases: [], related: ['[[Saltwick]]'] };
    expect(setEntityDate(frontmatter, 'date', date(1889))).toBe('changed');
    // A year of the real-world calendar is a bare number; a month or a day is text.
    expect(frontmatter).toEqual({ type: 'character', role: 'Keeper', aliases: [], related: ['[[Saltwick]]'], date: 1889 });
    expect(setEntityDate(frontmatter, 'end', date(1923, 3))).toBe('changed');
    expect(setEntityDate(frontmatter, 'date', date(1889, 4, 17))).toBe('changed');
    expect(frontmatter).toEqual({ type: 'character', role: 'Keeper', aliases: [], related: ['[[Saltwick]]'], date: '1889-04-17', end: '1923-03' });
    expect(Object.keys(frontmatter)).toEqual(['type', 'role', 'aliases', 'related', 'date', 'end']);
  });

  it('changes nothing when the note already says that date, however it is written', () => {
    const frontmatter: Frontmatter = { date: '1889', end: '1923-03-01T10:00:00Z' };
    expect(setEntityDate(frontmatter, 'date', date(1889))).toBe('unchanged');
    expect(setEntityDate(frontmatter, 'end', date(1923, 3, 1))).toBe('unchanged');
    expect(frontmatter).toEqual({ date: '1889', end: '1923-03-01T10:00:00Z' });
  });

  it('takes a date away with its key, and leaves the other date alone', () => {
    const frontmatter: Frontmatter = { date: 1889, end: 1923, moments: ['1911'] };
    expect(setEntityDate(frontmatter, 'end', null)).toBe('changed');
    expect(frontmatter).toEqual({ date: 1889, moments: ['1911'] });
    expect(setEntityDate(frontmatter, 'end', null)).toBe('unchanged');
    // A date that could not be read is replaced by one that can.
    const odd: Frontmatter = { date: 'long ago' };
    expect(setEntityDate(odd, 'date', date(1700))).toBe('changed');
    expect(odd).toEqual({ date: 1700 });
  });

  it('writes a date of an invented calendar in that calendar\'s form, always as text', () => {
    const frontmatter: Frontmatter = { type: 'place' };
    expect(setEntityDate(frontmatter, 'date', ember('1203 AE'))).toBe('changed');
    expect(setEntityDate(frontmatter, 'end', ember('1260-10-36 AE'))).toBe('changed');
    expect(frontmatter).toEqual({ type: 'place', date: '1203 AE', end: '1260-10-36 AE' });
    expect(setEntityDate(frontmatter, 'date', ember('1203 AE'))).toBe('unchanged');
    // What was written is read back as the same dates.
    const back = readEntityTime(frontmatter, EMBER);
    expect([text(back.start), text(back.end)]).toEqual(['1203 AE', '1260-10-36 AE']);
  });

  it('says why an end that is not later than the beginning will not do, in the type\'s own words', () => {
    expect(checkEntityDates(date(1889), date(1923))).toBeNull();
    expect(checkEntityDates(date(1889), null)).toBeNull();
    expect(checkEntityDates(null, date(1923))).toBeNull();
    expect(checkEntityDates(date(1923), date(1889), dateWords(typeOf('character')))).toBe('"Died" must be later than "Born".');
    expect(checkEntityDates(date(1923), date(1923, 1, 1))).toBe('"Until" must be later than "From".');
  });
});

describe('writing moments', () => {
  it('adds a moment at the end of the list, as one readable line, and touches nothing else', () => {
    const frontmatter: Frontmatter = { type: 'character', date: 1889 };
    expect(addMoment(frontmatter, date(1911), 'qualifies as a chart maker')).toBe('changed');
    expect(addMoment(frontmatter, date(1923, 10, 13), '  is sent\nto Saltwick ')).toBe('changed');
    expect(addMoment(frontmatter, date(1900), '')).toBe('changed');
    expect(frontmatter).toEqual({
      type: 'character',
      date: 1889,
      moments: ['1911 | qualifies as a chart maker', '1923-10-13 | is sent to Saltwick', '1900'],
    });
    // The very same moment is not listed twice.
    expect(addMoment(frontmatter, date(1911), 'qualifies as a chart maker')).toBe('unchanged');
    expect((frontmatter['moments'] as unknown[]).length).toBe(3);
  });

  it('changes one moment in its place, found by where it was and how it is written', () => {
    const frontmatter: Frontmatter = { moments: ['1911 | qualifies', 'one day | meets Tobias', '1923-10-13 | is sent to Saltwick'] };
    expect(changeMoment(frontmatter, 1, 'one day | meets Tobias', date(1923, 10, 14), 'meets Tobias')).toBe('changed');
    expect(frontmatter).toEqual({ moments: ['1911 | qualifies', '1923-10-14 | meets Tobias', '1923-10-13 | is sent to Saltwick'] });
    // Another device moved the list meanwhile: the moment is found by its text.
    expect(changeMoment(frontmatter, 0, '1923-10-13 | is sent to Saltwick', date(1923, 10, 13), 'is sent north')).toBe('changed');
    expect(frontmatter['moments']).toEqual(['1911 | qualifies', '1923-10-14 | meets Tobias', '1923-10-13 | is sent north']);
    // One that is gone, or already says that, changes nothing.
    expect(changeMoment(frontmatter, 0, '1850 | never was', date(1850), 'x')).toBe('unchanged');
    expect(changeMoment(frontmatter, 0, '1911 | qualifies', date(1911), 'qualifies')).toBe('unchanged');
    expect(frontmatter['moments']).toEqual(['1911 | qualifies', '1923-10-14 | meets Tobias', '1923-10-13 | is sent north']);
  });

  it('removes one moment, and the key with the last one', () => {
    const frontmatter: Frontmatter = { date: 1889, moments: ['1911 | qualifies', 1921, '1911 | qualifies'] };
    // Of two that say the same, the one at the place asked for goes.
    expect(removeMoment(frontmatter, 2, '1911 | qualifies')).toBe('changed');
    expect(frontmatter['moments']).toEqual(['1911 | qualifies', 1921]);
    expect(removeMoment(frontmatter, 1, '1921')).toBe('changed');
    expect(removeMoment(frontmatter, 5, 'nothing like it')).toBe('unchanged');
    expect(removeMoment(frontmatter, 0, '1911 | qualifies')).toBe('changed');
    expect(frontmatter).toEqual({ date: 1889 });
  });

  it('leaves alone a "moments" property that is not a list', () => {
    const frontmatter: Frontmatter = { moments: { first: '1911' } };
    expect(addMoment(frontmatter, date(1911), 'x')).toBe('unreadable');
    expect(changeMoment(frontmatter, 0, 'x', date(1911), 'y')).toBe('unreadable');
    expect(removeMoment(frontmatter, 0, 'x')).toBe('unreadable');
    expect(frontmatter).toEqual({ moments: { first: '1911' } });
    // One line on its own is taken as a list of one.
    const single: Frontmatter = { moments: '1911 | qualifies' };
    expect(addMoment(single, date(1912), 'sails')).toBe('changed');
    expect(single).toEqual({ moments: ['1911 | qualifies', '1912 | sails'] });
  });

  it('writes and changes moments of an invented calendar in that calendar\'s form', () => {
    const frontmatter: Frontmatter = {};
    expect(addMoment(frontmatter, ember('1210-02 AE'), 'the flood')).toBe('changed');
    expect(changeMoment(frontmatter, 0, '1210-02 AE | the flood', ember('1210-02-09 AE'), 'the flood')).toBe('changed');
    expect(frontmatter).toEqual({ moments: ['1210-02-09 AE | the flood'] });
    expect(readMoments(frontmatter, EMBER).map((moment) => [text(moment.date), moment.label])).toEqual([['1210-02-09 AE', 'the flood']]);
  });
});

describe('the history of an entity', () => {
  const history = (calendar: StoryCalendar | null = null): ReturnType<typeof entityHistory> =>
    entityHistory({
      entityPath: 'World/Characters/The Keeper.md',
      time: readEntityTime({ date: 1858, end: '1923-03', moments: ['1922-11 | is pensioned off', '1892 | takes over the light', 'sometime | marries'] }, calendar),
      words: dateWords(typeOf('character')),
      events: [
        { path: 'Timeline/The lighthouse is closed.md', title: 'The lighthouse is closed', frontmatter: { date: '1922-11' } },
        { path: 'Timeline/The storm of 1901.md', title: 'The storm of 1901', frontmatter: { date: '1901-01-10', end: '1901-01-12' } },
        { path: 'Timeline/Rumours.md', title: 'Rumours', frontmatter: {} },
      ],
      scenes: [
        { path: 'Manuscript/What the Keeper Wrote.md', title: 'What the Keeper Wrote', frontmatter: { date: '1923-12-03' } },
        { path: "Manuscript/The Keeper's Log.md", title: "The Keeper's Log", frontmatter: { status: 'Draft' } },
        { path: 'Manuscript/Missing.md', title: 'Missing', frontmatter: null },
      ],
      calendar,
    });

  it('is one list in order of time: its own dates and moments, the events that list it, the dated scenes it is in', () => {
    expect(history().dated.map((line) => [line.kind, text(line.date), line.label])).toEqual([
      ['from', '1858', 'Born'],
      ['moment', '1892', 'takes over the light'],
      ['event', '1901-01-10', 'The storm of 1901'],
      // On the same day: what the entity's own note says first, then what happens to it.
      ['moment', '1922-11', 'is pensioned off'],
      ['event', '1922-11', 'The lighthouse is closed'],
      ['until', '1923-03', 'Died'],
      ['scene', '1923-12-03', 'What the Keeper Wrote'],
    ]);
    expect(text(history().dated[2]?.end ?? null)).toBe('1901-01-12');
  });

  it('lists what has no date after, never leaving it out', () => {
    expect(history().undated.map((line) => [line.kind, line.label])).toEqual([
      ['moment', 'sometime | marries'],
      ['event', 'Rumours'],
      ['scene', "The Keeper's Log"],
      ['scene', 'Missing'],
    ]);
  });

  it('says where each line comes from, to open it: the entity\'s own note, the event, the scene', () => {
    const paths = Object.fromEntries([...history().dated, ...history().undated].map((line) => [line.label, line.path]));
    expect(paths['Born']).toBe('World/Characters/The Keeper.md');
    expect(paths['takes over the light']).toBe('World/Characters/The Keeper.md');
    expect(paths['The lighthouse is closed']).toBe('Timeline/The lighthouse is closed.md');
    expect(paths['What the Keeper Wrote']).toBe('Manuscript/What the Keeper Wrote.md');
  });

  it('puts what begins before what ends on one and the same day, and an end last', () => {
    const lines = entityHistory({
      entityPath: 'World/Lore/Tale.md',
      time: readEntityTime({ date: 1700, end: 1701, moments: ['1701 | is forgotten', '1700 | is first told'] }, null),
      words: dateWords(typeOf('lore')),
      events: [{ path: 'Timeline/E.md', title: 'E', frontmatter: { date: 1701 } }],
      scenes: [{ path: 'Manuscript/S.md', title: 'S', frontmatter: { date: 1700 } }],
      calendar: null,
    }).dated;
    expect(lines.map((line) => line.label)).toEqual(['Set in', 'is first told', 'S', 'is forgotten', 'E', 'Until']);
  });

  it('reads everything in the project\'s calendar: real-world dates are undated in an invented one', () => {
    const invented = history(EMBER);
    expect(invented.dated).toEqual([]);
    expect(invented.undated.map((line) => line.kind)).toEqual(['moment', 'moment', 'moment', 'event', 'event', 'event', 'scene', 'scene', 'scene']);
    const own = entityHistory({
      entityPath: 'World/Places/Emberhold.md',
      time: readEntityTime({ date: '1203 AE', moments: ['0003 BE | הנבואה'] }, EMBER),
      words: dateWords(typeOf('place')),
      events: [{ path: 'Timeline/Siege.md', title: 'Siege', frontmatter: { date: '1210-02-09 AE', end: '1210-03 AE' } }],
      scenes: [],
      calendar: EMBER,
    });
    expect(own.dated.map((line) => [line.kind, text(line.date), line.label])).toEqual([
      ['moment', '0003 BE', 'הנבואה'],
      ['from', '1203 AE', 'Founded'],
      ['event', '1210-02-09 AE', 'Siege'],
    ]);
  });
});

describe('the browser by date', () => {
  const notes = [
    { path: 'World/Characters/Mara.md', frontmatter: { type: 'character', date: '1889-04-17' } },
    { path: 'World/Characters/Noa.md', frontmatter: { type: 'character', date: '1894-06-03' } },
    { path: 'World/Characters/Anon.md', frontmatter: { type: 'character' } },
    { path: 'World/Characters/The Keeper.md', frontmatter: { type: 'character', date: 1858, end: '1923-03' } },
    { path: 'World/Places/The Old Lighthouse.md', frontmatter: { type: 'place', date: 1841, end: '1922-11' } },
    { path: 'World/Items/The Net.md', frontmatter: { type: 'item', moments: ['1700 | first mended'] } },
    { path: 'World/Items/The Ring.md', frontmatter: { type: 'item', end: 1723 } },
  ];
  const entities = readEntities(notes, BUILT_IN_TYPES);
  const timeOf = (entity: (typeof entities)[number]): ReturnType<typeof readEntityTime> => readEntityTime(entity.frontmatter, null);

  it('orders the cards by when each begins, with those that have no date after, by name', () => {
    expect(sortByDate(entities, timeOf).map((entity) => entity.name)).toEqual([
      // A thing with only a moment, or only an end, stands at that.
      'The Net',
      'The Ring',
      'The Old Lighthouse',
      'The Keeper',
      'Mara',
      'Noa',
      'Anon',
    ]);
    const [mara, noa, anon] = ['Mara', 'Noa', 'Anon'].map((name) => timeOf(entities.find((entity) => entity.name === name) as (typeof entities)[number]));
    if (!mara || !noa || !anon) throw new Error('no entity');
    expect(compareByDate(mara, noa)).toBeLessThan(0);
    expect(compareByDate(anon, noa)).toBeGreaterThan(0);
    expect(compareByDate(anon, anon)).toBe(0);
  });

  it('gives the table a "From" and an "Until" column, each sortable both ways, with empty ones last', () => {
    const rows = (column: 'from' | 'until', descending: boolean): string[] =>
      tableRows(entities, BUILT_IN_TYPES, '', '', { column, descending }, () => 0, timeOf).map((row) => `${row.entity.name}: ${column === 'from' ? row.fromText : row.untilText}`);
    expect(rows('from', false)).toEqual([
      'The Old Lighthouse: 1841',
      'The Keeper: 1858',
      'Mara: 17 Apr 1889',
      'Noa: 3 Jun 1894',
      'Anon: ',
      'The Net: ',
      'The Ring: ',
    ]);
    expect(rows('from', true).slice(0, 4)).toEqual(['Noa: 3 Jun 1894', 'Mara: 17 Apr 1889', 'The Keeper: 1858', 'The Old Lighthouse: 1841']);
    expect(rows('from', true).slice(4)).toEqual(['Anon: ', 'The Net: ', 'The Ring: ']);
    expect(rows('until', false).slice(0, 3)).toEqual(['The Ring: 1723', 'The Old Lighthouse: Nov 1922', 'The Keeper: Mar 1923']);
    expect(rows('until', true).slice(0, 3)).toEqual(['The Keeper: Mar 1923', 'The Old Lighthouse: Nov 1922', 'The Ring: 1723']);
    expect(nextSort(DEFAULT_SORT, 'from')).toEqual({ column: 'from', descending: false });
    expect(nextSort({ column: 'from', descending: false }, 'from')).toEqual({ column: 'from', descending: true });
    // Without the dates the table is as it was: no row has one.
    expect(tableRows(entities, BUILT_IN_TYPES, '', '', DEFAULT_SORT, () => 0).every((row) => row.from === null && row.fromText === '')).toBe(true);
  });
});

describe('moving an entity on the timeline takes its moments along', () => {
  it('moves every moment by the same amount as the date, each in its own units, in the real-world calendar', () => {
    const frontmatter: Frontmatter = {
      date: '1923-03-01',
      end: '1923-09-01',
      moments: ['1923-05-15 | sails', '1923-07 | the storm', 1924, 'not a date at all', '1923-06-01'],
      title: 'kept',
    };
    const patch = redateEntityPatch(frontmatter, date(1923, 1, 29));
    expect(patch).toEqual({
      date: '1923-01-29',
      end: '1923-08-01',
      // A year moves by whole years: the start stays in 1923, so 1924 stays.
      moments: ['1923-04-14 | sails', '1923-05 | the storm', 1924, 'not a date at all', '1923-05-01'],
    });
    expect(frontmatter['moments']).toEqual(['1923-05-15 | sails', '1923-07 | the storm', 1924, 'not a date at all', '1923-06-01']); // untouched
  });

  it('moves them in an invented calendar too, writing the calendar\'s own form', () => {
    const frontmatter: Frontmatter = { date: '1203-04-17 AE', end: '1203-06-02 AE', moments: ['1203-05-01 AE | the flood', '1204 AE | הנבואה'] };
    const patch = redateEntityPatch(frontmatter, ember('1205-04-17 AE'));
    expect(patch['date']).toBe('1205-04-17 AE');
    expect(patch['moments']).toEqual(['1205-05-01 AE | the flood', '1206 AE | הנבואה']);
  });

  it('gives an event without moments, an unmoved note, or a "moments" that is not a list exactly what an event gets', () => {
    expect(redateEntityPatch({ date: '1923-03-01' }, date(1923, 3, 5))).toEqual({ date: '1923-03-05' });
    expect(redateEntityPatch({ date: '1923-03-01', moments: ['1923-04-01'] }, date(1923, 3, 1))).toEqual({});
    expect(redateEntityPatch({ date: '1923-03-01', moments: { odd: true } }, date(1923, 3, 5))).toEqual({ date: '1923-03-05' });
    expect(redateEntityPatch({ date: '1923-03-01', moments: ['nothing to read'] }, date(1923, 3, 5))).toEqual({ date: '1923-03-05' });
  });
});
