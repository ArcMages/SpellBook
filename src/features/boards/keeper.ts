// The plugin's side of the idea boards: what the Boards pane, the windows
// and the commands ask, on top of the project store.
//
// It knows, for the open project:
//   - its boards (the Canvas files in its Boards folder) and how many cards
//     each has (read once, and again when the file changes);
//   - what a drawn board is made of: the world's entities and relations,
//     the binder's scenes, their statuses and labels.
// It makes boards, renames them and moves them to the trash, and turns a
// board's text cards into scenes or entities. Every change goes through the
// project store; the vault doorway is used to read and to listen, never to
// write. No note's text is ever changed.

import { formatCount } from '../../core/binderModel';
import {
  BOARDS_FOLDER,
  BOARD_EXTENSION,
  EMPTY_BOARD_TEXT,
  cardNoteName,
  chapterCards,
  countCards,
  entityWeb,
  oneLine,
  readBoard,
  relationMap,
  splitCardText,
  swapCards,
  textCards,
  writeBoard,
} from '../../core/boards';
import type { CardChoice, CardSwap, MapEntity, MapRelation, NewBoard, ReadCard, SceneGroup, WebEntity } from '../../core/boards';
import { TAG_INDEX_KEYS, readSceneFields, readTagLists } from '../../core/cards';
import type { CardColor } from '../../core/cards';
import { sanitiseFileName, uniqueName } from '../../core/names';
import { clashKey, joinPath, noteTitle, pathKey, relativeTo } from '../../core/paths';
import type { Frontmatter, IntentResult, Placement, TreeNode } from '../../core/types';
import type { VaultEvent } from '../../core/vaultPort';
import {
  ENTITY_TYPES_KEY,
  SUMMARY_KEY,
  WORLD_FOLDER,
  buildRelations,
  buildWorldLinks,
  findType,
  newEntityBody,
  newEntityFrontmatter,
  readEntities,
  readEntityTypes,
} from '../../core/world';
import type { Entity, EntityType, LinkingNote, WorldLinks, WorldRelations } from '../../core/world';
import type { FeatureContext } from '../registry';

export const NO_PROJECT_TEXT = 'Open a Spellbook project first.';
export const READ_ONLY_TEXT = 'This project cannot be changed right now: its index note could not be read.';
export const SWITCHED_OFF_TEXT = 'Spellbook has been switched off. Nothing was changed.';
export const NO_NAME_TEXT = 'Give the board a name.';
export const BAD_NAME_TEXT = 'That name has no characters that can be used in a file name.';
export const UNREADABLE_BOARD_TEXT = 'This board could not be read. It may still be syncing, or it is not a Canvas file Spellbook understands.';
export const NO_ENTITIES_TEXT = 'The World has no entities of those types yet.';
export const NO_SCENES_TEXT = 'That part of the binder has no scenes yet.';
export const NOT_AN_ENTITY_TEXT = 'That entity is no longer in the project.';
/** What a group of scenes without a status or a label is called on a chapter board. */
export const NO_STATUS_TEXT = 'No status';
export const NO_LABEL_TEXT = 'No label';
export const WHOLE_MANUSCRIPT_TEXT = 'Whole manuscript';
export const SCENES_BOX_TEXT = 'Scenes';
export const EVENTS_BOX_TEXT = 'Events';
export const RELATIONSHIP_MAP_NAME = 'Relationship map';

/** The parts of the feature context the keeper is built on. */
export type KeeperContext = Pick<FeatureContext, 'store' | 'vault' | 'clock' | 'openNote'>;

/** One board of the project, as the Boards pane lists it. */
export interface BoardInfo {
  /** Path relative to the project folder: "Boards/<name>.canvas". */
  readonly path: string;
  /** The board's name: the writer's own text. */
  readonly name: string;
  /** How many cards it has; null while it has not been read, or when it cannot be. */
  readonly cards: number | null;
}

/** The open project, as the boards need it. */
export interface BoardsProject {
  readonly id: string;
  readonly title: string;
  readonly folder: string;
  readonly readOnly: boolean;
}

/** A place in the binder new scenes can go: the end of the binder, or the end of a folder. */
export interface SceneFolder {
  /** The folder's id; null for the top level. */
  readonly parentId: string | null;
  /** "Part one / Chapter 2"; the writer's own text. */
  readonly label: string;
}

/** How a chapter board groups its scenes. */
export type GroupBy = 'status' | 'label' | 'none';

/** A card of a board and what the writer chose for it. */
export interface CardDecision {
  readonly card: ReadCard;
  readonly choice: CardChoice;
}

/** What turning cards into notes did. */
export interface Conversion {
  /** The notes made, as paths relative to the project folder. */
  readonly made: readonly string[];
  /** How many cards on the board now point at their new notes. */
  readonly swapped: number;
  /** What went wrong, one sentence each; empty when all went well. */
  readonly problems: readonly string[];
}

/** A finished request: what it gave, or why not. */
export type Outcome<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly message: string };

const fail = <T>(message: string): Outcome<T> => ({ ok: false, message });

/** "1 card", "12 cards". */
export function describeCards(count: number): string {
  return `${formatCount(count)} ${count === 1 ? 'card' : 'cards'}`;
}

/** What a board is called: its file name without ".canvas". */
export function boardName(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const ending = `.${BOARD_EXTENSION}`;
  return name.toLowerCase().endsWith(ending) ? name.slice(0, -ending.length) : name;
}

/** The message of a request that was not done; null when it was (or there was nothing to do). */
function problemOf(result: IntentResult<unknown>): string | null {
  if (result.status === 'done') return null;
  if (result.status === 'noop' && result.reason === 'unchanged') return null;
  return result.message;
}

/** The scenes of a binder tree, in order, with their paths; scenes whose note is missing are left out. */
function scenesOf(tree: readonly TreeNode[], into: Array<{ path: string; title: string }> = []): Array<{ path: string; title: string }> {
  for (const node of tree) {
    if (node.kind === 'folder') scenesOf(node.children, into);
    else if (!node.missing) into.push({ path: node.path, title: node.title });
  }
  return into;
}

/** The world of the open project, worked out when a board needs it. */
interface World {
  readonly types: readonly EntityType[];
  readonly entities: readonly Entity[];
  readonly links: WorldLinks;
  readonly relations: WorldRelations;
}

export class BoardKeeper {
  private readonly context: KeeperContext;
  private disposed = false;
  private readonly listening = new Set<() => void>();
  private readonly stops: Array<() => void> = [];
  private stopTelling: (() => void) | null = null;
  /** How many cards each board has, by its path; worked out when the pane asks. */
  private readonly counts = new Map<string, number | null>();
  private readonly counting = new Set<string>();
  /** The project the counts belong to. */
  private countsOf: string | null = null;

  constructor(context: KeeperContext) {
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

  /** The plugin is being switched off. */
  release(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const stop of this.stops.splice(0)) stop();
    this.stopTelling?.();
    this.stopTelling = null;
    this.counts.clear();
    for (const listener of [...this.listening]) listener();
    this.listening.clear();
  }

  get isReleased(): boolean {
    return this.disposed;
  }

  /** Be told when the boards may have changed. Returns the function that stops it. */
  onChange(listener: () => void): () => void {
    if (this.disposed) return () => undefined;
    this.listening.add(listener);
    return () => {
      this.listening.delete(listener);
    };
  }

  private changed(): void {
    if (this.disposed || this.stopTelling !== null || this.listening.size === 0) return;
    this.stopTelling = this.context.clock.setTimer(() => {
      this.stopTelling = null;
      if (this.disposed) return;
      for (const listener of [...this.listening]) {
        try {
          listener();
        } catch (error) {
          console.error('Spellbook: the boards could not be brought up to date', error);
        }
      }
    }, 0);
  }

  private onVaultEvent(event: VaultEvent): void {
    if (this.disposed) return;
    if (event.type === 'refresh') {
      this.counts.clear();
      this.changed();
      return;
    }
    if (event.type === 'metadata') return;
    const folder = this.context.store.project?.folder;
    if (folder === undefined) return;
    const boards = joinPath(folder, BOARDS_FOLDER);
    const paths = event.type === 'rename' ? [event.path, event.oldPath] : [event.path];
    let touched = false;
    for (const path of paths) {
      const rel = relativeTo(folder, path);
      if (rel === null || (path !== boards && relativeTo(boards, path) === null)) continue;
      touched = true;
      this.counts.delete(pathKey(rel));
    }
    if (touched) this.changed();
  }

  // ------------------------------------------------------------------ reading

  /** The open project; null when none is open. */
  get project(): BoardsProject | null {
    if (this.disposed) return null;
    const snapshot = this.context.store.project;
    if (!snapshot) return null;
    return { id: snapshot.indexPath, title: snapshot.title, folder: snapshot.folder, readOnly: snapshot.readOnly };
  }

  /** Why nothing can be changed now; null when it can. */
  whyNotWritable(): string | null {
    if (this.disposed) return SWITCHED_OFF_TEXT;
    const project = this.project;
    if (!project) return NO_PROJECT_TEXT;
    if (project.readOnly) return READ_ONLY_TEXT;
    return null;
  }

  /** The boards of the open project, by name, with their card counts as far as they are known. */
  boards(): BoardInfo[] {
    const project = this.project;
    if (!project) return [];
    if (this.countsOf !== project.id) {
      this.counts.clear();
      this.countsOf = project.id;
    }
    return this.context.store
      .boardFiles()
      .map((path) => ({ path, name: boardName(path), cards: this.counts.get(pathKey(path)) ?? null }))
      .sort((a, b) => a.name.localeCompare(b.name) || (a.path < b.path ? -1 : 1));
  }

  /** Read the boards whose cards have not been counted yet; the listeners are told when counts arrive. */
  countCards(): void {
    const project = this.project;
    if (!project) return;
    for (const path of this.context.store.boardFiles()) {
      const key = pathKey(path);
      if (this.counts.has(key) || this.counting.has(key)) continue;
      this.counting.add(key);
      void this.context.store.readBoardFile(path).then((result) => {
        this.counting.delete(key);
        if (this.disposed || this.project?.id !== project.id) return;
        const board = result.status === 'done' ? readBoard(result.value) : null;
        this.counts.set(key, board === null ? null : countCards(board));
        this.changed();
      });
    }
  }

  /** The board a file of the vault is, as its path relative to the project folder; null when it is no board of the open project. */
  boardAt(vaultPath: string): string | null {
    const project = this.project;
    const rel = project ? relativeTo(project.folder, vaultPath) : null;
    if (rel === null) return null;
    const key = pathKey(rel);
    return this.context.store.boardFiles().find((path) => pathKey(path) === key) ?? null;
  }

  /** The text cards of a board, in reading order; why not, when it cannot be read. */
  async textCardsOf(path: string): Promise<Outcome<ReadCard[]>> {
    const result = await this.context.store.readBoardFile(path);
    if (result.status !== 'done') return fail(result.message);
    const board = readBoard(result.value);
    if (board === null) return fail(UNREADABLE_BOARD_TEXT);
    return { ok: true, value: textCards(board) };
  }

  /** Where new scenes can go: the end of the binder, then every folder in binder order. */
  sceneFolders(): SceneFolder[] {
    const tree = this.context.store.project?.tree ?? [];
    const choices: SceneFolder[] = [{ parentId: null, label: 'End of the binder' }];
    const walk = (nodes: readonly TreeNode[], trail: readonly string[]): void => {
      for (const node of nodes) {
        if (node.kind !== 'folder') continue;
        const names = [...trail, node.name];
        choices.push({ parentId: node.id, label: names.join(' / ') });
        walk(node.children, names);
      }
    };
    walk(tree, []);
    return choices;
  }

  /** The types an entity can have, in the order of the list. */
  types(): readonly EntityType[] {
    return this.project ? readEntityTypes(this.context.store.projectData(ENTITY_TYPES_KEY)) : [];
  }

  /** Every entity of the project, sorted by name. */
  entities(): readonly Entity[] {
    return this.project ? readEntities(this.context.store.worldNotes(), this.types()) : [];
  }

  /** The entity whose note is at a vault path; null when it is no entity of the open project. */
  entityAt(vaultPath: string): Entity | null {
    const project = this.project;
    const rel = project ? relativeTo(project.folder, vaultPath) : null;
    if (rel === null) return null;
    const key = pathKey(rel);
    return this.entities().find((entity) => pathKey(entity.path) === key) ?? null;
  }

  private world(): World {
    const { store } = this.context;
    const types = this.types();
    const entities = readEntities(store.worldNotes(), types);
    const indexed = new Map(store.projectNotes().map((note) => [pathKey(note.path), note.frontmatter]));
    const linking = (note: { path: string; title: string }): LinkingNote => ({
      path: note.path,
      title: note.title,
      vaultPath: store.vaultPathOf(note.path),
      frontmatter: indexed.get(pathKey(note.path)) ?? null,
    });
    const scenes = scenesOf(store.project?.tree ?? []).map(linking);
    const events = store.timelineNotes().map((note) => linking({ path: note.path, title: noteTitle(note.path) }));
    const resolve = (target: string, from: string): string | null => this.resolveEntityLink(entities, target, from);
    return {
      types,
      entities,
      links: buildWorldLinks({ entities, entityVaultPath: (path) => store.vaultPathOf(path), scenes, events, resolve }),
      relations: buildRelations({ entities, entityVaultPath: (path) => store.vaultPathOf(path), resolve }),
    };
  }

  /**
   * Where a link in an entity's list leads: a bare name is looked for among
   * this project's own entities first (as the World browser does), anything
   * else is left to the vault.
   */
  private resolveEntityLink(entities: readonly Entity[], target: string, from: string): string | null {
    const { store, vault } = this.context;
    if (!target.includes('/')) {
      const wanted = target.trim().toLowerCase();
      const own = entities.filter((entity) => noteTitle(entity.path).toLowerCase() === wanted);
      const only = own.length === 1 ? own[0] : undefined;
      const path = only ? store.vaultPathOf(only.path) : null;
      if (path !== null) return path;
    }
    return vault.resolveLink(target, from);
  }

  // ----------------------------------------------------------------- changing

  /**
   * Make a new, empty board. Nothing is replaced: a name that is taken is turned down.
   *
   * @returns the new board's path relative to the project folder, or why it was not made
   */
  async create(rawName: string): Promise<Outcome<string>> {
    const blocked = this.whyNotWritable();
    if (blocked !== null) return fail(blocked);
    if (rawName.trim() === '') return fail(NO_NAME_TEXT);
    const name = sanitiseFileName(rawName, '');
    if (name === '') return fail(BAD_NAME_TEXT);
    const result = await this.context.store.createBoardFile(name, EMPTY_BOARD_TEXT, this.project?.id);
    this.changed();
    return result.status === 'done' ? { ok: true, value: result.value.path } : fail(result.message);
  }

  /**
   * Make a new board that was drawn for the writer, under the first free
   * name of "<name>", "<name> 2", "<name> 3"... Nothing is ever replaced.
   */
  async createDrawn(baseName: string, board: NewBoard): Promise<Outcome<string>> {
    const blocked = this.whyNotWritable();
    const project = this.project;
    if (blocked !== null || !project) return fail(blocked ?? NO_PROJECT_TEXT);
    const base = sanitiseFileName(baseName, 'Board');
    const text = writeBoard(board);
    const taken = (candidate: string): boolean =>
      this.context.vault.exists(joinPath(project.folder, BOARDS_FOLDER, `${candidate}.${BOARD_EXTENSION}`));
    // A board of the same name may arrive from another device in the meantime: then the next name is tried.
    for (let attempt = 0; attempt < 5; attempt++) {
      const name = uniqueName(base, taken);
      const result = await this.context.store.createBoardFile(name, text, project.id);
      if (result.status === 'done') {
        this.changed();
        return { ok: true, value: result.value.path };
      }
      if (result.status !== 'refused' || result.reason !== 'exists') return fail(result.message);
    }
    return fail(`There are boards of every name like "${base}" already.`);
  }

  /** Rename a board. */
  async renameBoard(path: string, rawName: string): Promise<Outcome<string>> {
    const blocked = this.whyNotWritable();
    if (blocked !== null) return fail(blocked);
    if (rawName.trim() === '') return fail(NO_NAME_TEXT);
    const name = sanitiseFileName(rawName, '');
    if (name === '') return fail(BAD_NAME_TEXT);
    const result = await this.context.store.renameBoardFile(path, name, this.project?.id);
    this.changed();
    if (result.status === 'done') return { ok: true, value: result.value.path };
    if (result.status === 'noop' && result.reason === 'unchanged') return { ok: true, value: path };
    return fail(result.message);
  }

  /** Move a board to the trash. Resolves with null when done, or why not. */
  async trashBoard(path: string): Promise<string | null> {
    const blocked = this.whyNotWritable();
    if (blocked !== null) return blocked;
    const result = await this.context.store.trashBoardFile(path, this.project?.id);
    this.changed();
    return problemOf(result);
  }

  /** Show a board (or any note of the project) in the main area. */
  async open(path: string, where: boolean | 'tab' | 'split' | 'window' = false): Promise<boolean> {
    const project = this.project;
    if (!project) return false;
    return this.context.openNote(joinPath(project.folder, path), where);
  }

  // ------------------------------------------------------- cards into notes

  /**
   * Turn text cards of a board into notes: each card chosen as a scene
   * becomes a new scene (its first line the title, the rest the synopsis) at
   * the end of the binder or of the folder given; each chosen as an entity
   * becomes a new note of that type in the World (its first line the name,
   * the rest the summary). Then, in one change of the board as it is on disk
   * at that moment, each card that became a note is replaced by a file card
   * pointing at it, in the same place, of the same size and colour, with the
   * same id, so its edges stay. A card left as it is stays a text card.
   */
  async convert(boardPath: string, decisions: readonly CardDecision[], parentId: string | null): Promise<Outcome<Conversion>> {
    const blocked = this.whyNotWritable();
    const project = this.project;
    if (blocked !== null || !project) return fail(blocked ?? NO_PROJECT_TEXT);
    const types = this.types();
    const made: string[] = [];
    const swaps: CardSwap[] = [];
    const problems: string[] = [];
    for (const { card, choice } of decisions) {
      if (choice.kind === 'keep') continue;
      if (this.disposed || this.project?.id !== project.id) {
        problems.push('The project was closed before every card was turned into a note.');
        break;
      }
      const note = choice.kind === 'scene' ? await this.makeScene(card, parentId, project.id) : await this.makeEntity(card, choice.typeId, types, project);
      if (!note.ok) {
        problems.push(note.message);
        continue;
      }
      made.push(note.value);
      swaps.push({ id: card.id, file: joinPath(project.folder, note.value) });
    }
    let swapped = 0;
    if (swaps.length > 0) {
      let missing: readonly string[] = [];
      const result = await this.context.store.updateBoardFile(
        boardPath,
        (current) => {
          const swap = swapCards(current, swaps);
          swapped = swap.swapped.length;
          missing = swap.missing;
          return swap.text;
        },
        project.id,
      );
      const problem = problemOf(result);
      if (problem !== null) {
        swapped = 0;
        problems.push(`The notes were made, but the board could not be changed: ${problem}`);
      } else if (missing.length > 0) {
        problems.push(`${describeCards(missing.length)} had already left the board, so ${missing.length === 1 ? 'its note was' : 'their notes were'} made but not put on it.`);
      }
    }
    this.changed();
    return { ok: true, value: { made, swapped, problems } };
  }

  private async makeScene(card: ReadCard, parentId: string | null, projectId: string): Promise<Outcome<string>> {
    const { title, rest } = splitCardText(card.text);
    const placement: Placement = { at: 'end', parentId };
    const added = await this.context.store.addScene(title, placement, projectId);
    if (added.status !== 'done') return fail(added.message);
    const path = added.value.path;
    if (rest !== '') {
      const saved = await this.context.store.updateNoteProperties(
        path,
        (frontmatter: Frontmatter) => {
          frontmatter['synopsis'] = rest;
          return true;
        },
        projectId,
      );
      const problem = problemOf(saved);
      if (problem !== null) return fail(`The scene "${noteTitle(path)}" was made, but its synopsis could not be saved: ${problem}`);
    }
    return { ok: true, value: path };
  }

  private async makeEntity(card: ReadCard, typeId: string, types: readonly EntityType[], project: BoardsProject): Promise<Outcome<string>> {
    const type = findType(types, typeId);
    if (!type) return fail('That type is no longer in the list.');
    const { title, rest } = splitCardText(card.text);
    const base = cardNoteName(title, type.name);
    const directory = type.folder === '' ? WORLD_FOLDER : `${WORLD_FOLDER}/${type.folder}`;
    const frontmatter: Frontmatter = { ...newEntityFrontmatter(type), [SUMMARY_KEY]: oneLine(rest) };
    const taken = (candidate: string): boolean => this.context.vault.exists(joinPath(project.folder, directory, `${candidate}.md`));
    for (let attempt = 0; attempt < 5; attempt++) {
      const name = uniqueName(base, taken);
      const result = await this.context.store.addWorldNote(type.folder, name, frontmatter, newEntityBody(type), project.id);
      if (result.status === 'done') return { ok: true, value: result.value.path };
      if (result.status !== 'refused' || result.reason !== 'exists') return fail(result.message);
    }
    return fail(`There are notes of every name like "${base}" already.`);
  }

  // ------------------------------------------------------------ drawn boards

  /**
   * A relationship map of the entities of the types given (all of them when
   * the list is empty): what it holds, and the name to give it.
   */
  relationshipMap(typeIds: readonly string[]): Outcome<{ name: string; board: NewBoard }> {
    if (!this.project) return fail(NO_PROJECT_TEXT);
    const world = this.world();
    const wanted = new Set(typeIds);
    const chosen = world.entities.filter((entity) => wanted.size === 0 || (entity.typeId !== null && wanted.has(entity.typeId)));
    const placed: MapEntity[] = [];
    for (const entity of chosen) {
      const file = this.context.store.vaultPathOf(entity.path);
      if (file !== null) placed.push({ key: entity.path, file, color: this.colorOf(world, entity) });
    }
    if (placed.length === 0) return fail(NO_ENTITIES_TEXT);
    const relations: MapRelation[] = [];
    for (const entity of placed) {
      for (const relation of world.relations.of(entity.key)) {
        if (relation.entity !== null) relations.push({ from: entity.key, to: relation.entity.path, label: relation.label });
      }
    }
    return { ok: true, value: { name: RELATIONSHIP_MAP_NAME, board: relationMap(placed, relations) } };
  }

  /**
   * The scenes of a part of the binder as cards, grouped: what the board
   * holds, and the name to give it.
   *
   * @param folderId a binder folder's id; null for the whole manuscript
   */
  chapterBoard(folderId: string | null, groupBy: GroupBy): Outcome<{ name: string; board: NewBoard }> {
    const snapshot = this.context.store.project;
    if (!snapshot || this.disposed) return fail(NO_PROJECT_TEXT);
    let nodes: readonly TreeNode[] = snapshot.tree;
    let name = WHOLE_MANUSCRIPT_TEXT;
    if (folderId !== null) {
      const folder = findFolder(snapshot.tree, folderId);
      if (!folder) return fail('That folder is no longer in the binder.');
      nodes = folder.children;
      name = folder.name;
    }
    const scenes = scenesOf(nodes);
    if (scenes.length === 0) return fail(NO_SCENES_TEXT);
    const indexed = new Map(this.context.store.projectNotes().map((note) => [pathKey(note.path), note.frontmatter]));
    const lists = readTagLists({
      [TAG_INDEX_KEYS.status]: this.context.store.projectData(TAG_INDEX_KEYS.status),
      [TAG_INDEX_KEYS.label]: this.context.store.projectData(TAG_INDEX_KEYS.label),
    });
    const list = groupBy === 'label' ? lists.labels : lists.statuses;
    const groups = new Map<string, { name: string | null; color: CardColor | null; scenes: string[] }>();
    const order: string[] = [];
    if (groupBy !== 'none') {
      for (const tag of list.tags) {
        const key = tag.name.toLowerCase();
        groups.set(key, { name: tag.name, color: tag.color, scenes: [] });
        order.push(key);
      }
    }
    const none = groupBy === 'label' ? NO_LABEL_TEXT : NO_STATUS_TEXT;
    for (const scene of scenes) {
      const file = this.context.store.vaultPathOf(scene.path);
      if (file === null) continue;
      const fields = readSceneFields(indexed.get(pathKey(scene.path)) ?? null);
      const value = groupBy === 'status' ? fields.status : groupBy === 'label' ? fields.label : null;
      const key = groupBy === 'none' ? '' : value === null ? '\n' : value.toLowerCase();
      let group = groups.get(key);
      if (!group) {
        group = { name: groupBy === 'none' ? null : (value ?? none), color: null, scenes: [] };
        groups.set(key, group);
        order.push(key);
      }
      group.scenes.push(file);
    }
    // The scenes without a status or a label come last.
    const keys = [...order.filter((key) => key !== '\n'), ...order.filter((key) => key === '\n')];
    const sceneGroups: SceneGroup[] = [];
    for (const key of keys) {
      const group = groups.get(key);
      if (group !== undefined && group.scenes.length > 0) sceneGroups.push(group);
    }
    return { ok: true, value: { name: `${name} as cards`, board: chapterCards(sceneGroups) } };
  }

  /** A board around one entity: what it holds, and the name to give it. */
  entityBoard(entityPath: string): Outcome<{ name: string; board: NewBoard }> {
    if (!this.project) return fail(NO_PROJECT_TEXT);
    const world = this.world();
    const key = pathKey(entityPath);
    const entity = world.entities.find((candidate) => pathKey(candidate.path) === key);
    const file = entity ? this.context.store.vaultPathOf(entity.path) : null;
    if (!entity || file === null) return fail(NOT_AN_ENTITY_TEXT);

    const related = new Map<string, { entity: Entity; out: string | null; back: string | null }>();
    for (const relation of world.relations.of(entity.path)) {
      const other = relation.entity;
      if (other === null || other.path === entity.path) continue;
      const known = related.get(pathKey(other.path)) ?? { entity: other, out: null, back: null };
      known.out = known.out === null || known.out === '' ? relation.label : known.out;
      related.set(pathKey(other.path), known);
    }
    for (const back of world.relations.mentionedBy(entity.path)) {
      if (back.entity.path === entity.path) continue;
      const known = related.get(pathKey(back.entity.path)) ?? { entity: back.entity, out: null, back: null };
      known.back = known.back === null || known.back === '' ? back.label : known.back;
      related.set(pathKey(back.entity.path), known);
    }
    // An entity that lists it back without having been listed: its own relations say so.
    for (const known of related.values()) {
      if (known.back !== null) continue;
      const back = world.relations.of(known.entity.path).find((relation) => relation.entity?.path === entity.path);
      if (back) known.back = back.label;
    }
    const ring: WebEntity[] = [];
    for (const known of related.values()) {
      const other = this.context.store.vaultPathOf(known.entity.path);
      if (other === null) continue;
      const labels = [known.out, known.back].filter((label): label is string => label !== null && label !== '');
      const label = labels.length === 2 && clashKey(labels[0] ?? '') === clashKey(labels[1] ?? '') ? (labels[0] ?? '') : labels.join(' / ');
      const way = known.out !== null && known.back !== null ? 'both' : known.out !== null ? 'out' : 'in';
      ring.push({ file: other, color: this.colorOf(world, known.entity), label, way });
    }
    const vault = (paths: readonly { path: string }[]): string[] =>
      paths.map((note) => this.context.store.vaultPathOf(note.path)).filter((path): path is string => path !== null);
    const board = entityWeb({
      center: { file, color: this.colorOf(world, entity) },
      related: ring,
      scenes: vault(world.links.scenesOf(entity.path)),
      events: vault(world.links.eventsOf(entity.path)),
      sceneLabel: SCENES_BOX_TEXT,
      eventLabel: EVENTS_BOX_TEXT,
    });
    return { ok: true, value: { name: `Around ${entity.name}`, board } };
  }

  private colorOf(world: World, entity: Entity): CardColor | null {
    return findType(world.types, entity.typeId)?.color ?? null;
  }
}

/** The binder folder with an id, wherever it is in the tree. */
function findFolder(tree: readonly TreeNode[], id: string): Extract<TreeNode, { kind: 'folder' }> | null {
  for (const node of tree) {
    if (node.kind !== 'folder') continue;
    if (node.id === id) return node;
    const inside = findFolder(node.children, id);
    if (inside) return inside;
  }
  return null;
}
