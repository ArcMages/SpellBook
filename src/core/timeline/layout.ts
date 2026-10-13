// Laying out the timeline: which row each event card goes in, where it
// starts and how long it is, so that no two cards of a lane overlap.
//
// The work is the same whichever way time runs. Across the screen, a card's
// length along the axis is its width and cards stack in rows; down a phone
// screen, it is its height and cards sit side by side in columns.
//
// The cost grows with n log n for n events, also when thousands of them fall
// on the same day: free rows are kept in a heap, never searched one by one.

import { laneKey } from './common';
import type { Lane } from './common';
import { laneAssigner } from './eventLanes';
import type { TimelineEvent } from './events';
import { displayLanes, visibleLanes } from './lanes';
import type { DisplayLane } from './lanes';
import { dayToPosition, makeScale } from './scale';
import type { TimeScale } from './scale';
import { storyDateToDayNumber } from './storyDate';
import type { StoryDate } from './storyDate';

/** The least room, in pixels, kept between two cards in the same row. */
export const DEFAULT_CARD_GAP = 8;
/** The smallest a card can be along the time axis, in pixels. */
export const DEFAULT_MIN_CARD_LENGTH = 24;
/** Zoomed far out, single-date events closer together than this many pixels become one cluster. */
export const DEFAULT_CLUSTER_DISTANCE = 16;
/** "Zoomed far out" means a day is narrower than this many pixels (a year under about 180). */
export const DEFAULT_CLUSTER_BELOW_PX_PER_DAY = 0.5;

/**
 * Tells how much room a card needs along the time axis, in pixels: its width
 * when time runs across, its height when time runs down.
 *
 * @param text  the text on the card: an event's title exactly as written, or a cluster's label
 * @param event the event, or null for a cluster
 */
export type MeasureCard = (text: string, event: TimelineEvent | null) => number;

/** What a layout needs to know. */
export interface LayoutOptions {
  readonly scale: TimeScale;
  readonly measure: MeasureCard;
  /** The names of the lanes this device has hidden. They are left out. */
  readonly hidden?: Iterable<string>;
  /** Pixels kept between two cards in a row. Default `DEFAULT_CARD_GAP`. */
  readonly gap?: number;
  /** The smallest card. Default `DEFAULT_MIN_CARD_LENGTH`. */
  readonly minLength?: number;
  /** Single-date events closer than this merge when zoomed far out; 0 turns clusters off. Default `DEFAULT_CLUSTER_DISTANCE`. */
  readonly clusterDistance?: number;
  /** Clusters form only when the zoom is below this. Default `DEFAULT_CLUSTER_BELOW_PX_PER_DAY`. */
  readonly clusterBelowPxPerDay?: number;
}

/** An event card, placed for a time axis that runs across the screen. */
export interface PlacedEvent {
  readonly kind: 'event';
  readonly event: TimelineEvent;
  /** The row within its lane, counted from 0. */
  readonly row: number;
  /** Where the card starts along the time axis, in pixels. */
  readonly position: number;
  /** How wide the card is, in pixels. */
  readonly width: number;
  /** True when the event lasts from one date to another. */
  readonly isSpan: boolean;
}

/** Several single-date events too close together to show apart, placed as one card. */
export interface PlacedCluster {
  readonly kind: 'cluster';
  /** The events in it, earliest first. */
  readonly events: readonly TimelineEvent[];
  readonly count: number;
  /** The date of the first event in it... */
  readonly start: StoryDate;
  /** ...and of the last. */
  readonly end: StoryDate;
  /** Its text in English: "12 events". */
  readonly label: string;
  readonly row: number;
  readonly position: number;
  readonly width: number;
}

/** A card placed for a time axis that runs across the screen: one event, or a cluster of them. */
export type PlacedItem = PlacedEvent | PlacedCluster;

/** One lane, laid out. */
export interface LaneLayout {
  readonly lane: DisplayLane;
  /** How many rows the lane needs; 0 when it has no dated events. */
  readonly rowCount: number;
  /** Its cards, in order of position. */
  readonly items: readonly PlacedItem[];
}

/** The whole timeline, laid out. */
export interface TimelineLayout {
  /** The visible lanes, in display order. */
  readonly lanes: readonly LaneLayout[];
}

/** An event card, placed for a time axis that runs down the screen. */
export interface StackedEvent {
  readonly kind: 'event';
  readonly event: TimelineEvent;
  /** The column, counted from 0. */
  readonly column: number;
  /** Where the card starts along the time axis (its top), in pixels. */
  readonly position: number;
  /** How tall the card is, in pixels. */
  readonly height: number;
  readonly isSpan: boolean;
}

/** A cluster, placed for a time axis that runs down the screen. */
export interface StackedCluster {
  readonly kind: 'cluster';
  readonly events: readonly TimelineEvent[];
  readonly count: number;
  readonly start: StoryDate;
  readonly end: StoryDate;
  readonly label: string;
  readonly column: number;
  readonly position: number;
  readonly height: number;
}

/** A card placed for a time axis that runs down the screen: one event, or a cluster of them. */
export type StackedItem = StackedEvent | StackedCluster;

/** One lane laid out for a phone, time running from top to bottom. */
export interface VerticalLaneLayout {
  /** The lane; null when no lane of that name is shown. */
  readonly lane: DisplayLane | null;
  /** How many columns of cards are needed side by side. */
  readonly columnCount: number;
  readonly items: readonly StackedItem[];
}

// ---------------------------------------------------------------------- heap

/** A heap of numbers: `pop` gives the one that `before` puts first. */
class NumberHeap {
  private readonly items: number[] = [];
  private readonly before: (a: number, b: number) => boolean;

  constructor(before: (a: number, b: number) => boolean) {
    this.before = before;
  }

  get size(): number {
    return this.items.length;
  }

  peek(): number | undefined {
    return this.items[0];
  }

  push(value: number): void {
    const items = this.items;
    let index = items.length;
    items.push(value);
    while (index > 0) {
      const parent = (index - 1) >> 1;
      const above = items[parent] as number;
      if (!this.before(value, above)) break;
      items[index] = above;
      index = parent;
    }
    items[index] = value;
  }

  pop(): number | undefined {
    const items = this.items;
    const top = items[0];
    const last = items.pop();
    if (last === undefined || items.length === 0) return top;
    let index = 0;
    for (;;) {
      let child = 2 * index + 1;
      if (child >= items.length) break;
      const right = child + 1;
      if (right < items.length && this.before(items[right] as number, items[child] as number)) child = right;
      if (!this.before(items[child] as number, last)) break;
      items[index] = items[child] as number;
      index = child;
    }
    items[index] = last;
    return top;
  }
}

// ------------------------------------------------------------------- placing

/**
 * A card before it has a row: one event, or several that merged.
 *
 * Cards are packed by `from` and `until`, which are measured from day 0 and
 * not from the start of the view. Day numbers are whole, so these come out
 * the same wherever the view has slid to, and so do the rows.
 */
interface Draft {
  readonly members: Dated[];
  /** The day the card starts on. */
  readonly startDay: number;
  /** Where the card starts, in pixels from day 0. */
  readonly from: number;
  /** Where the card ends, in pixels from day 0. */
  until: number;
  length: number;
  track: number;
}

interface Dated {
  readonly event: TimelineEvent;
  readonly start: StoryDate;
  readonly startDay: number;
  /** Equal to `startDay` for a single date. */
  readonly endDay: number;
  /** The event's place in the list it came in; settles ties. */
  readonly index: number;
}

interface Settings {
  readonly scale: TimeScale;
  readonly measure: MeasureCard;
  readonly gap: number;
  readonly minLength: number;
  /** 0 when clusters are off at this zoom. */
  readonly clusterDistance: number;
}

const atLeastZero = (value: number | undefined, fallback: number): number =>
  value !== undefined && Number.isFinite(value) && value >= 0 ? value : fallback;

function settingsOf(options: LayoutOptions): Settings {
  const below = atLeastZero(options.clusterBelowPxPerDay, DEFAULT_CLUSTER_BELOW_PX_PER_DAY);
  const distance = atLeastZero(options.clusterDistance, DEFAULT_CLUSTER_DISTANCE);
  // A scale that is not one (a zoom of zero, say) would put every card nowhere.
  const { pxPerDay, originDay } = options.scale;
  const usable = Number.isFinite(pxPerDay) && pxPerDay > 0 && Number.isFinite(originDay);
  const scale = usable ? options.scale : makeScale(pxPerDay, originDay);
  return {
    scale,
    measure: options.measure,
    gap: atLeastZero(options.gap, DEFAULT_CARD_GAP),
    minLength: Math.max(1, atLeastZero(options.minLength, DEFAULT_MIN_CARD_LENGTH)),
    clusterDistance: scale.pxPerDay < below ? distance : 0,
  };
}

function dated(event: TimelineEvent, index: number): Dated | null {
  if (event.start === null) return null;
  const startDay = storyDateToDayNumber(event.start);
  const endDay = event.end === null ? startDay : Math.max(startDay, storyDateToDayNumber(event.end));
  return { event, start: event.start, startDay, endDay, index };
}

/** Earliest first; on the same day the longer one first, so long bars take the first rows. */
function byStart(a: Dated, b: Dated): number {
  return a.startDay - b.startDay || b.endDay - a.endDay || a.index - b.index;
}

/** A cluster's text. */
function clusterLabel(count: number): string {
  return `${count} events`;
}

/** The room a card needs, as the measuring function says; never less than the smallest card. */
function measured(settings: Settings, text: string, event: TimelineEvent | null): number {
  const length = settings.measure(text, event);
  return Math.max(settings.minLength, Number.isFinite(length) ? length : 0);
}

/**
 * Give every card a track (a row or a column), the first one that is free.
 * The drafts must come in order of position.
 */
function assignTracks(drafts: readonly Draft[], gap: number): number {
  const trackEnd: number[] = [];
  const endOf = (track: number): number => trackEnd[track] as number;
  const busy = new NumberHeap((a, b) => endOf(a) < endOf(b) || (endOf(a) === endOf(b) && a < b));
  const free = new NumberHeap((a, b) => a < b);
  for (const draft of drafts) {
    // Every track whose last card ends before this one starts is free from here on.
    for (let track = busy.peek(); track !== undefined && endOf(track) + gap <= draft.from; track = busy.peek()) {
      busy.pop();
      free.push(track);
    }
    const track = free.pop() ?? trackEnd.length;
    trackEnd[track] = draft.until;
    busy.push(track);
    draft.track = track;
  }
  return trackEnd.length;
}

/** Lay out the events of one lane. Returns the cards in order of position, and how many tracks they need. */
function placeLane(events: readonly Dated[], settings: Settings): { readonly drafts: Draft[]; readonly tracks: number } {
  const { pxPerDay } = settings.scale;
  const sorted = [...events].sort(byStart);
  const drafts: Draft[] = [];
  const draftOf = (item: Dated): Draft => {
    const from = item.startDay * pxPerDay;
    return { members: [item], startDay: item.startDay, from, until: from, length: 0, track: 0 };
  };
  let open: Draft | null = null;
  for (const item of sorted) {
    const isPoint = item.endDay === item.startDay;
    if (isPoint && settings.clusterDistance > 0) {
      // A cluster reaches no further than the distance from its first event, so it stays one small card.
      if (open !== null && (item.startDay - open.startDay) * pxPerDay < settings.clusterDistance) {
        open.members.push(item);
        continue;
      }
      open = draftOf(item);
      drafts.push(open);
      continue;
    }
    drafts.push(draftOf(item));
  }

  for (const draft of drafts) {
    const only = draft.members[0] as Dated;
    if (draft.members.length > 1) {
      draft.length = measured(settings, clusterLabel(draft.members.length), null);
      draft.until = draft.from + draft.length;
    } else {
      const card = measured(settings, only.event.title, only.event);
      draft.length = Math.max(card, (only.endDay - only.startDay) * pxPerDay);
      // A span ends exactly where an event that starts on its last day begins: both are that day times the zoom.
      draft.until = Math.max(draft.from + card, only.endDay * pxPerDay);
    }
  }
  return { drafts, tracks: assignTracks(drafts, settings.gap) };
}

function toPlaced(draft: Draft, scale: TimeScale): PlacedItem {
  const first = draft.members[0] as Dated;
  const base = { row: draft.track, position: dayToPosition(scale, draft.startDay), width: draft.length };
  if (draft.members.length === 1) {
    return { kind: 'event', event: first.event, isSpan: first.endDay > first.startDay, ...base };
  }
  const last = draft.members[draft.members.length - 1] as Dated;
  return {
    kind: 'cluster',
    events: draft.members.map((member) => member.event),
    count: draft.members.length,
    start: first.start,
    end: last.start,
    label: clusterLabel(draft.members.length),
    ...base,
  };
}

function toStacked(draft: Draft, scale: TimeScale): StackedItem {
  const placed = toPlaced(draft, scale);
  const base = { column: placed.row, position: placed.position, height: placed.width };
  if (placed.kind === 'event') return { kind: 'event', event: placed.event, isSpan: placed.isSpan, ...base };
  return {
    kind: 'cluster',
    events: placed.events,
    count: placed.count,
    start: placed.start,
    end: placed.end,
    label: placed.label,
    ...base,
  };
}

/** Only dated events are placed; an undated one must not even call up the Other lane. */
const hasDate = (event: TimelineEvent): boolean => event.start !== null;

/** Sort the dated events into the lanes they show in. */
function eventsByLane(events: readonly TimelineEvent[], lanes: readonly Lane[], wanted: ReadonlySet<string>): Map<string, Dated[]> {
  const keysOf = laneAssigner(lanes);
  const byLane = new Map<string, Dated[]>();
  for (const key of wanted) byLane.set(key, []);
  events.forEach((event, index) => {
    const item = dated(event, index);
    if (item === null) return;
    for (const key of keysOf(event)) byLane.get(key)?.push(item);
  });
  return byLane;
}

/**
 * Lay out the timeline for a time axis that runs across the screen.
 *
 * In every visible lane the cards are packed into rows so that none overlap.
 * A single-date event is as wide as `measure` says its title needs; a span is
 * as wide as its dates, or as its title needs, whichever is more. An event in
 * several lanes gets a card in each. Zoomed far out, single-date events that
 * crowd together merge into clusters. Undated events are left out.
 *
 * Positions are measured from the start of the visible area. Sliding the view
 * only shifts them all alike, so one layout serves until the zoom, the events
 * or the lanes change.
 *
 * @param events the events to place (see `readTimeline`)
 * @param lanes  the lanes of the project index (see `readLanes`)
 */
export function layoutTimeline(
  events: readonly TimelineEvent[],
  lanes: readonly Lane[],
  options: LayoutOptions,
): TimelineLayout {
  const settings = settingsOf(options);
  const placed = events.filter(hasDate);
  const shown = visibleLanes(displayLanes(lanes, placed), options.hidden ?? []);
  const byLane = eventsByLane(placed, lanes, new Set(shown.map((lane) => lane.key)));
  return {
    lanes: shown.map((lane): LaneLayout => {
      const { drafts, tracks } = placeLane(byLane.get(lane.key) ?? [], settings);
      return { lane, rowCount: tracks, items: drafts.map((draft) => toPlaced(draft, settings.scale)) };
    }),
  };
}

/**
 * Lay out one lane for a phone, with time running from top to bottom. It
 * works as `layoutTimeline` does, turned a quarter: `measure` gives a card's
 * height, a span is as tall as its dates, and cards that would overlap sit
 * side by side in columns.
 *
 * @param events   the events of the whole timeline; only those in the lane are placed
 * @param lanes    the lanes of the project index (see `readLanes`)
 * @param laneName the lane to show
 */
export function layoutLaneVertical(
  events: readonly TimelineEvent[],
  lanes: readonly Lane[],
  laneName: string,
  options: LayoutOptions,
): VerticalLaneLayout {
  const wanted = laneKey(laneName);
  const placed = events.filter(hasDate);
  const lane = visibleLanes(displayLanes(lanes, placed), options.hidden ?? []).find(
    (candidate) => candidate.key === wanted,
  );
  if (lane === undefined) return { lane: null, columnCount: 0, items: [] };
  const byLane = eventsByLane(placed, lanes, new Set([lane.key]));
  const settings = settingsOf(options);
  const { drafts, tracks } = placeLane(byLane.get(lane.key) ?? [], settings);
  return { lane, columnCount: tracks, items: drafts.map((draft) => toStacked(draft, settings.scale)) };
}
