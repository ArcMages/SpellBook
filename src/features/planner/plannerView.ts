// The planner: the calendar and the to-do list of the open project, in one
// view that opens in the main area.
//
// On a wide pane the two sit side by side. On a narrow one they are two tabs,
// Calendar and To-dos. Which it is goes by the pane's measured width, never
// by the kind of device, so a phone, a split pane on a tablet and a small
// window on a computer all get the layout that fits them.
//
// The view holds the two parts (calendarPart.ts, todoPart.ts) and stands
// between them and the plugin:
//
//   reading   Everything shown comes from the host (plannerHost.ts). When the
//             host says something changed, the view reads it again and hands
//             both parts a new picture. Several changes in a row are drawn in
//             one go, and each part redraws only what differs.
//   changing  A part hands over an edit of the engine (src/core/planner); the
//             view passes it to the host, one edit after another, and tells
//             the writer when one came to nothing. The view itself reads and
//             writes no note.
//
// Everything it sets up (the host's calls, the size watcher, timers, the
// drag engine of the list) is taken down again when the view closes.

import { ItemView, Notice, Platform } from 'obsidian';
import type { ViewStateResult, WorkspaceLeaf } from 'obsidian';
import { parseMarks, parseTodo } from '../../core/planner';
import type { MarksEdit, TodoEdit, TodoFile } from '../../core/planner';
import { iconName } from '../../ui/icons';
import { CalendarPart } from './calendarPart';
import type { PlannerChange, PlannerHost } from './plannerHost';
import { SIDE_BY_SIDE_FROM, TABS_BELOW, isWideEnough } from './plannerModel';
import { readsRightToLeft } from './plannerParts';
import type { PlannerFrame, PlannerOwner } from './plannerParts';
import { TodoPart } from './todoPart';

export const PLANNER_VIEW_TYPE = 'spellbook-planner';
export const PLANNER_VIEW_NAME = 'Planner';
/** The view's icon, by every name Obsidian has had for it; the first one it knows is used. */
export const PLANNER_ICON = ['calendar-check', 'calendar-check-2', 'calendar'] as const;

/** The two tabs of a narrow pane. */
export type PlannerTab = 'calendar' | 'todos';

/** What the view says while no project is open. */
export const NO_PROJECT_MESSAGE = 'Open a Spellbook project to see its calendar and its to-dos.';
/** What the writer is told when a to-do was no longer in the file as the list showed it. */
export const TODO_CHANGED_NOTICE = 'That to-do was changed in the file meanwhile. The list is up to date again.';

/** How long a notice about something that went wrong stays up, in milliseconds. */
const PROBLEM_NOTICE_MS = 10000;

interface Elements {
  readonly root: HTMLElement;
  readonly tabs: Record<PlannerTab, HTMLElement>;
  readonly message: HTMLElement;
}

export class PlannerView extends ItemView implements PlannerOwner {
  readonly host: PlannerHost;
  private els: Elements | null = null;
  private calendar: CalendarPart | null = null;
  private todos: TodoPart | null = null;
  private closed = true;
  private stops: Array<() => void> = [];
  /** Cancels the drawing that is about to happen, if any. */
  private stopRender: (() => void) | null = null;
  private observer: ResizeObserver | null = null;
  /** True when the pane is wide enough for the two parts side by side. */
  private wide = false;
  /** The tab that is in front on a narrow pane. */
  private tab: PlannerTab = 'calendar';
  /** Whether the done to-dos are folded shut. */
  private doneCollapsed = true;
  /** The text To-do.md was last read from, and what the engine made of it. */
  private todoSource: string | null = null;
  private todo: TodoFile | null = null;
  /** The changes that were asked for run one after another, in the order they were asked for. */
  private queue: Promise<void> = Promise.resolve();
  private messageShown = '';

  constructor(leaf: WorkspaceLeaf, host: PlannerHost) {
    super(leaf);
    this.host = host;
    // A place of its own in the main area, not something to navigate away from.
    this.navigation = false;
  }

  override getViewType(): string {
    return PLANNER_VIEW_TYPE;
  }

  override getDisplayText(): string {
    return PLANNER_VIEW_NAME;
  }

  override getIcon(): string {
    return iconName(...PLANNER_ICON) ?? 'calendar';
  }

  /**
   * What Obsidian keeps for this pane with the layout of the workspace, on
   * this device: the tab that is in front, and whether "Done" is folded shut.
   */
  override getState(): Record<string, unknown> {
    const inherited: unknown = super.getState;
    const base = typeof inherited === 'function' ? super.getState() : {};
    return { ...base, tab: this.tab, doneCollapsed: this.doneCollapsed };
  }

  override async setState(state: unknown, result: ViewStateResult): Promise<void> {
    if (typeof state === 'object' && state !== null) {
      const { tab, doneCollapsed } = state as { tab?: unknown; doneCollapsed?: unknown };
      if (tab === 'calendar' || tab === 'todos') this.showTab(tab);
      if (typeof doneCollapsed === 'boolean') {
        this.doneCollapsed = doneCollapsed;
        this.todos?.foldDone(doneCollapsed);
      }
    }
    const inherited: unknown = super.setState;
    if (typeof inherited === 'function') await super.setState(state, result);
  }

  // ---------------------------------------------------------------- lifecycle

  protected override async onOpen(): Promise<void> {
    this.closed = false;
    this.wide = false;
    this.messageShown = '';
    const pane = this.contentEl;
    pane.empty();
    pane.addClass('spellbook-planner-pane');

    const root = pane.createDiv({ cls: 'spellbook-planner' });
    // Touch needs bigger targets. Platform.isMobile covers phones and
    // tablets; the stylesheet also covers touch screens on desktop.
    root.toggleClass('spellbook-is-mobile', Platform.isMobile);
    // On a phone, Obsidian's own bar floats over the bottom of the pane: the
    // stylesheet leaves room for it under whatever scrolls.
    root.toggleClass('spellbook-is-phone', Platform.isPhone);

    const tabList = root.createDiv({ cls: 'spellbook-planner-tabs', attr: { role: 'tablist', 'aria-label': PLANNER_VIEW_NAME } });
    const tabs: Record<PlannerTab, HTMLElement> = {
      calendar: this.addTab(tabList, 'calendar', 'Calendar'),
      todos: this.addTab(tabList, 'todos', 'To-dos'),
    };
    const message = root.createDiv({ cls: 'spellbook-planner-message' });
    const columns = root.createDiv({ cls: 'spellbook-planner-columns' });
    const calendar = new CalendarPart(columns, this);
    this.calendar = calendar;
    this.todos = new TodoPart(columns, this, this.doneCollapsed, (collapsed) => {
      this.doneCollapsed = collapsed;
      this.remember();
    });
    this.els = { root, tabs, message };
    this.showTab(this.tab);

    // Every layout goes by measured widths: the pane's for the tabs, the
    // calendar's own for what it has room for.
    if (typeof ResizeObserver === 'function') {
      const observer = new ResizeObserver(() => {
        this.measure();
      });
      observer.observe(pane);
      for (const element of calendar.observed()) observer.observe(element);
      this.observer = observer;
    }

    this.stops.push(
      this.host.onChange((change) => {
        this.onHostChange(change);
      }),
    );
    this.measure();
    this.render();
  }

  protected override async onClose(): Promise<void> {
    this.closed = true;
    for (const stop of this.stops.splice(0)) stop();
    this.stopRender?.();
    this.stopRender = null;
    this.observer?.disconnect();
    this.observer = null;
    // Ends a drag that is on and a list that is still being built.
    this.todos?.destroy();
    this.calendar?.destroy();
    this.todos = null;
    this.calendar = null;
    this.els = null;
    this.todo = null;
    this.todoSource = null;
    this.contentEl.empty();
    this.contentEl.removeClass('spellbook-planner-pane');
  }

  override onResize(): void {
    this.measure();
  }

  private measure(): void {
    const els = this.els;
    if (!els) return;
    this.wide = isWideEnough(this.contentEl.clientWidth, this.wide, SIDE_BY_SIDE_FROM, TABS_BELOW);
    els.root.toggleClass('spellbook-is-narrow', !this.wide);
    // The arrows for "previous" and "next" point the other way in an app that reads right to left.
    els.root.toggleClass('spellbook-is-rtl', readsRightToLeft(els.root));
    this.calendar?.measure();
  }

  // --------------------------------------------------------------------- tabs

  private addTab(parent: HTMLElement, tab: PlannerTab, label: string): HTMLElement {
    const button = parent.createEl('button', {
      cls: 'spellbook-planner-tab',
      text: label,
      attr: { type: 'button', role: 'tab', 'aria-selected': 'false' },
    });
    button.addEventListener('click', () => {
      this.showTab(tab);
      this.remember();
      // The part that came to the front was hidden until now, and so could not be measured.
      this.measure();
    });
    return button;
  }

  /** Bring one of the two parts to the front. On a wide pane both are shown anyway. */
  private showTab(tab: PlannerTab): void {
    this.tab = tab;
    const els = this.els;
    if (!els) return;
    els.root.toggleClass('spellbook-shows-calendar', tab === 'calendar');
    els.root.toggleClass('spellbook-shows-todos', tab === 'todos');
    for (const name of ['calendar', 'todos'] as const) {
      const on = name === tab;
      els.tabs[name].toggleClass('spellbook-is-current', on);
      els.tabs[name].setAttr('aria-selected', on ? 'true' : 'false');
    }
  }

  /** Ask Obsidian to save the layout, and with it what getState() gives. */
  private remember(): void {
    const workspace = this.app.workspace;
    const save: unknown = workspace.requestSaveLayout;
    if (typeof save === 'function') workspace.requestSaveLayout();
  }

  // ------------------------------------------------------------------ drawing

  private onHostChange(change: PlannerChange): void {
    if (this.closed) return;
    if (change === 'words') this.calendar?.wordsChanged();
    else this.scheduleRender();
  }

  /**
   * Draw again in a moment. The host often reports several changes in a row
   * (a file arrives, then the index, then the settings): they are all drawn
   * in one go.
   */
  private scheduleRender(): void {
    if (this.stopRender !== null || this.closed) return;
    this.stopRender = this.host.clock.setTimer(() => {
      this.stopRender = null;
      this.render();
    }, 0);
  }

  /** Everything one drawing is made from, read from the host as it is now. Null when no project is open. */
  private frameNow(): PlannerFrame | null {
    const host = this.host;
    const project = host.project;
    if (!project) return null;
    // The file is read by the engine once for each text it has had: the parts
    // tell by this that nothing changed.
    if (this.todo === null || project.todoText !== this.todoSource) {
      this.todoSource = project.todoText;
      this.todo = parseTodo(project.todoText);
    }
    return {
      project,
      todo: this.todo,
      marks: parseMarks(project.marks),
      today: host.today,
      firstDayOfWeek: host.firstDayOfWeek,
      words: host.words,
    };
  }

  private render(): void {
    const els = this.els;
    if (!els || this.closed) return;
    // A drawing that was about to happen is this one.
    this.stopRender?.();
    this.stopRender = null;
    const frame = this.frameNow();
    els.root.toggleClass('spellbook-has-no-project', frame === null);
    const message = frame === null ? NO_PROJECT_MESSAGE : '';
    if (message !== this.messageShown) {
      this.messageShown = message;
      els.message.setText(message);
    }
    this.calendar?.update(frame);
    this.todos?.update(frame);
  }

  // ----------------------------------------------------------------- changing

  /** Run `job` after every change that was asked for before it. */
  private enqueue<T>(job: () => Promise<T>): Promise<T> {
    const run = this.queue.then(job, job);
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private tell(what: string, error: unknown): void {
    console.error(`Spellbook: "${what}" failed`, error);
    new Notice(`"${what}" did not work: ${error instanceof Error ? error.message : String(error)}`, PROBLEM_NOTICE_MS);
  }

  /** Have the host read the project's files again. */
  private async reread(): Promise<void> {
    try {
      await this.host.refresh();
    } catch (error) {
      console.error('Spellbook: the planner could not be brought up to date', error);
    }
  }

  editTodo(what: string, edit: (text: string) => TodoEdit, quiet = false): Promise<TodoEdit | null> {
    return this.enqueue(async () => {
      let result: TodoEdit;
      try {
        result = await this.host.applyTodoEdit(edit);
      } catch (error) {
        this.tell(what, error);
        this.render();
        return null;
      }
      if (this.closed) return result;
      if (result.status === 'noop' && result.reason !== 'unchanged') {
        // The to-do (or the one it was to go next to) is no longer in the
        // file as the list showed it: say so, and show the file as it is.
        new Notice(TODO_CHANGED_NOTICE);
        await this.reread();
      } else if (result.status === 'refused' && !quiet) {
        new Notice(result.message);
      }
      this.render();
      return result;
    });
  }

  editMarks(what: string, edit: (marks: unknown) => MarksEdit): Promise<MarksEdit | null> {
    return this.enqueue(async () => {
      let result: MarksEdit;
      try {
        result = await this.host.applyMarksEdit(edit);
      } catch (error) {
        this.tell(what, error);
        this.render();
        return null;
      }
      if (this.closed) return result;
      if (result.status === 'refused') {
        // The engine's own words: which day, and what the writer can do about it.
        new Notice(result.message, PROBLEM_NOTICE_MS);
      } else if (result.status === 'noop' && result.reason === 'not-found') {
        // The mark was already gone: show the marks as they are.
        await this.reread();
      }
      this.render();
      return result;
    });
  }
}

/** Make the planner's view for a pane. This is what the plugin registers under PLANNER_VIEW_TYPE. */
export function createPlannerView(leaf: WorkspaceLeaf, host: PlannerHost): PlannerView {
  return new PlannerView(leaf, host);
}
