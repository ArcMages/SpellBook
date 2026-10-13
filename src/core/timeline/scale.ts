// The time scale: where a day sits on the axis, and how the writer zooms.
//
// Zoom is one number, pixels per day, that changes smoothly from many years
// per pixel down to a day as wide as a hand. A position is a distance in
// pixels along the time axis from the start of the visible area. The screen
// decides which way the axis runs (across, down, or right to left).

import type { TimelineEvent } from './events';
import {
  MAX_DAY_NUMBER,
  MAX_YEAR,
  MIN_DAY_NUMBER,
  MIN_YEAR,
  dayNumberToStoryDate,
  formatStoryDate,
  sameStoryDate,
  shiftStoryDate,
  storyDate,
  storyDateToDayNumber,
} from './storyDate';
import type { StoryDate } from './storyDate';

/** A zoom and a place: together they say where every day is drawn. */
export interface TimeScale {
  /** The zoom: how many pixels one day takes. */
  readonly pxPerDay: number;
  /** The day number shown at position 0, the start of the visible area. It may fall part-way through a day. */
  readonly originDay: number;
}

/** The furthest zoom out: all 9999 years fit on the narrowest phone. */
export const MIN_PX_PER_DAY = 0.00005;
/** The closest zoom in: one day is 200 pixels wide. */
export const MAX_PX_PER_DAY = 200;
/** The zoom used when there is nothing to fit: a month is about 120 pixels. */
export const DEFAULT_PX_PER_DAY = 4;
/** Labels on the axis are at least this many pixels apart. */
export const MIN_LABEL_GAP = 80;

/** A zoom brought within the limits. Anything that is not a positive number becomes the default zoom. */
export function clampZoom(pxPerDay: number): number {
  if (!Number.isFinite(pxPerDay) || pxPerDay <= 0) return DEFAULT_PX_PER_DAY;
  return Math.min(MAX_PX_PER_DAY, Math.max(MIN_PX_PER_DAY, pxPerDay));
}

/** Make a time scale; the zoom is brought within the limits. */
export function makeScale(pxPerDay: number, originDay: number): TimeScale {
  return { pxPerDay: clampZoom(pxPerDay), originDay: Number.isFinite(originDay) ? originDay : 0 };
}

/** The position, in pixels, of a day number (the start of that day). */
export function dayToPosition(scale: TimeScale, dayNumber: number): number {
  return (dayNumber - scale.originDay) * scale.pxPerDay;
}

/** The day number at a position. It has a fraction when the position falls part-way through a day. */
export function positionToDay(scale: TimeScale, position: number): number {
  return scale.originDay + position / scale.pxPerDay;
}

/**
 * Zoom in or out about a point, so that the date under the finger or the
 * pointer stays exactly where it is.
 *
 * @param factor how much closer: 2 doubles the size of a day, 0.5 halves it
 * @param anchor the position of the finger or pointer, in pixels
 */
export function zoomAbout(scale: TimeScale, factor: number, anchor: number): TimeScale {
  if (!Number.isFinite(factor) || factor <= 0 || !Number.isFinite(anchor)) return scale;
  const pxPerDay = clampZoom(scale.pxPerDay * factor);
  const anchorDay = positionToDay(scale, anchor);
  return { pxPerDay, originDay: anchorDay - anchor / pxPerDay };
}

/**
 * Slide the view by a distance in pixels: a positive distance moves the
 * content towards the end of the axis, showing earlier dates.
 */
export function panBy(scale: TimeScale, distance: number): TimeScale {
  if (!Number.isFinite(distance)) return scale;
  return { pxPerDay: scale.pxPerDay, originDay: scale.originDay - distance / scale.pxPerDay };
}

/** The first and last day that the events of a timeline cover. */
export interface TimelineExtent {
  readonly firstDay: number;
  readonly lastDay: number;
}

/** The days the dated events cover, the ends of spans included; null when no event has a date. */
export function timelineExtent(events: readonly TimelineEvent[]): TimelineExtent | null {
  let firstDay = Number.POSITIVE_INFINITY;
  let lastDay = Number.NEGATIVE_INFINITY;
  for (const event of events) {
    if (event.start === null) continue;
    const start = storyDateToDayNumber(event.start);
    const end = event.end === null ? start : storyDateToDayNumber(event.end);
    if (start < firstDay) firstDay = start;
    if (Math.max(start, end) > lastDay) lastDay = Math.max(start, end);
  }
  return firstDay <= lastDay ? { firstDay, lastDay } : null;
}

/** Room to leave around the events when fitting them all. */
export interface FitOptions {
  /** Pixels left free before the first event. Default 24. */
  readonly paddingStart?: number;
  /** Pixels left free after the last event: at least the width of its card. Default 24. */
  readonly paddingEnd?: number;
  /** The day to centre on when there are no events (today's day number, say). Default 0. */
  readonly fallbackDay?: number;
}

const pixels = (value: number | undefined, fallback: number): number =>
  value !== undefined && Number.isFinite(value) && value >= 0 ? value : fallback;

/**
 * "Fit all": the scale that shows every event, with room to spare at both
 * ends. A single date, or no date at all, is centred at the default zoom.
 *
 * @param extent         the days to show (see `timelineExtent`), or null
 * @param viewportLength the length of the visible area along the time axis, in pixels
 */
export function fitAll(extent: TimelineExtent | null, viewportLength: number, options: FitOptions = {}): TimeScale {
  const length = pixels(viewportLength, 0);
  const paddingStart = pixels(options.paddingStart, 24);
  const paddingEnd = pixels(options.paddingEnd, 24);
  const room = Math.max(1, length - paddingStart - paddingEnd);

  if (extent === null || !Number.isFinite(extent.firstDay) || !Number.isFinite(extent.lastDay)) {
    const centre = options.fallbackDay !== undefined && Number.isFinite(options.fallbackDay) ? options.fallbackDay : 0;
    return { pxPerDay: DEFAULT_PX_PER_DAY, originDay: centre - length / 2 / DEFAULT_PX_PER_DAY };
  }
  const days = Math.max(0, extent.lastDay - extent.firstDay);
  const pxPerDay = days === 0 ? DEFAULT_PX_PER_DAY : clampZoom(room / days);
  // When the zoom limit leaves room over, the events sit in the middle of it.
  const spare = Math.max(0, room - days * pxPerDay);
  return { pxPerDay, originDay: extent.firstDay - (paddingStart + spare / 2) / pxPerDay };
}

/**
 * The step between two labels on the axis. The first six are the usual ones;
 * the last three are only reached when a century is narrower than a label.
 */
export type TickUnit =
  | 'day'
  | 'month'
  | 'year'
  | '5-years'
  | 'decade'
  | 'century'
  | '5-centuries'
  | 'millennium'
  | '5-millennia';

/** One labelled mark on the axis. */
export interface Tick {
  /** The day number the mark stands on. */
  readonly day: number;
  /** Where to draw it, in pixels. */
  readonly position: number;
  /** Its label in English: "12 Apr 1923", "Apr 1923" or "1923". */
  readonly label: string;
}

/** The marks to draw on the axis. */
export interface TickPlan {
  readonly unit: TickUnit;
  /** In order. The first may lie just before the visible area, so its label can show from the edge. */
  readonly ticks: readonly Tick[];
}

interface Rung {
  readonly unit: TickUnit;
  readonly base: 'day' | 'month' | 'year';
  /** How many years one step is, for the steps counted in years. */
  readonly years: number;
  /** The fewest days one step can be. */
  readonly shortest: number;
}

const LADDER: readonly Rung[] = [
  { unit: 'day', base: 'day', years: 0, shortest: 1 },
  { unit: 'month', base: 'month', years: 0, shortest: 28 },
  { unit: 'year', base: 'year', years: 1, shortest: 365 },
  { unit: '5-years', base: 'year', years: 5, shortest: 1826 },
  { unit: 'decade', base: 'year', years: 10, shortest: 3652 },
  { unit: 'century', base: 'year', years: 100, shortest: 36524 },
  { unit: '5-centuries', base: 'year', years: 500, shortest: 182621 },
  { unit: 'millennium', base: 'year', years: 1000, shortest: 365242 },
  { unit: '5-millennia', base: 'year', years: 5000, shortest: 1826212 },
];
const COARSEST = LADDER[LADDER.length - 1] as Rung;

/** No axis ever needs more marks than this; it stops a slip elsewhere from freezing the screen. */
const MAX_TICKS = 2000;

/** The finest step whose labels are at least `minGap` pixels apart at this zoom. */
function rungFor(scale: TimeScale, minGap: number): Rung {
  const gap = Number.isFinite(minGap) && minGap > 0 ? minGap : MIN_LABEL_GAP;
  return LADDER.find((rung) => rung.shortest * scale.pxPerDay >= gap) ?? COARSEST;
}

/**
 * The labelled marks for the visible part of the axis. The step is the
 * finest of day, month, year, 5 years, decade and century (and beyond, when
 * zoomed out further still) that keeps the labels at least `minGap` pixels
 * apart. Marks stand on round dates: the first of a month, 1 January, years
 * that the step divides.
 *
 * @param viewportLength the length of the visible area along the time axis, in pixels
 * @param minGap         the least distance between two labels; default 80
 */
export function ticksFor(scale: TimeScale, viewportLength: number, minGap: number = MIN_LABEL_GAP): TickPlan {
  const rung = rungFor(scale, minGap);
  const ticks: Tick[] = [];
  const length = pixels(viewportLength, 0);
  const from = Math.max(MIN_DAY_NUMBER, Math.floor(positionToDay(scale, 0)));
  const to = Math.min(MAX_DAY_NUMBER, Math.ceil(positionToDay(scale, length)));
  if (!(from <= to)) return { unit: rung.unit, ticks };

  const mark = (date: StoryDate): void => {
    const day = storyDateToDayNumber(date);
    ticks.push({ day, position: dayToPosition(scale, day), label: formatStoryDate(date) });
  };

  if (rung.base === 'year') {
    const firstYear = dayNumberToStoryDate(from, 'year').year;
    let year = Math.floor(firstYear / rung.years) * rung.years;
    if (year < MIN_YEAR) year += rung.years;
    for (; year <= MAX_YEAR && ticks.length < MAX_TICKS; year += rung.years) {
      const date = storyDate(year);
      if (date === null || storyDateToDayNumber(date) > to) break;
      mark(date);
    }
    return { unit: rung.unit, ticks };
  }

  let date = dayNumberToStoryDate(from, rung.base);
  while (storyDateToDayNumber(date) <= to && ticks.length < MAX_TICKS) {
    mark(date);
    const next = shiftStoryDate(date, 1);
    if (sameStoryDate(next, date)) break;
    date = next;
  }
  return { unit: rung.unit, ticks };
}
