// The checks that look at one line at a time: filler words, the passive
// voice, and the forms a word is compared under when repeated words are
// looked for. Each takes the words of a line (tokens.ts) and gives back
// places in that line.

import { tokenize } from './tokens';
import type { Token } from './tokens';
import type { WordType } from './tagger';
import {
  BETWEEN,
  BE_FORMS,
  COMMON_EN,
  COMMON_HE,
  DESCRIBING,
  FILLERS_EN,
  FILLERS_HE,
  HAVE_FORMS,
  HEBREW_PREFIXES,
  IRREGULAR_PARTICIPLES,
  NOT_PARTICIPLES,
} from './wordLists';

/** A stretch of a line that a check found, and the words in it. */
export interface Found {
  readonly from: number;
  readonly to: number;
  readonly text: string;
}

// ------------------------------------------------------------ filler words

/** The filler words and phrases to look for, by their first word; the longest phrase first. */
export type FillerList = ReadonlyMap<string, ReadonlyArray<readonly string[]>>;

/**
 * Make the list to look for: Spellbook's own English and Hebrew fillers, and
 * the writer's. An entry may be one word or a few; how it is written (capitals,
 * Hebrew points) does not matter.
 */
export function fillerList(own: readonly string[] = []): FillerList {
  const byFirst = new Map<string, string[][]>();
  const seen = new Set<string>();
  for (const entry of [...FILLERS_EN, ...FILLERS_HE, ...own]) {
    const words = tokenize(typeof entry === 'string' ? entry : '').map((token) => token.lower);
    const first = words[0];
    const key = words.join(' ');
    if (first === undefined || seen.has(key)) continue;
    seen.add(key);
    const phrases = byFirst.get(first);
    if (phrases) phrases.push(words);
    else byFirst.set(first, [words]);
  }
  for (const phrases of byFirst.values()) phrases.sort((a, b) => b.length - a.length);
  return byFirst;
}

/** Only white space between two words that follow each other. */
function adjoining(line: string, left: Token, right: Token): boolean {
  return !right.start && line.slice(left.to, right.from).trim() === '';
}

/** The filler words and phrases of a line. */
export function findFillers(line: string, tokens: readonly Token[], list: FillerList): Found[] {
  const found: Found[] = [];
  for (let at = 0; at < tokens.length; at++) {
    const token = tokens[at];
    if (!token || token.script === 'number') continue;
    let phrases = list.get(token.lower);
    // In Hebrew "and" is a letter in front of the word.
    if (!phrases && token.script === 'hebrew' && token.lower.length > 2 && token.lower.startsWith('ו')) {
      phrases = list.get(token.lower.slice(1));
    }
    if (!phrases) continue;
    for (const phrase of phrases) {
      let fits = at + phrase.length <= tokens.length;
      for (let step = 1; fits && step < phrase.length; step++) {
        const here = tokens[at + step];
        const before = tokens[at + step - 1];
        fits = here !== undefined && before !== undefined && here.lower === phrase[step] && adjoining(line, before, here);
      }
      if (!fits) continue;
      const last = tokens[at + phrase.length - 1] ?? token;
      found.push({ from: token.from, to: last.to, text: line.slice(token.from, last.to) });
      at += phrase.length - 1;
      break;
    }
  }
  return found;
}

// ----------------------------------------------------------- passive voice

function isParticiple(word: string): boolean {
  if (IRREGULAR_PARTICIPLES.has(word)) return true;
  return word.length > 3 && word.endsWith('ed') && !NOT_PARTICIPLES.has(word);
}

/** A form of "to be", also at the end of "they're" and "I'm". */
function isBeForm(word: string): boolean {
  return BE_FORMS.has(word) || word.endsWith("'re") || word.endsWith("'m");
}

/**
 * The passives of an English line: "was taken", "had been quietly removed",
 * "got caught". A word that mostly describes ("was tired") counts only when
 * "by" follows it.
 *
 * @param types what the tagger said of each word, where it was asked (it helps to see adverbs)
 */
export function findPassives(line: string, tokens: readonly Token[], types?: ReadonlyArray<WordType | null>): Found[] {
  const found: Found[] = [];
  for (let at = 0; at < tokens.length; at++) {
    const be = tokens[at];
    if (!be || be.script !== 'latin' || !isBeForm(be.lower)) continue;
    let next = at + 1;
    for (let skipped = 0; skipped < 3; skipped++) {
      const between = tokens[next];
      if (!between || between.broken || between.script !== 'latin') break;
      const adverb = BETWEEN.has(between.lower) || (between.lower.length > 4 && between.lower.endsWith('ly')) || types?.[next] === 'adverb';
      if (!adverb || isParticiple(between.lower)) break;
      next++;
    }
    const participle = tokens[next];
    if (!participle || participle.broken || participle.script !== 'latin' || !isParticiple(participle.lower)) continue;
    const after = tokens[next + 1];
    const byFollows = after !== undefined && !after.broken && after.lower === 'by';
    if (DESCRIBING.has(participle.lower) && !byFollows) continue;
    // "is supposed to", "was meant to", "got used to"
    if (after !== undefined && after.lower === 'to' && ['supposed', 'meant', 'bound', 'used', 'going'].includes(participle.lower)) continue;
    let first = be;
    const before = tokens[at - 1];
    if (before && !be.broken && (be.lower === 'been' || be.lower === 'being') && (HAVE_FORMS.has(before.lower) || isBeForm(before.lower))) {
      first = before;
    }
    found.push({ from: first.from, to: participle.to, text: line.slice(first.from, participle.to) });
    at = next;
  }
  return found;
}

// ---------------------------------------------------------- repeated words

/** The shortest word, and the shortest form of a word, that is compared. */
const SHORTEST_EN = 3;
const SHORTEST_STEM = 3;
const SHORTEST_HE = 3;
/** English words shorter than this are compared as they are, without taking their ending off. */
const STEMMED_FROM = 5;

function undouble(stem: string): string {
  return stem.length >= 3 && stem.charAt(stem.length - 1) === stem.charAt(stem.length - 2) ? stem.slice(0, -1) : stem;
}

/**
 * The forms under which a word is compared with the words near it. Two words
 * are the same word when they share a form. The first form is the word itself.
 * An empty list: the word is too short or too common to count.
 *
 * English: the word, and the word without "-s", "-ed", "-ing" or "'s"
 * ("tides" and "tide", "making" and "make").
 *
 * Hebrew: the word, and the word without the letters attached to its front
 * (and, the, in, to, from, that, as): one letter, or two when the first is
 * "and", "that" or "as". At least three letters must be left. So "הגלים",
 * "והגלים" and "בגלים" are all the same word as "גלים".
 */
export function repeatForms(token: Token): string[] {
  const word = token.lower;
  if (token.script === 'hebrew') {
    if (word.length < SHORTEST_HE || COMMON_HE.has(word)) return [];
    const forms = [word];
    if (!HEBREW_PREFIXES.includes(word.charAt(0))) return forms;
    const one = word.slice(1);
    const two = 'ושכ'.includes(word.charAt(0)) && HEBREW_PREFIXES.includes(word.charAt(1)) ? word.slice(2) : '';
    // "and he", "that not": a small word with a letter in front is still a small word.
    if (COMMON_HE.has(one) || COMMON_HE.has(two)) return [];
    if (one.length >= SHORTEST_HE) forms.push(one);
    if (two.length >= SHORTEST_HE) forms.push(two);
    return forms;
  }
  if (token.script === 'number') return [];
  let base = word;
  if (base.endsWith("'s")) base = base.slice(0, -2);
  else if (base.endsWith("'")) base = base.slice(0, -1);
  // "don't" and "she'd" are small words in disguise.
  if (base.length < SHORTEST_EN || base.includes("'") || COMMON_EN.has(base)) return [];
  if (token.script !== 'latin' || base.length < STEMMED_FROM) return [base];
  const forms = new Set([base]);
  const stem = (form: string): void => {
    if (form.length >= SHORTEST_STEM && !COMMON_EN.has(form)) forms.add(form);
  };
  if (base.endsWith('ies')) stem(`${base.slice(0, -3)}y`);
  if (base.endsWith('es')) stem(base.slice(0, -2));
  if (base.endsWith('s') && !base.endsWith('ss')) stem(base.slice(0, -1));
  if (base.endsWith('ied')) stem(`${base.slice(0, -3)}y`);
  if (base.endsWith('ed')) {
    stem(base.slice(0, -2));
    stem(base.slice(0, -1));
    stem(undouble(base.slice(0, -2)));
  }
  if (base.endsWith('ing')) {
    stem(base.slice(0, -3));
    stem(`${base.slice(0, -3)}e`);
    stem(undouble(base.slice(0, -3)));
  }
  return [...forms];
}
