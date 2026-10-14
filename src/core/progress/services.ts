// What the writing progress offers the other screens: the one place where
// the two services are declared.
//
// The screens of the plugin live in folders of their own and may not import
// from each other. What one offers another therefore goes through the
// feature context's `services`, under a name, and its shape is declared
// here, in the core, where every screen may look: the writing progress
// (which offers both) and the screens that use them (the inspector shows the
// line, the planner reads the log) all go by these very declarations.
//
// Both are looked up at the moment they are used, never while registering:
//
//   const line = context.services.get<SceneLineService>(SCENE_LINE_SERVICE);
//   const stats = context.services.get<StatsService>(STATS_SERVICE);
//
// Either gives undefined while the writing progress is not running. A screen
// that uses one should still not take its word for everything: the lookup is
// by name, so what comes back is only as good as whoever provided it.
//
// Nothing here does anything: names and shapes only.

import type { StatusSegment } from './statusLine';

/** The name the line of figures is offered under. */
export const SCENE_LINE_SERVICE = 'progress.sceneLine';

/** The name the daily word log is offered under. */
export const STATS_SERVICE = 'progress.stats';

/**
 * A shortcut button of the line: the writer put it in the bottom bar's
 * settings to run one command of Obsidian or of a plugin.
 */
export interface SceneLineButton {
  /** A name for this button that no other button of the line has. */
  readonly key: string;
  /** The id of the command it runs. */
  readonly command: string;
  /** What it says; "" for none (it then shows its icon, or else the command's name). */
  readonly label: string;
  /** The name of its icon, or null. */
  readonly icon: string | null;
  /** What the command is called, for whoever points at the button or hears it read out. */
  readonly name: string;
  /** Whether there is such a command right now. A button without one is shown dimmed. */
  readonly available: boolean;
}

/**
 * The line of figures for the note that is open: its words and target, the
 * day it was started, the day it was last edited, the words of this session,
 * the project total against the project target, and today against the daily
 * target. On a desktop it is the bottom bar; a phone has no bottom bar, so
 * the inspector shows it instead.
 */
export interface SceneLineService {
  /**
   * The pieces of the line as they stand now, in the order they are shown.
   * Each has an id, an English label, a value ready for the screen, and
   * `met` when it has a target. A piece with nothing to show is left out;
   * with no project open the list is empty. Which pieces there are, and in
   * what order, is the writer's choice on this device (the bottom bar's
   * settings). The values are numbers and dates, except for the pieces
   * marked `ownText` (a status name, a scene's title), which are the
   * writer's own text in any language.
   */
  current(): readonly StatusSegment[];
  /**
   * The shortcut buttons the writer put in the bar, in the writer's order.
   * On a desktop they stand between the figures of the bottom bar; where the
   * inspector shows the line they come after the figures. Empty with no
   * project open. (Left out by a line that has no buttons to offer.)
   */
  buttons?(): readonly SceneLineButton[];
  /**
   * Run the command of a button. A command that is not there does nothing.
   * (Left out by a line that has no buttons to offer.)
   */
  run?(command: string): void;
  /**
   * Be told when the line has changed (typing paused, another note was
   * opened, the project or its targets changed, the writer changed the bar,
   * midnight passed). Then ask `current()` and `buttons()` again.
   *
   * @returns a function that stops the listening
   */
  onChange(listener: () => void): () => void;
}

/** The words of one day: net words (added minus deleted), so a day of cutting can be below zero. */
export interface DayWords {
  /** Net words in the manuscript. */
  readonly manuscript: number;
  /** Net words in all notes: the manuscript and everything else in the project. */
  readonly all: number;
}

/**
 * The writing habit in a few figures. All of them are about the manuscript,
 * as the daily target is.
 */
export interface StatsSummary {
  /** Days in a row with writing in the manuscript, up to today. A today without words yet does not break it. */
  readonly streak: number;
  /** Net manuscript words per day that was written on, rounded; 0 when there is none. */
  readonly average: number;
  /** Net manuscript words of the week today falls in (weeks begin on the first day of the week of Obsidian's language, as in the calendar). */
  readonly weekTotal: number;
  /** Net manuscript words of the month today falls in. */
  readonly monthTotal: number;
  /** The project's daily target in words; null when none is set. */
  readonly dailyTarget: number | null;
  /** Whether today's net manuscript words have reached the daily target; false when there is no target. */
  readonly dailyTargetMet: boolean;
}

/**
 * The daily word log of the open project: the log files of every device
 * added up, together with the words this device has counted and not saved
 * yet (so that today reads the same here as in the bottom bar).
 */
export interface StatsService {
  /**
   * The words of every day from `from` to `to`, both included, as
   * YYYY-MM-DD. Only days on which something was written or deleted are in
   * the map, in date order. Empty when no project is open.
   */
  wordsByDay(from: string, to: string): Promise<ReadonlyMap<string, DayWords>>;
  /**
   * The streak, the average and the totals of this week and this month.
   *
   * @param today today's date on this device, as YYYY-MM-DD
   */
  summary(today: string): Promise<StatsSummary>;
  /**
   * Be told when the figures may have changed (words were counted or saved,
   * a log file arrived from another device, the project or its targets
   * changed, midnight passed). Then ask again.
   *
   * @returns a function that stops the listening
   */
  onChange(listener: () => void): () => void;
}
