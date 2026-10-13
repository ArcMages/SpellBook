// The plugin's side of the world-building screen: what the World browser,
// its windows and the inspector's "In this scene" part ask, on top of the
// project store.
//
// It works out, for the open project:
//   - the types an entity can have (from the project index);
//   - the entities: the notes in the project's World folder;
//   - the links: which entities each scene and timeline event lists in its
//     "entities" property, and so the scenes and events of each entity.
// All of it is worked out when it is first asked for and kept until the
// project or one of those notes changes. Where a link leads is asked of the
// vault itself (Obsidian's own index of links), never guessed from a name.
//
// Every change goes through the project store: a new entity note, a rename,
// a note moved to the trash, a link added to or taken out of a scene's
// properties, a changed list of types. The vault doorway is used to read and
// to listen, never to write. No note's text is ever changed.

import { Notice } from 'obsidian';
import type { PaneType } from 'obsidian';
import { sanitiseFileName } from '../../core/names';
import { noteTitle, pathKey, relativeTo } from '../../core/paths';
import type { Frontmatter, IntentResult, TreeNode } from '../../core/types';
import type { VaultEvent } from '../../core/vaultPort';
import {
  ENTITY_TYPES_KEY,
  addEntityLink,
  buildWorldLinks,
  findType,
  linkTo,
  mentionNames,
  newEntityBody,
  newEntityFrontmatter,
  parseLink,
  readEntities,
  readEntityTypes,
  removeEntityLink,
  sceneMention,
  writeEntityTypes,
} from '../../core/world';
import type { Entity, EntityType, LinkChange, LinkingNote, MentionSnippet, TypeEdit, WorldLinks } from '../../core/world';
import type { FeatureContext } from '../registry';
import { NO_PROJECT_TEXT, PROBLEM_NOTICE_MS } from './parts';

export const SWITCHED_OFF_TEXT = 'Spellbook has been switched off. Nothing was changed.';
export const NO_NAME_TEXT = 'Give it a name.';
export const BAD_NAME_TEXT = 'That name has no characters that can be used in a file name.';
export const NO_TYPE_TEXT = 'That type is no longer in the list.';
export const NOT_FOUND_TEXT = 'That note is no longer in the project (it may still be syncing).';
export const UNREADABLE_LIST_TEXT =
  'The "entities" property of that note is not a list of links, so it was left as it is. Put it right in the note itself.';

/** The open project, as the world-building screen needs it. */
export interface WorldProject {
  /** The project's index path: what it is known by. */
  readonly id: string;
  /** The project's name: the writer's own text. */
  readonly title: string;
  /** True when the project cannot be changed (its index could not be understood). */
  readonly readOnly: boolean;
}

/** A scene whose text names an entity without listing it. */
export interface FoundMention {
  /** The scene's path relative to the project folder. */
  readonly path: string;
  readonly title: string;
  readonly snippet: MentionSnippet;
}

/** What the host is built on: the parts of the feature context it uses. */
export type WorldHostContext = Pick<FeatureContext, 'store' | 'vault' | 'clock' | 'openNote'>;

/** The open project, worked out once for every change of it. */
interface Model {
  readonly project: WorldProject;
  /** The project's folder in the vault. */
  readonly folder: string;
  readonly types: readonly EntityType[];
  readonly entities: readonly Entity[];
  readonly byPath: ReadonlyMap<string, Entity>;
  /** The scenes of the binder, in order. */
  readonly scenes: readonly LinkingNote[];
  readonly links: WorldLinks;
  /** The properties of every note the model was read from, as text: for telling a change from none. */
  readonly known: ReadonlyMap<string, string>;
}

const NO_LINKS: WorldLinks = { linksOf: () => [], scenesOf: () => [], eventsOf: () => [] };

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

/** The scenes of a binder tree, in order; a scene whose note is missing is left out. */
function scenesOf(tree: readonly TreeNode[], into: Array<{ path: string; title: string }> = []): Array<{ path: string; title: string }> {
  for (const node of tree) {
    if (node.kind === 'folder') scenesOf(node.children, into);
    else if (!node.missing) into.push({ path: node.path, title: node.title });
  }
  return into;
}

export class WorldHost {
  private readonly context: WorldHostContext;
  private disposed = false;
  private readonly listening = new Set<() => void>();
  private stops: Array<() => void> = [];
  private model: Model | null = null;
  /** The timer of a change that is about to be told, if any. */
  private stopTelling: (() => void) | null = null;

  constructor(context: WorldHostContext) {
    this.context = context;
    this.stops.push(
      context.store.onChange(() => {
        this.changed();
      }),
      context.vault.on((event) => {
        this.onVaultEvent(event);
      }),
    );
  }

  // ---------------------------------------------------------------- lifecycle

  /** The plugin is being switched off: stop following everything and forget what was kept. */
  release(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const stop of this.stops.splice(0)) stop();
    this.stopTelling?.();
    this.stopTelling = null;
    this.model = null;
    // A pane or a window that is still open says that there is nothing to show any more.
    for (const listener of [...this.listening]) listener();
    this.listening.clear();
  }

  get isReleased(): boolean {
    return this.disposed;
  }

  /** Be told when anything the host gives may have changed. Returns the function that stops it. */
  onChange(listener: () => void): () => void {
    if (this.disposed) return () => undefined;
    this.listening.add(listener);
    return () => {
      this.listening.delete(listener);
    };
  }

  /** Something changed: what was worked out is forgotten, and the listeners are told once, in a moment. */
  private changed(): void {
    if (this.disposed) return;
    this.model = null;
    if (this.stopTelling !== null || this.listening.size === 0) return;
    this.stopTelling = this.context.clock.setTimer(() => {
      this.stopTelling = null;
      if (this.disposed) return;
      for (const listener of [...this.listening]) {
        try {
          listener();
        } catch (error) {
          console.error('Spellbook: a world-building screen could not be brought up to date', error);
        }
      }
    }, 0);
  }

  private onVaultEvent(event: VaultEvent): void {
    if (this.disposed) return;
    // A text that changed is not a list that changed: only "Find mentions" reads texts, when asked.
    if (event.type === 'modify') return;
    if (event.type === 'refresh') {
      this.changed();
      return;
    }
    const folder = this.context.store.project?.folder;
    if (folder === undefined) return;
    const rel = relativeTo(folder, event.path);
    const was = event.type === 'rename' ? relativeTo(folder, event.oldPath) : null;
    if (rel === null && was === null) return;
    if (event.type === 'metadata' && rel !== null) {
      // A note that was indexed again with the properties it had: nothing to bring up to date.
      const known = this.model?.known.get(pathKey(rel));
      if (known !== undefined && known === JSON.stringify(event.frontmatter)) return;
    }
    this.changed();
  }

  // ------------------------------------------------------------------ reading

  private current(): Model | null {
    if (this.disposed) return null;
    const snapshot = this.context.store.project;
    if (!snapshot) {
      this.model = null;
      return null;
    }
    if (this.model !== null && this.model.project.id === snapshot.indexPath) return this.model;

    const { store, vault } = this.context;
    const types = readEntityTypes(store.projectData(ENTITY_TYPES_KEY));
    const known = new Map<string, string>();
    const indexed = new Map<string, Readonly<Frontmatter> | null>();
    for (const note of store.projectNotes()) {
      indexed.set(pathKey(note.path), note.frontmatter);
      known.set(pathKey(note.path), JSON.stringify(note.frontmatter));
    }
    const entities = readEntities(store.worldNotes(), types);
    const linking = (note: { path: string; title: string }): LinkingNote => ({
      path: note.path,
      title: note.title,
      vaultPath: store.vaultPathOf(note.path),
      frontmatter: indexed.get(pathKey(note.path)) ?? null,
    });
    const scenes = scenesOf(snapshot.tree).map(linking);
    const events = store.timelineNotes().map((note) => linking({ path: note.path, title: noteTitle(note.path) }));
    const links = buildWorldLinks({
      entities,
      entityVaultPath: (path) => store.vaultPathOf(path),
      scenes,
      events,
      resolve: (target, from) => this.resolveEntityLink(target, from),
    });
    this.model = {
      project: { id: snapshot.indexPath, title: snapshot.title, readOnly: snapshot.readOnly },
      folder: snapshot.folder,
      types,
      entities,
      byPath: new Map(entities.map((entity) => [pathKey(entity.path), entity])),
      scenes,
      links,
      known,
    };
    return this.model;
  }

  /** The open project; null when none is open. */
  get project(): WorldProject | null {
    return this.current()?.project ?? null;
  }

  /** False when nothing can be changed: no project is open, or it is read-only. */
  get canChange(): boolean {
    const project = this.project;
    return project !== null && !project.readOnly;
  }

  /** The types an entity can have, in the order of the list. */
  get types(): readonly EntityType[] {
    return this.current()?.types ?? [];
  }

  /** Every entity of the project, sorted by name. */
  get entities(): readonly Entity[] {
    return this.current()?.entities ?? [];
  }

  /** Who is where: the links between scenes, events and entities. */
  get links(): WorldLinks {
    return this.current()?.links ?? NO_LINKS;
  }

  /** The entity whose note is at this path (relative to the project folder), or null. */
  entity(path: string): Entity | null {
    return this.current()?.byPath.get(pathKey(path)) ?? null;
  }

  /** An entity's type; null for one whose type is not in the list. */
  typeOf(entity: Entity): EntityType | null {
    return findType(this.types, entity.typeId);
  }

  /** The title of a scene of the binder; null when the binder has no such scene. */
  sceneTitle(path: string): string | null {
    const key = pathKey(path);
    return this.current()?.scenes.find((scene) => pathKey(scene.path) === key)?.title ?? null;
  }

  // ------------------------------------------------------------------ showing

  /**
   * Show a note of the project.
   *
   * @param path  its path relative to the project folder
   * @param where what Obsidian's `Keymap.isModEvent` gives: false for the usual place, 'tab' for a new tab
   */
  async open(path: string, where: PaneType | boolean = false): Promise<void> {
    if (this.disposed) return;
    const vaultPath = this.context.store.vaultPathOf(path);
    const shown = vaultPath !== null && (await this.context.openNote(vaultPath, where));
    if (!shown) new Notice(NOT_FOUND_TEXT, PROBLEM_NOTICE_MS);
  }

  // ----------------------------------------------------------------- changing

  /** Why nothing can be changed right now, or the open project. */
  private writable(): WorldProject | string {
    if (this.disposed) return SWITCHED_OFF_TEXT;
    const project = this.project;
    if (!project) return NO_PROJECT_TEXT;
    return project;
  }

  /**
   * Make a new entity: a note in the folder of its type, with the type's
   * properties, empty, and a few headings. Nothing is replaced: a name that
   * is taken is turned down.
   *
   * @returns the new note's path relative to the project folder, or why it was not made
   */
  async createEntity(typeId: string, rawName: string): Promise<{ readonly path: string } | { readonly problem: string }> {
    const project = this.writable();
    if (typeof project === 'string') return { problem: project };
    const type = findType(this.types, typeId);
    if (!type) return { problem: NO_TYPE_TEXT };
    if (rawName.trim() === '') return { problem: NO_NAME_TEXT };
    const name = sanitiseFileName(rawName, '');
    if (name === '') return { problem: BAD_NAME_TEXT };
    const result = await this.context.store.addWorldNote(type.folder, name, newEntityFrontmatter(type), newEntityBody(type), project.id);
    this.changed();
    if (result.status === 'done') return { path: result.value.path };
    return { problem: result.message };
  }

  /**
   * Rename an entity: its note is renamed, and Obsidian brings the links to it up to date.
   *
   * @returns the note's new path, or why it was not renamed
   */
  async renameEntity(path: string, rawName: string): Promise<{ readonly path: string } | { readonly problem: string }> {
    const project = this.writable();
    if (typeof project === 'string') return { problem: project };
    if (rawName.trim() === '') return { problem: NO_NAME_TEXT };
    const name = sanitiseFileName(rawName, '');
    if (name === '') return { problem: BAD_NAME_TEXT };
    const result = await this.context.store.renameWorldNote(path, name, project.id);
    this.changed();
    if (result.status === 'done') return { path: result.value.path };
    if (result.status === 'noop' && result.reason === 'unchanged') return { path };
    return { problem: result.message };
  }

  /** Move an entity's note to the trash. The scenes that list it are left as they are. */
  async deleteEntity(path: string): Promise<string | null> {
    const project = this.writable();
    if (typeof project === 'string') return project;
    const result = await this.context.store.trashWorldNote(path, project.id);
    this.changed();
    return answerOf(result);
  }

  /**
   * The note an entry of an "entities" list leads to. A bare name is looked
   * for among this project's own world-building notes first: a vault may hold
   * two projects that each have a "Mara", and the vault alone would then lead
   * a scene of one project to the character of the other. Anything else, and
   * a name this project does not have exactly once, is left to the vault.
   */
  private resolveEntityLink(target: string, from: string): string | null {
    const { store, vault } = this.context;
    if (!target.includes('/')) {
      const wanted = target.trim().toLowerCase();
      const own = store.worldNotes().filter((note) => noteTitle(note.path).toLowerCase() === wanted);
      const only = own.length === 1 ? own[0] : undefined;
      const path = only ? store.vaultPathOf(only.path) : null;
      if (path !== null) return path;
    }
    return vault.resolveLink(target, from);
  }

  /** Whether an entry of a list, written in the note at `from`, leads to the note at `to`. */
  private leadsTo(entry: string, from: string, to: string): boolean {
    const written = parseLink(entry);
    if (written === null) return false;
    const found = this.resolveEntityLink(written.target, from);
    return found !== null && pathKey(found) === pathKey(to);
  }

  /**
   * List an entity in a scene (or a timeline event): a link to its note is
   * added to the note's "entities" property, unless one is there already.
   *
   * @param notePath   the scene's or the event's path relative to the project folder
   * @param entityPath the entity's
   */
  async link(notePath: string, entityPath: string): Promise<string | null> {
    const project = this.writable();
    if (typeof project === 'string') return project;
    const { store, vault } = this.context;
    const from = store.vaultPathOf(notePath);
    const to = store.vaultPathOf(entityPath);
    if (from === null || to === null) return NOT_FOUND_TEXT;
    const link = linkTo(noteTitle(entityPath), to, from, (target, source) => vault.resolveLink(target, source));
    let outcome: LinkChange = 'unchanged';
    const result = await store.updateNoteProperties(
      notePath,
      (frontmatter) => {
        outcome = addEntityLink(frontmatter, link, (entry) => this.leadsTo(entry, from, to));
        return outcome === 'changed';
      },
      project.id,
    );
    this.changed();
    return (outcome as LinkChange) === 'unreadable' ? UNREADABLE_LIST_TEXT : answerOf(result);
  }

  /**
   * Take an entity out of a scene's (or an event's) list.
   *
   * @param which the entry exactly as it is written, or the entity's path: every entry that leads to it goes
   */
  async unlink(notePath: string, which: { readonly raw: string } | { readonly entityPath: string }): Promise<string | null> {
    const project = this.writable();
    if (typeof project === 'string') return project;
    const { store } = this.context;
    const from = store.vaultPathOf(notePath);
    const to = 'entityPath' in which ? store.vaultPathOf(which.entityPath) : null;
    if (from === null || ('entityPath' in which && to === null)) return NOT_FOUND_TEXT;
    let outcome: LinkChange = 'unchanged';
    const result = await store.updateNoteProperties(
      notePath,
      (frontmatter) => {
        outcome = removeEntityLink(frontmatter, (entry) =>
          'raw' in which ? entry === which.raw : to !== null && this.leadsTo(entry, from, to),
        );
        return outcome === 'changed';
      },
      project.id,
    );
    this.changed();
    return (outcome as LinkChange) === 'unreadable' ? UNREADABLE_LIST_TEXT : answerOf(result);
  }

  /**
   * Change the list of types, in one read-change-save step of the project
   * index: `change` is handed the list as it is on disk at that moment.
   */
  async saveTypes(change: (types: readonly EntityType[]) => TypeEdit): Promise<string | null> {
    const project = this.writable();
    if (typeof project === 'string') return project;
    let problem: string | null = null;
    const result = await this.context.store.updateProjectData(
      ENTITY_TYPES_KEY,
      (current) => {
        problem = null;
        const edit = change(readEntityTypes(current));
        if (!edit.ok) {
          problem = edit.message;
          return current;
        }
        return writeEntityTypes(edit.types);
      },
      project.id,
    );
    this.changed();
    return problem ?? answerOf(result);
  }

  // ----------------------------------------------------------------- mentions

  /**
   * The scenes whose text names an entity (by its name or one of its other
   * names) and that do not list it, in binder order. Their texts are read
   * for this, one after the other; nothing is changed.
   */
  async findMentions(entityPath: string): Promise<FoundMention[]> {
    const model = this.current();
    const entity = model?.byPath.get(pathKey(entityPath));
    if (!model || !entity) return [];
    const names = mentionNames(entity);
    const listed = new Set(model.links.scenesOf(entity.path).map((scene) => pathKey(scene.path)));
    const found: FoundMention[] = [];
    for (const scene of model.scenes) {
      if (this.disposed) break;
      if (scene.vaultPath === null || listed.has(pathKey(scene.path))) continue;
      let text: string;
      try {
        text = await this.context.vault.readText(scene.vaultPath);
      } catch {
        continue; // a note that left in the meantime mentions nobody
      }
      const snippet = sceneMention(text, names);
      if (snippet !== null) found.push({ path: scene.path, title: scene.title, snippet });
    }
    return found;
  }
}
