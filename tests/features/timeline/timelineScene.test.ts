// What the timeline screen draws from, checked without any page: the lanes,
// the cards and their places, and which cards are near enough to be drawn.

import { describe, expect, it } from 'vitest';
import { makeScale, storyDateToText } from '../../../src/core/timeline';
import {
  CARD_HEIGHT,
  CLUSTER_SIZE,
  COLUMN_PAD,
  MAX_CARD_WIDTH,
  MIN_CARD_WIDTH,
  MIN_COLUMN_WIDTH,
  NO_SCENE_LABEL,
  PHONE_BELOW,
  ROW_SIZE,
  STORY_MAX_STEP,
  STORY_MIN_STEP,
  WIDE_FROM,
  allLanes,
  axisTicks,
  boxCross,
  boxesIn,
  cardWidth,
  fitScale,
  isPhoneWidth,
  layoutScene,
  rangeText,
  readContent,
  zoomIntoCluster,
  zoomScale,
} from '../../../src/features/timeline/timelineScene';
import type { Scene } from '../../../src/features/timeline/timelineScene';
import { EVENTS, note, sample } from './fakeHost';

const wide = (data = sample(), mode: 'date' | 'story' = 'date'): Scene => {
  const content = readContent(data);
  return layoutScene(content, {
    mode,
    vertical: false,
    scale: fitScale(content, mode, false, 760),
    laneKey: null,
    crossLength: 400,
  });
};

const titlesOf = (scene: Scene, lane: number): string[] =>
  (scene.lanes[lane]?.boxes ?? []).map((box) => box.event?.title ?? `(${box.members.length})`);

describe('the layout for a pane', () => {
  it('is the phone layout below a width, with slack so it does not flip at the border', () => {
    expect(isPhoneWidth(PHONE_BELOW - 1, false)).toBe(true);
    expect(isPhoneWidth(PHONE_BELOW, false)).toBe(false);
    expect(isPhoneWidth(WIDE_FROM - 1, true)).toBe(true); // still narrow until it is clearly wide
    expect(isPhoneWidth(WIDE_FROM, true)).toBe(false);
    expect(isPhoneWidth(0, true)).toBe(true); // a hidden pane keeps what it was
    expect(isPhoneWidth(0, false)).toBe(false);
  });

  it('sizes a card by its title, within limits, and a cluster as a dot', () => {
    const event = readContent(sample()).model.dated[0] ?? null;
    expect(event).not.toBeNull();
    expect(cardWidth('A', event)).toBe(MIN_CARD_WIDTH);
    expect(cardWidth('A very long title that goes on and on and on', event)).toBe(MAX_CARD_WIDTH);
    expect(cardWidth('מכתב לאחותי היקרה', event)).toBeGreaterThan(MIN_CARD_WIDTH);
    expect(cardWidth('12 events', null)).toBe(CLUSTER_SIZE);
  });
});

describe('a wide scene', () => {
  it('has Manuscript first, the project\'s lanes in order, then Other', () => {
    const scene = wide();
    expect(scene.lanes.map((lane) => lane.lane.name)).toEqual(['Manuscript', 'Main plot', 'רקע', 'Other']);
    expect(titlesOf(scene, 0)).toEqual(['Opening', 'Ending']);
    expect(titlesOf(scene, 1)).toEqual(['The war begins', 'Siege']);
    expect(titlesOf(scene, 2)).toEqual(['ילדות']);
    expect(titlesOf(scene, 3)).toEqual(['Stray']);
  });

  it('stacks the lanes as bands, and puts every card in a row of its band', () => {
    const scene = wide();
    let next = 0;
    for (const lane of scene.lanes) {
      expect(lane.start).toBe(next);
      next += lane.size;
      for (const box of lane.boxes) {
        const cross = boxCross(scene, lane, box);
        expect(cross.size).toBe(ROW_SIZE);
        expect(cross.start).toBeGreaterThanOrEqual(lane.start);
        expect(cross.start + cross.size).toBeLessThanOrEqual(lane.start + lane.size);
      }
    }
    expect(scene.crossSize).toBe(next);
    expect(scene.bands.map((band) => band.start)).toEqual(scene.lanes.map((lane) => lane.start));
  });

  it('makes a span as long as its dates and keeps the event\'s real dates on its card', () => {
    const scene = wide();
    const siege = scene.lanes[1]?.boxes[1];
    expect(siege?.isSpan).toBe(true);
    expect(siege?.size).toBeCloseTo(61 * scene.scale.pxPerDay, 5);
    expect(siege?.event?.end && storyDateToText(siege.event.end)).toBe('1923-08-01');
  });

  it('leaves out the lanes this device has hidden, but still lists them', () => {
    const data = sample({ hiddenLanes: ['main PLOT'] });
    const scene = wide(data);
    expect(scene.lanes.map((lane) => lane.lane.name)).toEqual(['Manuscript', 'רקע', 'Other']);
    expect(allLanes(readContent(data), 'date').map((lane) => lane.name)).toEqual(['Manuscript', 'Main plot', 'רקע', 'Other']);
  });

  it('merges crowded events into a cluster when zoomed far out, and can open it up', () => {
    const data = sample({
      events: [
        note(`${EVENTS}Long ago.md`, { date: 1901, timelines: ['Main plot'] }),
        note(`${EVENTS}One.md`, { date: '1923-04-12', timelines: ['Main plot'] }),
        note(`${EVENTS}Two.md`, { date: '1923-05-01', timelines: ['Main plot'] }),
        note(`${EVENTS}Three.md`, { date: '1923-06-01', timelines: ['Main plot'] }),
      ],
      scenes: [],
    });
    const scene = wide(data);
    expect(titlesOf(scene, 1)).toEqual(['Long ago', '(3)']);
    const cluster = scene.lanes[1]?.boxes[1];
    if (!cluster) throw new Error('no cluster');
    expect(cluster.size).toBe(CLUSTER_SIZE);
    expect(cluster.from && storyDateToText(cluster.from)).toBe('1923-04-12');
    expect(cluster.until && storyDateToText(cluster.until)).toBe('1923-06-01');

    const closer = zoomIntoCluster(scene.scale, cluster, 760);
    expect(closer.pxPerDay).toBeGreaterThanOrEqual(scene.scale.pxPerDay * 2);
    const opened = layoutScene(readContent(data), { mode: 'date', vertical: false, scale: closer, laneKey: null, crossLength: 400 });
    expect(titlesOf(opened, 1)).toEqual(['Long ago', 'One', 'Two', 'Three']);
    // The three now lie inside the view.
    const inView = boxesIn(opened, { alongFrom: 0, alongTo: 760, crossFrom: 0, crossTo: 400 });
    expect(inView.map((found) => found.box.event?.title)).toEqual(['One', 'Two', 'Three']);
  });

  it('says which dates are in view', () => {
    const scene = wide();
    expect(rangeText('date', scene.scale, 760)).toMatch(/^Apr 1923 . Oct 1923$/);
    expect(rangeText('date', makeScale(100, 0), 300)).toMatch(/^1 Jan 1970 . 4 Jan 1970$/);
    expect(rangeText('story', scene.scale, 760)).toBe('Story order');
  });
});

describe('finding the cards near the view', () => {
  const many = sample({
    events: Array.from({ length: 2000 }, (_, index) =>
      note(`${EVENTS}Event ${index}.md`, { date: 1000 + index, timelines: ['Main plot'] }),
    ),
    scenes: [],
  });

  it('gives only those that touch the part asked for, however many there are', () => {
    const content = readContent(many);
    const scene = layoutScene(content, { mode: 'date', vertical: false, scale: makeScale(1, 0), laneKey: null, crossLength: 400 });
    const lane = scene.lanes[1];
    if (!lane) throw new Error('no lane');
    expect(lane.boxes.length).toBe(2000);
    const middle = lane.boxes[1000];
    if (!middle) throw new Error('no box');
    const found = boxesIn(scene, {
      alongFrom: middle.along - 400,
      alongTo: middle.along + 400,
      crossFrom: 0,
      crossTo: scene.crossSize,
    });
    expect(found.length).toBeGreaterThan(0);
    expect(found.length).toBeLessThan(10);
    expect(found.map((entry) => entry.box.key)).toContain(middle.key);
    // Nothing far away, and nothing from a lane outside the part.
    expect(boxesIn(scene, { alongFrom: middle.along - 400, alongTo: middle.along + 400, crossFrom: -500, crossTo: -100 })).toEqual([]);
  });

  it('finds a long bar that began far before the part', () => {
    const data = sample({
      events: [
        note(`${EVENTS}The long war.md`, { date: 1000, end: 1900, timelines: ['Main plot'] }),
        ...many.events,
      ],
    });
    const scene = layoutScene(readContent(data), {
      mode: 'date',
      vertical: false,
      scale: makeScale(1, 0),
      laneKey: null,
      crossLength: 400,
    });
    const lane = scene.lanes[1];
    const bar = lane?.boxes[0];
    const late = lane?.boxes[801];
    if (!lane || !bar || !late) throw new Error('no boxes');
    expect(bar.event?.title).toBe('The long war');
    const found = boxesIn(scene, { alongFrom: late.along, alongTo: late.along + 300, crossFrom: 0, crossTo: scene.crossSize });
    expect(found.map((entry) => entry.box.event?.title)).toContain('The long war');
    expect(found.length).toBeLessThan(10);
  });
});

describe('a scene for a phone', () => {
  it('shows one lane, time running down, in columns as wide as the pane allows', () => {
    const content = readContent(sample());
    const scale = fitScale(content, 'date', true, 500);
    const scene = layoutScene(content, { mode: 'date', vertical: true, scale, laneKey: null, crossLength: 304 });
    expect(scene.vertical).toBe(true);
    expect(scene.shown.map((lane) => lane.name)).toEqual(['Manuscript', 'Main plot', 'רקע', 'Other']);
    expect(scene.lanes.map((lane) => lane.lane.name)).toEqual(['Manuscript']); // the first, when none was chosen

    const plot = layoutScene(content, { mode: 'date', vertical: true, scale, laneKey: 'main plot', crossLength: 304 });
    const lane = plot.lanes[0];
    if (!lane) throw new Error('no lane');
    expect(lane.boxes.map((box) => box.event?.title)).toEqual(['The war begins', 'Siege']);
    expect(plot.trackSize).toBe(304 - 2 * COLUMN_PAD);
    const [war, siege] = lane.boxes;
    if (!war || !siege) throw new Error('no boxes');
    expect(war.size).toBe(CARD_HEIGHT);
    expect(siege.size).toBeCloseTo(61 * scale.pxPerDay, 5);
    expect(boxCross(plot, lane, war)).toEqual({ start: COLUMN_PAD, size: 304 - 2 * COLUMN_PAD });
  });

  it('never makes a column narrower than a card can be read in', () => {
    const data = sample({
      events: Array.from({ length: 6 }, (_, index) => note(`${EVENTS}Same day ${index}.md`, { date: '1923-04-12', timelines: ['Main plot'] })),
      scenes: [],
    });
    const content = readContent(data);
    const scene = layoutScene(content, {
      mode: 'date',
      vertical: true,
      scale: fitScale(content, 'date', true, 500),
      laneKey: 'main plot',
      crossLength: 304,
    });
    expect(scene.lanes[0]?.trackCount).toBe(6);
    expect(scene.trackSize).toBe(MIN_COLUMN_WIDTH);
    expect(scene.crossSize).toBeGreaterThan(304); // wider than the pane: it scrolls sideways
  });
});

describe('story order', () => {
  it('spaces every event evenly in the order the manuscript tells them, the undated ones too', () => {
    const scene = wide(sample(), 'story');
    const all = scene.lanes.flatMap((lane) => lane.boxes).sort((a, b) => a.along - b.along);
    expect(all.map((box) => box.event?.title)).toEqual([
      'Opening',
      'ילדות',
      'Ending',
      'The war begins',
      'Stray',
      'Siege',
      'Loose end',
    ]);
    const steps = all.slice(1).map((box, index) => box.along - (all[index]?.along ?? 0));
    for (const step of steps) expect(step).toBeCloseTo(scene.scale.pxPerDay, 5);
    expect(all.every((box) => !box.isSpan)).toBe(true);
    // The cards still carry the events' real dates.
    expect(all[0]?.event?.start && storyDateToText(all[0].event.start)).toBe('1923-04-01');
    expect(all[6]?.event?.start).toBeNull();
  });

  it('labels the axis with the scene each stretch of events belongs to', () => {
    const content = readContent(sample());
    const scale = fitScale(content, 'story', false, 760);
    const ticks = axisTicks(content, 'story', scale, 760, false);
    expect(ticks.map((tick) => [tick.label, tick.ownText])).toEqual([
      ['Opening', true],
      ['Ending', true],
      [NO_SCENE_LABEL, false],
    ]);
    expect(ticks[1] && ticks[0] && ticks[1].position - ticks[0].position).toBeCloseTo(scale.pxPerDay, 5);
    // Dates are never the writer's own text.
    const dates = axisTicks(content, 'date', fitScale(content, 'date', false, 760), 760, false);
    expect(dates.length).toBeGreaterThan(2);
    expect(dates.every((tick) => !tick.ownText)).toBe(true);
  });

  it('keeps the distance between two events within its limits when zooming', () => {
    const scale = makeScale(160, 0);
    expect(zoomScale('story', scale, 100, 0).pxPerDay).toBe(STORY_MAX_STEP);
    expect(zoomScale('story', scale, 0.001, 0).pxPerDay).toBe(STORY_MIN_STEP);
    expect(zoomScale('date', scale, 0.001, 0).pxPerDay).toBeLessThan(STORY_MIN_STEP);
    // The place under the pointer stays where it is.
    const zoomed = zoomScale('story', scale, 0.5, 320);
    expect(zoomed.originDay + 320 / zoomed.pxPerDay).toBeCloseTo(scale.originDay + 320 / scale.pxPerDay, 9);
  });
});
