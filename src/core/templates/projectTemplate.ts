// Project templates: the shape of one project saved so that it can start
// another. A project template is a note in the vault's "Spellbook templates"
// folder. Its properties hold the binder's folders and scenes, in order: each
// scene's title and synopsis (and its label), and, when the writer asked for
// it, its text. Its own text is a readable outline of the same, for the
// writer; only the properties are read back.
//
//   spellbook-template: project
//   description: Saved from "My Novel"
//   structure:
//     - folder: Part one
//       children:
//         - title: Opening
//           synopsis: The lighthouse at night.
//
// The scenes of a project made from it start as "To do".

import { tidyDisplayName } from '../names';
import type { Frontmatter, TreeNode } from '../types';
import { isStructureFolder } from './structures';
import type { StructurePart, StructureScene } from './structures';
import { TEMPLATE_MARKER_KEY } from './templateNote';

/** What the marker property says on a project template. */
export const PROJECT_TEMPLATE_KIND = 'project';

/** The property that holds a project template's folders and scenes. */
export const STRUCTURE_KEY = 'structure';

/** The property that holds a project template's one-line description. */
export const DESCRIPTION_KEY = 'description';

/** How deep folders may sit in a project template, and how many scenes it may hold: more is not read. */
const MAX_DEPTH = 12;
const MAX_SCENES = 5000;

/** What is known of each scene when a project is saved as a template. */
export interface SceneFacts {
  readonly synopsis: string;
  readonly label: string;
  /** The scene's text, without its properties; null to leave it out. */
  readonly text: string | null;
}

/** True for the properties of a project template note. */
export function isProjectTemplate(frontmatter: Readonly<Frontmatter> | null): boolean {
  return frontmatter !== null && frontmatter[TEMPLATE_MARKER_KEY] === PROJECT_TEMPLATE_KIND;
}

/**
 * The parts of a project template made from a binder: its folders and its
 * scenes, in order, each scene with its title and what `facts` knows of it.
 */
export function partsOfBinder(tree: readonly TreeNode[], facts: (path: string) => SceneFacts): StructurePart[] {
  return tree.map((node): StructurePart => {
    if (node.kind === 'folder') return { folder: node.name, children: partsOfBinder(node.children, facts) };
    const known = facts(node.path);
    const scene: { -readonly [K in keyof StructureScene]: StructureScene[K] } = { title: node.title, synopsis: known.synopsis };
    if (known.label !== '') scene.label = known.label;
    if (known.text !== null && known.text !== '') scene.text = known.text;
    return scene;
  });
}

function partsToData(parts: readonly StructurePart[]): unknown[] {
  return parts.map((part) => {
    if (isStructureFolder(part)) return { folder: part.folder, children: partsToData(part.children) };
    const data: Record<string, unknown> = { title: part.title, synopsis: part.synopsis };
    if (part.label !== undefined && part.label !== '') data['label'] = part.label;
    if (part.text !== undefined && part.text !== '') data['text'] = part.text;
    return data;
  });
}

function outlineText(parts: readonly StructurePart[], depth = 0): string {
  let text = '';
  for (const part of parts) {
    const indent = '  '.repeat(depth);
    if (isStructureFolder(part)) {
      text += `${indent}- **${part.folder}**\n${outlineText(part.children, depth + 1)}`;
    } else {
      // One line each: a synopsis that runs over several lines is joined up.
      const synopsis = part.synopsis.replace(/\s+/g, ' ').trim();
      text += `${indent}- ${part.title}${synopsis === '' ? '' : `: ${synopsis}`}\n`;
    }
  }
  return text;
}

/**
 * The properties and the text of a project template note.
 *
 * @param description one line that says what the template is
 * @param parts       the folders and scenes, as partsOfBinder gives them
 */
export function projectTemplateNote(description: string, parts: readonly StructurePart[]): { frontmatter: Frontmatter; body: string } {
  const frontmatter: Frontmatter = {
    [TEMPLATE_MARKER_KEY]: PROJECT_TEMPLATE_KIND,
    [DESCRIPTION_KEY]: tidyDisplayName(description),
    [STRUCTURE_KEY]: partsToData(parts),
  };
  const body =
    'This is a Spellbook project template. "Create project" offers it as a starting structure.\n' +
    'The folders and scenes are kept in the properties above; this outline is only for reading.\n\n' +
    outlineText(parts);
  return { frontmatter, body };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function textOf(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
}

/**
 * The folders and scenes a project template note holds, or null when it is
 * not a project template or holds none. What cannot be understood is left
 * out, never guessed at: an entry with no title, a folder with no name.
 */
export function readProjectTemplate(frontmatter: Readonly<Frontmatter> | null): { description: string; parts: StructurePart[] } | null {
  if (frontmatter === null || !isProjectTemplate(frontmatter)) return null;
  let scenes = 0;
  const read = (raw: unknown, depth: number): StructurePart[] => {
    if (!Array.isArray(raw) || depth > MAX_DEPTH) return [];
    const parts: StructurePart[] = [];
    for (const item of raw) {
      if (scenes >= MAX_SCENES) break;
      if (!isRecord(item)) continue;
      if ('folder' in item) {
        const name = tidyDisplayName(textOf(item['folder']));
        if (name !== '') parts.push({ folder: name, children: read(item['children'], depth + 1) });
        continue;
      }
      const title = tidyDisplayName(textOf(item['title']));
      if (title === '') continue;
      scenes++;
      const scene: { -readonly [K in keyof StructureScene]: StructureScene[K] } = { title, synopsis: textOf(item['synopsis']) };
      const label = tidyDisplayName(textOf(item['label']));
      if (label !== '') scene.label = label;
      const text = textOf(item['text']);
      if (text !== '') scene.text = text;
      parts.push(scene);
    }
    return parts;
  };
  const parts = read(frontmatter[STRUCTURE_KEY], 0);
  if (parts.length === 0) return null;
  return { description: tidyDisplayName(textOf(frontmatter[DESCRIPTION_KEY])), parts };
}
