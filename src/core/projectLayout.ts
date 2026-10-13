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

/** The project's to-dos, as plain checkbox lines. */
export const TODO_FILE = 'To-do.md';
