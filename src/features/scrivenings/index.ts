// Scrivenings: the scenes of the manuscript (or of one folder of the binder)
// shown one after another, as one continuous text to read through, each
// under a small divider with its title and word count.
//
// This file plugs it into the plugin. It makes the host the pane asks
// (host.ts, on top of the project store and the vault doorway), registers the
// kind of pane with Obsidian, and adds the command and the ribbon button that
// open it. Everything is registered through the plugin, so Obsidian takes it
// away again when the plugin is switched off; the host is let go of by hand.
//
// The pane is for reading. A scene is edited in Obsidian's own editor, which
// opens on the scene (and the paragraph) that was tapped: Obsidian's public
// API has no way to put a working editor for a note inside another pane, and
// the plugin never writes a note's text itself.

import { Notice, Platform } from 'obsidian';
import type { App, WorkspaceLeaf } from 'obsidian';
import type { Feature, FeatureContext } from '../registry';
import { obsidianDrawer } from './drawing';
import { ScriveningsHost } from './host';
import { SCRIVENINGS_VIEW_TYPE, createScriveningsView, scriveningsIcon } from './scriveningsView';

export { ScriveningsHost, MEMORY_KEY, WORD_COUNT_ASKER } from './host';
export type { HostScene, ScopeScenes, ScriveningsChange } from './host';
export {
  SCRIVENINGS_ICONS,
  SCRIVENINGS_VIEW_NAME,
  SCRIVENINGS_VIEW_TYPE,
  ScriveningsView,
  createScriveningsView,
} from './scriveningsView';

/** What the ribbon button says. (Obsidian shows it as a tooltip.) */
export const SCRIVENINGS_RIBBON_TITLE = 'Open Spellbook novel view';

/** The command this feature adds. Obsidian puts the plugin's name in front of its name. */
export const SCRIVENINGS_COMMANDS = {
  openScrivenings: { id: 'open-scrivenings', name: 'Open novel view' },
} as const;

export const COULD_NOT_OPEN_TEXT = 'The novel view could not be opened.';

/** How long a notice about something that went wrong stays up, in milliseconds. */
const PROBLEM_NOTICE_MS = 10000;

/**
 * Brings the continuous manuscript onto the screen, as a tab in the main
 * area. A pane that is already open anywhere is brought to the front instead
 * of opening a second one, however fast it is asked for.
 */
export class ScriveningsPane {
  private readonly app: App;
  private released = false;
  /** The pane being brought to the front, so that two requests cannot open two. */
  private arriving: Promise<WorkspaceLeaf | null> | null = null;

  constructor(app: App) {
    this.app = app;
  }

  /** The plugin is being switched off: nothing is opened from here on. */
  release(): void {
    this.released = true;
    this.arriving = null;
  }

  /** Show the continuous manuscript. */
  reveal(): Promise<WorkspaceLeaf | null> {
    if (this.released) return Promise.resolve(null);
    if (!this.arriving) {
      const arriving = this.bring().finally(() => {
        if (this.arriving === arriving) this.arriving = null;
      });
      this.arriving = arriving;
    }
    return this.arriving;
  }

  private async bring(): Promise<WorkspaceLeaf | null> {
    const { workspace } = this.app;
    try {
      let leaf = workspace.getLeavesOfType(SCRIVENINGS_VIEW_TYPE)[0] ?? null;
      if (!leaf) {
        leaf = workspace.getLeaf('tab');
        await leaf.setViewState({ type: SCRIVENINGS_VIEW_TYPE, active: true });
      }
      await workspace.revealLeaf(leaf);
      // On a phone the drawers lie over the main area: slide them away so that the manuscript can be seen.
      if (!this.released && Platform.isPhone && leaf.getRoot() === workspace.rootSplit) {
        workspace.leftSplit.collapse();
        workspace.rightSplit.collapse();
      }
      return leaf;
    } catch (error) {
      console.error('Spellbook: scrivenings could not be opened', error);
      new Notice(COULD_NOT_OPEN_TEXT, PROBLEM_NOTICE_MS);
      return null;
    }
  }
}

export const scriveningsFeature: Feature = {
  id: 'scrivenings',
  register(context: FeatureContext): void {
    const { app, plugin } = context;
    // Nothing is read from the device's storage, and nothing in the vault is
    // followed, until a pane asks.
    const host = new ScriveningsHost(context, obsidianDrawer(app));
    const pane = new ScriveningsPane(app);
    context.onUnload(() => {
      pane.release();
      host.dispose();
    });

    plugin.registerView(SCRIVENINGS_VIEW_TYPE, (leaf) => createScriveningsView(leaf, host));
    plugin.addRibbonIcon(scriveningsIcon(), SCRIVENINGS_RIBBON_TITLE, () => {
      void pane.reveal();
    });
    plugin.addCommand({
      ...SCRIVENINGS_COMMANDS.openScrivenings,
      callback: () => {
        void pane.reveal();
      },
    });
  },
};
