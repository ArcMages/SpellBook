// The corkboard and the inspector: index cards for the scenes of the open
// project, and a panel that edits the open scene's properties.
//
// This file plugs them into the plugin. It makes the host the screens ask
// (storeHost.ts, on top of the project store), registers the two kinds of pane
// with Obsidian, and adds the commands and the ribbon button that open them.
// Everything is registered through the plugin, so Obsidian takes it away
// again when the plugin is switched off; the host is let go of by hand.

import { Notice } from 'obsidian';
import { folderScope } from '../../core/cards';
import type { Feature, FeatureContext } from '../registry';
import { CORKBOARD_ICON, CORKBOARD_VIEW_TYPE, createCorkboardView } from './corkboardView';
import { INSPECTOR_VIEW_TYPE, createInspectorView } from './inspectorView';
import { CardPanes } from './panes';
import { StoreCardsHost } from './storeHost';
import { openTagLists } from './tagListsModal';

export { CORKBOARD_VIEW_TYPE, CorkboardView, createCorkboardView } from './corkboardView';
export type {
  CardsChange,
  CardsHost,
  CardsProject,
  CorkboardHost,
  HostAnswer,
  InspectorHost,
  TagListChange,
  Unsubscribe,
} from './host';
export { INSPECTOR_VIEW_TYPE, InspectorView, createInspectorView } from './inspectorView';
export { CardPanes } from './panes';
export { StoreCardsHost } from './storeHost';
export { TagListsModal, openTagLists } from './tagListsModal';

/** What the ribbon button says. (Obsidian shows it as a tooltip.) */
export const CORKBOARD_RIBBON_TITLE = 'Open Spellbook corkboard';

/** The commands this feature adds. Obsidian puts the plugin's name in front of each name. */
export const CORKBOARD_COMMANDS = {
  openCorkboard: { id: 'open-corkboard', name: 'Open corkboard' },
  openInspector: { id: 'open-inspector', name: 'Open inspector' },
  manageLists: { id: 'manage-statuses-and-labels', name: 'Manage statuses and labels' },
} as const;

/**
 * The name under which the corkboard offers the other screens to show a
 * binder folder. The binder's folder menu asks for it ("Show on corkboard").
 */
export const SHOW_FOLDER_SERVICE = 'corkboard.showFolder';

/** What is offered under that name: show a folder of a project, by the project's index path and the folder's id. */
export type ShowFolder = (inProject: string, folderId: string) => Promise<void>;

export const OTHER_PROJECT_TEXT = 'That project is no longer the open one.';

export const corkboardFeature: Feature = {
  id: 'corkboard',
  register(context: FeatureContext): void {
    const { app, plugin, store } = context;
    // The host is there before the kinds of pane are known to Obsidian: a pane
    // that Obsidian puts back from the last session can ask it at once. Until
    // a project is open it says that there is none.
    const host = new StoreCardsHost(context);
    const panes = new CardPanes(app);
    context.onUnload(() => {
      panes.release();
      host.dispose();
    });

    plugin.registerView(CORKBOARD_VIEW_TYPE, (leaf) => createCorkboardView(leaf, host));
    plugin.registerView(INSPECTOR_VIEW_TYPE, (leaf) => createInspectorView(leaf, host.forInspector));

    plugin.addRibbonIcon(CORKBOARD_ICON, CORKBOARD_RIBBON_TITLE, () => {
      void panes.openCorkboard();
    });
    plugin.addCommand({
      ...CORKBOARD_COMMANDS.openCorkboard,
      callback: () => {
        void panes.openCorkboard();
      },
    });
    plugin.addCommand({
      ...CORKBOARD_COMMANDS.openInspector,
      callback: () => {
        void panes.openInspector();
      },
    });
    plugin.addCommand({
      ...CORKBOARD_COMMANDS.manageLists,
      // Only offered while there is a project whose lists it can show.
      checkCallback: (checking) => {
        if (store.project === null) return false;
        if (!checking) openTagLists(app, host.forInspector);
        return true;
      },
    });

    const showFolder: ShowFolder = async (inProject, folderId) => {
      // A menu can stay open for a while: the folder belongs to the project it was made for.
      if (store.project?.indexPath !== inProject) {
        new Notice(OTHER_PROJECT_TEXT);
        return;
      }
      await panes.openCorkboard(folderScope(folderId));
    };
    context.services.provide(SHOW_FOLDER_SERVICE, showFolder);
  },
};
