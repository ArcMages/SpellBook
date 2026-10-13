// The manuscript as a web page, laid out as a standard manuscript when it is
// printed: 12 point serif, double spacing, first lines set in, a # between
// scenes, every chapter on a new page, one inch of margin.
//
// Every paragraph and heading carries the direction of its own text
// (dir="rtl" for Hebrew), so a mixed manuscript reads right in a browser and
// on paper. The page holds nothing but the manuscript: no paths of the
// vault, and no script, except for the Print button of the page that is
// made for printing.
//
// Printing this page and choosing "Save as PDF" is the way to a PDF on
// every device. The line at the top of each page (author, title, page
// number) is asked for with the page rules of CSS, which not every browser
// follows when it prints: Chrome and Edge do, Safari leaves the line out.

import { looksArabic } from './direction';
import type { Direction } from './direction';
import { MARGIN_TWIPS, PAPER_SIZES, SCENE_BREAK_MARK, contentsOf, headerText, wordsLine } from './manuscript';
import type { ExportOptions, Manuscript } from './manuscript';
import { plainTextOfBlocks } from './markdown';
import type { Block, Run } from './markdown';

/** What the button on the page for printing says. */
export const PRINT_BUTTON_TEXT = 'Print / save as PDF';
export const PRINT_HINT_TEXT = 'To make a PDF: press the button, then choose "Save as PDF" where the printer is chosen.';
export const CONTENTS_TITLE = 'Contents';

/** Text made safe to stand in a page, also inside a quoted attribute. */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Text as a quoted string of a stylesheet. */
function cssString(text: string): string {
  return `"${text.replace(/[\\"<>&\n\r]/g, (character) => `\\${character.charCodeAt(0).toString(16)} `)}"`;
}

function runsHtml(runs: readonly Run[]): string {
  return runs
    .map((run) => {
      let html = escapeHtml(run.text);
      if (run.code) html = `<code>${html}</code>`;
      if (run.strike) html = `<s>${html}</s>`;
      if (run.italic) html = `<em>${html}</em>`;
      if (run.bold) html = `<strong>${html}</strong>`;
      return html;
    })
    .join('');
}

function blocksHtml(blocks: readonly Block[], base: Direction, out: string[]): void {
  // The first paragraph after a heading or a break is not set in.
  let first = true;
  for (const block of blocks) {
    if (block.kind === 'break') {
      out.push(`<p class="break">${SCENE_BREAK_MARK}</p>`);
      first = true;
      continue;
    }
    if (block.kind === 'code') {
      out.push(`<pre dir="ltr">${escapeHtml(block.lines.join('\n'))}</pre>`);
      first = true;
      continue;
    }
    const dir = block.direction ?? base;
    const text = runsHtml(block.runs);
    if (block.kind === 'heading') {
      out.push(`<h4 dir="${dir}">${text}</h4>`);
      first = true;
    } else if (block.kind === 'quote') {
      out.push(`<blockquote dir="${dir}"><p>${text}</p></blockquote>`);
    } else if (block.kind === 'item') {
      out.push(`<p class="item depth-${block.depth}" dir="${dir}"><span class="marker">${escapeHtml(block.marker)}</span> ${text}</p>`);
    } else {
      out.push(`<p${first ? ' class="first"' : ''} dir="${dir}">${text}</p>`);
      first = false;
    }
  }
}

function styles(manuscript: Manuscript, options: Pick<ExportOptions, 'titlePage' | 'header' | 'paper'>): string {
  const paper = PAPER_SIZES[options.paper];
  const margin = `${MARGIN_TWIPS / 1440}in`;
  // The line sits at the far end of the top margin: the right of a left-to-right page.
  const corner = manuscript.direction === 'rtl' ? '@top-left' : '@top-right';
  const header = options.header
    ? ` ${corner} { content: ${cssString(headerText(manuscript))} counter(page); font-family: "Times New Roman", Times, serif; font-size: 12pt; }`
    : '';
  const firstPage = options.header && options.titlePage ? `\n@page :first { ${corner} { content: none; } }` : '';
  return `@page { size: ${paper.css}; margin: ${margin};${header} }${firstPage}
html { background: white; color: black; }
body { font-family: "Times New Roman", Times, "David", "Noto Serif Hebrew", serif; font-size: 12pt; line-height: 2; margin: 0 auto; max-width: 6.5in; padding: 1in 1rem; }
p { margin: 0; text-indent: 0.5in; text-align: start; orphans: 2; widows: 2; }
p.first, p.item, blockquote p, .title-page p, .contents p { text-indent: 0; }
p.break { text-indent: 0; text-align: center; break-after: avoid; page-break-after: avoid; }
p.item { padding-inline-start: 0.5in; }
p.item.depth-1 { padding-inline-start: 1in; }
p.item.depth-2 { padding-inline-start: 1.5in; }
p.item.depth-3 { padding-inline-start: 2in; }
blockquote { margin: 0 0.5in; }
pre, code { font-family: "Courier New", Courier, monospace; font-size: 12pt; }
pre { margin: 0; white-space: pre-wrap; text-align: left; }
h1, h2, h3, h4 { font-size: 1em; font-weight: bold; text-align: center; margin: 2em 0 0; break-after: avoid; page-break-after: avoid; }
h4 { text-align: start; }
.chapter, .new-page { break-before: page; page-break-before: always; }
.chapter { padding-top: 2em; }
.title-page { text-align: center; padding: 3in 0 2em; break-after: page; page-break-after: always; }
.title-page h1 { margin: 0; }
.contents { break-after: page; page-break-after: always; }
.contents p.level-2 { padding-inline-start: 0.5in; }
.contents p.level-3 { padding-inline-start: 1in; }
.contents a { color: inherit; text-decoration: none; }
.print-bar { font-family: system-ui, sans-serif; font-size: 14px; line-height: 1.4; margin: 0 0 2em; padding: 12px; border: 1px solid gray; border-radius: 6px; text-align: center; }
.print-bar button { font-size: 16px; padding: 8px 16px; margin-bottom: 8px; }
@media print { body { max-width: none; padding: 0; } .print-bar { display: none; } }`;
}

/**
 * The manuscript as a whole web page.
 *
 * @param forPrinting true for the page that is made to be printed: it has a
 *   Print button at its top, which does not show on paper
 */
export function toHtml(
  manuscript: Manuscript,
  options: Pick<ExportOptions, 'titlePage' | 'header' | 'contents' | 'sceneTitles' | 'paper'>,
  forPrinting = false,
): string {
  const base = manuscript.direction;
  const body: string[] = [];

  if (forPrinting) {
    body.push(
      `<div class="print-bar" dir="ltr"><button type="button" onclick="print()">${escapeHtml(PRINT_BUTTON_TEXT)}</button><div>${escapeHtml(PRINT_HINT_TEXT)}</div></div>`,
    );
  }

  if (options.titlePage) {
    body.push('<section class="title-page">');
    body.push(`<h1 dir="auto">${escapeHtml(manuscript.title)}</h1>`);
    if (manuscript.author !== '') body.push(`<p class="author" dir="auto">${escapeHtml(manuscript.author)}</p>`);
    body.push(`<p class="words" dir="ltr">${escapeHtml(wordsLine(manuscript.words))}</p>`);
    body.push('</section>');
  }

  const entries = options.contents ? contentsOf(manuscript, options.sceneTitles) : [];
  if (entries.length > 0) {
    body.push('<nav class="contents">');
    body.push(`<h2 dir="ltr">${CONTENTS_TITLE}</h2>`);
    for (const entry of entries) {
      body.push(
        `<p class="level-${Math.min(3, entry.level)}" dir="${entry.direction}"><a href="#${entry.id}">${escapeHtml(entry.title)}</a></p>`,
      );
    }
    body.push('</nav>');
  }

  // Nothing has been printed on the page the text starts on: the first heading needs no new page.
  let pageIsNew = true;
  for (const part of manuscript.parts) {
    if (part.kind === 'chapter') {
      const tag = `h${Math.min(3, part.level) + 1}`;
      body.push(
        `<${tag} class="${pageIsNew ? 'chapter-first' : 'chapter'} level-${part.level}" id="${part.id}" dir="${part.direction}">${escapeHtml(part.title)}</${tag}>`,
      );
      pageIsNew = true;
      continue;
    }
    const newPage = part.opens === 'page' && !pageIsNew;
    if (options.sceneTitles) {
      body.push(
        `<h4 class="scene-title${newPage ? ' new-page' : ''}" id="${part.id}" dir="${part.direction}">${escapeHtml(part.title)}</h4>`,
      );
    } else if (part.opens === 'break') {
      body.push(`<p class="break">${SCENE_BREAK_MARK}</p>`);
    } else if (newPage) {
      body.push('<div class="new-page"></div>');
    }
    blocksHtml(part.blocks, base, body);
    pageIsNew = false;
  }

  const sample = manuscript.parts.map((part) => (part.kind === 'scene' ? plainTextOfBlocks(part.blocks.slice(0, 3)) : part.title)).join(' ');
  const lang = base === 'rtl' ? ` lang="${looksArabic(sample) ? 'ar' : 'he'}"` : '';
  return `<!DOCTYPE html>
<html${lang} dir="${base}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(manuscript.title)}</title>
<style>
${styles(manuscript, options)}
</style>
</head>
<body>
${body.join('\n')}
</body>
</html>
`;
}
