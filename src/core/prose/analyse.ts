// The analysis itself: lines of a note go in, marks come out.
//
// It is done in two steps, so that typing in a long scene stays light:
//
//   a line   Everything that can be said of one line on its own (the type of
//            each English word, filler words, passives, long sentences) is
//            worked out once and remembered under the line's text. A line
//            that has not changed is never looked at twice.
//   a passage  What needs more than one line (a word repeated a few lines
//            further on, three adverbs close together, four sentences in a
//            row of one length) is worked out over the lines handed in, from
//            what was remembered of each: a walk along short lists of numbers.
//
// A passage is the part of the note that is on the screen, with some lines
// before and after it (see contextLines). Nothing here reads a file, touches
// the screen or looks at the clock.

import { fillerList, findFillers, findPassives, repeatForms } from './checks';
import type { FillerList } from './checks';
import { LINE_SKIP, maskLine } from './mask';
import { wordTypes } from './tagger';
import { sentencesOf, tokenize } from './tokens';
import { ADVERB_LIMIT, ADVERB_WINDOW, RUN_LENGTH, RUN_SHORTEST, RUN_TOLERANCE } from './types';
import type { MarkKind, ProseCheck, ProseMark, ProseOptions } from './types';

/** A word of a line that may be a repetition of another. */
interface Repeatable {
  /** Its place among the words of the line: 0 for the first. */
  readonly word: number;
  readonly from: number;
  readonly to: number;
  readonly forms: readonly string[];
}

interface Spot {
  readonly word: number;
  readonly from: number;
  readonly to: number;
}

interface Stretch {
  readonly from: number;
  readonly to: number;
  readonly words: number;
}

/** What is remembered of one line. Places are counted from the start of the line. */
export interface LineAnalysis {
  /** The marks that need nothing but the line itself. */
  readonly marks: readonly ProseMark[];
  /** How many words the line has. */
  readonly words: number;
  readonly repeatables: readonly Repeatable[];
  /** The adverbs in "-ly". */
  readonly adverbs: readonly Spot[];
  readonly sentences: readonly Stretch[];
}

const EMPTY: LineAnalysis = { marks: [], words: 0, repeatables: [], adverbs: [], sentences: [] };

const TYPE_NAMES = { noun: 'Noun', verb: 'Verb', adjective: 'Adjective', adverb: 'Adverb' } as const;
const TYPE_CHECKS = { noun: 'nouns', verb: 'verbs', adjective: 'adjectives', adverb: 'adverbs' } as const;

/** One line of a passage: its text, what scanLines said of it, and where it begins in the note. */
export interface PassageLine {
  readonly text: string;
  readonly flags: number;
  readonly from: number;
}

/** No more lines than this are remembered; the oldest half is forgotten first. */
const REMEMBERED = 3000;

/**
 * Analyses lines for one set of choices (which checks are on, the two
 * thresholds, the writer's filler words). When the choices change, make a
 * new one.
 */
export class ProseAnalyser {
  readonly options: ProseOptions;
  private readonly fillers: FillerList | null;
  private readonly wantsTypes: boolean;
  private recent = new Map<string, LineAnalysis>();
  private older = new Map<string, LineAnalysis>();

  constructor(options: ProseOptions) {
    this.options = options;
    const on = (check: ProseCheck): boolean => options.checks.has(check);
    this.fillers = on('filler') ? fillerList(options.ownFillers) : null;
    this.wantsTypes = on('nouns') || on('verbs') || on('adjectives') || on('adverbs') || on('overused-adverbs') || on('passive');
  }

  /** Whether any check is on at all. */
  get idle(): boolean {
    return this.options.checks.size === 0;
  }

  /** How many lines are remembered. */
  get remembered(): number {
    return this.recent.size + this.older.size;
  }

  /** What there is to say of one line on its own. Remembered under the line's text. */
  line(text: string, flags = 0): LineAnalysis {
    if ((flags & LINE_SKIP) !== 0 || text === '') return EMPTY;
    const key = flags === 0 ? text : `${flags}\n${text}`;
    let known = this.recent.get(key);
    if (known) return known;
    known = this.older.get(key);
    if (!known) {
      try {
        known = this.analyse(text, flags);
      } catch (error) {
        // One line that cannot be read must not take the checks away from all the others.
        console.error('Spellbook: a line could not be checked', error);
        known = EMPTY;
      }
    }
    if (this.recent.size >= REMEMBERED / 2) {
      this.older = this.recent;
      this.recent = new Map();
    }
    this.recent.set(key, known);
    return known;
  }

  private analyse(text: string, flags: number): LineAnalysis {
    const { checks, longSentence } = this.options;
    const masked = maskLine(text, flags);
    const tokens = tokenize(masked);
    if (tokens.length === 0) return EMPTY;
    const marks: ProseMark[] = [];
    const adverbs: Spot[] = [];
    const repeatables: Repeatable[] = [];

    const types = this.wantsTypes && tokens.some((token) => token.script === 'latin') ? wordTypes(masked, tokens) : null;
    if (types) {
      for (let at = 0; at < tokens.length; at++) {
        const type = types[at];
        const token = tokens[at];
        if (!type || !token) continue;
        if (checks.has(TYPE_CHECKS[type])) marks.push({ from: token.from, to: token.to, kind: type, message: TYPE_NAMES[type] });
        if (type === 'adverb' && token.lower.length > 4 && token.lower.endsWith('ly')) adverbs.push({ word: at, from: token.from, to: token.to });
      }
    }
    if (this.fillers) {
      for (const found of findFillers(masked, tokens, this.fillers)) {
        marks.push({ from: found.from, to: found.to, kind: 'filler', message: `Filler: "${found.text}"` });
      }
    }
    if (checks.has('passive')) {
      for (const found of findPassives(masked, tokens, types ?? undefined)) {
        marks.push({ from: found.from, to: found.to, kind: 'passive', message: `Passive voice: "${found.text}"` });
      }
    }
    if (checks.has('repeated')) {
      for (let at = 0; at < tokens.length; at++) {
        const token = tokens[at];
        if (!token) continue;
        const forms = repeatForms(token);
        if (forms.length > 0) repeatables.push({ word: at, from: token.from, to: token.to, forms });
      }
    }
    let sentences: Stretch[] = [];
    if (checks.has('rhythm')) {
      sentences = sentencesOf(tokens);
      for (const sentence of sentences) {
        if (sentence.words < longSentence) continue;
        marks.push({ from: sentence.from, to: sentence.to, kind: 'long', message: `Long sentence: ${sentence.words} words` });
      }
    }
    return { marks, words: tokens.length, repeatables, adverbs: checks.has('overused-adverbs') ? adverbs : [], sentences };
  }

  /**
   * The marks of a passage: lines that follow each other in the note, in
   * order. Places in the marks are places in the note.
   */
  passage(lines: readonly PassageLine[]): ProseMark[] {
    if (this.idle) return [];
    const { checks, distance } = this.options;
    const marks: ProseMark[] = [];
    const add = (from: number, to: number, kind: MarkKind, message: string): void => {
      marks.push({ from, to, kind, message });
    };

    /** Every use of a form in the passage, in order. */
    const uses = new Map<string, Array<{ at: number; from: number; to: number; shown: string }>>();
    const adverbs: Array<{ at: number; from: number; to: number }> = [];
    /** The sentences that follow each other without a break; a heading or a code block starts a new list. */
    let row: Stretch[] = [];
    const rows: Stretch[][] = [row];
    /** How many words came before the line that is being read. */
    let before = 0;

    for (const line of lines) {
      if ((line.flags & LINE_SKIP) !== 0) {
        if (row.length > 0) rows.push((row = []));
        continue;
      }
      const known = this.line(line.text, line.flags);
      if (known === EMPTY) continue;
      for (const mark of known.marks) add(line.from + mark.from, line.from + mark.to, mark.kind, mark.message);
      for (const word of known.repeatables) {
        const use = { at: before + word.word, from: line.from + word.from, to: line.from + word.to, shown: word.forms[0] ?? '' };
        for (const form of word.forms) {
          const list = uses.get(form);
          if (list) list.push(use);
          else uses.set(form, [use]);
        }
      }
      for (const adverb of known.adverbs) adverbs.push({ at: before + adverb.word, from: line.from + adverb.from, to: line.from + adverb.to });
      for (const sentence of known.sentences) {
        row.push({ from: line.from + sentence.from, to: line.from + sentence.to, words: sentence.words });
      }
      before += known.words;
    }

    if (checks.has('repeated')) {
      // A word may be found under two of its forms: the longer chain is the one that is told.
      const told = new Map<number, { to: number; count: number; message: string }>();
      for (const [form, list] of uses) {
        if (list.length < 2) continue;
        let first = 0;
        for (let at = 1; at <= list.length; at++) {
          const here = list[at];
          const last = list[at - 1];
          if (here && last && here.at - last.at <= distance) continue;
          const head = list[first];
          const count = at - first;
          if (count >= 2 && head && last) {
            const message = `Repeated: "${form}" ${count} times in ${last.at - head.at + 1} words`;
            for (let member = first; member < at; member++) {
              const use = list[member];
              if (!use) continue;
              const known = told.get(use.from);
              if (!known || known.count < count) told.set(use.from, { to: use.to, count, message });
            }
          }
          first = at;
        }
      }
      for (const [from, use] of told) add(from, use.to, 'repeated', use.message);
    }

    if (checks.has('overused-adverbs')) {
      const crowded = new Set<number>();
      for (let at = 0; at + ADVERB_LIMIT - 1 < adverbs.length; at++) {
        const head = adverbs[at];
        const tail = adverbs[at + ADVERB_LIMIT - 1];
        if (!head || !tail || tail.at - head.at >= ADVERB_WINDOW) continue;
        for (let member = at; member < at + ADVERB_LIMIT; member++) crowded.add(member);
      }
      for (const member of crowded) {
        const adverb = adverbs[member];
        if (!adverb) continue;
        const near = adverbs.filter((other) => Math.abs(other.at - adverb.at) < ADVERB_WINDOW).length;
        add(adverb.from, adverb.to, 'overused', `Adverbs: ${near} within ${ADVERB_WINDOW} words`);
      }
    }

    if (checks.has('rhythm')) {
      for (const sentences of rows) {
        let first = 0;
        let least = 0;
        let most = 0;
        for (let at = 0; at <= sentences.length; at++) {
          const words = sentences[at]?.words;
          const fits = words !== undefined && words >= RUN_SHORTEST;
          if (fits && at > first && Math.max(most, words) - Math.min(least, words) <= RUN_TOLERANCE) {
            least = Math.min(least, words);
            most = Math.max(most, words);
            continue;
          }
          if (at - first >= RUN_LENGTH) {
            const about = Math.round((least + most) / 2);
            const message = `Rhythm: ${at - first} sentences in a row of about ${about} words`;
            for (let member = first; member < at; member++) {
              const sentence = sentences[member];
              if (sentence) add(sentence.from, sentence.to, 'run', message);
            }
          }
          // The run starts again here: at this sentence, or after it when it is too short to count.
          first = fits ? at : at + 1;
          least = most = words ?? 0;
        }
      }
    }
    return marks;
  }
}

/**
 * Which lines to hand to `passage` for a part of a note that is on the
 * screen: the lines shown, and as many before and after them as hold the
 * words the checks look back and ahead over.
 *
 * @param countWords the number of words of a line, by its number (0 for a line that is not prose)
 * @param first the first line shown
 * @param last the last line shown
 * @param lineCount how many lines the note has; lines are numbered from 1
 * @param reach how many words to take in on either side
 * @returns the first and the last line to analyse
 */
export function contextLines(
  countWords: (line: number) => number,
  first: number,
  last: number,
  lineCount: number,
  reach: number,
): { first: number; last: number } {
  const MOST = 120;
  let from = Math.max(1, first);
  let to = Math.min(lineCount, last);
  for (let words = 0, lines = 0; from > 1 && words < reach && lines < MOST; lines++) words += countWords(--from);
  for (let words = 0, lines = 0; to < lineCount && words < reach && lines < MOST; lines++) words += countWords(++to);
  return { first: from, last: to };
}
