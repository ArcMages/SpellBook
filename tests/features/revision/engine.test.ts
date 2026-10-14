// The revision tools' engine: how a note is kept, how words are found, how a
// scene's text is changed in exact places, and where a name stands.

import { describe, expect, it } from 'vitest';
import {
  REVISION_NOTES_KEY,
  addToList,
  applyBodyEdits,
  applyToNote,
  changeInList,
  contextOf,
  editsFit,
  findInText,
  findWithJoined,
  findNote,
  linkTargets,
  locatePassage,
  nameOccurrences,
  newNameProblem,
  passageMarks,
  patternOf,
  withCaseOf,
  propertiesOf,
  readNoteList,
  readNotes,
  removeFromList,
  splitBody,
  tidyPassage,
} from '../../../src/core/revision/index';
import type { RevisionNote, SearchOptions } from '../../../src/core/revision/index';

const plain: SearchOptions = { matchCase: false, wholeWords: false, wildcards: false };
const words = (text: string, find: string, options: Partial<SearchOptions> = {}): string[] =>
  findInText(text, find, { ...plain, ...options }).map((match) => match.text);

const note = (passage: string, words = 'Say more', created = '2026-10-14', done = false): RevisionNote => ({ passage, note: words, created, done });

describe('the revision notes of a scene', () => {
  it('are a list of plain entries, each with passage, note, created and done', () => {
    const list: unknown[] = [];
    expect(addToList(list, note('The harbour was empty'))).toBe(true);
    addToList(list, note('Anna walked alone', 'Why alone?'));
    expect(list).toEqual([
      { passage: 'The harbour was empty', note: 'Say more', created: '2026-10-14', done: false },
      { passage: 'Anna walked alone', note: 'Why alone?', created: '2026-10-14', done: false },
    ]);
    expect(Object.keys((list as Array<Record<string, unknown>>)[0] ?? {})).toEqual(['passage', 'note', 'created', 'done']);
  });

  it('are read forgivingly (also as earlier versions kept them, in the scene\'s properties): entries without a passage are skipped, "done" may be written as yes, a date may come as a date', () => {
    const notes = readNotes({
      [REVISION_NOTES_KEY]: [
        { passage: 'one', note: 'first', created: '2026-10-01', done: 'yes' },
        'not a note',
        { note: 'no passage' },
        { passage: 'שלום לך', note: 'בעברית', created: new Date(Date.UTC(2026, 9, 2)), done: false },
        { passage: 'three', note: 7 },
      ],
    });
    expect(notes.map((entry) => [entry.passage, entry.note, entry.created, entry.done, entry.index])).toEqual([
      ['one', 'first', '2026-10-01', true, 0],
      ['שלום לך', 'בעברית', '2026-10-02', false, 3],
      ['three', '7', '', false, 4],
    ]);
    expect(readNotes(null)).toEqual([]);
    expect(readNotes({ [REVISION_NOTES_KEY]: 'nonsense' })).toEqual([]);
  });

  it('are changed and taken out one at a time, found again even when the list moved under them', () => {
    const list: unknown[] = [];
    addToList(list, note('alpha'));
    addToList(list, note('beta', 'B'));
    const [, beta] = readNoteList(list);
    if (!beta) throw new Error('no note');
    // Another device put a note in front meanwhile.
    list.unshift({ passage: 'new', note: '', created: '', done: false, extra: 'kept' });
    expect(findNote(list, beta)).toBe(2);
    expect(changeInList(list, beta, { done: true })).toBe(true);
    expect(changeInList(list, beta, { done: true })).toBe(false); // nothing to change
    expect(changeInList(list, { ...beta }, { note: 'B, again' })).toBe(true);
    expect(list[2]).toEqual({ passage: 'beta', note: 'B, again', created: '2026-10-14', done: true });
    // Its words changed: the old description no longer finds it.
    expect(removeFromList(list, beta)).toBe(false);
    const [first, alpha] = readNoteList(list);
    expect(removeFromList(list, alpha as RevisionNote)).toBe(true);
    expect(list[0]).toEqual({ passage: 'new', note: '', created: '', done: false, extra: 'kept' });
    removeFromList(list, first as RevisionNote);
    removeFromList(list, readNoteList(list)[0] as RevisionNote);
    expect(list).toEqual([]);
  });

  it('keep the exact words that were selected, without the spaces around them', () => {
    expect(tidyPassage('  the harbour\nwas empty \n')).toBe('the harbour\nwas empty');
    expect(tidyPassage('   ')).toBe('');
    expect(tidyPassage('x'.repeat(1200))).toHaveLength(1000);
  });

  it('find their passage in the text after the properties, and only open notes are marked', () => {
    const text = '---\nrevision-notes: [{"passage":"empty"}]\n---\nThe harbour was empty.\nהנמל היה ריק.\n';
    expect(locatePassage(text, 'empty')?.from).toBe(text.indexOf('empty'));
    const marks = passageMarks(text, [note('empty'), note('הנמל היה'), note('gone'), note('was', 'done', '', true)]);
    expect(marks.map((mark) => text.slice(mark.from, mark.to))).toEqual(['empty', 'הנמל היה']);
    expect(marks[0]?.from).toBe(text.indexOf('empty.')); // in the text, not in the properties
  });

  it('read the properties block of a whole note', () => {
    expect(propertiesOf('---\na: 1\nb: 2\n---\nText')).toBe('a: 1\nb: 2');
    expect(propertiesOf('---\n---\nText')).toBe('');
    expect(propertiesOf('Text only')).toBeNull();
  });
});

describe('finding words', () => {
  const english = 'Art and the artist start apart. ART, art; Arthur.';
  it('finds what is typed, with or without capitals', () => {
    expect(words(english, 'art')).toEqual(['Art', 'art', 'art', 'art', 'ART', 'art', 'Art']);
    expect(words(english, 'art', { matchCase: true })).toEqual(['art', 'art', 'art', 'art']);
  });

  it('finds whole words only when asked', () => {
    expect(words(english, 'art', { wholeWords: true })).toEqual(['Art', 'ART', 'art']);
    expect(words('Mr. Smith and Mrs. Smith', 'Mr.', { wholeWords: true })).toEqual(['Mr.']);
  });

  it('treats Hebrew letters as letters: a word with a letter joined to its front is another word', () => {
    const hebrew = 'הבית שלנו. בית קטן, ובית גדול; ביתה.';
    expect(words(hebrew, 'בית')).toHaveLength(4);
    expect(words(hebrew, 'בית', { wholeWords: true })).toEqual(['בית']);
    const at = hebrew.indexOf('בית קטן');
    expect(findInText(hebrew, 'בית', { ...plain, wholeWords: true })[0]?.from).toBe(at);
    // Pointed Hebrew: the vowel marks belong to the word.
    expect(words('שָׁלוֹם שלום', 'שלום', { wholeWords: true })).toEqual(['שלום']);
  });

  it('takes ? for one character and * for any characters, or the rest of a word at an end', () => {
    expect(words('walk walked walking talks', 'walk*', { wildcards: true, wholeWords: true })).toEqual(['walk', 'walked', 'walking']);
    expect(words('the old house, the red house', 'the * house', { wildcards: true })).toEqual(['the old house', 'the red house']);
    expect(words('cat cut cot coat', 'c?t', { wildcards: true, wholeWords: true })).toEqual(['cat', 'cut', 'cot']);
    expect(words('a(b) a.b', 'a(b)', {})).toEqual(['a(b)']); // nothing else is special
    expect(words('a.b axb', 'a.b', { wildcards: true })).toEqual(['a.b']);
    expect(words('one\ntwo', 'one*two', { wildcards: true })).toEqual([]); // a star stays on its line
    expect(patternOf('**', { ...plain, wildcards: true })).toBeNull();
    expect(patternOf('', plain)).toBeNull();
  });

  it('shows the line around a place, cut where it is long', () => {
    const text = `First line.\n${'x'.repeat(50)} the word ${'y'.repeat(50)}\nLast.`;
    const at = text.indexOf('word');
    const context = contextOf(text, at, at + 4);
    expect(context.match).toBe('word');
    expect(context.line).toBe(2);
    expect(context.before.endsWith(' the ')).toBe(true);
    expect(context.cutBefore && context.cutAfter).toBe(true);
    expect(context.before.includes('\n') || context.after.includes('\n')).toBe(false);
  });
});

describe('changing a scene\'s text in exact places', () => {
  const body = 'Anna walked. Anna sang.\n';
  const at = (n: number): number => body.split('Anna', n + 1).slice(0, n + 1).join('Anna').length;

  it('makes only the changes it is given, all at once', () => {
    expect(applyBodyEdits(body, [{ from: at(1), to: at(1) + 4, expect: 'Anna', insert: 'Dina' }])).toBe('Anna walked. Dina sang.\n');
    expect(applyBodyEdits(body, [
      { from: at(1), to: at(1) + 4, expect: 'Anna', insert: 'דינה' },
      { from: 0, to: 4, expect: 'Anna', insert: 'Dina' },
    ])).toBe('Dina walked. דינה sang.\n');
  });

  it('makes none when one does not find its words, when two overlap, or when there are none', () => {
    expect(applyBodyEdits(body, [{ from: 1, to: 5, expect: 'Anna', insert: 'x' }])).toBeNull();
    expect(editsFit(body, [{ from: 0, to: 4, expect: 'Anna', insert: 'x' }, { from: 2, to: 6, expect: 'na w', insert: 'y' }])).toBe(false);
    expect(editsFit(body, [])).toBe(false);
    expect(editsFit(body, [{ from: 20, to: 99, expect: '', insert: '' }])).toBe(false);
  });

  it('keeps the properties exactly as they are, and refuses a text that changed since the search', () => {
    const noteText = `---\nstatus: "Draft"\n---\n${body}`;
    const edits = [{ from: 0, to: 4, expect: 'Anna', insert: 'Dina' }];
    expect(applyToNote(noteText, body, edits)).toBe('---\nstatus: "Draft"\n---\nDina walked. Anna sang.\n');
    expect(applyToNote(noteText.replace('sang', 'sings'), body, edits)).toBeNull();
    // The properties may have changed meanwhile (a note was added): that is no change of the text.
    expect(applyToNote(`---\nstatus: "Done"\n---\n${body}`, body, edits)).toBe('---\nstatus: "Done"\n---\nDina walked. Anna sang.\n');
    // A change can never make the text start a properties block of its own.
    expect(applyToNote('x\nrest\n', 'x\nrest\n', [{ from: 0, to: 1, expect: 'x', insert: '---' }])).toBe('---\nrest\n');
    expect(applyToNote('x\na\n---\nrest', 'x\na\n---\nrest', [{ from: 0, to: 1, expect: 'x', insert: '---' }])).toBeNull();
    expect(splitBody(noteText)).toEqual({ head: '---\nstatus: "Draft"\n---\n', body });
  });
});

describe('where a name stands, for Rename everywhere', () => {
  it('finds the name as a whole word, as it is written, and not in the targets of links', () => {
    const text = 'Mara came. MARA shouted. Tamara stayed. [[Mara]] and [[Mara|Mara the keeper]] and [[World/Mara#Youth|her]].';
    const found = nameOccurrences(text, 'Mara');
    expect(found.map((match) => text.slice(Math.max(0, match.from - 1), match.to + 2))).toEqual(['Mara c', '|Mara t']);
    expect(linkTargets('[[Mara]] ![[pic.png|200]]').map((range) => range)).toEqual([{ from: 2, to: 6 }, { from: 12, to: 19 }]);
  });

  it('also finds a Hebrew name behind joined letters, marked so that it starts unticked', () => {
    const text = 'מרה הלכה. ומרה שרה. למרה אין. תמרה נשארה.';
    const found = nameOccurrences(text, 'מרה');
    expect(found.map((match) => [match.text, match.joined])).toEqual([
      ['מרה', false],
      ['מרה', true],
      ['מרה', true],
    ]);
    // Only the name is changed; the joined letter stays.
    expect(text.slice(found[1]?.from ?? 0, found[1]?.to ?? 0)).toBe('מרה');
    expect(text.charAt((found[1]?.from ?? 0) - 1)).toBe('ו');
  });

  it('turns down a name that cannot be a note\'s name', () => {
    expect(newNameProblem('Mara', 'Dina')).toBeNull();
    expect(newNameProblem('Mara', 'Mara')).not.toBeNull();
    expect(newNameProblem('Mara', '  ')).not.toBeNull();
    expect(newNameProblem('Mara', 'Di/na')).not.toBeNull();
    expect(newNameProblem('Mara', 'דינה')).toBeNull();
  });
});

describe('withCaseOf: a replacement takes the capitals of the words it replaces', () => {
  it('capitalises after a capital first letter, upper-cases after ALL CAPS, and leaves the rest as typed', () => {
    expect(withCaseOf('Gulls', 'seabirds')).toBe('Seabirds');
    expect(withCaseOf('GULLS', 'seabirds')).toBe('SEABIRDS');
    expect(withCaseOf('gulls', 'seabirds')).toBe('seabirds');
    expect(withCaseOf('gulls', 'Seabirds')).toBe('Seabirds');
    expect(withCaseOf('G', 'seabirds')).toBe('Seabirds');
    expect(withCaseOf('gULLS', 'seabirds')).toBe('seabirds');
    expect(withCaseOf('Gulls', '"sea" birds')).toBe('"Sea" birds');
    expect(withCaseOf('Gulls', '')).toBe('');
  });

  it('leaves words without capitals (Hebrew) as they are, on either side', () => {
    expect(withCaseOf('שחפים', 'seabirds')).toBe('seabirds');
    expect(withCaseOf('Gulls', 'שחפים')).toBe('שחפים');
    expect(withCaseOf('GULLS', 'שחפים')).toBe('שחפים');
    expect(withCaseOf('Gulls', 'שחפים and gulls')).toBe('שחפים and gulls');
  });
});

describe('findWithJoined: whole words, and Hebrew words with letters joined to their front', () => {
  const whole = { matchCase: false, wholeWords: true, wildcards: false };

  it('finds the word itself, and a joined form marked as joined', () => {
    const text = 'מגדלור. המגדלור והמגדלור, מגדלורים.';
    const found = findWithJoined(text, 'מגדלור', whole);
    expect(found.map((match) => [text.slice(match.from, match.to), match.joined])).toEqual([
      ['מגדלור', false],
      ['מגדלור', true],
      ['מגדלור', true],
    ]);
    expect(found[1]?.from).toBe(text.indexOf('המגדלור') + 1);
  });

  it('finds no joined forms without whole words (they are found anyway), nor for English words', () => {
    expect(findWithJoined('המגדלור', 'מגדלור', { ...whole, wholeWords: false }).map((match) => match.joined)).toEqual([false]);
    expect(findWithJoined('the art of start', 'art', whole).map((match) => match.from)).toEqual([4]);
  });

  it('is what Rename everywhere finds too, without link targets', () => {
    expect(nameOccurrences('המגדלור [[מגדלור]]', 'מגדלור').map((match) => match.joined)).toEqual([true]);
  });
});
