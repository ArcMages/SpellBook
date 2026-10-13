import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CARD_GAP,
  DEFAULT_CLUSTER_BELOW_PX_PER_DAY,
  DEFAULT_CLUSTER_DISTANCE,
  DEFAULT_MIN_CARD_LENGTH,
  dayToPosition,
  layoutLaneVertical,
  layoutTimeline,
  makeScale,
  panBy,
  readLanes,
} from '../../src/core/timeline';
import type {
  Lane,
  LaneLayout,
  PlacedCluster,
  PlacedEvent,
  PlacedItem,
  TimeScale,
  TimelineEvent,
  TimelineLayout,
} from '../../src/core/timeline';
import {
  HEBREW,
  POINTED_AS_STORED,
  POINTED_AS_TYPED,
  date,
  dayOf,
  deepFreeze,
  event,
  measureByLength,
  sceneEvent,
} from './helpers';

const lanes: Lane[] = [
  { name: 'Main plot', color: 'purple' },
  { name: 'Backstory', color: null },
];

/** Two pixels a day, with 1 January 1923 at the start of the view. */
const scale = makeScale(2, dayOf(1923, 1, 1));
const options = { scale, measure: measureByLength };

function lane(layout: TimelineLayout, name: string): LaneLayout {
  const found = layout.lanes.find((candidate) => candidate.lane.name === name);
  if (found === undefined) throw new Error(`The layout has no lane named "${name}".`);
  return found;
}

function titled(layout: LaneLayout, title: string): PlacedEvent {
  const found = layout.items.find((item): item is PlacedEvent => item.kind === 'event' && item.event.title === title);
  if (found === undefined) throw new Error(`The lane has no card titled "${title}".`);
  return found;
}

const clusters = (layout: LaneLayout): PlacedCluster[] =>
  layout.items.filter((item): item is PlacedCluster => item.kind === 'cluster');

/** Fails if two cards in the same row of a lane come closer than the gap. */
function expectNoOverlap(items: readonly PlacedItem[], gap: number): void {
  const rows = new Map<number, PlacedItem[]>();
  for (const item of items) {
    const row = rows.get(item.row) ?? [];
    row.push(item);
    rows.set(item.row, row);
  }
  for (const row of rows.values()) {
    row.sort((a, b) => a.position - b.position);
    for (let index = 1; index < row.length; index++) {
      const previous = row[index - 1] as PlacedItem;
      const current = row[index] as PlacedItem;
      expect(current.position, `row ${current.row}`).toBeGreaterThanOrEqual(previous.position + previous.width + gap - 1e-9);
    }
  }
}

/** A small repeatable source of numbers, so a "random" test is the same every time. */
function sequence(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
}

describe('layoutTimeline', () => {
  it('puts a card where its date is, as wide as its title needs', () => {
    const layout = layoutTimeline([event('Fire', { date: '1923-01-11', timelines: ['Main plot'] })], lanes, options);
    const card = titled(lane(layout, 'Main plot'), 'Fire');
    expect(card).toMatchObject({ kind: 'event', row: 0, position: 20, width: 4 * 7 + 16, isSpan: false });
  });

  it('keeps cards that do not touch in one row', () => {
    const events = [
      event('January', { date: '1923-01-01', timelines: ['Main plot'] }),
      event('July', { date: '1923-07-01', timelines: ['Main plot'] }),
      event('December', { date: '1923-12-01', timelines: ['Main plot'] }),
    ];
    const main = lane(layoutTimeline(events, lanes, options), 'Main plot');
    expect(main.rowCount).toBe(1);
    expect(main.items.map((item) => item.row)).toEqual([0, 0, 0]);
  });

  it('stacks cards that would overlap into more rows, and reuses a row once it is free', () => {
    const events = [
      event('First', { date: '1923-01-01', timelines: ['Main plot'] }), // 51 wide: 0 to 51
      event('Second', { date: '1923-01-05', timelines: ['Main plot'] }), // starts at 8: overlaps First
      event('Third', { date: '1923-01-09', timelines: ['Main plot'] }), // starts at 16: overlaps both
      event('Later', { date: '1923-03-01', timelines: ['Main plot'] }), // starts at 118: all rows are free
    ];
    const main = lane(layoutTimeline(events, lanes, options), 'Main plot');
    expect(main.rowCount).toBe(3);
    expect(titled(main, 'First').row).toBe(0);
    expect(titled(main, 'Second').row).toBe(1);
    expect(titled(main, 'Third').row).toBe(2);
    expect(titled(main, 'Later').row).toBe(0);
    expectNoOverlap(main.items, DEFAULT_CARD_GAP);
  });

  it('keeps the gap between two cards in a row', () => {
    const measure = (): number => 40;
    const fits = [
      event('A', { date: '1923-01-01', timelines: ['Main plot'] }),
      event('B', { date: '1923-01-25', timelines: ['Main plot'] }), // 48 pixels on: exactly the card and the gap
    ];
    expect(lane(layoutTimeline(fits, lanes, { scale, measure }), 'Main plot').rowCount).toBe(1);
    const tooClose = [fits[0] as TimelineEvent, event('B', { date: '1923-01-24', timelines: ['Main plot'] })];
    expect(lane(layoutTimeline(tooClose, lanes, { scale, measure }), 'Main plot').rowCount).toBe(2);
    expect(lane(layoutTimeline(tooClose, lanes, { scale, measure, gap: 0 }), 'Main plot').rowCount).toBe(1);
  });

  it('makes a span as wide as its dates, or as its title needs, whichever is more', () => {
    const events = [
      event('War', { date: '1923-01-01', end: '1923-07-01', timelines: ['Main plot'] }), // 181 days
      event('A long title for a short stay', { date: '1923-09-01', end: '1923-09-03', timelines: ['Main plot'] }),
    ];
    const main = lane(layoutTimeline(events, lanes, options), 'Main plot');
    expect(titled(main, 'War')).toMatchObject({ position: 0, width: 362, isSpan: true });
    expect(titled(main, 'A long title for a short stay')).toMatchObject({ width: 29 * 7 + 16, isSpan: true });
  });

  it('never makes a card smaller than the smallest card, whatever the measuring function says', () => {
    for (const answer of [0, -40, Number.NaN, Number.NEGATIVE_INFINITY]) {
      const layout = layoutTimeline([event('A', { date: 1923, timelines: ['Main plot'] })], lanes, {
        scale,
        measure: () => answer,
      });
      expect(titled(lane(layout, 'Main plot'), 'A').width, String(answer)).toBe(DEFAULT_MIN_CARD_LENGTH);
    }
    const wider = layoutTimeline([event('A', { date: 1923, timelines: ['Main plot'] })], lanes, {
      scale,
      measure: () => 10,
      minLength: 60,
    });
    expect(titled(lane(wider, 'Main plot'), 'A').width).toBe(60);
  });

  it('hands titles to the measuring function exactly as written, right-to-left ones too', () => {
    const titles = [HEBREW.battle, HEBREW.pointed, HEBREW.mixed, POINTED_AS_TYPED, POINTED_AS_STORED, '  spaced  '];
    expect(POINTED_AS_TYPED).not.toBe(POINTED_AS_STORED); // two spellings of one word: neither may be "tidied"
    const events = titles.map((title, index) => event(title, { date: 1900 + index, timelines: ['Main plot'] }));
    const seen: Array<[string, TimelineEvent | null]> = [];
    const layout = layoutTimeline(events, lanes, {
      scale,
      measure: (text, measuredEvent) => {
        seen.push([text, measuredEvent]);
        return measureByLength(text);
      },
    });
    expect(seen.map(([text]) => text)).toEqual(titles);
    expect(seen.map(([, measuredEvent]) => measuredEvent)).toEqual(events);
    const main = lane(layout, 'Main plot');
    for (const title of titles) {
      const card = titled(main, title);
      expect(card.event.title).toBe(title);
      expect(card.width).toBe(measureByLength(title));
    }
  });

  it('gives an event in several lanes a card in each', () => {
    const both = event('Both', { date: '1923-02-01', timelines: ['Main plot', 'Backstory'] });
    const layout = layoutTimeline([both], lanes, options);
    expect(titled(lane(layout, 'Main plot'), 'Both').event).toBe(both);
    expect(titled(lane(layout, 'Backstory'), 'Both').event).toBe(both);
    expect(titled(lane(layout, 'Main plot'), 'Both').position).toBe(titled(lane(layout, 'Backstory'), 'Both').position);
  });

  it('lays out the lanes in display order, each with its own rows', () => {
    const events = [
      sceneEvent('Opening', { date: '1923-01-01' }),
      sceneEvent('Reply', { date: '1923-01-02', timelines: ['Backstory'] }),
      event('Fire', { date: '1923-01-01', timelines: ['Main plot'] }),
      event('Ghost story', { date: '1923-01-01', timelines: ['Ghost'] }),
      event('Lost', { date: '1923-01-01' }),
    ];
    const layout = layoutTimeline(events, lanes, options);
    expect(layout.lanes.map((entry) => entry.lane.name)).toEqual(['Manuscript', 'Main plot', 'Backstory', 'Other']);
    expect(layout.lanes.map((entry) => entry.rowCount)).toEqual([2, 1, 1, 2]);
    expect(lane(layout, 'Manuscript').items.map((item) => (item as PlacedEvent).event.title)).toEqual(['Opening', 'Reply']);
    expect(lane(layout, 'Other').items.map((item) => (item as PlacedEvent).event.title)).toEqual(['Ghost story', 'Lost']);
  });

  it('gives an empty lane no rows', () => {
    const layout = layoutTimeline([event('Fire', { date: 1923, timelines: ['Main plot'] })], lanes, options);
    expect(lane(layout, 'Backstory')).toMatchObject({ rowCount: 0, items: [] });
    expect(lane(layout, 'Manuscript')).toMatchObject({ rowCount: 0, items: [] });
    expect(layoutTimeline([], [], options).lanes.map((entry) => entry.lane.name)).toEqual(['Manuscript']);
  });

  it('leaves hidden lanes out, and does not drop their events into Other', () => {
    const events = [
      event('Fire', { date: 1923, timelines: ['Main plot'] }),
      event('Flood', { date: 1924, timelines: ['Backstory'] }),
    ];
    const layout = layoutTimeline(events, lanes, { ...options, hidden: ['main PLOT', 'Manuscript'] });
    expect(layout.lanes.map((entry) => entry.lane.name)).toEqual(['Backstory']);
    expect(layout.lanes[0]?.items).toHaveLength(1);
  });

  it('leaves undated events out', () => {
    const events = [event('Someday', { timelines: ['Main plot'] }), event('Broken', { date: 'soon', timelines: ['Main plot'] })];
    expect(lane(layoutTimeline(events, lanes, options), 'Main plot').items).toEqual([]);
    // An undated event with no lane of its own does not call up an empty Other lane either.
    const orphan = [event('Someday', { timelines: ['Ghost'] }), event('Fire', { date: 1923, timelines: ['Main plot'] })];
    expect(layoutTimeline(orphan, lanes, options).lanes.map((entry) => entry.lane.name)).toEqual(['Manuscript', 'Main plot', 'Backstory']);
  });

  it('still places every card when the scale is not one', () => {
    const events = ['a', 'b'].map((title) => event(title, { date: '1923-01-01', timelines: ['Main plot'] }));
    for (const broken of [{ pxPerDay: 0, originDay: 0 }, { pxPerDay: Number.NaN, originDay: 0 }, { pxPerDay: 2, originDay: Number.NaN }]) {
      const main = lane(layoutTimeline(events, lanes, { scale: broken, measure: measureByLength }), 'Main plot');
      expect(main.rowCount).toBe(2);
      for (const item of main.items) {
        expect(Number.isFinite(item.position)).toBe(true);
        expect(Number.isFinite(item.width)).toBe(true);
      }
    }
  });

  it('on the same day, places the longer event first, then in the order given', () => {
    const events = [
      event('Point b', { date: '1923-01-01', timelines: ['Main plot'] }),
      event('Short span', { date: '1923-01-01', end: '1923-01-10', timelines: ['Main plot'] }),
      event('Point a', { date: '1923-01-01', timelines: ['Main plot'] }),
      event('Long span', { date: '1923-01-01', end: '1923-06-01', timelines: ['Main plot'] }),
    ];
    const main = lane(layoutTimeline(events, lanes, options), 'Main plot');
    expect(main.items.map((item) => (item as PlacedEvent).event.title)).toEqual(['Long span', 'Short span', 'Point b', 'Point a']);
    expect(main.items.map((item) => item.row)).toEqual([0, 1, 2, 3]);
  });

  it('only shifts every card alike when the view slides', () => {
    const random = sequence(11);
    const events = Array.from({ length: 200 }, (_, index) =>
      event(`E${index}`, { date: 1900 + Math.floor(random() * 40), timelines: ['Main plot'] }),
    );
    const before = lane(layoutTimeline(events, lanes, options), 'Main plot');
    const after = lane(layoutTimeline(events, lanes, { ...options, scale: panBy(scale, 500) }), 'Main plot');
    expect(after.rowCount).toBe(before.rowCount);
    after.items.forEach((item, index) => {
      const earlier = before.items[index] as PlacedItem;
      expect(item.row).toBe(earlier.row);
      expect(item.width).toBe(earlier.width);
      expect(item.position - earlier.position).toBeCloseTo(500, 6);
    });
  });

  it('keeps spans that share an end and a start in one row, at every place the view slides to', () => {
    // With no gap asked for, a span may start on the very day the one before it ends.
    const events = [
      event('War', { date: 1914, end: 1918, timelines: ['Main plot'] }),
      event('Peace', { date: 1918, end: 1939, timelines: ['Main plot'] }),
      event(HEBREW.battle, { date: 1939, end: 1945, timelines: ['Main plot'] }),
    ];
    const measure = (): number => 24;
    const rowsAt = (at: TimeScale): number =>
      lane(layoutTimeline(events, lanes, { scale: at, measure, gap: 0 }), 'Main plot').rowCount;

    const sliding = new Set<number>();
    for (let step = 0; step < 2000; step++) sliding.add(rowsAt(panBy(makeScale(0.731, -20000), step * 3.3)));
    expect([...sliding]).toEqual([1]);

    // And at any zoom at which each span is longer than its card.
    const random = sequence(23);
    const anywhere = new Set<number>();
    for (let step = 0; step < 2000; step++) {
      anywhere.add(rowsAt(makeScale(0.05 + random() * 40, Math.round((random() - 0.5) * 200_000) + random())));
    }
    expect([...anywhere]).toEqual([1]);
    // A gap of any size sends the second span to the next row, as it should.
    expect(lane(layoutTimeline(events, lanes, { scale: makeScale(0.731, -20000), measure, gap: 1 }), 'Main plot').rowCount).toBe(2);
  });

  it('gives the very same rows, lengths and clusters wherever the view has slid to', () => {
    const random = sequence(41);
    const events: TimelineEvent[] = [];
    for (let index = 0; index < 400; index++) {
      const year = 1800 + Math.floor(random() * 200);
      const properties: Record<string, unknown> = { date: year, timelines: ['Main plot'] };
      if (random() < 0.4) properties['end'] = year + 1 + Math.floor(random() * 12); // many spans end where others start
      events.push(event(`${index % 5 === 0 ? HEBREW.opening : 'E'} ${index}`, properties));
    }
    // One zoom close enough for single cards, one far enough for clusters.
    for (const zoom of [0.731, 0.07]) {
      const home = makeScale(zoom, dayOf(1800));
      const before = lane(layoutTimeline(events, lanes, { scale: home, measure: measureByLength, gap: 0 }), 'Main plot');
      if (zoom < DEFAULT_CLUSTER_BELOW_PX_PER_DAY) expect(clusters(before).length).toBeGreaterThan(0);
      for (const distance of [0.1, 3.3, 500, 777.77, -12_345.678, 1e6 / 3]) {
        const slid = panBy(home, distance);
        const after = lane(layoutTimeline(events, lanes, { scale: slid, measure: measureByLength, gap: 0 }), 'Main plot');
        expect(after.rowCount, `${zoom} slid ${distance}`).toBe(before.rowCount);
        expect(after.items.length).toBe(before.items.length);
        after.items.forEach((item, index) => {
          const earlier = before.items[index] as PlacedItem;
          expect(item.kind).toBe(earlier.kind);
          expect(item.row).toBe(earlier.row);
          expect(item.width).toBe(earlier.width); // exactly, not nearly
          expect(item.kind === 'cluster' ? item.count : 1).toBe(earlier.kind === 'cluster' ? earlier.count : 1);
          expect(item.position - earlier.position).toBeCloseTo(distance, 4);
        });
      }
    }
  });

  it('never lets two cards of a row overlap, for many events of every kind', () => {
    const random = sequence(5);
    const names = ['Main plot', 'Backstory', 'Ghost'];
    const events: TimelineEvent[] = [];
    for (let index = 0; index < 1500; index++) {
      const start = dayOf(1900) + Math.floor(random() * 3000);
      const length = random() < 0.3 ? Math.floor(random() * 200) : 0;
      const properties: Record<string, unknown> = {
        date: new Date(start * 86_400_000).toISOString().slice(0, 10),
        timelines: [names[index % 3], names[(index + 1) % 3]],
      };
      if (length > 0) properties['end'] = new Date((start + length) * 86_400_000).toISOString().slice(0, 10);
      events.push(event(`${index % 7 === 0 ? HEBREW.battle : 'Event'} ${index}`, properties));
    }
    const layout = layoutTimeline(events, lanes, { scale: makeScale(1.5, dayOf(1900)), measure: measureByLength });
    let cards = 0;
    for (const entry of layout.lanes) {
      expectNoOverlap(entry.items, DEFAULT_CARD_GAP);
      const used = new Set(entry.items.map((item) => item.row));
      expect(used.size).toBe(entry.rowCount); // no row is left empty
      for (const item of entry.items) expect(item.row).toBeLessThan(entry.rowCount);
      cards += entry.items.length;
    }
    expect(cards).toBe(3000); // every event is in two lanes
  });

  it('does not change what it is given', () => {
    const events = deepFreeze([
      event('Fire', { date: '1923-01-11', timelines: ['Main plot'] }),
      event('Flood', { date: '1923-01-12', timelines: ['Main plot'] }),
    ]);
    expect(() => layoutTimeline(events, deepFreeze([...lanes]), options)).not.toThrow();
  });
});

describe('clusters', () => {
  // Far out: a tenth of a pixel a day, so a year is 36 pixels.
  const far = makeScale(0.1, dayOf(1900));
  const farOptions = { scale: far, measure: measureByLength };

  it('merge single-date events that crowd together when zoomed far out', () => {
    const events = [
      event(HEBREW.battle, { date: '1900-01-01', timelines: ['Main plot'] }),
      event('Second', { date: '1900-02-01', timelines: ['Main plot'] }),
      event(HEBREW.mixed, { date: '1900-04-01', timelines: ['Main plot'] }),
      event('Alone', { date: '1950-01-01', timelines: ['Main plot'] }),
    ];
    const main = lane(layoutTimeline(events, lanes, farOptions), 'Main plot');
    expect(main.items).toHaveLength(2);
    const [cluster] = clusters(main);
    expect(cluster).toMatchObject({
      kind: 'cluster',
      count: 3,
      label: '3 events',
      start: date(1900, 1, 1),
      end: date(1900, 4, 1),
      position: 0,
      row: 0,
      width: measureByLength('3 events'),
    });
    // The events inside are whole and in order, right-to-left titles included.
    expect(cluster?.events.map((inside) => inside.title)).toEqual([HEBREW.battle, 'Second', HEBREW.mixed]);
    expect(cluster?.events[0]).toBe(events[0]);
    expect(titled(main, 'Alone').position).toBeCloseTo(dayToPosition(far, dayOf(1950)), 6);
  });

  it('measure the label of a cluster, not the titles inside it', () => {
    const measured: Array<[string, TimelineEvent | null]> = [];
    const events = [HEBREW.battle, HEBREW.pointed, 'Third'].map((title, index) =>
      event(title, { date: `1900-01-0${index + 1}`, timelines: ['Main plot'] }),
    );
    layoutTimeline(events, lanes, {
      scale: far,
      measure: (text, measuredEvent) => {
        measured.push([text, measuredEvent]);
        return 50;
      },
    });
    expect(measured).toEqual([['3 events', null]]);
  });

  it('do not form when zoomed in, even for events on the very same day', () => {
    expect(scale.pxPerDay).toBeGreaterThanOrEqual(DEFAULT_CLUSTER_BELOW_PX_PER_DAY);
    const events = ['a', 'b', 'c'].map((title) => event(title, { date: '1923-01-01', timelines: ['Main plot'] }));
    const main = lane(layoutTimeline(events, lanes, options), 'Main plot');
    expect(clusters(main)).toEqual([]);
    expect(main.rowCount).toBe(3);
  });

  it('can be turned off, or given another distance and another zoom to start at', () => {
    const events = ['a', 'b', 'c'].map((title, index) =>
      event(title, { date: `1900-0${index + 1}-01`, timelines: ['Main plot'] }),
    );
    const off = lane(layoutTimeline(events, lanes, { ...farOptions, clusterDistance: 0 }), 'Main plot');
    expect(clusters(off)).toEqual([]);
    expect(off.items).toHaveLength(3);
    // a is at 0, b at 3.1 and c at 5.9 pixels: only a and b are within 4.
    const tight = lane(layoutTimeline(events, lanes, { ...farOptions, clusterDistance: 4 }), 'Main plot');
    expect(clusters(tight).map((cluster) => cluster.count)).toEqual([2]);
    const never = lane(layoutTimeline(events, lanes, { ...farOptions, clusterBelowPxPerDay: 0.05 }), 'Main plot');
    expect(clusters(never)).toEqual([]);
    const always = lane(layoutTimeline(events, lanes, { scale, measure: measureByLength, clusterBelowPxPerDay: 5, clusterDistance: 200 }), 'Main plot');
    expect(clusters(always).map((cluster) => cluster.count)).toEqual([3]);
  });

  it('reach no further than the distance from their first event, so a long row of events makes many', () => {
    // One event every 100 days: 10 pixels apart, with clusters 16 pixels wide at most.
    const events = Array.from({ length: 10 }, (_, index) =>
      event(`E${index}`, { date: new Date((dayOf(1900) + index * 100) * 86_400_000).toISOString().slice(0, 10), timelines: ['Main plot'] }),
    );
    const main = lane(layoutTimeline(events, lanes, farOptions), 'Main plot');
    expect(DEFAULT_CLUSTER_DISTANCE).toBe(16);
    expect(clusters(main).map((cluster) => cluster.count)).toEqual([2, 2, 2, 2, 2]);
    for (const cluster of clusters(main)) {
      const span = dayOf(cluster.end.year, cluster.end.month, cluster.end.day) - dayOf(cluster.start.year, cluster.start.month, cluster.start.day);
      expect(span * far.pxPerDay).toBeLessThan(DEFAULT_CLUSTER_DISTANCE);
    }
    expectNoOverlap(main.items, DEFAULT_CARD_GAP);
  });

  it('never swallow a span, and stay inside their own lane', () => {
    const events = [
      event('Point 1', { date: '1900-01-01', timelines: ['Main plot'] }),
      event('Span', { date: '1900-01-05', end: '1903-01-01', timelines: ['Main plot'] }),
      event('Point 2', { date: '1900-01-10', timelines: ['Main plot'] }),
      event('Elsewhere', { date: '1900-01-03', timelines: ['Backstory'] }),
    ];
    const layout = layoutTimeline(events, lanes, farOptions);
    const main = lane(layout, 'Main plot');
    expect(clusters(main).map((cluster) => cluster.events.map((inside) => inside.title))).toEqual([['Point 1', 'Point 2']]);
    expect(titled(main, 'Span')).toMatchObject({ isSpan: true });
    expect(clusters(lane(layout, 'Backstory'))).toEqual([]);
    expect(titled(lane(layout, 'Backstory'), 'Elsewhere').row).toBe(0);
    expectNoOverlap(main.items, DEFAULT_CARD_GAP);
  });

  it('give the date range of events of mixed precision', () => {
    const events = [
      event('Year', { date: 1900, timelines: ['Main plot'] }),
      event('Month', { date: '1900-02', timelines: ['Main plot'] }),
      event('Day', { date: '1900-03-15', timelines: ['Main plot'] }),
    ];
    const [cluster] = clusters(lane(layoutTimeline(events, lanes, farOptions), 'Main plot'));
    expect(cluster?.start).toEqual(date(1900));
    expect(cluster?.end).toEqual(date(1900, 3, 15));
  });
});

describe('thousands of events', () => {
  it('are laid out quickly even when every one falls on the same day', () => {
    const count = 100_000;
    const events = Array.from({ length: count }, (_, index) => event(`E${index}`, { date: '1923-06-01', timelines: ['Main plot'] }));
    const started = performance.now();
    const main = lane(layoutTimeline(events, lanes, { scale, measure: () => 60 }), 'Main plot');
    const took = performance.now() - started;
    expect(main.rowCount).toBe(count);
    expect(main.items[count - 1]?.row).toBe(count - 1);
    // Searching the rows one by one would take billions of steps here.
    expect(took).toBeLessThan(1500);
  });

  it('are laid out quickly when spread over centuries, and shrink to a few clusters when zoomed out', () => {
    const random = sequence(3);
    const events = Array.from({ length: 20_000 }, (_, index) =>
      event(`E${index}`, { date: 1000 + Math.floor(random() * 1000), timelines: [index % 2 === 0 ? 'Main plot' : 'Backstory'] }),
    );
    const started = performance.now();
    const near = layoutTimeline(events, lanes, { scale: makeScale(1, dayOf(1000)), measure: () => 60 });
    const far = layoutTimeline(events, lanes, { scale: makeScale(0.001, dayOf(1000)), measure: () => 60 });
    const took = performance.now() - started;
    expect(took).toBeLessThan(1500);
    for (const entry of near.lanes) expectNoOverlap(entry.items, DEFAULT_CARD_GAP);
    for (const entry of far.lanes) expectNoOverlap(entry.items, DEFAULT_CARD_GAP);
    // A thousand years are 365 pixels at this zoom: about 23 clusters of 16 pixels.
    expect(lane(far, 'Main plot').items.length).toBeLessThan(30);
    const counted = lane(far, 'Main plot').items.reduce((sum, item) => sum + (item.kind === 'cluster' ? item.count : 1), 0);
    expect(counted).toBe(10_000);
  });
});

describe('layoutLaneVertical', () => {
  const stored = readLanes([{ name: 'Main plot' }, { name: 'Backstory' }]).lanes;
  // For a phone: time runs down, and the measuring function gives a card's height.
  const vertical = { scale, measure: (): number => 44 };

  it('places the cards of one lane down the axis, side by side when they would overlap', () => {
    const events = [
      event('First', { date: '1923-01-01', timelines: ['Main plot'] }), // 0 to 44
      event('Second', { date: '1923-01-11', timelines: ['Main plot'] }), // starts at 20: overlaps
      event('Third', { date: '1923-03-01', timelines: ['Main plot'] }), // starts at 118: free again
      event('Elsewhere', { date: '1923-01-01', timelines: ['Backstory'] }),
    ];
    const layout = layoutLaneVertical(events, stored, 'main plot', vertical);
    expect(layout.lane?.name).toBe('Main plot');
    expect(layout.columnCount).toBe(2);
    expect(layout.items).toEqual([
      { kind: 'event', event: events[0], isSpan: false, column: 0, position: 0, height: 44 },
      { kind: 'event', event: events[1], isSpan: false, column: 1, position: 20, height: 44 },
      { kind: 'event', event: events[2], isSpan: false, column: 0, position: 118, height: 44 },
    ]);
  });

  it('makes a span as tall as its dates', () => {
    const events = [event(HEBREW.battle, { date: '1923-01-01', end: '1923-04-11', timelines: ['Main plot'] })];
    const [card] = layoutLaneVertical(events, stored, 'Main plot', vertical).items;
    expect(card).toMatchObject({ kind: 'event', isSpan: true, column: 0, position: 0, height: 200 });
  });

  it('clusters crowded events when zoomed far out, as the wide layout does', () => {
    const events = ['a', 'b', 'c'].map((title, index) =>
      event(title, { date: `1900-01-0${index + 1}`, timelines: ['Main plot'] }),
    );
    const layout = layoutLaneVertical(events, stored, 'Main plot', { ...vertical, scale: makeScale(0.1, dayOf(1900)) });
    expect(layout.items).toHaveLength(1);
    expect(layout.items[0]).toMatchObject({ kind: 'cluster', count: 3, label: '3 events', column: 0, height: 44 });
  });

  it('shows the Manuscript and Other lanes too', () => {
    const events = [sceneEvent('Opening', { date: '1923-01-01' }), event('Lost', { date: '1923-01-01' })];
    expect(layoutLaneVertical(events, stored, 'Manuscript', vertical).items).toHaveLength(1);
    expect(layoutLaneVertical(events, stored, 'Other', vertical).lane?.kind).toBe('other');
  });

  it('gives nothing for a lane that is hidden or does not exist', () => {
    const events = [event('First', { date: '1923-01-01', timelines: ['Main plot'] })];
    expect(layoutLaneVertical(events, stored, 'Ghost', vertical)).toEqual({ lane: null, columnCount: 0, items: [] });
    expect(layoutLaneVertical(events, stored, 'Main plot', { ...vertical, hidden: ['Main plot'] }).lane).toBeNull();
  });
});
