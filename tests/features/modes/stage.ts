// A stage for testing the writing modes as they are plugged into the plugin:
// the real feature, registered through the registry, with the shared
// stand-in plugin, app, workspace and page (tests/obsidianStub.ts,
// tests/fakeObsidianApp.ts) as they are, and timers under the test's
// control. Nothing here is faked on the feature's own side.

import { WordCountCache } from '../../../src/core/wordCountCache';
import { MODES_SERVICE, modesFeature } from '../../../src/features/modes/index';
import type { ModesService } from '../../../src/features/modes/index';
import { registerFeatures } from '../../../src/features/registry';
import type { FeatureClock, RegisteredFeatures } from '../../../src/features/registry';
import { FakeObsidian } from '../../fakeObsidianApp';
import type { ManualTimers } from '../../memoryVault';
import { FakeElement, Platform, Plugin as StubPlugin, fakeDocument } from '../../obsidianStub';
import { MemoryDeviceStorage, TODAY, makeStore } from '../../storeHarness';

/** How long the stand-in clock takes to draw the screen once. */
export const FRAME_MS = 16;

/** A clock on the test's own timers: a frame is a timer of FRAME_MS. */
export function clockOn(timers: ManualTimers): FeatureClock {
  return {
    today: () => TODAY,
    now: () => 1_000,
    setTimer: timers.set,
    nextFrame: (callback) => timers.set(() => callback(0), FRAME_MS),
  };
}

/** The pane of a note that is open, as far as the modes look at it: its kind, and the buttons in its header. */
export class FakeNoteView {
  /** The header of the pane: the buttons added to it are its children. */
  readonly header = new FakeElement('div');

  constructor(private readonly type = 'markdown') {}

  getViewType(): string {
    return this.type;
  }

  addAction(icon: string, title: string, callback: () => unknown): FakeElement {
    const button = this.header.createEl('button', { attr: { 'aria-label': title } });
    button.icon = icon;
    button.addEventListener('click', callback);
    return button;
  }
}

export interface StageOptions {
  /** What the device kept from last time, by key. */
  stored?: Record<string, string>;
  /** The kind of device, as Obsidian reports it. */
  platform?: Partial<typeof Platform>;
  /** False: Obsidian has not finished putting its panes back yet. */
  ready?: boolean;
  /** Which sidebars are open. */
  open?: { left?: boolean; right?: boolean };
}

export interface Stage {
  fake: FakeObsidian;
  plugin: StubPlugin;
  storage: MemoryDeviceStorage;
  timers: ManualTimers;
  registered: RegisteredFeatures;
  /** The body of the page. */
  body: FakeElement;
  service: ModesService;
  /** Run one of the plugin's commands, as the writer does from the palette. */
  run(commandId: string): void;
  /** Let the screen be drawn once. */
  frame(): void;
  /** Open a note in a pane of the main area. */
  openNote(type?: string): FakeNoteView;
  /** What Obsidian does when the plugin is switched off. */
  unload(): void;
}

export function stage(options: StageOptions = {}): Stage {
  Object.assign(Platform, options.platform ?? {});
  const { store, vault, timers } = makeStore();
  const storage = new MemoryDeviceStorage();
  for (const [key, value] of Object.entries(options.stored ?? {})) storage.save(key, value);
  storage.saves.length = 0;
  const fake = new FakeObsidian();
  fake.workspace.leftSplit.collapsed = options.open?.left !== true;
  fake.workspace.rightSplit.collapsed = options.open?.right !== true;
  if (options.ready !== false) fake.workspace.becomeReady();
  const plugin = new StubPlugin(fake.app, { id: 'spellbook-novel-writer', name: 'Spellbook', version: '0.1.0' });
  const registered = registerFeatures([modesFeature], {
    plugin: plugin as never,
    app: fake.app,
    store,
    vault,
    storage,
    deviceId: () => 'ab12cd34ef',
    clock: clockOn(timers),
    wordCounts: new WordCountCache({ vault, setTimer: timers.set }),
    openNote: async () => true,
  });
  const service = registered.services.get<ModesService>(MODES_SERVICE);
  if (!service) throw new Error('the writing modes did not start');
  return {
    fake,
    plugin,
    storage,
    timers,
    registered,
    body: fakeDocument.body,
    service,
    run: (commandId) => {
      const command = plugin.commands.find((candidate) => candidate.id === commandId);
      if (!command?.callback) throw new Error(`no command "${commandId}"`);
      command.callback();
    },
    frame: () => {
      timers.advance(FRAME_MS);
    },
    openNote: (type = 'markdown') => {
      const view = new FakeNoteView(type);
      const leaf = fake.workspace.addLeaf(fake.workspace.rootSplit);
      leaf.view = view as never;
      leaf.type = type;
      fake.workspace.trigger('layout-change');
      return view;
    },
    unload: () => {
      registered.release();
      plugin.unload();
    },
  };
}
