// The entity sheet: one entity of the world, laid out as a card to read and
// to fill in. It is drawn in the browser's details: beside the list in a
// wide pane, as a page of its own with a button that leads back in a narrow
// one (a phone, a sidebar).
//
//   head     the button that leads back, and the name
//   hero     the picture (or the type's icon), the type, the other names,
//            "Open note", "Choose picture" and "Remove picture"
//   form     the summary, then the fields of the type and whatever else the
//            writer added to the note, each to be changed in place
//   rest     "Related" in groups by type, with "Mentioned by" for the other
//            side; "Scenes" in binder order with their synopsis; "Events"
//            with their date in the story; and "Find mentions"
//
// A field is saved when it is left or Enter is pressed, as a change of that
// one property of the note; the note's text is never touched. While the
// sheet shows the same entity its fields are kept and only brought up to
// date, never built anew: a field that is being typed in keeps its text and
// the keyboard whatever else changes around it.
//
// Names, summaries and what the fields hold are the writer's own text, in
// any language: each takes the direction of its own text, and the sheet
// follows the direction of the app. Nothing depends on hovering or dragging.

import { Keymap } from 'obsidian';
import type { App } from 'obsidian';
import { IMAGE_KEY, OTHER_NAME, SUMMARY_KEY, groupRelations, sheetFields } from '../../core/world';
import type { BackRelation, Entity, EntityType, Relation } from '../../core/world';
import { isInputMethodKey } from '../../ui/keys';
import { safely } from '../../ui/safely';
import { TextPromptModal } from '../../ui/textPromptModal';
import type { FoundMention, SheetAppearance, WorldHost } from './host';
import { openImagePicker } from './imagePicker';
import { WORLD_ICONS, entityPicture, iconButton, settle, textButton, typeBadge } from './parts';
import { openRelationPicker } from './relationModal';

export const OPEN_NOTE_TEXT = 'Open note';
export const BACK_LABEL = 'Back to the list';
export const CLOSE_LABEL = 'Close the sheet';
export const CHOOSE_PICTURE_TEXT = 'Choose picture';
export const REMOVE_PICTURE_TEXT = 'Remove picture';
export const SUMMARY_LABEL = 'Summary';
export const SUMMARY_PLACEHOLDER = 'One or two lines about it';
export const RELATED_HEADING = 'Related';
export const ADD_RELATION_TEXT = 'Add';
export const NO_RELATIONS_TEXT = 'Nothing yet. Use "Add" to say who or what it has to do with.';
export const MENTIONED_BY_HEADING = 'Mentioned by';
export const EDIT_LABEL_LABEL = 'Change the label';
export const REMOVE_RELATION_LABEL = 'Remove the relation';
export const LOST_RELATION_TEXT = 'not in this project';
export const SCENES_HEADING = 'Scenes';
export const EVENTS_HEADING = 'Events';
export const NO_SCENES_TEXT = 'Not in any scene yet. Add it to a scene from the inspector, under "In this scene".';
export const FIND_MENTIONS_TEXT = 'Find mentions';
export const MENTIONS_HEADING = 'Mentioned, not listed';
export const SEARCHING_TEXT = 'Reading the scenes...';
export const NO_MENTIONS_TEXT = 'No other scene names it.';
export const LINK_SCENE_TEXT = 'Link this scene';
export const REMOVE_FROM_SCENE_LABEL = 'Take out of this scene';

/** What "Find mentions" has to show for the entity on the sheet. */
type Mentions =
  | { readonly state: 'idle' }
  | { readonly state: 'searching' }
  | { readonly state: 'found'; readonly scenes: readonly FoundMention[] };

/** What the sheet asks of the pane it is drawn in. */
export interface SheetOwner {
  /** Whether the pane is narrow: the sheet then takes the place of the list. */
  isNarrow(): boolean;
  /** Show another entity's sheet, or none (null). */
  showSheet(path: string | null): void;
  /** Draw the sheet again from what the host holds now. */
  redrawSheet(): void;
  /** False once the pane is closed: nothing is drawn any more. */
  isOpen(): boolean;
}

/** One field of the form: the property it changes and the box it is typed in. */
interface FieldBox {
  readonly name: string;
  readonly box: HTMLTextAreaElement;
  /** What the note holds, as the box was last told. */
  stored: string;
}

/** The parts of a sheet that is on the screen, kept while it shows the same entity. */
interface Built {
  /** What it was built for: the entity, and the fields it has to offer. */
  readonly signature: string;
  readonly detail: HTMLElement;
  readonly head: HTMLElement;
  readonly hero: HTMLElement;
  readonly boxes: FieldBox[];
  readonly rest: HTMLElement;
}

export class EntitySheet {
  private readonly app: App;
  private readonly host: WorldHost;
  private readonly owner: SheetOwner;
  private built: Built | null = null;
  /** The property whose box has the keyboard, if any. */
  private typingIn: string | null = null;
  private mentions: Mentions = { state: 'idle' };
  /** The entity the mentions were looked for. */
  private mentionsOf: string | null = null;
  /** Goes up whenever the mentions being looked for are no longer wanted. */
  private mentionsRun = 0;

  constructor(app: App, host: WorldHost, owner: SheetOwner) {
    this.app = app;
    this.host = host;
    this.owner = owner;
  }

  /** The sheet is going away, or is to show another entity: forget what was kept for this one. */
  forget(): void {
    this.mentionsRun++;
    this.mentions = { state: 'idle' };
    this.mentionsOf = null;
    this.built = null;
    this.typingIn = null;
  }

  /**
   * Draw an entity's sheet into the details, or empty them (null).
   *
   * @param detail the element of the pane that holds the sheet
   */
  draw(detail: HTMLElement, entity: Entity | null): void {
    if (!entity) {
      detail.empty();
      this.forget();
      return;
    }
    if (this.mentionsOf !== entity.path) {
      this.mentionsRun++;
      this.mentions = { state: 'idle' };
      this.mentionsOf = entity.path;
    }
    const type = this.host.typeOf(entity);
    const canChange = this.host.canChange;
    const fields = sheetFields(entity, type);
    const signature = JSON.stringify([entity.path, type?.id ?? null, canChange, fields.map((field) => [field.name, field.editable])]);

    let built = this.built;
    if (built === null || built.signature !== signature || built.detail !== detail || built.head.parentElement !== detail) {
      detail.empty();
      this.typingIn = null;
      const head = detail.createDiv({ cls: 'spellbook-world-detail-head' });
      const hero = detail.createDiv({ cls: 'spellbook-world-sheet-hero' });
      const boxes: FieldBox[] = [];
      this.buildForm(detail, entity, fields, canChange, boxes);
      const rest = detail.createDiv({ cls: 'spellbook-world-sheet-rest' });
      built = { signature, detail, head, hero, boxes, rest };
      this.built = built;
    } else {
      // The same sheet: its boxes stay, and say what the note says now. The one being typed in is left alone.
      const values = new Map<string, string>([[SUMMARY_KEY, entity.summary], ...fields.map((field): [string, string] => [field.name, field.value])]);
      for (const field of built.boxes) {
        const value = values.get(field.name) ?? '';
        if (field.name === this.typingIn || field.stored === value) continue;
        field.stored = value;
        field.box.value = value;
        fit(field.box);
      }
    }
    this.drawHead(built.head, entity);
    this.drawHero(built.hero, entity, type, canChange);
    this.drawRest(built.rest, entity, canChange);
  }

  // --------------------------------------------------------------- head, hero

  private drawHead(head: HTMLElement, entity: Entity): void {
    head.empty();
    const narrow = this.owner.isNarrow();
    iconButton(head, 'spellbook-world-detail-back', narrow ? BACK_LABEL : CLOSE_LABEL, narrow ? WORLD_ICONS.back : WORLD_ICONS.close, () => {
      this.owner.showSheet(null);
    });
    head.createDiv({ cls: 'spellbook-world-detail-name', text: entity.name, attr: { dir: 'auto', role: 'heading', 'aria-level': 2 } });
  }

  private drawHero(hero: HTMLElement, entity: Entity, type: EntityType | null, canChange: boolean): void {
    hero.empty();
    const url = this.host.imageOf(entity);
    entityPicture(hero, url, type, 'spellbook-world-sheet-picture');
    const words = hero.createDiv({ cls: 'spellbook-world-sheet-words' });
    const kind = words.createDiv({ cls: 'spellbook-world-sheet-type' });
    typeBadge(kind, type);
    // The name of a type of the writer's own is the writer's text.
    kind.createSpan({ cls: 'spellbook-world-detail-type', text: type?.name ?? OTHER_NAME, attr: { dir: 'auto' } });
    if (entity.aliases.length > 0) {
      words.createDiv({ cls: 'spellbook-world-detail-aliases', text: entity.aliases.join(', '), attr: { dir: 'auto' } });
    }
    const actions = words.createDiv({ cls: 'spellbook-world-detail-actions' });
    textButton(actions, 'mod-cta spellbook-world-open', OPEN_NOTE_TEXT, () => this.host.open(entity.path, false));
    if (!canChange) return;
    textButton(actions, 'spellbook-world-choose-picture', CHOOSE_PICTURE_TEXT, () => {
      openImagePicker(this.app, this.host, entity.path);
    });
    // Also for a picture that cannot be shown: what the note names can then be taken away again.
    if (url !== null || entity.frontmatter?.[IMAGE_KEY] !== undefined) {
      textButton(actions, 'spellbook-world-remove-picture', REMOVE_PICTURE_TEXT, () => settle(this.host.setPicture(entity.path, null)));
    }
  }

  // --------------------------------------------------------------------- form

  private buildForm(
    detail: HTMLElement,
    entity: Entity,
    fields: ReturnType<typeof sheetFields>,
    canChange: boolean,
    boxes: FieldBox[],
  ): void {
    if (canChange) {
      const box = this.fieldBox(detail, 'spellbook-world-detail-summary', entity.path, SUMMARY_KEY, SUMMARY_LABEL, entity.summary, 2, boxes);
      box.setAttr('placeholder', SUMMARY_PLACEHOLDER);
    } else if (entity.summary !== '') {
      detail.createDiv({ cls: 'spellbook-world-detail-summary', text: entity.summary, attr: { dir: 'auto' } });
    }
    const shown = canChange ? fields : fields.filter((field) => field.value !== '');
    if (shown.length === 0) return;
    const table = detail.createEl('dl', { cls: 'spellbook-world-fields' });
    for (const field of shown) {
      const cell = table.createDiv({ cls: 'spellbook-world-field' });
      // Both the name of a property and what it holds may be the writer's own text.
      cell.createEl('dt', { cls: 'spellbook-world-field-name', text: field.name, attr: { dir: 'auto' } });
      const value = cell.createEl('dd', { cls: 'spellbook-world-field-value' });
      if (canChange && field.editable) {
        this.fieldBox(value, 'spellbook-world-field-box', entity.path, field.name, field.name, field.value, 1, boxes);
      } else {
        value.setText(field.value);
        value.setAttr('dir', 'auto');
      }
    }
  }

  /** A box a property is typed in. It is saved when the box is left, or on Enter; Escape puts back what the note says. */
  private fieldBox(
    parent: HTMLElement,
    cls: string,
    entityPath: string,
    name: string,
    label: string,
    value: string,
    rows: number,
    boxes: FieldBox[],
  ): HTMLTextAreaElement {
    const box = parent.createEl('textarea', {
      cls: `spellbook-world-box ${cls}`,
      // What is typed may be in any language; let it pick its own direction.
      attr: { dir: 'auto', rows, 'aria-label': label, 'data-field': name, enterkeyhint: 'done', spellcheck: 'true' },
    });
    box.value = value;
    const field: FieldBox = { name, box, stored: value };
    boxes.push(field);
    const save = (): void => {
      const typed = box.value.replace(/\s+/g, ' ').trim();
      if (typed === field.stored) return;
      field.stored = typed;
      void settle(this.host.setField(entityPath, name, typed));
    };
    box.addEventListener('focus', () => {
      this.typingIn = name;
    });
    box.addEventListener('blur', () => {
      if (this.typingIn === name) this.typingIn = null;
      save();
    });
    box.addEventListener('change', save);
    box.addEventListener('input', () => {
      fit(box);
    });
    box.addEventListener('keydown', (event) => {
      if (isInputMethodKey(event)) return;
      if (event.key === 'Enter' && !event.shiftKey) {
        // One line of text: Enter says "done", it does not start a new line.
        event.preventDefault();
        save();
      } else if (event.key === 'Escape' && box.value !== field.stored) {
        event.preventDefault();
        event.stopPropagation();
        box.value = field.stored;
        fit(box);
      }
    });
    fit(box);
    return box;
  }

  // --------------------------------------------------------------------- rest

  private drawRest(rest: HTMLElement, entity: Entity, canChange: boolean): void {
    rest.empty();
    this.drawRelations(rest, entity, canChange);
    const scenes = this.host.sceneRows(entity.path);
    this.drawAppearances(rest, SCENES_HEADING, scenes, entity, canChange);
    if (scenes.length === 0) rest.createDiv({ cls: 'spellbook-world-message spellbook-world-hint', text: NO_SCENES_TEXT });
    const events = this.host.eventRows(entity.path);
    if (events.length > 0) this.drawAppearances(rest, EVENTS_HEADING, events, entity, canChange);
    const actions = rest.createDiv({ cls: 'spellbook-world-detail-actions' });
    const find = textButton(actions, 'spellbook-world-find', FIND_MENTIONS_TEXT, () => {
      this.findMentions(entity.path);
    });
    find.disabled = this.mentions.state === 'searching';
    this.drawMentions(rest, entity, canChange);
  }

  private sectionHead(parent: HTMLElement, heading: string, count: number | null): HTMLElement {
    const head = parent.createDiv({ cls: 'spellbook-world-section-head', attr: { role: 'heading', 'aria-level': 3 } });
    head.createSpan({ text: heading });
    if (count !== null) head.createSpan({ cls: 'spellbook-world-group-count', text: String(count), attr: { dir: 'ltr' } });
    return head;
  }

  /** "Related": the entities this one lists, in groups by their type, and under them the ones that list it. */
  private drawRelations(rest: HTMLElement, entity: Entity, canChange: boolean): void {
    const own = this.host.relations.of(entity.path);
    const back = this.host.relations.mentionedBy(entity.path);
    const head = this.sectionHead(rest, RELATED_HEADING, own.length + back.length);
    if (canChange) {
      textButton(head, 'spellbook-world-relate', ADD_RELATION_TEXT, () => {
        openRelationPicker(this.app, this.host, entity.path);
      });
    }
    if (own.length === 0 && back.length === 0) {
      if (canChange) rest.createDiv({ cls: 'spellbook-world-message spellbook-world-hint', text: NO_RELATIONS_TEXT });
      return;
    }
    const types = this.host.types;
    for (const group of groupRelations(own, types)) {
      const rows = this.relationGroup(rest, group.type, group.name);
      for (const relation of group.relations) this.drawRelation(rows, entity, relation, canChange);
    }
    if (back.length === 0) return;
    rest.createDiv({ cls: 'spellbook-world-relation-side', text: MENTIONED_BY_HEADING, attr: { role: 'heading', 'aria-level': 4 } });
    for (const group of groupRelations(back, types)) {
      const rows = this.relationGroup(rest, group.type, group.name);
      for (const relation of group.relations) this.drawBackRelation(rows, relation);
    }
  }

  private relationGroup(rest: HTMLElement, type: EntityType | null, name: string): HTMLElement {
    const group = rest.createDiv({ cls: 'spellbook-world-relation-group' });
    const head = group.createDiv({ cls: 'spellbook-world-relation-type' });
    typeBadge(head, type);
    // The name of a type of the writer's own is the writer's text.
    head.createSpan({ text: name, attr: { dir: 'auto' } });
    return group.createDiv({ cls: 'spellbook-world-rows', attr: { role: 'list' } });
  }

  /** The other entity's name, as a button that shows its sheet, and the label beside it. */
  private relationWords(row: HTMLElement, name: string, label: string, other: Entity | null): void {
    const open = row.createEl('button', {
      cls: 'spellbook-world-row-open spellbook-world-relation-open',
      // A name is the writer's own text.
      attr: { type: 'button', dir: 'auto' },
    });
    open.createSpan({ cls: 'spellbook-world-relation-name', text: name, attr: { dir: 'auto' } });
    const said = other === null ? (label === '' ? LOST_RELATION_TEXT : `${label} (${LOST_RELATION_TEXT})`) : label;
    if (said !== '') open.createSpan({ cls: 'spellbook-world-relation-label', text: said, attr: { dir: 'auto' } });
    open.disabled = other === null;
    if (other === null) return;
    open.addEventListener('click', (event) => {
      safely(OPEN_NOTE_TEXT, () => {
        // With the usual key held, the other's note in a new tab; otherwise its sheet, here.
        if (Keymap.isModEvent(event)) return this.host.open(other.path, Keymap.isModEvent(event));
        this.owner.showSheet(other.path);
        return undefined;
      });
    });
  }

  private drawRelation(rows: HTMLElement, entity: Entity, relation: Relation, canChange: boolean): void {
    const row = rows.createDiv({ cls: 'spellbook-world-row spellbook-world-relation', attr: { role: 'listitem' } });
    row.toggleClass('spellbook-world-relation-lost', relation.entity === null);
    this.relationWords(row, relation.name, relation.label, relation.entity);
    if (!canChange) return;
    iconButton(row, 'spellbook-world-relation-edit', EDIT_LABEL_LABEL, WORLD_ICONS.label, () => {
      new TextPromptModal(this.app, {
        title: `${entity.name} and ${relation.name}`,
        label: 'Label',
        placeholder: 'For example: sister, keeps it, born there',
        value: relation.label,
        confirm: 'Save',
        submit: (value) => this.host.changeRelation(entity.path, relation.raw, value),
      }).open();
    });
    iconButton(row, 'spellbook-world-relation-remove', REMOVE_RELATION_LABEL, WORLD_ICONS.unlink, () =>
      settle(this.host.changeRelation(entity.path, relation.raw, null)),
    );
  }

  private drawBackRelation(rows: HTMLElement, relation: BackRelation): void {
    const row = rows.createDiv({ cls: 'spellbook-world-row spellbook-world-relation spellbook-world-relation-back', attr: { role: 'listitem' } });
    this.relationWords(row, relation.entity.name, relation.label, relation.entity);
  }

  /** A list of the scenes (or events) an entity is in: a tap on one opens it. */
  private drawAppearances(rest: HTMLElement, heading: string, notes: readonly SheetAppearance[], entity: Entity, canChange: boolean): void {
    this.sectionHead(rest, heading, notes.length);
    if (notes.length === 0) return;
    const rows = rest.createDiv({ cls: 'spellbook-world-rows', attr: { role: 'list' } });
    for (const note of notes) {
      const item = rows.createDiv({ cls: 'spellbook-world-appearance', attr: { role: 'listitem' } });
      const row = item.createDiv({ cls: 'spellbook-world-row' });
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
      // A scene's synopsis, or an event's date in the story.
      if (note.note !== '') item.createDiv({ cls: 'spellbook-world-row-note', text: note.note, attr: { dir: 'auto' } });
    }
  }

  // ----------------------------------------------------------------- mentions

  private findMentions(path: string): void {
    const run = ++this.mentionsRun;
    this.mentions = { state: 'searching' };
    this.owner.redrawSheet();
    void this.host
      .findMentions(path)
      .catch((error: unknown): FoundMention[] => {
        console.error('Spellbook: the scenes could not be read', error);
        return [];
      })
      .then((scenes) => {
        if (run !== this.mentionsRun || !this.owner.isOpen()) return;
        this.mentions = { state: 'found', scenes };
        this.owner.redrawSheet();
      });
  }

  private drawMentions(rest: HTMLElement, entity: Entity, canChange: boolean): void {
    const mentions = this.mentions;
    if (mentions.state === 'idle') return;
    this.sectionHead(rest, MENTIONS_HEADING, null);
    if (mentions.state === 'searching') {
      rest.createDiv({ cls: 'spellbook-world-message spellbook-world-hint', text: SEARCHING_TEXT });
      return;
    }
    // A scene that was linked a moment ago is listed above by now.
    const listed = new Set(this.host.links.scenesOf(entity.path).map((scene) => scene.path));
    const scenes = mentions.scenes.filter((scene) => !listed.has(scene.path));
    if (scenes.length === 0) {
      rest.createDiv({ cls: 'spellbook-world-message spellbook-world-hint', text: NO_MENTIONS_TEXT });
      return;
    }
    const rows = rest.createDiv({ cls: 'spellbook-world-rows spellbook-world-mentions', attr: { role: 'list' } });
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
}

/**
 * How tall a box has to be to show all it holds, in pixels, or null where
 * there is nothing to measure (a box that is not on the screen yet).
 *
 * What a box holds is measured inside its border, and its height is set
 * with the border: the border is added, or the box comes out a little too
 * short, grows a scrollbar, and the scrollbar pushes the last words out of
 * sight.
 */
export function fittedHeight(box: { readonly scrollHeight: number; readonly offsetHeight: number; readonly clientHeight: number }): number | null {
  const needed = box.scrollHeight;
  if (typeof needed !== 'number' || !(needed > 0)) return null;
  const border = box.offsetHeight - box.clientHeight;
  return needed + (typeof border === 'number' && border > 0 ? border : 0);
}

/** Whether the app makes a box as tall as what it holds by itself, as the stylesheet asks. */
function sizesItself(): boolean {
  try {
    return typeof CSS !== 'undefined' && typeof CSS.supports === 'function' && CSS.supports('field-sizing', 'content');
  } catch {
    return false;
  }
}

/**
 * Make a box as tall as what it holds, so that a long line is read whole.
 * (Where the app can do that by itself the stylesheet asks for it, and the
 * box is left to it: a height set here would also stay behind when the pane
 * changes its width. This is for where it cannot. A box that is not on the
 * screen yet has no height to measure, and keeps its rows.)
 */
function fit(box: HTMLTextAreaElement): void {
  if (sizesItself()) {
    if (box.style.height !== '') box.style.height = '';
    return;
  }
  if (fittedHeight(box) === null) return;
  box.style.height = 'auto';
  const height = fittedHeight(box);
  if (height !== null) box.style.height = `${height}px`;
}
