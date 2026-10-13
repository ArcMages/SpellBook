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

import {
  findFolder,
  flattenScenes,
  folderIds,
  hasScene,
  insertNode,
  locate,
  moveNode as moveInTree,
  removeFolderKeepChildren,
  removeNode,
  renameFolder as renameFolderInTree,
  replaceScenePaths,
  resolvePlacement,
  sceneRef,
  scenesIn,
} from './binderTree';
import { newFolderId, sanitiseFileName, uniqueName } from './names';
import { ORDER_STEP, planOrderKeys, readOrder } from './orderKeys';
import type { OrderedScene } from './orderKeys';
import {
  clashKey,
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
import { DEFAULT_SCENE_NAME, newSceneFrontmatter } from './scene';
import type {
  Binder,
  BinderNode,
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

/** The folder scenes live in. Notes here that are not in the binder show as Unfiled. */
export const MANUSCRIPT_FOLDER = 'Manuscript';
/** The folders every new project gets. */
export const PROJECT_FOLDERS: readonly string[] = [MANUSCRIPT_FOLDER, 'Timeline', 'Research', 'Stats'];
export const TODO_FILE = 'To-do.md';

/** How long to wait after the last change before writing order keys into scene notes. */
export const ORDER_DEBOUNCE_MS = 1500;
/** How long to collect renames (a renamed folder reports every note in it) before one index write. */
export const RENAME_SETTLE_MS = 250;

const READ_ONLY_MESSAGE =
  'This project is read-only because its index could not be understood. Nothing was changed.';

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

/** Folder names are free text, but a line break or a run of spaces in one helps nobody. */
function tidyDisplayName(name: string): string {
  return name.replace(/\s+/g, ' ').trim();
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
  private snapshotSignature = '';
  private revision = 0;

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

  /** Stop listening and cancel anything scheduled. Nothing more is written after this. */
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

  /** The projects in the vault, sorted by title. */
  listProjects(): ProjectSummary[] {
    return [...this.projects.values()].map(summaryOf).sort((a, b) => {
      const byTitle = a.title.localeCompare(b.title);
      if (byTitle !== 0) return byTitle;
      return a.indexPath < b.indexPath ? -1 : a.indexPath > b.indexPath ? 1 : 0;
    });
  }

  /** The open project, or null. A new object whenever something changed. */
  get project(): ProjectSnapshot | null {
    return this.snapshot;
  }

  /** Open the project whose index note is at `indexPath` (read from the file itself). */
  openProject(indexPath: string): Promise<IntentResult<ProjectSnapshot>> {
    return this.enqueue(async (): Promise<IntentResult<ProjectSnapshot>> => {
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

  /** Close the open project. Its files are not touched. */
  closeProject(): void {
    if (!this.active) return;
    this.resetActive();
    this.refreshSnapshot();
  }

  // ------------------------------------------------------------------ intents

  /**
   * Create a new project: a folder named after it, inside `parentFolder`
   * ("" = the vault root), holding the index note, To-do.md and the folders
   * Manuscript, Timeline, Research and Stats. Refuses when something with
   * that name is already there.
   */
  createProject(name: string, parentFolder = ''): Promise<IntentResult<ProjectSummary>> {
    return this.run(async (): Promise<IntentResult<ProjectSummary>> => {
      const title = tidyDisplayName(name);
      if (title === '') return refused('invalid-name', 'Give the project a name.');
      const folderName = sanitiseFileName(title, '');
      if (folderName === '') {
        return refused('invalid-name', `"${title}" has no characters that can be used in a folder name.`);
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

      const folder = joinPath(parent, folderName);
      if (this.vault.exists(folder)) {
        return refused('exists', `There is already something called "${folderName}" here. Choose another name.`);
      }

      let step = 'the project folder';
      let indexPath: string;
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
        await this.vault.createFile(joinPath(folder, TODO_FILE), '');
      } catch (error) {
        return failed(
          `The project was only partly created: ${step} could not be made (${messageOf(error)}). ` +
            `Nothing was deleted; "${folder}" holds what was created.`,
        );
      }

      const known: KnownProject = { indexPath, explicitTitle: title };
      this.projects.set(indexPath, known);
      this.emit({ type: 'projects' });
      return done(summaryOf(known));
    });
  }

  /** Create a scene note in Manuscript/ and put it in the binder. */
  addScene(title: string, placement: Placement = END_OF_BINDER): Promise<IntentResult<{ path: string }>> {
    return this.run(async (): Promise<IntentResult<{ path: string }>> => {
      const active = this.active;
      const blocked = this.whyNotWritable(active);
      if (blocked || !active) return blocked ?? refused('no-project', 'No project is open.');

      const manuscript = joinPath(active.folder, MANUSCRIPT_FOLDER);
      if (!this.vault.exists(manuscript)) await this.vault.createFolder(manuscript);

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

      const order = this.orderForNewScene(active, binder, wanted, placement);
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
    });
  }

  /** Add an empty binder folder. Binder folders are not folders on disk. */
  addFolder(name: string, placement: Placement = END_OF_BINDER): Promise<IntentResult<{ id: string }>> {
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
    });
  }

  /**
   * Rename a scene: its note is renamed (links to it are updated by the
   * vault) and its binder entry follows. `path` is relative to the project.
   */
  renameScene(path: string, title: string): Promise<IntentResult<{ path: string }>> {
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
    });
  }

  /** Change a binder folder's name. */
  renameFolder(id: string, name: string): Promise<IntentResult> {
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
    });
  }

  /**
   * Move a scene or a folder (with everything in it) within the binder.
   * Only the binder changes; no file is moved on disk.
   */
  moveNode(ref: NodeRef, placement: Placement): Promise<IntentResult> {
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
    });
  }

  /** Remove a binder folder but keep its contents: they move up to where the folder was. */
  removeFolder(id: string): Promise<IntentResult> {
    return this.run(async (): Promise<IntentResult> =>
      this.mutateBinder<undefined>((onDisk) => {
        const next = removeFolderKeepChildren(onDisk, id);
        if (!next) return noop('not-found', 'That folder is no longer in the binder.');
        return { status: 'done', binder: next, value: undefined };
      }),
    );
  }

  /** Take a scene out of the binder and move its note to the trash. */
  deleteScene(path: string): Promise<IntentResult> {
    return this.run(async (): Promise<IntentResult> => {
      const active = this.active;
      const blocked = this.whyNotWritable(active);
      if (blocked || !active) return blocked ?? refused('no-project', 'No project is open.');
      const rel = this.checkedPath(active, path, true);
      if (typeof rel !== 'string') return rel;
      // To-do.md, research notes and the like are not scenes: never trash them from here.
      if (!this.isSceneNote(active, rel)) {
        return refused('invalid-path', `"${path}" is not a scene of this project.`);
      }

      // Binder first: if the trash step then fails, the note is still there
      // and simply shows up as Unfiled.
      const removal = await this.mutateBinder<undefined>((onDisk) => {
        const removed = removeNode(onDisk, sceneRef(rel));
        if (!removed) return noop('not-found', 'That scene is no longer in the binder.');
        return { status: 'done', binder: removed.binder, value: undefined };
      });
      if (removal.status === 'failed' || removal.status === 'refused') return removal;
      const wasInBinder = removal.status === 'done';

      const file = this.projectFiles(active).get(pathKey(rel));
      if (!file) {
        return wasInBinder ? done(undefined) : noop('not-found', 'That scene is no longer in the project.');
      }
      if (!wasInBinder && !isInside(MANUSCRIPT_FOLDER, file.rel)) {
        // The binder on disk no longer lists it, and it is not a manuscript note: leave it be.
        return noop('not-found', 'That scene is no longer in the binder.');
      }
      try {
        await this.vault.trash(file.path);
      } catch (error) {
        return failed(
          (wasInBinder ? 'The scene was taken out of the binder, but its ' : 'The ') +
            `note could not be moved to the trash: ${messageOf(error)} You can find it under Unfiled.`,
        );
      }
      this.knownOrders.delete(file.path);
      return done(undefined);
    });
  }

  /**
   * Remove a binder entry whose note does not exist. If the note has turned
   * up in the meantime (a late sync), the entry is kept.
   */
  removeMissingEntry(path: string): Promise<IntentResult> {
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
    });
  }

  /** Put a note that is not in the binder (an Unfiled one) into it. */
  addUnfiledToBinder(path: string, placement: Placement = END_OF_BINDER): Promise<IntentResult<{ path: string }>> {
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
    });
  }

  /** Write any outstanding order keys now instead of waiting for the delay. */
  syncOrderKeysNow(): Promise<void> {
    this.cancelOrderTimer?.();
    this.cancelOrderTimer = null;
    return this.enqueue(() => this.syncOrderKeys());
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

  /** Run an intent in the queue, then bring the snapshot up to date and tell listeners once. */
  private run<T>(job: () => Promise<IntentResult<T>>): Promise<IntentResult<T>> {
    return this.enqueue(async (): Promise<IntentResult<T>> => {
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
   * Apply one change to the binder inside a single read-modify-write of the
   * index note. `change` sees the binder as it is on disk right now and
   * decides what to do. Renames waiting in `pendingRenames` ride along in the
   * same write. Nothing is written when there is nothing to change.
   */
  private async mutateBinder<T>(change: (onDisk: Binder) => BinderChange<T>): Promise<IntentResult<T>> {
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
        const result = change(renamed.binder);
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
      active.binder = parsed.binder;
      active.readOnly = false;
      active.error = null;
      active.notes = parsed.notes;
    } else {
      this.markUnreadable(active, parsed.error);
    }
    const known = this.projects.get(active.indexPath);
    if (!known || known.explicitTitle !== parsed.title) {
      this.projects.set(active.indexPath, { indexPath: active.indexPath, explicitTitle: parsed.title });
      this.emit({ type: 'projects' });
    }
  }

  /** Put the project into read-only mode with a reason. Nothing is written while it lasts. */
  private markUnreadable(active: ActiveProject, reason: string): void {
    active.binder = [];
    active.readOnly = true;
    active.error = `${reason} The project is read-only until this is fixed; Spellbook will not change the index.`;
    active.notes = [];
    this.pendingRenames.clear();
    this.orderHints.clear();
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
      if (this.snapshot !== null) {
        this.snapshot = null;
        this.snapshotSignature = '';
        this.emit({ type: 'project' });
      }
      return;
    }

    const files = this.projectFiles(active);
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
    };
    const signature = JSON.stringify(body);
    if (this.snapshot !== null && signature === this.snapshotSignature) return;
    this.snapshotSignature = signature;
    this.revision += 1;
    this.snapshot = { ...body, revision: this.revision };
    this.emit({ type: 'project' });
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

  private orderOf(file: ProjectFile): number | null {
    return this.knownOrders.get(file.path) ?? readOrder(file.frontmatter?.['order']);
  }

  /** The order key for a scene about to be created at `placement`. */
  private orderForNewScene(active: ActiveProject, binder: Binder, rel: string, placement: Placement): number {
    const target = resolvePlacement(binder, placement) ?? { parentId: null, index: binder.length };
    const inserted = insertNode(binder, { kind: 'scene', path: rel }, target.parentId, target.index);
    const withNew: Binder = inserted.ok ? inserted.binder : [...binder, { kind: 'scene', path: rel }];

    const files = this.projectFiles(active);
    const scenes: OrderedScene[] = [];
    for (const path of flattenScenes(withNew)) {
      if (path === rel) {
        scenes.push({ path, order: null });
        continue;
      }
      const file = files.get(pathKey(path));
      if (file) scenes.push({ path, order: this.orderOf(file) });
    }
    const planned = planOrderKeys(scenes, new Set([rel])).find((change) => change.path === rel);
    return planned?.order ?? ORDER_STEP;
  }

  /**
   * Order keys are only written as a result of something the writer did on
   * this device, never because of a change that arrived by sync: otherwise two
   * devices could keep correcting each other's files.
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
   * Bring the "order" property of the scene notes in line with the binder,
   * writing as few notes as possible. Missing notes are skipped. Each note is
   * re-read at the moment of writing and left alone if it already holds the
   * right value, so these writes cannot trigger each other.
   */
  private async syncOrderKeys(): Promise<void> {
    try {
      const active = this.active;
      if (!active || this.disposed) return;
      // Plan against the binder as it is on disk now.
      await this.reloadFromDisk();
      if (this.active !== active || active.readOnly) return;

      const hints = new Set(this.orderHints);
      this.orderHints.clear();
      const files = this.projectFiles(active);
      const scenes: OrderedScene[] = [];
      const vaultPathOf = new Map<string, string>();
      for (const rel of flattenScenes(this.effectiveBinder(active))) {
        const file = files.get(pathKey(rel));
        if (!file) continue; // Missing: nothing to write to
        scenes.push({ path: rel, order: this.orderOf(file) });
        vaultPathOf.set(rel, file.path);
      }

      for (const change of planOrderKeys(scenes, hints)) {
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
          // alone; the next change to the binder plans again.
        }
      }
    } finally {
      this.refreshSnapshot();
    }
  }
}
