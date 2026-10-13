// A stage for the timeline plugged into the plugin: the feature registered
// the way src/main.ts registers it, on the project store over the tests'
// memory vault, with the stand-in plugin and the stand-in workspace
// (tests/obsidianStub.ts, tests/fakeObsidianApp.ts). Nothing here is the
// real Obsidian; it shows that the pieces are joined up, not how they look.

import type { App } from 'obsidian';
import type { ProjectStore } from '../../../src/core/projectStore';
import type { Frontmatter } from '../../../src/core/types';
import { WordCountCache } from '../../../src/core/wordCountCache';
import { registerFeatures } from '../../../src/features/registry';
import type { Feature, FeatureContext, RegisteredFeatures } from '../../../src/features/registry';
import { OPEN_TIMELINE_COMMAND, TIMELINE_VIEW_TYPE, TimelineWiring, timelineFeature } from '../../../src/features/timeline/index';
import type { TimelineView } from '../../../src/features/timeline/timelineView';
import { FakeObsidian } from '../../fakeObsidianApp';
import type { FakeLeaf } from '../../fakeObsidianApp';
import { ManualTimers, MemoryVault } from '../../memoryVault';
import { Plugin as StubPlugin } from '../../obsidianStub';
import type { FakeElement, ItemView as StubItemView, StubCommand } from '../../obsidianStub';
import { MemoryDeviceStorage, TODAY, makeStore, seedProject, settle, tick } from '../../storeHarness';
import { FRAME_MS } from './fakeHost';
import { WIDE, one, resize } from './screen';
import type { PaneSize, Stage } from './screen';

export const NOVEL = 'Novel/Novel.md';
export const OTHER = 'Other/Other.md';
export const LANES = [{ name: 'Main plot', color: 'purple' }, { name: 'רקע', color: 'green' }];

/** The event notes of the sample novel, by name: the spring and summer of 1923, as in fakeHost.ts. */
export const EVENT_NOTES: Record<string, Frontmatter> = {
  'The war begins': { spellbook: 'event', date: '1923-04-12', timelines: ['Main plot'], tags: ['war'] },
  Siege: { spellbook: 'event', date: '1923-06-01', end: '1923-08-01', timelines: ['Main plot'] },
  'ילדות': { spellbook: 'event', date: '1923-05-02', timelines: ['רקע'], scenes: ['[[Ending]]'] },
  'Loose end': { spellbook: 'event', timelines: ['Main plot'] },
  Stray: { spellbook: 'event', date: '1923-05', timelines: ['Unknown'] },
};

/** What the writer wrote in an event note: it must come through every test unchanged. */
export const eventBody = (name: string): string => `Notes about ${name}, in the writer's own words.\n`;

/**
 * A vault with two projects. "Novel" has two lanes, five events and three
 * scenes, two of them dated; "Other" has one lane and one event.
 */
export function novelVault(): MemoryVault {
  const vault = new MemoryVault();
  seedProject(vault, { scenes: { Opening: 1024, Middle: 2048, Ending: 3072 }, extra: { timelines: LANES } });
  vault.seed('Novel/Manuscript/Opening.md', { frontmatter: { status: 'To do', order: 1024, date: '1923-04-01' }, body: 'Once.' });
  vault.seed('Novel/Manuscript/Ending.md', { frontmatter: { status: 'To do', order: 3072, date: '1923-07-20' }, body: 'The end.' });
  for (const [name, frontmatter] of Object.entries(EVENT_NOTES)) {
    vault.seed(`Novel/Timeline/${name}.md`, { frontmatter, body: eventBody(name) });
  }
  vault.seed('Novel/Research/Trains.md', { frontmatter: { date: '1923-01-01' }, body: 'facts' });
  seedProject(vault, { folder: 'Other', title: 'Other Book', scenes: { First: 1024 }, extra: { timelines: [{ name: 'Court', color: 'red' }] } });
  vault.seed('Other/Timeline/Coronation.md', { frontmatter: { spellbook: 'event', date: '1066-12-25', timelines: ['Court'] } });
  return vault;
}

export interface Wired {
  /** The stand-in for Obsidian's app: its workspace holds the panes. */
  fake: FakeObsidian;
  plugin: StubPlugin;
  vault: MemoryVault;
  store: ProjectStore;
  timers: ManualTimers;
  storage: MemoryDeviceStorage;
  registered: RegisteredFeatures;
  /** Every note the plugin was asked to show, as it was asked. */
  opened: Array<{ path: string; where: unknown }>;
  /** Set to make showing a note come to nothing (false) or fail (an error). */
  showing: { result: boolean | Error };
  /** What every feature is handed; the timeline's host can be made from it. */
  context: FeatureContext;
  /** The "Open timeline" command. */
  command: StubCommand;
  /** The panes that hold a timeline. */
  panes: () => FakeLeaf[];
  /** Switch the plugin off, as Obsidian does. */
  unload: () => void;
}

/**
 * The stand-in workspace hands out a pane for notes only. A view of the
 * plugin's own is opened in a new tab of the main area, so `getLeaf('tab')`
 * is given a pane there, as in Obsidian. Only for these tests: the shared
 * stand-in file is left as it is.
 */
export function giveMainAreaTabs(fake: FakeObsidian): void {
  const workspace = fake.workspace;
  const forNotes = workspace.getLeaf.bind(workspace);
  workspace.getLeaf = ((where?: unknown) => {
    const notes = forNotes(where);
    if (where !== 'tab' && where !== true) return notes;
    return Object.assign(workspace.addLeaf(workspace.rootSplit), notes);
  }) as typeof workspace.getLeaf;
}

/**
 * Register features the way the plugin does, once the store is ready.
 *
 * @param features what to register: the timeline itself unless a test wants something else
 */
export function wire(vault: MemoryVault = novelVault(), features: readonly Feature[] = [timelineFeature]): Wired {
  const fake = new FakeObsidian();
  giveMainAreaTabs(fake);
  const plugin = new StubPlugin(fake.app, { id: 'spellbook-novel-writer', name: 'Spellbook', version: '0.1.0' });
  const { store, timers } = makeStore(vault);
  const storage = new MemoryDeviceStorage();
  const opened: Array<{ path: string; where: unknown }> = [];
  const showing: { result: boolean | Error } = { result: true };
  let context: FeatureContext | null = null;
  const probe: Feature = { id: 'probe', register: (given) => void (context = given) };
  const registered = registerFeatures([probe, ...features], {
    plugin: plugin as never,
    app: fake.app as App,
    store,
    vault,
    storage,
    deviceId: () => 'ab12cd34ef',
    clock: {
      today: () => TODAY,
      now: () => 1_000,
      setTimer: timers.set,
      nextFrame: (callback) => timers.set(() => callback(0), FRAME_MS),
    },
    wordCounts: new WordCountCache({ vault, setTimer: timers.set }),
    openNote: async (path, where) => {
      opened.push({ path, where });
      if (showing.result instanceof Error) throw showing.result;
      return showing.result;
    },
  });
  // As in src/main.ts: the features are let go of when the plugin unloads, before the store closes.
  plugin.register(() => {
    registered.release();
    store.dispose();
  });
  return {
    fake,
    plugin,
    vault,
    store,
    timers,
    storage,
    registered,
    opened,
    showing,
    context: context as unknown as FeatureContext,
    get command(): StubCommand {
      const found = plugin.commands.find((candidate) => candidate.id === OPEN_TIMELINE_COMMAND);
      if (!found) throw new Error('there is no command to open the timeline');
      return found;
    },
    panes: () => fake.workspace.getLeavesOfType(TIMELINE_VIEW_TYPE),
    unload: () => plugin.unload(),
  };
}

/** The same, with a project open. */
export async function wireOpen(indexPath = NOVEL, vault: MemoryVault = novelVault(), features?: readonly Feature[]): Promise<Wired> {
  const w = wire(vault, features);
  const result = await w.store.openProject(indexPath);
  if (result.status !== 'done') throw new Error(`could not open ${indexPath}: ${JSON.stringify(result)}`);
  vault.clearWrites();
  return w;
}

/** The timeline's host on its own, made the way the feature makes it, and let go of with the plugin. */
export function hostOf(w: Wired): TimelineWiring {
  const host = new TimelineWiring(w.context);
  w.context.onUnload(() => {
    host.release();
  });
  return host;
}

/** Let the store finish, what waits for it come back, and the frames that are waiting be drawn. */
export async function rest(w: Pick<Wired, 'store' | 'timers'>, ms = 5 * FRAME_MS): Promise<void> {
  for (let turn = 0; turn < 3; turn++) {
    await settle(w.store);
    await tick();
    w.timers.advance(ms);
  }
  await settle(w.store);
  await tick();
}

/** Run the "Open timeline" command and wait for the pane. */
export async function openTimeline(w: Wired, size: PaneSize | null = WIDE): Promise<Stage> {
  w.command.callback?.();
  await rest(w);
  return screenOf(w, undefined, size);
}

/** A timeline pane as the screen's own test helpers know it (see screen.ts), given a size. */
export async function screenOf(w: Wired, leaf: FakeLeaf | undefined = w.panes()[0], size: PaneSize | null = WIDE): Promise<Stage> {
  if (!leaf?.view) throw new Error('there is no timeline on the screen');
  const view = leaf.view as unknown as TimelineView;
  const pane = view.contentEl as unknown as FakeElement;
  const s: Stage = {
    // The screen's helpers only ask their host for its timers.
    host: { timers: w.timers } as never,
    view,
    shell: view as unknown as StubItemView,
    pane,
    viewport: one(pane, 'spellbook-timeline-viewport'),
  };
  if (size) resize(s, size);
  await rest(w);
  return s;
}
