// The text of a scene as the continuous manuscript shows it: without its
// properties block; and the way back from a paragraph on the screen to its
// line in the note, so that the editor can be opened where the writer tapped.

import { stripComments, stripFrontmatter } from '../wordCount';

/** A scene's text as it is shown, and where that text starts in the note. */
export interface SceneText {
  /** The note without its properties block. */
  readonly body: string;
  /** The line of the note the body starts on, counted from 0. */
  readonly startLine: number;
}

function lineCount(text: string): number {
  let lines = 0;
  for (let at = text.indexOf('\n'); at >= 0; at = text.indexOf('\n', at + 1)) lines++;
  return lines;
}

/** Take a note apart: its text without the properties block, and the line that text starts on. */
export function sceneText(note: string): SceneText {
  const body = stripFrontmatter(note);
  return { body, startLine: Math.max(0, lineCount(note) - lineCount(body)) };
}

/** Whether a scene has anything to show: something other than space, comments aside. */
export function hasText(body: string): boolean {
  return stripComments(body).trim() !== '';
}

/** Letters and digits of any script, as the words they make; everything else only parts words. */
const WORD = /[\p{L}\p{N}]+/gu;

function wordsOf(text: string, limit: number): string[] {
  const words: string[] = [];
  for (const match of text.matchAll(WORD)) {
    words.push(match[0].toLowerCase());
    if (words.length >= limit) break;
  }
  return words;
}

/** How many words of a tapped paragraph are looked for at most. */
const SNIPPET_WORDS = 8;

/**
 * The line of a scene's text that a paragraph on the screen comes from, by
 * the words the paragraph begins with. Marks such as stars and brackets are
 * not compared, so bold text and links are found all the same; when the first
 * eight words are not found in a row, fewer are tried.
 *
 * @param body    the scene's text (see sceneText)
 * @param snippet the text of the paragraph as it is shown
 * @returns the line within `body`, counted from 0; null when it is not found
 */
export function lineOfSnippet(body: string, snippet: string): number | null {
  const wanted = wordsOf(snippet, SNIPPET_WORDS);
  if (wanted.length === 0) return null;
  const words: string[] = [];
  const lines: number[] = [];
  let lineNumber = 0;
  for (const line of body.split('\n')) {
    for (const match of line.matchAll(WORD)) {
      words.push(match[0].toLowerCase());
      lines.push(lineNumber);
    }
    lineNumber++;
  }
  // A single word is too little to go by unless the paragraph is that short.
  const least = Math.min(wanted.length, 2);
  for (let length = wanted.length; length >= least; length = length > 4 ? 4 : length - 1) {
    for (let start = 0; start + length <= words.length; start++) {
      let same = true;
      for (let at = 0; at < length && same; at++) same = words[start + at] === wanted[at];
      if (same) return lines[start] ?? null;
    }
  }
  return null;
}

/**
 * A scene's text as plain paragraphs, for when it cannot be drawn as
 * formatted text: comments left out, one paragraph per run of lines.
 */
export function plainParagraphs(body: string): string[] {
  return stripComments(body)
    .split(/\n[ \t\r]*\n/)
    .map((paragraph) => paragraph.replace(/[ \t\r]+$/gm, '').replace(/^\n+|\n+$/g, ''))
    .filter((paragraph) => paragraph.trim() !== '');
}
