// The export's own reader of a scene's Markdown (src/core/export/markdown.ts)
// and the direction of text (direction.ts).

import { describe, expect, it } from 'vitest';
import {
  BULLET,
  demoteHeadings,
  directionOf,
  manuscriptText,
  parseBlocks,
  parseInline,
  plainText,
  splitByScript,
} from '../../../src/core/export';
import type { Run } from '../../../src/core/export';

/** Runs in short: plain text as it is, **bold**, *italic*, ~strike~, `code`. */
function shown(runs: readonly Run[]): string {
  return runs
    .map((run) => {
      let text = run.text;
      if (run.code) text = `\`${text}\``;
      if (run.strike) text = `~${text}~`;
      if (run.italic) text = `<i>${text}</i>`;
      if (run.bold) text = `<b>${text}</b>`;
      return text;
    })
    .join('');
}

describe('manuscriptText', () => {
  it('leaves out the properties block and comments, and nothing else', () => {
    const note = '---\nstatus: Done\ncompile: true\n---\nFirst line. %%a private note%%\n%%\nmany\nlines\n%%\nSecond <!-- hidden --> line.\n';
    expect(manuscriptText(note)).toBe('First line.\n\nSecond line.\n');
  });

  it('keeps a lone %% and text that has no properties block', () => {
    expect(manuscriptText('100%% sure.\n')).toBe('100%% sure.\n');
    expect(manuscriptText('Windows\r\nline ends\r\n')).toBe('Windows\nline ends\n');
  });
});

describe('parseInline', () => {
  it('works out bold, italics, both, strike-through and code', () => {
    expect(shown(parseInline('a **b** c *d* e ***f*** g ~~h~~ `i*j*`'))).toBe('a <b>b</b> c <i>d</i> e <b><i>f</i></b> g ~h~ `i*j*`');
    expect(shown(parseInline('__b__ and _i_'))).toBe('<b>b</b> and <i>i</i>');
    expect(shown(parseInline('**bold *both* bold**'))).toBe('<b>bold </b><b><i>both</i></b><b> bold</b>');
  });

  it('leaves marks that have no partner as they were typed', () => {
    expect(shown(parseInline('2 * 3 * 4'))).toBe('2 * 3 * 4');
    expect(shown(parseInline('a *lonely star'))).toBe('a *lonely star');
    expect(shown(parseInline('snake_case_name and file_name'))).toBe('snake_case_name and file_name');
    expect(shown(parseInline('\\*not italics\\*'))).toBe('*not italics*');
  });

  it('keeps the words of links, and leaves out pictures, embedded notes, footnote marks and HTML tags', () => {
    expect(plainText(parseInline('See [the map](https://example.com/map) and [[Places/Harbour|the harbour]] or [[Anna]].'))).toBe(
      'See the map and the harbour or Anna.',
    );
    expect(plainText(parseInline('Before ![[map.png]] ![alt](x.png)after'))).toBe('Before after');
    expect(plainText(parseInline('A claim[^1] in <span class="x">red</span>.<br>Next'))).toBe('A claim in red. Next');
    expect(plainText(parseInline('==highlighted== words'))).toBe('highlighted words');
  });

  it('works the same in Hebrew', () => {
    expect(shown(parseInline('שלום **אחותי** היקרה'))).toBe('שלום <b>אחותי</b> היקרה');
  });
});

describe('parseBlocks', () => {
  it('makes a paragraph of every line, with or without an empty line between', () => {
    const blocks = parseBlocks('One.\nTwo.\n\n\nThree.\n');
    expect(blocks.map((block) => block.kind)).toEqual(['paragraph', 'paragraph', 'paragraph']);
  });

  it('reads headings, quotes, lists, tick boxes, breaks and code', () => {
    const blocks = parseBlocks(
      ['## A heading ##', '> quoted', '> [!note] A callout', '- one', '  - inner', '3. three', '- [ ] to do', '- [x] done', '---', '```', 'let x = *1*;', '```', 'End. ^block1'].join('\n'),
    );
    expect(
      blocks.map((block) =>
        block.kind === 'break' ? '#' : block.kind === 'code' ? `code:${block.lines.join('|')}` : `${block.kind}:${plainText(block.runs)}`,
      ),
    ).toEqual([
      'heading:A heading',
      'quote:quoted',
      'quote:A callout',
      'item:one',
      'item:inner',
      'item:three',
      'item:to do',
      'item:done',
      '#',
      'code:let x = *1*;',
      'paragraph:End.',
    ]);
    const items = blocks.filter((block) => block.kind === 'item');
    expect(items.map((item) => (item.kind === 'item' ? [item.marker, item.depth] : null))).toEqual([
      [BULLET, 0],
      [BULLET, 1],
      ['3.', 0],
      [String.fromCharCode(0x2610), 0],
      [String.fromCharCode(0x2611), 0],
    ]);
    expect(blocks[0]).toMatchObject({ kind: 'heading', level: 2 });
  });

  it('takes ***, ___, - - - and a lone # for a scene break, and drops one at either end', () => {
    expect(parseBlocks('***\nA\n* * *\n___\nB\n#\nC\n- - -\n').map((block) => block.kind)).toEqual([
      'paragraph',
      'break',
      'paragraph',
      'break',
      'paragraph',
    ]);
  });

  it('gives each block the direction of its own text', () => {
    const blocks = parseBlocks('Hello there.\nשלום לך.\n1984.\n"שלום," he said.\nHe said שלום.\n');
    expect(blocks.map((block) => (block.kind === 'paragraph' ? block.direction : 'x'))).toEqual(['ltr', 'rtl', null, 'rtl', 'ltr']);
  });
});

describe('demoteHeadings', () => {
  it('moves headings down, never below the sixth level, and leaves code alone', () => {
    expect(demoteHeadings('# A\n##### B\ntext # not\n```\n# code\n```\n', 2)).toBe('### A\n###### B\ntext # not\n```\n# code\n```\n');
    expect(demoteHeadings('# A', 0)).toBe('# A');
  });
});

describe('direction', () => {
  it('goes by the first letter', () => {
    expect(directionOf('שלום world')).toBe('rtl');
    expect(directionOf('world שלום')).toBe('ltr');
    expect(directionOf('  "مرحبا"')).toBe('rtl');
    expect(directionOf('123 - 456!')).toBeNull();
    expect(directionOf('')).toBeNull();
  });

  it('cuts a mixed line into stretches of one script, each keeping the spaces and marks after it', () => {
    expect(splitByScript('He said שלום, and left.', 'ltr')).toEqual([
      { text: 'He said ', rtl: false },
      { text: 'שלום, ', rtl: true },
      { text: 'and left.', rtl: false },
    ]);
    expect(splitByScript('"שלום" 3', 'ltr')).toEqual([{ text: '"שלום" 3', rtl: true }]);
    expect(splitByScript('# 12', 'rtl')).toEqual([{ text: '# 12', rtl: true }]);
    expect(splitByScript('', 'ltr')).toEqual([]);
    // Pointed Hebrew stays in one piece.
    expect(splitByScript('שָׁלוֹם', 'ltr')).toHaveLength(1);
  });
});
