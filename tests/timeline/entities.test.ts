// Entities on events: the "entities" property, a list of links to notes of
// the project's World folder, and the calendar's place in a merged index.

import { describe, expect, it } from 'vitest';
import { MERGED_WHOLE_KEYS, mergeConflictData } from '../../src/core/conflictCopies';
import {
  CALENDAR_KEY,
  CALENDAR_PRESETS,
  ENTITIES_KEY,
  WORLD_FOLDER,
  calendarToIndexValue,
  chipsThatFit,
  createEntityIndex,
  describeEventProblem,
  eventEntities,
  eventHasEntity,
  readCalendar,
  readEvent,
  readSceneEvent,
  setEntitiesPatch,
} from '../../src/core/timeline';
import type { StoryCalendar } from '../../src/core/timeline';
import { deepFreeze, event } from './helpers';

const WORLD = ['World/Mara.md', 'World/Saltwick.md', 'World/People/Tom.md', 'World/Places/Tom.md', 'World/מרים.md'];
const index = createEntityIndex(WORLD);
const keyOf = (name: string): string => index.resolve(name).key;

describe('the entities an event names', () => {
  it('are read from the "entities" property: links, each once, in the note\'s order', () => {
    expect([WORLD_FOLDER, ENTITIES_KEY]).toEqual(['World', 'entities']);
    const read = event('Fire', { entities: ['[[Mara]]', '[[World/Saltwick|the town]]', '[[Mara]]', '[[מרים]]'] });
    expect(read.entities).toEqual(['Mara', 'World/Saltwick', 'מרים']);
    expect(read.problems).toEqual([]);
    expect(event('Fire', {}).entities).toEqual([]);
    // One link on its own, and a link written without quotes (YAML makes a list in a list of it).
    expect(event('Fire', { entities: '[[Mara]]' }).entities).toEqual(['Mara']);
    expect(event('Fire', { entities: [[['Mara']], [['Saltwick']]] }).entities).toEqual(['Mara', 'Saltwick']);
    // A scene names its entities the same way.
    expect(readSceneEvent('Manuscript/Opening.md', { date: 1923, entities: ['[[Mara]]'] })?.entities).toEqual(['Mara']);
  });

  it('reports what is not a link, and keeps the rest', () => {
    const read = readEvent('Timeline/Fire.md', { entities: ['[[Mara]]', { name: 'x' }, true] });
    expect(read.entities).toEqual(['Mara']);
    expect(read.problems).toEqual(['entities-unreadable']);
    expect(describeEventProblem('entities-unreadable')).toMatch(/"entities"/);
  });

  it('are matched to the notes of the World folder by name or by path, whatever the capitals', () => {
    expect(index.all.map((entity) => entity.name)).toEqual(['Mara', 'Saltwick', 'Tom', 'Tom', 'מרים']);
    expect(index.resolve('Mara')).toEqual({ key: keyOf('Mara'), name: 'Mara', path: 'World/Mara.md' });
    for (const target of ['mara', 'World/Mara', 'World/Mara.md', 'My Novel/World/Mara.md']) {
      expect(index.resolve(target).path, target).toBe('World/Mara.md');
    }
    expect(index.resolve('Places/Tom').path).toBe('World/Places/Tom.md');
    expect(index.resolve('מרים').path).toBe('World/מרים.md');
  });

  it('in a vault with two projects that each have a "Mara", leads to this project\'s own', () => {
    // The paths are those of this project's World folder, from the project's folder on.
    const own = createEntityIndex(['World/Characters/Mara.md', 'World/Places/Saltwick.md'], 'Novel');
    const mara = own.resolve('Mara');
    expect(mara.path).toBe('World/Characters/Mara.md');
    // A bare name, or a path that says no more than the note's own, is this project's note...
    for (const target of ['mara', 'Characters/Mara', 'World/Characters/Mara.md', 'Novel/World/Characters/Mara', 'novel/world/characters/mara.md']) {
      expect(own.resolve(target).key, target).toBe(mara.key);
    }
    // ...and a path into the other project is not: it is shown by its name, without a note.
    for (const target of ['Atlas/World/Characters/Mara', 'Atlas/World/Characters/Mara.md', 'Books/Atlas/World/Characters/Mara', 'Old/Novel/World/Characters/Mara']) {
      const other = own.resolve(target);
      expect([other.name, other.path], target).toEqual(['Mara', null]);
      expect(other.key, target).not.toBe(mara.key);
    }
    // The filter goes by the same keys: an event that names the other project's Mara is not one of this Mara's.
    const theirs = event('Crossing', { entities: ['[[Atlas/World/Characters/Mara]]'] });
    const ours = event('Fire', { entities: ['[[Mara]]'] });
    expect(eventHasEntity(ours, new Set([mara.key]), own)).toBe(true);
    expect(eventHasEntity(theirs, new Set([mara.key]), own)).toBe(false);
    expect(eventEntities(theirs, own).map((entity) => entity.path)).toEqual([null]);
    // Taking this project's Mara for an event leaves the other link out, and writes a plain one.
    expect(setEntitiesPatch({ entities: ['[[Atlas/World/Characters/Mara]]'] }, [mara.key], own)).toEqual({ entities: ['[[Mara]]'] });
  });

  it('knows a project that lies inside other folders by the end of where it is', () => {
    const nested = createEntityIndex(['World/Mara.md'], 'Books/Novel');
    for (const target of ['Books/Novel/World/Mara', 'Novel/World/Mara']) expect(nested.resolve(target).path, target).toBe('World/Mara.md');
    for (const target of ['Books/Atlas/World/Mara', 'Shelf/Books/Novel/World/Mara', 'Atlas/Novel/World/Mara']) {
      expect(nested.resolve(target).path, target).toBeNull();
    }
  });

  it('still shows an entity whose note is not there, by the name its link gives', () => {
    const ghost = index.resolve('World/Ghost');
    expect(ghost).toEqual({ key: ghost.key, name: 'Ghost', path: null });
    expect(index.resolve('ghost').key).toBe(ghost.key);
    expect(ghost.key).not.toBe(keyOf('Mara'));
    const read = event('Fire', { entities: ['[[Mara]]', '[[Ghost]]', '[[World/Mara]]'] });
    expect(eventEntities(read, index).map((entity) => [entity.name, entity.path])).toEqual([
      ['Mara', 'World/Mara.md'],
      ['Ghost', null],
    ]);
  });

  it('narrow the timeline: an event passes when it names at least one of the entities wanted', () => {
    const fire = event('Fire', { entities: ['[[Mara]]', '[[Saltwick]]'] });
    const flood = event('Flood', { entities: ['[[world/saltwick]]'] });
    const quiet = event('Quiet', {});
    const wanted = (...names: string[]): Set<string> => new Set(names.map(keyOf));
    const passing = (keys: Set<string>): string[] =>
      [fire, flood, quiet].filter((candidate) => eventHasEntity(candidate, keys, index)).map((candidate) => candidate.title);
    expect(passing(wanted())).toEqual(['Fire', 'Flood', 'Quiet']);
    expect(passing(wanted('Mara'))).toEqual(['Fire']);
    expect(passing(wanted('Saltwick'))).toEqual(['Fire', 'Flood']);
    expect(passing(wanted('Mara', 'מרים'))).toEqual(['Fire']);
    expect(passing(wanted('מרים'))).toEqual([]);
  });
});

describe('changing the entities of a note', () => {
  it('adds a plain link at the end, and names nothing but "entities"', () => {
    expect(setEntitiesPatch({ date: 1923 }, [keyOf('Mara'), keyOf('Saltwick')], index)).toEqual({
      entities: ['[[Mara]]', '[[Saltwick]]'],
    });
    expect(setEntitiesPatch(deepFreeze({ entities: ['[[Mara]]'] }), [keyOf('Mara'), keyOf('מרים')], index)).toEqual({
      entities: ['[[Mara]]', '[[מרים]]'],
    });
  });

  it('keeps a link that stays exactly as it is written, alias and all, in its place', () => {
    const frontmatter = deepFreeze({ entities: ['[[World/Saltwick|the town]]', '[[Mara]]', '[[Ghost]]'] });
    const ghost = index.resolve('Ghost').key;
    expect(setEntitiesPatch(frontmatter, [keyOf('Saltwick'), ghost, keyOf('Places/Tom')], index)).toEqual({
      entities: ['[[World/Saltwick|the town]]', '[[Ghost]]', '[[World/Places/Tom]]'],
    });
  });

  it('tells two notes of one name apart by where they are', () => {
    expect(index.linkFor(keyOf('People/Tom'))).toBe('[[World/People/Tom]]');
    expect(index.linkFor(keyOf('Mara'))).toBe('[[Mara]]');
    expect(index.linkFor('name:nobody')).toBeNull();
    const nested = createEntityIndex(['Novel/World/Mara.md', 'Novel/World/A/Tom.md', 'Novel/World/B/Tom.md']);
    expect(nested.linkFor(nested.resolve('A/Tom').key)).toBe('[[World/A/Tom]]');
  });

  it('changes nothing when the note names those entities already, and writes an empty list when the last one goes', () => {
    expect(setEntitiesPatch({ entities: ['[[Mara]]', '[[Saltwick]]'] }, [keyOf('Saltwick'), keyOf('Mara')], index)).toEqual({});
    expect(setEntitiesPatch({}, [], index)).toEqual({});
    expect(setEntitiesPatch(null, [], index)).toEqual({});
    expect(setEntitiesPatch({ entities: ['[[Mara]]'] }, [], index)).toEqual({ entities: [] });
    // A link written without quotes is put right when the list is written again.
    expect(setEntitiesPatch({ entities: [[['Mara']]] }, [keyOf('Mara')], index)).toEqual({ entities: ['[[Mara]]'] });
    // A key that no note has cannot be added.
    expect(setEntitiesPatch({}, ['name:nobody'], index)).toEqual({});
  });
});

describe('the chips that fit on a card', () => {
  it('are all of them when there is room, with no room kept for a "+N"', () => {
    expect(chipsThatFit([40, 34, 60], 138, 2, 20)).toBe(3);
    expect(chipsThatFit([40], 40, 2, 20)).toBe(1);
    expect(chipsThatFit([], 0, 2, 20)).toBe(0);
  });

  it('are as many whole ones as fit beside the "+N" when there is not', () => {
    expect(chipsThatFit([40, 34, 60], 137, 2, 20)).toBe(2); // 40 + 2 + 34 + 2 + 20
    expect(chipsThatFit([40, 34, 60], 98, 2, 20)).toBe(2);
    expect(chipsThatFit([40, 34, 60], 97, 2, 20)).toBe(1);
    expect(chipsThatFit([40, 34, 60], 62, 2, 20)).toBe(1);
    expect(chipsThatFit([40, 34, 60], 61, 2, 20)).toBe(0);
    // Too narrow even for the "+N": still no chip in part.
    expect(chipsThatFit([40, 34, 60], 5, 2, 20)).toBe(0);
  });

  it('keep room for the "+N" when the event names more entities than there are chips', () => {
    expect(chipsThatFit([40, 34, 60], 138, 2, 20, 2)).toBe(2);
    expect(chipsThatFit([40, 34, 60], 160, 2, 20, 2)).toBe(3);
  });

  it('never skip a chip to show a later, shorter one: the order is the note\'s', () => {
    expect(chipsThatFit([90, 10, 10], 60, 2, 20)).toBe(0);
  });
});

describe('the calendar when a conflicting copy of the index is merged', () => {
  const ours = calendarToIndexValue(CALENDAR_PRESETS[1]?.calendar as StoryCalendar);
  const theirs = calendarToIndexValue(CALENDAR_PRESETS[2]?.calendar as StoryCalendar);

  it('is kept: the index never loses or changes the calendar it has', () => {
    expect([CALENDAR_KEY, MERGED_WHOLE_KEYS]).toEqual(['calendar', ['calendar']]);
    const main = deepFreeze({ calendar: ours, timelines: [{ name: 'Main plot', color: 'red' }] });
    expect(mergeConflictData(main, deepFreeze({ calendar: theirs }))).toEqual({ changes: {}, added: [] });
    expect(mergeConflictData(main, {})).toEqual({ changes: {}, added: [] });
  });

  it('is taken over whole from the copy when the index has none, and never mixed from two', () => {
    const merged = mergeConflictData(deepFreeze({ labels: [] }), deepFreeze({ calendar: theirs }));
    expect(merged.changes).toEqual({ calendar: theirs });
    expect(merged.changes['calendar']).not.toBe(theirs);
    expect(merged.added).toEqual([{ key: 'calendar', items: ['Ember reckoning'] }]);
    expect(readCalendar(merged.changes['calendar']).calendar).toEqual(CALENDAR_PRESETS[2]?.calendar);
    // The copy's has a leap rule and ours has not: nothing of it is brought in.
    const kept = mergeConflictData({ calendar: ours }, { calendar: theirs });
    expect(kept.changes).toEqual({});
  });

  it('leaves alone what is not a calendar', () => {
    expect(mergeConflictData({}, { calendar: 'Gregorian' }).changes).toEqual({});
    expect(mergeConflictData({ calendar: 'something by hand' }, { calendar: theirs }).changes).toEqual({});
  });
});
