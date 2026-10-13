// Counting the to-do lines of a scene: "- [ ] look up the train times".
//
// A to-do line is a list item that starts with a tick box. Lines inside the
// properties block at the top of a note, and inside a fenced block of code,
// are not to-dos, whatever they look like.

import { stripFrontmatter } from '../wordCount';

/** How many to-do lines a scene has, and how many of them are ticked. */
export interface TaskCount {
  readonly done: number;
  readonly total: number;
}

export const NO_TASKS: TaskCount = Object.freeze({ done: 0, total: 0 });

/** The line that opens or closes a block of code: three or more backticks or tildes (in a quote or a list too). */
const FENCE = /^\s*(?:>\s*)*(`{3,}|~{3,})(.*)$/;

/** A list item ("-", "*", "+", "1.", "1)") that starts with a tick box, in a quote or not. */
const TASK = /^\s*(?:>\s*)*(?:[-*+]|\d{1,9}[.)])\s+\[(.)\](?:\s|$)/;

/**
 * Count the to-do lines of a note. A box ticked with "x" or "X" is done; a
 * box with any other mark in it (such as "-" for "dropped") is counted, but
 * not as done.
 *
 * @param markdown the whole note, as stored
 */
export function countTasks(markdown: string): TaskCount {
  const body = stripFrontmatter(markdown);
  let done = 0;
  let total = 0;
  /** The fence that opened the block of code the line is in, if it is in one. */
  let fence: { readonly mark: string; readonly length: number } | null = null;
  let lineStart = 0;
  while (lineStart <= body.length) {
    let lineEnd = body.indexOf('\n', lineStart);
    if (lineEnd < 0) lineEnd = body.length;
    let line = body.slice(lineStart, lineEnd);
    lineStart = lineEnd + 1;
    if (line.endsWith('\r')) line = line.slice(0, -1);

    const found = FENCE.exec(line);
    const run = found?.[1] ?? '';
    if (fence) {
      // Closed by a line of the same mark, at least as long, with nothing after it.
      if (run.startsWith(fence.mark) && run.length >= fence.length && (found?.[2] ?? '').trim() === '') fence = null;
      continue;
    }
    if (run !== '') {
      fence = { mark: run.charAt(0), length: run.length };
      continue;
    }
    const task = TASK.exec(line);
    if (!task) continue;
    total++;
    if (task[1] === 'x' || task[1] === 'X') done++;
  }
  return total === 0 ? NO_TASKS : { done, total };
}

/** Add two counts up. */
export function addTasks(a: TaskCount, b: TaskCount): TaskCount {
  if (b.total === 0) return a;
  if (a.total === 0) return b;
  return { done: a.done + b.done, total: a.total + b.total };
}

/** A count as a cell shows it: "1/3"; nothing when there are no to-do lines. */
export function formatTasks(tasks: TaskCount | null | undefined): string {
  if (!tasks || tasks.total === 0) return '';
  return `${tasks.done}/${tasks.total}`;
}
