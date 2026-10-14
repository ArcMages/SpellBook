// The writing modes put together: which are on, how they are tuned, and the
// two places that follow (the page around the editors, chrome.ts, and the
// editors themselves, extensions.ts).
//
// Switching a mode saves the choice on this device, changes the page, and
// hands every editor a new list of extensions. The list is one array that is
// registered with Obsidian once, the first time a mode needs the editors;
// after that it is emptied and filled again, and Obsidian is asked to have
// the editors take it anew. An empty list leaves no trace in an editor.

import { Notice } from 'obsidian';
import type { Extension } from '@codemirror/state';
import { MODES, MODE_IDS, NO_MODES, sameModeSettings, withMode } from '../../core/modes/index';
import type { ModeId, ModeSet, ModeSettings, ModeState, ModesService } from '../../core/modes/index';
import type { FeatureContext } from '../registry';
import { ModesChrome } from './chrome';
import { modeExtensions } from './extensions';
import { ModesPrefs } from './prefs';

export const ZEN_ESCAPE_HINT = 'Press Escape to leave.';
export const ZEN_BUTTON_HINT = 'The button in the corner leaves it.';

export interface ControllerOptions {
  /** A phone or tablet. */
  readonly mobile: boolean;
  /** A phone. */
  readonly phone: boolean;
  /** An iPhone or iPad. */
  readonly ios: boolean;
}

export class ModesController implements ModesService {
  private readonly context: FeatureContext;
  private readonly options: ControllerOptions;
  private readonly prefs: ModesPrefs;
  private readonly chrome: ModesChrome;
  /** The one list Obsidian was handed. Its contents change; the array stays. */
  private readonly extensions: Extension[] = [];
  private registered = false;
  private current: ModeSet = NO_MODES;
  private tuned: ModeSettings;
  private readonly listeners = new Set<() => void>();
  private released = false;

  constructor(context: FeatureContext, options: ControllerOptions) {
    this.context = context;
    this.options = options;
    this.prefs = new ModesPrefs(context.storage, options.phone);
    this.tuned = this.prefs.loadSettings();
    this.chrome = new ModesChrome({
      app: context.app,
      clock: context.clock,
      mobile: options.mobile,
      switchOff: (id) => {
        this.set(id, false);
      },
    });
  }

  /** Bring back the modes that were on when Obsidian was last closed on this device. */
  start(): void {
    this.current = this.prefs.loadModes();
    this.follow();
  }

  /** The plugin is being switched off. What is on stays remembered for the next time. */
  release(): void {
    if (this.released) return;
    this.released = true;
    this.listeners.clear();
    this.chrome.release();
    if (this.extensions.length > 0) {
      this.extensions.length = 0;
      this.context.app.workspace.updateOptions();
    }
  }

  // ----------------------------------------------------------------- the modes

  modes(): ModeState[] {
    return MODE_IDS.map((id) => ({ id, name: MODES[id].name, commandId: MODES[id].command.id, on: this.current[id] }));
  }

  isOn(id: ModeId): boolean {
    return this.current[id];
  }

  toggle(id: ModeId): void {
    this.set(id, !this.current[id]);
  }

  set(id: ModeId, on: boolean): void {
    if (this.released || this.current[id] === on) return;
    this.current = withMode(this.current, id, on);
    this.prefs.saveModes(this.current);
    this.follow();
    new Notice(this.switchedText(id, on));
    for (const listener of [...this.listeners]) {
      try {
        listener();
      } catch (error) {
        console.error('Spellbook: a screen could not follow the writing modes', error);
      }
    }
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  // -------------------------------------------------------------- the settings

  get settings(): ModeSettings {
    return this.tuned;
  }

  /** Change some of the settings. The modes that are on follow at once. */
  tune(change: Partial<ModeSettings>): void {
    if (this.released) return;
    const next = { ...this.tuned, ...change };
    if (sameModeSettings(next, this.tuned)) return;
    this.tuned = next;
    this.prefs.saveSettings(next);
    this.follow();
  }

  // ---------------------------------------------------------------------------

  private switchedText(id: ModeId, on: boolean): string {
    const text = `${MODES[id].name} ${on ? 'on' : 'off'}.`;
    if (id !== 'zen' || !on) return text;
    if (this.options.mobile) return `${text} ${ZEN_BUTTON_HINT}`;
    return this.tuned.zenEscape ? `${text} ${ZEN_ESCAPE_HINT}` : text;
  }

  /** Have the page and the editors agree with the modes and the settings. */
  private follow(): void {
    this.chrome.apply(this.current, this.tuned);
    const next = modeExtensions(this.current, this.tuned, {
      clock: this.context.clock,
      ios: this.options.ios,
      mobile: this.options.mobile,
      blocked: (what, editorEl) => {
        this.chrome.blocked(what, editorEl);
      },
    });
    // Nothing in the editors, and nothing to take out of them.
    if (next.length === 0 && this.extensions.length === 0) return;
    // New extensions each time: the editors would not notice the same ones again.
    this.extensions.length = 0;
    this.extensions.push(...next);
    if (!this.registered) {
      this.registered = true;
      this.context.plugin.registerEditorExtension(this.extensions);
    }
    this.context.app.workspace.updateOptions();
  }
}
