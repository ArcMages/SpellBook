// A stage for testing the prose checks as they are plugged into the plugin:
// the real feature, registered through the registry, on a project store that
// sits on the tests' memory vault, with the shared stand-in plugin and app,
// and timers under the test's control.
//
// The editor is a real CodeMirror state (the text, the transactions and
// their "user events" are the real thing); only the screen is missing, so a
// stand-in hands each transaction to the marks as the editor's view would.

import { EditorState } from '@codemirror/state';
import type { Text, TransactionSpec } from '@codemirror/state';
import type { DecorationSet, EditorView, ViewUpdate } from '@codemirror/view';
import { editorInfoField } from 'obsidian';
import { WordCountCache } from '../../../src/core/wordCountCache';
import { ProseMarksView, proseFeature } from '../../../src/features/prose/index';
import type { ProseEditorHost } from '../../../src/features/prose/index';
import { registerFeatures } from '../../../src/features/registry';
import type { FeatureContext, RegisteredFeatures } from '../../../src/features/registry';
import { FakeObsidian } from '../../fakeObsidianApp';
import { ManualTimers } from '../../memoryVault';
import { FakeElement, Plugin as StubPlugin, fakeDocument } from '../../obsidianStub';
import type { StubCommand } from '../../obsidianStub';
import { MemoryDeviceStorage, TODAY, openSeeded } from '../../storeHarness';

/** A scene of the seeded project, a note outside it, and something that is no note. */
export const SCENE = 'Novel/Manuscript/Opening.md';
export const OUTSIDE = 'Journal/Today.md';
export const PICTURE = 'Novel/Research/map.png';

export interface Stage {
  plugin: StubPlugin;
  fake: FakeObsidian;
  storage: MemoryDeviceStorage;
  timers: ManualTimers;
  registered: RegisteredFeatures;
  /** What the feature was handed. */
  context: FeatureContext;
  command(id: string): StubCommand;
  /** Run a command, as from the command palette. */
  run(id: string): void;
  /** What the feature gave the editors: empty while no check is on. */
  extensions(): unknown[];
  /** The "Prose checks" part of the settings tab, drawn. */
  settings(): FakeElement;
}

/** The feature, registered, with a project in the vault. `storage` lets a test start with choices already made. */
export async function stage(storage = new MemoryDeviceStorage()): Promise<Stage> {
  const { store, vault, timers: storeTimers } = await openSeeded({ scenes: { Opening: 1 } });
  const timers = new ManualTimers();
  const fake = new FakeObsidian();
  const plugin = new StubPlugin(fake.app, { id: 'spellbook-novel-writer', name: 'Spellbook', version: '0.1.0' });
  let context: FeatureContext | null = null;
  const registered = registerFeatures([{ id: 'look', register: (given) => void (context = given) }, proseFeature], {
    plugin: plugin as never,
    app: fake.app,
    store,
    vault,
    storage,
    deviceId: () => 'device0001',
    clock: { today: () => TODAY, now: () => 1_000, setTimer: timers.set, nextFrame: (callback) => timers.set(() => callback(16), 16) },
    wordCounts: new WordCountCache({ vault, setTimer: storeTimers.set }),
    openNote: async () => true,
  });
  const command = (id: string): StubCommand => {
    const found = plugin.commands.find((entry) => entry.id === id);
    if (!found) throw new Error(`no command "${id}"`);
    return found;
  };
  return {
    plugin,
    fake,
    storage,
    timers,
    registered,
    context: context as unknown as FeatureContext,
    command,
    run: (id) => {
      (command(id) as unknown as { callback: () => void }).callback();
    },
    extensions: () => (plugin.editorExtensions[0] as unknown[] | undefined) ?? [],
    settings: () => {
      const section = registered.settingsSections.find((entry) => entry.id === 'prose');
      if (!section) throw new Error('no settings section');
      const element = new FakeElement('div');
      section.render(element as never);
      return element;
    },
  };
}

/** One mark as it is drawn: its kind, the words it is on, and what it says. */
export interface Drawn {
  kind: string;
  words: string;
  message: string;
  from: number;
  to: number;
}

/** The marks of a set of decorations, in the order of the text. */
export function drawn(decorations: DecorationSet, doc: Text): Drawn[] {
  const marks: Drawn[] = [];
  for (const cursor = decorations.iter(); cursor.value !== null; cursor.next()) {
    const spec = cursor.value.spec as { class: string; attributes: Record<string, string> };
    const kind = spec.class.split(' ').find((name) => name.startsWith('spellbook-prose-') && name !== 'spellbook-prose-mark') ?? '';
    marks.push({
      kind: kind.replace('spellbook-prose-', ''),
      words: doc.sliceString(cursor.from, cursor.to),
      message: spec.attributes['data-spellbook-prose'] ?? '',
      from: cursor.from,
      to: cursor.to,
    });
  }
  return marks;
}

/**
 * A note open in an editor, as far as the marks ask: the text, what is on
 * the screen, the caret, and whether the editor has the keyboard.
 */
export class FakeEditor {
  state: EditorState;
  /** What is on the screen: the whole note unless a test says otherwise. */
  shown: { from: number; to: number } | null = null;
  hasFocus = true;
  readonly dom = new FakeElement('div');
  readonly contentDOM = new FakeElement('div');
  readonly marks: ProseMarksView;
  /** How often the marks were handed a change. */
  updates = 0;

  constructor(path: string, text: string, host: ProseEditorHost) {
    this.state = EditorState.create({ doc: text, extensions: [editorInfoField.init(() => ({ file: { path } }) as never)] });
    this.marks = new ProseMarksView(this as unknown as EditorView, host);
  }

  get visibleRanges(): Array<{ from: number; to: number }> {
    return [this.shown ?? { from: 0, to: this.state.doc.length }];
  }

  get text(): string {
    return this.state.doc.toString();
  }

  /** The marks that are drawn, as "kind: words". */
  get picture(): string[] {
    return drawn(this.marks.decorations, this.state.doc).map((mark) => `${mark.kind}: ${mark.words}`);
  }

  dispatch(spec: TransactionSpec, more: Partial<Pick<ViewUpdate, 'viewportChanged' | 'focusChanged'>> = {}): void {
    const before = this.state;
    const transaction = before.update(spec);
    this.state = transaction.state;
    this.updates++;
    this.marks.update({
      docChanged: transaction.docChanged,
      selectionSet: !before.selection.eq(transaction.state.selection),
      viewportChanged: more.viewportChanged ?? false,
      focusChanged: more.focusChanged ?? false,
      transactions: [transaction],
      changes: transaction.changes,
      startState: before,
      state: transaction.state,
      view: this,
    } as unknown as ViewUpdate);
  }

  /** Type at a place in the note; the caret ends up after what was typed. */
  type(at: number, text: string): void {
    this.dispatch({ changes: { from: at, insert: text }, selection: { anchor: at + text.length }, userEvent: 'input.type' });
  }

  backspace(at: number): void {
    this.dispatch({ changes: { from: at - 1, to: at }, selection: { anchor: at - 1 }, userEvent: 'delete.backward' });
  }

  paste(at: number, text: string): void {
    this.dispatch({ changes: { from: at, insert: text }, selection: { anchor: at + text.length }, userEvent: 'input.paste' });
  }

  /** Put the caret somewhere, as a tap or an arrow key does. */
  caret(at: number): void {
    this.dispatch({ selection: { anchor: at }, userEvent: 'select' });
  }

  /** Scroll: another part of the note is on the screen. */
  scroll(from: number, to: number): void {
    this.shown = { from, to };
    this.dispatch({}, { viewportChanged: true });
  }

  /** The editor loses the keyboard. */
  blur(): void {
    this.hasFocus = false;
    this.dispatch({}, { focusChanged: true });
  }
}

export { fakeDocument };
