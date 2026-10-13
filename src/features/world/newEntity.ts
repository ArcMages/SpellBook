// Making a new entity: which type (when the command does not say), then its
// name. The note is made in the folder of its type, from the type's template,
// and opened, so that the writer can fill it in.

import { Modal, Notice } from 'obsidian';
import type { App } from 'obsidian';
import { findType } from '../../core/world';
import type { EntityType } from '../../core/world';
import { safely } from '../../ui/safely';
import { TextPromptModal } from '../../ui/textPromptModal';
import type { WorldHost } from './host';
import { NO_PROJECT_TEXT, PROBLEM_NOTICE_MS, READ_ONLY_TEXT, typeBadge } from './parts';

export const CHOOSE_TYPE_TITLE = 'New entity';
export const CHOOSE_TYPE_TEXT = 'What is it?';

/** "New character": what the window that asks for the name is called. */
export function newEntityTitle(type: EntityType): string {
  return type.builtIn ? `New ${type.name.toLowerCase()}` : `New: ${type.name}`;
}

/** A small window with one button per type. */
export class TypeChoiceModal extends Modal {
  private readonly types: readonly EntityType[];
  private readonly choose: (type: EntityType) => void;

  constructor(app: App, types: readonly EntityType[], choose: (type: EntityType) => void) {
    super(app);
    this.types = types;
    this.choose = choose;
  }

  override onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    this.titleEl.setText(CHOOSE_TYPE_TITLE);
    this.modalEl.addClass('spellbook-world-choice');
    contentEl.createEl('p', { cls: 'spellbook-world-choice-text', text: CHOOSE_TYPE_TEXT });
    const list = contentEl.createDiv({ cls: 'spellbook-world-choice-list' });
    let first: HTMLElement | null = null;
    for (const type of this.types) {
      const button = list.createEl('button', { cls: 'spellbook-world-choice-type', attr: { type: 'button' } });
      typeBadge(button, type);
      // The name of a type of the writer's own is the writer's text.
      button.createSpan({ cls: 'spellbook-world-choice-name', text: type.name, attr: { dir: 'auto' } });
      button.addEventListener('click', () => {
        // The next window opens in the same turn as the tap, so that a phone gives it the keyboard.
        this.close();
        safely(CHOOSE_TYPE_TITLE, () => {
          this.choose(type);
        });
      });
      first ??= button;
    }
    first?.focus();
  }

  override onClose(): void {
    this.contentEl.empty();
  }
}

/** Ask for the name of a new entity of a type, make it, and show its note. */
function askName(app: App, host: WorldHost, type: EntityType): void {
  new TextPromptModal(app, {
    title: newEntityTitle(type),
    label: 'Name',
    placeholder: 'Name',
    confirm: 'Create',
    submit: async (value) => {
      const made = await host.createEntity(type.id, value);
      if ('problem' in made) return made.problem;
      void host.open(made.path, false);
      return null;
    },
  }).open();
}

/**
 * Start making a new entity.
 *
 * @param typeId the type's id, or null to ask which type first
 */
export function askNewEntity(app: App, host: WorldHost, typeId: string | null): void {
  const project = host.project;
  if (!project || project.readOnly) {
    new Notice(project ? READ_ONLY_TEXT : NO_PROJECT_TEXT, PROBLEM_NOTICE_MS);
    return;
  }
  if (typeId === null) {
    new TypeChoiceModal(app, host.types, (type) => {
      askName(app, host, type);
    }).open();
    return;
  }
  const type = findType(host.types, typeId);
  if (type) askName(app, host, type);
}
