// The figures of the writing report: measuring one note, adding notes up, and
// working out pages, reading time and the reading grade.
//
// One note is measured into a TextStats. Everything in it is a sum, so the
// figures of a chapter or of the whole manuscript are the sums of its scenes;
// averages and the reading grade are then worked out from the sums (never by
// averaging the grades of the scenes).
//
// Words are counted by the plugin's one word counter (src/core/wordCount.ts),
// on the same text the binder and the outliner count, so the report always
// agrees with them. Reading time comes from the outliner's own rule.

import { formatReadTime } from '../outliner/readTime';
import { WORD_HYPHENS, countWords, defaultSegmenter } from '../wordCount';
import type { WordSegmenter } from '../wordCount';
import { proseBlocks } from './prose';
import { countSentences } from './sentences';
import { countSyllables } from './syllables';

/** How many words go on a page unless the writer says otherwise. */
export const DEFAULT_WORDS_PER_PAGE = 250;
export const MIN_WORDS_PER_PAGE = 50;
export const MAX_WORDS_PER_PAGE = 2000;

/** A word with more letters than this is a long word (for the LIX index). */
export const LONG_WORD_LETTERS = 6;

/** What was measured in a text. Every number is a sum, so two of these add up. */
export interface TextStats {
  /** Words, as the binder counts them. */
  words: number;
  /** Characters of the prose, spaces between words included. */
  characters: number;
  charactersNoSpaces: number;
  sentences: number;
  paragraphs: number;
  /** The words that stand in sentences (headings are not sentences). */
  sentenceWords: number;
  /** The letters of those words. */
  sentenceLetters: number;
  /** How many of those words have more than six letters. */
  longWords: number;
  /** How many of those words are written in Latin letters, and their syllables. */
  latinWords: number;
  latinSyllables: number;
  /** The letters of each script in the whole prose: they say which language the text is in. */
  latinLetters: number;
  hebrewLetters: number;
  /** How often each word occurs, by the word in lower case. */
  frequency: Map<string, number>;
}

export function emptyStats(): TextStats {
  return {
    words: 0,
    characters: 0,
    charactersNoSpaces: 0,
    sentences: 0,
    paragraphs: 0,
    sentenceWords: 0,
    sentenceLetters: 0,
    longWords: 0,
    latinWords: 0,
    latinSyllables: 0,
    latinLetters: 0,
    hebrewLetters: 0,
    frequency: new Map(),
  };
}

/** Add what was measured in one text to a running total. The total is changed and handed back. */
export function addStats(total: TextStats, part: TextStats): TextStats {
  total.words += part.words;
  total.characters += part.characters;
  total.charactersNoSpaces += part.charactersNoSpaces;
  total.sentences += part.sentences;
  total.paragraphs += part.paragraphs;
  total.sentenceWords += part.sentenceWords;
  total.sentenceLetters += part.sentenceLetters;
  total.longWords += part.longWords;
  total.latinWords += part.latinWords;
  total.latinSyllables += part.latinSyllables;
  total.latinLetters += part.latinLetters;
  total.hebrewLetters += part.hebrewLetters;
  for (const [word, count] of part.frequency) total.frequency.set(word, (total.frequency.get(word) ?? 0) + count);
  return total;
}

// The pattern for a device without Intl.Segmenter. It follows the fallback of
// the word counter: every Chinese character and Japanese kana is a word;
// otherwise a word is a run of letters, digits and accent marks, which may be
// joined by one apostrophe, hyphen, dot or underscore.
const SPACELESS = '[\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}]';
const WORD_CHARACTER = `(?:(?!${SPACELESS})[\\p{L}\\p{N}\\p{M}])`;
const JOINERS = `'._\\-${String.fromCharCode(0x2010, 0x2011, 0x2019, 0x05f3, 0x05f4)}`;
const FALLBACK_WORD = new RegExp(`${SPACELESS}|${WORD_CHARACTER}+(?:[${JOINERS}]${WORD_CHARACTER}+)*`, 'gu');

/**
 * The words of a text without markup, in order, cut the way the word counter
 * cuts them.
 *
 * @param segmenter the word segmenter to use; pass null to force the fallback pattern
 */
export function wordsOf(text: string, segmenter: WordSegmenter | null = defaultSegmenter()): string[] {
  if (segmenter === null) return text.match(FALLBACK_WORD) ?? [];
  const words: string[] = [];
  // A hyphenated word is one word, as the word counter has it: its parts are joined again.
  let afterWord = false;
  let hyphen: string | null = null;
  for (const part of segmenter.segment(text)) {
    if (part.isWordLike) {
      if (hyphen !== null && words.length > 0) words[words.length - 1] += hyphen + part.segment;
      else words.push(part.segment);
      afterWord = true;
      hyphen = null;
    } else {
      hyphen = afterWord && WORD_HYPHENS.has(part.segment) ? part.segment : null;
      afterWord = false;
    }
  }
  return words;
}

const MARKS = /\p{M}/gu;
const SPACES = /\s/gu;
const LETTERS = /\p{L}/gu;
const LATIN = /\p{Script=Latin}/gu;
const HEBREW = /\p{Script=Hebrew}/gu;
/** The points and accents written above and below Hebrew letters (niqqud and cantillation). */
const HEBREW_POINTS = /[֑-ׇֽֿׁׂׅׄ]/g;
const STARTS_WITH_DIGIT = /^\p{N}/u;

const countOf = (text: string, pattern: RegExp): number => text.match(pattern)?.length ?? 0;

/**
 * A word as the list of most used words knows it: in lower case, without
 * Hebrew points, with a straight apostrophe. Empty for what is not listed (a number).
 */
export function wordKey(word: string): string {
  if (STARTS_WITH_DIGIT.test(word)) return '';
  return word.toLowerCase().replace(HEBREW_POINTS, '').replace(/’/g, "'");
}

/**
 * Measure one note.
 *
 * @param markdown  the whole note, as stored
 * @param segmenter the word segmenter to use; pass null to force the fallback pattern
 */
export function analyzeText(markdown: string, segmenter: WordSegmenter | null = defaultSegmenter()): TextStats {
  const stats = emptyStats();
  stats.words = countWords(markdown, segmenter);
  for (const block of proseBlocks(markdown)) {
    // A letter with its points or its accent is one character to a reader.
    const seen = block.text.replace(MARKS, '');
    const length = [...seen].length;
    stats.characters += length;
    stats.charactersNoSpaces += length - countOf(seen, SPACES);
    stats.latinLetters += countOf(seen, LATIN);
    stats.hebrewLetters += countOf(seen, HEBREW);

    const words = wordsOf(block.text, segmenter);
    for (const word of words) {
      const key = wordKey(word);
      if (key !== '') stats.frequency.set(key, (stats.frequency.get(key) ?? 0) + 1);
    }
    if (block.kind !== 'paragraph') continue;

    stats.paragraphs++;
    stats.sentences += countSentences(block.text);
    for (const word of words) {
      const letters = countOf(word, LETTERS);
      stats.sentenceWords++;
      stats.sentenceLetters += letters;
      if (letters > LONG_WORD_LETTERS) stats.longWords++;
      if (countOf(word, LATIN) > 0) {
        stats.latinWords++;
        stats.latinSyllables += countSyllables(word);
      }
    }
  }
  return stats;
}

// ------------------------------------------------------------ pages and time

/**
 * What was typed or stored as the words on a page: a whole number within
 * sensible bounds, or null when it is not one.
 */
export function parseWordsPerPage(value: unknown): number | null {
  const number = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : Number.NaN;
  if (!Number.isFinite(number)) return null;
  const whole = Math.round(number);
  return whole < MIN_WORDS_PER_PAGE || whole > MAX_WORDS_PER_PAGE ? null : whole;
}

/** The words on a page to go by: what was stored when that is a sensible number, or the default. */
export function readWordsPerPage(value: unknown): number {
  return parseWordsPerPage(value) ?? DEFAULT_WORDS_PER_PAGE;
}

/** The pages a number of words fills: a page that was begun counts as a page. */
export function pagesFor(words: number, wordsPerPage: number = DEFAULT_WORDS_PER_PAGE): number {
  if (!(words > 0)) return 0;
  return Math.ceil(words / readWordsPerPage(wordsPerPage));
}

// ------------------------------------------------------------- reading grade

/** The script most of a text is written in; null when it has neither Hebrew nor Latin letters. */
export type DominantScript = 'latin' | 'hebrew' | null;

export function dominantScript(stats: Pick<TextStats, 'latinLetters' | 'hebrewLetters'>): DominantScript {
  if (stats.hebrewLetters > stats.latinLetters) return 'hebrew';
  return stats.latinLetters > 0 ? 'latin' : null;
}

/** How hard a text is to read, by the measure that fits its language. */
export type ReadingGrade =
  /** English: the Flesch-Kincaid grade level, a school year in the United States. */
  | { readonly kind: 'english'; readonly grade: number }
  /** Hebrew: the LIX index, an approximate measure and not a school year. */
  | { readonly kind: 'hebrew'; readonly lix: number; readonly longWordShare: number }
  /** Nothing to go by: no sentence, or a text in neither language. */
  | { readonly kind: 'none' };

/**
 * The Flesch-Kincaid grade level: 0.39 x words per sentence + 11.8 x
 * syllables per word - 15.59. Never below 0.
 */
export function fleschKincaidGrade(wordsPerSentence: number, syllablesPerWord: number): number {
  return Math.max(0, 0.39 * wordsPerSentence + 11.8 * syllablesPerWord - 15.59);
}

/** The LIX index: words per sentence + the long words out of every hundred words. */
export function lixIndex(wordsPerSentence: number, longWordShare: number): number {
  return wordsPerSentence + 100 * longWordShare;
}

/**
 * The reading grade of what was measured. The text is judged by the script
 * most of it is written in: an English formula says nothing about Hebrew.
 */
export function readingGrade(stats: TextStats): ReadingGrade {
  if (stats.sentences === 0 || stats.sentenceWords === 0) return { kind: 'none' };
  const wordsPerSentence = stats.sentenceWords / stats.sentences;
  const script = dominantScript(stats);
  if (script === 'hebrew') {
    const longWordShare = stats.longWords / stats.sentenceWords;
    return { kind: 'hebrew', lix: lixIndex(wordsPerSentence, longWordShare), longWordShare };
  }
  if (script === 'latin' && stats.latinWords > 0) {
    return { kind: 'english', grade: fleschKincaidGrade(wordsPerSentence, stats.latinSyllables / stats.latinWords) };
  }
  return { kind: 'none' };
}

// -------------------------------------------------------------- the figures

/** Everything the report shows about a text, worked out from what was measured. */
export interface ReportFigures {
  readonly words: number;
  readonly characters: number;
  readonly charactersNoSpaces: number;
  readonly sentences: number;
  readonly paragraphs: number;
  readonly pages: number;
  /** As the outliner writes it: "9 min", "1 h 52 min". */
  readonly readTime: string;
  readonly grade: ReadingGrade;
  /** Null when there is no sentence to go by. */
  readonly wordsPerSentence: number | null;
  readonly lettersPerWord: number | null;
}

export function figuresOf(stats: TextStats, wordsPerPage: number = DEFAULT_WORDS_PER_PAGE): ReportFigures {
  const measured = stats.sentences > 0 && stats.sentenceWords > 0;
  return {
    words: stats.words,
    characters: stats.characters,
    charactersNoSpaces: stats.charactersNoSpaces,
    sentences: stats.sentences,
    paragraphs: stats.paragraphs,
    pages: pagesFor(stats.words, wordsPerPage),
    readTime: formatReadTime(stats.words),
    grade: readingGrade(stats),
    wordsPerSentence: measured ? stats.sentenceWords / stats.sentences : null,
    lettersPerWord: measured ? stats.sentenceLetters / stats.sentenceWords : null,
  };
}
