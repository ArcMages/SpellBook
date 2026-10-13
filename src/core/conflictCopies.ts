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
//     every device (it goes by the notes' names and titles, never by which
//     one happens to be open);
//   - merging a copy into the index: every scene that only the copy lists is
//     added at the end. Nothing is ever removed or put in another order.

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
  /** Its title property, or null when it has none. */
  readonly explicitTitle: string | null;
}

/**
 * Find the index notes that are conflicting copies of another index note.
 *
 * An index note is a copy when another index note sits in the same folder,
 * the copy's name is that note's name with something added ("Novel 2" next
 * to "Novel"), and both carry the same title property (a copy is the same
 * note, after all). Anything else is left alone: two index notes in one
 * folder with names or titles of their own are two projects.
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
        if (other === path || candidate.explicitTitle !== note.explicitTitle) continue;
        if (!isNamedAfter(title, noteTitle(other))) continue;
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
