// Telling the nouns, verbs, adjectives and adverbs of an English line apart.
//
// There is no grammar library behind this, only three small steps:
//
//   1. look the word up in Spellbook's own lists (lexicon.ts), also without
//      its ending ("walked" is "walk", "tides" is "tide", "slowly" is "slow");
//   2. failing that, guess from the ending ("-ness" is a noun, "-ous" an
//      adjective), and take a capital letter inside a sentence for a name;
//   3. where a word can be two things ("light", "walk"), let the word before
//      it and the word after it decide.
//
// It is right for most words of ordinary prose and wrong for some: it is a
// way of seeing one's adverbs at a glance, not a judgement. Words that are
// not written in Latin letters are left alone.

import { DEGREE_WORDS, LINKING_VERBS, closedTag, usesOf } from './lexicon';
import type { ClosedTag } from './lexicon';
import type { Token } from './tokens';

export type WordType = 'noun' | 'verb' | 'adjective' | 'adverb';

type Open = 'N' | 'V' | 'J' | 'R';
type Role = Open | ClosedTag | null;
type Form = '' | 's' | 'ed' | 'ing';

interface Word {
  /** What the word is, as far as it is known. */
  role: Role;
  /** Everything it can be, the likeliest first; empty for the small words. */
  can: string;
  form: Form;
  /** It was not in the lists: its ending was all there was to go by. */
  guessed: boolean;
  /** It is never coloured, whatever its role ("she'll" is half a pronoun). */
  plain: boolean;
}

const NOTHING: Word = { role: null, can: '', form: '', guessed: false, plain: true };
const TYPE: Record<Open, WordType> = { N: 'noun', V: 'verb', J: 'adjective', R: 'adverb' };
const VERB_LIKE = new Set<Role>(['BE', 'HAVE', 'DO', 'MODAL']);
const JOINING = new Set(['and', 'or', 'but', 'nor']);
const OBJECTS = new Set(['me', 'us', 'him', 'them', 'it', 'you']);
const QUOTE = /["'\u201C\u2018]/;

const NOUN_ENDINGS = ['ness', 'ment', 'tion', 'sion', 'ity', 'ance', 'ence', 'ship', 'hood', 'dom', 'ism', 'ist', 'ery'];
const ADJECTIVE_ENDINGS = ['ous', 'ful', 'less', 'ive', 'able', 'ible', 'ical', 'ic', 'ish', 'al', 'ary', 'ant', 'ent', 'y'];
const VERB_ENDINGS = ['ize', 'ise', 'ify'];

const isOpen = (role: Role): role is Open => role === 'N' || role === 'V' || role === 'J' || role === 'R';

/** "runn" is "run": a letter doubled before an ending. */
function undouble(stem: string): string {
  return stem.length >= 3 && stem.charAt(stem.length - 1) === stem.charAt(stem.length - 2) ? stem.slice(0, -1) : stem;
}

function anyUse(stems: readonly string[], wanted: string): string | undefined {
  for (const stem of stems) {
    const uses = stem.length >= 2 ? usesOf(stem) : undefined;
    if (uses !== undefined && [...wanted].some((use) => uses.includes(use))) return uses;
  }
  return undefined;
}

/** A listed word behind an ending: what the whole word can be then. */
function withoutEnding(word: string): { can: string; form: Form } | null {
  const size = word.length;
  if (size >= 5 && word.endsWith('ing')) {
    const stem = word.slice(0, -3);
    if (anyUse([stem, `${stem}e`, undouble(stem)], 'V') !== undefined) return { can: 'V', form: 'ing' };
  }
  if (size >= 4 && word.endsWith('ed')) {
    const stem = word.slice(0, -2);
    if (anyUse([stem, word.slice(0, -1), undouble(stem), `${word.slice(0, -3)}y`], 'V') !== undefined) return { can: 'V', form: 'ed' };
  }
  if (size >= 4 && word.endsWith('s') && !word.endsWith('ss')) {
    const uses = anyUse([word.slice(0, -1), word.slice(0, -2), `${word.slice(0, -3)}y`, `${word.slice(0, -3)}f`, `${word.slice(0, -3)}fe`], 'NV');
    if (uses !== undefined) return { can: [...uses].filter((use) => use === 'N' || use === 'V').join(''), form: 's' };
  }
  for (const ending of ['er', 'est']) {
    if (size < 5 || !word.endsWith(ending)) continue;
    const stem = word.slice(0, -ending.length);
    const stems = [stem, `${stem}e`, undouble(stem), `${stem.slice(0, -1)}y`];
    if (anyUse(stems, 'J') !== undefined) return { can: 'J', form: '' };
    // A walker walks.
    if (ending === 'er' && anyUse(stems, 'V') !== undefined) return { can: 'N', form: '' };
  }
  if (size >= 5 && word.endsWith('ly')) {
    const stem = word.slice(0, -2);
    if (anyUse([stem, `${word.slice(0, -3)}y`, `${word.slice(0, -1)}e`, word.slice(0, -4)], 'J') !== undefined) return { can: 'R', form: '' };
  }
  return null;
}

/** A word that is in no list: what its ending suggests. */
function guess(word: string): { can: string; form: Form } {
  const size = word.length;
  // "grey-green", "half-open": most joined words describe.
  if (word.includes('-')) return { can: 'JN', form: '' };
  if (size > 4 && word.endsWith('ly')) return { can: 'R', form: '' };
  if (size > 4 && word.endsWith('ing')) return { can: 'V', form: 'ing' };
  if (size > 3 && word.endsWith('ed')) return { can: 'V', form: 'ed' };
  if (NOUN_ENDINGS.some((ending) => size > ending.length + 2 && word.endsWith(ending))) return { can: 'N', form: '' };
  if (ADJECTIVE_ENDINGS.some((ending) => size > ending.length + 2 && word.endsWith(ending))) return { can: 'J', form: '' };
  if (VERB_ENDINGS.some((ending) => size > ending.length + 2 && word.endsWith(ending))) return { can: 'V', form: '' };
  if (size > 3 && word.endsWith('s') && !word.endsWith('ss')) return { can: 'NV', form: 's' };
  return { can: 'N', form: '' };
}

/** Step one and two: a word on its own. */
function alone(token: Token, line: string): Word {
  if (token.script !== 'latin') return NOTHING;
  const word = token.lower;
  const closed = closedTag(word);
  if (closed !== undefined) return { role: closed, can: '', form: '', guessed: false, plain: false };

  const cut = word.lastIndexOf("'");
  if (cut > 0) {
    const head = word.slice(0, cut);
    const tail = word.slice(cut + 1);
    const small = (role: ClosedTag): Word => ({ role, can: '', form: '', guessed: false, plain: true });
    if (tail === 'll' || tail === 'd') return small('MODAL');
    if (tail === 've') return small('HAVE');
    if (tail === 're' || tail === 'm') return small('BE');
    if (word.endsWith("n't")) return { ...small('MODAL'), plain: false };
    if (tail === 's' || tail === '') {
      // "it's" is "it is"; "the captain's" owns the next word.
      if (closedTag(head) !== undefined) return small('BE');
      return { role: 'POSS', can: 'N', form: '', guessed: false, plain: false };
    }
  }

  const capital = token.text.charAt(0) !== token.text.charAt(0).toLowerCase();
  const opensQuote = QUOTE.test(line.charAt(token.from - 1));
  // A capital inside a sentence: a name.
  if (capital && !token.start && !opensQuote && token.text !== token.text.toUpperCase()) {
    return { role: 'N', can: 'N', form: '', guessed: false, plain: false };
  }
  const listed = usesOf(word);
  if (listed !== undefined) return { role: listed.charAt(0) as Open, can: listed, form: '', guessed: false, plain: false };
  const found = withoutEnding(word);
  if (found !== null) return { role: found.can.charAt(0) as Open, can: found.can, form: found.form, guessed: false, plain: false };
  const guessed = guess(word);
  return { role: guessed.can.charAt(0) as Open, can: guessed.can, form: guessed.form, guessed: true, plain: false };
}

/**
 * What each word of a line is: a noun, a verb, an adjective, an adverb, or
 * null for the small words and for anything that is not English.
 *
 * @param line the line the tokens were cut from (its Markdown blanked out)
 */
export function wordTypes(line: string, tokens: readonly Token[]): Array<WordType | null> {
  const words = tokens.map((token) => alone(token, line));

  /** The word before word `at`: its index, -1 at the start of a sentence, -2 across a comma or a dash. */
  const back = (at: number, skipAdverbs: boolean): number => {
    let index = at;
    for (let hops = 0; hops < 3; hops++) {
      const token = tokens[index];
      if (!token || token.start) return -1;
      if (token.broken) return -2;
      index--;
      if (!(skipAdverbs && words[index]?.role === 'R')) return index;
    }
    return -1;
  };
  const roleAt = (index: number): Role => (index >= 0 ? (words[index]?.role ?? null) : null);
  const follows = (index: number): Word | null => {
    const token = tokens[index];
    return token && !token.broken ? (words[index] ?? null) : null;
  };
  const nounish = (index: number): boolean => {
    const word = follows(index);
    if (!word) return false;
    if (word.role === 'POSS' && word.can === 'N') return true;
    return isOpen(word.role) && (word.can.includes('N') || word.can.includes('J'));
  };
  const verbish = (index: number): boolean => {
    const word = follows(index);
    return word !== null && (VERB_LIKE.has(word.role) || word.can === 'V');
  };

  const settle = (at: number, word: Word): Open => {
    const { can, form } = word;
    const has = (use: Open): boolean => can.includes(use);
    const near = back(at, false);
    const past = back(at, true);
    const nearRole = roleAt(near);
    const pastRole = roleAt(past);
    const next = at + 1;
    const first = can.charAt(0) as Open;
    const afterArticle = nearRole === 'DET' || nearRole === 'POSS' || nearRole === 'NUM';

    if (form === 'ing') {
      if (pastRole === 'BE') return 'V';
      if (afterArticle || nearRole === 'J') return nounish(next) ? 'J' : 'N';
      if (near === -1 && verbish(next)) return 'N';
      return 'V';
    }
    if (form === 'ed') {
      if (afterArticle || nearRole === 'J') return 'J';
      if (past >= 0 && pastRole === 'V' && LINKING_VERBS.has(tokens[past]?.lower ?? '')) return 'J';
      return 'V';
    }

    const plainVerb = has('V') && form === '';
    if (nearRole === 'TO' && plainVerb) return 'V';
    if (pastRole === 'MODAL' && (plainVerb || (word.guessed && form === ''))) return 'V';
    if (pastRole === 'DO' && plainVerb) return 'V';
    if (pastRole === 'BE') {
      if (has('J')) return 'J';
      if (has('R')) return 'R';
      return first;
    }
    if (pastRole === 'HAVE' && has('V')) return 'V';
    if (afterArticle) {
      if (has('J') && nounish(next)) return 'J';
      if (has('N')) return 'N';
      if (has('J')) return 'J';
      // "the walk", "a say": after an article a verb is a thing.
      if (can === 'V' && ['the', 'a', 'an'].includes(tokens[near]?.lower ?? '')) return nounish(next) ? 'J' : 'N';
      return first;
    }
    if (nearRole === 'J') {
      if (has('J') && nounish(next)) return 'J';
      if (has('N')) return 'N';
    }
    if (near >= 0 && DEGREE_WORDS.has(tokens[near]?.lower ?? '')) {
      if (has('J')) return 'J';
      if (has('R')) return 'R';
    }
    if (pastRole === 'SUBJ' && has('V')) return 'V';
    if (nearRole === 'PREP') {
      if (has('J') && nounish(next)) return 'J';
      if (has('N')) return 'N';
    }
    if (past >= 0 && pastRole === 'V' && has('J') && LINKING_VERBS.has(tokens[past]?.lower ?? '')) return 'J';
    if (nearRole === 'N' && has('V')) {
      // "the sea wall held": a verb follows, so this is still part of the thing.
      if (verbish(next)) return has('N') ? 'N' : first;
      // "the customs house": a word that is a thing first stays one, unless its ending says otherwise.
      if (first === 'N' && form === '') return 'N';
      return 'V';
    }
    // "cold and dark", "ran and jumped": like the word it is joined to.
    const joined = near === -2 ? at - 1 : near >= 0 && JOINING.has(tokens[near]?.lower ?? '') ? near - 1 : -1;
    if (joined >= 0 && tokens[joined + 1]?.start !== true) {
      const partner = roleAt(joined);
      if (isOpen(partner) && has(partner)) return partner;
    }
    if (near === -1) {
      const after = follows(next);
      // "Close the door."
      if (plainVerb && after && (after.role === 'DET' || after.role === 'POSS' || OBJECTS.has(tokens[next]?.lower ?? ''))) return 'V';
      if (has('N') && verbish(next)) return 'N';
    }
    if (has('J') && nounish(next)) return 'J';
    if (nearRole === 'V') {
      if (has('R') && !nounish(next)) return 'R';
      if (has('N')) return 'N';
    }
    return first;
  };

  for (let at = 0; at < words.length; at++) {
    const word = words[at];
    const token = tokens[at];
    if (!word || !token) continue;
    if (word.role === 'PREP' && token.lower === 'like') {
      // "she would like", "they like it"
      const before = roleAt(back(at, true));
      if (before === 'SUBJ' || before === 'MODAL' || before === 'DO' || before === 'TO') words[at] = { ...word, role: 'V', can: 'V' };
      continue;
    }
    if (!isOpen(word.role)) continue;
    if (word.guessed && token.start && token.text.charAt(0) !== token.lower.charAt(0) && word.form === '' && verbish(at + 1)) {
      // An unknown word with a capital that opens a sentence, before a verb: a name.
      word.role = 'N';
      continue;
    }
    if (word.can.length > 1 || word.form !== '' || word.guessed || word.can === 'V') word.role = settle(at, word);
  }

  return words.map((word) => {
    if (word.plain) return null;
    if (isOpen(word.role)) return TYPE[word.role];
    if (word.role === 'POSS' && word.can === 'N') return 'noun';
    return VERB_LIKE.has(word.role) ? 'verb' : null;
  });
}
