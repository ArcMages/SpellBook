// The writing report engine: everything the report works out, with no screen
// and no vault. See stats.ts for what is measured and how it adds up.

export { ENGLISH_COMMON_WORDS, HEBREW_COMMON_WORDS, isCommonWord } from './commonWords';
export { formatShare, mostUsedWords } from './frequency';
export type { WordUse, WordUseOptions } from './frequency';
export { NARROW_BELOW, WIDE_FROM, isNarrowPane } from './layout';
export { proseBlocks, stripInline } from './prose';
export type { ProseBlock } from './prose';
export { foldersOf, resolveScope, sameScope, scenesUnder } from './scope';
export type { ReportScope, ScopeFolder, ScopeScene, ScopeSubject } from './scope';
export { countSentences, splitSentences } from './sentences';
export {
  DEFAULT_WORDS_PER_PAGE,
  LONG_WORD_LETTERS,
  MAX_WORDS_PER_PAGE,
  MIN_WORDS_PER_PAGE,
  addStats,
  analyzeText,
  dominantScript,
  emptyStats,
  figuresOf,
  fleschKincaidGrade,
  lixIndex,
  pagesFor,
  readWordsPerPage,
  readingGrade,
  wordKey,
  wordsOf,
} from './stats';
export type { DominantScript, ReadingGrade, ReportFigures, TextStats } from './stats';
export { countSyllables } from './syllables';
