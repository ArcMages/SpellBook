// Word accounting: turning what the writer does in the editor into the
// numbers of the daily log.
//
// Only typing on this device counts. Words that arrive through sync, or from
// another program, were already counted by the device they were typed on.
//
// How it works:
//  - For every note the tracker remembers a baseline: the note's word count
//    the last time it looked. The first look only sets the baseline.
//  - The editor reports each edit as it happens. Typing just raises a flag
//    ("typed in, not measured yet"); no counting is done on a keystroke.
//  - When typing pauses, the note is measured: the difference from the
//    baseline is what was typed. More words go to "added", fewer to "deleted".
//    A note that changed without the flag was changed by something else: its
//    baseline moves and nothing is counted.
//  - Pasting, dropping and cutting move the baseline without counting, unless
//    the setting "count pasted text" is on.
//  - Undo and redo are never writing or deleting. An undo of typing takes back
//    what that typing counted, a redo puts it back, and an undo or redo of a
//    paste counts nothing. To know which is which, the tracker keeps a short
//    history per note that mirrors the editor's own undo history.
//
// Nothing here reads the clock, the editor or the vault: the time, the list
// of projects and every word count are handed in.

import { isDateText } from './../dates';
import { isInside, isMarkdownPath, joinPath, pathKey } from './../paths';
import { MANUSCRIPT_FOLDER } from './../projectLayout';
import { STATS_FOLDER } from './statsFile';
import type { DayCounts } from './statsFile';
import { WRITE_RETRY_MS, planWrites } from './writeSchedule';
import type { TypingNote, WritePlan } from './writeSchedule';

// ------------------------------------------------------------------- the types

/** A moment: the local date and a running count of milliseconds. */
export interface Instant {
  /** The local date on this device, as YYYY-MM-DD. */
  readonly date: string;
  /** Milliseconds on any steady count (for example since 1970). */
  readonly time: number;
}

/** The projects in the vault right now. */
export interface ProjectsNow {
  /** The vault path of every project folder ("" for a project at the top of the vault). */
  readonly folders: readonly string[];
  /** The folder of the project the writer has open, or null when there is none. */
  readonly active: string | null;
}

/** Where a note's words are counted: in the manuscript, or with the other notes. */
export type WordBucket = 'manuscript' | 'other';

/** The project a note's words are credited to, and under which heading. */
export interface NoteTarget {
  /** The project folder's vault path, exactly as it was handed in. */
  readonly project: string;
  readonly bucket: WordBucket;
}

/**
 * What kind of edit happened in the editor. In the words the editor
 * (CodeMirror) uses for the "user event" of a change:
 *  - typed:    typing or deleting with the keyboard, dictation and autocorrect
 *              included ("input", "input.type", "input.complete", "delete.backward",
 *              "delete.forward", "delete.selection")
 *  - paste:    "input.paste"
 *  - drop:     "input.drop" and "move.drop"
 *  - cut:      "delete.cut"
 *  - undo, redo: "undo" and "redo"
 *  - external: a change with no user event at all: the text was changed by
 *              something other than the writer (sync, another plugin, this plugin)
 */
export type EditKind = 'typed' | 'paste' | 'drop' | 'cut' | 'undo' | 'redo' | 'external';

/** One edit, as the editor reports it. */
export interface EditEvent {
  /** The note's vault path. */
  readonly path: string;
  readonly kind: EditKind;
  /**
   * The note's whole word count just before the edit (counted the way the
   * rest of the plugin counts words). Needed for every kind except "typed".
   * Without it the edit cannot be told apart from typing, so the tracker
   * counts nothing and takes a fresh baseline at the next measurement.
   */
  readonly wordsBefore?: number;
  /**
   * The note's whole word count just after the edit. Needed like `wordsBefore`.
   *
   * For "external", give both counts only when the change went through the
   * editor and the editor's own undo can take it back. For an outside change
   * that undo cannot reach, call measure() with the count before it, then
   * report it with `wordsAfter` alone.
   */
  readonly wordsAfter?: number;
  /**
   * For undo and redo, when the editor can tell: whether it is replaying
   * typing or a move (paste, drop, cut). With it the tracker never has to
   * work it out.
   */
  readonly of?: 'typing' | 'move';
  /**
   * How many characters the edit put in and took out. Optional, and cheap to
   * give for paste, drop, cut and undo: it lets the tracker recognise the undo
   * of a paste by its size. With neither `of` nor `chars` the tracker goes by
   * the word counts alone: an undo is taken for the undo of the last paste
   * only when it changes as many words and no typing is left standing on top
   * of that paste. One case is beyond word counts: typing on top of a paste
   * that came to no change in words over more than two steps of the editor's
   * undo, one of them the size of the paste. Give `of` or `chars` to rule it out.
   */
  readonly chars?: { readonly inserted: number; readonly removed: number };
}

/** What the tracker needs from outside. */
export interface TrackerDeps {
  /**
   * The local date and time, read at the moment of the call. In the plugin:
   * today's date as the device sees it, and the system clock in milliseconds.
   */
  readonly clock: () => Instant;
  /** The projects in the vault, read at the moment of the call. */
  readonly projects: () => ProjectsNow;
  /** The setting "count pasted text"; left out means off. */
  readonly countPasted?: () => boolean;
}

/** Counted words for one project and one day that are not in the log file yet. Numbers may be negative after an undo. */
export interface LogEntry {
  /** The project folder's vault path. */
  readonly project: string;
  /** The day, as YYYY-MM-DD. */
  readonly date: string;
  readonly counts: DayCounts;
}

/** Words typed since the plugin loaded. */
export interface SessionWords {
  readonly added: number;
  readonly deleted: number;
  /** Added minus deleted. */
  readonly net: number;
  /** The net of the manuscript alone. */
  readonly manuscriptNet: number;
  /** The net of notes outside the manuscript. */
  readonly otherNet: number;
}

// -------------------------------------------------------------- classification

/**
 * Decide where a note's words are counted.
 *
 *  - A note under some project's Manuscript folder counts as "manuscript" for
 *    that project, whichever project is open.
 *  - Any other note counts as "other" for the open project.
 *  - Null (not counted at all) when there is no open project to credit, for a
 *    file that is not a markdown note, and for the daily logs themselves.
 */
export function classifyNote(path: string, projects: ProjectsNow): NoteTarget | null {
  if (!isMarkdownPath(path)) return null;
  const note = pathKey(path);
  const folders = projects.active === null ? projects.folders : [...projects.folders, projects.active];

  let manuscriptOf: string | null = null;
  for (const folder of folders) {
    const key = pathKey(folder);
    if (isInside(joinPath(key, STATS_FOLDER), note)) return null;
    if (!isInside(joinPath(key, MANUSCRIPT_FOLDER), note)) continue;
    // A project inside another project's folder: the nearest one wins.
    if (manuscriptOf === null || key.length > pathKey(manuscriptOf).length) manuscriptOf = folder;
  }
  if (manuscriptOf !== null) return { project: manuscriptOf, bucket: 'manuscript' };
  return projects.active === null ? null : { project: projects.active, bucket: 'other' };
}

// ------------------------------------------------------------- the inner state

type Side = 'added' | 'deleted';

/** A stretch of typing that was counted, and how much of that count still stands. */
interface TypedEntry {
  readonly kind: 'typed';
  readonly date: string;
  target: NoteTarget | null;
  added: number;
  deleted: number;
  /**
   * True when typing was measured here that changed no word count (two words
   * deleted and two typed): steps of the editor's undo stand here that the
   * numbers do not show. It holds until an undo first reaches this typing.
   */
  hidden: boolean;
}

/** A paste, drop or cut (or an outside change) that was not counted. */
interface MovedEntry {
  readonly kind: 'moved';
  readonly net: number;
  readonly inserted: number | null;
  readonly removed: number | null;
}

type Entry = TypedEntry | MovedEntry;

/** A piece of a count: so many words, on one side, for one day and project. */
interface Piece {
  readonly date: string;
  target: NoteTarget | null;
  readonly side: Side;
  readonly amount: number;
}

/** What an undo did, so that the redo can do exactly the opposite. */
type Undone =
  | { readonly kind: 'moved'; readonly entry: MovedEntry | null }
  | {
      readonly kind: 'typed';
      readonly net: number;
      readonly taken: Piece[];
      readonly given: Piece[];
      /** The typing whose `hidden` mark this undo cleared; null when it cleared none. */
      readonly hid: { readonly date: string; target: NoteTarget | null } | null;
    };

interface NoteState {
  /** The note's vault path, as it was last handed in. */
  path: string;
  /** The word count at the last look; null when the next look only sets it. */
  baseline: number | null;
  /** The date typing began since the last measurement; null when not typed in. */
  typedDate: string | null;
  firstTypedAt: number;
  lastTypedAt: number;
  /** True once typing in this note has been measured: its undo history is then partly ours. */
  typedHere: boolean;
  /** Mirror of the editor's undo history, oldest first. */
  undo: Entry[];
  /** Mirror of the editor's redo history, oldest first. */
  redo: Undone[];
}

/** No more than this many steps of history are remembered per note. */
const MAX_HISTORY = 400;

interface MutableCounts {
  manuscriptAdded: number;
  manuscriptDeleted: number;
  otherAdded: number;
  otherDeleted: number;
}

const zeroCounts = (): MutableCounts => ({ manuscriptAdded: 0, manuscriptDeleted: 0, otherAdded: 0, otherDeleted: 0 });

const isZero = (counts: DayCounts): boolean =>
  counts.manuscriptAdded === 0 && counts.manuscriptDeleted === 0 && counts.otherAdded === 0 && counts.otherDeleted === 0;

function countKey(bucket: WordBucket, side: Side): keyof MutableCounts {
  if (bucket === 'manuscript') return side === 'added' ? 'manuscriptAdded' : 'manuscriptDeleted';
  return side === 'added' ? 'otherAdded' : 'otherDeleted';
}

const sameTarget = (a: NoteTarget | null, b: NoteTarget | null): boolean =>
  a === null || b === null ? a === b : a.project === b.project && a.bucket === b.bucket;

/** A word count as handed in: a whole number from 0 up, or null when it is not usable. */
function usable(words: number | undefined): number | null {
  return words !== undefined && Number.isFinite(words) ? Math.max(0, Math.round(words)) : null;
}

function usableChars(chars: EditEvent['chars']): { inserted: number; removed: number } | null {
  if (!chars) return null;
  const inserted = usable(chars.inserted);
  const removed = usable(chars.removed);
  return inserted === null || removed === null ? null : { inserted, removed };
}

// ------------------------------------------------------------------ the tracker

/**
 * Counts the words the writer types on this device.
 *
 * The editor side reports edits with `edit` and word counts with `measure`;
 * `plan` says when to measure and when to save; `beginSave`, `markWritten`
 * and `writeFailed` hand the counted words over to the daily log, one save
 * at a time; `unwritten` lists them for showing on screen.
 */
export class WordTracker {
  private readonly clock: () => Instant;
  private readonly projects: () => ProjectsNow;
  private readonly countPasted: () => boolean;

  /** What is known about each note, by its path in one Unicode form (see pathKey). */
  private readonly notes = new Map<string, NoteState>();
  /** Words counted and not yet saved, by project folder and then by date. */
  private readonly pending = new Map<string, Map<string, MutableCounts>>();
  /** Words counted since the tracker was made, by project folder. */
  private readonly sessions = new Map<string, MutableCounts>();

  /** When the oldest unsaved words were typed: the first keystroke of their stretch of typing. */
  private unwrittenSince: number | null = null;
  private lastChangeAt: number | null = null;
  private notBefore: number | null = null;
  /** True from `beginSave` until `markWritten` or `writeFailed`. */
  private saving = false;
  /** Like `unwrittenSince`, for the words counted since the save under way began. */
  private sinceInSave: number | null = null;

  constructor(deps: TrackerDeps) {
    this.clock = deps.clock;
    this.projects = deps.projects;
    this.countPasted = deps.countPasted ?? (() => false);
  }

  // ----------------------------------------------------------------- reporting

  /**
   * Report an edit made in the editor, at the moment it happens.
   *
   * For typing, the path and the kind are enough (call `measure` once typing
   * pauses; see `plan`). Every other kind needs the note's word count before
   * and after the edit.
   */
  edit(event: EditEvent): void {
    const now = this.clock();
    const note = this.note(event.path);
    const before = usable(event.wordsBefore);
    const after = usable(event.wordsAfter);

    if (event.kind === 'typed') {
      // Counts on a typing event are welcome but not needed.
      if (before !== null) this.settle(note, event.path, before, now);
      if (note.typedDate === null) {
        note.typedDate = now.date;
        note.firstTypedAt = now.time;
      }
      note.lastTypedAt = now.time;
      note.redo = [];
      if (after !== null) this.settle(note, event.path, after, now);
      return;
    }

    if (event.kind === 'external') {
      // Whatever was typed up to here is still the writer's.
      if (before !== null) this.settle(note, event.path, before, now);
      note.baseline = after;
      note.typedDate = null;
      // A change that went through the editor can be undone like a paste.
      if (before !== null && after !== null && after !== before) {
        this.pushEntry(note, { kind: 'moved', net: after - before, inserted: null, removed: null });
        note.redo = [];
      }
      return;
    }

    if (before === null || after === null) {
      // Without both counts this edit cannot be told apart from typing: count
      // nothing rather than guess, and start again from the next measurement.
      // The history no longer mirrors the editor's, so it is dropped as well:
      // later undos then count nothing either.
      note.baseline = after;
      note.typedDate = null;
      note.typedHere = false;
      note.undo = [];
      note.redo = [];
      return;
    }

    this.settle(note, event.path, before, now);
    note.baseline = after;
    const net = after - before;

    if (event.kind === 'undo') {
      this.undo(note, event, net, now);
    } else if (event.kind === 'redo') {
      this.redo(note, event, net, now);
    } else {
      note.redo = [];
      if (this.countPasted()) {
        note.typedHere = true;
        if (net !== 0) this.count(note, event.path, now.date, net, now);
      } else if (net !== 0) {
        const chars = usableChars(event.chars);
        this.pushEntry(note, { kind: 'moved', net, inserted: chars?.inserted ?? null, removed: chars?.removed ?? null });
      }
    }
  }

  /**
   * Hand in a note's word count.
   *
   * Call it when a note is opened (so that the first words typed in it count),
   * and again whenever `plan` asks for the note to be measured. If the note was
   * typed in since the last count, the difference is counted as typing;
   * otherwise the note's baseline just moves and nothing is counted.
   *
   * A note that `plan` names but that can no longer be read (it was deleted)
   * should be reported with `removed` instead, or `plan` keeps naming it.
   */
  measure(path: string, words: number): void {
    const count = usable(words);
    if (count === null) return;
    this.settle(this.note(path), path, count, this.clock());
  }

  /** A note was renamed or moved: what is known about it follows it to its new path. */
  renamed(from: string, to: string): void {
    const fromKey = pathKey(from);
    const toKey = pathKey(to);
    const state = this.notes.get(fromKey);
    if (!state) return;
    state.path = to;
    if (fromKey === toKey) return;
    this.notes.delete(fromKey);
    this.notes.set(toKey, state);
  }

  /** A note was deleted. The words it contributed stay counted: deleting a note does not unwrite them. */
  removed(path: string): void {
    this.notes.delete(pathKey(path));
  }

  /** A project folder was renamed or moved: its counted words follow it. */
  projectMoved(from: string, to: string): void {
    if (from === to) return;
    const move = <T>(map: Map<string, T>, merge: (kept: T, moved: T) => T): void => {
      const moved = map.get(from);
      if (moved === undefined) return;
      map.delete(from);
      const kept = map.get(to);
      map.set(to, kept === undefined ? moved : merge(kept, moved));
    };
    move(this.pending, (kept, moved) => {
      for (const [date, counts] of moved) {
        const row = kept.get(date);
        if (!row) kept.set(date, counts);
        else for (const key of Object.keys(counts) as Array<keyof MutableCounts>) row[key] += counts[key];
      }
      return kept;
    });
    move(this.sessions, (kept, moved) => {
      for (const key of Object.keys(moved) as Array<keyof MutableCounts>) kept[key] += moved[key];
      return kept;
    });
    const retarget = (holder: { target: NoteTarget | null }): void => {
      if (holder.target?.project === from) holder.target = { project: to, bucket: holder.target.bucket };
    };
    for (const note of this.notes.values()) {
      for (const entry of note.undo) if (entry.kind === 'typed') retarget(entry);
      for (const undone of note.redo) {
        if (undone.kind !== 'typed') continue;
        undone.taken.forEach(retarget);
        undone.given.forEach(retarget);
        if (undone.hid !== null) retarget(undone.hid);
      }
    }
  }

  // ------------------------------------------------------------------- reading

  /**
   * What is due now: which notes to measure, whether to save the log, and how
   * long to wait before asking again. See planWrites for the rules.
   *
   * `write` is never true while a save is under way (see `beginSave`), not
   * even when unloading: let that save end, then ask again.
   *
   * @param unloading true when the plugin is unloading: everything is due at once
   */
  plan(unloading = false): WritePlan {
    const now = this.clock();
    const typing: TypingNote[] = [];
    for (const note of this.notes.values()) {
      if (note.typedDate === null) continue;
      typing.push({ path: note.path, date: note.typedDate, firstTypedAt: note.firstTypedAt, lastTypedAt: note.lastTypedAt });
    }
    const entries = this.unwritten();
    if (entries.length === 0) this.unwrittenSince = null;
    const plan = planWrites({
      now: now.time,
      today: now.date,
      typing,
      unwritten:
        entries.length === 0 || this.saving
          ? null
          : {
              since: this.unwrittenSince ?? now.time,
              lastChangeAt: this.lastChangeAt ?? now.time,
              dates: [...new Set(entries.map((entry) => entry.date))],
            },
      unloading,
      notBefore: this.notBefore,
    });
    return this.saving ? { ...plan, write: false } : plan;
  }

  /**
   * Start a save, when `plan` says "write": the counted words to put in the
   * log files now, exactly as `unwritten` lists them.
   *
   * Only one save runs at a time. Until it ends, `plan` does not ask for
   * another and a second `beginSave` gives an empty list, so that no word is
   * ever put in a file twice. End every save with exactly one call, also when
   * something throws: `markWritten` when all of it went in, `writeFailed`
   * otherwise. An empty list means there is nothing to do and nothing to end.
   */
  beginSave(): LogEntry[] {
    if (this.saving) return [];
    const entries = this.unwritten();
    if (entries.length === 0) return [];
    this.saving = true;
    this.sinceInSave = null;
    return entries;
  }

  /**
   * The counted words that are not in the log file yet, one entry per project
   * and day, in order of project and date. For showing on screen (see
   * addToTotals); to save them, take them with `beginSave` instead.
   */
  unwritten(): LogEntry[] {
    const entries: LogEntry[] = [];
    for (const [project, days] of this.pending) {
      for (const [date, counts] of days) {
        if (!isZero(counts)) entries.push({ project, date, counts: { ...counts } });
      }
    }
    return entries.sort((a, b) =>
      a.project !== b.project ? (a.project < b.project ? -1 : 1) : a.date < b.date ? -1 : a.date > b.date ? 1 : 0,
    );
  }

  /**
   * The save ended well: these entries are dealt with. That means in their
   * log file now, or, where updateStatsText answered "unchanged", needing no
   * place there (an undo took words back from a day the file no longer
   * holds). Words counted while the save was under way stay waiting.
   */
  markWritten(entries: readonly LogEntry[]): void {
    this.settleEntries(entries);
    this.notBefore = null;
    this.unwrittenSince = this.unwritten().length === 0 ? null : (this.sinceInSave ?? this.lastChangeAt);
    this.saving = false;
    this.sinceInSave = null;
  }

  /**
   * The save ended with something left over: a file could not be written, or
   * updateStatsText refused one (tell the writer its reason). Nothing is
   * lost: what is left stays counted, shows in `unwritten`, and `plan` asks
   * for it again after a short wait, so a file the writer has put right is
   * picked up.
   *
   * @param written the entries of this save that are dealt with all the same (see `markWritten`); leave out when none are
   */
  writeFailed(written: readonly LogEntry[] = []): void {
    this.settleEntries(written);
    this.notBefore = this.clock().time + WRITE_RETRY_MS;
    this.saving = false;
    this.sinceInSave = null;
  }

  /** Take entries that are dealt with off the words still waiting. */
  private settleEntries(entries: readonly LogEntry[]): void {
    for (const entry of entries) {
      const days = this.pending.get(entry.project);
      const row = days?.get(entry.date);
      if (!days || !row) continue;
      for (const key of Object.keys(row) as Array<keyof MutableCounts>) {
        const written = entry.counts[key];
        if (Number.isFinite(written)) row[key] -= written;
      }
      if (isZero(row)) days.delete(entry.date);
      if (days.size === 0) this.pending.delete(entry.project);
    }
  }

  /**
   * Words typed since the plugin loaded.
   *
   * @param project a project folder, for that project alone; leave out for all projects together
   */
  session(project?: string): SessionWords {
    const sum = zeroCounts();
    for (const [folder, counts] of this.sessions) {
      if (project !== undefined && folder !== project) continue;
      for (const key of Object.keys(sum) as Array<keyof MutableCounts>) sum[key] += counts[key];
    }
    const manuscriptNet = sum.manuscriptAdded - sum.manuscriptDeleted;
    const otherNet = sum.otherAdded - sum.otherDeleted;
    return {
      added: sum.manuscriptAdded + sum.otherAdded,
      deleted: sum.manuscriptDeleted + sum.otherDeleted,
      net: manuscriptNet + otherNet,
      manuscriptNet,
      otherNet,
    };
  }

  // ------------------------------------------------------------------ counting

  /** What is known about a note. The same path in another Unicode form is the same note. */
  private note(path: string): NoteState {
    const key = pathKey(path);
    let state = this.notes.get(key);
    if (!state) {
      state = { path, baseline: null, typedDate: null, firstTypedAt: 0, lastTypedAt: 0, typedHere: false, undo: [], redo: [] };
      this.notes.set(key, state);
    }
    state.path = path;
    return state;
  }

  /** Look at a note's word count: count what was typed since the last look, and move the baseline. */
  private settle(note: NoteState, path: string, words: number, now: Instant): void {
    if (note.baseline === null) {
      // First sight: nothing is counted.
      note.baseline = words;
      note.typedDate = null;
      return;
    }
    const delta = words - note.baseline;
    note.baseline = words;
    const date = note.typedDate;
    // Changed without being typed in here: sync, or another program.
    if (date === null) return;
    note.typedDate = null;
    note.typedHere = true;
    if (delta !== 0) {
      // These words have been waiting since the first keystroke of the stretch, not since now.
      this.count(note, path, date, delta, now, note.firstTypedAt);
    } else {
      // Typing that changed no word count still stands in the editor's undo history.
      const target = classifyNote(path, this.projects());
      this.pushTyped(note, { kind: 'typed', date, target, added: 0, deleted: 0, hidden: true });
    }
  }

  /**
   * Count a net change made by typing, and remember it so that an undo can take it back.
   *
   * @param since when these words were typed, if that was before now
   */
  private count(note: NoteState, path: string, date: string, delta: number, now: Instant, since = now.time): void {
    const target = classifyNote(path, this.projects());
    const added = delta > 0 ? delta : 0;
    const deleted = delta < 0 ? -delta : 0;
    this.credit(target, date, 'added', added, now, since);
    this.credit(target, date, 'deleted', deleted, now, since);
    this.pushTyped(note, { kind: 'typed', date, target, added, deleted, hidden: false });
  }

  /**
   * Add words (or, with a negative amount, take them back) for one day, project and side.
   *
   * @param since when they were typed; the two-minute limit on unsaved words runs from there
   */
  private credit(
    target: NoteTarget | null,
    date: string,
    side: Side,
    amount: number,
    now: Instant,
    since = now.time,
  ): void {
    if (target === null || amount === 0 || !isDateText(date)) return;
    const key = countKey(target.bucket, side);

    let days = this.pending.get(target.project);
    if (!days) {
      days = new Map();
      this.pending.set(target.project, days);
    }
    let row = days.get(date);
    if (!row) {
      row = zeroCounts();
      days.set(date, row);
    }
    row[key] += amount;

    let session = this.sessions.get(target.project);
    if (!session) {
      session = zeroCounts();
      this.sessions.set(target.project, session);
    }
    session[key] += amount;

    this.lastChangeAt = now.time;
    this.unwrittenSince = this.unwrittenSince === null ? since : Math.min(this.unwrittenSince, since);
    if (this.saving) this.sinceInSave = this.sinceInSave === null ? since : Math.min(this.sinceInSave, since);
  }

  // ------------------------------------------------------------ undo and redo

  private pushEntry(note: NoteState, entry: Entry): void {
    note.undo.push(entry);
    if (note.undo.length > MAX_HISTORY) note.undo.splice(0, note.undo.length - MAX_HISTORY);
  }

  /** Remember counted typing; typing of the same day and project is kept as one step. */
  private pushTyped(note: NoteState, entry: TypedEntry): void {
    const top = note.undo[note.undo.length - 1];
    if (top && top.kind === 'typed' && top.date === entry.date && sameTarget(top.target, entry.target)) {
      top.added += entry.added;
      top.deleted += entry.deleted;
      top.hidden = top.hidden || entry.hidden;
    } else {
      this.pushEntry(note, entry);
    }
  }

  /** Where the typing since the last move begins in the history: just above that move. */
  private static floorOf(note: NoteState): number {
    for (let i = note.undo.length - 1; i >= 0; i--) {
      if ((note.undo[i] as Entry).kind === 'moved') return i + 1;
    }
    return 0;
  }

  /**
   * Take counted words back from the typing above `floor`, newest first.
   * Returns how many could not be found there.
   */
  private takeBack(note: NoteState, side: Side, amount: number, floor: number, taken: Piece[], now: Instant): number {
    let need = amount;
    for (let i = note.undo.length - 1; i >= floor && need > 0; i--) {
      const entry = note.undo[i] as Entry;
      if (entry.kind !== 'typed') break;
      const part = Math.min(need, entry[side]);
      if (part <= 0) continue;
      entry[side] -= part;
      need -= part;
      this.credit(entry.target, entry.date, side, -part, now);
      taken.push({ date: entry.date, target: entry.target, side, amount: part });
    }
    return need;
  }

  /** Forget typing steps above `floor` that have nothing left to take back. */
  private static dropSpent(note: NoteState, floor: number): void {
    for (let i = note.undo.length - 1; i >= floor; i--) {
      const entry = note.undo[i] as Entry;
      if (entry.kind === 'typed' && entry.added === 0 && entry.deleted === 0 && !entry.hidden) note.undo.splice(i, 1);
    }
  }

  private undo(note: NoteState, event: EditEvent, net: number, now: Instant): void {
    const floor = WordTracker.floorOf(note);
    const moved = floor > 0 ? (note.undo[floor - 1] as MovedEntry) : null;

    if (note.undo.length === 0 && !note.typedHere) {
      // Nothing in this note was ever counted here: the undo reaches back
      // before the tracker began. Not ours to count, whatever it undoes.
      WordTracker.pushUndone(note, { kind: 'moved', entry: null });
      return;
    }

    // Is the last move the thing being undone? Only if this undo is exactly
    // its reverse, and the typing counted after it is no longer standing
    // (the editor undoes the newest thing first).
    let isMove = false;
    if (moved !== null && moved.net === -net && event.of !== 'typing') {
      let standingNet = 0;
      let standingWords = 0;
      let hidden = false;
      for (let i = floor; i < note.undo.length; i++) {
        const entry = note.undo[i] as Entry;
        if (entry.kind !== 'typed') continue;
        standingNet += entry.added - entry.deleted;
        standingWords += entry.added + entry.deleted;
        hidden = hidden || entry.hidden;
      }
      const chars = usableChars(event.chars);
      if (event.of === 'move') {
        // The editor says it is a move. Typing still standing above the last
        // move means it is a later paste, one that was counted (the setting
        // was on): its undo takes the count back, like typing.
        isMove = standingNet === 0;
      } else if (chars !== null && moved.inserted !== null && moved.removed !== null) {
        // The size of the edit tells a paste's undo from typing that happens
        // to change the same number of words.
        isMove = standingNet === 0 && chars.removed === moved.inserted && chars.inserted === moved.removed;
      } else {
        // Nothing else to go by: any typing still standing above the move
        // has to be undone before the move can be. That includes typing that
        // changed no word count: its steps are in the editor's history too.
        isMove = standingWords === 0 && !hidden;
      }
    }

    if (isMove && moved !== null) {
      // Everything typed after the move has been undone by now. If a little of
      // its count is still standing (one step of the editor, measured in two
      // halves, leaves the same amount on both sides), it goes too.
      for (let i = note.undo.length - 1; i >= floor; i--) {
        const entry = note.undo[i] as Entry;
        if (entry.kind !== 'typed') continue;
        this.credit(entry.target, entry.date, 'added', -entry.added, now);
        this.credit(entry.target, entry.date, 'deleted', -entry.deleted, now);
      }
      note.undo.splice(floor - 1);
      WordTracker.pushUndone(note, { kind: 'moved', entry: moved });
      return;
    }

    const taken: Piece[] = [];
    const given: Piece[] = [];
    if (net !== 0) {
      // Fewer words after the undo: typing is taken back from "added".
      // More words: a deletion is taken back from "deleted".
      const side: Side = net < 0 ? 'added' : 'deleted';
      const other: Side = net < 0 ? 'deleted' : 'added';
      const missing = this.takeBack(note, side, Math.abs(net), floor, taken, now);
      if (missing > 0) {
        // The undone step was hidden inside one measurement (typing 8 words
        // and deleting 3 was counted as 5 added). Its other half now shows.
        //
        // Word counts cannot tell this from an undo that reaches typing from
        // before the tracker first looked at the note, once typing was
        // counted in it: both leave nothing standing. Steps hidden in a
        // measurement are the everyday case, so that is what is assumed.
        let top = note.undo[note.undo.length - 1];
        if (!top || top.kind !== 'typed') {
          const target = classifyNote(event.path, this.projects());
          top = { kind: 'typed', date: now.date, target, added: 0, deleted: 0, hidden: false };
          this.pushEntry(note, top);
        }
        top[other] += missing;
        this.credit(top.target, top.date, other, missing, now);
        given.push({ date: top.date, target: top.target, side: other, amount: missing });
      }
    }
    // An undo has reached this typing: from here on its numbers are all there is to go by.
    let hid: { date: string; target: NoteTarget | null } | null = null;
    for (let i = floor; i < note.undo.length; i++) {
      const entry = note.undo[i] as Entry;
      if (entry.kind !== 'typed' || !entry.hidden) continue;
      entry.hidden = false;
      hid = { date: entry.date, target: entry.target };
    }
    WordTracker.dropSpent(note, floor);
    WordTracker.pushUndone(note, { kind: 'typed', net, taken, given, hid });
  }

  /** Remember what an undo did. One is kept for every undo, so that redos pair up with them one to one. */
  private static pushUndone(note: NoteState, undone: Undone): void {
    note.redo.push(undone);
    if (note.redo.length > MAX_HISTORY) note.redo.splice(0, note.redo.length - MAX_HISTORY);
  }

  private redo(note: NoteState, event: EditEvent, net: number, now: Instant): void {
    // What the matching undo did decides what the redo does.
    const undone = note.redo.pop();

    // A redo whose undo was never seen is not counted: better nothing than a guess.
    if (undone === undefined) return;

    if (undone.kind === 'moved') {
      if (undone.entry !== null) this.pushEntry(note, undone.entry);
      return;
    }

    if (undone.net === -net) {
      // Exactly the opposite of what the undo did, in the opposite order.
      const floor = WordTracker.floorOf(note);
      for (let i = undone.given.length - 1; i >= 0; i--) {
        const piece = undone.given[i] as Piece;
        const missing = this.takeBack(note, piece.side, piece.amount, floor, [], now);
        if (missing > 0) this.credit(piece.target, piece.date, piece.side, -missing, now);
      }
      WordTracker.dropSpent(note, floor);
      for (let i = undone.taken.length - 1; i >= 0; i--) {
        const piece = undone.taken[i] as Piece;
        this.credit(piece.target, piece.date, piece.side, piece.amount, now);
        this.pushTyped(note, {
          kind: 'typed',
          date: piece.date,
          target: piece.target,
          added: piece.side === 'added' ? piece.amount : 0,
          deleted: piece.side === 'deleted' ? piece.amount : 0,
          hidden: false,
        });
      }
      // The typing whose mark the undo cleared stands untouched again.
      if (undone.hid !== null) {
        this.pushTyped(note, { kind: 'typed', date: undone.hid.date, target: undone.hid.target, added: 0, deleted: 0, hidden: true });
      }
      return;
    }

    // Typing is being redone, but not the amount its undo took back: count it as it reads.
    if (net !== 0) this.count(note, event.path, now.date, net, now);
  }
}
