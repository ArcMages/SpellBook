// What the World browser shows: the entities that pass the search box and
// the type filter, as cards in groups, one per type, or as the rows of a
// table that can be sorted; and the one or two facts a card shows besides
// the name and the summary.

import { fieldText } from './entity';
import type { Entity } from './entity';
import { SUMMARY_KEY, findType } from './types';
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

// ------------------------------------------------------------ cards and rows

/** The two ways the browser lays the entities out. */
export type WorldLayout = 'cards' | 'list';
export const WORLD_LAYOUTS: readonly WorldLayout[] = ['cards', 'list'];
/** What a device that never chose shows. */
export const DEFAULT_LAYOUT: WorldLayout = 'cards';

/** Read the layout a device remembers. Anything that is not one of the two is the usual one. */
export function readLayout(stored: unknown): WorldLayout {
  return stored === 'list' || stored === 'cards' ? stored : DEFAULT_LAYOUT;
}

/**
 * The properties a card of a built-in type shows under the name: what a
 * reader most wants to know at a glance. A type of the writer's own shows
 * the first two of its fields.
 */
const KEY_FIELDS: Readonly<Record<string, readonly string[]>> = {
  character: ['role'],
  place: ['kind', 'region'],
  faction: ['kind', 'leader'],
  item: ['kind', 'owner'],
  lore: ['kind', 'period'],
  creature: ['kind', 'habitat'],
  culture: ['kind', 'region'],
};

/** No card shows more facts than this. */
export const CARD_FACTS_MAX = 2;

/** One fact on a card: a property and what it holds. */
export interface CardFact {
  readonly name: string;
  readonly value: string;
}

/**
 * The one or two key facts of an entity, for its card: the key properties
 * of its type that hold something. A built-in type whose key properties the
 * writer took off its list, and every type of the writer's own, shows the
 * first fields of the type instead. Never the summary: it has its own line.
 */
export function cardFacts(entity: Entity, type: EntityType | null): CardFact[] {
  if (type === null) return [];
  const usual = (KEY_FIELDS[type.id] ?? []).filter((name) => type.fields.includes(name));
  const names = usual.length > 0 ? usual : type.fields.filter((name) => name !== SUMMARY_KEY).slice(0, CARD_FACTS_MAX);
  const facts: CardFact[] = [];
  for (const name of names) {
    const value = fieldText(entity.frontmatter?.[name]);
    if (value !== '') facts.push({ name, value });
  }
  return facts.slice(0, CARD_FACTS_MAX);
}

/** What the table's "Kind" column says of an entity: its first key fact (a character's role, a place's kind). */
export function kindOf(entity: Entity, type: EntityType | null): string {
  return cardFacts(entity, type)[0]?.value ?? '';
}

/** The columns of the table, in order; each can be sorted by. */
export type WorldColumn = 'name' | 'type' | 'kind' | 'scenes';
export const WORLD_COLUMNS: ReadonlyArray<{ readonly id: WorldColumn; readonly title: string }> = [
  { id: 'name', title: 'Name' },
  { id: 'type', title: 'Type' },
  { id: 'kind', title: 'Kind' },
  { id: 'scenes', title: 'Scenes' },
];

/** How the table is sorted. */
export interface WorldSort {
  readonly column: WorldColumn;
  readonly descending: boolean;
}
export const DEFAULT_SORT: WorldSort = { column: 'name', descending: false };

/** The sort after a tap on a column's heading: that column, or the other way round when it is sorted by already. */
export function nextSort(sort: WorldSort, column: WorldColumn): WorldSort {
  return sort.column === column ? { column, descending: !sort.descending } : { column, descending: false };
}

/** One row of the table. */
export interface WorldRow {
  readonly entity: Entity;
  /** The type; null for an entity whose type is not in the list. */
  readonly type: EntityType | null;
  /** What the type is called ("Character"), or "Other". */
  readonly typeName: string;
  readonly kind: string;
  /** How many scenes list it. */
  readonly scenes: number;
}

/**
 * The rows of the table: the entities that pass the search box and the type
 * filter, sorted by a column. Rows that are equal there are in order of
 * their names; a row with nothing in the column comes after those that have
 * something, whichever way the column is sorted.
 *
 * @param typeId     ALL_TYPES, a type's id, or OTHER_TYPE
 * @param sceneCount how many scenes list an entity, by its path
 */
export function tableRows(
  entities: readonly Entity[],
  types: readonly EntityType[],
  query: string,
  typeId: string,
  sort: WorldSort,
  sceneCount: (entityPath: string) => number,
): WorldRow[] {
  const rows: WorldRow[] = [];
  for (const entity of entities) {
    const type = findType(types, entity.typeId);
    if (typeId !== ALL_TYPES && typeId !== (type?.id ?? OTHER_TYPE)) continue;
    if (!matchesSearch(entity, query)) continue;
    rows.push({ entity, type, typeName: type?.name ?? OTHER_NAME, kind: kindOf(entity, type), scenes: sceneCount(entity.path) });
  }
  const byName = (a: WorldRow, b: WorldRow): number =>
    a.entity.name.localeCompare(b.entity.name) || (a.entity.path < b.entity.path ? -1 : a.entity.path > b.entity.path ? 1 : 0);
  const turn = sort.descending ? -1 : 1;
  const words = (a: string, b: string): number => {
    if ((a === '') !== (b === '')) return a === '' ? 1 : -1;
    return turn * a.localeCompare(b);
  };
  const typeOrder = (row: WorldRow): number => (row.type === null ? types.length : types.indexOf(row.type));
  return rows.sort((a, b) => {
    let order = 0;
    if (sort.column === 'name') order = turn * byName(a, b);
    else if (sort.column === 'type') order = turn * (typeOrder(a) - typeOrder(b));
    else if (sort.column === 'kind') order = words(a.kind, b.kind);
    else order = turn * (a.scenes - b.scenes);
    return order || byName(a, b);
  });
}
