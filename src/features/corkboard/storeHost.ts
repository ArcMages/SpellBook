// The plugin's side of the corkboard, the inspector and the
// statuses-and-labels window: the host they ask (see host.ts), on top of the
// project store.
//
// While a screen is listening, it keeps:
//   - the open project as these screens need it (the binder tree and the two
//     lists), handed out as the same object until something in it changes;
//   - the properties of every scene of the binder, from the vault's index,
//     each handed out as the same object until that scene's properties change;
//   - the text of the scenes a corkboard has shown that have no synopsis of
//     their own, read a few at a time, only for scenes that are on show;
//   - which scene is being worked on in the editor.
// Word counts come from the cache the binder uses too.
//
// It follows the store, the vault and the workspace only while a screen is
// listening to it, and lets go of everything it kept when the last one stops.
// So a plugin that is loaded with none of these screens open does no work for
// them and leaves nothing behind.
//
// Every change goes through the project store. The vault doorway is used to
// read and to listen, never to write.

import { Notice } from 'obsidian';
import type { PaneType, TFile } from 'obsidian';
import {
  TAG_INDEX_KEYS,
  applyFrontmatterPatch,
  hasSynopsis,
  readCardSize,
  readTagLists,
  renameTagInScene,
} from '../../core/cards';
import type { CardLists, CardMove, CardSize, FrontmatterPatch, SceneData, SceneProperties } from '../../core/cards';
import { noteTitle, pathKey } from '../../core/paths';
import type { Frontmatter, IntentResult, TreeNode } from '../../core/types';
import type { VaultEvent } from '../../core/vaultPort';
import type { DragClock } from '../../ui/dragDrop';
import { MISSING_LABEL } from '../../ui/missingNote';
import type { FeatureContext } from '../registry';
import type {
  CardsChange,
  CardsProject,
  CorkboardHost,
  HostAnswer,
  InspectorHost,
  TagListChange,
  Unsubscribe,
} from './host';
import { PROBLEM_NOTICE_MS } from './parts';
import { mountSceneEntities } from './sceneEntities';
import { mountSceneLine } from './summaryLine';

/** Where this device remembers the size of the cards. */
export const CARD_SIZE_KEY = 'spellbook-card-size';

/** The name under which the corkboard asks for word counts (see WordCountCache.track). */
export const WORD_COUNT_ASKER = 'corkboard';

/** How long after a scene was last saved its text is read again, in milliseconds. */
export const TEXT_SETTLE_MS = 750;

/** At most this many scenes are read in one go before the screen is given a moment. */
export const TEXT_SLICE = 20;

export const SWITCHED_OFF_TEXT = 'Spellbook has been switched off. Nothing was changed.';
export const NO_PROJECT_OPEN_TEXT = 'No project is open. Nothing was changed.';

/** What the host is built on: the parts of the feature context it uses. */
export type CardsHostContext = Pick<
  FeatureContext,
  'app' | 'store' | 'vault' | 'storage' | 'clock' | 'wordCounts' | 'openNote' | 'services'
>;

/** A scene's properties as last seen, with their text for telling a change from none. */
interface Known {
  readonly frontmatter: Readonly<Frontmatter> | null;
  readonly json: string;
}

/** The open project, worked out once for every change of it. */
interface Model {
  readonly project: CardsProject;
  /** The binder tree as text, for telling a change of it from none. */
  readonly treeKey: string;
  /** Every scene of the binder, in order, by its path as the binder spells it. */
  readonly scenes: readonly string[];
  /** Where each scene's note is in the vault; a scene whose note is missing has no entry. */
  readonly vaultPaths: ReadonlyMap<string, string>;
  /** The other way round: the scene a note in the vault is. */
  readonly byVaultPath: ReadonlyMap<string, string>;
  /** The notes whose words are counted while a corkboard is open, as vault paths: the scenes that have a note. */
  readonly counted: readonly string[];
}

/** One screen that is listening. */
interface Listening {
  readonly listener: (change: CardsChange) => void;
  /** True for a screen that shows word counts (a corkboard). */
  readonly counts: boolean;
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

export class StoreCardsHost implements CorkboardHost {
  readonly clock: DragClock;
  /**
   * The same host, as the inspector and the statuses-and-labels window ask
   * it. It differs in one thing: a screen that listens through it shows no
   * word counts, so none are counted on its account.
   */
  readonly forInspector: InspectorHost;

  private readonly context: CardsHostContext;
  private disposed = false;
  private readonly listening = new Set<Listening>();
  /** What stops the host from following the store, the vault and the workspace. */
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
  /** The scene being worked on in the editor, as the binder spells its path. */
  private active: string | null = null;

  /** The scenes each open corkboard shows as cards. */
  private readonly watchers = new Map<object, readonly string[]>();
  private watched = new Set<string>();
  /** The watched scenes that have no synopsis of their own: their text is read. */
  private readonly textWanted = new Set<string>();
  private readonly texts = new Map<string, string | null>();
  private readonly textQueue = new Set<string>();
  /** Scenes that were just saved, each with the function that cancels its timer. */
  private readonly textTimers = new Map<string, () => void>();
  private textInHand: string | null = null;
  private readingTexts = false;
  /** Goes up whenever what is being read is no longer wanted, so that the reading stops. */
  private epoch = 0;
  private stopPause: (() => void) | null = null;

  /** The scenes that changed and have not been reported yet. */
  private readonly pendingScenes = new Set<string>();
  private stopFlush: (() => void) | null = null;
  /** Above zero while several scenes are being changed in a row: they are reported together at the end. */
  private holds = 0;

  /** The card size; null until it was read from the device. */
  private size: CardSize | null = null;

  constructor(context: CardsHostContext) {
    this.context = context;
    this.clock = context.clock;
    const board: StoreCardsHost = this;
    this.forInspector = {
      get ready(): boolean {
        return board.ready;
      },
      get project(): CardsProject | null {
        return board.project;
      },
      get activeScenePath(): string | null {
        return board.activeScenePath;
      },
      clock: this.clock,
      sceneData: (path) => this.sceneData(path),
      sceneProperties: () => this.sceneProperties(),
      onChange: (listener) => this.listen(listener, false),
      applyScenePatch: (path, patch) => this.applyScenePatch(path, patch),
      saveTagList: (change) => this.saveTagList(change),
      // On phones and tablets: the word count line, when the writing progress screen offers one.
      mountSummary: (slot) => mountSceneLine(slot, context.services, context.clock),
      // Who and what is in the scene, when the world-building screen offers it.
      mountEntities: (slot, scenePath) => mountSceneEntities(slot, context.services, context.clock, scenePath),
    };
  }

  // ---------------------------------------------------------------- lifecycle

  /** The plugin is being switched off: stop following everything and forget what was kept. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unfollow();
    // A window that is still open says that there is nothing to work on any more.
    this.emit({ type: 'project' });
    this.listening.clear();
    this.watchers.clear();
    this.watched = new Set();
  }

  get ready(): boolean {
    return !this.disposed;
  }

  onChange(listener: (change: CardsChange) => void): Unsubscribe {
    return this.listen(listener, true);
  }

  private listen(listener: (change: CardsChange) => void, counts: boolean): Unsubscribe {
    if (this.disposed) return () => undefined;
    const entry: Listening = { listener, counts };
    const first = this.listening.size === 0;
    this.listening.add(entry);
    if (first) this.follow();
    if (counts) this.keepCounting();
    return () => {
      if (!this.listening.delete(entry)) return;
      if (this.listening.size === 0) this.unfollow();
      // The last corkboard has closed: its word counts are let go of.
      else if (counts) this.keepCounting();
    };
  }

  /** The first screen is listening: work everything out and keep it up to date from here on. */
  private follow(): void {
    const { app, store, vault, wordCounts } = this.context;
    this.refresh();
    this.active = this.sceneAt(app.workspace.getActiveFile()?.path ?? null);
    const fileOpen = app.workspace.on('file-open', (file) => {
      this.onFileOpen(file);
    });
    this.stops = [
      store.onChange((change) => {
        if (change.type === 'project') this.onProjectChange();
      }),
      vault.on((event) => {
        this.onVaultEvent(event);
      }),
      wordCounts.onChange((paths) => {
        this.onCounts(paths);
      }),
      () => {
        app.workspace.offref(fileOpen);
      },
    ];
    this.weighTexts();
  }

  /** No screen is listening any more: stop following, and keep nothing. */
  private unfollow(): void {
    for (const stop of this.stops.splice(0)) stop();
    this.stopFlush?.();
    this.stopFlush = null;
    this.model = null;
    this.active = null;
    this.forgetScenes();
    this.context.wordCounts.release(WORD_COUNT_ASKER);
  }

  /** Forget everything that was known about the scenes (of the project that was open until now). */
  private forgetScenes(): void {
    this.epoch++;
    this.readingTexts = false;
    this.textInHand = null;
    this.stopPause?.();
    this.stopPause = null;
    for (const cancel of this.textTimers.values()) cancel();
    this.textTimers.clear();
    this.textQueue.clear();
    this.textWanted.clear();
    this.texts.clear();
    this.properties = new Map();
    this.written.clear();
    this.pendingScenes.clear();
  }

  private emit(change: CardsChange): void {
    for (const entry of [...this.listening]) {
      try {
        entry.listener(change);
      } catch (error) {
        // A screen that fails to draw must not stop the others from hearing of the change.
        console.error('Spellbook: a screen could not follow a change', error);
      }
    }
  }

  /**
   * Say that scenes changed. Changes that come in a row (a status renamed in
   * every scene that used it, a batch of word counts) are reported together,
   * a moment later.
   */
  private reportScenes(paths: Iterable<string>): void {
    if (this.listening.size === 0) {
      this.pendingScenes.clear();
      return;
    }
    for (const path of paths) this.pendingScenes.add(path);
    if (this.pendingScenes.size === 0 || this.holds > 0 || this.stopFlush !== null) return;
    this.stopFlush = this.context.clock.setTimer(() => {
      this.stopFlush = null;
      if (this.holds > 0 || this.pendingScenes.size === 0) return;
      const changed = [...this.pendingScenes];
      this.pendingScenes.clear();
      this.emit({ type: 'scenes', paths: changed });
    }, 0);
  }

  // --------------------------------------------------------- the open project

  /**
   * The open project as it is now. While a screen is listening it is kept up
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
    const project: CardsProject =
      last !== null && sameTree && last.project.readOnly === snapshot.readOnly && last.project.lists === lists
        ? last.project
        : {
            id: snapshot.indexPath,
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
    // The cards show the words of scenes, and of nothing else.
    const counted = [...vaultPaths.values()];
    this.model = { project, treeKey, scenes, vaultPaths, byVaultPath, counted };

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
    return changed;
  }

  /** The store says that the open project changed (or was opened, closed or swapped for another). */
  private onProjectChange(): void {
    const before = this.model?.project ?? null;
    const wasActive = this.active;
    const changed = this.refresh();
    this.active = this.sceneAt(this.context.app.workspace.getActiveFile()?.path ?? null);
    this.weighTexts();
    this.keepCounting();
    if ((this.model?.project ?? null) !== before) this.emit({ type: 'project' });
    this.reportScenes(changed);
    if (this.active !== wasActive) this.emit({ type: 'active' });
  }

  get project(): CardsProject | null {
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
        if (this.textWanted.has(path)) this.readTextSoon(path);
        // Off show: what is kept of its text is out of date. It is read when the scene comes back on show.
        else this.texts.delete(path);
        // (Its words are counted again by the word counts themselves.)
        return;
      }
      case 'refresh':
        // The index was filled (again) wholesale: look at everything anew.
        this.written.clear();
        this.onProjectChange();
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
    // With or without a synopsis of its own now: its text may be needed, or no longer.
    this.weighText(path);
    return true;
  }

  // ------------------------------------------------------------ word counts

  private showsCounts(): boolean {
    for (const entry of this.listening) if (entry.counts) return true;
    return false;
  }

  /**
   * Ask for the words of the project's scenes to be counted while a corkboard
   * is open (the scenes on show first), and let go of them when none is. The
   * corkboard asks under its own name: what the binder or the bottom bar ask
   * for, and whether they are open at all, makes no difference to it.
   */
  private keepCounting(): void {
    const { wordCounts } = this.context;
    const model = this.model;
    if (!model || !this.showsCounts()) {
      wordCounts.release(WORD_COUNT_ASKER);
      return;
    }
    const first: string[] = [];
    for (const path of this.watched) {
      const vaultPath = model.vaultPaths.get(path);
      if (vaultPath !== undefined) first.push(vaultPath);
    }
    wordCounts.track(WORD_COUNT_ASKER, [...first, ...model.counted]);
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

  // ------------------------------------------------------------ scene texts

  watchScenes(watcher: object, paths: readonly string[]): void {
    if (this.disposed) return;
    if (paths.length === 0) this.watchers.delete(watcher);
    else this.watchers.set(watcher, [...paths]);
    const watched = new Set<string>();
    for (const shown of this.watchers.values()) for (const path of shown) watched.add(path);
    this.watched = watched;
    if (this.listening.size === 0) return;
    this.weighTexts();
    this.keepCounting();
  }

  /**
   * Decide for one scene whether its text is to be read: it is on show and
   * has no synopsis of its own. A text that was read is kept while the scene
   * is off show (the writer may come back to its folder), for as long as it
   * is still the scene's text and the scene still needs one.
   */
  private weighText(path: string): void {
    const model = this.model;
    const needsText =
      model !== null && model.vaultPaths.has(path) && !hasSynopsis(this.properties.get(path)?.frontmatter);
    if (!needsText) this.texts.delete(path);
    if (needsText && this.watched.has(path)) {
      if (this.textWanted.has(path)) return;
      this.textWanted.add(path);
      if (!this.texts.has(path) && path !== this.textInHand) {
        this.textQueue.add(path);
        this.pumpTexts();
      }
      return;
    }
    if (!this.textWanted.delete(path)) return;
    // It was about to be read again, so what is kept of it is out of date.
    const stale = this.textQueue.delete(path) || this.textTimers.has(path) || this.textInHand === path;
    this.textTimers.get(path)?.();
    this.textTimers.delete(path);
    if (stale) this.texts.delete(path);
  }

  private weighTexts(): void {
    for (const path of new Set([...this.textWanted, ...this.watched, ...this.texts.keys()])) this.weighText(path);
  }

  /** Read a scene's text again once it has stopped being saved for a moment. */
  private readTextSoon(path: string): void {
    this.textTimers.get(path)?.();
    this.textTimers.set(
      path,
      this.context.clock.setTimer(() => {
        this.textTimers.delete(path);
        if (!this.textWanted.has(path)) return;
        this.textQueue.add(path);
        this.pumpTexts();
      }, TEXT_SETTLE_MS),
    );
  }

  private pumpTexts(): void {
    if (this.readingTexts || this.textQueue.size === 0 || this.listening.size === 0) return;
    this.readingTexts = true;
    void this.readTexts(this.epoch);
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
  private async readTexts(epoch: number): Promise<void> {
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
        if (read >= TEXT_SLICE) {
          announce();
          await this.pause();
          if (epoch !== this.epoch) return;
          read = 0;
        }
        const next = this.textQueue.values().next();
        if (next.done === true) break;
        const path = next.value;
        this.textQueue.delete(path);
        const vaultPath = this.model?.vaultPaths.get(path);
        if (vaultPath === undefined || !this.textWanted.has(path)) continue;
        read++;
        this.textInHand = path;
        let text: string | null;
        try {
          text = await this.context.vault.readText(vaultPath);
        } catch {
          // Gone, or not readable: the card shows no preview. It is read again when it is saved.
          text = null;
        }
        if (epoch !== this.epoch) return;
        this.textInHand = null;
        // Saved again, or no longer wanted, while it was being read: what was read is out of date.
        if (this.textQueue.has(path) || !this.textWanted.has(path)) continue;
        if (this.texts.has(path) && this.texts.get(path) === text) continue;
        this.texts.set(path, text);
        fresh.push(path);
      }
    } catch (error) {
      console.error('Spellbook: reading the scenes for the corkboard failed', error);
    } finally {
      if (epoch === this.epoch) {
        this.readingTexts = false;
        this.textInHand = null;
        announce();
      }
    }
  }

  // ----------------------------------------------------------- what is asked

  sceneData(path: string): SceneData | undefined {
    const model = this.look();
    if (!model) return undefined;
    const vaultPath = model.vaultPaths.get(path);
    return {
      frontmatter: this.properties.get(path)?.frontmatter ?? null,
      text: this.texts.get(path),
      // A scene without a note cannot be counted; one that is waiting its turn has no count yet.
      words: vaultPath === undefined ? null : this.context.wordCounts.get(vaultPath),
    };
  }

  sceneProperties(): readonly SceneProperties[] {
    const model = this.look();
    if (!model) return [];
    return model.scenes.map((path) => ({ path, frontmatter: this.properties.get(path)?.frontmatter ?? null }));
  }

  // --------------------------------------------------------- the active scene

  /** The scene of the binder that the note at a vault path is; null when it is none. */
  private sceneAt(vaultPath: string | null): string | null {
    if (vaultPath === null) return null;
    return this.model?.byVaultPath.get(vaultPath) ?? null;
  }

  private onFileOpen(file: TFile | null): void {
    // With no file in front (a graph, say), Obsidian still knows the note
    // that was worked on last: that one stays the active scene.
    const front = file ?? this.context.app.workspace.getActiveFile();
    const active = this.sceneAt(front?.path ?? null);
    if (active === this.active) return;
    this.active = active;
    this.emit({ type: 'active' });
  }

  get activeScenePath(): string | null {
    if (this.listening.size > 0) return this.active;
    if (!this.look()) return null;
    return this.sceneAt(this.context.app.workspace.getActiveFile()?.path ?? null);
  }

  // ---------------------------------------------------------------- card size

  get cardSize(): CardSize {
    if (this.size === null) {
      let stored: unknown = null;
      try {
        stored = this.context.storage.load(CARD_SIZE_KEY);
      } catch (error) {
        console.error('Spellbook: could not read what this device remembers', error);
      }
      this.size = readCardSize(stored);
    }
    return this.size;
  }

  setCardSize(size: CardSize): void {
    const next = readCardSize(size);
    if (next === this.cardSize) return;
    this.size = next;
    try {
      this.context.storage.save(CARD_SIZE_KEY, next);
    } catch (error) {
      // The choice then lasts until Obsidian closes.
      console.error('Spellbook: could not save what this device remembers', error);
    }
    this.emit({ type: 'cardSize' });
  }

  // ------------------------------------------------------------------ changes

  /** The index path of the open project, or the sentence that says why nothing can be changed. */
  private openProject(): { readonly id: string } | string {
    if (this.disposed) return SWITCHED_OFF_TEXT;
    const snapshot = this.context.store.project;
    return snapshot ? { id: snapshot.indexPath } : NO_PROJECT_OPEN_TEXT;
  }

  /**
   * Change one scene's properties in the store's read-change-save step.
   *
   * @param patchFor  works the patch out from the properties as they are on disk at that moment
   * @param inProject the project the change was decided for; refused when another one is open by then
   */
  private async patchScene(
    path: string,
    patchFor: (frontmatter: Readonly<Frontmatter>) => FrontmatterPatch,
    inProject: string,
  ): Promise<IntentResult> {
    const saved: { frontmatter: Frontmatter | null } = { frontmatter: null };
    const result = await this.context.store.updateNoteProperties(
      path,
      (frontmatter) => {
        const changed = applyFrontmatterPatch(frontmatter, patchFor(frontmatter));
        saved.frontmatter = changed ? { ...frontmatter } : null;
        return changed;
      },
      inProject,
    );
    if (result.status === 'done' && saved.frontmatter !== null) this.noteWritten(path, saved.frontmatter);
    return result;
  }

  /**
   * A scene's properties were just saved. The vault's index only catches up
   * a moment later; until it has, what was saved is what the screens are shown.
   */
  private noteWritten(path: string, frontmatter: Frontmatter): void {
    if (this.listening.size === 0 || this.model?.vaultPaths.has(path) !== true) return;
    // The index got there first: nothing to stand in for.
    if (this.properties.get(path)?.json === JSON.stringify(frontmatter)) return;
    const kept = Object.freeze(frontmatter);
    this.written.set(path, kept);
    if (this.know(path, kept)) this.reportScenes([path]);
  }

  async applyScenePatch(path: string, patch: FrontmatterPatch): HostAnswer {
    const open = this.openProject();
    if (typeof open === 'string') return open;
    return answerOf(await this.patchScene(path, () => patch, open.id));
  }

  async saveTagList(change: TagListChange): HostAnswer {
    const open = this.openProject();
    if (typeof open === 'string') return open;
    const { store } = this.context;
    this.holds++;
    try {
      const stored = answerOf(await store.updateProjectData(change.key, () => change.value, open.id));
      if (stored !== null) return stored;

      // A rename: every scene that used the old name gets the new one. Each
      // scene's change is worked out again from the scene as it is on disk at
      // the moment it is written, so that nothing else in it is undone.
      const rename = change.rename;
      const problems: Array<{ path: string; message: string }> = [];
      for (const { path, patch } of change.scenePatches) {
        const result = await this.patchScene(
          path,
          (frontmatter) =>
            rename ? renameTagInScene(change.kind, frontmatter, rename.from, rename.to) : patch,
          open.id,
        );
        const message = answerOf(result);
        if (message !== null) problems.push({ path, message });
      }
      const [first] = problems;
      if (first === undefined) return null;
      return problems.length === 1
        ? `The list was saved, but "${noteTitle(first.path)}" could not be changed: ${first.message}`
        : `The list was saved, but ${problems.length} scenes could not be changed. The first problem: ${first.message}`;
    } finally {
      this.holds--;
      this.reportScenes([]);
    }
  }

  async moveCard(move: CardMove): HostAnswer {
    const open = this.openProject();
    if (typeof open === 'string') return open;
    return answerOf(await this.context.store.moveNode(move.ref, move.placement, open.id));
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
