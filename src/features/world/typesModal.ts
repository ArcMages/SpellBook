// The window for a project's entity types.
//
// It lists the types: the seven every project has (character, place, faction,
// item, lore, creature, culture) and the writer's own. Each can be given another name, folder, list
// of properties, colour and icon, and moved up and down; a type of the
// writer's own can be removed; new ones can be added at the end.
//
// Every change is worked out by the engine (src/core/world) against the list
// as it is in the project index at that moment, and stored by the host; the
// window itself writes nothing. No note is touched by any of it: a type's id
// never changes, a new folder is only where notes are made from then on, and
// the notes of a type that was removed stay where they are.
//
// Nothing here depends on dragging or on hovering: every control is a button
// that can be tapped, and reached and pressed from the keyboard.

import { Menu, Modal, Notice } from 'obsidian';
import type { App } from 'obsidian';
import { CARD_COLORS } from '../../core/cards';
import type { CardColor } from '../../core/cards';
import { ENTITY_ICONS, addType, changeType, dateWords, moveType, removeType, usualDateWords } from '../../core/world';
import type { EntityType, TypeDetails } from '../../core/world';
import { ConfirmModal } from '../../ui/confirmModal';
import { ROW_MORE_ICON, iconName } from '../../ui/icons';
import { safely } from '../../ui/safely';
import { TextPromptModal } from '../../ui/textPromptModal';
import type { WorldHost } from './host';
import {
  FALLBACK_ICON,
  MORE_LABEL,
  NO_PROJECT_TEXT,
  PROBLEM_NOTICE_MS,
  READ_ONLY_TEXT,
  WORLD_ICONS,
  colorName,
  iconButton,
  placeUnder,
  setColor,
  settle,
  textButton,
  typeBadge,
} from './parts';

export const ENTITY_TYPES_TITLE = 'Entity types';
export const ENTITY_TYPES_TEXT =
  'Each type keeps its notes in a folder of its own inside World, and gives a new note its properties. Changing a type never changes a note.';
export const ADD_TYPE_TEXT = 'Add a type';
export const FIELDS_HINT = 'Properties a new note starts with, with commas between them';
export const DATE_WORDS_TEXT = 'Change date words';
export const DATE_WORDS_HINT = 'The words for when it begins and when it ends, with a comma between them';

/** What an icon is called in the menu: its name in Obsidian's icon set, spelled as words. */
export function iconLabel(icon: string): string {
  const words = icon.replace(/-/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export class EntityTypesModal extends Modal {
  private readonly host: WorldHost;
  private stop: (() => void) | null = null;
  private list: HTMLElement | null = null;
  private closed = true;

  constructor(app: App, host: WorldHost) {
    super(app);
    this.host = host;
  }

  override onOpen(): void {
    const { contentEl } = this;
    this.closed = false;
    contentEl.empty();
    this.titleEl.setText(ENTITY_TYPES_TITLE);
    this.modalEl.addClass('spellbook-world-types-window');
    contentEl.createEl('p', { cls: 'spellbook-world-types-text', text: ENTITY_TYPES_TEXT });
    this.list = contentEl.createDiv({ cls: 'spellbook-world-types-list', attr: { role: 'list' } });
    textButton(contentEl, 'spellbook-world-types-add', ADD_TYPE_TEXT, () => {
      this.askAdd();
    });
    this.stop = this.host.onChange(() => {
      this.draw();
    });
    this.draw();
  }

  override onClose(): void {
    this.closed = true;
    this.stop?.();
    this.stop = null;
    this.list = null;
    this.contentEl.empty();
  }

  private draw(): void {
    const list = this.list;
    if (!list || this.closed) return;
    // The project was closed, or became read-only, under the window.
    if (!this.host.canChange) {
      this.close();
      return;
    }
    list.empty();
    const types = this.host.types;
    types.forEach((type, at) => {
      const row = list.createDiv({ cls: 'spellbook-world-type', attr: { role: 'listitem', 'data-type': type.id } });
      const swatch = iconButton(row, 'spellbook-world-type-color', `Colour of ${type.name}: ${colorName(type.color)}`, [], (button) => {
        this.showColors(type, button);
      });
      setColor(swatch.createSpan({ cls: 'spellbook-world-swatch' }), type.color);
      const icon = iconButton(row, 'spellbook-world-type-icon', `Icon of ${type.name}`, [type.icon, FALLBACK_ICON], (button) => {
        this.showIcons(type, button);
      });
      setColor(icon, type.color);

      const words = row.createDiv({ cls: 'spellbook-world-type-words' });
      // A type of the writer's own has the writer's own text for its name, folder and properties.
      words.createDiv({ cls: 'spellbook-world-type-name', text: type.name, attr: { dir: 'auto' } });
      const meta = words.createDiv({ cls: 'spellbook-world-type-meta' });
      meta.createSpan({ cls: 'spellbook-world-type-folder', text: `World/${type.folder}`, attr: { dir: 'auto' } });
      meta.createSpan({
        cls: 'spellbook-world-type-fields',
        text: type.fields.length === 0 ? 'No properties' : type.fields.join(', '),
        attr: { dir: 'auto' },
      });

      const up = iconButton(row, 'spellbook-world-type-up', `Move ${type.name} up`, WORLD_ICONS.moveUp, () =>
        this.save((now) => moveType(now, type.id, 'up')),
      );
      const down = iconButton(row, 'spellbook-world-type-down', `Move ${type.name} down`, WORLD_ICONS.moveDown, () =>
        this.save((now) => moveType(now, type.id, 'down')),
      );
      up.toggleClass('is-disabled', at === 0);
      up.setAttr('aria-disabled', at === 0 ? 'true' : null);
      down.toggleClass('is-disabled', at === types.length - 1);
      down.setAttr('aria-disabled', at === types.length - 1 ? 'true' : null);
      iconButton(row, 'spellbook-world-type-more', MORE_LABEL, ROW_MORE_ICON, (button) => {
        this.showMore(type, button);
      });
    });
  }

  private save(change: Parameters<WorldHost['saveTypes']>[0]): Promise<boolean> {
    return settle(this.host.saveTypes(change));
  }

  /** Change one thing about a type; the answer is the message for the window that asked, or null. */
  private change(type: EntityType, details: TypeDetails): Promise<string | null> {
    return this.host.saveTypes((now) => changeType(now, type.id, details));
  }

  // -------------------------------------------------------------------- menus

  private showColors(type: EntityType, anchor: HTMLElement): void {
    const menu = new Menu();
    const choices: Array<CardColor | null> = [...CARD_COLORS, null];
    for (const color of choices) {
      menu.addItem((item) => {
        const title = createFragment();
        setColor(title.createSpan({ cls: 'spellbook-world-swatch spellbook-world-menu-swatch' }), color);
        title.createSpan({ text: colorName(color) });
        item
          .setTitle(title)
          .setChecked(type.color === color)
          .onClick(() => {
            safely('Colour', () => settle(this.change(type, { color })));
          });
      });
    }
    menu.showAtPosition(placeUnder(anchor));
  }

  private showIcons(type: EntityType, anchor: HTMLElement): void {
    const menu = new Menu();
    for (const icon of ENTITY_ICONS) {
      menu.addItem((item) => {
        item
          .setTitle(iconLabel(icon))
          .setIcon(icon)
          .setChecked(type.icon === icon)
          .onClick(() => {
            safely('Icon', () => settle(this.change(type, { icon })));
          });
      });
    }
    menu.showAtPosition(placeUnder(anchor));
  }

  private showMore(type: EntityType, anchor: HTMLElement): void {
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
    item('Rename', WORLD_ICONS.rename, () => {
      this.ask(`Rename "${type.name}"`, 'Name', type.name, 'Rename', (name) => this.change(type, { name }));
    });
    item('Change folder', WORLD_ICONS.folder, () => {
      this.ask(`Folder of "${type.name}"`, 'Folder inside World', type.folder, 'Save', (folder) => this.change(type, { folder }));
    });
    item('Change properties', WORLD_ICONS.fields, () => {
      this.ask(`Properties of "${type.name}"`, FIELDS_HINT, type.fields.join(', '), 'Save', (fields) => this.change(type, { fields }), FIELDS_HINT);
    });
    // What the two dates of an entity of this type are called on its sheet: "Born, Died".
    item(DATE_WORDS_TEXT, WORLD_ICONS.dates, () => {
      const now = dateWords(type);
      const usual = usualDateWords(type);
      this.ask(
        `Date words of "${type.name}"`,
        `${DATE_WORDS_HINT}. Leave empty for "${usual.from}, ${usual.until}".`,
        `${now.from}, ${now.until}`,
        'Save',
        (words) => this.change(type, { dateWords: words }),
        `${usual.from}, ${usual.until}`,
      );
    });
    if (!type.builtIn) {
      menu.addSeparator();
      item('Remove', WORLD_ICONS.remove, () => {
        this.askRemove(type);
      }, true);
    }
    menu.showAtPosition(placeUnder(anchor));
  }

  // ------------------------------------------------------------------ windows

  private ask(
    title: string,
    label: string,
    value: string,
    confirm: string,
    submit: (value: string) => Promise<string | null>,
    placeholder?: string,
  ): void {
    new TextPromptModal(this.app, { title, label, value, confirm, submit, ...(placeholder === undefined ? {} : { placeholder }) }).open();
  }

  private askAdd(): void {
    this.ask('New type', 'Name, for example "Creature"', '', 'Add', (name) => this.host.saveTypes((now) => addType(now, { name })), 'Name');
  }

  private askRemove(type: EntityType): void {
    const notes = this.host.entities.filter((entity) => entity.typeId === type.id).length;
    new ConfirmModal(this.app, {
      title: `Remove the type "${type.name}"?`,
      message:
        notes === 0
          ? 'No note has this type.'
          : `${notes === 1 ? '1 note has' : `${notes} notes have`} this type. They stay where they are, unchanged, and are listed under "Other".`,
      confirm: 'Remove',
      onConfirm: () => {
        void this.save((now) => removeType(now, type.id));
      },
    }).open();
  }
}

/** Open the window of entity types for the open project. */
export function openEntityTypes(app: App, host: WorldHost): void {
  const project = host.project;
  if (!project || project.readOnly) {
    new Notice(project ? READ_ONLY_TEXT : NO_PROJECT_TEXT, PROBLEM_NOTICE_MS);
    return;
  }
  new EntityTypesModal(app, host).open();
}
