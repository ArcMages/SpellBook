// The writing report: the figures of the scene that is open, of a folder of
// the binder (a chapter) or of the whole manuscript: words, characters,
// sentences, paragraphs, pages, reading time, reading grade and the most
// used words.
//
// This file plugs it into the plugin. It makes the host the pane asks
// (host.ts, on top of the project store and the vault doorway), registers the
// kind of pane with Obsidian, and adds the command and the ribbon button that
// open it. Everything is registered through the plugin, so Obsidian takes it
// away again when the plugin is switched off; the host is let go of by hand.

import { Notice, Platform } from 'obsidian';
import type { App, WorkspaceLeaf } from 'obsidian';
import type { Feature, FeatureContext } from '../registry';
import { ReportHost } from './host';
import { REPORT_VIEW_TYPE, createReportView, reportIcon } from './reportView';
import { ReportPrefs, reportSettings } from './settings';

export { ReportHost } from './host';
export type { ReportChange, ReportOutcome, ReportSubject } from './host';
export { REPORT_ICONS, REPORT_VIEW_NAME, REPORT_VIEW_TYPE, ReportView, createReportView } from './reportView';
export { ReportPrefs, WORDS_PER_PAGE_KEY, reportSettings } from './settings';

/** What the ribbon button says. (Obsidian shows it as a tooltip.) */
export const REPORT_RIBBON_TITLE = 'Open Spellbook writing report';

/** The command this feature adds. Obsidian puts the plugin's name in front of its name. */
export const REPORT_COMMANDS = {
  openReport: { id: 'open-writing-report', name: 'Open writing report' },
} as const;

export const COULD_NOT_OPEN_TEXT = 'The writing report could not be opened.';

/** How long a notice about something that went wrong stays up, in milliseconds. */
const PROBLEM_NOTICE_MS = 10000;

/**
 * Brings the writing report onto the screen, as a tab in the main area. A
 * report that is already open anywhere is brought to the front instead of
 * opening a second one, however fast it is asked for.
 */
export class ReportPane {
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

  /** Show the writing report. */
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
      let leaf = workspace.getLeavesOfType(REPORT_VIEW_TYPE)[0] ?? null;
      if (!leaf) {
        leaf = workspace.getLeaf('tab');
        await leaf.setViewState({ type: REPORT_VIEW_TYPE, active: true });
      }
      await workspace.revealLeaf(leaf);
      // On a phone the drawers lie over the main area: slide them away so that the report can be seen.
      if (!this.released && Platform.isPhone && leaf.getRoot() === workspace.rootSplit) {
        workspace.leftSplit.collapse();
        workspace.rightSplit.collapse();
      }
      return leaf;
    } catch (error) {
      console.error('Spellbook: the writing report could not be opened', error);
      new Notice(COULD_NOT_OPEN_TEXT, PROBLEM_NOTICE_MS);
      return null;
    }
  }
}

export const reportFeature: Feature = {
  id: 'report',
  register(context: FeatureContext): void {
    const { app, plugin } = context;
    // Nothing is read from the device's storage, and nothing in the vault is
    // followed, until a pane asks.
    const prefs = new ReportPrefs(context.storage);
    const host = new ReportHost(context, prefs);
    const pane = new ReportPane(app);
    context.onUnload(() => {
      pane.release();
      host.dispose();
      prefs.release();
    });

    plugin.registerView(REPORT_VIEW_TYPE, (leaf) => createReportView(leaf, host));
    plugin.addRibbonIcon(reportIcon(), REPORT_RIBBON_TITLE, () => {
      void pane.reveal();
    });
    plugin.addCommand({
      ...REPORT_COMMANDS.openReport,
      callback: () => {
        void pane.reveal();
      },
    });
    // The words on a page can be set in the report itself and in the plugin's settings tab.
    context.addSettingsSection(reportSettings(prefs));
  },
};
