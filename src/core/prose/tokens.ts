// Cutting a line into words and sentences, in English and in Hebrew.
//
// A word is a run of letters. In English it may hold an apostrophe or a
// hyphen ("don't", "well-known"); in Hebrew it may hold a geresh or a
// gershayim, so that an acronym stays one word. Hebrew points (niqqud) belong
// to the word, and are left out when two words are compared. Each word knows
// which alphabet it is written in, so that a line which mixes the two
// languages gets the English checks on its English words only.
//
// The line is expected with its Markdown already blanked out (see mask.ts).

export type Script = 'latin' | 'hebrew' | 'other' | 'number';

export interface Token {
  /** The word as it is written. */
  readonly text: string;
  /** The word for comparing: lower case, a straight apostrophe, and Hebrew without its points. */
  readonly lower: string;
  readonly from: number;
  readonly to: number;
  readonly script: Script;
  /** Whether the word begins a sentence. */
  start: boolean;
  /** Whether a comma, a dash, a quote mark or the like stands between the word before and this one. */
  broken: boolean;
}

/** One sentence of a line: its first and last word, and how many words it has. */
export interface Sentence {
  /** The index of its first token, and of the one after its last. */
  readonly first: number;
  readonly end: number;
  readonly from: number;
  readonly to: number;
  readonly words: number;
}

const HEBREW_LETTER = '\\u05D0-\\u05EA';
const HEBREW_POINT = '\\u0591-\\u05BD\\u05BF\\u05C1\\u05C2\\u05C4\\u05C5\\u05C7';
const HEBREW_PART = `[${HEBREW_LETTER}][${HEBREW_LETTER}${HEBREW_POINT}]*`;
const HEBREW_WORD = `${HEBREW_PART}(?:["'\\u05F3\\u05F4\\u2019]${HEBREW_PART})*\\u05F3?`;
const OTHER_WORD = "\\p{L}[\\p{L}\\p{M}]*(?:['\\u2019-][\\p{L}\\p{M}]+)*";
const NUMBER = '\\p{N}+(?:[.,:]\\p{N}+)*';
const WORD = new RegExp(`${HEBREW_WORD}|${OTHER_WORD}|${NUMBER}`, 'gu');

const POINTS = new RegExp(`[${HEBREW_POINT}]`, 'g');
const LATIN = /^[A-Za-z\u00C0-\u024F]/;
const DIGIT = /^\p{N}/u;

/** What ends a sentence, and what only breaks a clause. */
const SENTENCE_END = /[.!?\u2026]/;
const CLAUSE_BREAK = /[,;:()[\]"\u201C\u201D\u2014\u2013\u05BE]|--| - /;

/** Short forms that end in a full stop without ending the sentence. */
const SHORT_FORMS = new Set(
  'mr mrs ms dr prof st sr jr mt vs etc no vol fig gen col capt lt sgt rev hon inc ltd co approx ca cf eg ie'.split(' '),
);

function scriptOf(word: string): Script {
  const code = word.charCodeAt(0);
  if (code >= 0x0590 && code <= 0x05ff) return 'hebrew';
  if (LATIN.test(word)) return 'latin';
  if (DIGIT.test(word)) return 'number';
  return 'other';
}

/** A word as it is compared with other words. */
export function normalWord(word: string): string {
  const code = word.charCodeAt(0);
  if (code >= 0x0590 && code <= 0x05ff) {
    return word.replace(POINTS, '').replace(/[\u05F3\u2019]/g, "'").replace(/\u05F4/g, '"');
  }
  return word.toLowerCase().replace(/\u2019/g, "'");
}

/** Whether a word begins with a lower-case letter (Hebrew has no cases: never). */
function startsLower(word: string): boolean {
  const first = word.charAt(0);
  return first !== first.toUpperCase() && first === first.toLowerCase();
}

/**
 * The words of a line, in order, each marked with whether it begins a
 * sentence and whether punctuation parts it from the word before.
 */
export function tokenize(line: string): Token[] {
  const tokens: Token[] = [];
  WORD.lastIndex = 0;
  let previous: Token | null = null;
  for (let match = WORD.exec(line); match !== null; match = WORD.exec(line)) {
    const text = match[0];
    const from = match.index;
    const script = scriptOf(text);
    let start = previous === null;
    let broken = false;
    if (previous !== null) {
      const gap = line.slice(previous.to, from);
      broken = CLAUSE_BREAK.test(gap);
      if (SENTENCE_END.test(gap)) {
        // "Stop!" she said. and wait... what? go on in the same sentence.
        const goesOn = script === 'latin' && startsLower(text);
        // "Mr. Hale" and "J. R. Hale": a full stop after a short form or an initial ends nothing.
        const shortForm =
          !/[!?\u2026]/.test(gap) &&
          !gap.includes('..') &&
          previous.script === 'latin' &&
          (SHORT_FORMS.has(previous.lower) || (previous.text.length === 1 && previous.text !== 'I' && previous.text !== 'a'));
        start = !goesOn && !shortForm;
        broken = broken || !start;
      }
    }
    const token: Token = { text, lower: normalWord(text), from, to: from + text.length, script, start, broken: broken || start };
    tokens.push(token);
    previous = token;
  }
  return tokens;
}

/** The sentences of a line, from its tokens. */
export function sentencesOf(tokens: readonly Token[]): Sentence[] {
  const sentences: Sentence[] = [];
  let first = 0;
  for (let at = 1; at <= tokens.length; at++) {
    if (at < tokens.length && tokens[at]?.start !== true) continue;
    const head = tokens[first];
    const tail = tokens[at - 1];
    if (head && tail) sentences.push({ first, end: at, from: head.from, to: tail.to, words: at - first });
    first = at;
  }
  return sentences;
}
