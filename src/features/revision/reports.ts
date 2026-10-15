// What the writer is told once a replace is over.

import { formatCount } from '../../core/binderModel';
import { outsideText } from '../../ui/renameLinks';
import { notesText } from './results';
import type { LinksReport, ReplaceReport } from './keeper';

/** "Replaced 3 changes in 2 scenes. Left as they were: Opening (it was changed since the search ...)." */
export function reportText(report: ReplaceReport): string {
  const parts: string[] = [];
  if (report.changes > 0) {
    parts.push(
      `Replaced ${formatCount(report.changes)} ${report.changes === 1 ? 'place' : 'places'} in ${notesText(report.scenes, report.chapters ?? 0)}. A snapshot of each was taken first.`,
    );
  } else parts.push('Nothing was replaced.');
  for (const problem of report.problems) parts.push(`${problem.title}: ${problem.message}`);
  return parts.join('\n');
}

/** What the writer is told about the links to a renamed entity; null when there were none. */
export function linksText(report: LinksReport): string | null {
  const parts: string[] = [];
  if (report.changed > 0) {
    parts.push(`${formatCount(report.changed)} ${report.changed === 1 ? 'link' : 'links'} in ${formatCount(report.notes)} ${report.notes === 1 ? 'note' : 'notes'} now ${report.changed === 1 ? 'leads' : 'lead'} to the new name.`);
  }
  if (report.missed.length > 0) parts.push(`The links in these notes could not be changed: ${report.missed.join(', ')}.`);
  if (report.outside.length > 0) parts.push(outsideText(report.outside.length));
  return parts.length === 0 ? null : parts.join('\n');
}

/** Why links from notes outside the project keep the old name. */
export { outsideText } from '../../ui/renameLinks';
