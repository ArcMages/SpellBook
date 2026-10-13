// What the planner screen needs from the plugin.
//
// The screen (the calendar and the to-do list) never reads a note, the
// project store or the clock itself. It reads what the host hands it, asks
// the host to make changes, and draws again when the host says something
// changed. In the plugin the host is PlannerWiring (plannerWiring.ts), built
// on the project store; the screen's own tests use a stand-in (FakeHost in
// tests/features/planner/plannerStage.ts).
//
// How a change is made, for both To-do.md and the day marks: the screen hands
// over a function that takes what is stored right now and returns the
// engine's verdict (src/core/planner). The host reads the file again, calls
// the function with what it read, and writes the result only when the verdict
// is "done". So a change is always worked out on the newest text, however
// old the screen's own picture of it was.

import type { DayWords, DayWordsSource, MarksEdit, TodoEdit, YearMonth } from '../../core/planner';
import type { DragClock } from '../../ui/dragDrop';

/** The open project, as far as the planner shows it. */
export interface PlannerProject {
  /**
   * Names the project: the vault path of its index note. When this differs
   * from the last time, another project is on show and the screen starts
   * afresh (this month, no day chosen).
   */
  readonly key: string;
  /**
   * The whole text of the project's To-do.md as it was last read; "" when
   * the file does not exist yet. The screen reads it with the engine's
   * parseTodo.
   */
  readonly todoText: string;
  /**
   * The value stored under the "marks" key of the project index, exactly as
   * it was read (MARKS_KEY in src/core/planner); undefined or null when the
   * index has none. The screen reads it with the engine's parseMarks.
   */
  readonly marks: unknown;
  /**
   * True when nothing in this project may be changed from the planner (its
   * index note could not be understood, say). The screen then shows
   * everything and offers no way to change it.
   */
  readonly readOnly: boolean;
}

/** How today's writing stands against the daily target. */
export interface TargetProgress {
  /** The number of words aimed for in a day. */
  readonly goal: number;
  /** The words written today that count towards it. */
  readonly written: number;
  /** True when the target is met. */
  readonly met: boolean;
}

/**
 * The numbers under the calendar. Every one of them is optional: the screen
 * shows a line for each number it is given and nothing for the others.
 */
export interface PlannerStats {
  /** The words written in the month that is on show. */
  readonly month?: DayWords | null;
  /** The words written in the current week (the week today falls in). */
  readonly week?: DayWords | null;
  /** How many days in a row, up to today, something was written. */
  readonly streak?: number | null;
  /** The average number of manuscript words in a day. */
  readonly average?: number | null;
  /** Today's daily target and how far along it is. */
  readonly target?: TargetProgress | null;
}

/**
 * What changed, as far as the host can tell:
 *  - "data":  anything read through `project`, `today` or `firstDayOfWeek`
 *             (another project, To-do.md, the marks, the settings, midnight).
 *             The screen compares for itself and redraws only what differs.
 *  - "words": the word counts: what `words` or `stats` would answer now is
 *             no longer what they answered before. The screen asks again.
 */
export type PlannerChange = 'data' | 'words';

/** What the planner screen needs from the plugin. */
export interface PlannerHost {
  /**
   * The open project; null while no project is open, and while Obsidian is
   * still starting up. Read again at every drawing, so it may be a getter.
   */
  readonly project: PlannerProject | null;

  /** Today on this device, as YYYY-MM-DD. Read again at every drawing. */
  readonly today: string;

  /** The weekday the calendar's weeks start on: 0 is Sunday, 1 Monday, up to 6 for Saturday. From the language Obsidian is set to. */
  readonly firstDayOfWeek: number;

  /**
   * Where the calendar gets the words written on each day (the word log), or
   * null when there is none: the calendar then shows to-dos and marks only.
   */
  readonly words: DayWordsSource | null;

  /**
   * The numbers under the calendar for the month on show. Leave the method
   * out, resolve with null, or leave numbers out of the answer: whatever is
   * not given is not shown.
   */
  stats?(month: YearMonth): Promise<PlannerStats | null>;

  /**
   * The timers the screen runs on (drawing a moment later, building a long
   * list in pieces, dragging). The same pair the binder is given.
   */
  readonly clock: DragClock;

  /**
   * Call `callback` whenever something the screen shows may have changed.
   * Returns a function that stops the calls. Calling it more often than
   * needed is harmless: several calls in a row are drawn in one go.
   */
  onChange(callback: (change: PlannerChange) => void): () => void;

  /**
   * Change To-do.md. The host reads the file as it is now ("" when it does
   * not exist), calls `edit` with that text, and, only when the answer's
   * status is "done", writes the answer's `text` to the file (creating it
   * when needed). It resolves with the answer of `edit`, whatever it was.
   *
   * By the time it resolves, `project.todoText` is the text that was read or
   * written. It rejects when the file could not be read or written; the
   * screen then tells the writer.
   */
  applyTodoEdit(edit: (text: string) => TodoEdit): Promise<TodoEdit>;

  /**
   * Change the day marks. The host reads the value stored under the project
   * index's "marks" key as it is now, calls `edit` with it, and, only when
   * the answer's status is "done", stores the answer's `marks` under that
   * key. It resolves with the answer of `edit`, whatever it was.
   *
   * By the time it resolves, `project.marks` is the value that was read or
   * stored. It rejects when the index could not be read or written.
   */
  applyMarksEdit(edit: (marks: unknown) => MarksEdit): Promise<MarksEdit>;

  /**
   * Read To-do.md and the day marks again, so that `project` is up to date
   * when this resolves. Asked for when a change found that the file was no
   * longer as the screen showed it.
   */
  refresh(): Promise<void>;

  /** Show To-do.md in the editor. Leave it out and the screen offers no button for it. */
  openTodoNote?(): void;
}
