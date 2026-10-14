// The revision notes of every project of the vault, as they are kept: one
// file per project, "Revision notes.json" at the top of the project folder
// (see src/core/revision/notesFile.ts for what is in it, and why).
//
// The book reads each project's file once and keeps it, and reads it again
// when it changes on disk (another device, through the sync). It writes
// through the project store only (store.updateRevisionNotes), which reads the
// file as it is on disk at the moment of writing; the store does one thing at
// a time, so two notes saved one right after the other both arrive.
//
// The book that the feature keeps also looks after two things:
//
//   - Renamed and moved scenes. Their notes go along with them: the vault's
//     own rename events are followed (a renamed folder reports each note in
//     it), gathered for a moment and written in one go. A scene moved into
//     another project takes its notes into that project's file. A scene
//     moved out of every project leaves its notes where they were.
//     A deleted scene leaves its notes in the file, as its snapshots stay in
//     the Snapshots folder: put the scene back (from the trash, under the
//     same name) and its notes are back. Nothing in the file points at a
//     scene that is not there: no screen shows such notes.
//
//   - Notes kept the old way, in a scene's own "revision-notes" property
//     (versions before this one; a device that has not been updated yet; a
//     snapshot restored together with the properties of its time). For the
//     open project, they are moved into the file and the property is taken
//     out of the scene, in two steps that are each safe to repeat:
//       1. every such note is added to the file, unless it is there already;
//       2. the property is taken out of each scene, at the moment of
//          writing, only when the file holds every note the property holds
//          then.
//     Stopped between the two (the app closed, the save failed), it is done
//     again the next time, and adds nothing twice. A property that holds
//     anything that is not a note is left as it is.

import { isMarkdownPath, isInside, joinPath, pathKey, relativeTo } from '../../core/paths';
import { REVISION_NOTES_FILE } from '../../core/projectLayout';
import {
  REVISION_NOTES_KEY,
  editScene,
  entriesAt,
  holdsAll,
  mergeIntoScene,
  parseNotesFile,
  putEntriesAt,
  readNote,
  readNotes,
  renameScenes,
  sameNote,
  sceneNotes,
  serialiseNotesFile,
  takeEntriesAt,
} from '../../core/revision/index';
import type { IdAt, NotesFile, PlacedNote, RevisionNote, SceneKey } from '../../core/revision/index';
import { sceneIdOf } from '../../core/snapshots/index';
import type { Frontmatter, ProjectSummary, TreeNode } from '../../core/types';
import { VaultFileMissingError } from '../../core/vaultPort';
import type { VaultEvent } from '../../core/vaultPort';
import type { FeatureContext } from '../registry';

export const UNREADABLE_NOTES_TEXT = `The revision notes of this project could not be read (the file "${REVISION_NOTES_FILE}" may still be syncing), so nothing was changed. Try again in a moment.`;

/** How long renames are gathered before their notes are moved, in milliseconds. */
export const RENAME_PAUSE_MS = 300;
/** How long after a scene shows notes kept the old way they are moved, in milliseconds. */
export const MIGRATE_PAUSE_MS = 500;

/** A project, as much of it as the book needs. */
type Project = Pick<ProjectSummary, 'indexPath' | 'folder'>;

interface Shelf {
  /** The file's vault path. */
  readonly path: string;
  /** 'unread' until the file was read once. */
  status: 'unread' | 'ready' | 'unreadable';
  file: NotesFile | null;
  /** The file's text as last read or written; null when there is no file. */
  text: string | null;
  /** Goes up whenever the shelf is set, so that a read that started earlier does not undo it. */
  generation: number;
  loading: Promise<void> | null;
}

function scenePaths(tree: readonly TreeNode[], into: Set<string> = new Set()): Set<string> {
  for (const node of tree) {
    if (node.kind === 'folder') scenePaths(node.children, into);
    else if (!node.missing) into.add(pathKey(node.path));
  }
  return into;
}

export interface BookOptions {
  /** Follow renamed scenes and move notes kept the old way into the file. Only the feature's own book does. */
  readonly keep: boolean;
}

export class RevisionNotesBook {
  private readonly context: FeatureContext;
  private readonly keep: boolean;
  private readonly shelves = new Map<string, Shelf>();
  private readonly listeners = new Set<() => void>();
  private stops: Array<() => void> = [];
  private renames: Array<{ from: string; to: string }> = [];
  private cancelRenames: (() => void) | null = null;
  private cancelMigrate: (() => void) | null = null;
  /** Renames and migrations, one after the other. */
  private work: Promise<void> = Promise.resolve();
  private disposed = false;

  constructor(context: FeatureContext, options: BookOptions) {
    this.context = context;
    this.keep = options.keep;
  }

  /** Start following the vault (and, for the feature's book, look for notes kept the old way). */
  start(): void {
    if (this.disposed || this.stops.length > 0) return;
    this.stops.push(
      this.context.vault.on((event) => {
        this.onVaultEvent(event);
      }),
      this.context.store.onChange((change) => {
        if (change.type !== 'project') return;
        this.readOpenProject();
        this.migrateSoon();
      }),
    );
    this.readOpenProject();
    this.migrateSoon();
  }

  /** Start reading the open project's file, so that its notes are there when a screen asks. */
  private readOpenProject(): void {
    const project = this.context.store.project;
    if (project && !this.disposed) this.shelf(project);
  }

  dispose(): void {
    this.disposed = true;
    for (const stop of this.stops.splice(0)) stop();
    this.cancelRenames?.();
    this.cancelMigrate?.();
    this.cancelRenames = null;
    this.cancelMigrate = null;
    this.renames = [];
    this.listeners.clear();
    this.shelves.clear();
  }

  /** Be told when the notes of any project change. Returns a function that stops it. */
  onChange(listener: () => void): () => void {
    if (this.disposed) return () => undefined;
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(): void {
    for (const listener of [...this.listeners]) {
      try {
        listener();
      } catch (error) {
        console.error('Spellbook: the revision notes could not be shown', error);
      }
    }
  }

  /** Wait until what was started (reading, renames, moving notes kept the old way) has finished. For the tests. */
  async idle(): Promise<void> {
    for (let round = 0; round < 5; round++) {
      await this.work;
      await Promise.all([...this.shelves.values()].map((shelf) => shelf.loading ?? Promise.resolve()));
    }
  }

  // -------------------------------------------------------------- projects

  /** The project a note of the vault is in: the one with the deepest folder around it. */
  projectOf(vaultPath: string): Project | null {
    let found: Project | null = null;
    for (const project of this.context.store.listProjects()) {
      if (!isInside(project.folder, vaultPath) || pathKey(project.indexPath) === pathKey(vaultPath)) continue;
      if (!found || project.folder.length > found.folder.length) found = project;
    }
    return found;
  }

  private fileOf(project: Project): string {
    return joinPath(project.folder, REVISION_NOTES_FILE);
  }

  /** The ids of the notes of a project, as the vault has indexed them. Worked out once, when first asked. */
  idsIn(project: Project): IdAt {
    let ids: Map<string, string | null> | null = null;
    return (path) => {
      if (!ids) {
        ids = new Map();
        for (const note of this.context.vault.listMarkdownFiles(project.folder)) {
          const rel = relativeTo(project.folder, note.path);
          if (rel !== null) ids.set(pathKey(rel), sceneIdOf(note.frontmatter));
        }
      }
      return ids.get(pathKey(path));
    };
  }

  // --------------------------------------------------------------- reading

  /** The shelf of a project's file; it starts being read the first time it is asked for. */
  private shelf(project: Project): Shelf {
    const key = pathKey(this.fileOf(project));
    let shelf = this.shelves.get(key);
    if (!shelf) {
      shelf = { path: this.fileOf(project), status: 'unread', file: null, text: null, generation: 0, loading: null };
      this.shelves.set(key, shelf);
      if (!this.disposed) void this.load(shelf);
    }
    return shelf;
  }

  /** Read a project's file (again). The screens are told when what it holds changed. */
  private load(shelf: Shelf): Promise<void> {
    const { path } = shelf;
    const generation = shelf.generation;
    const loading = (async () => {
      let text: string | null = null;
      let failed = false;
      try {
        text = this.context.vault.exists(path) ? await this.context.vault.readText(path) : null;
      } catch (error) {
        if (!(error instanceof VaultFileMissingError)) failed = true;
      }
      if (this.disposed || shelf.generation !== generation) return;
      const file = failed ? null : parseNotesFile(text);
      const status = file ? 'ready' : 'unreadable';
      const changed = status !== shelf.status || text !== shelf.text;
      shelf.status = status;
      shelf.file = file;
      shelf.text = failed ? null : text;
      shelf.generation++;
      if (changed) this.emit();
    })().finally(() => {
      if (shelf.loading === loading) shelf.loading = null;
    });
    shelf.loading = loading;
    return loading;
  }

  /** The project's file, once it has been read. */
  private async loaded(project: Project): Promise<Shelf> {
    const shelf = this.shelf(project);
    while (shelf.loading) await shelf.loading;
    return shelf;
  }

  /**
   * Why the notes of a project cannot be changed just now (its file cannot
   * be read); null when they can. Reads no file.
   */
  problem(project: Project): string | null {
    return this.shelf(project).status === 'unreadable' ? UNREADABLE_NOTES_TEXT : null;
  }

  /**
   * A scene's notes, as its project's file holds them. Reads no file: empty
   * until the file has been read (those who follow the book are told then).
   *
   * @param path the scene's path relative to the project folder
   * @param idAt the ids of the project's notes (see idsIn); asked for once for many scenes
   */
  notesOf(project: Project, path: string, idAt: IdAt = this.idsIn(project)): PlacedNote[] {
    const shelf = this.shelf(project);
    if (!shelf.file) return [];
    return sceneNotes(shelf.file, { path, id: idAt(path) ?? null }, idAt);
  }

  /**
   * The notes of the note at a vault path, for the editor: those in its
   * project's file, and those still kept the old way in its properties (in
   * a project that has not been opened since). Empty outside every project.
   */
  notesAtVaultPath(vaultPath: string): RevisionNote[] {
    const project = this.projectOf(vaultPath);
    const rel = project ? relativeTo(project.folder, vaultPath) : null;
    if (!project || rel === null || !isMarkdownPath(rel)) return [];
    const idAt = this.idsIn(project);
    const notes: RevisionNote[] = this.notesOf(project, rel, idAt);
    const indexed = this.context.vault.listMarkdownFiles(project.folder).find((note) => pathKey(note.path) === pathKey(vaultPath));
    for (const old of readNotes(indexed?.frontmatter ?? null)) {
      if (!notes.some((note) => sameNote(note, old))) notes.push(old);
    }
    return notes;
  }

  // --------------------------------------------------------------- writing

  /**
   * Change a project's file, as it is on disk at the moment of writing.
   * `change` edits the file in place and says whether it did; it may be
   * called more than once. Nothing is written when nothing changed, and
   * never over a file that cannot be read.
   *
   * @returns null once it is saved (or nothing needed to change), or why it was not
   */
  async write(project: Project, change: (file: NotesFile) => boolean): Promise<string | null> {
    if (this.disposed) return 'The revision notes are closed.';
    const box: { written: string | null; unreadable: boolean } = { written: null, unreadable: false };
    const result = await this.context.store.updateRevisionNotes(project.indexPath, (current) => {
      box.written = null;
      box.unreadable = false;
      const file = parseNotesFile(current);
      if (!file) {
        box.unreadable = true;
        return null;
      }
      if (!change(file)) return null;
      box.written = serialiseNotesFile(file);
      return box.written;
    });
    if (this.disposed) return null;
    const shelf = this.shelf(project);
    if (box.unreadable) {
      // Read it again: what is on disk is what the screens should go by.
      void this.load(shelf);
      return UNREADABLE_NOTES_TEXT;
    }
    if (result.status === 'done' && box.written !== null) {
      const text = box.written;
      const changed = text !== shelf.text;
      shelf.status = 'ready';
      shelf.file = parseNotesFile(text);
      shelf.text = text;
      shelf.generation++;
      if (changed) this.emit();
      return null;
    }
    if (result.status === 'done' || result.status === 'noop') return null;
    return result.message;
  }

  /**
   * Change one scene's list of notes (see editScene). `edit` changes the list
   * in place and says whether it did.
   */
  editScene(project: Project, path: string, edit: (list: unknown[]) => boolean): Promise<string | null> {
    return this.write(project, (file) => {
      // The ids as the vault has them now, at the moment of writing.
      const idAt = this.idsIn(project);
      const scene: SceneKey = { path, id: idAt(path) ?? null };
      return editScene(file, scene, idAt, edit);
    });
  }

  // ---------------------------------------------------------------- events

  private onVaultEvent(event: VaultEvent): void {
    if (this.disposed) return;
    if (event.type === 'refresh') {
      for (const shelf of this.shelves.values()) if (shelf.status !== 'unread') void this.load(shelf);
      this.migrateSoon();
      return;
    }
    if (event.type === 'metadata') {
      if (this.keep && event.frontmatter !== null && REVISION_NOTES_KEY in event.frontmatter) this.migrateSoon();
      return;
    }
    // The file of a project changed, came, went or was renamed: read it again.
    const paths = event.type === 'rename' ? [event.path, event.oldPath] : [event.path];
    for (const path of paths) {
      const shelf = this.shelves.get(pathKey(path));
      if (shelf && shelf.status !== 'unread') void this.load(shelf);
    }
    if (event.type === 'rename' && !event.folder && this.keep && isMarkdownPath(event.oldPath)) {
      this.renames.push({ from: event.oldPath, to: event.path });
      this.cancelRenames?.();
      this.cancelRenames = this.context.clock.setTimer(() => {
        this.cancelRenames = null;
        this.queue(() => this.followRenames());
      }, RENAME_PAUSE_MS);
    }
  }

  private queue(job: () => Promise<void>): void {
    this.work = this.work.then(job).catch((error: unknown) => {
      console.error('Spellbook: the revision notes could not be kept up to date', error);
    });
  }

  /** Move the notes of the scenes renamed in the last moment along with them. */
  private async followRenames(): Promise<void> {
    const renames = this.renames.splice(0);
    if (this.disposed || renames.length === 0) return;
    const inside = new Map<string, { project: Project; renames: Array<{ from: string; to: string }> }>();
    const across: Array<{ from: Project; fromPath: string; to: Project; toPath: string }> = [];
    for (const rename of renames) {
      const from = this.projectOf(rename.from);
      const to = this.projectOf(rename.to);
      const fromPath = from ? relativeTo(from.folder, rename.from) : null;
      const toPath = to ? relativeTo(to.folder, rename.to) : null;
      // A note that comes from outside every project brings no notes; one that goes outside leaves them.
      if (!from || !to || fromPath === null || toPath === null) continue;
      if (from.indexPath === to.indexPath) {
        const entry = inside.get(from.indexPath) ?? { project: from, renames: [] };
        entry.renames.push({ from: fromPath, to: toPath });
        inside.set(from.indexPath, entry);
      } else {
        across.push({ from, fromPath, to, toPath });
      }
    }
    for (const { project, renames: list } of inside.values()) {
      const problem = await this.write(project, (file) => renameScenes(file, list));
      if (problem) console.warn(`Spellbook: the revision notes of a renamed scene could not follow it. ${problem}`);
    }
    for (const move of across) {
      // Into the other project first, then out of this one: stopped half way, the notes are in both, never in neither.
      const source = await this.loaded(move.from);
      const entries = source.file ? entriesAt(source.file, move.fromPath) : [];
      if (entries.length === 0) continue;
      const added = await this.write(move.to, (file) => putEntriesAt(file, move.toPath, entries));
      if (added) {
        console.warn(`Spellbook: the revision notes of a moved scene could not follow it. ${added}`);
        continue;
      }
      const taken = await this.write(move.from, (file) => takeEntriesAt(file, move.fromPath).length > 0);
      if (taken) console.warn(`Spellbook: the revision notes of a moved scene were copied, but are still in the project it left. ${taken}`);
    }
  }

  // ------------------------------------------------------------- migration

  /** Look for notes kept the old way in the open project, a moment from now. */
  private migrateSoon(): void {
    if (!this.keep || this.disposed) return;
    this.cancelMigrate?.();
    this.cancelMigrate = this.context.clock.setTimer(() => {
      this.cancelMigrate = null;
      this.queue(() => this.migrate());
    }, MIGRATE_PAUSE_MS);
  }

  /** Move the notes kept in the properties of the open project's scenes into its file. See the top of this file. */
  private async migrate(): Promise<void> {
    const { store } = this.context;
    const open = store.project;
    if (this.disposed || !open || open.readOnly) return;
    const project: Project = { indexPath: open.indexPath, folder: open.folder };
    const scenes = scenePaths(open.tree);
    const found: Array<{ path: string; id: string | null; entries: unknown[] }> = [];
    for (const note of store.projectNotes()) {
      if (!scenes.has(pathKey(note.path))) continue;
      const list = note.frontmatter?.[REVISION_NOTES_KEY];
      if (!Array.isArray(list) || list.some((entry) => readNote(entry) === null)) continue;
      found.push({ path: note.path, id: sceneIdOf(note.frontmatter), entries: list });
    }
    if (found.length === 0) return;

    // 1. Into the file, each note once.
    const problem = await this.write(project, (file) => {
      const idAt = this.idsIn(project);
      let changed = false;
      for (const scene of found) changed = mergeIntoScene(file, { path: scene.path, id: scene.id }, idAt, scene.entries) || changed;
      return changed;
    });
    if (problem) {
      console.warn(`Spellbook: the revision notes kept in the scenes could not be moved yet. ${problem}`);
      return;
    }
    const shelf = await this.loaded(project);
    if (!shelf.file || store.project?.indexPath !== project.indexPath) return;

    // 2. Out of each scene, only when the file holds all it holds at that moment.
    for (const scene of found) {
      if (this.disposed) return;
      await store.updateNoteProperties(
        scene.path,
        (frontmatter: Frontmatter) => {
          const list = frontmatter[REVISION_NOTES_KEY];
          if (!Array.isArray(list) || !shelf.file) return false;
          const notes = list.map((entry) => readNote(entry));
          if (notes.some((note) => note === null)) return false;
          const key: SceneKey = { path: scene.path, id: sceneIdOf(frontmatter) };
          if (!holdsAll(shelf.file, key, this.idsIn(project), notes as RevisionNote[])) return false;
          delete frontmatter[REVISION_NOTES_KEY];
          return true;
        },
        project.indexPath,
      );
    }
  }
}
