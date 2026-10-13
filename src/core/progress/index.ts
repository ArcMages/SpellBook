// Writing progress: the logic underneath the word counts, the daily log, the
// targets, the scene dates and the bottom-bar line. No screens, no files, no
// clock: plain values in, plain values out. Everything a screen or a file
// layer may use is exported from here.
//
// How the parts fit together
//
// 1. Counting. Make one WordTracker when the plugin loads, with a clock that
//    gives the device's local date and the time in milliseconds. Tell it every
//    edit the writer makes in the editor (edit) and hand it word counts
//    (measure): once when a note is opened, and again whenever plan() names
//    the note. plan() also says when to save and how long to sleep; ask it
//    again after every edit and after acting on it. Call plan(true) when the
//    plugin unloads.
//
// 2. Saving. Each device has an id of its own (newDeviceId, kept in the
//    device's own storage, never in synced data). When plan() says "write",
//    take the entries with tracker.beginSave(). For each entry, the file is
//    statsFilePath(entry.project, entry.date, deviceId). Read that file's
//    text as it is now (or null when there is none) and pass it through
//    updateStatsText together with the entries for that file:
//      - "write": save the text it returns. Once saved, those entries are done.
//      - "unchanged": save nothing. Those entries are done as well.
//      - "refused": save nothing and show the writer the reason. Those
//        entries are not done; neither are the entries of a file whose
//        save threw.
//    Then end the save with exactly one call, also when something throws:
//    tracker.markWritten(entries) when every entry is done, otherwise
//    tracker.writeFailed(the entries that are done). What is not done stays
//    counted and is offered again after a short wait. Then ask plan() again.
//
//    Only one save runs at a time: from beginSave() until that one call,
//    plan() never says "write" and beginSave() gives an empty list, so two
//    saves can never put the same words in a file twice. When the plugin
//    unloads, let a save that is under way end before asking plan(true).
//
// 3. Reading. Read every file in <Project>/Stats with parseStatsFile (pass
//    the file's path too), add them up with sumDeviceLogs, and add this
//    device's unsaved words with addToTotals(totals, the entries of
//    tracker.unwritten() for that project). From the totals come the day,
//    week and month figures (summariseWords turns four stored numbers into
//    added, deleted and net), the streak and the average.
//
// 4. Targets. parseTargets(index frontmatter[TARGETS_KEY]) reads them,
//    validateTargets checks a form, updateTargets gives the value to store
//    under that key, and writingProgress does the sums.
//
// 5. Scene dates. Keep a SceneDatesState, feed sceneDatesStep the events of
//    the editor and the app, and for every write it returns, update that
//    scene's properties with what sceneDatePatch says (and nothing else).
//
// 6. The line of figures. buildStatusLine turns the numbers into labelled,
//    formatted pieces: the scene's count, sceneStartDate, sceneEditedDate,
//    tracker.session().net, the manuscript total, and today's manuscript net
//    (summariseWords(countsOn(totals, today)).manuscript.net).
//
// Dates are always text written as YYYY-MM-DD in the device's local time;
// paths are vault paths with forward slashes; a project is named by the
// vault path of its folder ("" for a project at the top of the vault).

// ------------------------------------------------------------ daily log files

export {
  /** The folder of a project that holds its daily word logs: "Stats". */
  STATS_FOLDER,
  /** What the "spellbook" property of a daily log file says: "stats". */
  STATS_MARKER_VALUE,
  /** Four zeros: the numbers of a day on which nothing was written. */
  NO_WORDS,
  /** True for a usable device id: 1 to 64 letters, digits, "-" or "_", starting with a letter or digit. */
  isDeviceId,
  /** Make a new device id (eight lower-case letters and digits) from a handed-in random source. */
  newDeviceId,
  /** The name of a device's log file for a month, "2026-10 k3x9q2ab.md"; null when month or id is not valid. */
  statsFileName,
  /** Read a log file's name or path back into { month, device }; null for any other file, sync-conflict copies included. */
  parseStatsFileName,
  /** The vault path of the log file holding a given day for one device: "<project>/Stats/<YYYY-MM> <device>.md". */
  statsFilePath,
  /** Read a log file's whole text into a StatsFile. Never throws; unreadable rows are kept and reported. */
  parseStatsFile,
  /** An empty log for a device and a month. */
  newStatsFile,
  /** The whole text of a log file, rows sorted by date; everything that was not understood is written back as it was. */
  serialiseStatsFile,
  /** Add numbers to one day of a log (negative numbers take away, never below zero); returns a new StatsFile. */
  applyDayChange,
  /** The one step a save needs: the file's current text (or null) plus numbers to add, giving the text to save, "unchanged", or a refusal. */
  updateStatsText,
} from './statsFile';

export type {
  /** The four numbers kept for one day: manuscript added and deleted, other notes added and deleted. */
  DayCounts,
  /** One row of a log: a date, its four numbers, and any cells of columns this version does not know. */
  StatsDay,
  /** Which device (id and name) and which month a log file belongs to. */
  StatsIdentity,
  /** The kinds of thing that can be wrong in a log file. */
  StatsProblemKind,
  /** Something in a log file that could not be read as expected: its kind, line, text and a plain-English message. */
  StatsProblem,
  /** The parts of a log file that were not understood, kept for writing back. Sealed: pass it along unchanged. */
  StatsKept,
  /** A log file read into memory: device, month, days, problems, and what was kept. */
  StatsFile,
  /** Numbers to add to one day: { date, counts }. A LogEntry of the tracker fits here as it is. */
  StatsChange,
  /** What updateStatsText decided: write this text, nothing to do, or refused with a reason. */
  StatsUpdate,
} from './statsFile';

// ------------------------------------------------------------ totals and habit

export {
  /** Add up the logs of several devices into one total per day; copies of the same device's file are not counted twice. */
  sumDeviceLogs,
  /** Totals with extra numbers added in, for showing words counted but not yet saved. */
  addToTotals,
  /** The four numbers of one day; zeros for a day with nothing. */
  countsOn,
  /** The numbers of every day from one date to another (both included), added up. */
  totalsForRange,
  /** The numbers of the week a date falls in, added up; the week's first day can be chosen. */
  totalsForWeek,
  /** The numbers of a month ("2026-10"), added up. */
  totalsForMonth,
  /** Turn four stored numbers into added, deleted and net for the manuscript, for other notes, and for all notes together. */
  summariseWords,
  /** The writing streak up to today (today has grace) and the longest streak ever. */
  writingStreak,
  /** Totals and averages over the days actually written on, not the days of the calendar. */
  writingAverage,
} from './statsTotals';

export type {
  /** The words of every device together, by day, in date order. */
  DailyTotals,
  /** Words added, words deleted, and net (added minus deleted). */
  WordTally,
  /** A WordTally for the manuscript, for other notes, and for all notes. */
  WordSummary,
  /** Which words a figure is about: "manuscript" or "all". */
  WordScope,
  /** The current and the longest streak, and whether today was written on. */
  WritingStreak,
  /** Days written, totals, and the averages per day written. */
  WritingAverage,
} from './statsTotals';

// -------------------------------------------------------------- word accounting

export {
  /** Counts the words typed on this device: edit, measure, plan, beginSave, markWritten, writeFailed, unwritten, session, renamed, removed, projectMoved. */
  WordTracker,
  /** Decide where a note's words count: "manuscript" of the project whose Manuscript folder holds it, else "other" of the open project, else null. */
  classifyNote,
} from './wordTracker';

export type {
  /** A moment: { date: local YYYY-MM-DD, time: milliseconds }. */
  Instant,
  /** The projects in the vault now: every project folder, and the open one. */
  ProjectsNow,
  /** "manuscript" or "other". */
  WordBucket,
  /** The project a note's words are credited to, and under which heading. */
  NoteTarget,
  /** The kind of an edit: typed, paste, drop, cut, undo, redo or external. */
  EditKind,
  /** One edit as the editor reports it: path, kind, and (for all but typing) the word count before and after. */
  EditEvent,
  /** What the tracker needs: a clock, the list of projects, and the "count pasted text" setting. */
  TrackerDeps,
  /** Counted words for one project and day that are not in the log file yet. */
  LogEntry,
  /** Words typed since the plugin loaded: added, deleted, net, and the net of manuscript and other notes. */
  SessionWords,
} from './wordTracker';

export {
  /** Typing must pause this long (2 seconds) before a note is measured. */
  MEASURE_AFTER_MS,
  /** The log is saved after this much quiet (8 seconds). */
  WRITE_AFTER_QUIET_MS,
  /** Changes never wait longer than this (2 minutes) to be saved. */
  MAX_UNWRITTEN_MS,
  /** After a failed save, the next try waits this long (8 seconds). */
  WRITE_RETRY_MS,
  /** The scheduling decision on its own: from the time now and what is waiting, what to measure, whether to save, how long to sleep. */
  planWrites,
} from './writeSchedule';

export type {
  /** A note typed in and not measured since: path, date, first and last keystroke times. */
  TypingNote,
  /** Counted words not yet saved: since when, last change, and their dates. */
  UnwrittenWords,
  /** Everything planWrites needs. */
  WriteScheduleInput,
  /** What is due now: notes to measure, whether to save, and how long to wait. */
  WritePlan,
} from './writeSchedule';

// --------------------------------------------------------------------- targets

export {
  /** The key of the project index that holds the targets: "targets". */
  TARGETS_KEY,
  /** The largest target the form accepts. */
  MAX_TARGET_WORDS,
  /** No targets set at all. */
  NO_TARGETS,
  /** Read a hand-typed number of words (80000, "80,000", "80 000"); null when it is not a whole number above zero. */
  readWordTarget,
  /** Read the "targets" value of a project index. Never throws; unreadable parts read as not set and are reported. */
  parseTargets,
  /** Check a targets form: either the targets, or a message for each field that is wrong. */
  validateTargets,
  /** The value to store under "targets" after a change; untouched, unknown and unreadable parts are kept; undefined means remove the key. */
  updateTargets,
  /** Percent reached, words remaining and whether a word target is met; null without a target. */
  targetProgress,
  /** Days left to the deadline and the words to write each day, from today, to reach the project target in time. */
  deadlineProgress,
  /** Project, daily and deadline progress in one call. */
  writingProgress,
} from './targets';

export type {
  /** The targets of a project: project words, daily words, deadline; null means not set. */
  Targets,
  /** Targets as read, with what could not be understood. */
  ParsedTargets,
  /** What the writer typed into the targets form. */
  TargetsInput,
  /** The result of checking a targets form. */
  TargetsValidation,
  /** A change to the targets: a value sets, null removes, left out keeps. */
  TargetsChange,
  /** Words, target, percent, remaining and met for one target. */
  TargetProgress,
  /** Deadline, days left, whether it has passed, and words per day. */
  DeadlineProgress,
  /** The three progress figures together. */
  WritingProgress,
} from './targets';

// ----------------------------------------------------------------- scene dates

export {
  /** The state to start with: no scene waiting, none written. */
  emptySceneDates,
  /** Take one editor event and say which scenes are due an "edited" write; never while typing, at most once per scene per day. */
  sceneDatesStep,
  /** For one scene's properties, exactly which of "created" and "edited" to set; an empty result means do not save. */
  sceneDatePatch,
  /** The day a scene was started, for display: its "created" property, else the file's creation date. */
  sceneStartDate,
  /** The day a scene was last edited, from its "edited" property. */
  sceneEditedDate,
} from './sceneDates';

export type {
  /** What sceneDatesStep remembers between events. */
  SceneDatesState,
  /** An editor or app event: typed, opened, closed, background, unload, renamed, deleted, failed. */
  SceneDatesEvent,
  /** A write that is due: set this scene's "edited" to this date. */
  SceneDateWrite,
  /** The new state and the writes due after one event. */
  SceneDatesStep,
  /** Which of a scene's two dates to set. */
  SceneDatePatch,
} from './sceneDates';

// ---------------------------------------------------------- the line of figures

export {
  /** The ordered, labelled, formatted pieces of the line for the open scene; pieces with nothing to show are left out. */
  buildStatusLine,
  /** About how long so many words take to read: "<1 min", "12 min", "1h 05m". */
  formatReadingTime,
  /** How many words a minute the reading time goes by. */
  READING_WORDS_PER_MINUTE,
} from './statusLine';

export {
  /** Every figure the bar can show, as the settings name them. */
  BAR_ITEMS,
  /** The ready-made layouts: Minimal, Drafting, Everything. */
  BAR_PRESETS,
  /** The icons the settings offer for a shortcut button. */
  BAR_BUTTON_ICONS,
  /** The layout a device starts with: the bar as it was before it could be changed. */
  DEFAULT_BAR_LAYOUT,
  /** Read a stored layout; the default for nothing or for anything that is not one. Never throws. */
  parseBarLayout,
  /** A layout as text, to keep on the device. */
  serializeBarLayout,
  /** True when two layouts hold the same things in the same order. */
  sameBarLayout,
  /** The figures of a layout, in order. */
  barItemIds,
  /** The figures a layout does not hold yet. */
  missingBarItems,
  /** The name of a figure as the settings show it. */
  barItemName,
  /** True when a value is the id of a figure. */
  isBarItemId,
  /** Put a figure at the end of a layout. */
  addBarItem,
  /** Put a shortcut button at the end of a layout. */
  addBarButton,
  /** Take one entry out of a layout. */
  removeBarEntry,
  /** Move one entry a step toward the start (-1) or the end (1). */
  moveBarEntry,
  /** Change what a button says or which icon it shows. */
  editBarButton,
  /** A button's label as it is kept: one line, no spaces at the ends, not too long. */
  tidyLabel,
  /** No more than this many figures and buttons are kept in a layout. */
  MAX_BAR_ENTRIES,
  /** The longest label a button can have, in characters. */
  MAX_LABEL_LENGTH,
} from './barLayout';

export type {
  /** The id of a figure the bar can show. */
  BarItemId,
  /** One figure the writer can choose: its id, its name and what it shows. */
  BarItemInfo,
  /** A figure in the bar. */
  BarItemEntry,
  /** A shortcut button in the bar: the command it runs, its label and its icon. */
  BarButtonEntry,
  /** One thing in the bar: a figure or a shortcut button. */
  BarEntry,
  /** What the bar holds, in order. */
  BarLayout,
  /** A ready-made layout, with a name and a line that describes it. */
  BarPreset,
} from './barLayout';

export type {
  /** The names of the pieces: the figures the writer can choose from (see BarItemId). */
  StatusSegmentId,
  /** One piece: id, English label, formatted value, and whether its target is met. */
  StatusSegment,
  /** The figures the line is built from. */
  StatusLineInput,
} from './statusLine';

// ------------------------------------------- what is offered to other screens

export {
  /** The name under which the line of figures is offered to the other screens. */
  SCENE_LINE_SERVICE,
  /** The name under which the daily word log is offered to the other screens. */
  STATS_SERVICE,
} from './services';

export type {
  /** The line of figures for the open note, and a way to be told when it changes. */
  SceneLineService,
  /** A shortcut button of the line: the command it runs, its label and its icon. */
  SceneLineButton,
  /** The net words of one day: in the manuscript, and in all notes. */
  DayWords,
  /** The streak, the average and the totals of this week and this month. */
  StatsSummary,
  /** The daily word log of the open project, on all devices. */
  StatsService,
} from './services';

export {
  /** A whole number with thousands separators: "1,234,567". */
  formatNumber,
  /** A YYYY-MM-DD date as it reads on screen: "13 Oct 2026"; null when it is not a real date. */
  formatDisplayDate,
} from './format';

// ------------------------------------------------------------------- calendar

export {
  /** How many days one date is after another; null when either is not a real date. */
  daysBetween,
  /** The month a date belongs to, as YYYY-MM. */
  monthOf,
  /** The first and last day of the week a date falls in; the week's first day can be chosen. */
  weekRange,
  /** Read a date property that may be text, text with a time, or a date value; null when it is not a real date. */
  readDateProperty,
} from './calendar';

export type {
  /** The first and the last day of a span of days, both included. */
  DateRange,
} from './calendar';
