// The planner's host: what stands between the planner screen and the plugin.
//
// The screen (plannerView.ts) knows the plugin only as a PlannerHost. This is
// that host, built on what every feature is handed (src/features/registry.ts):
//
//   reading   The open project and its day marks come from the project store.
//             The text of To-do.md is read through the store and kept here,
//             and read again whenever the file changes on disk, whoever
//             changed it: the writer in the editor, this screen, or another
//             device through sync.
//   changing  Every change goes through the store, which reads the file as
//             it is at that moment, hands that to the engine's edit, and
//             writes the answer: updateDataFile for To-do.md,
//             updateProjectData for the marks. Nothing is written from here.
//   words     The words of each day and the numbers under the calendar are
//             the writing-progress screen's. They are asked for through the
//             services, each time anew, so it does not matter which screen
//             started first; without them the calendar shows to-dos and
//             marks only.
//
// The host exists before a project is open (Obsidian restores panes while it
// starts up): until then it reports no project. It says so when a project
// opens, closes or changes, and when the day changes at midnight.

import { Notice } from 'obsidian';
import type { PaneType } from 'obsidian';
import { clashKey, joinPath } from '../../core/paths';
import { MARKS_KEY, monthRange } from '../../core/planner';
import type { DayWords, DayWordsSource, MarksEdit, TodoEdit, YearMonth } from '../../core/planner';
import { TODO_FILE } from '../../core/projectLayout';
import type { ProjectStore } from '../../core/projectStore';
import type { IntentResult, ProjectSnapshot, StoreChange } from '../../core/types';
import type { VaultEvent, VaultPort } from '../../core/vaultPort';
import type { DragClock } from '../../ui/dragDrop';
import type { FeatureClock, FeatureServices } from '../registry';
import type { PlannerChange, PlannerHost, PlannerProject, PlannerStats } from './plannerHost';
import { PROGRESS_STATS_SERVICE, TARGETS_KEY, asDays, asProgressStats, statsFrom, wordsOn } from './plannerNumbers';
import type { ProgressStats, ProgressSummary } from './plannerNumbers';

/** How often the host looks whether the day has changed, in milliseconds, while a planner is open. */
export const DAY_CHECK_MS = 60000;

/** How long a notice about something that went wrong stays up, in milliseconds. */
const PROBLEM_NOTICE_MS = 10000;

const NO_PROJECT = 'No project is open.';

/** What the host is built on: the parts of a FeatureContext it uses, and the week's first day. */
export interface WiringDeps {
  readonly store: ProjectStore;
  /** For listening only. Everything that writes goes through the store. */
  readonly vault: Pick<VaultPort, 'on'>;
  readonly clock: FeatureClock;
  readonly services: Pick<FeatureServices, 'get'>;
  /** Show a note in the main area (FeatureContext.openNote). */
  openNote(path: string, where?: PaneType | boolean): Promise<boolean>;
  /** The weekday that weeks start on, 0 (Sunday) to 6 (Saturday). Asked at every drawing. */
  firstDayOfWeek(): number;
}

/** A value as text, to tell whether it is still the same. */
function signatureOf(value: unknown): string {
  try {
    return JSON.stringify(value) ?? '';
  } catch {
    return '';
  }
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export class PlannerWiring implements PlannerHost {
  readonly clock: DragClock;

  private readonly listeners = new Set<(change: PlannerChange) => void>();
  private stops: Array<() => void> = [];
  private disposed = false;

  /** The index path of the project the store has open, as far as this host has followed it. */
  private following: string | null = null;
  /** True when `todoText` is the text of that project's To-do.md. */
  private loaded = false;
  private todoText = '';
  /** Goes up with every reading of To-do.md that is started: only the newest answer counts. */
  private reading = 0;
  private readsUnderWay = 0;

  /** The word counts this host is listening to, and how to stop. */
  private connected: ProgressStats | null = null;
  private stopStats: (() => void) | null = null;
  private stopRecheck: (() => void) | null = null;

  private stopDayCheck: (() => void) | null = null;
  private dayShown: string;
  private targetsShown: string;

  constructor(private readonly deps: WiringDeps) {
    this.clock = { setTimer: deps.clock.setTimer, nextFrame: deps.clock.nextFrame };
    this.dayShown = deps.clock.today();
    this.targetsShown = signatureOf(deps.store.projectData(TARGETS_KEY));
    this.stops.push(
      deps.store.onChange((change) => {
        this.onStoreChange(change);
      }),
      deps.vault.on((event) => {
        this.onVaultEvent(event);
      }),
    );
    // A project may be open already, and so may the word counts be on offer.
    // A screen that plugs itself in after this one offers them a moment later.
    this.followProject();
    this.connectStats();
    this.connectStatsSoon();
  }

  /** Let go of everything: nothing is listened to and no timer is left running. Calling it again does nothing. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const stop of this.stops.splice(0)) stop();
    this.dropStats();
    this.stopRecheck?.();
    this.stopRecheck = null;
    this.stopDayCheck?.();
    this.stopDayCheck = null;
    this.listeners.clear();
    this.following = null;
    this.loaded = false;
    this.todoText = '';
    this.reading++;
  }

  // ------------------------------------------------------------------ reading

  get project(): PlannerProject | null {
    if (this.disposed || !this.loaded) return null;
    const { store } = this.deps;
    const open = store.project;
    if (!open || open.indexPath !== this.following) return null;
    return { key: open.indexPath, todoText: this.todoText, marks: store.projectData(MARKS_KEY), readOnly: open.readOnly };
  }

  get today(): string {
    return this.deps.clock.today();
  }

  get firstDayOfWeek(): number {
    const day = this.deps.firstDayOfWeek();
    return Number.isInteger(day) && day >= 0 && day <= 6 ? day : 0;
  }

  get words(): DayWordsSource | null {
    const service = this.lookUp();
    // Another one than was listened to (or the first one): listen to it, and tell every planner.
    if (service !== this.connected) this.connectStatsSoon();
    return service;
  }

  async stats(month: YearMonth): Promise<PlannerStats | null> {
    const service = this.lookUp();
    if (!service) return null;
    const today = this.today;
    const range = monthRange(month.year, month.month);
    const [summary, monthDays] = await Promise.all([
      this.ask<ProgressSummary | null | undefined>('the numbers under the calendar', () =>
        typeof service.summary === 'function' ? service.summary(today) : null,
      ),
      this.ask('the words of the month', () => service.wordsByDay(range.from, range.to)).then(asDays),
    ]);
    let todayWords: DayWords | null = null;
    if (today >= range.from && today <= range.to) {
      todayWords = monthDays === null ? null : wordsOn(monthDays, today);
    } else {
      const days = asDays(await this.ask("today's words", () => service.wordsByDay(today, today)));
      todayWords = days === null ? null : wordsOn(days, today);
    }
    return statsFrom({
      month,
      today,
      monthDays,
      todayWords,
      summary: summary ?? null,
      targets: this.deps.store.projectData(TARGETS_KEY),
    });
  }

  onChange(callback: (change: PlannerChange) => void): () => void {
    if (this.disposed) return () => undefined;
    if (this.listeners.size === 0) this.dayShown = this.deps.clock.today();
    this.listeners.add(callback);
    this.watchDay();
    return () => {
      this.listeners.delete(callback);
      if (this.listeners.size > 0) return;
      // Nobody is looking: no need to watch the clock.
      this.stopDayCheck?.();
      this.stopDayCheck = null;
    };
  }

  // ----------------------------------------------------------------- changing

  async applyTodoEdit(edit: (text: string) => TodoEdit): Promise<TodoEdit> {
    const open = this.openProject();
    const seen: { text: string; answer: TodoEdit | null } = { text: '', answer: null };
    const result = await this.deps.store.updateDataFile(
      TODO_FILE,
      (current) => {
        // The file as it is at this very moment; it may be asked more than once.
        seen.text = current ?? '';
        seen.answer = edit(seen.text);
        return seen.answer.status === 'done' ? seen.answer.text : null;
      },
      open.indexPath,
    );
    const answer = seen.answer;
    if (result.status === 'refused' || result.status === 'failed') throw new Error(result.message);
    if (answer === null) throw new Error(`${TODO_FILE} could not be read.`);
    if (this.following === open.indexPath && !this.disposed) {
      // An answer still on its way may be about the file as it was before this change.
      const overtaken = this.readsUnderWay > 0;
      this.take(result.status === 'done' && answer.status === 'done' ? answer.text : seen.text);
      if (overtaken) void this.readTodo();
    }
    return answer;
  }

  async applyMarksEdit(edit: (marks: unknown) => MarksEdit): Promise<MarksEdit> {
    const open = this.openProject();
    const seen: { answer: MarksEdit | null } = { answer: null };
    const result = await this.deps.store.updateProjectData(
      MARKS_KEY,
      (current) => {
        seen.answer = edit(current);
        if (seen.answer.status !== 'done') return current;
        // No marks left: the key goes, and no empty group is left behind in the project note.
        return Object.keys(seen.answer.marks).length === 0 ? undefined : seen.answer.marks;
      },
      open.indexPath,
    );
    // The store has read the index again by now, and said so if the marks differ.
    const answer = seen.answer;
    if (result.status === 'refused' || result.status === 'failed') throw new Error(result.message);
    if (answer === null) throw new Error('The day marks could not be read.');
    return answer;
  }

  async refresh(): Promise<void> {
    const open = this.disposed ? null : this.deps.store.project;
    if (!open) return;
    // The marks are read with the index note. The store reads that note again
    // for every change it is asked for, also one that changes nothing, as
    // this one: nothing is written.
    await this.deps.store.updateProjectData(MARKS_KEY, (current) => current, open.indexPath);
    await this.deps.store.idle();
    await this.readTodo();
  }

  // -------------------------------------------------------------- To-do.md

  /** True when there is a project whose To-do.md can be shown. */
  get hasProject(): boolean {
    return !this.disposed && this.deps.store.project !== null;
  }

  openTodoNote(): void {
    void this.showTodoNote();
  }

  /**
   * Show the open project's To-do.md in the editor. A project that has none
   * yet gets an empty one first, as a new project has.
   *
   * @returns whether the note was shown
   */
  async showTodoNote(): Promise<boolean> {
    const { store } = this.deps;
    const open = this.disposed ? null : store.project;
    if (!open) {
      new Notice(NO_PROJECT);
      return false;
    }
    try {
      let path = store.vaultPathOf(TODO_FILE);
      if (path === null) {
        const made = await store.updateDataFile(TODO_FILE, (current) => (current === null ? '' : null), open.indexPath);
        if (made.status === 'refused' || made.status === 'failed') {
          new Notice(`This project has no ${TODO_FILE} yet, and it could not be created: ${made.message}`, PROBLEM_NOTICE_MS);
          return false;
        }
        path = store.vaultPathOf(TODO_FILE) ?? joinPath(open.folder, TODO_FILE);
      }
      if (await this.deps.openNote(path)) return true;
    } catch (error) {
      console.error(`Spellbook: ${TODO_FILE} could not be opened`, error);
    }
    new Notice(`${TODO_FILE} could not be opened.`, PROBLEM_NOTICE_MS);
    return false;
  }

  // ---------------------------------------------------------------- following

  private emit(change: PlannerChange): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(change);
      } catch (error) {
        // A planner that fails to redraw must not stop the others.
        console.error('Spellbook: the planner could not follow a change', error);
      }
    }
  }

  /** The open project, or an error that says there is none. */
  private openProject(): ProjectSnapshot {
    const open = this.disposed ? null : this.deps.store.project;
    if (!open) throw new Error(NO_PROJECT);
    return open;
  }

  private onStoreChange(change: StoreChange): void {
    // The list of projects is not something the planner shows.
    if (change.type !== 'project' || this.disposed) return;
    const sameProject = this.followProject(change.movedFrom);
    this.connectStats();
    const targets = signatureOf(this.deps.store.projectData(TARGETS_KEY));
    const newTargets = targets !== this.targetsShown;
    this.targetsShown = targets;
    this.emit('data');
    // Another daily target: the numbers under the calendar are no longer right.
    // (Another project is asked about from scratch anyway.)
    if (newTargets && sameProject) this.emit('words');
  }

  /**
   * Take over the project the store has open now.
   *
   * @param movedFrom the index path the open project had until now, when it was renamed or moved
   * @returns true when it is the project that was followed already
   */
  private followProject(movedFrom?: string): boolean {
    const key = this.deps.store.project?.indexPath ?? null;
    if (key === this.following) return true;
    const moved = key !== null && movedFrom !== undefined && movedFrom === this.following;
    this.following = key;
    // The same project at another path keeps its to-dos; of any other one nothing is known yet.
    if (!moved) {
      this.loaded = false;
      this.todoText = '';
    }
    // An answer on its way is about the file where it was before.
    this.reading++;
    if (key !== null) void this.readTodo();
    return moved;
  }

  private onVaultEvent(event: VaultEvent): void {
    const open = this.disposed ? null : this.deps.store.project;
    if (!open) return;
    if (event.type === 'refresh') {
      void this.readTodo();
      return;
    }
    // A change of the text is reported as "modify"; "metadata" follows it and says nothing new.
    if (event.type === 'metadata') return;
    const todo = clashKey(joinPath(open.folder, TODO_FILE));
    const touched = clashKey(event.path) === todo || (event.type === 'rename' && clashKey(event.oldPath) === todo);
    if (touched) void this.readTodo();
  }

  /** Read To-do.md again and, when it says something else than before, tell the planners. */
  private async readTodo(): Promise<void> {
    const key = this.following;
    if (key === null || this.disposed) return;
    const token = ++this.reading;
    this.readsUnderWay++;
    let result: IntentResult<string | null>;
    try {
      result = await this.deps.store.readDataFile(TODO_FILE);
    } catch (error) {
      result = { status: 'failed', message: messageOf(error) };
    } finally {
      this.readsUnderWay--;
    }
    // A newer reading was started meanwhile, or another project was opened.
    if (this.disposed || token !== this.reading || this.following !== key) return;
    if (result.status === 'done') {
      this.take(result.value ?? '');
      return;
    }
    console.error(`Spellbook: ${TODO_FILE} could not be read: ${result.message}`);
    // Nothing is known of this project's to-dos: show the calendar and the marks all the same.
    if (!this.loaded) this.take('');
  }

  /** Take `text` as what To-do.md says now. Compared by content: the plugin's own writes come back as changes too. */
  private take(text: string): void {
    if (this.loaded && this.todoText === text) return;
    this.loaded = true;
    this.todoText = text;
    this.emit('data');
  }

  // -------------------------------------------------------------------- words

  /** The word counts, as they are on offer at this moment. Never kept: asked for each time. */
  private lookUp(): ProgressStats | null {
    if (this.disposed) return null;
    return asProgressStats(this.deps.services.get<unknown>(PROGRESS_STATS_SERVICE));
  }

  private async ask<T>(what: string, question: () => Promise<T> | T): Promise<T | null> {
    try {
      return await question();
    } catch (error) {
      console.error(`Spellbook: ${what} could not be read`, error);
      return null;
    }
  }

  private dropStats(): void {
    const stop = this.stopStats;
    this.stopStats = null;
    this.connected = null;
    try {
      stop?.();
    } catch (error) {
      console.error('Spellbook: the planner could not stop following the word counts', error);
    }
  }

  private connectStatsSoon(): void {
    if (this.stopRecheck !== null || this.disposed) return;
    this.stopRecheck = this.deps.clock.setTimer(() => {
      this.stopRecheck = null;
      this.connectStats();
    }, 0);
  }

  /** Listen to the word counts that are on offer now, when they are not the ones listened to already. */
  private connectStats(): void {
    const service = this.lookUp();
    if (service === this.connected) return;
    this.dropStats();
    this.connected = service;
    if (service && typeof service.onChange === 'function') {
      try {
        const stop: unknown = service.onChange(() => {
          if (this.connected === service) this.emit('words');
        });
        this.stopStats = typeof stop === 'function' ? (stop as () => void) : null;
      } catch (error) {
        console.error('Spellbook: the planner could not follow the word counts', error);
      }
    }
    // What `words` gives is another thing now: the planners read it again.
    this.emit('data');
  }

  // ---------------------------------------------------------------- midnight

  /** Look at the clock now and then while a planner is open, so that "today" moves on at midnight. */
  private watchDay(): void {
    if (this.stopDayCheck !== null || this.disposed || this.listeners.size === 0) return;
    this.stopDayCheck = this.deps.clock.setTimer(() => {
      this.stopDayCheck = null;
      const today = this.deps.clock.today();
      if (today !== this.dayShown) {
        this.dayShown = today;
        this.emit('data');
        // The streak, the week and today's target are counted from today.
        this.emit('words');
      }
      this.watchDay();
    }, DAY_CHECK_MS);
  }
}
