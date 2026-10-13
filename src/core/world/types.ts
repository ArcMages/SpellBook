// The types an entity of the world can have: character, place, faction,
// item, lore, creature, culture, and whatever types the writer adds.
//
//   entityTypes:
//     - id: character
//       name: Character
//       folder: Characters
//       fields: [role, age, occupation, appearance, personality, voice, goal, arc, summary]
//       fieldsVersion: 2
//       color: blue
//       icon: user
//
// The list lives in the project index under "entityTypes", so that it syncs
// with the project. The seven types above the writer's own are built in:
// they are there also when the index says nothing about them, and cannot be
// removed (their commands rely on them), but their name, folder, fields,
// colour and icon can be changed like any other's.
//
// A type's id is what an entity note says in its "type" property. It never
// changes once the type exists, so renaming a type leaves every note alone.
//
// Projects made by an earlier version: the first version had four built-in
// types, and fewer fields for a character and a place. A list stored then is
// read like this:
//   - a built-in type it does not mention is added after the others, as
//     always, so lore, creature and culture simply appear;
//   - a character or a place whose fields are exactly what the first version
//     gave them (the writer never changed them) gets the fields of today;
//   - whatever the writer changed, and every type of their own, stays as it
//     is written. A list stored by this version says "fieldsVersion: 2" on
//     those two types, so that fields the writer later sets back to the old
//     ones are kept as well.

import { readColor } from '../cards/colors';
import type { CardColor } from '../cards/colors';
import { sanitiseFileName, tidyDisplayName } from '../names';
import { clashKey } from '../paths';

/** The key of the project index the types are kept under. */
export const ENTITY_TYPES_KEY = 'entityTypes';

/** The property of an entity note that names its type. */
export const TYPE_KEY = 'type';
/** The property every type starts with, and the one the browser shows and searches. */
export const SUMMARY_KEY = 'summary';
/** Obsidian's own property for the other names of a note; "Find mentions" looks for them too. */
export const ALIASES_KEY = 'aliases';
/** The property of a scene or a timeline event that lists the entities in it, as links. */
export const ENTITIES_KEY = 'entities';
/** The property of an entity note that names its picture: a link to an image file of the vault. */
export const IMAGE_KEY = 'image';
/** The property of an entity note that lists the entities it has to do with: links, each with a short label. */
export const RELATED_KEY = 'related';

/** The icons a type can have, by their names in Obsidian's icon set; the first is what a new type gets. */
export const ENTITY_ICONS = [
  'circle-dot',
  'user',
  'users',
  'map-pin',
  'flag',
  'gem',
  'crown',
  'sword',
  'shield',
  'book',
  'key',
  'star',
  'heart',
  'home',
  'ship',
  'paw-print',
  'leaf',
  'skull',
  'sparkles',
  'scroll',
  'landmark',
  'languages',
  'feather',
  'mountain',
] as const;

export interface EntityType {
  /** What an entity note says in its "type" property: lower case, never changed. */
  readonly id: string;
  /** What one of them is called, for example "Character". The writer's own text for a type of their own. */
  readonly name: string;
  /** The folder inside World its notes are made in, and the heading of its group: "Characters". */
  readonly folder: string;
  /** The properties a new note of this type starts with, besides "type", in order. */
  readonly fields: readonly string[];
  readonly color: CardColor | null;
  /** The name of an icon in Obsidian's set. */
  readonly icon: string;
  /** True for the types every project has. */
  readonly builtIn: boolean;
}

/** The types every project has. */
export const BUILT_IN_TYPES: readonly EntityType[] = Object.freeze([
  {
    id: 'character',
    name: 'Character',
    folder: 'Characters',
    fields: ['role', 'age', 'occupation', 'appearance', 'personality', 'voice', 'goal', 'arc', SUMMARY_KEY],
    color: 'blue',
    icon: 'user',
    builtIn: true,
  },
  {
    id: 'place',
    name: 'Place',
    folder: 'Places',
    fields: ['kind', 'region', 'atmosphere', 'landmarks', SUMMARY_KEY],
    color: 'green',
    icon: 'map-pin',
    builtIn: true,
  },
  { id: 'faction', name: 'Faction', folder: 'Factions', fields: ['kind', 'leader', SUMMARY_KEY], color: 'red', icon: 'flag', builtIn: true },
  { id: 'item', name: 'Item', folder: 'Items', fields: ['kind', 'owner', SUMMARY_KEY], color: 'orange', icon: 'gem', builtIn: true },
  // Legends, tales, myths, history, religion, customs.
  { id: 'lore', name: 'Lore', folder: 'Lore', fields: ['kind', 'period', 'told-by', SUMMARY_KEY], color: 'purple', icon: 'scroll', builtIn: true },
  { id: 'creature', name: 'Creature', folder: 'Creatures', fields: ['kind', 'habitat', SUMMARY_KEY], color: 'yellow', icon: 'paw-print', builtIn: true },
  // Peoples and their languages.
  { id: 'culture', name: 'Culture', folder: 'Cultures', fields: ['kind', 'region', SUMMARY_KEY], color: 'cyan', icon: 'users', builtIn: true },
] satisfies EntityType[]);

/** What a stored list says on a built-in type whose fields were written by this version. */
export const FIELDS_VERSION_KEY = 'fieldsVersion';
/** The version of the built-in types' fields: 1 had fewer for a character and a place. */
export const FIELDS_VERSION = 2;

/** The fields the first version gave the built-in types that have more today. */
const FIRST_FIELDS: Readonly<Record<string, readonly string[]>> = {
  character: ['role', 'age', 'appearance', 'goal', SUMMARY_KEY],
  place: ['kind', 'region', SUMMARY_KEY],
};

/** Properties that are not a type's to list: they have a meaning of their own. */
const RESERVED_FIELDS: ReadonlySet<string> = new Set([TYPE_KEY, ALIASES_KEY, ENTITIES_KEY, IMAGE_KEY, RELATED_KEY]);

/** How a type is told from another: its id without regard to capitals or spaces around it. */
export function typeKey(id: string): string {
  return id.trim().normalize('NFC').toLowerCase();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown): string {
  return typeof value === 'string' ? tidyDisplayName(value) : '';
}

/**
 * Read a list of property names: a list, or one line with commas between the
 * names (what the writer types). Empty names, repeats and the properties with
 * a meaning of their own (type, aliases, entities, image, related) are left
 * out.
 */
export function readFields(value: unknown): string[] {
  const raw: unknown[] = typeof value === 'string' ? value.split(/[,\n]/) : Array.isArray(value) ? value : [];
  const fields: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const name = text(item);
    const key = name.toLowerCase();
    if (name === '' || seen.has(key) || RESERVED_FIELDS.has(key)) continue;
    seen.add(key);
    fields.push(name);
  }
  return fields;
}

/**
 * True for a stored built-in type that an earlier version wrote and the
 * writer never changed the fields of: it does not say which version its
 * fields are of, and they are exactly what that version gave the type.
 */
function isFirstVersion(id: string, item: Record<string, unknown>): boolean {
  const first = FIRST_FIELDS[id];
  if (first === undefined) return false;
  const version: unknown = item[FIELDS_VERSION_KEY];
  if (typeof version === 'number' && version >= FIELDS_VERSION) return false;
  const stored = readFields(item['fields']);
  return stored.length === first.length && stored.every((field, index) => field === first[index]);
}

/** The first of `names` that no type in `types` uses as its folder; " 2", " 3" are added until one is free. */
function freeFolder(wanted: string, taken: ReadonlySet<string>): string {
  if (!taken.has(clashKey(wanted))) return wanted;
  for (let n = 2; ; n++) {
    const candidate = `${wanted} ${n}`;
    if (!taken.has(clashKey(candidate))) return candidate;
  }
}

/**
 * Read the types of a project from what its index holds under "entityTypes".
 * Whatever cannot be understood is left out, never guessed at: an entry
 * without an id, a second entry with an id already seen. A built-in type the
 * list does not have is added after the others, as it is built in; and a
 * built-in type that still has the fields an earlier version gave it gets
 * the fields of today (see the top of this file).
 */
export function readEntityTypes(raw: unknown): EntityType[] {
  const types: EntityType[] = [];
  const seen = new Set<string>();
  const folders = new Set<string>();
  for (const item of Array.isArray(raw) ? raw : []) {
    if (!isRecord(item)) continue;
    const id = typeKey(typeof item['id'] === 'string' ? item['id'] : '');
    if (id === '' || seen.has(id)) continue;
    const builtIn = BUILT_IN_TYPES.find((type) => type.id === id) ?? null;
    const name = text(item['name']) || builtIn?.name || id;
    const folder = freeFolder(sanitiseFileName(text(item['folder']), '') || builtIn?.folder || sanitiseFileName(name, id), folders);
    const icon = typeof item['icon'] === 'string' && item['icon'].trim() !== '' ? item['icon'].trim() : (builtIn?.icon ?? ENTITY_ICONS[0]);
    seen.add(id);
    folders.add(clashKey(folder));
    types.push({
      id,
      name,
      folder,
      fields: builtIn && (item['fields'] === undefined || isFirstVersion(builtIn.id, item)) ? builtIn.fields : readFields(item['fields']),
      // A colour that is written out and is none of the eight means "no colour"; a built-in type that says nothing keeps its own.
      color: item['color'] === undefined && builtIn ? builtIn.color : readColor(item['color']),
      icon,
      builtIn: builtIn !== null,
    });
  }
  for (const builtIn of BUILT_IN_TYPES) {
    if (seen.has(builtIn.id)) continue;
    const folder = freeFolder(builtIn.folder, folders);
    folders.add(clashKey(folder));
    types.push({ ...builtIn, folder });
  }
  return types;
}

/** The list as it is stored in the project index. */
export function writeEntityTypes(types: readonly EntityType[]): unknown[] {
  return types.map((type) => ({
    id: type.id,
    name: type.name,
    folder: type.folder,
    fields: [...type.fields],
    // So that fields set back to an earlier version's are known to be the writer's choice.
    ...(type.builtIn && FIRST_FIELDS[type.id] !== undefined ? { [FIELDS_VERSION_KEY]: FIELDS_VERSION } : {}),
    color: type.color,
    icon: type.icon,
  }));
}

/** The type with this id, or null. */
export function findType(types: readonly EntityType[], id: string | null): EntityType | null {
  if (id === null) return null;
  const key = typeKey(id);
  return types.find((type) => type.id === key) ?? null;
}

/** What became of a change to the list: the new list, or why it cannot be made. */
export type TypeEdit = { readonly ok: true; readonly types: EntityType[] } | { readonly ok: false; readonly message: string };

/** What the writer can set on a type. */
export interface TypeDetails {
  readonly name?: string;
  readonly folder?: string;
  readonly fields?: readonly string[] | string;
  readonly color?: CardColor | null;
  readonly icon?: string;
}

function no(message: string): TypeEdit {
  return { ok: false, message };
}

/** Check a name typed for a type's folder: it must be a file name, and no other type's folder. */
function checkFolder(types: readonly EntityType[], raw: string, own: string | null): string | TypeEdit {
  const folder = sanitiseFileName(raw, '');
  if (folder === '') return no('Give the folder a name.');
  if (types.some((type) => type.id !== own && clashKey(type.folder) === clashKey(folder))) {
    return no(`Another type already keeps its notes in "${folder}".`);
  }
  return folder;
}

/**
 * Add a type of the writer's own at the end of the list. Its id is its name
 * in lower case; its folder is its name unless another is given.
 */
export function addType(types: readonly EntityType[], details: TypeDetails & { readonly name: string }): TypeEdit {
  const name = tidyDisplayName(details.name);
  if (name === '') return no('Give the type a name.');
  const id = typeKey(name);
  if (types.some((type) => type.id === id || typeKey(type.name) === id)) return no(`There is already a type called "${name}".`);
  const folder = checkFolder(types, details.folder ?? name, null);
  if (typeof folder !== 'string') {
    return details.folder === undefined && sanitiseFileName(name, '') === ''
      ? no('That name has no characters that can be used in a folder name.')
      : folder;
  }
  const fields = details.fields === undefined ? [SUMMARY_KEY] : readFields(details.fields);
  return {
    ok: true,
    types: [
      ...types,
      { id, name, folder, fields, color: details.color ?? null, icon: details.icon ?? ENTITY_ICONS[0], builtIn: false },
    ],
  };
}

/**
 * Change a type's name, folder, fields, colour or icon. Its id stays, so the
 * notes that have this type keep it. A new folder is where notes are made
 * from now on: the notes that are already there are not moved.
 */
export function changeType(types: readonly EntityType[], id: string, details: TypeDetails): TypeEdit {
  const type = findType(types, id);
  if (!type) return no('That type is no longer in the list.');
  let next: EntityType = type;
  if (details.name !== undefined) {
    const name = tidyDisplayName(details.name);
    if (name === '') return no('Give the type a name.');
    const key = typeKey(name);
    if (types.some((other) => other.id !== type.id && (other.id === key || typeKey(other.name) === key))) {
      return no(`There is already a type called "${name}".`);
    }
    next = { ...next, name };
  }
  if (details.folder !== undefined) {
    const folder = checkFolder(types, details.folder, type.id);
    if (typeof folder !== 'string') return folder;
    next = { ...next, folder };
  }
  if (details.fields !== undefined) next = { ...next, fields: readFields(details.fields) };
  if (details.color !== undefined) next = { ...next, color: details.color };
  if (details.icon !== undefined && details.icon.trim() !== '') next = { ...next, icon: details.icon.trim() };
  return { ok: true, types: types.map((other) => (other.id === type.id ? next : other)) };
}

/** Take a type of the writer's own off the list. Its notes stay where they are, and show as "Other". */
export function removeType(types: readonly EntityType[], id: string): TypeEdit {
  const type = findType(types, id);
  if (!type) return no('That type is no longer in the list.');
  if (type.builtIn) return no(`"${type.name}" is one of the types every project has, and cannot be removed.`);
  return { ok: true, types: types.filter((other) => other.id !== type.id) };
}

/** Move a type one place up or down the list. The list comes back as it is when it is already at that end. */
export function moveType(types: readonly EntityType[], id: string, direction: 'up' | 'down'): TypeEdit {
  const at = types.findIndex((type) => type.id === typeKey(id));
  if (at < 0) return no('That type is no longer in the list.');
  const to = direction === 'up' ? at - 1 : at + 1;
  const next = [...types];
  if (to < 0 || to >= next.length) return { ok: true, types: next };
  const [moved] = next.splice(at, 1);
  next.splice(to, 0, moved as EntityType);
  return { ok: true, types: next };
}
