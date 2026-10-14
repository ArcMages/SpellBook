// The plugin's side of the world-building screen: what the World browser,
// its windows and the inspector's "In this scene" part ask, on top of the
// project store.
//
// It works out, for the open project:
//   - the types an entity can have (from the project index);
//   - the entities: the notes in the project's World folder;
//   - the links: which entities each scene and timeline event lists in its
//     "entities" property, and so the scenes and events of each entity;
//   - the relations: which entities each entity lists in its "related"
//     property, and so who lists each entity.
// All of it is worked out when it is first asked for and kept until the
// project or one of those notes changes. Where a link leads is asked of the
// vault itself (Obsidian's own index of links), never guessed from a name.
//
// Every change goes through the project store: a new entity note, a rename,
// a note moved to the trash, a link added to or taken out of a scene's
// properties, one property of an entity's sheet, its picture, its relations,
// a changed list of types. The vault doorway is used to read and to listen,
// never to write. No note's text is ever changed.
//
// How the browser is laid out (cards or a table) is this device's own
// choice: it is kept in the device's storage, never in the project.

import { Notice } from 'obsidian';
import type { PaneType } from 'obsidian';
import type { EntityBoardService } from '../../core/boards';
import type { RenameEverywhereService } from '../../core/revision';
import { sanitiseFileName } from '../../core/names';
import { isImagePath, noteTitle, pathKey, relativeTo } from '../../core/paths';
import { entityStart, worldTemplates } from '../../core/templates';
import type { TemplateEntry } from '../../core/templates';
import { CALENDAR_KEY, readCalendar } from '../../core/timeline';
import type { StoryCalendar, StoryDate } from '../../core/timeline';
import type { Frontmatter, IntentResult, TreeNode } from '../../core/types';
import type { VaultEvent } from '../../core/vaultPort';
import {
  DATE_KEY,
  END_KEY,
  ENTITY_TYPES_KEY,
  addEntityLink,
  addMoment,
  addRelation,
  buildRelations,
  buildWorldLinks,
  changeMoment,
  checkEntityDates,
  dateWords,
  entityHistory,
  fieldText,
  findType,
  imageLink,
  linkTo,
  mentionNames,
  newEntityBody,
  newEntityFrontmatter,
  parseLink,
  parseRelation,
  readEntities,
  readEntityTime,
  readEntityTypes,
  readLayout,
  relabelRelation,
  relationTo,
  removeEntityLink,
  removeMoment,
  removeRelation,
  resolveImage,
  sceneMention,
  editAliases,
  setEntityDate,
  setEntityField,
  setImage,
  writeEntityTypes,
} from '../../core/world';
import type {
  AliasEdit,
  Entity,
  EntityHistory,
  EntityTime,
  EntityType,
  FieldChange,
  HistoryNote,
  LinkChange,
  LinkingNote,
  MentionSnippet,
  Moment,
  TimeChange,
  TypeEdit,
  WorldLayout,
  WorldLinks,
  WorldRelations,
} from '../../core/world';
import { renameWindowText, renamedLinksNotice } from '../../ui/renameLinks';
import type { FeatureContext } from '../registry';
import { NO_PROJECT_TEXT, PROBLEM_NOTICE_MS } from './parts';

export const SWITCHED_OFF_TEXT = 'Spellbook has been switched off. Nothing was changed.';
export const NO_NAME_TEXT = 'Give it a name.';
export const BAD_NAME_TEXT = 'That name has no characters that can be used in a file name.';
export const NO_TYPE_TEXT = 'That type is no longer in the list.';
export const NOT_FOUND_TEXT = 'That note is no longer in the project (it may still be syncing).';
export const UNREADABLE_LIST_TEXT =
  'The "entities" property of that note is not a list of links, so it was left as it is. Put it right in the note itself.';
export const UNREADABLE_FIELD_TEXT = 'That property holds a list or something else that is not one line of text, so it was left as it is. Change it in the note itself.';
export const UNREADABLE_ALIASES_TEXT =
  'The "aliases" property of that note is not a list of names, so it was left as it is. Put it right in the note itself.';
export const UNREADABLE_RELATED_TEXT =
  'The "related" property of that note is not a list of links, so it was left as it is. Put it right in the note itself.';
export const NOT_A_PICTURE_TEXT = 'That file is no longer in the vault, or it is not a picture.';
export const SELF_RELATION_TEXT = 'A note cannot be related to itself.';
export const UNREADABLE_MOMENTS_TEXT =
  'The "moments" property of that note is not a list, so it was left as it is. Put it right in the note itself.';

/** Where this device keeps how the browser is laid out: "cards" or "list". */
export const LAYOUT_KEY = 'spellbook-world-layout';

/** A scene or an event an entity is in, with what the sheet shows beside its title. */
export interface SheetAppearance {
  /** Path relative to the project folder. */
  readonly path: string;
  readonly title: string;
  /** A scene's synopsis, or an event's date in the story, on one line; "" for none. */
  readonly note: string;
}

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
export type WorldHostContext = Pick<FeatureContext, 'store' | 'vault' | 'clock' | 'openNote' | 'storage'>;

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
  readonly relations: WorldRelations;
  /** The properties of every note the project has, by path: for the line beside a scene or an event. */
  readonly indexed: ReadonlyMap<string, Readonly<Frontmatter> | null>;
  /** The properties of every note the model was read from, as text: for telling a change from none. */
  readonly known: ReadonlyMap<string, string>;
  /** The project's invented calendar; null for the real-world one. */
  readonly calendar: StoryCalendar | null;
  /** When each entity is, by its path: worked out the first time it is asked for. */
  readonly times: Map<string, EntityTime>;
}

const NO_LINKS: WorldLinks = { linksOf: () => [], scenesOf: () => [], eventsOf: () => [] };
const NO_RELATIONS: WorldRelations = { of: () => [], mentionedBy: () => [] };

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
  /**
   * The world notes of the open project by name (lower case), for following
   * links: worked out once and kept until something changes, because a big
   * world has thousands of links and each would otherwise list every note.
   */
  private namesIndex: { readonly project: string; readonly byName: Map<string, string[]> } | null = null;
  /** The timer of a change that is about to be told, if any. */
  private stopTelling: (() => void) | null = null;
  /** How the browser is laid out on this device; null until it is read from the device's storage. */
  private chosenLayout: WorldLayout | null = null;

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
    this.namesIndex = null;
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
    this.namesIndex = null;
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
      this.namesIndex = null;
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
    const relations = buildRelations({
      entities,
      entityVaultPath: (path) => store.vaultPathOf(path),
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
      relations,
      indexed,
      known,
      calendar: readCalendar(store.projectData(CALENDAR_KEY)).calendar,
      times: new Map(),
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

  /** Who has to do with whom: the relations between entities. */
  get relations(): WorldRelations {
    return this.current()?.relations ?? NO_RELATIONS;
  }

  /** The scenes an entity is in, in binder order, each with its synopsis on one line. */
  sceneRows(entityPath: string): SheetAppearance[] {
    const model = this.current();
    if (!model) return [];
    return model.links.scenesOf(entityPath).map((scene) => ({
      path: scene.path,
      title: scene.title,
      note: fieldText(model.indexed.get(pathKey(scene.path))?.['synopsis']),
    }));
  }

  /** The timeline events an entity is in, each with its date in the story (and the day it ends, when it lasts). */
  eventRows(entityPath: string): SheetAppearance[] {
    const model = this.current();
    if (!model) return [];
    return model.links.eventsOf(entityPath).map((event) => {
      const frontmatter = model.indexed.get(pathKey(event.path));
      const from = fieldText(frontmatter?.['date']);
      const to = fieldText(frontmatter?.['end']);
      return { path: event.path, title: event.title, note: to !== '' && from !== '' ? `${from} to ${to}` : from };
    });
  }

  /**
   * The picture of an entity, as an address an image element can show; null
   * when its note names none, or what it names is not there or not a picture.
   */
  imageOf(entity: Entity): string | null {
    if (this.disposed) return null;
    const { store, vault } = this.context;
    const from = store.vaultPathOf(entity.path);
    if (from === null) return null;
    const found = resolveImage(entity.frontmatter, from, (target, source) => vault.resolveLink(target, source));
    return found === null ? null : vault.resourceUrl(found);
  }

  /** Every picture of the vault, as vault paths, sorted: what "Choose picture" lists. */
  imageFiles(): string[] {
    return this.disposed ? [] : this.context.vault.listImageFiles();
  }

  /** The address a picture of the vault can be shown at, for the list it is chosen from; null for what is not one. */
  pictureUrl(imagePath: string): string | null {
    if (this.disposed || !isImagePath(imagePath)) return null;
    return this.context.vault.resourceUrl(imagePath);
  }

  /**
   * The entity whose note is at a vault path (the note open in the editor,
   * say), as its path relative to the project folder; null when the note is
   * not an entity of the open project.
   */
  entityPathOf(vaultPath: string): string | null {
    const model = this.current();
    const rel = model ? relativeTo(model.folder, vaultPath) : null;
    return rel !== null && model?.byPath.has(pathKey(rel)) === true ? rel : null;
  }

  /** How the browser is laid out on this device: as cards, or as a table. */
  get layout(): WorldLayout {
    if (this.chosenLayout === null) {
      let stored: unknown = null;
      try {
        stored = this.context.storage.load(LAYOUT_KEY);
      } catch {
        stored = null; // a storage that fails is ignored: the choice then lasts until Obsidian closes
      }
      this.chosenLayout = readLayout(stored);
    }
    return this.chosenLayout;
  }

  set layout(layout: WorldLayout) {
    if (this.layout === layout) return;
    this.chosenLayout = layout;
    try {
      this.context.storage.save(LAYOUT_KEY, layout);
    } catch {
      // see above
    }
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
   * The templates a new entity of a type can start from: the notes in the
   * project's Templates/World/<the type's folder>, by name. Empty when there
   * are none, or no project is open.
   */
  templatesFor(typeId: string): TemplateEntry[] {
    const type = findType(this.types, typeId);
    if (this.disposed || !type || !this.context.store.project) return [];
    return worldTemplates(this.context.store.templateNotes(), type);
  }

  /**
   * Make a new entity: a note in the folder of its type, with the type's
   * properties, empty, and a few headings; or, when a template is given,
   * with the type's properties and the template's on top, and the
   * template's text. Nothing is replaced: a name that is taken is turned down.
   *
   * @param template the path of a template (see templatesFor), relative to the project folder
   * @returns the new note's path relative to the project folder, or why it was not made
   */
  async createEntity(typeId: string, rawName: string, template?: string): Promise<{ readonly path: string } | { readonly problem: string }> {
    const project = this.writable();
    if (typeof project === 'string') return { problem: project };
    const type = findType(this.types, typeId);
    if (!type) return { problem: NO_TYPE_TEXT };
    if (rawName.trim() === '') return { problem: NO_NAME_TEXT };
    const name = sanitiseFileName(rawName, '');
    if (name === '') return { problem: BAD_NAME_TEXT };
    let frontmatter = newEntityFrontmatter(type);
    let body = newEntityBody(type);
    if (template !== undefined && template !== '') {
      // The template as it is now: it may have changed since the window was opened.
      const read = await this.context.store.readTemplate(template, 'project');
      if (read.status !== 'done') return { problem: read.message };
      const start = entityStart(frontmatter, read.value, { title: name, date: this.context.clock.today(), project: project.title });
      frontmatter = start.frontmatter;
      body = start.body;
    }
    const result = await this.context.store.addWorldNote(type.folder, name, frontmatter, body, project.id);
    this.changed();
    if (result.status === 'done') return { path: result.value.path };
    return { problem: result.message };
  }

  /**
   * Rename an entity: its note is renamed, and the store brings the links to it in the project up to date.
   *
   * @returns the note's new path, or why it was not renamed
   */
  async renameEntity(path: string, rawName: string): Promise<{ readonly path: string; readonly told?: string | null } | { readonly problem: string }> {
    const project = this.writable();
    if (typeof project === 'string') return { problem: project };
    if (rawName.trim() === '') return { problem: NO_NAME_TEXT };
    const name = sanitiseFileName(rawName, '');
    if (name === '') return { problem: BAD_NAME_TEXT };
    const result = await this.context.store.renameWorldNote(path, name, project.id);
    this.changed();
    if (result.status === 'done') return { path: result.value.path, told: renamedLinksNotice(name, result.value) };
    if (result.status === 'noop' && result.reason === 'unchanged') return { path };
    return { problem: result.message };
  }

  /** What the rename window says about the links to an entity's note: where they are changed, and how many notes outside the project keep the old name. */
  renameNote(path: string): string {
    const store = this.context.store;
    return renameWindowText(store.linkScope, store.linksFromOutside(path).length);
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
      const own = this.worldNotesNamed(target.trim().toLowerCase());
      const path = own.length === 1 ? store.vaultPathOf(own[0] as string) : null;
      if (path !== null) return path;
    }
    return vault.resolveLink(target, from);
  }

  /** The world notes of the open project whose name is `wanted` (lower case), as paths relative to the project folder. */
  private worldNotesNamed(wanted: string): readonly string[] {
    const { store } = this.context;
    const project = store.project?.indexPath ?? '';
    if (this.namesIndex === null || this.namesIndex.project !== project) {
      const byName = new Map<string, string[]>();
      for (const note of store.worldNotes()) {
        const name = noteTitle(note.path).toLowerCase();
        const list = byName.get(name);
        if (list) list.push(note.path);
        else byName.set(name, [note.path]);
      }
      this.namesIndex = { project, byName };
    }
    return this.namesIndex.byName.get(wanted) ?? [];
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

  // ---------------------------------------------------------------- the sheet

  /**
   * Set one property of an entity's note to what was typed on its sheet: a
   * field of its type, its summary, or a property the writer added. Only
   * that property changes, in the note's properties; never its text.
   *
   * @param name the property's name
   */
  async setField(entityPath: string, name: string, typed: string): Promise<string | null> {
    const project = this.writable();
    if (typeof project === 'string') return project;
    if (this.entity(entityPath) === null) return NOT_FOUND_TEXT;
    let outcome: FieldChange = 'unchanged';
    const result = await this.context.store.updateNoteProperties(
      entityPath,
      (frontmatter) => {
        outcome = setEntityField(frontmatter, name, typed);
        return outcome === 'changed';
      },
      project.id,
    );
    this.changed();
    return (outcome as FieldChange) === 'unreadable' ? UNREADABLE_FIELD_TEXT : answerOf(result);
  }

  /**
   * Change the other names of an entity by one: add a name, change one or
   * take one away. The "aliases" property of its note is written as a list,
   * starting from what the note says at the moment of writing. Only that
   * property changes; never the note's text.
   */
  async changeAliases(entityPath: string, edit: AliasEdit): Promise<string | null> {
    const project = this.writable();
    if (typeof project === 'string') return project;
    if (this.entity(entityPath) === null) return NOT_FOUND_TEXT;
    let outcome: FieldChange = 'unchanged';
    const result = await this.context.store.updateNoteProperties(
      entityPath,
      (frontmatter) => {
        outcome = editAliases(frontmatter, edit);
        return outcome === 'changed';
      },
      project.id,
    );
    this.changed();
    return (outcome as FieldChange) === 'unreadable' ? UNREADABLE_ALIASES_TEXT : answerOf(result);
  }

  /**
   * Give an entity a picture, or take its picture away (null): a link to the
   * image file is written in the note's "image" property. The picture itself
   * is never touched.
   *
   * @param imagePath the picture's vault path, as imageFiles gives it
   */
  async setPicture(entityPath: string, imagePath: string | null): Promise<string | null> {
    const project = this.writable();
    if (typeof project === 'string') return project;
    const { store, vault } = this.context;
    const from = store.vaultPathOf(entityPath);
    if (from === null || this.entity(entityPath) === null) return NOT_FOUND_TEXT;
    let link: string | null = null;
    if (imagePath !== null) {
      if (!vault.listImageFiles().includes(imagePath)) return NOT_A_PICTURE_TEXT;
      link = imageLink(imagePath, from, (target, source) => vault.resolveLink(target, source));
    }
    const result = await store.updateNoteProperties(entityPath, (frontmatter) => setImage(frontmatter, link), project.id);
    this.changed();
    return answerOf(result);
  }

  /**
   * Say that an entity has to do with another: a link to the other's note is
   * added to this one's "related" property, with a short label, unless it
   * lists the other already. Nothing is written into the other note.
   */
  async relate(entityPath: string, otherPath: string, label: string): Promise<string | null> {
    const project = this.writable();
    if (typeof project === 'string') return project;
    const { store, vault } = this.context;
    const from = store.vaultPathOf(entityPath);
    const to = store.vaultPathOf(otherPath);
    if (from === null || to === null) return NOT_FOUND_TEXT;
    if (pathKey(from) === pathKey(to)) return SELF_RELATION_TEXT;
    const entry = relationTo(noteTitle(otherPath), to, from, (target, source) => vault.resolveLink(target, source), label);
    let outcome: LinkChange = 'unchanged';
    const result = await store.updateNoteProperties(
      entityPath,
      (frontmatter) => {
        outcome = addRelation(frontmatter, entry, (written) => {
          const target = parseRelation(written)?.target;
          const found = target === undefined ? null : this.resolveEntityLink(target, from);
          return found !== null && pathKey(found) === pathKey(to);
        });
        return outcome === 'changed';
      },
      project.id,
    );
    this.changed();
    return (outcome as LinkChange) === 'unreadable' ? UNREADABLE_RELATED_TEXT : answerOf(result);
  }

  /**
   * Give one entry of an entity's "related" list another label, or take the
   * entry out (null).
   *
   * @param raw the entry exactly as it is written
   */
  async changeRelation(entityPath: string, raw: string, label: string | null): Promise<string | null> {
    const project = this.writable();
    if (typeof project === 'string') return project;
    let outcome: LinkChange = 'unchanged';
    const result = await this.context.store.updateNoteProperties(
      entityPath,
      (frontmatter) => {
        outcome = label === null ? removeRelation(frontmatter, raw) : relabelRelation(frontmatter, raw, label);
        return outcome === 'changed';
      },
      project.id,
    );
    this.changed();
    return (outcome as LinkChange) === 'unreadable' ? UNREADABLE_RELATED_TEXT : answerOf(result);
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

  // --------------------------------------------------------------------- time

  /** The project's invented calendar; null for the real-world one (and when no project is open). */
  get calendar(): StoryCalendar | null {
    return this.current()?.calendar ?? null;
  }

  /** When an entity is: its two dates and its moments, read in the project's calendar. */
  timeOf(entity: Entity): EntityTime {
    const model = this.current();
    if (!model) return readEntityTime(entity.frontmatter, null);
    const key = pathKey(entity.path);
    let time = model.times.get(key);
    if (time === undefined) {
      time = readEntityTime(entity.frontmatter, model.calendar);
      model.times.set(key, time);
    }
    return time;
  }

  /**
   * An entity's history: its own dates and moments, the timeline events
   * that list it and the scenes it is in, in order of time, with whatever
   * has no date after.
   */
  historyOf(entity: Entity): EntityHistory {
    const model = this.current();
    const note = (appearance: { readonly path: string; readonly title: string }): HistoryNote => ({
      path: appearance.path,
      title: appearance.title,
      frontmatter: model?.indexed.get(pathKey(appearance.path)) ?? null,
    });
    return entityHistory({
      entityPath: entity.path,
      time: this.timeOf(entity),
      words: dateWords(this.typeOf(entity)),
      events: this.links.eventsOf(entity.path).map(note),
      scenes: this.links.scenesOf(entity.path).map(note),
      calendar: model?.calendar ?? null,
    });
  }

  /** One read-change-save step on an entity's dates or moments: only what `change` touches is written. */
  private async changeTime(entityPath: string, change: (frontmatter: Frontmatter) => TimeChange): Promise<string | null> {
    const project = this.writable();
    if (typeof project === 'string') return project;
    if (this.entity(entityPath) === null) return NOT_FOUND_TEXT;
    let outcome: TimeChange = 'unchanged';
    const result = await this.context.store.updateNoteProperties(
      entityPath,
      (frontmatter) => {
        outcome = change(frontmatter);
        return outcome === 'changed';
      },
      project.id,
    );
    this.changed();
    return (outcome as TimeChange) === 'unreadable' ? UNREADABLE_MOMENTS_TEXT : answerOf(result);
  }

  /**
   * Set when an entity begins ("date") or ends ("end"), or take that date
   * away (null). Only that one property of the note changes. An end that is
   * not later than the beginning is turned down.
   */
  async setDate(entityPath: string, key: typeof DATE_KEY | typeof END_KEY, date: StoryDate | null): Promise<string | null> {
    const entity = this.entity(entityPath);
    if (entity !== null && date !== null) {
      const time = this.timeOf(entity);
      const problem = checkEntityDates(key === DATE_KEY ? date : time.start, key === END_KEY ? date : time.end, dateWords(this.typeOf(entity)));
      if (problem !== null) return problem;
    }
    return this.changeTime(entityPath, (frontmatter) => setEntityDate(frontmatter, key, date));
  }

  /** Add a moment to an entity: a date and a short label, at the end of its "moments" list. */
  addMoment(entityPath: string, date: StoryDate, label: string): Promise<string | null> {
    return this.changeTime(entityPath, (frontmatter) => addMoment(frontmatter, date, label));
  }

  /** Give one moment of an entity another date or label, or take it out of the list (null). */
  changeMoment(entityPath: string, moment: Moment, to: { readonly date: StoryDate; readonly label: string } | null): Promise<string | null> {
    return this.changeTime(entityPath, (frontmatter) =>
      to === null ? removeMoment(frontmatter, moment.index, moment.text) : changeMoment(frontmatter, moment.index, moment.text, to.date, to.label),
    );
  }

  /** Set by the feature: opens the timeline as the history of the world. Null while no timeline offers it. */
  showWorldHistory: (() => boolean) | null = null;

  /** Set by the feature: what draws a board around an entity, asked for each time; null while no feature offers it. */
  entityBoard: () => EntityBoardService | null = () => null;

  /** Set by the feature: what renames an entity everywhere, asked for each time; null while no feature offers it. */
  renameEverywhere: () => RenameEverywhereService | null = () => null;

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
