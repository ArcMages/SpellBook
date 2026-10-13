// The calendar half of the planner, driven through a stand-in host
// (tests/features/planner/plannerStage.ts). These tests check what the
// calendar shows and does; how it looks can only be checked in Obsidian.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DUE_MARK } from '../../../src/core/planner';
import { DETAIL_BESIDE_FROM, DETAIL_UNDER_BELOW, LABELS_FROM, NUMBERS_BELOW, NUMBERS_FROM } from '../../../src/features/planner/plannerModel';
import { FakeElement, fakeDocument, resetPlatform } from '../../obsidianStub';
import {
  FakeWords,
  TODAY,
  boxOf,
  cellOf,
  cellPicture,
  clearScreen,
  click,
  dayCells,
  detail,
  detailOpen,
  flip,
  headButton,
  key,
  monthName,
  notices,
  one,
  part,
  resize,
  settle,
  stagePlanner,
  statPicture,
  ticked,
  unused,
} from './plannerStage';
import type { FakeHost, PlannerStage } from './plannerStage';

beforeEach(() => {
  clearScreen();
});

afterEach(() => {
  resetPlatform();
  vi.restoreAllMocks();
});

const due = (date: string): string => `${DUE_MARK} ${date}`;

const TODO = [
  '# Plan',
  `- [ ] Send chapter one ${due('2026-10-20')}`,
  `- [ ] Ask about the cover ${due('2026-10-21')}`,
  `- [ ] Book the hall ${due('2026-10-21')}`,
  `- [ ] Order paper ${due('2026-10-21')}`,
  `- [ ] Write the blurb ${due('2026-10-21')}`,
  `- [x] Pay the editor ${due('2026-10-22')}`,
  '- [ ] No date at all',
].join('\n');

const withWords = (words: FakeWords) => ({
  setup: (host: FakeHost): void => {
    host.words = words;
  },
});

/** Tap a day and let what follows happen. */
async function open(s: PlannerStage, date: string): Promise<FakeElement> {
  click(cellOf(s.pane, date));
  await settle(s);
  return detail(s.pane);
}

describe('the month', () => {
  it("shows today's month, named in English, as weeks that start on Sunday", async () => {
    const { pane } = await stagePlanner();
    expect(monthName(pane)).toBe('October 2026');
    expect(pane.withClass('spellbook-calendar-weekday').map((heading) => heading.text)).toEqual(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);
    const cells = dayCells(pane);
    expect(cells).toHaveLength(35);
    // The first week starts in September; those days are shown, but apart.
    expect(cells.slice(0, 5).map((cell) => cellPicture(cell).number)).toEqual(['27', '28', '29', '30', '1']);
    expect(cells.slice(0, 5).map((cell) => cell.hasClass('spellbook-is-outside'))).toEqual([true, true, true, true, false]);
    expect(cells.filter((cell) => !cell.hasClass('spellbook-is-outside'))).toHaveLength(31);
    // Every cell is a button and says its whole date.
    expect(cells.every((cell) => cell.tag === 'button')).toBe(true);
    expect(cells[4]?.attrs['aria-label']).toBe('Thursday, 1 October 2026');
  });

  it('starts the weeks on the day the host says', async () => {
    const s = await stagePlanner({
      setup: (host) => {
        host.firstDayOfWeek = 1;
      },
    });
    expect(s.pane.withClass('spellbook-calendar-weekday').map((heading) => heading.text)).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
    expect(cellPicture(dayCells(s.pane)[0] as FakeElement).number).toBe('28');

    // The setting changes while the calendar is open.
    s.host.firstDayOfWeek = 6;
    s.host.emit('data');
    await settle(s);
    expect(s.pane.withClass('spellbook-calendar-weekday')[0]?.text).toBe('Sat');
    expect(cellPicture(dayCells(s.pane)[0] as FakeElement).number).toBe('26');
  });

  it('has as many weeks as the month touches: four, five or six', async () => {
    const weeksIn = async (today: string): Promise<number> => {
      const { pane } = await stagePlanner({
        setup: (host) => {
          host.today = today;
        },
      });
      return dayCells(pane).length / 7;
    };
    expect(await weeksIn('2026-02-10')).toBe(4);
    expect(await weeksIn('2026-10-13')).toBe(5);
    expect(await weeksIn('2026-08-15')).toBe(6);
  });

  it('outlines today, and only today', async () => {
    const s = await stagePlanner();
    const today = s.pane.withClass('spellbook-day', 'spellbook-is-today');
    expect(today).toHaveLength(1);
    expect(today[0]).toBe(cellOf(s.pane, TODAY));
    expect(today[0]?.attrs['aria-current']).toBe('date');
    expect(String(today[0]?.attrs['aria-label'])).toMatch(/, today$/);

    // Midnight passes.
    s.host.today = '2026-10-14';
    s.host.emit('data');
    await settle(s);
    expect(s.pane.withClass('spellbook-day', 'spellbook-is-today')).toEqual([cellOf(s.pane, '2026-10-14')]);
    expect(cellOf(s.pane, TODAY).attrs['aria-current']).toBeUndefined();
  });

  it('goes to the month before, the month after, and back to today', async () => {
    const words = new FakeWords();
    const s = await stagePlanner(withWords(words));
    click(headButton(s.pane, 'Next month'));
    expect(monthName(s.pane)).toBe('November 2026');
    expect(cellPicture(dayCells(s.pane)[0] as FakeElement).number).toBe('1');
    click(headButton(s.pane, 'Previous month'));
    click(headButton(s.pane, 'Previous month'));
    expect(monthName(s.pane)).toBe('September 2026');
    click(headButton(s.pane, 'Previous month'));
    click(headButton(s.pane, 'Today'));
    expect(monthName(s.pane)).toBe('October 2026');
    await settle(s);
    // Each month asked the host for the words of the days it shows.
    expect(words.asked[0]).toBe('2026-09-27..2026-10-31');
    expect(words.asked[1]).toBe('2026-11-01..2026-12-05');
    expect(words.asked).toHaveLength(6);
  });

  it('crosses the turn of the year', async () => {
    const s = await stagePlanner({
      setup: (host) => {
        host.today = '2026-12-31';
      },
    });
    expect(monthName(s.pane)).toBe('December 2026');
    click(headButton(s.pane, 'Next month'));
    expect(monthName(s.pane)).toBe('January 2027');
    expect(headButton(s.pane, 'Next month').attrs['role']).toBe('button');
  });
});

describe('words in the cells', () => {
  const words = (): FakeWords => new FakeWords().set('2026-10-10', 1200, 1500).set('2026-10-12', 100).set('2026-10-13', 400, 650);

  it("tints a day by its manuscript words, on the engine's scale", async () => {
    const { pane } = await stagePlanner(withWords(words()));
    expect(cellPicture(cellOf(pane, '2026-10-12')).tint).toBe(1);
    expect(cellPicture(cellOf(pane, '2026-10-13')).tint).toBe(4);
    expect(cellPicture(cellOf(pane, '2026-10-10')).tint).toBe(4);
    expect(cellPicture(cellOf(pane, '2026-10-11')).tint).toBe(0);
    // One tint class at a time.
    for (const cell of dayCells(pane)) {
      expect([...cell.classes].filter((cls) => cls.startsWith('spellbook-tint-'))).toHaveLength(1);
    }
  });

  it('writes the two numbers into the cell: the manuscript, and all words', async () => {
    const { pane } = await stagePlanner(withWords(words()));
    expect(cellPicture(cellOf(pane, '2026-10-13'))).toMatchObject({ manuscript: '400', all: '650' });
    expect(cellPicture(cellOf(pane, '2026-10-10'))).toMatchObject({ manuscript: '1.2k', all: '1.5k' });
    // A day without writing shows no numbers at all.
    expect(cellPicture(cellOf(pane, '2026-10-11'))).toMatchObject({ manuscript: '', all: '' });
    expect(cellOf(pane, '2026-10-13').attrs['aria-label']).toBe(
      'Tuesday, 13 October 2026, today, 400 words in the manuscript, 650 words in all notes',
    );
    // Numbers keep their own direction, whatever the language around them.
    expect(part(cellOf(pane, '2026-10-13'), 'spellbook-day-words').attrs['dir']).toBe('ltr');
  });

  it('shows the numbers only where a cell is wide enough, going by the measured width of the month', async () => {
    const s = await stagePlanner(withWords(words()));
    const calendar = one(s.pane, 'spellbook-calendar');
    expect(calendar.hasClass('spellbook-shows-numbers')).toBe(false);
    resize(s, 900, 600, NUMBERS_FROM);
    expect(calendar.hasClass('spellbook-shows-numbers')).toBe(true);
    expect(calendar.hasClass('spellbook-shows-labels')).toBe(false);
    resize(s, 900, 600, NUMBERS_BELOW);
    expect(calendar.hasClass('spellbook-shows-numbers')).toBe(true);
    resize(s, 375, 375, NUMBERS_BELOW - 1);
    expect(calendar.hasClass('spellbook-shows-numbers')).toBe(false);
    resize(s, 1200, 800, LABELS_FROM);
    expect(calendar.hasClass('spellbook-shows-numbers')).toBe(true);
    expect(calendar.hasClass('spellbook-shows-labels')).toBe(true);
  });

  it('draws the month at once and tints it when the words arrive', async () => {
    const log = words();
    log.hold = true;
    const s = await stagePlanner(withWords(log));
    expect(monthName(s.pane)).toBe('October 2026');
    expect(cellPicture(cellOf(s.pane, '2026-10-13')).tint).toBe(0);
    log.release();
    await settle(s);
    expect(cellPicture(cellOf(s.pane, '2026-10-13')).tint).toBe(4);
  });

  it('shows new words when the host says they changed', async () => {
    const log = words();
    const s = await stagePlanner(withWords(log));
    log.set('2026-10-13', 900, 950);
    s.host.emit('words');
    await settle(s);
    expect(cellPicture(cellOf(s.pane, '2026-10-13'))).toMatchObject({ manuscript: '900', all: '950' });
  });

  it('does not use an answer that belongs to a month no longer on show', async () => {
    const log = words().set('2026-11-01', 5000);
    log.hold = true;
    const s = await stagePlanner(withWords(log));
    click(headButton(s.pane, 'Next month'));
    await settle(s);
    click(headButton(s.pane, 'Previous month'));
    await settle(s);
    // Three questions are out: October, November, October again. They are answered in that order.
    expect(log.asked).toHaveLength(3);
    const painted = vi.spyOn(FakeElement.prototype, 'setText');
    log.release();
    await settle(s);
    expect(monthName(s.pane)).toBe('October 2026');
    expect(cellPicture(cellOf(s.pane, '2026-10-13')).tint).toBe(4);
    expect(cellPicture(cellOf(s.pane, '2026-10-12')).tint).toBe(1);
    // Only the last answer was drawn: each of the three written days was painted once, not twice.
    const numbers = new Map(dayCells(s.pane).map((cell) => [part(cell, 'spellbook-day-manuscript'), cell]));
    expect(painted.mock.contexts.filter((element) => numbers.has(element as FakeElement))).toHaveLength(3);
  });

  it('still works with to-dos and marks when the host has no words', async () => {
    const { pane } = await stagePlanner({ todo: TODO, marks: { '2026-10-20': { color: 'red' } } });
    expect(dayCells(pane).every((cell) => cellPicture(cell).tint === 0 && cellPicture(cell).manuscript === '')).toBe(true);
    expect(cellPicture(cellOf(pane, '2026-10-20')).dots).toBe(1);
    expect(cellOf(pane, '2026-10-20').hasClass('spellbook-mark-red')).toBe(true);
  });

  it('keeps working when the word log cannot be read', async () => {
    const complaints = vi.spyOn(console, 'error').mockImplementation(() => {});
    const log = words();
    log.broken = true;
    const { pane } = await stagePlanner({ todo: TODO, ...withWords(log) });
    expect(complaints).toHaveBeenCalled();
    expect(monthName(pane)).toBe('October 2026');
    expect(cellPicture(cellOf(pane, '2026-10-20')).dots).toBe(1);
  });
});

describe('to-dos in the cells', () => {
  it('shows a dot for each open to-do due that day, "+N" after three, and a tick when all are done', async () => {
    const { pane } = await stagePlanner({ todo: TODO });
    expect(cellPicture(cellOf(pane, '2026-10-20'))).toMatchObject({ dots: 1, more: '', tick: false });
    expect(cellPicture(cellOf(pane, '2026-10-21'))).toMatchObject({ dots: 3, more: '+1', tick: false });
    expect(cellPicture(cellOf(pane, '2026-10-22'))).toMatchObject({ dots: 0, more: '', tick: true });
    expect(cellPicture(cellOf(pane, '2026-10-23'))).toMatchObject({ dots: 0, more: '', tick: false });
    expect(cellOf(pane, '2026-10-21').attrs['aria-label']).toBe('Wednesday, 21 October 2026, 4 to-dos due');
  });

  it('repaints only the cells that show something else when a to-do changes', async () => {
    const s = await stagePlanner({ todo: TODO });
    const numberOf = (date: string): FakeElement => part(cellOf(s.pane, date), 'spellbook-day-number');
    const written = vi.spyOn(FakeElement.prototype, 'setText');
    s.host.file = `${TODO}\n- [ ] Proofread ${due('2026-10-27')}`;
    s.host.sync();
    await settle(s);
    expect(cellPicture(cellOf(s.pane, '2026-10-27')).dots).toBe(1);
    // Of all the day numbers, only that one cell's was written again.
    const numbers = new Set(dayCells(s.pane).map((cell) => part(cell, 'spellbook-day-number')));
    const rewritten = written.mock.contexts.filter((element) => numbers.has(element as FakeElement));
    expect(rewritten).toEqual([numberOf('2026-10-27')]);
  });

  it('builds its cells once and keeps them from month to month', async () => {
    const s = await stagePlanner({ todo: TODO });
    const before = s.pane.withClass('spellbook-day');
    expect(before).toHaveLength(42);
    expect(s.pane.withClass('spellbook-calendar-week').filter(unused)).toHaveLength(1);
    click(headButton(s.pane, 'Next month'));
    click(headButton(s.pane, 'Next month'));
    const after = s.pane.withClass('spellbook-day');
    expect(after).toHaveLength(42);
    expect(after.every((cell, at) => cell === before[at])).toBe(true);
  });
});

describe('marks in the cells', () => {
  const MARKS = {
    '2026-10-20': { color: 'red', label: 'Deadline' },
    '2026-10-23': { label: 'יום הולדת' },
    '2026-10-24': { color: 'cyan' },
  };

  it('shows a mark as a corner in its colour, with its label', async () => {
    const { pane } = await stagePlanner({ marks: MARKS });
    const deadline = cellOf(pane, '2026-10-20');
    expect(deadline.hasClass('spellbook-has-mark')).toBe(true);
    expect(deadline.hasClass('spellbook-mark-red')).toBe(true);
    expect(deadline.withClass('spellbook-day-corner')).toHaveLength(1);
    expect(cellPicture(deadline).label).toBe('Deadline');
    expect(cellOf(pane, '2026-10-24').hasClass('spellbook-mark-cyan')).toBe(true);
    expect(cellPicture(cellOf(pane, '2026-10-24')).label).toBe('');
    // A mark with a label and no colour still shows.
    expect(cellOf(pane, '2026-10-23').hasClass('spellbook-mark-plain')).toBe(true);
    expect(cellOf(pane, '2026-10-19').hasClass('spellbook-has-mark')).toBe(false);
  });

  it("lets the label, and only the label, take the direction of the writer's own text", async () => {
    const { pane } = await stagePlanner({ marks: MARKS, todo: TODO });
    const cell = cellOf(pane, '2026-10-23');
    expect(cellPicture(cell).label).toBe('יום הולדת');
    const own = cell.all().filter((element) => element.attrs['dir'] === 'auto');
    expect(own).toEqual([part(cell, 'spellbook-day-label')]);
    // The cell itself has no direction of its own: it follows the app, like its neighbours.
    expect(cell.attrs['dir']).toBeUndefined();
  });

  it('takes a mark off the cell when it is removed, and changes its colour when that changes', async () => {
    const s = await stagePlanner({ marks: MARKS });
    s.host.stored = { '2026-10-20': { color: 'blue', label: 'Deadline' } };
    s.host.sync();
    await settle(s);
    const deadline = cellOf(s.pane, '2026-10-20');
    expect(deadline.hasClass('spellbook-mark-blue')).toBe(true);
    expect(deadline.hasClass('spellbook-mark-red')).toBe(false);
    expect(cellOf(s.pane, '2026-10-24').hasClass('spellbook-has-mark')).toBe(false);
    expect(cellOf(s.pane, '2026-10-24').hasClass('spellbook-mark-cyan')).toBe(false);
  });

  it('says what could not be read of the marks, and leaves it alone', async () => {
    const { pane } = await stagePlanner({ marks: { '2026-10-20': 'party', 'next week': { color: 'red' } } });
    const notes = pane.withClass('spellbook-calendar-note');
    expect(notes).toHaveLength(2);
    expect(notes[0]?.text).toMatch(/2026-10-20 could not be read/);
    expect(notes.every((note) => note.attrs['dir'] === 'auto')).toBe(true);
    expect(unused(one(pane, 'spellbook-calendar-notes'))).toBe(false);
    expect(cellOf(pane, '2026-10-20').hasClass('spellbook-has-mark')).toBe(false);
  });

  it('says nothing when every mark could be read', async () => {
    const { pane } = await stagePlanner({ marks: MARKS });
    expect(unused(one(pane, 'spellbook-calendar-notes'))).toBe(true);
  });
});

describe('the numbers under the month', () => {
  it('shows the numbers the host gives, and asks for the month on show', async () => {
    const s = await stagePlanner({
      setup: (host) => {
        host.numbers = {
          month: { manuscript: 12500, all: 15000 },
          week: { manuscript: 2100, all: 2600 },
          streak: 4,
          average: 612,
          target: { goal: 500, written: 620, met: true },
        };
      },
    });
    expect(statPicture(s.pane)).toEqual([
      'October 2026: 12,500 (15,000 in all notes)',
      'This week: 2,100 (2,600 in all notes)',
      'Streak: 4 days',
      'Daily average: 612 (words a day)',
      "Today's target: 620 of 500 (Met)",
    ]);
    expect(s.host.statsAsked).toEqual([{ year: 2026, month: 10 }]);
    expect(one(s.pane, 'spellbook-stat-target').hasClass('spellbook-is-met')).toBe(true);

    click(headButton(s.pane, 'Next month'));
    await settle(s);
    expect(s.host.statsAsked[1]).toEqual({ year: 2026, month: 11 });
    expect(statPicture(s.pane)[0]).toMatch(/^November 2026: /);
  });

  it('shows nothing for a number the host does not give', async () => {
    const s = await stagePlanner({
      setup: (host) => {
        host.numbers = { streak: 1, target: { goal: 500, written: 120, met: false } };
      },
    });
    expect(statPicture(s.pane)).toEqual(['Streak: 1 day', "Today's target: 120 of 500 (Not met yet)"]);
    expect(one(s.pane, 'spellbook-stat-target').hasClass('spellbook-is-met')).toBe(false);
  });

  it('takes no room at all when the host gives no numbers, or cannot be asked for any', async () => {
    const none = await stagePlanner();
    expect(statPicture(none.pane)).toEqual([]);
    expect(unused(one(none.pane, 'spellbook-calendar-stats'))).toBe(true);

    const cannot = await stagePlanner({
      setup: (host) => {
        Object.defineProperty(host, 'stats', { value: undefined });
      },
    });
    expect(statPicture(cannot.pane)).toEqual([]);
    expect(monthName(cannot.pane)).toBe('October 2026');
  });

  it('brings the numbers up to date when the host says the words changed', async () => {
    const s = await stagePlanner({
      setup: (host) => {
        host.numbers = { streak: 4 };
      },
    });
    s.host.numbers = { streak: 5 };
    s.host.emit('words');
    await settle(s);
    expect(statPicture(s.pane)).toEqual(['Streak: 5 days']);
  });
});

describe("a day's detail", () => {
  it('opens when a day is tapped, and shows the date', async () => {
    const s = await stagePlanner({ todo: TODO });
    expect(detailOpen(s.pane)).toBe(false);
    const panel = await open(s, '2026-10-20');
    expect(detailOpen(s.pane)).toBe(true);
    expect(part(panel, 'spellbook-detail-title').text).toBe('Tuesday, 20 October 2026');
    const cell = cellOf(s.pane, '2026-10-20');
    expect(cell.hasClass('spellbook-is-selected')).toBe(true);
    expect(cell.attrs['aria-pressed']).toBe('true');
    expect(s.pane.withClass('spellbook-day', 'spellbook-is-selected')).toHaveLength(1);
  });

  it('shuts when the same day is tapped again, or Close is', async () => {
    const s = await stagePlanner({ todo: TODO });
    await open(s, '2026-10-20');
    await open(s, '2026-10-20');
    expect(detailOpen(s.pane)).toBe(false);
    expect(cellOf(s.pane, '2026-10-20').attrs['aria-pressed']).toBe('false');

    const panel = await open(s, '2026-10-21');
    expect(part(panel, 'spellbook-detail-title').text).toBe('Wednesday, 21 October 2026');
    click(part(panel, 'spellbook-detail-close'));
    expect(detailOpen(s.pane)).toBe(false);
  });

  it('lists the to-dos due that day with their tick boxes, and says when there are none', async () => {
    const s = await stagePlanner({ todo: TODO });
    const panel = await open(s, '2026-10-21');
    const rows = part(panel, 'spellbook-detail-todos').children;
    expect(rows.map((row) => part(row, 'spellbook-todo-text').text)).toEqual([
      'Ask about the cover',
      'Book the hall',
      'Order paper',
      'Write the blurb',
    ]);
    expect(rows.every((row) => !ticked(boxOf(row)))).toBe(true);
    expect(unused(part(panel, 'spellbook-detail-empty'))).toBe(true);

    await open(s, '2026-10-22');
    expect(ticked(boxOf(part(panel, 'spellbook-detail-todos').children[0] as FakeElement))).toBe(true);

    await open(s, '2026-10-23');
    expect(part(panel, 'spellbook-detail-todos').children).toHaveLength(0);
    expect(unused(part(panel, 'spellbook-detail-empty'))).toBe(false);
  });

  it('shows the words of the day when the host has words, and no words line when it has none', async () => {
    const s = await stagePlanner(withWords(new FakeWords().set('2026-10-13', 400, 650)));
    const panel = await open(s, TODAY);
    expect(part(panel, 'spellbook-detail-manuscript').text).toBe('400 words in the manuscript');
    expect(part(panel, 'spellbook-detail-all').text).toBe('650 words in all notes');
    await open(s, '2026-10-14');
    expect(part(panel, 'spellbook-detail-manuscript').text).toBe('0 words in the manuscript');

    const bare = await stagePlanner();
    const other = await open(bare, TODAY);
    expect(unused(part(other, 'spellbook-detail-words'))).toBe(true);
  });

  it('ticks a to-do in the file when its box is ticked, and the cell follows', async () => {
    const s = await stagePlanner({ todo: TODO });
    const panel = await open(s, '2026-10-20');
    flip(boxOf(part(panel, 'spellbook-detail-todos').children[0] as FakeElement));
    await settle(s);
    expect(s.host.file).toContain(`- [x] Send chapter one ${due('2026-10-20')}`);
    // Only that line changed.
    expect(s.host.file.split('\n')).toHaveLength(TODO.split('\n').length);
    expect(cellPicture(cellOf(s.pane, '2026-10-20'))).toMatchObject({ dots: 0, tick: true });
    expect(ticked(boxOf(part(panel, 'spellbook-detail-todos').children[0] as FakeElement))).toBe(true);
  });

  it('adds a to-do for that day, from the keyboard or with the button', async () => {
    const s = await stagePlanner({ todo: TODO });
    const panel = await open(s, '2026-10-27');
    const input = part(part(panel, 'spellbook-detail-add'), 'spellbook-todo-input');
    expect(input.attrs['dir']).toBe('auto');
    input.value = 'לשלוח את הפרק';
    key(input, 'Enter');
    await settle(s);
    expect(s.host.file.split('\n').pop()).toBe(`- [ ] לשלוח את הפרק ${due('2026-10-27')}`);
    expect(input.value).toBe('');
    expect(cellPicture(cellOf(s.pane, '2026-10-27')).dots).toBe(1);
    expect(part(panel, 'spellbook-detail-todos').children).toHaveLength(1);

    input.value = 'Second thing';
    click(part(part(panel, 'spellbook-detail-add'), 'spellbook-todo-add-button'));
    await settle(s);
    expect(cellPicture(cellOf(s.pane, '2026-10-27')).dots).toBe(2);
  });

  it('does not add on the Enter that only accepts a word from an input method', async () => {
    const s = await stagePlanner();
    const panel = await open(s, '2026-10-27');
    const input = part(part(panel, 'spellbook-detail-add'), 'spellbook-todo-input');
    input.value = 'にほん';
    key(input, 'Enter', { isComposing: true });
    key(input, 'Enter', { keyCode: 229 });
    await settle(s);
    expect(s.host.todoEdits).toBe(0);
  });

  it("tells the writer, in the engine's words, when there is nothing to add", async () => {
    const s = await stagePlanner({ todo: TODO });
    const panel = await open(s, '2026-10-27');
    click(part(part(panel, 'spellbook-detail-add'), 'spellbook-todo-add-button'));
    await settle(s);
    expect(notices()).toEqual(['A to-do needs some text.']);
    expect(s.host.file).toBe(TODO);
  });

  it('shuts when its day is no longer on show, and stays for a day that still is', async () => {
    const s = await stagePlanner();
    await open(s, '2026-10-20');
    click(headButton(s.pane, 'Next month'));
    expect(detailOpen(s.pane)).toBe(false);
    click(headButton(s.pane, 'Previous month'));
    expect(detailOpen(s.pane)).toBe(false);

    // The last days of September are part of October's first week, and of September's last.
    await open(s, '2026-09-29');
    click(headButton(s.pane, 'Previous month'));
    expect(monthName(s.pane)).toBe('September 2026');
    expect(detailOpen(s.pane)).toBe(true);
    expect(cellOf(s.pane, '2026-09-29').hasClass('spellbook-is-selected')).toBe(true);
  });

  it('sits beside the month where the calendar is wide enough, and under it otherwise', async () => {
    const s = await stagePlanner();
    const calendar = one(s.pane, 'spellbook-calendar');
    expect(calendar.hasClass('spellbook-detail-beside')).toBe(false);
    resize(s, 1200, DETAIL_BESIDE_FROM);
    expect(calendar.hasClass('spellbook-detail-beside')).toBe(true);
    resize(s, 1200, DETAIL_UNDER_BELOW);
    expect(calendar.hasClass('spellbook-detail-beside')).toBe(true);
    resize(s, 700, DETAIL_UNDER_BELOW - 1);
    expect(calendar.hasClass('spellbook-detail-beside')).toBe(false);
  });

  it('scrolls the calendar, and only the calendar, to show a detail that opened below what can be seen', async () => {
    const s = await stagePlanner();
    const scroll = one(s.pane, 'spellbook-calendar-scroll');
    scroll.rect = { top: 100, bottom: 500, left: 0, right: 375, width: 375, height: 400 };
    detail(s.pane).rect = { top: 450, bottom: 750, left: 0, right: 375, width: 375, height: 300 };
    await open(s, '2026-10-20');
    expect(scroll.scrollTop).toBe(250);

    // Beside the month there is nothing to scroll to.
    scroll.scrollTop = 0;
    await open(s, '2026-10-20');
    resize(s, 1200, DETAIL_BESIDE_FROM);
    await open(s, '2026-10-21');
    expect(scroll.scrollTop).toBe(0);
  });
});

describe('marking a day', () => {
  const swatch = (panel: FakeElement, color: string): FakeElement => part(panel, `spellbook-mark-${color}`);

  it('offers the eight colours by name', async () => {
    const s = await stagePlanner();
    const panel = await open(s, '2026-10-20');
    const swatches = panel.withClass('spellbook-mark-swatch');
    expect(swatches.map((button) => button.attrs['aria-label'])).toEqual(['Red', 'Orange', 'Yellow', 'Green', 'Cyan', 'Blue', 'Purple', 'Pink']);
    expect(swatches.every((button) => button.tag === 'button' && button.attrs['aria-pressed'] === 'false')).toBe(true);
  });

  it('gives the day a colour, changes it, and takes it away again', async () => {
    const s = await stagePlanner();
    const panel = await open(s, '2026-10-20');
    click(swatch(panel, 'green'));
    await settle(s);
    expect(s.host.stored).toEqual({ '2026-10-20': { color: 'green' } });
    expect(cellOf(s.pane, '2026-10-20').hasClass('spellbook-mark-green')).toBe(true);
    expect(swatch(panel, 'green').attrs['aria-pressed']).toBe('true');
    expect(swatch(panel, 'green').hasClass('spellbook-is-chosen')).toBe(true);

    click(swatch(panel, 'blue'));
    await settle(s);
    expect(s.host.stored).toEqual({ '2026-10-20': { color: 'blue' } });
    expect(swatch(panel, 'green').attrs['aria-pressed']).toBe('false');

    // Tapping the colour the day has takes the colour away; nothing is left, so the mark goes.
    click(swatch(panel, 'blue'));
    await settle(s);
    expect(s.host.stored).toEqual({});
    expect(cellOf(s.pane, '2026-10-20').hasClass('spellbook-has-mark')).toBe(false);
  });

  it('stores the label when the writer leaves the field or presses Enter, once', async () => {
    const s = await stagePlanner({ marks: { '2026-10-20': { color: 'red' }, '2026-11-02': { color: 'pink' } } });
    const panel = await open(s, '2026-10-20');
    const label = part(panel, 'spellbook-mark-label');
    expect(label.attrs['dir']).toBe('auto');
    label.value = 'מועד אחרון';
    key(label, 'Enter');
    label.fire('change');
    await settle(s);
    expect(s.host.marksEdits).toBe(1);
    // Only that day's entry changed; its colour and the other day stay as they were.
    expect(s.host.stored).toEqual({ '2026-10-20': { color: 'red', label: 'מועד אחרון' }, '2026-11-02': { color: 'pink' } });
    expect(cellPicture(cellOf(s.pane, '2026-10-20')).label).toBe('מועד אחרון');

    label.value = '';
    label.fire('change');
    await settle(s);
    expect(s.host.stored).toEqual({ '2026-10-20': { color: 'red' }, '2026-11-02': { color: 'pink' } });
  });

  it('shows the label the day has, and does not write over what is being typed', async () => {
    const s = await stagePlanner({ marks: { '2026-10-20': { color: 'red', label: 'Deadline' } } });
    const panel = await open(s, '2026-10-20');
    const label = part(panel, 'spellbook-mark-label');
    expect(label.value).toBe('Deadline');

    label.focus();
    label.value = 'Dead';
    s.host.emit('data'); // something else changes while the writer types
    await settle(s);
    expect(label.value).toBe('Dead');

    // Another day has its own label.
    await open(s, '2026-10-21');
    expect(label.value).toBe('');
  });

  it('removes the mark, and offers that only when there is one', async () => {
    const s = await stagePlanner({ marks: { '2026-10-20': { color: 'red', label: 'Deadline' }, '2026-10-22': { color: 'blue' } } });
    const panel = await open(s, '2026-10-20');
    const remove = part(panel, 'spellbook-mark-remove');
    expect(remove.text).toBe('Remove mark');
    expect(remove.disabled).toBe(false);
    click(remove);
    await settle(s);
    expect(s.host.stored).toEqual({ '2026-10-22': { color: 'blue' } });
    expect(remove.disabled).toBe(true);
    expect(part(panel, 'spellbook-mark-label').value).toBe('');
    expect(cellOf(s.pane, '2026-10-20').hasClass('spellbook-has-mark')).toBe(false);
  });

  it('refuses to write over a day whose stored value is not a mark, and says why', async () => {
    const stored = { '2026-10-20': 'party' };
    const s = await stagePlanner({ marks: stored });
    const panel = await open(s, '2026-10-20');
    click(swatch(panel, 'red'));
    await settle(s);
    expect(s.host.stored).toEqual(stored);
    expect(notices()).toHaveLength(1);
    expect(notices()[0]).toMatch(/The mark for 2026-10-20 could not be read/);
  });

  it('offers no change when the marks as a whole could not be read', async () => {
    const s = await stagePlanner({ marks: 'not marks at all' });
    const panel = await open(s, '2026-10-20');
    expect(panel.withClass('spellbook-mark-swatch').every((button) => button.disabled)).toBe(true);
    expect(part(panel, 'spellbook-mark-label').disabled).toBe(true);
    expect(part(panel, 'spellbook-mark-remove').disabled).toBe(true);
    expect(part(panel, 'spellbook-detail-locked').text).toMatch(/could not be read/);
    expect(s.host.stored).toBe('not marks at all');
  });

  it('tells the writer when the project note could not be written', async () => {
    const complaints = vi.spyOn(console, 'error').mockImplementation(() => {});
    const s = await stagePlanner();
    const panel = await open(s, '2026-10-20');
    s.host.failNext = 'the disk is full';
    click(swatch(panel, 'red'));
    await settle(s);
    expect(notices()).toEqual(['"Mark colour" did not work: the disk is full']);
    expect(complaints).toHaveBeenCalled();
    expect(s.host.stored).toBeUndefined();
    // The next try works.
    click(swatch(panel, 'red'));
    await settle(s);
    expect(s.host.stored).toEqual({ '2026-10-20': { color: 'red' } });
  });

  it('makes one change after another, in the order they were asked for', async () => {
    const s = await stagePlanner();
    const panel = await open(s, '2026-10-20');
    const label = part(panel, 'spellbook-mark-label');
    label.value = 'Launch';
    label.fire('change');
    click(swatch(panel, 'purple'));
    await settle(s);
    expect(s.host.stored).toEqual({ '2026-10-20': { label: 'Launch', color: 'purple' } });
  });
});

describe('a project that cannot be changed', () => {
  it('shows everything and offers no way to change it', async () => {
    const s = await stagePlanner({
      todo: TODO,
      marks: { '2026-10-20': { color: 'red', label: 'Deadline' } },
      setup: (host) => {
        host.readOnly = true;
      },
    });
    const panel = await open(s, '2026-10-20');
    expect(boxOf(part(panel, 'spellbook-detail-todos').children[0] as FakeElement).disabled).toBe(true);
    expect(unused(part(panel, 'spellbook-detail-add'))).toBe(true);
    expect(panel.withClass('spellbook-mark-swatch').every((button) => button.disabled)).toBe(true);
    expect(part(panel, 'spellbook-mark-label').value).toBe('Deadline');
    expect(part(panel, 'spellbook-mark-label').disabled).toBe(true);
    expect(part(panel, 'spellbook-detail-locked').text).toMatch(/read-only/);
  });
});

describe('the keyboard in the month', () => {
  const stops = (pane: FakeElement): FakeElement[] => pane.withClass('spellbook-day').filter((cell) => cell.attrs['tabindex'] === 0);

  it('makes one day a stop for the Tab key: today', async () => {
    const { pane } = await stagePlanner();
    expect(stops(pane)).toEqual([cellOf(pane, TODAY)]);
  });

  it('goes a day or a week further with the arrow keys', async () => {
    const s = await stagePlanner();
    key(cellOf(s.pane, TODAY), 'ArrowRight');
    expect(fakeDocument.activeElement).toBe(cellOf(s.pane, '2026-10-14'));
    expect(stops(s.pane)).toEqual([cellOf(s.pane, '2026-10-14')]);
    key(cellOf(s.pane, '2026-10-14'), 'ArrowDown');
    expect(fakeDocument.activeElement).toBe(cellOf(s.pane, '2026-10-21'));
    key(cellOf(s.pane, '2026-10-21'), 'ArrowLeft');
    key(cellOf(s.pane, '2026-10-20'), 'ArrowUp');
    expect(fakeDocument.activeElement).toBe(cellOf(s.pane, '2026-10-13'));
    // The arrows moved the keyboard; no day was opened by them.
    expect(detailOpen(s.pane)).toBe(false);
  });

  it('takes the month along when the keyboard goes past what is shown', async () => {
    const s = await stagePlanner();
    key(cellOf(s.pane, '2026-10-31'), 'ArrowRight');
    expect(monthName(s.pane)).toBe('November 2026');
    expect(fakeDocument.activeElement).toBe(cellOf(s.pane, '2026-11-01'));
    key(cellOf(s.pane, '2026-11-01'), 'ArrowUp');
    expect(monthName(s.pane)).toBe('October 2026');
    expect(fakeDocument.activeElement).toBe(cellOf(s.pane, '2026-10-25'));
  });

  it('goes the other way sideways in an app that reads right to left', async () => {
    const s = await stagePlanner();
    s.pane.setAttr('dir', 'rtl');
    key(cellOf(s.pane, TODAY), 'ArrowLeft');
    expect(fakeDocument.activeElement).toBe(cellOf(s.pane, '2026-10-14'));
    key(cellOf(s.pane, '2026-10-14'), 'ArrowRight');
    expect(fakeDocument.activeElement).toBe(cellOf(s.pane, TODAY));
  });

  it('leaves other keys, and arrows held with a modifier, alone', async () => {
    const s = await stagePlanner();
    const event = key(cellOf(s.pane, TODAY), 'ArrowRight', { ctrlKey: true });
    expect(event.defaultPrevented).toBe(false);
    expect(key(cellOf(s.pane, TODAY), 'a').defaultPrevented).toBe(false);
    expect(key(cellOf(s.pane, TODAY), 'ArrowDown').defaultPrevented).toBe(true);
  });
});
