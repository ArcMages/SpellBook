// The "Calendar" window: the calendar the project's story dates are counted
// in. The real-world one, or one the writer invents: its months, the days of
// its week, its eras and its leap years.
//
// The window starts from what the project has, or from one of a few
// ready-made calendars, and shows all the while how a date will read and
// how it will be written in a note. Before anything is saved it lists the
// dates already in the project that the calendar being made cannot read.
// Those are never changed: the events simply show as undated until the
// writer gives them a date again. Saving such a calendar takes a second
// press, so that it is always a choice.
//
// Only the project index is written (through the host). No note is touched.

import { Modal, Setting } from 'obsidian';
import type { App, ButtonComponent } from 'obsidian';
import {
  CALENDAR_PRESETS,
  MAX_ERAS,
  MAX_MONTHS,
  MAX_WEEKDAYS,
  calendarToIndexValue,
  checkCalendar,
  datesOutsideCalendar,
  readCalendar,
  storyDate,
  storyDateToText,
} from '../../core/timeline';
import type { MisfitDate, StoryCalendar, TimelineNote } from '../../core/timeline';
import { showIcon } from '../../ui/icons';
import { safely } from '../../ui/safely';
import { describePickedDate } from '../../ui/dateFields';

export const CALENDAR_WINDOW_TITLE = 'Story calendar';
export const REAL_WORLD_NOTE = 'Story dates follow the real-world calendar, written as 1923, 1923-04 or 1923-04-12.';
export const USE_CALENDAR_LABEL = 'Use this calendar';
export const USE_ANYWAY_LABEL = 'Use it anyway';
/** The id of the starting point that stands for the calendar the project already has. */
export const OWN_PRESET = 'own';
/** The list of dates that do not fit shows this many at most; the rest are counted. */
export const MISFITS_SHOWN = 40;

/** A calendar while it is being edited: every figure as the text in its field. */
export interface CalendarDraft {
  /** True for the real-world calendar: nothing below is then used. */
  real: boolean;
  name: string;
  months: Array<{ name: string; days: string }>;
  weekdays: string[];
  eras: Array<{ name: string; short: string; start: string }>;
  hasBefore: boolean;
  beforeName: string;
  beforeShort: string;
  yearZero: boolean;
  hasLeap: boolean;
  leapMonth: number;
  leapDays: string;
  leapEvery: string;
}

/** The draft to start editing from: a calendar's own figures, or the real-world calendar for null. */
export function calendarDraft(calendar: StoryCalendar | null): CalendarDraft {
  const from = calendar ?? (CALENDAR_PRESETS[1]?.calendar as StoryCalendar);
  return {
    real: calendar === null,
    name: from.name,
    months: from.months.map((month) => ({ name: month.name, days: String(month.days) })),
    weekdays: [...from.weekdays],
    eras: from.eras.map((era) => ({ name: era.name, short: era.short, start: String(era.start) })),
    hasBefore: from.before !== null,
    beforeName: from.before?.name ?? 'Before',
    beforeShort: from.before?.short ?? 'B',
    yearZero: from.yearZero,
    hasLeap: from.leap !== null,
    leapMonth: from.leap?.month ?? 1,
    leapDays: String(from.leap?.days ?? 1),
    leapEvery: String(from.leap?.every ?? 4),
  };
}

const whole = (text: string): number => (/^-?\d+$/.test(text.trim()) ? Number(text.trim()) : Number.NaN);

/**
 * The calendar a draft describes, as it stands: not yet checked (see
 * `checkCalendar`). The first era begins where the count begins, whatever
 * its field says.
 */
export function draftCalendar(draft: CalendarDraft): StoryCalendar {
  return {
    name: draft.name.trim(),
    months: draft.months.map((month) => ({ name: month.name.trim(), days: whole(month.days) })),
    weekdays: draft.weekdays.map((day) => day.trim()),
    eras: draft.eras.map((era, index) => ({
      name: era.name.trim(),
      short: era.short.trim(),
      start: index === 0 ? (draft.yearZero ? 0 : 1) : whole(era.start),
    })),
    before: draft.hasBefore ? { name: draft.beforeName.trim(), short: draft.beforeShort.trim() } : null,
    yearZero: draft.yearZero,
    leap: draft.hasLeap ? { month: draft.leapMonth, days: whole(draft.leapDays), every: whole(draft.leapEvery) } : null,
  };
}

/** How a date of a calendar reads and how it is written, for the window's preview line. */
export function calendarPreview(calendar: StoryCalendar): string {
  const last = calendar.eras[calendar.eras.length - 1];
  const year = (last?.start ?? 1) + 2;
  const day = Math.min(17, calendar.months[0]?.days ?? 1);
  const date = storyDate(year, 1, day, calendar);
  if (date === null) return '';
  return `A date reads: ${describePickedDate(calendar, date)}. In a note it is written: ${storyDateToText(date)}`;
}

export interface CalendarForm {
  /** The value stored under the "calendar" key of the project index now. */
  readonly stored: unknown;
  /** The event notes and the scenes, to list the dates a new calendar could not read. */
  readonly notes: readonly TimelineNote[];
  /** Store the calendar (as plain data), or null for the real-world one. Rejects when it could not be saved. */
  readonly save: (value: Readonly<Record<string, unknown>> | null) => Promise<void>;
}

export class CalendarModal extends Modal {
  private readonly form: CalendarForm;
  private draft: CalendarDraft;
  /** Which starting point is marked: one of the ready-made ones, or the project's own calendar. */
  private preset: string;
  private readonly storedText: string;
  private body: HTMLElement | null = null;
  private preview: HTMLElement | null = null;
  private misfits: HTMLElement | null = null;
  private message: HTMLElement | null = null;
  private confirmButton: ButtonComponent | null = null;
  /** True once the writer was shown the dates that do not fit and told that a second press saves. */
  private warned = false;
  private busy = false;
  private closed = false;

  constructor(app: App, form: CalendarForm) {
    super(app);
    this.form = form;
    const own = readCalendar(form.stored).calendar;
    this.draft = calendarDraft(own);
    this.preset = own === null ? 'real' : OWN_PRESET;
    this.storedText = own === null ? 'null' : JSON.stringify(calendarToIndexValue(own));
  }

  override onOpen(): void {
    const { contentEl } = this;
    this.closed = false;
    contentEl.empty();
    this.titleEl.setText(CALENDAR_WINDOW_TITLE);
    this.modalEl.addClass('spellbook-prompt', 'spellbook-timeline-calendar-window');
    this.body = contentEl.createDiv({ cls: 'spellbook-timeline-calendar-body' });
    this.preview = contentEl.createDiv({ cls: 'spellbook-timeline-calendar-preview', attr: { dir: 'auto', 'aria-live': 'polite' } });
    this.misfits = contentEl.createDiv({ cls: 'spellbook-timeline-calendar-misfits' });
    this.message = contentEl.createDiv({ cls: 'spellbook-prompt-message', attr: { role: 'alert', dir: 'auto' } });
    new Setting(contentEl)
      .addButton((button) => {
        button.setButtonText('Cancel').onClick(() => {
          this.close();
        });
      })
      .addButton((button) => {
        this.confirmButton = button;
        button
          .setButtonText(USE_CALENDAR_LABEL)
          .setCta()
          .onClick(() => {
            void this.submit();
          });
      });
    this.draw();
  }

  override onClose(): void {
    this.closed = true;
    this.body = null;
    this.preview = null;
    this.misfits = null;
    this.message = null;
    this.confirmButton = null;
    this.contentEl.empty();
  }

  // ------------------------------------------------------------------ drawing

  /** Draw every field again: after a starting point was chosen, or a row was added, moved or removed. */
  private draw(): void {
    const body = this.body;
    if (!body) return;
    body.empty();
    const draft = this.draft;

    const starts = body.createDiv({ cls: 'spellbook-timeline-calendar-presets', attr: { role: 'group', 'aria-label': 'Start from' } });
    starts.createDiv({ cls: 'spellbook-timeline-field-label', text: 'Start from' });
    const row = starts.createDiv({ cls: 'spellbook-timeline-calendar-preset-row' });
    for (const preset of CALENDAR_PRESETS) {
      const button = row.createEl('button', {
        cls: 'spellbook-timeline-calendar-preset',
        text: preset.label,
        attr: { type: 'button', 'aria-pressed': this.preset === preset.id ? 'true' : 'false' },
      });
      button.toggleClass('is-active', this.preset === preset.id);
      button.addEventListener('click', () => {
        this.preset = preset.id;
        this.draft = calendarDraft(preset.calendar);
        this.draw();
      });
    }

    if (draft.real) {
      body.createEl('p', { cls: 'spellbook-timeline-calendar-note', text: REAL_WORLD_NOTE });
      this.changed();
      return;
    }

    this.textField(body, 'Name', 'spellbook-timeline-calendar-name', draft.name, (value) => {
      draft.name = value;
    });

    this.section(body, 'Months', 'Each with its name and its number of days.', 'spellbook-timeline-calendar-months', (list) => {
      draft.months.forEach((month, index) => {
        const line = this.line(list);
        this.input(line, `Month ${index + 1}: name`, 'spellbook-timeline-calendar-month-name', month.name, true, (value) => {
          month.name = value;
        });
        this.input(line, `Month ${index + 1}: days`, 'spellbook-timeline-calendar-days', month.days, false, (value) => {
          month.days = value;
        });
        this.rowButtons(line, draft.months, index, `month ${index + 1}`, draft.months.length > 1, () => {
          // The leap month is a place in the list: it stays within the list.
          draft.leapMonth = Math.min(draft.leapMonth, draft.months.length);
        });
      });
    }, draft.months.length < MAX_MONTHS ? 'Add month' : null, () => {
      draft.months.push({ name: `Month ${draft.months.length + 1}`, days: '30' });
    });

    this.section(body, 'Days of the week', 'Optional. Leave the list empty for a calendar without weeks.', 'spellbook-timeline-calendar-week', (list) => {
      draft.weekdays.forEach((day, index) => {
        const line = this.line(list);
        this.input(line, `Day ${index + 1} of the week`, 'spellbook-timeline-calendar-weekday', day, true, (value) => {
          draft.weekdays[index] = value;
        });
        this.rowButtons(line, draft.weekdays, index, `day ${index + 1}`, true, () => undefined);
      });
    }, draft.weekdays.length < MAX_WEEKDAYS ? 'Add day' : null, () => {
      draft.weekdays.push(`Day ${draft.weekdays.length + 1}`);
    });

    const first = draft.yearZero ? '0' : '1';
    this.section(
      body,
      'Eras',
      `Each with its name, the short form written after a date, and the year it begins in, counted from the start of the first era (year ${first}). Its own years are then counted afresh.`,
      'spellbook-timeline-calendar-eras',
      (list) => {
        draft.eras.forEach((era, index) => {
          const line = this.line(list);
          this.input(line, `Era ${index + 1}: name`, 'spellbook-timeline-calendar-era-name', era.name, true, (value) => {
            era.name = value;
          });
          this.input(line, `Era ${index + 1}: short form`, 'spellbook-timeline-calendar-era-short', era.short, true, (value) => {
            era.short = value;
          });
          const start = this.input(
            line,
            `Era ${index + 1}: begins in year`,
            'spellbook-timeline-calendar-era-start',
            index === 0 ? first : era.start,
            false,
            (value) => {
              era.start = value;
            },
          );
          start.disabled = index === 0;
          this.rowButtons(line, draft.eras, index, `era ${index + 1}`, draft.eras.length > 1, () => undefined, false);
        });
      },
      draft.eras.length < MAX_ERAS ? 'Add era' : null,
      () => {
        const last = draft.eras[draft.eras.length - 1];
        const begins = (Number(last?.start) || (draft.yearZero ? 0 : 1)) + 1000;
        draft.eras.push({ name: `Era ${draft.eras.length + 1}`, short: `E${draft.eras.length + 1}`, start: String(begins) });
      },
    );

    this.toggle(body, 'An era before the first', 'Its years count backwards from the year before the first era.', draft.hasBefore, (value) => {
      draft.hasBefore = value;
    });
    if (draft.hasBefore) {
      const line = this.line(body);
      this.input(line, 'Era before the first: name', 'spellbook-timeline-calendar-before-name', draft.beforeName, true, (value) => {
        draft.beforeName = value;
      });
      this.input(line, 'Era before the first: short form', 'spellbook-timeline-calendar-before-short', draft.beforeShort, true, (value) => {
        draft.beforeShort = value;
      });
    }

    this.toggle(body, 'Year zero', 'Eras count their years from 0 instead of from 1.', draft.yearZero, (value) => {
      draft.yearZero = value;
    });

    this.toggle(body, 'Leap years', 'One month gains days every so many years.', draft.hasLeap, (value) => {
      draft.hasLeap = value;
    });
    if (draft.hasLeap) {
      const line = this.line(body);
      const month = line.createEl('select', {
        cls: ['dropdown', 'spellbook-timeline-calendar-leap-month'],
        attr: { 'aria-label': 'Leap years: the month that gains days' },
      });
      draft.months.forEach((entry, index) => {
        const value = String(index + 1);
        month.createEl('option', { text: entry.name, value, attr: { value, dir: 'auto' } });
      });
      month.value = String(draft.leapMonth);
      month.addEventListener('change', () => {
        draft.leapMonth = Number(month.value) || 1;
        this.changed();
      });
      this.input(line, 'Leap years: days gained', 'spellbook-timeline-calendar-leap-days', draft.leapDays, false, (value) => {
        draft.leapDays = value;
      });
      this.input(line, 'Leap years: every how many years', 'spellbook-timeline-calendar-leap-every', draft.leapEvery, false, (value) => {
        draft.leapEvery = value;
      });
    }
    this.changed();
  }

  private textField(parent: HTMLElement, label: string, cls: string, value: string, set: (value: string) => void): void {
    const field = parent.createDiv({ cls: 'spellbook-prompt-field' });
    field.createDiv({ cls: 'spellbook-timeline-field-label', text: label });
    this.input(field, label, cls, value, true, set);
  }

  /** A field of a row. `ownText` is true for a name: the writer's own text, in any language. */
  private input(
    parent: HTMLElement,
    label: string,
    cls: string,
    value: string,
    ownText: boolean,
    set: (value: string) => void,
  ): HTMLInputElement {
    const attr: Record<string, string> = { type: 'text', 'aria-label': label, title: label };
    if (ownText) attr['dir'] = 'auto';
    else attr['inputmode'] = 'numeric';
    const input = parent.createEl('input', { cls: ['spellbook-prompt-input', cls], attr });
    input.value = value;
    input.addEventListener('input', () => {
      set(input.value);
      this.custom();
      this.changed();
    });
    return input;
  }

  private line(parent: HTMLElement): HTMLElement {
    return parent.createDiv({ cls: 'spellbook-timeline-calendar-line' });
  }

  /** A heading, a hint, a list of rows, and the button that adds a row. */
  private section(
    parent: HTMLElement,
    heading: string,
    hint: string,
    cls: string,
    rows: (list: HTMLElement) => void,
    addLabel: string | null,
    add: () => void,
  ): void {
    const section = parent.createDiv({ cls: ['spellbook-timeline-calendar-section', cls], attr: { role: 'group', 'aria-label': heading } });
    section.createDiv({ cls: 'spellbook-timeline-field-label', text: heading });
    section.createDiv({ cls: 'spellbook-timeline-calendar-hint', text: hint });
    rows(section.createDiv({ cls: 'spellbook-timeline-calendar-list' }));
    if (addLabel === null) return;
    const button = section.createEl('button', { cls: 'spellbook-timeline-calendar-add', text: addLabel, attr: { type: 'button' } });
    button.addEventListener('click', () => {
      safely(addLabel, () => {
        add();
        this.custom();
        this.draw();
      });
    });
  }

  /** The buttons at the end of a row: move it up, move it down, remove it. */
  private rowButtons<T>(
    line: HTMLElement,
    list: T[],
    index: number,
    what: string,
    removable: boolean,
    after: () => void,
    movable = true,
  ): void {
    const act = (label: string, icon: string, enabled: boolean, action: () => void): void => {
      const button = line.createEl('button', {
        cls: ['clickable-icon', 'spellbook-timeline-calendar-row-button'],
        attr: { type: 'button', 'aria-label': `${label} ${what}` },
      });
      showIcon(button, icon);
      button.disabled = !enabled;
      button.addEventListener('click', () => {
        if (button.disabled) return;
        safely(label, () => {
          action();
          after();
          this.custom();
          this.draw();
        });
      });
    };
    const swap = (other: number): void => {
      const here = list[index] as T;
      list[index] = list[other] as T;
      list[other] = here;
    };
    if (movable) {
      act('Move up', 'arrow-up', index > 0, () => {
        swap(index - 1);
      });
      act('Move down', 'arrow-down', index < list.length - 1, () => {
        swap(index + 1);
      });
    }
    act('Remove', 'x', removable, () => {
      list.splice(index, 1);
    });
  }

  private toggle(parent: HTMLElement, name: string, description: string, value: boolean, set: (value: boolean) => void): void {
    new Setting(parent)
      .setName(name)
      .setDesc(description)
      .addToggle((toggle) => {
        toggle.setValue(value).onChange((next) => {
          set(next);
          this.custom();
          this.draw();
        });
      });
  }

  /** The writer changed something: the calendar is no longer one of the ready-made ones as they come. */
  private custom(): void {
    if (this.preset !== OWN_PRESET && this.preset !== 'real') this.preset = OWN_PRESET;
  }

  // --------------------------------------------------------------- what it is

  /** The calendar the window describes: null for the real-world one, or a message saying what is wrong with it. */
  private current(): StoryCalendar | null | string {
    if (this.draft.real) return null;
    const calendar = draftCalendar(this.draft);
    return checkCalendar(calendar) ?? calendar;
  }

  private misfitDates(calendar: StoryCalendar | null): MisfitDate[] {
    return datesOutsideCalendar(this.form.notes, calendar);
  }

  /** A field changed: the preview and the list of dates that do not fit are worked out again. */
  private changed(): void {
    this.warned = false;
    this.confirmButton?.setButtonText(USE_CALENDAR_LABEL);
    this.message?.setText('');
    const calendar = this.current();
    this.preview?.setText(typeof calendar === 'string' ? calendar : calendar === null ? '' : calendarPreview(calendar));
    const misfits = this.misfits;
    if (!misfits) return;
    misfits.empty();
    if (typeof calendar === 'string') return;
    const found = this.misfitDates(calendar);
    if (found.length === 0) return;
    misfits.createDiv({
      cls: 'spellbook-timeline-calendar-misfit-heading',
      text:
        `${found.length === 1 ? '1 date in this project does' : `${found.length} dates in this project do`} not fit this calendar. ` +
        'Nothing in the notes will be changed: these events will show as undated until you set their dates again.',
    });
    const list = misfits.createDiv({ cls: 'spellbook-timeline-calendar-misfit-list' });
    for (const misfit of found.slice(0, MISFITS_SHOWN)) {
      const row = list.createDiv({ cls: 'spellbook-timeline-calendar-misfit' });
      row.createSpan({ cls: 'spellbook-timeline-calendar-misfit-title', text: misfit.title, attr: { dir: 'auto' } });
      row.createSpan({ cls: 'spellbook-timeline-calendar-misfit-value', text: `${misfit.property}: ${misfit.value}`, attr: { dir: 'auto' } });
    }
    if (found.length > MISFITS_SHOWN) {
      list.createDiv({ cls: 'spellbook-timeline-calendar-misfit', text: `and ${found.length - MISFITS_SHOWN} more` });
    }
  }

  private async submit(): Promise<void> {
    if (this.busy) return;
    const calendar = this.current();
    if (typeof calendar === 'string') {
      this.message?.setText(calendar);
      return;
    }
    const value = calendar === null ? null : calendarToIndexValue(calendar);
    // Nothing was changed: there is nothing to save, and nothing to warn about.
    if (JSON.stringify(value) === this.storedText) {
      this.close();
      return;
    }
    const found = this.misfitDates(calendar).length;
    if (found > 0 && !this.warned) {
      this.warned = true;
      this.confirmButton?.setButtonText(USE_ANYWAY_LABEL);
      this.message?.setText(
        `${found === 1 ? '1 date does' : `${found} dates do`} not fit this calendar (listed above). ` +
          `Press "${USE_ANYWAY_LABEL}" to switch all the same; the notes are left as they are.`,
      );
      return;
    }
    this.busy = true;
    this.confirmButton?.setDisabled(true);
    let problem: string | null = null;
    try {
      await this.form.save(value);
    } catch (error) {
      console.error('Spellbook: the calendar could not be saved', error);
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
