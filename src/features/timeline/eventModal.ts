// The small window for an event's title and dates: a new event, or new dates
// for an existing one.
//
// A window with its own fields is used, as everywhere in the plugin, because
// that is what works dependably with the keyboards of phones and tablets.
// Enter confirms, Escape cancels, and both can be done with the two buttons.
//
// Dates are typed the way they are stored: 1923, 1923-04 or 1923-04-12. The
// timeline engine reads them; this window only says what it could not read.

import { Modal, Setting } from 'obsidian';
import type { App, ButtonComponent } from 'obsidian';
import { readStoryDate, storyDateToDayNumber } from '../../core/timeline';
import type { StoryDate } from '../../core/timeline';
import { isInputMethodKey } from '../../ui/keys';

export const DATE_PLACEHOLDER = '1923, 1923-04 or 1923-04-12';
export const DATE_HELP = 'Write the date as a year, a year and month, or a full date: 1923, 1923-04 or 1923-04-12.';

/** What the writer filled in. */
export interface EventAnswer {
  /** The title, with the spaces at its ends taken off; "" when the window has no title field. */
  readonly title: string;
  readonly start: StoryDate | null;
  readonly end: StoryDate | null;
}

export interface EventForm {
  /** The window's title, for example "New event". */
  readonly heading: string;
  /** The text of the button that confirms, for example "Create". */
  readonly confirm: string;
  /** What the title field starts with; null for a window without a title field. */
  readonly title: string | null;
  /** What the date and end fields start with. */
  readonly date: string;
  readonly end: string;
  /** False lets the date be left empty (an undated event). */
  readonly dateNeeded: boolean;
  /** A line under the heading, such as the lane the event will be in. The writer's own text may be in it. */
  readonly note?: string;
  /**
   * Called when the writer confirms and the dates could be read. Resolves
   * with null when all went well (the window closes), or with a message
   * saying why not (shown in the window, which stays open).
   */
  readonly submit: (answer: EventAnswer) => Promise<string | null> | string | null;
}

/** Read the fields. Gives the answer, or the message that says what will not do. */
export function readEventForm(form: EventForm, title: string, date: string, end: string): EventAnswer | string {
  const name = title.trim();
  if (form.title !== null && name === '') return 'Give the event a title.';
  let start: StoryDate | null = null;
  if (date.trim() !== '') {
    start = readStoryDate(date.trim());
    if (start === null) return DATE_HELP;
  } else if (form.dateNeeded) {
    return `Give the event a date. ${DATE_HELP}`;
  }
  let until: StoryDate | null = null;
  if (end.trim() !== '') {
    until = readStoryDate(end.trim());
    if (until === null) return `The end date could not be read. ${DATE_HELP}`;
    if (start === null) return 'An end date needs a date to start from.';
    if (storyDateToDayNumber(until) <= storyDateToDayNumber(start)) return 'The end date must be later than the date.';
  }
  return { title: name, start, end: until };
}

export class EventModal extends Modal {
  private readonly form: EventForm;
  private titleInput: HTMLInputElement | null = null;
  private dateInput: HTMLInputElement | null = null;
  private endInput: HTMLInputElement | null = null;
  private message: HTMLElement | null = null;
  private confirmButton: ButtonComponent | null = null;
  private busy = false;
  private closed = false;

  constructor(app: App, form: EventForm) {
    super(app);
    this.form = form;
  }

  override onOpen(): void {
    const { contentEl, form } = this;
    this.closed = false;
    contentEl.empty();
    this.titleEl.setText(form.heading);
    this.modalEl.addClass('spellbook-prompt', 'spellbook-timeline-event-window');
    if (form.note !== undefined) {
      contentEl.createEl('p', { cls: 'spellbook-timeline-window-note', text: form.note, attr: { dir: 'auto' } });
    }

    if (form.title !== null) {
      // The title may be in any language; it picks its own direction.
      this.titleInput = this.field('Title', 'spellbook-timeline-title-input', form.title, { dir: 'auto', enterkeyhint: 'next' });
    }
    // Dates are digits and dashes: they read the same way in every language.
    const dateInput = this.field('Date', 'spellbook-timeline-date-input', form.date, {
      placeholder: DATE_PLACEHOLDER,
      enterkeyhint: 'done',
    });
    this.dateInput = dateInput;
    this.endInput = this.field('End date (optional)', 'spellbook-timeline-end-input', form.end, {
      placeholder: DATE_PLACEHOLDER,
      enterkeyhint: 'done',
    });
    this.message = contentEl.createDiv({ cls: 'spellbook-prompt-message', attr: { role: 'alert', dir: 'auto' } });

    contentEl.addEventListener('keydown', (event) => {
      if (isInputMethodKey(event) || this.closed) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        this.close();
      } else if (event.key === 'Enter') {
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

    const first = this.titleInput ?? dateInput;
    first.focus();
    first.select();
  }

  override onClose(): void {
    this.closed = true;
    this.titleInput = null;
    this.dateInput = null;
    this.endInput = null;
    this.message = null;
    this.confirmButton = null;
    this.contentEl.empty();
  }

  private field(label: string, cls: string, value: string, attr: Record<string, string>): HTMLInputElement {
    const field = this.contentEl.createDiv({ cls: 'spellbook-prompt-field' });
    field.createDiv({ cls: 'spellbook-timeline-field-label', text: label });
    const input = field.createEl('input', {
      cls: ['spellbook-prompt-input', cls],
      attr: { type: 'text', 'aria-label': label, ...attr },
    });
    input.value = value;
    input.addEventListener('input', () => {
      this.say(null); // the writer is putting it right: the old complaint no longer applies
    });
    return input;
  }

  private say(message: string | null): void {
    this.message?.setText(message ?? '');
  }

  private async submit(): Promise<void> {
    if (this.busy || !this.dateInput || !this.endInput) return;
    const answer = readEventForm(this.form, this.titleInput?.value ?? '', this.dateInput.value, this.endInput.value);
    if (typeof answer === 'string') {
      this.say(answer);
      return;
    }
    this.busy = true;
    this.confirmButton?.setDisabled(true);
    let problem: string | null;
    try {
      problem = await this.form.submit(answer);
    } catch (error) {
      console.error('Spellbook: the event could not be saved', error);
      problem = error instanceof Error ? error.message : String(error);
    } finally {
      this.busy = false;
      this.confirmButton?.setDisabled(false);
    }
    // The writer may have closed the window while the work was going on.
    if (this.closed) return;
    if (problem === null) this.close();
    else this.say(problem);
  }
}
