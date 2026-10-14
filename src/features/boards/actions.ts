// What the commands, the Boards pane and the World browser's button do: ask
// what is needed in a small window, have the keeper do it, and open the
// board that was made. Each problem is told in a notice or in the window.

import { Notice, Platform } from 'obsidian';
import type { App } from 'obsidian';
import type { NewBoard } from '../../core/boards';
import { findType } from '../../core/world';
import { ConfirmModal } from '../../ui/confirmModal';
import { TextPromptModal } from '../../ui/textPromptModal';
import { BoardKeeper, NO_PROJECT_TEXT, NO_ENTITIES_TEXT } from './keeper';
import type { BoardInfo, Outcome } from './keeper';
import { BoardPickerModal, CardsToNotesModal, ChapterBoardModal, EntityPickerModal, NO_TEXT_CARDS_TEXT, RelationMapModal } from './windows';

export const NEW_BOARD_TITLE = 'New idea board';
export const NEW_BOARD_LABEL = 'Name';
export const NEW_BOARD_PLACEHOLDER = 'For example: ideas for part two';
export const CREATE_TEXT = 'Create';
export const RENAME_TITLE = 'Rename board';
export const RENAME_CONFIRM = 'Rename';
export const NO_BOARDS_TEXT = 'This project has no boards yet. Use "New idea board" to make one.';
export const NO_WORLD_TEXT = 'The World of this project has no entities yet.';
export const BOARD_MADE_TEXT = 'Board drawn.';

const PROBLEM_NOTICE_MS = 10000;
const NOTICE_MS = 5000;

/** 'Delete "Ideas"?' */
export function trashTitle(board: BoardInfo): string {
  return `Delete "${board.name}"?`;
}

export const TRASH_MESSAGE = 'The board goes to the trash. The notes its cards show stay where they are.';

export class BoardActions {
  private readonly app: App;
  private readonly keeper: BoardKeeper;

  constructor(app: App, keeper: BoardKeeper) {
    this.app = app;
    this.keeper = keeper;
  }

  /**
   * Show a board (or a note) of the project in the main area. On a phone
   * the side drawers, which lie over it, slide away.
   */
  async open(path: string, where: boolean | 'tab' | 'split' | 'window' = false): Promise<void> {
    const shown = await this.keeper.open(path, where);
    if (shown && Platform.isPhone) {
      this.app.workspace.leftSplit?.collapse();
      this.app.workspace.rightSplit?.collapse();
    }
  }

  /** Why nothing can be changed now, told in a notice; true when it can. */
  private writable(): boolean {
    const blocked = this.keeper.whyNotWritable();
    if (blocked !== null) new Notice(blocked, PROBLEM_NOTICE_MS);
    return blocked === null;
  }

  /** Ask for a name, make an empty board, and open it. */
  askNewBoard(): void {
    if (!this.writable()) return;
    new TextPromptModal(this.app, {
      title: NEW_BOARD_TITLE,
      label: NEW_BOARD_LABEL,
      placeholder: NEW_BOARD_PLACEHOLDER,
      confirm: CREATE_TEXT,
      submit: async (value) => {
        const made = await this.keeper.create(value);
        if (!made.ok) return made.message;
        void this.open(made.value, false);
        return null;
      },
    }).open();
  }

  askRename(board: BoardInfo): void {
    if (!this.writable()) return;
    new TextPromptModal(this.app, {
      title: RENAME_TITLE,
      label: NEW_BOARD_LABEL,
      value: board.name,
      confirm: RENAME_CONFIRM,
      submit: async (value) => {
        const renamed = await this.keeper.renameBoard(board.path, value);
        return renamed.ok ? null : renamed.message;
      },
    }).open();
  }

  askTrash(board: BoardInfo): void {
    if (!this.writable()) return;
    new ConfirmModal(this.app, {
      title: trashTitle(board),
      message: TRASH_MESSAGE,
      confirm: 'Delete',
      onConfirm: () => {
        void this.keeper.trashBoard(board.path).then((problem) => {
          if (problem !== null) new Notice(problem, PROBLEM_NOTICE_MS);
        });
      },
    }).open();
  }

  /** Pick a board from the list (or take the one given), then turn its cards into notes. */
  chooseBoard(open: string | null, then: (board: BoardInfo) => void): void {
    const boards = this.keeper.boards();
    const given = open === null ? undefined : boards.find((board) => board.path === open);
    if (given) {
      then(given);
      return;
    }
    if (boards.length === 0) {
      new Notice(this.keeper.project ? NO_BOARDS_TEXT : NO_PROJECT_TEXT, PROBLEM_NOTICE_MS);
      return;
    }
    new BoardPickerModal(this.app, boards, then).open();
  }

  /** Open the window that turns a board's text cards into notes. */
  async cardsToNotes(board: BoardInfo): Promise<void> {
    if (!this.writable()) return;
    const cards = await this.keeper.textCardsOf(board.path);
    if (!cards.ok) {
      new Notice(cards.message, PROBLEM_NOTICE_MS);
      return;
    }
    if (cards.value.length === 0) {
      new Notice(NO_TEXT_CARDS_TEXT, NOTICE_MS);
      return;
    }
    new CardsToNotesModal(this.app, {
      boardName: board.name,
      cards: cards.value,
      types: this.keeper.types(),
      folders: this.keeper.sceneFolders(),
      convert: (decisions, parentId) => this.keeper.convert(board.path, decisions, parentId),
    }).open();
  }

  askRelationshipMap(): void {
    if (!this.writable()) return;
    const entities = this.keeper.entities();
    const types = this.keeper.types().filter((type) => entities.some((entity) => entity.typeId === type.id));
    if (types.length === 0) {
      new Notice(NO_WORLD_TEXT, PROBLEM_NOTICE_MS);
      return;
    }
    new RelationMapModal(this.app, types, async (typeIds) => {
      if (typeIds.length === 0) return NO_ENTITIES_TEXT;
      return this.make(this.keeper.relationshipMap(typeIds));
    }).open();
  }

  askChapterBoard(): void {
    if (!this.writable()) return;
    const folders = this.keeper.sceneFolders().map((folder) => (folder.parentId === null ? { ...folder, label: 'Whole manuscript' } : folder));
    new ChapterBoardModal(this.app, folders, async (folderId, groupBy) => this.make(this.keeper.chapterBoard(folderId, groupBy))).open();
  }

  /**
   * Draw a board around an entity: the one given, or one picked from the
   * list when none is given.
   */
  askEntityBoard(entityPath: string | null): void {
    if (!this.writable()) return;
    if (entityPath !== null) {
      void this.make(this.keeper.entityBoard(entityPath)).then((problem) => {
        if (problem !== null) new Notice(problem, PROBLEM_NOTICE_MS);
      });
      return;
    }
    const entities = this.keeper.entities();
    if (entities.length === 0) {
      new Notice(NO_WORLD_TEXT, PROBLEM_NOTICE_MS);
      return;
    }
    const types = this.keeper.types();
    new EntityPickerModal(this.app, entities, (entity) => findType(types, entity.typeId)?.name ?? '', (entity) => {
      this.askEntityBoard(entity.path);
    }).open();
  }

  /** Make a drawn board and open it. Resolves with null when done, or why not. */
  private async make(drawn: Outcome<{ name: string; board: NewBoard }>): Promise<string | null> {
    if (!drawn.ok) return drawn.message;
    const made = await this.keeper.createDrawn(drawn.value.name, drawn.value.board);
    if (!made.ok) return made.message;
    new Notice(BOARD_MADE_TEXT, NOTICE_MS);
    void this.open(made.value, false);
    return null;
  }
}
