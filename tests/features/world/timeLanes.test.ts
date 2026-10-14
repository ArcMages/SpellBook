// The world on the timeline, as the engine lays it out: one lane per type of
// entity that has a date, each entity a row from its first day to its last,
// packed so that no two rows of a lane overlap. Checked in the real-world
// calendar and in an invented one, across a wide pane and down a narrow one.

import { describe, expect, it } from 'vitest';
import { CALENDAR_PRESETS, makeScale, storyDateToText } from '../../../src/core/timeline';
import type { StoryCalendar } from '../../../src/core/timeline';
import {
  BUILT_IN_TYPES,
  OTHER_TYPE,
  WORLD_LANE_PREFIX,
  addType,
  isWorldLaneKey,
  layoutWorldLaneDown,
  layoutWorldLanes,
  readEntities,
  worldExtent,
  worldLaneKey,
  worldLanes,
} from '../../../src/core/world';
import type { EntityType, PlacedWorldRow, WorldLane } from '../../../src/core/world';
import { dayOf, measureByLength } from '../../timeline/helpers';

const EMBER = CALENDAR_PRESETS.find((preset) => preset.id === 'ten-months')?.calendar as StoryCalendar;

const NOTES = [
  { path: 'World/Characters/Mara.md', frontmatter: { type: 'character', date: '1889-04-17', moments: ['1911 | qualifies', '1923-10-13 | is sent to Saltwick'] } },
  { path: 'World/Characters/The Keeper.md', frontmatter: { type: 'character', date: 1858, end: '1923-03', moments: ['1892 | takes over the light'] } },
  { path: 'World/Characters/Tobias.md', frontmatter: { type: 'character', date: '1882-02' } },
  { path: 'World/Characters/Anon.md', frontmatter: { type: 'character', role: 'Nobody' } },
  { path: 'World/Characters/תמר.md', frontmatter: { type: 'character', date: 1897 } },
  { path: 'World/Places/The Old Lighthouse.md', frontmatter: { type: 'place', date: 1841, end: '1922-11' } },
  { path: 'World/Places/The Drowned Village.md', frontmatter: { type: 'place', date: 1612, end: 1723 } },
  { path: 'World/Items/The Ring.md', frontmatter: { type: 'item', end: 1723 } },
  { path: 'World/Items/The Net.md', frontmatter: { type: 'item', moments: ['1700 | first mended', 'once | lost'] } },
  { path: 'World/Factions/The Guild.md', frontmatter: { type: 'faction', summary: 'No date at all.' } },
  { path: 'World/Loose.md', frontmatter: { date: 1800 } },
];

function lanesOf(types: readonly EntityType[] = BUILT_IN_TYPES, options: Parameters<typeof worldLanes>[3] = {}): WorldLane[] {
  return worldLanes(readEntities(NOTES, types), types, null, options);
}

const names = (lane: WorldLane | undefined): string[] => (lane?.rows ?? []).map((row) => row.entity.name);

/** True when two rows of the same track share any room, with the gap between them. */
function overlap(a: PlacedWorldRow, b: PlacedWorldRow, gap: number): boolean {
  return a.track === b.track && a.position < b.position + b.size + gap && b.position < a.position + a.size + gap;
}

describe('the lanes of the world', () => {
  it('has one lane per type that has an entity with a date, in the order of the types, with "Other" last', () => {
    const lanes = lanesOf();
    expect(lanes.map((lane) => [lane.typeId, lane.name, lane.color, lane.rows.length])).toEqual([
      ['character', 'Characters', 'blue', 4],
      ['place', 'Places', 'green', 2],
      // The faction has no date: its type has no lane.
      ['item', 'Items', 'orange', 2],
      [OTHER_TYPE, 'Other', null, 1],
    ]);
    expect(lanes.every((lane) => !lane.hidden)).toBe(true);
    // An entity without any date is on no lane.
    expect(lanes.flatMap(names)).not.toContain('Anon');
    expect(lanes.flatMap(names)).not.toContain('The Guild');
  });

  it('gives every lane a key no lane of the writer\'s own can have', () => {
    const lanes = lanesOf();
    expect(lanes.map((lane) => lane.key)).toEqual(['world\ncharacter', 'world\nplace', 'world\nitem', 'world\n*other']);
    expect(WORLD_LANE_PREFIX).toBe('world\n');
    expect(worldLaneKey('character')).toBe('world\ncharacter');
    for (const lane of lanes) expect(isWorldLaneKey(lane.key)).toBe(true);
    // A lane called "World", or "Characters", is a lane like any other.
    for (const own of ['world', 'characters', 'manuscript', 'other', '', null, undefined]) expect(isWorldLaneKey(own)).toBe(false);
  });

  it('orders the rows of a lane by their first day, then by name', () => {
    const [characters, places] = lanesOf();
    expect(names(characters)).toEqual(['The Keeper', 'Tobias', 'Mara', 'תמר']);
    expect(names(places)).toEqual(['The Drowned Village', 'The Old Lighthouse']);
  });

  it('knows each row\'s span, its point and its moments', () => {
    const [characters, , items] = lanesOf();
    const keeper = characters?.rows[0];
    expect([keeper?.startDay, keeper?.endDay]).toEqual([dayOf(1858), dayOf(1923, 3)]);
    expect([keeper?.firstDay, keeper?.lastDay]).toEqual([dayOf(1858), dayOf(1923, 3)]);
    expect(keeper?.points.map((point) => [point.day, point.label])).toEqual([[dayOf(1892), 'takes over the light']]);
    // What a drag moves is the entity's own date and end, as an event's.
    expect([storyDateToText(keeper?.event.start ?? { precision: 'year', year: 1, month: 1, day: 1 }), keeper?.event.end?.precision]).toEqual(['1858', 'month']);

    const mara = characters?.rows[2];
    // Only a date: a point. Her moments reach further, and so does her row.
    expect([mara?.startDay, mara?.endDay]).toEqual([dayOf(1889, 4, 17), null]);
    expect([mara?.firstDay, mara?.lastDay]).toEqual([dayOf(1889, 4, 17), dayOf(1923, 10, 13)]);
    expect(mara?.event.end).toBeNull();
    expect(mara?.extent.end).not.toBeNull();

    // No date of its own, but a moment or an end: it has a row all the same, and cannot be dragged.
    const [net, ring] = [items?.rows.find((row) => row.entity.name === 'The Net'), items?.rows.find((row) => row.entity.name === 'The Ring')];
    expect([net?.startDay, net?.endDay, net?.firstDay, net?.points.length]).toEqual([null, null, dayOf(1700), 1]);
    expect([ring?.startDay, ring?.endDay, ring?.firstDay]).toEqual([null, dayOf(1723), dayOf(1723)]);
    expect([net?.event.start, ring?.event.start, ring?.event.end]).toEqual([null, null, null]);
  });

  it('marks the lanes this device hides, and has rows only for the entities the timeline is narrowed to', () => {
    expect(lanesOf(BUILT_IN_TYPES, { hidden: ['place', 'nothing'] }).map((lane) => [lane.typeId, lane.hidden])).toEqual([
      ['character', false],
      ['place', true],
      ['item', false],
      [OTHER_TYPE, false],
    ]);
    const narrowed = lanesOf(BUILT_IN_TYPES, { only: (entity) => entity.name === 'Mara' || entity.name === 'The Ring' });
    expect(narrowed.map((lane) => [lane.typeId, names(lane)])).toEqual([
      ['character', ['Mara']],
      ['item', ['The Ring']],
    ]);
  });

  it('follows the types of the project: the writer\'s own type has a lane, under its own name and colour', () => {
    const added = addType(BUILT_IN_TYPES, { name: 'ספינה', folder: 'ספינות', color: 'pink' });
    if (!added.ok) throw new Error(added.message);
    const lanes = worldLanes(
      readEntities([...NOTES, { path: 'World/ספינות/הדולפין.md', frontmatter: { type: 'ספינה', date: 1901 } }], added.types),
      added.types,
      null,
    );
    expect(lanes.map((lane) => lane.name)).toEqual(['Characters', 'Places', 'Items', 'ספינות', 'Other']);
    expect(lanes[3]).toMatchObject({ typeId: 'ספינה', color: 'pink', key: 'world\nספינה' });
  });

  it('covers the days from the first thing dated to the last', () => {
    expect(worldExtent(lanesOf())).toEqual({ firstDay: dayOf(1612), lastDay: dayOf(1923, 10, 13) });
    expect(worldExtent(lanesOf().slice(1, 2))).toEqual({ firstDay: dayOf(1612), lastDay: dayOf(1922, 11) });
    expect(worldExtent([])).toBeNull();
  });
});

describe('laying the world lanes out across a wide pane', () => {
  // About three centuries in 900 pixels: three pixels a year, as the world's history is fitted.
  const scale = makeScale(900 / (312 * 365.25), dayOf(1612));
  const laid = (): ReturnType<typeof layoutWorldLanes> => layoutWorldLanes(lanesOf(), { scale, measure: measureByLength });

  it('places every row where its first day is, as long as its dates or as its name needs, whichever is more', () => {
    const [characters, places] = laid();
    const row = (lane: typeof characters, name: string): PlacedWorldRow => lane?.items.find((item) => item.row.entity.name === name) as PlacedWorldRow;
    const village = row(places, 'The Drowned Village');
    expect(village.position).toBeCloseTo(0, 6);
    // 111 years at three pixels a year: longer than its name.
    expect(village.size).toBeCloseTo((dayOf(1723) - dayOf(1612)) * scale.pxPerDay, 6);
    expect(village.size).toBeGreaterThan(measureByLength('The Drowned Village'));
    expect(village.isSpan).toBe(true);
    // A point is as wide as its name.
    const tobias = row(characters, 'Tobias');
    expect(tobias.position).toBeCloseTo((dayOf(1882, 2) - dayOf(1612)) * scale.pxPerDay, 6);
    expect(tobias.size).toBe(measureByLength('Tobias'));
    expect(tobias.isSpan).toBe(false);
    // A point with moments reaches as far as its last moment, or its name.
    const mara = row(characters, 'Mara');
    expect(mara.size).toBeCloseTo(Math.max(measureByLength('Mara'), (dayOf(1923, 10, 13) - dayOf(1889, 4, 17)) * scale.pxPerDay), 6);
    expect(mara.isSpan).toBe(true);
  });

  it('packs the rows of a lane so that no two overlap, and keeps every lane and entity', () => {
    const lanes = laid();
    expect(lanes.map((entry) => [entry.lane.typeId, entry.items.length])).toEqual([
      ['character', 4],
      ['place', 2],
      ['item', 2],
      [OTHER_TYPE, 1],
    ]);
    for (const entry of lanes) {
      expect(entry.trackCount).toBe(Math.max(...entry.items.map((item) => item.track)) + 1);
      entry.items.forEach((a, index) => {
        for (const b of entry.items.slice(index + 1)) expect(overlap(a, b, 8), `${a.row.entity.name} / ${b.row.entity.name}`).toBe(false);
      });
    }
    // Four people born within forty years: each needs a row of its own at this zoom.
    expect(lanes[0]?.trackCount).toBe(4);
    // The village is long gone when the lighthouse is built: one row does for both.
    expect(lanes[1]?.trackCount).toBe(1);
  });

  it('never merges entities into a cluster, however far the view is zoomed out', () => {
    const far = layoutWorldLanes(lanesOf(), { scale: makeScale(0.0005, dayOf(1612)), measure: measureByLength });
    expect(far.flatMap((entry) => entry.items).map((item) => item.row.entity.name).sort()).toEqual(
      lanesOf().flatMap(names).sort(),
    );
    expect(far[0]?.trackCount).toBe(4);
  });

  it('shifts every row alike when the view slides: the rows stay what they are', () => {
    const slid = layoutWorldLanes(lanesOf(), { scale: makeScale(scale.pxPerDay, dayOf(1700)), measure: measureByLength });
    const shift = (dayOf(1700) - dayOf(1612)) * scale.pxPerDay;
    laid().forEach((entry, at) => {
      entry.items.forEach((item, index) => {
        const other = slid[at]?.items[index];
        expect(other?.track).toBe(item.track);
        expect(other?.size).toBe(item.size);
        expect((other?.position ?? 0) + shift).toBeCloseTo(item.position, 6);
      });
    });
  });

  it('has nothing to lay out without lanes', () => {
    expect(layoutWorldLanes([], { scale, measure: measureByLength })).toEqual([]);
  });
});

describe('laying a world lane out down a narrow pane', () => {
  const scale = makeScale(0.02, dayOf(1850));
  const characters = lanesOf()[0] as WorldLane;

  it('is one column of cards in order of time, none overlapping, each as tall as a card', () => {
    const laid = layoutWorldLaneDown(characters, { scale, measure: () => 48, gap: 6 });
    expect(laid.trackCount).toBe(1);
    expect(laid.items.map((item) => item.row.entity.name)).toEqual(['The Keeper', 'Tobias', 'Mara', 'תמר']);
    expect(laid.items.every((item) => item.track === 0 && item.size === 48)).toBe(true);
    laid.items.forEach((item, index) => {
      const next = laid.items[index + 1];
      if (next) expect(next.position).toBeGreaterThanOrEqual(item.position + item.size + 6);
    });
    // The first card stands where its date is.
    expect(laid.items[0]?.position).toBeCloseTo((dayOf(1858) - dayOf(1850)) * 0.02, 6);
  });
});

describe('the world lanes in an invented calendar', () => {
  const notes = [
    { path: 'World/Places/Emberhold.md', frontmatter: { type: 'place', date: '1203 AE', end: '1260-10-36 AE', moments: ['0003 BE | הנבואה', '1210-02 AE | the flood'] } },
    { path: 'World/Places/Old Rome.md', frontmatter: { type: 'place', date: 1889 } },
    { path: 'World/Characters/Ash.md', frontmatter: { type: 'character', date: '1240-04-17 AE' } },
  ];

  it('reads the calendar\'s own dates, and leaves out an entity whose date is of another calendar', () => {
    const lanes = worldLanes(readEntities(notes, BUILT_IN_TYPES), BUILT_IN_TYPES, EMBER);
    expect(lanes.map((lane) => [lane.typeId, names(lane)])).toEqual([
      ['character', ['Ash']],
      ['place', ['Emberhold']],
    ]);
    const hold = lanes[1]?.rows[0];
    // The prophecy, before the first era, is the first thing known of it.
    expect(hold?.points.map((point) => point.label)).toEqual(['הנבואה', 'the flood']);
    expect(hold?.firstDay).toBe(hold?.points[0]?.day);
    expect(hold?.firstDay).toBeLessThan(hold?.startDay ?? 0);
    expect(hold?.extent.start?.calendar).toBe(EMBER);
    expect(hold?.event.start?.calendar).toBe(EMBER);
    // A year of this calendar has 360 days (365 every fourth): the span is 58 years long.
    const years = ((hold?.endDay ?? 0) - (hold?.startDay ?? 0)) / 361.25;
    expect(years).toBeGreaterThan(57);
    expect(years).toBeLessThan(59);
    const laid = layoutWorldLanes(lanes, { scale: makeScale(0.01, hold?.firstDay ?? 0), measure: measureByLength });
    expect(laid.map((entry) => entry.items.length)).toEqual([1, 1]);
    expect(laid[1]?.items[0]?.position).toBeCloseTo(0, 6);
  });
});
