import { Notice, Plugin } from 'obsidian';
import type { PaneType } from 'obsidian';
import { DevicePrefs } from './core/devicePrefs';
import { createSampleProject, createStarterProject } from './core/newProject';
import type { NewProject } from './core/newProject';
import { ProjectSession } from './core/projectSession';
import { ProjectStore } from './core/projectStore';
import type { IntentResult } from './core/types';
import { WordCountCache } from './core/wordCountCache';
import { ObsidianDeviceStorage } from './obsidian/deviceStorage';
import { ObsidianVault } from './obsidian/obsidianVault';
import { openNote } from './obsidian/openNote';
import { localToday, setTimer } from './obsidian/systemClock';
import { SpellbookSettingTab } from './settings';
import { CreateProjectModal } from './ui/createProjectModal';
import { BINDER_ICON } from './ui/icons';
import { BINDER_VIEW_TYPE, BinderView } from './views/binderView';
import type { BinderHost, BinderServices } from './views/binderView';

const STILL_STARTING = 'Spellbook is still starting. Try again in a moment.';
const STILL_CREATING = 'Spellbook is still creating the last project. Try again when it has finished.';
const NO_ROOM_FOR_BINDER = 'The binder could not be opened: Obsidian has no room for it in the left sidebar.';

/** How long a notice about something that went wrong stays up, in milliseconds. */
const PROBLEM_NOTICE_MS = 10000;

/**
 * Spellbook, a novel writer.
 *
 * Plugin entry point. It registers the settings tab, the commands and the
 * binder panel, and, once Obsidian has finished starting up, creates the
 * project store, which finds the Spellbook projects in the vault and opens
 * the one this device last worked on. Loading the plugin changes no note;
 * notes are only created when a command is run.
 */
export default class SpellbookPlugin extends Plugin implements BinderHost {
  /**
   * The working parts of the plugin: the project store and what goes with it.
   * Null until Obsidian's layout is ready, and again after unloading.
   */
  services: BinderServices | null = null;

  private unloaded = false;
  /** True while a project is being created, so that a second request cannot overlap it. */
  private creating = false;
  /** Callbacks waiting for the services to exist. */
  private waiting: Array<() => void> = [];
  /** The binder being brought to the front, so that two requests cannot open two. */
  private revealing: Promise<void> | null = null;

  /**
   * The projects in this vault and the one that is open. Views read from
   * here. Null until Obsidian's layout is ready, and again after unloading.
   */
  get store(): ProjectStore | null {
    return this.services?.store ?? null;
  }

  override onload(): void {
    this.addSettingTab(new SpellbookSettingTab(this.app, this));

    this.registerView(BINDER_VIEW_TYPE, (leaf) => new BinderView(leaf, this));
    this.addRibbonIcon(BINDER_ICON, 'Open Spellbook binder', () => {
      void this.openBinder();
    });

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
    this.addCommand({
      id: 'open-binder',
      name: 'Open binder',
      callback: () => {
        void this.openBinder();
      },
    });

    this.register(() => {
      this.unloaded = true;
      this.waiting = [];
    });
    // Obsidian is still loading the vault while plugins load. Waiting for the
    // layout keeps start-up fast and means the file list is complete.
    this.app.workspace.onLayoutReady(() => {
      this.start();
    });
  }

  override onunload(): void {
    // Nothing to release by hand: the settings tab, the commands, the ribbon
    // icon, the binder panel, the vault listeners and the store's clean-up
    // were all registered through the Plugin API, and Obsidian removes them
    // when the plugin unloads. An open binder is left where it is, so that it
    // is still there when the plugin is switched on again.
  }

  /** Create the vault doorway, the project store and what goes with it. Runs once, when the layout is ready. */
  private start(): void {
    if (this.unloaded || this.services) return;
    const vault = new ObsidianVault(this.app);
    const store = new ProjectStore({
      vault,
      today: localToday,
      setTimer,
      random: Math.random,
    });
    const prefs = new DevicePrefs(new ObsidianDeviceStorage(this.app));
    const session = new ProjectSession(store, prefs);
    const wordCounts = new WordCountCache({ vault, setTimer });
    this.services = { store, session, wordCounts, prefs };

    store.start();
    wordCounts.start();
    vault.start((ref) => {
      this.registerEvent(ref);
    });
    // Open the project this device last worked on. This only reads.
    session.start();
    this.register(() => {
      session.dispose();
      wordCounts.dispose();
      store.dispose();
      vault.stop();
      this.services = null;
    });

    for (const callback of this.waiting.splice(0)) {
      try {
        callback();
      } catch (error) {
        console.error('Spellbook: a panel could not start', error);
      }
    }
  }

  // --------------------------------------------------------- for the panels

  whenStarted(callback: () => void): void {
    if (this.services) callback();
    else if (!this.unloaded) this.waiting.push(callback);
  }

  openNote(path: string, where: PaneType | boolean = false): Promise<boolean> {
    return openNote(this.app, path, where);
  }

  /**
   * Show the binder in the left sidebar. A binder that is already open
   * anywhere is brought to the front instead: there is only ever one.
   */
  openBinder(): Promise<void> {
    if (this.unloaded) return Promise.resolve();
    this.revealing ??= this.revealBinder().finally(() => {
      this.revealing = null;
    });
    return this.revealing;
  }

  private async revealBinder(): Promise<void> {
    const { workspace } = this.app;
    try {
      const open = workspace.getLeavesOfType(BINDER_VIEW_TYPE);
      let leaf = open[0] ?? null;
      for (const extra of open.slice(1)) extra.detach();
      if (!leaf) {
        leaf = workspace.getLeftLeaf(false);
        if (!leaf) {
          new Notice(NO_ROOM_FOR_BINDER, PROBLEM_NOTICE_MS);
          return;
        }
        await leaf.setViewState({ type: BINDER_VIEW_TYPE, active: true });
      }
      await workspace.revealLeaf(leaf);
    } catch (error) {
      console.error('Spellbook: the binder could not be opened', error);
      new Notice('The binder could not be opened.', PROBLEM_NOTICE_MS);
    }
  }

  // ----------------------------------------------------------------- commands

  /** Show the window that asks for a new project's name and location. */
  askForNewProject(): void {
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
    // The writer made this project: it is the one this device works on from now on.
    this.services?.session.remember(result.value.project.indexPath);

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
