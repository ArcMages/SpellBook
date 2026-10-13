// A stand-in for the plugin, as far as the timeline screen knows it: data in
// memory, timers under the test's control, and a record of everything the
// screen asked for. Changes to notes are applied the way a real host should:
// each change is made again from the note's properties at that moment.

import type { App } from 'obsidian';
import { applyFrontmatterPatch } from '../../../src/core/timeline';
import type { LaneChange, TimelineNote } from '../../../src/core/timeline';
import type {
  CreateEventResult,
  NewEvent,
  NoteChange,
  TimelineData,
  TimelineHost,
} from '../../../src/features/timeline/timelineHost';
import type { DragClock } from '../../../src/ui/dragDrop';
import { ManualTimers } from '../../memoryVault';

/** How long one frame of the test's clock lasts, in milliseconds. */
export const FRAME_MS = 16;

export const note = (path: string, frontmatter: Record<string, unknown> = {}): TimelineNote => ({ path, frontmatter });

export const EVENTS = 'Novel/Timeline/';
export const SCENES = 'Novel/Manuscript/';

/** A small novel in the spring and summer of 1923: close enough together that nothing clusters. */
export function sample(overrides: Partial<TimelineData> = {}): TimelineData {
  return {
    projectId: 'Novel/Novel.md',
    projectName: 'Novel',
    timelines: [{ name: 'Main plot', color: 'purple' }, { name: 'רקע', color: 'green' }],
    events: [
      note(`${EVENTS}The war begins.md`, { date: '1923-04-12', timelines: ['Main plot'], tags: ['war', 'מלחמה'] }),
      note(`${EVENTS}Siege.md`, { date: '1923-06-01', end: '1923-08-01', timelines: ['Main plot'] }),
      note(`${EVENTS}ילדות.md`, { date: '1923-05-02', timelines: ['רקע'], scenes: ['[[Ending]]'] }),
      note(`${EVENTS}Loose end.md`, { timelines: ['Main plot'] }),
      note(`${EVENTS}Stray.md`, { date: '1923-05', timelines: ['Unknown'] }),
    ],
    scenes: [
      note(`${SCENES}Opening.md`, { date: '1923-04-01' }),
      note(`${SCENES}Middle.md`, {}),
      note(`${SCENES}Ending.md`, { date: '1923-07-20' }),
    ],
    sceneOrder: [`${SCENES}Opening.md`, `${SCENES}Middle.md`, `${SCENES}Ending.md`],
    hiddenLanes: [],
    today: 19000,
    ...overrides,
  };
}

export class FakeHost implements TimelineHost {
  readonly app = {} as App;
  readonly timers = new ManualTimers();
  readonly clock: DragClock = {
    setTimer: this.timers.set,
    nextFrame: (callback) =>
      this.timers.set(() => {
        callback(0);
      }, FRAME_MS),
  };

  data: TimelineData | null;
  /** Every note that was asked to be shown. */
  readonly opened: Array<{ path: string; where: unknown }> = [];
  readonly created: NewEvent[] = [];
  /** Every batch of note changes that was asked for. */
  readonly changes: NoteChange[][] = [];
  /** Every change of the lanes that was asked for, with what it came to. */
  readonly laneSaves: Array<{ result: LaneChange; noteChanges: readonly NoteChange[] }> = [];
  readonly hidden: string[][] = [];
  /** Set to make the next event note fail to be made. */
  createResult: CreateEventResult | null = null;
  /** Set to make writing notes fail. */
  failWrites = false;
  private readonly listeners = new Set<() => void>();

  constructor(data: TimelineData | null = sample()) {
    this.data = data;
  }

  get listening(): number {
    return this.listeners.size;
  }

  getData(): TimelineData | null {
    return this.data;
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Change the data and say so, as the plugin does when a note or the index changes. */
  set(patch: Partial<TimelineData>): void {
    this.data = { ...(this.data ?? sample()), ...patch };
    this.announce();
  }

  announce(): void {
    for (const listener of [...this.listeners]) listener();
  }

  /** The properties of a note as they are now. */
  frontmatterOf(path: string): Record<string, unknown> {
    const found = [...(this.data?.events ?? []), ...(this.data?.scenes ?? [])].find((entry) => entry.path === path);
    if (!found) throw new Error(`no note at ${path}`);
    return found.frontmatter as Record<string, unknown>;
  }

  openNote(path: string, where: unknown): void {
    this.opened.push({ path, where });
  }

  async createEvent(event: NewEvent): Promise<CreateEventResult> {
    this.created.push(event);
    const result = this.createResult ?? { ok: true, path: `${EVENTS}${event.title}.md` };
    if (result.ok && this.data) this.set({ events: [...this.data.events, note(result.path, { ...event.frontmatter })] });
    return result;
  }

  async applyNoteChanges(changes: readonly NoteChange[]): Promise<void> {
    this.changes.push([...changes]);
    if (this.failWrites) throw new Error('the disk is full');
    this.write(changes);
    this.announce();
  }

  async saveLanes(make: (timelines: unknown) => LaneChange, noteChanges: readonly NoteChange[]): Promise<LaneChange> {
    const result = make(this.data?.timelines);
    this.laneSaves.push({ result, noteChanges });
    if (result.ok && result.changed && this.data) {
      this.data = { ...this.data, timelines: result.value };
      this.write(noteChanges);
      this.announce();
    }
    return result;
  }

  setHiddenLanes(names: readonly string[]): void {
    this.hidden.push([...names]);
    this.set({ hiddenLanes: [...names] });
  }

  private write(changes: readonly NoteChange[]): void {
    const data = this.data;
    if (!data) return;
    const rewrite = (entry: TimelineNote): TimelineNote => {
      const change = changes.find((candidate) => candidate.path === entry.path);
      if (!change) return entry;
      const frontmatter = { ...(entry.frontmatter as Record<string, unknown>) };
      applyFrontmatterPatch(frontmatter, change.remake(frontmatter));
      return { path: entry.path, frontmatter };
    };
    this.data = { ...data, events: data.events.map(rewrite), scenes: data.scenes.map(rewrite) };
  }
}
