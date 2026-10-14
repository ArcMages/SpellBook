// The timeline's filter by tags and by kind, and its saved views, driven
// through a stand-in host: what is shown, the "Filtered" strip, the window
// that sets the filter, the views button, and the world's history.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EVENTS_KIND, MANUSCRIPT_LANE, NO_TAG_FILTER, SCENES_KIND, typeKind } from '../../../src/core/timeline';
import type { SavedView, TagFilter, TimelineNote, ViewState } from '../../../src/core/timeline';
import type { TimelineData, WorldLaneChoice } from '../../../src/features/timeline/timelineHost';
import { readContent } from '../../../src/features/timeline/timelineScene';
import { VIEW_CHOICES_KEY, ViewChoiceStore } from '../../../src/features/timeline/viewChoices';
import { MemoryDeviceStorage } from '../../storeHarness';
import { resetPlatform } from '../../obsidianStub';
import type { ButtonComponent, FakeElement } from '../../obsidianStub';
import { EVENTS, FakeHost, note, sample } from './fakeHost';
import { button, clearScreen, laneNames, lastMenu, open, openWindow, settle, titles, windowParts } from './screen';
import type { Stage } from './screen';

const KING = 'World/Characters/King Aldric.md';
const QUEEN = 'World/Characters/המלכה.md';
const TOWN = 'World/Places/Saltwick.md';

/** A king and a queen who are characters with dates, and royal events: the owner's example. */
const WORLD: TimelineNote[] = [
  note(KING, { type: 'character', date: '1923-03-01', end: '1923-09-01', tags: ['royalty'] }),
  note(QUEEN, { type: 'character', date: '1923-04-20', tags: ['מלוכה', 'royalty/queen'] }),
  note(TOWN, { type: 'place', date: '1923-06-10', tags: ['war'] }),
];

function royalData(world: WorldLaneChoice = { on: true, hidden: [] }, tagFilter: TagFilter = NO_TAG_FILTER): TimelineData {
  const base = sample();
  return sample({
    worldNotes: WORLD,
    world: WORLD.map((entry) => entry.path),
    folder: 'Novel',
    worldLanes: world,
    tagFilter,
    events: [...base.events, note(`${EVENTS}Coronation.md`, { date: '1923-05-20', timelines: ['Main plot'], tags: ['Royalty', 'מלוכה'] })],
    scenes: [
      note('Novel/Manuscript/Opening.md', { date: '1923-04-01', tags: ['royalty'] }),
      note('Novel/Manuscript/Middle.md', {}),
      note('Novel/Manuscript/Ending.md', { date: '1923-07-20', tags: ['war'] }),
    ],
  });
}

/** A host that keeps the view choices, as the plugin's does: each change announced once. */
class ViewHost extends FakeHost {
  readonly states: ViewState[] = [];
  readonly filters: TagFilter[] = [];

  setWorldLanes(choice: WorldLaneChoice): void {
    this.set({ worldLanes: choice });
  }

  setTagFilter(filter: TagFilter): void {
    this.filters.push(filter);
    this.set({ tagFilter: filter });
  }

  setViewState(state: ViewState): void {
    this.states.push(state);
    this.set({ hiddenLanes: [...state.hiddenLanes], worldLanes: state.world, tagFilter: state.filter });
  }

  setSavedViews(views: readonly SavedView[]): void {
    this.set({ savedViews: views });
  }
}

async function stage(data: TimelineData = royalData()): Promise<Stage & { host: ViewHost }> {
  return (await open(new ViewHost(data))) as Stage & { host: ViewHost };
}

const strip = (s: Stage): FakeElement => s.pane.withClass('spellbook-timeline-tag-filter')[0] as FakeElement;
const rowsOf = (list: FakeElement): FakeElement[] => list.withClass('spellbook-timeline-entity-row');
const rowNamed = (list: FakeElement, name: string): FakeElement => {
  const found = rowsOf(list).find((row) => row.withClass('spellbook-timeline-entity-name')[0]?.text === name);
  if (!found) throw new Error(`no row "${name}"`);
  return found;
};

/** The "Show" button of the filter's window: the third at its bottom, after "Clear" and "Cancel". */
const showButton = (): ButtonComponent => openWindow().contentEl.settings[0]?.components[2] as ButtonComponent;

beforeEach(() => {
  clearScreen();
});

afterEach(() => {
  resetPlatform();
});

describe('what the filter by tags shows', () => {
  it('shows a character tagged "royalty" with the royal events and scenes, and no one else', () => {
    const content = readContent(royalData(undefined, { tags: ['royalty'], match: 'any', kinds: [] }));
    expect(content.tagged).toBe(true);
    expect([...content.model.dated].map((event) => event.title).sort()).toEqual(['Coronation', 'Opening']);
    // The queen's tag is nested under "royalty": she shows too. The town is tagged "war": it does not.
    expect(content.world.shown.map((lane) => [lane.name, lane.rows.map((row) => row.entity.name)])).toEqual([['Characters', ['King Aldric', 'המלכה']]]);
    // A lane the filter leaves empty is not drawn; the device's own hidden lanes are untouched.
    expect(content.hiddenLanes).toEqual(['רקע']);
    expect(content.data.hiddenLanes).toEqual([]);
  });

  it('needs every tag with "all", Hebrew tags too', () => {
    const content = readContent(royalData(undefined, { tags: ['royalty', 'מלוכה'], match: 'all', kinds: [] }));
    expect(content.model.dated.map((event) => event.title)).toEqual(['Coronation']);
    expect(content.world.shown.flatMap((lane) => lane.rows.map((row) => row.entity.name))).toEqual(['המלכה']);
    const hebrew = readContent(royalData(undefined, { tags: ['מלוכה'], match: 'any', kinds: [] }));
    expect(hebrew.model.dated.map((event) => event.title)).toEqual(['Coronation']);
  });

  it('shows only the kinds chosen: characters and events, without the manuscript', () => {
    const content = readContent(royalData(undefined, { tags: [], match: 'any', kinds: [typeKind('character'), EVENTS_KIND] }));
    expect(content.model.dated.every((event) => event.source === 'event')).toBe(true);
    expect(content.world.shown.map((lane) => lane.name)).toEqual(['Characters']);
    expect(content.hiddenLanes).toContain(MANUSCRIPT_LANE);
    expect(content.kinds.map((kind) => kind.name)).toEqual(['Events', 'Scenes', 'Characters', 'Places']);
  });

  it('counts the tags of the events, the scenes and the entities', () => {
    const content = readContent(royalData());
    expect(content.tagCounts.slice(0, 3)).toEqual([
      // As it is first written: the Coronation's "Royalty" is read first.
      { tag: 'Royalty', count: 3 },
      { tag: 'war', count: 3 },
      { tag: 'מלוכה', count: 2 },
    ]);
    expect(content.tagged).toBe(false);
  });
});

describe('the filter on the screen', () => {
  it('is set in its window, says what it shows in a strip, and is cleared with one tap', async () => {
    const s = await stage();
    expect(strip(s).hasClass('spellbook-is-hidden')).toBe(true);
    button(s, 'Filter by tags').fire('click');
    const window = openWindow();
    const [tagList, kindList] = window.contentEl.withClass('spellbook-timeline-entity-list') as [FakeElement, FakeElement];
    // The project's tags, the most used first, each with its count.
    expect(rowsOf(tagList).map((row) => row.fullText)).toEqual(['#Royalty 3', '#war 3', '#מלוכה 2', '#royalty/queen 1', '#מלחמה 1']);
    expect(rowsOf(kindList).map((row) => row.fullText)).toEqual(['Events', 'Scenes', 'Characters', 'Places']);
    rowNamed(tagList, '#Royalty').fire('click');
    rowNamed(kindList, 'Characters').fire('click');
    rowNamed(kindList, 'Events').fire('click');
    showButton().click();
    await settle(s);
    expect(s.host.states[s.host.states.length - 1]?.filter).toEqual({ tags: ['Royalty'], match: 'any', kinds: [EVENTS_KIND, typeKind('character')] });
    expect(titles(s)).toEqual(expect.arrayContaining(['Coronation', 'King Aldric', 'המלכה']));
    expect(titles(s)).not.toContain('Opening');
    expect(laneNames(s)).toEqual(['Main plot', 'Characters']);
    expect(strip(s).hasClass('spellbook-is-hidden')).toBe(false);
    expect(strip(s).fullText).toContain('#Royalty - only Events, Characters');
    expect(button(s, 'Filter by tags').getAttr('aria-pressed')).toBe('true');
    // One tap clears it, and everything is back.
    (strip(s).withClass('spellbook-timeline-filter-clear')[0] as FakeElement).fire('click');
    await settle(s);
    expect(strip(s).hasClass('spellbook-is-hidden')).toBe(true);
    expect(laneNames(s)).toEqual(['Manuscript', 'Main plot', 'רקע', 'Other', 'Characters', 'Places']);
  });

  it('turns the world lanes on when it asks for a type of the world', async () => {
    const s = await stage(royalData({ on: false, hidden: ['character'] }));
    expect(laneNames(s)).not.toContain('Characters');
    button(s, 'Filter by tags').fire('click');
    const [, kindList] = openWindow().contentEl.withClass('spellbook-timeline-entity-list') as [FakeElement, FakeElement];
    rowNamed(kindList, 'Characters').fire('click');
    showButton().click();
    await settle(s);
    expect(s.host.states[0]?.world).toEqual({ on: true, hidden: [] });
    expect(laneNames(s)).toEqual(['Characters']);
  });

  it('says so when nothing matches', async () => {
    const s = await stage(royalData(undefined, { tags: ['nothing-has-this'], match: 'any', kinds: [] }));
    expect(s.pane.withClass('spellbook-timeline-empty')[0]?.text).toBe('Nothing on the timeline matches this filter.');
  });
});

describe('saved views', () => {
  it('switches between "Story" and "World history", and Story brings the scenes back', async () => {
    const s = await stage(royalData({ on: false, hidden: [] }));
    expect(button(s, 'Views: Story').text).toBe('Story');
    button(s, 'Views: Story').fire('click');
    expect(lastMenu().outline).toEqual(['Story', 'World history', '---', 'Save current view...']);
    lastMenu().item('World history').click();
    await settle(s);
    expect(laneNames(s)).toEqual(['Main plot', 'רקע', 'Other', 'Characters', 'Places']);
    expect(button(s, 'Views: World history').text).toBe('World history');
    button(s, 'Views: World history').fire('click');
    lastMenu().item('Story').click();
    await settle(s);
    expect(laneNames(s)).toEqual(['Manuscript', 'Main plot', 'רקע', 'Other']);
  });

  it('saves what is shown under a name, switches back to it, and deletes it', async () => {
    const s = await stage(royalData({ on: true, hidden: [] }, { tags: ['royalty'], match: 'any', kinds: [] }));
    expect(button(s, 'Views').text).toBe('Views');
    button(s, 'Views').fire('click');
    lastMenu().item('Save current view...').click();
    const prompt = windowParts();
    prompt.type('spellbook-prompt-input', 'מלכים');
    prompt.confirm.click();
    await settle(s);
    expect(s.host.data?.savedViews?.map((view) => [view.name, view.filter.tags])).toEqual([['מלכים', ['royalty']]]);
    expect(button(s, 'Views: מלכים').getAttr('dir')).toBe('auto');
    // Story clears the filter; the saved view brings it back.
    button(s, 'Views: מלכים').fire('click');
    lastMenu().item('Story').click();
    await settle(s);
    expect(s.host.data?.tagFilter).toEqual(NO_TAG_FILTER);
    button(s, 'Views: Story').fire('click');
    expect(lastMenu().outline).toEqual(['Story', 'World history', '---', 'מלכים', '---', 'Save current view...', 'Delete "מלכים"']);
    lastMenu().item('מלכים').click();
    await settle(s);
    expect(s.host.data?.tagFilter?.tags).toEqual(['royalty']);
    button(s, 'Views: מלכים').fire('click');
    lastMenu().item('Delete "מלכים"').click();
    windowParts().confirm.click();
    await settle(s);
    expect(s.host.data?.savedViews).toEqual([]);
  });

  it('"Open world history" switches to the World history view at once, and the World switch goes back to Story', async () => {
    const s = await stage(royalData({ on: false, hidden: [] }, { tags: ['war'], match: 'any', kinds: [SCENES_KIND] }));
    s.view.showWorldHistory();
    await settle(s);
    expect(s.host.states).toEqual([
      { hiddenLanes: [MANUSCRIPT_LANE], world: { on: true, hidden: [] }, filter: NO_TAG_FILTER },
    ]);
    expect(laneNames(s)).not.toContain('Manuscript');
    button(s, 'World').fire('click');
    await settle(s);
    expect(laneNames(s)).toEqual(['Manuscript', 'Main plot', 'רקע', 'Other']);
    expect(s.host.data?.hiddenLanes).toEqual([]);
  });
});

describe('what the device remembers', () => {
  it('keeps the filter and the views per project, as text, and follows a renamed project', () => {
    const storage = new MemoryDeviceStorage();
    const store = new ViewChoiceStore(storage);
    expect(store.of('Novel/Novel.md').views).toEqual([]);
    expect(store.setFilter('Novel/Novel.md', { tags: ['מלוכה'], match: 'all', kinds: [] })).toBe(true);
    expect(store.setFilter('Novel/Novel.md', { tags: ['מלוכה'], match: 'all', kinds: [] })).toBe(false);
    const view: SavedView = { name: 'Royals', hiddenLanes: [], world: { on: true, hidden: [] }, filter: NO_TAG_FILTER };
    expect(store.setViews('Novel/Novel.md', [view])).toBe(true);
    expect(storage.saves.every(([key, value]) => key === VIEW_CHOICES_KEY && typeof value === 'string')).toBe(true);
    // A new session reads the same back.
    const again = new ViewChoiceStore(storage);
    expect(again.of('Novel/Novel.md')).toEqual({ filter: { tags: ['מלוכה'], match: 'all', kinds: [] }, views: [view] });
    again.move('Novel/Novel.md', 'Book/Book.md');
    expect(new ViewChoiceStore(storage).of('Book/Book.md').views).toEqual([view]);
    expect(new ViewChoiceStore(storage).of('Novel/Novel.md').views).toEqual([]);
  });

  it('ignores what makes no sense, and a storage that fails', () => {
    const storage = new MemoryDeviceStorage();
    storage.save(VIEW_CHOICES_KEY, '{"Novel/Novel.md": {"filter": 5, "views": "x"}, "Other.md": [1]}');
    expect(new ViewChoiceStore(storage).of('Novel/Novel.md')).toEqual({ filter: NO_TAG_FILTER, views: [] });
    storage.save(VIEW_CHOICES_KEY, 'not json');
    const original = console.error;
    console.error = () => undefined;
    try {
      expect(new ViewChoiceStore(storage).of('Novel/Novel.md').views).toEqual([]);
    } finally {
      console.error = original;
    }
  });
});
