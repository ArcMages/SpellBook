// Changing To-do.md.
//
// Every function here takes the text of the file as it is right now and
// returns the new text. Nothing is remembered between calls, so the caller
// can (and should) read the file again just before each change.
//
// Two promises:
//
//  1. Only the lines that must change do. A change to one to-do rewrites that
//     line and no other; adding, removing and moving touch one line each.
//     Line breaks, headings, notes and blank lines stay as they were.
//
//  2. A change never lands on the wrong line. The to-do is named by where it
//     was and what it said (a TaskRef). If the file changed underneath, the
//     same text is looked for close by; if it is not there, nothing changes
//     and the result says so.

import { isDateText } from './fromCore';
import { DUE_MARK, dueMarks, findTask, joinTaskLine, parseTodo, shieldedBlocks, splitTaskLine, withoutDue } from './todo';
import type { ShieldedBlock, TaskParts, TaskRef, TodoFile, TodoTask } from './todo';

/**
 * What a change to To-do.md came to.
 *  - done:    `text` is the new file text to write. `task` names the to-do
 *             where it is now (null after a removal), ready for a next change.
 *  - noop:    nothing to write. "not-found": the to-do is no longer in the
 *             file as it was (read the file again and redraw).
 *             "target-missing": the same, for the to-do it was to be moved
 *             next to. "unchanged": it already is as asked.
 *  - refused: nothing to write, because what was asked makes no to-do:
 *             "empty-text" or "invalid-date".
 * `message` says the same in plain English.
 */
export type TodoEdit =
  | { readonly status: 'done'; readonly text: string; readonly task: TaskRef | null }
  | {
      readonly status: 'noop';
      readonly reason: 'not-found' | 'target-missing' | 'unchanged';
      readonly message: string;
    }
  | { readonly status: 'refused'; readonly reason: 'empty-text' | 'invalid-date'; readonly message: string };

/** A to-do to add. */
export interface NewTask {
  /** What to do. Free text in any language; line breaks become spaces. */
  readonly title: string;
  /** When it is due, as YYYY-MM-DD. Leave out (or null) for no date. */
  readonly due?: string | null;
  /** True to add it already ticked. Default: not done. */
  readonly done?: boolean;
}

const NOT_FOUND: TodoEdit = {
  status: 'noop',
  reason: 'not-found',
  message: 'That to-do is no longer in the file as it was, so nothing was changed.',
};

const TARGET_MISSING: TodoEdit = {
  status: 'noop',
  reason: 'target-missing',
  message: 'The to-do it should go next to is no longer in the file as it was, so nothing was moved.',
};

const EMPTY_TEXT: TodoEdit = { status: 'refused', reason: 'empty-text', message: 'A to-do needs some text.' };

const unchanged = (message: string): TodoEdit => ({ status: 'noop', reason: 'unchanged', message });

const invalidDate = (date: string): TodoEdit => ({
  status: 'refused',
  reason: 'invalid-date',
  message: `"${date}" is not a date written as YYYY-MM-DD.`,
});

const isBlank = (character: string | undefined): boolean => character === ' ' || character === '\t';

const isIdCharacter = (character: string | undefined): boolean =>
  character !== undefined && /^[A-Za-z0-9-]$/.test(character);

/** A to-do is one line: line breaks in new text become single spaces, and the ends are trimmed. */
function oneLine(text: string): string {
  return text.replace(/[\r\n\u{2028}\u{2029}]+/gu, ' ').trim();
}

/** How far a line is indented. A tab counts as four spaces. */
function indentWidth(raw: string): number {
  let width = 0;
  for (const character of raw) {
    if (character === ' ') width += 1;
    else if (character === '\t') width += 4;
    else break;
  }
  return width;
}

/**
 * Put a due date into text that has none: at the end, but in front of any
 * spaces that trail the line and in front of a block id (" ^abc123"), which
 * Obsidian only recognises as the last thing on a line.
 */
function insertDue(text: string, marker: string): string {
  let end = text.length;
  while (end > 0 && isBlank(text[end - 1])) end--;
  let core = end;
  let idStart = end;
  while (idStart > 0 && isIdCharacter(text[idStart - 1])) idStart--;
  if (idStart < end && idStart > 0 && text[idStart - 1] === '^') {
    const caret = idStart - 1;
    let before = caret;
    while (before > 0 && isBlank(text[before - 1])) before--;
    if (before < caret || caret === 0) core = before;
  }
  const head = text.slice(0, core);
  const tail = text.slice(core);
  const join = tail === '' || isBlank(tail[0]) ? '' : ' ';
  return `${head}${head === '' ? '' : ' '}${marker}${join}${tail}`;
}

/** The text with this due date: the date it already carries is swapped, or one is added. */
function withDue(text: string, due: string): string {
  const marks = dueMarks(text);
  const last = marks[marks.length - 1];
  if (last === undefined) return insertDue(text, `${DUE_MARK} ${due}`);
  return text.slice(0, last.dateStart) + due + text.slice(last.dateStart + last.date.length);
}

/** The lines of the file as a working copy. */
interface Draft {
  readonly bom: string;
  readonly raws: string[];
  readonly endings: string[];
}

function draftOf(todo: TodoFile): Draft {
  return { bom: todo.bom, raws: todo.lines.map((line) => line.raw), endings: [...todo.endings] };
}

function textOf(draft: Draft): string {
  return draft.bom + draft.raws.map((raw, position) => raw + (draft.endings[position] ?? '')).join('');
}

/**
 * Add a line so that it becomes line number `index`. The line breaks already
 * in the file stay where they are; the one that is added matches its
 * neighbour. A file that did not end with a line break still does not.
 */
function insertLine(draft: Draft, index: number, raw: string): void {
  const count = draft.raws.length;
  const fileBreak = draft.endings.find((ending) => ending !== '') ?? '\n';
  draft.raws.splice(index, 0, raw);
  if (count === 0) {
    draft.endings.push(fileBreak);
    return;
  }
  const neighbour = index >= count ? count - 1 : index;
  draft.endings.splice(neighbour, 0, draft.endings[neighbour] || fileBreak);
}

/** Replace one to-do line by the same line with some of its pieces changed. */
function rewrite(todo: TodoFile, task: TodoTask, parts: TaskParts): TodoEdit {
  const raw = joinTaskLine(parts);
  const draft = draftOf(todo);
  draft.raws[task.line] = raw;
  return { status: 'done', text: textOf(draft), task: { line: task.line, raw } };
}

/** The code blocks (and the properties block) of a file: where no line may be put, because it would not be a to-do there. */
function blocksOf(todo: TodoFile): ShieldedBlock[] {
  return shieldedBlocks(todo.lines.map((line) => line.raw));
}

/**
 * The last line that belongs to a to-do: the line itself, or the last of the
 * notes written under it. A note belongs to it when it is indented further
 * than the to-do; blank lines between such notes belong too. Another to-do
 * never does, however far it is indented.
 *
 * A code block among the notes belongs as a whole, down to its closing
 * fence, whatever the indent of the lines inside it: a line put after this
 * one must never land inside a block, where it would be code and no to-do.
 * A code block that is never closed does not belong: it runs to the end of
 * the note, so the only place left for a line is above it.
 */
function lastLineOf(todo: TodoFile, task: TodoTask, blocks: readonly ShieldedBlock[]): number {
  const own = indentWidth(task.raw);
  let last = task.line;
  for (let i = task.line + 1; i < todo.lines.length; i++) {
    const line = todo.lines[i];
    if (line === undefined || line.kind === 'task') break;
    if (line.raw.trim() === '') continue;
    if (indentWidth(line.raw) <= own) break;
    const block = blocks.find((candidate) => candidate.from === i);
    if (block !== undefined) {
      if (!block.closed) break;
      i = block.to;
    }
    last = i;
  }
  return last;
}

/**
 * True when nothing lies between two to-dos, the first above the second, but
 * the first one's own notes and blank lines. A heading, a line of text that
 * is no note of the first, or another to-do between them makes it false.
 */
function nothingElseBetween(
  todo: TodoFile,
  first: TodoTask,
  second: TodoTask,
  blocks: readonly ShieldedBlock[],
): boolean {
  for (let i = lastLineOf(todo, first, blocks) + 1; i < second.line; i++) {
    if ((todo.lines[i]?.raw ?? '').trim() !== '') return false;
  }
  return true;
}

/**
 * Where a line goes in a file that has no to-dos: at the end, or, when the
 * file ends inside a code block that is never closed, just above that block.
 */
function endOf(todo: TodoFile, blocks: readonly ShieldedBlock[]): number {
  const open = blocks.find((block) => !block.closed);
  return open === undefined ? todo.lines.length : open.from;
}

/**
 * The bullet and indent for a new to-do at the end of the list: those of the
 * least indented to-do in the last unbroken run of to-do lines, so that the
 * new one joins that list as a full member and not as somebody's sub-task.
 */
function styleOfLastRun(todo: TodoFile): { readonly indent: string; readonly bullet: string } {
  let chosen: TodoTask | null = null;
  for (let i = todo.tasks.length - 1; i >= 0; i--) {
    const task = todo.tasks[i];
    if (task === undefined) break;
    const below = todo.tasks[i + 1];
    if (below !== undefined && below.line !== task.line + 1) break;
    if (chosen === null || indentWidth(task.raw) < indentWidth(chosen.raw)) chosen = task;
  }
  return chosen === null ? { indent: '', bullet: '-' } : { indent: chosen.indent, bullet: chosen.bullet };
}

/**
 * Add a to-do: after the last to-do in the file (and any notes written under
 * it), or at the end of the file when it has none. Refused when the title is
 * empty or the date is not a real one.
 *
 * The new line never lands inside a code block, where it would be code and
 * no to-do: a block among the last to-do's notes is stepped over whole, and
 * a block that is never closed (it runs to the end of the note) gets the new
 * to-do just above it.
 *
 * A date typed into the title in the Tasks format counts as the due date when
 * `due` is left out; when both are given, `due` wins.
 */
export function addTask(text: string, task: NewTask): TodoEdit {
  const title = oneLine(task.title);
  if (title === '') return EMPTY_TEXT;
  const due = task.due ?? null;
  if (due !== null && !isDateText(due)) return invalidDate(due);

  const todo = parseTodo(text);
  const last = todo.tasks[todo.tasks.length - 1];
  const style = styleOfLastRun(todo);
  const raw = joinTaskLine({
    indent: style.indent,
    bullet: style.bullet,
    gap: ' ',
    box: task.done === true ? 'x' : ' ',
    sep: ' ',
    text: due === null ? title : withDue(title, due),
  });
  const blocks = blocksOf(todo);
  const index = last === undefined ? endOf(todo, blocks) : lastLineOf(todo, last, blocks) + 1;
  const draft = draftOf(todo);
  insertLine(draft, index, raw);
  return { status: 'done', text: textOf(draft), task: { line: index, raw } };
}

/**
 * Tick or untick a to-do. Ticking writes "x" in the box; unticking writes a
 * space. Only the box changes: no done date is added or removed.
 */
export function setTaskDone(text: string, ref: TaskRef, done: boolean): TodoEdit {
  const todo = parseTodo(text);
  const task = findTask(todo, ref);
  const parts = task === null ? null : splitTaskLine(task.raw);
  if (task === null || parts === null) return NOT_FOUND;
  if (task.done === done) return unchanged(done ? 'That to-do is already done.' : 'That to-do is already open.');
  return rewrite(todo, task, { ...parts, box: done ? 'x' : ' ' });
}

/** Tick a to-do that is open, untick one that is done. */
export function toggleTask(text: string, ref: TaskRef): TodoEdit {
  const task = findTask(parseTodo(text), ref);
  if (task === null) return NOT_FOUND;
  return setTaskDone(text, task, !task.done);
}

/**
 * Change what a to-do says. `title` replaces the to-do's title (its text
 * without the due date); the due date stays, unless the new title carries a
 * date of its own in the Tasks format, which then counts instead. The box and
 * the indent are not touched. Refused when the title is empty.
 */
export function setTaskText(text: string, ref: TaskRef, title: string): TodoEdit {
  const fresh = oneLine(title);
  if (fresh === '') return EMPTY_TEXT;
  const todo = parseTodo(text);
  const task = findTask(todo, ref);
  const parts = task === null ? null : splitTaskLine(task.raw);
  if (task === null || parts === null) return NOT_FOUND;
  if (fresh === task.title) return unchanged('That to-do already says that.');

  const marks = dueMarks(parts.text);
  const kept = marks[marks.length - 1];
  const carriesOwnDate = dueMarks(fresh).length > 0;
  const body =
    kept === undefined || carriesOwnDate ? fresh : insertDue(fresh, parts.text.slice(kept.start, kept.end));
  return rewrite(todo, task, { ...parts, text: body });
}

/**
 * Give a to-do a due date (YYYY-MM-DD), change the one it has, or, with null,
 * take it away. Only the date changes; the rest of the line is not touched.
 * Refused when the date is not a real one.
 */
export function setTaskDue(text: string, ref: TaskRef, due: string | null): TodoEdit {
  if (due !== null && !isDateText(due)) return invalidDate(due);
  const todo = parseTodo(text);
  const task = findTask(todo, ref);
  const parts = task === null ? null : splitTaskLine(task.raw);
  if (task === null || parts === null) return NOT_FOUND;
  if (due === task.due) {
    return unchanged(due === null ? 'That to-do has no due date.' : 'That to-do is already due on that day.');
  }
  const body = due === null ? withoutDue(parts.text) : withDue(parts.text, due);
  return rewrite(todo, task, { ...parts, text: body });
}

/**
 * Remove a to-do: its line and that line's own line break, nothing else.
 * Notes written under it stay in the file.
 */
export function removeTask(text: string, ref: TaskRef): TodoEdit {
  const todo = parseTodo(text);
  const task = findTask(todo, ref);
  if (task === null) return NOT_FOUND;
  const draft = draftOf(todo);
  draft.raws.splice(task.line, 1);
  draft.endings.splice(task.line, 1);
  return { status: 'done', text: textOf(draft), task: null };
}

/**
 * Move a to-do so that its line comes straight before, or straight after,
 * another to-do's line.
 *
 * Exactly one line moves: the to-do's own. Every other line (headings, notes,
 * blank lines, other to-dos) keeps its text and its order. "After" means
 * after the other to-do and the notes written under it, so those notes are
 * not cut off from it.
 *
 * The to-do goes to the other one wherever that is: moved before the first
 * to-do under the next heading, it ends up under that heading. "unchanged"
 * means it already is next to the other one on the side asked for, with
 * nothing between the two but blank lines and the upper one's own notes. Two
 * to-dos that are neighbours in the list but have a heading or other text
 * between them are not next to each other: the move is made, across that text.
 */
export function moveTask(text: string, ref: TaskRef, target: TaskRef, where: 'before' | 'after'): TodoEdit {
  const todo = parseTodo(text);
  const task = findTask(todo, ref);
  if (task === null) return NOT_FOUND;
  const anchor = findTask(todo, target);
  if (anchor === null) return TARGET_MISSING;
  if (task === anchor) return unchanged('A to-do cannot be moved next to itself.');

  const before = where === 'before';
  const blocks = blocksOf(todo);
  const upper = before ? task : anchor;
  const lower = before ? anchor : task;
  if (upper.line < lower.line && nothingElseBetween(todo, upper, lower, blocks)) {
    return unchanged('That to-do is already there.');
  }

  // Counted in the lines as they are now: the moved line goes in front of this one.
  const slot = before ? anchor.line : lastLineOf(todo, anchor, blocks) + 1;
  const line = slot > task.line ? slot - 1 : slot;
  const draft = draftOf(todo);
  draft.raws.splice(task.line, 1);
  draft.raws.splice(line, 0, task.raw);
  return { status: 'done', text: textOf(draft), task: { line, raw: task.raw } };
}
