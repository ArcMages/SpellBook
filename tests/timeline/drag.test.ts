import { describe, expect, it } from 'vitest';
import {
  TAP_THRESHOLD,
  addEventToLanePatch,
  dateAtPosition,
  dragDates,
  isTap,
  laneAt,
  laneBands,
  laneNameFor,
  layoutTimeline,
  makeScale,
  moveEventToLanePatch,
  precisionForScale,
  resolveDrag,
} from '../../src/core/timeline';
import type { DragInput, Lane, LaneBand } from '../../src/core/timeline';
import { HEBREW, POINTED_AS_TYPED, date, dayOf, event, measureByLength } from './helpers';

describe('isTap', () => {
  it('counts a press that barely moved as a tap', () => {
    expect(TAP_THRESHOLD).toBe(6);
    expect(isTap(0, 0)).toBe(true);
    expect(isTap(5, 0)).toBe(true);
    expect(isTap(0, -5.9)).toBe(true);
    expect(isTap(4, 4)).toBe(true); // 5.7 pixels away
  });

  it('counts a press that moved the threshold or more as a drag, in any direction', () => {
    expect(isTap(6, 0)).toBe(false);
    expect(isTap(-6, 0)).toBe(false);
    expect(isTap(0, 40)).toBe(false);
    expect(isTap(4.3, 4.3)).toBe(false); // 6.1 pixels away
  });

  it('takes another threshold, and treats nonsense as a tap', () => {
    expect(isTap(9, 0, 10)).toBe(true);
    expect(isTap(10, 0, 10)).toBe(false);
    expect(isTap(Number.NaN, 50)).toBe(true);
  });
});

describe('dragDates', () => {
  it('moves an event dated to the day by whole days, to the nearest one', () => {
    const scale = makeScale(10, 0);
    const start = date(1923, 4, 12);
    expect(dragDates(start, null, 100, scale)).toEqual({ start: date(1923, 4, 22), end: null });
    expect(dragDates(start, null, 14, scale).start).toEqual(date(1923, 4, 13));
    expect(dragDates(start, null, 16, scale).start).toEqual(date(1923, 4, 14));
    expect(dragDates(start, null, -26, scale).start).toEqual(date(1923, 4, 9));
    expect(dragDates(start, null, 4, scale).start).toEqual(start);
    expect(dragDates(start, null, 200, scale).start).toEqual(date(1923, 5, 2)); // across the end of April
  });

  it('moves an event dated to the month by whole months', () => {
    const scale = makeScale(1, 0);
    const start = date(1923, 4);
    expect(dragDates(start, null, 20, scale).start).toEqual(date(1923, 5)); // 21 April is nearer to May
    expect(dragDates(start, null, 10, scale).start).toEqual(date(1923, 4)); // 11 April is nearer to April
    expect(dragDates(start, null, -10, scale).start).toEqual(date(1923, 4)); // 22 March is nearer to April
    expect(dragDates(start, null, -20, scale).start).toEqual(date(1923, 3));
    expect(dragDates(start, null, 300, scale).start).toEqual(date(1924, 2)); // 26 January 1924
    for (const along of [-400, -77, 33, 250, 1000]) {
      const moved = dragDates(start, null, along, scale).start;
      expect(moved.precision).toBe('month');
      expect(moved.day).toBe(1);
    }
  });

  it('moves an event dated to the year by whole years', () => {
    const scale = makeScale(0.5, 0);
    const start = date(1923);
    expect(dragDates(start, null, 100, scale).start).toEqual(date(1924)); // 200 days on: nearer to 1924
    expect(dragDates(start, null, 80, scale).start).toEqual(date(1923)); // 160 days on: still nearer to 1923
    expect(dragDates(start, null, -100, scale).start).toEqual(date(1922));
    expect(dragDates(start, null, 1830, scale).start).toEqual(date(1933));
    // Zoomed in, a short drag is far less than a year: nothing changes.
    expect(dragDates(start, null, 300, makeScale(100, 0)).start).toEqual(date(1923));
  });

  it('moves a span as a whole, keeping its length', () => {
    const scale = makeScale(10, 0);
    expect(dragDates(date(1923, 4, 12), date(1923, 4, 20), 100, scale)).toEqual({
      start: date(1923, 4, 22),
      end: date(1923, 4, 30),
    });
    expect(dragDates(date(1923, 1), date(1923, 3), 62, makeScale(1, 0))).toEqual({
      start: date(1923, 3),
      end: date(1923, 5),
    });
    expect(dragDates(date(1914), date(1918), 3650, makeScale(1, 0))).toEqual({ start: date(1924), end: date(1928) });
  });

  it('stops at the ends of the calendar', () => {
    const scale = makeScale(1, 0);
    expect(dragDates(date(9999, 12, 30), null, 1e9, scale).start).toEqual(date(9999, 12, 31));
    expect(dragDates(date(1, 1, 5), null, -1e9, scale).start).toEqual(date(1, 1, 1));
    expect(dragDates(date(9998), null, 1e9, scale).start).toEqual(date(9999));
    expect(dragDates(date(9999, 12, 1), date(9999, 12, 11), 1e9, scale)).toEqual({
      start: date(9999, 12, 21),
      end: date(9999, 12, 31),
    });
  });

  it('changes nothing for no movement, nonsense, or a scale that is not one', () => {
    const start = date(1923, 4, 12);
    const end = date(1923, 4, 20);
    expect(dragDates(start, end, 0, makeScale(10, 0))).toEqual({ start, end });
    expect(dragDates(start, end, Number.NaN, makeScale(10, 0))).toEqual({ start, end });
    expect(dragDates(start, null, Number.POSITIVE_INFINITY, makeScale(10, 0)).start).toEqual(start);
    // A zoom of zero is treated as the default zoom, not as "any distance is forever".
    expect(dragDates(start, null, 8, { pxPerDay: 0, originDay: 0 }).start).toEqual(date(1923, 4, 14));
  });
});

describe('dateAtPosition and precisionForScale', () => {
  it('gives the date under a point of the axis, snapped to the precision asked for', () => {
    const scale = makeScale(10, dayOf(1923, 4, 1));
    expect(dateAtPosition(scale, 0, 'day')).toEqual(date(1923, 4, 1));
    expect(dateAtPosition(scale, 114, 'day')).toEqual(date(1923, 4, 12)); // 11.4 days on
    expect(dateAtPosition(scale, 116, 'day')).toEqual(date(1923, 4, 13));
    expect(dateAtPosition(scale, 100, 'month')).toEqual(date(1923, 4));
    expect(dateAtPosition(scale, 200, 'month')).toEqual(date(1923, 5));
    expect(dateAtPosition(scale, 100, 'year')).toEqual(date(1923));
    expect(dateAtPosition(scale, 2000, 'year')).toEqual(date(1924));
  });

  it('suggests a precision that suits the zoom', () => {
    expect(precisionForScale(makeScale(200, 0))).toBe('day');
    expect(precisionForScale(makeScale(8, 0))).toBe('day');
    expect(precisionForScale(makeScale(7, 0))).toBe('month');
    expect(precisionForScale(makeScale(0.3, 0))).toBe('month');
    expect(precisionForScale(makeScale(0.2, 0))).toBe('year');
    expect(precisionForScale(makeScale(0.0001, 0))).toBe('year');
  });
});

describe('laneBands and laneAt', () => {
  const rows = [
    { lane: { key: 'manuscript' }, rowCount: 2 },
    { lane: { key: 'main plot' }, rowCount: 0 },
    { lane: { key: 'backstory' }, rowCount: 3 },
  ];
  const bands = laneBands(rows, { rowSize: 40, rowGap: 4, padding: 8, header: 24, laneGap: 10 });

  it('stacks the lanes one after another, each as thick as its rows need', () => {
    expect(bands).toEqual([
      { lane: 'manuscript', start: 0, size: 24 + 16 + 80 + 4 },
      { lane: 'main plot', start: 134, size: 24 + 16 + 40 }, // an empty lane is still one row thick
      { lane: 'backstory', start: 224, size: 24 + 16 + 120 + 8 },
    ]);
  });

  it('uses plain rows when no other sizes are given, and takes a real layout as it is', () => {
    expect(laneBands(rows, { rowSize: 30 })).toEqual([
      { lane: 'manuscript', start: 0, size: 60 },
      { lane: 'main plot', start: 60, size: 30 },
      { lane: 'backstory', start: 90, size: 90 },
    ]);
    expect(laneBands(rows, { rowSize: 30, minRows: 0 })[1]).toEqual({ lane: 'main plot', start: 60, size: 0 });
    const layout = layoutTimeline([event('Fire', { date: 1923, timelines: ['Main plot'] })], [{ name: 'Main plot', color: null }], {
      scale: makeScale(1, 0),
      measure: measureByLength,
    });
    expect(laneBands(layout.lanes, { rowSize: 30 }).map((band) => band.lane)).toEqual(['manuscript', 'main plot']);
  });

  it('finds the lane under the pointer', () => {
    expect(laneAt(bands, 0)).toBe('manuscript');
    expect(laneAt(bands, 123)).toBe('manuscript');
    expect(laneAt(bands, 134)).toBe('main plot');
    expect(laneAt(bands, 213)).toBe('main plot');
    expect(laneAt(bands, 300)).toBe('backstory');
  });

  it('takes the nearest lane between two lanes and beyond the first and the last', () => {
    expect(laneAt(bands, 127)).toBe('manuscript'); // 3 pixels past Manuscript, 7 before Main plot
    expect(laneAt(bands, 131)).toBe('main plot');
    expect(laneAt(bands, -500)).toBe('manuscript');
    expect(laneAt(bands, 5000)).toBe('backstory');
  });

  it('gives null when there are no lanes', () => {
    expect(laneAt([], 50)).toBeNull();
  });
});

describe('resolveDrag', () => {
  const bands: LaneBand[] = [
    { lane: 'manuscript', start: 0, size: 100 },
    { lane: 'main plot', start: 100, size: 100 },
    { lane: 'backstory', start: 200, size: 100 },
  ];
  const press: DragInput = {
    start: date(1923, 4, 12),
    end: null,
    lane: 'main plot',
    along: 0,
    across: 0,
    scale: makeScale(10, 0),
    bands,
    pointerAcross: 150,
  };

  it('calls a small movement a tap', () => {
    expect(resolveDrag(press)).toEqual({ kind: 'tap' });
    expect(resolveDrag({ ...press, along: 3, across: -4 })).toEqual({ kind: 'tap' });
  });

  it('gives the new date of a drag along the time axis', () => {
    expect(resolveDrag({ ...press, along: 52, across: 2, pointerAcross: 152 })).toEqual({
      kind: 'drag',
      start: date(1923, 4, 17),
      end: null,
      dateChanged: true,
      lane: 'main plot',
      laneChanged: false,
    });
  });

  it('picks the lane under the pointer of a drag across the axis, and keeps the date', () => {
    // The finger wandered 5 pixels sideways, which at this zoom is half a day.
    expect(resolveDrag({ ...press, along: 5, across: 110, pointerAcross: 260 })).toEqual({
      kind: 'drag',
      start: date(1923, 4, 12),
      end: null,
      dateChanged: false,
      lane: 'backstory',
      laneChanged: true,
    });
    // Zoomed far out the same 5 pixels are fifty days, and still do not move the date.
    const far = makeScale(0.1, 0);
    expect(resolveDrag({ ...press, scale: far, along: 5, across: 110, pointerAcross: 260 })).toMatchObject({
      dateChanged: false,
      start: date(1923, 4, 12),
    });
    expect(resolveDrag({ ...press, scale: far, along: 6, across: 110, pointerAcross: 260 })).toMatchObject({
      dateChanged: true,
      start: date(1923, 6, 11),
    });
  });

  it('can change the date and the lane in one drag', () => {
    expect(resolveDrag({ ...press, along: -30, across: -120, pointerAcross: 30 })).toMatchObject({
      kind: 'drag',
      start: date(1923, 4, 9),
      dateChanged: true,
      lane: 'manuscript',
      laneChanged: true,
    });
  });

  it('snaps to the precision of the event and moves a span as a whole', () => {
    const year = resolveDrag({ ...press, start: date(1923), along: 40 });
    expect(year).toMatchObject({ kind: 'drag', start: date(1923), dateChanged: false });
    const span = resolveDrag({ ...press, start: date(1923, 4, 12), end: date(1923, 4, 20), along: 100 });
    expect(span).toMatchObject({ start: date(1923, 4, 22), end: date(1923, 4, 30), dateChanged: true });
  });

  it('keeps the lane when it is not told where the lanes are, as on a phone', () => {
    const { bands: _bands, pointerAcross: _pointer, ...phone } = press;
    expect(resolveDrag({ ...phone, along: 20, across: 300 })).toMatchObject({
      kind: 'drag',
      start: date(1923, 4, 14),
      lane: 'main plot',
      laneChanged: false,
    });
  });

  it('takes another threshold', () => {
    expect(resolveDrag({ ...press, along: 12, threshold: 20 })).toEqual({ kind: 'tap' });
    expect(resolveDrag({ ...press, along: 22, threshold: 20 })).toMatchObject({ kind: 'drag', start: date(1923, 4, 14) });
  });

  it('names the lane by a key that the lane change takes as it is, and the note gets the lane as the writer spelled it', () => {
    const lanes: Lane[] = [
      { name: 'Main Plot', color: null },
      { name: POINTED_AS_TYPED, color: null },
    ];
    const scale = makeScale(10, dayOf(1923, 4, 1));
    const events = [event('Fire', { date: '1923-04-12', timelines: ['Backstory'] }), event('Flood', { date: '1923-04-12', timelines: [HEBREW.backstory] })];
    const layout = layoutTimeline(events, lanes, { scale, measure: measureByLength });
    expect(layout.lanes.map((entry) => entry.lane.name)).toEqual(['Manuscript', 'Main Plot', POINTED_AS_TYPED, 'Other']);
    const laneBandsNow = laneBands(layout.lanes, { rowSize: 40 });

    const droppedOn = (place: number): string => {
      const band = laneBandsNow[place];
      if (band === undefined) throw new Error(`There is no lane at place ${place}.`);
      const outcome = resolveDrag({
        start: date(1923, 4, 12),
        end: null,
        lane: 'other',
        along: 0,
        across: 60,
        scale,
        bands: laneBandsNow,
        pointerAcross: band.start + band.size / 2,
      });
      if (outcome.kind !== 'drag') throw new Error('The press was taken for a tap.');
      return outcome.lane;
    };

    // Dropped on "Main Plot": the key is not the name, and the note gets the name.
    expect(droppedOn(1)).toBe('main plot');
    expect(moveEventToLanePatch({ date: '1923-04-12', timelines: ['Backstory'] }, 'other', droppedOn(1), { lanes })).toEqual({
      timelines: ['Main Plot'],
    });
    // Dropped on the pointed Hebrew lane: the marks stay in the order the writer typed them.
    expect(droppedOn(2)).not.toBe(POINTED_AS_TYPED);
    const moved = moveEventToLanePatch({ timelines: [HEBREW.backstory] }, 'other', droppedOn(2), { lanes });
    expect((moved['timelines'] as string[])[0]).toBe(POINTED_AS_TYPED);
    expect(laneNameFor(droppedOn(2), lanes)).toBe(POINTED_AS_TYPED);
    expect(addEventToLanePatch({ timelines: [] }, droppedOn(1), { lanes })).toEqual({ timelines: ['Main Plot'] });
  });
});
