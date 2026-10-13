// The plugin's side of the writing report: what the pane asks, on top of the
// project store, the vault doorway and the workspace.
//
// It answers three things:
//   - what a report can be about (the open project, its folders, the scene
//     that is open);
//   - the figures of a scope: it reads the scenes through the vault doorway,
//     a few at a time, and lets the screen draw and answer taps in between,
//     so that a manuscript of a hundred scenes does not freeze a phone;
//   - that something changed since (a scene was saved, another note was
//     opened), so that the pane can say that its figures are out of date.
//     Nothing is read again until the writer asks.
//
// It follows the store, the vault and the workspace only while a pane is
// listening, and it only ever reads: the report changes nothing in the vault.

import { addStats, analyzeText, emptyStats, foldersOf, resolveScope, scenesUnder } from '../../core/report';
import type { ReportScope, ScopeFolder, TextStats } from '../../core/report';
import { pathKey } from '../../core/paths';
import type { FeatureContext } from '../registry';
import type { ReportPrefs } from './settings';

/** At most this many scenes are read in one go before the screen is given a moment. */
export const READ_BATCH = 5;
/** And no go lasts longer than this, in milliseconds, however few scenes it took. */
export const READ_SLICE_MS = 30;

/** What the host is built on: the parts of the feature context it uses. */
export type ReportHostContext = Pick<FeatureContext, 'app' | 'store' | 'vault' | 'clock'>;

/** What a pane is told. It then asks the host again. */
export type ReportChange =
  /** The project changed, or was opened, closed or swapped for another. */
  | { readonly type: 'project' }
  /** The text of a note changed on disk. */
  | { readonly type: 'note'; readonly vaultPath: string }
  /** Another note came to the front (or none). */
  | { readonly type: 'front' }
  /** The words on a page were changed. */
  | { readonly type: 'settings' };

/** What a finished report is about. */
export type ReportSubject =
  | { readonly kind: 'scene'; readonly title: string; readonly path: string }
  | { readonly kind: 'folder'; readonly title: string }
  | { readonly kind: 'manuscript'; readonly title: string };

/** How a request for figures ended. */
export type ReportOutcome =
  | { readonly kind: 'no-project' }
  /** The note that is open is not a scene of the binder (or no note is open). */
  | { readonly kind: 'no-scene' }
  /** The folder is no longer in the binder. */
  | { readonly kind: 'no-folder' }
  | {
      readonly kind: 'done';
      readonly subject: ReportSubject;
      /** How many scenes were read. */
      readonly scenes: number;
      /** The titles of the scenes that could not be read (their note is missing, or the read failed). */
      readonly unread: readonly string[];
      readonly stats: TextStats;
      /** The notes the figures were worked out from, as vault paths. */
      readonly notes: ReadonlySet<string>;
    };

export class ReportHost {
  private readonly context: ReportHostContext;
  private readonly prefs: ReportPrefs;
  private disposed = false;
  private readonly listening = new Set<(change: ReportChange) => void>();
  /** What stops the host from following the store, the vault, the workspace and the settings. */
  private stops: Array<() => void> = [];
  /** The pauses that are on, each with the function that ends it at once. */
  private readonly pauses = new Set<() => void>();

  constructor(context: ReportHostContext, prefs: ReportPrefs) {
    this.context = context;
    this.prefs = prefs;
  }

  // ---------------------------------------------------------------- lifecycle

  /** The plugin is being switched off: stop following everything, and end whatever is being read. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unfollow();
    for (const end of [...this.pauses]) end();
    // A pane that is still open says that there is nothing to report on any more.
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

  onChange(listener: (change: ReportChange) => void): () => void {
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
    const { app, store, vault } = this.context;
    const fileOpen = app.workspace.on('file-open', () => {
      this.emit({ type: 'front' });
    });
    this.stops = [
      store.onChange((change) => {
        if (change.type === 'project') this.emit({ type: 'project' });
      }),
      vault.on((event) => {
        if (event.type === 'modify') this.emit({ type: 'note', vaultPath: event.path });
        // The index was filled (again) wholesale: the binder may be another one.
        else if (event.type === 'refresh') this.emit({ type: 'project' });
      }),
      this.prefs.onChange(() => {
        this.emit({ type: 'settings' });
      }),
      () => {
        app.workspace.offref(fileOpen);
      },
    ];
  }

  private unfollow(): void {
    for (const stop of this.stops.splice(0)) stop();
  }

  private emit(change: ReportChange): void {
    for (const listener of [...this.listening]) {
      try {
        listener(change);
      } catch (error) {
        // A pane that fails to draw must not stop the others from hearing of the change.
        console.error('Spellbook: the writing report could not follow a change', error);
      }
    }
  }

  // ----------------------------------------------------------- what is asked

  /** How many words go on a page: the writer's choice on this device. */
  get wordsPerPage(): number {
    return this.prefs.wordsPerPage;
  }

  /** Every pane that is open is told, and draws its pages anew. */
  setWordsPerPage(value: number): void {
    if (this.disposed) return;
    this.prefs.wordsPerPage = value;
  }

  /** The name of the open project (the writer's own text), or null when none is open. */
  get projectTitle(): string | null {
    if (this.disposed) return null;
    return this.context.store.project?.title ?? null;
  }

  /** The folders of the open project's binder, top to bottom. */
  folders(): ScopeFolder[] {
    if (this.disposed) return [];
    const project = this.context.store.project;
    return project ? foldersOf(project.tree) : [];
  }

  /**
   * The scene that is open, as the binder spells its path. Null when no note
   * is open, or the open note is not a scene of the open project.
   */
  openScene(): string | null {
    if (this.disposed) return null;
    const { app, store } = this.context;
    const project = store.project;
    const front = app.workspace.getActiveFile()?.path;
    if (!project || front === undefined) return null;
    const wanted = pathKey(front);
    for (const scene of scenesUnder(project.tree)) {
      if (scene.missing) continue;
      const vaultPath = store.vaultPathOf(scene.path);
      if (vaultPath !== null && pathKey(vaultPath) === wanted) return scene.path;
    }
    return null;
  }

  /**
   * The notes a scope stands for as the binder is now, as vault paths. Null
   * when no project is open, or the scope is not there (its folder is gone,
   * the open note is not a scene).
   */
  notesOf(scope: ReportScope): string[] | null {
    if (this.disposed) return null;
    const { store } = this.context;
    const project = store.project;
    if (!project) return null;
    const found = resolveScope(project.tree, scope, scope.kind === 'scene' ? this.openScene() : null);
    if (found.kind === 'no-scene' || found.kind === 'no-folder') return null;
    const notes: string[] = [];
    for (const scene of found.scenes) {
      const vaultPath = scene.missing ? null : store.vaultPathOf(scene.path);
      if (vaultPath !== null) notes.push(vaultPath);
    }
    return notes;
  }

  // ------------------------------------------------------------- the figures

  /** Let Obsidian draw and answer taps before going on. Ends at once when the plugin is switched off. */
  private pause(): Promise<void> {
    return new Promise((resolve) => {
      let cancel: () => void = () => undefined;
      const end = (): void => {
        if (!this.pauses.delete(end)) return;
        cancel();
        resolve();
      };
      this.pauses.add(end);
      cancel = this.context.clock.setTimer(end, 0);
    });
  }

  /**
   * Work out the figures of a scope, as the binder and the notes are now.
   *
   * @param progress told, before each pause, how many scenes were read out of how many
   * @param wanted   asked after every wait: when it says no, the reading stops and null is the answer
   * @returns the outcome, or null when the reading was stopped
   */
  async measure(
    scope: ReportScope,
    progress: (done: number, total: number) => void,
    wanted: () => boolean,
  ): Promise<ReportOutcome | null> {
    if (this.disposed) return null;
    const { clock, store, vault } = this.context;
    const project = store.project;
    if (!project) return { kind: 'no-project' };
    const found = resolveScope(project.tree, scope, scope.kind === 'scene' ? this.openScene() : null);
    if (found.kind === 'no-scene' || found.kind === 'no-folder') return { kind: found.kind };

    const subject: ReportSubject =
      found.kind === 'scene'
        ? { kind: 'scene', title: found.title, path: found.scenes[0]?.path ?? '' }
        : found.kind === 'folder'
          ? { kind: 'folder', title: found.title }
          : { kind: 'manuscript', title: project.title };

    const stats = emptyStats();
    const unread: string[] = [];
    const notes = new Set<string>();
    const total = found.scenes.length;
    let read = 0;
    let inThisGo = 0;
    let goStarted = clock.now();
    for (const [at, scene] of found.scenes.entries()) {
      if (inThisGo >= READ_BATCH || (inThisGo > 0 && clock.now() - goStarted >= READ_SLICE_MS)) {
        progress(at, total);
        await this.pause();
        if (this.disposed || !wanted()) return null;
        inThisGo = 0;
        goStarted = clock.now();
      }
      inThisGo++;
      const vaultPath = scene.missing ? null : store.vaultPathOf(scene.path);
      if (vaultPath === null) {
        unread.push(scene.title);
        continue;
      }
      let text: string;
      try {
        text = await vault.readText(vaultPath);
      } catch {
        // Gone, or not readable: the report says so and goes on with the rest.
        if (this.disposed || !wanted()) return null;
        unread.push(scene.title);
        continue;
      }
      if (this.disposed || !wanted()) return null;
      addStats(stats, analyzeText(text));
      notes.add(vaultPath);
      read++;
    }
    return { kind: 'done', subject, scenes: read, unread, stats, notes };
  }
}
