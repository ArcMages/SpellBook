// The timeline plugged into the plugin: the view type, the command and the
// ribbon button it registers, and the screen itself working on a real project
// store over the tests' memory vault, through the stand-in workspace. What a
// tap, a drag or a window does must reach the notes, and what changes in the
// notes must reach the screen. How any of it looks can only be seen in Obsidian.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sceneRef } from '../../../src/core/binderTree';
import { HIDDEN_LANES_KEY } from '../../../src/features/timeline/hiddenLanes';
import {
  OPEN_TIMELINE_COMMAND,
  OPEN_TIMELINE_NAME,
  OPEN_TIMELINE_TOOLTIP,
  TIMELINE_NOT_OPENED,
  TIMELINE_VIEW_TYPE,
  TimelineView,
  timelineFeature,
} from '../../../src/features/timeline/index';
import { BY_STORY_LABEL, NO_PROJECT_MESSAGE } from '../../../src/features/timeline/timelineView';
import SpellbookPlugin from '../../../src/main';
import { FakeObsidian, note } from '../../fakeObsidianApp';
import type { FakeElement, Plugin as StubPlugin } from '../../obsidianStub';
import { tick } from '../../storeHarness';
import {
  WIDE,
  boxOf,
  button,
  cardOf,
  cards,
  clearScreen,
  click,
  drag,
  grip,
  laneNames,
  lastMenu,
  notices,
  one,
  openWindow,
  openWindows,
  rangeOf,
  resize,
  tapAt,
  titleOf,
  titles,
  windowParts,
} from './screen';
import type { Stage } from './screen';
import { EVENT_NOTES, LANES, NOVEL, OTHER, eventBody, giveMainAreaTabs, openTimeline, rest, screenOf, wire, wireOpen } from './wired';
import type { Wired } from './wired';

const HEBREW_LANE = 'רקע';
const HEBREW_EVENT = 'ילדות';
/** The zoom the sample novel fits a wide pane at, in pixels per day. */
const DAY = 492 / 122;

const onDisk = (name: string): string => `Novel/Timeline/${name}.md`;
const more = (s: Stage, title: string): FakeElement => one(cardOf(s, title), 'spellbook-timeline-card-more');
const dateOn = (s: Stage, title: string): string => one(cardOf(s, title), 'spellbook-timeline-card-date').text;

/** The titles of the cards on the page, in the order they stand along the time axis. */
const alongAxis = (s: Stage): string[] =>
  cards(s)
    .map((card) => [titleOf(card), boxOf(card).x] as const)
    .sort((a, b) => a[1] - b[1])
    .map(([title]) => title);

async function onScreen(): Promise<{ w: Wired; s: Stage }> {
  const w = await wireOpen();
  const s = await openTimeline(w);
  return { w, s };
}

beforeEach(() => {
  clearScreen();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('plugging the timeline in', () => {
  it('registers the view, a command and a ribbon button, and leaves no trace doing so', () => {
    const w = wire();
    expect(timelineFeature.id).toBe('timeline');
    expect(w.registered.ids).toContain('timeline');
    expect(w.plugin.viewTypes).toEqual(['spellbook-timeline']);
    expect(TIMELINE_VIEW_TYPE).toBe('spellbook-timeline');
    // Obsidian puts "Spellbook: " in front of the command's name itself.
    expect(w.plugin.commands.map((command) => [command.id, command.name])).toEqual([
      ['open-timeline', 'Open timeline'],
      ['edit-story-calendar', 'Edit story calendar'],
      ['open-world-history', 'Open world history'],
    ]);
    expect([OPEN_TIMELINE_COMMAND, OPEN_TIMELINE_NAME]).toEqual(['open-timeline', 'Open timeline']);
    expect(w.plugin.ribbonIcons.map((icon) => [icon.icon, icon.title, icon.shown])).toEqual([
      ['calendar-range', OPEN_TIMELINE_TOOLTIP, true],
    ]);
    expect(OPEN_TIMELINE_TOOLTIP).toBe('Open Spellbook timeline');
    // One section in the settings: the Story calendar button.
    expect(w.registered.settingsSections.map((section) => [section.id, section.title])).toEqual([['timeline', 'Timeline']]);
    // Nothing is opened, written or remembered by plugging in.
    expect(w.fake.workspace.leaves).toEqual([]);
    expect(w.vault.writes).toEqual([]);
    expect(w.storage.saves).toEqual([]);
    expect(w.timers.pending).toBe(0);
  });

  it('opens the timeline as a tab in the main area, and brings that one back instead of opening a second', async () => {
    const w = await wireOpen();
    w.command.callback?.();
    w.command.callback?.(); // asked again before the first one is on the screen
    await rest(w);
    const [leaf] = w.panes();
    expect(w.fake.workspace.leaves).toEqual([leaf]);
    expect(leaf?.split.name).toBe('root');
    const view = leaf?.view;
    expect(view).toBeInstanceOf(TimelineView);
    expect(w.fake.workspace.revealed).toEqual([leaf]);

    w.command.callback?.();
    await rest(w);
    w.plugin.ribbonIcons[0]?.callback({});
    await rest(w);
    expect(w.fake.workspace.leaves).toEqual([leaf]);
    expect(leaf?.view).toBe(view); // the same timeline, not a new one in the old pane
    expect(w.fake.workspace.revealed).toEqual([leaf, leaf, leaf]);
    expect(notices()).toEqual([]);
  });

  it('brings back a timeline the writer has moved elsewhere', async () => {
    const w = await wireOpen();
    const side = w.fake.workspace.addLeaf(w.fake.workspace.rightSplit);
    await side.setViewState({ type: TIMELINE_VIEW_TYPE });
    expect(w.fake.workspace.rightSplit.collapsed).toBe(true);
    w.command.callback?.();
    await rest(w);
    expect(w.fake.workspace.leaves).toEqual([side]);
    expect(w.fake.workspace.rightSplit.collapsed).toBe(false);
  });

  it('says so when Obsidian cannot open it, and can be asked again', async () => {
    const w = await wireOpen();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const working = w.fake.workspace.getLeaf;
    w.fake.workspace.getLeaf = (() => {
      throw new Error('no room');
    }) as never;
    w.command.callback?.();
    await rest(w);
    expect(notices()).toEqual([TIMELINE_NOT_OPENED]);
    expect(w.panes()).toEqual([]);

    w.fake.workspace.getLeaf = working;
    w.command.callback?.();
    await rest(w);
    expect(w.panes()).toHaveLength(1);
  });

  it('shows a timeline that Obsidian put back at start-up: empty until a project is open, then filled in', async () => {
    const w = wire();
    // Obsidian puts the pane back as soon as the view type exists. No project is open yet.
    const leaf = w.fake.workspace.addLeaf(w.fake.workspace.rootSplit);
    await leaf.setViewState({ type: TIMELINE_VIEW_TYPE });
    const s = await screenOf(w, leaf);
    const message = one(s.pane, 'spellbook-timeline-empty');
    expect(message.text).toBe(NO_PROJECT_MESSAGE);
    expect(message.hasClass('spellbook-is-hidden')).toBe(false);
    expect(cards(s)).toEqual([]);

    await w.store.openProject(NOVEL);
    await rest(w);
    expect(message.hasClass('spellbook-is-hidden')).toBe(true);
    expect(one(s.pane, 'spellbook-timeline').hasClass('spellbook-is-empty')).toBe(false);
    expect(laneNames(s)).toEqual(['Manuscript', 'Main plot', HEBREW_LANE, 'Other']);
    expect(titles(s).sort()).toEqual(['Ending', 'Opening', 'Siege', 'Stray', 'The war begins', HEBREW_EVENT]);
    expect(w.vault.writes).toEqual([]);
  });
});

describe('the timeline on the screen, on the project store', () => {
  it('shows the lanes of the index, the events of the Timeline folder and the scenes that have a date', async () => {
    const { w, s } = await onScreen();
    expect(laneNames(s)).toEqual(['Manuscript', 'Main plot', HEBREW_LANE, 'Other']);
    // Middle has no date; the research note has one, but is neither an event nor a scene.
    expect(titles(s).sort()).toEqual(['Ending', 'Opening', 'Siege', 'Stray', 'The war begins', HEBREW_EVENT]);
    expect(dateOn(s, 'The war begins')).toBe('12 Apr 1923');
    expect(cardOf(s, 'Siege').hasClass('spellbook-color-purple')).toBe(true);
    expect(cardOf(s, HEBREW_EVENT).hasClass('spellbook-color-green')).toBe(true);
    expect(one(s.pane, 'spellbook-timeline-undated-toggle').fullText).toBe('Undated 1');
    expect(w.vault.writes).toEqual([]);
    expect(w.storage.saves).toEqual([]);
  });

  it('opens the note of a card that is tapped, where it is in the vault', async () => {
    const { w, s } = await onScreen();
    const war = cardOf(s, 'The war begins');
    tapAt(war, grip(s, war));
    tapAt(war, grip(s, war), 'mouse', { metaKey: true });
    const opening = cardOf(s, 'Opening');
    tapAt(opening, grip(s, opening));
    await rest(w);
    expect(w.opened).toEqual([
      { path: onDisk('The war begins'), where: false },
      { path: onDisk('The war begins'), where: 'tab' },
      { path: 'Novel/Manuscript/Opening.md', where: false },
    ]);
  });

  it('gives an event a new date when its card is dragged along its lane, and a scene the same way', async () => {
    const { w, s } = await onScreen();
    const war = cardOf(s, 'The war begins');
    const before = boxOf(war).x;
    drag(war, grip(s, war), { x: grip(s, war).x + 10 * DAY, y: grip(s, war).y });
    await rest(w);
    expect(w.vault.writes).toEqual([{ op: 'updateFrontmatter', path: onDisk('The war begins') }]);
    expect(w.vault.frontmatterOf(onDisk('The war begins'))).toEqual({ ...EVENT_NOTES['The war begins'], date: '1923-04-22' });
    expect(w.vault.bodyOf(onDisk('The war begins'))).toBe(eventBody('The war begins'));
    // The screen shows it where it now is.
    expect(dateOn(s, 'The war begins')).toBe('22 Apr 1923');
    expect(boxOf(cardOf(s, 'The war begins')).x).toBeCloseTo(before + 10 * DAY, 1);

    const opening = cardOf(s, 'Opening');
    const openingAt = boxOf(opening).x;
    drag(opening, grip(s, opening), { x: grip(s, opening).x + 4 * DAY, y: grip(s, opening).y });
    await rest(w);
    expect(w.vault.frontmatterOf('Novel/Manuscript/Opening.md')).toEqual({ status: 'To do', order: 1024, date: '1923-04-05' });
    expect(w.vault.bodyOf('Novel/Manuscript/Opening.md')).toBe('Once.');
    expect(boxOf(cardOf(s, 'Opening')).x).toBeGreaterThan(openingAt);
    expect(notices()).toEqual([]);
  });

  it('moves an event to another lane from its menu', async () => {
    const { w, s } = await onScreen();
    tapAt(more(s, 'The war begins'), grip(s, cardOf(s, 'The war begins')));
    lastMenu().item('Move to lane').click();
    await rest(w);
    lastMenu().item(HEBREW_LANE).click();
    await rest(w);
    expect(w.vault.frontmatterOf(onDisk('The war begins'))).toEqual({ ...EVENT_NOTES['The war begins'], timelines: [HEBREW_LANE] });
    expect(cardOf(s, 'The war begins').hasClass('spellbook-color-green')).toBe(true);
    expect(cardOf(s, 'The war begins').hasClass('spellbook-color-purple')).toBe(false);
  });

  it('makes a new event note from the New event window, and never one over a note that is there', async () => {
    const { w, s } = await onScreen();
    click(button(s, 'New event'));
    const window = windowParts();
    window.type('spellbook-timeline-title-input', 'siege');
    window.type('spellbook-timeline-date-input', '1923-07-04');
    window.confirm.click();
    await rest(w);
    expect(window.message()).toBe('There is already an event called "siege". Give this one another title.');
    expect(openWindows()).toBe(1);
    expect(w.vault.writes).toEqual([]);

    window.type('spellbook-timeline-title-input', 'The armistice: signed');
    window.confirm.click();
    await rest(w);
    expect(openWindows()).toBe(0);
    // The title became the note's name, without what a file name cannot hold.
    expect(w.vault.writes).toEqual([{ op: 'createFile', path: onDisk('The armistice signed') }]);
    expect(w.vault.frontmatterOf(onDisk('The armistice signed'))).toEqual({ spellbook: 'event', date: '1923-07-04', timelines: ['Main plot'] });
    expect(w.vault.bodyOf(onDisk('The armistice signed'))).toBe('');
    expect(dateOn(s, 'The armistice signed')).toBe('4 Jul 1923');
    expect(w.vault.frontmatterOf(onDisk('Siege'))).toEqual(EVENT_NOTES['Siege']);
    expect(w.vault.bodyOf(onDisk('Siege'))).toBe(eventBody('Siege'));
  });

  it('changes the lanes from the Lanes window: a new one, a new name with its events, and one hidden on this device', async () => {
    const { w, s } = await onScreen();
    click(button(s, 'Lanes'));
    const modal = openWindow();
    const row = (name: string): FakeElement => {
      const found = modal.contentEl
        .withClass('spellbook-timeline-lane-row')
        .find((candidate) => one(candidate, 'spellbook-timeline-lane-title').text === name);
      if (!found) throw new Error(`no lane called "${name}" in the window`);
      return found;
    };

    click(one(modal.contentEl, 'spellbook-timeline-lane-add'));
    let prompt = windowParts();
    prompt.type('spellbook-prompt-input', 'Subplot');
    prompt.confirm.click();
    await rest(w);
    expect(w.vault.frontmatterOf(NOVEL)?.['timelines']).toEqual([...LANES, { name: 'Subplot' }]);
    expect(laneNames(s)).toEqual(['Manuscript', 'Main plot', HEBREW_LANE, 'Subplot', 'Other']);

    click(one(row('Main plot'), 'spellbook-timeline-lane-more'));
    lastMenu().item('Rename').click();
    prompt = windowParts();
    prompt.type('spellbook-prompt-input', 'Plot A');
    prompt.confirm.click();
    await rest(w);
    expect(openWindows()).toBe(1); // only the Lanes window is left
    expect(w.vault.frontmatterOf(NOVEL)?.['timelines']).toEqual([{ name: 'Plot A', color: 'purple' }, LANES[1], { name: 'Subplot' }]);
    for (const name of ['Loose end', 'Siege', 'The war begins']) {
      expect(w.vault.frontmatterOf(onDisk(name))?.['timelines'], name).toEqual(['Plot A']);
    }
    expect(laneNames(s)).toEqual(['Manuscript', 'Plot A', HEBREW_LANE, 'Subplot', 'Other']);
    expect(cardOf(s, 'Siege').hasClass('spellbook-color-purple')).toBe(true); // still in its lane, not in Other

    w.vault.clearWrites();
    click(one(row(HEBREW_LANE), 'spellbook-timeline-lane-toggle'));
    await rest(w);
    expect(laneNames(s)).toEqual(['Manuscript', 'Plot A', 'Subplot', 'Other']);
    expect(titles(s)).not.toContain(HEBREW_EVENT);
    // Hiding is this device's own business: nothing in the vault changed.
    expect(w.vault.writes).toEqual([]);
    expect(JSON.parse(w.storage.load(HIDDEN_LANES_KEY) as string)).toEqual({ [NOVEL]: [HEBREW_LANE] });
    expect(notices()).toEqual([]);
  });

  it('tells "By story order" from the binder, and follows the binder when a scene is moved', async () => {
    const { w, s } = await onScreen();
    click(button(s, BY_STORY_LABEL));
    expect(rangeOf(s)).toBe('Story order');
    // Opening, then what happens at Ending (the event that links it comes first, by date), then the rest by date.
    expect(alongAxis(s)).toEqual(['Opening', HEBREW_EVENT, 'Ending', 'The war begins', 'Stray', 'Siege', 'Loose end']);

    await w.store.moveNode(sceneRef('Manuscript/Ending.md'), { at: 'start', parentId: null });
    await rest(w);
    expect(alongAxis(s)).toEqual([HEBREW_EVENT, 'Ending', 'Opening', 'The war begins', 'Stray', 'Siege', 'Loose end']);
  });

  it('follows what another device changes: a date, a new event, the lanes', async () => {
    const { w, s } = await onScreen();
    w.vault.external.editFrontmatter(onDisk('The war begins'), (frontmatter) => {
      frontmatter['date'] = '1923-04-20';
    });
    w.vault.external.create(onDisk('Arrival'), { frontmatter: { spellbook: 'event', date: '1923-05-20', timelines: ['Main plot'] } });
    await rest(w);
    expect(dateOn(s, 'The war begins')).toBe('20 Apr 1923');
    expect(titles(s)).toContain('Arrival');

    w.vault.external.editFrontmatter(NOVEL, (frontmatter) => {
      frontmatter['timelines'] = [{ name: 'Main plot', color: 'red' }];
    });
    await rest(w);
    expect(laneNames(s)).toEqual(['Manuscript', 'Main plot', 'Other']);
    expect(cardOf(s, 'Siege').hasClass('spellbook-color-red')).toBe(true);
    expect(w.vault.writes).toEqual([]); // looking on changes nothing
  });

  it('shows the other project when the writer switches, and nothing when the project is closed', async () => {
    const { w, s } = await onScreen();
    await w.store.openProject(OTHER);
    await rest(w);
    expect(laneNames(s)).toEqual(['Manuscript', 'Court']);
    expect(titles(s)).toEqual(['Coronation']);
    expect(dateOn(s, 'Coronation')).toBe('25 Dec 1066');
    expect(rangeOf(s)).toMatch(/1066/); // fitted afresh, not left looking at 1923

    await w.store.closeProject();
    await rest(w);
    expect(one(s.pane, 'spellbook-timeline-empty').text).toBe(NO_PROJECT_MESSAGE);
    expect(cards(s)).toEqual([]);
  });

  it('tells the writer when a change cannot be made, and changes nothing', async () => {
    const { w, s } = await onScreen();
    w.vault.external.corrupt(NOVEL); // the index can no longer be understood: the project is read-only
    await rest(w);
    w.vault.clearWrites();
    tapAt(more(s, 'The war begins'), grip(s, cardOf(s, 'The war begins')));
    lastMenu().item('Move later').click();
    await rest(w);
    expect(notices()).toHaveLength(1);
    expect(notices()[0]).toMatch(/^"Move later" did not work: This project is read-only/);
    expect(w.vault.writes).toEqual([]);
    expect(dateOn(s, 'The war begins')).toBe('12 Apr 1923');
  });

  it('lets go of everything when the plugin is switched off, and leaves the pane where it was', async () => {
    const { w, s } = await onScreen();
    const [leaf] = w.panes();
    w.vault.external.editFrontmatter(onDisk('Siege'), (frontmatter) => {
      frontmatter['date'] = '1923-06-02';
    });
    expect(w.timers.pending).toBeGreaterThan(0); // a drawing is waiting

    w.unload();
    expect(leaf?.view).toBeNull();
    expect(w.fake.workspace.leaves).toEqual([leaf]); // there again when the plugin is switched back on
    expect(s.pane.children).toEqual([]);
    expect(s.viewport.listenerCount()).toBe(0);
    expect(w.timers.pending).toBe(0);
    expect(w.plugin.ribbonIcons.every((icon) => !icon.shown)).toBe(true);
    expect(w.plugin.viewTypes).toEqual([]);

    // Nothing of the timeline reacts any more.
    w.vault.external.editFrontmatter(onDisk('Siege'), (frontmatter) => {
      frontmatter['date'] = '1923-06-03';
    });
    w.vault.refresh();
    w.command.callback?.();
    await tick();
    expect(w.timers.pending).toBe(0);
    expect(w.fake.workspace.leaves).toEqual([leaf]);
    expect(w.fake.workspace.revealed).toHaveLength(1);
    expect(w.vault.writes).toEqual([]);
  });
});

describe('in the plugin itself', () => {
  /** Wait for something the plugin does in the background. */
  async function until(check: () => boolean, what: string): Promise<void> {
    for (let attempt = 0; attempt < 500; attempt++) {
      if (check()) return;
      await tick();
    }
    throw new Error(`timed out waiting for ${what}`);
  }

  it('is there once Obsidian has started, shows the vault, and writes through Obsidian\'s own way of changing properties', async () => {
    // Node has no frames to draw; a frame is the next turn of the event loop here.
    vi.stubGlobal('requestAnimationFrame', (callback: (time: number) => void) => setTimeout(() => callback(0), 0));
    vi.stubGlobal('cancelAnimationFrame', (id: ReturnType<typeof setTimeout>) => clearTimeout(id));
    const fake = new FakeObsidian();
    giveMainAreaTabs(fake);
    fake.addNote(
      'Novel/Novel.md',
      note({ spellbook: 'project', version: 1, title: 'My Novel', binder: ['Manuscript/Opening.md'], timelines: [{ name: 'Main plot', color: 'purple' }] }, 'Index text.'),
    );
    fake.addNote('Novel/Manuscript/Opening.md', note({ status: 'To do', order: 1024, date: '1923-04-01' }, 'It was a dark night.\n'));
    fake.addNote('Novel/Timeline/The war begins.md', note({ spellbook: 'event', date: '1923-04-12', timelines: ['Main plot'] }, 'What happened.\n'));

    const plugin = new SpellbookPlugin(fake.app, { id: 'spellbook-novel-writer', name: 'Spellbook', version: '0.1.0' } as never);
    const stub = plugin as unknown as StubPlugin;
    try {
      plugin.onload();
      expect(stub.viewTypes).not.toContain(TIMELINE_VIEW_TYPE); // the screens plug in once the store is ready
      fake.finishStartup();
      expect(plugin.features?.ids).toContain('timeline');
      expect(stub.viewTypes).toContain(TIMELINE_VIEW_TYPE);
      expect(stub.ribbonIcons.map((icon) => icon.title)).toContain(OPEN_TIMELINE_TOOLTIP);
      await until(() => plugin.store?.project != null, 'the project to open');
      expect(fake.workspace.leaves).toEqual([]);

      stub.commands.find((command) => command.id === OPEN_TIMELINE_COMMAND)?.callback?.();
      await until(() => fake.workspace.getLeavesOfType(TIMELINE_VIEW_TYPE)[0]?.view != null, 'the timeline to open');
      const leaf = fake.workspace.getLeavesOfType(TIMELINE_VIEW_TYPE)[0];
      expect(leaf?.split.name).toBe('root');
      const view = leaf?.view as unknown as TimelineView;
      const pane = view.contentEl as unknown as FakeElement;
      const s = { view, pane, viewport: one(pane, 'spellbook-timeline-viewport') } as Stage;
      resize(s, WIDE);
      await until(() => titles(s).length === 2, 'the cards to be drawn');
      expect(titles(s).sort()).toEqual(['Opening', 'The war begins']);
      expect(laneNames(s)).toEqual(['Manuscript', 'Main plot']);

      tapAt(more(s, 'The war begins'), grip(s, cardOf(s, 'The war begins')));
      lastMenu().item('Move later').click();
      await until(() => plugin.store?.timelineNotes()[0]?.frontmatter?.['date'] === '1923-04-13', 'the note to be re-dated');
      expect(fake.calls).toEqual(['processFrontMatter Novel/Timeline/The war begins.md']);
      expect(fake.textOf('Novel/Timeline/The war begins.md').endsWith('What happened.\n')).toBe(true);
      await until(() => dateOn(s, 'The war begins') === '13 Apr 1923', 'the card to be drawn again');
      expect(notices()).toEqual([]);

      plugin.unload();
      expect(leaf?.view).toBeNull();
      expect(fake.vault.listenerCount()).toBe(0);
      expect(fake.metadataCache.listenerCount()).toBe(0);
    } finally {
      plugin.unload();
    }
  });
});
