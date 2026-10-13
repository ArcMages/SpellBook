// "Find mentions": the scenes whose text names an entity without listing it.
//
// A mention is the entity's name, or one of its other names (its "aliases"),
// standing as a word of its own in the text of a scene: "Mara" is found in
// "Mara's lamp" and not in "Tamara". Capitals do not matter. A Hebrew name is
// also found behind the short words Hebrew joins to it ("and", "to", "the",
// "in", "from", "that", "as"): one or two of those letters in front of the
// name are still the name.
//
// A mention is only ever offered. Nothing is linked until the writer says so.

import { stripFrontmatter } from '../wordCount';
import type { Entity } from './entity';

/** A name shorter than this many characters is not looked for: it would be found everywhere. */
export const MIN_MENTION_LENGTH = 2;

/** How much of the text around a mention is shown, on each side, in characters. */
export const SNIPPET_REACH = 40;

/** The Hebrew letters that are joined to the front of a word as a short word of their own. */
const HEBREW_PREFIXES = 'והבלמשכ';

const LETTER = /[\p{L}\p{N}\p{M}_]/u;
const HEBREW_LETTER = /[א-ת]/;

/** The names an entity is looked for by: its own and its other names, longest first. */
export function mentionNames(entity: Pick<Entity, 'name' | 'aliases'>): string[] {
  const names: string[] = [];
  for (const raw of [entity.name, ...entity.aliases]) {
    const name = raw.normalize('NFC').trim();
    if ([...name].length < MIN_MENTION_LENGTH) continue;
    if (!names.some((other) => other.toLocaleLowerCase() === name.toLocaleLowerCase())) names.push(name);
  }
  return names.sort((a, b) => b.length - a.length);
}

/** The character that ends just before `at`, whole even when it is made of two units. */
function before(text: string, at: number): string {
  if (at <= 0) return '';
  const low = text.charCodeAt(at - 1);
  const pair = at >= 2 && low >= 0xdc00 && low <= 0xdfff;
  return text.slice(at - (pair ? 2 : 1), at);
}

/** The character that starts at `at`. */
function after(text: string, at: number): string {
  return at >= text.length ? '' : String.fromCodePoint(text.codePointAt(at) as number);
}

function isLetter(character: string): boolean {
  return character !== '' && LETTER.test(character);
}

/** Whether a word may start at `at`: nothing, or something that is not a letter, comes before it. */
function startsWord(text: string, at: number, hebrew: boolean): boolean {
  if (!isLetter(before(text, at))) return true;
  if (!hebrew) return false;
  // One or two joined letters in front of a Hebrew name, and a word's start before those.
  for (let taken = 1; taken <= 2; taken++) {
    const letter = text.charAt(at - taken);
    if (letter === '' || !HEBREW_PREFIXES.includes(letter)) return false;
    if (!isLetter(before(text, at - taken))) return true;
  }
  return false;
}

/** A place in a text where one of the names stands. */
export interface Mention {
  /** Where the name starts, in the text that was searched. */
  readonly index: number;
  /** The name as it is written there. */
  readonly found: string;
}

/**
 * The first place in a text where one of the names stands as a word of its
 * own, or null. The text is searched as it is: hand it a scene's text
 * without its properties (see sceneMention).
 */
export function findMention(text: string, names: readonly string[]): Mention | null {
  const hay = text.toLocaleLowerCase();
  // Lower case may change a text's length in a few languages; then the places would not match.
  const sameLength = hay.length === text.length;
  let best: Mention | null = null;
  for (const name of names) {
    const needle = name.toLocaleLowerCase();
    if (needle === '') continue;
    const hebrew = HEBREW_LETTER.test(needle.charAt(0));
    for (let at = hay.indexOf(needle); at >= 0; at = hay.indexOf(needle, at + 1)) {
      if (best !== null && at >= best.index) break;
      if (isLetter(after(hay, at + needle.length)) || !startsWord(hay, at, hebrew)) continue;
      best = { index: at, found: sameLength ? text.slice(at, at + needle.length) : name };
      break;
    }
  }
  return best;
}

/** A mention with the text around it, for showing. */
export interface MentionSnippet {
  /** The text before the name, starting with "..." when it was cut. */
  readonly before: string;
  readonly found: string;
  readonly after: string;
}

/** The line a mention stands in, cut to a few words on each side. */
export function snippetAround(text: string, mention: Mention): MentionSnippet {
  const end = mention.index + mention.found.length;
  const lineStart = text.lastIndexOf('\n', mention.index - 1) + 1;
  const lineBreak = text.indexOf('\n', end);
  const lineEnd = lineBreak < 0 ? text.length : lineBreak;
  let from = Math.max(lineStart, mention.index - SNIPPET_REACH);
  let to = Math.min(lineEnd, end + SNIPPET_REACH);
  // Not in the middle of a word, where that can be helped.
  if (from > lineStart) {
    const space = text.indexOf(' ', from);
    if (space >= 0 && space < mention.index) from = space + 1;
  }
  if (to < lineEnd) {
    const space = text.lastIndexOf(' ', to);
    if (space > end) to = space;
  }
  return {
    before: (from > lineStart ? '...' : '') + text.slice(from, mention.index),
    found: text.slice(mention.index, end),
    after: text.slice(end, to) + (to < lineEnd ? '...' : ''),
  };
}

/**
 * Where a scene's text first names an entity, with the text around it; null
 * when it does not. The properties block at the top of the note is not text.
 *
 * @param noteText the whole text of the scene's note
 */
export function sceneMention(noteText: string, names: readonly string[]): MentionSnippet | null {
  if (names.length === 0) return null;
  const body = stripFrontmatter(noteText).normalize('NFC');
  const mention = findMention(body, names);
  return mention === null ? null : snippetAround(body, mention);
}
