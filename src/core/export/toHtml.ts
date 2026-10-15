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
// The preset decides the look: the standard manuscript format, a reading
// copy (book-like spacing, a row of stars between scenes, lines set flush
// with both margins) or a proof (wide margins to write notes in). Pages
// before and after the text (dedication, epigraph, acknowledgements, about
// the author) each start a page of their own.
//
// Printing this page and choosing "Save as PDF" is the way to a PDF on
// every device. The line at the top of each page (author, title, page
// number) is asked for with the page rules of CSS, which not every browser
// follows when it prints: Chrome and Edge do, Safari leaves the line out.

import type { Direction } from './direction';
import { MARGIN_TWIPS, PAPER_SIZES, PRESETS, contentsOf, headerText, headingDirection, titledMatter, wordsLine } from './manuscript';
import type { ExportOptions, Manuscript, MatterPart, PaperId, Preset } from './manuscript';
import type { Block, Run } from './markdown';

/** What the button on the page for printing says. */
export const PRINT_BUTTON_TEXT = 'Print / save as PDF';
export const PRINT_HINT_TEXT = 'To make a PDF: press the button, then choose "Save as PDF" where the printer is chosen.';
/** The list of contents' heading in an English book; a Hebrew book has its own (see BOOK_WORDS). */
export const CONTENTS_TITLE = 'Contents';

/** How a paper is named on the page for printing. */
const PAPER_LABELS: Readonly<Record<PaperId, string>> = { a4: 'A4', letter: 'US Letter' };

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

function blocksHtml(blocks: readonly Block[], base: Direction, out: string[], breakMark: string): void {
  // The first paragraph after a heading or a break is not set in.
  let first = true;
  for (const block of blocks) {
    if (block.kind === 'break') {
      out.push(`<p class="break">${escapeHtml(breakMark)}</p>`);
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

/** A page before or after the text, on a page of its own. */
function matterHtml(part: MatterPart, base: Direction, out: string[], breakMark: string): void {
  out.push(`<section class="matter ${part.role} new-page" id="${part.id}" dir="${part.direction}">`);
  if (part.title !== null) out.push(`<h2 dir="${part.direction}">${escapeHtml(part.title)}</h2>`);
  blocksHtml(part.blocks, base, out, breakMark);
  out.push('</section>');
}

/** A length in inches, as CSS writes it: "1in", "1.5in". */
function inches(value: number): string {
  return `${Number(value.toFixed(2))}in`;
}

/** The margins as one CSS value: "1in" when all are the same. */
function marginsCss(preset: Preset): string {
  const { top, bottom, side } = preset.margins;
  if (top === bottom && top === side) return inches(top);
  return top === bottom ? `${inches(top)} ${inches(side)}` : `${inches(top)} ${inches(side)} ${inches(bottom)}`;
}

type HtmlOptions = Pick<ExportOptions, 'titlePage' | 'header' | 'contents' | 'paper'> & Partial<Pick<ExportOptions, 'preset'>>;

function styles(manuscript: Manuscript, options: HtmlOptions, preset: Preset): string {
  const paper = PAPER_SIZES[options.paper];
  // The line sits at the far end of the top margin: the right of a left-to-right page.
  const corner = manuscript.direction === 'rtl' ? '@top-left' : '@top-right';
  const header = options.header
    ? ` ${corner} { content: ${cssString(headerText(manuscript))} counter(page); font-family: "Times New Roman", Times, serif; font-size: 12pt; }`
    : '';
  const firstPage = options.header && options.titlePage ? `\n@page :first { ${corner} { content: none; } }` : '';
  // On the screen the text is as wide as it is on paper.
  const width = inches(paper.width / MARGIN_TWIPS - 2 * preset.margins.side);
  const look = [
    preset.justify ? '\np[dir] { text-align: justify; }' : '',
    preset.largeChapterTitles ? '\nh2, h3 { font-size: 1.5em; font-weight: normal; margin-bottom: 1em; }' : '',
    preset.id === 'proof' ? '\n.chapter, .scene-title { border-block-start: 1px dashed gray; }' : '',
  ].join('');
  return `@page { size: ${paper.css}; margin: ${marginsCss(preset)};${header} }${firstPage}
html { background: white; color: black; }
body { font-family: "Times New Roman", Times, "David", "Noto Serif Hebrew", serif; font-size: 12pt; line-height: ${preset.lineSpacing}; margin: 0 auto; max-width: ${width}; padding: 1in 1rem; }
p { margin: 0; text-indent: 0.5in; text-align: start; orphans: 2; widows: 2; }
p.first, p.item, blockquote p, .title-page p, .contents p, .matter.dedication p, .matter.epigraph p { text-indent: 0; }
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
.book-part { padding-top: 2.5in; font-size: 1.3em; }
.title-page { text-align: center; padding: 3in 0 2em; break-after: page; page-break-after: always; }
.title-page h1 { margin: 0; }
.contents { break-after: page; page-break-after: always; }
.contents p.level-2 { padding-inline-start: 0.5in; }
.contents p.level-3 { padding-inline-start: 1in; }
.contents a { color: inherit; text-decoration: none; }
.matter.dedication { padding-top: 2in; text-align: center; }
.matter.dedication p { text-align: center; }
.matter.epigraph { padding-top: 2in; margin-inline: 1in; }
.print-bar { font-family: system-ui, sans-serif; font-size: 14px; line-height: 1.4; margin: 0 0 2em; padding: 12px; border: 1px solid gray; border-radius: 6px; text-align: center; }
.print-bar button { font-size: 16px; padding: 8px 16px; margin-bottom: 8px; }
.print-bar ol { text-align: start; margin: 8px auto 0; max-width: 32em; }
@media print { body { max-width: none; padding: 0; } .print-bar { display: none; } }${look}`;
}

/** The box at the top of the page made for printing: the button, and what to choose in the print window. */
function printBar(options: HtmlOptions, preset: Preset): string {
  const margins = marginsCss(preset).split(' ');
  const marginWords = margins.length === 1 ? `${margins[0]} on every side` : `${margins[0]} at the top and bottom, ${margins[1]} at the sides`;
  const steps = [
    PRINT_HINT_TEXT,
    `Paper: ${PAPER_LABELS[options.paper]}, upright. The margins are ${marginWords}: leave "Margins" at "Default".`,
    'Switch off "Headers and footers" in the print window, so that the browser adds no address or date of its own.',
  ];
  return `<div class="print-bar" dir="ltr"><button type="button" onclick="print()">${escapeHtml(PRINT_BUTTON_TEXT)}</button><ol>${steps
    .map((step) => `<li>${escapeHtml(step)}</li>`)
    .join('')}</ol></div>`;
}

/**
 * The manuscript as a whole web page.
 *
 * @param forPrinting true for the page that is made to be printed: it has a
 *   Print button at its top, which does not show on paper
 */
export function toHtml(manuscript: Manuscript, options: HtmlOptions, forPrinting = false): string {
  const base = manuscript.direction;
  const preset = PRESETS[options.preset ?? 'manuscript'];
  const words = manuscript.headings;
  const breakMark = preset.sceneBreak;
  const body: string[] = [];

  if (forPrinting) body.push(printBar(options, preset));

  if (options.titlePage) {
    body.push('<section class="title-page">');
    body.push(`<h1 dir="auto">${escapeHtml(manuscript.title)}</h1>`);
    if (manuscript.author !== '') body.push(`<p class="author" dir="auto">${escapeHtml(manuscript.author)}</p>`);
    if (preset.wordsOnTitlePage) body.push(`<p class="words" dir="ltr">${escapeHtml(wordsLine(manuscript.words))}</p>`);
    body.push('</section>');
  }

  for (const part of manuscript.front) matterHtml(part, base, body, breakMark);

  const entries = options.contents ? [...contentsOf(manuscript), ...titledMatter(manuscript.back)] : [];
  if (entries.length > 0) {
    const contentsDirection: Direction = headingDirection(manuscript, 'contents');
    body.push(`<nav class="contents${manuscript.front.length > 0 ? ' new-page' : ''}">`);
    body.push(`<h2 dir="${contentsDirection}">${escapeHtml(words.contents)}</h2>`);
    for (const entry of entries) {
      const level = entry.kind === 'matter' ? 1 : Math.min(3, entry.level);
      body.push(`<p class="level-${level}" dir="${entry.direction}"><a href="#${entry.id}">${escapeHtml(entry.title ?? '')}</a></p>`);
    }
    body.push('</nav>');
  }

  // Nothing has been printed on the page the text starts on (the title page and the contents end their pages): the first heading needs no new page.
  let pageIsNew = true;
  // The pages before the text do not end their pages: what follows them starts one.
  let afterFront = manuscript.front.length > 0 && entries.length === 0;
  for (const part of manuscript.parts) {
    if (part.kind === 'chapter') {
      const tag = `h${Math.min(3, part.level) + 1}`;
      body.push(
        `<${tag} class="${pageIsNew || afterFront ? 'chapter-first' : 'chapter'}${afterFront ? ' new-page' : ''} level-${part.level}${part.bookPart === true ? ' book-part' : ''}" id="${part.id}" dir="${part.direction}">${escapeHtml(part.title)}</${tag}>`,
      );
      pageIsNew = true;
      afterFront = false;
      continue;
    }
    const newPage = (part.opens === 'page' && !pageIsNew) || afterFront;
    afterFront = false;
    if (part.titled) {
      body.push(
        `<h4 class="scene-title${newPage ? ' new-page' : ''}" id="${part.id}" dir="${part.direction}">${escapeHtml(part.title)}</h4>`,
      );
    } else if (newPage) {
      body.push('<div class="new-page"></div>');
    } else if (part.opens === 'break') {
      body.push(`<p class="break">${escapeHtml(breakMark)}</p>`);
    }
    blocksHtml(part.blocks, base, body, breakMark);
    pageIsNew = false;
  }

  for (const part of manuscript.back) matterHtml(part, base, body, breakMark);

  const lang = base === 'rtl' ? ` lang="${manuscript.language}"` : '';
  return `<!DOCTYPE html>
<html${lang} dir="${base}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(manuscript.title)}</title>
<style>
${styles(manuscript, options, preset)}
</style>
</head>
<body>
${body.join('\n')}
</body>
</html>
`;
}
