// The World browser: the characters, places, factions and items of the open
// project, and whatever other types the writer made.
//
//   bar      a search box (names, other names and summaries), a list to show
//            one type only, "New" and the button for the window of types
//   list     the entities as cards, in groups, one per type; each card shows
//            the name, the summary and the number of scenes it is in
//   details  one entity: its summary and properties, the scenes it is in (in
//            binder order) and the timeline events that list it, and "Find
//            mentions": scenes whose text names it without listing it
//
// A tap on a card opens the entity's note. The number of scenes on the card
// is a button of its own that shows the details; the card's menu has both,
// and Rename and Delete (to the trash).
//
// How many columns of cards fit is the stylesheet's business; whether the
// pane is narrow is measured here, from the pane itself and not from the
// kind of device. A narrow pane (a phone, a sidebar) shows one column, and
// the details instead of the list, with a button that leads back.
//
// Names and summaries are the writer's own text, in any language: each takes
// the direction of its own text. Nothing depends on hovering or dragging.

import { ItemView, Keymap, Menu, Platform } from 'obsidian';
import type { WorkspaceLeaf } from 'obsidian';
import {
  ALL_TYPES,
  OTHER_NAME,
  OTHER_TYPE,
  entityFields,
  groupEntities,
  isNarrowPane,
  sceneCountText,
} from '../../core/world';
import type { Appearance, Entity, EntityGroup } from '../../core/world';
import { ConfirmModal } from '../../ui/confirmModal';
import { ROW_MORE_ICON, iconName } from '../../ui/icons';
import { isInputMethodKey } from '../../ui/keys';
import { safely } from '../../ui/safely';
import { TextPromptModal } from '../../ui/textPromptModal';
import type { FoundMention, WorldHost } from './host';
import { askNewEntity } from './newEntity';
import {
  MORE_LABEL,
  NO_PROJECT_TEXT,
  WORLD_ICONS,
  iconButton,
  placeUnder,
  setColor,
  setShown,
  settle,
  textButton,
  typeBadge,
  typeTitle,
} from './parts';
import { openEntityTypes } from './typesModal';

export const WORLD_VIEW_TYPE = 'spellbook-world';
export const WORLD_VIEW_NAME = 'World';
export const WORLD_ICON = 'globe';

export const SEARCH_PLACEHOLDER = 'Search names and summaries';
export const ALL_TYPES_TEXT = 'All types';
export const NEW_TEXT = 'New';
export const TYPES_LABEL = 'Entity types';
export const NO_ENTITIES_TEXT = 'Nothing in the world yet.';
export const NO_ENTITIES_HINT = 'Use "New" to add a character, a place, a faction or an item. Each one is a plain note in the World folder of the project.';
export const NOTHING_FOUND_TEXT = 'Nothing matches.';
export const NONE_OF_TYPE_TEXT = 'None yet.';
export const OPEN_NOTE_TEXT = 'Open note';
export const BACK_LABEL = 'Back to the list';
export const CLOSE_LABEL = 'Close the details';
export const SCENES_HEADING = 'Scenes';
export const EVENTS_HEADING = 'Timeline events';
export const NO_SCENES_TEXT = 'Not in any scene yet. Add it to a scene from the inspector, under "In this scene".';
export const FIND_MENTIONS_TEXT = 'Find mentions';
export const MENTIONS_HEADING = 'Mentioned, not listed';
export const SEARCHING_TEXT = 'Reading the scenes...';
export const NO_MENTIONS_TEXT = 'No other scene names it.';
export const LINK_SCENE_TEXT = 'Link this scene';
export const REMOVE_FROM_SCENE_LABEL = 'Take out of this scene';

/** What "Find mentions" has to show for the entity in the details. */
type Mentions =
  | { readonly state: 'idle' }
  | { readonly state: 'searching' }
  | { readonly state: 'found'; readonly scenes: readonly FoundMention[] };

interface Elements {
  readonly root: HTMLElement;
  readonly search: HTMLInputElement;
  readonly filter: HTMLSelectElement;
  readonly add: HTMLButtonElement;
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
  /** The entity in the details, by its path relative to the project folder. */
  private selected: string | null = null;
  private mentions: Mentions = { state: 'idle' };
  /** Goes up whenever the mentions being looked for are no longer wanted. */
  private mentionsRun = 0;

  constructor(leaf: WorkspaceLeaf, host: WorldHost) {
    super(leaf);
    this.host = host;
    this.navigation = false;
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
    const add = textButton(bar, 'mod-cta spellbook-world-new', NEW_TEXT, (button) => {
      this.showNewMenu(button);
    });
    const types = iconButton(bar, 'spellbook-world-types', TYPES_LABEL, WORLD_ICONS.types, () => {
      openEntityTypes(this.app, this.host);
    });

    const body = root.createDiv({ cls: 'spellbook-world-body' });
    const list = body.createDiv({ cls: 'spellbook-world-list' });
    const detail = body.createDiv({ cls: 'spellbook-world-detail' });
    this.els = { root, search, filter, add, types, list, detail };

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
    this.mentionsRun++;
    this.observer?.disconnect();
    this.observer = null;
    for (const stop of this.stops.splice(0)) stop();
    this.els = null;
    this.selected = null;
    this.mentions = { state: 'idle' };
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
    const groups = groupEntities(entities, this.host.types, this.query, this.typeFilter);
    if (entities.length === 0 && this.typeFilter === ALL_TYPES) {
      list.createDiv({ cls: 'spellbook-world-message', text: NO_ENTITIES_TEXT });
      list.createDiv({ cls: 'spellbook-world-message spellbook-world-hint', text: NO_ENTITIES_HINT });
      return;
    }
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
    typeBadge(head, group.type);
    head.createSpan({ cls: 'spellbook-world-card-name', text: entity.name, attr: { dir: 'auto' } });
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
    count.setAttr('aria-label', `${sceneCountText(scenes)}: show the details`);

    // A tap anywhere else on the card opens the entity's note.
    card.addEventListener('click', (event) => {
      safely(OPEN_NOTE_TEXT, () => this.host.open(entity.path, Keymap.isModEvent(event)));
    });
    card.addEventListener('keydown', (event) => {
      if (event.target !== card || (event.key !== 'Enter' && event.key !== ' ')) return;
      event.preventDefault();
      safely(OPEN_NOTE_TEXT, () => this.host.open(entity.path, Keymap.isModEvent(event)));
    });
  }

  // ------------------------------------------------------------------ details

  /** Show an entity's details, or none (null). */
  private select(path: string | null, redraw: boolean): void {
    if (path !== this.selected) {
      this.mentionsRun++;
      this.mentions = { state: 'idle' };
    }
    this.selected = path;
    if (!redraw) return;
    this.drawList();
    this.drawDetail();
  }

  private drawDetail(): void {
    const els = this.els;
    if (!els || this.closed) return;
    const detail = els.detail;
    detail.empty();
    const entity = this.selected === null ? null : this.host.entity(this.selected);
    els.root.toggleClass('spellbook-world-has-detail', entity !== null);
    if (!entity) return;
    const type = this.host.typeOf(entity);
    const canChange = this.host.canChange;

    const head = detail.createDiv({ cls: 'spellbook-world-detail-head' });
    iconButton(head, 'spellbook-world-detail-back', this.narrow ? BACK_LABEL : CLOSE_LABEL, this.narrow ? WORLD_ICONS.back : WORLD_ICONS.close, () => {
      this.select(null, true);
    });
    typeBadge(head, type);
    head.createDiv({ cls: 'spellbook-world-detail-name', text: entity.name, attr: { dir: 'auto', role: 'heading', 'aria-level': 2 } });

    const meta = detail.createDiv({ cls: 'spellbook-world-detail-type', text: type?.name ?? OTHER_NAME, attr: { dir: 'auto' } });
    if (entity.aliases.length > 0) {
      meta.createSpan({ cls: 'spellbook-world-detail-aliases', text: entity.aliases.join(', '), attr: { dir: 'auto' } });
    }
    if (entity.summary !== '') {
      detail.createDiv({ cls: 'spellbook-world-detail-summary', text: entity.summary, attr: { dir: 'auto' } });
    }
    const fields = entityFields(entity, type);
    if (fields.length > 0) {
      const table = detail.createEl('dl', { cls: 'spellbook-world-fields' });
      for (const field of fields) {
        // Both the name of a property and what it holds may be the writer's own text.
        table.createEl('dt', { cls: 'spellbook-world-field-name', text: field.name, attr: { dir: 'auto' } });
        table.createEl('dd', { cls: 'spellbook-world-field-value', text: field.value, attr: { dir: 'auto' } });
      }
    }

    const actions = detail.createDiv({ cls: 'spellbook-world-detail-actions' });
    textButton(actions, 'mod-cta spellbook-world-open', OPEN_NOTE_TEXT, () => this.host.open(entity.path, false));
    const find = textButton(actions, 'spellbook-world-find', FIND_MENTIONS_TEXT, () => {
      this.findMentions(entity.path);
    });
    find.disabled = this.mentions.state === 'searching';

    const scenes = this.host.links.scenesOf(entity.path);
    this.drawAppearances(detail, SCENES_HEADING, scenes, entity, canChange);
    if (scenes.length === 0) detail.createDiv({ cls: 'spellbook-world-message spellbook-world-hint', text: NO_SCENES_TEXT });
    const events = this.host.links.eventsOf(entity.path);
    if (events.length > 0) this.drawAppearances(detail, EVENTS_HEADING, events, entity, canChange);
    this.drawMentions(detail, entity, canChange);
  }

  /** A list of the scenes (or events) an entity is in: a tap on one opens it. */
  private drawAppearances(detail: HTMLElement, heading: string, notes: readonly Appearance[], entity: Entity, canChange: boolean): void {
    const head = detail.createDiv({ cls: 'spellbook-world-section-head', attr: { role: 'heading', 'aria-level': 3 } });
    head.createSpan({ text: heading });
    head.createSpan({ cls: 'spellbook-world-group-count', text: String(notes.length), attr: { dir: 'ltr' } });
    if (notes.length === 0) return;
    const rows = detail.createDiv({ cls: 'spellbook-world-rows', attr: { role: 'list' } });
    for (const note of notes) {
      const row = rows.createDiv({ cls: 'spellbook-world-row', attr: { role: 'listitem' } });
      const open = row.createEl('button', {
        cls: 'spellbook-world-row-open',
        text: note.title,
        // A scene's title is the writer's own text.
        attr: { type: 'button', dir: 'auto' },
      });
      open.addEventListener('click', (event) => {
        safely(OPEN_NOTE_TEXT, () => this.host.open(note.path, Keymap.isModEvent(event)));
      });
      if (canChange) {
        iconButton(row, 'spellbook-world-row-unlink', REMOVE_FROM_SCENE_LABEL, WORLD_ICONS.unlink, () =>
          settle(this.host.unlink(note.path, { entityPath: entity.path })),
        );
      }
    }
  }

  // ----------------------------------------------------------------- mentions

  private findMentions(path: string): void {
    const run = ++this.mentionsRun;
    this.mentions = { state: 'searching' };
    this.drawDetail();
    void this.host
      .findMentions(path)
      .catch((error: unknown): FoundMention[] => {
        console.error('Spellbook: the scenes could not be read', error);
        return [];
      })
      .then((scenes) => {
        if (run !== this.mentionsRun || this.closed) return;
        this.mentions = { state: 'found', scenes };
        this.drawDetail();
      });
  }

  private drawMentions(detail: HTMLElement, entity: Entity, canChange: boolean): void {
    const mentions = this.mentions;
    if (mentions.state === 'idle') return;
    const head = detail.createDiv({ cls: 'spellbook-world-section-head', attr: { role: 'heading', 'aria-level': 3 } });
    head.createSpan({ text: MENTIONS_HEADING });
    if (mentions.state === 'searching') {
      detail.createDiv({ cls: 'spellbook-world-message spellbook-world-hint', text: SEARCHING_TEXT });
      return;
    }
    // A scene that was linked a moment ago is listed above by now.
    const listed = new Set(this.host.links.scenesOf(entity.path).map((scene) => scene.path));
    const scenes = mentions.scenes.filter((scene) => !listed.has(scene.path));
    if (scenes.length === 0) {
      detail.createDiv({ cls: 'spellbook-world-message spellbook-world-hint', text: NO_MENTIONS_TEXT });
      return;
    }
    const rows = detail.createDiv({ cls: 'spellbook-world-rows spellbook-world-mentions', attr: { role: 'list' } });
    for (const scene of scenes) {
      const row = rows.createDiv({ cls: 'spellbook-world-mention', attr: { role: 'listitem' } });
      const line = row.createDiv({ cls: 'spellbook-world-row' });
      const open = line.createEl('button', { cls: 'spellbook-world-row-open', text: scene.title, attr: { type: 'button', dir: 'auto' } });
      open.addEventListener('click', (event) => {
        safely(OPEN_NOTE_TEXT, () => this.host.open(scene.path, Keymap.isModEvent(event)));
      });
      if (canChange) {
        textButton(line, 'spellbook-world-mention-link', LINK_SCENE_TEXT, () => settle(this.host.link(scene.path, entity.path)));
      }
      // The words around the name, from the scene's own text.
      const snippet = row.createDiv({ cls: 'spellbook-world-snippet', attr: { dir: 'auto' } });
      snippet.createSpan({ text: scene.snippet.before });
      snippet.createEl('mark', { cls: 'spellbook-world-snippet-name', text: scene.snippet.found });
      snippet.createSpan({ text: scene.snippet.after });
    }
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
    item('Open', WORLD_ICONS.open, () => this.host.open(entity.path, false));
    item('Open in new tab', WORLD_ICONS.openInNewTab, () => this.host.open(entity.path, 'tab'));
    item('Show scenes and details', WORLD_ICONS.details, () => {
      this.select(entity.path, true);
    });
    if (canChange) {
      menu.addSeparator();
      item('Rename', WORLD_ICONS.rename, () => {
        this.askRename(entity);
      });
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
