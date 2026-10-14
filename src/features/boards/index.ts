// Idea boards: free-form boards for loose ideas, in the spirit of Scapple.
// A board is an Obsidian Canvas file in the project's Boards folder, so it
// opens in Obsidian's own Canvas on a Mac, an iPhone and an iPad, and stays
// usable without the plugin. Spellbook adds:
//   - "New idea board", and the Boards pane, which lists the boards with
//     their card counts, opens, renames and deletes them (to the trash);
//   - "Turn board cards into notes": a board's text cards become scenes or
//     World entries, and the cards then show the new notes;
//   - three boards drawn for the writer: a relationship map of the World, a
//     chapter as cards, and the web around one entity.
//
// This file plugs it into the plugin: the kind of pane, the commands, the
// ribbon button, and the service the World browser's sheet asks for.
// Everything is registered through the plugin, so Obsidian takes it away
// again when the plugin is switched off; the keeper is let go of by hand.
//
// Obsidian's public API (the "obsidian" package, 1.14) declares the JSON of a
// Canvas file and nothing of the Canvas screen: no event or menu of a card
// on the canvas. So "Make this a scene" cannot be added to a card's own menu
// without reaching into Obsidian's private parts, which Spellbook does not.
// The command and the pane's menu do the same for the board that is open.

import { Notice } from 'obsidian';
import type { App, WorkspaceLeaf } from 'obsidian';
import { ENTITY_BOARD_SERVICE } from '../../core/boards';
import type { EntityBoardService } from '../../core/boards';
import type { Feature, FeatureContext } from '../registry';
import { BoardActions } from './actions';
import { BOARDS_VIEW_TYPE, boardsIcon, createBoardsView } from './boardsView';
import { BoardKeeper } from './keeper';

export { BoardActions } from './actions';
export { BOARDS_VIEW_NAME, BOARDS_VIEW_TYPE, BoardsView } from './boardsView';
export { BoardKeeper } from './keeper';

/** What the ribbon button says. (Obsidian shows it as a tooltip.) */
export const BOARDS_RIBBON_TITLE = 'Open Spellbook idea boards';

/** The commands this feature adds. Obsidian puts the plugin's name in front of each name. */
export const BOARD_COMMANDS = {
  newBoard: { id: 'new-idea-board', name: 'New idea board' },
  openBoards: { id: 'open-boards', name: 'Open idea boards' },
  cardsToNotes: { id: 'board-cards-to-notes', name: 'Turn board cards into notes' },
  relationshipMap: { id: 'board-relationship-map', name: 'Board: relationship map' },
  chapterCards: { id: 'board-chapter-cards', name: 'Board: chapter as cards' },
  entityWeb: { id: 'board-entity-web', name: 'Board: around this entity' },
} as const;

export const COULD_NOT_OPEN_TEXT = 'The idea boards could not be opened.';
const PROBLEM_NOTICE_MS = 10000;

/**
 * Brings the Boards pane onto the screen, in the side bar on the right (a
 * drawer on a phone). One that is already open is brought to the front.
 */
export class BoardsPane {
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
      let leaf = workspace.getLeavesOfType(BOARDS_VIEW_TYPE)[0] ?? null;
      if (!leaf) {
        leaf = workspace.getRightLeaf(false) ?? workspace.getLeaf('tab');
        await leaf.setViewState({ type: BOARDS_VIEW_TYPE, active: true });
      }
      await workspace.revealLeaf(leaf);
      return leaf;
    } catch (error) {
      console.error('Spellbook: the idea boards could not be opened', error);
      new Notice(COULD_NOT_OPEN_TEXT, PROBLEM_NOTICE_MS);
      return null;
    }
  }
}

export const boardsFeature: Feature = {
  id: 'boards',
  register(context: FeatureContext): void {
    const { app, plugin } = context;
    const keeper = new BoardKeeper(context);
    const actions = new BoardActions(app, keeper);
    const pane = new BoardsPane(app);
    context.onUnload(() => {
      pane.release();
      keeper.release();
    });

    /** The vault path of the file open in the editor, or null. */
    const front = (): string | null => app.workspace.getActiveFile()?.path ?? null;

    // For the World browser's sheet: looked up by name when the sheet is drawn.
    const entityBoards: EntityBoardService = {
      draw: (entityPath) => {
        if (keeper.isReleased) return;
        actions.askEntityBoard(entityPath);
      },
    };
    context.services.provide(ENTITY_BOARD_SERVICE, entityBoards);

    plugin.registerView(BOARDS_VIEW_TYPE, (leaf) => createBoardsView(leaf, keeper, actions));
    plugin.addRibbonIcon(boardsIcon(), BOARDS_RIBBON_TITLE, () => {
      void pane.reveal();
    });
    plugin.addCommand({
      ...BOARD_COMMANDS.openBoards,
      callback: () => {
        void pane.reveal();
      },
    });
    plugin.addCommand({
      ...BOARD_COMMANDS.newBoard,
      callback: () => {
        if (keeper.isReleased) return;
        actions.askNewBoard();
      },
    });
    plugin.addCommand({
      ...BOARD_COMMANDS.cardsToNotes,
      callback: () => {
        if (keeper.isReleased) return;
        const open = front();
        actions.chooseBoard(open === null ? null : keeper.boardAt(open), (board) => {
          void actions.cardsToNotes(board);
        });
      },
    });
    plugin.addCommand({
      ...BOARD_COMMANDS.relationshipMap,
      callback: () => {
        if (!keeper.isReleased) actions.askRelationshipMap();
      },
    });
    plugin.addCommand({
      ...BOARD_COMMANDS.chapterCards,
      callback: () => {
        if (!keeper.isReleased) actions.askChapterBoard();
      },
    });
    plugin.addCommand({
      ...BOARD_COMMANDS.entityWeb,
      callback: () => {
        if (keeper.isReleased) return;
        const open = front();
        const entity = open === null ? null : keeper.entityAt(open);
        actions.askEntityBoard(entity?.path ?? null);
      },
    });
  },
};
