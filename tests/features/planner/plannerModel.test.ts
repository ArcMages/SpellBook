// What the planner screen works out before it draws (src/features/planner/plannerModel.ts).

import { describe, expect, it } from 'vitest';
import { parseMarks, parseTodo, summariseDays } from '../../../src/core/planner';
import {
  MARK_CLASSES,
  compactWords,
  dayDots,
  describeDay,
  describeWords,
  dropPlace,
  dueLabel,
  formatWords,
  groupTasks,
  isWideEnough,
  keyTasks,
  markClass,
  colorName,
  movesAnything,
  neighbourOf,
  statLines,
} from '../../../src/features/planner/plannerModel';

describe('choosing a layout by width', () => {
  it('comes in at one width and goes at a smaller one, so that it does not flicker at the edge', () => {
    expect(isWideEnough(719, false, 720, 680)).toBe(false);
    expect(isWideEnough(720, false, 720, 680)).toBe(true);
    expect(isWideEnough(700, true, 720, 680)).toBe(true);
    expect(isWideEnough(679, true, 720, 680)).toBe(false);
    expect(isWideEnough(700, false, 720, 680)).toBe(false);
  });

  it('keeps what it was while there is nothing to measure', () => {
    expect(isWideEnough(0, true, 720, 680)).toBe(true);
    expect(isWideEnough(0, false, 720, 680)).toBe(false);
    expect(isWideEnough(Number.NaN, true, 720, 680)).toBe(true);
  });
});

describe('writing numbers of words', () => {
  it('writes them in full with commas, and words taken away with a minus', () => {
    expect(formatWords(0)).toBe('0');
    expect(formatWords(12345)).toBe('12,345');
    expect(formatWords(-120)).toBe('-120');
    expect(formatWords(Number.NaN)).toBe('0');
    expect(describeWords(1)).toBe('1 word');
    expect(describeWords(2500)).toBe('2,500 words');
    expect(describeWords(-3)).toBe('-3 words');
  });

  it('shortens them for a small cell, never rounding up', () => {
    expect(compactWords(0)).toBe('0');
    expect(compactWords(999)).toBe('999');
    expect(compactWords(1000)).toBe('1k');
    expect(compactWords(1250)).toBe('1.2k');
    expect(compactWords(9999)).toBe('9.9k');
    expect(compactWords(12345)).toBe('12k');
    expect(compactWords(999999)).toBe('999k');
    expect(compactWords(1500000)).toBe('1.5m');
    expect(compactWords(-1250)).toBe('-1.2k');
  });
});

describe('the chip of a due date', () => {
  it('names the days around today, and writes the others short', () => {
    expect(dueLabel('2026-10-13', '2026-10-13')).toBe('Today');
    expect(dueLabel('2026-10-14', '2026-10-13')).toBe('Tomorrow');
    expect(dueLabel('2026-10-12', '2026-10-13')).toBe('Yesterday');
    expect(dueLabel('2026-10-20', '2026-10-13')).toBe('20 Oct');
    expect(dueLabel('2026-03-05', '2026-10-13')).toBe('5 Mar');
  });

  it('adds the year when it is not this year, and knows the turn of the year', () => {
    expect(dueLabel('2027-01-03', '2026-10-13')).toBe('3 Jan 2027');
    expect(dueLabel('2027-01-01', '2026-12-31')).toBe('Tomorrow');
  });
});

describe('the to-dos as the list shows them', () => {
  const todo = parseTodo(['# Plan', '- [ ] One', '- [x] Two', '- [ ] Three', '- [ ] One', '- [X] Four'].join('\n'));

  it('puts the open ones first and the done ones after, each in the order of the file', () => {
    const groups = groupTasks(todo);
    expect(groups.open.map((task) => task.title)).toEqual(['One', 'Three', 'One']);
    expect(groups.done.map((task) => task.title)).toEqual(['Two', 'Four']);
  });

  it('names each to-do by what its line says, telling equal lines apart by their order', () => {
    const { open } = groupTasks(todo);
    const keys = keyTasks(open).map((item) => item.key);
    expect(new Set(keys).size).toBe(3);
    // The name does not hold the line number: it stays the same when lines are added above.
    const moved = groupTasks(parseTodo(['', '', '- [ ] One', '- [ ] Three', '- [ ] One'].join('\n'))).open;
    expect(keyTasks(moved).map((item) => item.key)).toEqual(keys);
  });

  it('finds the to-do above and below another, and none past the ends', () => {
    const { open } = groupTasks(todo);
    const [first, second, third] = open;
    if (!first || !second || !third) throw new Error('three open to-dos were expected');
    expect(neighbourOf(open, second, -1)).toBe(first);
    expect(neighbourOf(open, second, 1)).toBe(third);
    expect(neighbourOf(open, first, -1)).toBeNull();
    expect(neighbourOf(open, third, 1)).toBeNull();
    // Two lines that say the same are still two to-dos.
    expect(neighbourOf(open, third, -1)).toBe(second);
  });
});

describe('where a dragged row would go', () => {
  const rows = [0, 1, 2, 3].map((at) => ({ top: at * 30, bottom: at * 30 + 30 }));

  it('goes before a row in its upper half and after it in its lower half', () => {
    expect(dropPlace(rows, 5)).toEqual({ index: 0, where: 'before' });
    expect(dropPlace(rows, 20)).toEqual({ index: 0, where: 'after' });
    expect(dropPlace(rows, 65)).toEqual({ index: 2, where: 'before' });
    expect(dropPlace(rows, 119)).toEqual({ index: 3, where: 'after' });
  });

  it('takes above the first row as before it and below the last as after it', () => {
    expect(dropPlace(rows, -50)).toEqual({ index: 0, where: 'before' });
    expect(dropPlace(rows, 500)).toEqual({ index: 3, where: 'after' });
    expect(dropPlace([], 10)).toBeNull();
  });

  it('knows the places that would leave the list as it is', () => {
    // The row at 1 is dragged: on itself, after the row above it and before the row below it change nothing.
    expect(movesAnything({ index: 1, where: 'before' }, 1)).toBe(false);
    expect(movesAnything({ index: 1, where: 'after' }, 1)).toBe(false);
    expect(movesAnything({ index: 0, where: 'after' }, 1)).toBe(false);
    expect(movesAnything({ index: 2, where: 'before' }, 1)).toBe(false);
    expect(movesAnything({ index: 0, where: 'before' }, 1)).toBe(true);
    expect(movesAnything({ index: 2, where: 'after' }, 1)).toBe(true);
  });

  it('finds the place in a list of thousands', () => {
    const many = Array.from({ length: 5000 }, (_, at) => ({ top: at * 30, bottom: at * 30 + 30 }));
    expect(dropPlace(many, 4321 * 30 + 29)).toEqual({ index: 4321, where: 'after' });
  });
});

describe("a day's dots", () => {
  it('shows a dot for each open to-do up to three, then "+N", and a tick when all are done', () => {
    expect(dayDots({ openTasks: 0, allTasksDone: false })).toEqual({ tick: false, dots: 0, more: 0 });
    expect(dayDots({ openTasks: 2, allTasksDone: false })).toEqual({ tick: false, dots: 2, more: 0 });
    expect(dayDots({ openTasks: 3, allTasksDone: false })).toEqual({ tick: false, dots: 3, more: 0 });
    expect(dayDots({ openTasks: 7, allTasksDone: false })).toEqual({ tick: false, dots: 3, more: 4 });
    expect(dayDots({ openTasks: 0, allTasksDone: true })).toEqual({ tick: true, dots: 0, more: 0 });
  });
});

describe('a day said in full', () => {
  const todo = parseTodo(['- [ ] A \u{1F4C5} 2026-10-20', '- [ ] B \u{1F4C5} 2026-10-20', '- [x] C \u{1F4C5} 2026-10-21'].join('\n'));
  const marks = parseMarks({ '2026-10-20': { color: 'red', label: 'Deadline' }, '2026-10-22': { color: 'blue' } }).marks;
  const days = summariseDays('2026-10-19', '2026-10-22', new Map([['2026-10-20', { manuscript: 350, all: 500 }]]), todo, marks);
  const day = (date: string) => {
    const summary = days.get(date);
    if (!summary) throw new Error(`no summary for ${date}`);
    return summary;
  };

  it('says the date, the words, the to-dos and the mark', () => {
    expect(describeDay(day('2026-10-20'), false, true)).toBe(
      'Tuesday, 20 October 2026, 350 words in the manuscript, 500 words in all notes, 2 to-dos due, marked: Deadline',
    );
    expect(describeDay(day('2026-10-21'), false, true)).toBe('Wednesday, 21 October 2026, its to-do is done');
    expect(describeDay(day('2026-10-22'), false, true)).toBe('Thursday, 22 October 2026, marked blue');
    expect(describeDay(day('2026-10-19'), true, true)).toBe('Monday, 19 October 2026, today');
  });

  it('leaves the words out when the calendar has none to show', () => {
    expect(describeDay(day('2026-10-20'), false, false)).toBe('Tuesday, 20 October 2026, 2 to-dos due, marked: Deadline');
  });
});

describe('the marks', () => {
  it('names a class and a button for each colour', () => {
    expect(markClass('red')).toBe('spellbook-mark-red');
    expect(MARK_CLASSES).toHaveLength(8);
    expect(colorName('purple')).toBe('Purple');
  });
});

describe('the numbers under the calendar', () => {
  it('has a line for each number that was given', () => {
    const lines = statLines(
      {
        month: { manuscript: 12500, all: 15000 },
        week: { manuscript: 2100, all: 2100 },
        streak: 4,
        average: 612.4,
        target: { goal: 500, written: 350, met: false },
      },
      'October 2026',
    );
    expect(lines.map((line) => `${line.label}: ${line.value} / ${line.detail}`)).toEqual([
      'October 2026: 12,500 / 15,000 in all notes',
      'This week: 2,100 / 2,100 in all notes',
      'Streak: 4 days / ',
      'Daily average: 612 / words a day',
      "Today's target: 350 of 500 / Not met yet",
    ]);
    expect(lines[4]?.met).toBe(false);
  });

  it('has no line for a number that was not given', () => {
    expect(statLines(null, 'October 2026')).toEqual([]);
    expect(statLines({}, 'October 2026')).toEqual([]);
    expect(statLines({ streak: 1, month: null, average: undefined }, 'October 2026').map((line) => line.id)).toEqual(['streak']);
    expect(statLines({ streak: 1 }, 'October 2026')[0]?.value).toBe('1 day');
    expect(statLines({ streak: Number.NaN }, 'October 2026')).toEqual([]);
  });

  it('says when the target is met', () => {
    const [line] = statLines({ target: { goal: 500, written: 620, met: true } }, 'October 2026');
    expect(line?.value).toBe('620 of 500');
    expect(line?.detail).toBe('Met');
    expect(line?.met).toBe(true);
  });
});
