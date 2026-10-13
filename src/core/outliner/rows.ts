// The rows of the outliner, worked out from the binder tree.
//
// In manuscript order the table follows the binder: a first row for the whole
// manuscript, then every binder folder as a row with its scenes under it (a
// folder that is folded shut hides them). With a sort on, the table is a flat
// list of scenes and has no folder rows. A filter leaves out the scenes that
// do not pass it, and the folders that then have nothing to show.
//
// The rows that stand for more than one scene (a folder, the manuscript, the
// Total row) carry sums. They are always sums of the scenes that pass the
// filter, so that what is shown adds up; `whole` is the sum of every scene,
// for the line above the table.
//
// Plain calculations only: values go in, values come out.

import { folderRef, sceneRef } from '../binderTree';
import { findTag, readSceneFields } from '../cards';
import type { CardLists, CardTag, TagList } from '../cards';
import type { Frontmatter, NodeRef, TreeNode } from '../types';
import { NO_FILTER, matchesFilter, prepareFilter } from './filter';
import type { OutlineFilter } from './filter';
import { readNoteTags } from './properties';
import { sortScenes } from './sort';
import type { OutlineSort, TextCompare } from './sort';
import { NO_TASKS, addTasks } from './tasks';
import type { TaskCount } from './tasks';

/** What is known about one scene when the rows are worked out. Everything may be left out. */
export interface SceneFacts {
  /** The note's properties; null when it has none. */
  readonly frontmatter?: Readonly<Frontmatter> | null;
  /** The word count: null when the note cannot be read, left out while it is still being counted. */
  readonly words?: number | null;
  /** The to-do lines in its text: null when the note cannot be read, left out while it has not been read. */
  readonly tasks?: TaskCount | null;
}

/** Looks up what is known about a scene by its path relative to the project folder. */
export type SceneFactsLookup = (path: string) => SceneFacts | null | undefined;

/** One scene as a row of the table. */
export interface SceneRow {
  readonly kind: 'scene';
  /** What the row is known by: "scene:<path>". */
  readonly key: string;
  /** The scene's path relative to the project folder; also its identity. */
  readonly path: string;
  readonly title: string;
  /** True when the binder lists the scene but its note is not in the vault. */
  readonly missing: boolean;
  /** How deep it sits in the binder: 1 at the top level, 2 inside a folder, and so on. */
  readonly depth: number;
  /** The binder folder it sits in; null at the top level. */
  readonly parentId: string | null;
  /** Its number in the manuscript, counting every scene from 1. */
  readonly number: number;
  readonly status: CardTag | null;
  readonly label: CardTag | null;
  /** The word target; null when none is set. */
  readonly target: number | null;
  /** The words: null when they cannot be known (unreadable, or the note is missing), undefined while they are counted. */
  readonly words: number | null | undefined;
  /** The synopsis exactly as stored; "" when there is none. */
  readonly synopsis: string;
  readonly tags: readonly string[];
  /** The to-do lines: null when they cannot be known, undefined while the text has not been read. */
  readonly tasks: TaskCount | null | undefined;
  /** Whether the scene goes into the compiled manuscript. */
  readonly compile: boolean;
  /** As YYYY-MM-DD; null when not known. */
  readonly created: string | null;
  readonly edited: string | null;
  /** The note's properties, for the columns that show one of the others. */
  readonly frontmatter: Readonly<Frontmatter> | null;
}

/** What a folder, the manuscript or the Total row adds up. */
export interface Sums {
  /** The scenes counted, including those whose note is missing. */
  readonly scenes: number;
  /** How many of them have no note. */
  readonly missing: number;
  /** Their words; null while one of them is still being counted. */
  readonly words: number | null;
  /** The sum of their targets; 0 when none has one. */
  readonly target: number;
  /**
   * The words of the scenes that have a target, which is what the summed
   * target is measured against (a scene without a target cannot be ahead of
   * or behind one). Null while one of them is still being counted.
   */
  readonly targetWords: number | null;
  /** Their to-do lines; null while the text of one of them has not been read. */
  readonly tasks: TaskCount | null;
}

/** A binder folder as a row. */
export interface FolderRow {
  readonly kind: 'folder';
  /** "folder:<id>" */
  readonly key: string;
  readonly id: string;
  readonly name: string;
  readonly depth: number;
  readonly parentId: string | null;
  /** True when it is folded shut: its scenes are summed but not shown. */
  readonly collapsed: boolean;
  readonly sums: Sums;
}

/** The first row: the whole manuscript. */
export interface ManuscriptRow {
  readonly kind: 'manuscript';
  readonly key: 'manuscript';
  readonly depth: 0;
  readonly sums: Sums;
}

export type OutlineRow = SceneRow | FolderRow | ManuscriptRow;

export const MANUSCRIPT_ROW_KEY = 'manuscript';

export function sceneRowKey(path: string): string {
  return `scene:${path}`;
}

export function folderRowKey(id: string): string {
  return `folder:${id}`;
}

/** The binder node a row stands for; null for the manuscript row. */
export function rowRef(row: OutlineRow): NodeRef | null {
  if (row.kind === 'scene') return sceneRef(row.path);
  return row.kind === 'folder' ? folderRef(row.id) : null;
}

/** What a scene's row was last worked out from, to tell whether it has to be worked out again. */
interface Remembered {
  readonly row: SceneRow;
  readonly frontmatter: unknown;
  readonly words: unknown;
  readonly tasks: unknown;
  readonly lists: CardLists;
}

/** Everything the table shows. */
export interface Outline {
  /** The rows above the Total row, top to bottom. */
  readonly rows: readonly OutlineRow[];
  /** True when the rows are a flat list of scenes in the order of a column. */
  readonly flat: boolean;
  /** True when a filter leaves scenes out. */
  readonly filtered: boolean;
  /** Every scene of the binder, in manuscript order, whether it is shown or not. */
  readonly scenes: readonly SceneRow[];
  /** The Total row: the sums of the scenes that pass the filter. */
  readonly total: Sums;
  /** The sums of every scene of the manuscript. */
  readonly whole: Sums;
  /** Kept from one outline to the next: see OutlineInput.previous. */
  readonly remembered: ReadonlyMap<string, unknown>;
}

/** What the rows are worked out from. */
export interface OutlineInput {
  /** The binder tree of the open project: `snapshot.tree`. */
  readonly tree: readonly TreeNode[];
  /** Gives each scene's properties, word count and to-do lines. */
  readonly sceneOf: SceneFactsLookup;
  /** The project's statuses and labels (see readTagLists). */
  readonly lists: CardLists;
  /** Which scenes to show. Left out: all of them. */
  readonly filter?: OutlineFilter;
  /** The column to sort by. Left out or null: manuscript order, with folder rows. */
  readonly sort?: OutlineSort | null;
  /** The ids of the folders that are folded shut. */
  readonly collapsed?: ReadonlySet<string>;
  /**
   * The outline that was worked out last. A scene that has not changed since
   * keeps the very same row object, so that whoever draws the rows can tell
   * at a glance which ones to draw again.
   */
  readonly previous?: Outline | null;
  /** How text is compared when sorting; left out, the device's own way. */
  readonly collator?: TextCompare;
}

/** Sums while they are being added up. */
interface Running {
  scenes: number;
  missing: number;
  words: number | null;
  target: number;
  targetWords: number | null;
  tasks: TaskCount | null;
}

function nothing(): Running {
  return { scenes: 0, missing: 0, words: 0, target: 0, targetWords: 0, tasks: NO_TASKS };
}

function addScene(sums: Running, scene: SceneRow): void {
  sums.scenes++;
  if (scene.missing) {
    // An entry without a note has no words, no target and no to-do lines.
    sums.missing++;
    return;
  }
  // Still being counted: the sum is not known yet. Unreadable: it adds nothing.
  const words = scene.words === undefined ? null : (scene.words ?? 0);
  sums.words = sums.words === null || words === null ? null : sums.words + words;
  if (scene.target !== null) {
    sums.target += scene.target;
    sums.targetWords = sums.targetWords === null || words === null ? null : sums.targetWords + words;
  }
  const tasks = scene.tasks === undefined ? null : (scene.tasks ?? NO_TASKS);
  sums.tasks = sums.tasks === null || tasks === null ? null : addTasks(sums.tasks, tasks);
}

function addSums(sums: Running, inner: Running): void {
  sums.scenes += inner.scenes;
  sums.missing += inner.missing;
  sums.words = sums.words === null || inner.words === null ? null : sums.words + inner.words;
  sums.target += inner.target;
  sums.targetWords =
    sums.targetWords === null || inner.targetWords === null ? null : sums.targetWords + inner.targetWords;
  sums.tasks = sums.tasks === null || inner.tasks === null ? null : addTasks(sums.tasks, inner.tasks);
}

/** Add up a list of scenes. */
export function sumScenes(scenes: Iterable<SceneRow>): Sums {
  const sums = nothing();
  for (const scene of scenes) addScene(sums, scene);
  return { ...sums };
}

function tagOf(list: TagList, name: string | null): CardTag | null {
  if (name === null) return null;
  const tag = findTag(list, name);
  return tag ? { name: tag.name, color: tag.color, listed: true } : { name, color: null, listed: false };
}

function wordsOf(counted: number | null | undefined, missing: boolean): number | null | undefined {
  if (missing) return null;
  if (typeof counted !== 'number') return counted;
  // A count that is not a number of words adds nothing, like a note that cannot be read.
  return Number.isFinite(counted) ? Math.max(0, Math.round(counted)) : null;
}

type SceneNode = Extract<TreeNode, { kind: 'scene' }>;

function makeSceneRow(
  node: SceneNode,
  facts: SceneFacts,
  lists: CardLists,
  place: { readonly depth: number; readonly parentId: string | null; readonly number: number },
): SceneRow {
  const frontmatter = node.missing ? null : (facts.frontmatter ?? null);
  const fields = readSceneFields(frontmatter);
  return {
    kind: 'scene',
    key: sceneRowKey(node.path),
    path: node.path,
    title: node.title,
    missing: node.missing,
    depth: place.depth,
    parentId: place.parentId,
    number: place.number,
    status: tagOf(lists.statuses, fields.status),
    label: tagOf(lists.labels, fields.label),
    target: fields.target,
    words: wordsOf(facts.words, node.missing),
    synopsis: fields.synopsis,
    tags: readNoteTags(frontmatter),
    tasks: node.missing ? null : facts.tasks,
    compile: fields.compile,
    created: fields.created,
    edited: fields.edited,
    frontmatter,
  };
}

/** Stands in the list of rows for a folder whose sums are not known yet. */
const PENDING_ROW: ManuscriptRow = { kind: 'manuscript', key: MANUSCRIPT_ROW_KEY, depth: 0, sums: { ...nothing() } };

/**
 * Work out the rows of the table.
 *
 * A scene whose note is missing stays in the table, marked as missing. A
 * binder that lists a scene twice shows it once.
 */
export function buildOutline(input: OutlineInput): Outline {
  const { lists } = input;
  const filter = prepareFilter(input.filter ?? NO_FILTER);
  const sort = input.sort ?? null;
  const flat = sort !== null;
  const collapsed: ReadonlySet<string> = input.collapsed ?? new Set<string>();
  const before = (input.previous?.remembered ?? new Map()) as ReadonlyMap<string, Remembered>;

  const remembered = new Map<string, Remembered>();
  const scenes: SceneRow[] = [];
  const passing: SceneRow[] = [];
  const rows: OutlineRow[] = [];
  const whole = nothing();

  /**
   * @param shown false inside a folder that is folded shut: summed, but no rows
   * @returns the sums of the scenes in `nodes` that pass the filter
   */
  const walk = (nodes: readonly TreeNode[], depth: number, parentId: string | null, shown: boolean): Running => {
    const sums = nothing();
    for (const node of nodes) {
      if (node.kind === 'folder') {
        const at = rows.length;
        const drawn = shown && !flat;
        if (drawn) rows.push(PENDING_ROW);
        const shut = collapsed.has(node.id);
        const inner = walk(node.children, depth + 1, node.id, shown && !shut);
        addSums(sums, inner);
        if (!drawn) continue;
        if (filter.on && inner.scenes === 0) {
          // Nothing in it passes the filter: the folder is left out. (Whatever was inside left itself out.)
          rows.length = at;
          continue;
        }
        rows[at] = {
          kind: 'folder',
          key: folderRowKey(node.id),
          id: node.id,
          name: node.name,
          depth,
          parentId,
          collapsed: shut,
          sums: { ...inner },
        };
        continue;
      }

      if (remembered.has(node.path)) continue;
      const facts = input.sceneOf(node.path) ?? {};
      const number = scenes.length + 1;
      const last = before.get(node.path);
      const same =
        last !== undefined &&
        last.frontmatter === facts.frontmatter &&
        last.words === facts.words &&
        last.tasks === facts.tasks &&
        last.lists === lists &&
        last.row.missing === node.missing &&
        last.row.title === node.title &&
        last.row.depth === depth &&
        last.row.parentId === parentId &&
        last.row.number === number;
      const row = same ? last.row : makeSceneRow(node, facts, lists, { depth, parentId, number });
      remembered.set(node.path, {
        row,
        frontmatter: facts.frontmatter,
        words: facts.words,
        tasks: facts.tasks,
        lists,
      });
      scenes.push(row);
      addScene(whole, row);
      if (!matchesFilter(row, filter)) continue;
      addScene(sums, row);
      passing.push(row);
      if (shown && !flat) rows.push(row);
    }
    return sums;
  };

  const total: Sums = { ...walk(input.tree, 1, null, true) };
  const shownRows: OutlineRow[] =
    sort !== null
      ? sortScenes(passing, sort, lists, input.collator)
      : [{ kind: 'manuscript', key: MANUSCRIPT_ROW_KEY, depth: 0, sums: total }, ...rows];

  return { rows: shownRows, flat, filtered: filter.on, scenes, total, whole: { ...whole }, remembered };
}

/** True when two sums say the same. */
export function sameSums(a: Sums, b: Sums): boolean {
  return (
    a.scenes === b.scenes &&
    a.missing === b.missing &&
    a.words === b.words &&
    a.target === b.target &&
    a.targetWords === b.targetWords &&
    (a.tasks === b.tasks || (a.tasks !== null && b.tasks !== null && a.tasks.done === b.tasks.done && a.tasks.total === b.tasks.total))
  );
}
