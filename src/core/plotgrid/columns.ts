// The columns of the plot grid: one per plotline, of one kind at a time.
//
//   lanes       the writer's own timeline lanes (Manuscript holds every
//               scene and Other only collects, so neither is a column)
//   labels      the project's labels, then any label a scene names that the
//               list does not have
//   characters  every entity of the World whose type is Character
//   places      every entity whose type is Place
//   chosen      the entities the writer picked, in the order they were picked
//
// And whether a scene is in a column, by the same rules the timeline, the
// inspector and the World use, so that a change made here shows there too.
//
// Plain calculations: nothing here reads or writes a note.

import { readSceneFields, sameTagName } from '../cards';
import type { CardColor, TagList } from '../cards';
import { readColor } from '../cards/colors';
import { pathKey } from '../paths';
import {
  MANUSCRIPT_LANE,
  OTHER_LANE,
  addEventToLanePatch,
  isEmptyPatch,
  laneKey,
  readLanes,
  removeEventFromLanePatch,
} from '../timeline';
import type { FrontmatterPatch, Lane } from '../timeline';
import type { Frontmatter } from '../types';
import type { Entity, EntityType, WorldLinks } from '../world';

/** What the columns of the grid are. */
export type ColumnKind = 'lanes' | 'labels' | 'characters' | 'places' | 'chosen';

/** Every kind, in the order the menu lists them. */
export const COLUMN_KINDS: readonly ColumnKind[] = ['lanes', 'labels', 'characters', 'places', 'chosen'];

/** What each kind is called on screen. */
export const COLUMN_KIND_NAMES: Readonly<Record<ColumnKind, string>> = {
  lanes: 'Timeline lanes',
  labels: 'Labels',
  characters: 'Characters',
  places: 'Places',
  chosen: 'Chosen entities',
};

/** The World types whose entities make the Characters and the Places columns. */
export const CHARACTER_TYPE = 'character';
export const PLACE_TYPE = 'place';

export function isColumnKind(value: unknown): value is ColumnKind {
  return typeof value === 'string' && (COLUMN_KINDS as readonly string[]).includes(value);
}

/** One column of the grid. */
export interface PlotColumn {
  /** What the column is known by: a lane's key, a label's name, or an entity's path. */
  readonly key: string;
  /** What its header says: the writer's own text. */
  readonly name: string;
  readonly color: CardColor | null;
  /** An icon from Obsidian's set, for an entity's type; null for none. */
  readonly icon: string | null;
  /** False for a label a scene names that the project's list does not have. */
  readonly listed: boolean;
}

// -------------------------------------------------------------------- lanes

/** The lanes the project index lists, without the built-in Manuscript and Other. */
export function plotLanes(stored: unknown): Lane[] {
  return readLanes(stored).lanes.filter((lane) => {
    const key = laneKey(lane.name);
    return key !== laneKey(MANUSCRIPT_LANE) && key !== laneKey(OTHER_LANE);
  });
}

/** One column per lane of the writer's own, in the timeline's order. */
export function laneColumns(stored: unknown): PlotColumn[] {
  return plotLanes(stored).map((lane) => ({
    key: laneKey(lane.name),
    name: lane.name,
    color: readColor(lane.color),
    icon: null,
    listed: true,
  }));
}

/**
 * Whether a scene is in a lane: whether its "timelines" property names the
 * lane, as the timeline reads it. (It is in a lane exactly when taking it out
 * would change something.)
 *
 * @param lanes every lane the project index lists (see readLanes), so that names are matched as the timeline matches them
 */
export function sceneInLane(frontmatter: unknown, lane: string, lanes: readonly Lane[]): boolean {
  return !isEmptyPatch(removeEventFromLanePatch(frontmatter, lane, { lanes, source: 'scene' }));
}

/**
 * The change that puts a scene in a lane, or takes it out: only its
 * "timelines" property, with every other entry kept as it is written. Empty
 * when the scene is already as asked.
 */
export function lanePatch(frontmatter: unknown, lane: string, lanes: readonly Lane[], on: boolean): FrontmatterPatch {
  const context = { lanes, source: 'scene' as const };
  return on ? addEventToLanePatch(frontmatter, lane, context) : removeEventFromLanePatch(frontmatter, lane, context);
}

// ------------------------------------------------------------------- labels

/**
 * One column per label: the project's list in its order, then the labels
 * scenes name that the list lacks, in the order they first come in the book.
 *
 * @param sceneLabels the label of every scene, in binder order (null for none)
 */
export function labelColumns(labels: TagList, sceneLabels: readonly (string | null)[]): PlotColumn[] {
  const columns: PlotColumn[] = labels.tags.map((tag) => ({ key: tag.name, name: tag.name, color: tag.color, icon: null, listed: true }));
  for (const label of sceneLabels) {
    if (label === null || label === '') continue;
    if (columns.some((column) => sameTagName(column.name, label))) continue;
    columns.push({ key: label, name: label, color: null, icon: null, listed: false });
  }
  return columns;
}

/** The scene's label, as the inspector reads it; null for none. */
export function sceneLabel(frontmatter: Readonly<Frontmatter> | null | undefined): string | null {
  return readSceneFields(frontmatter ?? null).label;
}

/** Whether a scene has this label (capitals and extra spaces do not count). */
export function sceneHasLabel(frontmatter: Readonly<Frontmatter> | null | undefined, label: string): boolean {
  const own = sceneLabel(frontmatter);
  return own !== null && sameTagName(own, label);
}

// ----------------------------------------------------------------- entities

function entityColumn(entity: Entity, types: readonly EntityType[]): PlotColumn {
  const type = types.find((candidate) => candidate.id === entity.typeId) ?? null;
  return { key: entity.path, name: entity.name, color: type?.color ?? null, icon: type?.icon ?? null, listed: true };
}

/**
 * The columns of the World's entities: every one of a type (sorted by name,
 * as the World lists them), or the chosen ones in the order they were chosen.
 * A chosen entity that is no longer there is left out.
 */
export function entityColumns(
  kind: 'characters' | 'places' | 'chosen',
  entities: readonly Entity[],
  types: readonly EntityType[],
  chosen: readonly string[] = [],
): PlotColumn[] {
  if (kind === 'chosen') {
    const byPath = new Map(entities.map((entity) => [pathKey(entity.path), entity]));
    const seen = new Set<string>();
    const columns: PlotColumn[] = [];
    for (const path of chosen) {
      const key = pathKey(path);
      const entity = byPath.get(key);
      if (!entity || seen.has(key)) continue;
      seen.add(key);
      columns.push(entityColumn(entity, types));
    }
    return columns;
  }
  const typeId = kind === 'characters' ? CHARACTER_TYPE : PLACE_TYPE;
  return entities.filter((entity) => entity.typeId === typeId).map((entity) => entityColumn(entity, types));
}

/** Whether a scene lists an entity in its "entities" property (a link that leads to the entity's note). */
export function sceneHasEntity(links: WorldLinks, scenePath: string, entityPath: string): boolean {
  const key = pathKey(entityPath);
  return links.linksOf(scenePath).some((link) => link.entity !== null && pathKey(link.entity.path) === key);
}

/**
 * Where a link leads, the way the World works it out: a bare name is looked
 * for among the project's own World notes first (a vault may hold two
 * projects that each have a "Mara"); anything else, and a name the project
 * does not have exactly once, is left to the vault.
 *
 * @param worldNotes the vault paths of the project's World notes
 * @param vault      the vault's own way of following a link
 */
export function projectFirstResolver(
  worldNotes: readonly string[],
  vault: (target: string, from: string) => string | null,
): (target: string, from: string) => string | null {
  const byName = new Map<string, string[]>();
  for (const path of worldNotes) {
    const name = (path.split('/').pop() ?? path).replace(/\.md$/i, '').toLowerCase();
    const list = byName.get(name) ?? [];
    list.push(path);
    byName.set(name, list);
  }
  return (target, from) => {
    if (!target.includes('/')) {
      const own = byName.get(target.trim().toLowerCase());
      if (own !== undefined && own.length === 1 && own[0] !== undefined) return own[0];
    }
    return vault(target, from);
  };
}
