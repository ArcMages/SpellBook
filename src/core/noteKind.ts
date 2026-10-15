// Chapters and scenes: what a note of the manuscript stands for.
//
// A note in the binder is a scene unless it is marked as a chapter: a whole
// chapter written as one note. A book may mix the two: some chapters as one
// note, others as a binder folder of scene notes.
//
// The project index keeps both facts next to the binder, so the notes'
// own properties stay as they are:
//
//   writes-in: chapters          what "New ..." makes; absent means scenes
//   chapters:                    the notes that are whole chapters
//     - Manuscript/The Spark.md
//
// Older versions of the plugin ignore both keys, so a project that uses them
// still opens there (every note then reads as a scene).
//
// Nothing here depends on Obsidian.

import { normaliseRelativePath, pathKey } from './paths';

/** What a note of the manuscript stands for. */
export type NoteKind = 'scene' | 'chapter';

/** The project index key with the paths of the notes that are whole chapters. */
export const CHAPTERS_KEY = 'chapters';

/** The project index key that says what the writer usually writes in. */
export const WRITES_IN_KEY = 'writes-in';

/** The value of WRITES_IN_KEY for a project written in chapters. */
export const WRITES_IN_CHAPTERS = 'chapters';

/** The paths in a stored chapters list, tidied; anything that is not a path is left out. */
export function readChapterList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const path = normaliseRelativePath(item);
    if (path === null || seen.has(pathKey(path))) continue;
    seen.add(pathKey(path));
    out.push(path);
  }
  return out;
}

/** The keys (see pathKey) of the notes a stored chapters list marks as chapters. */
export function chapterKeys(value: unknown): Set<string> {
  return new Set(readChapterList(value).map(pathKey));
}

/** What the writer usually writes in, from the stored value: scenes unless it says chapters. */
export function readWritesIn(value: unknown): NoteKind {
  return typeof value === 'string' && value.trim().toLowerCase() === WRITES_IN_CHAPTERS ? 'chapter' : 'scene';
}

/** The value to store for what the writer usually writes in; undefined (no key) for scenes. */
export function writesInValue(kind: NoteKind): string | undefined {
  return kind === 'chapter' ? WRITES_IN_CHAPTERS : undefined;
}

/**
 * The chapters list with one note's kind set. Entries that are not paths are
 * kept as they were. Returns undefined (no key at all) for a list that ends
 * up empty.
 */
export function withKind(current: unknown, path: string, kind: NoteKind): unknown[] | undefined {
  const list = Array.isArray(current) ? [...(current as unknown[])] : [];
  const key = pathKey(path);
  const matches = (item: unknown): boolean => {
    if (typeof item !== 'string') return false;
    const tidy = normaliseRelativePath(item);
    return tidy !== null && pathKey(tidy) === key;
  };
  const kept = list.filter((item) => !matches(item));
  if (kind === 'chapter') kept.push(path);
  return kept.length === 0 ? undefined : kept;
}

/**
 * The chapters list with notes that moved under their new paths. Returns null
 * when nothing changed. Entries that are not paths are kept as they were.
 */
export function renamedChapterList(
  current: unknown,
  renames: Iterable<readonly [oldPath: string, newPath: string]>,
): unknown[] | null {
  if (!Array.isArray(current)) return null;
  const moves = new Map<string, string>();
  for (const [from, to] of renames) moves.set(pathKey(from), to);
  if (moves.size === 0) return null;
  let changed = false;
  const out: unknown[] = [];
  const seen = new Set<string>();
  for (const item of current as unknown[]) {
    if (typeof item !== 'string') {
      out.push(item);
      continue;
    }
    const tidy = normaliseRelativePath(item);
    const moved = tidy === null ? undefined : moves.get(pathKey(tidy));
    const next = moved ?? item;
    if (moved !== undefined) changed = true;
    const key = pathKey(normaliseRelativePath(next) ?? next);
    if (seen.has(key)) {
      changed = true;
      continue;
    }
    seen.add(key);
    out.push(next);
  }
  return changed ? out : null;
}

// ------------------------------------------------------------------ wording

/** The word for a kind, in lower case: "chapter" or "scene"; with a count of other than one, plural. */
export function kindWord(kind: NoteKind, count = 1): string {
  return count === 1 ? kind : `${kind}s`;
}

/** The word for a kind with a capital: "Chapter" or "Scene". */
export function kindTitle(kind: NoteKind, count = 1): string {
  const word = kindWord(kind, count);
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/** A whole number with commas between the thousands: "12,345". */
function grouped(count: number): string {
  return String(Math.max(0, Math.round(count))).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** A count of notes said naturally: "1 scene", "3 chapters and 2 scenes", "0 scenes". */
export function describeKinds(chapters: number, scenes: number): string {
  const said = (count: number, kind: NoteKind): string => `${grouped(count)} ${kindWord(kind, count)}`;
  if (chapters > 0 && scenes > 0) return `${said(chapters, 'chapter')} and ${said(scenes, 'scene')}`;
  if (chapters > 0) return said(chapters, 'chapter');
  return said(scenes, 'scene');
}

/** Counts the kinds of a list of notes and says it naturally (see describeKinds). */
export function describeNotes(paths: Iterable<string>, isChapter: (path: string) => boolean): string {
  let chapters = 0;
  let scenes = 0;
  for (const path of paths) {
    if (isChapter(path)) chapters += 1;
    else scenes += 1;
  }
  return describeKinds(chapters, scenes);
}

/** The setting's choice as the writer reads it. */
export const WRITES_IN_LABELS: Readonly<Record<NoteKind, string>> = { scene: 'Scenes', chapter: 'Chapters' };

/** Title of the first note of a new project written in chapters. */
export const FIRST_CHAPTER_TITLE = 'Chapter 1';
