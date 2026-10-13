// The whole engine used the way a screen would use it: read a project, lay
// it out, drag a card, and write the result back as a change to one note.

import { describe, expect, it } from 'vitest';
import {
  addLane,
  applyFrontmatterPatch,
  eventLaneKeys,
  fitAll,
  laneBands,
  laneKey,
  layoutTimeline,
  moveEventToLanePatch,
  narrativeOrder,
  readEvent,
  readLanes,
  readTimeline,
  redateEventPatch,
  renameLane,
  resolveDrag,
  ticksFor,
  timelineExtent,
} from '../../src/core/timeline';
import type { PlacedEvent } from '../../src/core/timeline';
import { HEBREW, date, deepFreeze, measureByLength } from './helpers';

const index = deepFreeze({
  spellbook: 'project',
  version: 1,
  title: 'A Novel',
  binder: ['Manuscript/Opening.md', 'Manuscript/The Letter.md'],
  timelines: [
    { name: 'Main plot', color: 'purple' },
    { name: HEBREW.backstory, color: 'cyan' },
  ],
});

const eventNotes = deepFreeze([
  {
    path: 'Timeline/War.md',
    frontmatter: { spellbook: 'event', date: 1914, end: 1918, timelines: ['Main plot'], tags: ['war'] },
  },
  {
    path: `Timeline/${HEBREW.battle}.md`,
    frontmatter: {
      spellbook: 'event',
      date: '1916-07-01',
      timelines: [HEBREW.backstory, 'Main plot'],
      scenes: ['[[The Letter]]'],
      mood: 'grim', // a property the plugin knows nothing about
    },
  },
  { path: 'Timeline/Someday.md', frontmatter: { spellbook: 'event', date: null, timelines: ['Main plot'] } },
]);

const sceneNotes = deepFreeze([
  { path: 'Manuscript/Opening.md', frontmatter: { synopsis: 'It begins.', status: 'To do', date: '1916-06-30' } },
  { path: 'Manuscript/The Letter.md', frontmatter: { synopsis: 'A letter arrives.', status: 'To do' } },
]);

describe('the timeline, from reading a project to writing a change', () => {
  const lanes = readLanes(index.timelines).lanes;
  const model = readTimeline(eventNotes, sceneNotes);
  const viewport = 1000;
  const scale = fitAll(timelineExtent(model.dated), viewport, { paddingEnd: 200 });
  const layout = layoutTimeline(model.dated, lanes, { scale, measure: measureByLength });

  it('reads the events and the lanes', () => {
    expect(model.dated.map((event) => event.title)).toEqual(['War', 'Opening', HEBREW.battle]);
    expect(model.undated.map((event) => event.title)).toEqual(['Someday']);
    expect(layout.lanes.map((entry) => entry.lane.name)).toEqual(['Manuscript', 'Main plot', HEBREW.backstory]);
    expect(layout.lanes.map((entry) => entry.lane.color)).toEqual([null, 'purple', 'cyan']);
  });

  it('fits everything in the view and labels the years', () => {
    for (const entry of layout.lanes) {
      for (const item of entry.items) {
        expect(item.position).toBeGreaterThanOrEqual(24 - 1e-6);
        expect(item.position).toBeLessThanOrEqual(viewport - 200 + 1e-6);
      }
    }
    const war = layout.lanes[1]?.items[0] as PlacedEvent;
    expect(war.event.title).toBe('War');
    expect(war.position).toBeCloseTo(24, 6);
    expect(war.width).toBeCloseTo(776, 6); // four years, from the padding to 200 pixels before the edge
    const axis = ticksFor(scale, viewport);
    expect(axis.unit).toBe('year');
    expect(axis.ticks.map((tick) => tick.label)).toEqual(expect.arrayContaining(['1914', '1915', '1916', '1917', '1918']));
  });

  it('turns a drag into a change to one note, and nothing else in it', () => {
    const mainPlot = layout.lanes[1];
    const card = mainPlot?.items.find((item): item is PlacedEvent => item.kind === 'event' && item.event.title === HEBREW.battle);
    if (mainPlot === undefined || card === undefined || card.event.start === null) throw new Error('The card is missing.');

    const bands = laneBands(layout.lanes, { rowSize: 40, header: 20, laneGap: 8 });
    const target = bands[2];
    if (target === undefined) throw new Error('The third lane is missing.');
    const outcome = resolveDrag({
      start: card.event.start,
      end: card.event.end,
      lane: mainPlot.lane.key,
      along: 20 * scale.pxPerDay, // twenty days later
      across: 120,
      scale,
      bands,
      pointerAcross: target.start + target.size / 2,
    });
    if (outcome.kind !== 'drag') throw new Error('The press was taken for a tap.');
    expect(outcome).toMatchObject({
      start: date(1916, 7, 21),
      end: null,
      dateChanged: true,
      lane: laneKey(HEBREW.backstory),
      laneChanged: true,
    });

    // At the moment of writing: the note's properties as they are then.
    const note = eventNotes[1];
    if (note === undefined) throw new Error('The note is missing.');
    const properties: Record<string, unknown> = { ...note.frontmatter };
    const newLane = layout.lanes.find((entry) => entry.lane.key === outcome.lane)?.lane.name ?? '';
    applyFrontmatterPatch(properties, redateEventPatch(properties, outcome.start));
    applyFrontmatterPatch(properties, moveEventToLanePatch(properties, mainPlot.lane.name, newLane, { lanes }));
    expect(properties).toEqual({
      spellbook: 'event',
      date: '1916-07-21',
      timelines: [HEBREW.backstory], // it was in that lane already, so it only left Main plot
      scenes: ['[[The Letter]]'],
      mood: 'grim',
    });
    expect(Object.keys(properties)).toEqual(Object.keys(note.frontmatter));

    const reread = readEvent(note.path, properties);
    expect(reread.title).toBe(HEBREW.battle);
    expect(reread.start).toEqual(date(1916, 7, 21));
    expect(eventLaneKeys(reread, lanes)).toEqual([laneKey(HEBREW.backstory)]);
  });

  it('tells the events in the order of the book', () => {
    const order = narrativeOrder([...model.dated, ...model.undated], index.binder, { spacing: 100 });
    expect(order.map((item) => item.event.title)).toEqual(['Opening', HEBREW.battle, 'War', 'Someday']);
    expect(order.map((item) => item.position)).toEqual([0, 100, 200, 300]);
  });

  it('changes the lanes of the project and the notes that name them', () => {
    const added = addLane(index.timelines, 'Romance', 'pink');
    if (!added.ok) throw new Error(added.message);
    expect(added.value).toEqual([...index.timelines, { name: 'Romance', color: 'pink' }]);

    const renamed = renameLane(added.value, 'Main plot', 'The war', [...eventNotes, ...sceneNotes]);
    if (!renamed.ok) throw new Error(renamed.message);
    expect(renamed.lanes.map((lane) => lane.name)).toEqual(['The war', HEBREW.backstory, 'Romance']);
    expect(renamed.eventPatches).toEqual([
      { path: 'Timeline/War.md', patch: { timelines: ['The war'] } },
      { path: `Timeline/${HEBREW.battle}.md`, patch: { timelines: [HEBREW.backstory, 'The war'] } },
      { path: 'Timeline/Someday.md', patch: { timelines: ['The war'] } },
    ]);
  });
});
