// Conflicting copies of a project's index.
//
// When two devices change the same note before they have synced, iCloud (and
// other sync services) keep both versions: the note itself and a copy next to
// it, typically "<Project> 2.md". A copy of a project's index carries the
// same "spellbook: project" marker, so without care it would look like a
// second project, and the binder of one device would silently differ from
// the binder of the other.
//
// This file holds the plain logic for that situation:
//   - telling which of several index notes in one folder is the project's
//     own and which are copies of it, in a way that comes out the same on
//     every device (it goes by where the notes are and what they are called,
//     never by which one happens to be open);
//   - merging a copy into the index: every scene that only the copy lists is
//     added at the end. Nothing is ever removed or put in another order;
//   - merging what the other screens keep in the index (the statuses, the
//     labels, the timelines, the day marks and the targets) the same way:
//     what only the copy has is added, and nothing the index has is removed
//     or written over.
//
// What the two notes say (their title property, their binders) plays no part
// in telling them apart. A copy is the other device's version of the index,
// so it differs from the index in whatever that device changed, and that can
// be the title as easily as the binder. Going by the name alone also means
// the answer cannot be out of date: a note's path is always known, while
// what Obsidian remembers of its properties can lag behind the file.

import { flattenScenes } from './binderTree';
import { clashKey, noteTitle, parentPath, pathKey } from './paths';
import type { Binder, BinderNode } from './types';

/**
 * What a sync service puts between a note's name and what it adds to it:
 * "Novel 2", "Novel (conflicted copy)", "Novel.sync-conflict-...".
 */
const AFTER_THE_NAME = /^[\s.(_-]/;

/** True when the note called `copy` could be a conflicting copy of the note called `main`. */
function isNamedAfter(copy: string, main: string): boolean {
  const copyKey = clashKey(copy);
  const mainKey = clashKey(main);
  return (
    mainKey !== '' &&
    copyKey.length > mainKey.length &&
    copyKey.startsWith(mainKey) &&
    AFTER_THE_NAME.test(copyKey.slice(mainKey.length))
  );
}

/** A project index note, as far as telling copies apart needs to know it. */
export interface IndexNote {
  /** Vault path of the index note. */
  readonly indexPath: string;
}

/**
 * Find the index notes that are conflicting copies of another index note.
 *
 * An index note is a copy when another index note sits in the same folder
 * and the copy's name is that note's name with something added ("Novel 2"
 * next to "Novel"). Their titles do not matter: the two versions may well
 * disagree about the title, when that is what one device changed. Two index
 * notes in one folder whose names have nothing to do with each other are
 * left alone: they are two projects.
 *
 * @param indexes every project index note in the vault
 * @returns for each copy (by its vault path), the path of the index note it is a copy of
 */
export function conflictCopies(indexes: Iterable<IndexNote>): Map<string, string> {
  const byFolder = new Map<string, IndexNote[]>();
  for (const index of indexes) {
    const folder = parentPath(index.indexPath);
    const group = byFolder.get(folder);
    if (group) group.push(index);
    else byFolder.set(folder, [index]);
  }

  const mains = new Map<string, string>();
  for (const group of byFolder.values()) {
    if (group.length < 2) continue;
    for (const note of group) {
      const path = note.indexPath;
      const title = noteTitle(path);
      // The shortest name this one is built on is the original of the lot.
      let main: string | null = null;
      for (const candidate of group) {
        const other = candidate.indexPath;
        if (other === path || !isNamedAfter(title, noteTitle(other))) continue;
        if (main === null || other.length < main.length || (other.length === main.length && other < main)) {
          main = other;
        }
      }
      if (main !== null) mains.set(path, main);
    }
  }
  return mains;
}

/** What merging a copy into an index comes to. */
export interface CopyMerge {
  /** The index's binder with the copy's extra scenes added; the same object when there are none. */
  readonly binder: Binder;
  /** The scene paths that were added, in the order the copy lists them. */
  readonly added: readonly string[];
}

/**
 * Merge the binder of a conflicting copy into the binder of the index.
 *
 * Every scene path that only the copy lists is added at the end of the top
 * level, in the copy's own manuscript order. Everything the index lists
 * stays exactly where it is: nothing is removed, renamed or moved, and the
 * copy's folders are not taken over.
 */
export function mergeConflictCopy(main: Binder, copy: Binder): CopyMerge {
  const listed = new Set(flattenScenes(main).map(pathKey));
  const added: string[] = [];
  for (const path of flattenScenes(copy)) {
    const key = pathKey(path);
    if (listed.has(key)) continue;
    listed.add(key);
    added.push(path);
  }
  if (added.length === 0) return { binder: main, added };
  return { binder: [...main, ...added.map((path): BinderNode => ({ kind: 'scene', path }))], added };
}

// ------------------------------------------------------ what the screens keep
//
// Besides the binder, the index note holds a few things the other screens
// keep there, each under a key of its own:
//
//   statuses, labels, timelines   lists of named things: { name, color }
//   marks                         a mark for a day:      { "2026-10-15": { color, label } }
//   targets                       a few figures:         { project, daily, deadline }
//
// A copy is the other device's version of the index, so it can hold a label,
// a timeline, a mark or a target that this one does not. The rule for all of
// them is the binder's: add what is missing, and leave alone whatever is
// already there. Where the two versions disagree about the same thing (the
// colour of a label, the mark of a day, the daily target), this one is kept.

/** The keys of the index that hold a list of named things; a copy's extra names are added at the end. */
export const MERGED_LIST_KEYS: readonly string[] = ['statuses', 'labels', 'timelines'];

/** The keys of the index that hold a group of values by name; a copy's extra entries are added. */
export const MERGED_GROUP_KEYS: readonly string[] = ['marks', 'targets'];

/** What was brought over from a copy under one key of the index. */
export interface MergedData {
  /** The key of the index: "labels", "marks" and so on. */
  readonly key: string;
  /** What was added: the names of the statuses, labels or timelines, the days of the marks, the names of the targets. */
  readonly items: readonly string[];
}

/** What merging the screens' data of a copy into the index comes to. */
export interface DataMerge {
  /**
   * The new value of every key that gained something, to be written into the
   * index as it is. A key the copy added nothing to is not in here, and must
   * not be written.
   */
  readonly changes: Readonly<Record<string, unknown>>;
  /** What was brought over, key by key, in the order of the keys above. Empty when the copy had nothing new. */
  readonly added: readonly MergedData[];
}

function isGroup(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Nothing stored: no value, an empty text, or nothing but spaces. (An empty list or group is something: it is the writer's.) */
function isBlank(value: unknown): boolean {
  return value === undefined || value === null || (typeof value === 'string' && value.trim() === '');
}

/** The name of an entry of a list: the text itself, or its "name". Null for anything else. */
function nameOfEntry(entry: unknown): string | null {
  const name = typeof entry === 'string' ? entry : isGroup(entry) ? entry['name'] : null;
  return typeof name === 'string' && name.trim() !== '' ? name.trim() : null;
}

/** Two names are the same thing when they differ only in capitals, in spaces around them, or in how an accent is stored. */
function nameKey(name: string): string {
  return clashKey(name.trim());
}

/** A value as it can be written into another note: a copy of its own, sharing nothing. */
function cloned<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * Merge a list of named things. Entries of the copy whose name the index
 * does not have are added at the end, in the copy's order and exactly as the
 * copy has them. Entries the index has stay as they are, in their place.
 * Returns null when there is nothing to add.
 */
function mergeList(main: unknown, copy: unknown): { readonly value: unknown[]; readonly items: string[] } | null {
  if (!Array.isArray(copy)) return null;
  // Something is there that is not a list: it is not understood, so it is not touched.
  if (!isBlank(main) && !Array.isArray(main)) return null;
  const kept: unknown[] = Array.isArray(main) ? main : [];
  const known = new Set<string>();
  for (const entry of kept) {
    const name = nameOfEntry(entry);
    if (name !== null) known.add(nameKey(name));
  }
  const extra: unknown[] = [];
  const items: string[] = [];
  for (const entry of copy) {
    const name = nameOfEntry(entry);
    // An entry without a name cannot be told from the ones that are there: it is left out.
    if (name === null || known.has(nameKey(name))) continue;
    known.add(nameKey(name));
    extra.push(cloned(entry));
    items.push(name);
  }
  if (extra.length === 0) return null;
  return { value: [...cloned(kept), ...extra], items };
}

/**
 * Merge a group of values by name (the marks by day, the targets by what
 * they are for). An entry of the copy is added when the index has nothing
 * under that name; an entry the index has, whatever it holds, stays as it is.
 * Returns null when there is nothing to add.
 */
function mergeGroup(main: unknown, copy: unknown): { readonly value: Record<string, unknown>; readonly items: string[] } | null {
  if (!isGroup(copy)) return null;
  if (!isBlank(main) && !isGroup(main)) return null;
  const kept: Record<string, unknown> = isGroup(main) ? main : {};
  const value: Record<string, unknown> = cloned(kept);
  const items: string[] = [];
  for (const [name, entry] of Object.entries(copy)) {
    if (isBlank(entry)) continue;
    if (Object.prototype.hasOwnProperty.call(kept, name) && !isBlank(kept[name])) continue;
    value[name] = cloned(entry);
    items.push(name);
  }
  return items.length === 0 ? null : { value, items };
}

/**
 * Merge what the screens keep in a conflicting copy of the index into what
 * they keep in the index itself: the statuses, the labels, the timelines,
 * the day marks and the targets.
 *
 * Only ever adds:
 *  - a status, label or timeline whose name the index does not list is added
 *    at the end of its list (names are compared without regard to capitals);
 *  - a mark on a day the index has no mark for is added;
 *  - a target the index has not set is added;
 *  - a whole list or group the index does not have at all is taken over.
 *
 * Never removes, reorders or writes over: where both versions have the same
 * name, day or target, the index keeps its own, also when the two differ.
 * A value in the index that is not what it should be (a text where a list
 * belongs, say) is left exactly as it is. Every other key of the copy is
 * ignored.
 *
 * @param main the index's own data (its top-level keys besides the binder and the index's own)
 * @param copy the copy's
 */
export function mergeConflictData(
  main: Readonly<Record<string, unknown>>,
  copy: Readonly<Record<string, unknown>>,
): DataMerge {
  const changes: Record<string, unknown> = {};
  const added: MergedData[] = [];
  const own = (data: Readonly<Record<string, unknown>>, key: string): unknown =>
    Object.prototype.hasOwnProperty.call(data, key) ? data[key] : undefined;
  for (const key of MERGED_LIST_KEYS) {
    const merged = mergeList(own(main, key), own(copy, key));
    if (merged === null) continue;
    changes[key] = merged.value;
    added.push({ key, items: merged.items });
  }
  for (const key of MERGED_GROUP_KEYS) {
    const merged = mergeGroup(own(main, key), own(copy, key));
    if (merged === null) continue;
    changes[key] = merged.value;
    added.push({ key, items: merged.items });
  }
  return { changes, added };
}
