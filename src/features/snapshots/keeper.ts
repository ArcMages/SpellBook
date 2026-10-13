// The snapshot keeper: everything the snapshots do, between the screens and
// the project store.
//
// It reads through the vault doorway (the scene's text, a snapshot's text)
// and the store (which notes the project has), and it writes through the
// store only:
//   - a new snapshot           store.createSnapshotNote
//   - a snapshot to the trash  store.trashSnapshotNote
//   - a scene's id             store.updateNoteProperties (a property; the text is not touched)
//   - a restored scene         store.replaceSceneText
//
// Restoring is the one thing in the plugin that replaces what the writer
// wrote, so it goes carefully (see restore below): the text as it is now is
// saved as a snapshot of its own first, and the scene is only replaced if it
// still is, at the moment of writing, the text that was saved.

import type { App } from 'obsidian';
import { isInside, noteTitle, parentPath, pathKey, relativeTo } from '../../core/paths';
import { SNAPSHOTS_FOLDER } from '../../core/projectLayout';
import {
  SCENE_ID_KEY,
  automaticToRemove,
  belongsTo,
  newSceneId,
  readSnapshotInfo,
  readSnapshotText,
  restoredText,
  sceneIdOf,
  shownDate,
  shownName,
  snapshotBody,
  snapshotFileName,
  snapshotFolderName,
  snapshotFrontmatter,
  snapshotsOf,
  splitNote,
  tidySnapshotName,
} from '../../core/snapshots';
import type { SceneRef, SnapshotInfo, SnapshotText } from '../../core/snapshots';
import type { Frontmatter, TreeNode } from '../../core/types';
import type { VaultEvent } from '../../core/vaultPort';
import { countWords } from '../../core/wordCount';
import type { FeatureContext } from '../registry';
import { localMoment } from './time';

export const NO_PROJECT_TEXT = 'No Spellbook project is open.';
export const NO_SCENE_TEXT = 'Open a scene of the project first: a snapshot is a saved version of one scene.';
export const SCENE_GONE_TEXT = 'That scene is no longer in the project.';
export const SNAPSHOT_GONE_TEXT = 'That snapshot is no longer in the project.';
export const SAME_TEXT = 'The scene already reads exactly as this snapshot does. Nothing was changed.';
export const KEPT_CHANGING_TEXT =
  'The scene kept changing while it was being restored (it may be syncing, or being typed in), so nothing was replaced. Try again in a moment.';

/** How many times a restore starts over when the scene changes under it. */
const RESTORE_TRIES = 3;

/** A scene of the open project. */
export interface SceneAt {
  /** Path relative to the project folder. */
  readonly path: string;
  readonly title: string;
}

/** How something the keeper was asked to do ended. */
export type Outcome<T = undefined> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly message: string };

/** What the keeper tells those who follow it. */
export type KeeperChange =
  /** The open project changed, or another one was opened. */
  | { readonly type: 'project' }
  /** A snapshot was added, removed or indexed. */
  | { readonly type: 'snapshots' }
  /** A note of the project was saved. */
  | { readonly type: 'text'; readonly vaultPath: string }
  /** A note of the project was renamed or moved (paths relative to the project folder). */
  | { readonly type: 'renamed'; readonly from: string; readonly to: string }
  /** A scene is about to be given this text by a restore. */
  | { readonly type: 'restoring'; readonly vaultPath: string; readonly text: string };

export interface TakeOptions {
  /** The name the writer gave; empty for none. */
  readonly name?: string;
  /** True for a snapshot the plugin takes by itself. */
  readonly automatic?: boolean;
  /**
   * The scene's whole text, when it is not what is on disk now (an automatic
   * snapshot holds the text as it was before the edit). Default: the scene
   * is read.
   */
  readonly text?: string;
}

const fail = (message: string): { ok: false; message: string } => ({ ok: false, message });
const ok = <T>(value: T): { ok: true; value: T } => ({ ok: true, value });

function scenesOf(tree: readonly TreeNode[], into: SceneAt[] = []): SceneAt[] {
  for (const node of tree) {
    if (node.kind === 'folder') scenesOf(node.children, into);
    else if (!node.missing) into.push({ path: node.path, title: node.title });
  }
  return into;
}

export class SnapshotKeeper {
  private readonly context: FeatureContext;
  private readonly app: App;
  private readonly listeners = new Set<(change: KeeperChange) => void>();
  private stops: Array<() => void> = [];
  private disposed = false;

  /** Ids given to scenes on this device, by the key of the scene's path, until the vault's index shows them. */
  private readonly knownIds = new Map<string, string>();
  /** Scenes (by the key of their path) whose id has not been written into their properties yet. */
  private readonly unwritten = new Map<string, string>();
  /** The properties of snapshots made here, by path, until the vault's index shows them. */
  private readonly written = new Map<string, Frontmatter>();
  private idsMade = 0;

  constructor(context: FeatureContext) {
    this.context = context;
    this.app = context.app;
  }

  /** The plugin is being switched off: nothing is followed or written any more. */
  dispose(): void {
    this.disposed = true;
    this.listeners.clear();
    this.unfollow();
  }

  // ------------------------------------------------------------- following

  /**
   * Be told when snapshots, scenes or the project change. The vault and the
   * store are only followed while somebody listens. Returns a function that
   * stops it.
   */
  onChange(listener: (change: KeeperChange) => void): () => void {
    if (this.disposed) return () => undefined;
    this.listeners.add(listener);
    if (this.stops.length === 0) {
      this.stops.push(
        this.context.vault.on((event) => {
          this.onVaultEvent(event);
        }),
        this.context.store.onChange((change) => {
          if (change.type === 'project') this.emit({ type: 'project' });
        }),
      );
    }
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) this.unfollow();
    };
  }

  private unfollow(): void {
    for (const stop of this.stops.splice(0)) stop();
  }

  private emit(change: KeeperChange): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(change);
      } catch (error) {
        console.error('Spellbook: a snapshots screen could not follow a change', error);
      }
    }
  }

  private onVaultEvent(event: VaultEvent): void {
    const project = this.context.store.project;
    if (this.disposed || !project) return;
    if (event.type === 'refresh') {
      this.emit({ type: 'snapshots' });
      return;
    }
    const rel = relativeTo(project.folder, event.path);
    if (event.type === 'rename') {
      const from = relativeTo(project.folder, event.oldPath);
      if (from !== null && rel !== null && !event.folder) {
        // What is remembered about a scene by its path goes with it.
        for (const map of [this.knownIds, this.unwritten]) {
          const id = map.get(pathKey(from));
          if (id === undefined) continue;
          map.delete(pathKey(from));
          map.set(pathKey(rel), id);
        }
        this.emit({ type: 'renamed', from, to: rel });
      }
      if ([from, rel].some((path) => path !== null && (path === SNAPSHOTS_FOLDER || isInside(SNAPSHOTS_FOLDER, path)))) {
        this.emit({ type: 'snapshots' });
      }
      return;
    }
    if (rel === null) return;
    if (rel === SNAPSHOTS_FOLDER || isInside(SNAPSHOTS_FOLDER, rel)) {
      // The vault's index has caught up with this snapshot: trust it again.
      if (event.type === 'metadata' && event.frontmatter !== null) this.written.delete(rel);
      if (event.type === 'delete') this.written.delete(rel);
      this.emit({ type: 'snapshots' });
    } else if (event.type === 'modify') {
      this.emit({ type: 'text', vaultPath: event.path });
    } else if (event.type === 'metadata') {
      // A scene's id may have arrived from another device.
      this.emit({ type: 'snapshots' });
    }
  }

  // --------------------------------------------------------------- scenes

  /** The scene that is in front, when the note in front is a scene of the open project. */
  openScene(): SceneAt | null {
    const front = this.app.workspace.getActiveFile()?.path;
    return front === undefined ? null : this.sceneAt(front);
  }

  /** The scene of the open project whose note is at a vault path; null when there is none. */
  sceneAt(vaultPath: string): SceneAt | null {
    const { store } = this.context;
    const project = store.project;
    if (this.disposed || !project) return null;
    const wanted = pathKey(vaultPath);
    for (const scene of scenesOf(project.tree)) {
      const at = store.vaultPathOf(scene.path);
      if (at !== null && pathKey(at) === wanted) return scene;
    }
    return null;
  }

  /** The scene at a path inside the project, as the binder has it now; null when it lists no such scene with a note. */
  scene(path: string): SceneAt | null {
    const project = this.context.store.project;
    if (this.disposed || !project) return null;
    const wanted = pathKey(path);
    return scenesOf(project.tree).find((scene) => pathKey(scene.path) === wanted) ?? null;
  }

  /** The properties the vault has indexed for a note of the project. Reads no file. */
  private indexed(path: string): Readonly<Frontmatter> | null {
    const wanted = pathKey(path);
    const folder = parentPath(path);
    for (const note of this.context.store.projectNotes(folder === '' ? undefined : folder)) {
      if (pathKey(note.path) === wanted) return note.frontmatter;
    }
    return null;
  }

  private ref(path: string): SceneRef {
    return { path, id: sceneIdOf(this.indexed(path)) ?? this.knownIds.get(pathKey(path)) ?? null };
  }

  // ------------------------------------------------------------ snapshots

  /** Every snapshot of the open project, copies left by a sync service included. Reads no file. */
  private all(): SnapshotInfo[] {
    const found: SnapshotInfo[] = [];
    for (const note of this.context.store.projectNotes(SNAPSHOTS_FOLDER)) {
      const info = readSnapshotInfo(note.path, note.frontmatter ?? this.written.get(note.path) ?? null);
      if (info) found.push(info);
    }
    return found;
  }

  /** The snapshots of a scene, newest first. Reads no file. */
  list(scenePath: string): SnapshotInfo[] {
    if (this.disposed) return [];
    return snapshotsOf(this.all(), this.ref(scenePath));
  }

  /** A scene's whole text as it is now. What is still unsaved in an editor is saved first. */
  async sceneText(scenePath: string): Promise<string | null> {
    const vaultPath = this.context.store.vaultPathOf(scenePath);
    if (this.disposed || vaultPath === null) return null;
    await this.saveEditors(vaultPath);
    try {
      return await this.context.vault.readText(vaultPath);
    } catch {
      return null;
    }
  }

  /** What a snapshot holds: the scene's properties and text at the time. Null when it cannot be read. */
  async read(snapshotPath: string): Promise<SnapshotText | null> {
    const vaultPath = this.context.store.vaultPathOf(snapshotPath);
    if (this.disposed || vaultPath === null) return null;
    try {
      return readSnapshotText(await this.context.vault.readText(vaultPath));
    } catch {
      return null;
    }
  }

  /**
   * Have every editor that shows a note save what was typed, so that the
   * file is what the writer sees. (Obsidian saves a moment after the last
   * key by itself; a snapshot taken in that moment would miss the last words.)
   */
  private async saveEditors(vaultPath: string): Promise<void> {
    const saves: Array<Promise<unknown>> = [];
    try {
      this.app.workspace.iterateAllLeaves((leaf) => {
        const view = leaf.view as unknown as { file?: { path?: string } | null; save?: () => unknown } | null;
        if (view?.file?.path !== vaultPath || typeof view.save !== 'function') return;
        try {
          saves.push(Promise.resolve(view.save()).catch(() => undefined));
        } catch {
          // An editor that cannot save now saves by itself a moment later.
        }
      });
    } catch (error) {
      console.error('Spellbook: the open editors could not be asked to save', error);
    }
    await Promise.all(saves);
  }

  /**
   * The id of a scene; it is given one when it has none. A scene that has
   * snapshots from before it lost its id (they are found by its path) takes
   * their id back.
   *
   * @param later true: the id is not written into the scene's properties
   *   now (the scene is being typed in) but by writeIds, later
   */
  private async idFor(scenePath: string, later: boolean): Promise<Outcome<string>> {
    const key = pathKey(scenePath);
    const have = this.ref(scenePath).id;
    if (have !== null) {
      // An id that was held back is written now that it may be.
      return !later && this.unwritten.has(key) ? this.writeId(scenePath, have) : ok(have);
    }
    const orphan = snapshotsOf(this.all(), { id: null, path: scenePath }).find((info) => info.sceneId !== null)?.sceneId ?? null;
    const id = orphan ?? newSceneId(this.context.clock.now(), this.context.deviceId, this.idsMade++);
    if (later) {
      this.knownIds.set(key, id);
      this.unwritten.set(key, id);
      return ok(id);
    }
    return this.writeId(scenePath, id);
  }

  /** Write a scene's id into its properties. If the note turns out to have one already, that one is the scene's id. */
  private async writeId(scenePath: string, id: string): Promise<Outcome<string>> {
    let settled = id;
    const result = await this.context.store.updateNoteProperties(scenePath, (frontmatter) => {
      const onDisk = sceneIdOf(frontmatter);
      if (onDisk !== null) {
        settled = onDisk;
        return false;
      }
      settled = id;
      frontmatter[SCENE_ID_KEY] = id;
      return true;
    });
    if (result.status === 'refused' || result.status === 'failed') return fail(result.message);
    if (result.status === 'noop' && result.reason !== 'unchanged') return fail(result.message);
    const key = pathKey(scenePath);
    this.knownIds.set(key, settled);
    this.unwritten.delete(key);
    return ok(settled);
  }

  /**
   * Write the ids that were held back into their scenes' properties, except
   * for the scene at `exceptVaultPath` (the one being typed in).
   */
  async writeIds(exceptVaultPath: string | null): Promise<void> {
    if (this.disposed) return;
    const project = this.context.store.project;
    for (const scene of project ? scenesOf(project.tree) : []) {
      const id = this.unwritten.get(pathKey(scene.path));
      if (id === undefined || this.disposed) continue;
      if (exceptVaultPath !== null && this.context.store.vaultPathOf(scene.path) === exceptVaultPath) continue;
      await this.writeId(scene.path, id);
    }
  }

  /** Take a snapshot of a scene. */
  async take(scenePath: string, options: TakeOptions = {}): Promise<Outcome<SnapshotInfo>> {
    const { store, vault, clock } = this.context;
    const project = store.project;
    if (this.disposed || !project) return fail(NO_PROJECT_TEXT);
    const scene = this.scene(scenePath);
    const vaultPath = store.vaultPathOf(scenePath);
    if (!scene || vaultPath === null) return fail(SCENE_GONE_TEXT);
    const automatic = options.automatic === true;
    const name = tidySnapshotName(options.name ?? '');

    if (options.text === undefined) await this.saveEditors(vaultPath);
    const id = await this.idFor(scene.path, automatic);
    if (!id.ok) return fail(`The snapshot could not be taken: ${id.message}`);
    let text = options.text;
    if (text === undefined) {
      try {
        text = await vault.readText(vaultPath);
      } catch (error) {
        return fail(`The scene could not be read: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    const takenAt = clock.now();
    const moment = localMoment(takenAt);
    const frontmatter = snapshotFrontmatter({
      sceneId: id.value,
      scenePath: scene.path,
      name,
      moment,
      takenAt,
      automatic,
      words: countWords(text),
      device: this.context.deviceId,
    });
    // A scene's snapshots stay in the folder they started in, whatever the scene is called by now.
    const earlier = this.all().find((info) => info.sceneId === id.value);
    const folder = earlier ? noteTitle(parentPath(earlier.path)) : snapshotFolderName(scene.title, id.value);
    const body = snapshotBody(text);
    for (let attempt = 0; attempt < 27; attempt++) {
      const made = await store.createSnapshotNote(folder, snapshotFileName(moment, name, attempt), frontmatter, body, project.indexPath);
      // Two snapshots in one second: the next name is tried.
      if (made.status === 'refused' && made.reason === 'exists') continue;
      if (made.status !== 'done') return fail(made.message);
      this.written.set(made.value.path, frontmatter);
      const info = readSnapshotInfo(made.value.path, frontmatter);
      this.emit({ type: 'snapshots' });
      return info ? ok(info) : fail('The snapshot was saved, but it could not be read back.');
    }
    return fail('The snapshot could not be saved: too many were taken in the same second.');
  }

  /** Move a snapshot to the trash, together with any copies of it a sync service left. */
  async remove(snapshotPath: string): Promise<Outcome> {
    const { store } = this.context;
    const project = store.project;
    if (this.disposed || !project) return fail(NO_PROJECT_TEXT);
    const all = this.all();
    const wanted = all.find((info) => info.path === snapshotPath);
    const same = (info: SnapshotInfo): boolean =>
      wanted !== undefined &&
      wanted.takenAt !== 0 &&
      info.takenAt === wanted.takenAt &&
      info.device === wanted.device &&
      info.sceneId === wanted.sceneId &&
      info.name === wanted.name;
    const paths = [snapshotPath, ...all.filter((info) => info.path !== snapshotPath && same(info)).map((info) => info.path)];
    let problem: string | null = null;
    for (const path of paths) {
      const result = await store.trashSnapshotNote(path, project.indexPath);
      if (result.status === 'refused' || result.status === 'failed') problem = result.message;
      else this.written.delete(path);
    }
    this.emit({ type: 'snapshots' });
    return problem === null ? ok(undefined) : fail(problem);
  }

  /** Move the automatic snapshots of a scene beyond the newest `keep` to the trash. Named ones are never touched. */
  async prune(scenePath: string, keep: number): Promise<void> {
    if (this.disposed) return;
    const ref = this.ref(scenePath);
    const mine = this.all().filter((info) => belongsTo(info, ref));
    for (const info of automaticToRemove(mine, keep)) {
      const project = this.context.store.project;
      if (this.disposed || !project) return;
      const result = await this.context.store.trashSnapshotNote(info.path, project.indexPath);
      if (result.status === 'done') this.written.delete(info.path);
    }
    this.emit({ type: 'snapshots' });
  }

  /**
   * Put a snapshot's text back into its scene.
   *
   *  1. The scene's text as it is now is saved as a snapshot of its own
   *     ("Before restore: ..."), so the restore can itself be undone.
   *  2. The scene is replaced through the store, which reads the note again
   *     at the moment of writing: if it is not, letter for letter, the text
   *     that was just saved, nothing is replaced and the whole thing starts
   *     over with the newer text.
   *  3. The scene keeps the properties it has now, unless the writer asked
   *     for the properties of the time as well. Even then it keeps its place
   *     in the binder and its tie to its snapshots.
   *
   * @returns the "before" snapshot that was taken
   */
  async restore(scenePath: string, snapshotPath: string, withProperties: boolean): Promise<Outcome<SnapshotInfo>> {
    const { store, vault } = this.context;
    const project = store.project;
    if (this.disposed || !project) return fail(NO_PROJECT_TEXT);
    const scene = this.scene(scenePath);
    const vaultPath = store.vaultPathOf(scenePath);
    if (!scene || vaultPath === null) return fail(SCENE_GONE_TEXT);
    const info = this.all().find((candidate) => candidate.path === snapshotPath);
    const snapshot = await this.read(snapshotPath);
    if (!info || snapshot === null) return fail(SNAPSHOT_GONE_TEXT);
    if (!belongsTo(info, this.ref(scene.path))) return fail('That snapshot is of another scene. Nothing was changed.');

    // First, so that it does not change the note between the reading and the writing below.
    const id = await this.idFor(scene.path, false);
    if (!id.ok) return fail(`Nothing was restored: ${id.message}`);

    const beforeName = `Before restore: ${[shownName(info), shownDate(info.taken)].filter((part) => part !== '').join(', ')}`;
    for (let attempt = 0; attempt < RESTORE_TRIES; attempt++) {
      await this.saveEditors(vaultPath);
      let current: string;
      let kept: Frontmatter | null;
      try {
        current = await vault.readText(vaultPath);
        kept = withProperties ? await vault.readFrontmatter(vaultPath) : null;
      } catch (error) {
        return fail(`The scene could not be read, so nothing was restored: ${error instanceof Error ? error.message : String(error)}`);
      }
      const target = restoredText(current, snapshot, withProperties);
      if (target === current) return fail(SAME_TEXT);

      const before = await this.take(scene.path, { name: beforeName, text: current });
      if (!before.ok) return fail(`The text as it is now could not be saved first, so nothing was restored. ${before.message}`);

      this.emit({ type: 'restoring', vaultPath, text: target });
      const replaced = await store.replaceSceneText(scene.path, (onDisk) => (onDisk === current ? target : null), project.indexPath);
      if (replaced.status === 'noop' && replaced.reason === 'unchanged') {
        // The scene changed in that moment. The snapshot just taken is of a
        // text that is already gone: it is kept (it harms nothing), and the
        // newer text is saved before another try.
        continue;
      }
      if (replaced.status !== 'done') return fail(`Nothing was restored: ${replaced.message}`);

      if (withProperties) {
        // The properties of the time, but still this scene: its id and its place in the binder.
        const order = kept?.['order'];
        await store.updateNoteProperties(
          scene.path,
          (frontmatter) => {
            let changed = false;
            if (sceneIdOf(frontmatter) !== id.value) {
              frontmatter[SCENE_ID_KEY] = id.value;
              changed = true;
            }
            if (order !== undefined && frontmatter['order'] !== order) {
              frontmatter['order'] = order;
              changed = true;
            }
            return changed;
          },
          project.indexPath,
        );
      }
      return before;
    }
    return fail(KEPT_CHANGING_TEXT);
  }

  /** The text of a scene without its properties: what a comparison is made of. */
  static bodyOf(sceneText: string): string {
    return splitNote(sceneText).body;
  }
}
