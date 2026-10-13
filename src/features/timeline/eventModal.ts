// The small window for an event's title and dates: a new event, or new dates
// for an existing one.
//
// A window with its own fields is used, as everywhere in the plugin, because
// that is what works dependably with the keyboards of phones and tablets.
// Enter confirms, Escape cancels, and both can be done with the two buttons.
//
// Dates are typed the way they are stored: 1923, 1923-04 or 1923-04-12. The
// timeline engine reads them; this window only says what it could not read.
// In a project with an invented calendar nothing is typed: the era, the
// year, the month and the day are picked (dateFields.ts), and what was
// picked is checked against the calendar by the same engine.
//
// The window can also list the entities the event involves (notes of the
// project's World folder), as chips that are taken off with a tap and added
// through a list that can be searched (entityPicker.ts).

import { Modal, Setting } from 'obsidian';
import type { App, ButtonComponent } from 'obsidian';
import { readStoryDate, storyDateToDayNumber } from '../../core/timeline';
import type { EventEntity, StoryCalendar, StoryDate } from '../../core/timeline';
import { showIcon } from '../../ui/icons';
import { isInputMethodKey } from '../../ui/keys';
import { drawDateFields } from './dateFields';
import type { DateFields } from './dateFields';
import { EntityPickerModal } from './entityPicker';

export const DATE_PLACEHOLDER = '1923, 1923-04 or 1923-04-12';
export const DATE_HELP = 'Write the date as a year, a year and month, or a full date: 1923, 1923-04 or 1923-04-12.';
export const PICKED_DATE_HELP =
  'Choose an era and give a year of that era; the month and the day may be left out. The day must be one the month has.';
export const ENTITIES_LABEL = 'Entities';
export const CHOOSE_ENTITIES_LABEL = 'Choose entities';
export const NO_ENTITIES_CHOSEN = 'None';

/** What the writer filled in. */
export interface EventAnswer {
  /** The title, with the spaces at its ends taken off; "" when the window has no title field. */
  readonly title: string;
  readonly start: StoryDate | null;
  readonly end: StoryDate | null;
  /** The keys of the entities the event should name; null when the window has no entities to choose. */
  readonly entities: readonly string[] | null;
}

/** The entities of an event, for the window to show and change. */
export interface EventFormEntities {
  /** Every entity there is to choose from. */
  readonly all: readonly EventEntity[];
  /** The ones the event names now. */
  readonly chosen: readonly EventEntity[];
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
   * The project's invented calendar, when it has one: the dates are then
   * picked instead of typed, and `date` and `end` are read in that calendar.
   */
  readonly calendar?: StoryCalendar | null;
  /** The event's entities; leave out for a window without them. */
  readonly entities?: EventFormEntities;
  /**
   * Called when the writer confirms and the dates could be read. Resolves
   * with null when all went well (the window closes), or with a message
   * saying why not (shown in the window, which stays open).
   */
  readonly submit: (answer: EventAnswer) => Promise<string | null> | string | null;
}

/**
 * Read the fields. Gives the answer, or the message that says what will not do.
 *
 * @param entities the keys of the entities chosen; leave out for a window without them
 */
export function readEventForm(
  form: EventForm,
  title: string,
  date: string,
  end: string,
  entities: readonly string[] | null = null,
): EventAnswer | string {
  const name = title.trim();
  if (form.title !== null && name === '') return 'Give the event a title.';
  const calendar = form.calendar ?? null;
  const help = calendar === null ? DATE_HELP : PICKED_DATE_HELP;
  let start: StoryDate | null = null;
  if (date.trim() !== '') {
    start = readStoryDate(date.trim(), calendar);
    if (start === null) return calendar === null ? help : `That date does not exist in the calendar. ${help}`;
  } else if (form.dateNeeded) {
    return `Give the event a date. ${help}`;
  }
  let until: StoryDate | null = null;
  if (end.trim() !== '') {
    until = readStoryDate(end.trim(), calendar);
    if (until === null) {
      return calendar === null ? `The end date could not be read. ${help}` : `That end date does not exist in the calendar. ${help}`;
    }
    if (start === null) return 'An end date needs a date to start from.';
    if (storyDateToDayNumber(until) <= storyDateToDayNumber(start)) return 'The end date must be later than the date.';
  }
  return { title: name, start, end: until, entities };
}

export class EventModal extends Modal {
  private readonly form: EventForm;
  private titleInput: HTMLInputElement | null = null;
  private dateInput: HTMLInputElement | null = null;
  private endInput: HTMLInputElement | null = null;
  /** The pickers that stand in for the two date fields when the project has an invented calendar. */
  private datePicker: DateFields | null = null;
  private endPicker: DateFields | null = null;
  private chosen: EventEntity[] = [];
  private chips: HTMLElement | null = null;
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
    const calendar = form.calendar ?? null;
    let firstDate: { focus(): void; select?(): void };
    if (calendar === null) {
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
      firstDate = dateInput;
    } else {
      const quiet = (): void => {
        this.say(null);
      };
      // A date that this calendar cannot read starts out empty: the writer picks it anew.
      this.datePicker = drawDateFields(contentEl, calendar, 'Date', 'spellbook-timeline-date-picker', readStoryDate(form.date, calendar), quiet);
      this.endPicker = drawDateFields(
        contentEl,
        calendar,
        'End date (optional)',
        'spellbook-timeline-end-picker',
        readStoryDate(form.end, calendar),
        quiet,
      );
      firstDate = this.datePicker;
    }
    if (form.entities !== undefined) this.entityField(form.entities);
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

    if (this.titleInput) {
      this.titleInput.focus();
      this.titleInput.select();
    } else {
      firstDate.focus();
      firstDate.select?.();
    }
  }

  override onClose(): void {
    this.closed = true;
    this.titleInput = null;
    this.dateInput = null;
    this.endInput = null;
    this.datePicker = null;
    this.endPicker = null;
    this.chips = null;
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

  /** The row that lists the event's entities, each with a button that takes it off, and the button that opens the list. */
  private entityField(entities: EventFormEntities): void {
    this.chosen = [...entities.chosen];
    const field = this.contentEl.createDiv({ cls: ['spellbook-prompt-field', 'spellbook-timeline-entity-field'] });
    field.createDiv({ cls: 'spellbook-timeline-field-label', text: ENTITIES_LABEL });
    this.chips = field.createDiv({ cls: 'spellbook-timeline-entity-chips', attr: { role: 'group', 'aria-label': ENTITIES_LABEL } });
    const choose = field.createEl('button', { cls: 'spellbook-timeline-entity-choose', text: CHOOSE_ENTITIES_LABEL, attr: { type: 'button' } });
    choose.addEventListener('click', () => {
      // An entity the event names that has no note can still be kept, or taken off.
      const all = [...entities.all, ...this.chosen.filter((entity) => !entities.all.some((other) => other.key === entity.key))];
      new EntityPickerModal(this.app, {
        heading: ENTITIES_LABEL,
        confirm: 'Done',
        all,
        chosen: this.chosen.map((entity) => entity.key),
        submit: (keys) => {
          this.chosen = all.filter((entity) => keys.includes(entity.key));
          this.drawChips();
          return null;
        },
      }).open();
    });
    this.drawChips();
  }

  private drawChips(): void {
    const chips = this.chips;
    if (!chips) return;
    chips.empty();
    if (this.chosen.length === 0) {
      chips.createSpan({ cls: 'spellbook-timeline-entity-none', text: NO_ENTITIES_CHOSEN });
      return;
    }
    for (const entity of this.chosen) {
      const chip = chips.createSpan({ cls: 'spellbook-timeline-entity-chip' });
      chip.toggleClass('spellbook-is-missing', entity.path === null);
      // The name is the writer's own text: it takes the direction of what it says.
      chip.createSpan({ cls: 'spellbook-timeline-entity-chip-name', text: entity.name, attr: { dir: 'auto' } });
      const remove = chip.createEl('button', {
        cls: ['clickable-icon', 'spellbook-timeline-entity-remove'],
        attr: { type: 'button', 'aria-label': `Remove ${entity.name}` },
      });
      showIcon(remove, 'x');
      remove.addEventListener('click', () => {
        this.chosen = this.chosen.filter((other) => other.key !== entity.key);
        this.drawChips();
      });
    }
  }

  private say(message: string | null): void {
    this.message?.setText(message ?? '');
  }

  private async submit(): Promise<void> {
    if (this.busy) return;
    const date = this.datePicker?.text() ?? this.dateInput?.value;
    const end = this.endPicker?.text() ?? this.endInput?.value;
    if (date === undefined || end === undefined) return;
    const entities = this.form.entities === undefined ? null : this.chosen.map((entity) => entity.key);
    const answer = readEventForm(this.form, this.titleInput?.value ?? '', date, end, entities);
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
