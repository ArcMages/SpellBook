// What the timeline screen needs from the plugin: the data it shows, a way to
// hear that the data changed, and the things it can ask for.
//
// The screen never reads or writes a note itself and knows nothing of the
// project store or the vault. Whoever wires it up implements TimelineHost.
//
// Paths are whatever the host hands out (vault paths are the obvious choice).
// The screen only compares them and hands them back, so they must be written
// the same way everywhere: in `events`, in `scenes` and in `sceneOrder`.

import type { App, PaneType } from 'obsidian';
import type { FrontmatterPatch, LaneChange, TimelineNote } from '../../core/timeline';
import type { Frontmatter } from '../../core/types';
import type { DragClock } from '../../ui/dragDrop';

/** Everything the timeline shows, for the project that is open. */
export interface TimelineData {
  /** Something that names the project and changes when another one is opened (its index path, say). */
  readonly projectId: string;
  /** The project's name: the writer's own text. */
  readonly projectName: string;
  /**
   * Where the project is in the vault ("Novel"), when the paths below are
   * written from the project's folder on. With it, a link to an entity of
   * another project is not taken for an entity of this one.
   */
  readonly folder?: string;
  /** The value stored under the "timelines" key of the project index, exactly as it is stored. */
  readonly timelines: unknown;
  /**
   * The value stored under the "calendar" key of the project index, exactly as
   * it is stored: the project's invented calendar. Nothing there means the
   * real-world calendar.
   */
  readonly calendar?: unknown;
  /** The paths of the notes in the project's World/ folder (its entities), written the same way as the other paths. */
  readonly world?: readonly string[];
  /** Every note in the project's Timeline/ folder, with its properties as they are. */
  readonly events: readonly TimelineNote[];
  /** Every scene of the manuscript, with its properties. Scenes without a date are simply not shown. */
  readonly scenes: readonly TimelineNote[];
  /** The manuscript in reading order: the scenes' paths, written as in `scenes`. */
  readonly sceneOrder: readonly string[];
  /** The names of the lanes this device has hidden. */
  readonly hiddenLanes: readonly string[];
  /** Today as a day number (whole days since 1 January 1970): where an empty timeline is centred. */
  readonly today: number;
}

/** A change to the properties of one note. */
export interface NoteChange {
  readonly path: string;
  /** The change, worked out by the timeline engine from the properties the screen was showing. */
  readonly patch: FrontmatterPatch;
  /**
   * The same change worked out again from the note's properties as they are
   * at the moment of writing. A host that reads the note afresh before it
   * writes (as it should, the vault syncs) calls this and applies what it
   * gets; an empty patch then means there is nothing to write any more.
   */
  readonly remake: (frontmatter: unknown) => FrontmatterPatch;
}

/** A new event note to make in the project's Timeline/ folder. */
export interface NewEvent {
  /** The note's name, as the writer typed it (not yet checked or tidied). */
  readonly title: string;
  /** Its properties, ready to write: the "spellbook: event" mark, the date, the end and the lanes. */
  readonly frontmatter: Frontmatter;
}

/** What making an event note came to: its path, or why it could not be made (shown under the title field). */
export type CreateEventResult =
  | { readonly ok: true; readonly path: string }
  | { readonly ok: false; readonly message: string };

export interface TimelineHost {
  /** Obsidian's app, for the small windows the screen opens. */
  readonly app: App;
  /** The timers the screen runs on (handed in so that tests can keep the time). */
  readonly clock: DragClock;

  /**
   * What to show now, or null when no project is open (or the plugin has not
   * finished starting). Called again after every change. Hand out a new
   * object whenever anything in it changed: the screen reads an object it has
   * seen before only once.
   */
  getData(): TimelineData | null;

  /**
   * Call `listener` whenever what getData() returns may have changed: notes,
   * the project index, the hidden lanes, or which project is open. Returns
   * the function that stops the calls.
   */
  onChange(listener: () => void): () => void;

  /**
   * Show a note.
   *
   * @param where false for the pane in use, or where a new one should open (as Keymap.isModEvent gives it)
   */
  openNote(path: string, where: PaneType | boolean): void;

  /** Make an event note. Resolves once it exists (a change is then announced as usual). */
  createEvent(event: NewEvent): Promise<CreateEventResult>;

  /**
   * Change the properties of the notes named, and nothing else in them.
   * Rejects when a note could not be written; the screen then tells the writer.
   */
  applyNoteChanges(changes: readonly NoteChange[]): Promise<void>;

  /**
   * Change the lanes of the project.
   *
   * Call `make` with the "timelines" value as stored at the moment of
   * writing. When its result is ok and changed, store `value` under
   * "timelines" and then apply `noteChanges` (the events a renamed lane was
   * named in). Resolve with the result of `make` either way: a refusal
   * carries a message that the screen shows.
   */
  saveLanes(make: (timelines: unknown) => LaneChange, noteChanges: readonly NoteChange[]): Promise<LaneChange>;

  /**
   * Store the project's calendar under the "calendar" key of the project
   * index, or take the key away (null: the real-world calendar). No note is
   * touched: dates stay as they are written. Rejects when the index could
   * not be saved; the screen then tells the writer.
   *
   * @param value the calendar as plain data (see `calendarToIndexValue`), or null
   */
  saveCalendar(value: Readonly<Record<string, unknown>> | null): Promise<void>;

  /** Remember, on this device only, which lanes are hidden; then announce the change. */
  setHiddenLanes(names: readonly string[]): void;
}
