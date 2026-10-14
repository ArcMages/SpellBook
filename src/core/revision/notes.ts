// Revision notes: a note the writer pins to a passage of a scene ("say what
// she hears instead"). The scene's text is never changed.
//
// The notes are kept outside the scenes, in one file per project (see
// notesFile.ts). This file is about the notes themselves: one entry per
// note, each with four plain fields:
//
//   { "passage": "The harbour was empty", "note": "Say what she hears instead.",
//     "created": "2026-10-14", "done": false }
//
//   passage  the exact words the note is about, as they were selected
//   note     what the writer wrote
//   created  the day the note was made (YYYY-MM-DD)
//   done     true once the writer has dealt with it
//
// An entry may hold other fields (written by hand, or by a newer version):
// they are kept as they are whenever the entry is changed.
//
// Earlier versions kept the same list in the scene's own properties, under
// "revision-notes". readNotes still reads that list, so that the notes can be
// moved out of the scene (see the migration in src/features/revision/book.ts).
//
// A note is found again in the text by its passage: the first place where
// the exact words stand. When they are gone (the passage was rewritten), the
// note says "passage changed" and stays in the list until it is ticked done
// or deleted.

import type { Frontmatter } from '../types';
import { stripFrontmatter } from '../wordCount';

/** The property earlier versions kept a scene's notes under. */
export const REVISION_NOTES_KEY = 'revision-notes';

/** The longest passage a note keeps, in characters. A longer selection is cut there. */
export const MAX_PASSAGE_LENGTH = 1000;

export interface RevisionNote {
  /** The exact words of the scene the note is about. The writer's own text. */
  readonly passage: string;
  /** What the writer wrote. */
  readonly note: string;
  /** The day it was made, YYYY-MM-DD; "" when the entry has none. */
  readonly created: string;
  readonly done: boolean;
}

/** A note together with its place in the scene's list, which is what changes it. */
export interface PlacedNote extends RevisionNote {
  /** Its position in the scene's list as it was read. */
  readonly index: number;
}

function textOf(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

function dayOf(value: unknown): string {
  if (typeof value === 'string') return value.trim().slice(0, 10);
  // A YAML reader may hand a bare date over as a date.
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  return '';
}

function doneOf(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return ['true', 'yes', 'done', 'x'].includes(value.trim().toLowerCase());
  return false;
}

/** One entry of the list, or null for something that is not a note (an entry without a passage). */
export function readNote(entry: unknown): RevisionNote | null {
  if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) return null;
  const fields = entry as Record<string, unknown>;
  const passage = textOf(fields['passage']);
  if (passage.trim() === '') return null;
  return { passage, note: textOf(fields['note']), created: dayOf(fields['created']), done: doneOf(fields['done']) };
}

/** The notes in a list of entries, in the order they are written. Entries that are not notes are skipped. */
export function readNoteList(list: unknown): PlacedNote[] {
  if (!Array.isArray(list)) return [];
  const notes: PlacedNote[] = [];
  list.forEach((entry, index) => {
    const note = readNote(entry);
    if (note) notes.push({ ...note, index });
  });
  return notes;
}

/** The notes an earlier version kept in a scene's properties, under "revision-notes". */
export function readNotes(frontmatter: Readonly<Frontmatter> | null | undefined): PlacedNote[] {
  return readNoteList(frontmatter?.[REVISION_NOTES_KEY]);
}

/** A note as it is written into the list: the four fields, in this order. */
export function entryOf(note: RevisionNote): Record<string, unknown> {
  return { passage: note.passage, note: note.note, created: note.created, done: note.done };
}

/**
 * The words of a selection, made ready to be a passage: the spaces and line
 * ends at its two ends are left off (the words themselves are kept exactly),
 * and it is cut at MAX_PASSAGE_LENGTH. Empty when nothing but spaces was selected.
 */
export function tidyPassage(selection: string): string {
  const trimmed = selection.replace(/^\s+/, '').replace(/\s+$/, '');
  if (trimmed.length <= MAX_PASSAGE_LENGTH) return trimmed;
  return trimmed.slice(0, MAX_PASSAGE_LENGTH).replace(/\s+$/, '');
}

/** Whether two notes are the same note: same passage, same words, same day. */
export function sameNote(a: RevisionNote, b: RevisionNote): boolean {
  return a.passage === b.passage && a.note === b.note && a.created === b.created;
}

/**
 * Where a note stands in the list as it is now: at the position it was read
 * from when it is still there, or wherever the same note is now (an entry
 * may have been added or removed meanwhile, on this device or another).
 * -1 when it is gone.
 */
export function findNote(list: readonly unknown[], wanted: PlacedNote | RevisionNote): number {
  if ('index' in wanted) {
    const there = readNote(list[wanted.index]);
    if (there && sameNote(there, wanted)) return wanted.index;
  }
  return list.findIndex((entry) => {
    const note = readNote(entry);
    return note !== null && sameNote(note, wanted);
  });
}

/** Add a note at the end of a scene's list. Returns true (the list changed). */
export function addToList(list: unknown[], note: RevisionNote): boolean {
  list.push(entryOf(note));
  return true;
}

/**
 * Change one note in a scene's list: its words, or whether it is done.
 * Other fields of the entry are kept. Returns false when the note is no
 * longer there or nothing would change.
 */
export function changeInList(list: unknown[], wanted: PlacedNote | RevisionNote, change: { readonly note?: string; readonly done?: boolean }): boolean {
  const at = findNote(list, wanted);
  if (at < 0) return false;
  const entry = list[at] as Record<string, unknown>;
  let changed = false;
  if (change.note !== undefined && entry['note'] !== change.note) {
    entry['note'] = change.note;
    changed = true;
  }
  if (change.done !== undefined && doneOf(entry['done']) !== change.done) {
    entry['done'] = change.done;
    changed = true;
  }
  return changed;
}

/** Take one note out of a scene's list. Returns false when the note is no longer there. */
export function removeFromList(list: unknown[], wanted: PlacedNote | RevisionNote): boolean {
  const at = findNote(list, wanted);
  if (at < 0) return false;
  list.splice(at, 1);
  return true;
}

/**
 * Where a passage stands in a scene's text: the first place, at or after
 * `from`, where its exact words are. Null when they are not there any more.
 */
export function locatePassage(text: string, passage: string, from = 0): { from: number; to: number } | null {
  if (passage === '') return null;
  const at = text.indexOf(passage, from);
  return at < 0 ? null : { from: at, to: at + passage.length };
}

/** A note's passage, where it stands in a whole note (properties and all). */
export interface PassageMark {
  readonly from: number;
  readonly to: number;
  readonly note: RevisionNote;
}

/**
 * Where the open notes of a scene stand in its whole text, as the editor
 * holds it: each note's passage, looked for after the properties. Notes that
 * are done, and notes whose passage is gone, are left out. In the order of
 * the notes.
 */
export function passageMarks(text: string, notes: readonly RevisionNote[]): PassageMark[] {
  const head = text.length - stripFrontmatter(text).length;
  const marks: PassageMark[] = [];
  for (const note of notes) {
    if (note.done) continue;
    const place = locatePassage(text, note.passage, head);
    if (place) marks.push({ ...place, note });
  }
  return marks;
}

/**
 * The properties block of a whole note, as YAML (what is between its two
 * "---" lines); null when it has none.
 */
export function propertiesOf(text: string): string | null {
  const body = stripFrontmatter(text);
  const head = text.slice(0, text.length - body.length);
  const start = head.indexOf('\n');
  if (head === '' || start < 0) return null;
  const inner = head.slice(start + 1).replace(/\n$/, '');
  const end = inner.lastIndexOf('\n');
  return end < 0 ? '' : inner.slice(0, end);
}
