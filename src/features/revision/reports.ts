// What the writer is told once a replace is over.

import { formatCount } from '../../core/binderModel';
import type { ReplaceReport } from './keeper';

/** "Replaced 3 changes in 2 scenes. Left as they were: Opening (it was changed since the search ...)." */
export function reportText(report: ReplaceReport): string {
  const parts: string[] = [];
  if (report.changes > 0) {
    parts.push(
      `Replaced ${formatCount(report.changes)} ${report.changes === 1 ? 'place' : 'places'} in ${formatCount(report.scenes)} ${report.scenes === 1 ? 'scene' : 'scenes'}. A snapshot of each was taken first.`,
    );
  } else parts.push('Nothing was replaced.');
  for (const problem of report.problems) parts.push(`${problem.title}: ${problem.message}`);
  return parts.join('\n');
}
