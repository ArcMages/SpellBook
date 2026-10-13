// An entity of the world: a character, a place, a faction, an item, a piece
// of lore, a creature, a culture, or something of a type the writer made. It
// is a plain note in the project's World folder:
//
//   World/Characters/Mara.md
//   ---
//   type: character
//   role: Lighthouse keeper
//   age: 34
//   appearance:
//   goal:
//   summary: Keeps the light, and a secret.
//   aliases: []
//   image: "[[mara.png]]"
//   related:
//     - "[[Saltwick|lives in]]"
//   ---
//   ## Appearance
//
// Its name is the note's name. Its type is what the "type" property says or,
// for a note without one, the type whose folder it lies in. Its picture
// (image.ts) and the entities it has to do with (relations.ts) are optional:
// a new note has neither. Every other property is the writer's: they can add
// and remove whatever they like.

import { clashKey, isInside, isMarkdownPath, noteTitle } from '../paths';
import { WORLD_FOLDER } from '../projectLayout';
import type { Frontmatter } from '../types';
import { ALIASES_KEY, ENTITIES_KEY, IMAGE_KEY, RELATED_KEY, SUMMARY_KEY, TYPE_KEY, findType, typeKey } from './types';
import type { EntityType } from './types';

/** A note of the project, as the store lists it. */
export interface WorldNote {
  /** Path relative to the project folder. */
  readonly path: string;
  readonly frontmatter: Readonly<Frontmatter> | null;
}

export interface Entity {
  /** The note's path relative to the project folder; what the entity is known by. */
  readonly path: string;
  /** The note's name: the writer's own text. */
  readonly name: string;
  /** The id of its type; null for a note whose type is not in the list ("Other"). */
  readonly typeId: string | null;
  /** The "summary" property, on one line; "" when the note has none. */
  readonly summary: string;
  /** The other names it goes by (Obsidian's "aliases" property). */
  readonly aliases: readonly string[];
  readonly frontmatter: Readonly<Frontmatter> | null;
}

/** The headings a new note of a built-in type starts with. */
const HEADINGS: Readonly<Record<string, readonly string[]>> = {
  character: ['Appearance', 'Background', 'Notes'],
  place: ['Description', 'History', 'Notes'],
  faction: ['Description', 'Members', 'Notes'],
  item: ['Description', 'History', 'Notes'],
  lore: ['The tale', 'Who tells it', 'What is true'],
  creature: ['Description', 'Habits', 'What people say'],
  culture: ['Description', 'Customs', 'Language'],
};
const OTHER_HEADINGS: readonly string[] = ['Description', 'Notes'];

/** True for a note that is an entity: a markdown note inside the World folder. */
export function isEntityPath(path: string): boolean {
  return isInside(WORLD_FOLDER, path) && isMarkdownPath(path);
}

/**
 * The properties a new note of a type starts with: its type, then the type's
 * fields, each empty, then an empty list of other names.
 */
export function newEntityFrontmatter(type: EntityType): Frontmatter {
  const frontmatter: Frontmatter = { [TYPE_KEY]: type.id };
  for (const field of type.fields) frontmatter[field] = '';
  frontmatter[ALIASES_KEY] = [];
  return frontmatter;
}

/** The text a new note of a type starts with: a few empty headings. It is the writer's from then on. */
export function newEntityBody(type: EntityType): string {
  return (HEADINGS[type.id] ?? OTHER_HEADINGS).map((heading) => `## ${heading}\n\n`).join('');
}

/** A property's value as one line of text: a text, a number, or a list of them joined with commas. */
export function fieldText(value: unknown): string {
  if (typeof value === 'string') return value.replace(/\s+/g, ' ').trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (Array.isArray(value)) return value.map(fieldText).filter((item) => item !== '').join(', ');
  return '';
}

/** The other names of a note: its "aliases" property, as one name or a list of names. */
export function readAliases(frontmatter: Readonly<Frontmatter> | null): string[] {
  const raw: unknown = frontmatter?.[ALIASES_KEY];
  const list: unknown[] = typeof raw === 'string' ? [raw] : Array.isArray(raw) ? raw : [];
  const names: string[] = [];
  for (const item of list) {
    const name = typeof item === 'string' || typeof item === 'number' ? String(item).trim() : '';
    if (name !== '' && !names.includes(name)) names.push(name);
  }
  return names;
}

/** The type of a note: what its "type" property says, or else the type whose folder it is in. */
function typeOf(note: WorldNote, types: readonly EntityType[]): string | null {
  const said: unknown = note.frontmatter?.[TYPE_KEY];
  if (typeof said === 'string' && said.trim() !== '') {
    const key = typeKey(said);
    // What a writer typed by hand may be the type's name ("Character") as well as its id.
    return (findType(types, key) ?? types.find((type) => typeKey(type.name) === key))?.id ?? null;
  }
  const folder = note.path.split('/')[1];
  if (folder === undefined || note.path.split('/').length < 3) return null;
  return types.find((type) => clashKey(type.folder) === clashKey(folder))?.id ?? null;
}

/**
 * The entities among a project's notes: every markdown note in its World
 * folder, sorted by name.
 */
export function readEntities(notes: readonly WorldNote[], types: readonly EntityType[]): Entity[] {
  const entities: Entity[] = [];
  for (const note of notes) {
    if (!isEntityPath(note.path)) continue;
    entities.push({
      path: note.path,
      name: noteTitle(note.path),
      typeId: typeOf(note, types),
      summary: fieldText(note.frontmatter?.[SUMMARY_KEY]),
      aliases: readAliases(note.frontmatter),
      frontmatter: note.frontmatter,
    });
  }
  return entities.sort((a, b) => a.name.localeCompare(b.name) || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/** One property of an entity, for showing: its name and its value on one line. */
export interface EntityField {
  readonly name: string;
  readonly value: string;
}

/**
 * The properties of an entity that have something in them, for its details:
 * the fields of its type first, in the type's order, then whatever else the
 * writer added. The type, the other names, the summary, the picture and
 * the related entities are shown elsewhere and left out.
 */
export function entityFields(entity: Entity, type: EntityType | null): EntityField[] {
  const frontmatter = entity.frontmatter ?? {};
  const skip = new Set([TYPE_KEY, ALIASES_KEY, SUMMARY_KEY, IMAGE_KEY, RELATED_KEY]);
  const names = [...(type?.fields ?? []), ...Object.keys(frontmatter)];
  const fields: EntityField[] = [];
  const seen = new Set<string>();
  for (const name of names) {
    if (skip.has(name) || seen.has(name)) continue;
    seen.add(name);
    const value = fieldText(frontmatter[name]);
    if (value !== '') fields.push({ name, value });
  }
  return fields;
}

// ------------------------------------------------------------------ the sheet

/** The properties shown elsewhere on an entity's sheet, or not a text at all: never among its fields. */
const NOT_FIELDS: ReadonlySet<string> = new Set([TYPE_KEY, ALIASES_KEY, SUMMARY_KEY, ENTITIES_KEY, IMAGE_KEY, RELATED_KEY]);

/** One line of an entity's sheet: a property, what it holds, and whether it can be changed there. */
export interface SheetField {
  readonly name: string;
  /** What it holds, on one line; "" for nothing. */
  readonly value: string;
  /** False for what is not one text or one number (a list, say): that is changed in the note itself. */
  readonly editable: boolean;
}

/** Whether a property's value is one the sheet can change: nothing, a text or a number. */
function isPlain(value: unknown): boolean {
  return value === undefined || value === null || typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value));
}

/**
 * The lines of an entity's sheet: every field of its type, in the type's
 * order and also when it is empty (so that it can be filled in), then
 * whatever else the writer added to the note that holds something. The
 * type, the other names, the summary, the picture and the links have places
 * of their own and are left out.
 */
export function sheetFields(entity: Entity, type: EntityType | null): SheetField[] {
  const frontmatter = entity.frontmatter ?? {};
  const fields: SheetField[] = [];
  const seen = new Set<string>();
  for (const name of type?.fields ?? []) {
    if (NOT_FIELDS.has(name) || seen.has(name)) continue;
    seen.add(name);
    fields.push({ name, value: fieldText(frontmatter[name]), editable: isPlain(frontmatter[name]) });
  }
  for (const name of Object.keys(frontmatter)) {
    if (NOT_FIELDS.has(name) || seen.has(name)) continue;
    seen.add(name);
    const value = fieldText(frontmatter[name]);
    if (value !== '') fields.push({ name, value, editable: isPlain(frontmatter[name]) });
  }
  return fields;
}

/** What changing one property of a note came to. */
export type FieldChange = 'changed' | 'unchanged' | 'unreadable';

/**
 * Set one property of an entity note, in place, to what was typed on its
 * sheet. No other property is touched. Nothing changes when the property
 * already says that; a property that holds a list or anything else that is
 * not one text or number is left as it is ("unreadable"). What was a number
 * stays a number when what is typed is one.
 *
 * @param name  the property: a field of the type, the summary, or one the writer added
 * @param typed the new text; spaces around it are dropped, and "" empties the property
 */
export function setEntityField(frontmatter: Frontmatter, name: string, typed: string): FieldChange {
  if (name === TYPE_KEY || name === ALIASES_KEY || name === ENTITIES_KEY || name === IMAGE_KEY || name === RELATED_KEY) return 'unreadable';
  const current: unknown = frontmatter[name];
  if (!isPlain(current)) return 'unreadable';
  const text = typed.replace(/\s+/g, ' ').trim();
  if (fieldText(current) === text) return 'unchanged';
  frontmatter[name] = typeof current === 'number' && /^-?\d+(\.\d+)?$/.test(text) ? Number(text) : text;
  return 'changed';
}
