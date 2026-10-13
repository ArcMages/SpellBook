// The window that picks entities: a list of the notes in the project's World
// folder, with a field to search it. Used twice: to say which entities an
// event involves, and to narrow the timeline to the events of some of them.
//
// Each entity is a row that is tapped to tick it and tapped again to untick
// it, so it works the same with a finger as with a mouse. Nothing is written
// here: the window hands the ticked entities to whoever opened it.

import { Modal, Setting } from 'obsidian';
import type { App, ButtonComponent } from 'obsidian';
import { clashKey } from '../../core/paths';
import type { EventEntity } from '../../core/timeline';
import { isInputMethodKey } from '../../ui/keys';

export const NO_ENTITIES_MESSAGE = 'There are no notes in the World folder of this project yet.';
export const NO_MATCH_MESSAGE = 'No entity has that in its name.';
export const NO_NOTE_LABEL = 'no note';

/** The list shows this many rows at most; the rest are found by searching. */
export const PICKER_ROWS = 200;

export interface EntityPickerForm {
  /** The window's title, for example "Entities". */
  readonly heading: string;
  /** The text of the button that confirms, for example "Save". */
  readonly confirm: string;
  /** A line under the heading, such as the event's title. The writer's own text may be in it. */
  readonly note?: string;
  /** Every entity there is to choose from. */
  readonly all: readonly EventEntity[];
  /** The keys of the entities that start out ticked. */
  readonly chosen: readonly string[];
  /**
   * Called with the keys of the ticked entities when the writer confirms.
   * Resolves with null when all went well (the window closes), or with a
   * message saying why not (shown in the window, which stays open).
   */
  readonly submit: (keys: string[]) => Promise<string | null> | string | null;
}

/** The entities whose name has the search text in it, whatever its capitals; all of them for an empty search. */
export function searchEntities(all: readonly EventEntity[], query: string): EventEntity[] {
  const wanted = clashKey(query.trim());
  return wanted === '' ? [...all] : all.filter((entity) => clashKey(entity.name).includes(wanted));
}

export class EntityPickerModal extends Modal {
  private readonly form: EntityPickerForm;
  private readonly chosen: Set<string>;
  private search: HTMLInputElement | null = null;
  private list: HTMLElement | null = null;
  private message: HTMLElement | null = null;
  private confirmButton: ButtonComponent | null = null;
  private busy = false;
  private closed = false;

  constructor(app: App, form: EntityPickerForm) {
    super(app);
    this.form = form;
    this.chosen = new Set(form.chosen);
  }

  override onOpen(): void {
    const { contentEl, form } = this;
    this.closed = false;
    contentEl.empty();
    this.titleEl.setText(form.heading);
    this.modalEl.addClass('spellbook-prompt', 'spellbook-timeline-entity-window');
    if (form.note !== undefined) {
      contentEl.createEl('p', { cls: 'spellbook-timeline-window-note', text: form.note, attr: { dir: 'auto' } });
    }
    const field = contentEl.createDiv({ cls: 'spellbook-prompt-field' });
    const search = field.createEl('input', {
      cls: ['spellbook-prompt-input', 'spellbook-timeline-entity-search'],
      attr: { type: 'text', placeholder: 'Search', 'aria-label': 'Search entities', dir: 'auto', enterkeyhint: 'search' },
    });
    search.addEventListener('input', () => {
      this.draw();
    });
    this.search = search;
    this.list = contentEl.createDiv({ cls: 'spellbook-timeline-entity-list', attr: { role: 'group', 'aria-label': form.heading } });
    this.message = contentEl.createDiv({ cls: 'spellbook-prompt-message', attr: { role: 'alert', dir: 'auto' } });

    contentEl.addEventListener('keydown', (event) => {
      if (isInputMethodKey(event) || this.closed) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        this.close();
      } else if (event.key === 'Enter' && event.target === this.search) {
        event.preventDefault();
        void this.submit();
      }
    });

    new Setting(contentEl)
      .addButton((button) => {
        button.setButtonText('Cancel').onClick(() => {
          this.close();
        });
      })
      .addButton((button) => {
        this.confirmButton = button;
        button
          .setButtonText(form.confirm)
          .setCta()
          .onClick(() => {
            void this.submit();
          });
      });
    this.draw();
    if (form.all.length > 0) search.focus();
  }

  override onClose(): void {
    this.closed = true;
    this.search = null;
    this.list = null;
    this.message = null;
    this.confirmButton = null;
    this.contentEl.empty();
  }

  private draw(): void {
    const list = this.list;
    if (!list) return;
    list.empty();
    const all = this.form.all;
    if (all.length === 0) {
      list.createDiv({ cls: 'spellbook-timeline-entity-none', text: NO_ENTITIES_MESSAGE });
      return;
    }
    const found = searchEntities(all, this.search?.value ?? '');
    if (found.length === 0) {
      list.createDiv({ cls: 'spellbook-timeline-entity-none', text: NO_MATCH_MESSAGE });
      return;
    }
    // The list keeps its order while it is tapped: a row never moves from under the finger.
    const ordered = found;
    for (const entity of ordered.slice(0, PICKER_ROWS)) {
      const row = list.createEl('button', { cls: 'spellbook-timeline-entity-row', attr: { type: 'button' } });
      const tick = row.createSpan({ cls: 'spellbook-timeline-entity-tick' });
      // The name is the writer's own text: it takes the direction of what it says.
      row.createSpan({ cls: 'spellbook-timeline-entity-name', text: entity.name, attr: { dir: 'auto' } });
      if (entity.path === null) row.createSpan({ cls: 'spellbook-timeline-entity-missing', text: NO_NOTE_LABEL });
      const show = (): void => {
        const ticked = this.chosen.has(entity.key);
        row.toggleClass('is-active', ticked);
        row.setAttr('aria-pressed', ticked ? 'true' : 'false');
        tick.setText(ticked ? '\u2713' : '');
      };
      show();
      row.addEventListener('click', () => {
        if (this.chosen.has(entity.key)) this.chosen.delete(entity.key);
        else this.chosen.add(entity.key);
        this.message?.setText('');
        show();
      });
    }
    if (ordered.length > PICKER_ROWS) {
      list.createDiv({ cls: 'spellbook-timeline-entity-none', text: `and ${ordered.length - PICKER_ROWS} more: search to find them` });
    }
  }

  private async submit(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.confirmButton?.setDisabled(true);
    let problem: string | null;
    try {
      // In the order of the list, so that what is written does not depend on the order of the taps.
      const keys = this.form.all.filter((entity) => this.chosen.has(entity.key)).map((entity) => entity.key);
      problem = await this.form.submit(keys);
    } catch (error) {
      console.error('Spellbook: the entities could not be saved', error);
      problem = error instanceof Error ? error.message : String(error);
    } finally {
      this.busy = false;
      this.confirmButton?.setDisabled(false);
    }
    if (this.closed) return;
    if (problem === null) this.close();
    else this.message?.setText(problem);
  }
}
