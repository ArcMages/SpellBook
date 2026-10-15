// What the corkboard shows: the cards of the whole manuscript, or of one
// binder folder, in binder order.
//
// A scene is a scene card. A folder is one folder card that stands for
// everything inside it and opens that folder as the next board. The board
// follows the binder tree exactly, so moving a card is moving a binder row.

import { MANUSCRIPT_FOLDER, binderTotals } from './coreImports';
import type { Frontmatter, TreeNode } from './coreImports';
import { buildSceneCard } from './card';
import type { CardLists, SceneCard } from './card';
import { PREVIEW_LENGTH } from './preview';

/** Which part of the binder a board shows: the whole manuscript, or one folder. */
export type BoardScope =
  | { readonly kind: 'manuscript' }
  | { readonly kind: 'folder'; readonly id: string };

/** The scope of the top-level board: the whole manuscript. */
export const MANUSCRIPT_SCOPE: BoardScope = { kind: 'manuscript' };

/** The scope that shows one binder folder, by the folder's id. */
export function folderScope(id: string): BoardScope {
  return { kind: 'folder', id };
}

/** True when two scopes show the same board. */
export function sameScope(a: BoardScope, b: BoardScope): boolean {
  if (a.kind === 'manuscript') return b.kind === 'manuscript';
  return b.kind === 'folder' && a.id === b.id;
}

/** What is known about one scene when the board is built. Everything may be left out. */
export interface SceneData {
  /** The note's properties; null when it has none. */
  readonly frontmatter?: Readonly<Frontmatter> | null;
  /** The whole text of the note; only needed for a scene without a synopsis (see hasSynopsis). */
  readonly text?: string | null;
  /** The word count: null when the note cannot be read, left out while it is still being counted. */
  readonly words?: number | null;
}

/** Looks up what is known about a scene by its path relative to the project folder. */
export type SceneLookup = (path: string) => SceneData | null | undefined;

/** A binder folder as one card. */
export interface FolderCard {
  readonly kind: 'folder';
  /** The folder's id; also its identity. */
  readonly id: string;
  readonly name: string;
  /** The scenes inside it, at any depth, including those whose note is missing. */
  readonly sceneCount: number;
  /** How many of those scenes have no note in the vault. */
  readonly missingCount: number;
  /** How many of those are notes that are whole chapters. Absent: none. */
  readonly chapterCount?: number;
  /** The words of all the scenes inside; null while any of them is still being counted. */
  readonly words: number | null;
  /** The scope that shows this folder's own cards: what opening the card leads to. */
  readonly opens: BoardScope;
}

/** One card on the board. */
export type BoardCard = SceneCard | FolderCard;

/** One step of the trail from the manuscript down to the board being shown. */
export interface Crumb {
  /** "Manuscript" for the first step, then folder names. */
  readonly name: string;
  /** The scope this step leads to. */
  readonly scope: BoardScope;
  /** True for the last step: the board being shown. */
  readonly current: boolean;
}

/** Everything a corkboard shows. */
export interface Board {
  /** The scope shown. The whole manuscript when the folder asked for is no longer in the binder. */
  readonly scope: BoardScope;
  /** False when the folder asked for was not found and the whole manuscript is shown in its place. */
  readonly scopeFound: boolean;
  /** The binder folder the cards sit in (null for the top level); where a new card would go. */
  readonly parentId: string | null;
  /** The trail from the manuscript to this board; the last step is this board. */
  readonly breadcrumb: readonly Crumb[];
  /** The cards in binder order. */
  readonly cards: readonly BoardCard[];
  /** The scenes in this scope at any depth, including those whose note is missing. */
  readonly sceneCount: number;
  /** How many of those are notes that are whole chapters. Absent: none. */
  readonly chapterCount?: number;
  /** The words of all those scenes; null while any of them is still being counted. */
  readonly words: number | null;
}

/** What the board is built from. */
export interface BoardInput {
  /** The binder tree of the open project: `snapshot.tree`. */
  readonly tree: readonly TreeNode[];
  /** Which part to show. Left out: the whole manuscript. */
  readonly scope?: BoardScope;
  /** Gives each scene's properties, text and word count. */
  readonly sceneOf: SceneLookup;
  /** The project's statuses and labels (see readTagLists). */
  readonly lists: CardLists;
  /** About how long a synopsis taken from a scene's text may be. */
  readonly previewLength?: number;
}

type FolderTreeNode = Extract<TreeNode, { kind: 'folder' }>;

/** The folders from the top level down to the one with this id, or null when it is not in the tree. */
function trailTo(nodes: readonly TreeNode[], id: string): FolderTreeNode[] | null {
  for (const node of nodes) {
    if (node.kind !== 'folder') continue;
    if (node.id === id) return [node];
    const inner = trailTo(node.children, id);
    if (inner) return [node, ...inner];
  }
  return null;
}

function countScenes(nodes: readonly TreeNode[]): { scenes: number; missing: number; chapters: number } {
  let scenes = 0;
  let missing = 0;
  let chapters = 0;
  for (const node of nodes) {
    if (node.kind === 'folder') {
      const inner = countScenes(node.children);
      scenes += inner.scenes;
      missing += inner.missing;
      chapters += inner.chapters;
    } else {
      scenes++;
      if (node.missing) missing++;
      if (node.chapter === true) chapters++;
    }
  }
  return { scenes, missing, chapters };
}

/**
 * Build the board for a scope.
 *
 * The cards are the direct contents of the scope, in binder order: a scene
 * card for each scene and a folder card for each folder. A scene whose note
 * is missing stays on the board, marked as missing. When the folder asked for
 * is not in the binder any more (it was removed, perhaps on another device),
 * the whole manuscript is shown and `scopeFound` is false.
 */
export function buildBoard(input: BoardInput): Board {
  const asked = input.scope ?? MANUSCRIPT_SCOPE;
  const trail = asked.kind === 'folder' ? trailTo(input.tree, asked.id) : [];
  const folder = trail === null ? undefined : trail[trail.length - 1];
  const scope: BoardScope = folder ? folderScope(folder.id) : MANUSCRIPT_SCOPE;
  const children = folder ? folder.children : input.tree;

  const totals = binderTotals(children, (path) => {
    const words = input.sceneOf(path)?.words;
    if (typeof words !== 'number') return words;
    // A count that is not a number of words adds nothing, like a note that cannot be read.
    return Number.isFinite(words) ? Math.max(0, Math.round(words)) : null;
  });

  const cards = children.map((node): BoardCard => {
    if (node.kind === 'folder') {
      const inside = countScenes(node.children);
      return {
        kind: 'folder',
        id: node.id,
        name: node.name,
        sceneCount: inside.scenes,
        missingCount: inside.missing,
        ...(inside.chapters > 0 ? { chapterCount: inside.chapters } : {}),
        words: totals.folders.get(node.id) ?? null,
        opens: folderScope(node.id),
      };
    }
    const known = input.sceneOf(node.path) ?? {};
    const card = buildSceneCard(
      { path: node.path, frontmatter: known.frontmatter, text: known.text, words: known.words, missing: node.missing },
      input.lists,
      input.previewLength ?? PREVIEW_LENGTH,
    );
    return node.chapter === true ? { ...card, chapter: true } : card;
  });

  const whole = countScenes(children);
  const steps: Array<{ name: string; scope: BoardScope }> = [
    { name: MANUSCRIPT_FOLDER, scope: MANUSCRIPT_SCOPE },
    ...(trail ?? []).map((step) => ({ name: step.name, scope: folderScope(step.id) })),
  ];
  const breadcrumb = steps.map((step, position): Crumb => ({ ...step, current: position === steps.length - 1 }));

  return {
    scope,
    scopeFound: asked.kind === 'manuscript' || folder !== undefined,
    parentId: folder ? folder.id : null,
    breadcrumb,
    cards,
    sceneCount: whole.scenes,
    ...(whole.chapters > 0 ? { chapterCount: whole.chapters } : {}),
    words: totals.manuscript,
  };
}
