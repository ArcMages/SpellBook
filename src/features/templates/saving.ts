// Saving notes and projects as templates, and finding what can be saved.
//
// Everything is read from the notes themselves at the moment of saving and
// written through the project store, which only ever makes a new note in a
// Templates folder (or the vault's "Spellbook templates" folder) and never
// replaces one.

import { placeOfNote } from '../../core/binderModel';
import { sanitiseFileName } from '../../core/names';
import { isInside, noteTitle, parentPath, pathKey, relativeTo } from '../../core/paths';
import { WORLD_FOLDER } from '../../core/projectLayout';
import {
  SCENES_SUBFOLDER,
  WORLD_SUBFOLDER,
  partsOfBinder,
  projectTemplateNote,
  sceneTemplateOf,
  worldTemplateOf,
} from '../../core/templates';
import type { SceneFacts } from '../../core/templates';
import type { Frontmatter, ProjectSnapshot } from '../../core/types';
import { stripFrontmatter } from '../../core/wordCount';
import { ENTITY_TYPES_KEY, TYPE_KEY, findType, readEntityTypes } from '../../core/world';
import type { FeatureContext } from '../registry';

export const NO_PROJECT_TEXT = 'Open a Spellbook project first.';
export const READ_ONLY_TEXT = 'This project is read-only because its index could not be understood. Nothing was saved.';
export const NO_NAME_TEXT = 'Give the template a name.';
export const BAD_NAME_TEXT = 'That name has no characters that can be used in a file name.';
export const NO_TYPE_FOLDER_TEXT = 'This entry has no type, so it is not known which entries the template is for. Give it a type first.';
export const EMPTY_BINDER_TEXT = 'The binder of this project is empty: there is nothing to save as a template.';

/** What saving came to: the new template's place and name, or why it was not saved. */
export type Saved = { readonly path: string; readonly name: string } | { readonly problem: string };

/** The scene of the open project whose note is at a vault path, as a path relative to the project folder; null for any other note. */
export function sceneOf(project: ProjectSnapshot, vaultPath: string): string | null {
  if (project.readOnly) return null;
  const rel = relativeTo(project.folder, vaultPath);
  if (rel === null) return null;
  const place = placeOfNote(project, rel);
  return place === 'binder' || place === 'unfiled' ? rel : null;
}

/** The entry of the World of the open project whose note is at a vault path, as a path relative to the project folder; null for any other note. */
export function entryOf(project: ProjectSnapshot, vaultPath: string): string | null {
  if (project.readOnly) return null;
  const rel = relativeTo(project.folder, vaultPath);
  return rel !== null && isInside(WORLD_FOLDER, rel) ? rel : null;
}

/** A name typed for a template, made into a file name; or why it will not do. */
function templateName(typed: string): string | { problem: string } {
  if (typed.trim() === '') return { problem: NO_NAME_TEXT };
  const name = sanitiseFileName(typed, '');
  return name === '' ? { problem: BAD_NAME_TEXT } : name;
}

/** A note's properties and its text, read from the file as it is now. */
async function readNote(context: FeatureContext, rel: string): Promise<{ frontmatter: Frontmatter | null; body: string } | { problem: string }> {
  const vaultPath = context.store.vaultPathOf(rel);
  if (vaultPath === null) return { problem: `"${noteTitle(rel)}" is not in the project (it may still be syncing).` };
  try {
    const frontmatter = await context.vault.readFrontmatter(vaultPath);
    const body = stripFrontmatter(await context.vault.readText(vaultPath));
    return { frontmatter, body };
  } catch (error) {
    return { problem: `"${noteTitle(rel)}" could not be read: ${error instanceof Error ? error.message : String(error)}` };
  }
}

/** Save a scene of the open project as a scene template, in Templates/Scenes. */
export async function saveSceneTemplate(context: FeatureContext, scenePath: string, typed: string): Promise<Saved> {
  const project = context.store.project;
  if (!project) return { problem: NO_PROJECT_TEXT };
  if (project.readOnly) return { problem: READ_ONLY_TEXT };
  const name = templateName(typed);
  if (typeof name !== 'string') return name;
  const note = await readNote(context, scenePath);
  if ('problem' in note) return note;
  const template = sceneTemplateOf(note.frontmatter, note.body);
  const result = await context.store.createTemplateNote(SCENES_SUBFOLDER, name, template.frontmatter, template.body, project.indexPath);
  return result.status === 'done' ? { path: result.value.path, name } : { problem: result.message };
}

/**
 * The folder (inside World) of the type an entry belongs to: the folder of
 * the type its "type" property names, or else the folder it is in. Null
 * when neither says.
 */
export function typeFolderOf(context: FeatureContext, entryPath: string, frontmatter: Readonly<Frontmatter> | null): string | null {
  const types = readEntityTypes(context.store.projectData(ENTITY_TYPES_KEY));
  const named = frontmatter?.[TYPE_KEY];
  const type = typeof named === 'string' ? findType(types, named) : null;
  if (type) return type.folder;
  const folder = parentPath(entryPath);
  return folder !== WORLD_FOLDER && parentPath(folder) === WORLD_FOLDER ? folder.slice(WORLD_FOLDER.length + 1) : null;
}

/** Save an entry of the World of the open project as a template for its type, in Templates/World/<the type's folder>. */
export async function saveWorldTemplate(context: FeatureContext, entryPath: string, typed: string): Promise<Saved> {
  const project = context.store.project;
  if (!project) return { problem: NO_PROJECT_TEXT };
  if (project.readOnly) return { problem: READ_ONLY_TEXT };
  const name = templateName(typed);
  if (typeof name !== 'string') return name;
  const note = await readNote(context, entryPath);
  if ('problem' in note) return note;
  const folder = typeFolderOf(context, entryPath, note.frontmatter);
  if (folder === null) return { problem: NO_TYPE_FOLDER_TEXT };
  const template = worldTemplateOf(note.frontmatter, note.body);
  const result = await context.store.createTemplateNote(`${WORLD_SUBFOLDER}/${folder}`, name, template.frontmatter, template.body, project.indexPath);
  return result.status === 'done' ? { path: result.value.path, name } : { problem: result.message };
}

/** What the writer chose in the window that saves a project as a template. */
export interface ProjectTemplateChoice {
  readonly name: string;
  readonly description: string;
  /** True to keep the text of the scenes as well. */
  readonly includeText: boolean;
}

function textOf(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/**
 * Save the open project's binder as a project template, in the vault's
 * "Spellbook templates" folder: its folders, and each scene's title,
 * synopsis and label (and its text, when asked).
 */
export async function saveProjectTemplate(context: FeatureContext, choice: ProjectTemplateChoice): Promise<Saved> {
  const project = context.store.project;
  if (!project) return { problem: NO_PROJECT_TEXT };
  const name = templateName(choice.name);
  if (typeof name !== 'string') return name;
  if (project.tree.length === 0) return { problem: EMPTY_BINDER_TEXT };

  const indexed = new Map<string, Readonly<Frontmatter> | null>();
  for (const note of context.store.projectNotes()) indexed.set(pathKey(note.path), note.frontmatter);
  const texts = new Map<string, string>();
  const scenes: string[] = [];
  const walk = (nodes: ProjectSnapshot['tree']): void => {
    for (const node of nodes) {
      if (node.kind === 'folder') walk(node.children);
      else scenes.push(node.path);
    }
  };
  walk(project.tree);
  // Read from the notes themselves: what the vault has indexed may be a moment behind.
  for (const path of scenes) {
    const vaultPath = context.store.vaultPathOf(path);
    if (vaultPath === null) continue;
    try {
      const frontmatter = await context.vault.readFrontmatter(vaultPath);
      indexed.set(pathKey(path), frontmatter);
      if (choice.includeText) texts.set(pathKey(path), stripFrontmatter(await context.vault.readText(vaultPath)).trim());
    } catch {
      // A scene that cannot be read keeps what the vault has indexed, and no text.
    }
  }
  const facts = (path: string): SceneFacts => {
    const frontmatter = indexed.get(pathKey(path)) ?? null;
    return {
      synopsis: textOf(frontmatter?.['synopsis']),
      label: textOf(frontmatter?.['label']),
      text: choice.includeText ? (texts.get(pathKey(path)) ?? null) : null,
    };
  };
  const note = projectTemplateNote(choice.description, partsOfBinder(project.tree, facts));
  const result = await context.store.createLibraryTemplate(name, note.frontmatter, note.body);
  return result.status === 'done' ? { path: result.value.path, name } : { problem: result.message };
}
