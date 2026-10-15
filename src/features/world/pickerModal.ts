// The window that adds an entity to a scene: a box to search in, and under
// it the entities of the project that the scene does not list yet. A tap on
// one lists it in the scene. When what was typed is not the name of an
// entity, the list ends with one row per type that makes a new entity of
// that name and lists it at once.
//
// Enter takes the first row. Nothing here depends on hovering: every row is
// a button that can be tapped, and reached and pressed from the keyboard.

import { Modal, Notice } from 'obsidian';
import type { App } from 'obsidian';
import { clashKey } from '../../core/paths';
import { matchesSearch } from '../../core/world';
import type { Entity, EntityType } from '../../core/world';
import { isInputMethodKey } from '../../ui/keys';
import { safely } from '../../ui/safely';
import type { WorldHost } from './host';
import { NO_PROJECT_TEXT, PROBLEM_NOTICE_MS, READ_ONLY_TEXT, typeBadge } from './parts';

export const PICKER_PLACEHOLDER = 'Search, or type a new name';
export const PICKER_EMPTY_TEXT = 'Nothing in the world yet. Type a name to make a character, a place, a piece of lore or anything else.';
export const PICKER_ALL_LISTED_TEXT = 'Everything is in this scene already. Type a name to make something new.';
export const PICKER_NONE_FOUND_TEXT = 'Nothing by that name yet.';

/** At most this many entities are listed at once; typing narrows the list down. */
export const PICKER_LIMIT = 50;

/** "Add to scene" with the scene's title, which is the writer's own text. */
export function pickerTitle(sceneTitle: string | null, chapter = false): string {
  const heading = chapter ? 'In this chapter' : 'In this scene';
  return sceneTitle === null ? heading : `${heading}: ${sceneTitle}`;
}

export class EntityPickerModal extends Modal {
  private readonly host: WorldHost;
  private readonly scenePath: string;
  private input: HTMLInputElement | null = null;
  private list: HTMLElement | null = null;
  private message: HTMLElement | null = null;
  private stop: (() => void) | null = null;
  private busy = false;
  private closed = true;
  /** What the first row does, for Enter. */
  private first: (() => void) | null = null;

  constructor(app: App, host: WorldHost, scenePath: string) {
    super(app);
    this.host = host;
    this.scenePath = scenePath;
  }

  override onOpen(): void {
    const { contentEl } = this;
    this.closed = false;
    contentEl.empty();
    this.titleEl.setText(pickerTitle(this.host.sceneTitle(this.scenePath), this.host.isChapter(this.scenePath)));
    this.titleEl.setAttr('dir', 'auto');
    this.modalEl.addClass('spellbook-world-picker');

    const input = contentEl.createEl('input', {
      cls: 'spellbook-world-picker-input',
      attr: {
        type: 'text',
        // A name may be in any language; let it pick its own direction.
        dir: 'auto',
        placeholder: PICKER_PLACEHOLDER,
        'aria-label': PICKER_PLACEHOLDER,
        enterkeyhint: 'done',
      },
    });
    input.addEventListener('input', () => {
      this.say(null);
      this.draw();
    });
    input.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' || isInputMethodKey(event)) return;
      event.preventDefault();
      this.first?.();
    });
    this.input = input;
    this.message = contentEl.createDiv({ cls: 'spellbook-world-picker-message', attr: { role: 'alert', dir: 'auto' } });
    this.list = contentEl.createDiv({ cls: 'spellbook-world-picker-list', attr: { role: 'list' } });
    this.stop = this.host.onChange(() => {
      if (!this.closed && !this.busy) this.draw();
    });
    this.draw();
    input.focus();
  }

  override onClose(): void {
    this.closed = true;
    this.stop?.();
    this.stop = null;
    this.input = null;
    this.list = null;
    this.message = null;
    this.first = null;
    this.contentEl.empty();
  }

  /** Show a message under the box, or take it away (null). */
  private say(message: string | null): void {
    this.message?.setText(message ?? '');
  }

  private draw(): void {
    const list = this.list;
    const input = this.input;
    if (!list || !input || this.closed) return;
    list.empty();
    this.first = null;
    const query = input.value;
    const listed = new Set(
      this.host.links
        .linksOf(this.scenePath)
        .map((link) => link.entity?.path)
        .filter((path): path is string => path !== undefined),
    );
    const all = this.host.entities;
    const open = all.filter((entity) => !listed.has(entity.path));
    const found = open.filter((entity) => matchesSearch(entity, query));

    for (const entity of found.slice(0, PICKER_LIMIT)) this.drawEntity(list, entity);
    if (found.length > PICKER_LIMIT) {
      list.createDiv({ cls: 'spellbook-world-picker-note', text: `${found.length - PICKER_LIMIT} more: type to narrow the list down.` });
    }

    const name = query.trim();
    const taken = name !== '' && all.some((entity) => clashKey(entity.name) === clashKey(name));
    if (name !== '' && !taken) {
      for (const type of this.host.types) this.drawCreate(list, type, name);
    }
    if (found.length === 0 && (name === '' || taken)) {
      let text = PICKER_NONE_FOUND_TEXT;
      if (all.length === 0) text = PICKER_EMPTY_TEXT;
      else if (open.length === 0) text = PICKER_ALL_LISTED_TEXT;
      list.createDiv({ cls: 'spellbook-world-picker-note', text });
    }
  }

  private row(list: HTMLElement, cls: string, action: () => void): HTMLElement {
    const row = list.createEl('button', { cls: `spellbook-world-picker-row ${cls}`, attr: { type: 'button', role: 'listitem' } });
    const run = (): void => {
      safely('Add to the scene', action);
    };
    row.addEventListener('click', run);
    this.first ??= run;
    return row;
  }

  private drawEntity(list: HTMLElement, entity: Entity): void {
    const type = this.host.typeOf(entity);
    const row = this.row(list, 'spellbook-world-picker-entity', () => {
      void this.take(async () => this.host.link(this.scenePath, entity.path));
    });
    typeBadge(row, type);
    const words = row.createSpan({ cls: 'spellbook-world-picker-words' });
    words.createSpan({ cls: 'spellbook-world-picker-name', text: entity.name, attr: { dir: 'auto' } });
    if (entity.summary !== '') {
      words.createSpan({ cls: 'spellbook-world-picker-summary', text: entity.summary, attr: { dir: 'auto' } });
    }
    if (type) row.createSpan({ cls: 'spellbook-world-picker-type', text: type.name, attr: { dir: 'auto' } });
  }

  private drawCreate(list: HTMLElement, type: EntityType, name: string): void {
    const row = this.row(list, 'spellbook-world-picker-create', () => {
      void this.take(async () => {
        const made = await this.host.createEntity(type.id, name);
        if ('problem' in made) return made.problem;
        return this.host.link(this.scenePath, made.path);
      });
    });
    typeBadge(row, type);
    const words = row.createSpan({ cls: 'spellbook-world-picker-words' });
    // "New character:" is the app's own; the name after it is the writer's.
    words.createSpan({ cls: 'spellbook-world-picker-new', text: `New ${type.builtIn ? type.name.toLowerCase() : type.name}:` });
    words.createSpan({ cls: 'spellbook-world-picker-name', text: name, attr: { dir: 'auto' } });
  }

  /** Do what a row asks, once at a time. The window closes when it is done, and says why when it is not. */
  private async take(action: () => Promise<string | null>): Promise<void> {
    if (this.busy || this.closed) return;
    this.busy = true;
    let problem: string | null;
    try {
      problem = await action();
    } catch (error) {
      console.error('Spellbook: the scene could not be changed', error);
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
    this.say(problem);
    this.draw();
    this.input?.focus();
  }
}

/** Open the window that adds an entity to a scene. */
export function openEntityPicker(app: App, host: WorldHost, scenePath: string): void {
  const project = host.project;
  if (!project || project.readOnly) {
    new Notice(project ? READ_ONLY_TEXT : NO_PROJECT_TEXT, PROBLEM_NOTICE_MS);
    return;
  }
  new EntityPickerModal(app, host, scenePath).open();
}
