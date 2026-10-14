// The Boards pane: the idea boards of the open project, each with how many
// cards it has. A tap opens a board in Obsidian's own Canvas; the button at
// the end of a row (or a right click) offers to open it in
// a new tab, turn its cards into notes, rename it or move it to the trash.
// "New board" makes an empty one, "Draw" one drawn for the writer.
//
// Everything it shows comes from the keeper, and everything it changes goes
// through the board actions (actions.ts). Touch first: every action is a
// button or a menu item, nothing depends on hovering or on dragging.

import { ItemView, Keymap, Menu, Platform } from 'obsidian';
import type { WorkspaceLeaf } from 'obsidian';
import { iconName, showIcon } from '../../ui/icons';
import { safely } from '../../ui/safely';
import type { BoardActions } from './actions';
import { BoardKeeper, NO_PROJECT_TEXT, describeCards } from './keeper';
import type { BoardInfo } from './keeper';

export const BOARDS_VIEW_TYPE = 'spellbook-boards';
export const BOARDS_VIEW_NAME = 'Idea boards';
/** The pane's icon, by every name Obsidian has had for it. */
export const BOARDS_ICONS = ['layout-dashboard', 'layout', 'layout-grid'] as const;

export function boardsIcon(): string {
  return iconName(...BOARDS_ICONS) ?? 'layout-dashboard';
}

export const NEW_BOARD_TEXT = 'New board';
export const DRAW_BOARD_TEXT = 'Draw';
export const DRAW_BOARD_LABEL = 'Draw a board for you';
export const EMPTY_TEXT = 'No boards yet. A board is a free canvas for loose ideas: "New board" makes one, and "Draw" lays one out for you from the World or the binder.';
export const MORE_LABEL = 'More';
export const OPEN_TEXT = 'Open';
export const OPEN_TAB_TEXT = 'Open in new tab';
export const CARDS_TO_NOTES_TEXT = 'Turn cards into notes';
export const RENAME_TEXT = 'Rename';
export const DELETE_TEXT = 'Delete';
export const COUNTING_TEXT = 'counting...';
export const UNREADABLE_TEXT = 'cannot be read';
export const RELATIONSHIP_MAP_TEXT = 'Relationship map';
export const CHAPTER_CARDS_TEXT = 'Chapter as cards';
export const ENTITY_WEB_TEXT = 'Around an entity';

const MORE_ICON = ['ellipsis', 'more-horizontal'] as const;

/** What a row says about the number of cards. */
export function countText(board: BoardInfo, counting: boolean): string {
  if (board.cards === null) return counting ? COUNTING_TEXT : UNREADABLE_TEXT;
  return describeCards(board.cards);
}

export class BoardsView extends ItemView {
  private readonly keeper: BoardKeeper;
  private readonly actions: BoardActions;
  private list: HTMLElement | null = null;
  private header: HTMLElement | null = null;
  private stops: Array<() => void> = [];
  private closed = true;

  constructor(leaf: WorkspaceLeaf, keeper: BoardKeeper, actions: BoardActions) {
    super(leaf);
    this.keeper = keeper;
    this.actions = actions;
    this.navigation = false;
  }

  override getViewType(): string {
    return BOARDS_VIEW_TYPE;
  }

  override getDisplayText(): string {
    return BOARDS_VIEW_NAME;
  }

  override getIcon(): string {
    return boardsIcon();
  }

  protected override async onOpen(): Promise<void> {
    this.closed = false;
    const pane = this.contentEl;
    pane.empty();
    const root = pane.createDiv({ cls: 'spellbook-boards' });
    root.toggleClass('spellbook-is-mobile', Platform.isMobile);
    root.toggleClass('spellbook-is-phone', Platform.isPhone);
    this.header = root.createDiv({ cls: 'spellbook-boards-header' });
    this.list = root.createDiv({ cls: 'spellbook-boards-list', attr: { role: 'list' } });
    this.stops.push(
      this.keeper.onChange(() => {
        this.render();
      }),
    );
    this.render();
  }

  protected override async onClose(): Promise<void> {
    this.closed = true;
    for (const stop of this.stops.splice(0)) stop();
    this.list = null;
    this.header = null;
    this.contentEl.empty();
  }

  /** Draw the pane again from what the keeper holds now. */
  render(): void {
    const { list, header } = this;
    if (this.closed || !list || !header) return;
    header.empty();
    list.empty();
    const project = this.keeper.project;
    if (!project) {
      list.createDiv({ cls: 'spellbook-boards-empty', text: NO_PROJECT_TEXT });
      return;
    }
    header.createDiv({ cls: 'spellbook-boards-title', text: project.title, attr: { dir: 'auto' } });
    const buttons = header.createDiv({ cls: 'spellbook-boards-buttons' });
    if (!project.readOnly) {
      const add = buttons.createEl('button', { cls: 'mod-cta spellbook-boards-new', text: NEW_BOARD_TEXT, attr: { type: 'button' } });
      add.addEventListener('click', () => {
        safely(NEW_BOARD_TEXT, () => {
          this.actions.askNewBoard();
        });
      });
      const draw = buttons.createEl('button', { cls: 'spellbook-boards-draw', text: DRAW_BOARD_TEXT, attr: { type: 'button', 'aria-label': DRAW_BOARD_LABEL } });
      draw.addEventListener('click', (event) => {
        this.showDrawMenu(event);
      });
    }

    const boards = this.keeper.boards();
    if (boards.length === 0) {
      list.createDiv({ cls: 'spellbook-boards-empty', text: EMPTY_TEXT });
      return;
    }
    let uncounted = false;
    for (const board of boards) {
      if (board.cards === null) uncounted = true;
      this.drawRow(list, board, !project.readOnly);
    }
    if (uncounted) this.keeper.countCards();
  }

  private drawRow(list: HTMLElement, board: BoardInfo, canChange: boolean): void {
    const row = list.createDiv({ cls: 'spellbook-boards-row', attr: { role: 'listitem' } });
    const open = row.createEl('button', { cls: 'spellbook-boards-open', attr: { type: 'button' } });
    showIcon(open.createSpan({ cls: 'spellbook-boards-icon' }), ...BOARDS_ICONS);
    open.createSpan({ cls: 'spellbook-boards-name', text: board.name, attr: { dir: 'auto' } });
    open.createSpan({ cls: 'spellbook-boards-count', text: countText(board, true) });
    open.addEventListener('click', (event) => {
      safely(OPEN_TEXT, () => this.actions.open(board.path, Keymap.isModEvent(event)));
    });
    open.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      this.showRowMenu(board, canChange, event);
    });
    const more = row.createEl('button', { cls: 'clickable-icon spellbook-boards-more', attr: { type: 'button', 'aria-label': MORE_LABEL } });
    showIcon(more, ...MORE_ICON);
    more.addEventListener('click', (event) => {
      this.showRowMenu(board, canChange, event);
    });
  }

  private showRowMenu(board: BoardInfo, canChange: boolean, event: MouseEvent): void {
    const menu = new Menu();
    menu.addItem((item) =>
      item
        .setTitle(OPEN_TEXT)
        .setIcon(iconName(...BOARDS_ICONS))
        .onClick(() => {
          safely(OPEN_TEXT, () => this.actions.open(board.path, false));
        }),
    );
    menu.addItem((item) =>
      item
        .setTitle(OPEN_TAB_TEXT)
        .setIcon(iconName('file-plus', 'plus'))
        .onClick(() => {
          safely(OPEN_TAB_TEXT, () => this.actions.open(board.path, 'tab'));
        }),
    );
    if (canChange) {
      menu.addSeparator();
      menu.addItem((item) =>
        item
          .setTitle(CARDS_TO_NOTES_TEXT)
          .setIcon(iconName('file-input', 'file-plus'))
          .onClick(() => {
            safely(CARDS_TO_NOTES_TEXT, () => this.actions.cardsToNotes(board));
          }),
      );
      menu.addItem((item) =>
        item
          .setTitle(RENAME_TEXT)
          .setIcon(iconName('pencil', 'edit-3'))
          .onClick(() => {
            safely(RENAME_TEXT, () => {
              this.actions.askRename(board);
            });
          }),
      );
      menu.addItem((item) =>
        item
          .setTitle(DELETE_TEXT)
          .setIcon(iconName('trash-2', 'trash'))
          .onClick(() => {
            safely(DELETE_TEXT, () => {
              this.actions.askTrash(board);
            });
          }),
      );
    }
    menu.showAtMouseEvent(event);
  }

  private showDrawMenu(event: MouseEvent): void {
    const menu = new Menu();
    menu.addItem((item) =>
      item.setTitle(RELATIONSHIP_MAP_TEXT).onClick(() => {
        safely(RELATIONSHIP_MAP_TEXT, () => {
          this.actions.askRelationshipMap();
        });
      }),
    );
    menu.addItem((item) =>
      item.setTitle(CHAPTER_CARDS_TEXT).onClick(() => {
        safely(CHAPTER_CARDS_TEXT, () => {
          this.actions.askChapterBoard();
        });
      }),
    );
    menu.addItem((item) =>
      item.setTitle(ENTITY_WEB_TEXT).onClick(() => {
        safely(ENTITY_WEB_TEXT, () => {
          this.actions.askEntityBoard(null);
        });
      }),
    );
    menu.showAtMouseEvent(event);
  }
}

export function createBoardsView(leaf: WorkspaceLeaf, keeper: BoardKeeper, actions: BoardActions): BoardsView {
  return new BoardsView(leaf, keeper, actions);
}
