// Entities on the timeline: the chips on a card, the window that ticks them,
// the event window's own list, and the filter "only events with ...".
// Then the same, and the calendar, plugged into the project store.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CALENDAR_PRESETS, calendarToIndexValue } from '../../../src/core/timeline';
import type { EventEntity, StoryCalendar } from '../../../src/core/timeline';
import { CALENDAR_WINDOW_TITLE } from '../../../src/features/timeline/calendarModal';
import { NO_ENTITIES_MESSAGE, NO_MATCH_MESSAGE, searchEntities } from '../../../src/features/timeline/entityPicker';
import { NO_ENTITIES_CHOSEN } from '../../../src/features/timeline/eventModal';
import { STORY_CALENDAR_SERVICE } from '../../../src/core/world';
import type { StoryCalendarService } from '../../../src/core/world';
import { EDIT_CALENDAR_COMMAND, STORY_CALENDAR_SETTING_DESC, STORY_CALENDAR_TEXT } from '../../../src/features/timeline/index';
import { CALENDAR_NO_PROJECT } from '../../../src/features/timeline/timelineActions';
import type { TimelineData } from '../../../src/features/timeline/timelineHost';
import { FILTER_LABEL, NO_MATCHING_EVENTS, SHOW_ALL_LABEL } from '../../../src/features/timeline/timelineView';
import { FakeElement, resetPlatform } from '../../obsidianStub';
import type { ButtonComponent } from '../../obsidianStub';
import { EVENTS, FakeHost, SCENES, note, sample } from './fakeHost';
import {
  PHONE,
  button,
  cardOf,
  click,
  clearScreen,
  grip,
  lastMenu,
  notices,
  one,
  open,
  openWindow,
  openWindows,
  settle,
  tapAt,
  titles,
  windowParts,
} from './screen';
import type { Stage } from './screen';
import { NOVEL, hostOf, novelVault, openTimeline, rest, wire, wireOpen } from './wired';

const WAR = `${EVENTS}The war begins.md`;
const WORLD = ['Novel/World/Mara.md', 'Novel/World/Saltwick.md', 'Novel/World/מרים.md'];

/** The sample novel with a World folder; three events and a scene name entities. */
function peopled(overrides: Partial<TimelineData> = {}): TimelineData {
  return sample({
    world: WORLD,
    events: [
      note(WAR, { date: '1923-04-12', timelines: ['Main plot'], entities: ['[[Mara]]', '[[World/Saltwick|the town]]'] }),
      note(`${EVENTS}Siege.md`, { date: '1923-06-01', end: '1923-08-01', timelines: ['Main plot'], entities: ['[[Saltwick]]', '[[Ghost]]'] }),
      note(`${EVENTS}ילדות ארוכה מאוד.md`, { date: '1923-05-02', timelines: ['רקע'], entities: ['[[מרים]]'] }),
      note(`${EVENTS}Loose end.md`, { timelines: ['Main plot'], entities: ['[[Mara]]'] }),
      note(`${EVENTS}A quiet month.md`, { date: '1923-07', timelines: ['Main plot'] }),
    ],
    scenes: [note(`${SCENES}Opening.md`, { date: '1923-04-01' }), note(`${SCENES}The long ending.md`, { date: '1923-07-20', entities: ['[[Mara]]'] })],
    sceneOrder: [`${SCENES}Opening.md`, `${SCENES}The long ending.md`],
    ...overrides,
  });
}

const chipsOf = (card: FakeElement): string[] => card.withClass('spellbook-timeline-entity-chip').map((chip) => chip.text);
const rows = (): FakeElement[] => openWindow().contentEl.withClass('spellbook-timeline-entity-row');
const rowNames = (): string[] => rows().map((row) => one(row, 'spellbook-timeline-entity-name').text);
const ticked = (): string[] =>
  rows()
    .filter((row) => row.attrs['aria-pressed'] === 'true')
    .map((row) => one(row, 'spellbook-timeline-entity-name').text);
function row(name: string): FakeElement {
  const found = rows().find((candidate) => one(candidate, 'spellbook-timeline-entity-name').text === name);
  if (!found) throw new Error(`the list has no entity "${name}"`);
  return found;
}
const filterStrip = (s: Stage): FakeElement => one(s.pane, 'spellbook-timeline-filter');

function cardMenu(s: Stage, title: string, item: string): void {
  const card = cardOf(s, title);
  tapAt(one(card, 'spellbook-timeline-card-more'), grip(s, card));
  lastMenu().item(item).click();
}

beforeEach(() => {
  clearScreen();
});

afterEach(() => {
  resetPlatform();
});

describe('entities on event cards', () => {
  it('shows the entities an event names as chips, by the names of their notes', async () => {
    const s = await open(new FakeHost(peopled()));
    // A link with an alias, or to a path, shows the note's own name.
    expect(chipsOf(cardOf(s, 'The war begins'))).toEqual(['Mara', 'Saltwick']);
    expect(chipsOf(cardOf(s, 'ילדות ארוכה מאוד'))).toEqual(['מרים']);
    expect(chipsOf(cardOf(s, 'The long ending'))).toEqual(['Mara']); // a scene names its entities the same way
    expect(chipsOf(cardOf(s, 'A quiet month'))).toEqual([]);
    // Names are the writer's own text.
    for (const chip of cardOf(s, 'ילדות ארוכה מאוד').withClass('spellbook-timeline-entity-chip')) expect(chip.attrs['dir']).toBe('auto');
    // An entity whose note is not in the World folder is still shown, marked as missing.
    const siege = cardOf(s, 'Siege').withClass('spellbook-timeline-entity-chip');
    expect(siege.map((chip) => [chip.text, chip.hasClass('spellbook-is-missing')])).toEqual([['Saltwick', false], ['Ghost', true]]);
  });

  it('shows three chips at most, and counts the rest', async () => {
    const world = ['A', 'B', 'C', 'D', 'E'].map((name) => `Novel/World/${name}.md`);
    const events = [note(WAR, { date: '1923-04-12', timelines: ['Main plot'], entities: ['[[A]]', '[[B]]', '[[C]]', '[[D]]', '[[E]]'] })];
    const s = await open(new FakeHost(peopled({ world, events })));
    const card = cardOf(s, 'The war begins');
    expect(chipsOf(card)).toEqual(['A', 'B', 'C']);
    expect(one(card, 'spellbook-timeline-entity-more').text).toBe('+2');
  });

  describe('on a narrow card', () => {
    const NAMES = ['Mara', 'Tom', 'Saltwick', 'Dunmore', 'Eve'];

    /** A card with five entities: an event that lasts, so that its card is as long as the zoom makes it. */
    async function crowded(names: readonly string[] = NAMES): Promise<{ s: Stage; card: FakeElement }> {
      const world = names.map((name) => `Novel/World/${name}.md`);
      const events = [note(WAR, { date: '1923-04-12', end: '1923-06-12', timelines: ['Main plot'], entities: names.map((name) => `[[${name}]]`) })];
      const s = await open(new FakeHost(peopled({ world, events })));
      return { s, card: cardOf(s, 'The war begins') };
    }

    /** What the page would say when asked how wide things are: the room for the chips, each chip, and the "+N". */
    function lay(card: FakeElement, room: number, chips: readonly number[], more = 20): void {
      Object.assign(one(card, 'spellbook-timeline-card-entities'), { clientWidth: room });
      card.withClass('spellbook-timeline-entity-chip').forEach((chip, at) => Object.assign(chip, { offsetWidth: chips[at] }));
      Object.assign(one(card, 'spellbook-timeline-entity-more'), { offsetWidth: more });
    }

    /** The writer zooms: the card gets another width, and its chips are fitted to it. */
    async function refit(s: Stage, zoom: 'Zoom in' | 'Zoom out'): Promise<void> {
      click(button(s, zoom));
      await settle(s);
    }

    const visible = (card: FakeElement): string[] =>
      card
        .withClass('spellbook-timeline-entity-chip')
        .filter((chip) => !chip.hasClass('spellbook-is-hidden'))
        .map((chip) => chip.text);
    const moreOf = (card: FakeElement): FakeElement => one(card, 'spellbook-timeline-entity-more');

    it('shows as many whole chips as fit, then a "+N" whose title lists the rest', async () => {
      const { s, card } = await crowded();
      // Mara 40, Tom 34, Saltwick 60: with the gaps and the "+N" (20), two fit in 100.
      lay(card, 100, [40, 34, 60]);
      await refit(s, 'Zoom in');
      expect(visible(card)).toEqual(['Mara', 'Tom']);
      expect(moreOf(card).text).toBe('+3');
      expect(moreOf(card).hasClass('spellbook-is-hidden')).toBe(false);
      expect(moreOf(card).attrs['title']).toBe('Saltwick, Dunmore, Eve');

      // Narrower still: one chip.
      lay(card, 64, [40, 34, 60]);
      await refit(s, 'Zoom out');
      expect(visible(card)).toEqual(['Mara']);
      expect(moreOf(card).text).toBe('+4');
      expect(moreOf(card).attrs['title']).toBe('Tom, Saltwick, Dunmore, Eve');
    });

    it('shows the "+N" alone rather than a chip cut down to a letter or two', async () => {
      const { s, card } = await crowded();
      lay(card, 50, [40, 34, 60]);
      await refit(s, 'Zoom in');
      expect(visible(card)).toEqual([]);
      expect(moreOf(card).text).toBe('+5');
      expect(moreOf(card).attrs['title']).toBe(NAMES.join(', '));
    });

    it('brings the chips back when the card is wide again', async () => {
      const { s, card } = await crowded();
      lay(card, 50, [40, 34, 60]);
      await refit(s, 'Zoom in');
      lay(card, 300, [40, 34, 60]);
      await refit(s, 'Zoom out');
      expect(visible(card)).toEqual(['Mara', 'Tom', 'Saltwick']);
      expect(moreOf(card).text).toBe('+2');
      expect(moreOf(card).attrs['title']).toBe('Dunmore, Eve');
    });

    it('needs no "+N" when every entity is on show, and shows one when the last does not fit', async () => {
      const { s, card } = await crowded(['Mara', 'Tom']);
      expect(moreOf(card).hasClass('spellbook-is-hidden')).toBe(true);
      // Both fit exactly when no room is kept for a "+N"...
      lay(card, 76, [40, 34]);
      await refit(s, 'Zoom in');
      expect(visible(card)).toEqual(['Mara', 'Tom']);
      expect(moreOf(card).hasClass('spellbook-is-hidden')).toBe(true);
      expect(moreOf(card).attrs['title']).toBeUndefined();
      // ...and a little less room shows one, and counts the other.
      lay(card, 70, [40, 34]);
      await refit(s, 'Zoom out');
      expect(visible(card)).toEqual(['Mara']);
      expect(moreOf(card).text).toBe('+1');
      expect(moreOf(card).attrs['title']).toBe('Tom');
    });

    it('leaves every chip in place where the page cannot be measured', async () => {
      const { s, card } = await crowded();
      await refit(s, 'Zoom in');
      expect(visible(card)).toEqual(['Mara', 'Tom', 'Saltwick']);
      expect(moreOf(card).text).toBe('+2');
    });
  });

  it('draws a card again when an entity\'s note is renamed', async () => {
    const host = new FakeHost(peopled());
    const s = await open(host);
    host.set({
      world: ['Novel/World/Mara of the Marsh.md', 'Novel/World/Saltwick.md'],
      events: host.data?.events.map((entry) => (entry.path === WAR ? note(WAR, { date: '1923-04-12', timelines: ['Main plot'], entities: ['[[Mara of the Marsh]]'] }) : entry)) ?? [],
    });
    await settle(s);
    expect(chipsOf(cardOf(s, 'The war begins'))).toEqual(['Mara of the Marsh']);
  });
});

describe('choosing the entities of an event', () => {
  it('finds entities by a part of their name, whatever its capitals', () => {
    const all: EventEntity[] = ['Mara', 'Saltwick', 'מרים'].map((name) => ({ key: name, name, path: `World/${name}.md` }));
    expect(searchEntities(all, '').map((entity) => entity.name)).toEqual(['Mara', 'Saltwick', 'מרים']);
    expect(searchEntities(all, ' SALT ').map((entity) => entity.name)).toEqual(['Saltwick']);
    expect(searchEntities(all, 'a').map((entity) => entity.name)).toEqual(['Mara', 'Saltwick']);
    expect(searchEntities(all, 'רי').map((entity) => entity.name)).toEqual(['מרים']);
    expect(searchEntities(all, 'x')).toEqual([]);
  });

  it('ticks and unticks them from the card\'s menu, through a list that can be searched', async () => {
    const host = new FakeHost(peopled());
    const s = await open(host);
    cardMenu(s, 'The war begins', 'Entities');
    const window = windowParts();
    expect(window.modal.titleEl.text).toBe('Entities');
    expect(one(window.modal.contentEl, 'spellbook-timeline-window-note').text).toBe('The war begins');
    // The notes of the World folder, then an entity some event names that has no note.
    expect(rowNames()).toEqual(['Mara', 'Saltwick', 'מרים', 'Ghost']);
    expect(ticked()).toEqual(['Mara', 'Saltwick']);
    expect(rows().every((entry) => one(entry, 'spellbook-timeline-entity-name').attrs['dir'] === 'auto')).toBe(true);

    window.type('spellbook-timeline-entity-search', 'מר');
    expect(rowNames()).toEqual(['מרים']);
    click(row('מרים'));
    window.type('spellbook-timeline-entity-search', 'zzz');
    expect(rowNames()).toEqual([]);
    expect(one(window.modal.contentEl, 'spellbook-timeline-entity-none').text).toBe(NO_MATCH_MESSAGE);
    window.type('spellbook-timeline-entity-search', '');
    // A tapped row stays where it is, and what was ticked while searching is still ticked.
    expect(rowNames()).toEqual(['Mara', 'Saltwick', 'מרים', 'Ghost']);
    click(row('Mara'));
    expect(ticked()).toEqual(['Saltwick', 'מרים']);
    expect(host.changes).toEqual([]);

    window.confirm.click();
    await settle(s);
    expect(openWindows()).toBe(0);
    expect(host.changes).toHaveLength(1);
    // The link that stays is kept as it was written; the new one is a plain link. Nothing else in the note is named.
    expect(host.changes[0]?.[0]?.patch).toEqual({ entities: ['[[World/Saltwick|the town]]', '[[מרים]]'] });
    expect(chipsOf(cardOf(s, 'The war begins'))).toEqual(['Saltwick', 'מרים']);
    expect(host.frontmatterOf(WAR)['date']).toBe('1923-04-12');
  });

  it('writes nothing when nothing was changed, and says so when there are no entities yet', async () => {
    const host = new FakeHost(peopled());
    const s = await open(host);
    cardMenu(s, 'The war begins', 'Entities');
    windowParts().confirm.click();
    await settle(s);
    expect(host.changes).toEqual([]);

    const bare = new FakeHost(sample());
    const other = await open(bare);
    cardMenu(other, 'The war begins', 'Entities');
    expect(rows()).toEqual([]);
    expect(one(openWindow().contentEl, 'spellbook-timeline-entity-none').text).toBe(NO_ENTITIES_MESSAGE);
    windowParts().cancel.click();
    expect(openWindows()).toBe(0);
  });

  it('gives a new event the entities chosen in its window', async () => {
    const host = new FakeHost(peopled());
    const s = await open(host);
    click(button(s, 'New event'));
    const window = windowParts();
    const chips = (): string[] => window.modal.contentEl.withClass('spellbook-timeline-entity-chip-name').map((chip) => chip.text);
    expect(one(window.modal.contentEl, 'spellbook-timeline-entity-chips').fullText).toBe(NO_ENTITIES_CHOSEN);
    window.type('spellbook-timeline-title-input', 'Arrival');

    click(one(window.modal.contentEl, 'spellbook-timeline-entity-choose'));
    expect(openWindows()).toBe(2);
    click(row('Saltwick'));
    click(row('Mara'));
    click(row('מרים'));
    windowParts().confirm.click();
    await settle(s);
    expect(openWindows()).toBe(1);
    expect(chips()).toEqual(['Mara', 'Saltwick', 'מרים']);
    // A chip is taken off with its own button.
    const remove = window.modal.contentEl.withClass('spellbook-timeline-entity-remove');
    expect(remove.map((el) => el.attrs['aria-label'])).toEqual(['Remove Mara', 'Remove Saltwick', 'Remove מרים']);
    click(remove[1] as FakeElement);
    expect(chips()).toEqual(['Mara', 'מרים']);

    window.confirm.click();
    await settle(s);
    expect(host.created).toHaveLength(1);
    expect(host.created[0]?.frontmatter['entities']).toEqual(['[[Mara]]', '[[מרים]]']);
    expect(openWindows()).toBe(0);
  });

  it('changes the entities together with the dates, in one write of the note', async () => {
    const host = new FakeHost(peopled());
    const s = await open(host);
    cardMenu(s, 'The war begins', 'Change date');
    const window = windowParts();
    expect(window.modal.contentEl.withClass('spellbook-timeline-entity-chip-name').map((chip) => chip.text)).toEqual(['Mara', 'Saltwick']);
    click(window.modal.contentEl.withClass('spellbook-timeline-entity-remove')[0] as FakeElement);
    window.type('spellbook-timeline-date-input', '1923-04-20');
    window.confirm.click();
    await settle(s);
    expect(host.changes).toHaveLength(1);
    expect(host.changes[0]).toHaveLength(1);
    expect(host.changes[0]?.[0]?.patch).toEqual({ date: '1923-04-20', entities: ['[[World/Saltwick|the town]]'] });
  });
});

describe('only events with ...', () => {
  it('narrows the timeline to the events that name at least one of the entities chosen', async () => {
    const host = new FakeHost(peopled());
    const s = await open(host);
    const all = titles(s).sort();
    expect(all).toEqual(['A quiet month', 'Opening', 'Siege', 'The long ending', 'The war begins', 'ילדות ארוכה מאוד']);
    expect(filterStrip(s).hasClass('spellbook-is-hidden')).toBe(true);
    expect(button(s, FILTER_LABEL).attrs['aria-pressed']).toBe('false');

    click(button(s, FILTER_LABEL));
    expect(windowParts().modal.titleEl.text).toBe('Only events with');
    expect(rowNames()).toEqual(['Mara', 'Saltwick', 'מרים', 'Ghost']);
    expect(ticked()).toEqual([]);
    click(row('Mara'));
    windowParts().confirm.click();
    await settle(s);

    expect(titles(s).sort()).toEqual(['The long ending', 'The war begins']);
    expect(filterStrip(s).hasClass('spellbook-is-hidden')).toBe(false);
    expect(filterStrip(s).withClass('spellbook-timeline-entity-chip').map((chip) => chip.text)).toEqual(['Mara']);
    expect(button(s, FILTER_LABEL).attrs['aria-pressed']).toBe('true');
    // The undated list is narrowed too: "Loose end" names Mara and stays.
    expect(one(s.pane, 'spellbook-timeline-count').text).toBe('1');

    // One more entity: events with either.
    click(button(s, FILTER_LABEL));
    expect(ticked()).toEqual(['Mara']);
    click(row('מרים'));
    windowParts().confirm.click();
    await settle(s);
    expect(titles(s).sort()).toEqual(['The long ending', 'The war begins', 'ילדות ארוכה מאוד']);
    expect(filterStrip(s).withClass('spellbook-timeline-entity-chip').map((chip) => [chip.text, chip.attrs['dir']])).toEqual([
      ['Mara', 'auto'],
      ['מרים', 'auto'],
    ]);

    click(one(filterStrip(s), 'spellbook-timeline-filter-clear'));
    await settle(s);
    expect(filterStrip(s).withClass('spellbook-timeline-filter-clear')).toEqual([]);
    expect(titles(s).sort()).toEqual(all);
    expect(filterStrip(s).hasClass('spellbook-is-hidden')).toBe(true);
    // Nothing of this is written anywhere: it is a way of looking.
    expect(host.changes).toEqual([]);
  });

  it('keeps the filter while notes change, and lets go of an entity that is gone altogether', async () => {
    const host = new FakeHost(peopled());
    const s = await open(host, PHONE);
    click(button(s, FILTER_LABEL));
    click(row('Ghost'));
    windowParts().confirm.click();
    await settle(s);
    expect(filterStrip(s).withClass('spellbook-timeline-entity-chip').map((chip) => chip.text)).toEqual(['Ghost']);
    expect(one(filterStrip(s), 'spellbook-timeline-filter-clear').text).toBe(SHOW_ALL_LABEL);

    // Another event comes to name it: it shows.
    host.set({ events: [...(host.data?.events ?? []), note(`${EVENTS}A haunting in the hall.md`, { date: '1923-06-10', timelines: ['Main plot'], entities: ['[[ghost]]'] })] });
    await settle(s);
    expect(filterStrip(s).hasClass('spellbook-is-hidden')).toBe(false);

    // No event names it any more, and it has no note: there is nothing left to narrow to.
    host.set({ events: (host.data?.events ?? []).map((entry) => note(entry.path, { ...(entry.frontmatter as Record<string, unknown>), entities: [] })) });
    await settle(s);
    expect(filterStrip(s).hasClass('spellbook-is-hidden')).toBe(true);
  });

  it('says so when no event names any of the entities chosen', async () => {
    const world = [...WORLD, 'Novel/World/Nobody.md'];
    const s = await open(new FakeHost(peopled({ world })));
    click(button(s, FILTER_LABEL));
    click(row('Nobody'));
    windowParts().confirm.click();
    await settle(s);
    expect(titles(s)).toEqual([]);
    const empty = one(s.pane, 'spellbook-timeline-empty');
    expect(empty.text).toBe(NO_MATCHING_EVENTS);
    expect(empty.hasClass('spellbook-is-hidden')).toBe(false);
    expect(notices()).toEqual([]);
  });
});

describe('plugged into the project', () => {
  const EMBER = calendarToIndexValue(CALENDAR_PRESETS[2]?.calendar as StoryCalendar);

  it('hands the screen the calendar of the index and the notes of the World folder', async () => {
    const vault = novelVault();
    vault.seed('Novel/World/Mara.md', { frontmatter: { kind: 'person' }, body: 'A smuggler.' });
    vault.seed('Novel/World/Places/Saltwick.md', { frontmatter: {}, body: 'A port.' });
    const w = await wireOpen(NOVEL, vault);
    const host = hostOf(w);
    expect(host.getData()?.world).toEqual(['World/Mara.md', 'World/Places/Saltwick.md']);
    expect(host.getData()?.calendar).toBeUndefined();

    // A note comes into the World folder on another device: the screen is told.
    let told = 0;
    host.onChange(() => {
      told++;
    });
    w.vault.external.create('Novel/World/Tom.md', { frontmatter: {}, body: '' });
    await rest(w);
    expect(told).toBe(1);
    expect(host.getData()?.world).toEqual(['World/Mara.md', 'World/Places/Saltwick.md', 'World/Tom.md']);
  });

  it('in a vault where two projects each have a "Mara", shows and filters by this project\'s own', async () => {
    const vault = novelVault();
    vault.seed('Novel/World/Characters/Mara.md', { frontmatter: { type: 'character' }, body: 'A smuggler.' });
    vault.seed('Other/World/Characters/Mara.md', { frontmatter: { type: 'character' }, body: 'A queen.' });
    vault.external.editFrontmatter('Novel/Timeline/The war begins.md', (frontmatter) => {
      frontmatter['entities'] = ['[[Mara]]'];
    });
    vault.external.editFrontmatter('Novel/Timeline/Siege.md', (frontmatter) => {
      frontmatter['entities'] = ['[[Novel/World/Characters/Mara]]'];
    });
    // An event of the novel that names the other book's Mara, by her path.
    vault.external.editFrontmatter('Novel/Timeline/ילדות.md', (frontmatter) => {
      frontmatter['entities'] = ['[[Other/World/Characters/Mara]]'];
    });
    const w = await wireOpen(NOVEL, vault);
    expect(hostOf(w).getData()?.folder).toBe('Novel');
    expect(hostOf(w).getData()?.world).toEqual(['World/Characters/Mara.md']);
    const s = await openTimeline(w);
    expect(chipsOf(cardOf(s, 'The war begins'))).toEqual(['Mara']);

    // The filter offers this project's Mara, and the name the stray link gives, apart.
    click(button(s, FILTER_LABEL));
    expect(rowNames()).toEqual(['Mara', 'Mara']);
    click(rows()[0] as FakeElement);
    windowParts().confirm.click();
    await settle(s);
    expect(titles(s).sort()).toEqual(['Siege', 'The war begins']);
  });

  it('stores the calendar in the project index and nowhere else, and takes it away again', async () => {
    const w = await wireOpen();
    const host = hostOf(w);
    host.getData();
    await host.saveCalendar(EMBER);
    await rest(w);
    expect(w.vault.writes).toEqual([{ op: 'updateFrontmatter', path: NOVEL }]);
    expect(w.vault.frontmatterOf(NOVEL)?.['calendar']).toEqual(EMBER);
    expect(host.getData()?.calendar).toEqual(EMBER);
    // Every date in every note is as it was written.
    expect(w.vault.frontmatterOf('Novel/Timeline/Siege.md')?.['date']).toBe('1923-06-01');
    // The lanes, and whatever else the index holds, are left alone.
    expect(w.vault.frontmatterOf(NOVEL)?.['timelines']).toHaveLength(2);

    w.vault.clearWrites();
    await host.saveCalendar(EMBER); // the same again: nothing to write
    expect(w.vault.writes).toEqual([]);
    await host.saveCalendar(null);
    await rest(w);
    expect(w.vault.writes).toEqual([{ op: 'updateFrontmatter', path: NOVEL }]);
    expect(w.vault.frontmatterOf(NOVEL)).not.toHaveProperty('calendar');
    expect(host.getData()?.calendar).toBeUndefined();
  });

  it('opens the Calendar window from its command, with or without the timeline on screen', async () => {
    const w = await wireOpen();
    const command = w.plugin.commands.find((candidate) => candidate.id === EDIT_CALENDAR_COMMAND);
    expect(command?.name).toBe('Edit story calendar');
    command?.callback?.();
    expect(openWindows()).toBe(1);
    expect(openWindow().titleEl.text).toBe(CALENDAR_WINDOW_TITLE);
    expect(w.panes()).toHaveLength(0);
    // Choosing a ready-made calendar and confirming twice (the project's dates do not fit it) stores it.
    const presets = openWindow().contentEl.withClass('spellbook-timeline-calendar-preset');
    click(presets[2] as FakeElement);
    expect(openWindow().contentEl.withClass('spellbook-timeline-calendar-misfit')).toHaveLength(7);
    windowParts().confirm.click();
    windowParts().confirm.click();
    await rest(w);
    expect(openWindows()).toBe(0);
    expect(w.vault.frontmatterOf(NOVEL)?.['calendar']).toEqual(EMBER);
    expect(w.vault.writes).toEqual([{ op: 'updateFrontmatter', path: NOVEL }]);

    // The timeline, opened now, counts in it: the real-world dates are listed as undated.
    const s = await openTimeline(w);
    expect(titles(s)).toEqual([]);
    expect(one(s.pane, 'spellbook-timeline-count').text).toBe('7');
  });

  it('says to open a project first, and opens nothing, when no project is open', () => {
    const w = wire();
    w.plugin.commands.find((candidate) => candidate.id === EDIT_CALENDAR_COMMAND)?.callback?.();
    expect(openWindows()).toBe(0);
    expect(notices()).toEqual([CALENDAR_NO_PROJECT]);
    expect(CALENDAR_NO_PROJECT).toBe('Open a Spellbook project first: the story calendar belongs to a project.');
  });

  /** The "Story calendar" button of the timeline's section in the settings, drawn into a place of its own. */
  function settingsButton(w: ReturnType<typeof wire>): ButtonComponent {
    const section = w.registered.settingsSections.find((candidate) => candidate.id === 'timeline');
    if (!section) throw new Error('the timeline added no settings section');
    const place = new FakeElement('div');
    section.render(place as unknown as HTMLElement);
    expect(place.settings.map((row) => [row.nameEl.text, row.descEl.text])).toEqual([[STORY_CALENDAR_TEXT, STORY_CALENDAR_SETTING_DESC]]);
    const found = place.settings[0]?.components[0] as ButtonComponent | undefined;
    if (!found) throw new Error('the section has no button');
    expect(found.buttonEl.text).toBe('Story calendar');
    return found;
  }

  it('opens the Calendar window from the button in the settings, for the open project', async () => {
    const w = await wireOpen();
    settingsButton(w).click();
    expect(openWindows()).toBe(1);
    expect(openWindow().titleEl.text).toBe(CALENDAR_WINDOW_TITLE);
    expect(w.panes()).toHaveLength(0); // the timeline is not opened for it
    expect(w.vault.writes).toEqual([]); // nor is anything written by opening it
  });

  it('says to open a project first when the settings button is pressed with none open', () => {
    const w = wire();
    settingsButton(w).click();
    expect(openWindows()).toBe(0);
    expect(notices()).toEqual([CALENDAR_NO_PROJECT]);
  });

  it('offers the same window to the World browser by name', async () => {
    const w = await wireOpen();
    const calendar = w.context.services.get<StoryCalendarService>(STORY_CALENDAR_SERVICE);
    expect(calendar).toBeDefined();
    calendar?.open();
    expect(openWindows()).toBe(1);
    expect(openWindow().titleEl.text).toBe(CALENDAR_WINDOW_TITLE);
    // Not after the plugin is switched off.
    clearScreen();
    w.unload();
    calendar?.open();
    expect(openWindows()).toBe(0);
  });
});
