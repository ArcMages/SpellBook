import { describe, expect, it } from 'vitest';
import {
  DUE_MARK,
  monthGrid,
  parseMarks,
  parseTodo,
  summariseDays,
  summariseMonth,
  tintLevel,
  tintScale,
} from '../../src/core/planner';
import type { DaySummary, DayWords, DayWordsSource } from '../../src/core/planner';

// Hebrew: "send chapter one to the editor", "deadline".
const SEND_CHAPTER = 'לשלוח את פרק אחד לעורכת';
const DEADLINE = 'מועד אחרון';

const NO_WORDS: ReadonlyMap<string, DayWords> = new Map();
const NO_TODO = parseTodo('');
const NO_MARKS = parseMarks(undefined).marks;

const words = (entries: Record<string, [number, number]>): Map<string, DayWords> =>
  new Map(Object.entries(entries).map(([date, [manuscript, all]]) => [date, { manuscript, all }]));

describe('tintScale', () => {
  it('is 0 when no day has words', () => {
    expect(tintScale([])).toBe(0);
    expect(tintScale([0, 0, 0])).toBe(0);
    expect(tintScale([0, -50, Number.NaN, Number.NEGATIVE_INFINITY])).toBe(0);
  });

  it('is the writing day nine tenths of the way up the list', () => {
    expect(tintScale([700])).toBe(700);
    expect(tintScale([100, 200, 300])).toBe(200);
    expect(tintScale([10, 20, 30, 40, 50, 60, 70, 80, 90, 100])).toBe(90);
    expect(tintScale(Array.from({ length: 11 }, (_, i) => (i + 1) * 10))).toBe(100);
    expect(tintScale(Array.from({ length: 20 }, (_, i) => (i + 1) * 10))).toBe(180);
    expect(tintScale(Array.from({ length: 21 }, (_, i) => (i + 1) * 10))).toBe(190);
    expect(tintScale(Array.from({ length: 30 }, (_, i) => (i + 1) * 10))).toBe(270);
    expect(tintScale(Array.from({ length: 31 }, (_, i) => (i + 1) * 10))).toBe(280);
    // order does not matter
    expect(tintScale([100, 10, 90, 20, 80, 30, 70, 40, 60, 50])).toBe(90);
  });

  it('ignores days without words, and days that lost words', () => {
    expect(tintScale([0, 0, 500, 0, -300, 0])).toBe(500);
    expect(tintScale([0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 0, 0, -1, Number.NaN, Number.POSITIVE_INFINITY])).toBe(90);
  });

  it('is the bigger day when only one or two days have words: two days cannot show which is the unusual one', () => {
    expect(tintScale([700])).toBe(700);
    expect(tintScale([10, 5000])).toBe(5000);
    expect(tintScale([5000, 10])).toBe(5000);
    expect(tintScale([300, 20000])).toBe(20000);
    expect(tintScale([640, 640])).toBe(640);
    // days without words do not count as writing days
    expect(tintScale([0, 10, 0, -40, 5000, 0, Number.NaN])).toBe(5000);
    // so a ten-word day beside a five-thousand-word day is drawn faint, not at full strength
    expect([tintLevel(10, tintScale([10, 5000])), tintLevel(5000, tintScale([10, 5000]))]).toEqual([1, 4]);
    expect([tintLevel(3000, tintScale([3000, 5000])), tintLevel(5000, tintScale([3000, 5000]))]).toEqual([3, 4]);
  });

  it('is never set by the single biggest day, once there are three writing days', () => {
    expect(tintScale([300, 320, 20000])).toBe(320);
    expect(tintScale([50, 800, 1200])).toBe(800);
    expect(tintScale([480, 490, 500, 510, 520, 20000])).toBe(520);
    const month = [400, 450, 500, 520, 480, 510, 530, 470, 490, 505, 495, 515, 485, 20000];
    expect(tintScale(month)).toBe(520);
    for (let count = 2; count <= 42; count++) {
      const days = Array.from({ length: count }, (_, i) => 100 + i);
      expect(tintScale([...days, 1_000_000]), `${count} days`).toBeLessThan(1_000_000);
    }
  });
});

describe('tintLevel', () => {
  it('is 0 for no writing, or for a day that lost words', () => {
    expect(tintLevel(0, 1000)).toBe(0);
    expect(tintLevel(-200, 1000)).toBe(0);
    expect(tintLevel(Number.NaN, 1000)).toBe(0);
    expect(tintLevel(0, 0)).toBe(0);
  });

  it('is at least 1 for any writing at all', () => {
    expect(tintLevel(1, 1000)).toBe(1);
    expect(tintLevel(1, 1_000_000)).toBe(1);
    expect(tintLevel(0.5, 1000)).toBe(1);
  });

  it('steps up at a quarter, a half and three quarters of the scale', () => {
    expect(tintLevel(250, 1000)).toBe(1);
    expect(tintLevel(251, 1000)).toBe(2);
    expect(tintLevel(500, 1000)).toBe(2);
    expect(tintLevel(501, 1000)).toBe(3);
    expect(tintLevel(750, 1000)).toBe(3);
    expect(tintLevel(751, 1000)).toBe(4);
    expect(tintLevel(1000, 1000)).toBe(4);
    // odd scales land on whole steps too
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((count) => tintLevel(count, 12))).toEqual([1, 1, 1, 2, 2, 2, 3, 3, 3, 4, 4, 4]);
    expect([1, 2, 3, 4, 5, 6, 7].map((count) => tintLevel(count, 7))).toEqual([1, 2, 2, 3, 3, 4, 4]);
  });

  it('never goes above 4, however far a day is beyond the scale', () => {
    expect(tintLevel(20000, 530)).toBe(4);
    expect(tintLevel(Number.POSITIVE_INFINITY, 530)).toBe(4);
    expect(tintLevel(Number.MAX_SAFE_INTEGER, 1)).toBe(4);
  });

  it('gives a day with words full strength when there is no scale to measure it against', () => {
    expect(tintLevel(10, 0)).toBe(4);
    expect(tintLevel(10, Number.NaN)).toBe(4);
    expect(tintLevel(10, -5)).toBe(4);
  });
});

describe('summariseDays', () => {
  const todo = parseTodo(
    [
      '# To-do',
      `- [ ] Send chapter one ${DUE_MARK} 2026-10-20`,
      `- [x] ${SEND_CHAPTER} ${DUE_MARK} 2026-10-20`,
      `- [x] Pay the printer ${DUE_MARK} 2026-10-21`,
      `- [X] Book the hall ${DUE_MARK} 2026-10-21`,
      `- [/] Started ${DUE_MARK} 2026-10-22`,
      '- [ ] No date',
      `- [ ] Next month ${DUE_MARK} 2026-11-02`,
      '',
    ].join('\n'),
  );
  const marks = parseMarks({
    '2026-10-20': { color: 'red', label: DEADLINE },
    '2026-10-23': { label: 'Party' },
    '2026-10-24': 'not a mark',
  }).marks;
  const logged = words({
    '2026-10-19': [300, 450],
    '2026-10-20': [1200, 1500],
    '2026-10-22': [-80, 40],
    '2026-10-24': [900, 900],
    '2026-10-25': [0, 220],
  });

  it('gives one summary per day, in order, from the first day to the last', () => {
    const days = summariseDays('2026-10-19', '2026-10-25', logged, todo, marks);
    expect([...days.keys()]).toEqual(['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25']);
    for (const [date, summary] of days) expect(summary.date).toBe(date);
  });

  it('puts the words, the to-dos and the mark of each day together', () => {
    const days = summariseDays('2026-10-19', '2026-10-25', logged, todo, marks);
    const day = (date: string): DaySummary => days.get(date) as DaySummary;

    // The writing days are 300, 900 and 1200 words: 900 is the scale, so 300 is a third of it.
    expect(day('2026-10-19')).toEqual({
      date: '2026-10-19', manuscriptWords: 300, allWords: 450, tasks: [], openTasks: 0, allTasksDone: false, mark: null, tint: 2,
    });

    const twentieth = day('2026-10-20');
    expect([twentieth.manuscriptWords, twentieth.allWords]).toEqual([1200, 1500]);
    expect(twentieth.tasks.map((task) => task.title)).toEqual(['Send chapter one', SEND_CHAPTER]);
    expect(twentieth.tasks[1]).toBe(todo.tasks[1]);
    expect([twentieth.openTasks, twentieth.allTasksDone]).toEqual([1, false]);
    expect(twentieth.mark).toEqual({ color: 'red', label: DEADLINE });
    expect(twentieth.tint).toBe(4);

    const twentyFirst = day('2026-10-21');
    expect(twentyFirst.tasks.map((task) => task.title)).toEqual(['Pay the printer', 'Book the hall']);
    expect([twentyFirst.openTasks, twentyFirst.allTasksDone]).toEqual([0, true]);
    expect([twentyFirst.manuscriptWords, twentyFirst.allWords, twentyFirst.tint, twentyFirst.mark]).toEqual([0, 0, 0, null]);

    const twentySecond = day('2026-10-22');
    expect([twentySecond.openTasks, twentySecond.allTasksDone]).toEqual([1, false]);
    // a day that lost manuscript words is not tinted, but its numbers are shown as they are
    expect([twentySecond.manuscriptWords, twentySecond.allWords, twentySecond.tint]).toEqual([-80, 40, 0]);

    expect(day('2026-10-23').mark).toEqual({ color: null, label: 'Party' });
    expect(day('2026-10-24').mark).toBeNull();
    expect(day('2026-10-24').tint).toBe(4);
    // words outside the manuscript do not tint a day
    expect([day('2026-10-25').manuscriptWords, day('2026-10-25').allWords, day('2026-10-25').tint]).toEqual([0, 220, 0]);
  });

  it('says a day is all done only when it has to-dos and none is open', () => {
    const days = summariseDays('2026-10-19', '2026-10-25', NO_WORDS, todo, NO_MARKS);
    const allDone = [...days.values()].filter((day) => day.allTasksDone).map((day) => day.date);
    expect(allDone).toEqual(['2026-10-21']);
    expect([...days.values()].map((day) => day.openTasks)).toEqual([0, 1, 0, 1, 0, 0, 0]);
    expect([...days.values()].reduce((count, day) => count + day.tasks.length, 0)).toBe(5);
  });

  it('measures the tint against the days it was asked about, not against days outside', () => {
    const logged = words({
      '2026-10-18': [100, 100],
      '2026-10-19': [300, 300],
      '2026-10-20': [1200, 1200],
      '2026-11-29': [50000, 50000],
      '2026-11-30': [90000, 90000],
    });
    const october = summariseDays('2026-10-18', '2026-10-20', logged, NO_TODO, NO_MARKS);
    expect([...october.values()].map((day) => day.tint)).toEqual([2, 4, 4]);
    const both = summariseDays('2026-10-18', '2026-11-30', logged, NO_TODO, NO_MARKS);
    expect(['2026-10-18', '2026-10-19', '2026-10-20', '2026-11-29', '2026-11-30'].map((date) => both.get(date)?.tint)).toEqual([1, 1, 1, 4, 4]);
  });

  it('does not let one huge day flatten a month of steady writing', () => {
    const entries: Record<string, [number, number]> = {};
    for (let day = 1; day <= 20; day++) entries[`2026-10-${String(day).padStart(2, '0')}`] = [400 + day * 10, 600];
    entries['2026-10-25'] = [20000, 20000];
    const days = summariseDays('2026-10-01', '2026-10-31', words(entries), NO_TODO, NO_MARKS);
    const tints = [...days.values()].map((day) => day.tint);
    expect(days.get('2026-10-25')?.tint).toBe(4);
    expect(days.get('2026-10-01')?.tint).toBe(3);
    expect(days.get('2026-10-20')?.tint).toBe(4);
    expect(tints.slice(0, 20).every((tint) => tint >= 3)).toBe(true);
    expect(tints.slice(20, 24)).toEqual([0, 0, 0, 0]);
  });

  it('does not draw a tiny day like a big one when only two days have words', () => {
    // The first days of a month: ten words on one day, five thousand on the next.
    const start = words({ '2026-10-01': [10, 10], '2026-10-02': [5000, 5200] });
    const month = summariseMonth(2026, 10, start, NO_TODO, NO_MARKS);
    expect([month.get('2026-10-01')?.tint, month.get('2026-10-02')?.tint, month.get('2026-10-03')?.tint]).toEqual([1, 4, 0]);
    const grid = monthGrid(2026, 10, 0);
    const cells = summariseDays(grid.from, grid.to, start, NO_TODO, NO_MARKS);
    expect([cells.get('2026-10-01')?.tint, cells.get('2026-10-02')?.tint]).toEqual([1, 4]);
    // a third writing day brings the usual rule in: the biggest day no longer sets the scale
    const third = words({ '2026-10-01': [10, 10], '2026-10-02': [5000, 5200], '2026-10-03': [600, 600] });
    const later = summariseMonth(2026, 10, third, NO_TODO, NO_MARKS);
    expect([later.get('2026-10-01')?.tint, later.get('2026-10-02')?.tint, later.get('2026-10-03')?.tint]).toEqual([1, 4, 4]);
  });

  it('nor a week of it', () => {
    const week = words({
      '2026-10-04': [480, 480],
      '2026-10-05': [520, 520],
      '2026-10-06': [20000, 20000],
      '2026-10-07': [500, 500],
      '2026-10-08': [130, 130],
    });
    const days = summariseDays('2026-10-04', '2026-10-10', week, NO_TODO, NO_MARKS);
    expect([...days.values()].map((day) => day.tint)).toEqual([4, 4, 4, 4, 1, 0, 0]);
  });

  it('counts a day that is missing from the word log, or holds nonsense, as no words', () => {
    const odd = new Map<string, DayWords>([
      ['2026-10-19', { manuscript: Number.NaN, all: Number.POSITIVE_INFINITY }],
      ['2026-10-20', { manuscript: 100 } as DayWords],
      ['2026-10-21', {} as DayWords],
    ]);
    const days = summariseDays('2026-10-19', '2026-10-22', odd, NO_TODO, NO_MARKS);
    expect([...days.values()].map((day) => [day.manuscriptWords, day.allWords, day.tint])).toEqual([
      [0, 0, 0],
      [100, 0, 4],
      [0, 0, 0],
      [0, 0, 0],
    ]);
  });

  it('covers a single day, the end of a month, and the end of a year', () => {
    expect([...summariseDays('2026-10-20', '2026-10-20', logged, todo, marks).keys()]).toEqual(['2026-10-20']);
    expect([...summariseDays('2026-02-27', '2026-03-02', NO_WORDS, NO_TODO, NO_MARKS).keys()]).toEqual(['2026-02-27', '2026-02-28', '2026-03-01', '2026-03-02']);
    expect([...summariseDays('2024-02-28', '2024-03-01', NO_WORDS, NO_TODO, NO_MARKS).keys()]).toEqual(['2024-02-28', '2024-02-29', '2024-03-01']);
    expect([...summariseDays('2026-12-30', '2027-01-02', NO_WORDS, NO_TODO, NO_MARKS).keys()]).toEqual(['2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02']);
    expect([...summariseDays('9999-12-30', '9999-12-31', NO_WORDS, NO_TODO, NO_MARKS).keys()]).toEqual(['9999-12-30', '9999-12-31']);
  });

  it('is empty when the days asked for make no sense', () => {
    expect(summariseDays('2026-10-21', '2026-10-20', logged, todo, marks).size).toBe(0);
    expect(summariseDays('2026-02-30', '2026-03-02', logged, todo, marks).size).toBe(0);
    expect(summariseDays('2026-10-20', 'later', logged, todo, marks).size).toBe(0);
    expect(summariseDays('', '', logged, todo, marks).size).toBe(0);
  });

  it('covers every cell of a month grid, the days of the neighbouring months included', () => {
    const grid = monthGrid(2026, 10, 1);
    const days = summariseDays(grid.from, grid.to, logged, todo, marks);
    expect([...days.keys()]).toEqual(grid.weeks.flat().map((day) => day.date));
    expect(days.get('2026-11-01')?.tasks).toEqual([]);
    expect(days.get('2026-09-28')?.mark).toBeNull();
  });
});

describe('summariseMonth', () => {
  const todo = parseTodo(`- [ ] ${SEND_CHAPTER} ${DUE_MARK} 2026-10-31\n- [ ] Next month ${DUE_MARK} 2026-11-01\n- [x] Last month ${DUE_MARK} 2026-09-30\n`);
  const marks = parseMarks({ '2026-10-01': { color: 'green', label: DEADLINE }, '2026-11-01': { color: 'red' } }).marks;

  it('covers every day of the month and no other', () => {
    const october = summariseMonth(2026, 10, NO_WORDS, todo, marks);
    expect(october.size).toBe(31);
    expect([...october.keys()][0]).toBe('2026-10-01');
    expect([...october.keys()][30]).toBe('2026-10-31');
    expect(october.get('2026-10-31')?.tasks.map((task) => task.title)).toEqual([SEND_CHAPTER]);
    expect(october.get('2026-10-01')?.mark).toEqual({ color: 'green', label: DEADLINE });
    expect([...october.values()].reduce((count, day) => count + day.tasks.length, 0)).toBe(1);
    expect([...october.values()].filter((day) => day.mark !== null)).toHaveLength(1);

    expect(summariseMonth(2026, 2, NO_WORDS, NO_TODO, NO_MARKS).size).toBe(28);
    expect(summariseMonth(2024, 2, NO_WORDS, NO_TODO, NO_MARKS).size).toBe(29);
    expect(summariseMonth(2026, 4, NO_WORDS, NO_TODO, NO_MARKS).size).toBe(30);
    expect([...summariseMonth(2026, 13, NO_WORDS, NO_TODO, NO_MARKS).keys()][0]).toBe('2027-01-01');
  });

  it('measures the tint within the month', () => {
    const logged = words({
      '2026-09-30': [50000, 50000],
      '2026-10-05': [200, 200],
      '2026-10-06': [800, 900],
      '2026-10-07': [900, 900],
      '2026-11-01': [50000, 50000],
    });
    const october = summariseMonth(2026, 10, logged, NO_TODO, NO_MARKS);
    expect(['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08'].map((date) => october.get(date)?.tint)).toEqual([1, 4, 4, 0]);
  });
});

describe('the word log as the calendar sees it', () => {
  it('feeds a month of summaries from a source of day words', async () => {
    const asked: Array<[string, string]> = [];
    const source: DayWordsSource = {
      wordsByDay(from, to) {
        asked.push([from, to]);
        return Promise.resolve(words({ '2026-10-13': [640, 700], '2026-09-29': [100, 100] }));
      },
    };
    const grid = monthGrid(2026, 10, 0);
    const days = summariseDays(grid.from, grid.to, await source.wordsByDay(grid.from, grid.to), NO_TODO, NO_MARKS);
    expect(asked).toEqual([['2026-09-27', '2026-10-31']]);
    expect(days.get('2026-10-13')?.manuscriptWords).toBe(640);
    expect(days.get('2026-09-29')?.allWords).toBe(100);
    expect(days.size).toBe(35);
  });
});
