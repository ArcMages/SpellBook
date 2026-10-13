// The snapshots engine: what a snapshot is on disk, which scene it belongs
// to, and how two versions of a scene are compared. No screen and no vault.

export { MAX_DIFF_DISTANCE, PAIR_SIMILARITY, diffSequences, diffTexts, diffWordCount, foldUnchanged, paragraphsOf, sideOf } from './diff';
export type { DiffBlock, DiffKind, DiffPiece, DiffRow, SequenceStep, TextDiff } from './diff';
export { ONE_COLUMN_BELOW, TWO_COLUMNS_FROM, isNarrowPane } from './layout';
export {
  AUTOMATIC_NAME,
  SCENE_ID_KEY,
  SNAPSHOT_MARK,
  SNAPSHOT_VERSION,
  UNNAMED_TEXT,
  automaticToRemove,
  belongsTo,
  dayOf,
  newSceneId,
  readSnapshotInfo,
  readSnapshotText,
  restoredText,
  sceneIdOf,
  shownDate,
  shownName,
  snapshotBody,
  snapshotFileName,
  snapshotFolderName,
  snapshotFrontmatter,
  snapshotsOf,
  splitNote,
  stampOf,
  tidySnapshotName,
} from './snapshotFile';
export type { LocalMoment, NoteParts, SceneRef, SnapshotInfo, SnapshotText } from './snapshotFile';
