// A synopsis for a scene that has none: the opening of its text.
//
// The preview is the first prose of the note: the properties block, comments,
// headings, scene-break rules and blank lines are passed over, the lines that
// remain are joined with single spaces, and the result is cut at about 200
// characters. The cut falls between two words and never inside a character,
// in Hebrew as in English. The letters themselves are never changed.

import { countableText } from './coreImports';

/** About how many characters of a scene's text make up a derived synopsis. */
export const PREVIEW_LENGTH = 200;

const ELLIPSIS = '\u{2026}';

// Spaces, and a comma, semicolon, colon, hyphen or dash (U+2013, U+2014), left
// at the very end of the kept text: they would look odd in front of the ellipsis.
const HANGING = /[ ,;:\u{2013}\u{2014}-]+$/u;

/** No word is longer than this many characters; a longer run without a space may be cut inside. */
const LONGEST_WORD = 40;

/** The part of Intl.Segmenter used to find where one character ends and the next begins. */
export interface GraphemeSegmenter {
  segment(text: string): Iterable<{ readonly segment: string; readonly index: number }>;
}

let cachedSegmenter: GraphemeSegmenter | null | undefined;

/** The built-in character segmenter, or null on a device that has none. */
export function defaultGraphemeSegmenter(): GraphemeSegmenter | null {
  if (cachedSegmenter !== undefined) return cachedSegmenter;
  cachedSegmenter = null;
  try {
    if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
      cachedSegmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
    }
  } catch {
    cachedSegmenter = null;
  }
  return cachedSegmenter;
}

// Accents, vowel points and other marks that sit on the letter before them.
const MARK = /^\p{M}$/u;
// The joiner that fuses several symbols into one (as in a family emoji).
const JOINER = 0x200d;
// The skin tones that follow an emoji of a person.
const SKIN_TONE_FIRST = 0x1f3fb;
const SKIN_TONE_LAST = 0x1f3ff;

function isHighSurrogate(unit: number): boolean {
  return unit >= 0xd800 && unit <= 0xdbff;
}

function isLowSurrogate(unit: number): boolean {
  return unit >= 0xdc00 && unit <= 0xdfff;
}

/** True when a cut just in front of position `at` would fall inside a character. */
function insideCharacter(text: string, at: number): boolean {
  if (at <= 0 || at >= text.length) return false;
  const unit = text.charCodeAt(at);
  if (isLowSurrogate(unit) && isHighSurrogate(text.charCodeAt(at - 1))) return true;
  if (unit === JOINER || text.charCodeAt(at - 1) === JOINER) return true;
  const codePoint = text.codePointAt(at) as number;
  if (codePoint >= SKIN_TONE_FIRST && codePoint <= SKIN_TONE_LAST) return true;
  return MARK.test(String.fromCodePoint(codePoint));
}

/**
 * The nearest place at or before `at` where text can be cut without splitting
 * a character: never between a letter and its marks, between the halves of an
 * emoji, or inside a joined group of symbols.
 */
export function characterBoundary(
  text: string,
  at: number,
  segmenter: GraphemeSegmenter | null = defaultGraphemeSegmenter(),
): number {
  const wanted = Math.max(0, Math.min(text.length, Math.trunc(at)));
  if (wanted === 0 || wanted === text.length) return wanted;
  if (segmenter !== null) {
    // A few characters past the cut are enough to see whether it falls inside one.
    let boundary = 0;
    for (const part of segmenter.segment(text.slice(0, Math.min(text.length, wanted + 64)))) {
      if (part.index > wanted) break;
      boundary = part.index;
    }
    return boundary;
  }
  let cut = wanted;
  while (cut > 0 && insideCharacter(text, cut)) cut--;
  return cut;
}

function stripHtmlComments(text: string): string {
  return text.replace(/<!--[\s\S]*?-->/g, ' ');
}

const HEADING = /^ {0,3}#{1,6}(?:[ \t]|$)/;
// A line of only dashes, stars or underscores: a scene break.
const RULE = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
// The line under a heading written the other way ("Title" over "=====" or "-----").
const UNDERLINE = /^ {0,3}(?:={2,}|-{2,})[ \t]*$/;

// The "\r" of a Windows line ending ("\r\n").
const CARRIAGE_RETURN = 0x0d;

function isBlank(line: string): boolean {
  return line.trim() === '';
}

/**
 * Gather the prose from the start of `body`, joined into one line, until
 * there is more than `budget` of it. `more` tells whether prose was left out.
 */
function gatherProse(body: string, budget: number): { prose: string; more: boolean } {
  let prose = '';
  let position = 0;
  let previousWasText = false;

  // A line runs up to "\n". The "\r" that Windows writes in front of it is
  // part of the line ending, not of the line: left on, it would stop a scene
  // break, an underline or a bare "#" from being recognised.
  const lineAt = (start: number): { line: string; next: number } | null => {
    if (start >= body.length) return null;
    const newline = body.indexOf('\n', start);
    const next = newline < 0 ? body.length : newline + 1;
    let end = newline < 0 ? body.length : newline;
    while (end > start && body.charCodeAt(end - 1) === CARRIAGE_RETURN) end--;
    return { line: body.slice(start, end), next };
  };

  for (let current = lineAt(position); current !== null; current = lineAt(position)) {
    position = current.next;
    const { line } = current;
    if (isBlank(line) || HEADING.test(line) || RULE.test(line) || UNDERLINE.test(line)) {
      previousWasText = false;
      continue;
    }
    // A single line with a row of = or - straight under it is a heading too.
    const below = lineAt(position);
    if (!previousWasText && below !== null && UNDERLINE.test(below.line)) continue;
    previousWasText = true;

    if (prose.length > budget) return { prose, more: true };
    // A paragraph is one long line: look only at as much of it as can be needed.
    const head = line.length > budget ? line.slice(0, budget) : line;
    const piece = head.replace(/[ \t\r\n]+/g, ' ').trim();
    if (piece === '') continue;
    prose = prose === '' ? piece : `${prose} ${piece}`;
    if (head.length < line.length) return { prose, more: true };
  }
  return { prose, more: false };
}

/**
 * Make a short preview from the text of a note, for a scene whose synopsis is
 * empty.
 *
 * @param markdown  the whole note as stored, properties block included
 * @param maxLength about how many characters to keep (marks that sit on a
 *                  letter, such as Hebrew vowel points, are not counted)
 * @param segmenter the character segmenter to use; pass null to do without one
 * @returns the opening prose; when it had to be cut, it ends at a word
 *          boundary followed by an ellipsis. "" when the note has no prose.
 */
export function derivePreview(
  markdown: string,
  maxLength: number = PREVIEW_LENGTH,
  segmenter: GraphemeSegmenter | null = defaultGraphemeSegmenter(),
): string {
  if (typeof markdown !== 'string' || markdown === '') return '';
  const limit = Number.isFinite(maxLength) ? Math.max(1, Math.trunc(maxLength)) : PREVIEW_LENGTH;
  // Enough of the text to hold `limit` characters even when each carries several marks.
  const budget = limit * 8 + 64;
  const { prose, more } = gatherProse(stripHtmlComments(countableText(markdown)), budget);

  // Walk the characters: `hardCut` is where character number limit + 1 begins,
  // `wordCut` the last space at or before it.
  let counted = 0;
  let hardCut = -1;
  let wordCut = -1;
  let countedAtWordCut = 0;
  let position = 0;
  for (const character of prose) {
    if (!MARK.test(character)) {
      if (counted === limit) {
        hardCut = position;
        if (character === ' ') {
          wordCut = position;
          countedAtWordCut = counted;
        }
        break;
      }
      if (character === ' ') {
        wordCut = position;
        countedAtWordCut = counted;
      }
      counted++;
    }
    position += character.length;
  }

  if (hardCut < 0) {
    // It all fits. When prose was left out further on, say so with an ellipsis.
    if (!more) return prose;
    hardCut = characterBoundary(prose, prose.length - 1, segmenter);
  }

  // Cut between two words. Only a run of characters far longer than any word
  // (a web address, or writing that uses no spaces) is cut inside.
  const atWord = wordCut > 0 && counted - countedAtWordCut <= LONGEST_WORD;
  const cut = atWord ? wordCut : characterBoundary(prose, hardCut, segmenter);
  const kept = prose.slice(0, cut).replace(HANGING, '');
  return kept === '' ? ELLIPSIS : kept + ELLIPSIS;
}
