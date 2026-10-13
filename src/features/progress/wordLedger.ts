// Counting the words typed on this device, and saving them in the daily log.
//
// The logic is all the engine's (src/core/progress): the tracker decides what
// counts, its plan decides when to count and when to save. This file is the
// part around it that the engine cannot be: it holds on to the editor's text
// until it is time to count it, keeps one timer running, and writes the log
// file through the project store.
//
// What happens when:
//  - While the writer types, the editor reports every change (edit). Nothing
//    is counted then: the newest text is remembered, the tracker is told that
//    the note was typed in, and a timer is set.
//  - When typing has paused, the tracker's plan names the note; its words are
//    counted then, from the text that was remembered (measure).
//  - A paste, a drop, a cut, an undo, a redo and a change that did not come
//    from the writer need a count before and after. They wait in a queue for
//    a moment and are counted from there, outside the editor's update.
//  - When the plan says so, the counted words are saved: this device's file
//    for the month, in the Stats folder of the project the words were typed
//    for (the open project, or the project whose manuscript the note is in),
//    and no other file.

import { pathKey } from '../../core/paths';
import {
  MEASURE_AFTER_MS,
  STATS_FOLDER,
  WRITE_RETRY_MS,
  WordTracker,
  monthOf,
  statsFileName,
  updateStatsText,
} from '../../core/progress/index';
import type { EditKind, LogEntry, StatsFile, StatsUpdate } from '../../core/progress/index';
import type { ProjectStore } from '../../core/projectStore';
import { countWords } from '../../core/wordCount';
import type { FeatureClock } from '../registry';

/** How long changes that need counting wait before they are counted, so that it never happens inside the editor's own update. */
export const COUNT_AFTER_MS = 50;

/** However often saving fails, it is tried again at least this often. */
export const LONGEST_RETRY_MS = 5 * 60 * 1000;

/**
 * The texts of at most this many notes are held on to between edits (a note
 * that is being typed in is always kept). Enough for a day's writing; it
 * keeps a long session from holding half a novel in memory.
 */
export const MOST_WATCHED = 40;

/** The word counts of this many texts are remembered, newest first (two panes on one note take four). */
const REMEMBERED_COUNTS = 4;

/** A note's text as the editor holds it: it never changes, and it is only turned into a string when it is counted. */
export interface EditorText {
  toString(): string;
}

/** One change of a note's text, as the editor reported it. */
export interface EditorEdit {
  /** The note's vault path. */
  readonly path: string;
  readonly kind: EditKind;
  /** The whole text just before the change. */
  readonly before: EditorText;
  /** The whole text just after it. */
  readonly after: EditorText;
  /** Characters put in and taken out (not worked out for typing). */
  readonly inserted: number;
  readonly removed: number;
  /** False when the editor's own undo cannot take the change back. */
  readonly undoable: boolean;
}

/** A log file that was just saved: where it is and what it now holds. */
export interface SavedLog {
  /** The index path of the project it belongs to. */
  readonly indexPath: string;
  /** The file's path relative to the project folder. */
  readonly path: string;
  readonly file: StatsFile;
}

export interface LedgerDeps {
  readonly store: ProjectStore;
  readonly clock: FeatureClock;
  /** This device's id; asked for only when a log file is about to be saved. */
  readonly deviceId: () => string;
  /** The setting "Count pasted text". */
  readonly countPasted: () => boolean;
  /** A note's words were counted from the editor's text. */
  readonly onMeasured: (path: string, words: number) => void;
  /** The counted numbers changed, or were saved. */
  readonly onChange: () => void;
  /** This device's log file was saved. Called just before the saved words stop being "unwritten". */
  readonly onSaved: (saved: SavedLog) => void;
  /** Something the writer should know: the log could not be saved, and why. */
  readonly onProblem: (message: string) => void;
}

/** What is remembered about a note that was changed in the editor. */
interface Watched {
  /** The note's vault path. */
  path: string;
  /** The newest text of the note seen in the editor. */
  latest: EditorText;
  /** True when the tracker has been given the count of `latest`. */
  counted: boolean;
}

type Queued =
  /** The text is not the one the tracker last knew: count the old one (if it was typed in), then start from the new one. */
  | { readonly type: 'rebase'; path: string; readonly from: EditorText | null; readonly to: EditorText }
  | { readonly type: 'typed'; path: string }
  | {
      readonly type: 'edit';
      path: string;
      readonly kind: Exclude<EditKind, 'typed'>;
      readonly before: EditorText;
      after: EditorText;
      inserted: number;
      removed: number;
      readonly undoable: boolean;
    };

const least = (a: number | null, b: number): number => (a === null ? b : Math.min(a, b));

export class WordLedger {
  /** The engine's tracker. Read it for the session's words; only this file tells it anything. */
  readonly tracker: WordTracker;

  private readonly deps: LedgerDeps;
  /** The notes changed in the editor, by their path in one Unicode form. */
  private readonly watched = new Map<string, Watched>();
  /** Changes waiting to be counted, oldest first. */
  private queue: Queued[] = [];
  private cancelCount: (() => void) | null = null;
  private cancelWake: (() => void) | null = null;
  private wakeAt = 0;
  /** The save under way, if any. Only one runs at a time. */
  private saving: Promise<void> | null = null;
  /** How many saves in a row could not be written. */
  private failures = 0;
  /** No save is tried before this time (set after a failure). */
  private holdUntil = 0;
  private lastProblem: string | null = null;
  private stopped = false;
  /** The last few texts that were counted, so that the same text is not counted twice. */
  private counts: Array<[EditorText, number]> = [];

  constructor(deps: LedgerDeps) {
    this.deps = deps;
    this.tracker = new WordTracker({
      clock: () => ({ date: deps.clock.today(), time: deps.clock.now() }),
      projects: () => ({
        folders: deps.store.listProjects().map((project) => project.folder),
        active: deps.store.project?.folder ?? null,
      }),
      countPasted: deps.countPasted,
    });
  }

  // ------------------------------------------------------------ from the editor

  /**
   * A change of a note's text, reported from inside the editor's update.
   * Nothing is counted here.
   */
  edit(edit: EditorEdit): void {
    if (this.stopped) return;
    const key = pathKey(edit.path);
    let note = this.watched.get(key);

    if (note === undefined || note.latest !== edit.before) {
      // Not the text the tracker knows: the note is seen for the first time,
      // or it was loaded again, or it is open in a second pane.
      this.queue.push({
        type: 'rebase',
        path: edit.path,
        from: note !== undefined && !note.counted ? note.latest : null,
        to: edit.before,
      });
    }

    if (edit.kind === 'typed') {
      if (this.queue.length === 0) {
        this.tracker.edit({ path: edit.path, kind: 'typed' });
      } else {
        // Something is waiting to be counted: the typing waits its turn behind it.
        const last = this.queue[this.queue.length - 1];
        if (last?.type !== 'typed' || pathKey(last.path) !== key) this.queue.push({ type: 'typed', path: edit.path });
      }
    } else {
      const last = this.queue[this.queue.length - 1];
      if (
        edit.kind === 'external' &&
        last?.type === 'edit' &&
        last.kind === 'external' &&
        last.undoable === edit.undoable &&
        last.after === edit.before &&
        pathKey(last.path) === key
      ) {
        // A run of changes made by a program is counted as one.
        last.after = edit.after;
      } else {
        this.queue.push({
          type: 'edit',
          path: edit.path,
          kind: edit.kind,
          before: edit.before,
          after: edit.after,
          inserted: edit.inserted,
          removed: edit.removed,
          undoable: edit.undoable,
        });
      }
    }

    if (note === undefined) {
      note = { path: edit.path, latest: edit.after, counted: false };
      this.watched.set(key, note);
      if (this.watched.size > MOST_WATCHED) this.forgetOldest();
    } else {
      note.path = edit.path;
      note.latest = edit.after;
      note.counted = false;
    }

    if (this.queue.length > 0) {
      this.cancelCount ??= this.deps.clock.setTimer(() => {
        this.cancelCount = null;
        this.pump();
      }, COUNT_AFTER_MS);
    }
    this.wake(MEASURE_AFTER_MS);
  }

  /**
   * Let go of the texts of notes that were edited longest ago and have been
   * counted since. A note that is edited again after that is simply looked
   * at afresh, as if it had just been opened.
   */
  private forgetOldest(): void {
    for (const [key, note] of this.watched) {
      if (this.watched.size <= MOST_WATCHED) return;
      if (note.counted) this.watched.delete(key);
    }
  }

  /** True while the editor holds changes to this note that have not been counted yet. */
  isTyping(path: string): boolean {
    const note = this.watched.get(pathKey(path));
    return note !== undefined && !note.counted;
  }

  // ------------------------------------------------------------- from the vault

  /** A note was renamed or moved: what is known about it follows it. */
  renamed(from: string, to: string): void {
    for (const item of this.queue) {
      if (pathKey(item.path) === pathKey(from)) item.path = to;
    }
    const note = this.watched.get(pathKey(from));
    if (note) {
      this.watched.delete(pathKey(from));
      note.path = to;
      this.watched.set(pathKey(to), note);
    }
    this.tracker.renamed(from, to);
  }

  /** A note was deleted. The words typed in it stay counted. */
  removed(path: string): void {
    const key = pathKey(path);
    // What was typed in it and counted so far stays; what was not counted yet cannot be any more.
    this.queue = this.queue.filter((item) => pathKey(item.path) !== key);
    this.watched.delete(key);
    this.tracker.removed(path);
  }

  /** A folder was deleted, with every note in it. */
  removedFolder(folder: string): void {
    const prefix = `${pathKey(folder)}/`;
    for (const [key, note] of [...this.watched]) {
      if (key.startsWith(prefix)) this.removed(note.path);
    }
  }

  /** The open project's folder was renamed or moved: its counted words follow it. */
  projectMoved(from: string, to: string): void {
    this.tracker.projectMoved(from, to);
  }

  // -------------------------------------------------------------------- reading

  /** The words counted for a project and not yet in its log file. */
  unwrittenFor(projectFolder: string): LogEntry[] {
    const wanted = pathKey(projectFolder);
    return this.tracker.unwritten().filter((entry) => pathKey(entry.project) === wanted);
  }

  // ------------------------------------------------------------------ the clock

  /** Look at what is due now. Called when something changed that the plan depends on. */
  poke(): void {
    this.pump();
  }

  /** Look at what is due in a moment, once whatever is running now has ended (safe to call from the editor's update). */
  soon(): void {
    if (!this.stopped) this.wake(0);
  }

  /**
   * Everything at once: count what was typed and save it, without waiting
   * for a pause. For when the app goes to the background and when the plugin
   * unloads. When no save is under way, the log file's save is asked of the
   * store before this returns.
   */
  async flush(): Promise<void> {
    // A save that is under way ends first.
    while (this.saving !== null) await this.saving;
    this.count();
    const plan = this.tracker.plan(true);
    for (const path of plan.measure) this.measure(path);
    if (plan.measure.length > 0) this.deps.onChange();
    if (!plan.write || !this.hasSavable()) return;
    const entries = this.tracker.beginSave();
    if (entries.length > 0) await this.runSave(entries);
  }

  /** Stop for good: no more timers, and nothing the editor reports is taken in. A save under way still ends. */
  stop(): void {
    this.stopped = true;
    this.cancelCount?.();
    this.cancelCount = null;
    this.cancelWake?.();
    this.cancelWake = null;
    this.counts = [];
  }

  /** Have pump() called within `ms` milliseconds, unless it will be called sooner anyway. */
  private wake(ms: number): void {
    const at = this.deps.clock.now() + ms;
    if (this.cancelWake !== null && this.wakeAt <= at) return;
    this.cancelWake?.();
    this.wakeAt = at;
    this.cancelWake = this.deps.clock.setTimer(
      () => {
        this.cancelWake = null;
        this.pump();
      },
      Math.max(0, ms),
    );
  }

  /** Do what the engine's plan says is due, and sleep until the next thing is. */
  private pump(): void {
    if (this.stopped) return;
    this.cancelWake?.();
    this.cancelWake = null;

    let changed = this.count();
    let plan = this.tracker.plan();
    if (plan.measure.length > 0) {
      for (const path of plan.measure) this.measure(path);
      changed = true;
      plan = this.tracker.plan();
    }

    let wait = plan.wait;
    if (plan.write && this.saving === null) {
      const now = this.deps.clock.now();
      if (now < this.holdUntil) {
        wait = least(wait, this.holdUntil - now);
      } else if (this.hasSavable()) {
        const entries = this.tracker.beginSave();
        if (entries.length > 0) void this.runSave(entries);
      }
    }
    if (wait !== null) this.wake(wait);
    if (changed) this.deps.onChange();
  }

  // ------------------------------------------------------------------- counting

  /** The words in a text. The last few answers are remembered: a change's "before" is usually the "after" of the last one. */
  private wordsIn(text: EditorText): number {
    for (const [known, words] of this.counts) {
      if (known === text) return words;
    }
    const words = countWords(text.toString());
    this.counts.unshift([text, words]);
    if (this.counts.length > REMEMBERED_COUNTS) this.counts.length = REMEMBERED_COUNTS;
    return words;
  }

  /** Count a note the plan named, from the newest text the editor showed. */
  private measure(path: string): void {
    const note = this.watched.get(pathKey(path));
    if (!note) {
      // Nothing to count it from: without this the plan would name it for ever.
      this.tracker.removed(path);
      return;
    }
    const words = this.wordsIn(note.latest);
    this.tracker.measure(note.path, words);
    note.counted = true;
    this.deps.onMeasured(note.path, words);
  }

  /**
   * Count the changes that were waiting, in the order they were made.
   * Returns whether any figure may have changed by it (typing that is only
   * taken note of changes none: it is counted when it pauses).
   */
  private count(): boolean {
    this.cancelCount?.();
    this.cancelCount = null;
    if (this.queue.length === 0) return false;
    const queue = this.queue;
    this.queue = [];
    let counted = false;
    for (const item of queue) {
      if (item.type === 'typed') {
        this.tracker.edit({ path: item.path, kind: 'typed' });
        continue;
      }
      if (item.type === 'rebase') {
        if (item.from !== null) {
          this.tracker.measure(item.path, this.wordsIn(item.from));
          counted = true;
        }
        this.tracker.edit({ path: item.path, kind: 'external', wordsAfter: this.wordsIn(item.to) });
        continue;
      }
      counted = true;
      const before = this.wordsIn(item.before);
      const after = this.wordsIn(item.after);
      if (item.kind === 'external' && !item.undoable) {
        // The editor's undo cannot reach this change: the tracker keeps no step for it.
        this.tracker.measure(item.path, before);
        this.tracker.edit({ path: item.path, kind: 'external', wordsAfter: after });
      } else if (item.kind === 'external') {
        this.tracker.edit({ path: item.path, kind: 'external', wordsBefore: before, wordsAfter: after });
      } else {
        this.tracker.edit({
          path: item.path,
          kind: item.kind,
          wordsBefore: before,
          wordsAfter: after,
          chars: { inserted: item.inserted, removed: item.removed },
        });
      }
      const note = this.watched.get(pathKey(item.path));
      if (note && note.latest === item.after) {
        // Nothing was typed since: the tracker knows this text.
        note.counted = true;
        this.deps.onMeasured(note.path, after);
      }
    }
    return counted;
  }

  // --------------------------------------------------------------------- saving

  /**
   * Tells where an entry can be saved now: the index note of the project it
   * was counted for, or null when its log cannot be written at the moment.
   *
   * Words go into the log of the project they were typed for. Usually that
   * is the open project. Words typed in the manuscript of another project of
   * the vault are for that project: they are saved in its own log straight
   * away, so that they are not lost when the plugin unloads before the
   * writer opens that project. A project that is gone from the vault, and an
   * open project that is read-only, cannot be written to.
   */
  private logFinder(): (entry: LogEntry) => string | null {
    const { store } = this.deps;
    const open = store.project;
    let others: Map<string, string> | null = null;
    return (entry) => {
      const wanted = pathKey(entry.project);
      if (open !== null && pathKey(open.folder) === wanted) return open.readOnly ? null : open.indexPath;
      if (others === null) {
        others = new Map();
        for (const project of store.listProjects()) others.set(pathKey(project.folder), project.indexPath);
      }
      return others.get(wanted) ?? null;
    };
  }

  private hasSavable(): boolean {
    const indexOf = this.logFinder();
    return this.tracker.unwritten().some((entry) => indexOf(entry) !== null);
  }

  private runSave(entries: readonly LogEntry[]): Promise<void> {
    const run = this.save(entries).then(() => {
      this.saving = null;
      this.deps.onChange();
      this.pump();
    });
    this.saving = run;
    return run;
  }

  /**
   * One save, as the engine describes it: every entry goes into this device's
   * file for its month, the file is read and written in one step, and the
   * save ends with exactly one call to the tracker. Never rejects.
   */
  private async save(entries: readonly LogEntry[]): Promise<void> {
    const done: LogEntry[] = [];
    const saved: SavedLog[] = [];
    const problems: string[] = [];
    try {
      const { store } = this.deps;
      const indexOf = this.logFinder();
      // One group for every log file: a project, and a month of this device.
      const groups = new Map<string, { indexPath: string; path: string; month: string; entries: LogEntry[] }>();
      /** This device's id: made only when a log file really needs its name. */
      let device: string | null = null;
      for (const entry of entries) {
        const indexPath = indexOf(entry);
        if (indexPath === null) continue;
        device ??= this.deps.deviceId();
        const month = monthOf(entry.date);
        const name = month === null ? null : statsFileName(month, device);
        if (month === null || name === null) {
          problems.push(`The words of ${entry.date} could not be given a log file.`);
          continue;
        }
        const path = `${STATS_FOLDER}/${name}`;
        const key = `${indexPath}\n${path}`;
        const group = groups.get(key) ?? { indexPath, path, month, entries: [] };
        group.entries.push(entry);
        groups.set(key, group);
      }
      const owner = device ?? '';
      // Every file is asked of the store at once, so that when the plugin
      // is unloading nothing is left to start later.
      await Promise.all(
        [...groups.values()].map(async (group) => {
          const { indexPath, path } = group;
          const box: { update: StatsUpdate | null } = { update: null };
          // The store writes "Stats/<file>" of the project named, the open one or not, and nothing else.
          const result = await store.updateStatsFile(indexPath, path, (current) => {
            const update = updateStatsText(current, { device: owner, deviceName: '', month: group.month }, group.entries);
            box.update = update;
            return update.status === 'write' ? update.text : null;
          });
          const update = box.update;
          if (result.status === 'done' || (result.status === 'noop' && update !== null && update.status !== 'refused')) {
            done.push(...group.entries);
            if (result.status === 'done' && update?.status === 'write') {
              saved.push({ indexPath, path, file: update.file });
            }
          } else if (result.status === 'noop' && update?.status === 'refused') {
            problems.push(`The word log "${path}" was not changed: ${update.reason}`);
          } else if (result.status !== 'noop') {
            problems.push(`The words you wrote could not be added to the word log yet: ${result.message}`);
          } else {
            problems.push(`The word log "${path}" could not be read.`);
          }
        }),
      );
    } catch (error) {
      console.error('Spellbook: the word log could not be saved', error);
      problems.push('The word log could not be saved.');
    } finally {
      for (const log of saved) this.deps.onSaved(log);
      // Exactly one of the two, whatever happened above.
      if (done.length === entries.length) this.tracker.markWritten(entries);
      else this.tracker.writeFailed(done);

      if (problems.length === 0) {
        this.failures = 0;
        this.holdUntil = 0;
        this.lastProblem = null;
      } else {
        // Tried again after a wait that grows, so that a file that cannot be
        // written does not keep a phone busy every few seconds.
        this.failures++;
        const wait = Math.min(WRITE_RETRY_MS * 2 ** Math.min(this.failures - 1, 10), LONGEST_RETRY_MS);
        this.holdUntil = this.deps.clock.now() + wait;
        const message = problems.join(' ');
        if (message !== this.lastProblem) {
          this.lastProblem = message;
          this.deps.onProblem(message);
        }
      }
    }
  }
}
