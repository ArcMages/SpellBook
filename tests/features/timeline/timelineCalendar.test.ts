// The timeline in a project with an invented calendar: the axis, the range,
// the cards, the windows that pick a date, and the "Calendar" window that
// defines the calendar. Driven through the stand-in host and stand-in
// elements; how it looks can only be checked in Obsidian.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CALENDAR_PRESETS, calendarToIndexValue, readCalendar } from '../../../src/core/timeline';
import type { StoryCalendar } from '../../../src/core/timeline';
import {
  CALENDAR_WINDOW_TITLE,
  REAL_WORLD_NOTE,
  USE_ANYWAY_LABEL,
  USE_CALENDAR_LABEL,
  calendarDraft,
  calendarPreview,
  draftCalendar,
} from '../../../src/features/timeline/calendarModal';
import { NOT_A_DATE, datePartsOf, datePartsText } from '../../../src/features/timeline/dateFields';
import { readEventForm } from '../../../src/features/timeline/eventModal';
import type { EventForm } from '../../../src/features/timeline/eventModal';
import type { TimelineData } from '../../../src/features/timeline/timelineHost';
import { resetPlatform } from '../../obsidianStub';
import type { FakeElement, Setting as StubSetting } from '../../obsidianStub';
import { EVENTS, FakeHost, SCENES, note, sample } from './fakeHost';
import {
  PHONE,
  WIDE,
  at,
  button,
  cardOf,
  click,
  clearScreen,
  drag,
  grip,
  lastMenu,
  one,
  open,
  openWindows,
  rangeOf,
  settle,
  tapAt,
  titles,
  windowParts,
} from './screen';
import type { Stage } from './screen';

const MONTHS = ['Thaw', 'Seedfall', 'Greening', 'Highsun', 'Goldwane', 'Harvest', 'Mistfall', 'Frost', 'Deepnight', 'Turning'];

/** Ten months of 36 days, a week of six, two eras and one before them, and a leap rule. */
const EMBER = {
  name: 'Ember reckoning',
  months: MONTHS.map((name) => ({ name, days: 36 })),
  weekdays: ['Sunrest', 'Moonrise', 'Tidesday', 'Windsday', 'Fireday', 'Stoneday'],
  eras: [
    { name: 'Age of Embers', short: 'AE', start: 1 },
    { name: 'Age of Tides', short: 'AT', start: 1204 },
  ],
  before: { name: 'Before the Embers', short: 'BE' },
  yearZero: false,
  leap: { month: 10, days: 5, every: 4 },
};

const HEBREW = {
  name: 'לוח הממלכה',
  months: [
    { name: 'ניסן', days: 30 },
    { name: 'אייר', days: 29 },
    { name: 'סיוון', days: 30 },
  ],
  eras: [{ name: 'עידן המלכים', short: 'ע״מ', start: 1 }],
  yearZero: false,
};

const FOUNDING = `${EVENTS}The founding of Saltwick.md`;
const OLD = `${EVENTS}Old.md`;

/** A small novel in the year 1203 of the Age of Embers, with one event still dated in the real world. */
function ember(overrides: Partial<TimelineData> = {}): TimelineData {
  return sample({
    calendar: EMBER,
    events: [
      note(FOUNDING, { date: '1203-01-01 AE', timelines: ['Main plot'] }),
      note(`${EVENTS}Siege.md`, { date: '1203-03-01 AE', end: '1203-05-01 AE', timelines: ['Main plot'] }),
      note(`${EVENTS}חג האביב הגדול.md`, { date: '1203-04 AE', timelines: ['רקע'] }),
      note(OLD, { date: '1923-04-12', end: '1923-05-01', timelines: ['Main plot'] }),
    ],
    scenes: [note(`${SCENES}Opening.md`, { date: '1203-02-10 AE' }), note(`${SCENES}Ending.md`, { date: '1203-06-20 AE' })],
    sceneOrder: [`${SCENES}Opening.md`, `${SCENES}Ending.md`],
    ...overrides,
  });
}

const ticks = (s: Stage): FakeElement[] => s.pane.withClass('spellbook-timeline-tick');
const dateOf = (card: FakeElement): string => card.withClass('spellbook-timeline-card-date')[0]?.text ?? '';

/** Choose an option of a select the way a writer does. */
function choose(select: FakeElement, value: string): void {
  select.value = value;
  select.dispatch('change', {});
}

/** The values and texts of a select's options. */
const options = (select: FakeElement): string[] => select.children.map((option) => `${option.value}:${option.text}`);

/** The four fields of one picked date in the window that is open. */
function picker(cls: string): { era: FakeElement; year: FakeElement; month: FakeElement; day: FakeElement; reading: () => string; set: (year: string) => void } {
  const group = one(windowParts().modal.contentEl, cls);
  const year = one(group, 'spellbook-timeline-year-input');
  return {
    era: one(group, 'spellbook-timeline-era-select'),
    year,
    month: one(group, 'spellbook-timeline-month-select'),
    day: one(group, 'spellbook-timeline-day-select'),
    reading: () => one(group, 'spellbook-timeline-date-reading').text,
    set: (text) => {
      year.value = text;
      year.dispatch('input', {});
    },
  };
}

beforeEach(() => {
  clearScreen();
});

afterEach(() => {
  resetPlatform();
});

describe('the timeline in an invented calendar', () => {
  it('places events by the calendar\'s own day count, in date order', async () => {
    const s = await open(new FakeHost(ember()));
    expect(titles(s).sort()).toEqual(['Ending', 'Opening', 'Siege', 'The founding of Saltwick', 'חג האביב הגדול']);
    const x = (title: string): number => Number.parseFloat(cardOf(s, title).style['insetInlineStart'] ?? 'NaN');
    // 1 Thaw, 10 Seedfall, 1 Greening, Highsun, 20 Harvest: 0, 45, 72, 108 and 199 days into the year.
    const day = (x('Ending') - x('The founding of Saltwick')) / 199;
    expect(day).toBeGreaterThan(0);
    expect((x('Opening') - x('The founding of Saltwick')) / day).toBeCloseTo(45, 1);
    expect((x('Siege') - x('The founding of Saltwick')) / day).toBeCloseTo(72, 1);
    expect((x('חג האביב הגדול') - x('The founding of Saltwick')) / day).toBeCloseTo(108, 1);
    // The siege lasts two months of 36 days.
    expect(Number.parseFloat(cardOf(s, 'Siege').style['inlineSize'] ?? 'NaN') / day).toBeCloseTo(72, 1);
  });

  it('names the months and eras of the calendar on the axis, in the range and on the cards', async () => {
    const s = await open(new FakeHost(ember()));
    expect(rangeOf(s)).toMatch(/^(Turning 1202|Thaw 1203) AE – \w+ 1203 AE$/);
    // Fitted, a month is too narrow for its name: the axis marks the year.
    expect(ticks(s).map((tick) => tick.text)).toEqual(['1202 AE', '1203 AE']);
    click(button(s, 'Zoom in'));
    click(button(s, 'Zoom in'));
    await settle(s);
    const labels = ticks(s).map((tick) => tick.text);
    expect(labels.length).toBeGreaterThan(2);
    for (const label of labels) expect(label).toMatch(new RegExp(`^(${MONTHS.join('|')}) 1203 AE$`));
    expect(labels).toContain('Highsun 1203 AE');
    expect(dateOf(cardOf(s, 'The founding of Saltwick'))).toBe('1 Thaw 1203 AE');
    expect(dateOf(cardOf(s, 'Siege'))).toBe('1 Greening 1203 AE – 1 Goldwane 1203 AE');
    expect(dateOf(cardOf(s, 'חג האביב הגדול'))).toBe('Highsun 1203 AE');
    // Month and era names are the writer's own text: what shows them takes their direction.
    expect(one(s.pane, 'spellbook-timeline-range').attrs['dir']).toBe('auto');
    expect(ticks(s).every((tick) => tick.attrs['dir'] === 'auto')).toBe(true);
    expect(cardOf(s, 'The founding of Saltwick').withClass('spellbook-timeline-card-date')[0]?.attrs['dir']).toBe('auto');
  });

  it('keeps counting in the calendar when zoomed in and out, and fits again', async () => {
    const s = await open(new FakeHost(ember()));
    const fitted = rangeOf(s);
    for (let press = 0; press < 11; press++) click(button(s, 'Zoom in'));
    await settle(s);
    expect(rangeOf(s)).toMatch(/^\d+ \w+ 1203 AE – \d+ \w+ 1203 AE$/);
    expect(ticks(s).map((tick) => tick.text).every((label) => /^\d+ \w+ 1203 AE$/.test(label))).toBe(true);
    for (let press = 0; press < 25; press++) click(button(s, 'Zoom out'));
    await settle(s);
    expect(rangeOf(s)).toMatch(/^\d+ (AE|BE) – \d+ (AE|AT)$/);
    const years = ticks(s).map((tick) => tick.text);
    expect(years.every((label) => /^\d+ (AE|AT|BE)$/.test(label))).toBe(true);
    // The first year of the Age of Tides is always marked.
    expect(years).toContain('1 AT');
    click(button(s, 'Fit'));
    await settle(s);
    expect(rangeOf(s)).toBe(fitted);
  });

  it('shows Hebrew month and era names as they are', async () => {
    const data = sample({
      calendar: HEBREW,
      events: [
        note(`${EVENTS}הכתרת המלך הצעיר.md`, { date: '0012-01-05 ע״מ', timelines: ['רקע'] }),
        note(`${EVENTS}המרד בעיר הנמל.md`, { date: '0012-03-20 ע״מ', timelines: ['רקע'] }),
      ],
      scenes: [],
      sceneOrder: [],
    });
    const s = await open(new FakeHost(data));
    expect(dateOf(cardOf(s, 'הכתרת המלך הצעיר'))).toBe('5 ניסן 12 ע״מ');
    expect(dateOf(cardOf(s, 'המרד בעיר הנמל'))).toBe('20 סיוון 12 ע״מ');
    expect(ticks(s).map((tick) => tick.text)).toContain('אייר 12 ע״מ');
    expect(rangeOf(s)).toContain('ע״מ');
  });

  it('lists an event whose date is not of the calendar as undated, says why, and leaves its note alone', async () => {
    const host = new FakeHost(ember());
    const s = await open(host);
    expect(titles(s)).not.toContain('Old');
    click(one(s.pane, 'spellbook-timeline-undated-toggle'));
    await settle(s);
    const row = one(s.pane, 'spellbook-timeline-undated-row');
    expect(one(row, 'spellbook-timeline-undated-title').text).toBe('Old');
    const why = one(row, 'spellbook-timeline-undated-problem').text;
    expect(why).toMatch(/not a date of the calendar "Ember reckoning"/);
    expect(why).toMatch(/Nothing was changed in the note/);
    expect(host.changes).toEqual([]);
    expect(host.frontmatterOf(OLD)).toEqual({ date: '1923-04-12', end: '1923-05-01', timelines: ['Main plot'] });
  });

  it('re-dates a dragged card in the calendar, and moves one a day later from its menu', async () => {
    const host = new FakeHost(ember());
    const s = await open(host);
    const card = cardOf(s, 'The founding of Saltwick');
    const from = grip(s, card);
    drag(card, from, { x: from.x + 120, y: from.y });
    await settle(s);
    expect(host.changes).toHaveLength(1);
    const moved = host.frontmatterOf(FOUNDING)['date'] as string;
    expect(moved).toMatch(/^1203-\d\d-\d\d AE$/);
    expect(moved > '1203-01-01 AE').toBe(true);
    expect(dateOf(cardOf(s, 'The founding of Saltwick'))).toMatch(/^\d+ \w+ 1203 AE$/);

    host.set({ events: host.data?.events.map((entry) => (entry.path === FOUNDING ? note(FOUNDING, { date: '1203-10-36 AE' }) : entry)) ?? [] });
    await settle(s);
    const last = cardOf(s, 'The founding of Saltwick');
    tapAt(one(last, 'spellbook-timeline-card-more'), grip(s, last));
    lastMenu().item('Move later').click();
    await settle(s);
    // The day after the last day of the Age of Embers is the first of the Age of Tides.
    expect(host.frontmatterOf(FOUNDING)['date']).toBe('0001-01-01 AT');
  });

  it('works the same down a narrow pane', async () => {
    const s = await open(new FakeHost(ember()), PHONE);
    expect(titles(s).length).toBeGreaterThan(0);
    for (const tick of ticks(s)) expect(tick.text).toMatch(/ 1203 AE$/);
    expect(rangeOf(s)).toMatch(/AE – .* AE$/);
  });

  it('says so above the timeline when the stored calendar cannot be used, and goes by the real world', async () => {
    const s = await open(new FakeHost(sample({ calendar: { name: 'Broken', months: [], eras: [{ name: 'Era', short: 'E' }] } })));
    const alert = one(s.pane, 'spellbook-timeline-alert');
    expect(alert.text).toMatch(/story calendar in the project index could not be used/);
    expect(alert.text).toMatch(/at least one month/);
    expect(titles(s)).toContain('Siege');
    expect(rangeOf(s)).toMatch(/1923/);
    expect(one(s.pane, 'spellbook-timeline-range').attrs['dir']).toBeUndefined();
  });
});

describe('picking a date', () => {
  it('puts the fields together as the text a note holds', () => {
    const calendar = readCalendar(EMBER).calendar as StoryCalendar;
    expect(datePartsText(calendar, { era: 0, year: '1203', month: 4, day: 17 })).toBe('1203-4-17 AE');
    expect(datePartsText(calendar, { era: 1, year: '12', month: 3, day: 0 })).toBe('12-3 AT');
    expect(datePartsText(calendar, { era: -1, year: ' 7 ', month: 0, day: 0 })).toBe('7 BE');
    expect(datePartsText(calendar, { era: 0, year: '', month: 0, day: 0 })).toBe('');
    // What makes no date still makes text: reading it back is what refuses it.
    expect(datePartsText(calendar, { era: 0, year: '', month: 3, day: 0 })).toBe('?-3 AE');
    expect(datePartsOf(calendar, null)).toEqual({ era: 1, year: '', month: 0, day: 0 });

    const form: EventForm = { heading: 'x', confirm: 'x', title: null, date: '', end: '', dateNeeded: true, calendar, submit: () => null };
    const read = readEventForm(form, '', '1215-4-17 AT'.replace('1215', '12'), '');
    expect(typeof read === 'string' ? read : read.start).toMatchObject({ precision: 'day', year: 1215, month: 4, day: 17 });
    expect(readEventForm(form, '', '?-3 AE', '')).toMatch(/does not exist in the calendar/);
    expect(readEventForm(form, '', '1923-04-12', '')).toMatch(/does not exist in the calendar/);
    expect(readEventForm(form, '', '', '')).toMatch(/^Give the event a date\. Choose an era/);
    expect(readEventForm(form, '', '12 AT', '11 AT')).toBe('The end date must be later than the date.');
    expect(readEventForm(form, '', '12 AT', '5000 AE')).toMatch(/end date does not exist/);
  });

  it('asks for a new event with pickers of era, year, month and day, already at the place that was tapped', async () => {
    const host = new FakeHost(ember());
    const s = await open(host);
    tapAt(s.viewport, at(s, 700, 90));
    const window = windowParts();
    expect(window.modal.titleEl.text).toBe('New event');
    // Nothing is typed as free text: there are no date fields, only the pickers.
    expect(window.modal.contentEl.withClass('spellbook-timeline-date-input')).toEqual([]);
    const date = picker('spellbook-timeline-date-picker');
    expect(options(date.era)).toEqual(['0:Age of Embers (AE)', '1:Age of Tides (AT)', '-1:Before the Embers (BE)']);
    expect(date.era.value).toBe('0');
    expect(date.year.value).toBe('1203');
    expect(options(date.month)).toEqual(['0:(no month)', ...MONTHS.map((name, index) => `${index + 1}:${name}`)]);
    // Zoomed to months, the date is a month: no day is chosen, and the month's days are there to choose.
    expect(Number(date.month.value)).toBeGreaterThan(0);
    expect(date.day.value).toBe('0');
    expect(date.day.children).toHaveLength(37);
    expect(date.reading()).toMatch(/^\w+ 1203 AE$/);

    choose(date.month, '10');
    expect(date.day.children).toHaveLength(37); // 1203 is no leap year
    date.set('1200');
    expect(date.day.children).toHaveLength(42); // 1200 is: Turning has 41 days
    choose(date.day, '41');
    expect(date.reading()).toBe('Stoneday, 41 Turning 1200 AE');
    date.set('1203');
    // The 41st does not exist in 1203: the day is let go of, where it can be seen.
    expect(date.day.value).toBe('0');
    choose(date.day, '36');
    expect(date.reading()).toBe('Stoneday, 36 Turning 1203 AE');

    const end = picker('spellbook-timeline-end-picker');
    expect(end.year.value).toBe('');
    expect(end.day.disabled).toBe(true);
    choose(end.era, '1');
    end.set('1');
    choose(end.month, '1');
    expect(end.day.disabled).toBe(false);
    choose(end.day, '2');

    window.type('spellbook-timeline-title-input', 'The turning');
    window.confirm.click();
    await settle(s);
    expect(host.created).toEqual([
      {
        title: 'The turning',
        frontmatter: { spellbook: 'event', date: '1203-10-36 AE', timelines: ['Main plot'], end: '0001-01-02 AT' },
      },
    ]);
    expect(openWindows()).toBe(0);
    expect(titles(s)).toContain('The turning');
  });

  it('refuses a year the era does not have, and a day without a month, in plain words', async () => {
    const host = new FakeHost(ember());
    const s = await open(host);
    click(button(s, 'New event'));
    const window = windowParts();
    window.type('spellbook-timeline-title-input', 'Late');
    const date = picker('spellbook-timeline-date-picker');
    date.set('1204'); // the Age of Tides had begun
    expect(date.reading()).toBe(NOT_A_DATE);
    window.confirm.click();
    expect(window.message()).toMatch(/That date does not exist in the calendar/);
    expect(host.created).toEqual([]);
    date.set('twelve');
    window.confirm.click();
    expect(window.message()).toMatch(/does not exist in the calendar/);
    // Changing a field takes the complaint away.
    date.set('1203');
    expect(window.message()).toBe('');
    window.confirm.click();
    await settle(s);
    expect(host.created[0]?.frontmatter['date']).toMatch(/^1203(-\d\d)? AE$/);
  });

  it('sets the date of an event left over from the real world by picking, and writes it as the calendar does', async () => {
    const host = new FakeHost(ember());
    const s = await open(host);
    click(one(s.pane, 'spellbook-timeline-undated-toggle'));
    await settle(s);
    click(one(s.pane, 'spellbook-timeline-set-date'));
    const window = windowParts();
    expect(window.modal.titleEl.text).toBe('Set date');
    const date = picker('spellbook-timeline-date-picker');
    // The old date is not one of this calendar: the fields start empty, in the latest era.
    expect([date.era.value, date.year.value, date.month.value, date.day.value]).toEqual(['1', '', '0', '0']);
    window.confirm.click();
    expect(window.message()).toMatch(/^Give the event a date/);
    choose(date.era, '-1');
    date.set('12');
    window.confirm.click();
    await settle(s);
    expect(host.frontmatterOf(OLD)).toEqual({ date: '0012 BE', end: null, timelines: ['Main plot'] });
    // It is undated no longer.
    expect(one(s.pane, 'spellbook-timeline-undated').hasClass('spellbook-is-hidden')).toBe(true);
  });

  it('opens on an event\'s own date and end, and changes only what was changed', async () => {
    const host = new FakeHost(ember());
    const s = await open(host);
    const card = cardOf(s, 'Siege');
    tapAt(one(card, 'spellbook-timeline-card-more'), grip(s, card));
    lastMenu().item('Change date').click();
    const date = picker('spellbook-timeline-date-picker');
    const end = picker('spellbook-timeline-end-picker');
    expect([date.era.value, date.year.value, date.month.value, date.day.value]).toEqual(['0', '1203', '3', '1']);
    expect([end.era.value, end.year.value, end.month.value, end.day.value]).toEqual(['0', '1203', '5', '1']);
    choose(end.day, '0');
    choose(end.month, '6');
    windowParts().confirm.click();
    await settle(s);
    expect(host.changes).toHaveLength(1);
    expect(host.changes[0]?.[0]?.patch).toEqual({ end: '1203-06 AE' });
  });

  it('still asks for typed dates in a project on the real-world calendar', async () => {
    const s = await open();
    click(button(s, 'New event'));
    const window = windowParts();
    expect(window.field('spellbook-timeline-date-input').attrs['placeholder']).toMatch(/1923-04-12/);
    expect(window.modal.contentEl.withClass('spellbook-timeline-date-picker')).toEqual([]);
  });
});

describe('the Calendar window', () => {
  const body = (): FakeElement => one(windowParts().modal.contentEl, 'spellbook-timeline-calendar-body');
  const presets = (): FakeElement[] => body().withClass('spellbook-timeline-calendar-preset');
  const preview = (): string => one(windowParts().modal.contentEl, 'spellbook-timeline-calendar-preview').text;
  const misfits = (): string[] =>
    windowParts().modal.contentEl.withClass('spellbook-timeline-calendar-misfit').map((row) => row.fullText);
  const inputs = (cls: string): FakeElement[] => body().withClass(cls);
  const type = (input: FakeElement | undefined, text: string): void => {
    if (!input) throw new Error('the window has no such field');
    input.value = text;
    input.dispatch('input', {});
  };
  const toggleOf = (name: string): StubSetting['toggles'][number] => {
    const found = body().settings.find((setting) => setting.nameEl.text === name)?.toggles[0];
    if (!found) throw new Error(`the window has no switch "${name}"`);
    return found;
  };
  const rowButton = (label: string): FakeElement => {
    const found = body().withClass('spellbook-timeline-calendar-row-button').find((el) => el.attrs['aria-label'] === label);
    if (!found) throw new Error(`the window has no button "${label}"`);
    return found;
  };

  it('makes a draft of a calendar and a calendar of a draft, with the first era beginning where the count does', () => {
    const calendar = readCalendar(EMBER).calendar as StoryCalendar;
    expect(draftCalendar(calendarDraft(calendar))).toEqual(calendar);
    const draft = calendarDraft(calendar);
    draft.yearZero = true;
    draft.eras[0] = { name: 'Age of Embers', short: 'AE', start: '77' };
    expect(draftCalendar(draft).eras[0]?.start).toBe(0);
    draft.months[0] = { name: 'Thaw', days: 'many' };
    expect(Number.isNaN(draftCalendar(draft).months[0]?.days)).toBe(true);
    expect(calendarDraft(null).real).toBe(true);
    expect(calendarPreview(calendar)).toBe('A date reads: Windsday, 17 Thaw 3 AT. In a note it is written: 0003-01-17 AT');
  });

  it('opens from the toolbar on the real world, for a project without a calendar', async () => {
    const s = await open();
    click(button(s, 'Calendar'));
    const window = windowParts();
    expect(window.modal.titleEl.text).toBe(CALENDAR_WINDOW_TITLE);
    expect(presets().map((preset) => [preset.text, preset.attrs['aria-pressed']])).toEqual([
      ['Real world', 'true'],
      ['Twelve months of thirty days', 'false'],
      ['Ten months (an example)', 'false'],
    ]);
    expect(one(body(), 'spellbook-timeline-calendar-note').text).toBe(REAL_WORLD_NOTE);
    expect(preview()).toBe('');
    expect(misfits()).toEqual([]);
    // Nothing was changed: confirming saves nothing.
    window.confirm.click();
    await settle(s);
    expect(s.host.calendarSaves).toEqual([]);
    expect(openWindows()).toBe(0);
  });

  it('starts from a ready-made calendar, shows how a date will read, and lists the dates that will not fit', async () => {
    const host = new FakeHost();
    const s = await open(host);
    click(button(s, 'Calendar'));
    click(presets()[1] as FakeElement);
    expect(presets().map((preset) => preset.attrs['aria-pressed'])).toEqual(['false', 'true', 'false']);
    expect(inputs('spellbook-timeline-calendar-month-name')).toHaveLength(12);
    expect(inputs('spellbook-timeline-calendar-days').map((input) => input.value)).toEqual(Array.from({ length: 12 }, () => '30'));
    expect(preview()).toBe('A date reads: Day 2, 17 Month 1 3 FE. In a note it is written: 0003-01-17 FE');

    // Every date the project has is a real-world one: all seven are listed, and none is touched.
    const listed = misfits();
    expect(listed).toHaveLength(7);
    expect(listed).toContain('The war begins date: 1923-04-12');
    expect(listed).toContain('Siege end: 1923-08-01');
    expect(listed).toContain('Opening date: 1923-04-01');
    expect(one(windowParts().modal.contentEl, 'spellbook-timeline-calendar-misfit-heading').text).toMatch(
      /^7 dates in this project do not fit this calendar\. Nothing in the notes will be changed/,
    );

    // Names are the writer's own, in any language; the preview follows as they are typed.
    type(inputs('spellbook-timeline-calendar-name')[0], 'לוח הממלכה');
    type(inputs('spellbook-timeline-calendar-month-name')[0], 'ניסן');
    type(inputs('spellbook-timeline-calendar-era-short')[0], 'ע״מ');
    expect(inputs('spellbook-timeline-calendar-month-name')[0]?.attrs['dir']).toBe('auto');
    expect(preview()).toBe('A date reads: Day 2, 17 ניסן 3 ע״מ. In a note it is written: 0003-01-17 ע״מ');

    // Switching is a choice: the first press says what will happen, the second does it.
    const window = windowParts();
    expect(window.confirm.buttonEl.text).toBe(USE_CALENDAR_LABEL);
    window.confirm.click();
    await settle(s);
    expect(host.calendarSaves).toEqual([]);
    expect(window.message()).toMatch(/^7 dates do not fit this calendar/);
    expect(window.confirm.buttonEl.text).toBe(USE_ANYWAY_LABEL);
    window.confirm.click();
    await settle(s);

    expect(host.calendarSaves).toHaveLength(1);
    const saved = readCalendar(host.calendarSaves[0]).calendar;
    expect(saved?.name).toBe('לוח הממלכה');
    expect(saved?.months[0]).toEqual({ name: 'ניסן', days: 30 });
    expect(saved?.eras).toEqual([{ name: 'First Era', short: 'ע״מ', start: 1 }]);
    expect(openWindows()).toBe(0);
    // No note was written: the events are simply undated now.
    expect(host.changes).toEqual([]);
    expect(titles(s)).toEqual([]);
    expect(host.frontmatterOf(`${EVENTS}Siege.md`)['date']).toBe('1923-06-01');
  });

  it('edits months, the week, eras, the era before, the year zero and the leap rule', async () => {
    const host = new FakeHost(sample({ events: [], scenes: [], sceneOrder: [] }));
    const s = await open(host);
    click(button(s, 'Calendar'));
    click(presets()[2] as FakeElement);
    expect(inputs('spellbook-timeline-calendar-month-name').map((input) => input.value)).toEqual(MONTHS);

    click(rowButton('Remove month 10'));
    click(rowButton('Move up month 2'));
    expect(inputs('spellbook-timeline-calendar-month-name').map((input) => input.value).slice(0, 3)).toEqual(['Seedfall', 'Thaw', 'Greening']);
    click(one(one(body(), 'spellbook-timeline-calendar-months'), 'spellbook-timeline-calendar-add'));
    type(inputs('spellbook-timeline-calendar-month-name')[9], 'Yearsend');
    type(inputs('spellbook-timeline-calendar-days')[9], '5');
    // The only month cannot be removed, nor the first moved up.
    expect(rowButton('Move up month 1').disabled).toBe(true);

    click(rowButton('Remove day 6'));
    expect(inputs('spellbook-timeline-calendar-weekday')).toHaveLength(5);

    click(one(one(body(), 'spellbook-timeline-calendar-eras'), 'spellbook-timeline-calendar-add'));
    expect(inputs('spellbook-timeline-calendar-era-start').map((input) => [input.value, input.disabled])).toEqual([['1', true], ['1001', false]]);
    type(inputs('spellbook-timeline-calendar-era-name')[1], 'Age of Tides');
    type(inputs('spellbook-timeline-calendar-era-short')[1], 'AE');
    expect(preview()).toBe('Two eras share the short form "AE". Each needs its own.');
    windowParts().confirm.click();
    expect(windowParts().message()).toBe('Two eras share the short form "AE". Each needs its own.');
    expect(host.calendarSaves).toEqual([]);
    type(inputs('spellbook-timeline-calendar-era-short')[1], 'AT');
    type(inputs('spellbook-timeline-calendar-era-start')[1], '1204');

    toggleOf('An era before the first').flip();
    expect(inputs('spellbook-timeline-calendar-before-name')).toEqual([]);
    toggleOf('Year zero').flip();
    expect(inputs('spellbook-timeline-calendar-era-start')[0]?.value).toBe('0');
    type(inputs('spellbook-timeline-calendar-leap-every')[0], '8');

    windowParts().confirm.click();
    await settle(s);
    expect(host.calendarSaves).toHaveLength(1);
    const saved = readCalendar(host.calendarSaves[0]).calendar as StoryCalendar;
    expect(saved.months.map((month) => month.name)).toEqual(['Seedfall', 'Thaw', 'Greening', 'Highsun', 'Goldwane', 'Harvest', 'Mistfall', 'Frost', 'Deepnight', 'Yearsend']);
    expect(saved.months[9]?.days).toBe(5);
    expect(saved.weekdays).toHaveLength(5);
    expect(saved.eras).toEqual([
      { name: 'Age of Embers', short: 'AE', start: 0 },
      { name: 'Age of Tides', short: 'AT', start: 1204 },
    ]);
    expect(saved.before).toBeNull();
    expect(saved.yearZero).toBe(true);
    // The leap month was the tenth, which was removed: the rule stays within the list, on the month that was last then.
    expect(saved.leap).toEqual({ month: 9, days: 5, every: 8 });
    // What was saved is exactly what the engine stores.
    expect(host.calendarSaves[0]).toEqual(calendarToIndexValue(saved));
  });

  it('opens on the project\'s own calendar, and goes back to the real world only by choice', async () => {
    const host = new FakeHost(ember());
    const s = await open(host);
    click(button(s, 'Calendar'));
    expect(presets().map((preset) => preset.attrs['aria-pressed'])).toEqual(['false', 'false', 'false']);
    expect(inputs('spellbook-timeline-calendar-name')[0]?.value).toBe('Ember reckoning');
    expect(inputs('spellbook-timeline-calendar-era-short').map((input) => input.value)).toEqual(['AE', 'AT']);
    expect(inputs('spellbook-timeline-calendar-before-short')[0]?.value).toBe('BE');
    // Only the one date left over from the real world does not fit the calendar the project has.
    expect(misfits()).toEqual(['Old date: 1923-04-12', 'Old end: 1923-05-01']);

    click(presets()[0] as FakeElement);
    // Back in the real world it is the other way round: the calendar's dates are the ones that do not fit.
    expect(misfits()).toHaveLength(6);
    expect(misfits()).toContain('The founding of Saltwick date: 1203-01-01 AE');
    expect(misfits()).not.toContain('Old date: 1923-04-12');
    const window = windowParts();
    window.confirm.click();
    expect(host.calendarSaves).toEqual([]);
    window.confirm.click();
    await settle(s);
    expect(host.calendarSaves).toEqual([null]);
    expect(titles(s)).toEqual(['Old']);
    expect(rangeOf(s)).toMatch(/1923/);
  });

  it('keeps the window open and says why when the calendar cannot be saved', async () => {
    const host = new FakeHost(sample({ events: [], scenes: [], sceneOrder: [] }));
    const s = await open(host);
    host.failWrites = true;
    click(button(s, 'Calendar'));
    click(presets()[1] as FakeElement);
    windowParts().confirm.click();
    await settle(s);
    expect(windowParts().message()).toBe('the disk is full');
    expect(openWindows()).toBe(1);
    windowParts().cancel.click();
    expect(openWindows()).toBe(0);
  });

  it('offers the calendars of the engine as starting points, each one usable', () => {
    for (const preset of CALENDAR_PRESETS) {
      const draft = calendarDraft(preset.calendar);
      expect(draft.real).toBe(preset.calendar === null);
      if (preset.calendar !== null) expect(draftCalendar(draft)).toEqual(preset.calendar);
    }
    expect(WIDE.pane).toBeGreaterThan(PHONE.pane);
  });
});
