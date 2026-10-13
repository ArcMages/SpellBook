// A stage for testing the planner as it is plugged into the plugin: the real
// feature (src/features/planner/index.ts), registered the way the plugin
// registers it, on the real project store over the tests' memory vault, with
// the stand-in for Obsidian's workspace around it. Nothing of the planner
// itself is replaced: the screen, its host and the store are the real ones.
//
// What is a stand-in: the vault (tests/memoryVault.ts), the workspace and the
// plugin (tests/fakeObsidianApp.ts, tests/obsidianStub.ts), the timers, and
// the writing-progress screen's word counts (FakeProgress below).

import type { DayWords } from '../../../src/core/planner';
import type { ProjectStore } from '../../../src/core/projectStore';
import { WordCountCache } from '../../../src/core/wordCountCache';
import { plannerFeature } from '../../../src/features/planner/index';
import type { PlannerHost } from '../../../src/features/planner/plannerHost';
import { PLANNER_VIEW_TYPE, PlannerView } from '../../../src/features/planner/plannerView';
import { registerFeatures } from '../../../src/features/registry';
import type { Feature, FeatureHost, RegisteredFeatures } from '../../../src/features/registry';
import { FakeObsidian } from '../../fakeObsidianApp';
import type { FakeLeaf } from '../../fakeObsidianApp';
import { MemoryVault } from '../../memoryVault';
import type { ManualTimers } from '../../memoryVault';
import { Plugin as StubPlugin } from '../../obsidianStub';
import type { FakeElement, StubCommand } from '../../obsidianStub';
import { MemoryDeviceStorage, makeStore, seedProject, settle, tick } from '../../storeHarness';
import { one } from './plannerStage';

export const TODAY = '2026-10-13';
export const NOVEL = 'Novel/Novel.md';
export const NOVEL_TODO = 'Novel/To-do.md';

const MANIFEST = { id: 'spellbook-novel-writer', name: 'Spellbook', version: '0.1.0' };

/** The word counts of the writing-progress screen, as the planner asks for them. */
export class FakeProgress {
  readonly days = new Map<string, DayWords>();
  /** Every stretch of days it was asked for: "from..to". */
  readonly asked: string[] = [];
  /** Every day a summary was asked for. */
  readonly summaries: string[] = [];
  /** What summary() answers. */
  numbers: Record<string, unknown> | null = {
    streak: 3,
    average: 420,
    weekTotal: 1500,
    monthTotal: 9999,
    dailyTarget: 500,
    dailyTargetMet: false,
  };
  /** Set to make every question fail. */
  broken = false;
  /** How often a listener was taken away again. */
  stopped = 0;
  private readonly listeners = new Set<() => void>();

  set(date: string, manuscript: number, all = manuscript): this {
    this.days.set(date, { manuscript, all });
    return this;
  }

  async wordsByDay(from: string, to: string): Promise<Map<string, DayWords>> {
    this.asked.push(`${from}..${to}`);
    if (this.broken) throw new Error('the word log cannot be read');
    return new Map([...this.days].filter(([date]) => date >= from && date <= to));
  }

  async summary(today: string): Promise<Record<string, unknown> | null> {
    this.summaries.push(today);
    if (this.broken) throw new Error('the word log cannot be read');
    return this.numbers;
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      if (this.listeners.delete(listener)) this.stopped++;
    };
  }

  /** How many are listening for changes. */
  get listening(): number {
    return this.listeners.size;
  }

  /** The counts changed: say so. */
  changed(): void {
    for (const listener of [...this.listeners]) listener();
  }
}

/** A project to put into the vault before anything starts. */
export interface SeededProject {
  /** The project folder, which also names its index note. Default "Novel". */
  folder?: string;
  /** The text of To-do.md; null for a project that has none. Default: an empty file. */
  todo?: string | null;
  /** The value under the index's "marks" key. */
  marks?: unknown;
  /** The value under the index's "targets" key. */
  targets?: unknown;
  /** The binder as the index holds it; something that is not a list makes the project read-only. */
  binder?: unknown;
}

export interface WireOptions extends SeededProject {
  /** More projects in the same vault. */
  others?: SeededProject[];
  /** False to register the planner while no project is open, as when Obsidian is still starting. Default true. */
  open?: boolean;
  /** The features to register. Default: the planner alone. */
  features?: readonly Feature[];
  /** True to have the plugin refuse every view type, as a plugin that is being switched off would. */
  refuseViews?: boolean;
}

export interface Wired {
  vault: MemoryVault;
  store: ProjectStore;
  timers: ManualTimers;
  fake: FakeObsidian;
  /** The plugin, as the stand-in that records what was registered through it. */
  plugin: StubPlugin;
  registered: RegisteredFeatures;
  storage: MemoryDeviceStorage;
  /** Change `day` to let the device's date move on. */
  clock: { day: string };
  /** Every note the feature asked to have shown. */
  shown: Array<{ path: string; where: unknown }>;
  /** Everything workspace.getLeaf() was asked for, in order. */
  leavesAskedFor: unknown[];
  command(id: string): StubCommand;
}

function seed(vault: MemoryVault, project: SeededProject): string {
  const folder = project.folder ?? 'Novel';
  const extra: Record<string, unknown> = {};
  if (project.marks !== undefined) extra['marks'] = project.marks;
  if (project.targets !== undefined) extra['targets'] = project.targets;
  const options = { folder, extra, scenes: { Opening: 1024 } };
  const indexPath = seedProject(vault, project.binder === undefined ? options : { ...options, binder: project.binder });
  if (project.todo !== null) vault.seed(`${folder}/To-do.md`, { body: project.todo ?? '' });
  return indexPath;
}

/** Let everything that is ready to happen, happen: the store's queue, what the host reads, and the drawing that follows. */
export async function rest(w: Pick<Wired, 'store' | 'timers'>): Promise<void> {
  for (let turn = 0; turn < 6; turn++) {
    await settle(w.store);
    await tick();
    w.timers.advance(0);
  }
  await tick();
}

/** The vault, the store, the workspace and the plugin, with the planner registered as the plugin registers it. */
export async function wire(options: WireOptions = {}): Promise<Wired> {
  const vault = new MemoryVault();
  const indexPath = seed(vault, options);
  for (const other of options.others ?? []) seed(vault, other);
  const { store, timers } = makeStore(vault);
  if (options.open !== false) {
    const opened = await store.openProject(indexPath);
    if (opened.status !== 'done') throw new Error(`could not open the seeded project: ${JSON.stringify(opened)}`);
  }
  vault.clearWrites();

  const fake = new FakeObsidian();
  // The stand-in workspace hands out leaves for notes only. A view in the
  // main area needs a pane that can hold it: a new tab is one in the root.
  const leavesAskedFor: unknown[] = [];
  const workspace = fake.workspace;
  const forNotes = workspace.getLeaf.bind(workspace);
  (workspace as unknown as { getLeaf: (where?: unknown) => unknown }).getLeaf = (where?: unknown) => {
    leavesAskedFor.push(where ?? false);
    return where === 'tab' || where === true ? workspace.addLeaf(workspace.rootSplit) : forNotes(where);
  };

  const plugin = new StubPlugin(fake.app, MANIFEST);
  if (options.refuseViews === true) {
    plugin.registerView = () => {
      throw new Error('no views today');
    };
  }
  const storage = new MemoryDeviceStorage();
  const clock = { day: TODAY };
  const shown: Array<{ path: string; where: unknown }> = [];
  const host: FeatureHost = {
    plugin: plugin as never,
    app: fake.app,
    store,
    vault,
    storage,
    deviceId: () => 'ab12cd34ef',
    clock: {
      today: () => clock.day,
      now: () => 0,
      setTimer: timers.set,
      nextFrame: (callback) => timers.set(() => callback(16), 16),
    },
    wordCounts: new WordCountCache({ vault, setTimer: timers.set }),
    openNote: async (path, where) => {
      shown.push({ path, where });
      return vault.has(path);
    },
  };
  const registered = registerFeatures(options.features ?? [plannerFeature], host);
  // As src/main.ts does: the features are let go of when the plugin unloads.
  plugin.register(() => {
    registered.release();
  });

  const command = (id: string): StubCommand => {
    const found = plugin.commands.find((candidate) => candidate.id === id);
    if (!found) throw new Error(`no command "${id}"`);
    return found;
  };
  const wired: Wired = { vault, store, timers, fake, plugin, registered, storage, clock, shown, leavesAskedFor, command };
  await rest(wired);
  return wired;
}

// ------------------------------------------------------------ the planner pane

/** The panes that hold a planner, wherever they are. */
export function planners(w: Pick<Wired, 'fake'>): FakeLeaf[] {
  return w.fake.workspace.getLeavesOfType(PLANNER_VIEW_TYPE);
}

export function viewOf(leaf: FakeLeaf): PlannerView {
  const view: unknown = leaf.view;
  if (!(view instanceof PlannerView)) throw new Error('this pane does not hold a planner');
  return view;
}

/** What the planner in a pane reads from and asks changes of. */
export function hostOf(leaf: FakeLeaf): PlannerHost {
  return viewOf(leaf).host;
}

export function paneOf(leaf: FakeLeaf): FakeElement {
  return viewOf(leaf).contentEl as unknown as FakeElement;
}

/** Give the pane, and the calendar in it, the width of a wide window, and let the view measure. */
export function widen(leaf: FakeLeaf, width = 1200): void {
  const pane = paneOf(leaf);
  pane.clientWidth = width;
  one(pane, 'spellbook-calendar').clientWidth = width;
  one(pane, 'spellbook-calendar-weeks').clientWidth = width;
  viewOf(leaf).onResize();
}

/** Run the "Open planner" command and give the one pane that holds the planner afterwards. */
export async function openPlanner(w: Wired): Promise<FakeLeaf> {
  w.command('open-planner').callback?.();
  await rest(w);
  const open = planners(w);
  if (open.length !== 1) throw new Error(`expected one planner, found ${open.length}`);
  const leaf = open[0] as FakeLeaf;
  widen(leaf);
  await rest(w);
  return leaf;
}

/** Obsidian puts a planner back into a pane, as it does for a saved layout: no command was run. */
export async function restorePlanner(w: Wired, where: 'root' | 'right' = 'root'): Promise<FakeLeaf> {
  const { workspace } = w.fake;
  const leaf = workspace.addLeaf(where === 'root' ? workspace.rootSplit : workspace.rightSplit);
  await leaf.setViewState({ type: PLANNER_VIEW_TYPE });
  widen(leaf);
  await rest(w);
  return leaf;
}
