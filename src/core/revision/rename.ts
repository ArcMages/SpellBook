// "Rename everywhere": where an entity's old name stands in the text of the
// manuscript, so that the writer can tick the places it is to be changed.
//
// The name is looked for as it is written (capitals count) and as a whole
// word. A Hebrew name is also found behind the short words Hebrew joins to
// its front ("ו", "ה", "ב", "ל", "מ", "ש", "כ": one or two of them): only the
// name itself is changed there, the joined letters stay. Those places are
// offered unticked, since a joined letter can also make another word.
//
// Links to the entity ("[[Mara]]", "[[Mara|the keeper]]") are not listed by
// their target: renaming the note brings those up to date by itself. What a
// link shows after "|" is the writer's text, and is listed.

import { sanitiseFileName } from '../names';
import { findInText, isWordChar } from './search';
import type { TextMatch } from './search';

/** The Hebrew letters that are joined to the front of a word as a short word of their own. */
const HEBREW_PREFIXES = 'והבלמשכ';
const HEBREW_LETTER = /[א-ת]/;

/** A place where the old name stands. */
export interface NameOccurrence extends TextMatch {
  /** True when one or two Hebrew letters are joined to its front (offered unticked). */
  readonly joined: boolean;
}

/** The stretches of a text that are link targets: "Mara" in "[[Mara]]" or "[[Mara|the keeper]]" or "[[Mara#Youth]]". */
export function linkTargets(text: string): Array<{ from: number; to: number }> {
  const ranges: Array<{ from: number; to: number }> = [];
  const link = /!?\[\[([^\]\n]*)\]\]/g;
  let found: RegExpExecArray | null;
  while ((found = link.exec(text)) !== null) {
    const inner = found[1] ?? '';
    const start = found.index + found[0].indexOf('[[') + 2;
    const bar = inner.indexOf('|');
    ranges.push({ from: start, to: start + (bar < 0 ? inner.length : bar) });
  }
  return ranges;
}

function inside(ranges: ReadonlyArray<{ from: number; to: number }>, from: number, to: number): boolean {
  return ranges.some((range) => from >= range.from && to <= range.to);
}

/** Whether one or two joined Hebrew letters, with the start of a word before them, stand just before `at`. */
function joinedBefore(text: string, at: number): boolean {
  for (let taken = 1; taken <= 2; taken++) {
    const letter = text.charAt(at - taken);
    if (letter === '' || !HEBREW_PREFIXES.includes(letter)) return false;
    if (!isWordChar(text.charAt(at - taken - 1))) return true;
  }
  return false;
}

/** Every place in a text where a name stands, in order. */
export function nameOccurrences(text: string, name: string): NameOccurrence[] {
  const wanted = name.trim();
  if (wanted === '') return [];
  const links = linkTargets(text);
  const found: NameOccurrence[] = findInText(text, wanted, { matchCase: true, wholeWords: true, wildcards: false })
    .filter((match) => !inside(links, match.from, match.to))
    .map((match) => ({ ...match, joined: false }));
  if (HEBREW_LETTER.test(wanted.charAt(0))) {
    // The name with letters joined to its front: everywhere it stands, a word's end after it.
    for (const match of findInText(text, wanted, { matchCase: true, wholeWords: false, wildcards: false })) {
      if (found.some((other) => other.from === match.from)) continue;
      if (isWordChar(text.charAt(match.to)) || !joinedBefore(text, match.from)) continue;
      if (inside(links, match.from, match.to)) continue;
      found.push({ ...match, joined: true });
    }
    found.sort((a, b) => a.from - b.from);
  }
  return found;
}

/** Why a new name will not do, or null when it will. */
export function newNameProblem(oldName: string, newName: string): string | null {
  const name = newName.trim();
  if (name === '') return 'Type the new name.';
  if (name === oldName) return 'That is the name it has now.';
  if (sanitiseFileName(name, '') !== name) return 'A name cannot hold any of these: \\ / : * ? " < > | # ^ [ ] and cannot start with a dot.';
  return null;
}
