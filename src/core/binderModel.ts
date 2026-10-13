// What the binder panel shows, worked out from the project snapshot. These
// are plain calculations (no screen, no vault), so they can be tested on
// their own; src/views/binderView.ts turns the results into rows.

import { noteTitle, relativeTo } from './paths';
import { RESEARCH_FOLDER } from './projectLayout';
import type { TreeNode } from './types';

// ------------------------------------------------------------------ research

/** One row of the Research section: a sub-folder or a note. */
export type ResearchNode =
  | {
      readonly kind: 'folder';
      /** Path relative to the project folder, for example "Research/Maps". */
      readonly path: string;
      readonly name: string;
      readonly children: readonly ResearchNode[];
    }
  | {
      readonly kind: 'note';
      /** Path relative to the project folder. */
      readonly path: string;
      /** File name without ".md". */
      readonly title: string;
    };

/**
 * Alphabetical order for names in any language: capitals and accents do not
 * matter, and numbers go by value ("Scene 2" before "Scene 10").
 */
export function compareNames(a: string, b: string): number {
  const byName = a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
  if (byName !== 0) return byName;
  return a < b ? -1 : a > b ? 1 : 0;
}

interface FolderDraft {
  readonly path: string;
  readonly name: string;
  readonly folders: Map<string, FolderDraft>;
  readonly notes: Array<{ path: string; title: string }>;
}

/**
 * Arrange the notes of the Research folder as a tree: in each folder the
 * sub-folders first, then the notes, both in alphabetical order.
 *
 * @param paths note paths relative to the project folder, as in the snapshot
 */
export function researchTree(paths: readonly string[], root: string = RESEARCH_FOLDER): ResearchNode[] {
  const top: FolderDraft = { path: root, name: root, folders: new Map(), notes: [] };
  for (const path of paths) {
    const inside = relativeTo(root, path);
    if (inside === null) continue;
    const steps = inside.split('/');
    steps.pop(); // the note's own file name
    let folder = top;
    for (const step of steps) {
      let next = folder.folders.get(step);
      if (!next) {
        next = { path: `${folder.path}/${step}`, name: step, folders: new Map(), notes: [] };
        folder.folders.set(step, next);
      }
      folder = next;
    }
    folder.notes.push({ path, title: noteTitle(path) });
  }

  const finish = (folder: FolderDraft): ResearchNode[] => [
    ...[...folder.folders.values()]
      .sort((a, b) => compareNames(a.name, b.name))
      .map((sub): ResearchNode => ({ kind: 'folder', path: sub.path, name: sub.name, children: finish(sub) })),
    ...folder.notes
      .sort((a, b) => compareNames(a.title, b.title))
      .map((note): ResearchNode => ({ kind: 'note', path: note.path, title: note.title })),
  ];
  return finish(top);
}

// --------------------------------------------------------------- word counts

/**
 * Looks up the words in a scene by its path relative to the project: a
 * number, null when the note cannot be read, undefined while it is still
 * being counted.
 */
export type CountLookup = (path: string) => number | null | undefined;

export interface BinderTotals {
  /**
   * The words in each binder folder (everything inside it), by folder id.
   * Null while one of its scenes is still being counted, so that a half-made
   * sum is never shown as if it were the total.
   */
  readonly folders: ReadonlyMap<string, number | null>;
  /** The words in the whole binder; null while it is still being counted. */
  readonly manuscript: number | null;
}

/**
 * Add up the scenes of each folder and of the whole binder. A scene whose
 * note is missing or cannot be read adds nothing.
 */
export function binderTotals(tree: readonly TreeNode[], countOf: CountLookup): BinderTotals {
  const folders = new Map<string, number | null>();
  const sum = (nodes: readonly TreeNode[]): number | null => {
    let total: number | null = 0;
    for (const node of nodes) {
      let words: number | null;
      if (node.kind === 'folder') {
        words = sum(node.children);
        folders.set(node.id, words);
      } else if (node.missing) {
        words = 0;
      } else {
        const counted = countOf(node.path);
        words = counted === undefined ? null : (counted ?? 0);
      }
      total = total === null || words === null ? null : total + words;
    }
    return total;
  };
  const manuscript = sum(tree);
  return { folders, manuscript };
}

/** The scenes of the binder that have a note, in manuscript order, as paths relative to the project. */
export function scenesWithNotes(tree: readonly TreeNode[]): string[] {
  const out: string[] = [];
  const walk = (nodes: readonly TreeNode[]): void => {
    for (const node of nodes) {
      if (node.kind === 'folder') walk(node.children);
      else if (!node.missing) out.push(node.path);
    }
  };
  walk(tree);
  return out;
}

/** A word count as shown in a row: whole, with commas between the thousands ("12,345"). */
export function formatCount(count: number): string {
  const whole = Math.max(0, Math.round(count));
  return String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** A word count said in full, for screen readers: "1 word", "12,345 words". */
export function describeCount(count: number): string {
  const whole = Math.max(0, Math.round(count));
  return `${formatCount(whole)} ${whole === 1 ? 'word' : 'words'}`;
}

// -------------------------------------------------------------- narrow panes

/** Below this width (in CSS pixels) the panel drops its word counts to leave room for titles. */
export const NARROW_BELOW = 220;
/** Above this width the word counts come back. The gap keeps the layout from flickering at the edge. */
export const WIDE_FROM = 240;

/**
 * Whether the panel should use its narrow layout, going by its measured
 * width. A width of zero means the panel is hidden: keep what it was.
 */
export function isNarrowPane(width: number, wasNarrow: boolean): boolean {
  if (!(width > 0)) return wasNarrow;
  return wasNarrow ? width < WIDE_FROM : width < NARROW_BELOW;
}

// ------------------------------------------------------------- folded items

/** The names under which the view remembers what is folded shut (see DevicePrefs). */
export const foldKey = {
  section: (name: 'manuscript' | 'unfiled' | 'research'): string => `section:${name}`,
  folder: (id: string): string => `folder:${id}`,
  research: (path: string): string => `research:${path}`,
};
