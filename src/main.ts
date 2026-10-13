import { Notice, Plugin } from 'obsidian';
import type { PaneType } from 'obsidian';
import { owningProject, placeOfNote } from './core/binderModel';
import { BinderSelection } from './core/binderSelection';
import { sceneRef } from './core/binderTree';
import { DevicePrefs } from './core/devicePrefs';
import { createSampleProject, createStarterProject } from './core/newProject';
import type { NewProject } from './core/newProject';
import { isInside, isMarkdownPath, relativeTo } from './core/paths';
import { MANUSCRIPT_FOLDER, RESEARCH_FOLDER } from './core/projectLayout';
import { ProjectSession } from './core/projectSession';
import { ProjectStore } from './core/projectStore';
import type { IntentResult, NodeRef, ProjectSnapshot } from './core/types';
import { WordCountCache } from './core/wordCountCache';
import { ObsidianDeviceStorage } from './obsidian/deviceStorage';
import { ObsidianVault } from './obsidian/obsidianVault';
import { openNote } from './obsidian/openNote';
import { localToday, setTimer } from './obsidian/systemClock';
import { SpellbookSettingTab } from './settings';
import { CreateProjectModal } from './ui/createProjectModal';
import { BINDER_ICON } from './ui/icons';
import { BinderActions } from './views/binderActions';
import type { ActionsHost } from './views/binderActions';
import { BINDER_VIEW_TYPE, BinderView } from './views/binderView';
import type { BinderHost, BinderServices } from './views/binderView';

const STILL_STARTING = 'Spellbook is still starting. Try again in a moment.';
const STILL_CREATING = 'Spellbook is still creating the last project. Try again when it has finished.';
const NO_ROOM_FOR_BINDER = 'The binder could not be opened: Obsidian has no room for it in the left sidebar.';

/** How long a notice about something that went wrong stays up, in milliseconds. */
const PROBLEM_NOTICE_MS = 10000;

/** The open project, when it is one that can be changed. */
interface OpenProject {
  readonly services: BinderServices;
  readonly project: ProjectSnapshot;
}

/** The note being worked on, as a scene of the open project's binder. */
interface ActiveScene extends OpenProject {
  readonly ref: NodeRef;
}

/** A note that has (or should have) a row in the binder of one of the vault's projects. */
interface RevealTarget {
  /** The index path of the note's project. */
  readonly indexPath: string;
  /** The note's path relative to that project's folder. */
  readonly path: string;
}

/**
 * Spellbook, a novel writer.
 *
 * Plugin entry point. It registers the settings tab, the commands and the
 * binder panel, and, once Obsidian has finished starting up, creates the
 * project store, which finds the Spellbook projects in the vault and opens
 * the one this device last worked on. Loading the plugin changes no note;
 * notes are only created when a command is run.
 */
export default class SpellbookPlugin extends Plugin implements BinderHost, ActionsHost {
  /**
   * The working parts of the plugin: the project store and what goes with it.
   * Null until Obsidian's layout is ready, and again after unloading.
   */
  services: BinderServices | null = null;

  /** What the binder's buttons, its menus and the commands below do. */
  readonly actions = new BinderActions(this);

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

    // The commands below make everything in the binder possible without a
    // mouse and without dragging. Each one is only offered while it can do
    // something: the command palette asks first (checking = true).
    this.addCommand({
      id: 'new-scene',
      name: 'New scene',
      checkCallback: (checking) => {
        const open = this.writableProject();
        if (!open) return false;
        if (!checking) this.actions.newSceneNear(open.project.indexPath, this.rowInUse(open));
        return true;
      },
    });
    this.addCommand({
      id: 'new-folder',
      name: 'New folder',
      checkCallback: (checking) => {
        const open = this.writableProject();
        if (!open) return false;
        if (!checking) this.actions.newFolderNear(open.project.indexPath, this.rowInUse(open));
        return true;
      },
    });
    this.addCommand({
      id: 'move-scene-up',
      name: 'Move scene up',
      checkCallback: (checking) => {
        const scene = this.activeScene();
        if (!scene) return false;
        if (!checking) void this.actions.step(scene.project.indexPath, scene.ref, 'up');
        return true;
      },
    });
    this.addCommand({
      id: 'move-scene-down',
      name: 'Move scene down',
      checkCallback: (checking) => {
        const scene = this.activeScene();
        if (!scene) return false;
        if (!checking) void this.actions.step(scene.project.indexPath, scene.ref, 'down');
        return true;
      },
    });
    this.addCommand({
      id: 'reveal-active-scene',
      name: 'Reveal active scene in binder',
      checkCallback: (checking) => {
        const target = this.revealTarget();
        if (!target) return false;
        if (!checking) void this.revealInBinder(target);
        return true;
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
    const selection = new BinderSelection();
    this.services = { store, session, wordCounts, prefs, selection };

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
      selection.dispose();
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

  // ------------------------------------------------- what the commands act on

  /** The open project, when there is one and it can be changed. */
  private writableProject(): OpenProject | null {
    const services = this.services;
    const project = services?.store.project;
    if (!services || !project || project.readOnly) return null;
    return { services, project };
  }

  /** The vault path of the note being worked on, if any. */
  private activePath(): string | null {
    return this.app.workspace.getActiveFile()?.path ?? null;
  }

  /** The note being worked on, when it is a scene in the binder of the open project. */
  private activeScene(): ActiveScene | null {
    const open = this.writableProject();
    const active = this.activePath();
    if (!open || active === null) return null;
    const path = relativeTo(open.project.folder, active);
    if (path === null || placeOfNote(open.project, path) !== 'binder') return null;
    return { ...open, ref: sceneRef(path) };
  }

  /**
   * The row a new scene or folder is put next to when a command asks for
   * one: the scene being worked on, or else the binder's selected row.
   */
  private rowInUse(open: OpenProject): NodeRef | null {
    return this.activeScene()?.ref ?? open.services.selection.currentIn(open.project.indexPath);
  }

  /**
   * Where the note being worked on is to be found in a binder: in the open
   * project when it has a row there, or else in the project whose Manuscript
   * or Research folder holds it. Null for any other note.
   */
  private revealTarget(): RevealTarget | null {
    const services = this.services;
    const active = this.activePath();
    if (!services || active === null) return null;
    const open = services.store.project;
    if (open) {
      const path = relativeTo(open.folder, active);
      if (path !== null && placeOfNote(open, path) !== null) return { indexPath: open.indexPath, path };
    }
    const owner = owningProject(services.store.listProjects(), active);
    if (!owner || owner.indexPath === open?.indexPath || !isMarkdownPath(active)) return null;
    const path = relativeTo(owner.folder, active);
    if (path === null || !(isInside(MANUSCRIPT_FOLDER, path) || isInside(RESEARCH_FOLDER, path))) return null;
    return { indexPath: owner.indexPath, path };
  }

  /**
   * Show the binder with the row of a note selected and in view. When the
   * note belongs to another project of the vault, that project is opened
   * first (and becomes the one this device works on).
   */
  private async revealInBinder(target: RevealTarget): Promise<void> {
    const services = this.services;
    if (!services) return;
    if (services.store.project?.indexPath !== target.indexPath) {
      const result = await services.session.choose(target.indexPath);
      if (result.status !== 'done') {
        new Notice(result.message, PROBLEM_NOTICE_MS);
        return;
      }
    }
    await this.openBinder();
    const project = this.services?.store.project;
    if (!project || project.indexPath !== target.indexPath || placeOfNote(project, target.path) === null) {
      new Notice('This note has no row in the binder.');
      return;
    }
    this.actions.select(target.indexPath, sceneRef(target.path));
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
