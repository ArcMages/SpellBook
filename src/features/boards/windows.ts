// The small windows of the idea boards:
//
//   BoardPickerModal     a list of the project's boards to pick one from
//   EntityPickerModal    a list of the World's entities to pick one from
//   RelationMapModal     which types of entity go on a relationship map
//   ChapterBoardModal    which part of the binder, grouped how
//   CardsToNotesModal    what each text card of a board becomes
//
// The windows only ask; the keeper does the work. Every choice is a tap on a
// list, a switch or a button, so they work the same with a finger, a mouse
// and a keyboard, at phone width.

import { FuzzySuggestModal, Modal, Notice, Setting } from 'obsidian';
import type { App, FuzzyMatch } from 'obsidian';
import { choiceKey, choiceOf, splitCardText } from '../../core/boards';
import type { ReadCard } from '../../core/boards';
import type { Entity, EntityType } from '../../core/world';
import { safely } from '../../ui/safely';
import { describeCards } from './keeper';
import type { BoardInfo, CardDecision, Conversion, GroupBy, Outcome, SceneFolder } from './keeper';
import { PROBLEM_NOTICE_MS } from '../../ui/notices';

export const PICK_BOARD_TEXT = 'Which board?';
export const NO_BOARD_FOUND_TEXT = 'No board with that name.';
export const PICK_ENTITY_TEXT = 'Which entity?';
export const NO_ENTITY_FOUND_TEXT = 'No entity with that name.';
export const DRAW_TEXT = 'Draw board';
export const CANCEL_TEXT = 'Cancel';
export const MAP_TITLE = 'Board: relationship map';
export const MAP_TEXT = 'Which entities go on the map? Each relation between two of them becomes a line, labelled as the World says.';
export const CHAPTER_TITLE = 'Board: chapter as cards';
export const CHAPTER_FOLDER_LABEL = 'Scenes from';
export const CHAPTER_GROUP_LABEL = 'Group by';
export const GROUP_NAMES: Readonly<Record<GroupBy, string>> = { status: 'Status', label: 'Label', none: 'No grouping' };
export const CARDS_TITLE = 'Turn board cards into notes';
export const CARDS_TEXT =
  'Choose what each card becomes. The first line is the title; the rest becomes the synopsis of a scene, or the summary of a World entry. On the board, the card then shows the new note, in the same place.';
export const KEEP_TEXT = 'Leave as a card';
export const SCENE_TEXT = 'Scene';
export const ALL_SCENES_TEXT = 'All scenes';
export const NONE_TEXT = 'Leave all';
export const WHERE_LABEL = 'New scenes go to';
export const MAKE_TEXT = 'Make notes';
export const NO_TEXT_CARDS_TEXT = 'This board has no text cards to turn into notes.';
export const NOTHING_CHOSEN_TEXT = 'Choose "Scene" or a World type for at least one card.';

/** "World: Character". */
export function entityChoiceText(type: EntityType): string {
  return `World: ${type.name}`;
}

/** What the window says when the cards have been turned into notes. */
export function conversionText(done: Conversion): string {
  const notes = done.made.length === 1 ? '1 note made' : `${done.made.length} notes made`;
  const cards = done.swapped === done.made.length ? '' : `; ${describeCards(done.swapped)} changed on the board`;
  return `${notes}${cards}.`;
}

/** A plain list to choose from, built by hand so that every option is the writer's text with its own direction. */
function choiceList(parent: HTMLElement, cls: string, label: string, options: ReadonlyArray<readonly [string, string]>, value: string, onChange: (value: string) => void): HTMLSelectElement {
  const select = parent.createEl('select', { cls: `dropdown ${cls}`, attr: { 'aria-label': label, dir: 'auto' } });
  for (const [key, text] of options) select.createEl('option', { text, attr: { value: key, dir: 'auto' } });
  select.value = value;
  select.addEventListener('change', () => {
    onChange(select.value);
  });
  return select;
}

// --------------------------------------------------------------- pickers

export class BoardPickerModal extends FuzzySuggestModal<BoardInfo> {
  private readonly boards: readonly BoardInfo[];
  private readonly choose: (board: BoardInfo) => void;

  constructor(app: App, boards: readonly BoardInfo[], choose: (board: BoardInfo) => void) {
    super(app);
    this.boards = boards;
    this.choose = choose;
    this.setPlaceholder(PICK_BOARD_TEXT);
    this.emptyStateText = NO_BOARD_FOUND_TEXT;
    this.modalEl.addClass('spellbook-boards-picker');
    this.inputEl.setAttr('dir', 'auto');
  }

  override getItems(): BoardInfo[] {
    return [...this.boards];
  }

  override getItemText(board: BoardInfo): string {
    return board.name;
  }

  override renderSuggestion(match: FuzzyMatch<BoardInfo>, el: HTMLElement): void {
    super.renderSuggestion(match, el);
    el.setAttr('dir', 'auto');
  }

  override onChooseItem(board: BoardInfo): void {
    this.choose(board);
  }
}

export class EntityPickerModal extends FuzzySuggestModal<Entity> {
  private readonly entities: readonly Entity[];
  private readonly typeName: (entity: Entity) => string;
  private readonly choose: (entity: Entity) => void;

  constructor(app: App, entities: readonly Entity[], typeName: (entity: Entity) => string, choose: (entity: Entity) => void) {
    super(app);
    this.entities = entities;
    this.typeName = typeName;
    this.choose = choose;
    this.setPlaceholder(PICK_ENTITY_TEXT);
    this.emptyStateText = NO_ENTITY_FOUND_TEXT;
    this.modalEl.addClass('spellbook-boards-picker');
    this.inputEl.setAttr('dir', 'auto');
  }

  override getItems(): Entity[] {
    return [...this.entities];
  }

  override getItemText(entity: Entity): string {
    return entity.name;
  }

  override renderSuggestion(match: FuzzyMatch<Entity>, el: HTMLElement): void {
    el.setAttr('dir', 'auto');
    el.createDiv({ cls: 'spellbook-boards-pick-name', text: match.item.name, attr: { dir: 'auto' } });
    const type = this.typeName(match.item);
    if (type !== '') el.createDiv({ cls: 'spellbook-boards-pick-type', text: type, attr: { dir: 'auto' } });
  }

  override onChooseItem(entity: Entity): void {
    this.choose(entity);
  }
}

// --------------------------------------------------------- relation map

export class RelationMapModal extends Modal {
  private readonly types: readonly EntityType[];
  private readonly draw: (typeIds: string[]) => Promise<string | null>;
  private readonly chosen = new Set<string>();
  private busy = false;

  /**
   * @param types the types to offer: those the World has entities of
   * @param draw  draws the board; resolves with null when done, or why not (the window stays open)
   */
  constructor(app: App, types: readonly EntityType[], draw: (typeIds: string[]) => Promise<string | null>) {
    super(app);
    this.types = types;
    this.draw = draw;
    // Characters are on the map unless the writer says otherwise; with no characters, everything is.
    const characters = types.some((type) => type.id === 'character');
    for (const type of types) if (!characters || type.id === 'character') this.chosen.add(type.id);
  }

  override onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    this.titleEl.setText(MAP_TITLE);
    this.modalEl.addClass('spellbook-boards-window');
    contentEl.createEl('p', { cls: 'spellbook-boards-window-text', text: MAP_TEXT });
    for (const type of this.types) {
      const row = new Setting(contentEl).setName(type.name);
      row.nameEl.setAttr('dir', 'auto');
      row.addToggle((toggle) =>
        toggle.setValue(this.chosen.has(type.id)).onChange((on) => {
          if (on) this.chosen.add(type.id);
          else this.chosen.delete(type.id);
        }),
      );
    }
    const message = contentEl.createDiv({ cls: 'spellbook-boards-window-message', attr: { 'aria-live': 'polite' } });
    new Setting(contentEl)
      .addButton((button) =>
        button.setButtonText(CANCEL_TEXT).onClick(() => {
          this.close();
        }),
      )
      .addButton((button) =>
        button
          .setButtonText(DRAW_TEXT)
          .setCta()
          .onClick(() => {
            if (this.busy) return;
            this.busy = true;
            safely(DRAW_TEXT, async () => {
              const problem = await this.draw(this.types.filter((type) => this.chosen.has(type.id)).map((type) => type.id));
              this.busy = false;
              if (problem === null) this.close();
              else message.setText(problem);
            });
          }),
      );
  }

  override onClose(): void {
    this.contentEl.empty();
  }
}

// --------------------------------------------------------- chapter board

export class ChapterBoardModal extends Modal {
  private readonly folders: readonly SceneFolder[];
  private readonly draw: (folderId: string | null, groupBy: GroupBy) => Promise<string | null>;
  private folder = '';
  private groupBy: GroupBy = 'status';
  private busy = false;

  /**
   * @param folders the parts of the binder to offer; the first (parentId null) is the whole manuscript
   * @param draw    draws the board; resolves with null when done, or why not (the window stays open)
   */
  constructor(app: App, folders: readonly SceneFolder[], draw: (folderId: string | null, groupBy: GroupBy) => Promise<string | null>) {
    super(app);
    this.folders = folders;
    this.draw = draw;
    // A chapter is a folder: the first one is offered first, when there is one.
    this.folder = folders.find((folder) => folder.parentId !== null)?.parentId ?? '';
  }

  override onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    this.titleEl.setText(CHAPTER_TITLE);
    this.modalEl.addClass('spellbook-boards-window');
    const form = contentEl.createDiv({ cls: 'spellbook-boards-form' });
    const where = form.createDiv({ cls: 'spellbook-boards-field' });
    where.createDiv({ cls: 'spellbook-boards-field-name', text: CHAPTER_FOLDER_LABEL });
    choiceList(
      where,
      'spellbook-boards-folder',
      CHAPTER_FOLDER_LABEL,
      this.folders.map((folder): [string, string] => [folder.parentId ?? '', folder.label]),
      this.folder,
      (value) => {
        this.folder = value;
      },
    );
    const group = form.createDiv({ cls: 'spellbook-boards-field' });
    group.createDiv({ cls: 'spellbook-boards-field-name', text: CHAPTER_GROUP_LABEL });
    choiceList(
      group,
      'spellbook-boards-group',
      CHAPTER_GROUP_LABEL,
      (Object.keys(GROUP_NAMES) as GroupBy[]).map((key): [string, string] => [key, GROUP_NAMES[key]]),
      this.groupBy,
      (value) => {
        this.groupBy = value === 'label' || value === 'none' ? value : 'status';
      },
    );
    const message = contentEl.createDiv({ cls: 'spellbook-boards-window-message', attr: { 'aria-live': 'polite' } });
    new Setting(contentEl)
      .addButton((button) =>
        button.setButtonText(CANCEL_TEXT).onClick(() => {
          this.close();
        }),
      )
      .addButton((button) =>
        button
          .setButtonText(DRAW_TEXT)
          .setCta()
          .onClick(() => {
            if (this.busy) return;
            this.busy = true;
            safely(DRAW_TEXT, async () => {
              const problem = await this.draw(this.folder === '' ? null : this.folder, this.groupBy);
              this.busy = false;
              if (problem === null) this.close();
              else message.setText(problem);
            });
          }),
      );
  }

  override onClose(): void {
    this.contentEl.empty();
  }
}

// ------------------------------------------------------ cards into notes

/** What the cards window is given. */
export interface CardsWindow {
  /** The board's name, for the window's title. */
  readonly boardName: string;
  readonly cards: readonly ReadCard[];
  readonly types: readonly EntityType[];
  readonly folders: readonly SceneFolder[];
  /** Makes the notes; resolves with what was done, or why nothing was. */
  readonly convert: (decisions: CardDecision[], parentId: string | null) => Promise<Outcome<Conversion>>;
}

export class CardsToNotesModal extends Modal {
  private readonly window: CardsWindow;
  /** What each card is to become, by its id: a key of choiceKey. */
  private readonly chosen = new Map<string, string>();
  private readonly selects = new Map<string, HTMLSelectElement>();
  private folder = '';
  private busy = false;

  constructor(app: App, window: CardsWindow) {
    super(app);
    this.window = window;
    for (const card of window.cards) this.chosen.set(card.id, 'keep');
  }

  override onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    this.titleEl.setText(`${CARDS_TITLE}: ${this.window.boardName}`);
    this.titleEl.setAttr('dir', 'auto');
    this.modalEl.addClass('spellbook-boards-window');
    this.modalEl.addClass('spellbook-boards-cards-window');
    contentEl.createEl('p', { cls: 'spellbook-boards-window-text', text: CARDS_TEXT });

    const options: Array<[string, string]> = [
      ['keep', KEEP_TEXT],
      [choiceKey({ kind: 'scene' }), SCENE_TEXT],
      ...this.window.types.map((type): [string, string] => [choiceKey({ kind: 'entity', typeId: type.id }), entityChoiceText(type)]),
    ];
    const quick = contentEl.createDiv({ cls: 'spellbook-boards-quick' });
    const quickButton = (text: string, key: string): void => {
      const button = quick.createEl('button', { text, attr: { type: 'button' } });
      button.addEventListener('click', () => {
        for (const card of this.window.cards) {
          this.chosen.set(card.id, key);
          const select = this.selects.get(card.id);
          if (select) select.value = key;
        }
      });
    };
    quickButton(ALL_SCENES_TEXT, 'scene');
    quickButton(NONE_TEXT, 'keep');

    const list = contentEl.createDiv({ cls: 'spellbook-boards-cards' });
    for (const card of this.window.cards) {
      const { title, rest } = splitCardText(card.text);
      const row = list.createDiv({ cls: 'spellbook-boards-card' });
      const words = row.createDiv({ cls: 'spellbook-boards-card-words' });
      words.createDiv({ cls: 'spellbook-boards-card-title', text: title, attr: { dir: 'auto' } });
      if (rest !== '') words.createDiv({ cls: 'spellbook-boards-card-rest', text: rest, attr: { dir: 'auto' } });
      const select = choiceList(row, 'spellbook-boards-card-choice', `What "${title}" becomes`, options, 'keep', (value) => {
        this.chosen.set(card.id, value);
      });
      this.selects.set(card.id, select);
    }

    const where = contentEl.createDiv({ cls: 'spellbook-boards-field' });
    where.createDiv({ cls: 'spellbook-boards-field-name', text: WHERE_LABEL });
    choiceList(
      where,
      'spellbook-boards-folder',
      WHERE_LABEL,
      this.window.folders.map((folder): [string, string] => [folder.parentId ?? '', folder.label]),
      '',
      (value) => {
        this.folder = value;
      },
    );

    const message = contentEl.createDiv({ cls: 'spellbook-boards-window-message', attr: { 'aria-live': 'polite' } });
    new Setting(contentEl)
      .addButton((button) =>
        button.setButtonText(CANCEL_TEXT).onClick(() => {
          this.close();
        }),
      )
      .addButton((button) =>
        button
          .setButtonText(MAKE_TEXT)
          .setCta()
          .onClick(() => {
            if (this.busy) return;
            const decisions = this.decisions();
            if (decisions.every((decision) => decision.choice.kind === 'keep')) {
              message.setText(NOTHING_CHOSEN_TEXT);
              return;
            }
            this.busy = true;
            button.setDisabled(true);
            safely(MAKE_TEXT, async () => {
              const outcome = await this.window.convert(decisions, this.folder === '' ? null : this.folder);
              this.busy = false;
              button.setDisabled(false);
              if (!outcome.ok) {
                message.setText(outcome.message);
                return;
              }
              const done = outcome.value;
              if (done.problems.length > 0) new Notice([conversionText(done), ...done.problems].join(' '), PROBLEM_NOTICE_MS);
              else new Notice(conversionText(done), 5000);
              this.close();
            });
          }),
      );
  }

  /** What the writer chose for each card, in the order of the list. */
  decisions(): CardDecision[] {
    return this.window.cards.map((card) => ({ card, choice: choiceOf(this.chosen.get(card.id) ?? 'keep') }));
  }

  /** Choose for one card, as the list does: for the tests, and for nothing else. */
  choose(cardId: string, key: string): void {
    this.chosen.set(cardId, key);
    const select = this.selects.get(cardId);
    if (select) select.value = key;
  }

  /** Choose where new scenes go, as the list does. */
  chooseFolder(parentId: string | null): void {
    this.folder = parentId ?? '';
  }

  override onClose(): void {
    this.selects.clear();
    this.contentEl.empty();
  }
}
