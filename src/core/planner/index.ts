// The planner: everything under the calendar and to-do screen that is not the
// screen itself. Pure logic: text in, text out; plain values in, plain values out.
//
// How the pieces fit together, for whoever builds the screen:
//
//   To-dos      const todo = parseTodo(textOfToDoFile);
//               ...show todo.tasks...
//               On a tap: read the file again, then
//                 const result = toggleTask(freshText, task);
//                 if (result.status === 'done') write result.text;
//                 else read again and redraw (result.message says why).
//
//   Calendar    const grid = monthGrid(2026, 10, firstDayOfWeek);
//               const words = await source.wordsByDay(grid.from, grid.to);
//               const days = summariseDays(grid.from, grid.to, words, todo, parseMarks(index.marks).marks);
//               ...for each cell of grid.weeks: days.get(cell.date)...
//
//   Day marks   const result = setMark(index.marks, '2026-10-20', { color: 'red', label: 'Deadline' });
//               if (result.status === 'done') store result.marks under MARKS_KEY.
//
// Dates are always text written as YYYY-MM-DD. Nothing here reads the clock,
// the vault or the screen.

// ----- To-do.md: reading -----

export {
  /** The calendar emoji written in front of a due date, as the Tasks plugin does: "📅 2026-10-20". */
  DUE_MARK,
  /**
   * Read the text of To-do.md into a model that keeps every line. A to-do is a
   * checkbox line ("- [ ] text", also with "*" or "+", also indented); it is
   * done when the box holds x or X. Never throws.
   */
  parseTodo,
  /** The file text of a model; for a model that was just read, exactly the text it was read from. */
  todoText,
  /**
   * Find a to-do again in a newer reading of the file: on its remembered
   * line, or else the nearest line with exactly the same text, up to 20 lines
   * away. Null when it is gone or was changed.
   */
  findTask,
  /** The to-dos due on a day (YYYY-MM-DD), done or not, in file order. */
  tasksDueOn,
  /** The to-dos that are late as of a day: not done and due before it. */
  overdueTasks,
  /** The to-dos with no due date, done or not. */
  undatedTasks,
  /** How many to-dos are not done. */
  openTaskCount,
} from './todo';

export type {
  /** Names one to-do line by where it was (`line`) and what it said (`raw`). Every TodoTask is one. */
  TaskRef,
  /** One to-do: `title` and `due` to show, `done`, and the line it came from. */
  TodoTask,
  /** A line of the file that is not a to-do; kept exactly as it is. */
  OtherLine,
  /** Any line of the file: a TodoTask or an OtherLine. */
  TodoLine,
  /** To-do.md as read: every line (`lines`) and the to-dos among them (`tasks`). */
  TodoFile,
} from './todo';

// ----- To-do.md: changing -----
//
// Each takes the file text as it is now and returns a TodoEdit. Each changes
// one line only, and changes nothing when the to-do it names is no longer in
// the file as it was.

export {
  /** Add a to-do after the last one (or at the end of a file that has none). */
  addTask,
  /** Tick (true) or untick (false) a to-do. Only the box changes. */
  setTaskDone,
  /** Tick an open to-do, untick a done one. */
  toggleTask,
  /** Change what a to-do says; its due date, box and indent stay. */
  setTaskText,
  /** Set, change or (with null) clear a to-do's due date; the rest of the line stays. */
  setTaskDue,
  /** Remove a to-do's line. */
  removeTask,
  /** Move a to-do straight before or after another to-do; no other line moves. */
  moveTask,
} from './todoEdit';

export type {
  /** What a change came to: "done" with the new file `text`, or "noop" / "refused" with a reason and a message. */
  TodoEdit,
  /** A to-do to add: `title`, and optionally `due` and `done`. */
  NewTask,
} from './todoEdit';

// ----- The calendar -----

export {
  /** The days of the week in English; position 0 is Sunday. */
  WEEKDAY_NAMES,
  /** Three-letter names of the days of the week; position 0 is "Sun". */
  WEEKDAY_SHORT_NAMES,
  /** The months in English; position 0 is January. */
  MONTH_NAMES,
  /** A month laid out as weeks of seven days, for a first day of the week from 0 (Sunday) to 6 (Saturday). */
  monthGrid,
  /** The month after a month (or after a month grid). */
  nextMonth,
  /** The month before a month (or before a month grid). */
  previousMonth,
  /** The month a date falls in; null for text that is not a real date. */
  monthOf,
  /** The first and the last day of a month, as YYYY-MM-DD. */
  monthRange,
  /** How many days a month has. */
  daysInMonth,
  /** The day of the week of a date: 0 is Sunday, 6 is Saturday; null for text that is not a real date. */
  weekdayOf,
  /** A month's heading, for example "October 2026". */
  monthTitle,
  /** A day's heading, for example "Tuesday, 20 October 2026". */
  dayTitle,
} from './calendar';

export type {
  /** A month of a year; `month` is 1 to 12. */
  YearMonth,
  /** One cell of the month grid: its date, day number, weekday, and whether it belongs to the month. */
  CalendarDay,
  /** A month as weeks of days, with the first and last day shown (`from`, `to`). */
  MonthGrid,
} from './calendar';

// ----- Day marks -----

export {
  /** The key in the project index that holds the day marks: "marks". */
  MARKS_KEY,
  /** The eight colour names a mark can have. */
  MARK_COLORS,
  /** True for one of the eight colour names. */
  isMarkColor,
  /** Read the value stored under the index's "marks" key. Never throws; what it cannot read stays in the index. */
  parseMarks,
  /** Put a mark on a day or change the one there; returns the new value to store. */
  setMark,
  /** Take the mark off a day; returns the new value to store. */
  removeMark,
} from './marks';

export type {
  /** One of the eight colour names: red, orange, yellow, green, cyan, blue, purple, pink. */
  MarkColor,
  /** The mark on one day: a colour (or null) and a label (or ""). */
  DayMark,
  /** The marks as read: `marks` by day, `notes` about what could not be read, and whether it is `writable`. */
  ParsedMarks,
  /** What to change about a mark: `color` and/or `label`; a part left out stays as it is. */
  MarkChange,
  /** What a change to the marks came to: "done" with the new `marks` value, or "noop" / "refused" with a reason. */
  MarksEdit,
} from './marks';

// ----- Day summaries and tint -----

export {
  /** One summary for every day between two dates (for example a month grid's `from` and `to`), by date. */
  summariseDays,
  /** One summary for every day of a month, by date. */
  summariseMonth,
  /** The number of words that counts as a full-strength day: the 90th percentile of the days with any words. */
  tintScale,
  /** The tint, 0 to 4, of a day's words against a scale from tintScale. */
  tintLevel,
} from './summary';

export type {
  /** The words written on one day: `manuscript` and `all`. */
  DayWords,
  /** Where the calendar gets its word counts: `wordsByDay(from, to)`. The word log provides one. */
  DayWordsSource,
  /** How strongly a day is tinted: 0 (no writing) to 4. */
  TintLevel,
  /** Everything one day's cell shows: words, to-dos due, how many are open, whether all are done, the mark, the tint. */
  DaySummary,
} from './summary';
