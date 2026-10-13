// The manuscript as one Markdown note: every scene's text as the writer
// wrote it (links and all), without properties and comments, under the
// chapter headings, in binder order.
//
// Markdown has no pages, so there is no running header and a chapter does
// not start a new page. Scenes are set apart by a line of three stars, which
// every Markdown reader shows as a break.

import { contentsOf, wordsLine } from './manuscript';
import type { ExportOptions, Manuscript } from './manuscript';
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

export function toMarkdown(manuscript: Manuscript, options: Pick<ExportOptions, 'titlePage' | 'contents' | 'sceneTitles'>): string {
  const pieces: string[] = [];
  // Under a title of its own, every chapter moves one level down.
  const shift = options.titlePage ? 1 : 0;

  if (options.titlePage) {
    pieces.push(heading(1, manuscript.title));
    if (manuscript.author !== '') pieces.push(headingText(manuscript.author));
    pieces.push(wordsLine(manuscript.words));
  }

  const entries = options.contents ? contentsOf(manuscript, options.sceneTitles) : [];
  if (entries.length > 0) {
    pieces.push(
      entries.map((entry) => `${'  '.repeat(Math.max(0, entry.level - 1))}- ${headingText(entry.title)}`).join('\n'),
    );
  }

  for (const part of manuscript.parts) {
    if (part.kind === 'chapter') {
      pieces.push(heading(part.level + shift, part.title));
      continue;
    }
    if (options.sceneTitles) pieces.push(heading(part.level + shift, part.title));
    else if (part.opens !== 'first') pieces.push(MARKDOWN_SCENE_BREAK);
    // The scene's own headings sit below the chapter's (and below its own title).
    const above = part.level + shift - (options.sceneTitles ? 0 : 1);
    if (part.markdown !== '') pieces.push(demoteHeadings(part.markdown, above));
  }
  return `${pieces.join('\n\n')}\n`;
}
