// What the binder panel shows, worked out from the project snapshot. These
// are plain calculations (no screen, no vault), so they can be tested on
// their own; src/views/binderView.ts turns the results into rows.

import { locate, refOf, stepPlacement } from './binderTree';
import type { StepDirection } from './binderTree';
import { noteTitle, pathKey, relativeTo } from './paths';
import { RESEARCH_FOLDER } from './projectLayout';
import type { NoteKind } from './noteKind';
import type { NodeRef, Placement, ProjectSnapshot, TreeNode } from './types';

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

/**
 * The fold names of every folder the panel shows for a project: the binder's
 * folders and the sub-folders of Research. The three sections are not among
 * them. This is what "Collapse all" folds shut.
 */
export function folderFoldKeys(tree: readonly TreeNode[], research: readonly string[]): string[] {
  const keys: string[] = [];
  const binder = (nodes: readonly TreeNode[]): void => {
    for (const node of nodes) {
      if (node.kind !== 'folder') continue;
      keys.push(foldKey.folder(node.id));
      binder(node.children);
    }
  };
  binder(tree);
  const notes = (nodes: readonly ResearchNode[]): void => {
    for (const node of nodes) {
      if (node.kind !== 'folder') continue;
      keys.push(foldKey.research(node.path));
      notes(node.children);
    }
  };
  notes(researchTree(research));
  return keys;
}

// --------------------------------------------------------- rows and actions

/**
 * A name for a row, to find it again after the list was drawn anew: one per
 * note (by its path relative to the project) and one per binder folder (by
 * its id). Two spellings of the same accented or pointed name give one key.
 */
export function rowKey(ref: NodeRef): string {
  return ref.kind === 'scene' ? `scene:${pathKey(ref.path)}` : `folder:${ref.id}`;
}

/** The binder entry a reference points at, or null when the binder has none. */
export function findNode(tree: readonly TreeNode[], ref: NodeRef): TreeNode | null {
  const walk = (nodes: readonly TreeNode[]): TreeNode | null => {
    for (const node of nodes) {
      if (rowKey(refOf(node)) === rowKey(ref)) return node;
      if (node.kind !== 'folder') continue;
      const inner = walk(node.children);
      if (inner) return inner;
    }
    return null;
  };
  return walk(tree);
}

/** How a binder entry is called in a message: the scene's title or the folder's name. */
export function nodeTitle(node: TreeNode): string {
  return node.kind === 'scene' ? node.title : node.name;
}

/** How many scenes a binder entry stands for: one, or everything inside a folder. */
export function sceneCount(node: TreeNode): number {
  if (node.kind === 'scene') return 1;
  return node.children.reduce((sum, child) => sum + sceneCount(child), 0);
}

/** How many of the notes a binder entry stands for are whole chapters. */
export function chapterCount(node: TreeNode): number {
  if (node.kind === 'scene') return node.chapter === true ? 1 : 0;
  return node.children.reduce((sum, child) => sum + chapterCount(child), 0);
}

/**
 * Whether "Move up" (or "Move down") would move a binder entry. It would not
 * for the first (or last) entry of the top level, or for something that is
 * not in the binder.
 */
export function canStep(tree: readonly TreeNode[], ref: NodeRef, direction: StepDirection): boolean {
  return stepPlacement(tree, ref, direction) !== null;
}

const END_OF_BINDER: Placement = { at: 'end', parentId: null };

/** Whether a binder entry is a note that is a whole chapter. */
export function isChapterNode(node: TreeNode | null | undefined): boolean {
  return node?.kind === 'scene' && node.chapter === true;
}

/** The kind of a note of the binder by its path: chapter when it is marked so, scene otherwise. */
export function kindOfNote(tree: readonly TreeNode[], path: string): NoteKind {
  return isChapterNode(findNode(tree, { kind: 'scene', path })) ? 'chapter' : 'scene';
}

/**
 * What a new note at `placement` should be. Next to a note: the same as that
 * note, so that "New ... below" a scene inside a chapter folder makes another
 * scene. At the end of a folder: the same as the last note in it. Otherwise
 * (an empty folder, the top level): what the project usually writes in.
 */
export function kindForNewNote(tree: readonly TreeNode[], placement: Placement, usual: NoteKind): NoteKind {
  if (placement.at === 'before' || placement.at === 'after') {
    const sibling = findNode(tree, placement.sibling);
    if (sibling?.kind === 'scene') return sibling.chapter === true ? 'chapter' : 'scene';
    return usual;
  }
  if (placement.parentId === null) return usual;
  const folder = findNode(tree, { kind: 'folder', id: placement.parentId });
  if (folder?.kind !== 'folder') return usual;
  const notes = folder.children.filter((child) => child.kind === 'scene');
  const last = notes[notes.length - 1];
  return last === undefined ? usual : last.chapter === true ? 'chapter' : 'scene';
}

/**
 * Where a new scene goes: inside the chosen folder (at its end), straight
 * below the chosen scene, or at the end of the binder when nothing in the
 * binder is chosen.
 */
export function placementForNewScene(tree: readonly TreeNode[], chosen: NodeRef | null): Placement {
  const node = chosen ? findNode(tree, chosen) : null;
  if (!node) return END_OF_BINDER;
  if (node.kind === 'folder') return { at: 'end', parentId: node.id };
  return { at: 'after', sibling: refOf(node) };
}

/**
 * Where a new folder goes: straight below the chosen entry, at the same
 * level, or at the end of the binder when nothing in the binder is chosen.
 */
export function placementForNewFolder(tree: readonly TreeNode[], chosen: NodeRef | null): Placement {
  const node = chosen ? findNode(tree, chosen) : null;
  return node ? { at: 'after', sibling: refOf(node) } : END_OF_BINDER;
}

/** Shown for the top level of the binder in the list of "Move to folder". */
export const TOP_LEVEL_LABEL = 'Top level';

/** One place a binder entry can be moved to. */
export interface FolderChoice {
  /** The folder's id; null for the top level of the binder. */
  readonly parentId: string | null;
  /** The folder's name, with the names of the folders around it in front: "Part one / Chapter 2". */
  readonly label: string;
}

/**
 * The places "Move to folder" offers for a binder entry: the top level, then
 * every folder in binder order. A folder is never offered itself, nor
 * anything inside it. The place the entry is already in is offered like any
 * other: picking it sends the entry to the end of that place. Empty when the
 * entry is not in the binder.
 */
export function folderChoices(tree: readonly TreeNode[], moving: NodeRef): FolderChoice[] {
  if (!locate(tree, moving)) return [];
  const choices: FolderChoice[] = [{ parentId: null, label: TOP_LEVEL_LABEL }];
  const walk = (nodes: readonly TreeNode[], trail: readonly string[]): void => {
    for (const node of nodes) {
      if (node.kind !== 'folder') continue;
      if (moving.kind === 'folder' && node.id === moving.id) continue;
      const names = [...trail, node.name];
      choices.push({ parentId: node.id, label: names.join(' / ') });
      walk(node.children, names);
    }
  };
  walk(tree, []);
  return choices;
}

/**
 * The project a file belongs to: the one whose folder is around it. When
 * projects sit inside one another (one at the top of the vault, say), the
 * innermost wins. Null when no project's folder holds the file.
 *
 * @param path a vault path
 */
export function owningProject<T extends { readonly folder: string }>(projects: readonly T[], path: string): T | null {
  let best: T | null = null;
  for (const project of projects) {
    // A project at the top of the vault has "" as its folder, which holds everything.
    const inside = project.folder === '' ? path !== '' : relativeTo(project.folder, path) !== null;
    if (inside && (best === null || project.folder.length > best.folder.length)) best = project;
  }
  return best;
}

/** Where a note of the open project is shown in the panel, if anywhere. */
export type RowPlace = 'binder' | 'unfiled' | 'research';

/**
 * In which part of the panel a note has a row.
 *
 * @param path the note's path relative to the project folder
 */
export function placeOfNote(
  project: Pick<ProjectSnapshot, 'tree' | 'unfiled' | 'research'>,
  path: string,
): RowPlace | null {
  const key = pathKey(path);
  if (findNode(project.tree, { kind: 'scene', path })) return 'binder';
  if (project.unfiled.some((other) => pathKey(other) === key)) return 'unfiled';
  if (project.research.some((other) => pathKey(other) === key)) return 'research';
  return null;
}
