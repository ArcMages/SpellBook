// The writing report engine (src/core/report), on small English and Hebrew
// texts whose words, characters, sentences and paragraphs were counted by
// hand. The hand counts are written out next to each text.

import { describe, expect, it } from 'vitest';
import { formatReadTime } from '../../../src/core/outliner/readTime';
import {
  DEFAULT_WORDS_PER_PAGE,
  ENGLISH_COMMON_WORDS,
  HEBREW_COMMON_WORDS,
  NARROW_BELOW,
  WIDE_FROM,
  addStats,
  analyzeText,
  countSyllables,
  dominantScript,
  emptyStats,
  figuresOf,
  fleschKincaidGrade,
  foldersOf,
  formatShare,
  isCommonWord,
  isNarrowPane,
  mostUsedWords,
  pagesFor,
  proseBlocks,
  readWordsPerPage,
  readingGrade,
  resolveScope,
  sameScope,
  splitSentences,
  stripInline,
  wordKey,
  wordsOf,
} from '../../../src/core/report';
import type { TreeNode } from '../../../src/core/types';
import { countWords } from '../../../src/core/wordCount';

// ------------------------------------------------------------ an English chapter
//
//   heading      Chapter One                                            2 words, 11 characters, 10 without the space
//   paragraph 1  It was a dark night. The harbour was empty, and Anna walked alone.
//                13 words, 2 sentences, 66 characters (20 + 1 + 45), 12 spaces
//   paragraph 2  "Who is there?" she asked. Nobody answered!
//                7 words, 2 sentences (the first runs on after the quotation), 43 characters, 6 spaces
//   paragraph 3  Dr. Levi had sent three letters.
//                6 words, 1 sentence ("Dr." does not end one), 32 characters, 5 spaces
//
// The properties block, the comment and the stars around "three" are not prose.
export const ENGLISH_CHAPTER = [
  '---',
  'status: Draft',
  'synopsis: Anna arrives in the old town.',
  '---',
  '# Chapter One',
  '',
  'It was a dark night. The harbour was empty, and Anna walked alone.',
  '',
  '"Who is there?" she asked. Nobody answered!',
  '',
  '%% remember to name the dog %%',
  'Dr. Levi had sent **three** letters.',
  '',
].join('\n');

export const ENGLISH_COUNTS = { words: 28, characters: 152, charactersNoSpaces: 128, sentences: 5, paragraphs: 3 };
/** The words that stand in sentences (the heading's two do not), and their syllables, counted word by word. */
const ENGLISH_SENTENCE_WORDS = 26;
const ENGLISH_SYLLABLES = 17 + 10 + 8;

// ------------------------------------------------------------- a Hebrew chapter
//
//   heading      (2 words: "chapter one")                               9 characters, 8 without the space
//   paragraph 1  (three sentences: a greeting, a question, an exclamation)
//                11 words, 3 sentences, 52 characters, 10 spaces
//   paragraph 2  (one sentence with a comma)
//                5 words, 1 sentence, 25 characters, 4 spaces
//
// Letters in the words of the two paragraphs: 39 + 19 = 58. No word has more than six.
export const HEBREW_CHAPTER = [
  '# פרק ראשון',
  '',
  'שלום לך אחותי היקרה. מה שלומך? אני כותבת לך מן הנמל!',
  '',
  'הלילה היה חשוך, והים שקט.',
  '',
].join('\n');

export const HEBREW_COUNTS = { words: 18, characters: 86, charactersNoSpaces: 71, sentences: 4, paragraphs: 2 };

const counted = (markdown: string): typeof ENGLISH_COUNTS => {
  const { words, characters, charactersNoSpaces, sentences, paragraphs } = analyzeText(markdown);
  return { words, characters, charactersNoSpaces, sentences, paragraphs };
};

describe('the figures match a hand count', () => {
  it('on an English chapter', () => {
    expect(counted(ENGLISH_CHAPTER)).toEqual(ENGLISH_COUNTS);
    // The words are the binder's words.
    expect(countWords(ENGLISH_CHAPTER)).toBe(ENGLISH_COUNTS.words);
  });

  it('on a Hebrew chapter', () => {
    expect(counted(HEBREW_CHAPTER)).toEqual(HEBREW_COUNTS);
    expect(countWords(HEBREW_CHAPTER)).toBe(HEBREW_COUNTS.words);
  });

  it('the same on a device without a word segmenter', () => {
    for (const [chapter, counts] of [
      [ENGLISH_CHAPTER, ENGLISH_COUNTS],
      [HEBREW_CHAPTER, HEBREW_COUNTS],
    ] as const) {
      const { words, characters, charactersNoSpaces, sentences, paragraphs } = analyzeText(chapter, null);
      expect({ words, characters, charactersNoSpaces, sentences, paragraphs }).toEqual(counts);
    }
  });

  it('adds two chapters up, sum by sum', () => {
    const total = addStats(addStats(emptyStats(), analyzeText(ENGLISH_CHAPTER)), analyzeText(HEBREW_CHAPTER));
    expect(total.words).toBe(28 + 18);
    expect(total.characters).toBe(152 + 86);
    expect(total.charactersNoSpaces).toBe(128 + 71);
    expect(total.sentences).toBe(9);
    expect(total.paragraphs).toBe(5);
    expect(total.frequency.get('was')).toBe(2);
    expect(total.frequency.get('לך')).toBe(2);
    // Adding left the parts alone.
    expect(analyzeText(HEBREW_CHAPTER).frequency.get('was')).toBeUndefined();
  });

  it('counts nothing in an empty note, and in one that is all properties and comments', () => {
    for (const text of ['', '\n\n', '---\nstatus: Draft\n---\n', '%% only a note to self %%\n']) {
      expect(counted(text), JSON.stringify(text)).toEqual({ words: 0, characters: 0, charactersNoSpaces: 0, sentences: 0, paragraphs: 0 });
    }
    // A comment written the HTML way is no prose either. (The binder does count its words, and so the report does.)
    expect(counted('<!-- hidden -->')).toEqual({ words: countWords('<!-- hidden -->'), characters: 0, charactersNoSpaces: 0, sentences: 0, paragraphs: 0 });
    const figures = figuresOf(analyzeText(''));
    expect(figures.pages).toBe(0);
    expect(figures.readTime).toBe('0 min');
    expect(figures.grade).toEqual({ kind: 'none' });
    expect(figures.wordsPerSentence).toBeNull();
  });
});

describe('markup is not prose', () => {
  it('takes the markup out of a line and keeps what a reader sees', () => {
    expect(stripInline('She **ran** and *ran* and ~~walked~~ ==home==.')).toBe('She ran and ran and walked home.');
    expect(stripInline('A _quiet_ night, __very__ quiet.')).toBe('A quiet night, very quiet.');
    expect(stripInline('the snake_case name stays')).toBe('the snake_case name stays');
    expect(stripInline('See [the office](https://example.com/a b) today.')).toBe('See the office today.');
    expect(stripInline('Ask [[Anna Levi|Anna]] or [[Daniel]].')).toBe('Ask Anna or Daniel.');
    expect(stripInline('A picture ![[map.png]] and ![alt](map.png) here.')).toBe('A picture and here.');
    expect(stripInline('A claim.[^1] And `code` and <b>bold</b>.')).toBe('A claim. And code and bold.');
    expect(stripInline('Not \\*emphasis\\*, a star.')).toBe('Not emphasis, a star.');
  });

  it('gives one block per line of text, and leaves out what is not text', () => {
    const note = [
      '---',
      'status: Draft',
      '---',
      '## The harbour ##',
      'First line.',
      'Second line, right under it.',
      '',
      '> A quoted line.',
      '> [!note] A callout',
      '- a list item',
      '2. a numbered one',
      '- [x] a finished to-do',
      '***',
      '```js',
      'const not = "prose";',
      '```',
      '$$',
      'x = y',
      '$$',
      '| Name | Age |',
      '| --- | :-: |',
      '| Anna | 30 |',
      '[^1]: A footnote.',
      '<!-- a hidden',
      'comment -->',
      '%%',
      'another one',
      '%%',
      'Last line.',
    ].join('\n');
    expect(proseBlocks(note)).toEqual([
      { kind: 'heading', text: 'The harbour' },
      { kind: 'paragraph', text: 'First line.' },
      { kind: 'paragraph', text: 'Second line, right under it.' },
      { kind: 'paragraph', text: 'A quoted line.' },
      { kind: 'paragraph', text: 'A callout' },
      { kind: 'paragraph', text: 'a list item' },
      { kind: 'paragraph', text: 'a numbered one' },
      { kind: 'paragraph', text: 'a finished to-do' },
      { kind: 'paragraph', text: 'Name Age' },
      { kind: 'paragraph', text: 'Anna 30' },
      { kind: 'paragraph', text: 'A footnote.' },
      { kind: 'paragraph', text: 'Last line.' },
    ]);
  });

  it('counts a pointed Hebrew letter as one character', () => {
    // "Shalom" with its points: four letters, as without them.
    const pointed = 'שָׁלוֹם';
    expect([...pointed].length).toBeGreaterThan(4);
    expect(analyzeText(pointed).characters).toBe(4);
    expect(analyzeText(pointed).frequency.get('שלום')).toBe(1);
  });

  it('a tag is not a heading, and a line of text that starts with a star is not a list', () => {
    expect(proseBlocks('#draft\n*Suddenly* it rained.')).toEqual([
      { kind: 'paragraph', text: '#draft' },
      { kind: 'paragraph', text: 'Suddenly it rained.' },
    ]);
  });
});

describe('sentences', () => {
  it('ends them at a full stop, a question mark, an exclamation mark or an ellipsis', () => {
    expect(splitSentences('It rained. Did it stop? Never! She waited… Then she left.')).toEqual([
      'It rained.',
      'Did it stop?',
      'Never!',
      'She waited…',
      'Then she left.',
    ]);
    expect(splitSentences('No full stop at the end')).toEqual(['No full stop at the end']);
    expect(splitSentences('Really?! Yes.')).toEqual(['Really?!', 'Yes.']);
    expect(splitSentences('')).toEqual([]);
    expect(splitSentences('... … !')).toEqual([]);
  });

  it('does not end them at a title, an initial, an abbreviation or a number', () => {
    expect(splitSentences('Dr. Levi met Mrs. Cohen at St. Mary. They talked.')).toEqual(['Dr. Levi met Mrs. Cohen at St. Mary.', 'They talked.']);
    expect(splitSentences('J. R. R. Tolkien wrote it. So it is said.')).toHaveLength(2);
    expect(splitSentences('It cost 3.50 in the U.S. Anna paid.')).toEqual(['It cost 3.50 in the U.S. Anna paid.']);
    expect(splitSentences('Bring fruit, e.g. apples. And bread.')).toHaveLength(2);
    // "I" at the end of a sentence is not an initial; a title at the very end ends the text.
    expect(splitSentences('Neither did I. She left.')).toHaveLength(2);
    expect(splitSentences('Call the Dr.')).toHaveLength(1);
  });

  it('keeps a quotation with what is said about it', () => {
    expect(splitSentences('"Stop!" she said. "Why?" He did not answer.')).toEqual(['"Stop!" she said.', '"Why?"', 'He did not answer.']);
    expect(splitSentences('He paused... then went on.')).toHaveLength(1);
    expect(splitSentences('“Go.” She went.')).toEqual(['“Go.”', 'She went.']);
  });

  it('works the same way in Hebrew', () => {
    expect(splitSentences('שלום לך אחותי היקרה. מה שלומך? אני כותבת לך מן הנמל!')).toEqual([
      'שלום לך אחותי היקרה.',
      'מה שלומך?',
      'אני כותבת לך מן הנמל!',
    ]);
    // Initials: "Y. L. Peretz wrote. We read."
    expect(splitSentences('י. ל. פרץ כתב. אנחנו קראנו.')).toHaveLength(2);
    // A number with a stop inside it, and a sentence with no mark at its end.
    expect(splitSentences('המחיר היה 3.50 שקלים. היא שילמה')).toHaveLength(2);
  });
});

describe('the reading grade', () => {
  it('estimates the syllables of English words', () => {
    const expected: Record<string, number> = {
      a: 1,
      the: 1,
      cat: 1,
      night: 1,
      dark: 1,
      walked: 1,
      asked: 1,
      wanted: 2,
      make: 1,
      times: 1,
      boxes: 2,
      horses: 2,
      table: 2,
      little: 2,
      people: 2,
      alone: 2,
      three: 1,
      there: 1,
      harbour: 2,
      empty: 2,
      nobody: 3,
      answered: 2,
      letters: 2,
      beautiful: 3,
      reading: 2,
      yellow: 2,
      'élan': 2,
    };
    for (const [word, syllables] of Object.entries(expected)) expect(countSyllables(word), word).toBe(syllables);
    expect(countSyllables('1984')).toBe(0);
    expect(countSyllables('שלום')).toBe(0);
  });

  it('gives English its Flesch-Kincaid grade, from the sums of the text', () => {
    const stats = analyzeText(ENGLISH_CHAPTER);
    expect(stats.sentenceWords).toBe(ENGLISH_SENTENCE_WORDS);
    expect(stats.latinWords).toBe(ENGLISH_SENTENCE_WORDS);
    expect(stats.latinSyllables).toBe(ENGLISH_SYLLABLES);
    expect(dominantScript(stats)).toBe('latin');
    const grade = readingGrade(stats);
    expect(grade.kind).toBe('english');
    // 0.39 x (26 / 5) + 11.8 x (35 / 26) - 15.59
    const byHand = 0.39 * (26 / 5) + 11.8 * (35 / 26) - 15.59;
    expect(byHand).toBeCloseTo(2.323, 3);
    if (grade.kind === 'english') expect(grade.grade).toBeCloseTo(byHand, 10);
    expect(fleschKincaidGrade(1, 1)).toBe(0); // never below nought
    expect(fleschKincaidGrade(20, 1.5)).toBeCloseTo(9.91, 2);
  });

  it('gives Hebrew an approximate measure of its own, never the English formula', () => {
    const stats = analyzeText(HEBREW_CHAPTER);
    expect(dominantScript(stats)).toBe('hebrew');
    expect(stats.sentenceWords).toBe(16);
    expect(stats.sentenceLetters).toBe(58);
    expect(stats.longWords).toBe(0);
    expect(stats.latinWords).toBe(0);
    // LIX: 16 words in 4 sentences, and no long word.
    expect(readingGrade(stats)).toEqual({ kind: 'hebrew', lix: 4, longWordShare: 0 });
    const figures = figuresOf(stats);
    expect(figures.wordsPerSentence).toBe(4);
    expect(figures.lettersPerWord).toBe(58 / 16);

    // A long word counts: "the mathematicians understood." has one of eleven letters among two words.
    const long = readingGrade(analyzeText('המתמטיקאים הבינו.'));
    expect(long).toEqual({ kind: 'hebrew', lix: 2 + 50, longWordShare: 0.5 });
  });

  it('judges a text by the script most of it is written in, and recomputes the grade for a whole', () => {
    const mostlyHebrew = analyzeText('היא אמרה hello ויצאה מן הבית.');
    expect(readingGrade(mostlyHebrew).kind).toBe('hebrew');
    const mostlyEnglish = analyzeText('She said שלום and left the house quietly.');
    expect(readingGrade(mostlyEnglish).kind).toBe('english');
    expect(mostlyEnglish.latinWords).toBe(7);
    expect(readingGrade(analyzeText('1984. 2001!')).kind).toBe('none');
    expect(readingGrade(analyzeText('# Only a heading')).kind).toBe('none');

    // A long English chapter and a short Hebrew one: the whole is English, from the sums of both.
    const whole = addStats(addStats(emptyStats(), analyzeText(ENGLISH_CHAPTER)), analyzeText('שלום לך.'));
    const grade = readingGrade(whole);
    expect(grade.kind).toBe('english');
    if (grade.kind === 'english') expect(grade.grade).toBeCloseTo(Math.max(0, 0.39 * (28 / 6) + 11.8 * (35 / 26) - 15.59), 10);
  });
});

describe('pages and reading time', () => {
  it('counts a page that was begun as a page', () => {
    expect(pagesFor(0)).toBe(0);
    expect(pagesFor(1)).toBe(1);
    expect(pagesFor(250)).toBe(1);
    expect(pagesFor(251)).toBe(2);
    expect(pagesFor(90_000)).toBe(360);
    expect(pagesFor(90_000, 300)).toBe(300);
    expect(DEFAULT_WORDS_PER_PAGE).toBe(250);
  });

  it('keeps the words on a page within sensible bounds', () => {
    expect(readWordsPerPage(300)).toBe(300);
    expect(readWordsPerPage('275')).toBe(275);
    expect(readWordsPerPage(' 300.4 ')).toBe(300);
    for (const odd of [null, undefined, '', 'many', 0, -5, 49, 2001, Number.NaN, {}, true]) {
      expect(readWordsPerPage(odd), String(odd)).toBe(250);
    }
  });

  it('says the reading time the outliner says', () => {
    for (const markdown of [ENGLISH_CHAPTER, HEBREW_CHAPTER]) {
      expect(figuresOf(analyzeText(markdown)).readTime).toBe(formatReadTime(countWords(markdown)));
    }
    expect(figuresOf(analyzeText(ENGLISH_CHAPTER)).readTime).toBe('1 min');
    expect(figuresOf(analyzeText(ENGLISH_CHAPTER)).pages).toBe(1);
  });
});

describe('the most used words', () => {
  const text = 'The dog saw the cat. The cat saw Anna, and Anna’s dog ran. Dog!';

  it('cuts words the way the word counter does', () => {
    expect(wordsOf('It was 3.14, she said.')).toEqual(['It', 'was', '3.14', 'she', 'said']);
    expect(wordsOf("Don't stop", null)).toEqual(["Don't", 'stop']);
    for (const sample of [ENGLISH_CHAPTER, HEBREW_CHAPTER, text]) {
      const plain = proseBlocks(sample)
        .map((block) => block.text)
        .join('\n');
      expect(wordsOf(plain).length).toBe(countWords(sample));
      expect(wordsOf(plain, null).length).toBe(countWords(sample, null));
    }
  });

  it('knows a word in lower case, without Hebrew points, and lists no numbers', () => {
    expect(wordKey('Anna')).toBe('anna');
    expect(wordKey('Anna’s')).toBe("anna's");
    expect(wordKey('שָׁלוֹם')).toBe('שלום');
    expect(wordKey('1984')).toBe('');
    expect(wordKey('3rd')).toBe('');
  });

  it('lists them the most used first, without the common words unless asked', () => {
    const { frequency } = analyzeText(text);
    // 14 words: the x3, dog x3, saw x2, cat x2, anna, and, anna's, ran.
    expect(mostUsedWords(frequency).map((use) => [use.word, use.count])).toEqual([
      ['dog', 3],
      ['cat', 2],
      ['saw', 2],
      ['anna', 1],
      ["anna's", 1],
      ['ran', 1],
    ]);
    const all = mostUsedWords(frequency, { includeCommon: true });
    expect(all.map((use) => use.word)).toEqual(['dog', 'the', 'cat', 'saw', 'and', 'anna', "anna's", 'ran']);
    expect(all[0]?.share).toBeCloseTo(3 / 14, 10);
    // The share is of all the words, also when the common ones are not listed.
    expect(mostUsedWords(frequency)[0]?.share).toBeCloseTo(3 / 14, 10);
    expect(mostUsedWords(new Map())).toEqual([]);
  });

  it('leaves the common words of Hebrew out as well', () => {
    const { frequency } = analyzeText(HEBREW_CHAPTER);
    const listed = mostUsedWords(frequency).map((use) => use.word);
    expect(listed).toContain('אחותי');
    expect(listed).toContain('הנמל');
    for (const common of ['לך', 'מה', 'אני', 'מן', 'היה']) expect(listed, common).not.toContain(common);
    expect(mostUsedWords(frequency, { includeCommon: true })[0]).toEqual({ word: 'לך', count: 2, share: 2 / 18 });
  });

  it('has a list of its own for each language, of words of grammar only', () => {
    expect(ENGLISH_COMMON_WORDS.size).toBeGreaterThan(150);
    expect(HEBREW_COMMON_WORDS.size).toBeGreaterThan(120);
    for (const word of ['the', 'and', "don't", 'herself', 'של', 'הוא', 'אבל']) expect(isCommonWord(word), word).toBe(true);
    // Words a writer wants to see: they carry meaning, or may be a name.
    for (const word of ['said', 'just', 'suddenly', 'anna', 'אמר', 'פתאום', 'אלי']) expect(isCommonWord(word), word).toBe(false);
    // Every entry is as a word is known in the list: lower case, no points.
    for (const word of [...ENGLISH_COMMON_WORDS, ...HEBREW_COMMON_WORDS]) expect(wordKey(word), word).toBe(word);
    // No word is in both.
    expect([...ENGLISH_COMMON_WORDS].filter((word) => HEBREW_COMMON_WORDS.has(word))).toEqual([]);
  });

  it('writes a share so that a rare word never reads as nought', () => {
    expect(formatShare(3 / 14)).toBe('21.4%');
    expect(formatShare(0.042)).toBe('4.2%');
    expect(formatShare(1)).toBe('100.0%');
    expect(formatShare(1 / 90_000)).toBe('under 0.1%');
    expect(formatShare(0)).toBe('0%');
  });
});

describe('the scope of a report', () => {
  const scene = (path: string, missing = false): TreeNode => ({ kind: 'scene', path, title: path.replace(/^.*\//, '').replace(/\.md$/, ''), missing });
  const tree: TreeNode[] = [
    scene('Manuscript/Opening.md'),
    {
      kind: 'folder',
      id: 'f-one',
      name: 'Part one',
      children: [scene('Manuscript/Letter.md'), { kind: 'folder', id: 'f-inner', name: 'חלק שני', children: [scene('Manuscript/Night.md')] }],
    },
    scene('Manuscript/Ghost.md', true),
    { kind: 'folder', id: 'f-empty', name: 'Empty', children: [] },
  ];
  const paths = (scenes: readonly { path: string }[]): string[] => scenes.map((entry) => entry.path.replace('Manuscript/', ''));

  it('lists the folders of the binder, each with how deep it sits', () => {
    expect(foldersOf(tree)).toEqual([
      { id: 'f-one', name: 'Part one', depth: 0 },
      { id: 'f-inner', name: 'חלק שני', depth: 1 },
      { id: 'f-empty', name: 'Empty', depth: 0 },
    ]);
    expect(foldersOf([])).toEqual([]);
  });

  it('reads the whole manuscript in binder order', () => {
    const subject = resolveScope(tree, { kind: 'manuscript' }, null);
    expect(subject.kind).toBe('manuscript');
    if (subject.kind === 'manuscript') {
      expect(paths(subject.scenes)).toEqual(['Opening.md', 'Letter.md', 'Night.md', 'Ghost.md']);
      expect(subject.scenes[3]?.missing).toBe(true);
    }
  });

  it('reads a folder with the folders inside it', () => {
    const outer = resolveScope(tree, { kind: 'folder', id: 'f-one' }, null);
    expect(outer.kind === 'folder' && [outer.title, paths(outer.scenes)]).toEqual(['Part one', ['Letter.md', 'Night.md']]);
    const inner = resolveScope(tree, { kind: 'folder', id: 'f-inner' }, null);
    expect(inner.kind === 'folder' && paths(inner.scenes)).toEqual(['Night.md']);
    const empty = resolveScope(tree, { kind: 'folder', id: 'f-empty' }, null);
    expect(empty.kind === 'folder' && empty.scenes).toEqual([]);
    expect(resolveScope(tree, { kind: 'folder', id: 'f-gone' }, null)).toEqual({ kind: 'no-folder' });
  });

  it('reads the open scene, when the open note is one', () => {
    const subject = resolveScope(tree, { kind: 'scene' }, 'Manuscript/Night.md');
    expect(subject.kind === 'scene' && [subject.title, paths(subject.scenes)]).toEqual(['Night', ['Night.md']]);
    expect(resolveScope(tree, { kind: 'scene' }, null)).toEqual({ kind: 'no-scene' });
    expect(resolveScope(tree, { kind: 'scene' }, 'Research/Notes.md')).toEqual({ kind: 'no-scene' });
  });

  it('tells two scopes apart', () => {
    expect(sameScope({ kind: 'scene' }, { kind: 'scene' })).toBe(true);
    expect(sameScope({ kind: 'scene' }, { kind: 'manuscript' })).toBe(false);
    expect(sameScope({ kind: 'folder', id: 'a' }, { kind: 'folder', id: 'a' })).toBe(true);
    expect(sameScope({ kind: 'folder', id: 'a' }, { kind: 'folder', id: 'b' })).toBe(false);
  });
});

describe('one column or several', () => {
  it('goes by the measured width, with a gap so that it does not flicker', () => {
    expect(isNarrowPane(900, false)).toBe(false);
    expect(isNarrowPane(NARROW_BELOW - 1, false)).toBe(true);
    expect(isNarrowPane(NARROW_BELOW, false)).toBe(false);
    expect(isNarrowPane(500, true)).toBe(true); // in the gap: stays as it was
    expect(isNarrowPane(500, false)).toBe(false);
    expect(isNarrowPane(WIDE_FROM, true)).toBe(false);
    // A hidden pane measures nought: it keeps what it had.
    expect(isNarrowPane(0, true)).toBe(true);
    expect(isNarrowPane(0, false)).toBe(false);
  });
});
