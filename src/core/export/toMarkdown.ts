// The manuscript as one Markdown note: every scene's text as the writer
// wrote it (links and all), without properties and comments, under the
// chapter headings, in binder order.
//
// Markdown has no pages, so there is no running header and a chapter does
// not start a new page. Scenes are set apart by a line of three stars, which
// every Markdown reader shows as a break.
//
// A dedication comes after the title, an epigraph after it as a quote, and
// the acknowledgements and about the author at the end under their headings.

import { PRESETS, contentsOf, titledMatter, wordsLine } from './manuscript';
import type { ExportOptions, Manuscript, MatterPart } from './manuscript';
import { demoteHeadings } from './markdown';

/** The line between two scenes. */
export const MARKDOWN_SCENE_BREAK = '* * *';

/** A title as one line of Markdown that cannot be read as markup. */
function headingText(title: string): string {
  return title.replace(/\s+/g, ' ').trim().replace(/([\\*_`[\]<>#])/g, '\\$1');
}

function heading(level: number, title: string): string {
  return `${'#'.repeat(Math.min(6, Math.max(1, level)))} ${headingText(title)}`;
}

/** A page before or after the text: its heading at the top level of the chapters, an epigraph as a quote. */
function matterMarkdown(part: MatterPart, shift: number): string[] {
  const pieces: string[] = [];
  if (part.title !== null) pieces.push(heading(1 + shift, part.title));
  const text = demoteHeadings(part.markdown, 1 + shift);
  pieces.push(part.role === 'epigraph' ? text.split('\n').map((line) => (line === '' ? '>' : `> ${line}`)).join('\n') : text);
  return pieces;
}

export function toMarkdown(
  manuscript: Manuscript,
  options: Pick<ExportOptions, 'titlePage' | 'contents'> & Partial<Pick<ExportOptions, 'preset'>>,
): string {
  const pieces: string[] = [];
  const preset = PRESETS[options.preset ?? 'manuscript'];
  // Under a title of its own, every chapter moves one level down.
  const shift = options.titlePage ? 1 : 0;

  if (options.titlePage) {
    pieces.push(heading(1, manuscript.title));
    if (manuscript.author !== '') pieces.push(headingText(manuscript.author));
    if (preset.wordsOnTitlePage) pieces.push(wordsLine(manuscript.words));
  }

  for (const part of manuscript.front) pieces.push(...matterMarkdown(part, shift));

  const entries = options.contents ? [...contentsOf(manuscript), ...titledMatter(manuscript.back)] : [];
  if (entries.length > 0) {
    pieces.push(
      entries.map((entry) => `${'  '.repeat(entry.kind === 'matter' ? 0 : Math.max(0, entry.level - 1))}- ${headingText(entry.title ?? '')}`).join('\n'),
    );
  }

  for (const part of manuscript.parts) {
    if (part.kind === 'chapter') {
      pieces.push(heading(part.level + shift, part.title));
      continue;
    }
    if (part.titled) pieces.push(heading(part.level + shift, part.title));
    else if (part.opens !== 'first') pieces.push(MARKDOWN_SCENE_BREAK);
    // The scene's own headings sit below the chapter's (and below its own title).
    const above = part.level + shift - (part.titled ? 0 : 1);
    if (part.markdown !== '') pieces.push(demoteHeadings(part.markdown, above));
  }
  for (const part of manuscript.back) pieces.push(...matterMarkdown(part, shift));
  return `${pieces.join('\n\n')}\n`;
}
