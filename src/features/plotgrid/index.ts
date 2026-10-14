// The plot grid: which scene carries which plotline. A row per scene, a
// column per timeline lane, label, character, place or chosen entity.
//
// This file plugs it into the plugin: the host (host.ts, on top of the
// project store), the kind of pane, the command and the ribbon button that
// open it, and its part of the settings tab. Everything is registered through
// the plugin, so Obsidian takes it away again when the plugin is switched
// off; the host is let go of by hand.

import { Notice, Platform, Setting } from 'obsidian';
import type { App, WorkspaceLeaf } from 'obsidian';
import { MAX_GAP_LENGTH, MIN_GAP_LENGTH, readGapLength } from '../../core/plotgrid';
import type { Feature, FeatureContext, SettingsSection } from '../registry';
import { PROBLEM_NOTICE_MS, PlotGridHost } from './host';
import { PLOT_GRID_ICON, PLOT_GRID_VIEW_TYPE, createPlotGridView } from './plotGridView';

export { PlotGridHost } from './host';
export { PLOT_GRID_ICON, PLOT_GRID_VIEW_NAME, PLOT_GRID_VIEW_TYPE, PlotGridView, createPlotGridView } from './plotGridView';

/** What the ribbon button says. (Obsidian shows it as a tooltip.) */
export const PLOT_GRID_RIBBON_TITLE = 'Open Spellbook plot grid';

export const PLOT_GRID_COMMANDS = {
  openPlotGrid: { id: 'open-plot-grid', name: 'Open plot grid' },
} as const;

export const COULD_NOT_OPEN_TEXT = 'The plot grid could not be opened.';

export const GAP_SETTING_NAME = 'Mark long gaps';
export const OUTSIDE_SETTING_NAME = 'Shade before and after';

/** Brings the plot grid onto the screen as a tab in the main area; one that is open already is brought to the front. */
export class PlotGridPane {
  private readonly app: App;
  private released = false;
  private arriving: Promise<WorkspaceLeaf | null> | null = null;

  constructor(app: App) {
    this.app = app;
  }

  release(): void {
    this.released = true;
    this.arriving = null;
  }

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
      let leaf = workspace.getLeavesOfType(PLOT_GRID_VIEW_TYPE)[0] ?? null;
      if (!leaf) {
        leaf = workspace.getLeaf('tab');
        await leaf.setViewState({ type: PLOT_GRID_VIEW_TYPE, active: true });
      }
      await workspace.revealLeaf(leaf);
      // On a phone the drawers lie over the main area: slide them away so that the grid can be seen.
      if (!this.released && Platform.isPhone && leaf.getRoot() === workspace.rootSplit) {
        workspace.leftSplit.collapse();
        workspace.rightSplit.collapse();
      }
      return leaf;
    } catch (error) {
      console.error('Spellbook: the plot grid could not be opened', error);
      new Notice(COULD_NOT_OPEN_TEXT, PROBLEM_NOTICE_MS);
      return null;
    }
  }
}

/** The plot grid's part of the settings tab: how long a gap must be before it is marked, and whether a plotline's span stands out. */
export function plotGridSettings(host: PlotGridHost): SettingsSection {
  return {
    id: 'plotgrid',
    title: 'Plot grid',
    render(containerEl: HTMLElement): void {
      new Setting(containerEl)
        .setName(GAP_SETTING_NAME)
        .setDesc(
          'How many scenes in a row a plotline can be missing from before the plot grid shades the stretch. ' +
            `Any whole number from ${MIN_GAP_LENGTH} to ${MAX_GAP_LENGTH}; 0 turns the shading off. This choice is kept on this device only.`,
        )
        .addText((text) => {
          text.inputEl.setAttr('inputmode', 'numeric');
          text.setValue(String(host.prefs.gapLength)).onChange((value) => {
            // While a number is being typed it may be out of bounds for a moment: it is taken once it is not.
            const typed = value.trim();
            if (!/^\d+$/.test(typed)) return;
            const length = readGapLength(typed);
            if (String(length) === String(Number(typed))) host.setGapLength(length);
          });
        });
      new Setting(containerEl)
        .setName(OUTSIDE_SETTING_NAME)
        .setDesc(
          "Shade a plotline's cells before its first scene and after its last, so the stretch where it is in the story stands out. " +
            'This choice is kept on this device only.',
        )
        .addToggle((toggle) => {
          toggle.setValue(host.prefs.shadeOutside).onChange((on) => {
            host.setShadeOutside(on);
          });
        });
    },
  };
}

export const plotGridFeature: Feature = {
  id: 'plotgrid',
  register(context: FeatureContext): void {
    const { app, plugin } = context;
    const host = new PlotGridHost(context);
    const pane = new PlotGridPane(app);
    context.onUnload(() => {
      pane.release();
      host.dispose();
    });

    plugin.registerView(PLOT_GRID_VIEW_TYPE, (leaf) => createPlotGridView(leaf, host));
    plugin.addRibbonIcon(PLOT_GRID_ICON, PLOT_GRID_RIBBON_TITLE, () => {
      void pane.reveal();
    });
    plugin.addCommand({
      ...PLOT_GRID_COMMANDS.openPlotGrid,
      callback: () => {
        void pane.reveal();
      },
    });
    context.addSettingsSection(plotGridSettings(host));
  },
};
