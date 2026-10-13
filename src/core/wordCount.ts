// Counting the words of a scene.
//
// Words are found with Intl.Segmenter, which knows where words begin and end
// in every language, including ones written without spaces (Chinese,
// Japanese, Thai). Where it is not available, a simpler pattern is used.
// The properties block at the top of a note and %% comments %% never count.

/** The part of Intl.Segmenter this file needs; also lets tests pass their own. */
export interface WordSegmenter {
  segment(text: string): Iterable<{ readonly segment: string; readonly isWordLike?: boolean }>;
}

let cachedSegmenter: WordSegmenter | null | undefined;

/** The built-in word segmenter, or null on a device that has none. */
export function defaultSegmenter(): WordSegmenter | null {
  if (cachedSegmenter !== undefined) return cachedSegmenter;
  cachedSegmenter = null;
  try {
    if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
      cachedSegmenter = new Intl.Segmenter(undefined, { granularity: 'word' });
    }
  } catch {
    cachedSegmenter = null;
  }
  return cachedSegmenter;
}

/**
 * Remove the properties (frontmatter) block: a first line of "---" up to the
 * next line that is just "---". A block that is never closed is ordinary text.
 */
export function stripFrontmatter(text: string): string {
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const isFence = (line: string): boolean => line.replace(/[ \t\r]+$/, '') === '---';

  let lineEnd = body.indexOf('\n');
  if (lineEnd < 0 || !isFence(body.slice(0, lineEnd))) return body;
  let lineStart = lineEnd + 1;
  while (lineStart <= body.length) {
    lineEnd = body.indexOf('\n', lineStart);
    const line = lineEnd < 0 ? body.slice(lineStart) : body.slice(lineStart, lineEnd);
    if (isFence(line)) return lineEnd < 0 ? '' : body.slice(lineEnd + 1);
    if (lineEnd < 0) break;
    lineStart = lineEnd + 1;
  }
  return body;
}

/**
 * Remove Obsidian comments: everything between a pair of %% marks, on one
 * line or across many. A lone %% with no partner is left alone, so a stray
 * "100%%" cannot hide the rest of a scene from the count.
 */
export function stripComments(text: string): string {
  return text.replace(/%%[\s\S]*?%%/g, ' ');
}

/** The text of a note that counts as writing. */
export function countableText(markdown: string): string {
  return stripComments(stripFrontmatter(markdown));
}

// Fallback word pattern, built once.
//  - Chinese characters and Japanese kana are written without spaces: each
//    character counts as one word.
//  - Otherwise a word is a run of letters, digits and accent marks, which may
//    be joined by one apostrophe, hyphen, dot or underscore ("don't",
//    "well-known", "3.14"). The apostrophes include the curly one (U+2019)
//    and the Hebrew geresh and gershayim (U+05F3, U+05F4).
const SPACELESS = '[\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}]';
const WORD_CHARACTER = `(?:(?!${SPACELESS})[\\p{L}\\p{N}\\p{M}])`;
const JOINERS = `'._\\-${String.fromCharCode(0x2019, 0x05f3, 0x05f4)}`;
const FALLBACK_WORD = new RegExp(
  `${SPACELESS}|${WORD_CHARACTER}+(?:[${JOINERS}]${WORD_CHARACTER}+)*`,
  'gu',
);

/** Count words with the fallback pattern (no Intl.Segmenter needed). */
export function countWordsByPattern(text: string): number {
  return text.match(FALLBACK_WORD)?.length ?? 0;
}

/**
 * Count the words in a note.
 *
 * @param markdown  the whole note, as stored
 * @param segmenter the word segmenter to use; pass null to force the fallback pattern
 */
export function countWords(
  markdown: string,
  segmenter: WordSegmenter | null = defaultSegmenter(),
): number {
  const text = countableText(markdown);
  if (segmenter === null) return countWordsByPattern(text);
  let words = 0;
  for (const part of segmenter.segment(text)) {
    if (part.isWordLike) words++;
  }
  return words;
}
