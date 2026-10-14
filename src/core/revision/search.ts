// Finding words in the text of a scene: what "Find and replace" and "Rename
// everywhere" look for.
//
// Three choices:
//   match case   "Anna" finds "Anna" and not "ANNA" (Hebrew has no capitals)
//   whole words  "art" finds "art" and not "start" or "artist". A word is a
//                run of letters, digits and marks, in any script: a Hebrew
//                word with a letter joined to its front ("הבית", "the house")
//                is another word than "בית" ("house"), and findInText does
//                not find it ("Find and replace" and "Rename everywhere" still
//                show it, unticked: see findWithJoined in rename.ts).
//   wildcards    "?" stands for one character and "*" for any characters on
//                the same line, as few as will do; a "*" at the start or the
//                end of what is looked for stands for the rest of the word:
//                "walk*" finds "walked" and "walking". No other character is
//                special: everything else is looked for as it is typed.
//
// Only the text that is handed in is searched: the callers hand in a scene's
// text without its properties, so that a replace can never reach them.

/** How a search is made. */
export interface SearchOptions {
  readonly matchCase: boolean;
  readonly wholeWords: boolean;
  readonly wildcards: boolean;
}

export const DEFAULT_SEARCH: SearchOptions = { matchCase: false, wholeWords: false, wildcards: false };

/** One place where the words were found. */
export interface TextMatch {
  /** Where it starts and ends in the text that was searched. */
  readonly from: number;
  readonly to: number;
  /** The words as they stand there. */
  readonly text: string;
}

/** The most matches one text gives, so that a search for "e" cannot freeze a phone. */
export const MAX_MATCHES_PER_TEXT = 2000;

const WORD = '[\\p{L}\\p{N}\\p{M}_]';
const WORD_CHAR = /[\p{L}\p{N}\p{M}_]/u;

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The regular expression a search is made with, or null when there is
 * nothing to look for. (The writer never types a regular expression: the
 * text is turned into one here.)
 */
export function patternOf(find: string, options: SearchOptions): RegExp | null {
  if (find === '') return null;
  let source = '';
  if (!options.wildcards) source = escape(find);
  else {
    const characters = [...find];
    characters.forEach((character, at) => {
      if (character === '?') source += '[^\\n]';
      else if (character === '*') {
        const atEdge = at === 0 || at === characters.length - 1;
        source += atEdge ? `${WORD}*` : '[^\\n]*?';
      } else source += escape(character);
    });
  }
  // Nothing but stars and question marks would find everything: not a search.
  if (options.wildcards && /^[*?]+$/.test(find)) return null;
  return new RegExp(source, options.matchCase ? 'gu' : 'giu');
}

/** The character that ends just before `at`, whole even when it is made of two units. */
function charBefore(text: string, at: number): string {
  if (at <= 0) return '';
  const low = text.charCodeAt(at - 1);
  const pair = at >= 2 && low >= 0xdc00 && low <= 0xdfff;
  return text.slice(at - (pair ? 2 : 1), at);
}

function charAt(text: string, at: number): string {
  return at >= text.length ? '' : String.fromCodePoint(text.codePointAt(at) as number);
}

/** Whether a character is part of a word: a letter, a digit or a mark, in any script. */
export function isWordChar(character: string): boolean {
  return character !== '' && WORD_CHAR.test(character);
}

/**
 * Whether the stretch from..to of a text is a whole word (or words): it does
 * not continue a word on either side. An edge that is not itself part of a
 * word ("Mr.") is not asked about.
 */
export function isWholeWord(text: string, from: number, to: number): boolean {
  if (from >= to) return false;
  const first = charAt(text, from);
  const last = charBefore(text, to);
  if (isWordChar(first) && isWordChar(charBefore(text, from))) return false;
  if (isWordChar(last) && isWordChar(charAt(text, to))) return false;
  return true;
}

/** Every place in a text where the words are found, in order and never overlapping. */
export function findInText(text: string, find: string, options: SearchOptions): TextMatch[] {
  const pattern = patternOf(find, options);
  if (!pattern) return [];
  const matches: TextMatch[] = [];
  pattern.lastIndex = 0;
  let found: RegExpExecArray | null;
  while ((found = pattern.exec(text)) !== null) {
    const from = found.index;
    const to = from + found[0].length;
    if (to === from) {
      pattern.lastIndex = from + 1;
      continue;
    }
    if (options.wholeWords && !isWholeWord(text, from, to)) {
      // Not a word of its own here: look again from the next character.
      pattern.lastIndex = from + 1;
      continue;
    }
    matches.push({ from, to, text: found[0] });
    if (matches.length >= MAX_MATCHES_PER_TEXT) break;
  }
  return matches;
}

/** The words around a match on its own line, to show it in a list. */
export interface MatchContext {
  readonly before: string;
  readonly match: string;
  readonly after: string;
  /** True when the line goes on beyond what is shown. */
  readonly cutBefore: boolean;
  readonly cutAfter: boolean;
  /** The number of the line it is on, from 1, in the text that was searched. */
  readonly line: number;
}

/** How much of the line is shown on each side of a match, in characters. */
export const CONTEXT_REACH = 40;

export function contextOf(text: string, from: number, to: number, reach = CONTEXT_REACH): MatchContext {
  const lineStart = text.lastIndexOf('\n', from - 1) + 1;
  const nextBreak = text.indexOf('\n', to);
  const lineEnd = nextBreak < 0 ? text.length : nextBreak;
  const start = Math.max(lineStart, from - reach);
  const end = Math.min(Math.max(lineEnd, to), to + reach);
  let line = 1;
  for (let at = text.indexOf('\n'); at >= 0 && at < from; at = text.indexOf('\n', at + 1)) line++;
  return {
    before: text.slice(start, from),
    match: text.slice(from, to),
    after: text.slice(to, end),
    cutBefore: start > lineStart,
    cutAfter: end < lineEnd,
    line,
  };
}
