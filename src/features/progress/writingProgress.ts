// Writing progress, put together: the editor is watched, the words typed on
// this device are counted and saved in the daily log, the bottom bar shows
// the line of figures for the open note, scenes get their dates when the
// writer leaves them, and the other screens are offered the line and the log.
//
// All the deciding is done by the engine in src/core/progress. This file
// connects it to Obsidian (the editor, the workspace, the status bar) and to
// the project store, and lets go of every one of those when the plugin unloads.

import type { Extension } from '@codemirror/state';
import { Notice, Platform, moment } from 'obsidian';
import type { App, Tasks } from 'obsidian';
import { binderTotals, isChapterNote, placeOfNote, scenesWithNotes } from '../../core/binderModel';
import { isDateText } from '../../core/dates';
import { findTag, parseTagList, readSceneFields, TAG_INDEX_KEYS } from '../../core/cards/index';
import { clashKey, isInside, isMarkdownPath, joinPath, noteTitle, parentPath, relativeTo } from '../../core/paths';
import { overdueTasks, parseTodo } from '../../core/planner/index';
import type { TodoFile } from '../../core/planner/index';
import { TODO_FILE } from '../../core/projectLayout';
import {
  STATS_FOLDER,
  TARGETS_KEY,
  addToTotals,
  barItemIds,
  withoutWordItems,
  buildStatusLine,
  countsOn,
  firstDayOfWeekOf,
  formatDisplayDate,
  formatNumber,
  monthOf,
  parseTargets,
  readWordTarget,
  sceneEditedDate,
  sceneStartDate,
  summariseWords,
  totalsForMonth,
  totalsForWeek,
  updateTargets,
  writingAverage,
  writingProgress,
  writingStreak,
} from '../../core/progress/index';
import type { BarButtonEntry, BarItemId, DailyTotals, DayCounts, StatusLineInput, StatusSegment } from '../../core/progress/index';
import type { Frontmatter, ProjectSnapshot, StoreChange } from '../../core/types';
import type { VaultEvent } from '../../core/vaultPort';
import { countWords } from '../../core/wordCount';
import type { FeatureContext } from '../registry';
import { BarPrefs } from './barPrefs';
import { findCommand, runCommand } from './commands';
import { editorWatch } from './editorWatch';
import { SceneDateKeeper } from './sceneDateKeeper';
import { SCENE_LINE_SERVICE, STATS_SERVICE } from './services';
import type { DayWords, SceneLineButton, SceneLineService, StatsService, StatsSummary } from './services';
import { ProgressPrefs, progressSettings } from './settings';
import { StatsLog } from './statsLog';
import { StatusBar } from './statusBar';
import type { BarPiece } from './statusBar';
import { TargetsModal } from './targetsModal';
import type { TargetsChoice } from './targetsModal';
import { WordLedger } from './wordLedger';
import type { EditorEdit } from './wordLedger';
import { PROBLEM_NOTICE_MS } from '../../ui/notices';
import { onWordCountsChange, showsWordCounts } from '../../ui/wordFigures';

/** How long after a note was last saved its words are counted again from the vault. */
export const RECOUNT_AFTER_MS = 1000;

/** The name under which the writing progress asks for word counts (see WordCountCache.track). */
export const WORD_COUNT_ASKER = 'progress';

/** How long after midnight "today" is looked at again: a little late rather than a moment too early. */
export const AFTER_MIDNIGHT_MS = 1000;

/** How often the date is looked at when the clock cannot tell how long it is until midnight. */
export const DAY_CHECK_MS = 60000;

/** The note in front, and what is shown about it. */
interface OpenNote {
  /** The note's vault path. */
  path: string;
  /** Its words as last counted; null until they have been. */
  words: number | null;
  /** Its properties as the vault last indexed them. */
  frontmatter: Readonly<Frontmatter> | null;
}

const byDate = ([a]: [string, unknown], [b]: [string, unknown]): number => (a < b ? -1 : a > b ? 1 : 0);

const later = (a: string | null, b: string | null): string | null => (a === null ? b : b === null || a >= b ? a : b);

/** The notes that are open in a tab somewhere, as vault paths. */
function openNotePaths(app: App): Set<string> {
  const paths = new Set<string>();
  app.workspace.iterateAllLeaves((leaf) => {
    const file = (leaf.view as { file?: { path?: unknown } | null } | null)?.file;
    if (file && typeof file.path === 'string') {
      paths.add(file.path);
      return;
    }
    // A tab that has not been shown yet since Obsidian started only knows its note by name.
    const named = leaf.getViewState().state?.['file'];
    if (typeof named === 'string') paths.add(named);
  });
  return paths;
}

function tell(listeners: ReadonlySet<() => void>): void {
  for (const listener of [...listeners]) {
    try {
      listener();
    } catch (error) {
      console.error('Spellbook: a listener of the writing progress failed', error);
    }
  }
}

function listen(listeners: Set<() => void>, listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export class WritingProgress {
  private readonly context: FeatureContext;
  private readonly prefs: ProgressPrefs;
  /** The writer's layout of the bar on this device. */
  private readonly barPrefs: BarPrefs;
  private readonly ledger: WordLedger;
  private readonly log: StatsLog;
  private readonly dates: SceneDateKeeper;

  /** What the editor was given. Emptied on unload, so that the editor lets go of it. */
  private readonly extensions: Extension[] = [];
  private bar: StatusBar | null = null;
  private targetsWindow: TargetsModal | null = null;
  private readonly lineListeners = new Set<() => void>();
  private readonly statsListeners = new Set<() => void>();
  /** What to call to stop listening to the vault, the store and the word counts. */
  private readonly stops: Array<() => void> = [];

  private open: OpenNote | null = null;
  /** The open project as it was last seen, to tell when its folder moves. */
  private project: { readonly indexPath: string; readonly folder: string } | null = null;
  /** The line as it was last drawn, to tell whether it changed. */
  private shownLine = '';
  private statsDirty = false;
  private readingLog = false;
  /** The open project's To-do.md as last read (by the project's index path); null until it has been, and after it changed. */
  private todo: { readonly indexPath: string; readonly file: TodoFile } | null = null;
  /** The to-dos that are due, as last worked out, and what they were worked out from. */
  private todoDue: { readonly file: TodoFile; readonly day: string; readonly dueToday: number; readonly late: number } | null = null;
  /** Goes up with every reading of To-do.md that is started: only the newest answer counts. */
  private todoReading = 0;
  private todoBeingRead = false;
  /** The date as it was last looked at, to notice midnight passing. */
  private day: string;
  /** Cancels the timer that waits for the date to change. */
  private cancelDayWatch: (() => void) | null = null;
  private cancelRedraw: (() => void) | null = null;
  private cancelRecount: (() => void) | null = null;
  private closed = false;

  constructor(context: FeatureContext) {
    this.context = context;
    this.day = context.clock.today();
    this.prefs = new ProgressPrefs(context.storage);
    this.barPrefs = new BarPrefs(context.storage);
    this.log = new StatsLog(context.store);
    this.dates = new SceneDateKeeper(context.store);
    this.ledger = new WordLedger({
      store: context.store,
      clock: context.clock,
      deviceId: () => context.deviceId,
      countPasted: () => this.prefs.countPasted,
      onMeasured: (path, words) => {
        if (this.open?.path === path) this.open.words = words;
      },
      onChange: () => {
        this.statsDirty = true;
        this.refresh();
      },
      onSaved: (saved) => {
        this.log.saved(saved.indexPath, saved.path, saved.file);
      },
      onProblem: (message) => {
        new Notice(`Spellbook: ${message}`, PROBLEM_NOTICE_MS);
      },
    });
  }

  /** Register everything. Called once, when the project store is ready. */
  start(): void {
    const { context } = this;
    const { plugin, app, store } = context;

    // The editor: one extension, which only reports what was changed.
    this.extensions.push(editorWatch((edit) => this.onEdit(edit)));
    plugin.registerEditorExtension(this.extensions);

    // The bottom bar. A phone has none; there the inspector shows the line.
    if (!Platform.isPhone) {
      try {
        this.bar = new StatusBar(
          plugin.addStatusBarItem(),
          () => this.openTargets(),
          // A button whose command is not there does nothing.
          (command) => void runCommand(app, command),
        );
      } catch (error) {
        console.error('Spellbook: the bottom bar could not be added', error);
      }
    }

    plugin.registerEvent(app.workspace.on('file-open', (file) => this.onNoteInFront(file?.path ?? null)));
    plugin.registerEvent(app.workspace.on('layout-change', () => this.onLayoutChange()));
    plugin.registerEvent(
      app.workspace.on('quit', (tasks: Tasks) => {
        tasks.add(() => this.leave());
      }),
    );
    const page = app.workspace.containerEl.ownerDocument;
    plugin.registerDomEvent(page, 'visibilitychange', () => this.onVisibility(page.visibilityState === 'hidden'));

    this.stops.push(
      context.vault.on((event) => this.onVaultEvent(event)),
      store.onChange((change) => this.onStoreChange(change)),
      context.wordCounts.onChange((paths) => this.onWordCounts(paths)),
      // The writer changed the bar in the settings: draw it anew.
      this.barPrefs.onChange(() => this.refresh()),
      // Word counts were switched on or off on this device: the same.
      onWordCountsChange(() => this.refresh()),
    );

    plugin.addCommand({
      id: 'set-writing-targets',
      name: 'Set writing targets',
      // Only offered while a project is open: the targets belong to a project.
      checkCallback: (checking) => {
        if (store.project === null) return false;
        if (!checking) this.openTargets();
        return true;
      },
    });
    context.addSettingsSection(progressSettings(this.prefs, { prefs: this.barPrefs, app }));

    const sceneLine: SceneLineService = {
      current: () => this.line(),
      buttons: () => this.buttons(),
      // A button whose command is not there does nothing.
      run: (command) => void runCommand(app, command),
      onChange: (listener) => listen(this.lineListeners, listener),
    };
    const stats: StatsService = {
      wordsByDay: (from, to) => this.wordsByDay(from, to),
      summary: (today) => this.summary(today),
      onChange: (listener) => listen(this.statsListeners, listener),
    };
    context.services.provide(SCENE_LINE_SERVICE, sceneLine);
    context.services.provide(STATS_SERVICE, stats);

    context.onUnload(() => this.stop());

    this.followProject(false);
    this.lookAt(app.workspace.getActiveFile()?.path ?? null);
    this.watchDay();
  }

  /** The plugin is unloading: save what is not saved yet, then let go of everything. */
  stop(): void {
    if (this.closed) return;
    // Unsaved dates and numbers first. Both are asked of the store before anything is let go of.
    this.dates.handle({ type: 'unload' });
    void this.ledger.flush();
    this.ledger.stop();

    this.closed = true;
    this.cancelDayWatch?.();
    this.cancelDayWatch = null;
    this.cancelRedraw?.();
    this.cancelRedraw = null;
    this.cancelRecount?.();
    this.cancelRecount = null;
    for (const stop of this.stops.splice(0)) stop();
    this.barPrefs.close();
    this.todo = null;
    this.todoDue = null;
    this.todoReading++;
    this.context.wordCounts.release(WORD_COUNT_ASKER);
    this.targetsWindow?.close();
    this.targetsWindow = null;
    this.bar?.remove();
    this.bar = null;
    this.lineListeners.clear();
    this.statsListeners.clear();
    this.open = null;
    // The editor stops reporting to the plugin.
    this.extensions.length = 0;
    this.context.app.workspace.updateOptions();
  }

  // ----------------------------------------------------- the editor and the app

  /** A change in the editor. Runs inside the editor's own update: nothing is counted or drawn here. */
  private onEdit(edit: EditorEdit): void {
    if (this.closed) return;
    this.ledger.edit(edit);
    // Midnight may have passed since the date was last looked at (the timer for it can run late).
    const today = this.newDay();
    // What the writer did marks the scene as edited today; what came from elsewhere does not.
    if (edit.kind !== 'external') this.dates.typed(edit.path, today);
  }

  /**
   * Look at the date. When it is another day than when it was last looked
   * at, yesterday's words are saved at once and every figure that is about
   * "today" starts again: the line is drawn anew, and whoever reads the log
   * (the planner) is told. Nothing is counted or drawn here itself, so it is
   * safe inside the editor's update.
   *
   * @returns today's date
   */
  private newDay(): string {
    const today = this.context.clock.today();
    if (today !== this.day) {
      this.day = today;
      this.ledger.soon();
      this.statsDirty = true;
      this.refresh();
    }
    return today;
  }

  /**
   * Wait for the date to change, so that "today" rolls over at midnight
   * also when nothing is typed and nothing else happens. One timer, set for
   * just after midnight; where the clock cannot say when that is, the date
   * is looked at once a minute instead.
   */
  private watchDay(): void {
    if (this.closed || this.cancelDayWatch !== null) return;
    const { clock } = this.context;
    const left = clock.untilTomorrow?.();
    const wait = left !== undefined && Number.isFinite(left) && left >= 0 ? left + AFTER_MIDNIGHT_MS : DAY_CHECK_MS;
    this.cancelDayWatch = clock.setTimer(() => {
      this.cancelDayWatch = null;
      if (this.closed) return;
      this.newDay();
      // Fired a little early (the device's clock was set back)? Then the wait simply starts again.
      this.watchDay();
    }, wait);
  }

  /** Another note is in front (or none is): the scenes that were typed in and left get their date. */
  private onNoteInFront(path: string | null): void {
    if (this.closed) return;
    this.dates.handle({ type: 'opened', path });
    this.lookAt(path);
  }

  private onLayoutChange(): void {
    if (this.closed || !this.dates.hasWaiting) return;
    this.dates.closedExcept(openNotePaths(this.context.app));
  }

  private onVisibility(hidden: boolean): void {
    if (this.closed) return;
    if (hidden) {
      // The app may not come back: a phone can close it while it is out of sight.
      this.dates.handle({ type: 'background' });
      void this.ledger.flush();
    } else {
      // Time has passed, perhaps a whole night: a timer that should have fired
      // while the device slept may not have yet.
      this.newDay();
      this.ledger.poke();
      this.statsDirty = true;
      this.refresh();
    }
  }

  /** The app is closing: one last save, as far as there is time for it. */
  private async leave(): Promise<void> {
    if (this.closed) return;
    this.dates.handle({ type: 'unload' });
    await Promise.all([this.ledger.flush(), this.dates.idle()]);
  }

  // --------------------------------------------------- the vault and the project

  private onVaultEvent(event: VaultEvent): void {
    if (this.closed) return;
    this.todoTouched(event);
    switch (event.type) {
      case 'rename':
        if (event.folder) {
          this.logChanged(null);
          return;
        }
        this.ledger.renamed(event.oldPath, event.path);
        this.dates.handle({ type: 'renamed', from: event.oldPath, to: event.path });
        if (this.open?.path === event.oldPath) this.open.path = event.path;
        this.logChanged(event.oldPath, true);
        this.logChanged(event.path);
        this.refresh();
        return;
      case 'delete':
        if (event.folder) {
          this.ledger.removedFolder(event.path);
          this.logChanged(null);
        } else {
          this.ledger.removed(event.path);
          this.dates.handle({ type: 'deleted', path: event.path });
          if (this.open?.path === event.path) this.open = null;
          this.logChanged(event.path, true);
        }
        this.refresh();
        return;
      case 'create':
        if (!event.folder) this.logChanged(event.path);
        return;
      case 'modify':
        this.logChanged(event.path);
        if (this.open?.path === event.path) this.recountSoon();
        return;
      case 'metadata':
        if (this.open?.path === event.path) {
          this.open.frontmatter = event.frontmatter;
          this.refresh();
        }
        return;
      case 'refresh':
        this.logChanged(null);
        if (this.open) this.open.frontmatter = this.indexedProperties(this.open.path);
        this.refresh();
        return;
      default:
        return;
    }
  }

  /**
   * A file changed that may be one of the open project's word logs (null:
   * any of them may have). It is read again when the totals are next wanted.
   */
  private logChanged(path: string | null, gone = false): void {
    if (path === null) {
      this.log.reset();
    } else {
      const project = this.context.store.project;
      const inProject = project === null ? null : relativeTo(project.folder, path);
      if (inProject === null || parentPath(inProject) !== STATS_FOLDER) return;
      if (gone) this.log.gone(inProject);
      else this.log.touch(inProject);
    }
    this.statsDirty = true;
    this.refresh();
  }

  private onStoreChange(change: StoreChange): void {
    if (this.closed || change.type !== 'project') return;
    this.followProject(change.movedFrom !== undefined);
    this.statsDirty = true;
    // Words counted for a project that was not open can be saved once it is.
    this.ledger.poke();
    this.refresh();
  }

  /** Take note of which project is open now. */
  private followProject(moved: boolean): void {
    const now = this.context.store.project;
    const before = this.project;
    if (moved && before !== null && now !== null && before.folder !== now.folder) {
      this.ledger.projectMoved(before.folder, now.folder);
    }
    this.project = now === null ? null : { indexPath: now.indexPath, folder: now.folder };
    this.log.follow(now?.indexPath ?? null, moved);
    this.countManuscript(now);
  }

  /**
   * Ask for the words of every scene of the open project, under this
   * feature's own name: the project total, the percent of the target and the
   * words a day until the deadline are then there whichever other screens are
   * open, the binder included. With no project open, nothing is asked for.
   */
  private countManuscript(project: ProjectSnapshot | null): void {
    const { store, wordCounts } = this.context;
    if (project === null) {
      wordCounts.release(WORD_COUNT_ASKER);
      return;
    }
    const wanted: string[] = [];
    for (const path of scenesWithNotes(project.tree)) {
      const vaultPath = store.vaultPathOf(path);
      if (vaultPath !== null) wanted.push(vaultPath);
    }
    wordCounts.track(WORD_COUNT_ASKER, wanted);
  }

  private onWordCounts(paths: readonly string[]): void {
    if (this.closed) return;
    const open = this.open;
    // While the note is being typed in, the editor is ahead of the saved file.
    if (open !== null && paths.includes(open.path) && !this.ledger.isTyping(open.path)) {
      const words = this.context.wordCounts.get(open.path);
      if (typeof words === 'number') open.words = words;
    }
    this.refresh();
  }

  // ------------------------------------------------------------- the open note

  /** Make `path` the note the line is about (null, or anything that is not a note, for none). */
  private lookAt(path: string | null): void {
    const wanted = path !== null && isMarkdownPath(path) ? path : null;
    if (wanted === null) {
      this.open = null;
    } else if (this.open?.path !== wanted) {
      const shared = this.context.wordCounts.get(wanted);
      this.open = {
        path: wanted,
        words: typeof shared === 'number' ? shared : null,
        frontmatter: this.indexedProperties(wanted),
      };
      if (typeof shared !== 'number') this.recount();
    }
    this.refresh();
  }

  /** A note's properties as the vault has indexed them. Reads no file. */
  private indexedProperties(path: string): Readonly<Frontmatter> | null {
    return this.context.vault.listMarkdownFiles(parentPath(path)).find((file) => file.path === path)?.frontmatter ?? null;
  }

  /** The open note was saved: count it again in a moment, unless that is being done for us. */
  private recountSoon(): void {
    this.cancelRecount?.();
    this.cancelRecount = this.context.clock.setTimer(() => {
      this.cancelRecount = null;
      this.recount();
    }, RECOUNT_AFTER_MS);
  }

  /**
   * Count the open note's words from the vault. Not while it is being typed
   * in (the editor's own text is counted when typing pauses), and not when
   * the shared word counts have the note (the binder is showing it).
   */
  private recount(): void {
    const open = this.open;
    if (open === null || this.closed || this.ledger.isTyping(open.path)) return;
    const path = open.path;
    const shared = this.context.wordCounts.get(path);
    if (shared !== undefined) {
      if (typeof shared === 'number' && open.words !== shared) {
        open.words = shared;
        this.refresh();
      }
      return;
    }
    this.context.vault.readText(path).then(
      (text) => {
        const current = this.open;
        if (this.closed || current === null || current.path !== path || this.ledger.isTyping(path)) return;
        const words = countWords(text);
        if (current.words === words) return;
        current.words = words;
        this.refresh();
      },
      () => undefined, // the note is gone, or cannot be read: there is nothing to show for it
    );
  }

  // ------------------------------------------------------------------- the line

  /** Draw the line again, once, before the screen is next drawn. */
  private refresh(): void {
    if (this.closed || this.cancelRedraw !== null) return;
    this.cancelRedraw = this.context.clock.nextFrame(() => {
      this.cancelRedraw = null;
      this.redraw();
    });
  }

  private redraw(): void {
    if (this.closed) return;
    if (this.bar !== null || this.lineListeners.size > 0) {
      const segments = this.line();
      // The bar itself leaves alone every piece that shows what it showed.
      this.bar?.show(this.pieces(segments));
      // The inspector's line is the figures and, after them, the buttons.
      const shown = JSON.stringify([segments, this.lineListeners.size > 0 ? this.buttons() : []]);
      if (shown !== this.shownLine) {
        this.shownLine = shown;
        tell(this.lineListeners);
      }
    }
    if (this.statsDirty) {
      this.statsDirty = false;
      tell(this.statsListeners);
    }
  }

  /**
   * What the bar holds, in the writer's order: the pieces of the line, with
   * the shortcut buttons between them. Nothing at all with no project open.
   */
  private pieces(segments: readonly StatusSegment[]): BarPiece[] {
    const { store } = this.context;
    if (store.project === null || this.closed) return [];
    const pieces: BarPiece[] = [];
    this.barPrefs.layout.entries.forEach((entry, index) => {
      if (entry.kind === 'item') {
        const segment = segments.find((candidate) => candidate.id === entry.id);
        if (segment !== undefined) pieces.push({ kind: 'figure', segment });
        return;
      }
      pieces.push({ kind: 'button', ...this.button(entry, index) });
    });
    return pieces;
  }

  /** A shortcut button as it stands now: what its command is called, and whether there is such a command. */
  private button(entry: BarButtonEntry, index: number): SceneLineButton {
    const command = findCommand(this.context.app, entry.command);
    return {
      key: `button:${index}`,
      command: entry.command,
      label: entry.label,
      icon: entry.icon,
      name: command?.name ?? entry.command,
      available: command !== null,
    };
  }

  /** The shortcut buttons the writer chose, in the writer's order, for the inspector's line. None with no project open. */
  private buttons(): SceneLineButton[] {
    if (this.context.store.project === null || this.closed) return [];
    return this.barPrefs.layout.entries.flatMap((entry, index) => (entry.kind === 'button' ? [this.button(entry, index)] : []));
  }

  /** The pieces of the line as they stand now: the figures the writer chose, in the writer's order. */
  private line(): StatusSegment[] {
    const { store, vault, clock } = this.context;
    const project = store.project;
    if (project === null || this.closed) return [];

    // Only what the bar shows is worked out. With word counts hidden on this
    // device, the figures that are words are left out (they are still counted).
    const chosen = barItemIds(this.barPrefs.layout);
    const items = showsWordCounts() ? chosen : withoutWordItems(chosen);
    const wants = (...ids: BarItemId[]): boolean => ids.some((id) => items.includes(id));
    if (items.length === 0) return [];

    const targets = parseTargets(store.projectData(TARGETS_KEY)).targets;
    const today = clock.today();
    let figures: StatusLineInput = {
      sessionWords: wants('session') ? this.ledger.tracker.session().net : null,
      projectWords: wants('project') ? this.projectWords(project) : null,
      projectTarget: targets.project,
      todayWords: wants('today') ? this.todayWords(project, today) : null,
      dailyTarget: targets.daily,
      todos: wants('todos') ? this.todosDue(project, today) : null,
    };
    const open = this.open;
    if (open !== null && isInside(project.folder, open.path)) {
      figures = {
        ...figures,
        sceneWords: open.words,
        sceneTarget: readWordTarget(open.frontmatter?.['target']),
        started: wants('started') ? sceneStartDate(open.frontmatter, vault.createdDay(open.path)) : null,
        // Typed in today, and the date not written into the note yet: today it is.
        edited: wants('edited') ? later(sceneEditedDate(open.frontmatter), this.dates.waitingFor(open.path)) : null,
        sceneTitle: noteTitle(open.path),
        chapter: isChapterNote(project, open.path),
        status: wants('status') ? this.statusOf(open.frontmatter) : null,
      };
    }
    return buildStatusLine(figures, items);
  }

  /** The open note's status: its name as the project's list of statuses spells it, and its colour there. */
  private statusOf(frontmatter: Readonly<Frontmatter> | null): { name: string; color: string | null } | null {
    const name = readSceneFields(frontmatter).status;
    if (name === null) return null;
    const listed = findTag(parseTagList('status', this.context.store.projectData(TAG_INDEX_KEYS.status)), name);
    return { name: listed?.name ?? name, color: listed?.color ?? null };
  }

  // ------------------------------------------------------------------ the to-dos

  /**
   * How many open to-dos are due today, and how many were due before; null
   * until To-do.md has been read. The file is read once, in the background,
   * and again only after it changed: never while the line is being drawn.
   */
  private todosDue(project: ProjectSnapshot, today: string): { dueToday: number; late: number } | null {
    const todo = this.todo;
    if (todo === null || todo.indexPath !== project.indexPath) {
      this.readTodo(project.indexPath);
      return null;
    }
    let due = this.todoDue;
    if (due === null || due.file !== todo.file || due.day !== today) {
      due = {
        file: todo.file,
        day: today,
        dueToday: todo.file.tasks.filter((task) => !task.done && task.due === today).length,
        late: overdueTasks(todo.file, today).length,
      };
      this.todoDue = due;
    }
    return due;
  }

  /** Read To-do.md in the background, and draw again when it is in. */
  private readTodo(indexPath: string): void {
    if (this.todoBeingRead || this.closed) return;
    this.todoBeingRead = true;
    const token = ++this.todoReading;
    const take = (text: string | null): void => {
      this.todoBeingRead = false;
      // The file changed again meanwhile, or another project was opened: the next drawing reads it anew.
      if (this.closed || token !== this.todoReading || this.context.store.project?.indexPath !== indexPath) {
        this.refresh();
        return;
      }
      // A file that is not there, or cannot be read, has no to-dos to show.
      this.todo = { indexPath, file: parseTodo(text ?? '') };
      this.refresh();
    };
    this.context.store.readDataFile(TODO_FILE).then(
      (result) => take(result.status === 'done' ? result.value : null),
      () => take(null),
    );
  }

  /** What is known of To-do.md is out of date. */
  private forgetTodo(): void {
    this.todo = null;
    this.todoDue = null;
    this.todoReading++;
  }

  /** Something happened in the vault: when it was to the open project's To-do.md, the file is read again when next wanted. */
  private todoTouched(event: VaultEvent): void {
    // A change of the text is reported as "modify"; "metadata" follows it and says nothing new.
    if (event.type === 'metadata') return;
    const project = this.context.store.project;
    if (project === null || (this.todo === null && !this.todoBeingRead)) return;
    if (event.type !== 'refresh') {
      const todo = clashKey(joinPath(project.folder, TODO_FILE));
      const touched = clashKey(event.path) === todo || (event.type === 'rename' && clashKey(event.oldPath) === todo);
      if (!touched) return;
    }
    this.forgetTodo();
    this.refresh();
  }

  /** The words of the whole manuscript, from the shared word counts; null while a scene is still uncounted. */
  private projectWords(project: ProjectSnapshot): number | null {
    const { store, wordCounts } = this.context;
    return binderTotals(project.tree, (path) => {
      const vaultPath = store.vaultPathOf(path);
      return vaultPath === null ? null : wordCounts.get(vaultPath);
    }).manuscript;
  }

  /** Net manuscript words written today on all devices; null until the logs have been read. */
  private todayWords(project: ProjectSnapshot, today: string): number | null {
    const saved = this.log.peek();
    if (saved === null) {
      this.readLog();
      return null;
    }
    return summariseWords(countsOn(this.withUnsaved(saved, project.folder), today)).manuscript.net;
  }

  /** Read the log files in the background, and draw again when they are in. */
  private readLog(): void {
    if (this.readingLog || this.closed) return;
    this.readingLog = true;
    const done = (): void => {
      this.readingLog = false;
      this.statsDirty = true;
      this.refresh();
    };
    this.log.totals().then(done, done);
  }

  // -------------------------------------------------------------------- the log

  /** Saved totals with the words this device has counted and not saved yet, in date order. */
  private withUnsaved(saved: DailyTotals, projectFolder: string): DailyTotals {
    const unwritten = this.ledger.unwrittenFor(projectFolder);
    if (unwritten.length === 0) return saved;
    return new Map([...addToTotals(saved, unwritten)].sort(byDate));
  }

  /** The words of every day of the open project, on all devices. */
  private async totals(): Promise<DailyTotals> {
    if (this.closed || this.context.store.project === null) return new Map();
    const saved = await this.log.totals();
    // The project may have changed while the files were read; the totals are the open one's.
    const project = this.context.store.project;
    return project === null ? new Map() : this.withUnsaved(saved, project.folder);
  }

  private async wordsByDay(from: string, to: string): Promise<ReadonlyMap<string, DayWords>> {
    const days = new Map<string, DayWords>();
    if (!isDateText(from) || !isDateText(to)) return days;
    const totals = await this.totals();
    for (const [date, counts] of [...totals].sort(byDate)) {
      if (date < from || date > to) continue;
      const words = summariseWords(counts);
      if (words.all.added === 0 && words.all.deleted === 0) continue;
      days.set(date, { manuscript: words.manuscript.net, all: words.all.net });
    }
    return days;
  }

  private async summary(today: string): Promise<StatsSummary> {
    const totals = await this.totals();
    const daily = parseTargets(this.context.store.projectData(TARGETS_KEY)).targets.daily;
    const month = monthOf(today);
    const net = (counts: DayCounts): number => summariseWords(counts).manuscript.net;
    return {
      streak: writingStreak(totals, today, 'manuscript').current,
      average: writingAverage(totals, 'manuscript').averageNet,
      // The week starts where the calendar grid starts it: on the first day of the week of Obsidian's language.
      weekTotal: net(totalsForWeek(totals, today, firstDayOfWeekOf(moment))),
      monthTotal: month === null ? 0 : net(totalsForMonth(totals, month)),
      dailyTarget: daily,
      dailyTargetMet: daily !== null && net(countsOn(totals, today)) >= daily,
    };
  }

  // ---------------------------------------------------------------- the targets

  /** Show the targets window for the open project. */
  private openTargets(): void {
    const { store, app, clock } = this.context;
    const project = store.project;
    if (this.closed) return;
    if (project === null) {
      new Notice('Open a Spellbook project first: targets belong to a project.');
      return;
    }
    if (project.readOnly) {
      new Notice(project.error ?? 'This project cannot be changed at the moment.', PROBLEM_NOTICE_MS);
      return;
    }

    const parsed = parseTargets(store.projectData(TARGETS_KEY));
    const open = this.open;
    const inProject = open === null ? null : relativeTo(project.folder, open.path);
    const place = inProject === null ? null : placeOfNote(project, inProject);
    const scenePath = place === 'binder' || place === 'unfiled' ? inProject : null;
    const indexPath = project.indexPath;

    this.targetsWindow?.close();
    const modal = new TargetsModal(app, {
      projectTitle: project.title,
      targets: parsed.targets,
      problems: parsed.problems,
      standing: this.standing(project, clock.today()),
      scene:
        scenePath === null ? null : { title: noteTitle(scenePath), target: readWordTarget(open?.frontmatter?.['target']) },
      save: (choice) => this.saveTargets(indexPath, scenePath, choice),
    });
    this.targetsWindow = modal;
    modal.open();
  }

  /** Where the writer stands against the targets, in a line or two. */
  private standing(project: ProjectSnapshot, today: string): string[] {
    const targets = parseTargets(this.context.store.projectData(TARGETS_KEY)).targets;
    const words = this.projectWords(project);
    const progress = writingProgress({
      targets,
      projectWords: words ?? 0,
      todayWords: this.todayWords(project, today) ?? 0,
      today,
    });
    const lines: string[] = [];
    if (progress.project !== null && words !== null) {
      const { target, percent } = progress.project;
      lines.push(`The manuscript has ${formatNumber(words)} of ${formatNumber(target)} words (${percent}%).`);
    }
    if (progress.deadline !== null) {
      const { deadline, daysLeft, passed, wordsPerDay } = progress.deadline;
      const date = formatDisplayDate(deadline) ?? deadline;
      if (passed) {
        lines.push(`The deadline, ${date}, has passed.`);
      } else {
        const days = daysLeft === 1 ? '1 day' : `${formatNumber(daysLeft)} days`;
        let pace = '';
        if (words !== null && wordsPerDay !== null) {
          pace = wordsPerDay === 0 ? ' The target is reached.' : ` That takes ${formatNumber(wordsPerDay)} words a day.`;
        }
        lines.push(`${days} of writing left until the deadline, ${date}, counting today.${pace}`);
      }
    }
    return lines;
  }

  /** Store what the writer chose in the targets window. Resolves with null, or with what went wrong. */
  private async saveTargets(indexPath: string, scenePath: string | null, choice: TargetsChoice): Promise<string | null> {
    const { store } = this.context;
    const stored = await store.updateProjectData(TARGETS_KEY, (current) => updateTargets(current, choice.targets), indexPath);
    if (stored.status === 'refused' || stored.status === 'failed') return stored.message;

    const target = choice.sceneTarget;
    if (scenePath === null || target === undefined) return null;
    const result = await store.updateNoteProperties(
      scenePath,
      (frontmatter) => {
        const has = Object.prototype.hasOwnProperty.call(frontmatter, 'target');
        if (target === null) {
          if (!has) return false;
          delete frontmatter['target'];
          return true;
        }
        if (has && frontmatter['target'] === target) return false;
        frontmatter['target'] = target;
        return true;
      },
      indexPath,
    );
    return result.status === 'refused' || result.status === 'failed' ? result.message : null;
  }
}
