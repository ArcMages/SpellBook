// Time on the entity sheet and in the World browser, as they are plugged
// into the plugin: the real feature on a project store over the tests'
// memory vault. What is checked hardest: each date given on the sheet writes
// that one property of the note and nothing else, never the note's text.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CALENDAR_PRESETS, calendarToIndexValue } from '../../../src/core/timeline';
import type { StoryCalendar } from '../../../src/core/timeline';
import { STORY_CALENDAR_SERVICE, WORLD_HISTORY_SERVICE } from '../../../src/core/world';
import { MemoryVault } from '../../memoryVault';
import { Menu as StubMenu, Modal as StubModal, Notice as StubNotice, resetFakeDocument, resetPlatform } from '../../obsidianStub';
import type { ButtonComponent, FakeElement } from '../../obsidianStub';
import { INDEX_BODY } from '../../storeHarness';
import { MARA, NOVEL_INDEX, OPENING, SALTWICK, calm, cardNamed, inNovel, lastWindow, novelVault, one, openWorld, typeInto, wire } from './stage';
import type { Wired } from './stage';

const EMBER = CALENDAR_PRESETS.find((preset) => preset.id === 'ten-months')?.calendar as StoryCalendar;
const stages: Wired[] = [];

async function stage(vault: MemoryVault = novelVault()): Promise<Wired> {
  const made = await wire(vault);
  stages.push(made);
  return made;
}

beforeEach(() => {
  StubMenu.shown.length = 0;
  StubNotice.shown.length = 0;
  StubModal.opened.length = 0;
  resetFakeDocument();
  resetPlatform();
});

afterEach(() => {
  for (const made of stages.splice(0)) made.switchOff();
});

/** The novel, with dates on Mara and Saltwick, and a date on the scene "Opening". */
function datedVault(): MemoryVault {
  const vault = novelVault();
  vault.external.editFrontmatter(inNovel(MARA), (frontmatter) => {
    frontmatter['date'] = '1889-04-17';
    frontmatter['moments'] = ['1923-10-13 | is sent to Saltwick', '1911 | qualifies'];
  });
  vault.external.editFrontmatter(inNovel(SALTWICK), (frontmatter) => {
    frontmatter['date'] = 1688;
  });
  vault.external.editFrontmatter(inNovel(OPENING), (frontmatter) => {
    frontmatter['date'] = '1923-10-14';
  });
  return vault;
}

async function sheetOf(s: Wired, name: string): Promise<{ pane: FakeElement; sheet: () => FakeElement }> {
  const { pane } = await openWorld(s);
  cardNamed(pane, name).fire('click');
  return { pane, sheet: () => one(pane, 'spellbook-world-detail') };
}

/** The lines of the "Time" part: word and what it says. */
function timeRows(sheet: FakeElement): string[] {
  return sheet
    .withClass('spellbook-world-time-row')
    .map((row) => `${one(row, 'spellbook-world-time-word').text}: ${one(row, 'spellbook-world-time-value').fullText}`);
}

/** The buttons at the bottom of the window that is open. */
function buttons(): ButtonComponent[] {
  return (lastWindow().contentEl.settings[0]?.components ?? []) as ButtonComponent[];
}

/** Press the button that saves (always the last one). */
async function save(s: Wired): Promise<void> {
  (buttons()[buttons().length - 1] as ButtonComponent).click();
  await calm(s);
}

describe('the "Time" part of the sheet', () => {
  it('shows the two dates under the words of the type, and the moments in order of time', async () => {
    const s = await stage(datedVault());
    const { sheet } = await sheetOf(s, 'Mara');
    expect(sheet().withClass('spellbook-world-time-head')[0]?.fullText).toBe('Time');
    expect(timeRows(sheet())).toEqual(['Born: 17 Apr 1889', 'Died: Not set']);
    expect(sheet().withClass('spellbook-world-time-moment').map((row) => one(row, 'spellbook-world-time-said').fullText)).toEqual([
      '1911 qualifies',
      '13 Oct 1923 is sent to Saltwick',
    ]);
    // The labels are the writer's own text.
    expect(sheet().withClass('spellbook-world-time-what').every((label) => label.getAttr('dir') === 'auto')).toBe(true);
    // A place has its own words.
    const { sheet: place } = await sheetOf(s, 'Saltwick');
    expect(timeRows(place())).toEqual(['Founded: 1688', 'Abandoned: Not set']);
    expect(s.vault.writes).toEqual([]);
  });

  it('sets a date in a window of its own, writing that one property and nothing else', async () => {
    const s = await stage(datedVault());
    const { sheet } = await sheetOf(s, 'Mara');
    const before = s.vault.frontmatterOf(inNovel(MARA)) ?? {};
    const body = s.vault.bodyOf(inNovel(MARA));
    const died = sheet().withClass('spellbook-world-time-set')[1] as FakeElement;
    expect(died.text).toBe('Set');
    died.fire('click');
    expect(lastWindow().titleEl.text).toBe('Died');
    // A date that is no date is turned down with the rule the timeline reads dates with.
    typeInto(one(lastWindow().contentEl, 'spellbook-world-time-date'), 'March 1923');
    await save(s);
    expect(one(lastWindow().contentEl, 'spellbook-prompt-message').text).toContain('1923, 1923-04 or 1923-04-12');
    // An end before the birth is turned down, in the type's own words.
    typeInto(one(lastWindow().contentEl, 'spellbook-world-time-date'), '1850');
    await save(s);
    expect(one(lastWindow().contentEl, 'spellbook-prompt-message').text).toBe('"Died" must be later than "Born".');
    expect(s.vault.writes).toEqual([]);
    typeInto(one(lastWindow().contentEl, 'spellbook-world-time-date'), '1923-03');
    await save(s);
    expect(lastWindow).toThrow();
    expect(s.vault.writes).toEqual([{ op: 'updateFrontmatter', path: inNovel(MARA) }]);
    expect(s.vault.frontmatterOf(inNovel(MARA))).toEqual({ ...before, end: '1923-03' });
    expect(s.vault.bodyOf(inNovel(MARA))).toBe(body);
    expect(timeRows(sheet())).toEqual(['Born: 17 Apr 1889', 'Died: Mar 1923']);
  });

  it('changes a date, and takes it away with "Remove"', async () => {
    const s = await stage(datedVault());
    const { sheet } = await sheetOf(s, 'Mara');
    const born = (): FakeElement => sheet().withClass('spellbook-world-time-set')[0] as FakeElement;
    born().fire('click');
    expect(one(lastWindow().contentEl, 'spellbook-world-time-date').value).toBe('1889-04-17');
    typeInto(one(lastWindow().contentEl, 'spellbook-world-time-date'), '1890');
    await save(s);
    // A year is a bare number, as the timeline writes it.
    expect(s.vault.frontmatterOf(inNovel(MARA))?.['date']).toBe(1890);
    born().fire('click');
    expect(buttons().map((button) => button.buttonEl.text)).toEqual(['Remove', 'Cancel', 'Save']);
    (buttons()[0] as ButtonComponent).click();
    await calm(s);
    expect(s.vault.frontmatterOf(inNovel(MARA))).not.toHaveProperty('date');
    expect(s.vault.frontmatterOf(inNovel(MARA))?.['moments']).toEqual(['1923-10-13 | is sent to Saltwick', '1911 | qualifies']);
    expect(timeRows(sheet())[0]).toBe('Born: Not set');
  });

  it('adds, changes and removes moments, each change written into "moments" alone', async () => {
    const s = await stage(datedVault());
    const { sheet } = await sheetOf(s, 'Mara');
    one(sheet(), 'spellbook-world-time-add').fire('click');
    typeInto(one(lastWindow().contentEl, 'spellbook-world-time-date'), '1923-10-14');
    typeInto(one(lastWindow().contentEl, 'spellbook-world-time-label'), 'פוגשת את טוביאס');
    await save(s);
    expect(s.vault.frontmatterOf(inNovel(MARA))?.['moments']).toEqual([
      '1923-10-13 | is sent to Saltwick',
      '1911 | qualifies',
      '1923-10-14 | פוגשת את טוביאס',
    ]);
    // A moment needs a date.
    one(sheet(), 'spellbook-world-time-add').fire('click');
    await save(s);
    expect(one(lastWindow().contentEl, 'spellbook-prompt-message').text).toBe('Give a date.');
    lastWindow().close();

    // The first in order of time is 1911.
    (sheet().withClass('spellbook-world-time-edit')[0] as FakeElement).fire('click');
    expect(one(lastWindow().contentEl, 'spellbook-world-time-label').value).toBe('qualifies');
    typeInto(one(lastWindow().contentEl, 'spellbook-world-time-label'), 'qualifies as a chart maker');
    await save(s);
    expect(s.vault.frontmatterOf(inNovel(MARA))?.['moments']).toEqual([
      '1923-10-13 | is sent to Saltwick',
      '1911 | qualifies as a chart maker',
      '1923-10-14 | פוגשת את טוביאס',
    ]);
    (sheet().withClass('spellbook-world-time-remove')[1] as FakeElement).fire('click');
    await calm(s);
    expect(s.vault.frontmatterOf(inNovel(MARA))?.['moments']).toEqual(['1911 | qualifies as a chart maker', '1923-10-14 | פוגשת את טוביאס']);
    expect(s.vault.writes.every((write) => write.op === 'updateFrontmatter' && write.path === inNovel(MARA))).toBe(true);
  });

  it('picks the dates by era, year and month in a project with an invented calendar, and writes them in its form', async () => {
    const vault = novelVault();
    vault.external.editFrontmatter(NOVEL_INDEX, (frontmatter) => {
      frontmatter['calendar'] = calendarToIndexValue(EMBER);
    });
    vault.external.editFrontmatter(inNovel(MARA), (frontmatter) => {
      frontmatter['date'] = 1889; // a real-world date from before the calendar: shown, not guessed at
    });
    const s = await stage(vault);
    const { sheet } = await sheetOf(s, 'Mara');
    expect(timeRows(sheet())[0]).toBe('Born: 1889 (cannot be read as a date)');
    (sheet().withClass('spellbook-world-time-set')[0] as FakeElement).fire('click');
    const window = lastWindow().contentEl;
    // The very pickers of the event window; a date of another calendar starts empty.
    expect(one(window, 'spellbook-timeline-year-input').value).toBe('');
    typeInto(one(window, 'spellbook-timeline-year-input'), '1203');
    const month = one(window, 'spellbook-timeline-month-select');
    month.value = '4';
    month.fire('change');
    await save(s);
    expect(s.vault.frontmatterOf(inNovel(MARA))?.['date']).toBe('1203-04 AE');
    expect(timeRows(sheet())[0]).toBe('Born: Highsun 1203 AE');
    expect(s.vault.bodyOf(NOVEL_INDEX)).toBe(INDEX_BODY);
  });
});

describe('the "History" part of the sheet', () => {
  it('lists the entity\'s own dates, its events and its scenes in order of time, the undated after, and opens each', async () => {
    const s = await stage(datedVault());
    const { sheet } = await sheetOf(s, 'Saltwick');
    const lines = sheet().withClass('spellbook-world-history-line').map((line) => line.fullText);
    // The event "The fire" (1890) lists Saltwick, and so do the scenes "Opening" (dated) and "Closing" (not).
    expect(lines).toEqual(['1688 Founded', '1 Mar 1890 The fire event', '14 Oct 1923 Opening scene', 'Closing scene']);
    expect(sheet().withClass('spellbook-world-history-undated-head')[0]?.fullText).toBe('Undated 1');
    (sheet().withClass('spellbook-world-history-open')[1] as FakeElement).fire('click');
    (sheet().withClass('spellbook-world-history-open')[0] as FakeElement).fire('click');
    await calm(s);
    expect(s.opened.map((entry) => entry.path)).toEqual([inNovel('Timeline/The fire.md'), inNovel(SALTWICK)]);
    expect(s.vault.writes).toEqual([]);
  });
});

describe('the World browser by date', () => {
  it('has "From" and "Until" in the table, and orders the cards by date when asked', async () => {
    const s = await stage(datedVault());
    const { pane } = await openWorld(s);
    const characters = (): string[] =>
      (pane.withClass('spellbook-world-group')[0] as FakeElement).withClass('spellbook-world-card-name').map((name) => name.text);
    expect(one(cardNamed(pane, 'Mara'), 'spellbook-world-card-dates').text).toBe('17 Apr 1889');
    const order = one(pane, 'spellbook-world-order');
    order.value = 'date';
    order.fire('change');
    // Mara has a date; the other character has none and comes after.
    expect(characters()).toEqual(['Mara', 'מארה']);
    one(pane, 'spellbook-world-layout-list').fire('click');
    (pane.withClass('spellbook-world-table-sort').find((heading) => heading.text === 'From') as FakeElement).fire('click');
    const names = pane.withClass('spellbook-world-table-entity').map((row) => one(row, 'spellbook-world-table-name').fullText);
    expect(names.slice(0, 2)).toEqual(['Saltwick', 'Mara']);
    expect(s.vault.writes).toEqual([]);
  });

  it('opens the world\'s history from the "History" button, through the timeline\'s service', async () => {
    const s = await stage(datedVault());
    const { pane } = await openWorld(s);
    let asked = 0;
    one(pane, 'spellbook-world-history-button').fire('click');
    expect(StubNotice.shown.map((notice) => notice.message)).toEqual(['The timeline is not available.']);
    s.features.services.provide(WORLD_HISTORY_SERVICE, { show: () => asked++ });
    one(pane, 'spellbook-world-history-button').fire('click');
    expect(asked).toBe(1);
  });

  it('opens the Story calendar window from the toolbar, next to "Story\'s present", through the timeline\'s service', async () => {
    const s = await stage(datedVault());
    const { pane } = await openWorld(s);
    const button = one(pane, 'spellbook-world-calendar');
    expect(button.getAttr('aria-label')).toBe('Story calendar');
    // It stands right after the "Story's present" button.
    const toolbar = button.parent as FakeElement;
    const at = toolbar.children.indexOf(button);
    expect(toolbar.children[at - 1]?.hasClass('spellbook-world-present')).toBe(true);
    let asked = 0;
    button.fire('click');
    expect(StubNotice.shown.map((notice) => notice.message)).toEqual(['The timeline is not available.']);
    s.features.services.provide(STORY_CALENDAR_SERVICE, { open: () => asked++ });
    button.fire('click');
    expect(asked).toBe(1);
    expect(s.vault.writes).toEqual([]);
  });
});

describe('the words for the dates, in the window of types', () => {
  it('changes what a type\'s two dates are called, in the project index alone', async () => {
    const s = await stage(datedVault());
    const { pane } = await openWorld(s);
    one(pane, 'spellbook-world-types').fire('click');
    const window = lastWindow();
    const row = window.contentEl.withClass('spellbook-world-type').find((candidate) => candidate.getAttr('data-type') === 'character') as FakeElement;
    one(row, 'spellbook-world-type-more').fire('click');
    StubMenu.shown[StubMenu.shown.length - 1]?.item('Change date words').click();
    const input = one(lastWindow().contentEl, 'spellbook-prompt-input');
    expect(input.value).toBe('Born, Died');
    typeInto(input, 'נולדה, נפטרה');
    input.fire('keydown', { key: 'Enter' });
    await calm(s);
    expect(s.vault.writes.map((write) => write.path)).toEqual([NOVEL_INDEX]);
    const types = s.vault.frontmatterOf(NOVEL_INDEX)?.['entityTypes'] as Array<Record<string, unknown>>;
    expect(types.find((type) => type['id'] === 'character')?.['dateWords']).toEqual(['נולדה', 'נפטרה']);
    window.close();
    cardNamed(pane, 'Mara').fire('click');
    await calm(s);
    expect(timeRows(one(pane, 'spellbook-world-detail'))).toEqual(['נולדה: 17 Apr 1889', 'נפטרה: Not set']);
  });
});
