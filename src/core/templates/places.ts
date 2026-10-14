// Where templates are kept.
//
//   <Project>/Templates/Scenes/<name>.md          what a new scene can start with
//   <Project>/Templates/World/<Type folder>/<name>.md
//                                                 what a new character, place ... can start with
//   Spellbook templates/<name>.md                 (at the top of the vault) project templates,
//                                                 so that one project can start another
//
// None of these folders is part of a new project: each is made the first
// time a template is saved there. A note in them is not a scene, not an
// entity of the world, not an event, and its words are not counted.

import { isInside, isMarkdownPath, parentPath } from '../paths';

/** The folder of a project that holds its templates. */
export const TEMPLATES_FOLDER = 'Templates';

/** The kind of template a project's Templates folder holds in "Scenes". */
export const SCENES_SUBFOLDER = 'Scenes';

/** The kind of template a project's Templates folder holds in "World". */
export const WORLD_SUBFOLDER = 'World';

/** The folder of scene templates, relative to the project folder. */
export const SCENE_TEMPLATES_FOLDER = `${TEMPLATES_FOLDER}/${SCENES_SUBFOLDER}`;

/** The folder that holds a folder of templates for each type of world entry, relative to the project folder. */
export const WORLD_TEMPLATES_FOLDER = `${TEMPLATES_FOLDER}/${WORLD_SUBFOLDER}`;

/** The folder at the top of the vault that holds project templates. */
export const LIBRARY_FOLDER = 'Spellbook templates';

/** True for a path (relative to a project folder) inside the project's Templates folder, or the folder itself. */
export function isTemplatePath(rel: string): boolean {
  return rel === TEMPLATES_FOLDER || isInside(TEMPLATES_FOLDER, rel);
}

/** True for a vault path inside the vault's folder of project templates, or the folder itself. */
export function isLibraryPath(vaultPath: string): boolean {
  return vaultPath === LIBRARY_FOLDER || isInside(LIBRARY_FOLDER, vaultPath);
}

/** True for a scene template: a note directly inside Templates/Scenes. */
export function isSceneTemplatePath(rel: string): boolean {
  return isMarkdownPath(rel) && parentPath(rel) === SCENE_TEMPLATES_FOLDER;
}

/**
 * The folder of a world template (its type's folder name, "Characters"), or
 * null when the path is not a note directly inside a folder of Templates/World.
 */
export function worldTemplateFolderOf(rel: string): string | null {
  if (!isMarkdownPath(rel)) return null;
  const folder = parentPath(rel);
  if (parentPath(folder) !== WORLD_TEMPLATES_FOLDER) return null;
  return folder.slice(WORLD_TEMPLATES_FOLDER.length + 1);
}

/** The folder the templates of a type of world entry are kept in, relative to the project folder. */
export function worldTemplatesFolder(typeFolder: string): string {
  return `${WORLD_TEMPLATES_FOLDER}/${typeFolder}`;
}
