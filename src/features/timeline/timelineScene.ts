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
  EVENTS_KIND,
  NO_TAG_FILTER,
  SCENES_KIND,
  MAX_PX_PER_DAY,
  MIN_LABEL_GAP,
  clampZoom,
  countTags,
  createEntityIndex,
  dateAtPosition,
  dayNumberToStoryDate,
  dayToPosition,
  displayLanes,
  eventEntities,
  eventHasEntity,
  eventLaneKeys,
  fitAll,
  formatStoryDateRange,
  isTagFilterActive,
  laneBands,
  layoutLaneVertical,
  layoutTimeline,
  makeScale,
  narrativeOrder,
  passesTagFilter,
  positionToDay,
  precisionForScale,
  readCalendar,
  readLanes,
  readTags,
  readTimeline,
  storyDateToDayNumber,
  ticksFor,
  timelineExtent,
  typeKind,
  visibleLanes,
  zoomAbout,
} from '../../core/timeline';
import type {
  DisplayLane,
  EntityIndex,
  EventEntity,
  Lane,
  LaneBand,
  LaneList,
  LaneMetrics,
  NarrativeItem,
  StoryCalendar,
  StoryDate,
  TagCount,
  TagFilter,
  TimeScale,
  TimelineEvent,
  TimelineModel,
} from '../../core/timeline';
import {
  isWorldLaneKey,
  layoutWorldLaneDown,
  layoutWorldLanes,
  readEntities,
  readEntityTypes,
  worldExtent,
  worldLanes,
} from '../../core/world';
import type { PlacedWorldRow, WorldLane, WorldLaneLayout, WorldNote, WorldTimeRow } from '../../core/world';
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

/** A card that names entities is at least this wide, so that a chip or two can be read under its title. */
export const ENTITY_CARD_WIDTH = 160;

/** The room a card needs along a time axis that runs across: by the length of its title, within limits. */
export function cardWidth(text: string, event: TimelineEvent | null): number {
  if (event === null) return CLUSTER_SIZE;
  const least = event.entities.length > 0 ? ENTITY_CARD_WIDTH : MIN_CARD_WIDTH;
  return Math.min(MAX_CARD_WIDTH, Math.max(least, Math.round(CARD_CHROME + text.length * LETTER_WIDTH)));
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
  /** The project's invented calendar; null for the real-world one. */
  readonly calendar: StoryCalendar | null;
  /** Why the stored calendar could not be used, in plain English; null when all is well. */
  readonly calendarProblem: string | null;
  /** The notes of the World folder, and what links to them resolve to. */
  readonly entityIndex: EntityIndex;
  /** The entities each event names, by the event's path. Events that name none are not in here. */
  readonly entities: ReadonlyMap<string, readonly EventEntity[]>;
  /** Every entity there is to choose from: the notes of the World folder, then those events name that have no note. */
  readonly allEntities: readonly EventEntity[];
  /** The entities the timeline is narrowed to (by key); empty when every event shows. */
  readonly filter: readonly string[];
  /** How many events the filter leaves out. */
  readonly filteredOut: number;
  /** The events that are shown: when the timeline is narrowed, only those that name one of the entities chosen. */
  readonly model: TimelineModel;
  /** Every event, dated or not, by its path. */
  readonly events: ReadonlyMap<string, TimelineEvent>;
  /** Every note's properties as the host gave them, by its path. */
  readonly frontmatter: ReadonlyMap<string, unknown>;
  /** Every event in the order the manuscript tells them; `position` counts from 0. */
  readonly story: readonly NarrativeItem[];
  /** The same events, each standing on a day of its own (day 0, 1, 2 ...), so the engine can lay them out evenly. */
  readonly storyEvents: readonly TimelineEvent[];
  /** The world on the timeline: a lane per type of entity. */
  readonly world: WorldContent;
  /** The filter by tags and by kind this device shows the timeline with. */
  readonly tagFilter: TagFilter;
  /** True when the filter by tags and by kind narrows anything. */
  readonly tagged: boolean;
  /** How many events, scenes and entities with a date the filter by tags leaves out. */
  readonly taggedOut: number;
  /** Every tag of the project's events, scenes and entities, with how many carry it, the most used first. */
  readonly tagCounts: readonly TagCount[];
  /** The kinds there are to filter by: events, scenes, and each type of the world that has an entity with a date. */
  readonly kinds: readonly KindChoice[];
  /**
   * The lanes not drawn: those this device hides, and, while the filter by
   * tags is on, those it leaves empty.
   */
  readonly hiddenLanes: readonly string[];
}

/** A kind of thing the timeline can be narrowed to. */
export interface KindChoice {
  /** EVENTS_KIND, SCENES_KIND or typeKind(id). */
  readonly kind: string;
  /** "Events", "Scenes", or a type's name (which may be the writer's own text). */
  readonly name: string;
  /** True for a type of the world, whose name is the writer's own text. */
  readonly world: boolean;
}

export const EVENTS_KIND_NAME = 'Events';
export const SCENES_KIND_NAME = 'Scenes';

/** The tags an entity's note carries, in its "tags" property. */
function entityTags(entity: { readonly frontmatter: Readonly<Record<string, unknown>> | null }): string[] {
  return readTags(entity.frontmatter?.['tags']);
}

/** The world on the timeline. */
export interface WorldContent {
  /** True when this device shows the world lanes. */
  readonly on: boolean;
  /** Every lane the world has (one per type that has an entity with a date), the hidden ones included. */
  readonly lanes: readonly WorldLane[];
  /** The lanes this device shows; none while the world is off. */
  readonly shown: readonly WorldLane[];
  /** The row of every entity that has one, by the entity's path. */
  readonly rows: ReadonlyMap<string, WorldTimeRow>;
}

/**
 * The world lanes of a project: read from the entity notes the host hands
 * over. When the timeline is narrowed to some entities, only those have a row.
 */
function readWorld(
  data: TimelineData,
  calendar: StoryCalendar | null,
  entityIndex: EntityIndex,
  wanted: ReadonlySet<string>,
  tagFilter: TagFilter,
): WorldContent {
  const choice = data.worldLanes ?? { on: false, hidden: [] };
  const types = readEntityTypes(data.entityTypes);
  const notes = (data.worldNotes ?? []).map(
    (note): WorldNote => ({
      path: note.path,
      frontmatter: typeof note.frontmatter === 'object' && note.frontmatter !== null ? (note.frontmatter as Record<string, unknown>) : null,
    }),
  );
  const lanes = worldLanes(readEntities(notes, types), types, calendar, {
    hidden: choice.hidden,
    ...(wanted.size === 0 ? {} : { only: (entity) => wanted.has(entityIndex.resolve(entity.path).key) }),
  });
  const rows = new Map<string, WorldTimeRow>();
  for (const lane of lanes) for (const row of lane.rows) rows.set(row.entity.path, row);
  let shown = choice.on ? lanes.filter((lane) => !lane.hidden) : [];
  if (isTagFilterActive(tagFilter)) {
    // Narrowed by tags: each lane keeps the entities that pass, and a lane left empty is not drawn.
    shown = shown
      .map((lane) => ({ ...lane, rows: lane.rows.filter((row) => passesTagFilter(tagFilter, entityTags(row.entity), typeKind(lane.typeId))) }))
      .filter((lane) => lane.rows.length > 0);
  }
  return { on: choice.on, lanes, shown, rows };
}

/** The world lanes that are drawn in a mode: the world has dates, so it shows by date only. */
function worldShown(content: TimelineContent, mode: TimeMode): readonly WorldLane[] {
  return mode === 'date' ? content.world.shown : [];
}

/** A world lane as the screen names it: a type's name is the writer's own text, as a lane's is. */
function worldDisplay(lane: WorldLane): DisplayLane {
  return { name: lane.name, color: lane.color, key: lane.key, kind: 'lane' };
}

/** The entity a card stands for, when it is a row of a world lane; null for an event's card. */
export function worldRowOf(content: TimelineContent | null, box: Box): WorldTimeRow | null {
  if (content === null || box.event === null || !isWorldLaneKey(box.laneKey)) return null;
  return content.world.rows.get(box.event.path) ?? null;
}

/**
 * @param filter the keys of the entities to narrow the timeline to: only events that name at least one of them are kept
 */
export function readContent(data: TimelineData, filter: readonly string[] = []): TimelineContent {
  const laneList = readLanes(data.timelines);
  const reading = readCalendar(data.calendar);
  const calendar = reading.calendar;
  const whole = readTimeline(data.events, data.scenes, calendar);

  const entityIndex = createEntityIndex(data.world ?? [], data.folder);
  const entities = new Map<string, readonly EventEntity[]>();
  const extra = new Map<string, EventEntity>();
  for (const event of [...whole.dated, ...whole.undated]) {
    if (event.entities.length === 0) continue;
    const named = eventEntities(event, entityIndex);
    entities.set(event.path, named);
    for (const entity of named) if (entity.path === null && !extra.has(entity.key)) extra.set(entity.key, entity);
  }
  const allEntities = [...entityIndex.all, ...extra.values()];
  // An entity that is gone altogether no longer narrows anything.
  const wanted = new Set(filter.filter((key) => allEntities.some((entity) => entity.key === key)));
  const keep = (event: TimelineEvent): boolean => eventHasEntity(event, wanted, entityIndex);
  const byEntities: TimelineModel =
    wanted.size === 0 ? whole : { dated: whole.dated.filter(keep), undated: whole.undated.filter(keep) };
  const filteredOut = whole.dated.length + whole.undated.length - byEntities.dated.length - byEntities.undated.length;
  // ...and then by tags and by kind.
  const tagFilter = data.tagFilter ?? NO_TAG_FILTER;
  const tagged = isTagFilterActive(tagFilter);
  const passes = (event: TimelineEvent): boolean =>
    passesTagFilter(tagFilter, event.tags, event.source === 'scene' ? SCENES_KIND : EVENTS_KIND);
  const model: TimelineModel = tagged
    ? { dated: byEntities.dated.filter(passes), undated: byEntities.undated.filter(passes) }
    : byEntities;
  let taggedOut = byEntities.dated.length + byEntities.undated.length - model.dated.length - model.undated.length;

  const frontmatter = new Map<string, unknown>();
  // An entity's dates are changed like an event's: its properties are known here too.
  for (const note of [...data.events, ...data.scenes, ...(data.worldNotes ?? [])]) {
    if (!frontmatter.has(note.path)) frontmatter.set(note.path, note.frontmatter);
  }
  const all = [...model.dated, ...model.undated];
  const events = new Map<string, TimelineEvent>();
  for (const event of all) events.set(event.path, event);
  const story = narrativeOrder(all, data.sceneOrder, { spacing: 1, offset: 0 });
  const storyEvents = story.map(
    (item): TimelineEvent => ({ ...item.event, start: dayNumberToStoryDate(item.position, 'day'), end: null }),
  );
  const world = readWorld(data, calendar, entityIndex, wanted, tagFilter);
  if (tagged) {
    const before = world.lanes.filter((lane) => world.on && !lane.hidden).reduce((sum, lane) => sum + lane.rows.length, 0);
    taggedOut += before - world.shown.reduce((sum, lane) => sum + lane.rows.length, 0);
  }
  // While the filter is on, a lane it leaves without anything is not drawn.
  let hiddenLanes = data.hiddenLanes;
  if (tagged) {
    const filled = new Set<string>();
    for (const event of all) for (const key of eventLaneKeys(event, laneList.lanes)) filled.add(key);
    const empty = displayLanes(laneList.lanes, all).filter((lane) => !filled.has(lane.key)).map((lane) => lane.name);
    hiddenLanes = [...data.hiddenLanes, ...empty];
  }
  const tagCounts = countTags([
    ...[...whole.dated, ...whole.undated].filter((event) => event.source === 'event').map((event) => event.tags),
    ...data.scenes.map((scene) => readTags(isRecordValue(scene.frontmatter) ? scene.frontmatter['tags'] : undefined)),
    ...(data.worldNotes ?? []).map((entry) => readTags(isRecordValue(entry.frontmatter) ? entry.frontmatter['tags'] : undefined)),
  ]);
  const kinds: KindChoice[] = [
    { kind: EVENTS_KIND, name: EVENTS_KIND_NAME, world: false },
    { kind: SCENES_KIND, name: SCENES_KIND_NAME, world: false },
    ...world.lanes.map((lane): KindChoice => ({ kind: typeKind(lane.typeId), name: lane.name, world: true })),
  ];
  return {
    data,
    laneList,
    lanes: laneList.lanes,
    calendar,
    calendarProblem: reading.problem,
    entityIndex,
    entities,
    allEntities,
    filter: [...wanted],
    filteredOut,
    model,
    events,
    frontmatter,
    story,
    storyEvents,
    world,
    tagFilter,
    tagged,
    taggedOut,
    tagCounts,
    kinds,
    hiddenLanes,
  };
}

function isRecordValue(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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
  /** The world lanes this device shows, after the others: one per type of entity. Empty in story order. */
  readonly world: readonly DisplayLane[];
  /** The lanes that are drawn: all the shown ones (the world lanes last), or the one chosen on a phone. */
  readonly lanes: readonly LaneBoxes[];
  /** The strips of the lanes an event can be in. The world lanes are not among them: no event is dropped there. */
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

/** A row of a world lane needs room for its name. */
export const WORLD_MIN_WIDTH = 64;
const WORLD_CHROME = 30;

/** The room an entity's name needs along a time axis that runs across. */
export function worldCardWidth(text: string): number {
  return Math.min(MAX_CARD_WIDTH, Math.max(WORLD_MIN_WIDTH, Math.round(WORLD_CHROME + text.length * LETTER_WIDTH)));
}

/** One world lane with its rows as cards. */
function worldLaneBoxes(laid: WorldLaneLayout, start: number, size: number): LaneBoxes {
  const lane = worldDisplay(laid.lane);
  const boxes: Box[] = [];
  const reach: number[] = [];
  let furthest = Number.NEGATIVE_INFINITY;
  for (const item of laid.items as readonly PlacedWorldRow[]) {
    boxes.push({
      key: `${lane.key}\n${item.row.entity.path}`,
      laneKey: lane.key,
      // The entity with its own "date" and "end": what a drag moves.
      event: item.row.event,
      members: [],
      from: null,
      until: null,
      track: item.track,
      along: item.position,
      size: item.size,
      isSpan: item.isSpan,
    });
    furthest = Math.max(furthest, item.position + item.size);
    reach.push(furthest);
  }
  return { lane, trackCount: laid.trackCount, boxes, reach, start, size };
}

/** Lay the timeline out for drawing. */
export function layoutScene(content: TimelineContent, options: SceneOptions): Scene {
  const { mode, vertical, scale } = options;
  const events = placedEvents(content, mode);
  const hidden = content.hiddenLanes;
  const display = displayLanes(content.lanes, events);
  const shown = visibleLanes(display, hidden);
  const worldOnShow = worldShown(content, mode);
  const base = { mode, vertical, scale, display, shown, world: worldOnShow.map(worldDisplay) };

  if (vertical) {
    const lane = laneOnShow(content, mode, options.laneKey);
    if (lane === null) return { ...base, lanes: [], bands: [], crossSize: 0, trackSize: 0 };
    const worldLane = worldOnShow.find((candidate) => candidate.key === lane.key);
    if (worldLane !== undefined) {
      // A world lane on a phone: one column of cards, each an entity with its dates written on it.
      const laidWorld = layoutWorldLaneDown(worldLane, { scale, measure: cardHeight, gap: CARD_GAP_DOWN });
      const crossSize = Math.max(0, options.crossLength);
      return {
        ...base,
        lanes: [worldLaneBoxes(laidWorld, 0, crossSize)],
        bands: [],
        crossSize,
        trackSize: Math.max(0, crossSize - 2 * COLUMN_PAD),
      };
    }
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
  const eventsSize = last ? last.start + last.size : 0;
  if (worldOnShow.length === 0) return { ...base, lanes, bands, crossSize: eventsSize, trackSize: ROW_SIZE };
  // The world lanes follow the others, packed the same way: no two rows of a lane overlap.
  const laidWorld = layoutWorldLanes(worldOnShow, { scale, measure: (text) => worldCardWidth(text) });
  const worldBands = laneBands(
    laidWorld.map((entry) => ({ lane: { key: entry.lane.key }, rowCount: entry.trackCount })),
    LANE_METRICS,
  );
  const worldBoxes = laidWorld.map((entry, index) => {
    const band = worldBands[index] as LaneBand;
    return worldLaneBoxes(entry, eventsSize + band.start, band.size);
  });
  const lastWorld = worldBands[worldBands.length - 1];
  return {
    ...base,
    lanes: [...lanes, ...worldBoxes],
    bands,
    crossSize: eventsSize + (lastWorld ? lastWorld.start + lastWorld.size : 0),
    trackSize: ROW_SIZE,
  };
}

/** The world lane at a place across the time axis (in the scene's own measures); null when it is over none. */
export function worldLaneAt(scene: Scene, cross: number): LaneBoxes | null {
  return scene.lanes.find((lane) => isWorldLaneKey(lane.lane.key) && cross >= lane.start && cross <= lane.start + lane.size) ?? null;
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
  const world = worldShown(content, mode).map(worldDisplay);
  const shown = [...visibleLanes(displayLanes(content.lanes, events), content.hiddenLanes), ...world];
  const asked = shown.find((candidate) => candidate.key === laneKey);
  if (asked !== undefined) return asked;
  const filled = new Set<string>();
  for (const event of events) {
    if (event.start === null) continue;
    for (const key of eventLaneKeys(event, content.lanes)) filled.add(key);
  }
  return shown.find((candidate) => filled.has(candidate.key)) ?? shown[0] ?? null;
}

/** The events that are placed in a mode and show in one lane. For a world lane: its entities, each from its first day to its last. */
function eventsOfLane(content: TimelineContent, mode: TimeMode, laneKey: string): TimelineEvent[] {
  if (isWorldLaneKey(laneKey)) {
    return (worldShown(content, mode).find((lane) => lane.key === laneKey)?.rows ?? []).map((row) => row.extent);
  }
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
 * @param laneKey   when time runs down: the lane on show (see `laneOnShow`); otherwise not used
 * @param worldOnly true for the world's history: the view is fitted to the world's own dates, whatever the events cover
 */
export function fitScale(
  content: TimelineContent | null,
  mode: TimeMode,
  vertical: boolean,
  length: number,
  laneKey: string | null = null,
  worldOnly = false,
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
  // The world lanes on show count as well: an entity's row is fitted like an event.
  const world = worldExtent(worldShown(content, mode));
  const everything = worldOnly && world !== null ? null : timelineExtent(content.model.dated);
  const whole =
    world === null || everything === null
      ? (world ?? everything)
      : { firstDay: Math.min(world.firstDay, everything.firstDay), lastDay: Math.max(world.lastDay, everything.lastDay) };
  // A lane with no dated event of its own: the whole timeline, as on a wide pane.
  const extent = laneExtent ?? whole;
  // With nothing to show, the real-world calendar opens on today; an invented one on its first year.
  return fitAll(extent, length, { ...options, fallbackDay: content.calendar === null ? content.data.today : 0 });
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

/**
 * The dates in view, for the header.
 *
 * @param calendar the project's invented calendar, when it has one
 */
export function rangeText(mode: TimeMode, scale: TimeScale, length: number, calendar: StoryCalendar | null = null): string {
  if (mode === 'story') return 'Story order';
  const precision = precisionForScale(scale, calendar);
  return formatStoryDateRange(
    dateAtPosition(scale, 0, precision, calendar),
    dateAtPosition(scale, Math.max(0, length), precision, calendar),
  );
}

/** The width of a letter of a label on the axis, more or less: what the room for a long month name is worked out from. */
export const TICK_LETTER_WIDTH = 6.5;
/** The least distance between two labels down a narrow pane: with an invented calendar a label may take three short lines. */
export const DOWN_LABEL_GAP = 56;
export const DOWN_CALENDAR_LABEL_GAP = 64;

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
    const calendar = content.calendar;
    // The names of an invented calendar's months and eras are the writer's own text.
    // Across, a label is one line and needs the room of its longest month name. Down, it wraps in its column.
    const gap = vertical ? (calendar === null ? DOWN_LABEL_GAP : DOWN_CALENDAR_LABEL_GAP) : MIN_LABEL_GAP;
    return ticksFor(scale, length, gap, calendar, vertical ? 0 : TICK_LETTER_WIDTH).ticks.map(
      (tick): AxisTick => ({ position: tick.position, label: tick.label, ownText: calendar !== null }),
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
