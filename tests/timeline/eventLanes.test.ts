import { describe, expect, it } from 'vitest';
import {
  addEventToLanePatch,
  applyFrontmatterPatch,
  eventLaneKeys,
  laneKey,
  laneNameFor,
  moveEventToLanePatch,
  readEvent,
  removeEventFromLanePatch,
  renameLaneInEventPatch,
} from '../../src/core/timeline';
import type { Lane, LaneContext } from '../../src/core/timeline';
import { HEBREW, POINTED_AS_STORED, POINTED_AS_TYPED, deepFreeze, event, sceneEvent } from './helpers';

const lanes: Lane[] = [
  { name: 'Main plot', color: 'purple' },
  { name: 'Backstory', color: null },
  { name: HEBREW.mainPlot, color: 'blue' },
];
const context: LaneContext = { lanes };
const forScene: LaneContext = { lanes, source: 'scene' };

describe('eventLaneKeys', () => {
  it('puts an event in every lane it names', () => {
    expect(eventLaneKeys(event('A', { timelines: ['Main plot'] }), lanes)).toEqual(['main plot']);
    expect(eventLaneKeys(event('A', { timelines: ['Backstory', 'Main plot', HEBREW.mainPlot] }), lanes)).toEqual([
      'backstory',
      'main plot',
      laneKey(HEBREW.mainPlot),
    ]);
  });

  it('matches lane names whatever their capitals', () => {
    expect(eventLaneKeys(event('A', { timelines: ['MAIN PLOT', ' backstory '] }), lanes)).toEqual(['main plot', 'backstory']);
  });

  it('puts an event that names an unlisted timeline, or none, in Other', () => {
    expect(eventLaneKeys(event('A', { timelines: ['Ghost'] }), lanes)).toEqual(['other']);
    expect(eventLaneKeys(event('A', { timelines: ['Ghost', 'Phantom'] }), lanes)).toEqual(['other']); // once
    expect(eventLaneKeys(event('A', { timelines: ['Main plot', 'Ghost'] }), lanes)).toEqual(['main plot', 'other']);
    expect(eventLaneKeys(event('A', {}), lanes)).toEqual(['other']);
    expect(eventLaneKeys(event('A', { timelines: ['Main plot'] }), [])).toEqual(['other']);
  });

  it('puts a dated scene in Manuscript, and in the lanes it names besides', () => {
    expect(eventLaneKeys(sceneEvent('Opening', { date: 1923 }), lanes)).toEqual(['manuscript']);
    expect(eventLaneKeys(sceneEvent('Opening', { date: 1923, timelines: ['Main plot'] }), lanes)).toEqual([
      'manuscript',
      'main plot',
    ]);
    expect(eventLaneKeys(sceneEvent('Opening', { date: 1923, timelines: ['Ghost'] }), lanes)).toEqual(['manuscript', 'other']);
  });

  it('lets an event note join the Manuscript lane by naming it', () => {
    expect(eventLaneKeys(event('A', { timelines: ['Manuscript'] }), lanes)).toEqual(['manuscript']);
  });
});

describe('addEventToLanePatch', () => {
  it('adds the lane after the ones the event is in', () => {
    const properties = deepFreeze({ date: 1923, timelines: ['Main plot'] });
    expect(addEventToLanePatch(properties, 'Backstory', context)).toEqual({ timelines: ['Main plot', 'Backstory'] });
    expect(addEventToLanePatch(properties, HEBREW.mainPlot, context)).toEqual({
      timelines: ['Main plot', HEBREW.mainPlot],
    });
  });

  it('is empty when the event is in the lane already, whatever the capitals', () => {
    expect(addEventToLanePatch({ timelines: ['Main plot'] }, 'Main plot', context)).toEqual({});
    expect(addEventToLanePatch({ timelines: ['main plot'] }, 'Main Plot', context)).toEqual({});
    expect(addEventToLanePatch({ timelines: 'Main plot' }, 'main plot', context)).toEqual({});
  });

  it('starts a list when the event has none, and turns one name into a list', () => {
    expect(addEventToLanePatch({}, 'Main plot', context)).toEqual({ timelines: ['Main plot'] });
    expect(addEventToLanePatch({ timelines: null }, 'Main plot', context)).toEqual({ timelines: ['Main plot'] });
    expect(addEventToLanePatch(undefined, 'Main plot', context)).toEqual({ timelines: ['Main plot'] });
    expect(addEventToLanePatch({ timelines: 'Backstory' }, 'Main plot', context)).toEqual({
      timelines: ['Backstory', 'Main plot'],
    });
  });

  it('keeps entries it does not understand, exactly where they were', () => {
    const odd = { note: 'from another plugin' };
    const patch = addEventToLanePatch({ timelines: ['Ghost', odd, 7, null] }, 'Main plot', context);
    expect(patch).toEqual({ timelines: ['Ghost', odd, 7, null, 'Main plot'] });
    expect((patch['timelines'] as unknown[])[1]).toBe(odd);
    // A value that is no list at all is kept too, as the first entry.
    expect(addEventToLanePatch({ timelines: odd }, 'Main plot', context)).toEqual({ timelines: [odd, 'Main plot'] });
  });

  it('cannot put an event in Other, which only collects', () => {
    expect(addEventToLanePatch({ timelines: ['Main plot'] }, 'Other', context)).toEqual({});
    // Unless the project lists a lane of that name.
    const withOther: LaneContext = { lanes: [...lanes, { name: 'Other', color: null }] };
    expect(addEventToLanePatch({ timelines: ['Main plot'] }, 'Other', withOther)).toEqual({
      timelines: ['Main plot', 'Other'],
    });
  });

  it('does not write Manuscript on a scene, which is in that lane anyway', () => {
    expect(addEventToLanePatch({ date: 1923 }, 'Manuscript', forScene)).toEqual({});
    expect(addEventToLanePatch({ date: 1923 }, 'Manuscript', context)).toEqual({ timelines: ['Manuscript'] });
  });

  it('ignores an empty name', () => {
    expect(addEventToLanePatch({ timelines: ['Main plot'] }, '   ', context)).toEqual({});
  });
});

describe('removeEventFromLanePatch', () => {
  it('takes the lane out and keeps the rest in order', () => {
    const properties = deepFreeze({ timelines: ['Main plot', 'Backstory', HEBREW.mainPlot] });
    expect(removeEventFromLanePatch(properties, 'backstory', context)).toEqual({
      timelines: ['Main plot', HEBREW.mainPlot],
    });
    expect(removeEventFromLanePatch(properties, HEBREW.mainPlot, context)).toEqual({
      timelines: ['Main plot', 'Backstory'],
    });
  });

  it('takes the property away, rather than leave an empty list, when the last lane goes', () => {
    expect(removeEventFromLanePatch({ timelines: 'Main plot' }, 'Main plot', context)).toEqual({ timelines: undefined });
    const properties: Record<string, unknown> = { date: 1923, timelines: ['Main plot'] };
    applyFrontmatterPatch(properties, removeEventFromLanePatch(properties, 'Main plot', context));
    expect(properties).toEqual({ date: 1923 });
    expect('timelines' in properties).toBe(false);
  });

  it('is empty when the event does not name the lane', () => {
    expect(removeEventFromLanePatch({ timelines: ['Main plot'] }, 'Backstory', context)).toEqual({});
    expect(removeEventFromLanePatch({}, 'Backstory', context)).toEqual({});
    expect(removeEventFromLanePatch({ date: 1923 }, 'Manuscript', forScene)).toEqual({}); // a scene stays in Manuscript
  });

  it('removes every spelling of the name', () => {
    expect(removeEventFromLanePatch({ timelines: ['Main plot', 'Backstory', 'MAIN PLOT'] }, 'Main plot', context)).toEqual({
      timelines: ['Backstory'],
    });
  });

  it('taken out of Other, loses the names the project does not list and nothing else', () => {
    const odd = { note: 'kept' };
    expect(removeEventFromLanePatch({ timelines: ['Ghost', 'Main plot', odd, 'Phantom', 'Manuscript'] }, 'Other', context)).toEqual({
      timelines: ['Main plot', odd, 'Manuscript'],
    });
  });
});

describe('moveEventToLanePatch', () => {
  it('puts the new lane where the old one was', () => {
    const properties = deepFreeze({ timelines: ['Backstory', 'Main plot', 'Ghost'] });
    expect(moveEventToLanePatch(properties, 'Main plot', HEBREW.mainPlot, context)).toEqual({
      timelines: ['Backstory', HEBREW.mainPlot, 'Ghost'],
    });
  });

  it('only drops the old lane when the event is in the new one already', () => {
    expect(moveEventToLanePatch({ timelines: ['Backstory', 'Main plot'] }, 'Main plot', 'backstory', context)).toEqual({
      timelines: ['Backstory'],
    });
  });

  it('is empty when both are the same lane', () => {
    expect(moveEventToLanePatch({ timelines: ['Main plot'] }, 'Main plot', 'main plot', context)).toEqual({});
  });

  it('moved out of Other, swaps the unlisted names for the new lane', () => {
    expect(moveEventToLanePatch({ timelines: ['Ghost', 'Backstory', 'Phantom'] }, 'Other', 'Main plot', context)).toEqual({
      timelines: ['Main plot', 'Backstory'],
    });
    // An event with no lane at all sits in Other too.
    expect(moveEventToLanePatch({}, 'Other', 'Main plot', context)).toEqual({ timelines: ['Main plot'] });
  });

  it('cannot move an event into Other', () => {
    expect(moveEventToLanePatch({ timelines: ['Main plot'] }, 'Main plot', 'Other', context)).toEqual({});
  });

  it('keeps a scene in Manuscript: out of it only adds, into it only removes', () => {
    expect(moveEventToLanePatch({ date: 1923 }, 'Manuscript', 'Main plot', forScene)).toEqual({ timelines: ['Main plot'] });
    expect(moveEventToLanePatch({ date: 1923, timelines: ['Main plot', 'Backstory'] }, 'Main plot', 'Manuscript', forScene)).toEqual({
      timelines: ['Backstory'],
    });
    // An event note is in Manuscript only by naming it.
    expect(moveEventToLanePatch({ timelines: ['Main plot'] }, 'Main plot', 'Manuscript', context)).toEqual({
      timelines: ['Manuscript'],
    });
  });

  it('keeps entries it does not understand', () => {
    const odd = { note: 'kept' };
    expect(moveEventToLanePatch({ timelines: [odd, 'Main plot', 7] }, 'Main plot', 'Backstory', context)).toEqual({
      timelines: [odd, 'Backstory', 7],
    });
  });

  it('gives a change that reads back as the event in its new lane', () => {
    const properties: Record<string, unknown> = { date: 1923, timelines: ['Main plot', 'Backstory'], tags: ['war'] };
    applyFrontmatterPatch(properties, moveEventToLanePatch(properties, 'Main plot', HEBREW.mainPlot, context));
    expect(properties).toEqual({ date: 1923, timelines: [HEBREW.mainPlot, 'Backstory'], tags: ['war'] });
    expect(eventLaneKeys(readEvent('Timeline/A.md', properties), lanes)).toEqual([laneKey(HEBREW.mainPlot), 'backstory']);
  });
});

describe('the Other lane, once the project lists it', () => {
  // Giving Other a colour or a place of its own writes it into the index.
  const listed: Lane[] = [
    { name: 'Main plot', color: null },
    { name: 'Backstory', color: null },
    { name: 'Other', color: 'orange' },
  ];
  const withOther: LaneContext = { lanes: listed };

  it('still holds every name the project does not list', () => {
    expect(eventLaneKeys(event('A', { date: 1923, timelines: ['Ghost'] }), listed)).toEqual(['other']);
    expect(eventLaneKeys(event('A', { timelines: ['Other', 'Ghost'] }), listed)).toEqual(['other']);
  });

  it('lets an event be taken out of it', () => {
    expect(removeEventFromLanePatch({ date: 1923, timelines: ['Ghost'] }, 'Other', withOther)).toEqual({ timelines: undefined });
    const odd = { note: 'kept' };
    expect(removeEventFromLanePatch({ timelines: ['Ghost', 'Main plot', odd, 'OTHER', 'Phantom'] }, 'other', withOther)).toEqual({
      timelines: ['Main plot', odd],
    });
  });

  it('lets an event be moved out of it, and the event is then no longer there', () => {
    const properties: Record<string, unknown> = { date: 1923, timelines: ['Ghost'] };
    const patch = moveEventToLanePatch(properties, 'Other', 'Main plot', withOther);
    expect(patch).toEqual({ timelines: ['Main plot'] });
    applyFrontmatterPatch(properties, patch);
    expect(eventLaneKeys(readEvent('Timeline/A.md', properties), listed)).toEqual(['main plot']);

    expect(moveEventToLanePatch({ timelines: ['Other', 'Backstory', 'Ghost'] }, 'Other', 'Main plot', withOther)).toEqual({
      timelines: ['Main plot', 'Backstory'],
    });
    // A scene named an unlisted timeline: it leaves Other and stays in Manuscript.
    expect(moveEventToLanePatch({ date: 1923, timelines: ['Ghost'] }, 'Other', 'Backstory', { lanes: listed, source: 'scene' })).toEqual({
      timelines: ['Backstory'],
    });
  });

  it('counts an event that names an unlisted timeline as being in it already', () => {
    expect(addEventToLanePatch({ timelines: ['Ghost'] }, 'Other', withOther)).toEqual({});
    expect(moveEventToLanePatch({ timelines: ['Main plot', 'Ghost'] }, 'Main plot', 'Other', withOther)).toEqual({
      timelines: ['Ghost'],
    });
    // The entry that is leaving does not count.
    expect(moveEventToLanePatch({ date: 1923, timelines: ['Ghost'] }, 'Ghost', 'Other', withOther)).toEqual({
      timelines: ['Other'],
    });
  });
});

describe('the lane changes and the lanes an event shows in', () => {
  // Whatever the screen shows, taking a card out of a lane or carrying it to
  // another must be possible: the changes go by the rule the display goes by.
  const laneSets: Array<[string, Lane[]]> = [
    ['Other not listed', lanes],
    ['Other listed', [...lanes, { name: 'Other', color: 'orange' }]],
    ['Other and Manuscript listed', [{ name: 'other', color: null }, ...lanes, { name: 'MANUSCRIPT', color: 'green' }]],
    ['no lanes at all', []],
  ];
  const notes: Array<Record<string, unknown>> = [
    {},
    { timelines: [] },
    { timelines: ['Ghost'] },
    { timelines: 'Main plot' },
    { timelines: ['Other'] },
    { timelines: ['other', 'Ghost', 'Backstory'] },
    { timelines: ['Main plot', 'Ghost', { odd: true }, 'Phantom', HEBREW.mainPlot] },
    { timelines: ['Manuscript', 'MAIN PLOT', 'Main plot'] },
  ];
  const sources = ['event', 'scene'] as const;
  const read = (source: 'event' | 'scene', properties: Record<string, unknown>): string[] => {
    const made = source === 'scene' ? sceneEvent('A', { date: 1923, ...properties }) : event('A', properties);
    return made.timelines.length === 0 && source === 'event' ? ['(none)'] : made.timelines.map((name) => laneKey(name));
  };

  for (const [told, listed] of laneSets) {
    const shows = (source: 'event' | 'scene', properties: Record<string, unknown>): string[] =>
      eventLaneKeys(source === 'scene' ? sceneEvent('A', { date: 1923, ...properties }) : event('A', properties), listed);
    const targets = ['manuscript', 'other', ...listed.map((lane) => laneKey(lane.name))];
    const otherListed = listed.some((lane) => laneKey(lane.name) === 'other');

    it(`take an event out of every lane it shows in (${told})`, () => {
      for (const source of sources) {
        for (const note of notes) {
          for (const from of shows(source, note)) {
            const properties = { ...note };
            applyFrontmatterPatch(properties, removeEventFromLanePatch(deepFreeze({ ...note }), from, { lanes: listed, source }));
            const after = shows(source, properties);
            // Two lanes cannot be left: a scene's Manuscript, and Other for an event that names no lane at all.
            const stays =
              (source === 'scene' && from === 'manuscript') || (from === 'other' && read(source, properties)[0] === '(none)');
            expect(after.includes(from), `${source} ${JSON.stringify(note)} out of ${from}`).toBe(stays);
          }
        }
      }
    });

    it(`move an event from every lane it shows in to every other (${told})`, () => {
      for (const source of sources) {
        for (const note of notes) {
          for (const from of shows(source, note)) {
            for (const to of targets) {
              if (to === from) continue;
              const why = `${source} ${JSON.stringify(note)} from ${from} to ${to}`;
              const properties = { ...note };
              const patch = moveEventToLanePatch(deepFreeze({ ...note }), from, to, { lanes: listed, source });
              applyFrontmatterPatch(properties, patch);
              const after = shows(source, properties);
              if (to === 'other' && !otherListed) {
                expect(patch, why).toEqual({}); // Other only collects
                continue;
              }
              expect(after, why).toContain(to);
              expect(after.includes(from), why).toBe(source === 'scene' && from === 'manuscript');
            }
          }
        }
      }
    });
  }
});

describe('a lane given by its key', () => {
  // A drag reports the lane under the pointer by its key. What is written in
  // the note is the lane's name as the writer spelled it.
  const pointed: Lane[] = [...lanes, { name: POINTED_AS_TYPED, color: null }];

  it('is written as the project spells it', () => {
    expect(laneKey('Main plot')).not.toBe('Main plot');
    expect(moveEventToLanePatch({ timelines: ['Backstory'] }, 'backstory', laneKey('Main plot'), context)).toEqual({
      timelines: ['Main plot'],
    });
    expect(addEventToLanePatch({ timelines: [] }, laneKey('Main Plot'), context)).toEqual({ timelines: ['Main plot'] });
    expect(addEventToLanePatch({ timelines: ['Backstory'] }, '  MAIN PLOT ', context)).toEqual({
      timelines: ['Backstory', 'Main plot'],
    });
  });

  it('is written with the marks of a pointed Hebrew name in the order the writer typed them', () => {
    expect(laneKey(POINTED_AS_TYPED)).not.toBe(POINTED_AS_TYPED);
    const added = addEventToLanePatch({ timelines: ['Main plot'] }, laneKey(POINTED_AS_TYPED), { lanes: pointed });
    expect(added).toEqual({ timelines: ['Main plot', POINTED_AS_TYPED] });
    const moved = moveEventToLanePatch({ timelines: ['Main plot'] }, 'main plot', POINTED_AS_STORED, { lanes: pointed });
    expect((moved['timelines'] as string[])[0]).toBe(POINTED_AS_TYPED);
  });

  it('is written as "Manuscript" or "Other" for the built-in lanes', () => {
    expect(addEventToLanePatch({}, 'manuscript', context)).toEqual({ timelines: ['Manuscript'] });
    const withOther: LaneContext = { lanes: [...lanes, { name: 'other', color: null }] };
    expect(moveEventToLanePatch({ timelines: ['Main plot'] }, 'main plot', 'other', withOther)).toEqual({ timelines: ['Other'] });
  });

  it('is written as given, trimmed at its ends, when the project does not list the lane', () => {
    expect(addEventToLanePatch({}, '  Ghost  Story ', context)).toEqual({ timelines: ['Ghost  Story'] });
    expect(addEventToLanePatch({}, ` ${HEBREW.backstory} `, context)).toEqual({ timelines: [HEBREW.backstory] });
  });
});

describe('laneNameFor', () => {
  it('gives the name of a lane from its key or from any spelling of its name', () => {
    expect(laneNameFor('main plot', lanes)).toBe('Main plot');
    expect(laneNameFor(' MAIN PLOT ', lanes)).toBe('Main plot');
    expect(laneNameFor(laneKey(HEBREW.mainPlot), lanes)).toBe(HEBREW.mainPlot);
    expect(laneNameFor(laneKey(POINTED_AS_TYPED), [{ name: POINTED_AS_TYPED, color: null }])).toBe(POINTED_AS_TYPED);
    expect(laneNameFor(POINTED_AS_TYPED, [{ name: POINTED_AS_STORED, color: null }])).toBe(POINTED_AS_STORED);
  });

  it('gives the built-in lanes their own names, and an unlisted lane the text it was given', () => {
    expect(laneNameFor('manuscript', lanes)).toBe('Manuscript');
    expect(laneNameFor('OTHER', [])).toBe('Other');
    expect(laneNameFor('manuscript', [{ name: 'MANUSCRIPT', color: 'green' }])).toBe('Manuscript');
    expect(laneNameFor(' Ghost ', lanes)).toBe('Ghost');
    expect(laneNameFor(HEBREW.backstory, lanes)).toBe(HEBREW.backstory);
    expect(laneNameFor('   ', lanes)).toBe('');
  });
});

describe('renameLaneInEventPatch', () => {
  it('puts the new name where the old one was', () => {
    const properties = deepFreeze({ timelines: ['Backstory', 'main plot', 'Ghost'] });
    expect(renameLaneInEventPatch(properties, 'Main plot', HEBREW.mainPlot)).toEqual({
      timelines: ['Backstory', HEBREW.mainPlot, 'Ghost'],
    });
  });

  it('is empty for an event that does not name the lane', () => {
    expect(renameLaneInEventPatch({ timelines: ['Backstory'] }, 'Main plot', 'Plot A')).toEqual({});
    expect(renameLaneInEventPatch({}, 'Main plot', 'Plot A')).toEqual({});
    expect(renameLaneInEventPatch(null, 'Main plot', 'Plot A')).toEqual({});
  });

  it('respells the name when only its capitals change, and is empty when it is already so', () => {
    expect(renameLaneInEventPatch({ timelines: ['main plot'] }, 'Main plot', 'Main Plot')).toEqual({ timelines: ['Main Plot'] });
    expect(renameLaneInEventPatch({ timelines: ['Main Plot'] }, 'main plot', 'Main Plot')).toEqual({});
  });

  it('does not name a lane twice', () => {
    expect(renameLaneInEventPatch({ timelines: ['Main plot', 'Plot A'] }, 'Main plot', 'plot a')).toEqual({
      timelines: ['Plot A'],
    });
    expect(renameLaneInEventPatch({ timelines: ['Main plot', 'Backstory', 'MAIN PLOT'] }, 'Main plot', 'Plot A')).toEqual({
      timelines: ['Plot A', 'Backstory'],
    });
  });

  it('renames a lane that was written as a number', () => {
    expect(renameLaneInEventPatch({ timelines: [1923, 'Backstory'] }, '1923', 'The twenties')).toEqual({
      timelines: ['The twenties', 'Backstory'],
    });
  });
});
