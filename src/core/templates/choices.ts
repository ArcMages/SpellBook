// The list of starting structures "Create project" shows: the built-in ones,
// then the project templates found in the vault's "Spellbook templates"
// folder.

import { noteTitle, parentPath } from '../paths';
import type { Frontmatter } from '../types';
import { LIBRARY_FOLDER } from './places';
import { readProjectTemplate } from './projectTemplate';
import { STRUCTURES, describeSize, outlineOf } from './structures';
import type { OutlineLine, StructurePart } from './structures';

/** What starts the id of a choice that is a project template of the vault. The note's vault path follows. */
export const LIBRARY_CHOICE_PREFIX = 'library:';

/** One starting structure, as the window that creates a project shows it. */
export interface StartChoice {
  /** A built-in structure's id, or LIBRARY_CHOICE_PREFIX and the vault path of a project template. */
  readonly id: string;
  readonly name: string;
  readonly description: string;
  /** True when the window should ask how many chapters. */
  readonly asksForChapters: boolean;
  /** Its folders and scenes, for the given number of chapters. */
  parts(chapters: number): readonly StructurePart[];
}

/** A note of the vault's template folder, with its properties as last indexed. */
export interface LibraryNote {
  /** Vault path. */
  readonly path: string;
  readonly frontmatter: Readonly<Frontmatter> | null;
}

/** The project templates among the notes of the vault's template folder (directly inside it), by name. */
export function libraryChoices(notes: readonly LibraryNote[]): StartChoice[] {
  const choices: StartChoice[] = [];
  for (const note of notes) {
    if (parentPath(note.path) !== LIBRARY_FOLDER) continue;
    const template = readProjectTemplate(note.frontmatter);
    if (template === null) continue;
    const parts = template.parts;
    choices.push({
      id: `${LIBRARY_CHOICE_PREFIX}${note.path}`,
      name: noteTitle(note.path),
      description: template.description === '' ? 'A project template of your own.' : template.description,
      asksForChapters: false,
      parts: () => parts,
    });
  }
  return choices.sort((a, b) => a.name.localeCompare(b.name));
}

/** Every starting structure: the built-in ones first, in their order, then the vault's project templates. */
export function projectChoices(notes: readonly LibraryNote[]): StartChoice[] {
  return [...STRUCTURES, ...libraryChoices(notes)];
}

/** The vault path of the project template a choice stands for, or null for a built-in structure. */
export function libraryPathOf(choiceId: string): string | null {
  return choiceId.startsWith(LIBRARY_CHOICE_PREFIX) ? choiceId.slice(LIBRARY_CHOICE_PREFIX.length) : null;
}

/** The lines and the size a choice shows under it. */
export function previewOf(choice: StartChoice, chapters: number): { lines: OutlineLine[]; size: string } {
  const parts = choice.parts(chapters);
  return { lines: outlineOf(parts), size: describeSize(parts) };
}
