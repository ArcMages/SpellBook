// The window for a project's statuses and labels.
//
// It lists the statuses, then the labels. Each one can be renamed, given
// another colour (or none), moved up and down, and removed; new ones can be
// added at the end. Names that scenes use but the list does not have are
// shown under it, each with a button that adds it.
//
// Every change is worked out by the engine (src/core/cards) and handed to the
// host to store; the window itself writes nothing. It shows what the host
// holds, and draws itself again when the host says the project changed.
//
// Nothing here depends on dragging or on hovering: every control is a button
// that can be tapped, and reached and pressed from the keyboard.

import { Menu, Modal, Notice, Platform } from 'obsidian';
import type { App, MenuPositionDef } from 'obsidian';
import { formatCount } from '../../core/binderModel';
import {
  CARD_COLORS,
  addTag,
  moveTag,
  recolourTag,
  removeTag,
  renameTag,
  scenesUsingTag,
  unlistedTags,
} from '../../core/cards';
import type { CardColor, Tag, TagEditResult, TagKind, TagList } from '../../core/cards';
import { tidyDisplayName } from '../../core/names';
import { ConfirmModal } from '../../ui/confirmModal';
import { ACTION_ICONS, ROW_MORE_ICON, iconName } from '../../ui/icons';
import { safely } from '../../ui/safely';
import { TextPromptModal } from '../../ui/textPromptModal';
import { describeScenes } from './cardElements';
import type { CardsHost } from './host';
import {
  MORE_LABEL,
  PROBLEM_NOTICE_MS,
  SWATCH_CLASS,
  colorName,
  iconButton,
  placeUnder,
  setButtonOff,
  setColor,
  tagTitle,
} from './parts';

export const TAG_LISTS_TITLE = 'Statuses and labels';

const KINDS: readonly TagKind[] = ['status', 'label'];
const WORDS: Readonly<Record<TagKind, { one: string; heading: string; none: string }>> = {
  status: { one: 'status', heading: 'Statuses', none: 'No statuses yet.' },
  label: { one: 'label', heading: 'Labels', none: 'No labels yet.' },
};

type SavedEdit = Extract<TagEditResult, { ok: true }>;

/** One of the controls of a row, to put the keyboard back on after the list was drawn again. */
type Control = 'color' | 'up' | 'down' | 'more';
const CONTROLS: readonly Control[] = ['color', 'up', 'down', 'more'];

/** A control of one status or label: where the keyboard is, or should be. */
interface Place {
  readonly kind: TagKind;
  readonly name: string;
  readonly control: Control;
}

interface RowControls {
  readonly kind: TagKind;
  readonly name: string;
  readonly color: HTMLElement;
  readonly up: HTMLElement;
  readonly down: HTMLElement;
  readonly more: HTMLElement;
}

export class TagListsModal extends Modal {
  private readonly host: CardsHost;
  private stop: (() => void) | null = null;
  private closed = true;
  /** True while a change is being stored: a second tap waits its turn. */
  private busy = false;
  /** The rows as they are drawn now, by list and name. */
  private rows = new Map<string, RowControls>();
  /** Where the keyboard should be once the change that is being stored has been drawn. */
  private focusNext: Place | null = null;

  constructor(app: App, host: CardsHost) {
    super(app);
    this.host = host;
  }

  override onOpen(): void {
    this.closed = false;
    this.titleEl.setText(TAG_LISTS_TITLE);
    this.modalEl.addClass('spellbook-tags');
    // Touch needs larger buttons: on phones and tablets, and (in the stylesheet) on any touch screen.
    this.modalEl.toggleClass('spellbook-is-mobile', Platform.isMobile);
    this.stop = this.host.onChange((change) => {
      // A scene that changed may use another status now: the names under the lists follow.
      if (change.type === 'project' || change.type === 'scenes') this.render();
    });
    this.render();
  }

  override onClose(): void {
    this.closed = true;
    this.stop?.();
    this.stop = null;
    this.rows = new Map();
    this.focusNext = null;
    this.contentEl.empty();
  }

  private listOf(kind: TagKind): TagList | null {
    const lists = this.host.ready ? this.host.project?.lists : undefined;
    if (!lists) return null;
    return kind === 'status' ? lists.statuses : lists.labels;
  }

  // ------------------------------------------------------------------ drawing

  /** The control the keyboard is on, if it is on one of the rows. */
  private keyboardPlace(): Place | null {
    const active = this.contentEl.ownerDocument.activeElement;
    if (!active) return null;
    for (const row of this.rows.values()) {
      const control = CONTROLS.find((candidate) => row[candidate] === active);
      if (control) return { kind: row.kind, name: row.name, control };
    }
    return null;
  }

  private render(): void {
    if (this.closed) return;
    const { contentEl } = this;
    // Drawing takes the controls away, and the keyboard with them: remember where it was.
    const wanted = this.focusNext ?? this.keyboardPlace();
    contentEl.empty();
    this.rows = new Map();
    const project = this.host.ready ? this.host.project : null;
    if (!project) {
      contentEl.createDiv({ cls: 'spellbook-tags-message', text: 'No project is open.' });
      return;
    }
    if (project.readOnly) {
      contentEl.createDiv({
        cls: 'spellbook-tags-message',
        text: 'This project is read-only, so its statuses and labels cannot be changed.',
      });
    }
    for (const kind of KINDS) {
      const list = this.listOf(kind);
      if (list) this.renderSection(contentEl, kind, list, project.readOnly);
    }

    if (!wanted) return;
    const row = this.rows.get(rowKey(wanted.kind, wanted.name));
    if (!row) return;
    // A row that reached the top has no "up" any more: its "down" is the nearest thing.
    const order: Control[] =
      wanted.control === 'up' ? ['up', 'down'] : wanted.control === 'down' ? ['down', 'up'] : [wanted.control];
    const target = order.map((control) => row[control]).find((el) => el.getAttr('aria-disabled') !== 'true');
    target?.focus();
  }

  private renderSection(parent: HTMLElement, kind: TagKind, list: TagList, readOnly: boolean): void {
    const words = WORDS[kind];
    const locked = readOnly || list.unreadable;
    const section = parent.createDiv({ cls: `spellbook-tags-section spellbook-tags-${kind}` });
    section.createDiv({ cls: 'spellbook-tags-heading', text: words.heading });
    for (const problem of list.problems) {
      // A problem may quote what the index holds, which is the writer's own text.
      section.createDiv({ cls: 'spellbook-tags-problem', text: problem, attr: { dir: 'auto' } });
    }
    if (list.fromDefaults && list.tags.length > 0) {
      section.createDiv({
        cls: 'spellbook-tags-note',
        text: `These are the built-in ${words.heading.toLowerCase()}. A change here saves the list in this project.`,
      });
    }
    if (list.tags.length === 0 && !list.unreadable) {
      section.createDiv({ cls: 'spellbook-tags-note', text: words.none });
    }

    const rows = section.createDiv({ cls: 'spellbook-tags-list', attr: { role: 'list' } });
    list.tags.forEach((tag, index) => {
      this.renderRow(rows, kind, tag, index, list.tags.length, locked);
    });

    if (!list.unreadable) this.renderUnlisted(section, kind, list, locked);

    const add = section.createEl('button', {
      cls: 'spellbook-tags-add',
      text: `Add ${words.one}`,
      attr: { type: 'button' },
    });
    add.disabled = locked;
    add.addEventListener('click', () => {
      safely(`Add ${words.one}`, () => {
        this.askToAdd(kind);
      });
    });
  }

  private renderRow(
    rows: HTMLElement,
    kind: TagKind,
    tag: Tag,
    index: number,
    count: number,
    locked: boolean,
  ): void {
    const row = rows.createDiv({ cls: 'spellbook-tag-row', attr: { role: 'listitem' } });
    const color = row.createEl('button', {
      cls: 'spellbook-tag-color',
      attr: {
        type: 'button',
        'aria-label': `Colour: ${tag.color === null ? 'none' : colorName(tag.color)}`,
        'aria-haspopup': 'menu',
      },
    });
    setColor(color.createSpan({ cls: SWATCH_CLASS }), tag.color);
    color.disabled = locked;
    color.addEventListener('click', () => {
      safely('Change colour', () => {
        this.showColourMenu(kind, tag, placeUnder(color));
      });
    });

    // The name is the writer's own text, and the only thing in the row that is.
    row.createDiv({ cls: 'spellbook-tag-name', text: tag.name, attr: { dir: 'auto' } });

    const up = iconButton(row, 'spellbook-tag-button spellbook-tag-up', 'Move up', ACTION_ICONS.moveUp, () =>
      this.act(kind, (list) => moveTag(list, tag.name, index - 1), { kind, name: tag.name, control: 'up' }),
    );
    setButtonOff(up, locked || index === 0);
    const down = iconButton(row, 'spellbook-tag-button spellbook-tag-down', 'Move down', ACTION_ICONS.moveDown, () =>
      this.act(kind, (list) => moveTag(list, tag.name, index + 1), { kind, name: tag.name, control: 'down' }),
    );
    setButtonOff(down, locked || index === count - 1);
    const more = iconButton(row, 'spellbook-tag-button spellbook-tag-more', MORE_LABEL, ROW_MORE_ICON, (button) => {
      this.showRowMenu(kind, tag, placeUnder(button));
    });
    more.setAttr('aria-haspopup', 'menu');
    setButtonOff(more, locked);
    this.rows.set(rowKey(kind, tag.name), { kind, name: tag.name, color, up, down, more });
  }

  /** The names scenes use that the list does not have, each with a button that adds it. */
  private renderUnlisted(section: HTMLElement, kind: TagKind, list: TagList, locked: boolean): void {
    const loose = unlistedTags(list, this.host.sceneProperties());
    if (loose.length === 0) return;
    const words = WORDS[kind];
    const box = section.createDiv({ cls: 'spellbook-tags-unlisted' });
    box.createDiv({ cls: 'spellbook-tags-note', text: 'Used by scenes, but not in the list:' });
    for (const entry of loose) {
      const row = box.createDiv({ cls: 'spellbook-tag-row spellbook-is-unlisted' });
      row.createDiv({ cls: 'spellbook-tag-name', text: entry.name, attr: { dir: 'auto' } });
      row.createSpan({ cls: 'spellbook-tag-uses', text: describeScenes(entry.paths.length), attr: { dir: 'ltr' } });
      const add = row.createEl('button', {
        cls: 'spellbook-tags-adopt',
        text: 'Add',
        attr: { type: 'button', 'aria-label': `Add this ${words.one} to the list` },
      });
      add.disabled = locked;
      add.addEventListener('click', () => {
        safely('Add', () => this.act(kind, (current) => addTag(current, entry.name)));
      });
    }
  }

  // -------------------------------------------------------------------- menus

  private showRowMenu(kind: TagKind, tag: Tag, at: MenuPositionDef): void {
    const words = WORDS[kind];
    const menu = new Menu();
    const add = (title: string, icons: readonly string[], run: () => unknown): void => {
      menu.addItem((item) => {
        item
          .setTitle(title)
          .setIcon(iconName(...icons))
          .onClick(() => {
            safely(title, run);
          });
      });
    };
    add('Rename', ACTION_ICONS.rename, () => {
      new TextPromptModal(this.app, {
        title: `Rename ${words.one}`,
        label: `New name for the ${words.one}`,
        value: tag.name,
        confirm: 'Rename',
        submit: (value) => this.rename(kind, tag.name, value),
      }).open();
    });
    add('Change colour', ['palette', 'droplet'], () => {
      this.showColourMenu(kind, tag, at);
    });
    menu.addSeparator();
    add('Remove', ACTION_ICONS.removeEntry, () => {
      this.askToRemove(kind, tag);
    });
    menu.showAtPosition(at);
  }

  /** The eight colours, and none: the one the status or label has is ticked. */
  private showColourMenu(kind: TagKind, tag: Tag, at: MenuPositionDef): void {
    const menu = new Menu();
    const offer = (title: string | DocumentFragment, color: CardColor | null): void => {
      menu.addItem((item) => {
        item
          .setTitle(title)
          .setChecked(tag.color === color)
          .onClick(() => {
            // The colour it already has: nothing to do.
            if (tag.color === color) return;
            safely('Change colour', () =>
              this.act(kind, (list) => recolourTag(list, tag.name, color), { kind, name: tag.name, control: 'color' }),
            );
          });
      });
    };
    for (const color of CARD_COLORS) offer(tagTitle(colorName(color), color, false), color);
    menu.addSeparator();
    offer('No colour', null);
    menu.showAtPosition(at);
  }

  // ------------------------------------------------------------------ changes

  private askToAdd(kind: TagKind): void {
    const words = WORDS[kind];
    new TextPromptModal(this.app, {
      title: `New ${words.one}`,
      label: `Name of the new ${words.one}`,
      placeholder: `Name of the ${words.one}`,
      confirm: 'Add',
      submit: async (value) => {
        const list = this.listOf(kind);
        if (!list) return 'No project is open.';
        const result = addTag(list, value);
        if (!result.ok) return result.message;
        return this.save(kind, result, null);
      },
    }).open();
  }

  private async rename(kind: TagKind, name: string, newName: string): Promise<string | null> {
    const list = this.listOf(kind);
    if (!list) return 'No project is open.';
    // The engine also works out the change every scene that uses the old name needs.
    const result = renameTag(list, name, newName, this.host.sceneProperties());
    if (!result.ok) return result.message;
    return this.save(kind, result, { from: name, to: tidyDisplayName(newName) });
  }

  private askToRemove(kind: TagKind, tag: Tag): void {
    const words = WORDS[kind];
    const used = scenesUsingTag(kind, tag.name, this.host.sceneProperties()).length;
    let message = `No scene uses this ${words.one}.`;
    if (used === 1) message = `1 scene uses this ${words.one}. It keeps the name, shown without a colour.`;
    if (used > 1) {
      message = `${formatCount(used)} scenes use this ${words.one}. They keep the name, shown without a colour.`;
    }
    new ConfirmModal(this.app, {
      title: `Remove "${tag.name}"?`,
      message,
      confirm: 'Remove',
      onConfirm: () => {
        safely('Remove', () => this.act(kind, (list) => removeTag(list, tag.name)));
      },
    }).open();
  }

  /**
   * Make one change to a list: the engine says what the list becomes, the
   * host stores it. A change that is refused, or cannot be stored, is told to
   * the writer in a notice.
   *
   * @param change works the change out from the list as it is at that moment
   * @param focus  where the keyboard should be once the list is drawn again
   */
  private async act(kind: TagKind, change: (list: TagList) => TagEditResult, focus: Place | null = null): Promise<void> {
    if (this.busy || this.closed) return;
    const list = this.listOf(kind);
    if (!list) return;
    const result = change(list);
    if (!result.ok) {
      new Notice(result.message, PROBLEM_NOTICE_MS);
      return;
    }
    this.busy = true;
    this.focusNext = focus;
    try {
      const message = await this.save(kind, result, null);
      if (message !== null) new Notice(message, PROBLEM_NOTICE_MS);
    } finally {
      this.busy = false;
      this.focusNext = null;
    }
  }

  /** Hand a changed list to the host. Resolves with null when it was stored, or with why it was not. */
  private async save(
    kind: TagKind,
    result: SavedEdit,
    rename: { readonly from: string; readonly to: string } | null,
  ): Promise<string | null> {
    let message: string | null;
    try {
      message = await this.host.saveTagList({
        kind,
        key: result.key,
        value: result.value,
        scenePatches: result.scenePatches,
        rename,
      });
    } catch (error) {
      console.error('Spellbook: the list could not be saved', error);
      message = error instanceof Error ? error.message : String(error);
    }
    // The host usually says that the project changed; drawn here as well, in case it is slow to.
    if (message === null) this.render();
    return message;
  }
}

function rowKey(kind: TagKind, name: string): string {
  return `${kind}\n${name}`;
}

/** Open the statuses-and-labels window. */
export function openTagLists(app: App, host: CardsHost): TagListsModal {
  const modal = new TagListsModal(app, host);
  modal.open();
  return modal;
}
