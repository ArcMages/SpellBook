// What is prose and what is not.
//
// The checks look at the writer's sentences only. Two steps keep everything
// else out of their sight:
//
//   scanLines  goes through a whole note once and says, for each line, whether
//              it is prose at all. The properties block at the top, code
//              blocks, maths blocks, headings, table rows and %% comments %%
//              are not.
//   maskLine   takes one line of prose and blanks out the Markdown in it
//              (inline code, link targets, tags, list bullets and so on) with
//              spaces. The result is exactly as long as the line, so a place
//              in it is the same place in the editor.
//
// A comment that is opened and never closed hides nothing, as in the word
// counter (src/core/wordCount.ts): a stray "100%%" must not switch the checks
// off for the rest of a scene.

/** The line is not prose: nothing in it is checked. */
export const LINE_SKIP = 1;
/** The line begins inside a %% comment that was opened on an earlier line. */
export const LINE_IN_COMMENT = 2;
/** The last %% on the line has no partner anywhere below: it is ordinary text. */
export const LINE_STRAY_COMMENT = 4;

const FRONTMATTER_FENCE = /^---[ \t\r]*$/;
const CODE_FENCE = /^ {0,3}(`{3,}|~{3,})/;
const HEADING = /^ {0,3}#{1,6}(?:\s|$)/;
const TABLE_ROW = /^\s*\|/;
const MATH_FENCE = /^\s*\$\$/;

function countComments(line: string): number {
  let count = 0;
  for (let at = line.indexOf('%%'); at >= 0; at = line.indexOf('%%', at + 2)) count++;
  return count;
}

/**
 * Say for every line of a note what it is: 0 for a line of prose, or a sum of
 * the LINE_ values above.
 *
 * @param lines the lines of the whole note, from its first
 */
export function scanLines(lines: Iterable<string>): Uint8Array {
  const all = Array.isArray(lines) ? (lines as string[]) : Array.from(lines);
  const flags = new Uint8Array(all.length);
  let start = 0;

  // The properties block: a first line of "---" up to the next such line.
  if (all.length > 0 && FRONTMATTER_FENCE.test((all[0] ?? '').replace(/^\uFEFF/, ''))) {
    for (let at = 1; at < all.length; at++) {
      if (FRONTMATTER_FENCE.test(all[at] ?? '')) {
        flags.fill(LINE_SKIP, 0, at + 1);
        start = at + 1;
        break;
      }
    }
  }

  /** The marks that opened the code block the scan is in, or null. */
  let fence: string | null = null;
  let math = false;
  let comment = false;
  /** The line on which the comment the scan is in was opened. */
  let openedAt = -1;

  let at = start;
  for (;;) {
    for (; at < all.length; at++) {
      const line = all[at] ?? '';
      if (fence !== null) {
        flags[at] = LINE_SKIP;
        const closing = CODE_FENCE.exec(line)?.[1];
        if (closing !== undefined && closing[0] === fence[0] && closing.length >= fence.length && line.trim() === closing) fence = null;
        continue;
      }
      if (math) {
        flags[at] = LINE_SKIP;
        if (line.includes('$$')) math = false;
        continue;
      }
      if (!comment) {
        const opening = CODE_FENCE.exec(line)?.[1];
        if (opening !== undefined) {
          flags[at] = LINE_SKIP;
          fence = opening;
          continue;
        }
        if (MATH_FENCE.test(line)) {
          flags[at] = LINE_SKIP;
          // "$$ x $$" on one line opens and closes at once.
          math = line.indexOf('$$', line.indexOf('$$') + 2) < 0;
          continue;
        }
        if (HEADING.test(line) || TABLE_ROW.test(line)) flags[at] = LINE_SKIP;
      }
      const marks = countComments(line);
      if (comment) {
        if (marks === 0) {
          flags[at] = LINE_SKIP;
          continue;
        }
        flags[at] = (flags[at] ?? 0) | LINE_IN_COMMENT;
        comment = (marks - 1) % 2 === 1;
      } else {
        comment = marks % 2 === 1;
      }
      if (comment) openedAt = at;
    }
    if (!comment) break;
    // Never closed: it is no comment. Read the lines after it again as what they are.
    flags[openedAt] = (flags[openedAt] ?? 0) | LINE_STRAY_COMMENT;
    flags.fill(0, openedAt + 1);
    comment = false;
    at = openedAt + 1;
  }
  return flags;
}

const blank = (found: string): string => ' '.repeat(found.length);

/** Bullets, numbers, check boxes and quote marks at the start of a line. */
const LEADING = /^\s*(?:>\s*)*(?:\[![^\]]*\][+-]?\s*)?(?:(?:[-*+]|\d+[.)])\s+(?:\[.\]\s+)?)?/;
const INLINE: ReadonlyArray<[RegExp, (found: string, ...groups: Array<string | undefined>) => string]> = [
  [/<!--.*?-->/g, blank],
  [/(`+).*?\1/g, blank],
  [/\$(?!\s)[^$]*?[^\s$]\$(?!\d)/g, blank],
  // Embedded notes and pictures: nothing of them is the writer's sentence.
  [/!\[\[[^\]]*\]\]/g, blank],
  [/!\[[^\]]*\]\([^)]*\)/g, blank],
  // A link to a note keeps the words that are shown for it.
  [
    /\[\[([^\]|]*\|)?([^\]]*)\]\]/g,
    (found, target, shown) => `${' '.repeat(2 + (target?.length ?? 0))}${shown ?? ''}  `,
  ],
  [/\[\^[^\]]*\]/g, blank],
  [/\[([^\]]*)\]\([^)]*\)/g, (found, shown) => ` ${shown ?? ''}${' '.repeat(found.length - (shown?.length ?? 0) - 1)}`],
  [/<\/?[A-Za-z][^>]*>/g, blank],
  [/(?:https?:\/\/|www\.)\S+/g, blank],
  [/(^|\s)#[\p{L}\p{N}_/-]+/gu, blank],
  [/\s\^[A-Za-z0-9-]+\s*$/, blank],
];

/**
 * One line of prose with its Markdown blanked out. The result has the length
 * of the line.
 *
 * @param flags what scanLines said of the line
 */
export function maskLine(text: string, flags = 0): string {
  if ((flags & LINE_SKIP) !== 0) return ' '.repeat(text.length);
  let line = text;
  if ((flags & LINE_IN_COMMENT) !== 0) {
    const end = line.indexOf('%%');
    line = end < 0 ? ' '.repeat(line.length) : ' '.repeat(end + 2) + line.slice(end + 2);
  }
  if (line.includes('%%')) {
    line = line.replace(/%%.*?%%/g, blank);
    const open = line.indexOf('%%');
    // A comment that goes on in the next line hides the rest of this one.
    if (open >= 0 && (flags & LINE_STRAY_COMMENT) === 0) line = line.slice(0, open) + ' '.repeat(line.length - open);
  }
  line = line.replace(LEADING, blank);
  for (const [pattern, replacement] of INLINE) {
    line = line.replace(pattern, replacement as (found: string, ...groups: string[]) => string);
  }
  return line;
}
