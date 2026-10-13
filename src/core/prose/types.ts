// The prose checks: what can be switched on, and what a mark on the page is.
//
// A check never changes the writer's text. It only says "look here": a mark
// is a stretch of one line (from, to), the kind of mark it is, and a sentence
// that tells the writer why it is there.

/** The checks the writer can switch on, one by one. The order is the order of the settings rows. */
export const PROSE_CHECKS = [
  'nouns',
  'verbs',
  'adjectives',
  'adverbs',
  'filler',
  'passive',
  'repeated',
  'overused-adverbs',
  'rhythm',
] as const;

export type ProseCheck = (typeof PROSE_CHECKS)[number];

/** The checks that colour English words by their type. */
export const WORD_TYPE_CHECKS: readonly ProseCheck[] = ['nouns', 'verbs', 'adjectives', 'adverbs'];

/** The kinds of mark that are drawn. (Sentence rhythm draws two: a long sentence, and a run of sentences of one length.) */
export const MARK_KINDS = [
  'noun',
  'verb',
  'adjective',
  'adverb',
  'filler',
  'passive',
  'repeated',
  'overused',
  'long',
  'run',
] as const;

export type MarkKind = (typeof MARK_KINDS)[number];

/** One mark. `from` and `to` are places in the text that was analysed (a line, or a whole passage). */
export interface ProseMark {
  readonly from: number;
  readonly to: number;
  readonly kind: MarkKind;
  /** What the writer is told when they point at the mark or tap it. */
  readonly message: string;
}

/** The least and the most the two thresholds may be, and what they are until the writer changes them. */
export const REPEAT_DISTANCE = { min: 10, max: 200, initial: 40 } as const;
export const LONG_SENTENCE = { min: 12, max: 100, initial: 35 } as const;

/** Three "-ly" adverbs within this many words are marked as overused. */
export const ADVERB_LIMIT = 3;
export const ADVERB_WINDOW = 40;

/** This many sentences in a row of nearly one length are marked as a run. */
export const RUN_LENGTH = 4;
/** Sentences in a run differ by no more than this many words. */
export const RUN_TOLERANCE = 2;
/** A sentence shorter than this breaks a run: one-word answers in a dialogue are not a rhythm. */
export const RUN_SHORTEST = 3;

/** What the analysis is asked to do. */
export interface ProseOptions {
  /** The checks that are on. */
  readonly checks: ReadonlySet<ProseCheck>;
  /** Two uses of a word this many words apart, or closer, are a repetition. */
  readonly distance: number;
  /** A sentence of this many words, or more, is a long one. */
  readonly longSentence: number;
  /** Filler words and phrases the writer added, in English or Hebrew. */
  readonly ownFillers: readonly string[];
}

/** A whole number between two bounds; `fallback` for anything that is not a number. */
export function clampWhole(value: unknown, bounds: { min: number; max: number }, fallback: number): number {
  const number = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : Number.NaN;
  if (!Number.isFinite(number)) return fallback;
  return Math.min(bounds.max, Math.max(bounds.min, Math.round(number)));
}
