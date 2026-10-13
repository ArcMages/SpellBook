// The colouring of English words by type: how often it is right, measured on
// pieces of fiction whose words were typed by hand (see passages.ts), and
// the rules it goes by, one by one.

import { describe, expect, it } from 'vitest';
import { tokenize, wordTypes } from '../../../src/core/prose';
import type { WordType } from '../../../src/core/prose';
import { HARD, TUNED, UNSEEN, readPassage, score } from './passages';

function tag(text: string): Array<{ word: string; type: WordType | null }> {
  const tokens = tokenize(text);
  const types = wordTypes(text, tokens);
  return tokens.map((token, at) => ({ word: token.text, type: types[at] ?? null }));
}

/** The words of a line with their types, as "word/N"; a word that is not coloured stands alone. */
function typed(text: string): string {
  const letter = { noun: 'N', verb: 'V', adjective: 'J', adverb: 'R' } as const;
  return tag(text)
    .map((entry) => (entry.type ? `${entry.word}/${letter[entry.type]}` : entry.word))
    .join(' ');
}

describe('how often the colouring is right', () => {
  it('reads the hand-typed pieces as they are meant', () => {
    const { text, expected } = readPassage('The tide/N came/V in slowly/R. It was/V unlocked/JV.');
    expect(text).toBe('The tide came in slowly. It was unlocked.');
    expect(expected).toEqual(['', 'N', 'V', '', 'R', '', 'V', 'JV']);
    for (const piece of [TUNED, UNSEEN, HARD]) {
      const read = readPassage(piece);
      expect(read.text).not.toContain('/');
      expect(tokenize(read.text)).toHaveLength(read.expected.length);
    }
  });

  it('is right for nearly every word of plain narration', () => {
    // The piece the rules were adjusted on, and one they never saw.
    const tuned = score(TUNED, tag);
    const unseen = score(UNSEEN, tag);
    expect(tuned.words).toBeGreaterThan(100);
    expect(unseen.words).toBeGreaterThan(100);
    expect(tuned.right / tuned.words, tuned.wrong.join('; ')).toBeGreaterThanOrEqual(0.95);
    expect(unseen.right / unseen.words, unseen.wrong.join('; ')).toBeGreaterThanOrEqual(0.93);
  });

  it('is right for about nine words in ten of quick dialogue with rarer words', () => {
    const hard = score(HARD, tag);
    expect(hard.words).toBeGreaterThan(80);
    expect(hard.right / hard.words, hard.wrong.join('; ')).toBeGreaterThanOrEqual(0.85);
    // It is not perfect, and the test says so: this piece has words it gets wrong.
    expect(hard.wrong.length).toBeGreaterThan(0);
  });
});

describe('the rules of the colouring', () => {
  it('never colours the small words of the language', () => {
    expect(typed('the of and she it to with a this who there')).toBe('the of and she it to with a this who there');
  });

  it('colours "was", "had", "could" and "don\'t" as verbs, and leaves "she\'ll" alone', () => {
    expect(typed("She was here and had gone. He could not. They don't. She'll go.")).toBe(
      "She was/V here/R and had/V gone/V He could/V not/R They don't/V She'll go/V",
    );
  });

  it('knows a listed word with an ending', () => {
    expect(typed('walked tides slowly happily colder. She kept running.')).toBe('walked/V tides/N slowly/R happily/R colder/J She kept/V running/V');
  });

  it('guesses a word it does not know from its ending', () => {
    expect(typed('The vastness, the glimmering, was ominous and glacial.')).toBe('The vastness/N the glimmering/N was/V ominous/J and glacial/J');
    expect(typed('He zigzagged deftly.')).toBe('He zigzagged/V deftly/R');
  });

  it('takes a capital inside a sentence for a name, and a possessive for a noun', () => {
    expect(typed("We met Quillon near Thornwick. Anna's hat fell.")).toBe("We met/V Quillon/N near Thornwick/N Anna's/N hat/N fell/V");
  });

  it('lets the words around decide what a word with two uses is', () => {
    expect(typed('The light was on.')).toBe('The light/N was/V on');
    expect(typed('A light rain fell.')).toBe('A light/J rain/N fell/V');
    expect(typed('She wanted to light the fire.')).toBe('She wanted/V to light/V the fire/N');
    expect(typed('They walk home.')).toBe('They walk/V home/N');
    expect(typed('The walk was long.')).toBe('The walk/N was/V long/J');
    expect(typed('He was very cold.')).toBe('He was/V very/R cold/J');
    expect(typed('The broken door.')).toBe('The broken/J door/N');
    expect(typed('She would like the falling snow.')).toBe('She would/V like/V the falling/J snow/N');
  });

  it('leaves Hebrew words alone', () => {
    expect(typed('הגלים rose לאט')).toBe('הגלים rose/V לאט');
  });
});
