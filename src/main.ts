import { Notice, Plugin } from 'obsidian';
import { createSampleProject, createStarterProject } from './core/newProject';
import type { NewProject } from './core/newProject';
import { ProjectStore } from './core/projectStore';
import type { IntentResult } from './core/types';
import { ObsidianVault } from './obsidian/obsidianVault';
import { openNote } from './obsidian/openNote';
import { localToday, setTimer } from './obsidian/systemClock';
import { SpellbookSettingTab } from './settings';
import { CreateProjectModal } from './ui/createProjectModal';

const STILL_STARTING = 'Spellbook is still starting. Try again in a moment.';
const STILL_CREATING = 'Spellbook is still creating the last project. Try again when it has finished.';

/** How long a notice about something that went wrong stays up, in milliseconds. */
const PROBLEM_NOTICE_MS = 10000;

/**
 * Spellbook, a novel writer.
 *
 * Plugin entry point. It registers the settings tab and the commands, and,
 * once Obsidian has finished starting up, creates the project store, which
 * finds the Spellbook projects in the vault. Loading the plugin changes no
 * note; notes are only created when a command is run.
 */
export default class SpellbookPlugin extends Plugin {
  /**
   * The projects in this vault and the one that is open. Views read from
   * here. Null until Obsidian's layout is ready, and again after unloading.
   */
  store: ProjectStore | null = null;

  private unloaded = false;
  /** True while a project is being created, so that a second request cannot overlap it. */
  private creating = false;

  override onload(): void {
    this.addSettingTab(new SpellbookSettingTab(this.app, this));

    this.addCommand({
      id: 'create-project',
      name: 'Create project',
      callback: () => {
        this.askForNewProject();
      },
    });
    this.addCommand({
      id: 'create-sample-project',
      name: 'Create sample project',
      callback: () => {
        void this.createSampleProject();
      },
    });

    this.register(() => {
      this.unloaded = true;
    });
    // Obsidian is still loading the vault while plugins load. Waiting for the
    // layout keeps start-up fast and means the file list is complete.
    this.app.workspace.onLayoutReady(() => {
      this.start();
    });
  }

  override onunload(): void {
    // Nothing to release by hand: the settings tab, the commands, the vault
    // listeners and the store's clean-up were all registered through the
    // Plugin API, and Obsidian removes them when the plugin unloads.
  }

  /** Create the vault doorway and the project store. Runs once, when the layout is ready. */
  private start(): void {
    if (this.unloaded || this.store) return;
    const vault = new ObsidianVault(this.app);
    const store = new ProjectStore({
      vault,
      today: localToday,
      setTimer,
      random: Math.random,
    });
    this.store = store;
    store.start();
    vault.start((ref) => {
      this.registerEvent(ref);
    });
    this.register(() => {
      store.dispose();
      vault.stop();
      this.store = null;
    });
  }

  // ----------------------------------------------------------------- commands

  /** Show the window that asks for a new project's name and location. */
  private askForNewProject(): void {
    const store = this.store;
    if (!store) {
      new Notice(STILL_STARTING);
      return;
    }
    new CreateProjectModal(this.app, store.listParentFolders(), (name, parentFolder) =>
      this.createProject(name, parentFolder),
    ).open();
  }

  /**
   * Create a project with a first scene, make it the open project and show
   * the scene. Says what happened in a notice.
   *
   * @returns true when the project was created
   */
  async createProject(name: string, parentFolder = ''): Promise<boolean> {
    return this.createWith(
      (store) => createStarterProject(store, name, parentFolder),
      (made) => `Created the project "${made.project.title}".`,
    );
  }

  /**
   * Create the sample novel ("Sample Novel", or "Sample Novel 2" and so on),
   * make it the open project and show its first scene.
   *
   * @returns true when the project was created
   */
  async createSampleProject(): Promise<boolean> {
    return this.createWith(
      (store) => createSampleProject(store, localToday()),
      (made) => `Created "${made.project.title}" with ${made.project.scenes.length} scenes.`,
      'Creating the sample project...',
    );
  }

  private async createWith(
    create: (store: ProjectStore) => Promise<IntentResult<NewProject>>,
    describe: (made: NewProject) => string,
    progressMessage?: string,
  ): Promise<boolean> {
    const store = this.store;
    if (!store) {
      new Notice(STILL_STARTING);
      return false;
    }
    if (this.creating) {
      new Notice(STILL_CREATING);
      return false;
    }

    this.creating = true;
    const progress = progressMessage === undefined ? null : new Notice(progressMessage, 0);
    let result: IntentResult<NewProject>;
    try {
      result = await create(store);
    } catch (error) {
      result = { status: 'failed', message: error instanceof Error ? error.message : String(error) };
    } finally {
      this.creating = false;
      progress?.hide();
    }

    if (result.status !== 'done') {
      new Notice(result.message, PROBLEM_NOTICE_MS);
      return false;
    }
    new Notice(describe(result.value));
    if (result.warning !== undefined) new Notice(result.warning, PROBLEM_NOTICE_MS);

    const firstScene = result.value.firstScene;
    if (firstScene !== null && !this.unloaded) {
      let shown = false;
      try {
        shown = await openNote(this.app, firstScene);
      } catch {
        shown = false;
      }
      if (!shown) {
        new Notice(`The project is ready, but "${firstScene}" could not be opened. You can open it from the file list.`);
      }
    }
    return true;
  }
}
