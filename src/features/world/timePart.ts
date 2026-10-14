// The parts of the entity sheet that are about time.
//
//   Life     for a character (any type that has an age): "Born", "Died" and
//            "Age" together near the top of the sheet. The age is worked out
//            from the dates: "Died at 63", or the age at the story's present
//   Time     when the entity begins and when it ends, under the words of its
//            type ("Founded" and "Abandoned" for a place), unless they are
//            in "Life" above, and its moments: more points in its life, each
//            a date and a short label
//   History  everything dated that concerns it, as one list in order of
//            time: its own dates and moments, the timeline events that list
//            it and the dated scenes it is in. Whatever has no date is
//            listed after, never left out. A tap on a line opens the note it
//            comes from.
//
// Every date is given in a small window (timeModal.ts) with the fields the
// timeline's event window uses, and each change saves one property of the
// note: "date", "end" or "moments". Nothing depends on hovering or dragging.
//
// Labels and titles are the writer's own text, in any language, and so are
// the names of an invented calendar's months: each takes the direction of
// its own text.

import { Keymap } from 'obsidian';
import type { App } from 'obsidian';
import { formatStoryDate, formatStoryDateRange, storyDateToText } from '../../core/timeline';
import type { StoryDate } from '../../core/timeline';
import { DATE_KEY, END_KEY, datedMoments, dateWords } from '../../core/world';
import type { Entity, HistoryKind, HistoryLine, Moment, StoryPresent } from '../../core/world';
import { safely } from '../../ui/safely';
import type { WorldHost } from './host';
import { WORLD_ICONS, iconButton, settle, textButton } from './parts';
import { TimeModal } from './timeModal';

export const TIME_HEADING = 'Time';
export const MOMENTS_HEADING = 'Moments';
export const HISTORY_HEADING = 'History';
export const UNDATED_HEADING = 'Undated';
export const ADD_MOMENT_TEXT = 'Add moment';
export const SET_DATE_TEXT = 'Set';
export const CHANGE_DATE_TEXT = 'Change';
export const NO_DATE_TEXT = 'Not set';
export const UNREAD_DATE_TEXT = 'cannot be read as a date';
export const NO_MOMENTS_TEXT = 'No moments yet. Use "Add moment" for a point in its life: a date and a few words.';
export const NO_HISTORY_TEXT = 'Nothing yet. Give it a date above, or list it in a scene or a timeline event.';
export const CHANGE_MOMENT_LABEL = 'Change the moment';
export const REMOVE_MOMENT_LABEL = 'Remove the moment';
export const AGE_TEXT = 'Age';
export const STORY_PRESENT_TEXT = "Story's present";
export const STORY_PRESENT_HINT = 'Ages are worked out at this date. Leave it empty to use the latest date in the story.';
export const LATEST_DATE_TEXT = 'latest date in the story';
export const NO_PRESENT_TEXT = "No date in the story yet: give a scene a date, or set the story's present";
export const NOT_BORN_YET_TEXT = 'Not born yet';
/** What a moment that is only a date says in the history. */
export const UNNAMED_MOMENT_TEXT = 'Moment';

/** What a line of the history is, said after it: nothing for the entity's own dates and moments. */
const KIND_WORDS: Readonly<Record<HistoryKind, string>> = { from: '', until: '', moment: '', event: 'event', scene: 'scene' };

function sectionHead(parent: HTMLElement, heading: string, count: number | null, level = 3): HTMLElement {
  const head = parent.createDiv({ cls: 'spellbook-world-time-head', attr: { role: 'heading', 'aria-level': level } });
  head.createSpan({ text: heading });
  if (count !== null) head.createSpan({ cls: 'spellbook-world-time-count', text: String(count), attr: { dir: 'ltr' } });
  return head;
}

/** A date as the sheet shows it. In an invented calendar the names in it are the writer's own text. */
function dateSpan(parent: HTMLElement, cls: string, date: StoryDate, end: StoryDate | null = null): HTMLElement {
  const span = parent.createSpan({ cls, text: formatStoryDateRange(date, end) });
  span.setAttr('dir', date.calendar === undefined ? 'ltr' : 'auto');
  return span;
}

/**
 * One of the two dates of an entity, as a line: its word ("Born"), the date
 * (or "Not set", or what cannot be read), and a button that changes it in a
 * window of its own. Nothing is drawn for a date that is not set where
 * nothing can be changed.
 */
function drawDateRow(
  app: App,
  host: WorldHost,
  part: HTMLElement,
  entity: Entity,
  canChange: boolean,
  key: typeof DATE_KEY | typeof END_KEY,
  word: string,
  date: StoryDate | null,
  unread: string,
): void {
  if (!canChange && date === null && unread === '') return;
  const calendar = host.calendar;
  const row = part.createDiv({ cls: 'spellbook-world-time-line spellbook-world-time-row', attr: { 'data-date': key } });
  // The word may be the writer's own: a type's words can be changed.
  row.createSpan({ cls: 'spellbook-world-time-word', text: word, attr: { dir: 'auto' } });
  if (date !== null) dateSpan(row, 'spellbook-world-time-value', date);
  else if (unread !== '') {
    const value = row.createSpan({ cls: 'spellbook-world-time-value spellbook-world-time-unread' });
    value.createSpan({ text: unread, attr: { dir: 'auto' } });
    value.createSpan({ cls: 'spellbook-world-time-problem', text: `(${UNREAD_DATE_TEXT})` });
  } else row.createSpan({ cls: 'spellbook-world-time-value spellbook-world-time-none', text: NO_DATE_TEXT });
  if (!canChange) return;
  const has = date !== null || unread !== '';
  const button = textButton(row, 'spellbook-world-time-set', has ? CHANGE_DATE_TEXT : SET_DATE_TEXT, () => {
    new TimeModal(app, {
      heading: word,
      note: entity.name,
      dateLabel: word,
      date: date !== null ? storyDateToText(date) : unread,
      label: null,
      dateNeeded: false,
      calendar,
      confirm: 'Save',
      // An empty field takes the date away.
      submit: (answer) => host.setDate(entity.path, key, answer.date),
      ...(has ? { remove: () => host.setDate(entity.path, key, null) } : {}),
    }).open();
  });
  button.setAttr('aria-label', `${has ? CHANGE_DATE_TEXT : SET_DATE_TEXT}: ${word}`);
}

/** Open the window that names the story's present, or takes it away so that the latest date in the story is used. */
export function openStoryPresent(app: App, host: WorldHost): void {
  const present = host.storyPresent;
  const set = present?.source === 'set';
  new TimeModal(app, {
    heading: STORY_PRESENT_TEXT,
    note: STORY_PRESENT_HINT,
    dateLabel: STORY_PRESENT_TEXT,
    date: set && present !== null ? storyDateToText(present.date) : '',
    label: null,
    dateNeeded: false,
    calendar: host.calendar,
    confirm: 'Save',
    submit: (answer) => host.setStoryPresent(answer.date),
    ...(set ? { remove: () => host.setStoryPresent(null) } : {}),
  }).open();
}

/** The story's present in words: "14 Oct 1923 (latest date in the story)". */
export function storyPresentText(present: StoryPresent): string {
  return present.source === 'latest' ? `${formatStoryDate(present.date)} (${LATEST_DATE_TEXT})` : formatStoryDate(present.date);
}

/**
 * The life of an entity whose type has an age (a character), near the top
 * of its sheet: "Born", "Died" and "Age" together. The age is worked out
 * from the dates: its age at death, or at the story's present.
 */
export function drawLifePart(app: App, host: WorldHost, part: HTMLElement, entity: Entity, canChange: boolean): void {
  part.empty();
  const age = host.ageOf(entity);
  if (age === null) return;
  const time = host.timeOf(entity);
  const words = dateWords(host.typeOf(entity));
  drawDateRow(app, host, part, entity, canChange, DATE_KEY, words.from, time.start, time.unreadStart);
  drawDateRow(app, host, part, entity, canChange, END_KEY, words.until, time.end, time.unreadEnd);
  if (age.kind === 'unknown' && !canChange) return;

  const row = part.createDiv({ cls: 'spellbook-world-time-line spellbook-world-age-row' });
  row.createSpan({ cls: 'spellbook-world-time-word', text: AGE_TEXT });
  const value = row.createSpan({ cls: 'spellbook-world-age-value' });
  const present = (): void => {
    if (canChange) textButton(row, 'spellbook-world-age-present', STORY_PRESENT_TEXT, () => openStoryPresent(app, host));
  };
  switch (age.kind) {
    case 'unknown':
      value.addClass('spellbook-world-time-none');
      value.setText(`Set "${words.from}" to work it out`);
      return;
    case 'problem':
      value.addClass('spellbook-world-time-problem');
      value.setText(`Cannot be worked out: "${words.until}" is not later than "${words.from}"`);
      return;
    case 'died':
      value.createSpan({ cls: 'spellbook-world-age-years', text: `Died at ${age.years}` });
      return;
    case 'no-present':
      value.addClass('spellbook-world-time-none');
      value.setText(NO_PRESENT_TEXT);
      present();
      return;
    case 'unborn':
      value.createSpan({ cls: 'spellbook-world-age-years', text: NOT_BORN_YET_TEXT });
      value.createSpan({ cls: 'spellbook-world-age-when', text: `at ${storyPresentText(age.present)}`, attr: { dir: 'auto' } });
      present();
      return;
    case 'alive':
      value.createSpan({ cls: 'spellbook-world-age-years', text: String(age.years), attr: { dir: 'ltr' } });
      value.createSpan({ cls: 'spellbook-world-age-when', text: `at ${storyPresentText(age.present)}`, attr: { dir: 'auto' } });
      present();
      return;
  }
}

/**
 * The "Time" part: the two dates and the moments, each changed in a window
 * of its own. For an entity whose type has an age, the two dates are near
 * the top of the sheet instead (drawLifePart), and this part has only the
 * moments.
 */
export function drawTimePart(app: App, host: WorldHost, rest: HTMLElement, entity: Entity, canChange: boolean): void {
  const time = host.timeOf(entity);
  const words = dateWords(host.typeOf(entity));
  const calendar = host.calendar;
  const datesAbove = host.ageOf(entity) !== null;
  const any = time.moments.length > 0 || (!datesAbove && (time.start !== null || time.end !== null || time.unreadStart !== '' || time.unreadEnd !== ''));
  // A project that cannot be changed shows what there is, and no empty part.
  if (!canChange && !any) return;

  sectionHead(rest, TIME_HEADING, null);
  const part = rest.createDiv({ cls: 'spellbook-world-time' });
  if (!datesAbove) {
    drawDateRow(app, host, part, entity, canChange, DATE_KEY, words.from, time.start, time.unreadStart);
    drawDateRow(app, host, part, entity, canChange, END_KEY, words.until, time.end, time.unreadEnd);
  }

  // The moments: those with a date in order of time, then those whose date cannot be read.
  const moments: Moment[] = [...datedMoments(time), ...time.moments.filter((moment) => moment.date === null)];
  if (!canChange && moments.length === 0) return;
  const head = sectionHead(part, MOMENTS_HEADING, moments.length, 4);
  head.addClass('spellbook-world-time-moments-head');
  if (canChange) {
    textButton(head, 'spellbook-world-time-add', ADD_MOMENT_TEXT, () => {
      new TimeModal(app, {
        heading: 'New moment',
        note: entity.name,
        dateLabel: 'Date',
        date: '',
        label: '',
        dateNeeded: true,
        calendar,
        confirm: 'Add',
        submit: (answer) => (answer.date === null ? null : host.addMoment(entity.path, answer.date, answer.label)),
      }).open();
    });
  }
  if (moments.length === 0) {
    part.createDiv({ cls: 'spellbook-world-message spellbook-world-hint', text: NO_MOMENTS_TEXT });
    return;
  }
  const rows = part.createDiv({ cls: 'spellbook-world-time-rows spellbook-world-time-moments', attr: { role: 'list' } });
  for (const moment of moments) {
    const row = rows.createDiv({ cls: 'spellbook-world-time-line spellbook-world-time-moment', attr: { role: 'listitem' } });
    const said = row.createDiv({ cls: 'spellbook-world-time-said' });
    if (moment.date !== null) dateSpan(said, 'spellbook-world-time-when', moment.date);
    else said.createSpan({ cls: 'spellbook-world-time-when spellbook-world-time-problem', text: UNREAD_DATE_TEXT });
    if (moment.label !== '') said.createSpan({ cls: 'spellbook-world-time-what', text: moment.label, attr: { dir: 'auto' } });
    if (!canChange) continue;
    iconButton(row, 'spellbook-world-time-edit', CHANGE_MOMENT_LABEL, WORLD_ICONS.label, () => {
      new TimeModal(app, {
        heading: 'Moment',
        note: entity.name,
        dateLabel: 'Date',
        date: moment.date === null ? '' : storyDateToText(moment.date),
        // A moment that could not be read keeps its text as its label, so that nothing typed is lost.
        label: moment.label,
        dateNeeded: true,
        calendar,
        confirm: 'Save',
        submit: (answer) => (answer.date === null ? null : host.changeMoment(entity.path, moment, { date: answer.date, label: answer.label })),
        remove: () => host.changeMoment(entity.path, moment, null),
      }).open();
    });
    iconButton(row, 'spellbook-world-time-remove', REMOVE_MOMENT_LABEL, WORLD_ICONS.unlink, () => settle(host.changeMoment(entity.path, moment, null)));
  }
}

/** The "History" part: everything that concerns the entity, in order of time; a tap on a line opens its note. */
export function drawHistoryPart(host: WorldHost, rest: HTMLElement, entity: Entity, canChange: boolean): void {
  const history = host.historyOf(entity);
  const count = history.dated.length + history.undated.length;
  if (count === 0 && !canChange) return;
  sectionHead(rest, HISTORY_HEADING, history.dated.length);
  if (count === 0) {
    rest.createDiv({ cls: 'spellbook-world-message spellbook-world-hint', text: NO_HISTORY_TEXT });
    return;
  }
  const line = (rows: HTMLElement, entry: HistoryLine): void => {
    const row = rows.createDiv({ cls: `spellbook-world-time-line spellbook-world-history-line spellbook-world-history-${entry.kind}`, attr: { role: 'listitem' } });
    const open = row.createEl('button', { cls: 'spellbook-world-history-open', attr: { type: 'button' } });
    if (entry.date !== null) dateSpan(open, 'spellbook-world-history-when', entry.date, entry.end);
    // "Born", a moment's label, a title: any of them may be the writer's own text.
    open.createSpan({ cls: 'spellbook-world-history-what', text: entry.label === '' ? UNNAMED_MOMENT_TEXT : entry.label, attr: { dir: 'auto' } });
    const kind = KIND_WORDS[entry.kind];
    if (kind !== '') open.createSpan({ cls: 'spellbook-world-history-kind', text: kind });
    open.addEventListener('click', (event) => {
      safely('Open note', () => host.open(entry.path, Keymap.isModEvent(event)));
    });
  };
  if (history.dated.length > 0) {
    const rows = rest.createDiv({ cls: 'spellbook-world-time-rows spellbook-world-history', attr: { role: 'list' } });
    for (const entry of history.dated) line(rows, entry);
  }
  if (history.undated.length === 0) return;
  sectionHead(rest, UNDATED_HEADING, history.undated.length, 4).addClass('spellbook-world-history-undated-head');
  const rows = rest.createDiv({ cls: 'spellbook-world-time-rows spellbook-world-history spellbook-world-history-undated', attr: { role: 'list' } });
  for (const entry of history.undated) line(rows, entry);
}
