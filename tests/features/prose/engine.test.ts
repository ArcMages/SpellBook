// The prose checks engine (src/core/prose): what counts as prose, how a line
// is cut into words and sentences in English and in Hebrew, and what each
// check marks.

import { describe, expect, it, vi } from 'vitest';
import {
  ADVERB_WINDOW,
  FILLERS_EN,
  FILLERS_HE,
  FIRST_CHECKS,
  LINE_IN_COMMENT,
  LINE_SKIP,
  LINE_STRAY_COMMENT,
  LONG_SENTENCE,
  NO_PROSE_PREFS,
  PROSE_CHECKS,
  PROSE_PREFS_KEY,
  ProseAnalyser,
  REPEAT_DISTANCE,
  clampWhole,
  contextLines,
  fillerList,
  fillerWords,
  findFillers,
  findPassives,
  isShown,
  maskLine,
  optionsOf,
  parseProsePrefs,
  repeatForms,
  scanLines,
  sentencesOf,
  serializeProsePrefs,
  tokenize,
  withCheck,
  withMaster,
} from '../../../src/core/prose';
import type { Token } from '../../../src/core/prose';
import { marked, marksOf, messages, options, passageOf } from './lines';

const word = (text: string): Token => tokenize(text)[0] as Token;

describe('what is prose', () => {
  it('leaves out the properties block, code blocks, maths blocks, headings and table rows', () => {
    const note = [
      '---',
      'synopsis: a very short one',
      '---',
      '# A very good heading',
      'Prose.',
      '```js',
      'very = 1',
      '```',
      'More prose.',
      '~~~',
      '``` not the end',
      '~~~',
      '$$',
      'x = very',
      '$$',
      '| very | table |',
      '$$ one = line $$',
      'Last prose.',
    ];
    const flags = [...scanLines(note)];
    const prose = note.filter((_, at) => (flags[at] ?? 0) === 0);
    expect(prose).toEqual(['Prose.', 'More prose.', 'Last prose.']);
    expect(flags.filter((flag) => flag !== 0).every((flag) => flag === LINE_SKIP)).toBe(true);
  });

  it('takes a properties block that is never closed, and "---" further down, for ordinary text', () => {
    expect([...scanLines(['---', 'It was very late.', 'Still.'])]).toEqual([0, 0, 0]);
    expect([...scanLines(['One.', '---', 'Two.', '---', 'Three.'])]).toEqual([0, 0, 0, 0, 0]);
    expect([...scanLines([])]).toEqual([]);
  });

  it('treats everything after an unclosed code fence as code, as Markdown does', () => {
    expect([...scanLines(['One.', '```', 'two', 'three'])]).toEqual([0, LINE_SKIP, LINE_SKIP, LINE_SKIP]);
  });

  it('follows a %% comment over several lines, and takes one that is never closed for text', () => {
    const flags = [...scanLines(['Before %% a note', 'all hidden', 'end %% after.', 'Plain.'])];
    expect(flags).toEqual([0, LINE_SKIP, LINE_IN_COMMENT, 0]);
    expect(maskLine('Before %% a note', 0)).toBe('Before          ');
    expect(maskLine('end %% after.', LINE_IN_COMMENT)).toBe('       after.');

    // "100%%" with no partner hides nothing, as in the word counter.
    const stray = [...scanLines(['Up 100%% today.', '```', 'code', '```', 'Very plain.'])];
    expect(stray).toEqual([LINE_STRAY_COMMENT, LINE_SKIP, LINE_SKIP, LINE_SKIP, 0]);
    expect(maskLine('Up 100%% today.', LINE_STRAY_COMMENT)).toBe('Up 100%% today.');
    // A closed one and then a stray one on the same line.
    expect([...scanLines(['a %%b%% c %% d', 'e'])]).toEqual([LINE_STRAY_COMMENT, 0]);
    expect(maskLine('a %%b%% c %% d', LINE_STRAY_COMMENT)).toBe('a       c %% d');
  });

  it('blanks out the Markdown in a line and keeps every place where it was', () => {
    const samples: Array<[string, string]> = [
      ['- [ ] Buy `very` bread', '      Buy        bread'],
      ['> 1. A quote', '     A quote'],
      ['> [!note] Title here', '          Title here'],
      ['See [[Harbour|the quay]] now', 'See           the quay   now'],
      ['See [[Harbour]] now', 'See   Harbour   now'],
      ['A [link](https://example.com/very) here', 'A  link                            here'],
      ['Shown ![[very.png]] and ![very](a.png) gone', 'Shown               and                gone'],
      ['A note[^1] and <b>bold</b> text', 'A note     and    bold     text'],
      ['Go to https://example.com/very now', 'Go to                          now'],
      ['Tagged #very/much here', 'Tagged            here'],
      ['Costs $5 and $10 today', 'Costs $5 and $10 today'],
      ['Maths $x + y$ inline', 'Maths         inline'],
      ['A line with an id ^abc-1', 'A line with an id       '],
      ['Hidden <!-- very --> part', 'Hidden               part'],
    ];
    for (const [line, expected] of samples) {
      const masked = maskLine(line);
      expect(masked, line).toBe(expected);
      expect(masked.length, line).toBe(line.length);
    }
    expect(maskLine('# Heading', LINE_SKIP)).toBe('         ');
  });

  it('checks nothing in what was left out', () => {
    const note = [
      '---',
      'title: very',
      '---',
      '# A very heading',
      'It was very dark. `very` and [[very|really]] and %%very%% and <b>just</b>.',
      '```',
      'very',
      '```',
      '%%',
      'very',
      '%%',
      'Just so.',
    ].join('\n');
    expect(marked(note, ['filler'])).toEqual(['filler: very', 'filler: really', 'filler: just', 'filler: Just']);
  });
});

describe('words and sentences', () => {
  it('cuts English into words, with apostrophes and hyphens inside them', () => {
    const tokens = tokenize("Don't touch the well-known 3.5 metre wall, Anna's wall.");
    expect(tokens.map((token) => token.text)).toEqual(["Don't", 'touch', 'the', 'well-known', '3.5', 'metre', 'wall', "Anna's", 'wall']);
    expect(tokens.map((token) => token.script)).toEqual(['latin', 'latin', 'latin', 'latin', 'number', 'latin', 'latin', 'latin', 'latin']);
    expect(tokenize('It’s here')[0]?.lower).toBe("it's");
    expect(tokens[6]).toMatchObject({ from: 37, to: 41 });
  });

  it('cuts Hebrew into words: points belong to the word, an acronym stays whole', () => {
    // "The IDF arrived in the city." with points on the last word, and a geresh abbreviation.
    const tokens = tokenize('צה"ל הגיע לעִיר, וכו׳');
    expect(tokens.map((token) => token.text)).toEqual(['צה"ל', 'הגיע', 'לעִיר', 'וכו׳']);
    expect(tokens.every((token) => token.script === 'hebrew')).toBe(true);
    // Compared without its points.
    expect(tokens[2]?.lower).toBe('לעיר');
    expect(tokens[3]?.lower).toBe("וכו'");
    // A maqaf joins two words; they stay two.
    expect(tokenize('בית־ספר').map((token) => token.text)).toEqual(['בית', 'ספר']);
  });

  it('knows each word of a line that mixes the two languages', () => {
    const tokens = tokenize('She said שלום and left.');
    expect(tokens.map((token) => token.script)).toEqual(['latin', 'latin', 'hebrew', 'latin', 'latin']);
  });

  it('finds where sentences begin', () => {
    const starts = (line: string): string[] => tokenize(line).filter((token) => token.start).map((token) => token.text);
    expect(starts('It rained. She left! Did he? Yes.')).toEqual(['It', 'She', 'Did', 'Yes']);
    // Speech that goes on, three dots, a title and initials end nothing.
    expect(starts('"Stop!" she said. "Now."')).toEqual(['Stop', 'Now']);
    expect(starts('He went... on and on. Then stopped.')).toEqual(['He', 'Then']);
    expect(starts('Mr. Hale met J. R. Wren at 3.30. They talked.')).toEqual(['Mr', 'They']);
    // Hebrew has no capitals: a full stop is always an end.
    expect(starts('ירד גשם. היא הלכה. מה עכשיו?')).toEqual(['ירד', 'היא', 'מה']);
  });

  it('counts the words of each sentence', () => {
    const sentences = sentencesOf(tokenize('It rained all night. She left.'));
    expect(sentences.map((sentence) => sentence.words)).toEqual([4, 2]);
    expect(sentences[1]).toMatchObject({ from: 21, to: 29 });
    expect(sentencesOf([])).toEqual([]);
  });
});

describe('filler words', () => {
  it('marks single words and whole phrases, the longest phrase first', () => {
    expect(marked('It was very late and she was kind of tired, a little bit, in order to rest.', ['filler'])).toEqual([
      'filler: very',
      'filler: kind of',
      'filler: a little bit',
      'filler: in order to',
    ]);
    expect(messages('He just left.', ['filler'])).toEqual(['Filler: "just"']);
  });

  it('does not join a phrase across a full stop or a comma', () => {
    expect(marked('That was kind. Of course not.', ['filler'])).toEqual(['filler: Of course']);
    expect(marked('A kind, of sorts.', ['filler'])).toEqual([]);
  });

  it('marks Hebrew fillers, also with "and" attached, and Hebrew phrases', () => {
    // "It was really beautiful, and-simply quiet. In the end we went."
    const line = 'זה היה ממש יפה, ופשוט שקט. בסופו של דבר הלכנו.';
    expect(marked(line, ['filler'])).toEqual(['filler: ממש', 'filler: ופשוט', 'filler: בסופו של דבר']);
    // With points, the word is the same word.
    expect(marked('זה מַמָּשׁ יפה', ['filler'])).toEqual(['filler: מַמָּשׁ']);
  });

  it("adds the writer's own words and phrases, in both languages, however they are written", () => {
    const own = { ownFillers: ['Nevertheless', 'at any rate', 'בקיצור', 'מה שנקרא'] };
    expect(marked('Nevertheless he came, at any rate.', ['filler'], own)).toEqual(['filler: Nevertheless', 'filler: at any rate']);
    expect(marked('בקיצור, זה מה שנקרא סוף.', ['filler'], own)).toEqual(['filler: בקיצור', 'filler: מה שנקרא']);
    // Without them, nothing.
    expect(marked('Nevertheless he came, at any rate.', ['filler'])).toEqual([]);
    // An entry that holds no word at all is nothing.
    expect(fillerList(['', '  ', '...']).size).toBe(fillerList().size);
  });

  it('has lists of its own for both languages', () => {
    expect(FILLERS_EN.length).toBeGreaterThanOrEqual(50);
    expect(FILLERS_HE.length).toBeGreaterThanOrEqual(30);
    expect(new Set(FILLERS_EN).size).toBe(FILLERS_EN.length);
    expect(new Set(FILLERS_HE).size).toBe(FILLERS_HE.length);
    const list = fillerList();
    const tokens = tokenize('very ממש');
    expect(findFillers('very ממש', tokens, list).map((found) => found.text)).toEqual(['very', 'ממש']);
  });
});

describe('passive voice', () => {
  const passives = (line: string): string[] => findPassives(line, tokenize(line)).map((found) => found.text);

  it('marks a form of "to be" with a past form after it', () => {
    expect(passives('The door was opened. The letters were written in haste.')).toEqual(['was opened', 'were written']);
    expect(passives('It is known. They are being followed. He got caught.')).toEqual(['is known', 'are being followed', 'got caught']);
    expect(passives("The boat wasn't seen again. They're taken care of.")).toEqual(["wasn't seen", "They're taken"]);
  });

  it('reaches over small words in between, and back to "had"', () => {
    expect(passives('The house was never quite finished by anyone.')).toEqual(['was never quite finished']);
    expect(passives('The lamp had been quietly removed.')).toEqual(['had been quietly removed']);
    expect(passives('It has been said.')).toEqual(['has been said']);
  });

  it('leaves alone what is not a passive', () => {
    expect(passives('She opened the door. She was opening it. She had opened it.')).toEqual([]);
    expect(passives('He was in need. It was red. She was indeed there.')).toEqual([]);
    // A word that describes: only with "by".
    expect(passives('She was tired. He was married. They were gone.')).toEqual([]);
    expect(passives('She was surprised by the noise.')).toEqual(['was surprised']);
    expect(passives('He was supposed to go. She was used to it.')).toEqual([]);
    // Not across a comma or a full stop.
    expect(passives('What it was, opened wide. It was. Opened doors.')).toEqual([]);
  });

  it('says what it found, and is silent in Hebrew', () => {
    expect(messages('The door was opened.', ['passive'])).toEqual(['Passive voice: "was opened"']);
    expect(marked('הדלת נפתחה על ידי הרוח.', ['passive'])).toEqual([]);
  });
});

describe('repeated words', () => {
  it('marks every use of a word that comes again within the distance, and says how often', () => {
    const text = 'The tide rose. She watched the tide from the wall, and the tide kept rising.';
    expect(marked(text, ['repeated'])).toEqual(['repeated: tide', 'repeated: tide', 'repeated: tide']);
    expect(messages(text, ['repeated'])).toEqual(['Repeated: "tide" 3 times in 12 words']);
  });

  it('takes a word for the same word with another ending', () => {
    expect(marked("The tides turn. The tide's pull. He was walking and then walked on.", ['repeated'])).toEqual([
      'repeated: tides',
      "repeated: tide's",
      'repeated: walking',
      'repeated: walked',
    ]);
    expect(repeatForms(word('running'))).toContain('run');
    expect(repeatForms(word('cried'))).toContain('cry');
    expect(repeatForms(word('stories'))).toContain('story');
  });

  it('ignores the small words of the language, short words and numbers', () => {
    expect(marked('The cat and the dog and the bird and she said that she said it.', ['repeated'])).toEqual([]);
    expect(marked("I don't and you don't. In 1900 and 1900.", ['repeated'])).toEqual([]);
    for (const small of ['the', 'said', 'of', 'it', "don't", '1900']) expect(repeatForms(word(small)), small).toEqual([]);
  });

  it('goes by the distance the writer chose, counted in words, across lines', () => {
    const far = `The harbour slept.\n\n${'A grey gull flew over. '.repeat(4)}\n\nThe harbour woke.`;
    expect(marked(far, ['repeated'], { distance: 15 }).filter((mark) => mark.includes('harbour'))).toEqual([]);
    expect(marked(far, ['repeated'], { distance: 30 }).filter((mark) => mark.includes('harbour'))).toEqual([
      'repeated: harbour',
      'repeated: harbour',
    ]);
    // Words in a code block between them do not count as distance.
    const code = `The harbour slept.\n\`\`\`\n${'filler filler filler filler filler\n'.repeat(8)}\`\`\`\nThe harbour woke.`;
    expect(marked(code, ['repeated'], { distance: 10 })).toEqual(['repeated: harbour', 'repeated: harbour']);
  });

  it('in Hebrew, takes a word for the same word with or without the letters attached to its front', () => {
    // "the-waves rose. She saw waves, and-the-waves were silent, in-waves."
    const text = 'הגלים עלו. היא ראתה גלים, והגלים שתקו בגלים.';
    expect(marked(text, ['repeated'])).toEqual(['repeated: הגלים', 'repeated: גלים', 'repeated: והגלים', 'repeated: בגלים']);
    expect(messages(text, ['repeated'])).toEqual(['Repeated: "גלים" 4 times in 8 words']);
    // One letter, or two when the first is "and", "that" or "as"; three letters must be left.
    expect(repeatForms(word('והגלים'))).toEqual(['והגלים', 'הגלים', 'גלים']);
    expect(repeatForms(word('שבגלים'))).toEqual(['שבגלים', 'בגלים', 'גלים']);
    expect(repeatForms(word('בהגלים'))).toEqual(['בהגלים', 'הגלים']);
    expect(repeatForms(word('הגל'))).toEqual(['הגל']);
    expect(repeatForms(word('גל'))).toEqual([]);
    // Points do not make a different word.
    expect(repeatForms(word('גַּלִּים'))).toEqual(['גלים']);
  });

  it('in Hebrew, ignores the small words, also with a letter in front', () => {
    for (const small of ['של', 'הוא', 'והוא', 'אבל', 'שלא', 'כאשר']) expect(repeatForms(word(small)), small).toEqual([]);
    expect(marked('הוא אמר שהוא לא יודע, והוא אמר את זה שוב.', ['repeated'])).toEqual([]);
  });
});

describe('overused adverbs', () => {
  it('marks three "-ly" adverbs close together, and no fewer', () => {
    const three = 'He ran quickly and quietly and silently into the rain.';
    expect(marked(three, ['overused-adverbs'])).toEqual(['overused: quickly', 'overused: quietly', 'overused: silently']);
    expect(messages(three, ['overused-adverbs'])).toEqual([`Adverbs: 3 within ${ADVERB_WINDOW} words`]);
    expect(marked('He ran quickly and quietly into the rain.', ['overused-adverbs'])).toEqual([]);
  });

  it('does not take every word in "-ly" for an adverb, and counts the distance in words', () => {
    expect(marked('The lonely family had a friendly, lovely, silly belly.', ['overused-adverbs'])).toEqual([]);
    const spread = `Slowly he rose. ${'The grey rain fell on the town. '.repeat(6)}Quietly she left. ${'The grey rain fell on the town. '.repeat(6)}Suddenly it ended.`;
    expect(marked(spread, ['overused-adverbs'])).toEqual([]);
  });
});

describe('sentence rhythm', () => {
  it('marks a sentence that is as long as the threshold, or longer', () => {
    const long = `Word ${'word '.repeat(10)}end.`;
    expect(marked(`Short one. ${long}`, ['rhythm'], { longSentence: 12 })).toEqual([`long: ${long.slice(0, -1)}`]);
    expect(messages(`Short one. ${long}`, ['rhythm'], { longSentence: 12 })).toEqual(['Long sentence: 12 words']);
    expect(marked(`Short one. ${long}`, ['rhythm'], { longSentence: 13 })).toEqual([]);
  });

  it('marks four sentences in a row of nearly one length, across paragraphs', () => {
    const text = 'She came to the door.\n\nHe went to the shore. They sat on the sand.\nWe ate by the fire. Then a much longer sentence arrived to break the pattern at last.';
    expect(marked(text, ['rhythm'])).toEqual([
      'run: She came to the door',
      'run: He went to the shore',
      'run: They sat on the sand',
      'run: We ate by the fire',
    ]);
    expect(messages(text, ['rhythm'])).toEqual(['Rhythm: 4 sentences in a row of about 5 words']);
  });

  it('does not call three sentences a run, nor one-word answers, nor sentences parted by a heading', () => {
    expect(marked('She came to the door. He went to the shore. They sat on the sand.', ['rhythm'])).toEqual([]);
    expect(marked('"Yes." "No." "Why?" "Because." "Oh."', ['rhythm'])).toEqual([]);
    expect(marked('She came to the door. He went to the shore.\n# Two\nThey sat on the sand. We ate by the fire.', ['rhythm'])).toEqual([]);
    // Lengths that drift apart are no run.
    expect(marked('One two three. One two three four five. One two three four five six seven. One two three four five six seven eight nine.', ['rhythm'])).toEqual([]);
  });

  it('works the same in Hebrew', () => {
    const text = 'היא באה אל הדלת. הוא הלך אל החוף. הם ישבו על החול. אנחנו אכלנו ליד האש.';
    expect(marked(text, ['rhythm']).map((mark) => mark.split(':')[0])).toEqual(['run', 'run', 'run', 'run']);
    const long = `${'מילה '.repeat(12)}סוף.`;
    expect(messages(long, ['rhythm'], { longSentence: 12 })).toEqual(['Long sentence: 13 words']);
  });
});

describe('the analysis', () => {
  it('marks nothing while no check is on, and only what is on', () => {
    const text = 'The tide was very high, and the tide was watched quickly, quietly, silently.';
    expect(new ProseAnalyser(options([])).idle).toBe(true);
    expect(marked(text, [])).toEqual([]);
    expect(marked(text, ['filler'])).toEqual(['filler: very']);
    expect(new Set(marksOf(text).map((mark) => mark.kind))).toEqual(
      new Set(['noun', 'verb', 'adjective', 'adverb', 'filler', 'passive', 'repeated', 'overused']),
    );
  });

  it('keeps every mark inside one line, and inside the words it is about', () => {
    const text = 'The tide was very high.\nAnd the tide was watched by the gulls, which were slowly, quietly, sadly leaving.';
    for (const mark of marksOf(text)) {
      const words = text.slice(mark.from, mark.to);
      expect(words).not.toContain('\n');
      expect(words).toBe(words.trim());
      expect(mark.message).not.toBe('');
    }
  });

  it('colours English words only: Hebrew words get no type', () => {
    const types = ['nouns', 'verbs', 'adjectives', 'adverbs'] as const;
    expect(marked('הגלים עלו לאט מאוד.', types)).toEqual([]);
    expect(marked('The wave גל rose.', types)).toEqual(['noun: wave', 'verb: rose']);
  });

  it('remembers a line it has seen, and forgets the oldest when there are too many', () => {
    const analyser = new ProseAnalyser(options());
    const first = analyser.line('The tide was very high.');
    expect(analyser.line('The tide was very high.')).toBe(first);
    expect(analyser.remembered).toBe(1);
    for (let at = 0; at < 4000; at++) analyser.line(`Line number ${at} is here.`);
    expect(analyser.remembered).toBeLessThanOrEqual(3000);
    // The same text under another reading of its comment marks is another line.
    expect(analyser.line('a %% b', LINE_STRAY_COMMENT)).not.toBe(analyser.line('a %% b', 0));
    expect(analyser.line('# Heading', LINE_SKIP).words).toBe(0);
  });

  it('goes on when one line cannot be read', () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const analyser = new ProseAnalyser(options(['filler']));
    const broken = { get length(): number { throw new Error('bug'); } } as unknown as string;
    expect(analyser.line(broken).marks).toEqual([]);
    expect(logged).toHaveBeenCalledTimes(1);
    logged.mockRestore();
    expect(analyser.passage(passageOf('It was very late.')).map((mark) => mark.kind)).toEqual(['filler']);
  });

  it('says which lines to read around the ones on the screen', () => {
    const tenWords = (): number => 10;
    expect(contextLines(tenWords, 50, 60, 200, 40)).toEqual({ first: 46, last: 64 });
    expect(contextLines(tenWords, 1, 3, 5, 40)).toEqual({ first: 1, last: 5 });
    // Empty lines hold no words: it looks further, but not without end.
    expect(contextLines(() => 0, 500, 510, 1000, 40)).toEqual({ first: 380, last: 630 });
    expect(contextLines(tenWords, 0, 999, 20, 40)).toEqual({ first: 1, last: 20 });
  });
});

describe("the writer's choices", () => {
  it('start with everything off, and nothing kept', () => {
    expect(NO_PROSE_PREFS).toMatchObject({ on: false, checks: [], distance: REPEAT_DISTANCE.initial, longSentence: LONG_SENTENCE.initial });
    expect(serializeProsePrefs(NO_PROSE_PREFS)).toBeNull();
    expect(parseProsePrefs(null)).toEqual(NO_PROSE_PREFS);
    expect(optionsOf(NO_PROSE_PREFS).checks.size).toBe(0);
    expect(PROSE_PREFS_KEY.startsWith('spellbook-')).toBe(true);
  });

  it('come back from the storage as they were saved', () => {
    const prefs = {
      on: true,
      checks: ['filler', 'rhythm'] as const,
      distance: 60,
      longSentence: 28,
      fillersEnglish: ['at any rate'],
      fillersHebrew: ['בקיצור'],
    };
    const text = serializeProsePrefs(prefs);
    expect(typeof text).toBe('string');
    expect(parseProsePrefs(text)).toEqual(prefs);
    expect(optionsOf(prefs)).toMatchObject({ distance: 60, longSentence: 28, ownFillers: ['at any rate', 'בקיצור'] });
    expect([...optionsOf(prefs).checks]).toEqual(['filler', 'rhythm']);
  });

  it('survive anything the storage may hold', () => {
    for (const bad of [undefined, 42, 'not json', '[]', 'null', '{"on":"yes"}', [], { checks: 'filler' }]) {
      expect(parseProsePrefs(bad), JSON.stringify(bad)).toEqual(NO_PROSE_PREFS);
    }
    const odd = parseProsePrefs({ on: true, checks: ['rhythm', 'nonsense', 'filler', 'filler'], distance: 100000, longSentence: -3, fillersEnglish: 'a, b', fillersHebrew: [1, 'x'] });
    expect(odd).toEqual({ on: true, checks: ['filler', 'rhythm'], distance: REPEAT_DISTANCE.max, longSentence: LONG_SENTENCE.min, fillersEnglish: ['a', 'b'], fillersHebrew: ['x'] });
  });

  it('show a check only while the master switch is on; switching a check on switches the checks on', () => {
    const chosen = withCheck({ ...NO_PROSE_PREFS, on: false }, 'filler', true);
    expect(chosen).toMatchObject({ on: true, checks: ['filler'] });
    const off = withMaster(chosen, false);
    expect(off.checks).toEqual(['filler']); // remembered while everything is off
    expect(isShown(off, 'filler')).toBe(false);
    expect(optionsOf(off).checks.size).toBe(0);
    expect(isShown(withMaster(off, true), 'filler')).toBe(true);
    expect(withCheck(chosen, 'filler', false)).toMatchObject({ on: true, checks: [] });
  });

  it('switched on for the first time with nothing chosen, the master switch chooses the underlining checks', () => {
    const first = withMaster(NO_PROSE_PREFS, true);
    expect(first.checks).toEqual(FIRST_CHECKS);
    expect(FIRST_CHECKS.some((check) => ['nouns', 'verbs', 'adjectives', 'adverbs'].includes(check))).toBe(false);
    expect(FIRST_CHECKS.every((check) => PROSE_CHECKS.includes(check))).toBe(true);
  });

  it("reads the writer's list of filler words: commas or lines between them, no doubles, not without end", () => {
    expect(fillerWords(' at any rate , so-called,, בקיצור\nat any rate; x ')).toEqual(['at any rate', 'so-called', 'בקיצור', 'x']);
    expect(fillerWords(Array.from({ length: 500 }, (_, at) => `w${at}`).join(','))).toHaveLength(200);
    expect(fillerWords('x'.repeat(500))[0]).toHaveLength(60);
    expect(fillerWords(7)).toEqual([]);
  });

  it('keeps a threshold a whole number within its bounds', () => {
    expect(clampWhole('25', REPEAT_DISTANCE, 40)).toBe(25);
    expect(clampWhole('25.6', REPEAT_DISTANCE, 40)).toBe(26);
    expect(clampWhole('3', REPEAT_DISTANCE, 40)).toBe(REPEAT_DISTANCE.min);
    expect(clampWhole('9999', REPEAT_DISTANCE, 40)).toBe(REPEAT_DISTANCE.max);
    for (const bad of ['', '  ', 'many', null, undefined, Number.NaN, Number.POSITIVE_INFINITY]) expect(clampWhole(bad, REPEAT_DISTANCE, 40)).toBe(40);
  });
});
