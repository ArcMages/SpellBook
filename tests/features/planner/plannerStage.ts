// A stage for testing the planner screen: a stand-in for the host it reads
// from and asks changes of, timers under the test's control, and the view
// itself, opened the way Obsidian opens it. Also: the screen as a test reads
// and taps it.
//
// The stand-in host keeps a "file" (the text of To-do.md) and the stored
// marks, and does what the real host must do: read what is stored, hand it to
// the engine's edit, and store the answer when it is "done".

import { dayTitle } from '../../../src/core/planner';
import type { DayWords, DayWordsSource, MarksEdit, TodoEdit, YearMonth } from '../../../src/core/planner';
import type { PlannerChange, PlannerHost, PlannerProject, PlannerStats } from '../../../src/features/planner/plannerHost';
import { PlannerView, createPlannerView } from '../../../src/features/planner/plannerView';
import type { DragClock } from '../../../src/ui/dragDrop';
import { FakeObsidian } from '../../fakeObsidianApp';
import { ManualTimers } from '../../memoryVault';
import { Menu as StubMenu, Modal as StubModal, Notice as StubNotice, resetFakeDocument } from '../../obsidianStub';
import type { ButtonComponent, FakeElement, FakeEvent, ItemView as StubItemView } from '../../obsidianStub';
import { tick } from '../../storeHarness';

export const TODAY = '2026-10-13';
export const PROJECT_KEY = 'Novel/Novel.md';

/** How long one frame of the test's own clock lasts, in milliseconds. */
export const FRAME_MS = 16;

/** A word log in memory. It remembers what it was asked, and can be made to answer late or not at all. */
export class FakeWords implements DayWordsSource {
  readonly days = new Map<string, DayWords>();
  /** Every question it was asked: "from..to". */
  readonly asked: string[] = [];
  /** Set to hold every answer back until release() is called. */
  hold = false;
  /** Set to make every question fail. */
  broken = false;
  private waiting: Array<() => void> = [];

  set(date: string, manuscript: number, all = manuscript): this {
    this.days.set(date, { manuscript, all });
    return this;
  }

  async wordsByDay(from: string, to: string): Promise<ReadonlyMap<string, DayWords>> {
    this.asked.push(`${from}..${to}`);
    if (this.broken) throw new Error('the word log cannot be read');
    const answer = new Map([...this.days].filter(([date]) => date >= from && date <= to));
    if (this.hold) {
      await new Promise<void>((resolve) => {
        this.waiting.push(resolve);
      });
    }
    return answer;
  }

  /** Let every answer that was held back go. */
  release(): void {
    for (const go of this.waiting.splice(0)) go();
  }
}

/** The plugin, as far as the planner knows it. */
export class FakeHost implements PlannerHost {
  /** The text of To-do.md "on disk". Change it to play another device or the writer's own hand. */
  file = '';
  /** The value stored under the index's "marks" key. */
  stored: unknown = undefined;
  /** Null: no project is open. */
  key: string | null = PROJECT_KEY;
  readOnly = false;
  today = TODAY;
  firstDayOfWeek = 0;
  words: DayWordsSource | null = null;
  /** The numbers under the calendar; null to give none. */
  numbers: PlannerStats | null = null;
  /** Every month the numbers were asked for. */
  readonly statsAsked: YearMonth[] = [];
  /** Set to make the next change of To-do.md or of the marks fail, as a file that cannot be written does. */
  failNext: string | null = null;
  /** How often each thing was asked for. */
  todoEdits = 0;
  marksEdits = 0;
  refreshes = 0;
  opened = 0;
  readonly clock: DragClock;

  /** What the planner was last given to read: it lags behind `file` until the host reads again. */
  private seenText = '';
  private seenMarks: unknown = undefined;
  private listeners = new Set<(change: PlannerChange) => void>();

  constructor(readonly timers: ManualTimers) {
    let frameTime = 0;
    this.clock = {
      setTimer: timers.set,
      nextFrame: (callback) =>
        timers.set(() => {
          frameTime += FRAME_MS;
          callback(frameTime);
        }, FRAME_MS),
    };
  }

  get project(): PlannerProject | null {
    if (this.key === null) return null;
    return { key: this.key, todoText: this.seenText, marks: this.seenMarks, readOnly: this.readOnly };
  }

  stats(month: YearMonth): Promise<PlannerStats | null> {
    this.statsAsked.push(month);
    return Promise.resolve(this.numbers);
  }

  onChange(callback: (change: PlannerChange) => void): () => void {
    this.listeners.add(callback);
    return () => {
      this.listeners.delete(callback);
    };
  }

  /** How many are listening for changes. */
  get listening(): number {
    return this.listeners.size;
  }

  /** Tell the planner that something changed. */
  emit(change: PlannerChange = 'data'): void {
    for (const listener of [...this.listeners]) listener(change);
  }

  /** Read what is stored, as the real host does when a file changes, and say so. */
  sync(): void {
    this.seenText = this.file;
    this.seenMarks = this.stored;
    this.emit('data');
  }

  private failIfAsked(): void {
    const problem = this.failNext;
    this.failNext = null;
    if (problem !== null) throw new Error(problem);
  }

  async applyTodoEdit(edit: (text: string) => TodoEdit): Promise<TodoEdit> {
    this.todoEdits++;
    this.failIfAsked();
    const result = edit(this.file);
    if (result.status === 'done') this.file = result.text;
    this.seenText = this.file;
    this.emit('data');
    return result;
  }

  async applyMarksEdit(edit: (marks: unknown) => MarksEdit): Promise<MarksEdit> {
    this.marksEdits++;
    this.failIfAsked();
    const result = edit(this.stored);
    if (result.status === 'done') this.stored = result.marks;
    this.seenMarks = this.stored;
    this.emit('data');
    return result;
  }

  async refresh(): Promise<void> {
    this.refreshes++;
    this.seenText = this.file;
    this.seenMarks = this.stored;
    this.emit('data');
  }

  openTodoNote(): void {
    this.opened++;
  }
}

export interface PlannerStage {
  host: FakeHost;
  timers: ManualTimers;
  fake: FakeObsidian;
  view: PlannerView;
  /** The view, seen as the stand-in it is built on (open, close). */
  shell: StubItemView;
  /** Obsidian's pane element, which the planner fills. */
  pane: FakeElement;
}

export interface StageOptions {
  /** The text of To-do.md. */
  todo?: string;
  /** The value stored under the index's "marks" key. */
  marks?: unknown;
  /** How wide the pane is, in CSS pixels. Default: 0, which is a pane that cannot be measured yet. */
  width?: number;
  /** Change the host before the view opens. */
  setup?: (host: FakeHost) => void;
}

/** Let everything that is ready to happen, happen: answers from the host, and the drawing that follows. */
export async function settle(s: Pick<PlannerStage, 'timers'>): Promise<void> {
  for (let turn = 0; turn < 4; turn++) {
    await tick();
    s.timers.advance(0);
  }
  await tick();
}

export async function stagePlanner(options: StageOptions = {}): Promise<PlannerStage> {
  const timers = new ManualTimers();
  const host = new FakeHost(timers);
  host.file = options.todo ?? '';
  host.stored = options.marks;
  options.setup?.(host);
  host.sync();
  const fake = new FakeObsidian();
  const leaf = fake.workspace.addLeaf(fake.workspace.rootSplit);
  const view = createPlannerView(leaf as never, host);
  const shell = view as unknown as StubItemView;
  const pane = view.contentEl as unknown as FakeElement;
  pane.clientWidth = options.width ?? 0;
  const made: PlannerStage = { host, timers, fake, view, shell, pane };
  await shell.open();
  await settle(made);
  return made;
}

/** Give the pane, the calendar in it and the month in that a width, and let the view measure. */
export function resize(s: PlannerStage, pane: number, calendar = pane, month = calendar): void {
  s.pane.clientWidth = pane;
  one(s.pane, 'spellbook-calendar').clientWidth = calendar;
  one(s.pane, 'spellbook-calendar-weeks').clientWidth = month;
  s.view.onResize();
}

/** Forget the notices, menus and windows of earlier tests. Call it before each test. */
export function clearScreen(): void {
  StubNotice.shown.length = 0;
  StubMenu.shown.length = 0;
  StubModal.opened.length = 0;
  resetFakeDocument();
}

export const notices = (): string[] => StubNotice.shown.map((notice) => notice.message);

// ------------------------------------------------------- reading the screen

/** The one element with this class inside `pane`, or a failed test. */
export function one(pane: FakeElement, cls: string): FakeElement {
  const found = pane.withClass(cls);
  if (found.length !== 1) throw new Error(`expected one ".${cls}", found ${found.length}`);
  return found[0] as FakeElement;
}

/** The first element with this class inside another, or a failed test. */
export function part(inside: FakeElement, cls: string): FakeElement {
  const found = inside.withClass(cls)[0];
  if (!found) throw new Error(`no ".${cls}" in there`);
  return found;
}

/** True for something the stylesheet takes out of view. */
export function unused(element: FakeElement): boolean {
  return element.hasClass('spellbook-is-unused');
}

/** As if the writer tapped (or clicked) an element; the event travels as in a browser. */
export function click(element: FakeElement, init: Record<string, unknown> = {}): FakeEvent {
  return element.fire('click', { button: 0, ...init });
}

/** As if the writer pressed a key while an element had the keyboard. */
export function key(element: FakeElement, name: string, init: Record<string, unknown> = {}): FakeEvent {
  return element.fire('keydown', { key: name, ...init });
}

/** Whether a tick box is ticked. (The stand-in elements know nothing of boxes; the screen's code sets this.) */
export function ticked(box: FakeElement): boolean {
  return (box as unknown as { checked?: boolean }).checked === true;
}

/** As if the writer ticked or unticked a box: it flips, then says so. */
export function flip(box: FakeElement): void {
  (box as unknown as { checked?: boolean }).checked = !ticked(box);
  box.fire('change');
}

// --- the calendar

/** The cells of the weeks on show, in order. */
export function dayCells(pane: FakeElement): FakeElement[] {
  return pane
    .withClass('spellbook-calendar-week')
    .filter((week) => !unused(week))
    .flatMap((week) => week.children);
}

/** The cell of a day, found by what it says of itself to a screen reader. */
export function cellOf(pane: FakeElement, date: string): FakeElement {
  const title = dayTitle(date);
  const found = dayCells(pane).filter((cell) => {
    const label = String(cell.attrs['aria-label'] ?? '');
    return label === title || label.startsWith(`${title},`);
  });
  if (found.length !== 1) throw new Error(`expected one cell for ${date}, found ${found.length}`);
  return found[0] as FakeElement;
}

/** What a cell shows, as a reader sees it. */
export function cellPicture(cell: FakeElement): {
  number: string;
  manuscript: string;
  all: string;
  dots: number;
  more: string;
  tick: boolean;
  label: string;
  tint: number;
} {
  return {
    number: part(cell, 'spellbook-day-number').text,
    manuscript: part(cell, 'spellbook-day-manuscript').text,
    all: part(cell, 'spellbook-day-all').text,
    dots: cell.withClass('spellbook-day-dot').length,
    more: cell.withClass('spellbook-day-more')[0]?.text ?? '',
    tick: cell.withClass('spellbook-day-tick').length > 0,
    label: part(cell, 'spellbook-day-label').text,
    tint: [0, 1, 2, 3, 4].find((level) => cell.hasClass(`spellbook-tint-${level}`)) ?? -1,
  };
}

export const monthName = (pane: FakeElement): string => one(pane, 'spellbook-calendar-title').text;

/** A button of the calendar's head, by its name. */
export function headButton(pane: FakeElement, label: string): FakeElement {
  const found = one(pane, 'spellbook-calendar-head').children.filter(
    (button) => button.attrs['aria-label'] === label || button.text === label,
  );
  if (found.length !== 1) throw new Error(`expected one "${label}" in the calendar's head, found ${found.length}`);
  return found[0] as FakeElement;
}

/** The day's detail, and whether it is open. */
export const detail = (pane: FakeElement): FakeElement => one(pane, 'spellbook-day-detail');
export const detailOpen = (pane: FakeElement): boolean => one(pane, 'spellbook-calendar').hasClass('spellbook-has-detail');

/** The lines under the month, as "label: value (detail)". */
export function statPicture(pane: FakeElement): string[] {
  return pane.withClass('spellbook-stat').map((line) => {
    const said = line.withClass('spellbook-stat-detail')[0]?.text ?? '';
    return `${part(line, 'spellbook-stat-label').text}: ${part(line, 'spellbook-stat-value').text}${said === '' ? '' : ` (${said})`}`;
  });
}

// --- the to-do list

export type ListName = 'open' | 'done';

export function todoRows(pane: FakeElement, list: ListName): FakeElement[] {
  return one(pane, `spellbook-todo-${list}`).children;
}

/** A row as a reader sees it: "[ ] text {chip}" or "[x] text"; "!" in front of a chip that is marked late. */
export function rowPicture(row: FakeElement): string {
  const chip = row.withClass('spellbook-todo-due')[0];
  const due = chip ? ` {${chip.hasClass('spellbook-is-overdue') ? '!' : ''}${chip.text}}` : '';
  return `[${ticked(part(row, 'spellbook-todo-check')) ? 'x' : ' '}] ${part(row, 'spellbook-todo-text').text}${due}`;
}

export function listPicture(pane: FakeElement, list: ListName): string[] {
  return todoRows(pane, list).map(rowPicture);
}

/** The row whose text is this, in either list. */
export function todoRow(pane: FakeElement, text: string): FakeElement {
  const found = one(pane, 'spellbook-todos')
    .withClass('spellbook-todo-row')
    .filter((row) => part(row, 'spellbook-todo-text').text === text);
  if (found.length !== 1) throw new Error(`expected one to-do "${text}", found ${found.length}`);
  return found[0] as FakeElement;
}

export const boxOf = (row: FakeElement): FakeElement => part(row, 'spellbook-todo-check');

/** Tap the "more" button of a to-do and give the menu that opens. */
export function menuOf(pane: FakeElement, text: string): StubMenu {
  const before = StubMenu.shown.length;
  click(part(todoRow(pane, text), 'spellbook-todo-more'));
  if (StubMenu.shown.length !== before + 1) throw new Error(`tapping "more" on "${text}" showed no menu`);
  return StubMenu.shown[StubMenu.shown.length - 1] as StubMenu;
}

/** The field for a new to-do at the top of the list, its date field and its button. */
export function addForm(pane: FakeElement): { text: FakeElement; date: FakeElement; button: FakeElement } {
  const form = one(pane, 'spellbook-todo-add');
  return {
    text: part(form, 'spellbook-todo-input'),
    date: part(form, 'spellbook-todo-date'),
    button: part(form, 'spellbook-todo-add-button'),
  };
}

// --- the small windows

/** The window that was opened last, which must still be open. */
export function openWindow(): StubModal {
  const modal = StubModal.opened[StubModal.opened.length - 1];
  if (!modal?.isOpen) throw new Error('no window is open');
  return modal;
}

export function openWindows(): number {
  return StubModal.opened.filter((modal) => modal.isOpen).length;
}

/** The field, the message and the two buttons of a window that asks for a text or a date. */
export function promptParts(modal: StubModal): {
  input: FakeElement;
  message: () => string;
  cancel: ButtonComponent;
  confirm: ButtonComponent;
} {
  const buttons = modal.contentEl.settings[0]?.components as ButtonComponent[];
  return {
    input: part(modal.contentEl, 'spellbook-prompt-input'),
    message: () => modal.contentEl.withClass('spellbook-prompt-message')[0]?.text ?? '',
    cancel: buttons[0] as ButtonComponent,
    confirm: buttons[1] as ButtonComponent,
  };
}

// --- the layout, for dragging

export const ROW_HEIGHT = 30;
export const LIST_TOP = 100;
export const LIST_WIDTH = 300;

/**
 * Give the to-do list and its rows places on the screen, as a browser's
 * layout would: the list starts at LIST_TOP, every row is ROW_HEIGHT high,
 * the open rows first, then (a row's height further down, for "Done") the
 * done ones. The list's own scroll position shifts everything up.
 */
export function layOutTodos(pane: FakeElement, height = 600): void {
  const list = one(pane, 'spellbook-todos-scroll');
  list.rect = { top: LIST_TOP, bottom: LIST_TOP + height, left: 0, right: LIST_WIDTH, width: LIST_WIDTH, height };
  let y = LIST_TOP - list.scrollTop;
  const place = (row: FakeElement): void => {
    row.rect = { top: y, bottom: y + ROW_HEIGHT, left: 0, right: LIST_WIDTH, width: LIST_WIDTH, height: ROW_HEIGHT };
    y += ROW_HEIGHT;
  };
  todoRows(pane, 'open').forEach(place);
  y += ROW_HEIGHT;
  todoRows(pane, 'done').forEach(place);
}

export type PointerKind = 'mouse' | 'touch' | 'pen';

/** A pointer event as a browser sends it, travelling down to `target` and back up. */
export function point(
  target: FakeElement,
  type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel',
  x: number,
  y: number,
  kind: PointerKind = 'mouse',
): FakeEvent {
  return target.fire(type, {
    pointerId: 1,
    pointerType: kind,
    isPrimary: true,
    button: 0,
    buttons: type === 'pointerup' || type === 'pointercancel' ? 0 : 1,
    clientX: x,
    clientY: y,
  });
}

/** A height within a row: 0 is its top edge, 1 its bottom edge. */
export function inRow(row: FakeElement, share: number): number {
  return row.rect.top + share * (row.rect.bottom - row.rect.top);
}

/** Pick a to-do up with the mouse by its text, carry it to a height on the screen, and let go there. */
export function dragTo(row: FakeElement, y: number): void {
  const grip = part(row, 'spellbook-todo-text');
  const x = 60;
  const from = inRow(row, 0.5);
  point(grip, 'pointerdown', x, from);
  // The first move starts the drag; the second is the place itself.
  point(grip, 'pointermove', x, from + 6);
  point(grip, 'pointermove', x, y);
  point(grip, 'pointerup', x, y);
}
