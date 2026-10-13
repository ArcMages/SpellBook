import { describe, expect, it } from 'vitest';
import { PROJECT_FOLDERS } from '../../src/core/projectLayout';
import {
  EVENT_MARKER_KEY,
  EVENT_MARKER_VALUE,
  TIMELINE_FOLDER,
  applyFrontmatterPatch,
  createSceneResolver,
  describeEventProblem,
  dragDates,
  isEmptyPatch,
  isEventPath,
  linkTarget,
  makeScale,
  newEventFrontmatter,
  readEvent,
  readSceneEvent,
  readTimeline,
  redateEventPatch,
} from '../../src/core/timeline';
import type { EventProblem, StoryDate } from '../../src/core/timeline';
import { HEBREW, POINTED_AS_STORED, POINTED_AS_TYPED, date, deepFreeze } from './helpers';

describe('readEvent', () => {
  it('reads the date, end, timelines, scenes and tags of an event note', () => {
    const event = readEvent('Timeline/The Fire.md', {
      spellbook: 'event',
      date: '1923-04-12',
      end: '1923-04-20',
      timelines: ['Main plot', 'Backstory'],
      scenes: ['[[Opening]]', 'Manuscript/The Letter.md'],
      tags: ['war', 'home'],
    });
    expect(event).toEqual({
      path: 'Timeline/The Fire.md',
      title: 'The Fire',
      source: 'event',
      start: date(1923, 4, 12),
      end: date(1923, 4, 20),
      timelines: ['Main plot', 'Backstory'],
      scenes: ['Opening', 'Manuscript/The Letter.md'],
      entities: [],
      tags: ['war', 'home'],
      problems: [],
    });
  });

  it('takes the title from the file name, without the extension and nothing else changed', () => {
    expect(readEvent('Timeline/Mr. Smith arrives.md', {}).title).toBe('Mr. Smith arrives');
    expect(readEvent('Timeline/1914/The War.md', {}).title).toBe('The War');
    expect(readEvent('Timeline/  spaced  out .md', {}).title).toBe('  spaced  out ');
    expect(readEvent(`Timeline/${HEBREW.battle}.md`, {}).title).toBe(HEBREW.battle);
    expect(readEvent(`Timeline/${HEBREW.pointed}.md`, {}).title).toBe(HEBREW.pointed);
    expect(readEvent(`Timeline/${HEBREW.mixed}.md`, {}).title).toBe(HEBREW.mixed);
    // Neither spelling of a pointed word is rewritten into the other.
    expect(readEvent(`Timeline/${POINTED_AS_TYPED}.md`, {}).title).toBe(POINTED_AS_TYPED);
    expect(readEvent(`Timeline/${POINTED_AS_STORED}.md`, {}).title).toBe(POINTED_AS_STORED);
  });

  it('passes Hebrew timelines, scenes and tags through untouched', () => {
    const event = readEvent(`Timeline/${HEBREW.battle}.md`, {
      date: 1923,
      timelines: [HEBREW.mainPlot, HEBREW.backstory],
      scenes: [`[[${HEBREW.opening}]]`, `[[Manuscript/${HEBREW.pointed}|${HEBREW.mixed}]]`],
      tags: [HEBREW.tag, `#${HEBREW.opening}`],
    });
    expect(event.start).toEqual(date(1923));
    expect(event.timelines).toEqual([HEBREW.mainPlot, HEBREW.backstory]);
    expect(event.scenes).toEqual([HEBREW.opening, `Manuscript/${HEBREW.pointed}`]);
    expect(event.tags).toEqual([HEBREW.tag, HEBREW.opening]);
  });

  it('reads a date of each precision, and a date and time', () => {
    expect(readEvent('Timeline/A.md', { date: 1923 }).start).toEqual(date(1923));
    expect(readEvent('Timeline/A.md', { date: '1923-04' }).start).toEqual(date(1923, 4));
    expect(readEvent('Timeline/A.md', { date: '1923-04-12T08:00:00Z' }).start).toEqual(date(1923, 4, 12));
  });

  it('leaves an event without a date undated, and says nothing is wrong with it', () => {
    for (const properties of [{}, { date: null }, { date: '' }, { date: '   ' }, { timelines: ['Main plot'] }]) {
      const event = readEvent('Timeline/Someday.md', properties);
      expect(event.start).toBeNull();
      expect(event.end).toBeNull();
      expect(event.problems).toEqual([]);
    }
  });

  it('leaves an event with an unreadable date undated, and reports it', () => {
    for (const value of ['next spring', '1923-13-01', '1900-02-29', 0, 10000, true, ['1923'], { year: 1923 }, 'אביב']) {
      const event = readEvent('Timeline/Odd.md', { date: value, timelines: ['Main plot'] });
      expect(event.start, String(value)).toBeNull();
      expect(event.problems, String(value)).toEqual(['date-unreadable']);
      expect(event.timelines).toEqual(['Main plot']); // the rest is still understood
    }
  });

  it('makes a span of an event whose end is later than its date', () => {
    expect(readEvent('Timeline/War.md', { date: 1914, end: 1918 }).end).toEqual(date(1918));
    expect(readEvent('Timeline/Summer.md', { date: '1923-06', end: '1923-09' }).end).toEqual(date(1923, 9));
    // Mixed precision: each date stands at the first day of its period.
    expect(readEvent('Timeline/Year.md', { date: 1923, end: '1923-06' }).end).toEqual(date(1923, 6));
  });

  it('reads an end that is earlier than the date as a point at the start, and reports it', () => {
    const backwards = readEvent('Timeline/Backwards.md', { date: '1923-04-12', end: '1923-04-01' });
    expect(backwards.start).toEqual(date(1923, 4, 12));
    expect(backwards.end).toBeNull();
    expect(backwards.problems).toEqual(['end-before-start']);

    expect(readEvent('Timeline/Years.md', { date: 1918, end: 1914 }).problems).toEqual(['end-before-start']);
    // "1923-04" stands at 1 April, which is before the 12th.
    const mixed = readEvent('Timeline/Mixed.md', { date: '1923-04-12', end: '1923-04' });
    expect(mixed.end).toBeNull();
    expect(mixed.problems).toEqual(['end-before-start']);
  });

  it('reads an end on the same day as the date as a plain point', () => {
    const event = readEvent('Timeline/Day.md', { date: '1923-04-12', end: '1923-04-12' });
    expect(event.end).toBeNull();
    expect(event.problems).toEqual([]);
    expect(readEvent('Timeline/Year.md', { date: 1923, end: '1923-01-01' }).problems).toEqual([]);
  });

  it('reports an end that cannot be read, or that has no date to go with', () => {
    const unreadable = readEvent('Timeline/A.md', { date: 1923, end: 'later' });
    expect(unreadable.start).toEqual(date(1923));
    expect(unreadable.end).toBeNull();
    expect(unreadable.problems).toEqual(['end-unreadable']);

    expect(readEvent('Timeline/B.md', { end: 1925 }).problems).toEqual(['end-without-date']);
    expect(readEvent('Timeline/C.md', { date: 'soon', end: 'later' }).problems).toEqual([
      'date-unreadable',
      'end-unreadable',
    ]);
  });

  it('reads one timeline written as plain text as a list of one', () => {
    expect(readEvent('Timeline/A.md', { timelines: 'Main plot' }).timelines).toEqual(['Main plot']);
    expect(readEvent('Timeline/A.md', { timelines: HEBREW.mainPlot }).timelines).toEqual([HEBREW.mainPlot]);
  });

  it('keeps each timeline once, whatever its capitals, and skips what is not a name', () => {
    const event = readEvent('Timeline/A.md', {
      timelines: ['Main plot', 'main PLOT', '  Main plot ', '', null, 1923, { name: 'x' }, ['nested'], 'Backstory'],
    });
    expect(event.timelines).toEqual(['Main plot', '1923', 'Backstory']);
    expect(readEvent('Timeline/A.md', { timelines: null }).timelines).toEqual([]);
    expect(readEvent('Timeline/A.md', { timelines: { a: 1 } }).timelines).toEqual([]);
  });

  it('reports entries that are neither names nor links, and says nothing about empty ones', () => {
    const problems = (properties: Record<string, unknown>): readonly EventProblem[] =>
      readEvent('Timeline/A.md', { date: 1923, ...properties }).problems;
    expect(problems({ timelines: ['Main plot', { name: 'x' }] })).toEqual(['timelines-unreadable']);
    expect(problems({ timelines: { a: 1 } })).toEqual(['timelines-unreadable']);
    expect(problems({ timelines: [['nested']] })).toEqual(['timelines-unreadable']);
    expect(problems({ timelines: true })).toEqual(['timelines-unreadable']);
    expect(problems({ scenes: ['[[Opening]]', { a: 1 }] })).toEqual(['scenes-unreadable']);
    expect(problems({ scenes: false })).toEqual(['scenes-unreadable']);
    expect(problems({ timelines: [{}], scenes: [{}] })).toEqual(['timelines-unreadable', 'scenes-unreadable']);
    // An empty entry, an empty list and a missing property are nothing to report.
    expect(problems({ timelines: ['Main plot', '', null], scenes: ['[[Opening]]', '', null, '[[]]'] })).toEqual([]);
    expect(problems({ timelines: [], scenes: [] })).toEqual([]);
    expect(problems({ timelines: null, scenes: undefined })).toEqual([]);
    expect(problems({ scenes: [['Opening']] })).toEqual([]); // a wikilink without quotes is fine
  });

  it('reads scene links in every way they get written', () => {
    const links = (scenes: unknown): readonly string[] => readEvent('Timeline/A.md', { scenes }).scenes;
    expect(links(['[[Opening]]', '[[Manuscript/The Letter]]'])).toEqual(['Opening', 'Manuscript/The Letter']);
    expect(links('[[Opening]]')).toEqual(['Opening']); // one link, not in a list
    expect(links(['[[Opening|how it starts]]', '[[The Letter#Part two]]', '![[Embedded]]'])).toEqual([
      'Opening',
      'The Letter',
      'Embedded',
    ]);
    expect(links(['Manuscript/Opening.md', 'Opening'])).toEqual(['Manuscript/Opening.md', 'Opening']);
    expect(links(['[the start](Manuscript/The%20Letter.md)', '[x](<Manuscript/Opening.md>)'])).toEqual([
      'Manuscript/The Letter.md',
      'Manuscript/Opening.md',
    ]);
    // YAML reads [[Opening]] without quotes as a list inside a list.
    expect(links([['Opening']])).toEqual(['Opening']);
    expect(links([[['Opening']], [['The Letter']]])).toEqual(['Opening', 'The Letter']);
    expect(links(['[[Opening]]', '[[Opening]]', '[[]]', '', null, 7, { a: 1 }])).toEqual(['Opening', '7']);
    expect(links(undefined)).toEqual([]);
  });

  it("reads Obsidian's tags as a list or as one text", () => {
    const tags = (value: unknown): readonly string[] => readEvent('Timeline/A.md', { tags: value }).tags;
    expect(tags(['war', '#home', ' peace '])).toEqual(['war', 'home', 'peace']);
    expect(tags('war, home peace')).toEqual(['war', 'home', 'peace']);
    expect(tags(['war', 'War', 'WAR', 'place/paris'])).toEqual(['war', 'place/paris']);
    expect(tags([HEBREW.tag, 1923, null, { a: 1 }])).toEqual([HEBREW.tag, '1923']);
    expect(tags(undefined)).toEqual([]);
    expect(tags(42)).toEqual([]);
  });

  it('never throws, whatever the properties are', () => {
    const oddNotes: unknown[] = [undefined, null, 0, 'text', true, [], [1, 2], () => 1, { date: () => 1 }];
    const oddValues: unknown[] = [undefined, null, 0, -1, 1e21, Number.NaN, '', 'x', true, [], [[[[[['deep']]]]]], {}, { a: { b: 1 } }, () => 1, Symbol('s')];
    for (const note of oddNotes) {
      const event = readEvent('Timeline/Odd.md', note);
      expect(event.title).toBe('Odd');
      expect(event.start).toBeNull();
    }
    for (const value of oddValues) {
      const properties = { date: value, end: value, timelines: value, scenes: value, tags: value };
      expect(() => readEvent('Timeline/Odd.md', properties)).not.toThrow();
      expect(() => readSceneEvent('Manuscript/Odd.md', properties)).not.toThrow();
    }
  });

  it('does not change the properties it reads', () => {
    const properties = deepFreeze({
      date: '1923-04-12',
      end: '1923-04-20',
      timelines: ['Main plot', 'main plot'],
      scenes: [['Opening']],
      tags: ['#war'],
    });
    expect(() => readEvent('Timeline/A.md', properties)).not.toThrow();
  });
});

describe('readSceneEvent', () => {
  it('makes an event of a scene that has a date', () => {
    const event = readSceneEvent('Manuscript/Opening.md', {
      synopsis: 'It begins.',
      status: 'First draft',
      date: '1923-04-12',
      end: '1923-04-13',
      timelines: ['Main plot'],
    });
    expect(event).toMatchObject({
      path: 'Manuscript/Opening.md',
      title: 'Opening',
      source: 'scene',
      start: date(1923, 4, 12),
      end: date(1923, 4, 13),
      timelines: ['Main plot'],
      problems: [],
    });
  });

  it('is not an event without a date', () => {
    expect(readSceneEvent('Manuscript/Opening.md', { synopsis: 'It begins.' })).toBeNull();
    expect(readSceneEvent('Manuscript/Opening.md', { date: null, timelines: ['Main plot'] })).toBeNull();
    expect(readSceneEvent('Manuscript/Opening.md', { date: '' })).toBeNull();
    expect(readSceneEvent('Manuscript/Opening.md', undefined)).toBeNull();
    expect(readSceneEvent('Manuscript/Opening.md', 'not properties')).toBeNull();
  });

  it('shows a scene whose date cannot be read as undated, so it can be mended', () => {
    const event = readSceneEvent(`Manuscript/${HEBREW.opening}.md`, { date: 'spring' });
    expect(event?.title).toBe(HEBREW.opening);
    expect(event?.start).toBeNull();
    expect(event?.problems).toEqual(['date-unreadable']);
  });
});

describe('readTimeline', () => {
  const eventNotes = [
    { path: 'Timeline/Armistice.md', frontmatter: { date: '1918-11-11' } },
    { path: 'Timeline/Someday.md', frontmatter: {} },
    { path: 'Timeline/War.md', frontmatter: { date: 1914, end: 1918 } },
    { path: 'Timeline/Broken.md', frontmatter: { date: 'who knows' } },
    { path: 'Timeline/New year.md', frontmatter: { date: '1914-01-01' } },
    { path: 'Timeline/No properties.md', frontmatter: undefined },
  ];
  const sceneNotes = [
    { path: 'Manuscript/Opening.md', frontmatter: { date: '1914-08' } },
    { path: 'Manuscript/Undated scene.md', frontmatter: { synopsis: 'no date' } },
    { path: 'Manuscript/Vague scene.md', frontmatter: { date: 'one day' } },
  ];

  it('sorts the dated events, earliest first, and lists the undated ones as they came', () => {
    const model = readTimeline(eventNotes, sceneNotes);
    expect(model.dated.map((event) => event.title)).toEqual(['War', 'New year', 'Opening', 'Armistice']);
    expect(model.undated.map((event) => event.title)).toEqual(['Someday', 'Broken', 'No properties', 'Vague scene']);
  });

  it('counts a dated scene as an event and skips a scene without a date', () => {
    const model = readTimeline(eventNotes, sceneNotes);
    expect(model.dated.find((event) => event.title === 'Opening')?.source).toBe('scene');
    const everyTitle = [...model.dated, ...model.undated].map((event) => event.title);
    expect(everyTitle).not.toContain('Undated scene');
  });

  it('keeps events of the same date in the order they came', () => {
    const notes = ['c', 'a', 'b'].map((name) => ({ path: `Timeline/${name}.md`, frontmatter: { date: '1923-04-12' } }));
    expect(readTimeline(notes).dated.map((event) => event.title)).toEqual(['c', 'a', 'b']);
  });

  it('works with no notes at all', () => {
    expect(readTimeline([])).toEqual({ dated: [], undated: [] });
  });
});

describe('small helpers', () => {
  it('knows which notes are event notes', () => {
    expect(TIMELINE_FOLDER).toBe('Timeline');
    expect(PROJECT_FOLDERS).toContain(TIMELINE_FOLDER);
    expect(isEventPath('Timeline/The Fire.md')).toBe(true);
    expect(isEventPath(`Timeline/1914/${HEBREW.battle}.md`)).toBe(true);
    expect(isEventPath('Timeline/map.png')).toBe(false);
    expect(isEventPath('Timeline')).toBe(false);
    expect(isEventPath('Manuscript/Opening.md')).toBe(false);
    expect(isEventPath('Timelines/The Fire.md')).toBe(false);
  });

  it('explains every problem in a sentence', () => {
    const problems: EventProblem[] = [
      'date-unreadable',
      'end-unreadable',
      'end-before-start',
      'end-without-date',
      'timelines-unreadable',
      'scenes-unreadable',
    ];
    const sentences = problems.map((problem) => describeEventProblem(problem));
    for (const sentence of sentences) expect(sentence).toMatch(/^[A-Z].+\.$/);
    expect(new Set(sentences).size).toBe(problems.length);
  });

  it('finds what a link points at', () => {
    expect(linkTarget('[[Opening]]')).toBe('Opening');
    expect(linkTarget('  [[Manuscript/Opening|start]]  ')).toBe('Manuscript/Opening');
    expect(linkTarget('[[Opening#^block]]')).toBe('Opening');
    expect(linkTarget('Plain name')).toBe('Plain name');
    expect(linkTarget('C# for writers')).toBe('C# for writers'); // not a link: nothing is cut off
    expect(linkTarget(`[[${HEBREW.mixed}]]`)).toBe(HEBREW.mixed);
    expect(linkTarget('[x](a%zz.md)')).toBe('a%zz.md'); // a broken escape is left as written
    expect(linkTarget('[[]]')).toBeNull();
    expect(linkTarget('[[#Heading only]]')).toBeNull();
    expect(linkTarget('   ')).toBeNull();
  });
});

describe('createSceneResolver', () => {
  const scenes = [
    'Manuscript/Opening.md',
    'Manuscript/Part two/The Letter.md',
    `Manuscript/${HEBREW.opening}.md`,
    'Manuscript/Part two/Opening.md',
  ];
  const resolve = createSceneResolver(scenes);

  it('finds a scene by its name, the end of its path, or a longer path', () => {
    expect(resolve('[[The Letter]]')).toBe('Manuscript/Part two/The Letter.md');
    expect(resolve('[[Part two/The Letter]]')).toBe('Manuscript/Part two/The Letter.md');
    expect(resolve('Manuscript/Part two/The Letter.md')).toBe('Manuscript/Part two/The Letter.md');
    expect(resolve('[[My Novel/Manuscript/Part two/The Letter]]')).toBe('Manuscript/Part two/The Letter.md');
    expect(resolve('./Manuscript//Opening.md')).toBe('Manuscript/Opening.md');
  });

  it('does not mind capitals, ".md" or an alias', () => {
    expect(resolve('[[the letter]]')).toBe('Manuscript/Part two/The Letter.md');
    expect(resolve('[[The Letter.md|that letter]]')).toBe('Manuscript/Part two/The Letter.md');
    expect(resolve('[[THE LETTER.MD]]')).toBe('Manuscript/Part two/The Letter.md');
  });

  it('gives the first scene when two share a name, and the exact one when the path says which', () => {
    expect(resolve('[[Opening]]')).toBe('Manuscript/Opening.md');
    expect(resolve('[[Part two/Opening]]')).toBe('Manuscript/Part two/Opening.md');
  });

  it('finds Hebrew scenes, in whichever Unicode form the link was typed', () => {
    expect(resolve(`[[${HEBREW.opening}]]`)).toBe(`Manuscript/${HEBREW.opening}.md`);
    expect(POINTED_AS_TYPED).not.toBe(POINTED_AS_STORED);
    const pointed = createSceneResolver([`Manuscript/${POINTED_AS_STORED}.md`]);
    expect(pointed(`[[${POINTED_AS_TYPED}]]`)).toBe(`Manuscript/${POINTED_AS_STORED}.md`);
    // The same holds for accents: "e" followed by an accent mark, as macOS stores it, against one accented letter.
    const twoMarks = `Cafe${String.fromCodePoint(0x301)}`;
    const oneLetter = `Caf${String.fromCodePoint(0xe9)}`;
    expect(twoMarks).not.toBe(oneLetter);
    expect(createSceneResolver([`Manuscript/${twoMarks}.md`])(`[[${oneLetter}]]`)).toBe(`Manuscript/${twoMarks}.md`);
  });

  it('gives null for a link to nothing in the manuscript', () => {
    expect(resolve('[[Nowhere]]')).toBeNull();
    expect(resolve('[[Elsewhere/Opening]]')).toBeNull(); // another folder's Opening is another note
    expect(resolve('[[../Opening]]')).toBeNull();
    expect(resolve('')).toBeNull();
    expect(resolve('[[]]')).toBeNull();
    expect(createSceneResolver([])('[[Opening]]')).toBeNull();
  });
});

describe('newEventFrontmatter', () => {
  it('writes the event mark, the date and the timelines, in that order', () => {
    const made = newEventFrontmatter(date(1923, 4, 12), ['Main plot']);
    expect(made).toEqual({ spellbook: 'event', date: '1923-04-12', timelines: ['Main plot'] });
    expect(Object.keys(made)).toEqual(['spellbook', 'date', 'timelines']);
    expect(made[EVENT_MARKER_KEY]).toBe(EVENT_MARKER_VALUE);
  });

  it('writes a year as a number and a month as text', () => {
    expect(newEventFrontmatter(date(1923), [])['date']).toBe(1923);
    expect(newEventFrontmatter(date(1923, 4), [])['date']).toBe('1923-04');
  });

  it('leaves the date empty for an undated event', () => {
    expect(newEventFrontmatter(null)).toEqual({ spellbook: 'event', date: null, timelines: [] });
  });

  it('keeps Hebrew lane names as written and drops empty and repeated ones', () => {
    const made = newEventFrontmatter(date(1923), [HEBREW.mainPlot, '', 'Backstory', 'backstory', HEBREW.mainPlot]);
    expect(made['timelines']).toEqual([HEBREW.mainPlot, 'Backstory']);
  });

  it('is read back as the event it describes', () => {
    const event = readEvent('Timeline/New.md', newEventFrontmatter(date(1923, 4), [HEBREW.mainPlot]));
    expect(event.start).toEqual(date(1923, 4));
    expect(event.timelines).toEqual([HEBREW.mainPlot]);
    expect(event.problems).toEqual([]);
  });
});

describe('redateEventPatch', () => {
  it('names only the date of a single-date event', () => {
    const properties = deepFreeze({ spellbook: 'event', date: '1923-04-12', timelines: ['Main plot'], tags: ['war'] });
    expect(redateEventPatch(properties, date(1923, 5, 1))).toEqual({ date: '1923-05-01' });
  });

  it('is empty when the date does not change', () => {
    const patch = redateEventPatch({ date: '1923-04-12', end: '1923-04-20' }, date(1923, 4, 12));
    expect(patch).toEqual({});
    expect(isEmptyPatch(patch)).toBe(true);
  });

  it('keeps the precision of the event, whatever the target is', () => {
    expect(redateEventPatch({ date: 1923 }, date(1931, 7, 4))).toEqual({ date: 1931 });
    expect(redateEventPatch({ date: '1923-04' }, date(1931, 7, 4))).toEqual({ date: '1931-07' });
    expect(redateEventPatch({ date: '1923-04-12' }, date(1931))).toEqual({ date: '1931-01-01' });
    // A target inside the same year changes nothing for an event dated to the year.
    expect(redateEventPatch({ date: 1923 }, date(1923, 11, 30))).toEqual({});
  });

  it('writes the new date the way the old one was written', () => {
    expect(redateEventPatch({ date: 1923 }, date(1925))).toEqual({ date: 1925 }); // a number stays a number
    expect(redateEventPatch({ date: '1923' }, date(1925))).toEqual({ date: '1925' }); // text stays text
    expect(redateEventPatch({ date: '923' }, date(925))).toEqual({ date: '0925' });
  });

  it('moves a span as a whole, keeping its length', () => {
    expect(redateEventPatch({ date: '1923-04-12', end: '1923-04-20' }, date(1924, 2, 25))).toEqual({
      date: '1924-02-25',
      end: '1924-03-04',
    });
    expect(redateEventPatch({ date: '1923-01', end: '1923-03' }, date(1923, 7))).toEqual({
      date: '1923-07',
      end: '1923-09',
    });
    expect(redateEventPatch({ date: 1914, end: 1918 }, date(1939))).toEqual({ date: 1939, end: 1943 });
  });

  it('leaves out an end that stays where it is', () => {
    // The end is known to the year only, and the start stays within its year.
    expect(redateEventPatch({ date: '1923-04-12', end: 1925 }, date(1923, 9, 1))).toEqual({ date: '1923-09-01' });
  });

  it('leaves alone an end it could not read', () => {
    expect(redateEventPatch({ date: '1923-04-12', end: 'later' }, date(1923, 5, 1))).toEqual({ date: '1923-05-01' });
    expect(redateEventPatch({ date: '1923-04-12', end: '1923-02-30' }, date(1923, 5, 1))).toEqual({ date: '1923-05-01' });
    expect(redateEventPatch({ date: '1923-04-12', end: null }, date(1923, 5, 1))).toEqual({ date: '1923-05-01' });
    expect(redateEventPatch({ date: '1923-04-12', end: ['1923-04-20'] }, date(1923, 5, 1))).toEqual({ date: '1923-05-01' });
  });

  it('takes along an end that makes no span, so a single moment stays one and gains no problem', () => {
    const cases: Array<[Record<string, unknown>, StoryDate, Record<string, unknown>]> = [
      // An end on the very day of the date: no span, and nothing wrong with it.
      [{ date: '1923-04-12', end: '1923-04-12' }, date(1923, 4, 10), { date: '1923-04-10', end: '1923-04-10' }],
      [{ date: '1923-04-12', end: '1923-04-12' }, date(1923, 4, 15), { date: '1923-04-15', end: '1923-04-15' }],
      [{ date: 1923, end: '1923-01-01' }, date(1920), { date: 1920, end: '1920-01-01' }],
      [{ date: 1923, end: 1923 }, date(1925), { date: 1925, end: 1925 }],
      // An end before the date: shown as a single moment, and reported.
      [{ date: '1923-04-12', end: '1923-04-01' }, date(1923, 3, 1), { date: '1923-03-01', end: '1923-02-18' }],
      [{ date: '1923-04-12', end: '1923-01-01' }, date(1923, 5, 1), { date: '1923-05-01', end: '1923-01-20' }],
      [{ date: '1923-04', end: '1923-02' }, date(1924, 1), { date: '1924-01', end: '1923-11' }],
      [{ date: 1923, end: 1920 }, date(1930), { date: 1930, end: 1927 }],
    ];
    for (const [before, target, after] of cases) {
      const told = JSON.stringify(before);
      const was = readEvent('Timeline/A.md', before);
      expect(was.end, told).toBeNull();
      const properties = { ...before };
      applyFrontmatterPatch(properties, redateEventPatch(deepFreeze({ ...before }), target));
      expect(properties, told).toEqual(after);
      // Read again, it is the same event at its new date: no span has appeared, no problem has come or gone.
      const now = readEvent('Timeline/A.md', properties);
      expect(now.end, told).toBeNull();
      expect(now.problems, told).toEqual(was.problems);
    }
  });

  it('moves such an end in its own units when it is known less exactly than the date', () => {
    expect(redateEventPatch({ date: '1923-04-12', end: '1923-04' }, date(1923, 6, 20))).toEqual({
      date: '1923-06-20',
      end: '1923-06',
    });
    expect(redateEventPatch({ date: '1923-04-12', end: 1923 }, date(1925, 6, 20))).toEqual({ date: '1925-06-20', end: 1925 });
    // Within the same month the end has nowhere to go.
    expect(redateEventPatch({ date: '1923-04-12', end: '1923-04' }, date(1923, 4, 20))).toEqual({ date: '1923-04-20' });
  });

  it('stops such an end at the first day of year 1, and keeps a time of day written after it', () => {
    expect(redateEventPatch({ date: '0001-03-01', end: '0001-01-15' }, date(1, 2, 1))).toEqual({
      date: '0001-02-01',
      end: '0001-01-01',
    });
    expect(redateEventPatch({ date: '1923-04-12T10:00', end: '1923-04-12T09:00' }, date(1923, 4, 20))).toEqual({
      date: '1923-04-20T10:00',
      end: '1923-04-20T09:00',
    });
  });

  it('writes a note that reads as the drag showed it, whatever its end was', () => {
    const scale = makeScale(10, 0); // ten pixels a day
    const notes: Array<Record<string, unknown>> = [
      { date: '1923-04-12' },
      { date: '1923-04-12', end: '1923-04-20' },
      { date: '1923-04-12', end: '1923-04-12' },
      { date: '1923-04-12', end: '1923-04-01' },
      { date: 1923, end: '1923-01-01' },
      { date: '1923-04', end: '1923-02' },
    ];
    for (const note of notes) {
      const event = readEvent('Timeline/A.md', note);
      if (event.start === null) throw new Error('The test event has no date.');
      for (const along of [-40_000, -4200, -420, -20, 30, 190, 4200, 40_000]) {
        const told = `${JSON.stringify(note)} dragged ${along}`;
        const shown = dragDates(event.start, event.end, along, scale);
        const properties = { ...note };
        applyFrontmatterPatch(properties, redateEventPatch(properties, shown.start));
        const reread = readEvent('Timeline/A.md', properties);
        expect(reread.start, told).toEqual(shown.start);
        expect(reread.end, told).toEqual(shown.end);
        expect(reread.problems, told).toEqual(event.problems);
      }
    }
  });

  it('gives an undated event the target as it is', () => {
    expect(redateEventPatch({}, date(1923, 4))).toEqual({ date: '1923-04' });
    expect(redateEventPatch({ date: null }, date(1923))).toEqual({ date: 1923 });
    expect(redateEventPatch({ date: 'next spring' }, date(1923, 4, 12))).toEqual({ date: '1923-04-12' });
    expect(redateEventPatch(undefined, date(1923, 4, 12))).toEqual({ date: '1923-04-12' });
  });

  it('keeps a time of day that was written after the date', () => {
    expect(redateEventPatch({ date: '1923-04-12T10:30:00Z', end: '1923-04-14 18:00' }, date(1923, 4, 20))).toEqual({
      date: '1923-04-20T10:30:00Z',
      end: '1923-04-22 18:00',
    });
  });

  it('holds a span back at the last day of 9999 instead of cutting it short', () => {
    expect(redateEventPatch({ date: 9990, end: 9995 }, date(9999))).toEqual({ date: 9994, end: 9999 });
    expect(redateEventPatch({ date: '9999-12-01', end: '9999-12-11' }, date(9999, 12, 31))).toEqual({
      date: '9999-12-21',
      end: '9999-12-31',
    });
  });

  it('reaches year 1 and year 9999', () => {
    expect(redateEventPatch({ date: '1923-04-12' }, date(1, 1, 1))).toEqual({ date: '0001-01-01' });
    expect(redateEventPatch({ date: '1923-04-12' }, date(9999, 12, 31))).toEqual({ date: '9999-12-31' });
    expect(redateEventPatch({ date: 1923 }, date(1))).toEqual({ date: 1 });
  });

  it('applied to a note, changes the date and nothing else', () => {
    const properties: Record<string, unknown> = {
      spellbook: 'event',
      date: '1923-04-12',
      end: '1923-04-20',
      timelines: [HEBREW.mainPlot],
      scenes: ['[[Opening]]'],
      mood: { colour: 'grey' }, // a property this plugin knows nothing about
    };
    const timelines = properties['timelines'];
    const mood = properties['mood'];
    applyFrontmatterPatch(properties, redateEventPatch(properties, date(1923, 5, 12)));
    expect(properties).toEqual({
      spellbook: 'event',
      date: '1923-05-12',
      end: '1923-05-20',
      timelines: [HEBREW.mainPlot],
      scenes: ['[[Opening]]'],
      mood: { colour: 'grey' },
    });
    expect(Object.keys(properties)).toEqual(['spellbook', 'date', 'end', 'timelines', 'scenes', 'mood']);
    expect(properties['timelines']).toBe(timelines);
    expect(properties['mood']).toBe(mood);
  });
});
