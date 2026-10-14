// Templates for scenes and for entries of the world: plain notes whose
// properties and text a new scene or entry starts with.
//
// What is taken from a template, and what is not:
//   - a scene gets every property of the template except the ones the plugin
//     keeps for each scene itself (its place in the order, the day it was
//     made, the day it was last changed);
//   - an entry of the world keeps the type it is made as, and gets the
//     template's other properties on top of the fields of its type;
//   - nothing ever takes a property that would mark it as a project or as a
//     project template.
// The placeholders ({{title}}, {{date}}, {{project}}) are filled in, in the
// text and in the properties.
//
// Saving a note as a template goes the other way: what belongs to that one
// scene or entry alone (its place in the story's time, who is in it, its
// other names, its picture) is left out, so that the template is a starting
// point and not a copy.

import { clashKey, isMarkdownPath, noteTitle, parentPath } from '../paths';
import type { Frontmatter } from '../types';
import { ALIASES_KEY, DATE_KEY, END_KEY, ENTITIES_KEY, IMAGE_KEY, MOMENTS_KEY, RELATED_KEY, TYPE_KEY } from '../world/types';
import { SCENE_TEMPLATES_FOLDER, worldTemplateFolderOf } from './places';
import { fillPlaceholders, fillValue } from './placeholders';
import type { PlaceholderValues } from './placeholders';

/** A template's properties and text, as read from its note. */
export interface TemplateText {
  readonly frontmatter: Readonly<Frontmatter>;
  readonly body: string;
}

/** What a new note starts with, made from a template. */
export interface NoteStart {
  readonly frontmatter: Frontmatter;
  readonly body: string;
}

/** The property that marks a project template note in the vault's template folder. */
export const TEMPLATE_MARKER_KEY = 'spellbook-template';

/** Properties no note made from a template ever takes: they would mark it as a project or a template. */
const NEVER_TAKEN: readonly string[] = ['spellbook', TEMPLATE_MARKER_KEY];

/** The properties of a scene that the plugin keeps for each scene itself: never taken from a template. */
export const SCENE_OWN_KEYS: readonly string[] = ['order', 'created', 'edited'];

/** What a scene saved as a template leaves out: the plugin's own properties, and what belongs to that scene alone. */
const SCENE_NOT_SAVED: readonly string[] = [...NEVER_TAKEN, ...SCENE_OWN_KEYS, DATE_KEY, ENTITIES_KEY];

/** What an entry saved as a template leaves out: what belongs to that one entry alone. */
const ENTITY_NOT_SAVED: readonly string[] = [...NEVER_TAKEN, ALIASES_KEY, IMAGE_KEY, RELATED_KEY, DATE_KEY, END_KEY, MOMENTS_KEY];

function isOneOf(key: string, keys: readonly string[]): boolean {
  const wanted = key.trim().toLowerCase();
  return keys.some((other) => other === wanted);
}

/** The properties of a template, without the ones in `left`, with placeholders filled in. */
function takenProperties(frontmatter: Readonly<Frontmatter>, left: readonly string[], values: PlaceholderValues): Frontmatter {
  const taken: Frontmatter = {};
  for (const [key, value] of Object.entries(frontmatter)) {
    if (isOneOf(key, left)) continue;
    taken[key] = fillValue(value, values);
  }
  return taken;
}

/**
 * What a new scene starts with when it is made from a template: the
 * template's properties (but for the plugin's own) and its text, with the
 * placeholders filled in. The plugin adds the scene's own properties.
 */
export function sceneStart(template: TemplateText, values: PlaceholderValues): NoteStart {
  return {
    frontmatter: takenProperties(template.frontmatter, [...NEVER_TAKEN, ...SCENE_OWN_KEYS], values),
    body: fillPlaceholders(template.body, values),
  };
}

/**
 * What a new entry of the world starts with when it is made from a template.
 *
 * @param base what an entry of its type starts with anyway (its type, the type's fields, an empty list of other names)
 */
export function entityStart(base: Readonly<Frontmatter>, template: TemplateText, values: PlaceholderValues): NoteStart {
  const frontmatter: Frontmatter = { ...base };
  const taken = takenProperties(template.frontmatter, [...NEVER_TAKEN, TYPE_KEY], values);
  for (const [key, value] of Object.entries(taken)) frontmatter[key] = value;
  return { frontmatter, body: fillPlaceholders(template.body, values) };
}

/** What a scene saved as a template keeps: its properties without what belongs to it alone, and its text. */
export function sceneTemplateOf(frontmatter: Readonly<Frontmatter> | null, body: string): TemplateText {
  const kept: Frontmatter = {};
  for (const [key, value] of Object.entries(frontmatter ?? {})) {
    if (!isOneOf(key, SCENE_NOT_SAVED)) kept[key] = value;
  }
  return { frontmatter: kept, body };
}

/** What an entry of the world saved as a template keeps: its type and fields, and its text, without what belongs to it alone. */
export function worldTemplateOf(frontmatter: Readonly<Frontmatter> | null, body: string): TemplateText {
  const kept: Frontmatter = {};
  for (const [key, value] of Object.entries(frontmatter ?? {})) {
    if (!isOneOf(key, ENTITY_NOT_SAVED)) kept[key] = value;
  }
  return { frontmatter: kept, body };
}

// ----------------------------------------------------------------- listing

/** A template note of the open project. */
export interface TemplateEntry {
  /** The note's path relative to the project folder. */
  readonly path: string;
  /** What it is called: its file name without ".md". */
  readonly name: string;
}

function byName(a: TemplateEntry, b: TemplateEntry): number {
  const order = a.name.localeCompare(b.name);
  if (order !== 0) return order;
  return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
}

/** The scene templates among the notes of a project (paths relative to the project folder), by name. */
export function sceneTemplates(notes: ReadonlyArray<{ readonly path: string }>): TemplateEntry[] {
  return notes
    .filter((note) => isMarkdownPath(note.path) && parentPath(note.path) === SCENE_TEMPLATES_FOLDER)
    .map((note) => ({ path: note.path, name: noteTitle(note.path) }))
    .sort(byName);
}

/** What a type of world entry is known by, to find its templates. */
export interface TemplateType {
  readonly id: string;
  readonly name: string;
  /** The folder its entries are kept in inside World, for example "Characters". */
  readonly folder: string;
}

/**
 * The templates of a type of world entry among the notes of a project, by
 * name: the notes in Templates/World/<folder>, where the folder is named
 * after the type's folder ("Characters"), its name ("Character") or its id.
 */
export function worldTemplates(notes: ReadonlyArray<{ readonly path: string }>, type: TemplateType): TemplateEntry[] {
  const names = new Set([type.folder, type.name, type.id].map((name) => clashKey(name)));
  return notes
    .filter((note) => {
      const folder = worldTemplateFolderOf(note.path);
      return folder !== null && names.has(clashKey(folder));
    })
    .map((note) => ({ path: note.path, name: noteTitle(note.path) }))
    .sort(byName);
}

/** Every world template among the notes of a project, with the folder (type) it is for, by folder and name. */
export function allWorldTemplates(notes: ReadonlyArray<{ readonly path: string }>): Array<TemplateEntry & { readonly folder: string }> {
  const found: Array<TemplateEntry & { readonly folder: string }> = [];
  for (const note of notes) {
    const folder = worldTemplateFolderOf(note.path);
    if (folder !== null) found.push({ path: note.path, name: noteTitle(note.path), folder });
  }
  return found.sort((a, b) => a.folder.localeCompare(b.folder) || byName(a, b));
}
