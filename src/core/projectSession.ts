// Keeps a project open, so that the views always have something to show.
//
// Which project? The one the writer last chose on this device, when it is in
// the vault. Otherwise the first one in the list, as a stand-in: the choice
// itself is kept, because the chosen project may simply not have arrived yet
// (the vault is still loading, or iCloud is still bringing it down). When it
// turns up, it is opened in place of the stand-in.
//
// A choice is only ever recorded for something the writer did: picking a
// project in the binder, or creating one. Opening a project reads its index
// note and writes nothing.

import type { DevicePrefs } from './devicePrefs';
import type { ProjectStore } from './projectStore';
import type { IntentResult, ProjectSnapshot, StoreChange } from './types';

export class ProjectSession {
  private readonly store: ProjectStore;
  private readonly prefs: DevicePrefs;
  private readonly listeners = new Set<() => void>();

  private stopListening: (() => void) | null = null;
  private disposed = false;
  /** How many projects this session is opening itself at the moment (normally none or one). */
  private opening = 0;
  /** The index path of the project that was open when the store last reported. */
  private lastOpen: string | null = null;
  /** Projects that could not be opened, with the reason; forgotten when the list of projects changes. */
  private readonly unopenable = new Map<string, string>();

  constructor(store: ProjectStore, prefs: DevicePrefs) {
    this.store = store;
    this.prefs = prefs;
  }

  /** Begin following the store, and open a project if there is one. */
  start(): void {
    if (this.stopListening || this.disposed) return;
    this.lastOpen = this.store.project?.indexPath ?? null;
    this.stopListening = this.store.onChange((change) => this.onStoreChange(change));
    this.ensure();
  }

  dispose(): void {
    this.disposed = true;
    this.stopListening?.();
    this.stopListening = null;
    this.listeners.clear();
  }

  /**
   * Why no project is open although the vault has some: the reason the last
   * one could not be opened. Null when all is well.
   */
  get problem(): string | null {
    if (this.store.project !== null) return null;
    for (const reason of this.unopenable.values()) return reason;
    return null;
  }

  /** Be told when `problem` changes. Returns a function that stops it. */
  onProblem(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Open the project the writer picked, and remember the choice on this device. */
  async choose(indexPath: string): Promise<IntentResult<ProjectSnapshot>> {
    const result = await this.open(indexPath);
    if (result.status === 'done' && !this.disposed) this.prefs.setActiveProject(indexPath);
    this.ensure();
    return result;
  }

  /**
   * Record a project as the writer's choice without opening it here: used
   * after a project was created, which opens it as part of creating it.
   */
  remember(indexPath: string): void {
    if (this.disposed) return;
    this.prefs.setActiveProject(indexPath);
    this.ensure();
  }

  // ---------------------------------------------------------------- internals

  private onStoreChange(change: StoreChange): void {
    if (this.disposed) return;
    if (change.type === 'projects') {
      // The list changed: a project that could not be opened may be fine now.
      if (this.unopenable.size > 0) {
        this.unopenable.clear();
        this.announce();
      }
    } else {
      // The open project was renamed or moved: what this device remembers as
      // folded shut in it goes along to its new path.
      const now = this.store.project?.indexPath;
      if (change.movedFrom !== undefined && now !== undefined) this.prefs.moveCollapsed(change.movedFrom, now);
      this.followOpenProject();
    }
    this.ensure();
  }

  /**
   * The open project changed. If that was not this session's doing and it is
   * now at another path, its index note was renamed or moved (or a project
   * that was just created took its place): a choice that pointed at the old
   * path follows it.
   */
  private followOpenProject(): void {
    const now = this.store.project?.indexPath ?? null;
    const before = this.lastOpen;
    this.lastOpen = now;
    if (this.opening > 0 || now === null || before === null || now === before) return;
    if (this.prefs.getActiveProject() === before) this.prefs.setActiveProject(now);
  }

  /** Make sure the right project is open, if the vault has one. */
  private ensure(): void {
    if (this.disposed || this.opening > 0) return;
    const openable = this.store
      .listProjects()
      .map((project) => project.indexPath)
      .filter((indexPath) => !this.unopenable.has(indexPath));
    const open = this.store.project?.indexPath ?? null;
    // A choice that points at what has turned out to be a conflicting copy of
    // a project's index stands for that project.
    const remembered = this.prefs.getActiveProject();
    const chosen = remembered === null ? null : (this.store.mainIndexOf(remembered) ?? remembered);
    const chosenIsThere = chosen !== null && openable.includes(chosen);

    let target: string | null = null;
    if (chosenIsThere) {
      if (chosen !== open) target = chosen;
    } else if (open === null) {
      target = openable[0] ?? null;
    } else {
      // The open "project" is such a copy (its original arrived later, by
      // sync): move over to the project itself, which then reports the copy.
      const main = this.store.mainIndexOf(open);
      if (main !== null && openable.includes(main)) target = main;
    }
    if (target === null) return;

    void this.open(target).then((result) => {
      if (this.disposed) return;
      if (result.status !== 'done') {
        this.unopenable.set(target, result.message);
        this.announce();
      }
      this.ensure();
    });
  }

  private async open(indexPath: string): Promise<IntentResult<ProjectSnapshot>> {
    this.opening++;
    try {
      return await this.store.openProject(indexPath);
    } catch (error) {
      return { status: 'failed', message: error instanceof Error ? error.message : String(error) };
    } finally {
      this.opening--;
    }
  }

  private announce(): void {
    for (const listener of [...this.listeners]) {
      try {
        listener();
      } catch (error) {
        console.error('Spellbook: a listener failed', error);
      }
    }
  }
}
