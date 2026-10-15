// The outliner engine: everything the manuscript table is worked out with.
//
// Plain calculations only. Nothing here reads or writes a file, touches the
// screen or looks at the clock: values go in, values come out.
//
//   rows       buildOutline, sumScenes: the rows of the table and their sums
//   cells      targetCell (percentage and band), formatReadTime, countTasks,
//              readNoteTags, propertyText
//   order      sortScenes, nextSort; matchesFilter and the filter's lists
//   columns    the column layouts and their saved form
//   memory     how the table was left for each project, and its saved form
//
// All paths are relative to the project folder, as in the project snapshot.

export {
  BUILT_IN_COLUMNS,
  COLUMN_PREFS_VERSION,
  NARROW_BELOW,
  PROPERTY_PREFIX,
  WIDE_FROM,
  addPropertyColumn,
  canMoveColumn,
  columnTitle,
  defaultLayout,
  isBuiltInColumn,
  isColumnId,
  isNumberColumn,
  isWordColumn,
  isOwnTextTitle,
  isShown,
  moveColumn,
  paneWidthFor,
  parseStored,
  propertyColumn,
  propertyKeyOf,
  propertyKeysIn,
  readColumnPrefs,
  readLayout,
  sameLayout,
  setColumnShown,
  shownColumns,
  writeColumnPrefs,
} from './columns';
export type { BuiltInColumn, ColumnChoice, ColumnId, ColumnLayout, ColumnPrefs, PaneWidth } from './columns';

export {
  NO_FILTER,
  NO_TAG,
  hasFilterTag,
  isFilterOn,
  matchesFilter,
  prepareFilter,
  readFilter,
  tagFilterKey,
  toggleFilterTag,
} from './filter';
export type { Filterable, OutlineFilter, PreparedFilter } from './filter';

export { stepMove } from './moves';

export { TARGET_BANDS, formatPercent, targetBand, targetCell } from './progress';
export type { TargetBand, TargetCell } from './progress';

export { KNOWN_SCENE_KEYS, otherPropertyKeys, propertyText, readNoteTags, readProperty } from './properties';

export { WORDS_PER_MINUTE, formatMinutes, formatReadTime, readMinutes } from './readTime';

export {
  MANUSCRIPT_ROW_KEY,
  buildOutline,
  folderRowKey,
  rowRef,
  sameSums,
  sceneRowKey,
  sumScenes,
} from './rows';
export type {
  FolderRow,
  ManuscriptRow,
  Outline,
  OutlineInput,
  OutlineRow,
  SceneFacts,
  SceneFactsLookup,
  SceneRow,
  Sums,
} from './rows';

export { compareKeys, defaultCollator, describeSort, nextSort, readSort, sortKeyFor, sortScenes } from './sort';
export type { OutlineSort, SortKey, SortKeyOf, TextCompare } from './sort';

export { NO_TASKS, addTasks, countTasks, formatTasks } from './tasks';
export type { TaskCount } from './tasks';

export {
  DEFAULT_VIEW,
  MAX_VIEW_PROJECTS,
  VIEW_PREFS_VERSION,
  isDefaultView,
  moveView,
  readViewChoice,
  readViewPrefs,
  viewOf,
  withView,
  writeViewPrefs,
} from './viewPrefs';
export type { ViewChoice, ViewPrefs } from './viewPrefs';
