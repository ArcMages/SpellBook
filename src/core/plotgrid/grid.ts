// The plot grid itself: one row per scene in binder order, under rows for the
// binder's folders (which fold), and one cell per column. For each column:
// how many scenes it is in, where in the book they are (for the thin bar
// under its header), and the long stretches of scenes it is missing from.
//
// Plain calculations: the caller says which scene is in which column.

import type { TreeNode } from '../types';
import type { PlotColumn } from './columns';

/** How many scenes in a row a column may be missing from before the stretch is marked, unless the writer chose otherwise. */
export const DEFAULT_GAP_LENGTH = 5;
/** The fewest and the most a writer can choose. 0 turns the marks off. */
export const MIN_GAP_LENGTH = 2;
export const MAX_GAP_LENGTH = 99;

/** A gap length as it may be used: a whole number in bounds, or 0 for no marks. */
export function readGapLength(value: unknown): number {
  const number = typeof value === 'string' && value.trim() !== '' ? Number(value.trim()) : value;
  if (typeof number !== 'number' || !Number.isInteger(number)) return DEFAULT_GAP_LENGTH;
  if (number === 0) return 0;
  if (number < MIN_GAP_LENGTH || number > MAX_GAP_LENGTH) return DEFAULT_GAP_LENGTH;
  return number;
}

/** A stretch of the bar: from and to as fractions of the book, 0 to 1. */
export interface BarSegment {
  readonly start: number;
  readonly end: number;
}

/** A stretch of scenes, by their places in the book (0 for the first scene), both ends included. */
export interface SceneStretch {
  readonly from: number;
  readonly to: number;
}

/** A column with what it covers. */
export interface GridColumn extends PlotColumn {
  /** How many scenes are in it. */
  readonly count: number;
  /** Where in the book its scenes are, runs of scenes in a row joined into one segment. */
  readonly segments: readonly BarSegment[];
  /** The long stretches between two of its scenes that it is missing from. */
  readonly gaps: readonly SceneStretch[];
  /** Its span: from its first scene to its last, by their places in the book; null when it is in no scene. */
  readonly span: SceneStretch | null;
}

export interface GridSceneRow {
  readonly kind: 'scene';
  /** The scene's path relative to the project folder. */
  readonly path: string;
  readonly title: string;
  /** How many folders it is inside. */
  readonly depth: number;
  /** Its place in the book: 0 for the first scene. */
  readonly index: number;
  /** True when the binder lists it but its note is not there. */
  readonly missing: boolean;
  /** For each column, in order: whether the scene is in it. */
  readonly cells: readonly boolean[];
  /** For each column: whether the scene lies in a long stretch the column is missing from. */
  readonly gaps: readonly boolean[];
  /**
   * For each column: whether the scene comes before the column's first scene
   * or after its last, so outside the stretch where it is in the story.
   * All false when the shading is turned off, and for a column in no scene.
   */
  readonly outside: readonly boolean[];
}

export interface GridFolderRow {
  readonly kind: 'folder';
  readonly id: string;
  readonly name: string;
  readonly depth: number;
  readonly folded: boolean;
  /** How many scenes it holds, at any depth. */
  readonly sceneCount: number;
  /** For each column: how many of its scenes are in it. */
  readonly counts: readonly number[];
}

export type GridRow = GridSceneRow | GridFolderRow;

export interface PlotGrid {
  readonly columns: readonly GridColumn[];
  /** The rows to show, top to bottom: the scenes inside a folded folder are left out. */
  readonly rows: readonly GridRow[];
  /** How many scenes the book has. */
  readonly sceneCount: number;
}

export interface PlotGridInput {
  readonly tree: readonly TreeNode[];
  readonly columns: readonly PlotColumn[];
  /** Whether a scene is in a column. Not asked for a scene whose note is missing. */
  readonly isIn: (scenePath: string, column: PlotColumn) => boolean;
  /** The ids of the folders that are folded shut. */
  readonly folded?: ReadonlySet<string>;
  /** How many scenes in a row make a gap worth marking; 0 for no marks. */
  readonly gapLength?: number;
  /** Whether to mark the scenes before a column's first scene and after its last; true unless said otherwise. */
  readonly shadeOutside?: boolean;
}

interface Scene {
  readonly path: string;
  readonly title: string;
  readonly missing: boolean;
}

function scenesOf(nodes: readonly TreeNode[], into: Scene[] = []): Scene[] {
  for (const node of nodes) {
    if (node.kind === 'folder') scenesOf(node.children, into);
    else into.push({ path: node.path, title: node.title, missing: node.missing });
  }
  return into;
}

/** Runs of filled places as segments of the bar. */
export function barSegments(filled: readonly boolean[]): BarSegment[] {
  const total = filled.length;
  const segments: BarSegment[] = [];
  let from = -1;
  for (let index = 0; index <= total; index++) {
    const on = index < total && filled[index] === true;
    if (on && from < 0) from = index;
    if (!on && from >= 0) {
      segments.push({ start: from / total, end: index / total });
      from = -1;
    }
  }
  return segments;
}

/**
 * The stretches between two filled places that are at least `length` places
 * long. Before a column's first scene and after its last there is no gap: a
 * plotline may well begin late or end early.
 */
export function findGaps(filled: readonly boolean[], length: number): SceneStretch[] {
  if (!(length > 0)) return [];
  const gaps: SceneStretch[] = [];
  let last = -1;
  filled.forEach((on, index) => {
    if (!on) return;
    if (last >= 0 && index - last - 1 >= length) gaps.push({ from: last + 1, to: index - 1 });
    last = index;
  });
  return gaps;
}

/** From the first filled place to the last, both included; null when none is filled. */
export function spanOf(filled: readonly boolean[]): SceneStretch | null {
  const from = filled.indexOf(true);
  if (from < 0) return null;
  return { from, to: filled.lastIndexOf(true) };
}

/** Work the grid out. */
export function buildPlotGrid(input: PlotGridInput): PlotGrid {
  const { tree, columns, isIn } = input;
  const folded = input.folded ?? new Set<string>();
  const gapLength = input.gapLength ?? DEFAULT_GAP_LENGTH;
  const shadeOutside = input.shadeOutside !== false;

  const scenes = scenesOf(tree);
  const filled: boolean[][] = scenes.map((scene) => columns.map((column) => !scene.missing && isIn(scene.path, column)));
  const byColumn = columns.map((_, at) => filled.map((row) => row[at] === true));
  const gaps = byColumn.map((column) => findGaps(column, gapLength));
  const inGap = (index: number, at: number): boolean => (gaps[at] ?? []).some((gap) => index >= gap.from && index <= gap.to);
  const spans = byColumn.map((column) => spanOf(column));
  const isOutside = (index: number, at: number): boolean => {
    const span = spans[at] ?? null;
    return shadeOutside && span !== null && (index < span.from || index > span.to);
  };

  const gridColumns: GridColumn[] = columns.map((column, at) => {
    const own = byColumn[at] ?? [];
    return { ...column, count: own.filter(Boolean).length, segments: barSegments(own), gaps: gaps[at] ?? [], span: spans[at] ?? null };
  });

  const rows: GridRow[] = [];
  let next = 0;
  const walk = (nodes: readonly TreeNode[], depth: number, shown: boolean): void => {
    for (const node of nodes) {
      if (node.kind === 'scene') {
        const index = next++;
        if (!shown) continue;
        rows.push({
          kind: 'scene',
          path: node.path,
          title: node.title,
          depth,
          index,
          missing: node.missing,
          cells: filled[index] ?? [],
          gaps: columns.map((_, at) => !(filled[index]?.[at] ?? false) && inGap(index, at)),
          outside: columns.map((_, at) => isOutside(index, at)),
        });
        continue;
      }
      const first = next;
      const count = scenesOf(node.children).length;
      const isFolded = folded.has(node.id);
      if (shown) {
        rows.push({
          kind: 'folder',
          id: node.id,
          name: node.name,
          depth,
          folded: isFolded,
          sceneCount: count,
          counts: columns.map((_, at) => filled.slice(first, first + count).filter((row) => row[at] === true).length),
        });
      }
      walk(node.children, depth + 1, shown && !isFolded);
    }
  };
  walk(tree, 0, true);
  return { columns: gridColumns, rows, sceneCount: scenes.length };
}
