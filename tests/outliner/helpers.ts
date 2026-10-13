// Shared pieces for the tests of the outliner engine.

import { readTagLists } from '../../src/core/cards';
import type { CardLists } from '../../src/core/cards';
import { buildOutline } from '../../src/core/outliner';
import type { FolderRow, Outline, OutlineInput, OutlineRow, SceneFacts, SceneFactsLookup, SceneRow } from '../../src/core/outliner';
import type { TreeNode } from '../../src/core/types';

// Hebrew used across the tests. Written once here so every file tests the same words.
export const HEBREW = {
  /** "Opening" */
  opening: 'פתיחה',
  /** "The letter" */
  letter: 'המכתב',
  /** "Daniel" */
  daniel: 'דניאל',
  /** "Final" */
  final: 'סופי',
  /** "Father" and "house": the first two letters of the alphabet, in order. */
  father: 'אבא',
  house: 'בית',
  /** A synopsis: "Anna finds the letter in the drawer." */
  synopsis: 'אנה מוצאת את המכתב במגירה.',
} as const;

/** The path of a scene by its name: "Opening" is Manuscript/Opening.md. */
export function pathOf(name: string): string {
  return `Manuscript/${name}.md`;
}

export function scene(name: string, missing = false): TreeNode {
  return { kind: 'scene', path: pathOf(name), title: name, missing };
}

export function folder(id: string, name: string, children: TreeNode[]): TreeNode {
  return { kind: 'folder', id, name, children };
}

/** The lists of a project that names its own statuses and labels, one of each in Hebrew. */
export function sampleLists(): CardLists {
  return readTagLists({
    statuses: [
      { name: 'To do', color: 'red' },
      { name: 'First draft', color: 'orange' },
      { name: HEBREW.final, color: 'green' },
    ],
    labels: [
      { name: 'Anna', color: 'purple' },
      { name: HEBREW.daniel, color: 'cyan' },
    ],
  });
}

/** Looks scenes up by their name. The same object is handed out every time, as the plugin does. */
export function lookup(facts: Record<string, SceneFacts>): SceneFactsLookup {
  const byPath = new Map(Object.entries(facts).map(([name, known]) => [pathOf(name), known]));
  return (path) => byPath.get(path);
}

/**
 * A small novel: a scene with everything set, a folder with a scene and a
 * folder inside it, an entry whose note is missing, and a scene that is
 * still being counted.
 *
 *   Opening
 *   Part one        [f-one]
 *     Letter
 *     Inner         [f-inner]
 *       Night
 *   Ghost           (missing)
 *   Closing
 */
export function novelTree(): TreeNode[] {
  return [
    scene('Opening'),
    folder('f-one', 'Part one', [scene('Letter'), folder('f-inner', 'Inner', [scene('Night')])]),
    scene('Ghost', true),
    scene('Closing'),
  ];
}

export function novelFacts(): Record<string, SceneFacts> {
  return {
    Opening: {
      frontmatter: {
        synopsis: 'Anna arrives in the old town.',
        status: 'To do',
        label: 'Anna',
        target: 1000,
        compile: true,
        created: '2026-10-01',
        edited: '2026-10-13',
        tags: ['draft', 'act-one'],
        pov: 'Anna',
        order: 1024,
      },
      words: 500,
      tasks: { done: 1, total: 3 },
    },
    Letter: { frontmatter: { status: 'first DRAFT', target: 400, pov: 'Daniel' }, words: 600, tasks: { done: 0, total: 0 } },
    Night: { frontmatter: { status: HEBREW.final, label: HEBREW.daniel, synopsis: HEBREW.synopsis }, words: 250, tasks: { done: 2, total: 2 } },
    Closing: { frontmatter: { status: 'Sent off', compile: false } },
  };
}

/** The outline of the small novel, with whatever is asked for on top. */
export function novelOutline(extra: Partial<OutlineInput> = {}, facts: Record<string, SceneFacts> = novelFacts()): Outline {
  return buildOutline({ tree: novelTree(), sceneOf: lookup(facts), lists: sampleLists(), ...extra });
}

/** The rows as a reader sees them, top to bottom: each by its key. */
export function keys(rows: readonly OutlineRow[]): string[] {
  return rows.map((row) => row.key);
}

/** The titles of the scene rows, top to bottom. */
export function titles(rows: readonly OutlineRow[]): string[] {
  return rows.flatMap((row) => (row.kind === 'scene' ? [row.title] : []));
}

export function sceneNamed(outline: Outline, name: string): SceneRow {
  const found = outline.scenes.find((row) => row.title === name);
  if (!found) throw new Error(`no scene "${name}"`);
  return found;
}

export function folderWithId(outline: Outline, id: string): FolderRow {
  const found = outline.rows.find((row): row is FolderRow => row.kind === 'folder' && row.id === id);
  if (!found) throw new Error(`no folder row "${id}"`);
  return found;
}
