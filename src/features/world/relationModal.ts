// The window that says an entity has to do with another: a box to search
// in, a box for a short label ("sister", "keeps it", "born there"), and
// under them the entities of the project that this one does not list yet. A
// tap on one writes a link to it, with the label, in this entity's "related"
// property. Nothing is written into the other note: its sheet shows the
// relation as "mentioned by".
//
// Enter in the search box takes the first row. Nothing here depends on
// hovering: every row is a button that can be tapped, and reached and
// pressed from the keyboard.

import { Modal, Notice } from 'obsidian';
import type { App } from 'obsidian';
import { RELATION_LABEL_MAX, matchesSearch } from '../../core/world';
import type { Entity } from '../../core/world';
import { isInputMethodKey } from '../../ui/keys';
import { safely } from '../../ui/safely';
import type { WorldHost } from './host';
import { NO_PROJECT_TEXT, PROBLEM_NOTICE_MS, READ_ONLY_TEXT, typeBadge } from './parts';

export const RELATION_SEARCH_PLACEHOLDER = 'Search the world';
export const RELATION_LABEL_PLACEHOLDER = 'How? For example: sister, keeps it (optional)';
export const RELATION_NONE_TEXT = 'Nothing else in the world yet.';
export const RELATION_ALL_LISTED_TEXT = 'It is related to everything in the world already.';
export const RELATION_NONE_FOUND_TEXT = 'Nothing by that name.';

/** At most this many entities are listed at once; typing narrows the list down. */
export const RELATION_PICKER_LIMIT = 50;

/** "Related to Mara": the entity's name is the writer's own text. */
export function relationPickerTitle(name: string | null): string {
  return name === null ? 'Related' : `Related to ${name}`;
}

export class RelationPickerModal extends Modal {
  private readonly host: WorldHost;
  private readonly entityPath: string;
  private input: HTMLInputElement | null = null;
  private label: HTMLInputElement | null = null;
  private list: HTMLElement | null = null;
  private message: HTMLElement | null = null;
  private stop: (() => void) | null = null;
  private busy = false;
  private closed = true;
  /** What the first row does, for Enter. */
  private first: (() => void) | null = null;

  constructor(app: App, host: WorldHost, entityPath: string) {
    super(app);
    this.host = host;
    this.entityPath = entityPath;
  }

  override onOpen(): void {
    const { contentEl } = this;
    this.closed = false;
    contentEl.empty();
    this.titleEl.setText(relationPickerTitle(this.host.entity(this.entityPath)?.name ?? null));
    this.titleEl.setAttr('dir', 'auto');
    this.modalEl.addClass('spellbook-world-picker');
    this.modalEl.addClass('spellbook-world-relation-picker');

    const box = (cls: string, placeholder: string): HTMLInputElement =>
      contentEl.createEl('input', {
        cls: `spellbook-world-picker-input ${cls}`,
        // A name and a label may be in any language; let each pick its own direction.
        attr: { type: 'text', dir: 'auto', placeholder, 'aria-label': placeholder, enterkeyhint: 'done' },
      });
    const input = box('spellbook-world-relation-search', RELATION_SEARCH_PLACEHOLDER);
    const label = box('spellbook-world-relation-label-box', RELATION_LABEL_PLACEHOLDER);
    label.setAttr('maxlength', RELATION_LABEL_MAX);
    input.addEventListener('input', () => {
      this.message?.setText('');
      this.drawRows();
    });
    input.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' || isInputMethodKey(event)) return;
      event.preventDefault();
      this.first?.();
    });
    this.input = input;
    this.label = label;
    this.message = contentEl.createDiv({ cls: 'spellbook-world-picker-message', attr: { role: 'alert', dir: 'auto' } });
    this.list = contentEl.createDiv({ cls: 'spellbook-world-picker-list', attr: { role: 'list' } });
    this.stop = this.host.onChange(() => {
      if (!this.closed && !this.busy) this.drawRows();
    });
    this.drawRows();
    input.focus();
  }

  override onClose(): void {
    this.closed = true;
    this.stop?.();
    this.stop = null;
    this.input = null;
    this.label = null;
    this.list = null;
    this.message = null;
    this.first = null;
    this.contentEl.empty();
  }

  private drawRows(): void {
    const list = this.list;
    const input = this.input;
    if (!list || !input || this.closed) return;
    list.empty();
    this.first = null;
    const listed = new Set(this.host.relations.of(this.entityPath).map((relation) => relation.entity?.path));
    const others = this.host.entities.filter((entity) => entity.path !== this.entityPath);
    const open = others.filter((entity) => !listed.has(entity.path));
    const found = open.filter((entity) => matchesSearch(entity, input.value));
    for (const entity of found.slice(0, RELATION_PICKER_LIMIT)) this.drawEntity(list, entity);
    if (found.length > RELATION_PICKER_LIMIT) {
      list.createDiv({ cls: 'spellbook-world-picker-note', text: `${found.length - RELATION_PICKER_LIMIT} more: type to narrow the list down.` });
    }
    if (found.length > 0) return;
    let text = RELATION_NONE_FOUND_TEXT;
    if (others.length === 0) text = RELATION_NONE_TEXT;
    else if (open.length === 0) text = RELATION_ALL_LISTED_TEXT;
    list.createDiv({ cls: 'spellbook-world-picker-note', text });
  }

  private drawEntity(list: HTMLElement, entity: Entity): void {
    const type = this.host.typeOf(entity);
    const row = list.createEl('button', { cls: 'spellbook-world-picker-row spellbook-world-picker-entity', attr: { type: 'button', role: 'listitem' } });
    const run = (): void => {
      safely('Add a relation', () => this.take(entity.path));
    };
    row.addEventListener('click', run);
    this.first ??= run;
    typeBadge(row, type);
    const words = row.createSpan({ cls: 'spellbook-world-picker-words' });
    words.createSpan({ cls: 'spellbook-world-picker-name', text: entity.name, attr: { dir: 'auto' } });
    if (entity.summary !== '') {
      words.createSpan({ cls: 'spellbook-world-picker-summary', text: entity.summary, attr: { dir: 'auto' } });
    }
    if (type) row.createSpan({ cls: 'spellbook-world-picker-type', text: type.name, attr: { dir: 'auto' } });
  }

  /** Add the relation, once at a time. The window closes when it is done, and says why when it is not. */
  private async take(otherPath: string): Promise<void> {
    if (this.busy || this.closed) return;
    this.busy = true;
    let problem: string | null;
    try {
      problem = await this.host.relate(this.entityPath, otherPath, this.label?.value ?? '');
    } catch (error) {
      console.error('Spellbook: the relation could not be saved', error);
      problem = error instanceof Error ? error.message : String(error);
    } finally {
      this.busy = false;
    }
    if (this.closed) {
      if (problem !== null) new Notice(problem, PROBLEM_NOTICE_MS);
      return;
    }
    if (problem === null) {
      this.close();
      return;
    }
    this.message?.setText(problem);
    this.drawRows();
    this.input?.focus();
  }
}

/** Open the window that adds a relation to an entity. */
export function openRelationPicker(app: App, host: WorldHost, entityPath: string): void {
  const project = host.project;
  if (!project || project.readOnly) {
    new Notice(project ? READ_ONLY_TEXT : NO_PROJECT_TEXT, PROBLEM_NOTICE_MS);
    return;
  }
  new RelationPickerModal(app, host, entityPath).open();
}
