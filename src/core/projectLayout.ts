// The names of the fixed parts of a project folder:
//
//   <Project>/<Project>.md   the project index
//   <Project>/To-do.md
//   <Project>/Manuscript/    <Project>/Timeline/    <Project>/Research/    <Project>/Stats/

/** The folder scenes live in. Notes here that are not in the binder show as Unfiled. */
export const MANUSCRIPT_FOLDER = 'Manuscript';

export const RESEARCH_FOLDER = 'Research';

/** The folders every new project gets. */
export const PROJECT_FOLDERS: readonly string[] = [MANUSCRIPT_FOLDER, 'Timeline', RESEARCH_FOLDER, 'Stats'];

export const TODO_FILE = 'To-do.md';
