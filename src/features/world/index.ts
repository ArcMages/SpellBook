// World-building: the characters, places, factions, items, lore, creatures
// and cultures of a story (and whatever other types the writer makes), each
// a plain note in the project's World folder, the links between them and
// the scenes they are in, and the relations between them.
//
// This file plugs it into the plugin. It makes the host (host.ts, on top of
// the project store), registers the World browser's kind of pane, adds the
// commands and the ribbon button, and offers the inspector the service that
// says who and what is in a scene. Everything is registered through the
// plugin, so Obsidian takes it away again when the plugin is switched off;
// the host is let go of by hand.

import { Notice, Platform } from 'obsidian';
import type { App, WorkspaceLeaf } from 'obsidian';
import { ENTITY_SHEET_SERVICE, SCENE_ENTITIES_SERVICE, WORLD_HISTORY_SERVICE } from '../../core/world';
import type { EntitySheetService, WorldHistoryService } from '../../core/world';
import { ENTITY_BOARD_SERVICE } from '../../core/boards';
import type { EntityBoardService } from '../../core/boards';
import { RENAME_EVERYWHERE_SERVICE } from '../../core/revision';
import type { RenameEverywhereService } from '../../core/revision';
import { iconName } from '../../ui/icons';
import type { Feature, FeatureContext } from '../registry';
import { WorldHost } from './host';
import { askNewEntity } from './newEntity';
import { NO_PROJECT_TEXT, PROBLEM_NOTICE_MS, WORLD_ICONS } from './parts';
import { sceneEntitiesService } from './sceneService';
import { WORLD_ICON, WORLD_VIEW_TYPE, WorldView, createWorldView } from './worldView';

export { WorldHost } from './host';
export type { FoundMention, WorldProject } from './host';
export { WORLD_ICON, WORLD_VIEW_NAME, WORLD_VIEW_TYPE, WorldView, createWorldView } from './worldView';

/** What the ribbon button says. (Obsidian shows it as a tooltip.) */
export const WORLD_RIBBON_TITLE = 'Open Spellbook world';

/** The commands this feature adds. Obsidian puts the plugin's name in front of each name. */
export const WORLD_COMMANDS = {
  openWorld: { id: 'open-world', name: 'Open world' },
  newCharacter: { id: 'new-character', name: 'New character' },
  newPlace: { id: 'new-place', name: 'New place' },
  newFaction: { id: 'new-faction', name: 'New faction' },
  newItem: { id: 'new-item', name: 'New item' },
  newLore: { id: 'new-lore', name: 'New lore' },
  newCreature: { id: 'new-creature', name: 'New creature' },
  newCulture: { id: 'new-culture', name: 'New culture' },
  newEntity: { id: 'new-entity', name: 'New entity' },
  openEntitySheet: { id: 'open-entity-sheet', name: 'Open entity sheet' },
} as const;

/** The type each "New ..." command makes; null for the one that asks. */
const NEW_COMMANDS: ReadonlyArray<readonly [{ readonly id: string; readonly name: string }, string | null]> = [
  [WORLD_COMMANDS.newCharacter, 'character'],
  [WORLD_COMMANDS.newPlace, 'place'],
  [WORLD_COMMANDS.newFaction, 'faction'],
  [WORLD_COMMANDS.newItem, 'item'],
  [WORLD_COMMANDS.newLore, 'lore'],
  [WORLD_COMMANDS.newCreature, 'creature'],
  [WORLD_COMMANDS.newCulture, 'culture'],
  [WORLD_COMMANDS.newEntity, null],
];

export const COULD_NOT_OPEN_TEXT = 'The World browser could not be opened.';
export const NOT_AN_ENTITY_TEXT =
  'The note open in the editor is not an entity of the open project. Open a note from the World folder first, or use the World browser.';

/**
 * Brings the World browser onto the screen, as a tab in the main area. One
 * that is already open anywhere is brought to the front instead of opening a
 * second one, however fast it is asked for.
 */
export class WorldPane {
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

  /** Show the World browser. */
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
      let leaf = workspace.getLeavesOfType(WORLD_VIEW_TYPE)[0] ?? null;
      if (!leaf) {
        leaf = workspace.getLeaf('tab');
        await leaf.setViewState({ type: WORLD_VIEW_TYPE, active: true });
      }
      await workspace.revealLeaf(leaf);
      // On a phone the drawers lie over the main area: slide them away so that the browser can be seen.
      if (!this.released && Platform.isPhone && leaf.getRoot() === workspace.rootSplit) {
        workspace.leftSplit.collapse();
        workspace.rightSplit.collapse();
      }
      return leaf;
    } catch (error) {
      console.error('Spellbook: the World browser could not be opened', error);
      new Notice(COULD_NOT_OPEN_TEXT, PROBLEM_NOTICE_MS);
      return null;
    }
  }
}

export const worldFeature: Feature = {
  id: 'world',
  register(context: FeatureContext): void {
    const { app, plugin } = context;
    // The host is there before the kind of pane is known to Obsidian: a pane
    // that Obsidian puts back from the last session can ask it at once. Until
    // a project is open it says that there is none.
    const host = new WorldHost(context);
    const pane = new WorldPane(app);
    context.onUnload(() => {
      pane.release();
      host.release();
    });

    // Who and what is in a scene, for the inspector: looked up by name when it is needed.
    context.services.provide(SCENE_ENTITIES_SERVICE, sceneEntitiesService(app, host));

    // An entity's sheet, for the timeline: a tap on an entity of a world lane shows it here.
    const sheets: EntitySheetService = {
      show: (entityPath) => {
        if (host.isReleased || host.entity(entityPath) === null) return;
        void pane.reveal().then((leaf) => {
          const view: unknown = leaf?.view;
          if (view instanceof WorldView) view.showSheet(entityPath);
        });
      },
    };
    context.services.provide(ENTITY_SHEET_SERVICE, sheets);
    // The other way round: the browser's "History" button asks the timeline, when one offers it.
    host.showWorldHistory = () => {
      const history = context.services.get<WorldHistoryService>(WORLD_HISTORY_SERVICE);
      history?.show();
      return history !== undefined;
    };

    // A board around an entity, for the sheet's button: offered by the idea boards, when they are there.
    host.entityBoard = () => context.services.get<EntityBoardService>(ENTITY_BOARD_SERVICE) ?? null;
    // "Rename everywhere" in an entity's menu and on its sheet: offered by the revision tools, when they are there.
    host.renameEverywhere = () => context.services.get<RenameEverywhereService>(RENAME_EVERYWHERE_SERVICE) ?? null;

    plugin.registerView(WORLD_VIEW_TYPE, (leaf) => createWorldView(leaf, host));
    plugin.addRibbonIcon(iconName(...WORLD_ICONS.view) ?? WORLD_ICON, WORLD_RIBBON_TITLE, () => {
      void pane.reveal();
    });
    plugin.addCommand({
      ...WORLD_COMMANDS.openWorld,
      callback: () => {
        void pane.reveal();
      },
    });
    // The sheet of the entity whose note is open in the editor.
    plugin.addCommand({
      ...WORLD_COMMANDS.openEntitySheet,
      callback: () => {
        if (host.isReleased) return;
        const open = app.workspace.getActiveFile();
        const path = open === null ? null : host.entityPathOf(open.path);
        if (path === null) {
          new Notice(host.project === null ? NO_PROJECT_TEXT : NOT_AN_ENTITY_TEXT, PROBLEM_NOTICE_MS);
          return;
        }
        void pane.reveal().then((leaf) => {
          const view: unknown = leaf?.view;
          if (view instanceof WorldView) view.showSheet(path);
        });
      },
    });
    for (const [command, typeId] of NEW_COMMANDS) {
      plugin.addCommand({
        ...command,
        callback: () => {
          if (!host.isReleased) askNewEntity(app, host, typeId);
        },
      });
    }
  },
};
