// The timeline as the screen is about to draw it: plain numbers, no page.
//
// Everything about dates, lanes and layout is the timeline engine's
// (src/core/timeline). This file only puts the engine's answers in the shape
// the screen draws from, and decides sizes: how big a card is, how thick a
// row, which cards are near enough to what is visible to be worth drawing.
//
// Two words are used throughout. "Along" is the direction time runs in:
// across a wide pane, down a narrow one. "Cross" is the other direction.

import { noteTitle } from '../../core/paths';
import {
  DEFAULT_CLUSTER_BELOW_PX_PER_DAY,
  DEFAULT_NARRATIVE_SPACING,
  MAX_PX_PER_DAY,
  MIN_LABEL_GAP,
  clampZoom,
  dateAtPosition,
  dayNumberToStoryDate,
  dayToPosition,
  displayLanes,
  eventLaneKeys,
  fitAll,
  formatStoryDateRange,
  laneBands,
  layoutLaneVertical,
  layoutTimeline,
  makeScale,
  narrativeOrder,
  positionToDay,
  precisionForScale,
  readLanes,
  readTimeline,
  storyDateToDayNumber,
  ticksFor,
  timelineExtent,
  visibleLanes,
  zoomAbout,
} from '../../core/timeline';
import type {
  DisplayLane,
  Lane,
  LaneBand,
  LaneList,
  LaneMetrics,
  NarrativeItem,
  StoryDate,
  TimeScale,
  TimelineEvent,
  TimelineModel,
} from '../../core/timeline';
import type { TimelineData } from './timelineHost';

/** "By date" puts events where their dates are; "By story order" in the order the manuscript tells them. */
export type TimeMode = 'date' | 'story';

// ------------------------------------------------------------------- sizes

/** A pane narrower than this gets the phone layout; it goes back to the wide one from WIDE_FROM. */
export const PHONE_BELOW = 520;
export const WIDE_FROM = 560;

/** The thickness of a row of cards: tall enough for a finger. */
export const ROW_SIZE = 44;
export const ROW_GAP = 6;
/** How the lanes of a wide pane are drawn; the same figures tell which lane a drag is over. */
export const LANE_METRICS: LaneMetrics = { rowSize: ROW_SIZE, rowGap: ROW_GAP, padding: 8, minRows: 1 };

export const MIN_CARD_WIDTH = 96;
export const MAX_CARD_WIDTH = 220;
/** A card at least this wide has room for its date and tags under the title. */
export const META_FROM_WIDTH = 120;
/** A cluster: a dot with a count, in a square big enough for a finger. */
export const CLUSTER_SIZE = 44;
/** How tall a card is when time runs down. */
export const CARD_HEIGHT = 48;
const CARD_GAP_DOWN = 6;
/** Room a card needs besides its title: its padding and its "more" button. */
const CARD_CHROME = 48;
const LETTER_WIDTH = 7.5;

/**
 * When time runs down there is one column of cards, as wide as the pane:
 * this is the room left free at both of its sides. A card never reaches past
 * the pane, however narrow that is.
 */
export const COLUMN_PAD = 8;

/** In story order, the distance from one event to the next can be zoomed between these. */
export const STORY_MIN_STEP = 48;
export const STORY_MAX_STEP = MAX_PX_PER_DAY;
const STORY_STEP_DOWN = CARD_HEIGHT + 12;
const FIT_PADDING = 24;

/**
 * Whether the pane gets the phone layout, going by its measured width, with
 * a little slack so that it does not flip back and forth at the border. A
 * width of zero means the pane is hidden: keep what it was.
 */
export function isPhoneWidth(width: number, wasPhone: boolean): boolean {
  if (!(width > 0)) return wasPhone;
  return wasPhone ? width < WIDE_FROM : width < PHONE_BELOW;
}

/** The room a card needs along a time axis that runs across: by the length of its title, within limits. */
export function cardWidth(text: string, event: TimelineEvent | null): number {
  if (event === null) return CLUSTER_SIZE;
  return Math.min(MAX_CARD_WIDTH, Math.max(MIN_CARD_WIDTH, Math.round(CARD_CHROME + text.length * LETTER_WIDTH)));
}

/** The room a card needs along a time axis that runs down. */
export function cardHeight(_text: string, event: TimelineEvent | null): number {
  return event === null ? CLUSTER_SIZE : CARD_HEIGHT;
}

// ---------------------------------------------------------------- the data

/** What was read from the host's data. Made once for every change of the data. */
export interface TimelineContent {
  readonly data: TimelineData;
  readonly laneList: LaneList;
  /** The lanes the project lists. */
  readonly lanes: readonly Lane[];
  readonly model: TimelineModel;
  /** Every event, dated or not, by its path. */
  readonly events: ReadonlyMap<string, TimelineEvent>;
  /** Every note's properties as the host gave them, by its path. */
  readonly frontmatter: ReadonlyMap<string, unknown>;
  /** Every event in the order the manuscript tells them; `position` counts from 0. */
  readonly story: readonly NarrativeItem[];
  /** The same events, each standing on a day of its own (day 0, 1, 2 ...), so the engine can lay them out evenly. */
  readonly storyEvents: readonly TimelineEvent[];
}

export function readContent(data: TimelineData): TimelineContent {
  const laneList = readLanes(data.timelines);
  const model = readTimeline(data.events, data.scenes);
  const frontmatter = new Map<string, unknown>();
  for (const note of [...data.events, ...data.scenes]) {
    if (!frontmatter.has(note.path)) frontmatter.set(note.path, note.frontmatter);
  }
  const all = [...model.dated, ...model.undated];
  const events = new Map<string, TimelineEvent>();
  for (const event of all) events.set(event.path, event);
  const story = narrativeOrder(all, data.sceneOrder, { spacing: 1, offset: 0 });
  const storyEvents = story.map(
    (item): TimelineEvent => ({ ...item.event, start: dayNumberToStoryDate(item.position, 'day'), end: null }),
  );
  return { data, laneList, lanes: laneList.lanes, model, events, frontmatter, story, storyEvents };
}

/** The events that are placed in a mode: the dated ones by date, all of them in story order. */
function placedEvents(content: TimelineContent, mode: TimeMode): readonly TimelineEvent[] {
  return mode === 'story' ? content.storyEvents : content.model.dated;
}

/** Every lane there is to show in a mode, hidden ones included (for the window that lists them). */
export function allLanes(content: TimelineContent, mode: TimeMode): DisplayLane[] {
  return displayLanes(content.lanes, placedEvents(content, mode));
}

// --------------------------------------------------------------- the layout

/** One card, placed. */
export interface Box {
  /** Stays the same from one drawing to the next for as long as the card stands for the same thing. */
  readonly key: string;
  readonly laneKey: string;
  /** The event (with its real dates), or null for a cluster. */
  readonly event: TimelineEvent | null;
  /** The events of a cluster; empty for a single event. */
  readonly members: readonly TimelineEvent[];
  /** The dates a cluster covers. */
  readonly from: StoryDate | null;
  readonly until: StoryDate | null;
  /** The row (time across) or the column (time down), from 0. */
  readonly track: number;
  /** Where it starts along the time axis, measured from the scene's own origin. */
  readonly along: number;
  /** How long it is along the time axis. */
  readonly size: number;
  readonly isSpan: boolean;
}

/** One lane with its cards. */
export interface LaneBoxes {
  readonly lane: DisplayLane;
  readonly trackCount: number;
  /** In order of `along`. */
  readonly boxes: readonly Box[];
  /** For each box, the furthest any box up to it reaches; lets the visible ones be found without a full walk. */
  readonly reach: readonly number[];
  /** The strip the lane takes up across the time axis. */
  readonly start: number;
  readonly size: number;
}

export interface Scene {
  readonly mode: TimeMode;
  /** True when time runs down (the phone layout): one lane is shown. */
  readonly vertical: boolean;
  /** The scale the cards were placed with. Sliding the view shifts all of them alike. */
  readonly scale: TimeScale;
  /** Every lane, hidden ones included. */
  readonly display: readonly DisplayLane[];
  /** The lanes this device shows. */
  readonly shown: readonly DisplayLane[];
  /** The lanes that are drawn: all the shown ones, or the one chosen on a phone. */
  readonly lanes: readonly LaneBoxes[];
  readonly bands: readonly LaneBand[];
  /** How much room the lanes take across the time axis. */
  readonly crossSize: number;
  /** The width of a column, when time runs down. */
  readonly trackSize: number;
}

export interface SceneOptions {
  readonly mode: TimeMode;
  readonly vertical: boolean;
  readonly scale: TimeScale;
  /** The lane to show when time runs down; the first one shown when it is null or gone. */
  readonly laneKey: string | null;
  /** The length of the visible area across the time axis. */
  readonly crossLength: number;
}

interface Placed {
  readonly kind: 'event' | 'cluster';
  readonly position: number;
  readonly event?: TimelineEvent;
  readonly events?: readonly TimelineEvent[];
  readonly start?: StoryDate;
  readonly end?: StoryDate;
  readonly isSpan?: boolean;
}

function laneOf(
  content: TimelineContent,
  lane: DisplayLane,
  trackCount: number,
  items: ReadonlyArray<Placed & { readonly track: number; readonly size: number }>,
  start: number,
  size: number,
): LaneBoxes {
  const real = (event: TimelineEvent): TimelineEvent => content.events.get(event.path) ?? event;
  const boxes: Box[] = [];
  const reach: number[] = [];
  let furthest = Number.NEGATIVE_INFINITY;
  for (const item of items) {
    const event = item.kind === 'event' && item.event ? real(item.event) : null;
    const members = item.events ? item.events.map(real) : [];
    const name = event ? event.path : `cluster\n${members[0]?.path ?? ''}`;
    boxes.push({
      key: `${lane.key}\n${name}`,
      laneKey: lane.key,
      event,
      members,
      from: members[0]?.start ?? null,
      until: members[members.length - 1]?.start ?? null,
      track: item.track,
      along: item.position,
      size: item.size,
      isSpan: item.isSpan === true,
    });
    furthest = Math.max(furthest, item.position + item.size);
    reach.push(furthest);
  }
  return { lane, trackCount, boxes, reach, start, size };
}

/** Lay the timeline out for drawing. */
export function layoutScene(content: TimelineContent, options: SceneOptions): Scene {
  const { mode, vertical, scale } = options;
  const events = placedEvents(content, mode);
  const hidden = content.data.hiddenLanes;
  const display = displayLanes(content.lanes, events);
  const shown = visibleLanes(display, hidden);
  const base = { mode, vertical, scale, display, shown };

  if (vertical) {
    const lane = laneOnShow(content, mode, options.laneKey);
    if (lane === null) return { ...base, lanes: [], bands: [], crossSize: 0, trackSize: 0 };
    const laid = layoutLaneVertical(events, content.lanes, lane.name, {
      scale,
      measure: cardHeight,
      hidden,
      gap: CARD_GAP_DOWN,
    });
    // One column, exactly as wide as the pane has room for: nothing to scroll sideways, nothing cut off.
    const crossSize = Math.max(0, options.crossLength);
    const trackSize = Math.max(0, crossSize - 2 * COLUMN_PAD);
    const items = laid.items.map((item) => ({ ...item, track: 0, size: item.height }));
    return {
      ...base,
      lanes: [laneOf(content, lane, 1, items, 0, crossSize)],
      bands: [{ lane: lane.key, start: 0, size: crossSize }],
      crossSize,
      trackSize,
    };
  }

  const laid = layoutTimeline(events, content.lanes, { scale, measure: cardWidth, hidden });
  const bands = laneBands(laid.lanes, LANE_METRICS);
  const lanes = laid.lanes.map((entry, index) => {
    const band = bands[index] as LaneBand;
    const items = entry.items.map((item) => ({ ...item, track: item.row, size: item.width }));
    return laneOf(content, entry.lane, entry.rowCount, items, band.start, band.size);
  });
  const last = bands[bands.length - 1];
  return { ...base, lanes, bands, crossSize: last ? last.start + last.size : 0, trackSize: ROW_SIZE };
}

/** Where a card sits across the time axis, and how thick it is. */
export function boxCross(scene: Scene, lane: LaneBoxes, box: Box): { readonly start: number; readonly size: number } {
  if (scene.vertical) return { start: COLUMN_PAD, size: scene.trackSize };
  const padding = LANE_METRICS.padding ?? 0;
  return { start: lane.start + padding + box.track * (ROW_SIZE + ROW_GAP), size: ROW_SIZE };
}

/** A part of the scene, in the scene's own measures. */
export interface SceneWindow {
  readonly alongFrom: number;
  readonly alongTo: number;
  readonly crossFrom: number;
  readonly crossTo: number;
}

/** A card with the lane it is in. */
export interface PlacedBox {
  readonly lane: LaneBoxes;
  readonly box: Box;
}

/** The first index whose value is not less than `wanted`, in a list that never goes down. */
function firstAtLeast(values: readonly number[], wanted: number): number {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if ((values[middle] as number) < wanted) low = middle + 1;
    else high = middle;
  }
  return low;
}

/** The cards that touch a part of the scene. The cost goes by what is found, not by how many cards there are. */
export function boxesIn(scene: Scene, part: SceneWindow): PlacedBox[] {
  const found: PlacedBox[] = [];
  for (const lane of scene.lanes) {
    if (lane.start > part.crossTo || lane.start + lane.size < part.crossFrom) continue;
    for (let index = firstAtLeast(lane.reach, part.alongFrom); index < lane.boxes.length; index++) {
      const box = lane.boxes[index] as Box;
      if (box.along > part.alongTo) break;
      if (box.along + box.size < part.alongFrom) continue;
      const cross = boxCross(scene, lane, box);
      if (cross.start > part.crossTo || cross.start + cross.size < part.crossFrom) continue;
      found.push({ lane, box });
    }
  }
  return found;
}

// ------------------------------------------------------------ scale helpers

/**
 * The lane that is drawn when time runs down: the one asked for. When none
 * was asked for yet, or that one is gone, it is the first lane this device
 * shows that has an event to show (a writer who dates no scenes would
 * otherwise always open on an empty Manuscript lane), or simply the first
 * when all are empty. Null when there is no lane to show.
 */
export function laneOnShow(content: TimelineContent, mode: TimeMode, laneKey: string | null): DisplayLane | null {
  const events = placedEvents(content, mode);
  const shown = visibleLanes(displayLanes(content.lanes, events), content.data.hiddenLanes);
  const asked = shown.find((candidate) => candidate.key === laneKey);
  if (asked !== undefined) return asked;
  const filled = new Set<string>();
  for (const event of events) {
    if (event.start === null) continue;
    for (const key of eventLaneKeys(event, content.lanes)) filled.add(key);
  }
  return shown.find((candidate) => filled.has(candidate.key)) ?? shown[0] ?? null;
}

/** The events that are placed in a mode and show in one lane. */
function eventsOfLane(content: TimelineContent, mode: TimeMode, laneKey: string): TimelineEvent[] {
  return placedEvents(content, mode).filter((event) => eventLaneKeys(event, content.lanes).includes(laneKey));
}

/**
 * "Fit": the scale that shows the events.
 *
 * Across a wide pane that is every dated event, with all the lanes under
 * each other. Down a narrow one a single lane is on show, so it is the
 * events of that lane that are fitted: fitting the whole timeline there
 * would often show a long empty stretch, with the lane's own events out of
 * sight.
 *
 * @param laneKey when time runs down: the lane on show (see `laneOnShow`); otherwise not used
 */
export function fitScale(
  content: TimelineContent | null,
  mode: TimeMode,
  vertical: boolean,
  length: number,
  laneKey: string | null = null,
): TimeScale {
  const lane = vertical && content !== null ? laneOnShow(content, mode, laneKey) : null;
  if (mode === 'story') {
    const step = vertical ? STORY_STEP_DOWN : DEFAULT_NARRATIVE_SPACING;
    // Each event stands on a day of its own; the lane's first one comes at the top.
    const first = lane === null || content === null ? null : timelineExtent(eventsOfLane(content, mode, lane.key));
    return makeScale(step, (first?.firstDay ?? 0) - FIT_PADDING / step);
  }
  const options = {
    paddingStart: FIT_PADDING,
    // The last event's card must fit after its date.
    paddingEnd: FIT_PADDING + (vertical ? CARD_HEIGHT : MAX_CARD_WIDTH),
  };
  if (content === null) return fitAll(null, length, options);
  const laneExtent = lane === null ? null : timelineExtent(eventsOfLane(content, mode, lane.key));
  // A lane with no dated event of its own: the whole timeline, as on a wide pane.
  const extent = laneExtent ?? timelineExtent(content.model.dated);
  return fitAll(extent, length, { ...options, fallbackDay: content.data.today });
}

/**
 * Whether any card of the scene touches the stretch of the time axis that
 * is in view under `scale` (the scale the view has slid to, which may be
 * another than the one the cards were placed with).
 */
export function anyCardInView(scene: Scene, scale: TimeScale, length: number): boolean {
  const from = -dayToPosition(scale, scene.scale.originDay);
  const to = from + Math.max(0, length);
  return scene.lanes.some((lane) => lane.boxes.some((box) => box.along <= to && box.along + box.size >= from));
}

/** Zoom about a point. In story order the distance between two events stays within its limits. */
export function zoomScale(mode: TimeMode, scale: TimeScale, factor: number, anchor: number): TimeScale {
  if (mode !== 'story') return zoomAbout(scale, factor, anchor);
  if (!Number.isFinite(factor) || factor <= 0) return scale;
  const wanted = Math.min(STORY_MAX_STEP, Math.max(STORY_MIN_STEP, scale.pxPerDay * factor));
  return zoomAbout(scale, wanted / scale.pxPerDay, anchor);
}

/** The scale that opens a cluster up: its dates fill most of the view, and it is at least twice as close. */
export function zoomIntoCluster(scale: TimeScale, box: Box, length: number): TimeScale {
  if (box.from === null || box.until === null) return scale;
  const firstDay = storyDateToDayNumber(box.from);
  const lastDay = storyDateToDayNumber(box.until);
  const days = lastDay - firstDay;
  // Events on one and the same day only come apart once clusters are off.
  const fitted = days > 0 ? (Math.max(1, length) * 0.6) / days : DEFAULT_CLUSTER_BELOW_PX_PER_DAY;
  const pxPerDay = clampZoom(Math.max(fitted, scale.pxPerDay * 2));
  return makeScale(pxPerDay, (firstDay + lastDay) / 2 - length / 2 / pxPerDay);
}

/** The dates in view, for the header. */
export function rangeText(mode: TimeMode, scale: TimeScale, length: number): string {
  if (mode === 'story') return 'Story order';
  const precision = precisionForScale(scale);
  return formatStoryDateRange(dateAtPosition(scale, 0, precision), dateAtPosition(scale, Math.max(0, length), precision));
}

/** One label on the axis. */
export interface AxisTick {
  /** Where it stands, from the start of the visible area. */
  readonly position: number;
  readonly label: string;
  /** True when the label is the writer's own text (a scene's name). */
  readonly ownText: boolean;
}

export const NO_SCENE_LABEL = 'Not in a scene';

/** The labels of the axis: dates, or in story order the scene each stretch of events belongs to. */
export function axisTicks(
  content: TimelineContent,
  mode: TimeMode,
  scale: TimeScale,
  length: number,
  vertical: boolean,
): AxisTick[] {
  if (mode !== 'story') {
    return ticksFor(scale, length, vertical ? 56 : MIN_LABEL_GAP).ticks.map(
      (tick): AxisTick => ({ position: tick.position, label: tick.label, ownText: false }),
    );
  }
  const story = content.story;
  const ticks: AxisTick[] = [];
  const last = Math.min(story.length - 1, Math.ceil(positionToDay(scale, length)));
  let index = Math.max(0, Math.floor(positionToDay(scale, 0)));
  // Start where the stretch of the first visible event starts, so its label can show from the edge.
  while (index > 0 && story[index - 1]?.scene === story[index]?.scene) index--;
  for (; index <= last; index++) {
    const item = story[index];
    if (item === undefined) break;
    if (index > 0 && story[index - 1]?.scene === item.scene) continue;
    ticks.push({
      position: dayToPosition(scale, index),
      label: item.scene === null ? NO_SCENE_LABEL : noteTitle(item.scene),
      ownText: item.scene !== null,
    });
  }
  return ticks;
}
