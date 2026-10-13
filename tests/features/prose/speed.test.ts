// How long the analysis takes on a scene of 5,000 words, in English and in
// Hebrew, with every check on.
//
// Three things are timed, on the pure analysis (no editor):
//   the whole scene, read for the first time: far more than the editor ever
//     asks at once, since it only reads what is on the screen;
//   one screen, read for the first time: what opening a scene costs;
//   one key: a line has changed, the rest of the screen is remembered.
//
// The limits are many times what a desktop needs, so that a slow machine
// running the tests does not fail them; a phone is slower than a desktop,
// which is why the limits for a screen and a key are the ones that matter.

import { describe, expect, it } from 'vitest';
import { PROSE_CHECKS, ProseAnalyser, contextLines, scanLines } from '../../../src/core/prose';
import type { PassageLine } from '../../../src/core/prose';
import { ENGLISH_SCENE, HEBREW_SCENE, WORDS } from './corpus';
import { options } from './lines';

const SCREEN_LINES = 60;
const WHOLE_SCENE_MS = 1500;
const SCREEN_MS = 150;
const KEY_MS = 30;

function linesOf(text: string): PassageLine[] {
  const lines = text.split('\n');
  const flags = scanLines(lines);
  let from = 0;
  return lines.map((line, at) => {
    const entry = { text: line, flags: flags[at] ?? 0, from };
    from += line.length + 1;
    return entry;
  });
}

/** The lines the editor would hand over for a screen that starts at line `top` (counted from 1). */
function screen(analyser: ProseAnalyser, lines: readonly PassageLine[], top: number): PassageLine[] {
  const wordsOf = (line: number): number => {
    const entry = lines[line - 1];
    return entry ? analyser.line(entry.text, entry.flags).words : 0;
  };
  const { first, last } = contextLines(wordsOf, top, top + SCREEN_LINES - 1, lines.length, 40);
  return lines.slice(first - 1, last);
}

function time(work: () => void): number {
  const before = performance.now();
  work();
  return performance.now() - before;
}

describe.each([
  ['English', ENGLISH_SCENE],
  ['Hebrew', HEBREW_SCENE],
])('a scene of 5,000 words in %s', (_language, text) => {
  it('is as long as it says, and gets marks of the kinds its language has', () => {
    const words = text.split(/\s+/).length;
    expect(words).toBeGreaterThanOrEqual(WORDS);
    expect(words).toBeLessThan(WORDS + 200);
    const kinds = new Set(new ProseAnalyser(options()).passage(linesOf(text)).map((mark) => mark.kind));
    expect(kinds.has('filler')).toBe(true);
    expect(kinds.has('repeated')).toBe(true);
    expect(kinds.has('noun')).toBe(text === ENGLISH_SCENE);
    expect(kinds.has('passive')).toBe(text === ENGLISH_SCENE);
  });

  it('is analysed whole, for the first time, well within the limit', () => {
    const analyser = new ProseAnalyser(options(PROSE_CHECKS));
    let marks = 0;
    const took = time(() => {
      marks = analyser.passage(linesOf(text)).length;
    });
    expect(marks).toBeGreaterThan(500);
    expect(took).toBeLessThan(WHOLE_SCENE_MS);
  });

  it('has one screen analysed for the first time, and a key answered, quickly', () => {
    const lines = linesOf(text);
    const top = Math.floor(lines.length / 2);
    const analyser = new ProseAnalyser(options(PROSE_CHECKS));
    const opened = time(() => analyser.passage(screen(analyser, lines, top)));
    expect(opened).toBeLessThan(SCREEN_MS);
    // Far fewer lines were read than the scene has.
    expect(analyser.remembered).toBeLessThan(lines.length / 2);

    // Twenty keys, each adding a letter to a line in the middle of the screen. The slowest counts.
    let slowest = 0;
    let typedLine = lines[top + 10] as PassageLine;
    if (typedLine.text === '') typedLine = lines[top + 11] as PassageLine;
    const at = lines.indexOf(typedLine);
    for (let key = 0; key < 20; key++) {
      const now = { ...(lines[at] as PassageLine), text: `${(lines[at] as PassageLine).text}x` };
      lines[at] = now;
      // The note has changed: which lines are prose is worked out again, as the editor does.
      const flags = scanLines(lines.map((line) => line.text));
      expect(flags.length).toBe(lines.length);
      slowest = Math.max(slowest, time(() => analyser.passage(screen(analyser, lines, top))));
    }
    expect(slowest).toBeLessThan(KEY_MS);
  });
});
