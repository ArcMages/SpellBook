// Comparing two versions of a scene: paragraphs lined up, and the words of a
// paragraph that changed. Checked by hand on small texts, against a plain
// reference on random ones, and for speed on a long scene.

import { describe, expect, it } from 'vitest';
import { diffSequences, diffTexts, diffWordCount, foldUnchanged, paragraphsOf, sideOf } from '../../../src/core/snapshots';
import type { DiffBlock, SequenceStep } from '../../../src/core/snapshots';

/** A comparison as one line per paragraph: "= same", "+ added", "- removed", "~ a [-b] {+c}". */
function picture(blocks: readonly DiffBlock[]): string[] {
  return blocks.map((block) => {
    if (block.kind === 'same') return `= ${block.text}`;
    if (block.kind === 'added') return `+ ${block.text}`;
    if (block.kind === 'removed') return `- ${block.text}`;
    return `~ ${block.pieces.map((piece) => (piece.kind === 'same' ? piece.text : piece.kind === 'added' ? `{+${piece.text}}` : `[-${piece.text}]`)).join('')}`;
  });
}

/** Both sequences, put together again from the steps. */
function rebuilt(steps: readonly SequenceStep[], before: readonly string[], after: readonly string[]): [string[], string[]] {
  const a: string[] = [];
  const b: string[] = [];
  for (const step of steps) {
    if (step.kind !== 'added') a.push(before[step.before] as string);
    if (step.kind !== 'removed') b.push(after[step.after] as string);
    if (step.kind === 'same') expect(before[step.before]).toBe(after[step.after]);
  }
  return [a, b];
}

/** The length of the longest common subsequence, the slow and plain way. */
function longestCommon(a: readonly string[], b: readonly string[]): number {
  const row = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = 0;
    for (let j = 1; j <= b.length; j++) {
      const above = row[j] as number;
      row[j] = a[i - 1] === b[j - 1] ? diagonal + 1 : Math.max(above, row[j - 1] as number);
      diagonal = above;
    }
  }
  return row[b.length] as number;
}

function randomSource(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

describe('lining up two sequences', () => {
  it('finds what was added, removed and kept, in reading order', () => {
    const steps = diffSequences(['a', 'b', 'c', 'd'], ['a', 'x', 'c', 'd', 'e']);
    expect(steps.map((step) => step.kind)).toEqual(['same', 'removed', 'added', 'same', 'same', 'added']);
    expect(diffSequences([], [])).toEqual([]);
    expect(diffSequences([], ['a']).map((step) => step.kind)).toEqual(['added']);
    expect(diffSequences(['a'], []).map((step) => step.kind)).toEqual(['removed']);
    expect(diffSequences(['a', 'b'], ['a', 'b']).map((step) => step.kind)).toEqual(['same', 'same']);
  });

  it('keeps as much as can be kept: as good as the plain method, on random sequences', () => {
    const random = randomSource(7);
    const letters = ['a', 'b', 'c', 'd', 'e'];
    for (let round = 0; round < 300; round++) {
      const make = (): string[] => Array.from({ length: Math.floor(random() * 14) }, () => letters[Math.floor(random() * letters.length)] as string);
      const before = make();
      const after = make();
      const steps = diffSequences(before, after);
      const [a, b] = rebuilt(steps, before, after);
      expect(a).toEqual(before);
      expect(b).toEqual(after);
      expect(steps.filter((step) => step.kind === 'same').length, `${before.join('')} -> ${after.join('')}`).toBe(longestCommon(before, after));
      // Where the two differ, what went comes before what came.
      for (let at = 1; at < steps.length; at++) {
        expect((steps[at - 1] as SequenceStep).kind === 'added' && (steps[at] as SequenceStep).kind === 'removed').toBe(false);
      }
    }
  });

  it('gives up on two sequences that are too far apart, and still says something true', () => {
    const before = Array.from({ length: 40 }, (_, at) => `a${at}`);
    const after = ['start', ...Array.from({ length: 40 }, (_, at) => (at % 2 === 0 ? `a${at}` : `b${at}`)), 'end'];
    const steps = diffSequences(before, after, 5);
    const [a, b] = rebuilt(steps, before, after);
    expect(a).toEqual(before);
    expect(b).toEqual(after);
    expect(steps.some((step) => step.kind === 'same')).toBe(false);
    // With room to search, the half they share is found.
    expect(diffSequences(before, after).filter((step) => step.kind === 'same')).toHaveLength(20);
  });
});

describe('comparing two texts', () => {
  it('marks whole paragraphs that came or went, and the words of one that changed', () => {
    const before = ['# One', '', 'Anna walked to the harbour alone.', '', 'It rained.', '', 'The end.'].join('\n');
    const after = ['# One', '', 'Anna ran to the old harbour alone.', '', 'A new paragraph here.', '', 'The end.'].join('\n');
    const diff = diffTexts(before, after);
    expect(picture(diff.blocks)).toEqual([
      '= # One',
      '~ Anna[- walked]{+ ran} to the{+ old} harbour alone.',
      '- It rained.',
      '+ A new paragraph here.',
      '= The end.',
    ]);
    expect(diff.added).toBe(2 + 4);
    expect(diff.removed).toBe(1 + 2);
  });

  it('says nothing changed for the same text, also when only empty lines and spaces at line ends differ', () => {
    const diff = diffTexts('One.\n\nTwo.\n', 'One.  \n\n\n\nTwo.');
    expect(picture(diff.blocks)).toEqual(['= One.', '= Two.']);
    expect([diff.added, diff.removed]).toEqual([0, 0]);
    expect(diffTexts('', '')).toEqual({ blocks: [], added: 0, removed: 0 });
    expect(paragraphsOf('\n  a \r\n\nb')).toEqual(['a', 'b']);
  });

  it('compares Hebrew word by word, points and joined words included', () => {
    const before = 'שלום לך אחותי היקרה. הלילה היה חשוך, והים שקט.';
    const after = 'שלום לך אחותי. הלילה היה חשוך מאוד, והים שקט.';
    const diff = diffTexts(before, after);
    expect(picture(diff.blocks)).toEqual(['~ שלום לך אחותי[- היקרה]. הלילה היה חשוך{+ מאוד}, והים שקט.']);
    expect([diff.added, diff.removed]).toEqual([1, 1]);
    // A word with points, an acronym and a joined pair are each one word.
    expect(diffWordCount('שָׁלוֹם צה״ל בית־ספר')).toBe(3);
    expect(diffWordCount("don't well-known 3 — ...")).toBe(3);
  });

  it('gives each side of a paragraph that changed: what it was, and what it is', () => {
    const [block] = diffTexts('The cat sat down.', 'The dog sat.').blocks;
    const text = (side: 'before' | 'after'): string => sideOf(block as DiffBlock, side).map((piece) => piece.text).join('');
    expect(text('before')).toBe('The cat sat down.');
    expect(text('after')).toBe('The dog sat.');
    const [front] = diffTexts('The cat sat.', 'cat sat down.').blocks;
    expect(sideOf(front as DiffBlock, 'before').map((piece) => piece.text).join('')).toBe('The cat sat.');
    expect(sideOf(front as DiffBlock, 'after').map((piece) => piece.text).join('')).toBe('cat sat down.');
    expect(sideOf({ kind: 'added', text: 'New.' }, 'before')).toEqual([]);
    expect(sideOf({ kind: 'added', text: 'New.' }, 'after')).toEqual([{ kind: 'added', text: 'New.' }]);
    expect(sideOf({ kind: 'same', text: 'Same.' }, 'before')).toEqual([{ kind: 'same', text: 'Same.' }]);
  });

  it('shows two paragraphs with little in common as one removed and one added', () => {
    const diff = diffTexts('The harbour was empty at night.', 'She never wrote back to him.');
    expect(picture(diff.blocks)).toEqual(['- The harbour was empty at night.', '+ She never wrote back to him.']);
    expect([diff.added, diff.removed]).toEqual([6, 6]);
  });

  it('puts both texts together again from what it found, on random texts', () => {
    const random = randomSource(11);
    const words = ['anna', 'walked', 'to', 'the', 'harbour', 'שלום', 'לך', 'night', 'rain', 'letter'];
    const sentence = (): string => Array.from({ length: 1 + Math.floor(random() * 8) }, () => words[Math.floor(random() * words.length)] as string).join(' ') + '.';
    for (let round = 0; round < 100; round++) {
      const before = Array.from({ length: Math.floor(random() * 8) }, sentence);
      const after = before.flatMap((line) => {
        const roll = random();
        if (roll < 0.15) return [];
        if (roll < 0.3) return [line, sentence()];
        if (roll < 0.5) return [line.replace(/ \S+/, ` ${words[Math.floor(random() * words.length)] as string}`)];
        return [line];
      });
      const diff = diffTexts(before.join('\n\n'), after.join('\n'));
      const side = (which: 'before' | 'after'): string[] =>
        diff.blocks.map((block) => sideOf(block, which).map((piece) => piece.text).join('')).filter((text) => text !== '');
      expect(side('before')).toEqual(before);
      expect(side('after')).toEqual(after);
      const count = (lines: string[]): number => lines.reduce((sum, line) => sum + diffWordCount(line), 0);
      expect(count(after) - count(before)).toBe(diff.added - diff.removed);
    }
  });
});

describe('a long scene', () => {
  const random = randomSource(3);
  const english = ['the', 'harbour', 'was', 'empty', 'and', 'anna', 'walked', 'alone', 'night', 'letter', 'rain', 'window', 'sea', 'quiet'];
  const hebrew = ['שלום', 'לך', 'אחותי', 'היקרה', 'הלילה', 'היה', 'חשוך', 'והים', 'שקט', 'מכתב', 'נמל', 'גשם'];
  const paragraph = (words: string[], length: number): string =>
    Array.from({ length }, () => words[Math.floor(random() * words.length)] as string).join(' ') + '.';
  // 100 paragraphs of 50 words: 5,000 words, half of them Hebrew.
  const scene = Array.from({ length: 100 }, (_, at) => paragraph(at % 2 === 0 ? english : hebrew, 50));

  it('of 5,000 words with a dozen edits is compared in a moment', () => {
    const edited = scene.flatMap((line, at) => {
      if (at % 17 === 3) return [line.replace(/ \S+ \S+/, ' changed here')];
      if (at === 40) return [];
      if (at === 60) return [line, paragraph(english, 30)];
      return [line];
    });
    const started = performance.now();
    const diff = diffTexts(scene.join('\n\n'), edited.join('\n\n'));
    expect(performance.now() - started).toBeLessThan(1000);
    expect(diff.blocks.filter((block) => block.kind === 'changed')).toHaveLength(6);
    expect(diff.blocks.filter((block) => block.kind === 'removed')).toHaveLength(1);
    expect(diff.blocks.filter((block) => block.kind === 'added')).toHaveLength(1);
    expect(diff.removed).toBe(6 * 2 + 50);
    expect(diff.added).toBe(6 * 2 + 30);
    // Folded, what changed is easy to find.
    const rows = foldUnchanged(diff.blocks);
    expect(rows.length).toBeLessThan(40);
    expect(rows.reduce((sum, row) => sum + (row.kind === 'fold' ? row.blocks.length : 1), 0)).toBe(diff.blocks.length);
  });

  it('rewritten from end to end, or written as one paragraph, still does not hold up the screen', () => {
    const other = Array.from({ length: 100 }, (_, at) => paragraph(at % 2 === 0 ? hebrew : english, 50));
    let started = performance.now();
    const rewritten = diffTexts(scene.join('\n'), other.join('\n'));
    expect(performance.now() - started).toBeLessThan(3000);
    expect(rewritten.blocks.length).toBeGreaterThan(0);

    // 5,000 words on one line, against another 5,000.
    started = performance.now();
    const oneLine = diffTexts(scene.join(' '), other.join(' '));
    expect(performance.now() - started).toBeLessThan(3000);
    expect(oneLine.blocks.length).toBeGreaterThan(0);
  });
});

describe('folding unchanged paragraphs away', () => {
  const same = (text: string): DiffBlock => ({ kind: 'same', text });
  const added: DiffBlock = { kind: 'added', text: 'new' };

  it('keeps one paragraph on either side of a change and folds the rest', () => {
    const blocks = [same('1'), same('2'), same('3'), same('4'), added, same('5'), same('6'), same('7'), same('8'), added, same('9'), same('10'), same('11')];
    const rows = foldUnchanged(blocks);
    expect(rows.map((row) => (row.kind === 'fold' ? `fold ${row.blocks.length}` : row.block.kind === 'same' ? row.block.text : 'new'))).toEqual([
      'fold 3',
      '4',
      'new',
      '5',
      'fold 2',
      '8',
      'new',
      '9',
      'fold 2',
    ]);
  });

  it('folds nothing when that would hide a single paragraph', () => {
    const blocks = [same('1'), added, same('2'), same('3'), same('4'), added];
    expect(foldUnchanged(blocks).every((row) => row.kind === 'block')).toBe(true);
    expect(foldUnchanged([])).toEqual([]);
    expect(foldUnchanged([same('1'), same('2')]).map((row) => row.kind)).toEqual(['fold']);
  });
});
