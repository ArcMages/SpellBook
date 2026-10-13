// Everything the writing progress is handed, as stand-ins: a project in a
// memory vault, a clock and timers under the test's control, a plugin with a
// status bar and a place for editor extensions, a workspace that says which
// note is in front, and editors that report changes the way CodeMirror does.
//
// The editors are real CodeMirror states (the text, the transactions and
// their "user events" are the real thing); only the screen is missing, so a
// stand-in hands each transaction to the plugin's listener as the editor's
// view would.
//
// A test that uses this file must lay the feature's extras over the shared
// Obsidian stand-in first (see obsidianExtras.ts).

import { EditorState } from '@codemirror/state';
import type { ChangeSet, Extension, TransactionSpec } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import type { ViewUpdate } from '@codemirror/view';
import { editorInfoField } from 'obsidian';
import { deviceIdOf } from '../../../src/core/deviceId';
import { parseStatsFile } from '../../../src/core/progress/index';
import type { StatsDay, StatusSegment } from '../../../src/core/progress/index';
import type { ProjectStore } from '../../../src/core/projectStore';
import { WordCountCache } from '../../../src/core/wordCountCache';
import { SCENE_LINE_SERVICE, STATS_SERVICE, progressFeature } from '../../../src/features/progress/index';
import type { SceneLineService, StatsService } from '../../../src/features/progress/index';
import { registerFeatures } from '../../../src/features/registry';
import type { FeatureClock, RegisteredFeatures } from '../../../src/features/registry';
import { MemoryVault } from '../../memoryVault';
import { FakeElement, Plugin as StubPlugin, fakeDocument } from '../../obsidianStub';
import type { FakeTarget } from '../../obsidianStub';
import { MemoryDeviceStorage, fixedRandom, openSeeded, quiet } from '../../storeHarness';
import type { SeedOptions } from '../../storeHarness';

export const DAY = '2026-10-13';

/** The clock and the timers of the feature, moved by the test. */
export class TestClock implements FeatureClock {
  /** Today's date, as the device would say it. */
  date = DAY;
  /** This moment, in milliseconds. */
  time = 1_800_000_000_000;
  private nextId = 1;
  private timers: Array<{ id: number; at: number; callback: () => void }> = [];

  readonly today = (): string => this.date;
  readonly now = (): number => this.time;

  readonly setTimer = (callback: () => void, ms: number): (() => void) => {
    const id = this.nextId++;
    this.timers.push({ id, at: this.time + ms, callback });
    return () => {
      this.timers = this.timers.filter((timer) => timer.id !== id);
    };
  };

  /** The screen is drawn sixty times a second. */
  readonly nextFrame = (callback: (time: number) => void): (() => void) =>
    this.setTimer(() => callback(this.time), 16);

  /** How many timers are waiting. */
  get pending(): number {
    return this.timers.length;
  }

  /** Let `ms` milliseconds pass, firing every timer that comes due, in order. */
  advance(ms: number): void {
    const until = this.time + ms;
    for (;;) {
      const due = this.timers.filter((timer) => timer.at <= until).sort((a, b) => a.at - b.at || a.id - b.id)[0];
      if (!due) break;
      this.timers = this.timers.filter((timer) => timer !== due);
      this.time = Math.max(this.time, due.at);
      due.callback();
    }
    this.time = until;
  }
}

/** The shared stand-in plugin, with the parts of Obsidian's Plugin the feature needs on top. */
export class FakePlugin extends StubPlugin {
  /** What was handed to registerEditorExtension, in order. */
  readonly editorExtensions: Extension[] = [];
  /** The app's status bar: the items the plugin added are its children. */
  readonly statusBar = new FakeElement('div');
  private readonly domEvents: Array<{ target: FakeTarget; type: string; callback: (event: never) => unknown }> = [];

  registerEditorExtension(extension: Extension): void {
    this.editorExtensions.push(extension);
  }

  addStatusBarItem(): FakeElement {
    return this.statusBar.createDiv({ cls: 'status-bar-item' });
  }

  registerDomEvent(target: FakeTarget, type: string, callback: (event: never) => unknown): void {
    target.addEventListener(type, callback);
    this.domEvents.push({ target, type, callback });
  }

  /** As Obsidian does on unload: what was registered through the plugin is taken away again. */
  override unload(): void {
    super.unload();
    for (const { target, type, callback } of this.domEvents.splice(0)) target.removeEventListener(type, callback);
    this.statusBar.empty();
    this.editorExtensions.length = 0;
  }
}

interface WorkspaceRef {
  name: string;
  callback: (...args: unknown[]) => unknown;
  e: FakeWorkspace;
}

/** The workspace as far as the feature asks: which note is in front, and which notes are open in tabs. */
export class FakeWorkspace {
  private readonly refs = new Set<WorkspaceRef>();
  readonly containerEl = new FakeElement('div');
  /** The notes open in tabs. */
  tabs: string[] = [];
  private front: { path: string } | null = null;
  /** How often the editors were asked to take their extensions anew. */
  optionsUpdated = 0;

  on(name: string, callback: (...args: never[]) => unknown): WorkspaceRef {
    const ref: WorkspaceRef = { name, callback: callback as (...args: unknown[]) => unknown, e: this };
    this.refs.add(ref);
    return ref;
  }

  offref(ref: WorkspaceRef): void {
    this.refs.delete(ref);
  }

  trigger(name: string, ...args: unknown[]): void {
    for (const ref of [...this.refs]) if (ref.name === name) ref.callback(...args);
  }

  listenerCount(name?: string): number {
    return [...this.refs].filter((ref) => name === undefined || ref.name === name).length;
  }

  getActiveFile(): { path: string } | null {
    return this.front;
  }

  iterateAllLeaves(callback: (leaf: unknown) => unknown): void {
    for (const path of this.tabs) {
      callback({ view: { file: { path } }, getViewState: () => ({ type: 'markdown', state: { file: path } }) });
    }
  }

  updateOptions(): void {
    this.optionsUpdated++;
  }

  /** The writer moves to another note (or to none): it is in front now, in a tab of its own. */
  show(path: string | null): void {
    if (path !== null && !this.tabs.includes(path)) this.tabs.push(path);
    this.front = path === null ? null : { path };
    this.trigger('file-open', this.front);
  }

  /** A tab is closed without another note coming to the front (it was in a second pane). */
  closeTab(path: string): void {
    this.tabs = this.tabs.filter((tab) => tab !== path);
    this.trigger('layout-change');
  }
}

/**
 * A note open in an editor. Every change is a real CodeMirror transaction
 * with the user event the real editor gives it, handed to the listeners the
 * plugin registered.
 */
export class FakeEditor {
  private state: EditorState;
  private undone: ChangeSet[] = [];
  private done: ChangeSet[] = [];

  constructor(
    readonly path: string,
    text: string,
    extensions: Extension,
  ) {
    this.state = EditorState.create({
      doc: text,
      extensions: [editorInfoField.init(() => ({ file: { path } }) as never), extensions],
    });
  }

  get text(): string {
    return this.state.doc.toString();
  }

  private dispatch(spec: TransactionSpec): ChangeSet {
    const before = this.state;
    const transaction = before.update(spec);
    this.state = transaction.state;
    const update = {
      docChanged: transaction.docChanged,
      transactions: [transaction],
      startState: before,
      state: transaction.state,
      view: {},
    } as unknown as ViewUpdate;
    for (const listener of this.state.facet(EditorView.updateListener)) listener(update);
    return transaction.changes.invert(before.doc);
  }

  /** A change the writer made, which the editor can undo. */
  private change(spec: TransactionSpec): void {
    this.done.push(this.dispatch(spec));
    this.undone = [];
  }

  /** Type at the end of the note. */
  type(text: string): void {
    this.change({ changes: { from: this.state.doc.length, insert: text }, userEvent: 'input.type' });
  }

  /** Delete the last `chars` characters with the backspace key. */
  backspace(chars: number): void {
    const end = this.state.doc.length;
    this.change({ changes: { from: Math.max(0, end - chars), to: end }, userEvent: 'delete.backward' });
  }

  /** Paste at the end of the note. */
  paste(text: string): void {
    this.change({ changes: { from: this.state.doc.length, insert: text }, userEvent: 'input.paste' });
  }

  /** Drop dragged text at the end of the note. */
  drop(text: string): void {
    this.change({ changes: { from: this.state.doc.length, insert: text }, userEvent: 'input.drop' });
  }

  /** Cut the last `chars` characters. */
  cut(chars: number): void {
    const end = this.state.doc.length;
    this.change({ changes: { from: Math.max(0, end - chars), to: end }, userEvent: 'delete.cut' });
  }

  /** Undo the last change. */
  undo(): void {
    const inverse = this.done.pop();
    if (!inverse) throw new Error('nothing to undo');
    this.undone.push(this.dispatch({ changes: inverse, userEvent: 'undo' }));
  }

  /** Redo the last change that was undone. */
  redo(): void {
    const again = this.undone.pop();
    if (!again) throw new Error('nothing to redo');
    this.done.push(this.dispatch({ changes: again, userEvent: 'redo' }));
  }

  /**
   * The note changed on disk (a sync, another program) and Obsidian put the
   * new text into the editor: a change with no user event at all.
   */
  reload(text: string): void {
    this.dispatch({ changes: { from: 0, to: this.state.doc.length, insert: text } });
    this.done = [];
    this.undone = [];
  }
}

export interface Stand {
  readonly vault: MemoryVault;
  readonly store: ProjectStore;
  readonly indexPath: string;
  readonly clock: TestClock;
  readonly storage: MemoryDeviceStorage;
  readonly plugin: FakePlugin;
  readonly workspace: FakeWorkspace;
  readonly wordCounts: WordCountCache;
  readonly features: RegisteredFeatures;
  /** This device's id, made the way the plugin makes it (asking does not count as the feature asking). */
  readonly deviceId: string;
  /** How often the feature asked for the device's id. */
  idsAsked(): number;
  /** Open a note in an editor; its text is the note's text in the vault unless given. */
  editor(path: string, text?: string): FakeEditor;
  /** Let everything that was started come to rest, without time passing. */
  rest(): Promise<void>;
  /** Let time pass (timers fire), then let everything come to rest. */
  pass(ms: number): Promise<void>;
  /** This device's log file for a month: its path in the vault. */
  logPath(month: string): string;
  /** The days in this device's log file for a month; null when there is no such file. */
  logDays(month: string): StatsDay[] | null;
  /** The line of figures, as "Label value" pieces. */
  line(): string[];
  sceneLine(): SceneLineService;
  stats(): StatsService;
  /** The item the feature put in the status bar, or null. */
  bar(): FakeElement | null;
  /** Switch the plugin off, as Obsidian does, and let what it started come to rest. */
  unload(): Promise<void>;
}

export interface StandOptions extends SeedOptions {
  /** Set up the vault before the project is opened. */
  prepare?: (vault: MemoryVault) => void;
  /** A seed for this device's id: another seed is another device. */
  device?: number;
}

/** The line of figures as text, one piece per entry. */
export function asText(segments: readonly StatusSegment[]): string[] {
  return segments.map((segment) => `${segment.label} ${segment.value}${segment.met === true ? ' (met)' : ''}`);
}

/**
 * A project with two scenes ("Opening", nine words, and "The Letter", ten), a
 * research note and a note outside the project, open in a store, with the
 * writing progress registered the way the plugin registers it.
 */
export async function makeStand(options: StandOptions = {}): Promise<Stand> {
  const vault = new MemoryVault();
  vault.seed('Novel/Research/Castle.md', { body: 'Notes on the castle.\n' });
  vault.seed('Elsewhere/Diary.md', { body: 'Dear diary.\n' });
  options.prepare?.(vault);
  const { store, indexPath } = await openSeeded({ scenes: { Opening: 1024, 'The Letter': 2048 }, ...options }, vault);

  const clock = new TestClock();
  const storage = new MemoryDeviceStorage();
  const workspace = new FakeWorkspace();
  const plugin = new FakePlugin({ workspace }, { id: 'spellbook-novel-writer', name: 'Spellbook', version: '0.1.0' });
  const wordCounts = new WordCountCache({ vault, setTimer: clock.setTimer });
  wordCounts.start();

  let asked = 0;
  const random = fixedRandom(options.device ?? 1);
  const features = registerFeatures([progressFeature], {
    plugin: plugin as never,
    app: { workspace } as never,
    store,
    vault,
    storage,
    deviceId: () => {
      asked++;
      return deviceIdOf(storage, random);
    },
    clock,
    wordCounts,
    openNote: async () => true,
  });
  // As in src/main.ts: the features are let go of when the plugin unloads.
  plugin.register(() => {
    features.release();
    wordCounts.dispose();
  });

  const rest = async (): Promise<void> => {
    for (let turn = 0; turn < 3; turn++) {
      await quiet(store);
      clock.advance(0);
    }
    await quiet(store);
  };

  const stand: Stand = {
    vault,
    store,
    indexPath,
    clock,
    storage,
    plugin,
    workspace,
    wordCounts,
    features,
    get deviceId(): string {
      return deviceIdOf(storage, random);
    },
    idsAsked: () => asked,
    editor: (path, text) => new FakeEditor(path, text ?? vault.textOf(path), plugin.editorExtensions),
    rest,
    pass: async (ms) => {
      clock.advance(ms);
      await rest();
    },
    logPath: (month) => `Novel/Stats/${month} ${stand.deviceId}.md`,
    logDays: (month) => {
      const path = stand.logPath(month);
      return vault.has(path) ? [...parseStatsFile(vault.textOf(path), path).days] : null;
    },
    line: () => asText(stand.sceneLine().current()),
    sceneLine: () => {
      const service = features.services.get<SceneLineService>(SCENE_LINE_SERVICE);
      if (!service) throw new Error('the line of figures is not offered');
      return service;
    },
    stats: () => {
      const service = features.services.get<StatsService>(STATS_SERVICE);
      if (!service) throw new Error('the word log is not offered');
      return service;
    },
    bar: () => plugin.statusBar.children[0] ?? null,
    unload: async () => {
      plugin.unload();
      await rest();
    },
  };
  return stand;
}

/** The app goes out of sight, or comes back. */
export function setHidden(hidden: boolean): void {
  (fakeDocument as unknown as { visibilityState: string }).visibilityState = hidden ? 'hidden' : 'visible';
  fakeDocument.dispatch('visibilitychange');
}
