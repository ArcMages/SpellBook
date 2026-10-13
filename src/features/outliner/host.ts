// The plugin's side of the outliner: what the table asks, on top of the
// project store.
//
// While a table is listening, it keeps:
//   - the open project as the table needs it (its name, the binder tree and
//     the lists of statuses and labels), handed out as the same object until
//     something in it changes;
//   - the properties of every scene of the binder, from the vault's index,
//     each handed out as the same object until that scene's properties change;
//   - the to-do lines of every scene, counted from its text, but only while
//     a table shows its Tasks column: the texts are read a few at a time.
// Word counts come from the plugin's shared cache (through wordCounts.ts).
//
// It follows the store and the vault only while a table is listening, and
// lets go of everything it kept when the last one stops. So a plugin that is
// loaded with no outliner open does no work for it and leaves nothing behind.
//
// Every change goes through the project store. The vault doorway is used to
// read and to listen, never to write.

import { Notice } from 'obsidian';
import type { PaneType } from 'obsidian';
import { TAG_INDEX_KEYS, applyFrontmatterPatch, inspectorPatch, isEmptyPatch, readTagLists } from '../../core/cards';
import type { CardLists, InspectorEdits } from '../../core/cards';
import {
  countTasks,
  moveView,
  readColumnPrefs,
  readViewPrefs,
  viewOf,
  withView,
  writeColumnPrefs,
  writeViewPrefs,
} from '../../core/outliner';
import type { ColumnPrefs, SceneFacts, TaskCount, ViewChoice } from '../../core/outliner';
import { noteTitle, pathKey } from '../../core/paths';
import type { Frontmatter, IntentResult, NodeRef, Placement, StoreChange, TreeNode } from '../../core/types';
import type { VaultEvent } from '../../core/vaultPort';
import type { DragClock } from '../../ui/dragDrop';
import { MISSING_LABEL } from '../../ui/missingNote';
import type { FeatureContext } from '../registry';
import { PROBLEM_NOTICE_MS } from './parts';
import { outlinerWordCounts } from './wordCounts';
import type { OutlinerWordCounts } from './wordCounts';

/** Where this device remembers the columns of the table. */
export const COLUMNS_KEY = 'spellbook-outliner-columns';
/** Where this device remembers the sort, the filter and the folded folders of each project. */
export const VIEW_KEY = 'spellbook-outliner-view';

/** How long after a scene was last saved its text is read again, in milliseconds. */
export const TASKS_SETTLE_MS = 750;
/** At most this many scenes are read in one go before the screen is given a moment. */
export const TASKS_SLICE = 20;

export const SWITCHED_OFF_TEXT = 'Spellbook has been switched off. Nothing was changed.';
export const NO_PROJECT_OPEN_TEXT = 'No project is open. Nothing was changed.';

/** The open project, as the table needs it. A new object whenever something in it changes. */
export interface OutlinerProject {
  /** The project's index path: what it is known by. */
  readonly id: string;
  /** The project's name: the writer's own text. */
  readonly title: string;
  /** True when the project cannot be changed (its index could not be understood). */
  readonly readOnly: boolean;
  readonly tree: readonly TreeNode[];
  readonly lists: CardLists;
}

/** What a table is told. It then asks the host again. */
export type OutlinerChange =
  /** The project changed, or was opened, closed or swapped for another. */
  | { readonly type: 'project' }
  /** What is known about these scenes changed (properties, words, to-do lines). */
  | { readonly type: 'scenes'; readonly paths: readonly string[] }
  /** The columns were changed (from another outliner pane, perhaps). */
  | { readonly type: 'columns' };

/** What the host is built on: the parts of the feature context it uses. */
export type OutlinerHostContext = Pick<
  FeatureContext,
  'store' | 'vault' | 'storage' | 'clock' | 'wordCounts' | 'openNote'
>;

/** A scene's properties as last seen, with their text for telling a change from none. */
interface Known {
  readonly frontmatter: Readonly<Frontmatter> | null;
  readonly json: string;
}

/** The open project, worked out once for every change of it. */
interface Model {
  readonly project: OutlinerProject;
  /** The binder tree as text, for telling a change of it from none. */
  readonly treeKey: string;
  /** Every scene of the binder, in order, by its path as the binder spells it. */
  readonly scenes: readonly string[];
  /** Where each scene's note is in the vault; a scene whose note is missing has no entry. */
  readonly vaultPaths: ReadonlyMap<string, string>;
  /** The other way round: the scene a note in the vault is. */
  readonly byVaultPath: ReadonlyMap<string, string>;
  /** The other notes the binder shows a count for, as vault paths. */
  readonly others: readonly string[];
}

/** What a finished request says to the screen: null when done, or why it was not. */
function answerOf(result: IntentResult<unknown>): string | null {
  if (result.status === 'done') {
    if (result.warning !== undefined) new Notice(result.warning, PROBLEM_NOTICE_MS);
    return null;
  }
  // Already as it was asked to be: nothing to say.
  if (result.status === 'noop' && result.reason === 'unchanged') return null;
  return result.message;
}

export class OutlinerHost {
  readonly clock: DragClock;

  private readonly context: OutlinerHostContext;
  private readonly counts: OutlinerWordCounts;
  private disposed = false;
  private readonly listening = new Set<(change: OutlinerChange) => void>();
  /** What stops the host from following the store, the vault and the word counts. */
  private stops: Array<() => void> = [];

  private model: Model | null = null;
  /** The lists that were last handed out, and what they were read from. */
  private lists: CardLists | null = null;
  private listsKey = '';
  private properties = new Map<string, Known>();
  /**
   * Properties this host has just written, by scene: they stand in for what
   * the vault's index says until the index has caught up with the note.
   */
  private readonly written = new Map<string, Readonly<Frontmatter>>();

  /** The tables that show their Tasks column. */
  private readonly taskWatchers = new Set<object>();
  /** The to-do lines of each scene whose text was read; null for a text that could not be read. */
  private readonly tasks = new Map<string, TaskCount | null>();
  private readonly taskQueue = new Set<string>();
  /** Scenes that were just saved, each with the function that cancels its timer. */
  private readonly taskTimers = new Map<string, () => void>();
  private taskInHand: string | null = null;
  private readingTasks = false;
  /** Goes up whenever what is being read is no longer wanted, so that the reading stops. */
  private epoch = 0;
  private stopPause: (() => void) | null = null;

  /** The scenes that changed and have not been reported yet. */
  private readonly pendingScenes = new Set<string>();
  private stopFlush: (() => void) | null = null;

  /** What this device remembers; null until it was read. */
  private columnPrefs: ColumnPrefs | null = null;
  private viewPrefs: Map<string, ViewChoice> | null = null;

  constructor(context: OutlinerHostContext) {
    this.context = context;
    this.clock = context.clock;
    this.counts = outlinerWordCounts(context.wordCounts);
  }

  // ---------------------------------------------------------------- lifecycle

  /** The plugin is being switched off: stop following everything and forget what was kept. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unfollow();
    // A table that is still open says that there is nothing to work on any more.
    this.emit({ type: 'project' });
    this.listening.clear();
    this.taskWatchers.clear();
  }

  get ready(): boolean {
    return !this.disposed;
  }

  /** How many tables are listening. */
  get listenerCount(): number {
    return this.listening.size;
  }

  onChange(listener: (change: OutlinerChange) => void): () => void {
    if (this.disposed) return () => undefined;
    const first = this.listening.size === 0;
    this.listening.add(listener);
    if (first) this.follow();
    return () => {
      if (!this.listening.delete(listener)) return;
      if (this.listening.size === 0) this.unfollow();
    };
  }

  /** The first table is listening: work everything out and keep it up to date from here on. */
  private follow(): void {
    const { store, vault } = this.context;
    this.refresh();
    this.stops = [
      store.onChange((change) => {
        if (change.type === 'project') this.onProjectChange(change);
      }),
      vault.on((event) => {
        this.onVaultEvent(event);
      }),
      this.counts.onChange((paths) => {
        this.onCounts(paths);
      }),
    ];
    this.keepCounting();
    this.queueTasks();
  }

  /** No table is listening any more: stop following, and keep nothing. */
  private unfollow(): void {
    for (const stop of this.stops.splice(0)) stop();
    this.stopFlush?.();
    this.stopFlush = null;
    this.counts.release();
    this.model = null;
    this.forgetScenes();
  }

  /** Forget everything that was known about the scenes (of the project that was open until now). */
  private forgetScenes(): void {
    this.forgetTasks();
    this.properties = new Map();
    this.written.clear();
    this.pendingScenes.clear();
  }

  private emit(change: OutlinerChange): void {
    for (const listener of [...this.listening]) {
      try {
        listener(change);
      } catch (error) {
        // A table that fails to draw must not stop the others from hearing of the change.
        console.error('Spellbook: the outliner could not follow a change', error);
      }
    }
  }

  /** Say that scenes changed. Changes that come in a row (a batch of word counts) are reported together, a moment later. */
  private reportScenes(paths: Iterable<string>): void {
    if (this.listening.size === 0) {
      this.pendingScenes.clear();
      return;
    }
    for (const path of paths) this.pendingScenes.add(path);
    if (this.pendingScenes.size === 0 || this.stopFlush !== null) return;
    this.stopFlush = this.context.clock.setTimer(() => {
      this.stopFlush = null;
      if (this.pendingScenes.size === 0) return;
      const changed = [...this.pendingScenes];
      this.pendingScenes.clear();
      this.emit({ type: 'scenes', paths: changed });
    }, 0);
  }

  // --------------------------------------------------------- the open project

  /**
   * The open project as it is now. While a table is listening it is kept up
   * to date; otherwise it is worked out when asked for.
   */
  private look(): Model | null {
    if (this.disposed) return null;
    if (this.listening.size === 0) this.refresh();
    return this.model;
  }

  /** The project's statuses and labels: the same object until one of the lists changes. */
  private listsNow(): CardLists {
    const { store } = this.context;
    const statuses = store.projectData(TAG_INDEX_KEYS.status);
    const labels = store.projectData(TAG_INDEX_KEYS.label);
    const key = JSON.stringify([statuses, labels]);
    if (this.lists === null || key !== this.listsKey) {
      this.lists = readTagLists({ [TAG_INDEX_KEYS.status]: statuses, [TAG_INDEX_KEYS.label]: labels });
      this.listsKey = key;
    }
    return this.lists;
  }

  /**
   * Read the open project from the store again.
   *
   * @returns the scenes whose properties are not what they were
   */
  private refresh(): string[] {
    const { store } = this.context;
    const snapshot = store.project;
    if (!snapshot) {
      this.model = null;
      this.forgetScenes();
      return [];
    }
    const last = this.model !== null && this.model.project.id === snapshot.indexPath ? this.model : null;
    // Another project: nothing that was known about the last one applies.
    if (!last) this.forgetScenes();

    const lists = this.listsNow();
    const treeKey = JSON.stringify(snapshot.tree);
    const sameTree = last !== null && last.treeKey === treeKey;
    const project: OutlinerProject =
      last !== null &&
      sameTree &&
      last.project.readOnly === snapshot.readOnly &&
      last.project.title === snapshot.title &&
      last.project.lists === lists
        ? last.project
        : {
            id: snapshot.indexPath,
            title: snapshot.title,
            readOnly: snapshot.readOnly,
            tree: last !== null && sameTree ? last.project.tree : snapshot.tree,
            lists,
          };

    const scenes: string[] = [];
    const vaultPaths = new Map<string, string>();
    const byVaultPath = new Map<string, string>();
    const walk = (nodes: readonly TreeNode[]): void => {
      for (const node of nodes) {
        if (node.kind === 'folder') {
          walk(node.children);
          continue;
        }
        scenes.push(node.path);
        const vaultPath = node.missing ? null : store.vaultPathOf(node.path);
        if (vaultPath === null) continue;
        vaultPaths.set(node.path, vaultPath);
        byVaultPath.set(vaultPath, node.path);
      }
    };
    walk(snapshot.tree);
    const others: string[] = [];
    for (const path of snapshot.unfiled) {
      const vaultPath = store.vaultPathOf(path);
      if (vaultPath !== null) others.push(vaultPath);
    }
    this.model = { project, treeKey, scenes, vaultPaths, byVaultPath, others };

    // The binder and the disk may spell the same name in two ways: notes are matched by key.
    const indexed = new Map<string, Readonly<Frontmatter> | null>();
    for (const note of store.projectNotes()) indexed.set(pathKey(note.path), note.frontmatter);
    const properties = new Map<string, Known>();
    const changed: string[] = [];
    for (const path of scenes) {
      const frontmatter = this.written.get(path) ?? indexed.get(pathKey(path)) ?? null;
      const json = JSON.stringify(frontmatter);
      const known = this.properties.get(path);
      if (known !== undefined && known.json === json) {
        properties.set(path, known);
      } else {
        properties.set(path, { frontmatter, json });
        if (known !== undefined) changed.push(path);
      }
    }
    this.properties = properties;
    for (const path of [...this.written.keys()]) {
      if (!properties.has(path)) this.written.delete(path);
    }
    // A scene that left the binder: what was read of it is not kept.
    for (const path of [...this.tasks.keys()]) {
      if (!vaultPaths.has(path)) this.tasks.delete(path);
    }
    return changed;
  }

  /** The store says that the open project changed (or was opened, closed or swapped for another). */
  private onProjectChange(change: StoreChange & { type: 'project' }): void {
    const before = this.model?.project ?? null;
    const changed = this.refresh();
    const now = this.model?.project ?? null;
    // The same project at another path: what this device remembers of it goes with it.
    if (change.movedFrom !== undefined && now !== null && change.movedFrom !== now.id) {
      this.viewPrefs = moveView(this.views(), change.movedFrom, now.id);
      this.saveViews();
    }
    this.keepCounting();
    this.queueTasks();
    if (now !== before) this.emit({ type: 'project' });
    this.reportScenes(changed);
  }

  get project(): OutlinerProject | null {
    return this.look()?.project ?? null;
  }

  // ---------------------------------------------------------------- the vault

  private onVaultEvent(event: VaultEvent): void {
    const model = this.model;
    if (!model) return;
    switch (event.type) {
      case 'metadata': {
        const path = model.byVaultPath.get(event.path);
        if (path === undefined) return;
        // The vault's own index has caught up with this note: it is trusted again.
        this.written.delete(path);
        if (this.know(path, event.frontmatter)) this.reportScenes([path]);
        return;
      }
      case 'modify': {
        const path = model.byVaultPath.get(event.path);
        if (path === undefined) return;
        if (this.taskWatchers.size > 0) this.readTasksSoon(path);
        this.keepCounting();
        return;
      }
      case 'refresh':
        // The index was filled (again) wholesale: look at everything anew.
        this.written.clear();
        this.onProjectChange({ type: 'project' });
        return;
      default:
        // A note that was created, deleted or renamed changes the project: the store says so.
        return;
    }
  }

  /**
   * Take in a scene's properties.
   *
   * @returns whether they are different from what was known
   */
  private know(path: string, frontmatter: Readonly<Frontmatter> | null): boolean {
    const json = JSON.stringify(frontmatter);
    if (this.properties.get(path)?.json === json) return false;
    this.properties.set(path, { frontmatter, json });
    return true;
  }

  // ------------------------------------------------------------ word counts

  /**
   * Ask for the words of the project's notes to be counted, while a table is
   * open. Asked again whenever something changes (see wordCounts.ts for why).
   */
  private keepCounting(): void {
    const model = this.model;
    if (!model || this.listening.size === 0) return;
    this.counts.want([...model.vaultPaths.values()], model.others);
  }

  private onCounts(vaultPaths: readonly string[]): void {
    const model = this.model;
    if (!model) return;
    const changed: string[] = [];
    for (const vaultPath of vaultPaths) {
      const path = model.byVaultPath.get(vaultPath);
      if (path !== undefined) changed.push(path);
    }
    this.reportScenes(changed);
  }

  // ------------------------------------------------------------- to-do lines

  /**
   * Say whether a table shows its Tasks column. The scenes' texts are only
   * read while at least one table does.
   *
   * @param watcher the table (anything that stays the same object for as long as it is open)
   */
  wantTasks(watcher: object, wanted: boolean): void {
    if (this.disposed) return;
    const before = this.taskWatchers.size > 0;
    if (wanted) this.taskWatchers.add(watcher);
    else this.taskWatchers.delete(watcher);
    const now = this.taskWatchers.size > 0;
    if (now === before) return;
    if (now) this.queueTasks();
    else this.forgetTasks();
  }

  private forgetTasks(): void {
    this.epoch++;
    this.readingTasks = false;
    this.taskInHand = null;
    this.stopPause?.();
    this.stopPause = null;
    for (const cancel of this.taskTimers.values()) cancel();
    this.taskTimers.clear();
    this.taskQueue.clear();
    this.tasks.clear();
  }

  /** Line up every scene whose text has not been read yet. */
  private queueTasks(): void {
    const model = this.model;
    if (!model || this.taskWatchers.size === 0 || this.listening.size === 0) return;
    for (const path of model.vaultPaths.keys()) {
      if (!this.tasks.has(path) && path !== this.taskInHand) this.taskQueue.add(path);
    }
    this.pumpTasks();
  }

  /** Read a scene's text again once it has stopped being saved for a moment. */
  private readTasksSoon(path: string): void {
    this.taskTimers.get(path)?.();
    this.taskTimers.set(
      path,
      this.context.clock.setTimer(() => {
        this.taskTimers.delete(path);
        if (this.taskWatchers.size === 0) return;
        this.taskQueue.add(path);
        this.pumpTasks();
      }, TASKS_SETTLE_MS),
    );
  }

  private pumpTasks(): void {
    if (this.readingTasks || this.taskQueue.size === 0 || this.listening.size === 0) return;
    this.readingTasks = true;
    void this.readTasks(this.epoch);
  }

  /** Let Obsidian draw and answer taps before going on. */
  private pause(): Promise<void> {
    return new Promise((resolve) => {
      this.stopPause = this.context.clock.setTimer(() => {
        this.stopPause = null;
        resolve();
      }, 0);
    });
  }

  /** Read the texts that are waiting, one at a time, and report them a slice at a time. */
  private async readTasks(epoch: number): Promise<void> {
    let fresh: string[] = [];
    const announce = (): void => {
      if (fresh.length === 0) return;
      const paths = fresh;
      fresh = [];
      this.reportScenes(paths);
    };
    try {
      let read = 0;
      while (epoch === this.epoch) {
        if (read >= TASKS_SLICE) {
          announce();
          await this.pause();
          if (epoch !== this.epoch) return;
          read = 0;
        }
        const next = this.taskQueue.values().next();
        if (next.done === true) break;
        const path = next.value;
        this.taskQueue.delete(path);
        const vaultPath = this.model?.vaultPaths.get(path);
        if (vaultPath === undefined) continue;
        read++;
        this.taskInHand = path;
        let counted: TaskCount | null;
        try {
          counted = countTasks(await this.context.vault.readText(vaultPath));
        } catch {
          // Gone, or not readable: the cell shows nothing. It is read again when it is saved.
          counted = null;
        }
        if (epoch !== this.epoch) return;
        this.taskInHand = null;
        // Saved again while it was being read: what was read is out of date.
        if (this.taskQueue.has(path)) continue;
        const known = this.tasks.get(path);
        const same =
          this.tasks.has(path) &&
          (known === counted ||
            (known !== null && known !== undefined && counted !== null && known.done === counted.done && known.total === counted.total));
        if (same) continue;
        this.tasks.set(path, counted);
        fresh.push(path);
      }
    } catch (error) {
      console.error('Spellbook: reading the scenes for the outliner failed', error);
    } finally {
      if (epoch === this.epoch) {
        this.readingTasks = false;
        this.taskInHand = null;
        announce();
      }
    }
  }

  // ----------------------------------------------------------- what is asked

  /** What is known about a scene; undefined when no project is open. */
  facts(path: string): SceneFacts | undefined {
    const model = this.look();
    if (!model) return undefined;
    const vaultPath = model.vaultPaths.get(path);
    return {
      frontmatter: this.properties.get(path)?.frontmatter ?? null,
      // A scene without a note cannot be counted; one that is waiting its turn has no count yet.
      words: vaultPath === undefined ? null : this.counts.get(vaultPath),
      tasks: this.tasks.get(path),
    };
  }

  /** The properties of every scene of the binder, in manuscript order. */
  sceneProperties(): Array<Readonly<Frontmatter> | null> {
    const model = this.look();
    if (!model) return [];
    return model.scenes.map((path) => this.properties.get(path)?.frontmatter ?? null);
  }

  // ---------------------------------------------- what this device remembers

  private load(key: string): unknown {
    try {
      return this.context.storage.load(key);
    } catch (error) {
      console.error('Spellbook: could not read what this device remembers', error);
      return null;
    }
  }

  private save(key: string, value: string | null): void {
    try {
      this.context.storage.save(key, value);
    } catch (error) {
      // The choice then lasts until Obsidian closes.
      console.error('Spellbook: could not save what this device remembers', error);
    }
  }

  /** The two column layouts of this device: one for a pane with room, one for a narrow one. */
  get columns(): ColumnPrefs {
    this.columnPrefs ??= readColumnPrefs(this.load(COLUMNS_KEY));
    return this.columnPrefs;
  }

  setColumns(prefs: ColumnPrefs): void {
    this.columnPrefs = prefs;
    this.save(COLUMNS_KEY, writeColumnPrefs(prefs));
    this.emit({ type: 'columns' });
  }

  private views(): Map<string, ViewChoice> {
    this.viewPrefs ??= readViewPrefs(this.load(VIEW_KEY));
    return this.viewPrefs;
  }

  private saveViews(): void {
    this.save(VIEW_KEY, writeViewPrefs(this.views()));
  }

  /** How the table was left for a project: its sort, its filter and its folded folders. */
  viewChoice(project: string): ViewChoice {
    return viewOf(this.views(), project);
  }

  setViewChoice(project: string, choice: ViewChoice): void {
    this.viewPrefs = withView(this.views(), project, choice);
    this.saveViews();
  }

  // ------------------------------------------------------------------ changes

  /** The index path of the open project, or the sentence that says why nothing can be changed. */
  private openProject(): { readonly id: string } | string {
    if (this.disposed) return SWITCHED_OFF_TEXT;
    const snapshot = this.context.store.project;
    return snapshot ? { id: snapshot.indexPath } : NO_PROJECT_OPEN_TEXT;
  }

  /**
   * A scene's properties were just saved. The vault's index only catches up
   * a moment later; until it has, what was saved is what the table is shown.
   */
  private noteWritten(path: string, frontmatter: Frontmatter): void {
    if (this.listening.size === 0 || this.model?.vaultPaths.has(path) !== true) return;
    // The index got there first: nothing to stand in for.
    if (this.properties.get(path)?.json === JSON.stringify(frontmatter)) return;
    const kept = Object.freeze(frontmatter);
    this.written.set(path, kept);
    if (this.know(path, kept)) this.reportScenes([path]);
  }

  /**
   * Change a scene's status, label, target, synopsis or "compile". The cards
   * engine checks the edit and names only the keys that really change; the
   * store writes them in its read-change-save step, against the note as it is
   * on disk at that moment.
   *
   * @returns null when it was done (or there was nothing to do), otherwise why not
   */
  async patchScene(path: string, edits: InspectorEdits): Promise<string | null> {
    const open = this.openProject();
    if (typeof open === 'string') return open;
    this.look();
    const lists = this.listsNow();
    // Checked first against what the table shows: a slip of the finger is
    // answered, and an edit that changes nothing ends here, without the note being touched.
    const shown = inspectorPatch(this.properties.get(path)?.frontmatter, edits, lists);
    if (!shown.ok) return shown.errors.map((error) => error.message).join(' ');
    if (isEmptyPatch(shown.patch)) return null;

    const outcome: { problem: string | null; saved: Frontmatter | null } = { problem: null, saved: null };
    const result = await this.context.store.updateNoteProperties(
      path,
      (frontmatter) => {
        const onDisk = inspectorPatch(frontmatter, edits, lists);
        if (!onDisk.ok) {
          outcome.problem = onDisk.errors.map((error) => error.message).join(' ');
          return false;
        }
        outcome.problem = null;
        const changed = applyFrontmatterPatch(frontmatter, onDisk.patch);
        outcome.saved = changed ? { ...frontmatter } : null;
        return changed;
      },
      open.id,
    );
    if (outcome.problem !== null) return outcome.problem;
    if (result.status === 'done' && outcome.saved !== null) this.noteWritten(path, outcome.saved);
    return answerOf(result);
  }

  /** Move a scene or a folder within the binder. */
  async moveNode(ref: NodeRef, placement: Placement): Promise<string | null> {
    const open = this.openProject();
    if (typeof open === 'string') return open;
    return answerOf(await this.context.store.moveNode(ref, placement, open.id));
  }

  async openScene(path: string, where: PaneType | boolean): Promise<void> {
    if (this.disposed) return;
    const title = noteTitle(path);
    const vaultPath = this.context.store.vaultPathOf(path);
    if (vaultPath === null) {
      new Notice(`"${title}": ${MISSING_LABEL}.`);
      return;
    }
    let shown = false;
    try {
      shown = await this.context.openNote(vaultPath, where);
    } catch {
      shown = false;
    }
    if (!shown) new Notice(`"${title}" could not be opened.`);
  }
}
