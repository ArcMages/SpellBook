import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PX_PER_DAY,
  MAX_DAY_NUMBER,
  MAX_PX_PER_DAY,
  MIN_DAY_NUMBER,
  MIN_LABEL_GAP,
  MIN_PX_PER_DAY,
  clampZoom,
  dayNumberToStoryDate,
  dayToPosition,
  fitAll,
  makeScale,
  panBy,
  positionToDay,
  ticksFor,
  timelineExtent,
  zoomAbout,
} from '../../src/core/timeline';
import type { TickUnit, TimeScale } from '../../src/core/timeline';
import { dayOf, event } from './helpers';

describe('positions', () => {
  const scale = makeScale(10, dayOf(1923, 4, 12));

  it('put a day at so many pixels from the start of the view', () => {
    expect(dayToPosition(scale, dayOf(1923, 4, 12))).toBe(0);
    expect(dayToPosition(scale, dayOf(1923, 4, 13))).toBe(10);
    expect(dayToPosition(scale, dayOf(1923, 4, 2))).toBe(-100);
    expect(dayToPosition(scale, dayOf(1923, 5, 12))).toBe(300); // April has 30 days
  });

  it('turn a position back into a day, with a fraction part-way through one', () => {
    expect(positionToDay(scale, 0)).toBe(dayOf(1923, 4, 12));
    expect(positionToDay(scale, 300)).toBe(dayOf(1923, 5, 12));
    expect(positionToDay(scale, 15)).toBe(dayOf(1923, 4, 13) + 0.5);
    for (const day of [MIN_DAY_NUMBER, -1, 0, 0.25, 19000, MAX_DAY_NUMBER]) {
      expect(positionToDay(scale, dayToPosition(scale, day))).toBeCloseTo(day, 6);
    }
  });
});

describe('zoom limits', () => {
  it('keep the zoom between the two ends', () => {
    expect(clampZoom(1)).toBe(1);
    expect(clampZoom(1e9)).toBe(MAX_PX_PER_DAY);
    expect(clampZoom(1e-12)).toBe(MIN_PX_PER_DAY);
    expect(MIN_PX_PER_DAY).toBeLessThan(DEFAULT_PX_PER_DAY);
    expect(DEFAULT_PX_PER_DAY).toBeLessThan(MAX_PX_PER_DAY);
  });

  it('turn nonsense into the default zoom', () => {
    for (const nonsense of [0, -3, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(clampZoom(nonsense)).toBe(DEFAULT_PX_PER_DAY);
    }
    expect(makeScale(Number.NaN, Number.NaN)).toEqual({ pxPerDay: DEFAULT_PX_PER_DAY, originDay: 0 });
  });

  it('reach from single days to the whole calendar', () => {
    // Zoomed all the way in, a phone 320 pixels wide shows less than two days.
    expect(320 / MAX_PX_PER_DAY).toBeLessThan(2);
    // Zoomed all the way out, all 9999 years fit in it.
    expect((MAX_DAY_NUMBER - MIN_DAY_NUMBER) * MIN_PX_PER_DAY).toBeLessThan(320);
  });
});

describe('zoomAbout', () => {
  const start = makeScale(2, dayOf(1923, 1, 1));

  it('keeps the date under the finger exactly where it is', () => {
    for (const anchor of [0, 137, 400, 1024]) {
      for (const factor of [1.07, 2, 10, 0.5, 0.01, 1 / 1.07]) {
        const before = positionToDay(start, anchor);
        const zoomed = zoomAbout(start, factor, anchor);
        expect(zoomed.pxPerDay).toBeCloseTo(2 * factor, 10);
        expect(positionToDay(zoomed, anchor), `anchor ${anchor}, factor ${factor}`).toBeCloseTo(before, 6);
        expect(dayToPosition(zoomed, before)).toBeCloseTo(anchor, 6);
      }
    }
  });

  it('moves every other date away from or towards the anchor', () => {
    const anchorDay = positionToDay(start, 200);
    const zoomed = zoomAbout(start, 2, 200);
    expect(dayToPosition(zoomed, anchorDay + 10) - 200).toBeCloseTo(2 * (dayToPosition(start, anchorDay + 10) - 200), 6);
  });

  it('is continuous: many small steps come to the same as one big one', () => {
    let stepped: TimeScale = start;
    for (let step = 0; step < 100; step++) stepped = zoomAbout(stepped, Math.pow(8, 1 / 100), 300);
    const once = zoomAbout(start, 8, 300);
    expect(stepped.pxPerDay).toBeCloseTo(once.pxPerDay, 8);
    expect(stepped.originDay).toBeCloseTo(once.originDay, 6);
  });

  it('stops at the limits and still keeps the anchor in place', () => {
    const anchorDay = positionToDay(start, 250);
    const closest = zoomAbout(start, 1e9, 250);
    expect(closest.pxPerDay).toBe(MAX_PX_PER_DAY);
    expect(positionToDay(closest, 250)).toBeCloseTo(anchorDay, 6);
    const furthest = zoomAbout(start, 1e-12, 250);
    expect(furthest.pxPerDay).toBe(MIN_PX_PER_DAY);
    expect(positionToDay(furthest, 250)).toBeCloseTo(anchorDay, 3);
    const again = zoomAbout(closest, 2, 250); // already at the limit: nothing moves
    expect(again.pxPerDay).toBe(MAX_PX_PER_DAY);
    expect(again.originDay).toBeCloseTo(closest.originDay, 9);
  });

  it('ignores a factor or an anchor that makes no sense', () => {
    for (const factor of [0, -2, Number.NaN, Number.POSITIVE_INFINITY]) expect(zoomAbout(start, factor, 100)).toBe(start);
    expect(zoomAbout(start, 2, Number.NaN)).toBe(start);
  });
});

describe('panBy', () => {
  it('slides the view: dragging the content forward shows earlier dates', () => {
    const scale = makeScale(10, 1000);
    const panned = panBy(scale, 50);
    expect(panned).toEqual({ pxPerDay: 10, originDay: 995 });
    expect(dayToPosition(panned, 1000)).toBe(50);
    expect(panBy(panned, -50)).toEqual(scale);
    expect(panBy(scale, Number.NaN)).toBe(scale);
  });
});

describe('timelineExtent', () => {
  it('covers every dated event, the ends of spans included', () => {
    const events = [
      event('Armistice', { date: '1918-11-11' }),
      event('War', { date: 1914, end: '1919-06-28' }),
      event('Someday', {}),
      event('Before', { date: '1913-12' }),
    ];
    expect(timelineExtent(events)).toEqual({ firstDay: dayOf(1913, 12, 1), lastDay: dayOf(1919, 6, 28) });
  });

  it('is a single day for one event and null when nothing has a date', () => {
    expect(timelineExtent([event('One', { date: '1923-04-12' })])).toEqual({
      firstDay: dayOf(1923, 4, 12),
      lastDay: dayOf(1923, 4, 12),
    });
    expect(timelineExtent([event('Someday', {}), event('Broken', { date: 'soon' })])).toBeNull();
    expect(timelineExtent([])).toBeNull();
  });
});

describe('fitAll', () => {
  it('shows every event with the padding asked for', () => {
    const extent = { firstDay: dayOf(1914, 1, 1), lastDay: dayOf(1918, 11, 11) };
    const scale = fitAll(extent, 1000, { paddingStart: 40, paddingEnd: 160 });
    expect(dayToPosition(scale, extent.firstDay)).toBeCloseTo(40, 6);
    expect(dayToPosition(scale, extent.lastDay)).toBeCloseTo(840, 6);
  });

  it('uses a modest padding when none is asked for', () => {
    const extent = { firstDay: 0, lastDay: 1000 };
    const scale = fitAll(extent, 548);
    expect(dayToPosition(scale, 0)).toBeCloseTo(24, 6);
    expect(dayToPosition(scale, 1000)).toBeCloseTo(524, 6);
  });

  it('fits the whole calendar, year 1 to year 9999, on a narrow phone', () => {
    const extent = { firstDay: MIN_DAY_NUMBER, lastDay: MAX_DAY_NUMBER };
    const scale = fitAll(extent, 320);
    expect(scale.pxPerDay).toBeGreaterThanOrEqual(MIN_PX_PER_DAY);
    expect(dayToPosition(scale, MIN_DAY_NUMBER)).toBeGreaterThanOrEqual(24 - 1e-6);
    expect(dayToPosition(scale, MAX_DAY_NUMBER)).toBeLessThanOrEqual(296 + 1e-6);
  });

  it('centres a single date at the default zoom', () => {
    const day = dayOf(1923, 4, 12);
    const scale = fitAll({ firstDay: day, lastDay: day }, 800, { paddingStart: 0, paddingEnd: 0 });
    expect(scale.pxPerDay).toBe(DEFAULT_PX_PER_DAY);
    expect(dayToPosition(scale, day)).toBeCloseTo(400, 6);
  });

  it('centres two dates that are too close to fill the view even at the closest zoom', () => {
    const scale = fitAll({ firstDay: 100, lastDay: 102 }, 1000, { paddingStart: 0, paddingEnd: 0 });
    expect(scale.pxPerDay).toBe(MAX_PX_PER_DAY);
    expect(dayToPosition(scale, 100)).toBeCloseTo(300, 6);
    expect(dayToPosition(scale, 102)).toBeCloseTo(700, 6);
  });

  it('centres on the day it is told to when there are no events', () => {
    const today = dayOf(2026, 10, 13);
    const scale = fitAll(null, 600, { fallbackDay: today });
    expect(scale.pxPerDay).toBe(DEFAULT_PX_PER_DAY);
    expect(dayToPosition(scale, today)).toBeCloseTo(300, 6);
    expect(Number.isFinite(fitAll(null, 600).originDay)).toBe(true);
  });

  it('copes with days that are not numbers', () => {
    const scale = fitAll({ firstDay: Number.NaN, lastDay: Number.POSITIVE_INFINITY }, 600, { fallbackDay: 1000 });
    expect(scale.pxPerDay).toBe(DEFAULT_PX_PER_DAY);
    expect(dayToPosition(scale, 1000)).toBeCloseTo(300, 6);
  });

  it('copes with a view of no size', () => {
    for (const length of [0, -50, Number.NaN]) {
      const scale = fitAll({ firstDay: 0, lastDay: 365 }, length);
      expect(Number.isFinite(scale.pxPerDay)).toBe(true);
      expect(Number.isFinite(scale.originDay)).toBe(true);
      expect(scale.pxPerDay).toBeGreaterThanOrEqual(MIN_PX_PER_DAY);
    }
  });
});

describe('ticksFor', () => {
  const at = (pxPerDay: number, year: number, month = 1, day = 1): TimeScale => makeScale(pxPerDay, dayOf(year, month, day));
  const unitAt = (pxPerDay: number): TickUnit => ticksFor(at(pxPerDay, 1923), 1000).unit;

  it('picks the finest step whose labels are at least 80 pixels apart', () => {
    expect(MIN_LABEL_GAP).toBe(80);
    expect(unitAt(200)).toBe('day');
    expect(unitAt(80)).toBe('day');
    expect(unitAt(79.9)).toBe('month');
    expect(unitAt(3)).toBe('month'); // February: 28 days, 84 pixels
    expect(unitAt(2.8)).toBe('year'); // February would be 78 pixels
    expect(unitAt(0.22)).toBe('year');
    expect(unitAt(0.2)).toBe('5-years');
    expect(unitAt(0.044)).toBe('5-years');
    expect(unitAt(0.04)).toBe('decade');
    expect(unitAt(0.022)).toBe('decade');
    expect(unitAt(0.02)).toBe('century');
    expect(unitAt(0.0022)).toBe('century');
  });

  it('goes beyond a century when zoomed out further still', () => {
    expect(unitAt(0.002)).toBe('5-centuries');
    expect(unitAt(0.0004)).toBe('millennium');
    expect(unitAt(0.0002)).toBe('5-millennia');
    expect(unitAt(MIN_PX_PER_DAY)).toBe('5-millennia');
  });

  it('labels days, months and years in English', () => {
    const days = ticksFor(at(100, 1923, 4, 10), 500);
    expect(days.ticks.map((tick) => tick.label)).toEqual([
      '10 Apr 1923',
      '11 Apr 1923',
      '12 Apr 1923',
      '13 Apr 1923',
      '14 Apr 1923',
      '15 Apr 1923',
    ]);
    expect(days.ticks.map((tick) => tick.position)).toEqual([0, 100, 200, 300, 400, 500]);

    const months = ticksFor(at(4, 1923, 11, 1), 400);
    expect(months.ticks.map((tick) => tick.label)).toEqual(['Nov 1923', 'Dec 1923', 'Jan 1924', 'Feb 1924']);

    const years = ticksFor(at(0.25, 1923), 300);
    expect(years.ticks.map((tick) => tick.label)).toEqual(['1923', '1924', '1925', '1926']);
  });

  it('puts the marks on round dates', () => {
    const fiveYears = ticksFor(at(0.1, 1923, 6, 1), 600);
    expect(fiveYears.unit).toBe('5-years');
    expect(fiveYears.ticks.map((tick) => tick.label)).toEqual(['1920', '1925', '1930', '1935']);

    const decades = ticksFor(at(0.03, 1923), 600);
    expect(decades.ticks.map((tick) => tick.label)).toEqual(['1920', '1930', '1940', '1950', '1960', '1970']);

    const centuries = ticksFor(at(0.003, 1923), 400);
    expect(centuries.ticks.map((tick) => tick.label)).toEqual(['1900', '2000', '2100', '2200']);

    const months = ticksFor(at(3, 1923, 4, 12), 300);
    for (const tick of months.ticks) expect(dayNumberToStoryDate(tick.day).day).toBe(1);
  });

  it('starts with the mark at or just before the start of the view, so its label can show', () => {
    const months = ticksFor(at(4, 1923, 4, 12), 400);
    expect(months.ticks[0]?.label).toBe('Apr 1923');
    expect(months.ticks[0]?.position).toBeLessThanOrEqual(0);
    expect(months.ticks[1]?.position).toBeGreaterThan(0);
    const exact = ticksFor(at(4, 1923, 4, 1), 400);
    expect(exact.ticks[0]).toEqual({ day: dayOf(1923, 4, 1), position: 0, label: 'Apr 1923' });
  });

  it('gives each mark the position its day has on the scale, in order', () => {
    const scale = at(0.5, 1923, 3, 3);
    const plan = ticksFor(scale, 900);
    expect(plan.ticks.length).toBeGreaterThan(1);
    plan.ticks.forEach((tick, index) => {
      expect(tick.position).toBe(dayToPosition(scale, tick.day));
      if (index > 0) expect(tick.day).toBeGreaterThan(plan.ticks[index - 1]?.day ?? Number.NaN);
    });
  });

  it('keeps labels at least 80 pixels apart at every zoom, and never floods the axis', () => {
    const width = 1200;
    // Small steps, so that the narrow band of zooms where February alone would be too tight is not skipped.
    for (let pxPerDay = MIN_PX_PER_DAY; pxPerDay <= MAX_PX_PER_DAY; pxPerDay *= 1.03) {
      // Viewed around February 2000, where the shortest month and a leap day both sit.
      const scale = makeScale(pxPerDay, dayOf(2000, 2, 1) - width / 2 / pxPerDay);
      const plan = ticksFor(scale, width);
      for (let index = 1; index < plan.ticks.length; index++) {
        const gap = (plan.ticks[index]?.position ?? 0) - (plan.ticks[index - 1]?.position ?? 0);
        expect(gap, `${plan.unit} at ${pxPerDay} px per day`).toBeGreaterThanOrEqual(MIN_LABEL_GAP - 1e-6);
      }
      expect(plan.ticks.length, `${plan.unit} at ${pxPerDay}`).toBeLessThanOrEqual(width / MIN_LABEL_GAP + 2);
    }
  });

  it('respects a wider gap when one is asked for', () => {
    const scale = at(4, 1923);
    expect(ticksFor(scale, 1000).unit).toBe('month');
    expect(ticksFor(scale, 1000, 200).unit).toBe('year');
    expect(ticksFor(scale, 1000, Number.NaN).unit).toBe('month'); // nonsense falls back to 80
  });

  it('counts the leap day in 2000 and not in 1900', () => {
    const labels = (year: number): string[] => ticksFor(at(100, year, 2, 28), 200).ticks.map((tick) => tick.label);
    expect(labels(2000)).toEqual(['28 Feb 2000', '29 Feb 2000', '1 Mar 2000']);
    expect(labels(1900)).toEqual(['28 Feb 1900', '1 Mar 1900', '2 Mar 1900']);
  });

  it('gives months their true lengths', () => {
    const plan = ticksFor(at(3, 2023, 1, 1), 1200);
    const lengths = plan.ticks.slice(1).map((tick, index) => tick.day - (plan.ticks[index]?.day ?? 0));
    expect(lengths.slice(0, 12)).toEqual([31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]);
  });

  it('stops at both ends of the calendar', () => {
    const early = ticksFor(makeScale(0.1, MIN_DAY_NUMBER - 2000), 4000);
    expect(early.unit).toBe('5-years');
    expect(early.ticks[0]?.label).toBe('5'); // year 1 is not a multiple of five
    expect(early.ticks[0]?.day).toBe(dayOf(5));

    const firstYears = ticksFor(makeScale(0.25, MIN_DAY_NUMBER - 400), 1000);
    expect(firstYears.ticks.map((tick) => tick.label).slice(0, 2)).toEqual(['1', '2']);

    const late = ticksFor(makeScale(100, MAX_DAY_NUMBER - 2), 1000);
    expect(late.ticks.map((tick) => tick.label)).toEqual(['29 Dec 9999', '30 Dec 9999', '31 Dec 9999']);

    const lastMonths = ticksFor(makeScale(4, dayOf(9999, 11, 15)), 1000);
    expect(lastMonths.ticks.map((tick) => tick.label)).toEqual(['Nov 9999', 'Dec 9999']);
  });

  it('draws nothing where there is no calendar, or no view', () => {
    expect(ticksFor(makeScale(1, MAX_DAY_NUMBER + 5000), 1000).ticks).toEqual([]);
    expect(ticksFor(makeScale(1, MIN_DAY_NUMBER - 5000), 1000).ticks).toEqual([]);
    expect(ticksFor(at(4, 1923), 0).ticks.length).toBeLessThanOrEqual(1);
    expect(() => ticksFor(at(4, 1923), Number.NaN)).not.toThrow();
  });
});
