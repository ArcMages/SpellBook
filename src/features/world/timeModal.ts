// The small window for one date of an entity: when it begins, when it ends,
// or one moment of its life (a date and a short label).
//
// The date is given in the very fields the timeline's event window uses
// (src/ui/dateFields.ts): typed as 1923, 1923-04 or 1923-04-12 in the
// real-world calendar, picked by era, year, month and day in a project with
// an invented one. What they say is read by the timeline engine's own rule,
// so a date given here is a date the timeline can show.
//
// A window with its own fields is used, as everywhere in the plugin, because
// that is what works dependably with the keyboards of phones and tablets.
// Enter confirms, Escape cancels, and both can be done with the buttons. The
// window only asks: what is done with the answer is the business of whoever
// opened it, and so is saying why an answer will not do.

import { Modal, Setting } from 'obsidian';
import type { App, ButtonComponent } from 'obsidian';
import type { StoryCalendar, StoryDate } from '../../core/timeline';
import { MOMENT_LABEL_MAX } from '../../core/world';
import { drawDateEntry, readDateEntry } from '../../ui/dateFields';
import type { DateFields } from '../../ui/dateFields';
import { isInputMethodKey } from '../../ui/keys';

export const MOMENT_LABEL_TEXT = 'What happens';
export const MOMENT_LABEL_PLACEHOLDER = 'For example: comes to Saltwick';
export const DATE_NEEDED_TEXT = 'Give a date.';
export const REMOVE_DATE_TEXT = 'Remove';

/** What the writer filled in. */
export interface TimeAnswer {
  /** The date; null when the field was left empty (only where that is allowed). */
  readonly date: StoryDate | null;
  /** The label, on one line; "" when the window has no label field. */
  readonly label: string;
}

export interface TimeForm {
  /** The window's title: "Born", "New moment". */
  readonly heading: string;
  /** A line under the heading: the entity's name. The writer's own text. */
  readonly note?: string;
  /** What the date field is called: "Born", "Date". */
  readonly dateLabel: string;
  /** The date the field starts with, as a note holds it; "" for none. */
  readonly date: string;
  /** What the label field starts with; null for a window without one (the two dates of an entity). */
  readonly label: string | null;
  /** False lets the date be left empty: that takes the date away. */
  readonly dateNeeded: boolean;
  /** The project's invented calendar, or null for the real-world one. */
  readonly calendar: StoryCalendar | null;
  /** The text of the button that confirms. */
  readonly confirm: string;
  /**
   * Called when the writer confirms and the date could be read. Resolves
   * with null when all went well (the window closes), or with why not.
   */
  readonly submit: (answer: TimeAnswer) => Promise<string | null> | string | null;
  /** When given, the window has a "Remove" button that calls this; it answers like `submit`. */
  readonly remove?: () => Promise<string | null> | string | null;
}

export class TimeModal extends Modal {
  private readonly form: TimeForm;
  private dateFields: DateFields | null = null;
  private labelInput: HTMLInputElement | null = null;
  private message: HTMLElement | null = null;
  private buttons: ButtonComponent[] = [];
  private busy = false;
  private closed = false;

  constructor(app: App, form: TimeForm) {
    super(app);
    this.form = form;
  }

  override onOpen(): void {
    const { contentEl, form } = this;
    this.closed = false;
    contentEl.empty();
    this.titleEl.setText(form.heading);
    this.modalEl.addClass('spellbook-prompt', 'spellbook-timeline-event-window', 'spellbook-world-time-window');
    if (form.note !== undefined) {
      contentEl.createEl('p', { cls: 'spellbook-timeline-window-note', text: form.note, attr: { dir: 'auto' } });
    }
    const quiet = (): void => {
      this.say(null);
    };
    this.dateFields = drawDateEntry(contentEl, form.calendar, form.dateLabel, 'spellbook-world-time-date', form.date, quiet);
    if (form.label !== null) {
      const field = contentEl.createDiv({ cls: 'spellbook-prompt-field' });
      field.createDiv({ cls: 'spellbook-timeline-field-label', text: MOMENT_LABEL_TEXT });
      // What happens is the writer's own text: it picks its own direction.
      const input = field.createEl('input', {
        cls: ['spellbook-prompt-input', 'spellbook-world-time-label'],
        attr: {
          type: 'text',
          dir: 'auto',
          'aria-label': MOMENT_LABEL_TEXT,
          placeholder: MOMENT_LABEL_PLACEHOLDER,
          maxlength: String(MOMENT_LABEL_MAX),
          enterkeyhint: 'done',
        },
      });
      input.value = form.label;
      input.addEventListener('input', quiet);
      this.labelInput = input;
    }
    this.message = contentEl.createDiv({ cls: 'spellbook-prompt-message', attr: { role: 'alert', dir: 'auto' } });

    contentEl.addEventListener('keydown', (event) => {
      if (isInputMethodKey(event) || this.closed) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        this.close();
      } else if (event.key === 'Enter') {
        event.preventDefault();
        void this.confirm();
      }
    });

    const row = new Setting(contentEl);
    const remove = form.remove;
    if (remove !== undefined) {
      row.addButton((button) => {
        this.buttons.push(button);
        button
          .setButtonText(REMOVE_DATE_TEXT)
          .setWarning()
          .onClick(() => {
            void this.run(remove);
          });
      });
    }
    row
      .addButton((button) => {
        button.setButtonText('Cancel').onClick(() => {
          this.close();
        });
      })
      .addButton((button) => {
        this.buttons.push(button);
        button
          .setButtonText(form.confirm)
          .setCta()
          .onClick(() => {
            void this.confirm();
          });
      });
    this.dateFields.focus();
  }

  override onClose(): void {
    this.closed = true;
    this.dateFields = null;
    this.labelInput = null;
    this.message = null;
    this.buttons = [];
    this.contentEl.empty();
  }

  private say(message: string | null): void {
    this.message?.setText(message ?? '');
  }

  private async confirm(): Promise<void> {
    const fields = this.dateFields;
    if (fields === null) return;
    const read = readDateEntry(fields.text(), this.form.calendar);
    if (!read.ok) {
      this.say(read.message);
      return;
    }
    if (read.date === null && this.form.dateNeeded) {
      this.say(DATE_NEEDED_TEXT);
      return;
    }
    const answer: TimeAnswer = { date: read.date, label: this.labelInput?.value ?? '' };
    await this.run(() => this.form.submit(answer));
  }

  /** Do what a button asks; the window closes when it went well, and says why when it did not. */
  private async run(work: () => Promise<string | null> | string | null): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    for (const button of this.buttons) button.setDisabled(true);
    let problem: string | null;
    try {
      problem = await work();
    } catch (error) {
      console.error('Spellbook: a date could not be saved', error);
      problem = error instanceof Error ? error.message : String(error);
    } finally {
      this.busy = false;
      for (const button of this.buttons) button.setDisabled(false);
    }
    // The writer may have closed the window while the work was going on.
    if (this.closed) return;
    if (problem === null) this.close();
    else this.say(problem);
  }
}
