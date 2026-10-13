// The list of most used words.

import { isCommonWord } from './commonWords';

/** One line of the list. */
export interface WordUse {
  /** The word, in lower case: the writer's own text. */
  readonly word: string;
  readonly count: number;
  /** Its part of all the words of the text, from 0 to 1. */
  readonly share: number;
}

export interface WordUseOptions {
  /** Whether the common words ("the", "and") are listed too. Default: they are left out. */
  readonly includeCommon?: boolean;
}

/**
 * The words of a text, the most used first. Words that are used equally often
 * stand in the order of the alphabet, so the list is the same every time.
 *
 * @param frequency how often each word occurs (see TextStats)
 */
export function mostUsedWords(frequency: ReadonlyMap<string, number>, options: WordUseOptions = {}): WordUse[] {
  let all = 0;
  for (const count of frequency.values()) all += count;
  const uses: WordUse[] = [];
  for (const [word, count] of frequency) {
    if (options.includeCommon !== true && isCommonWord(word)) continue;
    uses.push({ word, count, share: count / all });
  }
  return uses.sort((a, b) => b.count - a.count || (a.word < b.word ? -1 : a.word > b.word ? 1 : 0));
}

/** A share as the list shows it: "4.2%", and "under 0.1%" for a word that is rare but there. */
export function formatShare(share: number): string {
  if (!(share > 0)) return '0%';
  const percent = share * 100;
  if (percent < 0.05) return 'under 0.1%';
  return `${percent.toFixed(1)}%`;
}
