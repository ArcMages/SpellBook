// The World browser: the characters, places, factions, items, lore,
// creatures and cultures of the open project, and whatever other types the
// writer made.
//
//   bar      a search box (names, other names and summaries), a list to show
//            one type only, the switch between "Cards" and "List", "New" and
//            the button for the window of types
//   list     as cards: the entities in groups, one per type; each card shows
//            the picture (or the type's icon), the name, one or two key
//            facts, the summary and the number of scenes it is in;
//            as a list: one table of them all, sorted by the column whose
//            heading was tapped (name, type, kind, from, until, scenes);
//            the cards can be put in order of date instead of name, and
//            "History" opens the world on the timeline
//   details  the entity sheet (sheet.ts): one entity as a card to read and
//            to fill in
//
// A tap on a card shows the entity's sheet, and so does the number of scenes
// on it; a tap on the name on the card opens the entity's note. In the table
// it is the same: a row shows the sheet, the name opens the note. With the
// usual key held, either opens the note in a new tab. The card's menu has
// both, and Rename and Delete (to the trash).
//
// How many columns of cards fit is the stylesheet's business; whether the
// pane is narrow is measured here, from the pane itself and not from the
// kind of device. A narrow pane (a phone, a sidebar) shows one column, and
// the sheet instead of the list, as a page with a button that leads back.
// Cards or list is this device's own choice, and is remembered on it.
//
// Names and summaries are the writer's own text, in any language: each takes
// the direction of its own text. Nothing depends on hovering or dragging.

import { ItemView, Keymap, Menu, Notice, Platform } from 'obsidian';
import type { WorkspaceLeaf } from 'obsidian';
import {
  ALL_TYPES,
  CARD_ORDERS,
  DEFAULT_CARD_ORDER,
  DEFAULT_SORT,
  OTHER_NAME,
  OTHER_TYPE,
  WORLD_COLUMNS,
  cardFacts,
  groupEntities,
  isNarrowPane,
  nextSort,
  sceneCountText,
  sortByDate,
  spanText,
  tableRows,
} from '../../core/world';
import type { CardOrder, Entity, EntityGroup, WorldLayout, WorldRow, WorldSort } from '../../core/world';
import { ConfirmModal } from '../../ui/confirmModal';
import { ROW_MORE_ICON, iconName, showIcon } from '../../ui/icons';
import { isInputMethodKey } from '../../ui/keys';
import { safely } from '../../ui/safely';
import { TextPromptModal } from '../../ui/textPromptModal';
import type { WorldHost } from './host';
import { askNewEntity } from './newEntity';
import {
  MORE_LABEL,
  NO_PROJECT_TEXT,
  WORLD_ICONS,
  entityPicture,
  iconButton,
  placeUnder,
  setColor,
  setShown,
  settle,
  textButton,
  typeBadge,
  typeTitle,
} from './parts';
import { EntitySheet, OPEN_NOTE_TEXT, RENAME_EVERYWHERE_TEXT } from './sheet';
import { openEntityTypes } from './typesModal';

export const WORLD_VIEW_TYPE = 'spellbook-world';
export const WORLD_VIEW_NAME = 'World';
export const WORLD_ICON = 'globe';

export const SEARCH_PLACEHOLDER = 'Search names and summaries';
export const ALL_TYPES_TEXT = 'All types';
export const NEW_TEXT = 'New';
export const TYPES_LABEL = 'Entity types';
export const NO_ENTITIES_TEXT = 'Nothing in the world yet.';
export const NO_ENTITIES_HINT =
  'Use "New" to add a character, a place, a faction, an item, a piece of lore, a creature or a culture. Each one is a plain note in the World folder of the project.';
export const NOTHING_FOUND_TEXT = 'Nothing matches.';
export const NONE_OF_TYPE_TEXT = 'None yet.';
export const CARDS_TEXT = 'Cards';
export const LIST_TEXT = 'List';
export const LAYOUT_LABEL = 'Show as';
export const SHEET_TEXT = 'Sheet';
export const HISTORY_TEXT = 'History';
export const HISTORY_LABEL = 'Open world history: the world on the timeline';
export const NO_TIMELINE_TEXT = 'The timeline is not available.';
export const CARD_ORDER_LABEL = 'Order of the cards';
export const OPEN_SHEET_TEXT = 'Open sheet';
export const OPEN_IN_NEW_TAB_TEXT = 'Open note in new tab';

export {
  BACK_LABEL,
  CLOSE_LABEL,
  EVENTS_HEADING,
  FIND_MENTIONS_TEXT,
  LINK_SCENE_TEXT,
  MENTIONS_HEADING,
  NO_MENTIONS_TEXT,
  NO_SCENES_TEXT,
  OPEN_NOTE_TEXT,
  REMOVE_FROM_SCENE_LABEL,
  SCENES_HEADING,
  SEARCHING_TEXT,
} from './sheet';

interface Elements {
  readonly root: HTMLElement;
  readonly search: HTMLInputElement;
  readonly filter: HTMLSelectElement;
  /** The two buttons of the switch between cards and list, by the layout each stands for. */
  readonly layouts: ReadonlyMap<WorldLayout, HTMLButtonElement>;
  readonly add: HTMLButtonElement;
  /** The list that orders the cards by name or by date; out of sight while the table shows. */
  readonly order: HTMLSelectElement;
  /** The button that opens the world's history on the timeline. */
  readonly history: HTMLButtonElement;
  readonly types: HTMLElement;
  readonly list: HTMLElement;
  readonly detail: HTMLElement;
}

export class WorldView extends ItemView {
  private readonly host: WorldHost;
  private els: Elements | null = null;
  private closed = true;
  private stops: Array<() => void> = [];
  private observer: ResizeObserver | null = null;

  private query = '';
  private typeFilter: string = ALL_TYPES;
  /** What the list of types to choose from was last drawn for. */
  private filterDrawn = '';
  private narrow = false;
  /** The entity on the sheet, by its path relative to the project folder. */
  private selected: string | null = null;
  /** How the table is sorted. It lasts as long as the pane. */
  private sort: WorldSort = DEFAULT_SORT;
  /** How the cards of each group are ordered. It lasts as long as the pane. */
  private cardOrder: CardOrder = DEFAULT_CARD_ORDER;
  private readonly sheet: EntitySheet;

  constructor(leaf: WorkspaceLeaf, host: WorldHost) {
    super(leaf);
    this.host = host;
    this.navigation = false;
    this.sheet = new EntitySheet(this.app, host, {
      isNarrow: () => this.narrow,
      showSheet: (path) => {
        this.select(path, true);
      },
      redrawSheet: () => {
        this.drawDetail();
      },
      isOpen: () => !this.closed,
    });
  }

  /** Show an entity's sheet: what "Open entity sheet" asks for. */
  showSheet(path: string): void {
    if (this.closed || this.host.entity(path) === null) return;
    this.select(path, true);
  }

  override getViewType(): string {
    return WORLD_VIEW_TYPE;
  }

  override getDisplayText(): string {
    return WORLD_VIEW_NAME;
  }

  override getIcon(): string {
    return iconName(...WORLD_ICONS.view) ?? WORLD_ICON;
  }

  // ---------------------------------------------------------------- lifecycle

  protected override async onOpen(): Promise<void> {
    this.closed = false;
    const pane = this.contentEl;
    pane.empty();
    pane.addClass('spellbook-world-pane');

    const root = pane.createDiv({ cls: 'spellbook-world' });
    root.toggleClass('spellbook-is-mobile', Platform.isMobile);
    // On a phone, Obsidian's own bar floats over the bottom of the pane.
    root.toggleClass('spellbook-is-phone', Platform.isPhone);

    const bar = root.createDiv({ cls: 'spellbook-world-bar' });
    const search = bar.createEl('input', {
      cls: 'spellbook-world-search',
      attr: {
        type: 'search',
        // What is typed may be in any language; let it pick its own direction.
        dir: 'auto',
        placeholder: SEARCH_PLACEHOLDER,
        'aria-label': SEARCH_PLACEHOLDER,
        enterkeyhint: 'search',
      },
    });
    search.addEventListener('input', () => {
      this.query = search.value;
      this.drawList();
    });
    search.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || isInputMethodKey(event) || search.value === '') return;
      event.preventDefault();
      search.value = '';
      this.query = '';
      this.drawList();
    });
    const filter = bar.createEl('select', { cls: 'dropdown spellbook-world-filter', attr: { 'aria-label': 'Show' } });
    filter.addEventListener('change', () => {
      this.typeFilter = filter.value;
      this.drawList();
    });
    // Cards or a table: two buttons side by side, the one in use pressed in.
    const layout = bar.createDiv({ cls: 'spellbook-world-layout', attr: { role: 'group', 'aria-label': LAYOUT_LABEL } });
    const layouts = new Map<WorldLayout, HTMLButtonElement>();
    for (const [id, text] of [['cards', CARDS_TEXT], ['list', LIST_TEXT]] as const) {
      layouts.set(
        id,
        textButton(layout, `spellbook-world-layout-button spellbook-world-layout-${id}`, text, () => {
          if (this.host.layout === id) return;
          this.host.layout = id;
          this.draw();
        }),
      );
    }
    // The cards by name, or by when each entity begins.
    const order = bar.createEl('select', { cls: 'dropdown spellbook-world-order', attr: { 'aria-label': CARD_ORDER_LABEL } });
    for (const choice of CARD_ORDERS) order.createEl('option', { value: choice.id, text: choice.title });
    order.value = this.cardOrder;
    order.addEventListener('change', () => {
      this.cardOrder = order.value === 'date' ? 'date' : 'name';
      this.drawList();
    });
    // The world on the timeline: a lane per type, fitted to the world's dates.
    const history = textButton(bar, 'spellbook-world-history-button', HISTORY_TEXT, () => {
      if (this.host.showWorldHistory?.() !== true) new Notice(NO_TIMELINE_TEXT);
    });
    history.setAttr('aria-label', HISTORY_LABEL);
    const add = textButton(bar, 'mod-cta spellbook-world-new', NEW_TEXT, (button) => {
      this.showNewMenu(button);
    });
    const types = iconButton(bar, 'spellbook-world-types', TYPES_LABEL, WORLD_ICONS.types, () => {
      openEntityTypes(this.app, this.host);
    });

    const body = root.createDiv({ cls: 'spellbook-world-body' });
    const list = body.createDiv({ cls: 'spellbook-world-list' });
    const detail = body.createDiv({ cls: 'spellbook-world-detail' });
    this.els = { root, search, filter, layouts, add, order, history, types, list, detail };

    if (typeof ResizeObserver === 'function') {
      this.observer = new ResizeObserver(() => {
        this.measure();
      });
      this.observer.observe(pane);
    }
    this.stops.push(
      this.host.onChange(() => {
        this.draw();
      }),
    );
    this.measure();
    this.draw();
  }

  protected override async onClose(): Promise<void> {
    this.closed = true;
    this.sheet.forget();
    this.observer?.disconnect();
    this.observer = null;
    for (const stop of this.stops.splice(0)) stop();
    this.els = null;
    this.selected = null;
    this.filterDrawn = '';
    this.contentEl.empty();
    this.contentEl.removeClass('spellbook-world-pane');
  }

  override onResize(): void {
    this.measure();
  }

  /** Whether the pane is narrow, from its own width. A pane right at the edge stays as it was. */
  private measure(): void {
    const els = this.els;
    if (!els || this.closed) return;
    const narrow = isNarrowPane(this.contentEl.clientWidth, this.narrow);
    if (narrow === this.narrow && els.root.hasClass('spellbook-world-narrow') === narrow) return;
    this.narrow = narrow;
    els.root.toggleClass('spellbook-world-narrow', narrow);
    // The button at the top of the sheet leads back in a narrow pane, and closes the sheet in a wide one.
    this.drawDetail();
  }

  // ------------------------------------------------------------------ drawing

  /** Draw everything again from what the host holds now. The search box keeps what is typed in it. */
  private draw(): void {
    const els = this.els;
    if (!els || this.closed) return;
    const project = this.host.project;
    const usable = project !== null;
    els.search.disabled = !usable;
    els.filter.disabled = !usable;
    els.add.disabled = !usable || project.readOnly;
    setShown(els.types, usable && !project.readOnly);
    const layout = this.host.layout;
    for (const [id, button] of els.layouts) {
      button.disabled = !usable;
      button.toggleClass('is-active', id === layout);
      button.setAttr('aria-pressed', id === layout ? 'true' : 'false');
    }
    els.root.toggleClass('spellbook-world-as-list', layout === 'list');
    els.order.disabled = !usable;
    setShown(els.order, layout !== 'list');
    els.history.disabled = !usable;
    this.drawFilter();
    if (this.selected !== null && this.host.entity(this.selected) === null) this.select(null, false);
    this.drawList();
    this.drawDetail();
  }

  /** The list of types to show one of. Built anew only when the types changed: a list that is open is left alone. */
  private drawFilter(): void {
    const els = this.els;
    if (!els) return;
    const types = this.host.types;
    const drawn = JSON.stringify(types.map((type) => [type.id, type.folder]));
    if (drawn !== this.filterDrawn) {
      this.filterDrawn = drawn;
      els.filter.empty();
      els.filter.createEl('option', { value: ALL_TYPES, text: ALL_TYPES_TEXT });
      for (const type of types) {
        // A type's name may be the writer's own text.
        els.filter.createEl('option', { value: type.id, text: type.folder, attr: { dir: 'auto' } });
      }
      els.filter.createEl('option', { value: OTHER_TYPE, text: OTHER_NAME });
    }
    if (this.typeFilter !== ALL_TYPES && this.typeFilter !== OTHER_TYPE && !types.some((type) => type.id === this.typeFilter)) {
      this.typeFilter = ALL_TYPES;
    }
    if (els.filter.value !== this.typeFilter) els.filter.value = this.typeFilter;
  }

  private drawList(): void {
    const els = this.els;
    if (!els || this.closed) return;
    const list = els.list;
    list.empty();
    const project = this.host.project;
    if (!project) {
      list.createDiv({ cls: 'spellbook-world-message', text: NO_PROJECT_TEXT });
      return;
    }
    const entities = this.host.entities;
    if (entities.length === 0 && this.typeFilter === ALL_TYPES) {
      list.createDiv({ cls: 'spellbook-world-message', text: NO_ENTITIES_TEXT });
      list.createDiv({ cls: 'spellbook-world-message spellbook-world-hint', text: NO_ENTITIES_HINT });
      return;
    }
    if (this.host.layout === 'list') {
      this.drawTable(list);
      return;
    }
    // By date: the groups stay, and within each the earliest comes first; those without a date come after.
    const ordered = this.cardOrder === 'date' ? sortByDate(entities, (entity) => this.host.timeOf(entity)) : entities;
    const groups = groupEntities(ordered, this.host.types, this.query, this.typeFilter);
    if (groups.length === 0) {
      list.createDiv({ cls: 'spellbook-world-message', text: NOTHING_FOUND_TEXT });
      return;
    }
    for (const group of groups) this.drawGroup(list, group);
  }

  private drawGroup(list: HTMLElement, group: EntityGroup): void {
    const section = list.createDiv({ cls: 'spellbook-world-group' });
    const head = section.createDiv({ cls: 'spellbook-world-group-head', attr: { role: 'heading', 'aria-level': 2 } });
    typeBadge(head, group.type);
    // The name of a type of the writer's own is the writer's text.
    head.createSpan({ cls: 'spellbook-world-group-name', text: group.name, attr: { dir: 'auto' } });
    head.createSpan({ cls: 'spellbook-world-group-count', text: String(group.entities.length), attr: { dir: 'ltr' } });
    if (group.entities.length === 0) {
      section.createDiv({ cls: 'spellbook-world-message spellbook-world-hint', text: NONE_OF_TYPE_TEXT });
      return;
    }
    const cards = section.createDiv({ cls: 'spellbook-world-cards', attr: { role: 'list' } });
    for (const entity of group.entities) this.drawCard(cards, entity, group);
  }

  private drawCard(cards: HTMLElement, entity: Entity, group: EntityGroup): void {
    const card = cards.createDiv({
      cls: 'spellbook-world-card',
      attr: { role: 'listitem', tabindex: 0, 'data-path': entity.path },
    });
    card.toggleClass('is-selected', entity.path === this.selected);
    // The card's edge and its icon take the colour of its type.
    setColor(card, group.type?.color ?? null);
    const head = card.createDiv({ cls: 'spellbook-world-card-head' });
    // The picture, cropped to a small square; the type's icon for an entity without one.
    entityPicture(head, this.host.imageOf(entity), group.type, 'spellbook-world-card-picture');
    const words = head.createDiv({ cls: 'spellbook-world-card-words' });
    this.nameButton(words, 'spellbook-world-card-name', entity);
    // One or two key facts: a character's role, a place's kind and region.
    const facts = cardFacts(entity, group.type);
    if (facts.length > 0) {
      const line = words.createDiv({ cls: 'spellbook-world-card-facts' });
      for (const fact of facts) {
        line.createSpan({ cls: 'spellbook-world-card-fact', text: fact.value, attr: { dir: 'auto', 'aria-label': `${fact.name}: ${fact.value}` } });
      }
    }
    // When it begins and ends, when its note says: "1889", "1841 - 1922".
    const dates = spanText(this.host.timeOf(entity));
    if (dates !== '') {
      // In an invented calendar the names of months and eras are the writer's own text.
      words.createDiv({ cls: 'spellbook-world-card-dates', text: dates, attr: { dir: this.host.calendar === null ? 'ltr' : 'auto' } });
    }
    iconButton(head, 'spellbook-world-card-more', MORE_LABEL, ROW_MORE_ICON, (button) => {
      this.showCardMenu(entity, button);
    });
    if (entity.summary !== '') {
      card.createDiv({ cls: 'spellbook-world-card-summary', text: entity.summary, attr: { dir: 'auto' } });
    }
    const foot = card.createDiv({ cls: 'spellbook-world-card-foot' });
    const scenes = this.host.links.scenesOf(entity.path).length;
    // A count and a word of the app's own: read left to right in every language.
    const count = textButton(foot, 'spellbook-world-card-scenes', sceneCountText(scenes), () => {
      this.select(entity.path, true);
    });
    count.setAttr('dir', 'ltr');
    count.setAttr('aria-label', `${sceneCountText(scenes)}: show the sheet`);

    // A tap anywhere else on the card shows the entity's sheet.
    const show = this.sheetOpener(entity);
    card.addEventListener('click', show);
    card.addEventListener('keydown', (event) => {
      if (event.target !== card || (event.key !== 'Enter' && event.key !== ' ')) return;
      event.preventDefault();
      show(event);
    });
  }

  /** What a tap on a card or a row does: the entity's sheet; with the usual key held, its note in a new tab. */
  private sheetOpener(entity: Entity): (event: MouseEvent | KeyboardEvent) => void {
    return (event) => {
      safely(OPEN_SHEET_TEXT, () => {
        if (Keymap.isModEvent(event)) return this.host.open(entity.path, Keymap.isModEvent(event));
        this.select(entity.path, true);
        return undefined;
      });
    };
  }

  /** An entity's name, as a button that opens its note. The card or row around it shows the sheet instead. */
  private nameButton(parent: HTMLElement, cls: string, entity: Entity): HTMLButtonElement {
    const button = parent.createEl('button', {
      cls: `spellbook-world-name-open ${cls}`,
      text: entity.name,
      // A name is the writer's own text.
      attr: { type: 'button', dir: 'auto', 'aria-label': `${OPEN_NOTE_TEXT}: ${entity.name}` },
    });
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      safely(OPEN_NOTE_TEXT, () => this.host.open(entity.path, Keymap.isModEvent(event)));
    });
    button.addEventListener('keydown', (event) => {
      // Enter on the name is the name's own: the card does not answer it as well.
      if (event.key === 'Enter' || event.key === ' ') event.stopPropagation();
    });
    return button;
  }

  // -------------------------------------------------------------------- table

  /** The entities as one table. A tap on a heading sorts by that column, a second tap the other way round. */
  private drawTable(list: HTMLElement): void {
    const rows = tableRows(
      this.host.entities,
      this.host.types,
      this.query,
      this.typeFilter,
      this.sort,
      (path) => this.host.links.scenesOf(path).length,
      (entity) => this.host.timeOf(entity),
    );
    if (rows.length === 0) {
      list.createDiv({ cls: 'spellbook-world-message', text: this.query.trim() === '' ? NONE_OF_TYPE_TEXT : NOTHING_FOUND_TEXT });
      return;
    }
    const table = list.createDiv({ cls: 'spellbook-world-table', attr: { role: 'table' } });
    const head = table.createDiv({ cls: 'spellbook-world-table-row spellbook-world-table-head', attr: { role: 'row' } });
    for (const column of WORLD_COLUMNS) {
      const sorted = this.sort.column === column.id;
      const cell = head.createDiv({
        cls: `spellbook-world-table-cell spellbook-world-table-${column.id}`,
        attr: { role: 'columnheader', 'aria-sort': sorted ? (this.sort.descending ? 'descending' : 'ascending') : 'none' },
      });
      const button = textButton(cell, 'spellbook-world-table-sort', column.title, () => {
        this.sort = nextSort(this.sort, column.id);
        this.drawList();
      });
      button.toggleClass('is-active', sorted);
      if (sorted) {
        const arrow = button.createSpan({ cls: 'spellbook-world-table-arrow', attr: { 'aria-hidden': 'true' } });
        showIcon(arrow, ...(this.sort.descending ? WORLD_ICONS.sortDown : WORLD_ICONS.sortUp));
      }
    }
    for (const row of rows) this.drawTableRow(table, row);
  }

  private drawTableRow(table: HTMLElement, row: WorldRow): void {
    const { entity } = row;
    const line = table.createDiv({
      cls: 'spellbook-world-table-row spellbook-world-table-entity',
      attr: { role: 'row', tabindex: 0, 'data-path': entity.path },
    });
    line.toggleClass('is-selected', entity.path === this.selected);
    setColor(line, row.type?.color ?? null);
    const cell = (column: string): HTMLElement =>
      line.createDiv({ cls: `spellbook-world-table-cell spellbook-world-table-${column}`, attr: { role: 'cell' } });
    const name = cell('name');
    typeBadge(name, row.type);
    this.nameButton(name, 'spellbook-world-table-text', entity);
    // The name of a type of the writer's own, and what a field holds, are the writer's text.
    cell('type').createSpan({ cls: 'spellbook-world-table-text', text: row.typeName, attr: { dir: 'auto' } });
    cell('kind').createSpan({ cls: 'spellbook-world-table-text', text: row.kind, attr: { dir: 'auto' } });
    // When it begins and when it ends. In an invented calendar the names in a date are the writer's own text.
    const dateDir = this.host.calendar === null ? 'ltr' : 'auto';
    cell('from').createSpan({ cls: 'spellbook-world-table-text', text: row.fromText, attr: { dir: dateDir } });
    cell('until').createSpan({ cls: 'spellbook-world-table-text', text: row.untilText, attr: { dir: dateDir } });
    cell('scenes').createSpan({ cls: 'spellbook-world-table-text', text: String(row.scenes), attr: { dir: 'ltr' } });
    // A tap on a row shows the entity's sheet; a tap on the name opens the note.
    const show = this.sheetOpener(entity);
    line.addEventListener('click', show);
    line.addEventListener('keydown', (event) => {
      if (event.target !== line || (event.key !== 'Enter' && event.key !== ' ')) return;
      event.preventDefault();
      show(event);
    });
  }

  // -------------------------------------------------------------------- sheet

  /** Show an entity's sheet, or none (null). */
  private select(path: string | null, redraw: boolean): void {
    if (path !== this.selected) this.sheet.forget();
    this.selected = path;
    if (!redraw) return;
    this.drawList();
    this.drawDetail();
  }

  private drawDetail(): void {
    const els = this.els;
    if (!els || this.closed) return;
    const entity = this.selected === null ? null : this.host.entity(this.selected);
    els.root.toggleClass('spellbook-world-has-detail', entity !== null);
    this.sheet.draw(els.detail, entity);
  }

  // -------------------------------------------------------------------- menus

  /** "New": one item per type. */
  private showNewMenu(anchor: HTMLElement): void {
    const menu = new Menu();
    for (const type of this.host.types) {
      menu.addItem((item) => {
        item.setTitle(typeTitle(type, type.name)).onClick(() => {
          safely(NEW_TEXT, () => {
            askNewEntity(this.app, this.host, type.id);
          });
        });
      });
    }
    menu.showAtPosition(placeUnder(anchor));
  }

  private showCardMenu(entity: Entity, anchor: HTMLElement): void {
    const canChange = this.host.canChange;
    const menu = new Menu();
    const item = (title: string, icons: readonly string[], action: () => unknown, warning = false): void => {
      menu.addItem((entry) => {
        entry
          .setTitle(title)
          .setIcon(iconName(...icons))
          .onClick(() => {
            safely(title, action);
          });
        if (warning) entry.setWarning(true);
      });
    };
    item(OPEN_NOTE_TEXT, WORLD_ICONS.open, () => this.host.open(entity.path, false));
    item(OPEN_IN_NEW_TAB_TEXT, WORLD_ICONS.openInNewTab, () => this.host.open(entity.path, 'tab'));
    item(OPEN_SHEET_TEXT, WORLD_ICONS.sheet, () => {
      this.select(entity.path, true);
    });
    if (canChange) {
      menu.addSeparator();
      item('Rename', WORLD_ICONS.rename, () => {
        this.askRename(entity);
      });
      const everywhere = this.host.renameEverywhere();
      if (everywhere !== null) {
        item(RENAME_EVERYWHERE_TEXT, WORLD_ICONS.rename, () => {
          everywhere.open(entity.path);
        });
      }
      item('Delete', WORLD_ICONS.remove, () => {
        this.askDelete(entity);
      }, true);
    }
    menu.showAtPosition(placeUnder(anchor));
  }

  private askRename(entity: Entity): void {
    new TextPromptModal(this.app, {
      title: `Rename "${entity.name}"`,
      label: 'New name',
      value: entity.name,
      confirm: 'Rename',
      submit: async (value) => {
        const renamed = await this.host.renameEntity(entity.path, value);
        if ('problem' in renamed) return renamed.problem;
        // The details follow the note to its new name.
        if (this.selected === entity.path) this.selected = renamed.path;
        return null;
      },
    }).open();
  }

  private askDelete(entity: Entity): void {
    const scenes = this.host.links.scenesOf(entity.path).length;
    new ConfirmModal(this.app, {
      title: `Delete "${entity.name}"?`,
      message:
        'Its note will be moved to the trash.' +
        (scenes > 0 ? ` ${sceneCountText(scenes)} list it: their links will be left as they are, and can be taken out in the inspector.` : ''),
      confirm: 'Delete',
      onConfirm: () => {
        void settle(this.host.deleteEntity(entity.path));
      },
    }).open();
  }
}

/** Make a World browser for a pane. What Obsidian's `registerView` is given for WORLD_VIEW_TYPE. */
export function createWorldView(leaf: WorkspaceLeaf, host: WorldHost): WorldView {
  return new WorldView(leaf, host);
}
