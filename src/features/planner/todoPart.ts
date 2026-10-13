// The to-do half of the planner: every to-do of the project's To-do.md.
//
//   head    "To-dos", how many are open, and a button that shows the file
//   add     a field for a new to-do, with an optional date
//   list    the open to-dos in the order of the file, then "Done", which
//           folds shut, with the ones that are ticked off
//
// Each row has a tick box, the to-do's text, its due date as a small chip
// (marked when it is late), and a "more" button that opens its menu; a
// right-click opens the same menu. A row can be dragged to another place
// among its own kind (src/ui/dragDrop.ts does the dragging); "Move up" and
// "Move down" in the menu do the same without dragging.
//
// The part changes nothing itself. Every change is handed to the view as "do
// this to the text of the file as it is now" (an edit of the engine,
// src/core/planner), and the list is drawn again from what the host then has.
//
// A long list: a row is built once and used again for as long as its line
// says the same, so ticking, adding, moving or removing one to-do builds at
// most one row. A list that has to be built whole (when the screen opens, or
// "Done" is unfolded on hundreds of to-dos) is built in pieces, a screenful
// first, so that the screen never waits for it.
//
// Text in any language: only the to-do's text takes its own direction. The
// tick box, the chip and the button keep their places in every row.

import { Menu } from 'obsidian';
import { addTask, moveTask, overdueTasks, removeTask, setTaskDone, setTaskDue, setTaskText } from '../../core/planner';
import type { TodoEdit, TodoTask } from '../../core/planner';
import { ConfirmModal } from '../../ui/confirmModal';
import { DragDrop } from '../../ui/dragDrop';
import type { DragClock, DropHint, Picked } from '../../ui/dragDrop';
import type { ScreenPoint } from '../../core/dropTarget';
import { ACTION_ICONS, FOLD_ICON, ROW_MORE_ICON, iconName, showIcon } from '../../ui/icons';
import { isInputMethodKey } from '../../ui/keys';
import { safely } from '../../ui/safely';
import { TextPromptModal } from '../../ui/textPromptModal';
import { DatePromptModal } from './dateModal';
import { dropPlace, dueLabel, groupTasks, keyTasks, movesAnything, neighbourOf } from './plannerModel';
import type { DropPlace, KeyedTask, TaskGroups } from './plannerModel';
import { MORE_LABEL, NO_TEXT, buildTodoRow, iconButton, ownerOf, showMenuUnder, textButton } from './plannerParts';
import type { PlannerFrame, PlannerOwner } from './plannerParts';

/** On something that is there but has nothing to show at the moment. */
const UNUSED_CLASS = 'spellbook-is-unused';

/** The most rows that are built in one go; a list that needs more is built in pieces. */
export const ROWS_AT_ONCE = 60;
/** How many rows each later piece adds. */
export const ROWS_A_PIECE = 120;

/** What the list says when the file could not be saved from a small window. */
const NOT_SAVED = 'That could not be saved. Try again.';

/** The icons of the menu items that are the planner's own. */
const MENU_ICONS = {
  setDate: ['calendar-plus', 'calendar'],
  clearDate: ['calendar-x', 'calendar-minus', 'calendar'],
  remove: ['trash-2', 'trash'],
  openFile: ['file-text', 'file'],
} as const;

type Group = 'open' | 'done';

/** One to-do's row. Built once for a line; kept for as long as the list shows that line. */
interface Row {
  readonly key: string;
  readonly group: Group;
  readonly el: HTMLElement;
  /** The tick box together with the room around it that also ticks it. */
  readonly tick: HTMLElement;
  readonly check: HTMLInputElement;
  readonly chip: HTMLElement | null;
  readonly more: HTMLElement | null;
  /** The to-do as it is in the newest reading of the file (its line number may have changed). */
  task: TodoTask;
  /** What the chip was last written for. */
  chipFor: string;
  /** True while a change to this to-do is on its way. */
  busy: boolean;
}

/** What a drag picks up: a row, named, because the row itself may be drawn anew meanwhile. */
interface Dragged {
  readonly key: string;
  readonly group: Group;
}

/** Where the rows of one kind are while one of them is dragged. */
interface DropLayout {
  readonly group: Group;
  /** Top to bottom; heights are counted from the top of the list's contents, so they hold while it scrolls. */
  readonly spans: ReadonlyArray<{ readonly row: Row; readonly top: number; readonly bottom: number; readonly x: number; readonly width: number }>;
  /** Where the dragged row is among them. */
  readonly dragged: number;
}

/**
 * One list of rows (the open to-dos, or the done ones) that brings itself up
 * to date with as little work as it can.
 */
class RowList {
  private readonly rows = new Map<string, Row>();
  /** The names of the rows that are in the list on the screen, top to bottom. */
  private order: string[] = [];
  private stopFill: (() => void) | null = null;

  constructor(
    private readonly el: HTMLElement,
    private readonly clock: DragClock,
    private readonly build: (parent: HTMLElement | DocumentFragment, item: KeyedTask) => Row,
    private readonly renew: (row: Row, task: TodoTask) => void,
    private readonly dropped: (row: Row) => void,
  ) {}

  /** The rows on the screen, top to bottom. */
  shown(): Row[] {
    const rows: Row[] = [];
    for (const key of this.order) {
      const row = this.rows.get(key);
      if (row) rows.push(row);
    }
    return rows;
  }

  find(key: string): Row | undefined {
    return this.rows.get(key);
  }

  /** True while a long list is still being built, piece by piece. */
  get filling(): boolean {
    return this.stopFill !== null;
  }

  /** Forget every row: the next list is built from nothing. */
  clear(): void {
    this.stopFill?.();
    this.stopFill = null;
    for (const row of this.rows.values()) this.dropped(row);
    this.rows.clear();
    this.order = [];
    this.el.empty();
  }

  /** Stop building. The list cannot be used afterwards. */
  destroy(): void {
    this.stopFill?.();
    this.stopFill = null;
    this.rows.clear();
    this.order = [];
  }

  /** Show these to-dos, in this order. */
  set(tasks: readonly TodoTask[]): void {
    this.stopFill?.();
    this.stopFill = null;
    const wanted = keyTasks(tasks);
    const keys = new Set(wanted.map((item) => item.key));
    for (const [key, row] of this.rows) {
      if (keys.has(key)) continue;
      row.el.remove();
      this.rows.delete(key);
      this.dropped(row);
    }
    this.order = this.order.filter((key) => keys.has(key));

    let missing = 0;
    for (const item of wanted) if (!this.rows.has(item.key)) missing++;
    if (missing > ROWS_AT_ONCE) {
      // Too many to build in one go. Every row comes off the screen and they
      // go back in order, piece by piece; the ones that exist are used again.
      for (const key of this.order) this.rows.get(key)?.el.remove();
      this.order = [];
      this.fill(wanted, 0, ROWS_AT_ONCE);
      return;
    }

    // The new rows are built off the screen and put in afterwards.
    const holder = createFragment();
    for (const item of wanted) {
      const row = this.rows.get(item.key);
      if (row) this.renew(row, item.task);
      else this.rows.set(item.key, this.build(holder, item));
    }
    const next = wanted.map((item) => item.key);
    // When the rows on the screen are in the order wanted and the new ones
    // all come after them, only the new ones are added: nothing moves.
    // Otherwise every row is put in its place again; none is built.
    const stays = this.order.every((key, at) => next[at] === key);
    for (const key of stays ? next.slice(this.order.length) : next) {
      const row = this.rows.get(key);
      if (row) this.el.appendChild(row.el);
    }
    this.order = next;
  }

  private fill(wanted: readonly KeyedTask[], from: number, count: number): void {
    const end = Math.min(wanted.length, from + count);
    for (let at = from; at < end; at++) {
      const item = wanted[at];
      if (!item) continue;
      const row = this.rows.get(item.key);
      if (row) {
        this.renew(row, item.task);
        this.el.appendChild(row.el);
      } else {
        // Built straight into the list, at its end.
        this.rows.set(item.key, this.build(this.el, item));
      }
      this.order.push(item.key);
    }
    if (end >= wanted.length) return;
    this.stopFill = this.clock.nextFrame(() => {
      this.stopFill = null;
      this.fill(wanted, end, ROWS_A_PIECE);
    });
  }
}

interface Els {
  readonly root: HTMLElement;
  readonly count: HTMLElement;
  readonly add: HTMLElement;
  readonly addText: HTMLInputElement;
  readonly addDate: HTMLInputElement;
  readonly scroll: HTMLElement;
  readonly empty: HTMLElement;
  readonly doneToggle: HTMLButtonElement;
  readonly doneCount: HTMLElement;
}

export class TodoPart {
  private readonly owner: PlannerOwner;
  private readonly els: Els;
  private readonly open: RowList;
  private readonly done: RowList;
  private readonly rowByEl = new Map<HTMLElement, Row>();
  private readonly drag: DragDrop<Dragged>;
  /** Called when "Done" is folded or unfolded, so that the view can remember it. */
  private readonly onFold: (collapsed: boolean) => void;

  private frame: PlannerFrame | null = null;
  private groups: TaskGroups = { open: [], done: [] };
  /** The to-dos that are late, as the engine sees it. */
  private late = new Set<TodoTask>();
  private destroyed = false;
  private doneCollapsed: boolean;
  /** What the rows were last built for: when it differs, every row is built anew. */
  private rowsFor = '';
  /** What the lists were last drawn for: when it is the same, nothing is done. */
  private drawnFor: unknown[] = [];
  private dropLayout: DropLayout | null = null;

  constructor(parent: HTMLElement, owner: PlannerOwner, doneCollapsed: boolean, onFold: (collapsed: boolean) => void) {
    this.owner = owner;
    this.doneCollapsed = doneCollapsed;
    this.onFold = onFold;
    const root = parent.createDiv({ cls: 'spellbook-todos', attr: { role: 'tabpanel', 'aria-label': 'To-dos' } });

    const head = root.createDiv({ cls: 'spellbook-todos-head' });
    head.createDiv({ cls: 'spellbook-todos-title', text: 'To-dos', attr: { role: 'heading', 'aria-level': 2 } });
    const count = head.createDiv({ cls: 'spellbook-todos-count', attr: { 'aria-live': 'polite' } });
    const host = owner.host;
    if (typeof host.openTodoNote === 'function') {
      iconButton(head, 'spellbook-todos-open', 'Open To-do.md', MENU_ICONS.openFile, () => host.openTodoNote?.());
    }

    const add = root.createDiv({ cls: 'spellbook-todo-add' });
    const addText = add.createEl('input', {
      cls: 'spellbook-todo-input',
      attr: {
        type: 'text',
        // The text may be in any language; let it pick its own direction.
        dir: 'auto',
        placeholder: 'Add a to-do',
        'aria-label': 'New to-do',
        enterkeyhint: 'done',
      },
    });
    const addDate = add.createEl('input', {
      cls: 'spellbook-todo-date',
      attr: { type: 'date', 'aria-label': 'Due date (optional)' },
    });
    for (const field of [addText, addDate]) {
      field.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' || isInputMethodKey(event)) return;
        event.preventDefault();
        this.add();
      });
    }
    textButton(add, 'spellbook-todo-add-button', 'Add', () => {
      this.add();
    });

    const scroll = root.createDiv({ cls: 'spellbook-todos-scroll spellbook-planner-scroll' });
    const openList = scroll.createDiv({ cls: 'spellbook-todo-list spellbook-todo-open', attr: { role: 'list', 'aria-label': 'Open to-dos' } });
    const empty = scroll.createDiv({ cls: `spellbook-todos-empty ${UNUSED_CLASS}` });
    const doneToggle = scroll.createEl('button', {
      cls: `spellbook-todos-done-toggle ${UNUSED_CLASS}`,
      attr: { type: 'button', 'aria-expanded': 'false' },
    });
    showIcon(doneToggle.createSpan({ cls: 'spellbook-todos-done-icon' }), ...FOLD_ICON);
    doneToggle.createSpan({ cls: 'spellbook-todos-done-label', text: 'Done' });
    const doneCount = doneToggle.createSpan({ cls: 'spellbook-todos-done-count', attr: { dir: 'ltr' } });
    doneToggle.addEventListener('click', () => {
      this.foldDone(!this.doneCollapsed);
    });
    const doneList = scroll.createDiv({ cls: 'spellbook-todo-list spellbook-todo-done', attr: { role: 'list', 'aria-label': 'Done to-dos' } });

    this.els = { root, count, add, addText, addDate, scroll, empty, doneToggle, doneCount };

    const clock = host.clock;
    const forget = (row: Row): void => {
      this.rowByEl.delete(row.el);
    };
    const renew = (row: Row, task: TodoTask): void => {
      row.task = task;
      this.writeChip(row);
    };
    this.open = new RowList(openList, clock, (holder, item) => this.buildRow(holder, item, 'open'), renew, forget);
    this.done = new RowList(doneList, clock, (holder, item) => this.buildRow(holder, item, 'done'), renew, forget);

    // One listener of each kind for all the rows.
    scroll.addEventListener('change', (event) => {
      const row = ownerOf(event.target, scroll, this.rowByEl);
      if (row && event.target === row.check) this.tick(row);
    });
    scroll.addEventListener('click', (event) => {
      const row = ownerOf(event.target, scroll, this.rowByEl);
      if (row?.more?.contains(event.target as Node)) {
        safely(MORE_LABEL, () => {
          this.showMenu(row, null);
        });
      }
    });
    scroll.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      const row = ownerOf(event.target, scroll, this.rowByEl);
      if (!row?.more?.contains(event.target as Node)) return;
      event.preventDefault();
      safely(MORE_LABEL, () => {
        this.showMenu(row, null);
      });
    });
    scroll.addEventListener('contextmenu', (event) => {
      const row = ownerOf(event.target, scroll, this.rowByEl);
      if (!row || !row.more) return;
      event.preventDefault();
      safely(MORE_LABEL, () => {
        this.showMenu(row, event);
      });
    });

    this.drag = new DragDrop<Dragged>({
      container: scroll,
      scroller: scroll,
      clock,
      pick: (target) => this.pickUp(target),
      ghost: (ghost, picked) => {
        const row = this.rowOf(picked.data);
        const title = row === undefined || row.task.title === '' ? NO_TEXT : row.task.title;
        ghost.createDiv({ cls: 'spellbook-drag-ghost-title', text: title, attr: { dir: 'auto' } });
      },
      start: (picked) => {
        this.measureForDrop(picked.data);
      },
      hover: (_picked, point) => this.hintAt(point),
      drop: (picked, point) => {
        this.dropAt(picked.data, point);
      },
      end: () => {
        this.dropLayout = null;
      },
    });
  }

  /** The view is closing: stop dragging and building, and let go of every listener outside the part. */
  destroy(): void {
    this.destroyed = true;
    this.drag.destroy();
    this.open.destroy();
    this.done.destroy();
    this.rowByEl.clear();
    this.frame = null;
    this.dropLayout = null;
  }

  /** True while a long list is still being built, piece by piece. */
  get filling(): boolean {
    return this.open.filling || this.done.filling;
  }

  /** Draw for a new picture of the project; null when no project is open. */
  update(frame: PlannerFrame | null): void {
    if (this.destroyed) return;
    this.frame = frame;
    if (!frame) {
      this.drag.cancel();
      this.open.clear();
      this.done.clear();
      this.rowsFor = '';
      this.drawnFor = [];
      return;
    }
    // The same file, the same day, the same rights: the lists are as they should be.
    const drawnFor = [frame.project.key, frame.todo, frame.today, frame.project.readOnly, this.doneCollapsed];
    if (drawnFor.every((value, at) => value === this.drawnFor[at])) return;
    this.drawnFor = drawnFor;

    // The rows are about to change places: a drag over them has lost its footing.
    this.drag.cancel();
    const locked = frame.project.readOnly;
    // Another project, or other rights: no row of the last drawing will do.
    const rowsFor = `${locked}\n${frame.project.key}`;
    if (rowsFor !== this.rowsFor) {
      this.rowsFor = rowsFor;
      this.open.clear();
      this.done.clear();
    }

    this.groups = groupTasks(frame.todo);
    this.late = new Set(overdueTasks(frame.todo, frame.today));
    const { open, done } = this.groups;

    this.els.root.toggleClass('spellbook-is-locked', locked);
    this.els.add.toggleClass(UNUSED_CLASS, locked);
    this.els.count.setText(open.length === 0 ? '' : `${open.length} open`);
    const nothing = open.length === 0 ? (done.length === 0 ? 'No to-dos yet.' : 'Nothing left to do.') : '';
    this.els.empty.setText(nothing);
    this.els.empty.toggleClass(UNUSED_CLASS, nothing === '');

    this.els.doneToggle.toggleClass(UNUSED_CLASS, done.length === 0);
    this.els.doneToggle.toggleClass('spellbook-is-collapsed', this.doneCollapsed);
    this.els.doneToggle.setAttr('aria-expanded', this.doneCollapsed ? 'false' : 'true');
    this.els.doneCount.setText(String(done.length));

    this.open.set(open);
    // What is folded shut is not built at all.
    this.done.set(this.doneCollapsed ? [] : done);
  }

  /** Fold "Done" shut or open it. */
  foldDone(collapsed: boolean): void {
    if (collapsed === this.doneCollapsed) return;
    this.doneCollapsed = collapsed;
    this.onFold(collapsed);
    this.update(this.frame);
  }

  // --------------------------------------------------------------------- rows

  private buildRow(parent: HTMLElement | DocumentFragment, item: KeyedTask, group: Group): Row {
    const locked = this.frame?.project.readOnly === true;
    const { task } = item;
    const parts = buildTodoRow(parent, task, locked);
    parts.el.setAttr('role', 'listitem');
    const chip = task.due === null ? null : parts.el.createSpan({ cls: 'spellbook-todo-due', attr: { dir: 'ltr' } });
    let more: HTMLElement | null = null;
    if (!locked) {
      // The "more" button comes last, so it sits at the far end of the row
      // from the tick box, whichever way Obsidian itself reads.
      more = iconButton(parts.el, 'spellbook-todo-more', MORE_LABEL, ROW_MORE_ICON);
      more.setAttr('aria-haspopup', 'menu');
    }
    const row: Row = {
      key: item.key,
      group,
      el: parts.el,
      tick: parts.tick,
      check: parts.check,
      chip,
      more,
      task,
      chipFor: '',
      busy: false,
    };
    this.rowByEl.set(parts.el, row);
    this.writeChip(row);
    return row;
  }

  /** Write a row's due date as its chip says it today, and mark it when it is late. */
  private writeChip(row: Row): void {
    const { chip, task } = row;
    const today = this.frame?.today ?? '';
    if (!chip || task.due === null) return;
    const late = this.late.has(task);
    const chipFor = `${task.due}|${today}|${late}`;
    if (chipFor === row.chipFor) return;
    row.chipFor = chipFor;
    const label = dueLabel(task.due, today);
    chip.setText(label);
    chip.toggleClass('spellbook-is-overdue', late);
    chip.setAttr('aria-label', late ? `Overdue: ${label}` : `Due ${label}`);
  }

  private rowOf(dragged: Dragged): Row | undefined {
    return (dragged.group === 'open' ? this.open : this.done).find(dragged.key);
  }

  // ----------------------------------------------------------------- changing

  /**
   * Hand a change of one to-do to the view. While it is on its way the row
   * takes no second change; should it come to nothing, the row shows again
   * what the file says.
   */
  private change(row: Row, what: string, edit: (text: string) => TodoEdit): Promise<TodoEdit | null> {
    row.busy = true;
    row.el.setAttr('aria-busy', 'true');
    return this.owner.editTodo(what, edit).then((result) => {
      row.busy = false;
      row.el.setAttr('aria-busy', null);
      row.check.checked = row.task.done;
      return result;
    });
  }

  private tick(row: Row): void {
    const task = row.task;
    if (row.busy || this.frame?.project.readOnly !== false) {
      row.check.checked = task.done;
      return;
    }
    void this.change(row, task.done ? 'Untick' : 'Tick', (text) => setTaskDone(text, task, !task.done));
  }

  private add(): void {
    if (!this.frame || this.frame.project.readOnly) return;
    const { addText, addDate } = this.els;
    const title = addText.value;
    const due = addDate.value;
    void this.owner
      .editTodo('Add', (text) => addTask(text, { title, due: due === '' ? null : due }))
      .then((result) => {
        if (result?.status !== 'done') return;
        // Cleared only when they are still what was added: the writer may have typed on.
        if (addText.value === title) addText.value = '';
        if (addDate.value === due) addDate.value = '';
      });
  }

  private move(row: Row, step: 1 | -1): void {
    const task = row.task;
    const other = neighbourOf(this.groups[row.group], task, step);
    if (!other || row.busy) return;
    void this.change(row, step === 1 ? 'Move down' : 'Move up', (text) => moveTask(text, task, other, step === 1 ? 'after' : 'before'));
  }

  /** A row's menu, made for the to-do as it is right now. */
  private showMenu(row: Row, event: MouseEvent | null): void {
    const frame = this.frame;
    if (!frame || frame.project.readOnly || !row.more) return;
    const task = row.task;
    const group = this.groups[row.group];
    const menu = new Menu();
    const add = (title: string, icons: readonly string[], run: () => unknown, off = false, warning = false): void => {
      menu.addItem((item) => {
        item
          .setTitle(title)
          .setIcon(iconName(...icons))
          .onClick(() => {
            safely(title, run);
          });
        if (off) item.setDisabled(true);
        if (warning) item.setWarning(true);
      });
    };
    add('Edit text', ACTION_ICONS.rename, () => {
      this.askForText(row);
    });
    add('Set date', MENU_ICONS.setDate, () => {
      this.askForDate(row);
    });
    add(
      'Clear date',
      MENU_ICONS.clearDate,
      () => {
        void this.change(row, 'Clear date', (text) => setTaskDue(text, task, null));
      },
      task.due === null,
    );
    menu.addSeparator();
    add(
      'Move up',
      ACTION_ICONS.moveUp,
      () => {
        this.move(row, -1);
      },
      neighbourOf(group, task, -1) === null,
    );
    add(
      'Move down',
      ACTION_ICONS.moveDown,
      () => {
        this.move(row, 1);
      },
      neighbourOf(group, task, 1) === null,
    );
    menu.addSeparator();
    add(
      'Remove',
      MENU_ICONS.remove,
      () => {
        this.askToRemove(row);
      },
      false,
      true,
    );
    if (event) menu.showAtMouseEvent(event);
    else showMenuUnder(menu, row.more);
  }

  /**
   * What a small window says after its change was tried: null to close, or a
   * message to show under its field.
   */
  private answerOf(result: TodoEdit | null): string | null {
    if (result === null) return NOT_SAVED;
    return result.status === 'refused' ? result.message : null;
  }

  private askForText(row: Row): void {
    const task = row.task;
    new TextPromptModal(this.owner.app, {
      title: 'Edit to-do',
      label: 'To-do text',
      value: task.title,
      confirm: 'Save',
      submit: async (value) => this.answerOf(await this.owner.editTodo('Edit text', (text) => setTaskText(text, task, value), true)),
    }).open();
  }

  private askForDate(row: Row): void {
    const task = row.task;
    new DatePromptModal(this.owner.app, {
      title: 'Set date',
      label: 'Due date',
      value: task.due,
      confirm: 'Set date',
      submit: async (value) => {
        if (value === '') return 'Choose a date first.';
        return this.answerOf(await this.owner.editTodo('Set date', (text) => setTaskDue(text, task, value), true));
      },
    }).open();
  }

  private askToRemove(row: Row): void {
    const task = row.task;
    new ConfirmModal(this.owner.app, {
      title: 'Remove this to-do?',
      message: `"${task.title === '' ? NO_TEXT : task.title}" will be taken out of To-do.md. Notes written under it stay in the file.`,
      confirm: 'Remove',
      onConfirm: () => {
        void this.change(row, 'Remove', (text) => removeTask(text, task));
      },
    }).open();
  }

  // ----------------------------------------------------------------- dragging

  /** What a press on something in the list would pick up, if anything. */
  private pickUp(target: EventTarget | null): Picked<Dragged> | null {
    const frame = this.frame;
    if (!frame || frame.project.readOnly || this.filling) return null;
    const row = ownerOf(target, this.els.scroll, this.rowByEl);
    if (!row || row.busy) return null;
    // A press on the tick box or on the "more" button is for them.
    if (row.tick.contains(target as Node) || row.more?.contains(target as Node)) return null;
    return { el: row.el, data: { key: row.key, group: row.group } };
  }

  /** Measure where the rows of the dragged row's kind are, once for a whole drag. */
  private measureForDrop(dragged: Dragged): void {
    const scroll = this.els.scroll;
    const box = scroll.getBoundingClientRect();
    // What to add to a height in the window to get the height in the list's contents.
    const scrolled = scroll.scrollTop - box.top;
    const spans: Array<{ row: Row; top: number; bottom: number; x: number; width: number }> = [];
    let at = -1;
    for (const row of (dragged.group === 'open' ? this.open : this.done).shown()) {
      const rect = row.el.getBoundingClientRect();
      if (!(rect.height > 0)) continue;
      if (row.key === dragged.key) at = spans.length;
      spans.push({ row, top: rect.top + scrolled, bottom: rect.bottom + scrolled, x: rect.left, width: rect.width });
    }
    this.dropLayout = at < 0 ? null : { group: dragged.group, spans, dragged: at };
  }

  /** Where a drop at a place on the screen would put the dragged row, if it would change anything. */
  private placeAt(point: ScreenPoint): { place: DropPlace; top: number; bottom: number; scrolled: number } | null {
    const layout = this.dropLayout;
    const frame = this.frame;
    if (!layout || !frame || frame.project.readOnly) return null;
    const box = this.els.scroll.getBoundingClientRect();
    // Beside the list, or above or below what can be seen of it, is nowhere.
    if (point.x < box.left || point.x > box.right || point.y < box.top || point.y > box.bottom) return null;
    const scrolled = this.els.scroll.scrollTop - box.top;
    const place = dropPlace(layout.spans, point.y + scrolled);
    if (!place || !movesAnything(place, layout.dragged)) return null;
    return { place, top: box.top, bottom: box.bottom, scrolled };
  }

  private hintAt(point: ScreenPoint): DropHint | null {
    const found = this.placeAt(point);
    const span = found ? this.dropLayout?.spans[found.place.index] : undefined;
    if (!found || !span) return null;
    const edge = (found.place.where === 'before' ? span.top : span.bottom) - found.scrolled;
    // Kept within what can be seen of the list.
    const y = Math.max(found.top, Math.min(found.bottom, edge));
    return { line: { x: span.x, y, width: span.width } };
  }

  private dropAt(dragged: Dragged, point: ScreenPoint): void {
    const found = this.placeAt(point);
    const target = found ? this.dropLayout?.spans[found.place.index]?.row : undefined;
    const row = this.rowOf(dragged);
    if (!found || !target || !row || row === target) return;
    const task = row.task;
    const other = target.task;
    const where = found.place.where;
    void this.change(row, 'Move', (text) => moveTask(text, task, other, where));
  }
}
