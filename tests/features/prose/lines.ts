// Helpers for the tests of the prose checks: a text is cut into lines and
// analysed the way the editor has it done, and the marks come back in a form
// that reads well in a test.

import { PROSE_CHECKS, ProseAnalyser, scanLines } from '../../../src/core/prose';
import type { PassageLine, ProseCheck, ProseMark, ProseOptions } from '../../../src/core/prose';

/** Choices for the analysis: the checks named, with the usual thresholds unless given. */
export function options(checks: readonly ProseCheck[] = PROSE_CHECKS, more: Partial<ProseOptions> = {}): ProseOptions {
  return { checks: new Set(checks), distance: 40, longSentence: 35, ownFillers: [], ...more };
}

/** A text as the lines of a passage, each with what scanLines says of it and where it begins. */
export function passageOf(text: string): PassageLine[] {
  const lines = text.split('\n');
  const flags = scanLines(lines);
  let from = 0;
  return lines.map((line, at) => {
    const entry = { text: line, flags: flags[at] ?? 0, from };
    from += line.length + 1;
    return entry;
  });
}

/** The marks of a whole text. */
export function marksOf(text: string, checks?: readonly ProseCheck[], more?: Partial<ProseOptions>): ProseMark[] {
  return new ProseAnalyser(options(checks, more)).passage(passageOf(text)).sort((a, b) => a.from - b.from || b.to - a.to);
}

/** The marks of a text as "kind: the words marked", in the order of the text. */
export function marked(text: string, checks?: readonly ProseCheck[], more?: Partial<ProseOptions>): string[] {
  return marksOf(text, checks, more).map((mark) => `${mark.kind}: ${text.slice(mark.from, mark.to)}`);
}

/** What the marks of a text say, in the order of the text, each sentence once. */
export function messages(text: string, checks?: readonly ProseCheck[], more?: Partial<ProseOptions>): string[] {
  return [...new Set(marksOf(text, checks, more).map((mark) => mark.message))];
}
