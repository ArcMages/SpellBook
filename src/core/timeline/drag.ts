// Drag maths: what a finger or a mouse that moved so many pixels means.
//
// Distances come in two parts: "along" the time axis and "across" it. With
// time running across the screen, along is the sideways movement and across
// is the up-and-down one; on a phone with time running down it is the other
// way round. Along is positive towards later dates.

import { clampZoom, positionToDay } from './scale';
import type { TimeScale } from './scale';
import { moveDates, sameStoryDate, snapDayNumber, storyDateToDayNumber } from './storyDate';
import type { DatePrecision, DateRange, StoryDate } from './storyDate';

/** A press that moves less than this many pixels is a tap, not a drag. */
export const TAP_THRESHOLD = 6;

/**
 * True when a press moved so little that it counts as a tap.
 *
 * @param along     the movement along the time axis, in pixels
 * @param across    the movement across it, in pixels
 * @param threshold the least distance that makes a drag; default `TAP_THRESHOLD`
 */
export function isTap(along: number, across: number, threshold: number = TAP_THRESHOLD): boolean {
  return !(Math.hypot(along, across) >= threshold);
}

/**
 * The date at a position on the axis, at the precision asked for: the
 * nearest day, first of a month or 1 January. Use it to date a new event
 * where the writer tapped.
 */
export function dateAtPosition(scale: TimeScale, position: number, precision: DatePrecision): StoryDate {
  return snapDayNumber(positionToDay(scale, position), precision);
}

/**
 * A precision that suits the zoom, for dating a new event where the writer
 * tapped: the day when a day is at least 8 pixels wide, the month when a
 * month is, and otherwise the year.
 */
export function precisionForScale(scale: TimeScale): DatePrecision {
  if (scale.pxPerDay >= 8) return 'day';
  return scale.pxPerDay * 30 >= 8 ? 'month' : 'year';
}

/**
 * The dates of an event after it was dragged along the time axis.
 *
 * The start snaps at the event's own precision: an event dated to the year
 * moves by whole years, one dated to the month by whole months, one dated to
 * the day by whole days. A span moves as a whole and keeps its length (see
 * `moveDates`). Nothing moves past the ends of the calendar.
 *
 * @param start the event's date
 * @param end   its end date, or null for a single date
 * @param along the distance dragged along the time axis, in pixels
 */
export function dragDates(start: StoryDate, end: StoryDate | null, along: number, scale: TimeScale): DateRange {
  const days = Number.isFinite(along) ? along / clampZoom(scale.pxPerDay) : 0;
  const target = snapDayNumber(storyDateToDayNumber(start) + days, start.precision);
  return moveDates(start, end, target);
}

/** The strip a lane takes up across the time axis. */
export interface LaneBand {
  /** The lane's key. */
  readonly lane: string;
  /** Where the strip begins, in pixels. */
  readonly start: number;
  /** How thick it is, in pixels. */
  readonly size: number;
}

/** The sizes the lanes are drawn with. */
export interface LaneMetrics {
  /** The thickness of one row of cards. */
  readonly rowSize: number;
  /** The room between two rows. Default 0. */
  readonly rowGap?: number;
  /** The room inside a lane before its first row and after its last. Default 0. */
  readonly padding?: number;
  /** The room a lane's heading takes, before its rows. Default 0. */
  readonly header?: number;
  /** The room between two lanes. Default 0. */
  readonly laneGap?: number;
  /** A lane is drawn at least this many rows thick, even when empty. Default 1. */
  readonly minRows?: number;
}

const size = (value: number | undefined, fallback: number): number =>
  value !== undefined && Number.isFinite(value) && value >= 0 ? value : fallback;

/**
 * The strips the lanes take up, one after another, from their row counts.
 * Pass `layoutTimeline(...).lanes` as it is. The same strips serve to draw
 * the lanes and to tell which one a dragged card is over.
 */
export function laneBands(
  lanes: readonly { readonly lane: { readonly key: string }; readonly rowCount: number }[],
  metrics: LaneMetrics,
): LaneBand[] {
  const rowSize = size(metrics.rowSize, 0);
  const rowGap = size(metrics.rowGap, 0);
  const padding = size(metrics.padding, 0);
  const header = size(metrics.header, 0);
  const laneGap = size(metrics.laneGap, 0);
  const minRows = Math.trunc(size(metrics.minRows, 1));
  const bands: LaneBand[] = [];
  let start = 0;
  for (const entry of lanes) {
    const rows = Math.max(minRows, Math.trunc(size(entry.rowCount, 0)));
    const thickness = header + 2 * padding + rows * rowSize + Math.max(0, rows - 1) * rowGap;
    bands.push({ lane: entry.lane.key, start, size: thickness });
    start += thickness + laneGap;
  }
  return bands;
}

/**
 * The lane under the pointer. Between two lanes, and beyond the first or
 * the last, the nearest lane counts. Null only when there are no lanes.
 *
 * @param across the pointer's place across the time axis, in the same pixels as the bands
 */
export function laneAt(bands: readonly LaneBand[], across: number): string | null {
  let nearest: string | null = null;
  let least = Number.POSITIVE_INFINITY;
  for (const band of bands) {
    const away = across < band.start ? band.start - across : Math.max(0, across - (band.start + band.size));
    if (away < least) {
      least = away;
      nearest = band.lane;
    }
  }
  if (nearest === null && bands[0] !== undefined) return bands[0].lane;
  return nearest;
}

/** A press on an event card and how far it has moved. */
export interface DragInput {
  /** The event's date. */
  readonly start: StoryDate;
  /** Its end date, or null for a single date. */
  readonly end: StoryDate | null;
  /** The key of the lane the card was picked up in. */
  readonly lane: string;
  /** The movement along the time axis since the press, in pixels. */
  readonly along: number;
  /** The movement across it, in pixels. */
  readonly across: number;
  readonly scale: TimeScale;
  /** The strips of the lanes (see `laneBands`). Leave out when only one lane shows, as on a phone. */
  readonly bands?: readonly LaneBand[];
  /** Where the pointer now is across the time axis, in the same pixels as the bands. */
  readonly pointerAcross?: number;
  /** The least distance that makes a drag. Default `TAP_THRESHOLD`. */
  readonly threshold?: number;
}

/** What a press came to. */
export type DragOutcome =
  | { readonly kind: 'tap' }
  | {
      readonly kind: 'drag';
      /** The event's dates if it were dropped now. */
      readonly start: StoryDate;
      readonly end: StoryDate | null;
      readonly dateChanged: boolean;
      /** The key of the lane under the pointer. */
      readonly lane: string;
      readonly laneChanged: boolean;
    };

/**
 * Work out what a press on an event card means so far: a tap, or a drag to a
 * new date, a new lane, or both.
 *
 * The date only follows once the movement along the time axis is itself a
 * drag, so a card carried straight to another lane keeps its date even when
 * the finger wanders a few pixels sideways.
 */
export function resolveDrag(input: DragInput): DragOutcome {
  const threshold = size(input.threshold, TAP_THRESHOLD);
  if (isTap(input.along, input.across, threshold)) return { kind: 'tap' };

  const along = Math.abs(input.along) >= threshold ? input.along : 0;
  const moved = dragDates(input.start, input.end, along, input.scale);
  const dateChanged = !sameStoryDate(moved.start, input.start);

  let lane = input.lane;
  if (input.bands !== undefined && input.pointerAcross !== undefined && Number.isFinite(input.pointerAcross)) {
    lane = laneAt(input.bands, input.pointerAcross) ?? input.lane;
  }
  return { kind: 'drag', start: moved.start, end: moved.end, dateChanged, lane, laneChanged: lane !== input.lane };
}
