// Turning a title typed by the writer into a file or folder name that
// Obsidian, macOS, iOS and iCloud all accept.

import { clashKey } from './paths';

/** Used when nothing usable is left of a title. */
export const DEFAULT_NAME = 'Untitled';

/**
 * Longest name we create, in bytes of UTF-8. File systems allow 255; this
 * leaves room for " 12" and ".md". Hebrew letters take 2 bytes each, Chinese
 * and Japanese 3, so this is about 100 Hebrew or 66 Chinese characters.
 */
export const MAX_NAME_BYTES = 200;

// Characters Obsidian or iOS reject in a file name:  \ / : * ? " < > |  and  # ^ [ ]
// (the last four break Obsidian links). Each becomes a space, so that
// "Either/Or" turns into "Either Or" rather than "EitherOr".
const FORBIDDEN = /[\\/:*?"<>|#^[\]]/g;

// Every kind of space and line break, including the non-breaking spaces that
// Obsidian turns into ordinary spaces anyway.
const SPACES = /\s+/g;

// Invisible characters that have no place in a file name: control characters,
// and the direction marks that can ride along when right-to-left text is pasted.
const INVISIBLE = /[\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;

function utf8Length(codePoint: number): number {
  if (codePoint < 0x80) return 1;
  if (codePoint < 0x800) return 2;
  if (codePoint < 0x10000) return 3;
  return 4;
}

/** Cut a name to at most `maxBytes` of UTF-8 without splitting a character. */
function truncateToBytes(name: string, maxBytes: number): string {
  let bytes = 0;
  let out = '';
  for (const character of name) {
    bytes += utf8Length(character.codePointAt(0) as number);
    if (bytes > maxBytes) break;
    out += character;
  }
  return out;
}

function trimEdges(name: string): string {
  // No leading dot (it would hide the file) and no trailing dot or space.
  return name.replace(/^[. ]+/, '').replace(/[. ]+$/, '');
}

/**
 * Clean a title into a file name (without ".md").
 *
 * Takes out the characters that are not allowed, tidies spaces, and never
 * returns an empty name. Letters in any language are kept as typed.
 */
export function sanitiseFileName(raw: string, fallback: string = DEFAULT_NAME): string {
  const spaced = raw
    .normalize('NFC')
    .replace(FORBIDDEN, ' ')
    .replace(SPACES, ' ')
    .replace(INVISIBLE, '')
    .replace(SPACES, ' ');
  const name = trimEdges(truncateToBytes(trimEdges(spaced), MAX_NAME_BYTES));
  return name === '' ? fallback : name;
}

/**
 * Tidy a display name (a project title or a binder folder name). These are
 * free text in any language, but a line break or a run of spaces helps nobody.
 */
export function tidyDisplayName(name: string): string {
  return name.replace(/\s+/g, ' ').trim();
}

/**
 * Make a name unique by adding " 2", " 3" and so on.
 *
 * @param base    the wanted name
 * @param isTaken tells whether a candidate name is already in use
 */
export function uniqueName(base: string, isTaken: (candidate: string) => boolean): string {
  if (!isTaken(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base} ${n}`;
    if (!isTaken(candidate)) return candidate;
  }
}

/** True when two names would be the same file on a phone or a Mac. */
export function sameName(a: string, b: string): boolean {
  return clashKey(a) === clashKey(b);
}

/**
 * A short random id for a new binder folder, such as "f-k3x9q2".
 *
 * @param random returns a number from 0 up to (not including) 1
 * @param taken  ids already used in the project
 */
export function newFolderId(random: () => number, taken: ReadonlySet<string>): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  for (let attempt = 0; ; attempt++) {
    let id = 'f-';
    for (let i = 0; i < 6; i++) {
      const pick = Math.floor(random() * alphabet.length);
      id += alphabet[Math.max(0, Math.min(alphabet.length - 1, pick))] as string;
    }
    // After many clashes (a stuck random source) add a counter instead of looping forever.
    if (attempt >= 20) id += `-${attempt}`;
    if (!taken.has(id)) return id;
  }
}
