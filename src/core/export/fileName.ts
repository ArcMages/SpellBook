// The name of an exported file. Every export is a new file: the name holds
// the day, and a number when that day already has one, so that nothing is
// ever written over and two devices never write the same file.

import { sanitiseFileName } from '../names';
import type { ExportFormat } from './manuscript';

/** How each kind of export's file name ends. */
export const EXTENSIONS: Readonly<Record<ExportFormat, string>> = {
  docx: 'docx',
  html: 'html',
  markdown: 'md',
  print: 'html',
};

/** No more names than this are tried for one export. */
export const MAX_NAME_TRIES = 200;

/**
 * The name for an export, with its ending: "My Novel 2026-10-13.docx", and
 * for a later try "My Novel 2026-10-13 2.docx". An export of one folder
 * carries the folder's name too, and the page made for printing says so.
 *
 * @param title  the project's title
 * @param folder the name of the folder that is exported, or null for the whole manuscript
 * @param day    today, as YYYY-MM-DD
 * @param attempt 1 for the first name, 2 for the next, and so on
 */
export function exportFileName(title: string, folder: string | null, format: ExportFormat, day: string, attempt = 1): string {
  // The title is cut short first, so that what tells exports apart is never cut off.
  const what = [...sanitiseFileName([title, ...(folder === null ? [] : [folder])].join(' - '), 'Manuscript')].slice(0, 80).join('').trim();
  const tail = `${format === 'print' ? ' (to print)' : ''} ${day}${attempt > 1 ? ` ${attempt}` : ''}`;
  return `${sanitiseFileName(what + tail, 'Manuscript')}.${EXTENSIONS[format]}`;
}
