// Changing the text of a scene in a few exact places: what "Replace" and
// "Rename everywhere" do once the writer has ticked the changes they want.
//
// A change names a stretch of the scene's text (without its properties) by
// where it starts and ends, the words that must be there, and what goes in
// their place. The changes are applied all together or not at all: if the
// text is not, letter for letter, the text the search was made on, or a
// stretch does not hold the words it should, nothing is changed. The
// properties at the top of the note are never part of it.

import { stripFrontmatter } from '../wordCount';

/** One change to a scene's text. Positions are in the text without its properties. */
export interface BodyEdit {
  readonly from: number;
  readonly to: number;
  /** The words that must stand from..to. */
  readonly expect: string;
  /** What goes in their place. */
  readonly insert: string;
}

/** A note taken apart: the properties block at its top (with its "---" lines; "" when there is none) and the rest. */
export function splitBody(text: string): { readonly head: string; readonly body: string } {
  const body = stripFrontmatter(text);
  return { head: text.slice(0, text.length - body.length), body };
}

/**
 * Whether a list of changes can be applied to a text: at least one; each
 * names a stretch inside the text that holds exactly the words it expects;
 * no two overlap.
 */
export function editsFit(body: string, edits: readonly BodyEdit[]): boolean {
  if (edits.length === 0) return false;
  const sorted = [...edits].sort((a, b) => a.from - b.from);
  let end = 0;
  for (const edit of sorted) {
    if (!Number.isInteger(edit.from) || !Number.isInteger(edit.to)) return false;
    if (edit.from < end || edit.from >= edit.to || edit.to > body.length) return false;
    if (typeof edit.insert !== 'string' || body.slice(edit.from, edit.to) !== edit.expect) return false;
    end = edit.to;
  }
  return true;
}

/**
 * The text with the changes made, or null when they do not fit it (see
 * editsFit): then nothing at all is to be changed.
 */
export function applyBodyEdits(body: string, edits: readonly BodyEdit[]): string | null {
  if (!editsFit(body, edits)) return null;
  const sorted = [...edits].sort((a, b) => a.from - b.from);
  let result = '';
  let at = 0;
  for (const edit of sorted) {
    result += body.slice(at, edit.from) + edit.insert;
    at = edit.to;
  }
  return result + body.slice(at);
}

/**
 * A whole note with changes made to its text, its properties block kept
 * exactly as it is. Null when the text is no longer `expectedBody` (it was
 * changed since the search) or the changes do not fit it.
 */
export function applyToNote(note: string, expectedBody: string, edits: readonly BodyEdit[]): string | null {
  const { head, body } = splitBody(note);
  if (body !== expectedBody) return null;
  const changed = applyBodyEdits(body, edits);
  if (changed === null) return null;
  const result = head + changed;
  // A change that would make the text read as a properties block of its own (a note without one that would start with "---") is not made.
  if (splitBody(result).head !== head) return null;
  return result;
}

/** Whether a character has capitals at all (Latin, Greek, Cyrillic do; Hebrew does not). */
function hasCase(character: string): boolean {
  return character.toLowerCase() !== character.toUpperCase();
}

/**
 * The replacement for words found without "Match case", given the capitals
 * of the words it replaces:
 *   ALL CAPS found ("GULLS", two letters or more)   -> "SEABIRDS"
 *   a capital first letter found ("Gulls", "G")     -> "Seabirds"
 *   anything else ("gulls", "gULLS")                -> as typed
 * Only letters that have capitals count; words in a script without them
 * (Hebrew) leave the replacement as typed.
 */
export function withCaseOf(found: string, replacement: string): string {
  const cased = [...found].filter(hasCase);
  if (cased.length === 0) return replacement;
  const upper = (character: string): boolean => character === character.toUpperCase();
  if (cased.length >= 2 && cased.every(upper)) return replacement.toUpperCase();
  const firstFound = [...found].find((character) => /\p{L}/u.test(character)) ?? '';
  if (!hasCase(firstFound) || !upper(firstFound)) return replacement;
  const characters = [...replacement];
  // The first letter of the replacement, when it has a capital.
  const first = characters.findIndex((character) => /\p{L}/u.test(character));
  if (first < 0 || !hasCase(characters[first] ?? '')) return replacement;
  characters[first] = (characters[first] ?? '').toUpperCase();
  return characters.join('');
}
