// What the two parts of the planner screen (the calendar and the to-do list)
// share: the picture of the project they draw from, what they may ask of the
// view that holds them, and a few pieces of screen both are built from.

import type { App, Menu } from 'obsidian';
import type { DayWordsSource, MarksEdit, ParsedMarks, TodoEdit, TodoFile, TodoTask } from '../../core/planner';
import { showIcon } from '../../ui/icons';
import { safely } from '../../ui/safely';
import type { PlannerHost, PlannerProject } from './plannerHost';

/** Everything one drawing is made from. A new one is put together whenever the host says something changed. */
export interface PlannerFrame {
  readonly project: PlannerProject;
  /** To-do.md as the engine read it. The same object for as long as the file's text is the same. */
  readonly todo: TodoFile;
  /** The day marks as the engine read them. */
  readonly marks: ParsedMarks;
  /** Today, as YYYY-MM-DD. */
  readonly today: string;
  /** The weekday the weeks start on, 0 (Sunday) to 6. */
  readonly firstDayOfWeek: number;
  /** Where the words of each day come from, or null. */
  readonly words: DayWordsSource | null;
}

/** What a part may ask of the view that holds it. */
export interface PlannerOwner {
  readonly app: App;
  readonly host: PlannerHost;
  /**
   * Change To-do.md through the host, one change after another. Tells the
   * writer when it did not work, and brings the screen up to date before it
   * resolves. Resolves with the engine's answer, or with null when the file
   * could not be read or written.
   *
   * @param what  the name of the button or menu item, for a notice
   * @param quiet true when the caller shows a refusal itself (under a field, say)
   */
  editTodo(what: string, edit: (text: string) => TodoEdit, quiet?: boolean): Promise<TodoEdit | null>;
  /** The same for the day marks. */
  editMarks(what: string, edit: (marks: unknown) => MarksEdit): Promise<MarksEdit | null>;
}

/** What the "more" button of a to-do is called (read out, and shown as a tooltip). */
export const MORE_LABEL = 'More options';

/** What stands in for the text of a to-do whose line has none. */
export const NO_TEXT = '(no text)';

/**
 * A small button that shows an icon, built the way Obsidian builds its own
 * (so that themes style it). It can be reached and pressed from the keyboard.
 *
 * @param press what a tap, Enter or Space does; left out for a button whose
 *              taps are heard further up (one listener for a whole list)
 */
export function iconButton(
  parent: HTMLElement,
  cls: string,
  label: string,
  icons: readonly string[],
  press?: () => unknown,
): HTMLElement {
  const button = parent.createDiv({
    cls: `clickable-icon ${cls}`,
    // The label is read out by screen readers, and shown by Obsidian as a tooltip.
    attr: { role: 'button', tabindex: 0, 'aria-label': label },
  });
  showIcon(button, ...icons);
  if (press) {
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      safely(label, press);
    });
    button.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      event.stopPropagation();
      safely(label, press);
    });
  }
  return button;
}

/** A button with words on it. */
export function textButton(parent: HTMLElement, cls: string, text: string, press: () => unknown): HTMLButtonElement {
  const button = parent.createEl('button', { cls, text, attr: { type: 'button' } });
  button.addEventListener('click', () => {
    safely(text, press);
  });
  return button;
}

/** Show a menu under the button (or other element) it belongs to. */
export function showMenuUnder(menu: Menu, anchor: HTMLElement): void {
  const box = anchor.getBoundingClientRect();
  menu.showAtPosition({ x: box.left, y: box.bottom, width: box.width });
}

/** The pieces of a to-do's row that both parts of the screen use. */
export interface TodoRowParts {
  readonly el: HTMLElement;
  /** What is tapped to tick the to-do: the box and the room around it. */
  readonly tick: HTMLElement;
  readonly check: HTMLInputElement;
  readonly text: HTMLElement;
}

/**
 * One to-do as a row: a tick box, then its text. Only the text takes the
 * direction of the writer's own words; the box stays at the start of the row
 * whatever language the text is in.
 *
 * The box sits in a label of its own, which the stylesheet makes as big as a
 * finger needs: a tap anywhere in it ticks the box, and the box itself keeps
 * the size Obsidian gives it.
 *
 * @param locked true when the to-do cannot be changed: the box is then shown but cannot be ticked
 */
export function buildTodoRow(parent: HTMLElement | DocumentFragment, task: TodoTask, locked: boolean): TodoRowParts {
  const el = parent.createDiv({ cls: 'spellbook-todo-row' });
  el.toggleClass('spellbook-is-done', task.done);
  const title = task.title === '' ? NO_TEXT : task.title;
  const tick = el.createEl('label', { cls: 'spellbook-todo-tick' });
  const check = tick.createEl('input', {
    cls: 'spellbook-todo-check',
    // Read out as the name of the box: what would be ticked off.
    attr: { type: 'checkbox', 'aria-label': title },
  });
  check.checked = task.done;
  check.disabled = locked;
  const text = el.createDiv({ cls: 'spellbook-todo-text', text: title });
  if (task.title === '') text.addClass('spellbook-is-placeholder');
  else text.setAttr('dir', 'auto');
  return { el, tick, check, text };
}

/** The element among `known` that an event's target is, or sits in; looked for no further up than `stop`. */
export function ownerOf<T>(target: EventTarget | null, stop: HTMLElement, known: ReadonlyMap<HTMLElement, T>): T | null {
  for (let at = target as HTMLElement | null; at && at !== stop; at = at.parentElement) {
    const found = known.get(at);
    if (found !== undefined) return found;
  }
  return null;
}

/** True when Obsidian itself reads from right to left around an element. */
export function readsRightToLeft(element: HTMLElement): boolean {
  return element.ownerDocument.defaultView?.getComputedStyle(element).direction === 'rtl';
}
