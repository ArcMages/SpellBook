// The revision keeper: everything the revision tools do, between the screens
// and the project store.
//
// It reads through the store (which scenes there are, the properties the
// vault has indexed) and the vault doorway (a scene's text), and it writes
// through the store only:
//   - a revision note, added, changed or taken away
//                       store.updateNoteProperties (a property; the text is not touched)
//   - a replace         store.replaceInSceneBody, after a snapshot taken
//                       through the snapshots' own service
//   - a renamed entity  store.renameWorldNote, and its other names through
//                       store.updateNoteProperties
//
// Replacing words is one of the two things in the plugin that change what
// the writer wrote (restoring a snapshot is the other), so it goes carefully
// (see replace below).

import type { App, EditorPosition } from 'obsidian';
import { sanitiseFileName } from '../../core/names';
import { isInside, joinPath, noteTitle, parentPath, pathKey, relativeTo } from '../../core/paths';
import { REVISION_NOTES_KEY, addNoteTo, changeNoteIn, findInText, findNote, locatePassage, nameOccurrences, readNotes, removeNoteFrom, splitBody, tidyPassage } from '../../core/revision/index';
import type { BodyEdit, NameOccurrence, PlacedNote, SearchOptions, TextMatch } from '../../core/revision/index';
import type { Frontmatter, IntentResult, TreeNode } from '../../core/types';
import type { VaultEvent } from '../../core/vaultPort';
import { editAliases, isEntityPath, readAliases } from '../../core/world/index';
import type { FeatureContext } from '../registry';

export const NO_PROJECT_TEXT = 'No Spellbook project is open.';
export const READ_ONLY_TEXT = 'This project can only be read just now, so nothing can be changed.';
export const NO_SCENE_TEXT = 'Open a scene of the project first.';
export const NO_SELECTION_TEXT = 'Select the words the note is about first.';
export const SCENE_GONE_TEXT = 'That scene is no longer in the project.';
export const NOTE_GONE_TEXT = 'That note is no longer in the scene. It may have been changed on another device.';
export const CHANGED_SINCE_TEXT = 'It was changed since the search, so nothing in it was replaced. Search again to see it as it is now.';
export const NO_SNAPSHOTS_TEXT = 'Snapshots are not available, so nothing was replaced: every scene is saved as a snapshot before its words are changed.';

/**
 * The name the snapshots offer their actions under (see SNAPSHOTS_SERVICE in
 * src/features/snapshots). The revision tools use one of them: a snapshot
 * taken under a given name, without asking.
 */
export const SNAPSHOTS_SERVICE_NAME = 'snapshots.actions';

/** The part of the snapshots' service the revision tools use. */
export interface SnapshotTaker {
  takeNamed(scenePath: string, name: string): Promise<string | null>;
}

/** A scene of the open project, as the binder lists it. */
export interface SceneAt {
  /** Path relative to the project folder. */
  readonly path: string;
  readonly title: string;
  /** The ids of the binder folders it is in, outermost first. */
  readonly folders: readonly string[];
}

/** A binder folder, for choosing where to look. */
export interface FolderAt {
  readonly id: string;
  readonly name: string;
  /** How deep it lies: 0 for a folder at the top of the binder. */
  readonly depth: number;
}

/** The notes of one scene. */
export interface SceneNotes {
  readonly scene: SceneAt;
  readonly notes: readonly PlacedNote[];
}

/** What a search found in one scene. */
export interface SceneMatches<M extends TextMatch = TextMatch> {
  readonly scene: SceneAt;
  /** The scene's text without its properties, as it was searched. */
  readonly body: string;
  readonly matches: readonly M[];
}

/** The changes to make in one scene. */
export interface ScenePlan {
  readonly scene: SceneAt;
  readonly body: string;
  readonly edits: readonly BodyEdit[];
}

/** How a replace went. */
export interface ReplaceReport {
  /** The scenes that were changed. */
  readonly scenes: number;
  /** The changes made in them. */
  readonly changes: number;
  /** The scenes that were left as they are, and why. */
  readonly problems: ReadonlyArray<{ readonly title: string; readonly message: string }>;
}

/** How a rename went. */
export interface RenameReport {
  /** The entity note's path now, relative to the project folder. */
  readonly path: string;
  /** Why the old name could not be kept as another name; null when it was, or was not asked for. */
  readonly aliasProblem: string | null;
  readonly replaced: ReplaceReport;
}

/** What the keeper tells those who follow it. */
export type RevisionChange = { readonly type: 'project' } | { readonly type: 'notes' } | { readonly type: 'text'; readonly path: string };

/** An editor, as much of it as the jump to a passage uses. */
interface EditorLike {
  getValue(): string;
  offsetToPos(offset: number): EditorPosition;
  setSelection(anchor: EditorPosition, head?: EditorPosition): void;
  focus(): void;
}

function scenesOf(tree: readonly TreeNode[], folders: readonly string[] = [], into: SceneAt[] = []): SceneAt[] {
  for (const node of tree) {
    if (node.kind === 'folder') scenesOf(node.children, [...folders, node.id], into);
    else if (!node.missing) into.push({ path: node.path, title: node.title, folders });
  }
  return into;
}

function foldersOf(tree: readonly TreeNode[], depth = 0, into: FolderAt[] = []): FolderAt[] {
  for (const node of tree) {
    if (node.kind !== 'folder') continue;
    into.push({ id: node.id, name: node.name, depth });
    foldersOf(node.children, depth + 1, into);
  }
  return into;
}

function problemOf(result: IntentResult<unknown>): string | null {
  if (result.status === 'done') return null;
  if (result.status === 'noop' && result.reason === 'unchanged') return null;
  return result.message;
}

export class RevisionKeeper {
  private readonly context: FeatureContext;
  private readonly app: App;
  private readonly listeners = new Set<(change: RevisionChange) => void>();
  private stops: Array<() => void> = [];
  private disposed = false;

  constructor(context: FeatureContext) {
    this.context = context;
    this.app = context.app;
  }

  get isDisposed(): boolean {
    return this.disposed;
  }

  dispose(): void {
    this.disposed = true;
    this.listeners.clear();
    this.unfollow();
  }

  // ------------------------------------------------------------- following

  /** Be told when the notes, a scene's text or the project change. Returns a function that stops it. */
  onChange(listener: (change: RevisionChange) => void): () => void {
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

  private emit(change: RevisionChange): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(change);
      } catch (error) {
        console.error('Spellbook: a revision screen could not follow a change', error);
      }
    }
  }

  private onVaultEvent(event: VaultEvent): void {
    const project = this.context.store.project;
    if (this.disposed || !project) return;
    if (event.type === 'refresh') {
      this.emit({ type: 'notes' });
      return;
    }
    const rel = relativeTo(project.folder, event.path);
    if (rel === null) return;
    if (event.type === 'metadata') this.emit({ type: 'notes' });
    else if (event.type === 'modify') this.emit({ type: 'text', path: rel });
  }

  // ---------------------------------------------------------------- scenes

  /** The scenes of the open project that have a note, in binder order. */
  scenes(): SceneAt[] {
    const project = this.context.store.project;
    return this.disposed || !project ? [] : scenesOf(project.tree);
  }

  /** The binder folders of the open project, in binder order. */
  folders(): FolderAt[] {
    const project = this.context.store.project;
    return this.disposed || !project ? [] : foldersOf(project.tree);
  }

  /** The scenes inside a binder folder (and its folders), or all of them for null. */
  scenesIn(folderId: string | null): SceneAt[] {
    const all = this.scenes();
    return folderId === null ? all : all.filter((scene) => scene.folders.includes(folderId));
  }

  /** The scene at a path inside the project; null when the binder lists no such scene with a note. */
  scene(path: string): SceneAt | null {
    const wanted = pathKey(path);
    return this.scenes().find((scene) => pathKey(scene.path) === wanted) ?? null;
  }

  /** The scene whose note is at a vault path; null when it is no scene of the open project. */
  sceneAtVault(vaultPath: string): SceneAt | null {
    const { store } = this.context;
    const wanted = pathKey(vaultPath);
    for (const scene of this.scenes()) {
      const at = store.vaultPathOf(scene.path);
      if (at !== null && pathKey(at) === wanted) return scene;
    }
    return null;
  }

  /** Whether the open project can be changed now; a message saying why not, or null. */
  whyNotWritable(): string | null {
    const project = this.context.store.project;
    if (this.disposed || !project) return NO_PROJECT_TEXT;
    return project.readOnly ? READ_ONLY_TEXT : null;
  }

  /** Whether a note at a vault path lies inside one of the vault's Spellbook projects. */
  inAnyProject(vaultPath: string | null): boolean {
    if (vaultPath === null || this.disposed) return false;
    return this.context.store.listProjects().some((project) => isInside(project.folder, vaultPath));
  }

  /** Whether a project is open. */
  get hasProject(): boolean {
    return !this.disposed && this.context.store.project !== null;
  }

  /**
   * A scene's text as it is now. Null when it cannot be read.
   *
   * @param save whether what is typed in an open editor is saved first (default: it is)
   */
  async sceneText(scenePath: string, save = true): Promise<string | null> {
    const vaultPath = this.context.store.vaultPathOf(scenePath);
    if (this.disposed || vaultPath === null) return null;
    if (save) await this.saveEditors([vaultPath]);
    try {
      return await this.context.vault.readText(vaultPath);
    } catch {
      return null;
    }
  }

  /**
   * Have every editor that shows one of these notes save what was typed, so
   * that the files are what the writer sees. (Obsidian saves a moment after
   * the last key by itself; a search made in that moment would miss the last words.)
   */
  private async saveEditors(vaultPaths: readonly string[]): Promise<void> {
    const wanted = new Set(vaultPaths.map(pathKey));
    const saves: Array<Promise<unknown>> = [];
    try {
      this.app.workspace.iterateAllLeaves((leaf) => {
        const view = leaf.view as unknown as { file?: { path?: string } | null; save?: () => unknown } | null;
        const path = view?.file?.path;
        if (path === undefined || !wanted.has(pathKey(path)) || typeof view?.save !== 'function') return;
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

  // ----------------------------------------------------------------- notes

  /** The notes of a scene, as the vault has indexed its properties. Reads no file. */
  notesOf(scenePath: string): PlacedNote[] {
    const wanted = pathKey(scenePath);
    for (const note of this.context.store.projectNotes()) {
      if (pathKey(note.path) === wanted) return readNotes(note.frontmatter);
    }
    return [];
  }

  /** Every scene that has notes, in binder order, with its notes. Reads no file. */
  allNotes(): SceneNotes[] {
    const byPath = new Map<string, Readonly<Frontmatter> | null>();
    for (const note of this.context.store.projectNotes()) byPath.set(pathKey(note.path), note.frontmatter);
    const found: SceneNotes[] = [];
    for (const scene of this.scenes()) {
      const notes = readNotes(byPath.get(pathKey(scene.path)) ?? null);
      if (notes.length > 0) found.push({ scene, notes });
    }
    return found;
  }

  /**
   * Pin a note to a passage of a scene. The passage is the words as they
   * were selected; the scene's text is not touched.
   *
   * @returns null once it is saved, or why it was not
   */
  async addNote(scenePath: string, selection: string, words: string): Promise<string | null> {
    const blocked = this.whyNotWritable();
    if (blocked) return blocked;
    const scene = this.scene(scenePath);
    if (!scene) return SCENE_GONE_TEXT;
    const passage = tidyPassage(selection);
    if (passage === '') return NO_SELECTION_TEXT;
    const note = { passage, note: words.trim(), created: this.context.clock.today(), done: false };
    const result = await this.context.store.updateNoteProperties(scene.path, (frontmatter) => addNoteTo(frontmatter, note), this.projectId());
    this.emit({ type: 'notes' });
    return problemOf(result);
  }

  /** Change a note's words, or whether it is done. Resolves with null when done, or with why not. */
  async changeNote(scenePath: string, note: PlacedNote, change: { readonly note?: string; readonly done?: boolean }): Promise<string | null> {
    const blocked = this.whyNotWritable();
    if (blocked) return blocked;
    let found = false;
    const result = await this.context.store.updateNoteProperties(
      scenePath,
      (frontmatter) => {
        const list = frontmatter[REVISION_NOTES_KEY];
        found = Array.isArray(list) && findNote(list, note) >= 0;
        return found && changeNoteIn(frontmatter, note, change);
      },
      this.projectId(),
    );
    this.emit({ type: 'notes' });
    if (!found) return NOTE_GONE_TEXT;
    return problemOf(result);
  }

  /** Take a note away. Resolves with null when done, or with why not. */
  async removeNote(scenePath: string, note: PlacedNote): Promise<string | null> {
    const blocked = this.whyNotWritable();
    if (blocked) return blocked;
    let found = false;
    const result = await this.context.store.updateNoteProperties(
      scenePath,
      (frontmatter) => {
        found = removeNoteFrom(frontmatter, note);
        return found;
      },
      this.projectId(),
    );
    this.emit({ type: 'notes' });
    if (!found) return NOTE_GONE_TEXT;
    return problemOf(result);
  }

  /**
   * Which notes of a scene no longer find their passage in its text. Each
   * note is looked for in the text without its properties.
   */
  static changedPassages(sceneText: string, notes: readonly PlacedNote[]): Set<number> {
    const { body } = splitBody(sceneText);
    const changed = new Set<number>();
    for (const note of notes) if (locatePassage(body, note.passage) === null) changed.add(note.index);
    return changed;
  }

  /** Show a scene with a passage selected in the editor. Without a passage, or when it is gone, the scene is just shown. */
  async jumpTo(scenePath: string, passage: string | null): Promise<boolean> {
    const vaultPath = this.context.store.vaultPathOf(scenePath);
    if (this.disposed || vaultPath === null) return false;
    const shown = await this.context.openNote(vaultPath, false);
    if (!shown || passage === null) return shown;
    const active = (this.app.workspace as { activeEditor?: unknown }).activeEditor as
      | { file?: { path?: string } | null; editor?: EditorLike; setEphemeralState?: (state: unknown) => void }
      | null
      | undefined;
    const editor = active?.editor;
    if (!active || !editor || active.file?.path === undefined || pathKey(active.file.path) !== pathKey(vaultPath)) return true;
    try {
      const text = editor.getValue();
      const { head } = splitBody(text);
      const place = locatePassage(text, passage, head.length);
      if (!place) return true;
      const from = editor.offsetToPos(place.from);
      const to = editor.offsetToPos(place.to);
      // The editor scrolls to the line, and the passage is selected.
      active.setEphemeralState?.({ line: from.line, cursor: { from, to } });
      editor.setSelection(from, to);
      editor.focus();
    } catch (error) {
      console.error('Spellbook: the passage could not be shown', error);
    }
    return true;
  }

  // ---------------------------------------------------------------- search

  /**
   * Look for words in the text of the scenes (without their properties): in
   * all of them, or in those inside one binder folder. What is typed in open
   * editors is saved first. Scenes where nothing is found are left out.
   */
  async search(find: string, options: SearchOptions, folderId: string | null): Promise<SceneMatches[]> {
    return this.searchWith(folderId, (body) => findInText(body, find, options));
  }

  /** Where an entity's name stands in the text of the scenes. See nameOccurrences. */
  async findName(name: string): Promise<Array<SceneMatches<NameOccurrence>>> {
    return this.searchWith(null, (body) => nameOccurrences(body, name));
  }

  private async searchWith<M extends TextMatch>(folderId: string | null, find: (body: string) => M[]): Promise<Array<SceneMatches<M>>> {
    const { store, vault } = this.context;
    const scenes = this.scenesIn(folderId);
    const paths = scenes.map((scene) => store.vaultPathOf(scene.path)).filter((path): path is string => path !== null);
    await this.saveEditors(paths);
    const found: Array<SceneMatches<M>> = [];
    for (const scene of scenes) {
      if (this.disposed) return [];
      const vaultPath = store.vaultPathOf(scene.path);
      if (vaultPath === null) continue;
      let text: string;
      try {
        text = await vault.readText(vaultPath);
      } catch {
        continue;
      }
      const { body } = splitBody(text);
      const matches = find(body);
      if (matches.length > 0) found.push({ scene, body, matches });
    }
    return found;
  }

  // --------------------------------------------------------------- replace

  /**
   * Make the ticked changes, scene by scene. For each scene:
   *  1. it is read again: if its text is no longer the one that was searched,
   *     it is left alone;
   *  2. a snapshot of it is taken, under `snapshotName`, through the
   *     snapshots' own service; if that cannot be done, it is left alone;
   *  3. the changes are made through the store, which reads the scene once
   *     more at the very moment of writing and refuses if it changed.
   */
  async replace(plans: readonly ScenePlan[], snapshotName: string): Promise<ReplaceReport> {
    let scenes = 0;
    let changes = 0;
    const problems: Array<{ title: string; message: string }> = [];
    const blocked = this.whyNotWritable();
    if (blocked) return { scenes, changes, problems: plans.map((plan) => ({ title: plan.scene.title, message: blocked })) };
    for (const plan of plans) {
      if (plan.edits.length === 0) continue;
      const title = plan.scene.title;
      if (this.disposed) {
        problems.push({ title, message: NO_PROJECT_TEXT });
        continue;
      }
      const taker = this.context.services.get<SnapshotTaker>(SNAPSHOTS_SERVICE_NAME);
      if (!taker || typeof taker.takeNamed !== 'function') {
        problems.push({ title, message: NO_SNAPSHOTS_TEXT });
        continue;
      }
      const now = await this.sceneText(plan.scene.path);
      if (now === null) {
        problems.push({ title, message: SCENE_GONE_TEXT });
        continue;
      }
      if (splitBody(now).body !== plan.body) {
        problems.push({ title, message: CHANGED_SINCE_TEXT });
        continue;
      }
      const snapshot = await taker.takeNamed(plan.scene.path, snapshotName);
      if (snapshot !== null) {
        problems.push({ title, message: `No snapshot could be taken, so nothing was replaced. ${snapshot}` });
        continue;
      }
      const result = await this.context.store.replaceInSceneBody(plan.scene.path, plan.body, plan.edits, this.projectId());
      if (result.status === 'done') {
        scenes++;
        changes += plan.edits.length;
      } else if (result.status === 'refused' && result.reason === 'scene-changed') {
        problems.push({ title, message: CHANGED_SINCE_TEXT });
      } else {
        problems.push({ title, message: result.message });
      }
      this.emit({ type: 'text', path: plan.scene.path });
    }
    return { scenes, changes, problems };
  }

  // ---------------------------------------------------------------- rename

  /** The name and other names of an entity of the open project; null when there is no such entity. */
  entity(entityPath: string): { readonly path: string; readonly name: string; readonly aliases: readonly string[] } | null {
    if (this.disposed || !isEntityPath(entityPath)) return null;
    const wanted = pathKey(entityPath);
    for (const note of this.context.store.worldNotes()) {
      if (pathKey(note.path) === wanted) return { path: note.path, name: noteTitle(note.path), aliases: readAliases(note.frontmatter) };
    }
    return null;
  }

  /**
   * Rename an entity everywhere:
   *  1. the ticked places in the manuscript, with a snapshot of each scene
   *     first (see replace);
   *  2. its note, through Obsidian's rename, so that links to it follow;
   *  3. its old name added to its other names, when asked.
   * The note is not renamed when the name will not do (it is checked first);
   * the text is left as it is then too.
   */
  async renameEverywhere(entityPath: string, newName: string, keepOldName: boolean, plans: readonly ScenePlan[]): Promise<RenameReport | string> {
    const blocked = this.whyNotWritable();
    if (blocked) return blocked;
    const entity = this.entity(entityPath);
    if (!entity) return 'That entity is no longer in the project.';
    const name = newName.trim();
    if (name === '' || sanitiseFileName(name, '') !== name) return `"${name}" cannot be used as the name of a note.`;
    const target = pathKey(joinPath(parentPath(entity.path), `${name}.md`));
    const taken = target !== pathKey(entity.path) && this.context.store.projectNotes().some((note) => pathKey(note.path) === target);
    if (taken) return `There is already a note called "${name}" in that folder.`;

    const replaced = await this.replace(plans, `Before rename: ${entity.name} → ${name}`);
    const renamed = await this.context.store.renameWorldNote(entity.path, name, this.projectId());
    if (renamed.status !== 'done' && !(renamed.status === 'noop' && renamed.reason === 'unchanged')) {
      return `${renamed.message}${replaced.changes > 0 ? ` The text was changed in ${replaced.scenes} ${replaced.scenes === 1 ? 'scene' : 'scenes'}.` : ''}`;
    }
    const path = renamed.status === 'done' ? renamed.value.path : entity.path;
    let aliasProblem: string | null = null;
    if (keepOldName) {
      const old = entity.name;
      let unreadable = false;
      const result = await this.context.store.updateNoteProperties(
        path,
        (frontmatter) => {
          if (readAliases(frontmatter).includes(old)) return false;
          const change = editAliases(frontmatter, { add: old });
          unreadable = change === 'unreadable';
          return change === 'changed';
        },
        this.projectId(),
      );
      aliasProblem = unreadable ? 'The old name could not be added to its other names: its "aliases" property holds something else.' : problemOf(result);
    }
    this.emit({ type: 'notes' });
    return { path, aliasProblem, replaced };
  }

  private projectId(): string | undefined {
    return this.context.store.project?.indexPath;
  }
}
