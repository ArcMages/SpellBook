// From a note in the editor to the marks that are drawn on it.
//
// Only the part of the note that is on the screen is analysed, with some
// lines before and after it for the checks that look further than a line
// (see contextLines in the engine). Which lines are prose is worked out once
// for each state of the note's text and kept until the text changes.
//
// A mark becomes a CodeMirror "mark decoration": a class on a stretch of
// text, and the sentence that explains it as an attribute, which the bubble
// reads (tip.ts). A decoration changes how the text looks and nothing else:
// the note itself is never touched.

import type { Range, Text } from '@codemirror/state';
import { Decoration } from '@codemirror/view';
import type { DecorationSet } from '@codemirror/view';
import { ADVERB_WINDOW, contextLines, scanLines } from '../../core/prose/index';
import type { MarkKind, PassageLine, ProseAnalyser, ProseMark } from '../../core/prose/index';

/** The class every mark has, and the attribute that holds what it says. */
export const MARK_CLASS = 'spellbook-prose-mark';
export const MARK_MESSAGE = 'data-spellbook-prose';

/** The class of one kind of mark. */
export function markClass(kind: MarkKind): string {
  return `spellbook-prose-${kind}`;
}

const flagsOfText = new WeakMap<Text, Uint8Array>();

/** What each line of a note is (see scanLines), remembered for as long as the text is the same. */
export function lineFlags(doc: Text): Uint8Array {
  let flags = flagsOfText.get(doc);
  if (!flags) {
    flags = scanLines(doc.iterLines());
    flagsOfText.set(doc, flags);
  }
  return flags;
}

/**
 * The marks for the part of a note that is on the screen.
 *
 * @param visible the stretches of the note that are shown (EditorView.visibleRanges)
 */
export function marksInView(doc: Text, visible: ReadonlyArray<{ from: number; to: number }>, analyser: ProseAnalyser): ProseMark[] {
  if (analyser.idle || visible.length === 0 || doc.length === 0) return [];
  const flags = lineFlags(doc);
  let from = doc.length;
  let to = 0;
  for (const range of visible) {
    from = Math.min(from, range.from);
    to = Math.max(to, range.to);
  }
  const shownFirst = doc.lineAt(Math.max(0, Math.min(from, doc.length))).number;
  const shownLast = doc.lineAt(Math.max(0, Math.min(to, doc.length))).number;
  const reach = Math.max(analyser.options.distance, ADVERB_WINDOW);
  const wordsOf = (line: number): number => analyser.line(doc.line(line).text, flags[line - 1] ?? 0).words;
  const { first, last } = contextLines(wordsOf, shownFirst, shownLast, doc.lines, reach);
  const lines: PassageLine[] = [];
  for (let number = first; number <= last; number++) {
    const line = doc.line(number);
    lines.push({ text: line.text, flags: flags[number - 1] ?? 0, from: line.from });
  }
  return analyser.passage(lines);
}

/** Decorations are made once for each kind and sentence, and used again. */
const made = new Map<string, Decoration>();
const MOST_MADE = 2000;

function decorationOf(mark: ProseMark): Decoration {
  const key = `${mark.kind}\n${mark.message}`;
  let decoration = made.get(key);
  if (!decoration) {
    if (made.size >= MOST_MADE) made.clear();
    decoration = Decoration.mark({
      class: `${MARK_CLASS} ${markClass(mark.kind)}`,
      attributes: { [MARK_MESSAGE]: mark.message },
    });
    made.set(key, decoration);
  }
  return decoration;
}

/** The marks as CodeMirror ranges (in no particular order). */
export function rangesOf(marks: readonly ProseMark[], length: number): Array<Range<Decoration>> {
  const ranges: Array<Range<Decoration>> = [];
  for (const mark of marks) {
    if (mark.from < mark.to && mark.from >= 0 && mark.to <= length) ranges.push(decorationOf(mark).range(mark.from, mark.to));
  }
  return ranges;
}

/** The marks as a set of decorations. */
export function decorate(marks: readonly ProseMark[], length: number): DecorationSet {
  return Decoration.set(rangesOf(marks, length), true);
}
