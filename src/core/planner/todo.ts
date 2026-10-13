// Reading To-do.md: the writer's to-dos, as plain checkbox lines.
//
//   - [ ] Send chapter one 📅 2026-10-20
//   - [x] Choose a name for the ferry
//
// The writer may edit the file by hand, on any device, so reading is
// forgiving: every line is kept exactly as it was found, whether or not it is
// a to-do, and nothing here ever throws.
//
// The due date is written the way the Tasks community plugin writes it: a
// calendar emoji followed by a date. Everything else on the line, including
// the other marks that plugin uses (start and scheduled dates, done date,
// repeat rule, priority), is simply part of the text.

import { isDateText } from './fromCore';

/** The mark written in front of a due date: the calendar emoji the Tasks plugin uses. */
export const DUE_MARK = '\u{1F4C5}';

/** How many lines up or down a to-do is looked for when it is no longer on its own line. */
export const NEARBY_LINES = 20;

/**
 * Names one to-do line: where it was and what it said. Every change to the
 * file is asked for with one of these, so that a change meant for one line can
 * never land on another after the file was edited elsewhere. A TodoTask is one.
 */
export interface TaskRef {
  /** Position among all the lines of the file, counted from 0. */
  readonly line: number;
  /** The whole line exactly as it was read, without its line break. */
  readonly raw: string;
}

/** One to-do: a checkbox line. */
export interface TodoTask extends TaskRef {
  readonly kind: 'task';
  /** The spaces or tabs in front of the bullet. */
  readonly indent: string;
  /** The bullet: "-", "*" or "+". */
  readonly bullet: string;
  /** The character inside the box, kept as written: " ", "x", "X", or something else such as "/". */
  readonly box: string;
  /** True when the box holds x or X. Any other character means not done. */
  readonly done: boolean;
  /** Everything after the checkbox, exactly as written, due date included. */
  readonly text: string;
  /** The text without its due date and without spaces at either end: what a list shows. */
  readonly title: string;
  /** The due date as YYYY-MM-DD, or null when the line has none (or one that is not a real date). */
  readonly due: string | null;
}

/** Any line that is not a to-do: a heading, a note, a blank line. Kept exactly as it is. */
export interface OtherLine {
  readonly kind: 'other';
  readonly line: number;
  readonly raw: string;
}

/** One line of the file: a to-do, or anything else. */
export type TodoLine = TodoTask | OtherLine;

/** To-do.md as read: every line of the file, in order, and the to-dos among them. */
export interface TodoFile {
  /** Every line of the file, to-do or not. */
  readonly lines: readonly TodoLine[];
  /** The to-dos, in the order they appear in the file. */
  readonly tasks: readonly TodoTask[];
  /** The line break after each line ("\n", "\r\n" or "\r"); "" after a last line that has none. */
  readonly endings: readonly string[];
  /** The byte-order mark the file began with, or "". Kept so the file is written back unchanged. */
  readonly bom: string;
}

/** The pieces of a to-do line. Joined in this order they are the line again. */
export interface TaskParts {
  readonly indent: string;
  readonly bullet: string;
  /** The spaces between the bullet and the box. */
  readonly gap: string;
  readonly box: string;
  /** The spaces between the box and the text; "" when the line ends at the box. */
  readonly sep: string;
  readonly text: string;
}

/** Where a due date sits inside a to-do's text. */
export interface DueMark {
  /** Where the calendar emoji starts. */
  readonly start: number;
  /** Just past the last digit of the date. */
  readonly end: number;
  /** Where the date itself starts. */
  readonly dateStart: number;
  readonly date: string;
}

// indent, bullet, gap, [box], then nothing more, or spaces and the text.
const TASK_LINE = /^([ \t]*)([-*+])([ \t]+)\[([\s\S])\](?:([ \t]+)([\s\S]*))?$/u;

// A calendar emoji (the Tasks plugin reads three of them as "due"), an
// optional emoji-style selector, optional spaces, then a date. Marks that only
// steer the direction of text (Hebrew next to digits) may sit among the spaces.
const DUE_DATE = /[\u{1F4C5}\u{1F4C6}\u{1F5D3}]\u{FE0F}?[ \t\u{200E}\u{200F}\u{61C}]*(\d{4}-\d{2}-\d{2})(?!\d)/gu;

// The opening of a fenced code block: three or more backticks or tildes.
const FENCE = /^[ \t]*(`{3,}|~{3,})([\s\S]*)$/;

const isBlank = (character: string | undefined): boolean => character === ' ' || character === '\t';

/** Take a to-do line apart; null for a line that is not a to-do. */
export function splitTaskLine(raw: string): TaskParts | null {
  const match = TASK_LINE.exec(raw);
  if (match === null) return null;
  return {
    indent: match[1] ?? '',
    bullet: match[2] ?? '-',
    gap: match[3] ?? ' ',
    box: match[4] ?? ' ',
    sep: match[5] ?? '',
    text: match[6] ?? '',
  };
}

/** Put a to-do line together. Text is always kept apart from the box by at least one space. */
export function joinTaskLine(parts: TaskParts): string {
  const sep = parts.text !== '' && parts.sep === '' ? ' ' : parts.sep;
  return `${parts.indent}${parts.bullet}${parts.gap}[${parts.box}]${sep}${parts.text}`;
}

/** Every due date in a to-do's text, in order. A date that does not exist is not one. */
export function dueMarks(text: string): DueMark[] {
  const found: DueMark[] = [];
  DUE_DATE.lastIndex = 0;
  for (let match = DUE_DATE.exec(text); match !== null; match = DUE_DATE.exec(text)) {
    const date = match[1] ?? '';
    if (!isDateText(date)) continue;
    const end = match.index + match[0].length;
    found.push({ start: match.index, end, dateStart: end - date.length, date });
  }
  return found;
}

/**
 * The text with its due dates taken out. Each goes together with the spaces
 * in front of it (or, at the very start of the text, the spaces after it).
 * Nothing else in the text is touched.
 */
export function withoutDue(text: string, marks: readonly DueMark[] = dueMarks(text)): string {
  let kept = '';
  let from = 0;
  for (const mark of marks) {
    let cut = mark.start;
    while (cut > from && isBlank(text[cut - 1])) cut--;
    kept += text.slice(from, cut);
    from = mark.end;
    if (kept === '') {
      while (from < text.length && isBlank(text[from])) from++;
    }
  }
  return kept + text.slice(from);
}

function splitLines(text: string): { raws: string[]; endings: string[] } {
  const raws: string[] = [];
  const endings: string[] = [];
  const lineBreak = /\r\n|\n|\r/g;
  let start = 0;
  for (let match = lineBreak.exec(text); match !== null; match = lineBreak.exec(text)) {
    raws.push(text.slice(start, match.index));
    endings.push(match[0]);
    start = match.index + match[0].length;
  }
  if (start < text.length) {
    raws.push(text.slice(start));
    endings.push('');
  }
  return { raws, endings };
}

const isRule = (raw: string): boolean => raw.trimEnd() === '---';

/**
 * A run of lines that can never hold a to-do, whatever the lines look like:
 * the properties block at the top of the note, or a fenced code block.
 * For the planner's own files; not part of what the planner hands out.
 */
export interface ShieldedBlock {
  /** The first line of the block: the opening "---", or the opening fence. */
  readonly from: number;
  /** The last line of the block: the closing "---" or fence, or the last line of the note. */
  readonly to: number;
  /** False for a code block that is never closed, and so runs to the end of the note. */
  readonly closed: boolean;
}

/**
 * The blocks of lines that can never be to-dos: the properties block at the
 * top of the note, and fenced code blocks. Obsidian shows no checkbox there
 * either. A properties block that is never closed is ordinary text; a code
 * block that is never closed runs to the end of the note. In file order.
 */
export function shieldedBlocks(raws: readonly string[]): ShieldedBlock[] {
  const blocks: ShieldedBlock[] = [];
  let next = 0;
  if (raws.length > 0 && isRule(raws[0] ?? '')) {
    const close = raws.findIndex((raw, position) => position > 0 && isRule(raw));
    if (close > 0) {
      blocks.push({ from: 0, to: close, closed: true });
      next = close + 1;
    }
  }
  let fence: { readonly mark: string; readonly length: number; readonly from: number } | null = null;
  for (let i = next; i < raws.length; i++) {
    const match = FENCE.exec(raws[i] ?? '');
    const run = match?.[1] ?? '';
    const rest = match?.[2] ?? '';
    if (fence === null) {
      // "```like this```" on one line is a piece of inline code, not a block.
      if (run !== '' && !(run.startsWith('`') && rest.includes('`'))) {
        fence = { mark: run.charAt(0), length: run.length, from: i };
      }
      continue;
    }
    if (run.startsWith(fence.mark) && run.length >= fence.length && rest.trim() === '') {
      blocks.push({ from: fence.from, to: i, closed: true });
      fence = null;
    }
  }
  if (fence !== null) blocks.push({ from: fence.from, to: raws.length - 1, closed: false });
  return blocks;
}

/**
 * Read the text of To-do.md.
 *
 * A to-do is a line that starts (after any indent) with "-", "*" or "+", then
 * a box: "- [ ] text". It is done when the box holds x or X. Every other line
 * is kept as it is. Never throws, whatever the text.
 */
export function parseTodo(text: string): TodoFile {
  const bom = text.charCodeAt(0) === 0xfeff ? text.slice(0, 1) : '';
  const { raws, endings } = splitLines(text.slice(bom.length));
  const shielded = raws.map(() => false);
  for (const block of shieldedBlocks(raws)) {
    for (let line = block.from; line <= block.to; line++) shielded[line] = true;
  }
  const lines: TodoLine[] = [];
  const tasks: TodoTask[] = [];
  raws.forEach((raw, line) => {
    const parts = shielded[line] === true ? null : splitTaskLine(raw);
    if (parts === null) {
      lines.push({ kind: 'other', line, raw });
      return;
    }
    const marks = dueMarks(parts.text);
    const task: TodoTask = {
      kind: 'task',
      line,
      raw,
      indent: parts.indent,
      bullet: parts.bullet,
      box: parts.box,
      done: parts.box === 'x' || parts.box === 'X',
      text: parts.text,
      title: withoutDue(parts.text, marks).trim(),
      // With more than one date on the line, the last one written counts.
      due: marks[marks.length - 1]?.date ?? null,
    };
    lines.push(task);
    tasks.push(task);
  });
  return { lines, tasks, endings, bom };
}

/** The file text of a model. For a model that was just read, this is the text it was read from, to the letter. */
export function todoText(todo: TodoFile): string {
  return todo.bom + todo.lines.map((line, position) => line.raw + (todo.endings[position] ?? '')).join('');
}

/**
 * Find a to-do again in a (newer) reading of the file.
 *
 * First the line at the remembered position; when that no longer holds the
 * same text, the nearest line with exactly that text, up to NEARBY_LINES away
 * (of two equally near, the one above). Null when it is not there: the to-do
 * was changed or removed in the meantime.
 */
export function findTask(todo: TodoFile, ref: TaskRef): TodoTask | null {
  const there = todo.lines[ref.line];
  if (there !== undefined && there.kind === 'task' && there.raw === ref.raw) return there;
  let best: TodoTask | null = null;
  let bestDistance = NEARBY_LINES + 1;
  for (const task of todo.tasks) {
    if (task.raw !== ref.raw) continue;
    const distance = Math.abs(task.line - ref.line);
    if (distance < bestDistance) {
      best = task;
      bestDistance = distance;
    }
  }
  return best;
}

/** The to-dos due on a day (YYYY-MM-DD), done or not, in file order. */
export function tasksDueOn(todo: TodoFile, date: string): TodoTask[] {
  return todo.tasks.filter((task) => task.due === date);
}

/**
 * The to-dos that are late as of a day: not done, and due before it. A to-do
 * due on that very day is not late yet. In file order.
 */
export function overdueTasks(todo: TodoFile, today: string): TodoTask[] {
  if (!isDateText(today)) return [];
  return todo.tasks.filter((task) => !task.done && task.due !== null && task.due < today);
}

/** The to-dos with no due date, done or not, in file order. */
export function undatedTasks(todo: TodoFile): TodoTask[] {
  return todo.tasks.filter((task) => task.due === null);
}

/** How many to-dos are not done. */
export function openTaskCount(todo: TodoFile): number {
  return todo.tasks.reduce((count, task) => (task.done ? count : count + 1), 0);
}
