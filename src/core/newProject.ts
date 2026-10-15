// The two ways the plugin makes a new project: an ordinary one with a first
// scene, and the sample novel. Both create the project through the store and
// then make it the open project.

import type { NoteKind } from './noteKind';
import { joinPath } from './paths';
import type { NewProjectOptions, ProjectStore } from './projectStore';
import { starterProject } from './projectSeed';
import type { ProjectSeed } from './projectSeed';
import { SAMPLE_PROJECT_NAME, sampleProject } from './sampleProject';
import type { CreatedProject, IntentResult } from './types';

export interface NewProject {
  readonly project: CreatedProject;
  /** Vault path of the project's first scene, or null when it has none. */
  readonly firstScene: string | null;
}

async function createAndOpen(
  store: ProjectStore,
  name: string,
  parentFolder: string,
  options: NewProjectOptions,
): Promise<IntentResult<NewProject>> {
  const created = await store.createProject(name, parentFolder, options);
  if (created.status !== 'done') return created;

  const project = created.value;
  const first = project.scenes[0];
  const value: NewProject = {
    project,
    firstScene: first === undefined ? null : joinPath(project.folder, first),
  };
  const opened = await store.openProject(project.indexPath);
  if (opened.status !== 'done') {
    return {
      status: 'done',
      value,
      warning: `The project was created, but it could not be opened: ${opened.message}`,
    };
  }
  return created.warning === undefined ? { status: 'done', value } : { status: 'done', value, warning: created.warning };
}

/**
 * Create a project and open it: with one empty scene, "Scene 1", or with the
 * folders and scenes of a starting structure or a project template.
 * Refuses when something called `name` is already in `parentFolder`.
 *
 * @param seed what the project starts with. Default: one empty scene.
 */
export function createStarterProject(
  store: ProjectStore,
  name: string,
  parentFolder = '',
  seed: ProjectSeed = starterProject(),
  writesIn: NoteKind = 'scene',
): Promise<IntentResult<NewProject>> {
  return createAndOpen(store, name, parentFolder, writesIn === 'chapter' ? { seed, writesIn } : { seed });
}

/**
 * Create the sample novel and open it. It is called "Sample Novel", or
 * "Sample Novel 2" and so on when that name is taken.
 *
 * @param today today's date on this device, as YYYY-MM-DD
 */
export function createSampleProject(
  store: ProjectStore,
  today: string,
  parentFolder = '',
): Promise<IntentResult<NewProject>> {
  return createAndOpen(store, SAMPLE_PROJECT_NAME, parentFolder, {
    seed: sampleProject(today),
    numberIfTaken: true,
  });
}
