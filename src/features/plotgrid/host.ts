// The plugin's side of the plot grid: what the grid asks, on top of the
// project store.
//
// It works out, from the open project as the store and the vault's index
// know it, which scene is in which column, and it makes the one change a tap
// asks for. It follows the store and the vault only while a grid is open, and
// lets go of everything it kept when the last one closes.
//
// Every change goes through the project store, and changes one property of
// one scene: "timelines" for a lane, "label" for a label, "entities" for a
// World entity. The vault doorway is used to read and to listen, never to write.

import { Notice } from 'obsidian';
import type { PaneType } from 'obsidian';
import { TAG_INDEX_KEYS, applyFrontmatterPatch as applyCardPatch, inspectorPatch, isEmptyPatch as isEmptyCardPatch, readSceneFields, readTagLists } from '../../core/cards';
import type { CardColor, CardLists } from '../../core/cards';
import { noteTitle, pathKey, relativeTo } from '../../core/paths';
import {
  COLUMN_KIND_NAMES,
  DEFAULT_PREFS,
  buildPlotGrid,
  chosenOf,
  entityColumns,
  foldedOf,
  labelColumns,
  laneColumns,
  lanePatch,
  movePrefs,
  projectFirstResolver,
  readPrefs,
  renameChosen,
  sceneHasEntity,
  sceneHasLabel,
  sceneInLane,
  sceneLabel,
  withChosen,
  withFolded,
  writePrefs,
} from '../../core/plotgrid';
import type { ColumnKind, PlotColumn, PlotGrid, PlotGridPrefs } from '../../core/plotgrid';
import { applyFrontmatterPatch, isEmptyPatch, readLanes } from '../../core/timeline';
import type { Lane } from '../../core/timeline';
import type { Frontmatter, IntentResult, TreeNode } from '../../core/types';
import type { VaultEvent } from '../../core/vaultPort';
import {
  ENTITY_TYPES_KEY,
  addEntityLink,
  buildWorldLinks,
  linkTo,
  parseLink,
  readEntities,
  readEntityTypes,
  removeEntityLink,
} from '../../core/world';
import type { Entity, EntityType, LinkChange, WorldLinks } from '../../core/world';
import { MISSING_LABEL } from '../../ui/missingNote';
import type { FeatureContext } from '../registry';

/** Where this device remembers the grid. */
export const PREFS_KEY = 'spellbook-plotgrid';

/** The key of the project index that lists the timeline's lanes. */
const LANES_KEY = 'timelines';

/** How long a notice about something that went wrong stays up, in milliseconds. */
export const PROBLEM_NOTICE_MS = 10000;

export const SWITCHED_OFF_TEXT = 'Spellbook has been switched off. Nothing was changed.';
export const NO_PROJECT_OPEN_TEXT = 'No project is open. Nothing was changed.';
export const READ_ONLY_TEXT = 'This project is read-only. Nothing was changed.';
export const NO_SUCH_COLUMN_TEXT = 'That column is no longer there. Nothing was changed.';
export const MISSING_SCENE_TEXT = 'That scene has no note. Nothing was changed.';
export const UNREADABLE_ENTITIES_TEXT =
  'The "entities" property of that scene is not a list, so it was left as it is. Put it right by hand first.';

/** The open project, as the grid needs it. */
export interface PlotGridProject {
  readonly id: string;
  readonly title: string;
  readonly readOnly: boolean;
}

/** An entity as the picker lists it. */
export interface PickableEntity {
  readonly path: string;
  readonly name: string;
  readonly typeName: string;
  readonly color: CardColor | null;
  readonly icon: string | null;
}

export type PlotGridHostContext = Pick<FeatureContext, 'store' | 'vault' | 'storage' | 'clock' | 'openNote'>;

/** The open project, worked out once for every change of it. */
interface Model {
  readonly project: PlotGridProject;
  readonly folder: string;
  readonly tree: readonly TreeNode[];
  /** The properties of every note of the project, by path key (relative to the project folder). */
  readonly notes: ReadonlyMap<string, Readonly<Frontmatter> | null>;
  /** Every lane the project index lists, the built-in ones included when it lists them. */
  readonly lanes: readonly Lane[];
  readonly lanesValue: unknown;
  readonly lists: CardLists;
  readonly types: readonly EntityType[];
  readonly entities: readonly Entity[];
  /** Built when it is first asked for. */
  links: WorldLinks | null;
}

function answerOf(result: IntentResult<unknown>): string | null {
  if (result.status === 'done') {
    if (result.warning !== undefined) new Notice(result.warning, PROBLEM_NOTICE_MS);
    return null;
  }
  if (result.status === 'noop' && result.reason === 'unchanged') return null;
  return result.message;
}

function scenePaths(tree: readonly TreeNode[], into: string[] = []): string[] {
  for (const node of tree) {
    if (node.kind === 'folder') scenePaths(node.children, into);
    else into.push(node.path);
  }
  return into;
}

export class PlotGridHost {
  private readonly context: PlotGridHostContext;
  private disposed = false;
  private readonly listening = new Set<() => void>();
  private stops: Array<() => void> = [];
  private stopEmit: (() => void) | null = null;

  private model: Model | null = null;
  /** Properties this host has just written, by path key: they stand in until the vault's index has caught up. */
  private readonly written = new Map<string, Readonly<Frontmatter>>();
  private prefsNow: PlotGridPrefs | null = null;

  constructor(context: PlotGridHostContext) {
    this.context = context;
  }

  // ---------------------------------------------------------------- lifecycle

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unfollow();
    for (const listener of [...this.listening]) this.call(listener);
    this.listening.clear();
  }

  get ready(): boolean {
    return !this.disposed;
  }

  get listenerCount(): number {
    return this.listening.size;
  }

  /** Be told when anything the grid shows may have changed. */
  onChange(listener: () => void): () => void {
    if (this.disposed) return () => undefined;
    if (this.listening.size === 0) this.follow();
    this.listening.add(listener);
    return () => {
      if (!this.listening.delete(listener)) return;
      if (this.listening.size === 0) this.unfollow();
    };
  }

  private follow(): void {
    const { store, vault } = this.context;
    this.stops = [
      store.onChange((change) => {
        if (change.type !== 'project') return;
        if (change.movedFrom !== undefined) {
          const now = store.project?.indexPath;
          if (now !== undefined) this.savePrefs(movePrefs(this.prefs, change.movedFrom, now), false);
        }
        this.changed();
      }),
      vault.on((event) => {
        this.onVaultEvent(event);
      }),
    ];
  }

  private unfollow(): void {
    for (const stop of this.stops.splice(0)) stop();
    this.stopEmit?.();
    this.stopEmit = null;
    this.model = null;
    this.written.clear();
  }

  private call(listener: () => void): void {
    try {
      listener();
    } catch (error) {
      console.error('Spellbook: the plot grid could not follow a change', error);
    }
  }

  /** Something changed: work the project out again, and tell the grids a moment later (changes come in batches). */
  private changed(): void {
    this.model = null;
    if (this.listening.size === 0 || this.stopEmit !== null) return;
    this.stopEmit = this.context.clock.setTimer(() => {
      this.stopEmit = null;
      for (const listener of [...this.listening]) this.call(listener);
    }, 0);
  }

  private onVaultEvent(event: VaultEvent): void {
    const snapshot = this.context.store.project;
    if (!snapshot) return;
    if (event.type === 'refresh') {
      this.written.clear();
      this.changed();
      return;
    }
    const rel = relativeTo(snapshot.folder, event.path);
    const oldRel = event.type === 'rename' ? relativeTo(snapshot.folder, event.oldPath) : null;
    if (rel === null && oldRel === null) return;
    if (event.type === 'metadata' && rel !== null) {
      // The vault's index has caught up with this note: it is trusted again.
      this.written.delete(pathKey(rel));
    }
    if (event.type === 'rename' && rel !== null && oldRel !== null) {
      // A chosen entity that was renamed stays chosen.
      this.savePrefs(renameChosen(this.prefs, snapshot.indexPath, oldRel, rel), false);
    }
    this.changed();
  }

  // --------------------------------------------------------- the open project

  private current(): Model | null {
    if (this.disposed) return null;
    const { store } = this.context;
    const snapshot = store.project;
    if (!snapshot) {
      this.model = null;
      return null;
    }
    if (this.model !== null && this.model.project.id === snapshot.indexPath && this.listening.size > 0) return this.model;
    if (this.model !== null && this.model.project.id !== snapshot.indexPath) this.written.clear();

    const notes = new Map<string, Readonly<Frontmatter> | null>();
    for (const note of store.projectNotes()) notes.set(pathKey(note.path), note.frontmatter);
    for (const [key, frontmatter] of this.written) notes.set(key, frontmatter);
    const lanesValue = store.projectData(LANES_KEY);
    const types = readEntityTypes(store.projectData(ENTITY_TYPES_KEY));
    this.model = {
      project: { id: snapshot.indexPath, title: snapshot.title, readOnly: snapshot.readOnly },
      folder: snapshot.folder,
      tree: snapshot.tree,
      notes,
      lanes: readLanes(lanesValue).lanes,
      lanesValue,
      lists: readTagLists({
        [TAG_INDEX_KEYS.status]: store.projectData(TAG_INDEX_KEYS.status),
        [TAG_INDEX_KEYS.label]: store.projectData(TAG_INDEX_KEYS.label),
      }),
      types,
      entities: readEntities(store.worldNotes(), types),
      links: null,
    };
    return this.model;
  }

  /** The way a link is followed in this project: its own World notes first, then the vault. */
  private resolver(model: Model): (target: string, from: string) => string | null {
    const { store, vault } = this.context;
    const world = store
      .worldNotes()
      .map((note) => store.vaultPathOf(note.path))
      .filter((path): path is string => path !== null);
    return projectFirstResolver(world, (target, from) => vault.resolveLink(target, from));
  }

  private linksOf(model: Model): WorldLinks {
    if (model.links === null) {
      const { store } = this.context;
      const resolve = this.resolver(model);
      model.links = buildWorldLinks({
        entities: model.entities,
        entityVaultPath: (path) => store.vaultPathOf(path),
        scenes: scenePaths(model.tree).map((path) => ({
          path,
          title: noteTitle(path),
          vaultPath: store.vaultPathOf(path),
          frontmatter: model.notes.get(pathKey(path)) ?? null,
        })),
        events: [],
        resolve,
      });
    }
    return model.links;
  }

  get project(): PlotGridProject | null {
    return this.current()?.project ?? null;
  }

  /** A scene's properties as last known; null when it has none. */
  private frontmatterOf(model: Model, path: string): Readonly<Frontmatter> | null {
    return model.notes.get(pathKey(path)) ?? null;
  }

  /** The synopsis of a scene, exactly as written; "" for none. */
  synopsis(path: string): string {
    const model = this.current();
    return model ? readSceneFields(this.frontmatterOf(model, path)).synopsis : '';
  }

  /** The columns of a kind, for the open project. */
  private columnsOf(model: Model, kind: ColumnKind): PlotColumn[] {
    switch (kind) {
      case 'lanes':
        return laneColumns(model.lanesValue);
      case 'labels':
        return labelColumns(
          model.lists.labels,
          scenePaths(model.tree).map((path) => sceneLabel(this.frontmatterOf(model, path))),
        );
      default:
        return entityColumns(kind, model.entities, model.types, chosenOf(this.prefs, model.project.id));
    }
  }

  private isIn(model: Model, kind: ColumnKind, scenePath: string, column: PlotColumn): boolean {
    const frontmatter = this.frontmatterOf(model, scenePath);
    switch (kind) {
      case 'lanes':
        return sceneInLane(frontmatter, column.name, model.lanes);
      case 'labels':
        return sceneHasLabel(frontmatter, column.name);
      default:
        return sceneHasEntity(this.linksOf(model), scenePath, column.key);
    }
  }

  /** The grid as it is now, for the kind of columns chosen on this device; null when no project is open. */
  grid(): PlotGrid | null {
    const model = this.current();
    if (!model) return null;
    const prefs = this.prefs;
    const kind = prefs.kind;
    return buildPlotGrid({
      tree: model.tree,
      columns: this.columnsOf(model, kind),
      isIn: (path, column) => this.isIn(model, kind, path, column),
      folded: foldedOf(prefs, model.project.id),
      gapLength: prefs.gapLength,
    });
  }

  /** Every entity of the World, for the picker: by type, in the order of the list of types, then by name. */
  pickableEntities(): PickableEntity[] {
    const model = this.current();
    if (!model) return [];
    const order = new Map(model.types.map((type, at) => [type.id, at]));
    return [...model.entities]
      .sort((a, b) => (order.get(a.typeId ?? '') ?? 1e9) - (order.get(b.typeId ?? '') ?? 1e9))
      .map((entity) => {
        const type = model.types.find((candidate) => candidate.id === entity.typeId) ?? null;
        return { path: entity.path, name: entity.name, typeName: type?.name ?? 'Other', color: type?.color ?? null, icon: type?.icon ?? null };
      });
  }

  // ---------------------------------------------- what this device remembers

  get prefs(): PlotGridPrefs {
    if (this.prefsNow === null) {
      let stored: unknown = null;
      try {
        stored = this.context.storage.load(PREFS_KEY);
      } catch (error) {
        console.error('Spellbook: could not read what this device remembers', error);
      }
      this.prefsNow = readPrefs(stored);
    }
    return this.prefsNow ?? DEFAULT_PREFS;
  }

  private savePrefs(prefs: PlotGridPrefs, tell = true): void {
    if (prefs === this.prefsNow || writePrefs(prefs) === writePrefs(this.prefs)) {
      this.prefsNow = prefs;
      return;
    }
    this.prefsNow = prefs;
    try {
      this.context.storage.save(PREFS_KEY, writePrefs(prefs));
    } catch (error) {
      // The choice then lasts until Obsidian closes.
      console.error('Spellbook: could not save what this device remembers', error);
    }
    if (tell) this.changed();
  }

  setKind(kind: ColumnKind): void {
    this.savePrefs({ ...this.prefs, kind });
  }

  setSynopsisLine(on: boolean): void {
    this.savePrefs({ ...this.prefs, synopsisLine: on });
  }

  setGapLength(length: number): void {
    this.savePrefs({ ...this.prefs, gapLength: length });
  }

  /** The entities chosen for the open project. */
  get chosen(): readonly string[] {
    const project = this.project;
    return project ? chosenOf(this.prefs, project.id) : [];
  }

  setChosen(paths: readonly string[]): void {
    const project = this.project;
    if (project) this.savePrefs(withChosen(this.prefs, project.id, paths));
  }

  isFolded(id: string): boolean {
    const project = this.project;
    return project !== null && foldedOf(this.prefs, project.id).has(id);
  }

  toggleFold(id: string): void {
    const project = this.project;
    if (!project) return;
    const folded = new Set(foldedOf(this.prefs, project.id));
    if (!folded.delete(id)) folded.add(id);
    this.savePrefs(withFolded(this.prefs, project.id, folded));
  }

  /** What the kind of columns is called. */
  kindName(kind: ColumnKind = this.prefs.kind): string {
    return COLUMN_KIND_NAMES[kind];
  }

  // ------------------------------------------------------------------ changes

  /**
   * Put a scene in a column, or take it out of it: what a tap on a cell asks.
   * Only the one property of the one scene is written, worked out against the
   * note as it is on disk at that moment.
   *
   * @param on true to put it in, false to take it out
   * @returns null when it was done (or there was nothing to do), otherwise why not
   */
  async setCell(scenePath: string, columnKey: string, on: boolean): Promise<string | null> {
    if (this.disposed) return SWITCHED_OFF_TEXT;
    const model = this.current();
    if (!model) return NO_PROJECT_OPEN_TEXT;
    if (model.project.readOnly) return READ_ONLY_TEXT;
    const kind = this.prefs.kind;
    const column = this.columnsOf(model, kind).find((candidate) => candidate.key === columnKey);
    if (!column) return NO_SUCH_COLUMN_TEXT;
    const { store } = this.context;
    if (store.vaultPathOf(scenePath) === null) return MISSING_SCENE_TEXT;

    // What the step that writes found: filled in there, read once it is done.
    const box: { saved: Frontmatter | null; problem: string | null } = { saved: null, problem: null };
    let result: IntentResult;
    if (kind === 'lanes') {
      result = await store.updateNoteProperties(
        scenePath,
        (frontmatter) => {
          const patch = lanePatch(frontmatter, column.name, model.lanes, on);
          if (isEmptyPatch(patch)) return false;
          applyFrontmatterPatch(frontmatter, patch);
          box.saved = { ...frontmatter };
          return true;
        },
        model.project.id,
      );
    } else if (kind === 'labels') {
      result = await store.updateNoteProperties(
        scenePath,
        (frontmatter) => {
          box.problem = null;
          // Taking a scene out of a column only clears the label that column stands for.
          if (!on && !sceneHasLabel(frontmatter, column.name)) return false;
          const edit = inspectorPatch(frontmatter, { label: on ? column.name : null }, model.lists);
          if (!edit.ok) {
            box.problem = edit.errors.map((error) => error.message).join(' ');
            return false;
          }
          if (isEmptyCardPatch(edit.patch)) return false;
          const changed = applyCardPatch(frontmatter, edit.patch);
          if (changed) box.saved = { ...frontmatter };
          return changed;
        },
        model.project.id,
      );
    } else {
      const outcome = await this.setEntity(model, scenePath, column.key, on);
      if (typeof outcome === 'string') return outcome;
      result = outcome.result;
      box.saved = outcome.saved;
    }
    if (box.problem !== null) return box.problem;
    if (result.status === 'done' && box.saved !== null) this.noteWritten(scenePath, box.saved);
    return answerOf(result);
  }

  private async setEntity(
    model: Model,
    scenePath: string,
    entityPath: string,
    on: boolean,
  ): Promise<string | { result: IntentResult; saved: Frontmatter | null }> {
    const { store, vault } = this.context;
    const from = store.vaultPathOf(scenePath);
    const to = store.vaultPathOf(entityPath);
    if (from === null) return MISSING_SCENE_TEXT;
    if (to === null) return NO_SUCH_COLUMN_TEXT;
    const resolve = this.resolver(model);
    const leadsTo = (entry: string): boolean => {
      const written = parseLink(entry);
      const found = written === null ? null : resolve(written.target, from);
      return found !== null && pathKey(found) === pathKey(to);
    };
    // The same link the World writes: the name alone when it leads there, or else the whole path.
    const link = linkTo(noteTitle(entityPath), to, from, (target, source) => vault.resolveLink(target, source));
    const box: { outcome: LinkChange; saved: Frontmatter | null } = { outcome: 'unchanged', saved: null };
    const result = await store.updateNoteProperties(
      scenePath,
      (frontmatter) => {
        box.outcome = on ? addEntityLink(frontmatter, link, leadsTo) : removeEntityLink(frontmatter, leadsTo);
        box.saved = box.outcome === 'changed' ? { ...frontmatter } : null;
        return box.outcome === 'changed';
      },
      model.project.id,
    );
    if (box.outcome === 'unreadable') return UNREADABLE_ENTITIES_TEXT;
    return { result, saved: box.saved };
  }

  /** A scene's properties were just saved: until the vault's index catches up, what was saved is what the grid shows. */
  private noteWritten(path: string, frontmatter: Frontmatter): void {
    const key = pathKey(path);
    const indexed = this.context.store.projectNotes().find((note) => pathKey(note.path) === key);
    if (indexed !== undefined && JSON.stringify(indexed.frontmatter) === JSON.stringify(frontmatter)) return;
    this.written.set(key, Object.freeze(frontmatter));
    this.changed();
  }

  async openScene(path: string, where: PaneType | boolean): Promise<void> {
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
    if (!shown) new Notice(`"${title}" could not be opened.`);
  }
}
