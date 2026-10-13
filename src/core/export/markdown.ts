// Reading a scene's text for the export: what the writer wrote in Markdown,
// taken apart into paragraphs, headings, quotes, list items and scene breaks,
// each made of runs of plain, bold and italic text.
//
// It is the plugin's own small reader, not a full Markdown one. It follows
// what Obsidian's editor shows: every line the writer ends with Enter is a
// paragraph of its own, with or without an empty line after it. The
// properties block and comments (%%like this%% and <!-- like this -->) are
// left out. Links keep their words and lose their address; pictures and
// embedded notes are left out.

import { stripFrontmatter } from '../wordCount';
import { directionOf } from './direction';
import type { Direction } from './direction';

/** A stretch of text with one look. */
export interface Run {
  readonly text: string;
  readonly bold: boolean;
  readonly italic: boolean;
  readonly strike: boolean;
  /** Text between backticks: shown in a typewriter face. */
  readonly code: boolean;
}

/** What a block of text has besides its kind: its runs, and the direction its own letters give it (null: none). */
interface TextBlock {
  readonly runs: readonly Run[];
  readonly direction: Direction | null;
}

export type Block =
  | ({ readonly kind: 'paragraph' } & TextBlock)
  /** A heading the writer put inside the scene; `level` is the number of # marks. */
  | ({ readonly kind: 'heading'; readonly level: number } & TextBlock)
  | ({ readonly kind: 'quote' } & TextBlock)
  /** A line of a list. `marker` is what stands before it: a bullet, a number as typed, or a tick box. */
  | ({ readonly kind: 'item'; readonly depth: number; readonly marker: string } & TextBlock)
  /** A block between ``` fences, kept letter for letter. */
  | { readonly kind: 'code'; readonly lines: readonly string[] }
  /** A break the writer marked inside a scene with a line of ---, *** or ___. */
  | { readonly kind: 'break' };

/** The bullet printed before an item of a list that has no numbers. */
export const BULLET = String.fromCharCode(0x2022);
const BOX_EMPTY = String.fromCharCode(0x2610);
const BOX_TICKED = String.fromCharCode(0x2611);

/**
 * A scene's text without what is not part of the manuscript: the properties
 * block at the top and the comments. Everything else is as the writer wrote it.
 */
export function manuscriptText(note: string): string {
  return stripFrontmatter(note)
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]*%%[\s\S]*?%%/g, '')
    .replace(/[ \t]*<!--[\s\S]*?-->/g, '');
}

// ------------------------------------------------------------------- inline

type Token =
  | { kind: 'text'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'mark'; character: string; count: number; canOpen: boolean; canClose: boolean; role: 'open' | 'close' | null };

const WORD_CHARACTER = /[\p{L}\p{N}]/u;
const ESCAPABLE = /[\\`*_{}[\]()#+\-.!~=|<>%^$]/;

function isSpace(character: string | undefined): boolean {
  return character === undefined || /\s/.test(character);
}

/** What a [[wikilink]] shows: its alias, or else the name of what it points at. */
function wikilinkText(inner: string): string {
  const bar = inner.indexOf('|');
  if (bar >= 0) return inner.slice(bar + 1);
  return inner.replace(/^#\^?/, '').replace(/#\^?/g, ' > ');
}

function tokensOf(text: string): Token[] {
  const tokens: Token[] = [];
  let plain = '';
  const flush = (): void => {
    if (plain !== '') tokens.push({ kind: 'text', text: plain });
    plain = '';
  };

  let at = 0;
  while (at < text.length) {
    const character = text[at] as string;
    const rest = text.slice(at);

    if (character === '\\' && ESCAPABLE.test(text[at + 1] ?? '')) {
      plain += text[at + 1];
      at += 2;
      continue;
    }
    if (character === '`') {
      const fence = /^`+/.exec(rest)?.[0] ?? '`';
      const close = text.indexOf(fence, at + fence.length);
      if (close >= 0) {
        flush();
        tokens.push({ kind: 'code', text: text.slice(at + fence.length, close).trim() });
        at = close + fence.length;
        continue;
      }
    }
    // A picture or an embedded note: left out.
    const embed = /^!\[\[[^\]\n]*\]\]/.exec(rest) ?? /^!\[[^\]\n]*\]\([^)\n]*\)/.exec(rest);
    if (embed) {
      at += embed[0].length;
      // The space before it goes too, when another follows: no gap is left behind.
      if (text[at] === undefined || text[at] === ' ') plain = plain.replace(/ +$/, '');
      continue;
    }
    const wikilink = /^\[\[([^\]\n]+)\]\]/.exec(rest);
    if (wikilink) {
      plain += wikilinkText(wikilink[1] ?? '');
      at += wikilink[0].length;
      continue;
    }
    // A link keeps its words; a footnote mark is left out.
    const footnote = /^\[\^[^\]\s]+\]/.exec(rest);
    if (footnote) {
      at += footnote[0].length;
      continue;
    }
    const link = /^\[([^\]\n]*)\]\([^)\n]*\)/.exec(rest);
    if (link) {
      flush();
      tokens.push(...tokensOf(link[1] ?? ''));
      at += link[0].length;
      continue;
    }
    const tag = /^<\/?[A-Za-z][^<>\n]*>/.exec(rest);
    if (tag) {
      if (/^<br\b/i.test(tag[0])) plain += ' ';
      at += tag[0].length;
      continue;
    }
    if (character === '*' || character === '_' || character === '~' || character === '=') {
      let count = 1;
      while (text[at + count] === character) count++;
      const before = at === 0 ? undefined : text[at - 1];
      const after = text[at + count];
      const fits = character === '*' || character === '_' ? count <= 3 : count === 2;
      if (fits) {
        // An underscore inside a word is part of the word (snake_case).
        const inWord = character === '_';
        const canOpen = !isSpace(after) && !(inWord && before !== undefined && WORD_CHARACTER.test(before));
        const canClose = !isSpace(before) && !(inWord && after !== undefined && WORD_CHARACTER.test(after));
        flush();
        tokens.push({ kind: 'mark', character, count, canOpen, canClose, role: null });
      } else {
        plain += character.repeat(count);
      }
      at += count;
      continue;
    }
    plain += character;
    at++;
  }
  flush();
  return tokens;
}

/** Find which marks open and which close; a mark with no partner stays as the writer typed it. */
function pairMarks(tokens: Token[]): void {
  const open: number[] = [];
  tokens.forEach((token, index) => {
    if (token.kind !== 'mark') return;
    if (token.canClose) {
      for (let depth = open.length - 1; depth >= 0; depth--) {
        const opener = tokens[open[depth] as number];
        if (opener?.kind === 'mark' && opener.character === token.character && opener.count === token.count) {
          opener.role = 'open';
          token.role = 'close';
          open.length = depth;
          return;
        }
      }
    }
    if (token.canOpen) open.push(index);
  });
}

/** One line of text as runs: emphasis worked out, links and marks reduced to their words. */
export function parseInline(text: string): Run[] {
  const tokens = tokensOf(text);
  pairMarks(tokens);
  const runs: Run[] = [];
  let bold = 0;
  let italic = 0;
  let strike = 0;
  const add = (piece: string, code: boolean): void => {
    if (piece === '') return;
    const run: Run = { text: piece, bold: bold > 0, italic: italic > 0, strike: strike > 0, code };
    const last = runs[runs.length - 1];
    if (last && last.bold === run.bold && last.italic === run.italic && last.strike === run.strike && last.code === run.code) {
      runs[runs.length - 1] = { ...last, text: last.text + piece };
    } else {
      runs.push(run);
    }
  };
  for (const token of tokens) {
    if (token.kind === 'text') add(token.text, false);
    else if (token.kind === 'code') add(token.text, true);
    else if (token.role === null) add(token.character.repeat(token.count), false);
    else {
      const step = token.role === 'open' ? 1 : -1;
      if (token.character === '~') strike += step;
      else if (token.character === '*' || token.character === '_') {
        if (token.count !== 1) bold += step;
        if (token.count !== 2) italic += step;
      }
      // Highlighting (==) leaves no trace in a manuscript: only its marks go.
    }
  }
  return runs;
}

/** The words of some runs, without their looks. */
export function plainText(runs: readonly Run[]): string {
  return runs.map((run) => run.text).join('');
}

// ------------------------------------------------------------------- blocks

function textBlock(text: string): TextBlock {
  // A block id at the end of a line (" ^abc12") is Obsidian's, not the writer's.
  const runs = parseInline(text.replace(/\s\^[A-Za-z0-9-]+$/, '').trim());
  return { runs, direction: directionOf(plainText(runs)) };
}

const DIVIDER = /^\s*(?:(?:\*\s*){3,}|(?:-\s*){3,}|(?:_\s*){3,}|#)\s*$/;
const HEADING = /^\s{0,3}(#{1,6})\s+(.*?)(?:\s+#+)?\s*$/;
const QUOTE = /^\s*(?:>\s?)+(.*)$/;
const ITEM = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const FENCE = /^\s*(```+|~~~+)/;

/** Take a scene's text apart into blocks. Give it the text as manuscriptText leaves it. */
export function parseBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  let fence: string | null = null;
  let code: string[] = [];

  for (const line of text.split('\n')) {
    const fenced = FENCE.exec(line)?.[1] ?? null;
    if (fence !== null) {
      if (fenced !== null && fenced[0] === fence[0] && fenced.length >= fence.length) {
        if (code.length > 0) blocks.push({ kind: 'code', lines: code });
        fence = null;
        code = [];
      } else {
        code.push(line);
      }
      continue;
    }
    if (fenced !== null) {
      fence = fenced;
      continue;
    }
    if (line.trim() === '') continue;
    if (DIVIDER.test(line)) {
      // Two breaks in a row are one break.
      if (blocks[blocks.length - 1]?.kind !== 'break') blocks.push({ kind: 'break' });
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      const block = textBlock(heading[2] ?? '');
      if (block.runs.length > 0) blocks.push({ kind: 'heading', level: (heading[1] ?? '#').length, ...block });
      continue;
    }
    const quote = QUOTE.exec(line);
    if (quote) {
      // The first line of a callout names its kind ("[!note] Title"): only the title is the writer's.
      const block = textBlock((quote[1] ?? '').replace(/^\[![^\]]*\][+-]?\s*/, ''));
      if (block.runs.length > 0) blocks.push({ kind: 'quote', ...block });
      continue;
    }
    const item = ITEM.exec(line);
    if (item) {
      const indent = (item[1] ?? '').replace(/\t/g, '  ').length;
      const typed = item[2] ?? '-';
      let words = item[3] ?? '';
      let marker = /\d/.test(typed) ? typed : BULLET;
      const box = /^\[([ xX])\]\s+/.exec(words);
      if (box) {
        marker = box[1] === ' ' ? BOX_EMPTY : BOX_TICKED;
        words = words.slice(box[0].length);
      }
      const block = textBlock(words);
      if (block.runs.length > 0) blocks.push({ kind: 'item', depth: Math.min(3, Math.floor(indent / 2)), marker, ...block });
      continue;
    }
    const block = textBlock(line);
    if (block.runs.length > 0) blocks.push({ kind: 'paragraph', ...block });
  }
  // A fence that was never closed: what follows it is kept, as code.
  if (fence !== null && code.length > 0) blocks.push({ kind: 'code', lines: code });

  // A break with nothing before it or nothing after it separates nothing.
  while (blocks[0]?.kind === 'break') blocks.shift();
  while (blocks[blocks.length - 1]?.kind === 'break') blocks.pop();
  return blocks;
}

/** The words of some blocks as plain text, one block to a line: for counting. */
export function plainTextOfBlocks(blocks: readonly Block[]): string {
  return blocks
    .map((block) => (block.kind === 'break' ? '' : block.kind === 'code' ? block.lines.join('\n') : plainText(block.runs)))
    .join('\n');
}

/**
 * A scene's text as Markdown for a compiled manuscript: as the writer wrote
 * it, with its own headings moved down by `demote` levels (never below the
 * sixth) so that they sit under the chapter's and the scene's. Text between
 * ``` fences is left alone.
 */
export function demoteHeadings(text: string, demote: number): string {
  let fence: string | null = null;
  return text
    .split('\n')
    .map((line) => {
      const fenced = FENCE.exec(line)?.[1] ?? null;
      if (fence !== null) {
        if (fenced !== null && fenced[0] === fence[0] && fenced.length >= fence.length) fence = null;
        return line;
      }
      if (fenced !== null) {
        fence = fenced;
        return line;
      }
      const heading = /^(\s{0,3})(#{1,6})(\s+.*)$/.exec(line);
      if (!heading || demote <= 0) return line;
      const level = Math.min(6, (heading[2] ?? '#').length + demote);
      return `${heading[1] ?? ''}${'#'.repeat(level)}${heading[3] ?? ''}`;
    })
    .join('\n');
}
