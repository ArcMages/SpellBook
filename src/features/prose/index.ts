// Prose checks: marks in the editor that point at things worth a second look.
//
//   English   nouns, verbs, adjectives and adverbs in colour; filler words,
//             the passive voice, repeated words and crowded adverbs underlined
//   Hebrew    repeated words and filler words underlined
//   both      very long sentences, and runs of sentences of one length
//
// Everything is worked out on the device, from word lists that are part of
// the plugin. The marks are decorations in the editor: the text of a note is
// never changed. They show in the notes of Spellbook projects.
//
// The parts, each in a file of its own in this folder:
//   choices.ts   the writer's choices, kept on this device
//   marks.ts     from the lines on the screen to decorations
//   editor.ts    the editor extension: when the marks are worked out
//   tip.ts       the bubble that says what a mark is
//   settings.ts  the "Prose checks" part of the settings tab
//
// What is a filler word, a passive or a repetition is the engine's, in
// src/core/prose.
//
// Each check has a command that switches it on and off, and there is one for
// all of them together. Everything is off until the writer switches it on.
// While everything is off the feature has no part in the editor at all.

import type { Extension } from '@codemirror/state';
import { Notice, Platform } from 'obsidian';
import { isInside, isMarkdownPath } from '../../core/paths';
import { FIRST_CHECKS, PROSE_CHECKS, ProseAnalyser, isShown, optionsOf, withCheck, withMaster } from '../../core/prose/index';
import type { ProseCheck } from '../../core/prose/index';
import type { Feature, FeatureContext } from '../registry';
import { ProseChoices } from './choices';
import { proseEditor } from './editor';
import type { ProseEditorHost } from './editor';
import { CHECK_NAMES, proseSettings } from './settings';

export { ProseChoices } from './choices';
export { EDITOR_CLASS, ProseMarksView, TOUCH_PAUSE_MS, isTyping, proseEditor } from './editor';
export type { ProseEditorHost } from './editor';
export { MARK_CLASS, MARK_MESSAGE, decorate, lineFlags, markClass, marksInView } from './marks';
export { CHECK_NAMES, proseSettings } from './settings';
export { ProseTip, TIP_CLASS, messagesAt } from './tip';

/** The command that switches all the checks on and off. Obsidian puts the plugin's name in front of its name. */
export const PROSE_MASTER_COMMAND = { id: 'toggle-prose-checks', name: 'Toggle prose checks' } as const;

/** The command of each check. */
export const PROSE_COMMANDS: Record<ProseCheck, { readonly id: string; readonly name: string }> = {
  nouns: { id: 'toggle-prose-nouns', name: 'Toggle prose check: colour nouns' },
  verbs: { id: 'toggle-prose-verbs', name: 'Toggle prose check: colour verbs' },
  adjectives: { id: 'toggle-prose-adjectives', name: 'Toggle prose check: colour adjectives' },
  adverbs: { id: 'toggle-prose-adverbs', name: 'Toggle prose check: colour adverbs' },
  filler: { id: 'toggle-prose-filler', name: 'Toggle prose check: filler words' },
  passive: { id: 'toggle-prose-passive', name: 'Toggle prose check: passive voice' },
  repeated: { id: 'toggle-prose-repeated', name: 'Toggle prose check: repeated words' },
  'overused-adverbs': { id: 'toggle-prose-overused-adverbs', name: 'Toggle prose check: overused adverbs' },
  rhythm: { id: 'toggle-prose-rhythm', name: 'Toggle prose check: sentence rhythm' },
};

/** How long a notice about a switch stays, in milliseconds. */
const NOTICE_MS = 4000;

/** The feature at work: the writer's choices, the analysis under them, and its place in the editor. */
export class ProseChecks {
  readonly choices: ProseChoices;
  private readonly context: FeatureContext;
  /** What the editors are given: the extension while a check is on, nothing while none is. */
  private readonly extensions: Extension[] = [];
  /** Whether the list above was handed to Obsidian. It is, the first time a check is switched on. */
  private registered = false;
  private analyser: ProseAnalyser;
  /** The folders of the Spellbook projects in the vault; null until asked for. */
  private folders: string[] | null = null;
  private readonly stops: Array<() => void> = [];
  private closed = false;

  constructor(context: FeatureContext) {
    this.context = context;
    this.choices = new ProseChoices(context.storage);
    this.analyser = new ProseAnalyser(optionsOf(this.choices.prefs));
  }

  /** Register everything. Called once, when the project store is ready. */
  start(): void {
    const { context } = this;
    const { plugin, store } = context;

    plugin.addCommand({ ...PROSE_MASTER_COMMAND, callback: () => this.toggleAll() });
    for (const check of PROSE_CHECKS) {
      plugin.addCommand({ ...PROSE_COMMANDS[check], callback: () => this.toggle(check) });
    }
    context.addSettingsSection(proseSettings(this.choices));

    this.stops.push(
      this.choices.onChange(() => this.apply()),
      store.onChange((change) => {
        if (change.type !== 'projects') return;
        this.folders = null;
        // A note may have come into a project, or left one.
        if (!this.analyser.idle) this.apply();
      }),
    );
    context.onUnload(() => this.stop());
    this.apply();
  }

  /** The plugin is unloading: the marks go from every editor. */
  stop(): void {
    if (this.closed) return;
    this.closed = true;
    for (const stop of this.stops.splice(0)) stop();
    this.choices.release();
    this.extensions.length = 0;
    if (this.registered) this.context.app.workspace.updateOptions();
  }

  /** Whether the note at a vault path is checked: a Markdown note inside a Spellbook project. */
  covers(path: string | null): boolean {
    if (path === null || !isMarkdownPath(path)) return false;
    this.folders ??= this.context.store.listProjects().map((project) => project.folder);
    return this.folders.some((folder) => isInside(folder, path));
  }

  /** Switch all the checks on or off. */
  toggleAll(): void {
    const before = this.choices.prefs;
    const after = withMaster(before, !before.on);
    this.choices.set(after);
    if (!after.on) this.say('Prose checks: off');
    else if (before.checks.length === 0) {
      this.say(`Prose checks: on (${FIRST_CHECKS.map((check) => CHECK_NAMES[check].toLowerCase()).join(', ')}). More can be chosen in the settings.`);
    } else this.say('Prose checks: on');
  }

  /** Switch one check on or off. Switching one on switches the checks on as a whole. */
  toggle(check: ProseCheck): void {
    const before = this.choices.prefs;
    const on = !isShown(before, check);
    this.choices.set(withCheck(before, check, on));
    this.say(`${CHECK_NAMES[check]}: ${on ? 'on' : 'off'}`);
  }

  private say(message: string): void {
    new Notice(message, NOTICE_MS);
  }

  /** Bring the editors in line with the writer's choices. */
  private apply(): void {
    if (this.closed) return;
    const { context } = this;
    this.analyser = new ProseAnalyser(optionsOf(this.choices.prefs));
    this.extensions.length = 0;
    if (!this.analyser.idle) {
      const host: ProseEditorHost = {
        analyser: this.analyser,
        covers: (path) => this.covers(path),
        touch: Platform.isMobile,
        setTimer: (callback, ms) => context.clock.setTimer(callback, ms),
      };
      // A new extension each time: the editors then draw everything afresh.
      this.extensions.push(proseEditor(host));
      if (!this.registered) {
        context.plugin.registerEditorExtension(this.extensions);
        this.registered = true;
      }
    }
    if (this.registered) context.app.workspace.updateOptions();
  }
}

export const proseFeature: Feature = {
  id: 'prose',
  register(context: FeatureContext): void {
    // The marks are drawn in the editor. Where the plugin cannot be given a
    // place in it, the feature stays off as a whole, rather than offering
    // switches that do nothing.
    const plugin: { registerEditorExtension?: unknown } = context.plugin;
    if (typeof plugin.registerEditorExtension !== 'function') return;
    new ProseChecks(context).start();
  },
};
