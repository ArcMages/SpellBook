// The planner: the project's to-dos (kept in To-do.md) and the calendar,
// which shows the words written each day, the to-dos that are due and the
// marks put on days.
//
// This file plugs the screen into the plugin (see src/features/registry.ts).
// It registers the planner's view, a ribbon button and a command that open
// it, and a command that opens To-do.md. The screen itself is plannerView.ts;
// what it reads and changes goes through plannerWiring.ts.

import { Notice, moment } from 'obsidian';
import type { WorkspaceLeaf } from 'obsidian';
import { iconName } from '../../ui/icons';
import type { Feature, FeatureContext } from '../registry';
import { firstDayOfWeekOf } from './plannerNumbers';
import { PLANNER_ICON, PLANNER_VIEW_TYPE, createPlannerView } from './plannerView';
import { PlannerWiring } from './plannerWiring';
import { PROBLEM_NOTICE_MS } from '../../ui/notices';

/** The commands the planner adds. Obsidian puts the plugin's name in front of their names. */
export const OPEN_PLANNER_COMMAND = { id: 'open-planner', name: 'Open planner' } as const;
export const OPEN_TODO_NOTE_COMMAND = { id: 'open-todo-note', name: 'Open to-do note' } as const;

/** What the ribbon button says when it is pointed at. (The ribbon does not add the plugin's name.) */
export const PLANNER_RIBBON_TITLE = 'Open Spellbook planner';

/**
 * Show the planner as a tab in the main area. A planner that is open
 * anywhere is brought to the front instead: asking twice never opens two.
 */
async function revealPlanner(context: FeatureContext): Promise<void> {
  const { workspace } = context.app;
  try {
    let leaf: WorkspaceLeaf | null = workspace.getLeavesOfType(PLANNER_VIEW_TYPE)[0] ?? null;
    if (!leaf) {
      leaf = workspace.getLeaf('tab');
      await leaf.setViewState({ type: PLANNER_VIEW_TYPE, active: true });
    }
    await workspace.revealLeaf(leaf);
  } catch (error) {
    console.error('Spellbook: the planner could not be opened', error);
    new Notice('The planner could not be opened.', PROBLEM_NOTICE_MS);
  }
}

export const plannerFeature: Feature = {
  id: 'planner',
  register(context: FeatureContext): void {
    // The host comes first: Obsidian may put a planner back into a pane the
    // moment its view type exists, before any project is open.
    const wiring = new PlannerWiring({
      store: context.store,
      vault: context.vault,
      clock: context.clock,
      services: context.services,
      openNote: (path, where) => context.openNote(path, where),
      // Obsidian sets `moment` to the language of the app; Sunday when it cannot be told.
      firstDayOfWeek: () => firstDayOfWeekOf(moment),
    });
    let unloaded = false;
    context.onUnload(() => {
      unloaded = true;
      wiring.dispose();
    });

    /** The planner being brought to the front, so that two requests cannot open two. */
    let opening: Promise<void> | null = null;
    const openPlanner = (): Promise<void> => {
      if (unloaded) return Promise.resolve();
      opening ??= revealPlanner(context).finally(() => {
        opening = null;
      });
      return opening;
    };

    const { plugin } = context;
    plugin.registerView(PLANNER_VIEW_TYPE, (leaf) => createPlannerView(leaf, wiring));
    plugin.addRibbonIcon(iconName(...PLANNER_ICON) ?? 'calendar', PLANNER_RIBBON_TITLE, () => {
      void openPlanner();
    });
    plugin.addCommand({
      ...OPEN_PLANNER_COMMAND,
      callback: () => {
        void openPlanner();
      },
    });
    // Only offered while there is a project whose to-dos could be shown.
    plugin.addCommand({
      ...OPEN_TODO_NOTE_COMMAND,
      checkCallback: (checking) => {
        if (!wiring.hasProject) return false;
        if (!checking) wiring.openTodoNote();
        return true;
      },
    });
  },
};
