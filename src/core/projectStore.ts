// The project store: the one place that knows which projects exist, what is
// in the open project's binder, and how to change it safely.
//
// Rules it keeps (they exist because the vault syncs over iCloud, so another
// device can change any file at any time):
//
//  - The index note's frontmatter is the source of truth. The copy in memory
//    is only for drawing; it is re-read from disk after every write and every
//    time the index changes.
//  - Every change is an "intent" (add, rename, move, remove) applied inside
//    one read-modify-write of the index, against the binder as it is on disk
//    at that moment. An intent that no longer applies changes nothing and
//    says so.
//  - Changes run one at a time, through a queue.
//  - An index that cannot be understood makes the project read-only. It is
//    never written.
//  - Unfiled notes and Missing entries are worked out when reading, and never
//    "fixed" on disk without being asked.
//  - A note's text is never changed. Deleting a scene moves it to the trash.
//  - A scene note's "order" property is only written for something the writer
//    did on this device, and only in the notes that change needs.

import {
  findFolder,
  flattenScenes,
  folderIds,
  hasScene,
  insertNode,
  locate,
  moveNode as moveInTree,
  placementOf,
  removeFolderKeepChildren,
  removeNode,
  renameFolder as renameFolderInTree,
  replaceScenePaths,
  resolvePlacement,
  sceneRef,
  scenesIn,
  stepPlacement,
} from './binderTree';
import type { StepDirection } from './binderTree';
import { conflictCopies, mergeConflictCopy as mergeCopyInto } from './conflictCopies';
import { newFolderId, sanitiseFileName, tidyDisplayName, uniqueName } from './names';
import { ORDER_STEP, planLocalOrderKeys, readOrder } from './orderKeys';
import type { OrderedScene } from './orderKeys';
import {
  clashKey,
  comparePaths,
  isInside,
  isMarkdownPath,
  isSafeRelativePath,
  joinPath,
  normaliseRelativePath,
  noteTitle,
  parentPath,
  pathKey,
  relativeTo,
  replaceFolderPrefix,
} from './paths';
import {
  isProjectIndex,
  newIndexFrontmatter,
  parseProjectIndex,
  readTitle,
  writeBinder,
} from './projectIndex';
import { MANUSCRIPT_FOLDER, PROJECT_FOLDERS, RESEARCH_FOLDER, TODO_FILE } from './projectLayout';
import { plantSeed } from './projectSeed';
import type { PlantedSeed, ProjectSeed } from './projectSeed';
import { DEFAULT_SCENE_NAME, newSceneFrontmatter } from './scene';
import type {
  Binder,
  BinderNode,
  CreatedProject,
  Frontmatter,
  IntentResult,
  NodeRef,
  NoopReason,
  Placement,
  ProjectSnapshot,
  ProjectSummary,
  RefusalReason,
  StoreChange,
  TreeNode,
} from './types';
import { VaultFileMissingError } from './vaultPort';
import type { MarkdownFileInfo, VaultEvent, VaultPort } from './vaultPort';
import { stripFrontmatter } from './wordCount';

export { MANUSCRIPT_FOLDER, PROJECT_FOLDERS, TODO_FILE } from './projectLayout';

/** How long to wait after the last change before writing order keys into scene notes. */
export const ORDER_DEBOUNCE_MS = 1500;
/** How long to collect renames (a renamed folder reports every note in it) before one index write. */
export const RENAME_SETTLE_MS = 250;

const READ_ONLY_MESSAGE =
  'This project is read-only because its index could not be understood. Nothing was changed.';
const OTHER_PROJECT_MESSAGE =
  'Another project was opened in the meantime, so nothing was changed. Try again in the project you meant.';

/** Choices for createProject(). */
export interface NewProjectOptions {
  /** The scenes, binder folders and notes the project starts with. Default: none. */
  readonly seed?: ProjectSeed;
  /**
   * What to do when the name is taken. false (the default) refuses; true
   * creates the project as "<name> 2", "<name> 3" and so on instead.
   */
  readonly numberIfTaken?: boolean;
}

/** What merging a conflicting copy of the index came to. */
export interface MergedCopy {
  /** The scene paths that were added to the binder, relative to the project folder. */
  readonly added: string[];
  /** True when the copy's text (below its properties) was not the same as the index note's. */
  readonly textDiffers: boolean;
  /**
   * The copy's title property, when it was not the same as the index note's;
   * null when the two agreed or the copy had none. A title is not merged: the
   * project keeps its own.
   */
  readonly otherTitle: string | null;
}

/** What deleting a scene came to. */
export interface DeletedScene {
  /**
   * True when the scene's note was moved to the trash. False when the scene
   * was taken out of the binder but had no note in the project any more (it
   * was deleted or moved away in the meantime), so nothing went to the trash.
   */
  readonly trashed: boolean;
}

export interface StoreDeps {
  readonly vault: VaultPort;
  /** Today's date on this device, as YYYY-MM-DD. */
  readonly today: () => string;
  /** Call `callback` once after `ms` milliseconds. Returns a function that cancels it. */
  readonly setTimer: (callback: () => void, ms: number) => () => void;
  /** A random number from 0 up to (not including) 1; used for new folder ids. */
  readonly random: () => number;
}

interface KnownProject {
  indexPath: string;
  /** The index's title property, or null when the title comes from the file name. */
  explicitTitle: string | null;
}

interface ActiveProject {
  indexPath: string;
  folder: string;
  explicitTitle: string | null;
  /** The binder as last read from disk. */
  binder: Binder;
  readOnly: boolean;
  error: string | null;
  notes: readonly string[];
}

interface ProjectFile {
  /** Path relative to the project folder. */
  readonly rel: string;
  /** Vault path. */
  readonly path: string;
  readonly frontmatter: MarkdownFileInfo['frontmatter'];
}

/** What a binder change decided, before it is turned into the caller's result. */
type BinderChange<T> =
  | { readonly status: 'done'; readonly binder: Binder; readonly value: T; readonly warning?: string }
  | Exclude<IntentResult<T>, { status: 'done' }>;

function done<T>(value: T, warning?: string): IntentResult<T> {
  return warning === undefined ? { status: 'done', value } : { status: 'done', value, warning };
}

function noop(reason: NoopReason, message: string): { status: 'noop'; reason: NoopReason; message: string } {
  return { status: 'noop', reason, message };
}

function refused(
  reason: RefusalReason,
  message: string,
): { status: 'refused'; reason: RefusalReason; message: string } {
  return { status: 'refused', reason, message };
}

function failed(message: string): { status: 'failed'; message: string } {
  return { status: 'failed', message };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function summaryOf(known: KnownProject): ProjectSummary {
  return {
    indexPath: known.indexPath,
    folder: parentPath(known.indexPath),
    title: known.explicitTitle ?? noteTitle(known.indexPath),
  };
}

const END_OF_BINDER: Placement = { at: 'end', parentId: null };

export class ProjectStore {
  private readonly vault: VaultPort;
  private readonly deps: StoreDeps;
  private readonly listeners = new Set<(change: StoreChange) => void>();

  private stopListening: (() => void) | null = null;
  private disposed = false;

  /** Every project index found in the vault, by its path. */
  private projects = new Map<string, KnownProject>();

  private active: ActiveProject | null = null;
  private snapshot: ProjectSnapshot | null = null;
  /**
   * The opening of a project that the snapshot was last worked out for. A
   * project keeps this through a rename of its index note or its folder, and
   * gets a new one each time it is opened: that is how a project that moved
   * is told from another project that took its place.
   */
  private snapshotOf: ActiveProject | null = null;
  private snapshotSignature = '';
  private revision = 0;
  /** The open project's notes as they were when the snapshot was last worked out. */
  private snapshotFiles = new Map<string, ProjectFile>();

  /** The end of the job queue; every job chains onto it. */
  private tail: Promise<void> = Promise.resolve();
  private needsReload = false;
  private settleQueued = false;

  /**
   * Scene notes that were renamed on disk but whose index entry is not
   * updated yet: old relative path -> new relative path. They are folded
   * into the next index write.
   */
  private readonly pendingRenames = new Map<string, string>();
  private cancelRenameTimer: (() => void) | null = null;

  /** Order keys this store wrote, by vault path, until the vault's index reports the note again. */
  private readonly knownOrders = new Map<string, number>();
  /** Scenes that were just moved or added: the ones to rewrite when order keys are planned. */
  private readonly orderHints = new Set<string>();
  private cancelOrderTimer: (() => void) | null = null;

  constructor(deps: StoreDeps) {
    this.deps = deps;
    this.vault = deps.vault;
  }

  // ---------------------------------------------------------------- lifecycle

  /** Begin listening to the vault and look for projects. Safe to call before the vault has finished loading. */
  start(): void {
    if (this.stopListening) return;
    this.disposed = false;
    this.stopListening = this.vault.on((event) => this.handleEvent(event));
    this.rediscover();
  }

  /**
   * Stop listening and cancel anything scheduled. Nothing more is written
   * after this, not even order keys that were still waiting for their delay:
   * the plugin has been switched off and must leave the vault alone.
   */
  dispose(): void {
    this.disposed = true;
    this.stopListening?.();
    this.stopListening = null;
    this.cancelTimers();
    this.listeners.clear();
  }

  /** Be told when the project list or the open project changes. Returns a function that stops it. */
  onChange(listener: (change: StoreChange) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Resolves when every queued job has finished. */
  async idle(): Promise<void> {
    let seen: Promise<void>;
    do {
      seen = this.tail;
      await seen;
    } while (seen !== this.tail);
  }

  // ------------------------------------------------------------------ reading

  /**
   * The projects in the vault, sorted by title. A conflicting copy of a
   * project's index (see src/core/conflictCopies.ts) is not a project of its
   * own and is left out; the project it is a copy of reports it instead.
   */
  listProjects(): ProjectSummary[] {
    const copies = conflictCopies(this.projects.values());
    return [...this.projects.values()]
      .filter((known) => !copies.has(known.indexPath))
      .map(summaryOf)
      .sort((a, b) => {
        const byTitle = a.title.localeCompare(b.title);
        if (byTitle !== 0) return byTitle;
        return a.indexPath < b.indexPath ? -1 : a.indexPath > b.indexPath ? 1 : 0;
      });
  }

  /**
   * The index note that the note at `indexPath` is a conflicting copy of, or
   * null when it is not such a copy. Which of two index notes is the copy
   * goes by their names (never by which one is open), so every device comes
   * to the same answer.
   */
  mainIndexOf(indexPath: string): string | null {
    return conflictCopies(this.projects.values()).get(indexPath) ?? null;
  }

  /** The open project, or null. A new object whenever something changed. */
  get project(): ProjectSnapshot | null {
    return this.snapshot;
  }

  /**
   * Where a note of the open project really is: its vault path, for a path
   * relative to the project folder as the snapshot gives it. Null when the
   * project has no such note (a Missing scene, for example).
   *
   * Use this rather than joining the two paths by hand: the binder and the
   * disk may spell the same accented or pointed name in two different ways.
   */
  vaultPathOf(path: string): string | null {
    return this.snapshotFiles.get(pathKey(path))?.path ?? null;
  }

  /** Open the project whose index note is at `indexPath` (read from the file itself). */
  openProject(indexPath: string): Promise<IntentResult<ProjectSnapshot>> {
    return this.enqueue(async (): Promise<IntentResult<ProjectSnapshot>> => {
      // Order keys still waiting for their delay belong to the project that
      // is open now. Write them before leaving it; nobody would do it later.
      await this.flushOrderKeys();
      let frontmatter: Frontmatter | null;
      try {
        frontmatter = await this.vault.readFrontmatter(indexPath);
      } catch (error) {
        if (error instanceof VaultFileMissingError) {
          return refused('not-found', `There is no note at "${indexPath}".`);
        }
        return failed(`The note "${indexPath}" could not be read: ${messageOf(error)}`);
      }
      if (!isProjectIndex(frontmatter)) {
        return refused('not-a-project', `"${indexPath}" is not a Spellbook project.`);
      }
      this.resetActive();
      const active: ActiveProject = {
        indexPath,
        folder: parentPath(indexPath),
        explicitTitle: null,
        binder: [],
        readOnly: false,
        error: null,
        notes: [],
      };
      this.active = active;
      this.needsReload = false;
      this.applyIndex(active, frontmatter);
      this.refreshSnapshot();
      return done(this.snapshot as ProjectSnapshot);
    });
  }

  /**
   * Close the open project. Order keys that were still waiting for their
   * delay are written first; apart from that its files are not touched.
   */
  closeProject(): Promise<void> {
    return this.enqueue(async (): Promise<void> => {
      if (!this.active) return;
      await this.flushOrderKeys();
      this.resetActive();
      this.refreshSnapshot();
    });
  }

  // ------------------------------------------------------------------ intents
  //
  // The intents that change the open project take an optional last argument,
  // `inProject`: the index path of the project the change was decided for.
  // A menu or a confirmation window is made while looking at one project;
  // by the time the writer answers, another one may have been opened (a
  // project chosen on this device can arrive late from another device). With
  // `inProject` given, the intent is refused unless that project is still the
  // open one when its turn comes, so it can never land in the wrong project.

  /**
   * Create a new project: a folder named after it, inside `parentFolder`
   * ("" = the vault root), holding the index note, To-do.md and the folders
   * Manuscript, Timeline, Research and Stats, plus whatever `options.seed`
   * describes (scenes, binder folders, notes).
   *
   * Refuses when something with that name is already there, unless
   * `options.numberIfTaken` asks for "<name> 2", "<name> 3" and so on. Only
   * ever creates; never changes or replaces an existing file. The new project
   * is not opened.
   */
  createProject(
    name: string,
    parentFolder = '',
    options: NewProjectOptions = {},
  ): Promise<IntentResult<CreatedProject>> {
    return this.run(async (): Promise<IntentResult<CreatedProject>> => {
      const typed = tidyDisplayName(name);
      if (typed === '') return refused('invalid-name', 'Give the project a name.');
      const baseName = sanitiseFileName(typed, '');
      if (baseName === '') {
        return refused('invalid-name', `"${typed}" has no characters that can be used in a folder name.`);
      }

      const parent = joinPath(parentFolder);
      if (parent !== '') {
        if (!isSafeRelativePath(parent)) {
          return refused('invalid-path', `"${parentFolder}" is not a folder in this vault.`);
        }
        if (!this.vault.exists(parent)) {
          return refused('parent-missing', `There is no folder "${parent}" in this vault.`);
        }
      }
      for (const known of this.projects.values()) {
        const other = summaryOf(known);
        if (other.folder !== '' && (parent === other.folder || isInside(other.folder, parent))) {
          return refused(
            'inside-project',
            `"${parent}" belongs to the project "${other.title}". A project cannot be created inside another one.`,
          );
        }
      }

      let folderName = baseName;
      let title = typed;
      if (options.numberIfTaken === true) {
        folderName = uniqueName(baseName, (candidate) => this.vault.exists(joinPath(parent, candidate)));
        // The title gets the same " 2" as the folder, so the two can be told apart by name.
        title = `${typed}${folderName.slice(baseName.length)}`;
      }
      const folder = joinPath(parent, folderName);
      if (this.vault.exists(folder)) {
        return refused('exists', `There is already something called "${folderName}" here. Choose another name.`);
      }

      const seed = options.seed;
      let step = 'the project folder';
      let indexPath: string;
      let planted: PlantedSeed = { binder: [], scenes: [] };
      try {
        await this.vault.createFolder(folder);
        step = 'the project index note';
        indexPath = await this.vault.createFile(
          joinPath(folder, `${folderName}.md`),
          '',
          newIndexFrontmatter(title),
        );
        for (const sub of PROJECT_FOLDERS) {
          step = `the "${sub}" folder`;
          await this.vault.createFolder(joinPath(folder, sub));
        }
        step = 'the to-do note';
        await this.vault.createFile(joinPath(folder, TODO_FILE), seed?.todo ?? '');
        if (seed) {
          planted = await plantSeed(this.vault, folder, seed, {
            today: this.deps.today(),
            random: this.deps.random,
            onStep: (what) => {
              step = what;
            },
          });
        }
      } catch (error) {
        return failed(
          `The project was only partly created: ${step} could not be made (${messageOf(error)}). ` +
            `Nothing was deleted; "${folder}" holds what was created.`,
        );
      }

      if (planted.binder.length > 0) {
        const problem = await this.listInNewIndex(indexPath, planted.binder);
        if (problem !== null) {
          return failed(
            `The project's notes were created, but its binder could not be saved (${problem}). ` +
              `Nothing was deleted; the scenes are in "${joinPath(folder, MANUSCRIPT_FOLDER)}" and show under Unfiled.`,
          );
        }
      }

      const known: KnownProject = { indexPath, explicitTitle: title };
      this.projects.set(indexPath, known);
      this.emit({ type: 'projects' });
      return done({ ...summaryOf(known), scenes: planted.scenes });
    });
  }

  /**
   * Folders a new project can be created in: "" (the vault root) first, then
   * every folder that is not part of an existing project, each followed by
   * the folders inside it.
   */
  listParentFolders(): string[] {
    const projectFolders = [...this.projects.values()]
      .map((known) => summaryOf(known).folder)
      .filter((folder) => folder !== '');
    const free = this.vault
      .listFolders()
      .filter((folder) => !projectFolders.some((taken) => folder === taken || isInside(taken, folder)));
    return ['', ...free.sort(comparePaths)];
  }

  /** Create a scene note in Manuscript/ and put it in the binder. */
  addScene(
    title: string,
    placement: Placement = END_OF_BINDER,
    inProject?: string,
  ): Promise<IntentResult<{ path: string }>> {
    return this.run(async (): Promise<IntentResult<{ path: string }>> => {
      const active = this.active;
      const blocked = this.whyNotWritable(active);
      if (blocked || !active) return blocked ?? refused('no-project', 'No project is open.');

      const manuscript = joinPath(active.folder, MANUSCRIPT_FOLDER);
      if (!this.vault.exists(manuscript)) await this.vault.createFolder(manuscript);

      // The order keys the scenes hold now. Looked up first, so that nothing
      // has to be waited for between choosing a free name and creating the note.
      const keyed = await this.keyedScenes(active);

      // A name counts as taken when a note has it, and also when the binder
      // lists it: a Missing entry may be a note that is still on its way from
      // another device, and must not be filled in by a new empty note.
      const binder = this.effectiveBinder(active);
      const listed = new Set(flattenScenes(binder).map(clashKey));
      const base = sanitiseFileName(title, DEFAULT_SCENE_NAME);
      const name = uniqueName(base, (candidate) => {
        const rel = `${MANUSCRIPT_FOLDER}/${candidate}.md`;
        return listed.has(clashKey(rel)) || this.vault.exists(joinPath(active.folder, rel));
      });
      const wanted = `${MANUSCRIPT_FOLDER}/${name}.md`;

      const order = this.orderForNewScene(keyed.scenes, binder, wanted, placement);
      const createdPath = await this.vault.createFile(
        joinPath(active.folder, wanted),
        '',
        newSceneFrontmatter(order, this.deps.today()),
      );
      const rel = relativeTo(active.folder, createdPath) ?? wanted;
      this.knownOrders.set(createdPath, order);

      const result = await this.mutateBinder<{ path: string }>((onDisk) => {
        if (hasScene(onDisk, rel)) return noop('already-in-binder', 'The binder already lists this note.');
        const target = resolvePlacement(onDisk, placement);
        const at = target ?? { parentId: null, index: onDisk.length };
        const inserted = insertNode(onDisk, { kind: 'scene', path: rel }, at.parentId, at.index);
        if (!inserted.ok) return failed('The binder changed while the scene was being added.');
        return {
          status: 'done',
          binder: inserted.binder,
          value: { path: rel },
          warning: target
            ? undefined
            : 'The place you chose is no longer in the binder, so the scene was added at the end.',
        };
      });
      if (result.status === 'done') {
        this.scheduleOrderSync([rel]);
        return result;
      }
      // Another device listed this very path in the meantime: the scene is in the binder all the same.
      if (result.status === 'noop' && result.reason === 'already-in-binder') return done({ path: rel });
      return failed(
        `The note "${rel}" was created, but it could not be added to the binder: ${result.message} ` +
          'You can find it under Unfiled.',
      );
    }, inProject);
  }

  /** Add an empty binder folder. Binder folders are not folders on disk. */
  addFolder(
    name: string,
    placement: Placement = END_OF_BINDER,
    inProject?: string,
  ): Promise<IntentResult<{ id: string }>> {
    return this.run(async (): Promise<IntentResult<{ id: string }>> => {
      const tidy = tidyDisplayName(name);
      if (tidy === '') return refused('invalid-name', 'Give the folder a name.');
      return this.mutateBinder<{ id: string }>((onDisk) => {
        const id = newFolderId(this.deps.random, new Set(folderIds(onDisk)));
        const target = resolvePlacement(onDisk, placement);
        const at = target ?? { parentId: null, index: onDisk.length };
        const folder: BinderNode = { kind: 'folder', id, name: tidy, children: [] };
        const inserted = insertNode(onDisk, folder, at.parentId, at.index);
        if (!inserted.ok) return failed('The binder changed while the folder was being added.');
        return {
          status: 'done',
          binder: inserted.binder,
          value: { id },
          warning: target
            ? undefined
            : 'The place you chose is no longer in the binder, so the folder was added at the end.',
        };
      });
    }, inProject);
  }

  /**
   * Rename a scene: its note is renamed (links to it are updated by the
   * vault) and its binder entry follows. `path` is relative to the project.
   */
  renameScene(path: string, title: string, inProject?: string): Promise<IntentResult<{ path: string }>> {
    return this.run(async (): Promise<IntentResult<{ path: string }>> => {
      const active = this.active;
      const blocked = this.whyNotWritable(active);
      if (blocked || !active) return blocked ?? refused('no-project', 'No project is open.');
      const rel = this.checkedPath(active, path, true);
      if (typeof rel !== 'string') return rel;
      if (!this.isSceneNote(active, rel)) {
        return refused('invalid-path', `"${path}" is not a scene of this project.`);
      }

      const file = this.projectFiles(active).get(pathKey(rel));
      if (!file) {
        return refused(
          'missing-file',
          'This scene has no note in the vault (it may still be syncing), so it cannot be renamed yet.',
        );
      }
      const base = sanitiseFileName(title, DEFAULT_SCENE_NAME);
      if (base === noteTitle(file.path)) return noop('unchanged', 'The scene already has that name.');

      const directory = parentPath(file.path);
      const listed = new Set(flattenScenes(this.effectiveBinder(active)).map(clashKey));
      const name = uniqueName(base, (candidate) => {
        const candidatePath = joinPath(directory, `${candidate}.md`);
        // Changing only the capitals of its own name is not a clash.
        if (clashKey(candidatePath) === clashKey(file.path)) return false;
        const candidateRel = relativeTo(active.folder, candidatePath);
        return (
          this.vault.exists(candidatePath) ||
          (candidateRel !== null && listed.has(clashKey(candidateRel)))
        );
      });
      if (name === noteTitle(file.path)) return noop('unchanged', 'The scene already has that name.');

      const target = joinPath(directory, `${name}.md`);
      const newPath = await this.vault.rename(file.path, target);
      const newRel = relativeTo(active.folder, newPath) ?? relativeTo(active.folder, target) ?? rel;
      // The vault also reports the rename as an event; recording it twice is harmless.
      this.recordRename(file.rel, newRel);
      const saved = await this.mutateBinder<undefined>(() => noop('unchanged', ''));
      if (saved.status === 'failed' || saved.status === 'refused') {
        return failed(
          `The note was renamed to "${noteTitle(newRel)}", but the binder could not be updated: ${saved.message}`,
        );
      }
      return done({ path: newRel });
    }, inProject);
  }

  /** Change a binder folder's name. */
  renameFolder(id: string, name: string, inProject?: string): Promise<IntentResult> {
    return this.run(async (): Promise<IntentResult> => {
      const tidy = tidyDisplayName(name);
      if (tidy === '') return refused('invalid-name', 'Give the folder a name.');
      return this.mutateBinder<undefined>((onDisk) => {
        const folder = findFolder(onDisk, id);
        if (!folder) return noop('not-found', 'That folder is no longer in the binder.');
        if (folder.name === tidy) return noop('unchanged', 'The folder already has that name.');
        const next = renameFolderInTree(onDisk, id, tidy);
        if (!next) return noop('not-found', 'That folder is no longer in the binder.');
        return { status: 'done', binder: next, value: undefined };
      });
    }, inProject);
  }

  /**
   * Move a scene or a folder (with everything in it) within the binder.
   * Only the binder changes; no file is moved on disk.
   */
  moveNode(ref: NodeRef, placement: Placement, inProject?: string): Promise<IntentResult> {
    return this.run(async (): Promise<IntentResult> => {
      let moved: string[] = [];
      const result = await this.mutateBinder<undefined>((onDisk) => {
        const outcome = moveInTree(onDisk, ref, placement);
        if (outcome.ok) {
          const node = locate(onDisk, ref)?.node;
          moved = node ? scenesIn(node) : [];
          return { status: 'done', binder: outcome.binder, value: undefined };
        }
        switch (outcome.reason) {
          case 'not-found':
            return noop('not-found', 'That item is no longer in the binder.');
          case 'target-missing':
            return noop('target-missing', 'The place you chose is no longer in the binder.');
          case 'unchanged':
            return noop('unchanged', 'It is already there.');
          case 'into-itself':
            return refused('invalid-move', 'A folder cannot be moved into itself.');
        }
      });
      if (result.status === 'done') this.scheduleOrderSync(moved);
      return result;
    }, inProject);
  }

  /**
   * Move a scene or a folder (with everything in it) one step up or down:
   * past the sibling next to it or, at the edge of its folder, out to the
   * level above, straight before or after the folder. The step is worked out
   * against the binder as it is on disk. Something that is already first (or
   * last) at the top level stays where it is.
   */
  stepNode(ref: NodeRef, direction: StepDirection, inProject?: string): Promise<IntentResult> {
    return this.run(async (): Promise<IntentResult> => {
      let moved: string[] = [];
      const result = await this.mutateBinder<undefined>((onDisk) => {
        const from = locate(onDisk, ref);
        if (!from) return noop('not-found', 'That item is no longer in the binder.');
        const placement = stepPlacement(onDisk, ref, direction);
        const outcome = placement ? moveInTree(onDisk, ref, placement) : null;
        if (!outcome?.ok) {
          return noop('unchanged', direction === 'up' ? 'It is already at the top.' : 'It is already at the end.');
        }
        moved = scenesIn(from.node);
        return { status: 'done', binder: outcome.binder, value: undefined };
      });
      if (result.status === 'done') this.scheduleOrderSync(moved);
      return result;
    }, inProject);
  }

  /** Remove a binder folder but keep its contents: they move up to where the folder was. */
  removeFolder(id: string, inProject?: string): Promise<IntentResult> {
    return this.run(
      async (): Promise<IntentResult> =>
        this.mutateBinder<undefined>((onDisk) => {
          const next = removeFolderKeepChildren(onDisk, id);
          if (!next) return noop('not-found', 'That folder is no longer in the binder.');
          return { status: 'done', binder: next, value: undefined };
        }),
      inProject,
    );
  }

  /**
   * Take a scene out of the binder and move its note to the trash. The result
   * says whether a note went to the trash: an entry whose note is no longer
   * in the project is taken out of the binder all the same.
   */
  deleteScene(path: string, inProject?: string): Promise<IntentResult<DeletedScene>> {
    return this.run(async (): Promise<IntentResult<DeletedScene>> => {
      const active = this.active;
      const blocked = this.whyNotWritable(active);
      if (blocked || !active) return blocked ?? refused('no-project', 'No project is open.');
      const rel = this.checkedPath(active, path, true);
      if (typeof rel !== 'string') return rel;
      // To-do.md, research notes and the like are not scenes: never trash them from here.
      if (!this.isSceneNote(active, rel)) {
        return refused('invalid-path', `"${path}" is not a scene of this project.`);
      }

      // Binder first: a note is only trashed once the index no longer lists
      // it. If the trash step then fails, the entry is put back where it was.
      const removal = await this.mutateBinder<{ entry: BinderNode; where: Placement }>((onDisk) => {
        const where = placementOf(onDisk, sceneRef(rel));
        const removed = removeNode(onDisk, sceneRef(rel));
        if (!where || !removed) return noop('not-found', 'That scene is no longer in the binder.');
        return { status: 'done', binder: removed.binder, value: { entry: removed.node, where } };
      });
      if (removal.status === 'failed' || removal.status === 'refused') return removal;
      const taken = removal.status === 'done' ? removal.value : null;

      const file = this.projectFiles(active).get(pathKey(rel));
      if (!file) {
        // The entry is gone from the binder, but there was no note to move to the trash.
        return taken ? done({ trashed: false }) : noop('not-found', 'That scene is no longer in the project.');
      }
      if (!taken && !isInside(MANUSCRIPT_FOLDER, file.rel)) {
        // The binder on disk no longer lists it, and it is not a manuscript note: leave it be.
        return noop('not-found', 'That scene is no longer in the binder.');
      }
      try {
        await this.vault.trash(file.path);
      } catch (error) {
        const why = `note could not be moved to the trash (${messageOf(error)}).`;
        // It was an unfiled manuscript note, and still is.
        if (!taken) return failed(`The ${why} You can find it under Unfiled.`);
        if (await this.putBack(taken.entry, taken.where)) {
          return failed(`The scene was not deleted, because its ${why} It is still in the binder.`);
        }
        // Only notes in the Manuscript folder are listed as Unfiled.
        return failed(
          `The scene was taken out of the binder, but its ${why} ` +
            (isInside(MANUSCRIPT_FOLDER, file.rel)
              ? 'You can find it under Unfiled.'
              : `The note is still at "${file.rel}". To file it again, move it into the ` +
                `${MANUSCRIPT_FOLDER} folder: it is then listed under Unfiled.`),
        );
      }
      this.knownOrders.delete(file.path);
      return done({ trashed: true });
    }, inProject);
  }

  /**
   * Remove a binder entry whose note does not exist. If the note has turned
   * up in the meantime (a late sync), the entry is kept.
   */
  removeMissingEntry(path: string, inProject?: string): Promise<IntentResult> {
    return this.run(async (): Promise<IntentResult> => {
      const active = this.active;
      const blocked = this.whyNotWritable(active);
      if (blocked || !active) return blocked ?? refused('no-project', 'No project is open.');
      const rel = this.checkedPath(active, path, false);
      if (typeof rel !== 'string') return rel;
      return this.mutateBinder<undefined>((onDisk) => {
        if (!hasScene(onDisk, rel)) return noop('not-found', 'That entry is no longer in the binder.');
        if (this.projectFiles(active).has(pathKey(rel))) {
          return noop('file-exists', 'The note for this scene is in the vault now, so the entry was kept.');
        }
        const removed = removeNode(onDisk, sceneRef(rel));
        if (!removed) return noop('not-found', 'That entry is no longer in the binder.');
        return { status: 'done', binder: removed.binder, value: undefined };
      });
    }, inProject);
  }

  /** Put a note that is not in the binder (an Unfiled one) into it. */
  addUnfiledToBinder(
    path: string,
    placement: Placement = END_OF_BINDER,
    inProject?: string,
  ): Promise<IntentResult<{ path: string }>> {
    return this.run(async (): Promise<IntentResult<{ path: string }>> => {
      const active = this.active;
      const blocked = this.whyNotWritable(active);
      if (blocked || !active) return blocked ?? refused('no-project', 'No project is open.');
      const rel = this.checkedPath(active, path, true);
      if (typeof rel !== 'string') return rel;
      if (!isInside(MANUSCRIPT_FOLDER, rel)) {
        return refused('invalid-path', `Only notes in the ${MANUSCRIPT_FOLDER} folder can be added to the binder.`);
      }

      const file = this.projectFiles(active).get(pathKey(rel));
      if (!file) return noop('not-found', 'That note is no longer in the project.');

      const result = await this.mutateBinder<{ path: string }>((onDisk) => {
        if (hasScene(onDisk, file.rel)) return noop('already-in-binder', 'That note is already in the binder.');
        const target = resolvePlacement(onDisk, placement);
        const at = target ?? { parentId: null, index: onDisk.length };
        const inserted = insertNode(onDisk, { kind: 'scene', path: file.rel }, at.parentId, at.index);
        if (!inserted.ok) return failed('The binder changed while the note was being added.');
        return {
          status: 'done',
          binder: inserted.binder,
          value: { path: file.rel },
          warning: target
            ? undefined
            : 'The place you chose is no longer in the binder, so the note was added at the end.',
        };
      });
      if (result.status === 'done') this.scheduleOrderSync([file.rel]);
      return result;
    }, inProject);
  }

  /**
   * Merge a conflicting copy of the open project's index into the index, and
   * move the copy to the trash.
   *
   * Every scene path that only the copy lists is added at the end of the top
   * level of the binder, in one read-modify-write of the index; nothing the
   * index lists is removed or moved. The copy is read from the file itself.
   * It is only trashed once the index has been saved, and never when it
   * could not be understood: a copy that cannot be read is left where it is.
   *
   * Only the binder is merged. The copy's own text (the notes a writer may
   * keep in the index note) goes to the trash with it; `textDiffers` tells
   * whether that text was different from the index note's, so that the
   * writer can be told where to find it. The copy's title is not taken over
   * either; `otherTitle` gives it when it was not the index note's.
   *
   * @param copyPath the vault path of the copy, as the snapshot's `conflicts` gives it
   * @returns the scene paths that were added (relative to the project folder)
   */
  mergeConflictCopy(copyPath: string, inProject?: string): Promise<IntentResult<MergedCopy>> {
    return this.run(async (): Promise<IntentResult<MergedCopy>> => {
      const active = this.active;
      const blocked = this.whyNotWritable(active);
      if (blocked || !active) return blocked ?? refused('no-project', 'No project is open.');

      // Only a conflicting copy of this very index is ever merged and trashed.
      // What makes a note one is checked against things that cannot be out of
      // date: where it is and what it is called (a path is always known), and
      // that it is marked as a project, which is read from the file itself
      // below. Nothing here goes by what Obsidian last remembered of the
      // note's properties, which can lag behind the file.
      if (this.mainIndexOf(copyPath) !== active.indexPath) {
        if (!this.vault.exists(copyPath)) return noop('not-found', 'That copy is no longer in the vault.');
        return refused('not-a-copy', `"${copyPath}" is not a conflicting copy of this project's index.`);
      }

      const name = noteTitle(copyPath);
      let frontmatter: Frontmatter | null;
      try {
        frontmatter = await this.vault.readFrontmatter(copyPath);
      } catch (error) {
        if (error instanceof VaultFileMissingError) return noop('not-found', 'That copy is no longer in the vault.');
        return refused(
          'unreadable-copy',
          `The copy "${name}" could not be read (${messageOf(error)}). Nothing was changed, and the copy was left where it is.`,
        );
      }
      if (!isProjectIndex(frontmatter)) {
        return refused(
          'not-a-copy',
          `"${name}" is no longer marked as a Spellbook project. Nothing was changed, and the note was left where it is.`,
        );
      }
      const parsed = parseProjectIndex(frontmatter);
      if (!parsed.ok) {
        return refused(
          'unreadable-copy',
          `The copy "${name}" could not be understood: ${parsed.error} Nothing was changed, and the copy was left where it is.`,
        );
      }

      let added: string[] = [];
      // The index note's own title, as it is on disk when the binder is merged.
      const index: { title: string | null } = { title: null };
      const merged = await this.mutateBinder<undefined>((onDisk, title) => {
        index.title = title;
        const outcome = mergeCopyInto(onDisk, parsed.binder);
        added = [...outcome.added];
        // Nothing new in the copy: the index is not written at all.
        if (added.length === 0) return noop('unchanged', '');
        return { status: 'done', binder: outcome.binder, value: undefined };
      });
      if (merged.status === 'failed' || merged.status === 'refused') return merged;
      if (merged.status === 'done') this.scheduleOrderSync(added);

      // Looked at before the copy goes: is its text the same as the index note's?
      let textDiffers: boolean;
      try {
        const mine = stripFrontmatter(await this.vault.readText(active.indexPath));
        const theirs = stripFrontmatter(await this.vault.readText(copyPath));
        textDiffers = mine.trim() !== theirs.trim();
      } catch {
        // It cannot be told: better to send the writer to look than to say nothing.
        textDiffers = true;
      }

      try {
        await this.vault.trash(copyPath);
      } catch (error) {
        return failed(
          (added.length > 0 ? 'The scenes of the copy were added to the binder, but the' : 'The') +
            ` copy could not be moved to the trash (${messageOf(error)}). It is still at "${copyPath}".`,
        );
      }
      // The two versions may disagree about the title: the project keeps its own.
      const otherTitle = parsed.title !== null && parsed.title !== index.title ? parsed.title : null;
      return done({ added, textDiffers, otherTitle });
    }, inProject);
  }

  /** Write any outstanding order keys now instead of waiting for the delay. */
  syncOrderKeysNow(): Promise<void> {
    return this.enqueue(() => this.flushOrderKeys());
  }

  // -------------------------------------------------------------------- queue

  private enqueue<T>(job: () => Promise<T>): Promise<T> {
    const result = this.tail.then(job);
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  /**
   * Run an intent in the queue, then bring the snapshot up to date and tell
   * listeners once.
   *
   * @param inProject when given, the index path of the project the intent was
   *   decided for: the intent is refused, and nothing is written, unless that
   *   project is the open one when the intent's turn comes
   */
  private run<T>(job: () => Promise<IntentResult<T>>, inProject?: string): Promise<IntentResult<T>> {
    return this.enqueue(async (): Promise<IntentResult<T>> => {
      if (inProject !== undefined && this.active?.indexPath !== inProject) {
        return refused('other-project', OTHER_PROJECT_MESSAGE);
      }
      let result: IntentResult<T>;
      try {
        result = await job();
      } catch (error) {
        result = failed(messageOf(error));
      }
      await this.settle();
      return result;
    });
  }

  /** Ask for the snapshot to be brought up to date once the queue gets to it. */
  private requestSettle(): void {
    if (this.settleQueued || this.disposed) return;
    this.settleQueued = true;
    void this.enqueue(async () => {
      this.settleQueued = false;
      await this.settle();
    });
  }

  private async settle(): Promise<void> {
    try {
      if (this.needsReload) await this.reloadFromDisk();
      this.refreshSnapshot();
    } catch (error) {
      console.error('Spellbook: could not refresh the project', error);
    }
  }

  // ----------------------------------------------------------- index on disk

  /**
   * Write the binder of a project that was created a moment ago, in one
   * read-modify-write of its index note. Whatever the index already lists (it
   * is normally empty) is kept in front. Returns null when saved, or the
   * reason it could not be.
   */
  private async listInNewIndex(indexPath: string, binder: Binder): Promise<string | null> {
    let problem: string | null = null;
    try {
      await this.vault.updateFrontmatter(indexPath, (frontmatter) => {
        problem = null;
        const parsed = isProjectIndex(frontmatter) ? parseProjectIndex(frontmatter) : null;
        if (parsed === null || !parsed.ok) {
          problem = 'the index note changed while the project was being created';
          return false;
        }
        writeBinder(frontmatter, [...parsed.binder, ...binder]);
        return true;
      });
    } catch (error) {
      return messageOf(error);
    }
    return problem;
  }

  private whyNotWritable(
    active: ActiveProject | null,
  ): { status: 'refused'; reason: RefusalReason; message: string } | null {
    if (!active) return refused('no-project', 'No project is open.');
    if (active.readOnly) return refused('read-only', READ_ONLY_MESSAGE);
    return null;
  }

  /**
   * Check a path given by a caller: it must stay inside the project folder
   * and must not be the index note. Returns the tidy relative path, or a refusal.
   */
  private checkedPath(
    active: ActiveProject,
    path: string,
    mustBeMarkdown: boolean,
  ): string | { status: 'refused'; reason: RefusalReason; message: string } {
    const rel = normaliseRelativePath(path);
    if (rel === null || !isSafeRelativePath(rel) || (mustBeMarkdown && !isMarkdownPath(rel))) {
      return refused('invalid-path', `"${path}" is not a note inside this project.`);
    }
    if (pathKey(joinPath(active.folder, rel)) === pathKey(active.indexPath)) {
      return refused('invalid-path', 'The project index note is not a scene.');
    }
    return rel;
  }

  /**
   * Whether a note is one the plugin may rename or trash as a scene: one the
   * binder lists, or one in the Manuscript folder. Everything else in the
   * project folder (To-do.md, research, timeline, stats) is off limits.
   */
  private isSceneNote(active: ActiveProject, rel: string): boolean {
    return isInside(MANUSCRIPT_FOLDER, rel) || hasScene(this.effectiveBinder(active), rel);
  }

  /**
   * Put a binder entry back after a delete that did not go through: at the
   * place it was taken from, or at the end when that place is gone. Returns
   * whether the binder lists it again.
   */
  private async putBack(entry: BinderNode, where: Placement): Promise<boolean> {
    const result = await this.mutateBinder<undefined>((onDisk) => {
      const target = resolvePlacement(onDisk, where) ?? { parentId: null, index: onDisk.length };
      const inserted = insertNode(onDisk, entry, target.parentId, target.index);
      if (inserted.ok) return { status: 'done', binder: inserted.binder, value: undefined };
      // "duplicate": the index lists it again already (another device was quicker).
      return inserted.reason === 'duplicate'
        ? noop('already-in-binder', 'The binder already lists this note.')
        : failed('The binder changed while the scene was being put back.');
    });
    return result.status === 'done' || (result.status === 'noop' && result.reason === 'already-in-binder');
  }

  /**
   * Apply one change to the binder inside a single read-modify-write of the
   * index note. `change` sees the binder as it is on disk right now (and the
   * index note's title property, null when it has none) and decides what to
   * do. Renames waiting in `pendingRenames` ride along in the same write.
   * Nothing is written when there is nothing to change.
   */
  private async mutateBinder<T>(
    change: (onDisk: Binder, title: string | null) => BinderChange<T>,
  ): Promise<IntentResult<T>> {
    const active = this.active;
    const blocked = this.whyNotWritable(active);
    if (blocked || !active) return blocked ?? refused('no-project', 'No project is open.');

    const renames = [...this.pendingRenames];
    const box: { outcome: BinderChange<T> | null; understood: boolean } = {
      outcome: null,
      understood: false,
    };
    try {
      await this.vault.updateFrontmatter(active.indexPath, (frontmatter) => {
        box.outcome = null;
        box.understood = false;
        if (!isProjectIndex(frontmatter)) {
          box.outcome = refused('not-a-project', 'The index note is no longer marked as a Spellbook project.');
          return false;
        }
        const parsed = parseProjectIndex(frontmatter);
        if (!parsed.ok) {
          box.outcome = refused('read-only', READ_ONLY_MESSAGE);
          return false;
        }
        box.understood = true;
        const renamed = replaceScenePaths(parsed.binder, renames);
        const result = change(renamed.binder, parsed.title);
        box.outcome = result;
        if (result.status === 'done') {
          writeBinder(frontmatter, result.binder);
          return true;
        }
        // The intent itself changed nothing, but a waiting rename may have.
        if (renamed.changed) {
          writeBinder(frontmatter, renamed.binder);
          return true;
        }
        return false;
      });
    } catch (error) {
      this.needsReload = true;
      return failed(`The project index could not be saved: ${messageOf(error)}`);
    }

    this.needsReload = true;
    if (box.understood) {
      for (const [from, to] of renames) {
        if (this.pendingRenames.get(from) === to) this.pendingRenames.delete(from);
      }
    }
    const outcome = box.outcome;
    if (outcome === null) return failed('The project index could not be read.');
    if (outcome.status === 'done') return done(outcome.value, outcome.warning);
    return outcome;
  }

  /** Read the index note from disk again and take over what it says. */
  private async reloadFromDisk(): Promise<void> {
    const active = this.active;
    if (!active) {
      this.needsReload = false;
      return;
    }
    this.needsReload = false;
    const path = active.indexPath;
    let frontmatter: Frontmatter | null;
    try {
      frontmatter = await this.vault.readFrontmatter(path);
    } catch (error) {
      if (this.active !== active) return;
      if (active.indexPath !== path) {
        // The index was renamed while it was being read: read it again at its new path.
        this.needsReload = true;
        this.requestSettle();
        return;
      }
      this.markUnreadable(
        active,
        error instanceof VaultFileMissingError
          ? 'The project index note could not be found.'
          : `The project index note could not be read (${messageOf(error)}).`,
      );
      return;
    }
    if (this.active !== active) return;
    if (!isProjectIndex(frontmatter)) {
      // The note is no longer a project index: the project is gone.
      if (this.projects.delete(active.indexPath)) this.emit({ type: 'projects' });
      this.resetActive();
      return;
    }
    this.applyIndex(active, frontmatter);
  }

  private applyIndex(active: ActiveProject, frontmatter: Readonly<Frontmatter>): void {
    const parsed = parseProjectIndex(frontmatter);
    active.explicitTitle = parsed.title;
    if (parsed.ok) {
      const repaired = active.readOnly;
      active.binder = parsed.binder;
      active.readOnly = false;
      active.error = null;
      active.notes = parsed.notes;
      // Order keys for what the writer moved before the index became
      // unreadable could not be planned then. They can be now.
      if (repaired && this.orderHints.size > 0) this.scheduleOrderSync([]);
    } else {
      this.markUnreadable(active, parsed.error);
    }
    const known = this.projects.get(active.indexPath);
    if (!known || known.explicitTitle !== parsed.title) {
      this.projects.set(active.indexPath, { indexPath: active.indexPath, explicitTitle: parsed.title });
      this.emit({ type: 'projects' });
    }
  }

  /**
   * Put the project into read-only mode with a reason. Nothing is written
   * while it lasts. Which scenes the writer moved (orderHints) is remembered:
   * their order keys are planned once the index can be read again.
   */
  private markUnreadable(active: ActiveProject, reason: string): void {
    active.binder = [];
    active.readOnly = true;
    active.error = `${reason} The project is read-only until this is fixed; Spellbook will not change the index.`;
    active.notes = [];
    this.pendingRenames.clear();
    this.cancelTimers();
  }

  // ----------------------------------------------------------------- snapshot

  /** The markdown notes inside the project folder, by the key of their relative path. */
  private projectFiles(active: ActiveProject): Map<string, ProjectFile> {
    const files = new Map<string, ProjectFile>();
    for (const file of this.vault.listMarkdownFiles(active.folder)) {
      const rel = relativeTo(active.folder, file.path);
      if (rel === null) continue;
      files.set(pathKey(rel), { rel, path: file.path, frontmatter: file.frontmatter });
    }
    return files;
  }

  /** The binder as last read from disk, with renames that are about to be saved already applied. */
  private effectiveBinder(active: ActiveProject): Binder {
    if (this.pendingRenames.size === 0) return active.binder;
    return replaceScenePaths(active.binder, this.pendingRenames).binder;
  }

  /** Work out the snapshot again and tell listeners if it is different. */
  private refreshSnapshot(): void {
    const active = this.active;
    if (!active) {
      this.snapshotFiles = new Map();
      this.snapshotOf = null;
      if (this.snapshot !== null) {
        this.snapshot = null;
        this.snapshotSignature = '';
        this.emit({ type: 'project' });
      }
      return;
    }

    const files = this.projectFiles(active);
    this.snapshotFiles = files;
    const binder = this.effectiveBinder(active);
    const missing: string[] = [];
    const toTree = (nodes: Binder): TreeNode[] =>
      nodes.map((node): TreeNode => {
        if (node.kind === 'folder') {
          return { kind: 'folder', id: node.id, name: node.name, children: toTree(node.children) };
        }
        const isMissing = !files.has(pathKey(node.path));
        if (isMissing) missing.push(node.path);
        return { kind: 'scene', path: node.path, title: noteTitle(node.path), missing: isMissing };
      });
    const tree = toTree(binder);

    const inBinder = new Set(flattenScenes(binder).map(pathKey));
    const unfiled = [...files.values()]
      .filter((file) => isInside(MANUSCRIPT_FOLDER, file.rel) && !inBinder.has(pathKey(file.rel)))
      .map((file) => file.rel)
      .sort();
    const research = [...files.values()]
      .filter((file) => isInside(RESEARCH_FOLDER, file.rel))
      .map((file) => file.rel)
      .sort();
    const conflicts = [...conflictCopies(this.projects.values())]
      .filter(([, main]) => main === active.indexPath)
      .map(([copy]) => copy)
      .sort();

    const body = {
      indexPath: active.indexPath,
      folder: active.folder,
      title: active.explicitTitle ?? noteTitle(active.indexPath),
      readOnly: active.readOnly,
      error: active.error,
      notes: active.notes,
      tree,
      unfiled,
      missing,
      research,
      conflicts,
    };
    const signature = JSON.stringify(body);
    const before = this.snapshot;
    // The same opening of the same project, now at another path: it was
    // renamed or moved, and listeners are told where it was.
    const movedFrom =
      before !== null && this.snapshotOf === active && before.indexPath !== active.indexPath
        ? before.indexPath
        : null;
    this.snapshotOf = active;
    if (before !== null && signature === this.snapshotSignature) return;
    this.snapshotSignature = signature;
    this.revision += 1;
    this.snapshot = { ...body, revision: this.revision };
    this.emit(movedFrom === null ? { type: 'project' } : { type: 'project', movedFrom });
  }

  private emit(change: StoreChange): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(change);
      } catch (error) {
        // A view that fails to redraw must not stop the store.
        console.error('Spellbook: a change listener failed', error);
      }
    }
  }

  private cancelTimers(): void {
    this.cancelRenameTimer?.();
    this.cancelRenameTimer = null;
    this.cancelOrderTimer?.();
    this.cancelOrderTimer = null;
  }

  /** Forget the open project (without telling listeners; the caller refreshes the snapshot). */
  private resetActive(): void {
    this.active = null;
    this.needsReload = false;
    this.pendingRenames.clear();
    this.knownOrders.clear();
    this.orderHints.clear();
    this.cancelTimers();
  }

  // ---------------------------------------------------------------- discovery

  /** Look through the whole vault for project index notes. */
  private rediscover(): void {
    const found = new Map<string, KnownProject>();
    for (const file of this.vault.listMarkdownFiles()) {
      if (isProjectIndex(file.frontmatter)) {
        found.set(file.path, { indexPath: file.path, explicitTitle: readTitle(file.frontmatter) });
      } else if (file.frontmatter === null) {
        // Not indexed yet (or just created): keep what we already know about it.
        const known = this.projects.get(file.path);
        if (known) found.set(file.path, known);
      }
    }
    const signature = (projects: Map<string, KnownProject>): string =>
      JSON.stringify([...projects.values()].map(summaryOf).sort((a, b) => (a.indexPath < b.indexPath ? -1 : 1)));
    const changed = signature(found) !== signature(this.projects);
    this.projects = found;
    if (changed) this.emit({ type: 'projects' });
  }

  // ------------------------------------------------------------- vault events

  private handleEvent(event: VaultEvent): void {
    if (this.disposed) return;
    switch (event.type) {
      case 'refresh':
        this.rediscover();
        if (this.active) {
          this.needsReload = true;
          this.requestSettle();
        }
        return;
      case 'metadata':
        this.onMetadata(event.path, event.frontmatter);
        return;
      case 'create':
        if (this.touchesActive(event.path)) this.requestSettle();
        return;
      case 'modify':
        if (this.active && event.path === this.active.indexPath) {
          this.needsReload = true;
          this.requestSettle();
        }
        return;
      case 'delete':
        this.onDeleted(event.path, event.folder);
        return;
      case 'rename':
        this.onRenamed(event.oldPath, event.path, event.folder);
        return;
    }
  }

  private touchesActive(path: string): boolean {
    return this.active !== null && isInside(this.active.folder, path);
  }

  private onMetadata(path: string, frontmatter: Readonly<Frontmatter> | null): void {
    const known = this.projects.get(path);
    if (isProjectIndex(frontmatter)) {
      const explicitTitle = readTitle(frontmatter);
      if (!known || known.explicitTitle !== explicitTitle) {
        this.projects.set(path, { indexPath: path, explicitTitle });
        this.emit({ type: 'projects' });
      }
    } else if (known) {
      this.projects.delete(path);
      this.emit({ type: 'projects' });
    }

    const active = this.active;
    if (!active) return;
    if (path === active.indexPath) {
      this.needsReload = true;
      this.requestSettle();
    } else if (isInside(active.folder, path)) {
      // The vault's own index has caught up with this note; trust it again.
      this.knownOrders.delete(path);
      this.requestSettle();
    }
  }

  private onDeleted(path: string, folder: boolean): void {
    let listChanged = false;
    for (const indexPath of [...this.projects.keys()]) {
      if (indexPath === path || (folder && isInside(path, indexPath))) {
        this.projects.delete(indexPath);
        listChanged = true;
      }
    }
    if (listChanged) this.emit({ type: 'projects' });

    const active = this.active;
    if (!active) return;
    if (path === active.indexPath || (folder && isInside(path, active.indexPath))) {
      // The index note is gone, so there is no project to show any more.
      this.resetActive();
      this.refreshSnapshot();
      return;
    }
    if (isInside(active.folder, path)) {
      this.knownOrders.delete(path);
      this.requestSettle();
    }
  }

  private onRenamed(oldPath: string, newPath: string, folder: boolean): void {
    // Keep the project list pointing at the right notes.
    let listChanged = false;
    for (const [indexPath, known] of [...this.projects]) {
      const moved = folder
        ? replaceFolderPrefix(indexPath, oldPath, newPath)
        : indexPath === oldPath
          ? newPath
          : null;
      if (moved === null || moved === indexPath) continue;
      this.projects.delete(indexPath);
      this.projects.set(moved, { indexPath: moved, explicitTitle: known.explicitTitle });
      listChanged = true;
    }
    if (listChanged) this.emit({ type: 'projects' });

    const active = this.active;
    if (!active) return;

    if (folder) {
      const movedFolder = replaceFolderPrefix(active.folder, oldPath, newPath);
      if (movedFolder !== null) {
        // The project folder (or a folder above it) was renamed. Scene paths
        // are relative to it, so the binder needs no change at all.
        active.folder = movedFolder;
        active.indexPath = replaceFolderPrefix(active.indexPath, oldPath, newPath) ?? active.indexPath;
        this.requestSettle();
      } else if (isInside(active.folder, oldPath) || isInside(active.folder, newPath)) {
        this.requestSettle();
      }
      return;
    }

    if (oldPath === active.indexPath) {
      // The index note itself was renamed or moved. The project folder is
      // wherever the index is.
      const folderChanged = parentPath(newPath) !== active.folder;
      active.indexPath = newPath;
      active.folder = parentPath(newPath);
      if (folderChanged) this.pendingRenames.clear();
      this.needsReload = true;
      this.requestSettle();
      return;
    }
    if (newPath === active.indexPath) return; // already followed through its folder

    const knownOrder = this.knownOrders.get(oldPath);
    if (knownOrder !== undefined) {
      this.knownOrders.delete(oldPath);
      this.knownOrders.set(newPath, knownOrder);
    }
    const oldRel = relativeTo(active.folder, oldPath);
    const newRel = relativeTo(active.folder, newPath);
    // Only notes can be scenes; pictures and other files need no follow-up.
    const bothNotes = isMarkdownPath(oldPath) && isMarkdownPath(newPath);
    if (oldRel !== null && newRel !== null && bothNotes && !active.readOnly) {
      this.recordRename(oldRel, newRel);
      this.scheduleRenameFlush();
    }
    if (oldRel !== null || newRel !== null) this.requestSettle();
  }

  /** Remember that a note moved, joining it up with an earlier move of the same note. */
  private recordRename(oldRel: string, newRel: string): void {
    // A scene that is waiting for its order key keeps waiting under its new name.
    if (this.orderHints.delete(oldRel)) this.orderHints.add(newRel);
    for (const [from, to] of this.pendingRenames) {
      if (to !== oldRel) continue;
      if (from === newRel) this.pendingRenames.delete(from);
      else this.pendingRenames.set(from, newRel);
      return;
    }
    if (oldRel !== newRel) this.pendingRenames.set(oldRel, newRel);
  }

  /** Save waiting renames into the index, once the vault has stopped reporting them. */
  private scheduleRenameFlush(): void {
    this.cancelRenameTimer?.();
    const active = this.active;
    this.cancelRenameTimer = this.deps.setTimer(() => {
      this.cancelRenameTimer = null;
      if (this.disposed || this.active !== active) return;
      void this.run(async (): Promise<IntentResult> => {
        if (this.active !== active || this.pendingRenames.size === 0) {
          return noop('unchanged', '');
        }
        return this.mutateBinder<undefined>(() => noop('unchanged', ''));
      });
    }, RENAME_SETTLE_MS);
  }

  // --------------------------------------------------------------- order keys

  /**
   * A scene note's order key: a number, null when the note has none, or
   * undefined when that cannot be told because the note cannot be read.
   */
  private async orderOf(file: ProjectFile): Promise<number | null | undefined> {
    const written = this.knownOrders.get(file.path);
    if (written !== undefined) return written;
    if (file.frontmatter !== null) return readOrder(file.frontmatter['order']);
    // The vault's index holds nothing for this note. That is so for a note
    // without properties, and just as much for one that has not been indexed
    // yet (the app has only just started, or the note has only just arrived).
    // Only the note itself can tell the two apart.
    try {
      const onDisk = await this.vault.readFrontmatter(file.path);
      return readOrder(onDisk?.['order']);
    } catch {
      return undefined;
    }
  }

  /**
   * The scenes of the binder in manuscript order, each with the order key it
   * holds now, and the vault path of each one's note. Scenes whose note is
   * missing or cannot be read are not among them, because there is nothing
   * to write to; they are listed in `noNote` instead.
   */
  private async keyedScenes(
    active: ActiveProject,
  ): Promise<{ scenes: OrderedScene[]; vaultPathOf: Map<string, string>; noNote: string[] }> {
    const files = this.projectFiles(active);
    const scenes: OrderedScene[] = [];
    const vaultPathOf = new Map<string, string>();
    const noNote: string[] = [];
    // One note after another: when the vault's index is still empty, every
    // note has to be read, and a phone should not be asked for all at once.
    for (const rel of flattenScenes(this.effectiveBinder(active))) {
      const file = files.get(pathKey(rel));
      const order = file ? await this.orderOf(file) : undefined;
      if (!file || order === undefined) {
        noNote.push(rel);
        continue;
      }
      scenes.push({ path: rel, order });
      vaultPathOf.set(rel, file.path);
    }
    return { scenes, vaultPathOf, noNote };
  }

  /**
   * The order key for a scene about to be created at `placement`.
   * `keyed` is what keyedScenes() found: the other scenes and their keys.
   */
  private orderForNewScene(
    keyed: readonly OrderedScene[],
    binder: Binder,
    rel: string,
    placement: Placement,
  ): number {
    const target = resolvePlacement(binder, placement) ?? { parentId: null, index: binder.length };
    const inserted = insertNode(binder, { kind: 'scene', path: rel }, target.parentId, target.index);
    const withNew: Binder = inserted.ok ? inserted.binder : [...binder, { kind: 'scene', path: rel }];

    const known = new Map(keyed.map((scene) => [pathKey(scene.path), scene] as const));
    const scenes: OrderedScene[] = [];
    for (const path of flattenScenes(withNew)) {
      if (path === rel) {
        scenes.push({ path, order: null });
        continue;
      }
      const scene = known.get(pathKey(path));
      if (scene) scenes.push(scene);
    }
    const planned = planLocalOrderKeys(scenes, new Set([rel])).find((change) => change.path === rel);
    return planned?.order ?? ORDER_STEP;
  }

  /**
   * Order keys are only written as a result of something the writer did on
   * this device, never because of a change that arrived by sync: otherwise two
   * devices could keep correcting each other's files. `scenes` are the ones
   * that were just moved, added or filed here; they stay in `orderHints`
   * until a plan has dealt with them.
   */
  private scheduleOrderSync(scenes: Iterable<string>): void {
    for (const rel of scenes) this.orderHints.add(rel);
    this.cancelOrderTimer?.();
    const active = this.active;
    this.cancelOrderTimer = this.deps.setTimer(() => {
      this.cancelOrderTimer = null;
      if (this.disposed || this.active !== active) return;
      void this.enqueue(() => this.syncOrderKeys());
    }, ORDER_DEBOUNCE_MS);
  }

  /**
   * Write the order keys that are still waiting for their delay, if any.
   * Called from inside the queue, before the open project is left.
   */
  private async flushOrderKeys(): Promise<void> {
    if (this.cancelOrderTimer === null && this.orderHints.size === 0) return;
    this.cancelOrderTimer?.();
    this.cancelOrderTimer = null;
    try {
      await this.syncOrderKeys();
    } catch (error) {
      // Leaving a project must never be held up by its order keys.
      console.error('Spellbook: could not write the order keys', error);
    }
  }

  /**
   * Bring the "order" property of the scenes the writer moved, added or filed
   * on this device in line with the binder, writing as few notes as possible.
   * A scene that was not touched here is only written when it has no key at
   * all, or when no whole number fits next to it; a key that merely looks
   * wrong is left alone, because the device that moved that scene may still
   * be sending it (see planLocalOrderKeys). Missing notes are skipped. Each
   * note is re-read at the moment of writing and left alone if it already
   * holds the right value, so these writes cannot trigger each other.
   */
  private async syncOrderKeys(): Promise<void> {
    try {
      const active = this.active;
      if (!active || this.disposed) return;
      // Plan against the binder as it is on disk now.
      await this.reloadFromDisk();
      if (this.active !== active || active.readOnly) return;
      const { scenes, vaultPathOf, noNote } = await this.keyedScenes(active);
      if (this.active !== active || this.disposed) return;

      // This plan covers everything that was waiting ...
      this.cancelOrderTimer?.();
      this.cancelOrderTimer = null;
      const hints = new Set(this.orderHints);
      this.orderHints.clear();
      // ... except a scene that was moved here while its note was missing or
      // unreadable. It keeps waiting, and gets its key with a later change.
      for (const rel of noNote) {
        if (hints.has(rel)) this.orderHints.add(rel);
      }

      for (const change of planLocalOrderKeys(scenes, hints)) {
        if (this.active !== active || this.disposed) return;
        const path = vaultPathOf.get(change.path);
        if (path === undefined) continue;
        try {
          await this.vault.updateFrontmatter(path, (frontmatter) => {
            if (frontmatter['order'] === change.order) return false;
            frontmatter['order'] = change.order;
            return true;
          });
          this.knownOrders.set(path, change.order);
        } catch {
          // The note vanished or its properties cannot be read. Leave it
          // alone, and try again when the binder is next changed here.
          this.orderHints.add(change.path);
        }
      }
    } finally {
      this.refreshSnapshot();
    }
  }
}
