// The names of the fixed parts of a project folder:
//
//   <Project>/<Project>.md   the project index
//   <Project>/To-do.md
//   <Project>/Manuscript/    <Project>/Timeline/    <Project>/Research/    <Project>/Stats/

/** The folder scenes live in. Notes here that are not in the binder show as Unfiled. */
export const MANUSCRIPT_FOLDER = 'Manuscript';

/** The folder the timeline's events live in: one note per event. */
export const TIMELINE_FOLDER = 'Timeline';

export const RESEARCH_FOLDER = 'Research';

/** The folder the plugin keeps its own daily word logs in: one file per device per month. */
export const STATS_FOLDER = 'Stats';

/** The folders every new project gets. */
export const PROJECT_FOLDERS: readonly string[] = [MANUSCRIPT_FOLDER, TIMELINE_FOLDER, RESEARCH_FOLDER, STATS_FOLDER];

/**
 * The folder exported manuscripts are saved in. It is not part of a new
 * project: it is made the first time the writer exports.
 */
export const EXPORTS_FOLDER = 'Exports';

/** The kinds of file an export can be, by the ending of the file's name. */
export const EXPORT_EXTENSIONS: readonly string[] = ['md', 'html', 'docx'];

/**
 * The folder the world-building notes live in: one note per character, place,
 * faction or item, each in a folder for its type ("World/Characters"). It is
 * not part of a new project: it is made the first time the writer adds one.
 */
export const WORLD_FOLDER = 'World';

/** The project's to-dos, as plain checkbox lines. */
export const TODO_FILE = 'To-do.md';

/**
 * The folder the snapshots of scenes are kept in: earlier versions, saved as
 * plain notes, one folder for each scene. It is not part of a new project:
 * it is made the first time a snapshot is taken.
 */
export const SNAPSHOTS_FOLDER = 'Snapshots';
