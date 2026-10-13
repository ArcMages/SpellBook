// Automatic snapshots: with the setting on, the first time a scene's text
// changes on a day, the scene as it was before that change is saved as a
// snapshot. Off unless the writer switches it on.
//
// How "as it was before" is known: when a scene comes to the front, its text
// is read and remembered. Each time the scene is saved, the remembered text
// is the text of the save before, which is what the snapshot is made of; the
// newly saved text is remembered in its place. Nothing is read from the
// editor and nothing is drawn, so the line being typed is never disturbed.
// The scene's own note is not written to while it is in front either: a
// scene that needs an id for its snapshots gets it once the writer has moved
// on to another note (see SnapshotKeeper.writeIds).
//
// Nothing is followed while the setting is off.

import type { App, EventRef, Plugin } from 'obsidian';
import { splitNote } from '../../core/snapshots';
import type { FeatureContext } from '../registry';
import type { KeeperChange, SnapshotKeeper } from './keeper';
import type { SnapshotPrefs } from './prefs';

/** How many scenes' texts are remembered at once. */
const REMEMBERED = 20;

export class AutomaticSnapshots {
  private readonly context: FeatureContext;
  private readonly app: App;
  private readonly plugin: Plugin;
  private readonly keeper: SnapshotKeeper;
  private readonly prefs: SnapshotPrefs;

  private stops: Array<() => void> = [];
  private stopPrefs: (() => void) | null = null;
  private released = false;

  /** The text of scenes as last saved, by vault path; the oldest is forgotten first. */
  private readonly remembered = new Map<string, string>();
  /** The day (YYYY-MM-DD) an automatic snapshot of a scene was last taken or found, by vault path. */
  private readonly doneOn = new Map<string, string>();
  /** The text a restore is about to give a scene, by vault path: that save is not an edit. */
  private readonly restoring = new Map<string, string>();
  /** What is being worked on, one save after the other. */
  private tail: Promise<void> = Promise.resolve();

  constructor(context: FeatureContext, keeper: SnapshotKeeper, prefs: SnapshotPrefs) {
    this.context = context;
    this.app = context.app;
    this.plugin = context.plugin;
    this.keeper = keeper;
    this.prefs = prefs;
  }

  /** Follow the setting: start when it is on, stop when it is off. */
  start(): void {
    this.stopPrefs = this.prefs.onChange(() => {
      this.follow();
    });
    this.follow();
  }

  /** The plugin is being switched off. */
  release(): void {
    this.released = true;
    this.stopPrefs?.();
    this.stopPrefs = null;
    this.unfollow();
  }

  /** Resolves when every save seen so far has been dealt with. For tests. */
  idle(): Promise<void> {
    return this.tail;
  }

  private follow(): void {
    const wanted = !this.released && this.prefs.automatic;
    if (!wanted) {
      this.unfollow();
      return;
    }
    if (this.stops.length > 0) return;
    const { workspace } = this.app;
    const ref: EventRef = workspace.on('file-open', (file) => {
      this.lookAt(file?.path ?? null);
    });
    // Through the plugin as well, so that Obsidian takes it away on unload whatever happens.
    this.plugin.registerEvent(ref);
    this.stops.push(
      () => {
        workspace.offref(ref);
      },
      this.keeper.onChange((change) => {
        this.onChange(change);
      }),
    );
    this.lookAt(workspace.getActiveFile()?.path ?? null);
  }

  private unfollow(): void {
    for (const stop of this.stops.splice(0)) stop();
    this.remembered.clear();
    this.restoring.clear();
  }

  private queue(job: () => Promise<void>): void {
    this.tail = this.tail.then(job).catch((error: unknown) => {
      console.error('Spellbook: an automatic snapshot could not be taken', error);
    });
  }

  /** A note came to the front: remember its text if it is a scene, and finish what was held back for the others. */
  private lookAt(vaultPath: string | null): void {
    this.queue(async () => {
      if (this.stops.length === 0) return;
      await this.keeper.writeIds(vaultPath);
      if (vaultPath === null || this.remembered.has(vaultPath) || !this.keeper.sceneAt(vaultPath)) return;
      let text: string;
      try {
        text = await this.context.vault.readText(vaultPath);
      } catch {
        return;
      }
      if (!this.remembered.has(vaultPath)) this.remember(vaultPath, text);
    });
  }

  private remember(vaultPath: string, text: string): void {
    this.remembered.delete(vaultPath);
    this.remembered.set(vaultPath, text);
    while (this.remembered.size > REMEMBERED) {
      const oldest = this.remembered.keys().next().value;
      if (oldest === undefined) break;
      this.remembered.delete(oldest);
    }
  }

  private onChange(change: KeeperChange): void {
    switch (change.type) {
      case 'restoring':
        this.restoring.set(change.vaultPath, change.text);
        return;
      case 'text':
        if (this.remembered.has(change.vaultPath)) this.saved(change.vaultPath);
        return;
      case 'renamed':
      case 'project':
        // Remembered by path: a note that moved, or another project, starts afresh.
        this.remembered.clear();
        this.restoring.clear();
        this.lookAt(this.app.workspace.getActiveFile()?.path ?? null);
        return;
      default:
        return;
    }
  }

  /** A remembered scene was saved. */
  private saved(vaultPath: string): void {
    this.queue(async () => {
      const before = this.remembered.get(vaultPath);
      const scene = this.keeper.sceneAt(vaultPath);
      if (before === undefined || !scene || this.stops.length === 0) return;
      let now: string;
      try {
        now = await this.context.vault.readText(vaultPath);
      } catch {
        return;
      }
      this.remember(vaultPath, now);
      const restored = this.restoring.get(vaultPath);
      this.restoring.delete(vaultPath);
      // A restore is not an edit (and it has saved the text before it already).
      if (restored === now) return;
      // A change of the properties alone (a status, the binder's order) is not an edit of the text.
      if (splitNote(before).body === splitNote(now).body) return;

      const today = this.context.clock.today();
      if (this.doneOn.get(vaultPath) === today) return;
      this.doneOn.set(vaultPath, today);
      if (this.keeper.list(scene.path).some((info) => info.automatic && info.taken.startsWith(today))) return;
      const taken = await this.keeper.take(scene.path, { automatic: true, text: before });
      if (!taken.ok) {
        console.error(`Spellbook: an automatic snapshot could not be taken: ${taken.message}`);
        this.doneOn.delete(vaultPath);
        return;
      }
      await this.keeper.prune(scene.path, this.prefs.keep);
    });
  }
}
