// The synopsis made from a scene's own text, for a scene that has none.

import { describe, expect, it } from 'vitest';
import { PREVIEW_LENGTH, derivePreview } from '../../src/core/cards';
import { characterBoundary, defaultGraphemeSegmenter } from '../../src/core/cards/preview';
import { ENGLISH_PROSE, HEBREW } from './helpers';

// Characters that are easy to mistake or impossible to see are written as
// codes throughout this file, never typed in.
const ELLIPSIS = '\u{2026}';
const EM_DASH = '\u{2014}';
const MARK = /\p{M}/u;
/** What may be dropped from the end of a preview in front of the ellipsis: , ; : and dashes. */
const HANGING = '[,;:\\u{2013}\\u{2014}-]';

/** How many characters a reader sees: marks that sit on a letter are not counted. */
function seen(text: string): number {
  return [...text].filter((character) => !MARK.test(character)).length;
}

/** Every letter of the text followed by a Hebrew vowel point, as in pointed writing. */
function pointed(text: string): string {
  const points = ['\u{5B8}', '\u{5B4}', '\u{5B6}', '\u{5B7}\u{5BC}'];
  return [...text].map((character, index) => (character === ' ' ? character : character + points[index % points.length])).join('');
}

/**
 * Check a preview that was cut: it ends with an ellipsis, what comes before
 * is the start of the prose with nothing changed, the cut falls between two
 * words, and it is no longer than the limit.
 */
function expectCutAtWord(preview: string, prose: string, limit: number): void {
  expect(preview.endsWith(ELLIPSIS)).toBe(true);
  const body = preview.slice(0, -1);
  expect(body.length).toBeGreaterThan(0);
  expect(prose.startsWith(body)).toBe(true);
  expect(body).toBe(body.trimEnd());
  // What was left out begins with a space, perhaps after a comma or dash that was dropped.
  expect(prose.slice(body.length)).toMatch(new RegExp(`^${HANGING}* `, 'u'));
  expect(seen(body)).toBeLessThanOrEqual(limit);
}

describe('derivePreview: what counts as prose', () => {
  it('returns short text whole, with no ellipsis', () => {
    expect(derivePreview('Anna stood by the window.')).toBe('Anna stood by the window.');
    expect(derivePreview(HEBREW.synopsis)).toBe(HEBREW.synopsis);
  });

  it('is empty for a note with no prose', () => {
    for (const empty of ['', '   \n\n  ', '---\nstatus: To do\n---\n', '# Only a heading\n', '%% only a comment %%', '---\na: 1\n---\n\n# Title\n\n%% note %%\n\n***\n']) {
      expect(derivePreview(empty), JSON.stringify(empty)).toBe('');
    }
  });

  it('skips the properties block', () => {
    const note = '---\nsynopsis: ""\nstatus: To do\nlabel: Anna\n---\nAnna stood by the window.\n';
    expect(derivePreview(note)).toBe('Anna stood by the window.');
  });

  it('skips the properties block of a Hebrew note', () => {
    const note = `---\nsynopsis: ""\nlabel: ${HEBREW.anna}\n---\n\n${HEBREW.synopsis}\n`;
    expect(derivePreview(note)).toBe(HEBREW.synopsis);
  });

  it('treats a properties block that is never closed as ordinary text', () => {
    expect(derivePreview('---\nAnna stood by the window.')).toBe('Anna stood by the window.');
  });

  it('skips comments, on one line or across several', () => {
    expect(derivePreview('%% rough notes for later %%\n\nAnna stood by the window.')).toBe('Anna stood by the window.');
    expect(derivePreview('%%\nrough notes\n# not a heading either\n%%\nAnna stood by the window.')).toBe('Anna stood by the window.');
    expect(derivePreview('Anna stood %% check the name %% by the window.')).toBe('Anna stood by the window.');
    expect(derivePreview(`%% ${HEBREW.letter} %%\n${HEBREW.synopsis}`)).toBe(HEBREW.synopsis);
  });

  it('skips HTML comments as well', () => {
    expect(derivePreview('<!-- rough notes -->\nAnna stood by the window.')).toBe('Anna stood by the window.');
    expect(derivePreview('<!--\nrough\nnotes\n-->\n\nAnna stood by the window.')).toBe('Anna stood by the window.');
  });

  it('leaves a lone comment mark alone, so it cannot hide the rest of the scene', () => {
    expect(derivePreview('Sales rose 100%% that year.')).toBe('Sales rose 100%% that year.');
    expect(derivePreview('She typed <!-- and stopped.')).toBe('She typed <!-- and stopped.');
  });

  it('skips headings of every level', () => {
    const note = '# Part one\n## Chapter 1\n###### Deep\n#\nAnna stood by the window.';
    expect(derivePreview(note)).toBe('Anna stood by the window.');
  });

  it('skips a Hebrew heading and keeps the Hebrew prose under it', () => {
    expect(derivePreview(`# ${HEBREW.chapterOne}\n\n${HEBREW.synopsis}`)).toBe(HEBREW.synopsis);
  });

  it('skips a heading written with a line of = or - under it', () => {
    expect(derivePreview('Chapter One\n===========\n\nAnna stood by the window.')).toBe('Anna stood by the window.');
    expect(derivePreview(`${HEBREW.chapterOne}\n-----\n${HEBREW.synopsis}`)).toBe(HEBREW.synopsis);
  });

  it('keeps a line that only looks like a heading: a tag, or a # inside the line', () => {
    expect(derivePreview('#idea Anna stood by the window.')).toBe('#idea Anna stood by the window.');
    expect(derivePreview('Room #4 was empty.')).toBe('Room #4 was empty.');
  });

  it('skips scene-break rules', () => {
    expect(derivePreview('***\n\nAnna stood.\n\n* * *\n\nShe left.\n\n---\n___\nThe end.')).toBe('Anna stood. She left. The end.');
  });

  it('skips blank lines and joins the paragraphs with single spaces', () => {
    expect(derivePreview('\n\n  Anna stood.  \n\n\n\tShe left.\r\n\r\nThe end.\n')).toBe('Anna stood. She left. The end.');
    expect(derivePreview(`${HEBREW.letter}\n\n\n${HEBREW.opening}`)).toBe(`${HEBREW.letter} ${HEBREW.opening}`);
  });

  it('keeps the words themselves exactly as written, markup and all', () => {
    const line = `She *never* said "yes" to [[Daniel]] ${EM_DASH} not once; he_knew.`;
    expect(derivePreview(line)).toBe(line);
  });

  it('does not reorder a line that mixes Hebrew and English', () => {
    const line = `${HEBREW.anna} said "hello" ${HEBREW.daniel} (1984) ${HEBREW.letter}.`;
    expect(derivePreview(line)).toBe(line);
  });

  it('passes pointed Hebrew through code for code, whole or cut', () => {
    expect(HEBREW.untidy.normalize('NFC')).not.toBe(HEBREW.untidy);
    expect(derivePreview(`# ${HEBREW.chapterOne}\n\n${HEBREW.untidy}\n`)).toBe(HEBREW.untidy);
    const long = Array.from({ length: 40 }, () => HEBREW.untidy).join(' ');
    for (const segmenter of [defaultGraphemeSegmenter(), null]) {
      const preview = derivePreview(long, 60, segmenter);
      expect(preview.endsWith(ELLIPSIS)).toBe(true);
      expect(long.startsWith(preview.slice(0, -1))).toBe(true);
      expect(long.charAt(preview.length - 1)).toBe(' ');
    }
  });

  it('starts at the first prose even when a great deal comes before it', () => {
    const noise = `---\nsynopsis: ""\n---\n\n# Title\n\n%%\n${'notes '.repeat(3000)}\n%%\n\n`;
    expect(derivePreview(`${noise}Anna stood by the window.`)).toBe('Anna stood by the window.');
  });
});

describe('derivePreview: where it cuts', () => {
  it('is set to about 200 characters', () => {
    expect(PREVIEW_LENGTH).toBe(200);
    // Both sample texts are well past it, so both have to be cut.
    expect(ENGLISH_PROSE.length).toBeGreaterThan(300);
    expect(HEBREW.prose.length).toBe(290);
  });

  it('cuts long English prose between two words and ends with an ellipsis', () => {
    const preview = derivePreview(ENGLISH_PROSE);
    expectCutAtWord(preview, ENGLISH_PROSE, 200);
    expect(seen(preview)).toBeGreaterThan(180);
    expect(preview).toBe(
      'The rain fell all night on the old town, and the streets filled with water until not one dry place was left. ' +
        `Anna stood by the window and looked out at the blurred lights of the harbour. She thought${ELLIPSIS}`,
    );
  });

  it('cuts long Hebrew prose between two words too', () => {
    const preview = derivePreview(HEBREW.prose);
    expectCutAtWord(preview, HEBREW.prose, 200);
    expect(seen(preview)).toBeGreaterThan(180);
  });

  /**
   * The preview worked out the slow, obvious way, for plain prose without
   * marks: step back from the limit to a space, keep what is in front of it.
   */
  function cutByHand(prose: string, limit: number): string {
    let cut = limit;
    while (cut > 0 && prose.charAt(cut) !== ' ') cut--;
    return prose.slice(0, cut).trimEnd().replace(new RegExp(`${HANGING}+$`, 'u'), '').trimEnd() + ELLIPSIS;
  }

  it('cuts English at the last word boundary within the limit, at every length', () => {
    for (let limit = 12; limit < ENGLISH_PROSE.length; limit += 1) {
      const preview = derivePreview(ENGLISH_PROSE, limit);
      expectCutAtWord(preview, ENGLISH_PROSE, limit);
      expect(preview, `limit ${limit}`).toBe(cutByHand(ENGLISH_PROSE, limit));
    }
  });

  it('cuts Hebrew at the last word boundary within the limit, at every length', () => {
    for (let limit = 12; limit < HEBREW.prose.length; limit += 1) {
      const preview = derivePreview(HEBREW.prose, limit);
      expectCutAtWord(preview, HEBREW.prose, limit);
      expect(preview, `limit ${limit}`).toBe(cutByHand(HEBREW.prose, limit));
    }
  });

  it('keeps the last whole English word that fits, not one fewer', () => {
    // "one two three" is 13 characters: at 13 it fits whole, at 12 "three" has to go.
    expect(derivePreview('one two three four', 13)).toBe(`one two three${ELLIPSIS}`);
    expect(derivePreview('one two three four', 12)).toBe(`one two${ELLIPSIS}`);
    expect(derivePreview('one two three', 13)).toBe('one two three');
  });

  it('keeps the last whole Hebrew word that fits, not one fewer', () => {
    const hebrew = `${HEBREW.anna} ${HEBREW.daniel} ${HEBREW.letter}`; // 3 + 1 + 5 + 1 + 5 characters
    expect(derivePreview(hebrew, 9)).toBe(`${HEBREW.anna} ${HEBREW.daniel}${ELLIPSIS}`);
    expect(derivePreview(hebrew, 8)).toBe(`${HEBREW.anna}${ELLIPSIS}`);
    expect(derivePreview(hebrew, 15)).toBe(hebrew);
    expect(derivePreview(hebrew, 14)).toBe(`${HEBREW.anna} ${HEBREW.daniel}${ELLIPSIS}`);
  });

  it('counts the limit across paragraphs', () => {
    const preview = derivePreview('one two\n\nthree four\n\nfive six', 14);
    expect(preview).toBe(`one two three${ELLIPSIS}`);
  });

  it('drops a comma, colon or dash left hanging in front of the ellipsis', () => {
    expect(derivePreview('Anna stood, waiting for him', 12)).toBe(`Anna stood${ELLIPSIS}`);
    expect(derivePreview(`Anna stood ${EM_DASH} waiting for him`, 13)).toBe(`Anna stood${ELLIPSIS}`);
    expect(derivePreview('Anna stood - waiting for him', 13)).toBe(`Anna stood${ELLIPSIS}`);
    expect(derivePreview('Anna stood \u{2013} waiting for him', 13)).toBe(`Anna stood${ELLIPSIS}`);
    expect(derivePreview('Anna stood: waiting for him', 12)).toBe(`Anna stood${ELLIPSIS}`);
    expect(derivePreview('Anna stood. Waiting for him', 12)).toBe(`Anna stood.${ELLIPSIS}`);
  });

  it('does not count Hebrew vowel points toward the length', () => {
    const plain = HEBREW.prose;
    const withPoints = pointed(plain);
    expect(withPoints.length).toBeGreaterThan(plain.length * 1.8);
    const preview = derivePreview(withPoints);
    expectCutAtWord(preview, withPoints, 200);
    // The pointed preview keeps as many words as the plain one.
    const words = (text: string): number => text.split(' ').length;
    expect(words(preview)).toBe(words(derivePreview(plain)));
  });

  it('never separates a Hebrew letter from its vowel points', () => {
    const withPoints = pointed(HEBREW.prose);
    for (const segmenter of [defaultGraphemeSegmenter(), null]) {
      for (let limit = 5; limit < 120; limit += 3) {
        const body = derivePreview(withPoints, limit, segmenter).slice(0, -1);
        expect(withPoints.startsWith(body)).toBe(true);
        // The first character left out is never a mark belonging to the last one kept.
        expect(MARK.test(withPoints.charAt(body.length)), `limit ${limit}`).toBe(false);
      }
    }
  });

  it('reads a long paragraph that is one line without looking at all of it', () => {
    const paragraph = `${'word '.repeat(50000)}end`;
    const preview = derivePreview(paragraph);
    expectCutAtWord(preview, paragraph, 200);
    expect(preview).toBe(`${'word '.repeat(40).trimEnd()}${ELLIPSIS}`);
  });

  it('uses the usual length when the one asked for is not a number, and at least one character', () => {
    expect(derivePreview(ENGLISH_PROSE, Number.NaN)).toBe(derivePreview(ENGLISH_PROSE, 200));
    expect(derivePreview(ENGLISH_PROSE, Number.POSITIVE_INFINITY)).toBe(derivePreview(ENGLISH_PROSE, 200));
    expect(derivePreview('one two three', 0)).toBe(`o${ELLIPSIS}`);
    expect(derivePreview('one two three', -5)).toBe(`o${ELLIPSIS}`);
    expect(derivePreview('one two three', 3.9)).toBe(`one${ELLIPSIS}`);
  });
});

describe('derivePreview: text with no word boundary to cut at', () => {
  const family = '\u{1F469}\u{200D}\u{1F469}\u{200D}\u{1F467}'; // three people joined into one symbol
  const flagless = '\u{1F44B}\u{1F3FD}'; // a waving hand with a skin tone

  it('cuts a very long unbroken run inside, since there is nowhere else', () => {
    const run = 'x'.repeat(500);
    expect(derivePreview(run, 200)).toBe(`${'x'.repeat(200)}${ELLIPSIS}`);
    const hebrewRun = 'א'.repeat(500);
    expect(derivePreview(hebrewRun, 200)).toBe(`${'א'.repeat(200)}${ELLIPSIS}`);
  });

  it('still prefers the word boundary when the last word is merely long', () => {
    const text = `Anna said ${'supercalifragilistic'.repeat(2)} twice and then left the room for good`;
    expect(derivePreview(text, 30)).toBe(`Anna said${ELLIPSIS}`);
  });

  it('cuts inside a run far longer than any word instead of showing almost nothing', () => {
    const address = `See ${'a'.repeat(300)}`;
    expect(derivePreview(address, 100)).toBe(`See ${'a'.repeat(96)}${ELLIPSIS}`);
  });

  it('never splits an emoji in two, with or without the built-in segmenter', () => {
    const run = '\u{1F600}'.repeat(300); // each is two code units
    for (const segmenter of [defaultGraphemeSegmenter(), null]) {
      for (let limit = 1; limit < 40; limit += 1) {
        const body = derivePreview(run, limit, segmenter).slice(0, -1);
        expect(body, `limit ${limit}`).toBe('\u{1F600}'.repeat(limit));
      }
    }
  });

  it('never cuts inside a group of joined symbols or between a symbol and its skin tone', () => {
    for (const [unit, name] of [[family, 'family'], [flagless, 'hand']] as const) {
      const run = unit.repeat(120);
      for (const segmenter of [defaultGraphemeSegmenter(), null]) {
        for (let limit = 1; limit < 60; limit += 1) {
          const body = derivePreview(run, limit, segmenter).slice(0, -1);
          expect(body.length % unit.length, `${name}, limit ${limit}`).toBe(0);
          expect(run.startsWith(body)).toBe(true);
        }
      }
    }
  });

  it('never splits a pointed Hebrew letter in a run with no spaces', () => {
    const run = pointed('אבגדהוזח'.repeat(60));
    for (const segmenter of [defaultGraphemeSegmenter(), null]) {
      for (let limit = 1; limit < 80; limit += 1) {
        const body = derivePreview(run, limit, segmenter).slice(0, -1);
        expect(seen(body), `limit ${limit}`).toBe(limit);
        expect(MARK.test(run.charAt(body.length)), `limit ${limit}`).toBe(false);
      }
    }
  });

  it('copes with text that is nearly all marks', () => {
    const stacked = `a${'\u{301}'.repeat(5000)} b${'\u{301}'.repeat(5000)} c`;
    for (const segmenter of [defaultGraphemeSegmenter(), null]) {
      const preview = derivePreview(stacked, 200, segmenter);
      expect(preview.endsWith(ELLIPSIS)).toBe(true);
      const body = preview.slice(0, -1);
      expect(stacked.startsWith(body)).toBe(true);
      expect(MARK.test(stacked.charAt(body.length))).toBe(false);
    }
  });
});

describe('characterBoundary', () => {
  const both = [defaultGraphemeSegmenter(), null];

  it('has a built-in segmenter to test with', () => {
    expect(defaultGraphemeSegmenter()).not.toBeNull();
  });

  it('leaves a cut between two plain letters where it is', () => {
    for (const segmenter of both) {
      expect(characterBoundary('hello', 2, segmenter)).toBe(2);
      expect(characterBoundary(HEBREW.daniel, 3, segmenter)).toBe(3);
      expect(characterBoundary('hello', 0, segmenter)).toBe(0);
      expect(characterBoundary('hello', 5, segmenter)).toBe(5);
      expect(characterBoundary('hello', 99, segmenter)).toBe(5);
      expect(characterBoundary('hello', -3, segmenter)).toBe(0);
    }
  });

  it('moves a cut back to the start of the character it would split', () => {
    const shalom = '\u{5E9}\u{5C1}\u{5B8}\u{5DC}\u{5D5}\u{5B9}\u{5DD}'; // shin + dot + vowel, lamed, vav + vowel, mem
    for (const segmenter of both) {
      expect(characterBoundary(shalom, 1, segmenter)).toBe(0);
      expect(characterBoundary(shalom, 2, segmenter)).toBe(0);
      expect(characterBoundary(shalom, 3, segmenter)).toBe(3);
      expect(characterBoundary(shalom, 5, segmenter)).toBe(4);
      expect(characterBoundary('a\u{1F600}b', 2, segmenter)).toBe(1);
      expect(characterBoundary('e\u{301}x', 1, segmenter)).toBe(0);
    }
  });
});
