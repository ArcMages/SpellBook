// What the World browser shows: the entities that pass the search box and
// the type filter, in groups, one per type.

import type { Entity } from './entity';
import { findType } from './types';
import type { EntityType } from './types';

/** The filter value for "every type". */
export const ALL_TYPES = '';
/** The filter value, and the group, of entities whose type is not in the list. */
export const OTHER_TYPE = '*other';
/** What that group is called. */
export const OTHER_NAME = 'Other';

/** Below this width a pane shows one column, and the details instead of the list. */
export const NARROW_PANE_PX = 560;
/** How far past that width a narrow pane must grow before it is wide again, so that it does not flicker at the edge. */
export const NARROW_SLACK_PX = 24;

/**
 * Whether a pane of this width is narrow. A pane that sits right at the edge
 * stays as it was: it turns narrow under the width, and wide again only a
 * little above it.
 */
export function isNarrowPane(width: number, wasNarrow: boolean): boolean {
  if (!(width > 0)) return wasNarrow;
  return wasNarrow ? width < NARROW_PANE_PX + NARROW_SLACK_PX : width < NARROW_PANE_PX;
}

/** Text as the search compares it: capitals and the two ways of writing an accented letter do not matter. */
export function searchKey(text: string): string {
  return text.normalize('NFC').toLocaleLowerCase();
}

/** True when every word typed in the search box is found in the entity's name, other names or summary. */
export function matchesSearch(entity: Entity, query: string): boolean {
  const words = searchKey(query).split(/\s+/).filter((word) => word !== '');
  if (words.length === 0) return true;
  const hay = searchKey([entity.name, ...entity.aliases, entity.summary].join('\n'));
  return words.every((word) => hay.includes(word));
}

/** One group of the browser: a type and its entities, sorted by name. */
export interface EntityGroup {
  /** The type's id, or OTHER_TYPE. */
  readonly id: string;
  /** The type; null for the group of entities whose type is not in the list. */
  readonly type: EntityType | null;
  /** The heading: the type's folder name ("Characters"), or "Other". */
  readonly name: string;
  readonly entities: readonly Entity[];
}

/**
 * The entities to show, in groups in the order of the list of types, with
 * "Other" last. A group with nothing in it is left out, except when no
 * search is typed and it is the one type the filter asks for (so that the
 * browser can say that there are none yet).
 *
 * @param typeId ALL_TYPES, a type's id, or OTHER_TYPE
 */
export function groupEntities(
  entities: readonly Entity[],
  types: readonly EntityType[],
  query = '',
  typeId: string = ALL_TYPES,
): EntityGroup[] {
  const groups: EntityGroup[] = [];
  const wanted = (id: string): boolean => typeId === ALL_TYPES || typeId === id;
  const matching = entities.filter((entity) => matchesSearch(entity, query));
  for (const type of types) {
    if (!wanted(type.id)) continue;
    const members = matching.filter((entity) => entity.typeId === type.id);
    if (members.length > 0 || (typeId === type.id && query.trim() === '')) {
      groups.push({ id: type.id, type, name: type.folder, entities: members });
    }
  }
  if (wanted(OTHER_TYPE)) {
    const others = matching.filter((entity) => findType(types, entity.typeId) === null);
    if (others.length > 0) groups.push({ id: OTHER_TYPE, type: null, name: OTHER_NAME, entities: others });
  }
  return groups;
}

/** "3 scenes", "1 scene", "No scenes". */
export function sceneCountText(count: number): string {
  if (count <= 0) return 'No scenes';
  return count === 1 ? '1 scene' : `${count} scenes`;
}
