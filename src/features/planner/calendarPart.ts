// The calendar half of the planner.
//
//   head     the month's name, Previous, Next and Today
//   month    one cell for each day: its number, a tint for the words written
//            that day, the two word numbers when the cell is wide enough, a
//            dot for each to-do due, and the day's mark in a corner
//   detail   opens when a day is tapped: the date, its words, the to-dos due
//            that day, a field to add one, and the mark's colour and label
//   numbers  totals, streak, average and today's target, as far as the host
//            gives them
//
// The month, its days, the tint and everything about to-dos and marks come
// from the engine (src/core/planner). This file only draws.
//
// The 42 cells are built once and then kept: a drawing repaints only the
// cells that show something else than before. Going to another month is
// therefore the same work as one to-do changing, a few cells at most.
//
// Words per day are asked of the host whenever the month changes, and again
// when the host says they changed. They arrive a moment later: the month is
// drawn at once without them, and tinted when they are there.
//
// Text in any language: the label of a mark is the writer's own text, and the
// one thing in a cell that takes its own direction. Day numbers, word numbers
// and dots stay where they are in every language.

import { addDays } from '../../core/dates';
import {
  MARK_COLORS,
  WEEKDAY_NAMES,
  WEEKDAY_SHORT_NAMES,
  addTask,
  dayTitle,
  monthGrid,
  monthOf,
  monthTitle,
  nextMonth,
  previousMonth,
  removeMark,
  setMark,
  setTaskDone,
  summariseDays,
} from '../../core/planner';
import type {
  CalendarDay,
  DaySummary,
  DayWords,
  DayWordsSource,
  MarkColor,
  MonthGrid,
  TintLevel,
  TodoTask,
  YearMonth,
} from '../../core/planner';
import { showIcon } from '../../ui/icons';
import { isInputMethodKey } from '../../ui/keys';
import type { PlannerStats } from './plannerHost';
import {
  DETAIL_BESIDE_FROM,
  DETAIL_UNDER_BELOW,
  LABELS_BELOW,
  LABELS_FROM,
  NUMBERS_BELOW,
  NUMBERS_FROM,
  TINT_CLASSES,
  colorName,
  compactWords,
  dayDots,
  describeDay,
  describeWords,
  isWideEnough,
  markClass,
  statLines,
} from './plannerModel';
import { buildTodoRow, iconButton, ownerOf, readsRightToLeft, textButton } from './plannerParts';
import type { PlannerFrame, PlannerOwner } from './plannerParts';

/** The most weeks a month can touch, and the days in a week. */
const WEEKS = 6;
const DAYS = 7;

/** The class of a mark that has a label but no colour. */
const PLAIN_MARK_CLASS = 'spellbook-mark-plain';
/** On something that is there but has nothing to show at the moment. */
const UNUSED_CLASS = 'spellbook-is-unused';

/** How many of the notes about marks that could not be read are spelled out. */
const NOTES_SHOWN = 3;
/** The longest label a mark is given from this screen. */
const LABEL_LENGTH = 40;

const NO_WORDS: ReadonlyMap<string, DayWords> = new Map<string, DayWords>();

/** One day's cell. Built once; `painted` remembers what it shows. */
interface Cell {
  readonly el: HTMLButtonElement;
  readonly number: HTMLElement;
  readonly manuscript: HTMLElement;
  readonly all: HTMLElement;
  readonly todos: HTMLElement;
  readonly label: HTMLElement;
  /** The day the cell stands for; "" while it is not in use. */
  date: string;
  /** Everything the cell shows, as one piece of text to compare with. */
  painted: string;
  tint: TintLevel;
  /** The class it carries for its mark, if any. */
  mark: string | null;
  /** What its dots were last drawn for. */
  dots: string;
}

interface DetailEls {
  readonly root: HTMLElement;
  readonly title: HTMLElement;
  readonly words: HTMLElement;
  readonly manuscript: HTMLElement;
  readonly all: HTMLElement;
  readonly list: HTMLElement;
  readonly empty: HTMLElement;
  readonly add: HTMLElement;
  readonly addInput: HTMLInputElement;
  readonly swatches: Map<MarkColor, HTMLButtonElement>;
  readonly label: HTMLInputElement;
  readonly remove: HTMLButtonElement;
  readonly locked: HTMLElement;
}

interface Els {
  readonly root: HTMLElement;
  readonly scroll: HTMLElement;
  readonly title: HTMLElement;
  readonly weeks: HTMLElement;
  readonly notes: HTMLElement;
  readonly stats: HTMLElement;
  readonly detail: DetailEls;
}

export class CalendarPart {
  private readonly owner: PlannerOwner;
  private readonly els: Els;
  private readonly cells: Cell[] = [];
  private readonly cellByEl = new Map<HTMLElement, Cell>();
  private readonly weekRows: HTMLElement[] = [];
  private readonly weekdayEls: HTMLElement[] = [];
  /** The rows of the to-dos in the day's detail, with the to-do each stands for. */
  private readonly detailRows = new Map<HTMLElement, TodoTask>();

  private frame: PlannerFrame | null = null;
  private destroyed = false;

  private projectKey: string | null = null;
  /** The month on show. */
  private month: YearMonth | null = null;
  private grid: MonthGrid | null = null;
  /** What `grid` was laid out for. */
  private gridFor = '';
  /** The first day of the week the headings were written for. */
  private weekdaysFor = -1;
  private summaries = new Map<string, DaySummary>();

  private words: ReadonlyMap<string, DayWords> = NO_WORDS;
  /** The source the words were last asked of. */
  private source: DayWordsSource | null = null;
  private stats: PlannerStats | null = null;
  /** The project and the days the words were last asked for. */
  private loadedFor = '';
  /** Counts the times the words were asked for, so that a late answer to an old question is not used. */
  private request = 0;

  /** The day whose detail is open. */
  private selected: string | null = null;
  /** The day the Tab key stops at, and the arrow keys move from. */
  private cursor: string | null = null;

  private beside = false;
  private numbers = false;
  private labels = false;

  private shownTitle = '';
  private statsShown = '';
  private notesShown = '';
  /** The day the detail was last drawn for. */
  private detailFor: string | null = null;
  /** The to-dos the detail's list was last drawn for; null to draw it anew whatever they are. */
  private detailTodos: string | null = null;
  private detailWords = '';
  /** The label that was last sent to be stored, with its day. */
  private labelSent = '';

  constructor(parent: HTMLElement, owner: PlannerOwner) {
    this.owner = owner;
    const root = parent.createDiv({ cls: 'spellbook-calendar', attr: { role: 'tabpanel', 'aria-label': 'Calendar' } });
    const scroll = root.createDiv({ cls: 'spellbook-calendar-scroll spellbook-planner-scroll' });
    const layout = scroll.createDiv({ cls: 'spellbook-calendar-layout' });

    const main = layout.createDiv({ cls: 'spellbook-calendar-main' });
    const head = main.createDiv({ cls: 'spellbook-calendar-head' });
    const title = head.createDiv({ cls: 'spellbook-calendar-title', attr: { role: 'heading', 'aria-level': 2, 'aria-live': 'polite' } });
    iconButton(head, 'spellbook-calendar-step', 'Previous month', ['chevron-left'], () => {
      this.step(-1);
    });
    iconButton(head, 'spellbook-calendar-step', 'Next month', ['chevron-right'], () => {
      this.step(1);
    });
    textButton(head, 'spellbook-calendar-today', 'Today', () => {
      this.goToToday();
    });

    const month = main.createDiv({ cls: 'spellbook-calendar-grid' });
    // Every cell says its whole date itself; the headings are for the eye.
    const weekdays = month.createDiv({ cls: 'spellbook-calendar-weekdays', attr: { 'aria-hidden': 'true' } });
    for (let column = 0; column < DAYS; column++) {
      this.weekdayEls.push(weekdays.createDiv({ cls: 'spellbook-calendar-weekday' }));
    }
    const weeks = month.createDiv({ cls: 'spellbook-calendar-weeks' });
    for (let week = 0; week < WEEKS; week++) {
      const row = weeks.createDiv({ cls: 'spellbook-calendar-week' });
      this.weekRows.push(row);
      for (let column = 0; column < DAYS; column++) this.addCell(row);
    }
    // One listener each for all the cells.
    weeks.addEventListener('click', (event) => {
      const cell = ownerOf(event.target, weeks, this.cellByEl);
      if (cell && cell.date !== '') this.choose(cell.date);
    });
    weeks.addEventListener('keydown', (event) => {
      this.onKey(event);
    });
    const notes = main.createDiv({ cls: `spellbook-calendar-notes ${UNUSED_CLASS}` });

    const detail = this.buildDetail(layout);
    // Beside the month there is always something in the detail's place, so
    // that the month does not change its width when a day is tapped.
    layout.createDiv({ cls: 'spellbook-detail-hint', text: 'Choose a day to see what is due, and to mark it.' });
    const stats = layout.createDiv({ cls: `spellbook-calendar-stats ${UNUSED_CLASS}` });

    this.els = { root, scroll, title, weeks, notes, stats, detail };
  }

  /** What the view should watch the size of: the part itself, and the month in it. */
  observed(): HTMLElement[] {
    return [this.els.root, this.els.weeks];
  }

  /** The view is closing. Answers that are still on their way are not used. */
  destroy(): void {
    this.destroyed = true;
    this.request++;
    this.frame = null;
    this.cellByEl.clear();
    this.detailRows.clear();
  }

  /**
   * Choose the layouts that fit, going by measured widths: the day's detail
   * beside the month or under it, and how much a day's cell has room for.
   */
  measure(): void {
    const { root, weeks } = this.els;
    this.beside = isWideEnough(root.clientWidth, this.beside, DETAIL_BESIDE_FROM, DETAIL_UNDER_BELOW);
    root.toggleClass('spellbook-detail-beside', this.beside);
    const width = weeks.clientWidth;
    this.numbers = isWideEnough(width, this.numbers, NUMBERS_FROM, NUMBERS_BELOW);
    root.toggleClass('spellbook-shows-numbers', this.numbers);
    this.labels = isWideEnough(width, this.labels, LABELS_FROM, LABELS_BELOW);
    root.toggleClass('spellbook-shows-labels', this.labels);
  }

  /** Draw for a new picture of the project; null when no project is open. */
  update(frame: PlannerFrame | null): void {
    if (this.destroyed) return;
    this.frame = frame;
    if (!frame) {
      // Nothing is on show: an answer that is still on its way belongs to nobody.
      this.request++;
      this.projectKey = null;
      return;
    }
    if (frame.project.key !== this.projectKey) {
      // Another project: this month, no day chosen, nothing known yet.
      this.projectKey = frame.project.key;
      this.month = null;
      this.gridFor = '';
      this.selected = null;
      this.cursor = null;
      this.words = NO_WORDS;
      this.stats = null;
      this.loadedFor = '';
    }
    this.month ??= monthOf(frame.today) ?? { year: 2000, month: 1 };
    this.layGrid();
    this.draw();
  }

  /** The host says the word counts changed: ask again. What is shown stays until the answer is there. */
  wordsChanged(): void {
    if (this.destroyed || !this.frame || !this.grid) return;
    this.load(this.loadedFor);
  }

  // ---------------------------------------------------------------- the month

  private addCell(row: HTMLElement): void {
    const el = row.createEl('button', {
      cls: `spellbook-day ${TINT_CLASSES[0]}`,
      // Only one cell at a time is a stop for the Tab key (see draw).
      attr: { type: 'button', tabindex: -1 },
    });
    el.createSpan({ cls: 'spellbook-day-corner' });
    const number = el.createSpan({ cls: 'spellbook-day-number' });
    // Numbers read left to right in every language.
    const words = el.createSpan({ cls: 'spellbook-day-words', attr: { dir: 'ltr' } });
    const manuscript = words.createSpan({ cls: 'spellbook-day-manuscript' });
    const all = words.createSpan({ cls: 'spellbook-day-all' });
    const todos = el.createSpan({ cls: 'spellbook-day-todos' });
    // The label of a mark is the writer's own text.
    const label = el.createSpan({ cls: 'spellbook-day-label', attr: { dir: 'auto' } });
    const cell: Cell = { el, number, manuscript, all, todos, label, date: '', painted: '', tint: 0, mark: null, dots: '' };
    this.cells.push(cell);
    this.cellByEl.set(el, cell);
  }

  /**
   * Lay out the month on show, when it is another month than last time (or
   * the weeks start on another day), and ask for its words when they were not
   * asked for yet.
   */
  private layGrid(): void {
    const frame = this.frame;
    const month = this.month;
    if (!frame || !month) return;
    const key = `${month.year}-${month.month}-${frame.firstDayOfWeek}`;
    if (key !== this.gridFor || !this.grid) {
      const grid = monthGrid(month.year, month.month, frame.firstDayOfWeek);
      this.grid = grid;
      // The engine tidies what it is given; its own year and month count from here on.
      this.month = { year: grid.year, month: grid.month };
      this.gridFor = `${grid.year}-${grid.month}-${frame.firstDayOfWeek}`;
      // A day that is no longer on show cannot have its detail open.
      if (this.selected !== null && (this.selected < grid.from || this.selected > grid.to)) this.selected = null;
    }
    const grid = this.grid;
    const wanted = `${frame.project.key}\n${grid.year}-${grid.month}\n${grid.from}\n${grid.to}`;
    if (wanted !== this.loadedFor || frame.words !== this.source) this.load(wanted);
  }

  /** Ask the host for the words of the days on show and for the numbers under the month. */
  private load(wanted: string): void {
    const frame = this.frame;
    const grid = this.grid;
    if (!frame || !grid) return;
    if (wanted !== this.loadedFor) {
      // Other days: what was known is about days that are no longer on show.
      this.words = NO_WORDS;
      if (this.stats) this.stats = { ...this.stats, month: null };
    }
    this.loadedFor = wanted;
    this.source = frame.words;
    const token = ++this.request;
    const current = (): boolean => !this.destroyed && token === this.request;

    const source = frame.words;
    if (source) {
      Promise.resolve()
        .then(() => source.wordsByDay(grid.from, grid.to))
        .then(
          (words) => {
            if (!current()) return;
            this.words = typeof words?.get === 'function' ? words : NO_WORDS;
            this.draw();
          },
          (error: unknown) => {
            console.error('Spellbook: the words of each day could not be read', error);
          },
        );
    } else {
      this.words = NO_WORDS;
    }

    const host = this.owner.host;
    if (typeof host.stats === 'function') {
      Promise.resolve()
        .then(() => host.stats?.({ year: grid.year, month: grid.month }) ?? null)
        .then(
          (stats) => {
            if (!current()) return;
            this.stats = stats;
            this.drawStats();
          },
          (error: unknown) => {
            console.error('Spellbook: the numbers under the calendar could not be read', error);
          },
        );
    } else {
      this.stats = null;
    }
  }

  private step(by: 1 | -1): void {
    const month = this.month;
    if (!month) return;
    this.show(by === 1 ? nextMonth(month) : previousMonth(month));
  }

  private goToToday(): void {
    const frame = this.frame;
    const month = frame ? monthOf(frame.today) : null;
    if (!frame || !month) return;
    this.cursor = frame.today;
    this.show(month);
  }

  private show(month: YearMonth): void {
    this.month = month;
    this.layGrid();
    this.draw();
  }

  /** The day the Tab key stops at: where the keyboard was last, else the chosen day, today, or the 1st. */
  private cursorIn(grid: MonthGrid, today: string): string {
    const shown = (date: string | null): date is string => date !== null && date >= grid.from && date <= grid.to;
    if (shown(this.cursor)) return this.cursor;
    if (shown(this.selected)) return this.selected;
    if (shown(today)) return today;
    for (const week of grid.weeks) {
      for (const day of week) if (day.inMonth) return day.date;
    }
    return grid.from;
  }

  private draw(): void {
    const frame = this.frame;
    const grid = this.grid;
    if (!frame || !grid || this.destroyed) return;

    const title = monthTitle(grid.year, grid.month);
    if (title !== this.shownTitle) {
      this.shownTitle = title;
      this.els.title.setText(title);
    }
    if (grid.firstDayOfWeek !== this.weekdaysFor) {
      this.weekdaysFor = grid.firstDayOfWeek;
      grid.weekdays.forEach((weekday, column) => {
        const heading = this.weekdayEls[column];
        heading?.setText(WEEKDAY_SHORT_NAMES[weekday] ?? '');
        heading?.setAttr('title', WEEKDAY_NAMES[weekday] ?? '');
      });
    }

    const summaries = summariseDays(grid.from, grid.to, this.words, frame.todo, frame.marks.marks);
    this.summaries = summaries;
    const withWords = frame.words !== null;
    const cursor = this.cursorIn(grid, frame.today);
    let at = 0;
    for (const week of grid.weeks) {
      for (const day of week) {
        const cell = this.cells[at++];
        const summary = summaries.get(day.date);
        if (cell && summary) this.paint(cell, day, summary, frame.today, cursor, withWords);
      }
    }
    // A month that touches fewer than six weeks leaves the last rows out.
    for (; at < this.cells.length; at++) {
      const cell = this.cells[at];
      if (cell) cell.date = '';
    }
    this.weekRows.forEach((row, week) => {
      row.toggleClass(UNUSED_CLASS, week >= grid.weeks.length);
    });

    this.drawNotes(frame.marks.notes);
    this.drawStats();
    this.drawDetail();
  }

  /** Bring one cell up to date. Touches the screen only when the cell shows something else than before. */
  private paint(cell: Cell, day: CalendarDay, summary: DaySummary, today: string, cursor: string, withWords: boolean): void {
    const isToday = day.date === today;
    const isSelected = day.date === this.selected;
    const isCursor = day.date === cursor;
    const dots = dayDots(summary);
    const mark = summary.mark;
    const written = withWords && (summary.manuscriptWords !== 0 || summary.allWords !== 0);
    const state = JSON.stringify([
      day.date,
      day.inMonth,
      isToday,
      isSelected,
      isCursor,
      summary.tint,
      written ? [summary.manuscriptWords, summary.allWords] : null,
      [dots.tick, dots.dots, dots.more],
      mark ? [mark.color, mark.label] : null,
    ]);
    cell.date = day.date;
    if (state === cell.painted) return;
    cell.painted = state;

    const el = cell.el;
    el.toggleClass('spellbook-is-outside', !day.inMonth);
    el.toggleClass('spellbook-is-today', isToday);
    el.toggleClass('spellbook-is-selected', isSelected);
    el.setAttr('aria-pressed', isSelected ? 'true' : 'false');
    el.setAttr('aria-current', isToday ? 'date' : null);
    el.setAttr('tabindex', isCursor ? 0 : -1);
    el.setAttr('aria-label', describeDay(summary, isToday, withWords));

    if (cell.tint !== summary.tint) {
      el.removeClass(TINT_CLASSES[cell.tint]);
      el.addClass(TINT_CLASSES[summary.tint]);
      cell.tint = summary.tint;
    }
    const markCls = mark === null ? null : mark.color === null ? PLAIN_MARK_CLASS : markClass(mark.color);
    if (markCls !== cell.mark) {
      if (cell.mark !== null) el.removeClass(cell.mark);
      if (markCls !== null) el.addClass(markCls);
      el.toggleClass('spellbook-has-mark', markCls !== null);
      cell.mark = markCls;
    }

    cell.number.setText(String(day.day));
    cell.manuscript.setText(written ? compactWords(summary.manuscriptWords) : '');
    cell.all.setText(written ? compactWords(summary.allWords) : '');
    cell.label.setText(mark?.label ?? '');

    const dotsKey = `${dots.tick}|${dots.dots}|${dots.more}`;
    if (dotsKey !== cell.dots) {
      cell.dots = dotsKey;
      cell.todos.empty();
      if (dots.tick) showIcon(cell.todos.createSpan({ cls: 'spellbook-day-tick' }), 'check');
      for (let dot = 0; dot < dots.dots; dot++) cell.todos.createSpan({ cls: 'spellbook-day-dot' });
      if (dots.more > 0) cell.todos.createSpan({ cls: 'spellbook-day-more', text: `+${dots.more}` });
    }
  }

  /** What could not be read of the day marks, said under the month. Drawn anew only when it says something else. */
  private drawNotes(notes: readonly string[]): void {
    const key = notes.join('\n');
    if (key === this.notesShown) return;
    this.notesShown = key;
    const box = this.els.notes;
    box.empty();
    box.toggleClass(UNUSED_CLASS, notes.length === 0);
    for (const note of notes.slice(0, NOTES_SHOWN)) {
      // A note may quote what the writer stored.
      box.createDiv({ cls: 'spellbook-calendar-note', text: note, attr: { dir: 'auto' } });
    }
    if (notes.length > NOTES_SHOWN) {
      box.createDiv({ cls: 'spellbook-calendar-note', text: `And ${notes.length - NOTES_SHOWN} more like these.` });
    }
  }

  /** The numbers under the month: one line for each number the host gave, none for the others. */
  private drawStats(): void {
    const grid = this.grid;
    if (!grid || this.destroyed) return;
    const lines = statLines(this.frame ? this.stats : null, monthTitle(grid.year, grid.month));
    const key = JSON.stringify(lines);
    if (key === this.statsShown) return;
    this.statsShown = key;
    const box = this.els.stats;
    box.empty();
    box.toggleClass(UNUSED_CLASS, lines.length === 0);
    for (const line of lines) {
      const item = box.createDiv({ cls: `spellbook-stat spellbook-stat-${line.id}` });
      item.createDiv({ cls: 'spellbook-stat-label', text: line.label });
      item.createDiv({ cls: 'spellbook-stat-value', text: line.value, attr: { dir: 'ltr' } });
      if (line.detail !== '') item.createDiv({ cls: 'spellbook-stat-detail', text: line.detail });
      if (line.met !== undefined) item.toggleClass('spellbook-is-met', line.met);
    }
  }

  // ------------------------------------------------------------- the keyboard

  /**
   * An arrow key while the keyboard is on a day: go a day or a week further.
   * Past the edge of what is shown, the month follows. Enter and Space are
   * the button's own: they open the day.
   */
  private onKey(event: KeyboardEvent): void {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const cell = ownerOf(event.target, this.els.weeks, this.cellByEl);
    if (!cell || cell.date === '') return;
    let days: number;
    switch (event.key) {
      case 'ArrowUp':
        days = -DAYS;
        break;
      case 'ArrowDown':
        days = DAYS;
        break;
      case 'ArrowRight':
      case 'ArrowLeft':
        // In an app that reads right to left, the next day is to the left.
        days = (event.key === 'ArrowRight') !== readsRightToLeft(this.els.root) ? 1 : -1;
        break;
      default:
        return;
    }
    event.preventDefault();
    this.moveCursor(addDays(cell.date, days));
  }

  private moveCursor(date: string): void {
    const grid = this.grid;
    if (!grid) return;
    this.cursor = date;
    if (date < grid.from || date > grid.to) {
      const month = monthOf(date);
      if (!month) return;
      this.month = month;
      this.layGrid();
    }
    this.draw();
    this.cells.find((cell) => cell.date === date)?.el.focus();
  }

  // --------------------------------------------------------- the day's detail

  private buildDetail(parent: HTMLElement): DetailEls {
    const root = parent.createDiv({ cls: 'spellbook-day-detail', attr: { role: 'region', 'aria-label': 'Day' } });
    const head = root.createDiv({ cls: 'spellbook-detail-head' });
    const title = head.createDiv({ cls: 'spellbook-detail-title', attr: { role: 'heading', 'aria-level': 3, 'aria-live': 'polite' } });
    iconButton(head, 'spellbook-detail-close', 'Close day', ['x'], () => {
      this.choose(null);
    });

    const words = root.createDiv({ cls: 'spellbook-detail-words' });
    const manuscript = words.createDiv({ cls: 'spellbook-detail-manuscript' });
    const all = words.createDiv({ cls: 'spellbook-detail-all' });

    const due = root.createDiv({ cls: 'spellbook-detail-section' });
    due.createDiv({ cls: 'spellbook-detail-heading', text: 'To-dos due' });
    const list = due.createDiv({ cls: 'spellbook-detail-todos', attr: { role: 'list' } });
    list.addEventListener('change', (event) => {
      const task = ownerOf(event.target, list, this.detailRows);
      if (task) this.tick(task);
    });
    const empty = due.createDiv({ cls: 'spellbook-detail-empty', text: 'Nothing is due this day.' });
    const add = due.createDiv({ cls: 'spellbook-detail-add' });
    const addInput = add.createEl('input', {
      cls: 'spellbook-todo-input',
      attr: {
        type: 'text',
        // The text may be in any language; let it pick its own direction.
        dir: 'auto',
        placeholder: 'Add a to-do for this day',
        'aria-label': 'New to-do for this day',
        enterkeyhint: 'done',
      },
    });
    addInput.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' || isInputMethodKey(event)) return;
      event.preventDefault();
      this.addForDay();
    });
    textButton(add, 'spellbook-todo-add-button', 'Add', () => {
      this.addForDay();
    });

    const marking = root.createDiv({ cls: 'spellbook-detail-section' });
    marking.createDiv({ cls: 'spellbook-detail-heading', text: 'Mark' });
    const colors = marking.createDiv({ cls: 'spellbook-mark-colors', attr: { role: 'group', 'aria-label': 'Mark colour' } });
    const swatches = new Map<MarkColor, HTMLButtonElement>();
    for (const color of MARK_COLORS) {
      const swatch = colors.createEl('button', {
        cls: `spellbook-mark-swatch ${markClass(color)}`,
        attr: { type: 'button', 'aria-label': colorName(color), 'aria-pressed': 'false' },
      });
      swatch.addEventListener('click', () => {
        this.setColor(color);
      });
      swatches.set(color, swatch);
    }
    const label = marking.createEl('input', {
      cls: 'spellbook-mark-label',
      attr: {
        type: 'text',
        dir: 'auto',
        placeholder: 'Label',
        'aria-label': 'Mark label',
        maxlength: LABEL_LENGTH,
        enterkeyhint: 'done',
      },
    });
    // Stored when the writer leaves the field or presses Enter, not at every letter.
    label.addEventListener('change', () => {
      this.commitLabel();
    });
    label.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' || isInputMethodKey(event)) return;
      event.preventDefault();
      this.commitLabel();
    });
    const remove = textButton(marking, 'spellbook-mark-remove', 'Remove mark', () => {
      this.takeMarkOff();
    });
    const locked = marking.createDiv({ cls: `spellbook-detail-locked ${UNUSED_CLASS}` });

    return { root, title, words, manuscript, all, list, empty, add, addInput, swatches, label, remove, locked };
  }

  /** A day was tapped: open its detail. Tapping the day that is open, or the detail's Close, shuts it. */
  private choose(date: string | null): void {
    this.selected = date === null || date === this.selected ? null : date;
    if (date !== null) this.cursor = date;
    this.draw();
    if (this.selected !== null && !this.beside) this.revealDetail();
  }

  /**
   * Under the month, the detail may open below what can be seen. Scroll the
   * calendar, and only the calendar, so that as much of it as fits shows.
   */
  private revealDetail(): void {
    const scroll = this.els.scroll;
    const box = scroll.getBoundingClientRect();
    const at = this.els.detail.root.getBoundingClientRect();
    if (!(box.height > 0) || !(at.height > 0) || at.bottom <= box.bottom) return;
    scroll.scrollTop += Math.min(at.bottom - box.bottom, Math.max(0, at.top - box.top));
  }

  private drawDetail(): void {
    const frame = this.frame;
    const date = this.selected;
    const detail = this.els.detail;
    const summary = date === null ? undefined : this.summaries.get(date);
    this.els.root.toggleClass('spellbook-has-detail', summary !== undefined);
    if (!frame || date === null || !summary) {
      this.detailFor = null;
      return;
    }
    const fresh = date !== this.detailFor;
    if (fresh) {
      this.detailFor = date;
      this.detailTodos = null;
      this.labelSent = '';
      detail.title.setText(dayTitle(date));
      detail.addInput.value = '';
    }
    const locked = frame.project.readOnly;

    const withWords = frame.words !== null;
    const words = withWords ? `${summary.manuscriptWords}|${summary.allWords}` : '';
    if (fresh || words !== this.detailWords) {
      this.detailWords = words;
      detail.words.toggleClass(UNUSED_CLASS, !withWords);
      detail.manuscript.setText(withWords ? `${describeWords(summary.manuscriptWords)} in the manuscript` : '');
      detail.all.setText(withWords ? `${describeWords(summary.allWords)} in all notes` : '');
    }

    const todos = `${locked}\n${summary.tasks.map((task) => `${task.line}\n${task.raw}`).join('\n')}`;
    if (todos !== this.detailTodos) {
      this.detailTodos = todos;
      detail.list.empty();
      this.detailRows.clear();
      for (const task of summary.tasks) {
        const row = buildTodoRow(detail.list, task, locked);
        row.el.setAttr('role', 'listitem');
        this.detailRows.set(row.el, task);
      }
      detail.empty.toggleClass(UNUSED_CLASS, summary.tasks.length > 0);
    }
    detail.add.toggleClass(UNUSED_CLASS, locked);

    const mark = summary.mark;
    const canMark = !locked && frame.marks.writable;
    for (const [color, swatch] of detail.swatches) {
      const chosen = mark?.color === color;
      swatch.toggleClass('spellbook-is-chosen', chosen);
      swatch.setAttr('aria-pressed', chosen ? 'true' : 'false');
      swatch.disabled = !canMark;
    }
    // A field that is being typed in is left alone: what the writer types counts.
    const typing = !fresh && detail.label.ownerDocument.activeElement === detail.label;
    if (!typing) detail.label.value = mark?.label ?? '';
    detail.label.disabled = !canMark;
    detail.remove.disabled = !canMark || mark === null;
    const why = canMark
      ? ''
      : locked
        ? 'This project is read-only, so its days cannot be marked here.'
        : 'The day marks of this project could not be read, so they cannot be changed here.';
    detail.locked.setText(why);
    detail.locked.toggleClass(UNUSED_CLASS, why === '');
  }

  // ------------------------------------------------------- changing something

  private tick(task: TodoTask): void {
    void this.owner.editTodo(task.done ? 'Untick' : 'Tick', (text) => setTaskDone(text, task, !task.done));
  }

  private addForDay(): void {
    const date = this.selected;
    if (date === null) return;
    const input = this.els.detail.addInput;
    const title = input.value;
    void this.owner
      .editTodo('Add', (text) => addTask(text, { title, due: date }))
      .then((result) => {
        // Cleared only when it is still what was added: the writer may have typed on.
        if (result?.status === 'done' && input.value === title) input.value = '';
      });
  }

  /** A colour was tapped: the day gets it. Tapping the colour it has takes the colour away. */
  private setColor(color: MarkColor): void {
    const date = this.selected;
    if (date === null) return;
    const now = this.summaries.get(date)?.mark?.color ?? null;
    void this.owner.editMarks('Mark colour', (marks) => setMark(marks, date, { color: now === color ? null : color }));
  }

  private commitLabel(): void {
    const date = this.selected;
    if (date === null) return;
    const label = this.els.detail.label.value;
    // Enter and leaving the field both end up here: one of them is enough.
    const sent = `${date}\n${label}`;
    if (sent === this.labelSent) return;
    this.labelSent = sent;
    void this.owner
      .editMarks('Mark label', (marks) => setMark(marks, date, { label }))
      .then((result) => {
        if (result?.status !== 'done' && this.labelSent === sent) this.labelSent = '';
      });
  }

  private takeMarkOff(): void {
    const date = this.selected;
    if (date === null) return;
    this.labelSent = '';
    void this.owner.editMarks('Remove mark', (marks) => removeMark(marks, date));
  }
}
