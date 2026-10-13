// From a note as it is stored to the prose a reader reads.
//
// The writing report counts sentences, paragraphs and characters. Markdown
// markup is not prose: the properties block, comments, the marks of a
// heading, a list or a quotation, the stars around emphasis, the address of a
// link, code blocks. This file takes all of that away and hands back the text
// in blocks: one for every paragraph and one for every heading.
//
// A paragraph is one line of text. In Obsidian a writer starts a new
// paragraph with the Enter key, and the editor shows every line as a
// paragraph of its own, whether or not an empty line stands between them.

import { countableText } from '../wordCount';

/** A piece of a note's prose: a paragraph, or the words of a heading. */
export interface ProseBlock {
  readonly kind: 'paragraph' | 'heading';
  /** The text without any markup, with single spaces between its words. */
  readonly text: string;
}

const HTML_COMMENT = /<!--[\s\S]*?-->/g;
/** The line that opens or closes a block of code: three or more backticks or tildes. */
const FENCE = /^(`{3,}|~{3,})/;
/** A line across the page: three or more of the same mark, and nothing else. */
const RULE = /^([-*_])(?:\s*\1){2,}$/;
/** The line of dashes between the head and the body of a table. */
const TABLE_RULE = /^\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?$/;
const HEADING = /^#{1,6}\s+(.*)$/;

/**
 * Take away what stands in front of the text of a line: the marks of a
 * quotation (and of a callout), of a list item, of a to-do line and of a
 * footnote.
 */
function stripLead(line: string): string {
  let rest = line;
  for (;;) {
    const next = rest
      .replace(/^>\s*(?:\[![^\]]*\][+-]?\s*)?/, '')
      .replace(/^(?:[-*+]|\d+[.)])\s+/, '')
      .replace(/^\[.\]\s+/, '')
      .replace(/^\[\^[^\]]+\]:\s*/, '');
    if (next === rest) return rest;
    rest = next;
  }
}

/** Take the markup out of a line of text: what is left is what a reader sees. */
export function stripInline(line: string): string {
  return (
    line
      // A backslash in front of a mark only says "this mark is meant as it stands".
      .replace(/\\(?=[^\p{L}\p{N}\s])/gu, '')
      // Notes and pictures shown inside the note are not part of its text.
      .replace(/!\[\[[^\]]*\]\]/g, ' ')
      .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
      // A link reads as its words, not as its address.
      .replace(/\[\[[^\]|]*\|([^\]]*)\]\]/g, '$1')
      .replace(/\[\[([^\]]*)\]\]/g, '$1')
      .replace(/\[\^[^\]]*\]/g, '')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/<\/?[a-zA-Z][^>]*>/g, '')
      // The marks of code, emphasis, strike-through and highlighting.
      .replace(/`+/g, '')
      .replace(/\*+|~~|==/g, '')
      .replace(/(^|[^\p{L}\p{N}])_+/gu, '$1')
      .replace(/_+(?=[^\p{L}\p{N}]|$)/gu, '')
      .replace(/\s+/g, ' ')
      .trim()
  );
}

/**
 * The prose of a note, block by block, in order.
 *
 * @param markdown the whole note, as stored
 */
export function proseBlocks(markdown: string): ProseBlock[] {
  const text = countableText(markdown).replace(HTML_COMMENT, ' ');
  const blocks: ProseBlock[] = [];
  /** The mark of the code block that is open ("`" or "~"), if one is. */
  let fence: string | null = null;
  let math = false;

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const fenceMark = FENCE.exec(line)?.[1]?.charAt(0);
    if (fence !== null) {
      if (fenceMark === fence && /^(`+|~+)$/.test(line)) fence = null;
      continue;
    }
    if (fenceMark !== undefined) {
      fence = fenceMark;
      continue;
    }
    if (line.startsWith('$$')) {
      // A block of mathematics: it runs to the next line with the same mark.
      const closedOnThisLine = line.length > 2 && line.endsWith('$$');
      if (!closedOnThisLine) math = !math;
      continue;
    }
    if (math || line === '' || RULE.test(line) || /^=+$/.test(line)) continue;
    if (line.includes('-') && line.includes('|') && TABLE_RULE.test(line)) continue;

    const heading = HEADING.exec(line);
    if (heading) {
      const title = stripInline((heading[1] ?? '').replace(/\s+#+$/, ''));
      if (title !== '') blocks.push({ kind: 'heading', text: title });
      continue;
    }
    let body = stripLead(line);
    // A row of a table: the bars between its cells are not text.
    if (body.startsWith('|')) body = body.replace(/\|/g, ' ');
    const prose = stripInline(body);
    if (prose !== '') blocks.push({ kind: 'paragraph', text: prose });
  }
  return blocks;
}
