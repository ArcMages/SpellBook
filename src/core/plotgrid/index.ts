// The plot grid engine: which scene carries which plotline.
//
// Plain calculations only. Nothing here reads or writes a file, touches the
// screen or looks at the clock: values go in, values come out.
//
//   columns.ts  what the columns are (timeline lanes, labels, World
//               entities) and whether a scene is in one, by the rules the
//               timeline, the inspector and the World go by
//   grid.ts     the rows, the cells, each column's count, its bar and its gaps
//   prefs.ts    what this device remembers about the grid

export {
  CHARACTER_TYPE,
  COLUMN_KINDS,
  COLUMN_KIND_NAMES,
  PLACE_TYPE,
  entityColumns,
  isColumnKind,
  labelColumns,
  laneColumns,
  lanePatch,
  plotLanes,
  projectFirstResolver,
  sceneHasEntity,
  sceneHasLabel,
  sceneInLane,
  sceneLabel,
} from './columns';
export type { ColumnKind, PlotColumn } from './columns';

export {
  DEFAULT_GAP_LENGTH,
  MAX_GAP_LENGTH,
  MIN_GAP_LENGTH,
  barSegments,
  buildPlotGrid,
  findGaps,
  readGapLength,
  spanOf,
} from './grid';
export type { BarSegment, GridColumn, GridFolderRow, GridRow, GridSceneRow, PlotGrid, PlotGridInput, SceneStretch } from './grid';

export {
  DEFAULT_PREFS,
  chosenOf,
  foldedOf,
  movePrefs,
  readPrefs,
  renameChosen,
  withChosen,
  withFolded,
  writePrefs,
} from './prefs';
export type { PlotGridPrefs } from './prefs';
