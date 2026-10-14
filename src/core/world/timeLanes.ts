// The world on the timeline: one lane per type of entity, with the entities
// that have a place in time.
//
// An entity with a "date" and an "end" is a span from one to the other; one
// with only a "date" is a point; its moments are small points on the same
// row. An entity without a "date" still has a row when it has an "end" or a
// moment that can be read: it is then drawn at those. An entity with no date
// at all is not on the timeline, and a type none of whose entities has one
// has no lane.
//
// The rows are packed by the timeline engine itself (src/core/timeline), the
// way it packs events: each entity is handed to it as an event that lasts
// from its first day to its last, so no two rows of a lane overlap and a
// name always has room. Entities never merge into a cluster, however far the
// view is zoomed out: each keeps a row of its own.
//
// Pure: values in, values out. No file, no screen, no clock.

import type { CardColor } from '../cards/colors';
import { dayNumberToStoryDate, laneKey, layoutLaneVertical, layoutTimeline, storyDateToDayNumber } from '../timeline';
import type { Lane, MeasureCard, StoryCalendar, StoryDate, TimeScale, TimelineEvent } from '../timeline';
import { OTHER_NAME, OTHER_TYPE } from './browse';
import type { Entity } from './entity';
import { datedMoments, isDated, readEntityTime } from './time';
import type { EntityTime } from './time';
import { findType } from './types';
import type { EntityType } from './types';

/** What the key of every world lane starts with. No lane the writer names can have a key like it: it has a line break in it. */
export const WORLD_LANE_PREFIX = 'world\n';

/** The key of the lane of a type of entity (or of OTHER_TYPE). */
export function worldLaneKey(typeId: string): string {
  return laneKey(`${WORLD_LANE_PREFIX}${typeId}`);
}

/** True for the key of a world lane. */
export function isWorldLaneKey(key: string | null | undefined): boolean {
  return typeof key === 'string' && key.startsWith(WORLD_LANE_PREFIX);
}

/** One moment of an entity, as a point on its row. */
export interface WorldPoint {
  readonly day: number;
  readonly date: StoryDate;
  /** What happens; "" when the moment says only a date. The writer's own text. */
  readonly label: string;
}

/** One entity on the timeline: a row of a world lane. */
export interface WorldTimeRow {
  readonly entity: Entity;
  /** Its type; null for an entity whose type is not in the list. */
  readonly type: EntityType | null;
  readonly time: EntityTime;
  /** The first and the last day anything of it stands on. */
  readonly firstDay: number;
  readonly lastDay: number;
  /** The day it begins, and the day it ends; null for a date its note does not have. */
  readonly startDay: number | null;
  readonly endDay: number | null;
  /** Its moments that have a date, earliest first. */
  readonly points: readonly WorldPoint[];
  /**
   * The entity as the timeline engine moves an event: its own "date" and
   * "end", nothing else. An entity without a "date" has no start here, and
   * cannot be dragged.
   */
  readonly event: TimelineEvent;
  /** The entity as the engine packs it: an event from its first day to its last. */
  readonly extent: TimelineEvent;
}

/** One lane of the world: a type of entity and its rows. */
export interface WorldLane {
  /** What the lane is looked up by (see `worldLaneKey`). */
  readonly key: string;
  /** The type's id, or OTHER_TYPE for the entities whose type is not in the list. */
  readonly typeId: string;
  /** The heading: the type's folder name ("Characters"), or "Other". May be the writer's own text. */
  readonly name: string;
  readonly color: CardColor | null;
  /** Its rows, by first day, then by name. */
  readonly rows: readonly WorldTimeRow[];
  /** True when this device does not show the lane. */
  readonly hidden: boolean;
}

export interface WorldLaneOptions {
  /** The ids of the types whose lanes this device has hidden. */
  readonly hidden?: Iterable<string>;
  /** When given: only the entities for which it says yes have a row (the timeline's filter). */
  readonly only?: (entity: Entity) => boolean;
}

function eventOf(path: string, title: string, start: StoryDate | null, end: StoryDate | null, timelines: readonly string[]): TimelineEvent {
  return { path, title, source: 'event', start, end, timelines, scenes: [], entities: [], tags: [], problems: [] };
}

/** The name the engine is told a lane has: the same text as its key, so that the two are found by each other. */
const engineName = (typeId: string): string => `${WORLD_LANE_PREFIX}${typeId}`;

/**
 * The lanes of the world: one per type that has an entity with a date, in
 * the order of the list of types, with "Other" last.
 *
 * @param calendar the project's invented calendar, or null for the real-world one
 */
export function worldLanes(
  entities: readonly Entity[],
  types: readonly EntityType[],
  calendar: StoryCalendar | null,
  options: WorldLaneOptions = {},
): WorldLane[] {
  const hidden = new Set<string>();
  for (const id of options.hidden ?? []) hidden.add(id);
  const byType = new Map<string, WorldTimeRow[]>();
  for (const entity of entities) {
    if (options.only !== undefined && !options.only(entity)) continue;
    const time = readEntityTime(entity.frontmatter, calendar);
    if (!isDated(time)) continue;
    const type = findType(types, entity.typeId);
    const typeId = type?.id ?? OTHER_TYPE;
    const startDay = time.start === null ? null : storyDateToDayNumber(time.start);
    const endDay = time.end === null ? null : storyDateToDayNumber(time.end);
    const points = datedMoments(time).map((moment): WorldPoint => ({ day: storyDateToDayNumber(moment.date), date: moment.date, label: moment.label }));
    const days = [startDay, endDay, ...points.map((point) => point.day)].filter((day): day is number => day !== null);
    const firstDay = Math.min(...days);
    const lastDay = Math.max(...days);
    const lane = [engineName(typeId)];
    const row: WorldTimeRow = {
      entity,
      type,
      time,
      firstDay,
      lastDay,
      startDay,
      endDay,
      points,
      event: eventOf(entity.path, entity.name, time.start, time.start === null ? null : time.end, lane),
      extent: eventOf(
        entity.path,
        entity.name,
        dayNumberToStoryDate(firstDay, 'day', calendar),
        lastDay > firstDay ? dayNumberToStoryDate(lastDay, 'day', calendar) : null,
        lane,
      ),
    };
    const rows = byType.get(typeId) ?? [];
    rows.push(row);
    byType.set(typeId, rows);
  }
  const lanes: WorldLane[] = [];
  const add = (typeId: string, name: string, color: CardColor | null): void => {
    const rows = byType.get(typeId);
    if (rows === undefined) return;
    rows.sort((a, b) => a.firstDay - b.firstDay || a.entity.name.localeCompare(b.entity.name) || (a.entity.path < b.entity.path ? -1 : 1));
    lanes.push({ key: worldLaneKey(typeId), typeId, name, color, rows, hidden: hidden.has(typeId) });
  };
  for (const type of types) add(type.id, type.folder, type.color);
  add(OTHER_TYPE, OTHER_NAME, null);
  return lanes;
}

/** The first and the last day the rows of some lanes cover; null when they have none. */
export function worldExtent(lanes: readonly WorldLane[]): { readonly firstDay: number; readonly lastDay: number } | null {
  let firstDay = Number.POSITIVE_INFINITY;
  let lastDay = Number.NEGATIVE_INFINITY;
  for (const lane of lanes) {
    for (const row of lane.rows) {
      firstDay = Math.min(firstDay, row.firstDay);
      lastDay = Math.max(lastDay, row.lastDay);
    }
  }
  return firstDay <= lastDay ? { firstDay, lastDay } : null;
}

// ------------------------------------------------------------------- layout

/** A row with its place: for a time axis that runs across, or (on a phone) down. */
export interface PlacedWorldRow {
  readonly row: WorldTimeRow;
  /** The row within its lane (time across), from 0; always 0 when time runs down. */
  readonly track: number;
  /** Where it starts along the time axis, in pixels from the start of the view the scale describes. */
  readonly position: number;
  /** How long it is along the time axis: its width when time runs across, its height when time runs down. */
  readonly size: number;
  /** True when it covers more than one day. */
  readonly isSpan: boolean;
}

/** One world lane, laid out. */
export interface WorldLaneLayout {
  readonly lane: WorldLane;
  /** How many rows (time across) or columns (time down) it needs. */
  readonly trackCount: number;
  /** In order of position. */
  readonly items: readonly PlacedWorldRow[];
}

export interface WorldLayoutOptions {
  readonly scale: TimeScale;
  /**
   * How much room a row needs along the time axis besides its dates: the
   * room for its name. It is handed the entity's name and the entity as the
   * engine packs it.
   */
  readonly measure: MeasureCard;
  /** Pixels kept between two rows side by side. The engine's own default when left out. */
  readonly gap?: number;
}

function engineLanes(lanes: readonly WorldLane[]): Lane[] {
  return lanes.map((lane) => ({ name: engineName(lane.typeId), color: null }));
}

function rowsByPath(lanes: readonly WorldLane[]): Map<string, WorldTimeRow> {
  const rows = new Map<string, WorldTimeRow>();
  for (const lane of lanes) for (const row of lane.rows) rows.set(`${lane.key}\n${row.entity.path}`, row);
  return rows;
}

/**
 * Lay the world lanes out for a time axis that runs across the screen: in
 * every lane the rows are packed so that none overlap. A span is as wide as
 * its dates, or as its name needs, whichever is more.
 */
export function layoutWorldLanes(lanes: readonly WorldLane[], options: WorldLayoutOptions): WorldLaneLayout[] {
  if (lanes.length === 0) return [];
  const rows = rowsByPath(lanes);
  const laid = layoutTimeline(
    lanes.flatMap((lane) => lane.rows.map((row) => row.extent)),
    engineLanes(lanes),
    { scale: options.scale, measure: options.measure, clusterDistance: 0, ...(options.gap === undefined ? {} : { gap: options.gap }) },
  );
  return lanes.map((lane): WorldLaneLayout => {
    const found = laid.lanes.find((entry) => entry.lane.key === lane.key);
    const items: PlacedWorldRow[] = [];
    for (const item of found?.items ?? []) {
      if (item.kind !== 'event') continue;
      const row = rows.get(`${lane.key}\n${item.event.path}`);
      if (row !== undefined) items.push({ row, track: item.row, position: item.position, size: item.width, isSpan: item.isSpan });
    }
    return { lane, trackCount: found?.rowCount ?? 0, items };
  });
}

/**
 * Lay one world lane out for a phone, with time running from top to bottom:
 * one column of cards, each where its first date is, or right after the card
 * before it when that one is still in the way.
 */
export function layoutWorldLaneDown(lane: WorldLane, options: WorldLayoutOptions): WorldLaneLayout {
  const rows = rowsByPath([lane]);
  const laid = layoutLaneVertical(
    lane.rows.map((row) => row.extent),
    engineLanes([lane]),
    engineName(lane.typeId),
    { scale: options.scale, measure: options.measure, clusterDistance: 0, ...(options.gap === undefined ? {} : { gap: options.gap }) },
  );
  const items: PlacedWorldRow[] = [];
  for (const item of laid.items) {
    if (item.kind !== 'event') continue;
    const row = rows.get(`${lane.key}\n${item.event.path}`);
    if (row !== undefined) items.push({ row, track: 0, position: item.position, size: item.height, isSpan: item.isSpan });
  }
  return { lane, trackCount: laid.columnCount, items };
}
