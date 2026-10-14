// The sample novel's history: every entity of its world has a place in
// time, every date is one the timeline can read, and the dates tell one
// coherent story around 1923, consistent with the events the sample already
// has and with what the entities' own notes say.

import { describe, expect, it } from 'vitest';
import { sampleProject } from '../src/core/sampleProject';
import { SAMPLE_ENTITIES, SAMPLE_EVENTS, SAMPLE_STORY_YEAR } from '../src/core/sampleText';
import { readStoryDate, storyDateToDayNumber, storyDateToText } from '../src/core/timeline';
import type { StoryDate } from '../src/core/timeline';
import {
  BUILT_IN_TYPES,
  entityHistory,
  isDated,
  readEntities,
  readEntityTime,
  worldLanes,
  dateWords,
  findType,
} from '../src/core/world';
import type { WorldNote } from '../src/core/world';
import { TODAY } from './storeHarness';

const made = sampleProject(TODAY);
const seed = { world: made.world ?? [], events: made.events ?? [] };
const notes: WorldNote[] = seed.world.map((entity) => ({ path: `World/${entity.folder}/${entity.title}.md`, frontmatter: entity.frontmatter }));
const entities = readEntities(notes, BUILT_IN_TYPES);
const timeOf = (name: string): ReturnType<typeof readEntityTime> => {
  const entity = entities.find((candidate) => candidate.name === name);
  if (!entity) throw new Error(`the sample has no "${name}"`);
  return readEntityTime(entity.frontmatter, null);
};
const day = (date: StoryDate | null): number => {
  if (date === null) throw new Error('a date is missing');
  return storyDateToDayNumber(date);
};
const eventDate = (title: string): StoryDate => {
  const found = SAMPLE_EVENTS.find((event) => event.title === title);
  const date = found === undefined ? null : readStoryDate(found.date);
  if (date === null) throw new Error(`the sample has no event "${title}" with a date`);
  return date;
};
const momentOf = (name: string, label: string): StoryDate => {
  const found = timeOf(name).moments.find((moment) => moment.label === label);
  if (!found?.date) throw new Error(`${name} has no moment "${label}"`);
  return found.date;
};

describe('the sample\'s history', () => {
  it('gives every entity a place in time, every date one the timeline can read', () => {
    for (const entity of entities) {
      const time = readEntityTime(entity.frontmatter, null);
      expect(isDated(time), entity.name).toBe(true);
      expect([time.unreadStart, time.unreadEnd], entity.name).toEqual(['', '']);
      for (const moment of time.moments) expect(moment.date, `${entity.name}: ${moment.text}`).not.toBeNull();
      // An end that is there is later than the beginning (otherwise it would be unread above).
      if (entity.frontmatter?.['end'] !== undefined) expect(time.end, entity.name).not.toBeNull();
    }
    expect(SAMPLE_ENTITIES.every((entity) => entity.date !== undefined)).toBe(true);
  });

  it('writes the dates the way the sheet writes them: a year as a number, a moment as a date, a bar and a few words', () => {
    const keeper = seed.world.find((entity) => entity.title === 'The Keeper')?.frontmatter;
    expect(keeper).toMatchObject({ date: 1858, end: '1923-03', moments: ['1892 | takes over the light', '1922-11 | is pensioned off'] });
    expect(seed.world.find((entity) => entity.title === 'Mara')?.frontmatter['moments']).toEqual([
      '1911 | qualifies as a chart maker',
      '1923-10-13 | is sent to Saltwick to redraw the chart',
    ]);
    expect(seed.world.find((entity) => entity.title === 'Noa')?.frontmatter['moments']).toEqual(['1923-05 | takes over the archive in Saltwick']);
    // Noa's sister has hers from the letters.
    expect(seed.world.find((entity) => entity.title === 'Ellen')?.frontmatter['moments']).toEqual(['1923-06 | the first letter from Noa arrives']);
  });

  it('gives the characters births that agree with the ages their notes give in the story\'s year', () => {
    for (const entity of SAMPLE_ENTITIES.filter((candidate) => candidate.fields['age'] !== undefined)) {
      const born = readStoryDate(entity.date);
      const age = SAMPLE_STORY_YEAR - (born?.year ?? 0);
      // Born in that year or the one before, depending on the birthday.
      expect([age, age - 1], entity.name).toContain(entity.fields['age']);
    }
    expect(SAMPLE_STORY_YEAR).toBe(1923);
    // Noa's sister is the younger of the two.
    expect(day(timeOf('Ellen').start)).toBeGreaterThan(day(timeOf('Noa').start));
  });

  it('agrees with the events: the lighthouse closes the month the event says, the chart was last corrected that day', () => {
    expect(storyDateToText(timeOf('The Old Lighthouse').end as StoryDate)).toBe(storyDateToText(eventDate('The lighthouse is closed')));
    expect(storyDateToText(momentOf('The Keeper', 'is pensioned off'))).toBe(storyDateToText(eventDate('The lighthouse is closed')));
    expect(storyDateToText(momentOf('The Old Chart', 'last corrected'))).toBe(storyDateToText(eventDate('The old chart is last corrected')));
    expect(storyDateToText(momentOf('Saltwick', 'the winter storm moves the sandbars'))).toBe(storyDateToText(eventDate('The winter storm')));
    // Mara is sent between the storm and her arrival.
    const sent = day(momentOf('Mara', 'is sent to Saltwick to redraw the chart'));
    expect(sent).toBeGreaterThan(day(eventDate('The winter storm')));
    expect(sent).toBeLessThan(day(eventDate('Mara arrives in Saltwick')));
    // Noa takes the archive over before she finds the old map in it, and the archive says so too.
    expect(day(momentOf('Noa', 'takes over the archive in Saltwick'))).toBeLessThan(day(eventDate('Noa finds the old map')));
    expect(storyDateToText(momentOf('The Archive', 'Noa takes it over'))).toBe('1923-05');
  });

  it('tells one coherent past: the keeper kept the light thirty years, the village was lost before the town was old', () => {
    const tookOver = momentOf('The Keeper', 'takes over the light');
    expect(storyDateToText(momentOf('The Old Lighthouse', 'its last keeper takes over'))).toBe(storyDateToText(tookOver));
    expect((timeOf('The Old Lighthouse').end?.year ?? 0) - tookOver.year).toBe(30);
    expect(day(timeOf('The Old Lighthouse').start)).toBeLessThan(day(tookOver));
    // The keeper was born before he took the light, and died before the story's autumn.
    expect(day(timeOf('The Keeper').start)).toBeLessThan(day(tookOver));
    expect(day(timeOf('The Keeper').end)).toBeLessThan(day(eventDate('The winter storm')));
    // The legend is set the year the village was lost, "two hundred years ago, as it is told".
    expect(storyDateToText(timeOf('The Legend of the Drowned Village').start as StoryDate)).toBe(
      storyDateToText(timeOf('The Drowned Village').end as StoryDate),
    );
    expect(SAMPLE_STORY_YEAR - (timeOf('The Drowned Village').end?.year ?? 0)).toBe(200);
    // The log was begun when its keeper took the light, and went to the archive when the light closed.
    expect(storyDateToText(timeOf('The Logbook').start as StoryDate)).toBe(storyDateToText(tookOver));
    expect(storyDateToText(momentOf('The Logbook', 'goes to the archive'))).toBe(storyDateToText(eventDate('The lighthouse is closed')));
    // Everything begins before the story's year is out.
    for (const entity of entities) expect(day(readEntityTime(entity.frontmatter, null).start), entity.name).toBeLessThan(day(readStoryDate(1924)));
  });

  it('fills every lane of the world, and gives the Keeper\'s sheet a history in order', () => {
    expect(worldLanes(entities, BUILT_IN_TYPES, null).map((lane) => [lane.name, lane.rows.length])).toEqual([
      ['Characters', 6],
      ['Places', 4],
      ['Factions', 1],
      ['Items', 2],
      ['Lore', 3],
      ['Creatures', 1],
      ['Cultures', 1],
    ]);
    const keeper = entities.find((entity) => entity.name === 'The Keeper');
    if (!keeper) throw new Error('no keeper');
    const history = entityHistory({
      entityPath: keeper.path,
      time: readEntityTime(keeper.frontmatter, null),
      words: dateWords(findType(BUILT_IN_TYPES, 'character')),
      events: seed.events
        .filter((event) => JSON.stringify(event.frontmatter['entities'] ?? []).includes('The Keeper'))
        .map((event) => ({ path: `Timeline/${event.title}.md`, title: event.title, frontmatter: event.frontmatter })),
      scenes: [],
      calendar: null,
    });
    expect(history.dated.map((line) => `${storyDateToText(line.date as StoryDate)} ${line.label}`)).toEqual([
      '1858 Born',
      '1892 takes over the light',
      '1922-11 is pensioned off',
      '1922-11 The lighthouse is closed',
      '1923-03 Died',
    ]);
  });
});
