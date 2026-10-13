// Cutting a paragraph into sentences, for English and for Hebrew.
//
// Both languages end a sentence with the same marks: a full stop, a question
// mark, an exclamation mark or an ellipsis, perhaps followed by a closing
// quotation mark or bracket. Not every full stop ends a sentence, though:
//   - "Dr. Levi", "Mrs. Cohen", "e.g. this": a title or an abbreviation;
//   - "J. R. R. Tolkien", and the same with Hebrew initials: a single letter;
//   - "3.14": a number (there is no space after the stop);
//   - '"Stop!" she said.': what follows goes on in lower case, so the
//     sentence is not over. (Hebrew has no capital letters, so there a
//     quotation that ends with a mark does count as a sentence.)
//
// No lookbehind is used: it stops the whole plugin from loading on older
// iPhones. The text before a mark is looked at by hand instead.

/** Marks that may end a sentence, with whatever closes a quotation or a bracket after them. */
const SENTENCE_END = /[.!?…]+["'”’»)\]׳״]*(?=\s|$)/gu;

/** Titles and the like that are written with a full stop but do not end a sentence. */
const ABBREVIATIONS = new Set([
  'mr',
  'mrs',
  'ms',
  'dr',
  'prof',
  'st',
  'mt',
  'jr',
  'sr',
  'vs',
  'gen',
  'col',
  'lt',
  'sgt',
  'capt',
  'rev',
  'hon',
]);

const HAS_WORD = /[\p{L}\p{N}]/u;
/** The last word before a mark, with the stops inside it ("e.g", "U.S"). */
const LAST_WORD = /([\p{L}\p{M}.]+)$/u;
const LOWER_CASE = /^\p{Ll}/u;
const UPPER_CASE = /^\p{Lu}$/u;
const HEBREW_LETTER = /^\p{Script=Hebrew}$/u;

/**
 * Whether the full stop after `before` belongs to a word (a title, an
 * abbreviation, an initial) instead of ending the sentence.
 */
function stopBelongsToWord(before: string): boolean {
  const word = LAST_WORD.exec(before)?.[1] ?? '';
  if (word === '') return false;
  const letters = [...word.replace(/\p{M}/gu, '')];
  if (letters.length === 1) {
    const letter = letters[0] ?? '';
    // An initial. "I" on its own is far more often the last word of a sentence.
    return HEBREW_LETTER.test(letter) || (UPPER_CASE.test(letter) && letter !== 'I');
  }
  // Letters with stops between them: "e.g", "i.e", "U.S".
  if (/^(?:\p{L}\.)+\p{L}$/u.test(word)) return true;
  return ABBREVIATIONS.has(word.toLowerCase());
}

/**
 * The sentences of a paragraph, in order. A piece without a single letter or
 * digit (a lone quotation mark, a row of dots) is not a sentence.
 *
 * @param text a paragraph without markup (see proseBlocks)
 */
export function splitSentences(text: string): string[] {
  const sentences: string[] = [];
  let start = 0;
  for (const match of text.matchAll(SENTENCE_END)) {
    const at = match.index ?? 0;
    const marks = match[0];
    const end = at + marks.length;
    const next = text.slice(end, end + 8).trimStart();
    // What follows goes on in lower case: the sentence is not over.
    if (LOWER_CASE.test(next)) continue;
    if (marks.startsWith('.') && !marks.startsWith('..') && next !== '' && stopBelongsToWord(text.slice(Math.max(start, at - 24), at))) {
      continue;
    }
    sentences.push(text.slice(start, end).trim());
    start = end;
  }
  const rest = text.slice(start).trim();
  if (rest !== '') sentences.push(rest);
  return sentences.filter((sentence) => HAS_WORD.test(sentence));
}

/** How many sentences a paragraph has. */
export function countSentences(text: string): number {
  return splitSentences(text).length;
}
