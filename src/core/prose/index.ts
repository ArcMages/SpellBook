// The prose checks engine: everything the marks in the editor are worked out
// with. Plain calculations only: nothing here reads or writes a file, touches
// the screen or looks at the clock.
//
//   mask       scanLines, maskLine: what is prose and what is Markdown
//   tokens     tokenize, sentencesOf: words and sentences, English and Hebrew
//   lexicon    Spellbook's own English word lists
//   tagger     wordTypes: noun, verb, adjective or adverb
//   wordLists  filler words, common words, the words of the passive
//   checks     findFillers, findPassives, repeatForms
//   analyse    ProseAnalyser: a line, a passage; contextLines
//   prefs      the writer's choices and their saved form

export { ProseAnalyser, contextLines } from './analyse';
export type { LineAnalysis, PassageLine } from './analyse';
export { fillerList, findFillers, findPassives, repeatForms } from './checks';
export type { FillerList, Found } from './checks';
export { LINE_IN_COMMENT, LINE_SKIP, LINE_STRAY_COMMENT, maskLine, scanLines } from './mask';
export {
  FIRST_CHECKS,
  LONGEST_OWN_FILLER,
  MOST_OWN_FILLERS,
  NO_PROSE_PREFS,
  PROSE_PREFS_KEY,
  fillerWords,
  isShown,
  optionsOf,
  parseProsePrefs,
  serializeProsePrefs,
  withCheck,
  withMaster,
} from './prefs';
export type { ProsePrefs } from './prefs';
export { wordTypes } from './tagger';
export type { WordType } from './tagger';
export { normalWord, sentencesOf, tokenize } from './tokens';
export type { Script, Sentence, Token } from './tokens';
export {
  ADVERB_LIMIT,
  ADVERB_WINDOW,
  LONG_SENTENCE,
  MARK_KINDS,
  PROSE_CHECKS,
  REPEAT_DISTANCE,
  RUN_LENGTH,
  RUN_SHORTEST,
  RUN_TOLERANCE,
  WORD_TYPE_CHECKS,
  clampWhole,
} from './types';
export type { MarkKind, ProseCheck, ProseMark, ProseOptions } from './types';
export { COMMON_EN, COMMON_HE, FILLERS_EN, FILLERS_HE, HEBREW_PREFIXES } from './wordLists';
