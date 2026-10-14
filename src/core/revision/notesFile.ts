// The revision notes of a project, kept outside the scenes: one file at the
// top of the project folder, "Revision notes.json" (REVISION_NOTES_FILE in
// src/core/projectLayout.ts). The writer never needs to open it.
//
//   {
//     "spellbook-revision-notes": 1,
//     "about": "...",
//     "scenes": [
//       {
//         "scene": "Manuscript/Harbour.md",
//         "scene-id": "m2k9x1ab",
//         "notes": [
//           { "passage": "The harbour was empty", "note": "Say what she hears instead.",
//             "created": "2026-10-14", "done": false }
//         ]
//       }
//     ]
//   }
//
//   scene     the scene's path, relative to the project folder; kept up to
//             date when the scene is renamed or moved
//   scene-id  the scene's id from its "snapshot-id" property, when it has
//             one (the snapshots give a scene that id; no other property is
//             added to a scene for its notes). It finds the notes again when
//             the scene was renamed where Spellbook could not follow.
//   notes     the scene's notes, as in notes.ts
//
// Why JSON and not a note: Obsidian lists a JSON file nowhere (file list,
// search, graph, quick switcher, backlinks), and Spellbook's screens, word
// counts and exports only ever look at markdown notes, so the file cannot be
// counted, shown or exported by mistake. And it is read strictly: a file cut
// short by a sync that has not finished cannot be read, and is then never
// written over (see parseNotesFile).
//
// Anything in the file that this version does not know (another field of a
// scene's entry, of a note, or of the whole file) is kept as it is.

import { pathKey } from '../paths';
import { findNote, readNote, readNoteList } from './notes';
import type { PlacedNote, RevisionNote } from './notes';

/** The field that marks the file as Spellbook's, and the version of its layout. */
export const NOTES_FILE_MARK = 'spellbook-revision-notes';
export const NOTES_FILE_VERSION = 1;
/** A line for whoever opens the file. */
export const NOTES_FILE_ABOUT = 'The revision notes of this Spellbook project, by scene. Spellbook keeps this file: add, change and tick notes in Obsidian.';

/** The revision notes file of a project, as read. Changed in place, then written whole. */
export interface NotesFile {
  /** Everything in the file, unknown fields included. Its "scenes" is always a list. */
  readonly data: Record<string, unknown>;
}

/** A scene, as its notes are found by. */
export interface SceneKey {
  /** Its path relative to the project folder. */
  readonly path: string;
  /** Its "snapshot-id", or null when it has none. */
  readonly id: string | null;
}

/**
 * The id of the note at a path of the project: its "snapshot-id", null when
 * it has none, undefined when there is no note there.
 */
export type IdAt = (path: string) => string | null | undefined;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** A file with no notes yet. */
export function emptyNotesFile(): NotesFile {
  return { data: { [NOTES_FILE_MARK]: NOTES_FILE_VERSION, about: NOTES_FILE_ABOUT, scenes: [] } };
}

/**
 * Read the file's text. No file (null) or an empty one has no notes yet.
 * Null when it cannot be read: not JSON (cut short by a sync, or broken by
 * hand), not laid out as this version knows, or made by a newer version.
 * A file that cannot be read is never written over.
 */
export function parseNotesFile(text: string | null): NotesFile | null {
  if (text === null || text.trim() === '') return emptyNotesFile();
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(data)) return null;
  const version = data[NOTES_FILE_MARK];
  if (typeof version === 'number' && version > NOTES_FILE_VERSION) return null;
  if (data['scenes'] === undefined) data['scenes'] = [];
  if (!Array.isArray(data['scenes'])) return null;
  return { data };
}

/** The file's text: indented, one field to a line, so that it reads well and syncs in small changes. */
export function serialiseNotesFile(file: NotesFile): string {
  return `${JSON.stringify(file.data, null, 2)}\n`;
}

/** The entries of the file, one for each scene with notes. */
function entriesOf(file: NotesFile): unknown[] {
  return file.data['scenes'] as unknown[];
}

function pathOf(entry: unknown): string {
  return isRecord(entry) && typeof entry['scene'] === 'string' ? entry['scene'] : '';
}

function idOf(entry: unknown): string | null {
  if (!isRecord(entry)) return null;
  const id = entry['scene-id'];
  return typeof id === 'string' && id.trim() !== '' ? id.trim() : null;
}

/**
 * Where a scene's entry is in the file; -1 when it has none.
 *  1. The entry at its path, unless that entry belongs to another scene (it
 *     carries an id the scene does not have).
 *  2. When the scene has an id: the entry with that id whose own path no
 *     longer holds that scene. That is a scene renamed where Spellbook could
 *     not follow (on another device, without it). A copy of a scene that
 *     carries the same id does not take its notes: the original is still at
 *     the entry's path.
 */
export function findEntry(file: NotesFile, scene: SceneKey, idAt: IdAt): number {
  const entries = entriesOf(file);
  const key = pathKey(scene.path);
  const atPath = entries.findIndex((entry) => {
    if (pathOf(entry) === '' || pathKey(pathOf(entry)) !== key) return false;
    const id = idOf(entry);
    return id === null || id === scene.id;
  });
  if (atPath >= 0 || scene.id === null) return atPath;
  return entries.findIndex((entry) => idOf(entry) === scene.id && pathOf(entry) !== '' && idAt(pathOf(entry)) !== scene.id);
}

/** A scene's notes in the file, in their order. */
export function sceneNotes(file: NotesFile, scene: SceneKey, idAt: IdAt): PlacedNote[] {
  const at = findEntry(file, scene, idAt);
  if (at < 0) return [];
  const entry = entriesOf(file)[at] as Record<string, unknown>;
  return readNoteList(entry['notes']);
}

/**
 * Change a scene's list of notes. `edit` changes the list in place and says
 * whether it did. The scene's entry is made when it has none (and the edit
 * leaves something in it), its path and id are brought up to date, and an
 * entry left with no notes goes. Returns whether the file changed.
 */
export function editScene(file: NotesFile, scene: SceneKey, idAt: IdAt, edit: (list: unknown[]) => boolean): boolean {
  const entries = entriesOf(file);
  const at = findEntry(file, scene, idAt);
  if (at < 0) {
    const list: unknown[] = [];
    if (!edit(list) || list.length === 0) return false;
    const entry: Record<string, unknown> = { scene: scene.path };
    if (scene.id !== null) entry['scene-id'] = scene.id;
    entry['notes'] = list;
    entries.push(entry);
    return true;
  }
  const entry = entries[at] as Record<string, unknown>;
  const held = entry['notes'];
  const list: unknown[] = Array.isArray(held) ? held : [];
  if (!edit(list)) return false;
  if (list.length === 0) {
    entries.splice(at, 1);
    return true;
  }
  entry['notes'] = list;
  entry['scene'] = scene.path;
  if (scene.id !== null) entry['scene-id'] = scene.id;
  return true;
}

/**
 * Add entries of notes to a scene's list, leaving out each that is the same
 * note as one already there (same passage, words and day): so that adding
 * the same notes twice adds them once. A note that comes in done ticks the
 * same note there when it is not yet (a tick is never taken away). Every
 * field of an entry is kept. Entries that are not notes are left out.
 * Returns whether the file changed.
 */
export function mergeIntoScene(file: NotesFile, scene: SceneKey, idAt: IdAt, entries: readonly unknown[]): boolean {
  return editScene(file, scene, idAt, (list) => {
    let added = false;
    for (const entry of entries) {
      const note = readNote(entry);
      if (!note) continue;
      const at = findNote(list, note);
      if (at >= 0) {
        const there = list[at];
        if (note.done && isRecord(there) && readNote(there)?.done === false) {
          there['done'] = true;
          added = true;
        }
        continue;
      }
      list.push(JSON.parse(JSON.stringify(entry)) as unknown);
      added = true;
    }
    return added;
  });
}

/** Whether every one of these notes is in a scene's list in the file (and done there, when it is done here). */
export function holdsAll(file: NotesFile, scene: SceneKey, idAt: IdAt, notes: readonly RevisionNote[]): boolean {
  const at = findEntry(file, scene, idAt);
  const entry = at < 0 ? null : (entriesOf(file)[at] as Record<string, unknown>);
  const list = entry && Array.isArray(entry['notes']) ? (entry['notes'] as unknown[]) : [];
  return notes.every((note) => {
    const found = findNote(list, note);
    return found >= 0 && (!note.done || readNote(list[found])?.done === true);
  });
}

/**
 * Take out the entries at a path (whatever their capitals), and hand them
 * over. Empty when there are none.
 */
export function takeEntriesAt(file: NotesFile, path: string): Array<Record<string, unknown>> {
  const entries = entriesOf(file);
  const key = pathKey(path);
  const taken: Array<Record<string, unknown>> = [];
  for (let at = entries.length - 1; at >= 0; at--) {
    const entry = entries[at];
    if (isRecord(entry) && pathOf(entry) !== '' && pathKey(pathOf(entry)) === key) {
      taken.unshift(entry);
      entries.splice(at, 1);
    }
  }
  return taken;
}

/**
 * Take out of the entries at a path (whatever their capitals) the notes that
 * are in `copied` (entries as entriesAt gave them), and every entry left
 * with no notes. A note that is not among them (one that arrived after they
 * were copied) stays where it is. Returns whether the file changed.
 */
export function takeCopiedAt(file: NotesFile, path: string, copied: ReadonlyArray<Record<string, unknown>>): boolean {
  const gone: unknown[] = copied.flatMap((entry) => (Array.isArray(entry['notes']) ? (entry['notes'] as unknown[]) : []));
  const entries = entriesOf(file);
  const key = pathKey(path);
  let changed = false;
  for (let at = entries.length - 1; at >= 0; at--) {
    const entry = entries[at];
    if (!isRecord(entry) || pathOf(entry) === '' || pathKey(pathOf(entry)) !== key) continue;
    const list = Array.isArray(entry['notes']) ? (entry['notes'] as unknown[]) : [];
    const kept = list.filter((item) => {
      const read = readNote(item);
      return read === null || findNote(gone, read) < 0;
    });
    if (kept.length === list.length && list.length > 0) continue;
    changed = true;
    if (kept.length === 0) entries.splice(at, 1);
    else entry['notes'] = kept;
  }
  return changed;
}

/** The entries at a path, as copies, leaving the file as it is. */
export function entriesAt(file: NotesFile, path: string): Array<Record<string, unknown>> {
  const key = pathKey(path);
  return entriesOf(file)
    .filter((entry): entry is Record<string, unknown> => isRecord(entry) && pathOf(entry) !== '' && pathKey(pathOf(entry)) === key)
    .map((entry) => JSON.parse(JSON.stringify(entry)) as Record<string, unknown>);
}

/**
 * Put entries in the file under a path: each becomes the entry at that path,
 * or, when there already is one, its notes join that entry's (each note
 * once). Returns whether the file changed.
 */
export function putEntriesAt(file: NotesFile, path: string, taken: ReadonlyArray<Record<string, unknown>>): boolean {
  const entries = entriesOf(file);
  const key = pathKey(path);
  let changed = false;
  for (const entry of taken) {
    const there = entries.find((candidate): candidate is Record<string, unknown> => isRecord(candidate) && pathOf(candidate) !== '' && pathKey(pathOf(candidate)) === key);
    if (!there) {
      entries.push({ ...entry, scene: path });
      changed = true;
      continue;
    }
    const list = Array.isArray(there['notes']) ? (there['notes'] as unknown[]) : [];
    const incoming = Array.isArray(entry['notes']) ? (entry['notes'] as unknown[]) : [];
    for (const note of incoming) {
      const read = readNote(note);
      if (!read || findNote(list, read) >= 0) continue;
      list.push(note);
      changed = true;
    }
    there['notes'] = list;
    if (idOf(there) === null && idOf(entry) !== null) {
      there['scene-id'] = idOf(entry);
      changed = true;
    }
  }
  return changed;
}

/**
 * Follow scenes that were renamed or moved inside the project: the entries
 * at each old path go to the new one, in the order given (so that a chain of
 * renames, or two scenes trading names, comes out right). Returns whether
 * the file changed.
 */
export function renameScenes(file: NotesFile, renames: ReadonlyArray<{ readonly from: string; readonly to: string }>): boolean {
  let changed = false;
  for (const { from, to } of renames) {
    if (from === to) continue;
    const taken = takeEntriesAt(file, from);
    if (taken.length === 0) continue;
    putEntriesAt(file, to, taken);
    changed = true;
  }
  return changed;
}
