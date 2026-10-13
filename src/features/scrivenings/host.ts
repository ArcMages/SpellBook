// The plugin's side of the continuous manuscript: what the pane asks, on top
// of the project store, the vault doorway, the shared word counts and the
// workspace.
//
// It answers:
//   - which scenes a scope stands for (the whole manuscript, or one folder
//     of the binder), in manuscript order;
//   - the text of one scene, read through the vault doorway when the pane
//     is about to draw it, and never before;
//   - that something changed (the binder, the text of a note, a note's name,
//     a word count), so that the pane can bring just that scene up to date;
//   - what this device remembers: the scope and how far the writer had read.
//
// It follows the store, the vault and the word counts only while a pane is
// listening, and it only ever reads: the continuous manuscript changes
// nothing in the vault. Editing is done in Obsidian's own editor, which the
// host opens on the scene (and the line) that was tapped.

import { Notice } from 'obsidian';
import type { PaneType } from 'obsidian';
import { noteTitle } from '../../core/paths';
import { foldersOf, scenesUnder } from '../../core/report';
import type { ScopeFolder } from '../../core/report';
import { DEFAULT_VIEW, moveRemembered, readMemory, remember, scenesOfScope, writeMemory } from '../../core/scrivenings';
import type { RememberedView, ScriveningsScope } from '../../core/scrivenings';
import { MISSING_LABEL } from '../../ui/missingNote';
import type { FeatureContext } from '../registry';
import { followLink, showLine } from './drawing';
import type { SceneDrawer, Undraw } from './drawing';

/** The name the continuous manuscript asks the shared word counts under. No other asker uses it. */
export const WORD_COUNT_ASKER = 'scrivenings';

/** Where the scope and the place of each project are kept in the device's own storage. */
export const MEMORY_KEY = 'spellbook-scrivenings';

/** What the host is built on: the parts of the feature context it uses. */
export type ScriveningsHostContext = Pick<FeatureContext, 'app' | 'store' | 'vault' | 'storage' | 'clock' | 'wordCounts' | 'openNote'>;

/** What a pane is told. It then asks the host again. */
export type ScriveningsChange =
  /** The binder changed, or the project was opened, closed or swapped for another. */
  | {
      readonly type: 'project';
      /** Set when the open project is the one that was open before, at another path: the index path it had until now. */
      readonly movedFrom?: string;
    }
  /** The text of a note changed on disk. */
  | { readonly type: 'note'; readonly vaultPath: string }
  /** A note has another name or place. It comes with, before or after the binder's own change. */
  | { readonly type: 'renamed'; readonly from: string; readonly to: string }
  /** These notes have a new word count. */
  | { readonly type: 'counts'; readonly vaultPaths: readonly string[] };

/** A scene of the scope on show. */
export interface HostScene {
  /** Path relative to the project folder; the scene's identity. */
  readonly path: string;
  readonly title: string;
  /** Where the scene's note is in the vault; null when the binder lists it but the note is not there. */
  readonly vaultPath: string | null;
}

/** What a scope comes to as the binder is now. */
export type ScopeScenes =
  | { readonly kind: 'no-project' }
  /** The folder is no longer in the binder. */
  | { readonly kind: 'no-folder' }
  | { readonly kind: 'scenes'; readonly scenes: readonly HostScene[] };

export class ScriveningsHost {
  private readonly context: ScriveningsHostContext;
  private readonly drawer: SceneDrawer;
  private disposed = false;
  private readonly listening = new Set<(change: ScriveningsChange) => void>();
  /** What stops the host from following the store, the vault and the word counts. */
  private stops: Array<() => void> = [];
  /** What the device remembers; null until it has been read from the storage. */
  private memory: Map<string, RememberedView> | null = null;

  constructor(context: ScriveningsHostContext, drawer: SceneDrawer) {
    this.context = context;
    this.drawer = drawer;
  }

  // ---------------------------------------------------------------- lifecycle

  /** The plugin is being switched off: stop following everything. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unfollow();
    // A pane that is still open says that there is nothing to show any more.
    this.emit({ type: 'project' });
    this.listening.clear();
  }

  get ready(): boolean {
    return !this.disposed;
  }

  /** How many panes are listening. */
  get listenerCount(): number {
    return this.listening.size;
  }

  onChange(listener: (change: ScriveningsChange) => void): () => void {
    if (this.disposed) return () => undefined;
    const first = this.listening.size === 0;
    this.listening.add(listener);
    if (first) this.follow();
    return () => {
      if (!this.listening.delete(listener)) return;
      if (this.listening.size === 0) this.unfollow();
    };
  }

  private follow(): void {
    const { store, vault, wordCounts } = this.context;
    this.stops = [
      store.onChange((change) => {
        if (change.type !== 'project') return;
        if (change.movedFrom !== undefined) this.projectMoved(change.movedFrom);
        this.wantCounts();
        this.emit(change.movedFrom === undefined ? { type: 'project' } : { type: 'project', movedFrom: change.movedFrom });
      }),
      vault.on((event) => {
        if (event.type === 'modify') this.emit({ type: 'note', vaultPath: event.path });
        else if (event.type === 'rename' && !event.folder) this.emit({ type: 'renamed', from: event.oldPath, to: event.path });
        // The index was filled (again) wholesale: the binder may be another one.
        else if (event.type === 'refresh') this.emit({ type: 'project' });
      }),
      wordCounts.onChange((vaultPaths) => {
        this.emit({ type: 'counts', vaultPaths });
      }),
      () => {
        wordCounts.release(WORD_COUNT_ASKER);
      },
    ];
    this.wantCounts();
  }

  private unfollow(): void {
    for (const stop of this.stops.splice(0)) stop();
  }

  /** Ask for the word counts of every scene of the manuscript, in manuscript order. */
  private wantCounts(): void {
    const { store, wordCounts } = this.context;
    const project = store.project;
    const wanted: string[] = [];
    for (const scene of project ? scenesUnder(project.tree) : []) {
      const vaultPath = scene.missing ? null : store.vaultPathOf(scene.path);
      if (vaultPath !== null) wanted.push(vaultPath);
    }
    wordCounts.track(WORD_COUNT_ASKER, wanted);
  }

  private emit(change: ScriveningsChange): void {
    for (const listener of [...this.listening]) {
      try {
        listener(change);
      } catch (error) {
        // A pane that fails to draw must not stop the others from hearing of the change.
        console.error('Spellbook: the continuous manuscript could not follow a change', error);
      }
    }
  }

  // ----------------------------------------------------------- what is asked

  /** The vault path of the open project's index note: what a project is remembered by. Null when none is open. */
  get projectKey(): string | null {
    if (this.disposed) return null;
    return this.context.store.project?.indexPath ?? null;
  }

  /** The folders of the open project's binder, top to bottom. */
  folders(): ScopeFolder[] {
    if (this.disposed) return [];
    const project = this.context.store.project;
    return project ? foldersOf(project.tree) : [];
  }

  /** The scenes a scope stands for as the binder is now, in manuscript order. */
  scenesOf(scope: ScriveningsScope): ScopeScenes {
    const project = this.disposed ? null : this.context.store.project;
    if (!project) return { kind: 'no-project' };
    const listed = scenesOfScope(project.tree, scope);
    if (listed === null) return { kind: 'no-folder' };
    const { store } = this.context;
    return {
      kind: 'scenes',
      scenes: listed.map((scene) => ({
        path: scene.path,
        title: scene.title,
        vaultPath: scene.missing ? null : store.vaultPathOf(scene.path),
      })),
    };
  }

  /** The words of a note: a number once counted, null when it cannot be read, undefined while it waits. */
  wordsOf(vaultPath: string): number | null | undefined {
    return this.context.wordCounts.get(vaultPath);
  }

  /** The whole text of a scene's note, as it is on disk now. */
  read(vaultPath: string): Promise<string> {
    return this.context.vault.readText(vaultPath);
  }

  /** Draw a scene's text (without its properties block) into an empty element. */
  draw(body: string, el: HTMLElement, sourcePath: string): Promise<Undraw> {
    return this.drawer.draw(body, el, sourcePath);
  }

  /** Call `callback` once, just before the screen is next drawn. Returns a function that cancels it. */
  nextFrame(callback: () => void): () => void {
    return this.context.clock.nextFrame(() => {
      callback();
    });
  }

  /** Call `callback` once after `ms` milliseconds. Returns a function that cancels it. */
  later(callback: () => void, ms: number): () => void {
    return this.context.clock.setTimer(callback, ms);
  }

  // ------------------------------------------------------------- the editor

  /**
   * Open a scene's note in Obsidian's editor.
   *
   * @param path  the scene, as the binder spells its path
   * @param where false: in the tab the writer was last working in; true or 'tab': a new tab; and so on
   * @param line  the line of the note to put the cursor on, counted from 0; null for wherever Obsidian puts it
   */
  async openScene(path: string, where: PaneType | boolean, line: number | null = null): Promise<void> {
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
    if (!shown) {
      new Notice(`"${title}" could not be opened.`);
      return;
    }
    if (line !== null && !this.disposed) showLine(this.context.app, vaultPath, line);
  }

  /** Open what a link in a scene points at. */
  async openLink(link: string, sourcePath: string, where: PaneType | boolean): Promise<void> {
    if (this.disposed) return;
    await followLink(this.context.app, link, sourcePath, where);
  }

  // ------------------------------------------------- what the device remembers

  private remembered(): Map<string, RememberedView> {
    if (this.memory === null) {
      try {
        this.memory = readMemory(this.context.storage.load(MEMORY_KEY));
      } catch (error) {
        console.error('Spellbook: what this device remembers of the continuous manuscript could not be read', error);
        this.memory = new Map();
      }
    }
    return this.memory;
  }

  private saveMemory(memory: Map<string, RememberedView>): void {
    const before = this.memory === null ? null : writeMemory(this.memory);
    this.memory = memory;
    const text = writeMemory(memory);
    if (text === before) return;
    try {
      this.context.storage.save(MEMORY_KEY, text);
    } catch (error) {
      // It then lasts until Obsidian closes.
      console.error('Spellbook: the place in the continuous manuscript could not be saved on this device', error);
    }
  }

  /** The scope and the place this device remembers for the open project. */
  recall(): RememberedView {
    const key = this.projectKey;
    return (key === null ? undefined : this.remembered().get(key)) ?? DEFAULT_VIEW;
  }

  /** Remember the scope and the place for the open project, on this device. */
  keep(view: RememberedView): void {
    const key = this.projectKey;
    if (key === null) return;
    this.saveMemory(remember(this.remembered(), key, view));
  }

  private projectMoved(from: string): void {
    const key = this.projectKey;
    if (key === null || !this.remembered().has(from)) return;
    this.saveMemory(moveRemembered(this.remembered(), from, key));
  }
}
