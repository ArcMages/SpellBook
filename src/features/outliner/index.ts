// The outliner: the manuscript of the open project as a table, one row per
// scene, with its status, its progress toward its word target, its words,
// synopsis, tags, to-do lines and reading time, and a row of totals.
//
// This file plugs it into the plugin. It makes the host the table asks
// (host.ts, on top of the project store), registers the kind of pane with
// Obsidian, and adds the command and the ribbon button that open it.
// Everything is registered through the plugin, so Obsidian takes it away
// again when the plugin is switched off; the host is let go of by hand.

import { Notice, Platform } from 'obsidian';
import type { App, WorkspaceLeaf } from 'obsidian';
import type { Feature, FeatureContext } from '../registry';
import { OutlinerHost } from './host';
import { OUTLINER_ICON, OUTLINER_VIEW_TYPE, createOutlinerView } from './outlinerView';
import { PROBLEM_NOTICE_MS } from './parts';

export { OutlinerHost } from './host';
export type { OutlinerChange, OutlinerProject } from './host';
export { OUTLINER_ICON, OUTLINER_VIEW_NAME, OUTLINER_VIEW_TYPE, OutlinerView, createOutlinerView } from './outlinerView';

/** What the ribbon button says. (Obsidian shows it as a tooltip.) */
export const OUTLINER_RIBBON_TITLE = 'Open Spellbook outliner';

/** The command this feature adds. Obsidian puts the plugin's name in front of its name. */
export const OUTLINER_COMMANDS = {
  openOutliner: { id: 'open-outliner', name: 'Open outliner' },
} as const;

export const COULD_NOT_OPEN_TEXT = 'The outliner could not be opened.';

/**
 * Brings the outliner onto the screen, as a tab in the main area. An outliner
 * that is already open anywhere is brought to the front instead of opening a
 * second one, however fast it is asked for.
 */
export class OutlinerPane {
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

  /** Show the outliner. */
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
      let leaf = workspace.getLeavesOfType(OUTLINER_VIEW_TYPE)[0] ?? null;
      if (!leaf) {
        leaf = workspace.getLeaf('tab');
        await leaf.setViewState({ type: OUTLINER_VIEW_TYPE, active: true });
      }
      await workspace.revealLeaf(leaf);
      // On a phone the drawers lie over the main area: slide them away so that the table can be seen.
      if (!this.released && Platform.isPhone && leaf.getRoot() === workspace.rootSplit) {
        workspace.leftSplit.collapse();
        workspace.rightSplit.collapse();
      }
      return leaf;
    } catch (error) {
      console.error('Spellbook: the outliner could not be opened', error);
      new Notice(COULD_NOT_OPEN_TEXT, PROBLEM_NOTICE_MS);
      return null;
    }
  }
}

export const outlinerFeature: Feature = {
  id: 'outliner',
  register(context: FeatureContext): void {
    const { app, plugin } = context;
    // The host is there before the kind of pane is known to Obsidian: a pane
    // that Obsidian puts back from the last session can ask it at once. Until
    // a project is open it says that there is none.
    const host = new OutlinerHost(context);
    const pane = new OutlinerPane(app);
    context.onUnload(() => {
      pane.release();
      host.dispose();
    });

    plugin.registerView(OUTLINER_VIEW_TYPE, (leaf) => createOutlinerView(leaf, host));
    plugin.addRibbonIcon(OUTLINER_ICON, OUTLINER_RIBBON_TITLE, () => {
      void pane.reveal();
    });
    plugin.addCommand({
      ...OUTLINER_COMMANDS.openOutliner,
      callback: () => {
        void pane.reveal();
      },
    });
  },
};
