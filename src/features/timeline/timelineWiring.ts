// The timeline's host: what the timeline screen asks of the plugin, answered
// from the project store.
//
// The screen (timelineView.ts and what it uses) knows only TimelineHost. This
// file is the one place of the timeline that knows the store:
//
//   - what is shown comes from the store: the lanes are the "timelines" key of
//     the project index, the events are the notes of the Timeline folder, the
//     scenes are the binder's, in the binder's order;
//   - every change goes through the store, which reads the note or the index
//     as it is on disk at that moment before it writes;
//   - which lanes are hidden is kept on the device, never in the project.
//
// It exists from the moment the view type is registered, also while no
// project is open (it then has nothing to show), and tells the screens
// whenever what it hands out has really changed: after a change made here,
// when another project is opened, and when a note or the index changes on
// disk, whoever changed it.

import { Notice } from 'obsidian';
import type { App, PaneType } from 'obsidian';
import { dayNumber } from '../../core/dates';
import { sanitiseFileName, tidyDisplayName } from '../../core/names';
import { isInside, joinPath, pathKey, relativeTo } from '../../core/paths';
import { TIMELINE_FOLDER } from '../../core/projectLayout';
import type { ProjectStore } from '../../core/projectStore';
import { CALENDAR_KEY, WORLD_FOLDER, applyFrontmatterPatch, isEmptyPatch, laneKey, readLanes } from '../../core/timeline';
import type { Lane, LaneChange, TimelineNote } from '../../core/timeline';
import type { Frontmatter, StoreChange, TreeNode } from '../../core/types';
import { DATE_KEY, END_KEY, ENTITY_SHEET_SERVICE, ENTITY_TYPES_KEY, MOMENTS_KEY, TYPE_KEY } from '../../core/world';
import type { EntitySheetService } from '../../core/world';
import type { VaultEvent } from '../../core/vaultPort';
import type { DragClock } from '../../ui/dragDrop';
import type { FeatureContext, FeatureServices } from '../registry';
import { HiddenLanes, WORLD_LANES_KEY, readWorldMarks, writeWorldMarks } from './hiddenLanes';
import type { CreateEventResult, NewEvent, NoteChange, TimelineData, TimelineHost, WorldLaneChoice } from './timelineHost';

/** The key of the project index that holds the lanes. */
export const TIMELINES_KEY = 'timelines';

export const NO_PROJECT_OPEN = 'No Spellbook project is open.';
export const NOTE_NOT_OPENED = 'The note could not be opened. It may have been moved or deleted.';

/** How long a notice about something that went wrong stays up, in milliseconds. */
const PROBLEM_NOTICE_MS = 10000;

/** Every scene the binder lists, in reading order, as the binder spells its path. */
function binderScenes(tree: readonly TreeNode[], into: string[] = []): string[] {
  for (const node of tree) {
    if (node.kind === 'scene') into.push(node.path);
    else binderScenes(node.children, into);
  }
  return into;
}

/** A copy of a note's properties that shares nothing with the original. */
function copyOf(frontmatter: Frontmatter): Frontmatter {
  return JSON.parse(JSON.stringify(frontmatter)) as Frontmatter;
}

/** True when two values read from notes say the same. */
function sameValue(a: unknown, b: unknown): boolean {
  return a === b || JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/** The properties of an entity note that the timeline shows something of. */
const WORLD_KEYS = [TYPE_KEY, DATE_KEY, END_KEY, MOMENTS_KEY] as const;

/**
 * An entity note as the timeline needs it: its type, its two dates and its
 * moments, and nothing else, so that typing in a summary redraws nothing.
 */
function worldNote(note: TimelineNote): TimelineNote {
  const all = typeof note.frontmatter === 'object' && note.frontmatter !== null ? (note.frontmatter as Record<string, unknown>) : {};
  const kept: Record<string, unknown> = {};
  for (const key of WORLD_KEYS) if (all[key] !== undefined) kept[key] = all[key];
  return { path: note.path, frontmatter: kept };
}

/**
 * When a change of the lanes was the renaming of one lane, the old name and
 * the new one: the lists are as long as each other and differ in one place.
 */
function renamedLane(before: readonly Lane[], after: readonly Lane[]): { from: string; to: string } | null {
  if (before.length !== after.length) return null;
  let found: { from: string; to: string } | null = null;
  for (let index = 0; index < before.length; index++) {
    const from = before[index]?.name ?? '';
    const to = after[index]?.name ?? '';
    if (laneKey(from) === laneKey(to)) continue;
    if (found !== null) return null;
    found = { from, to };
  }
  return found;
}

export class TimelineWiring implements TimelineHost {
  readonly app: App;
  readonly clock: DragClock;

  private readonly store: ProjectStore;
  private readonly today: () => string;
  private readonly show: (path: string, where: PaneType | boolean) => Promise<boolean>;
  private readonly hidden: HiddenLanes;
  /** What this device shows of the world, project by project: a list of marks (see hiddenLanes.ts). */
  private readonly worldMarks: HiddenLanes;
  private readonly services: FeatureServices | null;
  private readonly listeners = new Set<() => void>();
  private stops: Array<() => void> = [];
  private released = false;

  /** What getData() hands out, until something in it changes. */
  private data: TimelineData | null = null;
  /** Everything in `data` as text, to tell whether a new reading says anything new. */
  private signature = '';
  /** True when `data` may no longer be what the store and the vault say. */
  private stale = true;
  /** The properties handed out for each note that is shown, by the key of its path. */
  private shown = new Map<string, unknown>();
  /**
   * The properties of notes as they were written from here a moment ago, by
   * the key of the note's path. The vault's index of properties follows a
   * write a little later; until it reports the note again, this is what the
   * note holds.
   */
  private readonly written = new Map<string, Frontmatter>();
  /** How many changes made from here are under way. Nothing is announced meanwhile: a change is shown whole. */
  private busy = 0;
  private stopCheck: (() => void) | null = null;

  constructor(context: FeatureContext) {
    this.app = context.app;
    this.clock = context.clock;
    this.store = context.store;
    this.today = () => context.clock.today();
    this.show = (path, where) => context.openNote(path, where);
    this.hidden = new HiddenLanes(context.storage);
    this.worldMarks = new HiddenLanes(context.storage, WORLD_LANES_KEY);
    this.services = context.services ?? null;
    this.stops.push(
      context.store.onChange((change) => {
        this.onStoreChange(change);
      }),
      // Listening only: the vault is never written to from here.
      context.vault.on((event) => {
        this.onVaultEvent(event);
      }),
    );
  }

  /** The plugin is unloading: stop listening, forget everything, and have nothing more to show. */
  release(): void {
    if (this.released) return;
    this.released = true;
    for (const stop of this.stops.splice(0)) stop();
    this.stopCheck?.();
    this.stopCheck = null;
    this.listeners.clear();
    this.written.clear();
    this.shown.clear();
    this.data = null;
    this.signature = '';
    this.stale = false;
  }

  get isReleased(): boolean {
    return this.released;
  }

  /** How many screens are listening. */
  get listening(): number {
    return this.listeners.size;
  }

  // ------------------------------------------------------------------ reading

  getData(): TimelineData | null {
    // While a change made from here is under way, what was shown before it
    // stands: the change is shown whole, when it is done.
    if (this.stale && this.busy === 0) this.read();
    return this.data;
  }

  onChange(listener: () => void): () => void {
    if (this.released) return () => undefined;
    // The first screen to listen is shown what there is now; it is not told
    // about what changed while nobody was looking.
    if (this.listeners.size === 0) this.getData();
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Read everything again. `data` becomes a new object only when something
   * in it is different, and whoever is listening is told when it does.
   */
  private read(): void {
    this.stale = false;
    const before = this.data;
    const next = this.build();
    if (next === null) {
      this.data = null;
      this.signature = '';
      this.shown = new Map();
    } else {
      const signature = JSON.stringify([
        next.projectId,
        next.projectName,
        next.folder ?? null,
        next.timelines ?? null,
        next.calendar ?? null,
        next.world ?? null,
        next.events,
        next.scenes,
        next.sceneOrder,
        next.hiddenLanes,
        next.worldNotes ?? null,
        next.entityTypes ?? null,
        next.worldLanes ?? null,
      ]);
      if (before === null || signature !== this.signature) {
        this.data = next;
        this.signature = signature;
        this.shown = new Map();
        for (const note of [...next.scenes, ...next.events]) this.shown.set(pathKey(note.path), note.frontmatter);
        // An entity note is shown in part, so it is never "the same as before": it is looked at again whenever it is reported.
      }
    }
    if (this.data === before) return;
    for (const listener of [...this.listeners]) {
      try {
        listener();
      } catch (error) {
        console.error('Spellbook: the timeline could not be drawn again', error);
      }
    }
  }

  private build(): TimelineData | null {
    const project = this.released ? null : this.store.project;
    if (!project) return null;

    const withWritten = (note: TimelineNote): TimelineNote => {
      const written = this.written.get(pathKey(note.path));
      return written === undefined ? note : { path: note.path, frontmatter: written };
    };
    const events = this.store.timelineNotes().map(withWritten);

    // The manuscript is what the binder lists, in the binder's order. A scene
    // whose note has not arrived yet keeps its place in the order.
    const sceneOrder: string[] = [];
    const scenes: TimelineNote[] = [];
    const notes = new Map<string, TimelineNote>();
    for (const note of this.store.projectNotes()) notes.set(pathKey(note.path), note);
    const listed = new Set<string>();
    for (const path of binderScenes(project.tree)) {
      const key = pathKey(path);
      // A note of the Timeline folder is an event, also when the binder lists it: it is shown once.
      if (listed.has(key) || isInside(TIMELINE_FOLDER, path)) continue;
      listed.add(key);
      sceneOrder.push(path);
      const note = notes.get(key);
      if (note) scenes.push(withWritten({ path, frontmatter: note.frontmatter }));
    }

    return {
      projectId: project.indexPath,
      projectName: project.title,
      folder: project.folder,
      timelines: this.store.projectData(TIMELINES_KEY),
      calendar: this.store.projectData(CALENDAR_KEY),
      // The entities are the notes of the World folder; only where they are is needed here.
      world: this.store.projectNotes(WORLD_FOLDER).map((note) => note.path),
      // ...and, for the world lanes, when each of them is.
      worldNotes: this.store.projectNotes(WORLD_FOLDER).map((note) => worldNote(withWritten(note))),
      entityTypes: this.store.projectData(ENTITY_TYPES_KEY),
      worldLanes: readWorldMarks(this.worldMarks.of(project.indexPath)),
      events,
      scenes,
      sceneOrder,
      hiddenLanes: this.hidden.of(project.indexPath),
      today: dayNumber(this.today()) ?? 0,
    };
  }

  // ---------------------------------------------------------------- listening

  private onStoreChange(change: StoreChange): void {
    if (this.released || change.type !== 'project') return;
    const project = this.store.project;
    if (change.movedFrom !== undefined && project) {
      // The same project at another path: what this device hides in it comes along.
      this.hidden.move(change.movedFrom, project.indexPath);
      this.worldMarks.move(change.movedFrom, project.indexPath);
    } else if (this.data !== null && project?.indexPath !== this.data.projectId) {
      // Another project, or none: what was written a moment ago was for the last one.
      this.written.clear();
    }
    this.changed();
  }

  private onVaultEvent(event: VaultEvent): void {
    if (this.released) return;
    const project = this.store.project;
    if (!project) return;
    const inside = (path: string): string | null => relativeTo(project.folder, path);
    switch (event.type) {
      case 'refresh':
        this.written.clear();
        this.touched();
        return;
      case 'modify':
        // A note's text changed. Its properties, if they changed too, follow as "metadata".
        return;
      case 'metadata': {
        const path = inside(event.path);
        if (path === null) return;
        const key = pathKey(path);
        // The index has caught up with this note: it is the truth again.
        this.written.delete(key);
        // Most often a note is reported again because its text was typed in.
        if (!this.stale && this.shown.has(key) && sameValue(this.shown.get(key), event.frontmatter)) return;
        this.touched();
        return;
      }
      case 'create':
        if (inside(event.path) !== null) this.touched();
        return;
      case 'delete': {
        const path = inside(event.path);
        if (path === null) return;
        this.written.delete(pathKey(path));
        this.touched();
        return;
      }
      case 'rename': {
        const from = inside(event.oldPath);
        if (from !== null) this.written.delete(pathKey(from));
        if (from !== null || inside(event.path) !== null) this.touched();
        return;
      }
    }
  }

  /**
   * Something on disk may have changed: look again before the next drawing,
   * once for however many notes. While no screen is listening nothing is
   * done at all; the next one to ask is given what there is then.
   */
  private touched(): void {
    this.stale = true;
    if (this.listeners.size === 0 || this.stopCheck) return;
    this.stopCheck = this.clock.nextFrame(() => {
      this.stopCheck = null;
      if (!this.released) this.getData();
    });
  }

  /** Something changed for certain: look again now, and tell the screens if it shows. */
  private changed(): void {
    if (this.released) return;
    this.stale = true;
    if (this.listeners.size > 0) this.getData();
  }

  // ------------------------------------------------------------------ actions

  openNote(path: string, where: PaneType | boolean): void {
    const project = this.released ? null : this.store.project;
    if (!project) return;
    const target = this.store.vaultPathOf(path) ?? joinPath(project.folder, path);
    void this.show(target, where).then(
      (shown) => {
        if (!shown) new Notice(NOTE_NOT_OPENED, PROBLEM_NOTICE_MS);
      },
      (error: unknown) => {
        console.error('Spellbook: a note could not be opened from the timeline', error);
        new Notice(NOTE_NOT_OPENED, PROBLEM_NOTICE_MS);
      },
    );
  }

  async createEvent(event: NewEvent): Promise<CreateEventResult> {
    const project = this.released ? null : this.store.project;
    if (!project) return { ok: false, message: NO_PROJECT_OPEN };
    if (tidyDisplayName(event.title) === '') return { ok: false, message: 'Give the event a title.' };
    // The title becomes the name of the note: what a file name cannot hold is taken out.
    const name = sanitiseFileName(event.title, '');
    if (name === '') return { ok: false, message: 'That title has no characters that can be used in a file name.' };

    const properties = copyOf(event.frontmatter);
    this.busy++;
    try {
      const result = await this.store.addTimelineNote(name, properties, project.indexPath);
      if (result.status === 'done') {
        const key = pathKey(result.value.path);
        // The vault lists a new note before its index has read it. Until
        // then, what the note holds is what was just put into it.
        const listed = this.store.timelineNotes().find((note) => pathKey(note.path) === key);
        if (listed && listed.frontmatter === null) this.written.set(key, properties);
        return { ok: true, path: result.value.path };
      }
      if (result.status === 'refused' && result.reason === 'exists') {
        return { ok: false, message: `There is already an event called "${name}". Give this one another title.` };
      }
      return { ok: false, message: result.message };
    } finally {
      this.busy--;
      this.changed();
    }
  }

  async applyNoteChanges(changes: readonly NoteChange[]): Promise<void> {
    const project = this.released ? null : this.store.project;
    if (!project) throw new Error(NO_PROJECT_OPEN);
    this.busy++;
    let problems: string[];
    try {
      problems = await this.writeNotes(changes, project.indexPath);
    } finally {
      this.busy--;
      this.changed();
    }
    const first = problems[0];
    if (first === undefined) return;
    throw new Error(problems.length === 1 ? first : `${problems.length} notes could not be changed. The first: ${first}`);
  }

  async saveLanes(make: (timelines: unknown) => LaneChange, noteChanges: readonly NoteChange[]): Promise<LaneChange> {
    const project = this.released ? null : this.store.project;
    if (!project) throw new Error(NO_PROJECT_OPEN);
    const indexPath = project.indexPath;
    this.busy++;
    try {
      const box: { result: LaneChange | null; before: readonly Lane[] } = { result: null, before: [] };
      const saved = await this.store.updateProjectData(
        TIMELINES_KEY,
        (current) => {
          box.before = readLanes(current).lanes;
          box.result = make(current);
          return box.result.ok && box.result.changed ? box.result.value : current;
        },
        indexPath,
      );
      const result = box.result;
      // Refused or failed: the lanes are as they were. The store says why in plain words.
      if (saved.status === 'refused' || saved.status === 'failed') throw new Error(saved.message);
      if (result === null) throw new Error('The lanes could not be read from the project index.');
      if (!result.ok || !result.changed) return result;

      // A lane this device hides stays hidden under its new name.
      const renamed = renamedLane(box.before, result.lanes);
      if (renamed !== null) {
        const hidden = this.hidden.of(indexPath);
        if (hidden.some((name) => laneKey(name) === laneKey(renamed.from))) {
          this.hidden.set(
            indexPath,
            hidden.map((name) => (laneKey(name) === laneKey(renamed.from) ? renamed.to : name)),
          );
        }
      }

      const problems = await this.writeNotes(noteChanges, indexPath);
      const first = problems[0];
      if (first !== undefined) {
        const count = problems.length === 1 ? '1 note' : `${problems.length} notes`;
        throw new Error(`The lanes were saved, but ${count} could not be changed to match. ${first}`);
      }
      return result;
    } finally {
      this.busy--;
      this.changed();
    }
  }

  async saveCalendar(value: Readonly<Record<string, unknown>> | null): Promise<void> {
    const project = this.released ? null : this.store.project;
    if (!project) throw new Error(NO_PROJECT_OPEN);
    this.busy++;
    try {
      // Only the index is written. No note is touched: every date stays as it is written.
      const saved = await this.store.updateProjectData(
        CALENDAR_KEY,
        () => (value === null ? undefined : (JSON.parse(JSON.stringify(value)) as unknown)),
        project.indexPath,
      );
      if (saved.status === 'refused' || saved.status === 'failed') throw new Error(saved.message);
    } finally {
      this.busy--;
      this.changed();
    }
  }

  setHiddenLanes(names: readonly string[]): void {
    const project = this.released ? null : this.store.project;
    if (!project) return;
    if (this.hidden.set(project.indexPath, names)) this.changed();
  }

  setWorldLanes(choice: WorldLaneChoice): void {
    const project = this.released ? null : this.store.project;
    if (!project) return;
    if (this.worldMarks.set(project.indexPath, writeWorldMarks(choice))) this.changed();
  }

  showEntity(path: string): boolean {
    if (this.released || !this.store.project) return false;
    // The World browser is asked by name at the moment it is needed: the two screens do not know each other.
    const sheets = this.services?.get<EntitySheetService>(ENTITY_SHEET_SERVICE);
    if (sheets === undefined) return false;
    sheets.show(path);
    return true;
  }

  /**
   * Change the properties of notes through the store, one note at a time.
   * Each change is worked out again from the note as it is on disk at the
   * moment of writing; one that has nothing left to change writes nothing.
   *
   * @returns why a note could not be changed, for each one that could not
   */
  private async writeNotes(changes: readonly NoteChange[], indexPath: string): Promise<string[]> {
    const problems: string[] = [];
    for (const change of changes) {
      const key = pathKey(change.path);
      let mine: Frontmatter | null = null;
      const result = await this.store.updateNoteProperties(
        change.path,
        (frontmatter) => {
          const patch = change.remake(frontmatter);
          if (isEmptyPatch(patch)) return false;
          applyFrontmatterPatch(frontmatter, patch);
          // Known here before the vault's index has read the note again.
          mine = copyOf(frontmatter);
          this.written.set(key, mine);
          return true;
        },
        indexPath,
      );
      if (result.status === 'done') continue;
      // Nothing was written after all: what the index says about the note stands.
      if (mine !== null && this.written.get(key) === mine) this.written.delete(key);
      // A note that is gone, or already as asked, is not a failure: the screen shows it as it is.
      if (result.status !== 'noop') problems.push(result.message);
    }
    return problems;
  }
}
