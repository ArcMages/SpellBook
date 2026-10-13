// The timeline screen, driven through a stand-in host and stand-in elements
// (tests/obsidianStub.ts). These tests check what the screen shows and what
// it asks of the host; how it looks can only be checked in Obsidian.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  BY_STORY_LABEL,
  CARDS_PER_FRAME,
  END_ROOM,
  NO_EVENTS_HINT,
  NO_PROJECT_MESSAGE,
  TIMELINE_VIEW_NAME,
  TIMELINE_VIEW_TYPE,
  TimelineView,
} from '../../../src/features/timeline/timelineView';
import { TOUCH_HOLD_MS } from '../../../src/ui/dragDrop';
import { point } from '../../binderScreen';
import { Platform as StubPlatform, fakeDocument, resetPlatform } from '../../obsidianStub';
import type { FakeElement } from '../../obsidianStub';
import { EVENTS, FRAME_MS, FakeHost, SCENES, note, sample } from './fakeHost';
import {
  PHONE,
  WIDE,
  at,
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
  open,
  openWindows,
  ownTextClasses,
  rangeOf,
  resize,
  settle,
  shiftOf,
  tapAt,
  titleOf,
  titles,
  windowParts,
} from './screen';
import type { Stage } from './screen';

/** The zoom the sample fits a wide pane at, in pixels per day, and the one it fits a phone at. */
const DAY = 492 / 122;
// At phone width the lane on show is what is fitted. It opens on the
// manuscript's lane, whose two scenes are 110 days apart (1 April to 20 July).
const DAY_DOWN = 404 / 110;

const WAR = `${EVENTS}The war begins.md`;
const layer = (s: Stage): { x: number; y: number } => shiftOf(one(s.pane, 'spellbook-timeline-cards'));
const more = (s: Stage, title: string): FakeElement => one(cardOf(s, title), 'spellbook-timeline-card-more');

/** A lane of the switcher that a narrow pane shows, by its place. */
function tab(s: Stage, index: number): FakeElement {
  const found = s.pane.withClass('spellbook-timeline-lane-tab')[index];
  if (!found) throw new Error(`the switcher has no lane ${index}`);
  return found;
}

beforeEach(() => {
  clearScreen();
});

afterEach(() => {
  resetPlatform();
});

describe('the view itself', () => {
  it('is the Timeline, with an icon, and is not a place to navigate from', async () => {
    const s = await open();
    expect(s.view).toBeInstanceOf(TimelineView);
    expect(s.view.getViewType()).toBe('spellbook-timeline');
    expect(TIMELINE_VIEW_TYPE).toBe('spellbook-timeline');
    expect(s.view.getDisplayText()).toBe(TIMELINE_VIEW_NAME);
    expect(s.view.getIcon()).not.toBe('');
    expect(s.view.navigation).toBe(false);
    expect(s.pane.hasClass('spellbook-timeline-pane')).toBe(true);
  });

  it('says so when no project is open, and fills in when one is', async () => {
    const s = await open(new FakeHost(null));
    const message = one(s.pane, 'spellbook-timeline-empty');
    expect(message.text).toBe(NO_PROJECT_MESSAGE);
    expect(message.hasClass('spellbook-is-hidden')).toBe(false);
    expect(one(s.pane, 'spellbook-timeline').hasClass('spellbook-is-empty')).toBe(true);
    expect(cards(s)).toEqual([]);
    tapAt(s.viewport, at(s, 300, 90));
    expect(openWindows()).toBe(0); // nothing to add an event to

    s.host.set(sample());
    await settle(s);
    expect(one(s.pane, 'spellbook-timeline').hasClass('spellbook-is-empty')).toBe(false);
    expect(message.hasClass('spellbook-is-hidden')).toBe(true);
    expect(titles(s)).toContain('Siege');
  });

  it('gives a hint when the project has no events yet', async () => {
    const s = await open(new FakeHost(sample({ events: [], scenes: [] })));
    expect(one(s.pane, 'spellbook-timeline-empty').text).toBe(NO_EVENTS_HINT);
    expect(laneNames(s)).toEqual(['Manuscript', 'Main plot', 'רקע']);
  });

  it('marks phones and tablets, so everything tapped is big enough for a finger', async () => {
    StubPlatform.isMobile = true;
    StubPlatform.isPhone = true;
    const s = await open();
    const root = one(s.pane, 'spellbook-timeline');
    expect(root.hasClass('spellbook-is-mobile')).toBe(true);
    expect(root.hasClass('spellbook-is-phone')).toBe(true);
  });

  it('lets go of everything when it closes', async () => {
    const s = await open();
    click(button(s, 'Zoom in'));
    point(s.viewport, 'pointerdown', 700, 300); // a press that is still on
    s.host.announce(); // and a drawing that is waiting
    expect(s.host.listening).toBe(1);
    expect(fakeDocument.listenerCount()).toBeGreaterThan(0);

    await s.shell.close();
    expect(s.host.listening).toBe(0);
    expect(s.host.timers.pending).toBe(0);
    expect(fakeDocument.listenerCount()).toBe(0);
    expect(s.viewport.listenerCount()).toBe(0);
    expect(s.pane.children).toEqual([]);
    expect(s.pane.hasClass('spellbook-timeline-pane')).toBe(false);
    s.host.announce(); // nobody is listening any more
    await settle(s);
    expect(s.pane.children).toEqual([]);
  });
});

describe('on a wide pane', () => {
  it('shows the lanes in order, with their colours', async () => {
    const s = await open();
    expect(one(s.pane, 'spellbook-timeline').hasClass('spellbook-is-vertical')).toBe(false);
    expect(laneNames(s)).toEqual(['Manuscript', 'Main plot', 'רקע', 'Other']);
    const bands = s.pane.withClass('spellbook-timeline-band');
    expect(bands.map((band) => boxOf(band).y)).toEqual([0, 60, 120, 180]);
    expect(bands[1]?.hasClass('spellbook-color-purple')).toBe(true);
    expect(bands[2]?.hasClass('spellbook-color-green')).toBe(true);
    expect([...(bands[0]?.classes ?? [])].filter((cls) => cls.startsWith('spellbook-color-'))).toEqual([]);
    expect(one(s.pane, 'spellbook-timeline-switcher').hasClass('spellbook-is-hidden')).toBe(true);
  });

  it('draws a card for every dated event, placed by the engine', async () => {
    const s = await open();
    expect(titles(s).sort()).toEqual(['Ending', 'Opening', 'Siege', 'Stray', 'The war begins', 'ילדות']);
    const opening = boxOf(cardOf(s, 'Opening'));
    expect(opening).toMatchObject({ x: 24, y: 8, height: 44 });
    const war = cardOf(s, 'The war begins');
    expect(boxOf(war).x).toBeCloseTo(24 + 11 * DAY, 1);
    expect(boxOf(war).y).toBe(68);
    expect(war.hasClass('spellbook-color-purple')).toBe(true);
    expect(war.hasClass('spellbook-is-span')).toBe(false);
    expect(war.attrs['role']).toBe('button');
    expect(war.attrs['tabindex']).toBe('0');
  });

  it('shows the date and the tags on a card that has room, and only the title on one that has not', async () => {
    const s = await open();
    const war = cardOf(s, 'The war begins');
    expect(war.hasClass('spellbook-has-meta')).toBe(true);
    expect(one(war, 'spellbook-timeline-card-date').text).toBe('12 Apr 1923');
    expect(one(war, 'spellbook-timeline-card-tags').text).toBe('#war #מלחמה');
    const stray = cardOf(s, 'Stray');
    expect(stray.hasClass('spellbook-has-meta')).toBe(false);
    expect(stray.withClass('spellbook-timeline-card-date')).toEqual([]);
  });

  it('draws a span as a bar as long as its dates, and a dated scene as a card in Manuscript', async () => {
    const s = await open();
    const siege = cardOf(s, 'Siege');
    expect(siege.hasClass('spellbook-is-span')).toBe(true);
    expect(boxOf(siege).width).toBeCloseTo(61 * DAY, 1);
    expect(one(siege, 'spellbook-timeline-card-date').text).toMatch(/^1 Jun 1923 . 1 Aug 1923$/);
    const ending = cardOf(s, 'Ending');
    expect(ending.hasClass('spellbook-is-scene')).toBe(true);
    expect(boxOf(ending).y).toBe(8);
    expect(titles(s)).not.toContain('Middle'); // a scene without a date is no event
  });

  it('lets only the writer\'s own text choose its direction', async () => {
    const s = await open();
    expect(ownTextClasses(s.viewport)).toEqual(['spellbook-timeline-card-tags', 'spellbook-timeline-card-title']);
    // Lane names: the writer's lanes, not the two that are built in.
    const labels = s.pane.withClass('spellbook-timeline-lane-label');
    expect(labels.map((label) => [label.text, label.attrs['dir'] ?? null])).toEqual([
      ['Manuscript', null],
      ['Main plot', 'auto'],
      ['רקע', 'auto'],
      ['Other', null],
    ]);
    // Dates, counts and buttons keep the direction of the app.
    expect(ownTextClasses(one(s.pane, 'spellbook-timeline-header'))).toEqual([]);
    expect(ownTextClasses(one(s.pane, 'spellbook-timeline-axis'))).toEqual([]);
    expect(one(s.pane, 'spellbook-timeline-axis').children.length).toBeGreaterThan(2);
  });

  it('shows the dates in view in the header, and labels along the axis', async () => {
    const s = await open();
    expect(rangeOf(s)).toMatch(/^Apr 1923 . Oct 1923$/);
    const ticks = one(s.pane, 'spellbook-timeline-axis').children;
    expect(ticks.map((tick) => tick.text)).toContain('May 1923');
    const positions = ticks.map((tick) => boxOf(tick).x);
    for (let index = 1; index < positions.length; index++) {
      expect((positions[index] as number) - (positions[index - 1] as number)).toBeGreaterThanOrEqual(80);
    }
  });

  it('keeps its view and its cards when a note changes', async () => {
    const s = await open();
    click(button(s, 'Zoom in'));
    const before = { range: rangeOf(s), siege: cardOf(s, 'Siege'), x: boxOf(cardOf(s, 'Siege')).x };
    s.host.set({ events: [...sample().events, note(`${EVENTS}Armistice.md`, { date: '1923-06-20', timelines: ['רקע'] })] });
    await settle(s);
    expect(titles(s)).toContain('Armistice');
    expect(rangeOf(s)).toBe(before.range);
    expect(cardOf(s, 'Siege')).toBe(before.siege); // the same element, not a new one
    expect(boxOf(cardOf(s, 'Siege')).x).toBe(before.x);
  });

  it('points out what the lanes could not be read for', async () => {
    const s = await open(new FakeHost(sample({ timelines: [{ name: 'Main plot' }, 7] })));
    const alerts = one(s.pane, 'spellbook-timeline-alerts');
    expect(alerts.hasClass('spellbook-is-hidden')).toBe(false);
    expect(alerts.fullText).toMatch(/Entry 2 of the timelines/);
  });
});

describe('moving around', () => {
  it('slides when the background is dragged, without taking the drag for a tap', async () => {
    const s = await open();
    drag(s.viewport, at(s, 700, 300), at(s, 600, 300));
    await settle(s);
    expect(layer(s).x).toBe(-100);
    expect(rangeOf(s)).not.toMatch(/^Apr 1923/);
    expect(openWindows()).toBe(0);
    expect(s.host.changes).toEqual([]);
    expect(s.viewport.capturedPointers.size).toBe(0);
  });

  it('zooms with the buttons about the middle of the view, and fits everything again', async () => {
    const s = await open();
    const siege = (): number => boxOf(cardOf(s, 'Siege')).width;
    const fitted = { width: siege(), range: rangeOf(s) };
    click(button(s, 'Zoom in'));
    expect(siege()).toBeCloseTo(fitted.width * 1.5, 1);
    click(button(s, 'Zoom out'));
    expect(siege()).toBeCloseTo(fitted.width, 1);
    expect(rangeOf(s)).toBe(fitted.range);

    click(button(s, 'Zoom in'));
    drag(s.viewport, at(s, 700, 300), at(s, 400, 300));
    await settle(s);
    click(button(s, 'Fit'));
    expect(siege()).toBeCloseTo(fitted.width, 1);
    expect(rangeOf(s)).toBe(fitted.range);
    expect(layer(s).x).toBe(0);
  });

  it('zooms with Ctrl and the wheel, keeping the date under the pointer in place', async () => {
    const s = await open();
    const screenX = (): number => boxOf(cardOf(s, 'Ending')).x + layer(s).x;
    const before = { x: screenX(), width: boxOf(cardOf(s, 'Siege')).width };
    const pointer = at(s, before.x, 30);
    const event = s.viewport.fire('wheel', { ctrlKey: true, deltaY: -100, deltaX: 0, deltaMode: 0, clientX: pointer.x, clientY: pointer.y });
    expect(event.defaultPrevented).toBe(true); // the page itself must not zoom
    await settle(s);
    expect(boxOf(cardOf(s, 'Siege')).width).toBeCloseTo(before.width * Math.exp(0.25), 1);
    expect(screenX()).toBeCloseTo(before.x, 1);

    s.viewport.fire('wheel', { metaKey: true, deltaY: 100, deltaX: 0, deltaMode: 0, clientX: pointer.x, clientY: pointer.y });
    await settle(s);
    expect(boxOf(cardOf(s, 'Siege')).width).toBeCloseTo(before.width, 1);
    expect(screenX()).toBeCloseTo(before.x, 1);
  });

  it('slides with the wheel alone', async () => {
    const s = await open();
    s.viewport.fire('wheel', { deltaX: 50, deltaY: 0, deltaMode: 0, clientX: 300, clientY: 300 });
    await settle(s);
    expect(layer(s).x).toBe(-50);
    s.viewport.fire('wheel', { deltaX: 0, deltaY: 3, deltaMode: 1, shiftKey: true, clientX: 300, clientY: 300 });
    await settle(s);
    expect(layer(s).x).toBe(-98); // three lines, turned sideways by Shift
  });

  it('zooms with two fingers about the point between them', async () => {
    const s = await open();
    const before = boxOf(cardOf(s, 'Siege')).width;
    const y = WIDE.top + 300;
    point(s.viewport, 'pointerdown', 400, y, 'touch', { pointerId: 1 });
    point(s.viewport, 'pointerdown', 600, y, 'touch', { pointerId: 2, isPrimary: false });
    expect(s.viewport.capturedPointers.size).toBe(2);
    point(s.viewport, 'pointermove', 300, y, 'touch', { pointerId: 1 });
    point(s.viewport, 'pointermove', 700, y, 'touch', { pointerId: 2, isPrimary: false });
    await settle(s);
    expect(boxOf(cardOf(s, 'Siege')).width).toBeCloseTo(before * 2, 1);
    // One finger leaves: the other goes on sliding, and no tap comes of it.
    point(s.viewport, 'pointerup', 700, y, 'touch', { pointerId: 2, isPrimary: false });
    const slid = layer(s).x;
    point(s.viewport, 'pointermove', 250, y, 'touch', { pointerId: 1 });
    point(s.viewport, 'pointerup', 250, y, 'touch', { pointerId: 1 });
    await settle(s);
    expect(layer(s).x).toBe(slid - 50);
    expect(openWindows()).toBe(0);
    expect(s.host.opened).toEqual([]);
    expect(s.viewport.capturedPointers.size).toBe(0);
  });

  it('keeps the page from scrolling under a finger only while the view slides', async () => {
    const s = await open();
    expect(s.viewport.listenerOptions('touchmove')).toEqual([{ passive: false }]);
    expect(s.viewport.fire('touchmove').defaultPrevented).toBe(false);
    point(s.viewport, 'pointerdown', 600, 300, 'touch');
    expect(s.viewport.fire('touchmove').defaultPrevented).toBe(false); // a finger that only rests
    point(s.viewport, 'pointermove', 560, 300, 'touch');
    expect(s.viewport.fire('touchmove').defaultPrevented).toBe(true);
    point(s.viewport, 'pointerup', 560, 300, 'touch');
    expect(s.viewport.fire('touchmove').defaultPrevented).toBe(false);
  });

  it('stops sliding on Escape and when the device takes the pointer away', async () => {
    const s = await open();
    point(s.viewport, 'pointerdown', 700, 300);
    point(s.viewport, 'pointermove', 650, 300);
    const key = s.viewport.fire('keydown', { key: 'Escape' });
    expect(key.defaultPrevented).toBe(true);
    point(s.viewport, 'pointermove', 500, 300);
    await settle(s);
    expect(layer(s).x).toBe(-50);
    expect(fakeDocument.listenerCount()).toBe(0);

    point(s.viewport, 'pointerdown', 700, 300, 'touch');
    point(s.viewport, 'pointermove', 650, 300, 'touch');
    point(s.viewport, 'pointercancel', 650, 300, 'touch');
    point(s.viewport, 'pointermove', 500, 300, 'touch');
    await settle(s);
    expect(layer(s).x).toBe(-100);
  });

  it('slides and zooms with the keyboard', async () => {
    const s = await open();
    s.viewport.fire('keydown', { key: 'ArrowRight' });
    await settle(s);
    expect(layer(s).x).toBe(-80);
    const before = boxOf(cardOf(s, 'Siege')).width;
    s.viewport.fire('keydown', { key: '+' });
    expect(boxOf(cardOf(s, 'Siege')).width).toBeCloseTo(before * 1.5, 1);
  });

  it('follows the direction of the app when Obsidian itself runs right to left', async () => {
    const s = await open();
    s.pane.setAttr('dir', 'rtl');
    resize(s, { ...WIDE, height: 401 });
    // The same place, counted from the other side, is the same date.
    tapAt(s.viewport, { x: WIDE.left + WIDE.width - 700, y: WIDE.top + 90 });
    expect(windowParts().field('spellbook-timeline-date-input').value).toBe('1923-09');
    windowParts().cancel.click();
    drag(s.viewport, at(s, 300, 300), at(s, 400, 300));
    await settle(s);
    expect(layer(s).x).toBe(100); // the cards go with the pointer
    expect(rangeOf(s)).not.toMatch(/^Apr 1923/); // towards later dates, which now lie to the other side
  });
});

describe('events', () => {
  it('opens the note of a card that is tapped, in a new tab with Cmd or Ctrl', async () => {
    const s = await open();
    const war = cardOf(s, 'The war begins');
    tapAt(war, grip(s, war));
    tapAt(war, grip(s, war), 'mouse', { metaKey: true });
    tapAt(one(war, 'spellbook-timeline-card-title'), grip(s, war), 'touch');
    expect(s.host.opened).toEqual([
      { path: WAR, where: false },
      { path: WAR, where: 'tab' },
      { path: WAR, where: false },
    ]);
    war.fire('keydown', { key: 'Enter', ctrlKey: true });
    expect(s.host.opened[3]).toEqual({ path: WAR, where: 'tab' });
  });

  it('asks for a new event where an empty place in a lane is tapped, and has the host make it', async () => {
    const s = await open();
    tapAt(s.viewport, at(s, 700, 90));
    const window = windowParts();
    expect(window.modal.titleEl.text).toBe('New event');
    expect(one(window.modal.contentEl, 'spellbook-timeline-window-note').text).toBe('Lane: Main plot');
    // Zoomed to months, the date is a month.
    expect(window.field('spellbook-timeline-date-input').value).toBe('1923-09');
    expect(window.field('spellbook-timeline-title-input').attrs['dir']).toBe('auto');
    expect(window.field('spellbook-timeline-date-input').attrs['dir']).toBeUndefined();

    window.confirm.click();
    expect(window.message()).toBe('Give the event a title.');
    window.type('spellbook-timeline-title-input', '  שביתת נשק ');
    window.type('spellbook-timeline-end-input', '1923-08');
    window.confirm.click();
    expect(window.message()).toBe('The end date must be later than the date.');
    window.type('spellbook-timeline-end-input', '1923-10');
    window.confirm.click();
    await settle(s);

    expect(s.host.created).toEqual([
      { title: 'שביתת נשק', frontmatter: { spellbook: 'event', date: '1923-09', timelines: ['Main plot'], end: '1923-10' } },
    ]);
    expect(openWindows()).toBe(0);
    expect(titles(s)).toContain('שביתת נשק');
  });

  it('dates a new event to the day when zoomed in that far, and puts one tapped into Other in no lane', async () => {
    const s = await open();
    click(button(s, 'Zoom in'));
    click(button(s, 'Zoom in'));
    tapAt(s.viewport, at(s, 380, 200));
    const window = windowParts();
    expect(window.field('spellbook-timeline-date-input').value).toMatch(/^1923-\d\d-\d\d$/);
    expect(window.modal.contentEl.withClass('spellbook-timeline-window-note')).toEqual([]);
    window.type('spellbook-timeline-title-input', 'Rumour');
    window.type('spellbook-timeline-date-input', '');
    window.confirm.click();
    await settle(s);
    // No date either: the host is asked for an undated event.
    expect(s.host.created[0]?.frontmatter).toEqual({ spellbook: 'event', date: null, timelines: [] });
  });

  it('keeps the window open and says why when the note cannot be made', async () => {
    const s = await open();
    s.host.createResult = { ok: false, message: 'There is already a note called "Siege".' };
    click(button(s, 'New event'));
    const window = windowParts();
    expect(one(window.modal.contentEl, 'spellbook-timeline-window-note').text).toBe('Lane: Main plot');
    window.type('spellbook-timeline-title-input', 'Siege');
    window.field('spellbook-timeline-title-input').fire('keydown', { key: 'Enter' });
    await settle(s);
    expect(window.message()).toBe('There is already a note called "Siege".');
    expect(openWindows()).toBe(1);
    window.modal.contentEl.fire('keydown', { key: 'Escape' });
    expect(openWindows()).toBe(0);
  });

  it('has a "more" menu on every card, with a way to do everything a drag does', async () => {
    const s = await open();
    const war = cardOf(s, 'The war begins');
    expect(more(s, 'The war begins').attrs['aria-label']).toBe('More options');
    tapAt(more(s, 'The war begins'), grip(s, war));
    expect(s.host.opened).toEqual([]);
    expect(lastMenu().outline).toEqual([
      'Open',
      'Open in new tab',
      '---',
      'Change date',
      'Move earlier',
      'Move later',
      'Entities',
      '---',
      'Move to lane',
      'Also show in lane',
      'Remove from this lane',
    ]);
    lastMenu().item('Open in new tab').click();
    expect(s.host.opened).toEqual([{ path: WAR, where: 'tab' }]);

    // The same menu with the right mouse button.
    const event = war.fire('contextmenu', { clientX: 200, clientY: 180 });
    expect(event.defaultPrevented).toBe(true);
    expect(lastMenu().position).toEqual({ x: 200, y: 180 });
    lastMenu().item('Move later').click();
    await settle(s);
    expect(s.host.changes[0]?.map((change) => [change.path, change.patch])).toEqual([[WAR, { date: '1923-04-13' }]]);
    expect(one(cardOf(s, 'The war begins'), 'spellbook-timeline-card-date').text).toBe('13 Apr 1923');
  });

  it('moves an event to another lane, shows it in one more, and takes it out of one, from the menu', async () => {
    const s = await open();
    tapAt(more(s, 'The war begins'), grip(s, cardOf(s, 'The war begins')));
    const first = lastMenu();
    first.item('Move to lane').click();
    await settle(s);
    expect(lastMenu()).not.toBe(first);
    expect(lastMenu().position).toEqual(first.position);
    expect(lastMenu().outline).toEqual(['Manuscript', 'רקע']); // not Other: it only collects
    expect(lastMenu().item('רקע').titleEl?.children[0]?.attrs['dir']).toBe('auto');
    expect(lastMenu().item('Manuscript').titleEl).toBeNull();
    lastMenu().item('רקע').click();
    await settle(s);
    expect(s.host.frontmatterOf(WAR)['timelines']).toEqual(['רקע']);
    expect(boxOf(cardOf(s, 'The war begins')).y).toBe(128);

    tapAt(more(s, 'The war begins'), grip(s, cardOf(s, 'The war begins')));
    lastMenu().item('Also show in lane').click();
    await settle(s);
    expect(lastMenu().outline).toEqual(['Manuscript', 'Main plot']);
    lastMenu().item('Main plot').click();
    await settle(s);
    expect(s.host.frontmatterOf(WAR)['timelines']).toEqual(['רקע', 'Main plot']);
    expect(cards(s).filter((card) => titleOf(card) === 'The war begins').length).toBe(2);

    tapAt(more(s, 'The war begins'), grip(s, cardOf(s, 'The war begins')));
    lastMenu().item('Remove from this lane').click();
    await settle(s);
    expect(s.host.frontmatterOf(WAR)['timelines']).toHaveLength(1);
    expect(cards(s).filter((card) => titleOf(card) === 'The war begins').length).toBe(1);
  });

  it('never offers to take a scene out of Manuscript', async () => {
    const s = await open();
    tapAt(more(s, 'Opening'), grip(s, cardOf(s, 'Opening')));
    expect(lastMenu().outline).toContain('Remove from this lane (off)');
    expect(lastMenu().outline).toContain('Move to lane');
  });

  it('changes an event\'s dates in a window, exactly as typed', async () => {
    const s = await open();
    tapAt(more(s, 'Siege'), grip(s, cardOf(s, 'Siege')));
    lastMenu().item('Change date').click();
    const window = windowParts();
    expect(window.modal.titleEl.text).toBe('Change date');
    expect(one(window.modal.contentEl, 'spellbook-timeline-window-note').text).toBe('Siege');
    expect(window.modal.contentEl.withClass('spellbook-timeline-title-input')).toEqual([]);
    expect(window.field('spellbook-timeline-date-input').value).toBe('1923-06-01');
    expect(window.field('spellbook-timeline-end-input').value).toBe('1923-08-01');

    window.type('spellbook-timeline-date-input', 'next spring');
    window.confirm.click();
    expect(window.message()).toMatch(/^Write the date as a year/);
    window.type('spellbook-timeline-date-input', '1923-05');
    window.type('spellbook-timeline-end-input', '');
    window.confirm.click();
    await settle(s);
    expect(s.host.changes[0]?.[0]?.patch).toEqual({ date: '1923-05', end: null });
    expect(openWindows()).toBe(0);
    expect(cardOf(s, 'Siege').hasClass('spellbook-is-span')).toBe(false);
  });

  it('tells the writer when the host could not write a note', async () => {
    const s = await open();
    s.host.failWrites = true;
    tapAt(more(s, 'The war begins'), grip(s, cardOf(s, 'The war begins')));
    lastMenu().item('Move earlier').click();
    await settle(s);
    expect(notices()).toEqual(['"Move earlier" did not work: the disk is full']);
  });
});

describe('dragging a card', () => {
  it('along its lane gives the event a new date, snapped to its own precision', async () => {
    const s = await open();
    const war = cardOf(s, 'The war begins');
    const from = grip(s, war);
    point(war, 'pointerdown', from.x, from.y);
    point(war, 'pointermove', from.x + 5 * DAY, from.y);
    expect(war.hasClass('spellbook-is-dragged')).toBe(true);
    expect(one(s.pane, 'spellbook-timeline').hasClass('spellbook-drag-active')).toBe(true);
    expect(s.viewport.hasPointerCapture(1)).toBe(true);
    point(war, 'pointermove', from.x + 10 * DAY, from.y);
    // The card goes with the pointer, and a label says what a drop would do.
    expect(war.style['transform']).toMatch(/^translate3d\(40\.3\d?px, 0px, 0\)$/);
    const label = one(s.pane, 'spellbook-timeline-carried');
    expect(label.hasClass('spellbook-is-hidden')).toBe(false);
    expect(label.fullText).toBe('22 Apr 1923');
    point(war, 'pointerup', from.x + 10 * DAY, from.y);
    expect(war.hasClass('spellbook-is-dragged')).toBe(false);
    expect(war.style['transform']).toBe('');
    expect(label.hasClass('spellbook-is-hidden')).toBe(true);
    expect(s.viewport.hasPointerCapture(1)).toBe(false);
    await settle(s);

    expect(s.host.changes).toHaveLength(1);
    expect(s.host.changes[0]?.[0]?.patch).toEqual({ date: '1923-04-22' });
    expect(s.host.opened).toEqual([]); // a drag is not a tap
    expect(boxOf(cardOf(s, 'The war begins')).x).toBeCloseTo(24 + 21 * DAY, 1);

    // An event dated to the month moves by whole months, and a span keeps its length.
    const stray = cardOf(s, 'Stray');
    drag(stray, grip(s, stray), { x: grip(s, stray).x + 40 * DAY, y: grip(s, stray).y });
    const siege = cardOf(s, 'Siege');
    drag(siege, grip(s, siege), { x: grip(s, siege).x - 31 * DAY, y: grip(s, siege).y });
    await settle(s);
    expect(s.host.changes[1]?.[0]?.patch).toEqual({ date: '1923-06' });
    expect(s.host.changes[2]?.[0]?.patch).toEqual({ date: '1923-05-01', end: '1923-07-01' });
  });

  it('to another lane moves the event there and leaves its date alone', async () => {
    const s = await open();
    const war = cardOf(s, 'The war begins');
    const from = grip(s, war);
    point(war, 'pointerdown', from.x, from.y);
    point(war, 'pointermove', from.x + 3, from.y + 30);
    point(war, 'pointermove', from.x + 3, from.y + 60);
    const bands = s.pane.withClass('spellbook-timeline-band');
    expect(bands.map((band) => band.hasClass('spellbook-is-drop-target'))).toEqual([false, false, true, false]);
    const label = one(s.pane, 'spellbook-timeline-carried');
    expect(label.fullText).toBe('12 Apr 1923 רקע');
    expect(one(label, 'spellbook-timeline-carried-lane').attrs['dir']).toBe('auto');
    point(war, 'pointerup', from.x + 3, from.y + 60);
    expect(bands.some((band) => band.hasClass('spellbook-is-drop-target'))).toBe(false);
    await settle(s);
    expect(s.host.changes[0]?.[0]?.patch).toEqual({ timelines: ['רקע'] });
    expect(s.host.frontmatterOf(WAR)['date']).toBe('1923-04-12');
  });

  it('re-dates a scene the same way', async () => {
    const s = await open();
    const opening = cardOf(s, 'Opening');
    drag(opening, grip(s, opening), { x: grip(s, opening).x + 4 * DAY, y: grip(s, opening).y });
    await settle(s);
    expect(s.host.changes[0]?.map((change) => [change.path, change.patch])).toEqual([[`${SCENES}Opening.md`, { date: '1923-04-05' }]]);
  });

  it('hands the host a way to make the change again from the note as it is then', async () => {
    const s = await open();
    const war = cardOf(s, 'The war begins');
    drag(war, grip(s, war), { x: grip(s, war).x + 10 * DAY, y: grip(s, war).y + 60 });
    await settle(s);
    const change = s.host.changes[0]?.[0];
    expect(change?.patch).toEqual({ date: '1923-04-22', timelines: ['רקע'] });
    // Another device has since added a lane and written the date with a time of day.
    const fresh = { date: '1923-04-12T08:00', timelines: ['Main plot', 'Side'] };
    expect(change?.remake(fresh)).toEqual({ date: '1923-04-22T08:00', timelines: ['רקע', 'Side'] });
    expect(change?.remake({ date: '1923-04-22', timelines: ['רקע'] })).toEqual({});
  });

  it('takes a press that hardly moves for a tap, and a card brought back for nothing at all', async () => {
    const s = await open();
    const war = cardOf(s, 'The war begins');
    const from = grip(s, war);
    point(war, 'pointerdown', from.x, from.y);
    point(war, 'pointermove', from.x + 2, from.y + 1);
    point(war, 'pointerup', from.x + 2, from.y + 1);
    expect(s.host.opened).toEqual([{ path: WAR, where: false }]);

    point(war, 'pointerdown', from.x, from.y);
    point(war, 'pointermove', from.x + 40, from.y);
    point(war, 'pointermove', from.x + 1, from.y);
    point(war, 'pointerup', from.x + 1, from.y);
    await settle(s);
    expect(s.host.opened).toHaveLength(1);
    expect(s.host.changes).toEqual([]);
  });

  it('is cancelled by Escape, by the device taking the pointer away, and by the notes changing under it', async () => {
    const s = await open();
    const endings: Array<() => void> = [
      () => s.viewport.fire('keydown', { key: 'Escape' }),
      () => point(cardOf(s, 'The war begins'), 'pointercancel', 0, 0),
      () => {
        s.host.set({ hiddenLanes: [] });
        s.host.timers.advance(FRAME_MS);
      },
    ];
    for (const end of endings) {
      const war = cardOf(s, 'The war begins');
      const from = grip(s, war);
      point(war, 'pointerdown', from.x, from.y);
      point(war, 'pointermove', from.x + 10 * DAY, from.y + 60);
      expect(war.hasClass('spellbook-is-dragged')).toBe(true);
      end();
      expect(war.hasClass('spellbook-is-dragged')).toBe(false);
      expect(war.style['transform']).toBe('');
      expect(s.pane.withClass('spellbook-is-drop-target')).toEqual([]);
      point(war, 'pointerup', from.x + 10 * DAY, from.y + 60);
      await settle(s);
    }
    expect(s.host.changes).toEqual([]);
    expect(s.host.opened).toEqual([]);
    expect(s.viewport.capturedPointers.size).toBe(0);
  });

  it('with a finger: moving slides the view, resting picks the card up', async () => {
    const s = await open();
    const war = cardOf(s, 'The war begins');
    const from = grip(s, war);
    drag(war, from, { x: from.x - 100, y: from.y }, 'touch');
    await settle(s);
    expect(layer(s).x).toBe(-100);
    expect(s.host.changes).toEqual([]);
    expect(s.host.opened).toEqual([]);
    const range = rangeOf(s);

    const held = grip(s, war);
    point(war, 'pointerdown', held.x, held.y, 'touch');
    expect(war.hasClass('spellbook-is-dragged')).toBe(false);
    s.host.timers.advance(TOUCH_HOLD_MS);
    expect(war.hasClass('spellbook-is-dragged')).toBe(true);
    expect(s.viewport.fire('touchmove').defaultPrevented).toBe(true);
    point(war, 'pointermove', held.x + 10 * DAY, held.y, 'touch');
    point(war, 'pointerup', held.x + 10 * DAY, held.y, 'touch');
    await settle(s);
    expect(s.host.changes[0]?.[0]?.patch).toEqual({ date: '1923-04-22' });
    expect(rangeOf(s)).toBe(range); // the view stayed where it was
  });

  it('with a finger that rests and lets go without moving: the card\'s menu', async () => {
    const s = await open();
    const war = cardOf(s, 'The war begins');
    const from = grip(s, war);
    point(war, 'pointerdown', from.x, from.y, 'touch');
    s.host.timers.advance(TOUCH_HOLD_MS);
    point(war, 'pointerup', from.x + 1, from.y, 'touch');
    expect(lastMenu().outline[0]).toBe('Open');
    expect(s.host.opened).toEqual([]);
    // The menu the device itself sends for a long press is not answered twice.
    const shown = lastMenu();
    expect(war.fire('contextmenu', { clientX: from.x, clientY: from.y }).defaultPrevented).toBe(true);
    expect(lastMenu()).toBe(shown);
  });
});

describe('clusters', () => {
  const far = (): FakeHost =>
    new FakeHost(
      sample({
        events: [
          note(`${EVENTS}Long ago.md`, { date: 1901, timelines: ['Main plot'] }),
          note(`${EVENTS}One.md`, { date: '1923-04-12', timelines: ['Main plot'] }),
          note(`${EVENTS}Two.md`, { date: '1923-05-01', timelines: ['Main plot'] }),
          note(`${EVENTS}Three.md`, { date: '1923-06-01', timelines: ['Main plot'] }),
        ],
        scenes: [],
      }),
    );

  it('are dots with a count when zoomed far out; tapping one zooms into it', async () => {
    const s = await open(far());
    expect(titles(s)).toEqual(['Long ago']);
    const dot = one(s.pane, 'spellbook-timeline-cluster');
    expect(one(dot, 'spellbook-timeline-cluster-count').text).toBe('3');
    expect(String(dot.attrs['aria-label'])).toMatch(/^3 events, 12 Apr 1923 . 1 Jun 1923\. Zoom in\.$/);
    expect(dot.hasClass('spellbook-color-purple')).toBe(true);
    expect(dot.withClass('spellbook-timeline-card-more')).toEqual([]);

    const box = boxOf(dot);
    tapAt(dot, at(s, box.x + 10, box.y + 10));
    expect(s.host.opened).toEqual([]);
    expect(s.pane.withClass('spellbook-timeline-cluster')).toEqual([]);
    expect(titles(s).sort()).toEqual(['One', 'Three', 'Two']);
    for (const title of ['One', 'Two', 'Three']) {
      const x = boxOf(cardOf(s, title)).x + layer(s).x;
      expect(x).toBeGreaterThan(0);
      expect(x).toBeLessThan(WIDE.width);
    }
  });
});

describe('undated events', () => {
  it('are counted in a strip that folds open, each with "Set date"', async () => {
    const s = await open();
    const strip = one(s.pane, 'spellbook-timeline-undated');
    expect(strip.hasClass('spellbook-is-hidden')).toBe(false);
    expect(strip.hasClass('is-collapsed')).toBe(true);
    const toggle = one(strip, 'spellbook-timeline-undated-toggle');
    expect(toggle.fullText).toBe('Undated 1');
    expect(toggle.attrs['aria-expanded']).toBe('false');
    expect(strip.withClass('spellbook-timeline-undated-row')).toEqual([]);

    click(toggle);
    expect(strip.hasClass('is-collapsed')).toBe(false);
    expect(one(strip, 'spellbook-timeline-undated-toggle').attrs['aria-expanded']).toBe('true');
    const title = one(strip, 'spellbook-timeline-undated-title');
    expect([title.text, title.attrs['dir']]).toEqual(['Loose end', 'auto']);
    click(title, { ctrlKey: true });
    expect(s.host.opened).toEqual([{ path: `${EVENTS}Loose end.md`, where: 'tab' }]);

    click(one(strip, 'spellbook-timeline-set-date'));
    const window = windowParts();
    expect(window.modal.titleEl.text).toBe('Set date');
    window.confirm.click();
    expect(window.message()).toMatch(/^Give the event a date\./);
    window.type('spellbook-timeline-date-input', '1923-07');
    window.confirm.click();
    await settle(s);
    expect(s.host.changes[0]?.map((change) => [change.path, change.patch])).toEqual([[`${EVENTS}Loose end.md`, { date: '1923-07' }]]);
    expect(strip.hasClass('spellbook-is-hidden')).toBe(true);
    expect(titles(s)).toContain('Loose end');
  });

  it('say what is wrong with a date that could not be read', async () => {
    const s = await open(new FakeHost(sample({ events: [note(`${EVENTS}Muddle.md`, { date: 'spring', end: '1923-05' })] })));
    click(one(s.pane, 'spellbook-timeline-undated-toggle'));
    expect(one(s.pane, 'spellbook-timeline-undated-problem').text).toMatch(/^The date could not be read\./);
  });
});

describe('by story order', () => {
  it('spaces the events evenly in the order the manuscript tells them', async () => {
    const s = await open();
    const byDate = button(s, 'By date');
    const byStory = button(s, BY_STORY_LABEL);
    expect([byDate.attrs['aria-pressed'], byStory.attrs['aria-pressed']]).toEqual(['true', 'false']);
    click(byStory);
    expect([byDate.attrs['aria-pressed'], byStory.attrs['aria-pressed']]).toEqual(['false', 'true']);
    expect(byStory.hasClass('is-active')).toBe(true);
    expect(rangeOf(s)).toBe('Story order');

    const places = cards(s)
      .map((card) => [titleOf(card), boxOf(card).x] as const)
      .sort((a, b) => a[1] - b[1]);
    expect(places).toEqual([
      ['Opening', 24],
      ['ילדות', 184],
      ['Ending', 344],
      ['The war begins', 504],
      ['Stray', 664],
      ['Siege', 824],
      ['Loose end', 984],
    ]);
    // No bars here; a card still shows the event's real date.
    expect(cardOf(s, 'Siege').hasClass('spellbook-is-span')).toBe(false);
    expect(one(cardOf(s, 'The war begins'), 'spellbook-timeline-card-date').text).toBe('12 Apr 1923');
    // The axis names the scenes; those names are the writer's own text.
    const ticks = one(s.pane, 'spellbook-timeline-axis').children;
    expect(ticks.map((tick) => [tick.text, tick.attrs['dir'] ?? null])).toEqual([
      ['Opening', 'auto'],
      ['Ending', 'auto'],
      ['Not in a scene', null],
    ]);
  });

  it('lets a card be carried to another lane but never re-dates it, and dates no new event by its place', async () => {
    const s = await open();
    click(button(s, BY_STORY_LABEL));
    const war = cardOf(s, 'The war begins');
    drag(war, grip(s, war), { x: grip(s, war).x + 200, y: grip(s, war).y });
    drag(war, grip(s, war), { x: grip(s, war).x + 200, y: grip(s, war).y + 60 });
    await settle(s);
    expect(s.host.changes.map((batch) => batch[0]?.patch)).toEqual([{ timelines: ['רקע'] }]);

    tapAt(s.viewport, at(s, 300, 90));
    expect(windowParts().field('spellbook-timeline-date-input').value).toBe('');

    click(button(s, 'By date'));
    expect(rangeOf(s)).toMatch(/^Apr 1923/);
    expect(cardOf(s, 'Siege').hasClass('spellbook-is-span')).toBe(true);
  });
});

describe('at phone width', () => {
  it('runs time from top to bottom and shows one lane, with a switcher for the others', async () => {
    const s = await open(new FakeHost(), PHONE);
    expect(one(s.pane, 'spellbook-timeline').hasClass('spellbook-is-vertical')).toBe(true);
    const switcher = one(s.pane, 'spellbook-timeline-switcher');
    expect(switcher.hasClass('spellbook-is-hidden')).toBe(false);
    const tabs = switcher.withClass('spellbook-timeline-lane-tab');
    expect(tabs.map((tab) => [tab.fullText, tab.attrs['aria-pressed']])).toEqual([
      ['Manuscript', 'true'],
      ['Main plot', 'false'],
      ['רקע', 'false'],
      ['Other', 'false'],
    ]);
    expect(titles(s)).toEqual(['Opening', 'Ending']);
    expect(laneNames(s)).toEqual([]);

    click(tab(s, 1));
    expect(titles(s)).toEqual(['The war begins', 'Siege']);
    expect(s.pane.withClass('spellbook-timeline-lane-tab', 'is-active').map((active) => active.fullText)).toEqual(['Main plot']);
    const war = boxOf(cardOf(s, 'The war begins'));
    expect(war.x).toBe(8);
    expect(war.width).toBe(PHONE.width - 16);
    expect(war.height).toBe(48);
    // The lane has events at the dates in view, so the view stays where it was.
    expect(war.y).toBeCloseTo(24 + 11 * DAY_DOWN, 1);
    // An event that lasts is a card like the others here, as wide as the pane; its dates are written on it.
    const siege = cardOf(s, 'Siege');
    expect(boxOf(siege)).toMatchObject({ x: 8, width: PHONE.width - 16, height: 48 });
    expect(boxOf(siege).y).toBeCloseTo(24 + 61 * DAY_DOWN, 1);
    expect(siege.hasClass('spellbook-is-span')).toBe(true);
    expect(siege.hasClass('spellbook-has-meta')).toBe(true);
    expect(one(siege, 'spellbook-timeline-card-date').text).toMatch(/^1 Jun.*1 Aug 1923$/);
    // The axis runs down the start side.
    const ticks = one(s.pane, 'spellbook-timeline-axis').children;
    const places = ticks.map((tick) => boxOf(tick).y);
    expect(places.length).toBeGreaterThan(2);
    expect([...places].sort((a, b) => a - b)).toEqual(places);
    expect(new Set(places).size).toBe(places.length);
  });

  it('does the same taps, menus and drags', async () => {
    const s = await open(new FakeHost(), PHONE);
    click(tab(s, 1));
    const war = cardOf(s, 'The war begins');
    tapAt(war, grip(s, war), 'touch');
    expect(s.host.opened).toEqual([{ path: WAR, where: false }]);

    tapAt(more(s, 'The war begins'), grip(s, war), 'touch');
    expect(lastMenu().outline).toContain('Move to lane');

    // A finger that rests picks the card up; carried down, it gets a later date.
    const from = grip(s, war);
    point(war, 'pointerdown', from.x, from.y, 'touch');
    s.host.timers.advance(TOUCH_HOLD_MS);
    point(war, 'pointermove', from.x + 80, from.y + 10 * DAY_DOWN, 'touch');
    expect(war.style['transform']).toMatch(/^translate3d\(80px, 36\.7\d?px, 0\)$/);
    point(war, 'pointerup', from.x + 80, from.y + 10 * DAY_DOWN, 'touch');
    await settle(s);
    expect(s.host.changes[0]?.[0]?.patch).toEqual({ date: '1923-04-22' }); // sideways changes no lane here

    tapAt(s.viewport, at(s, 150, 450), 'touch');
    const window = windowParts();
    expect(one(window.modal.contentEl, 'spellbook-timeline-window-note').text).toBe('Lane: Main plot');
    expect(window.field('spellbook-timeline-date-input').value).toBe('1923-08');
  });

  it('slides up and down under a finger, and leaves a sideways swipe to Obsidian', async () => {
    const s = await open(new FakeHost(), PHONE);
    drag(s.viewport, at(s, 150, 300), at(s, 150, 200), 'touch');
    await settle(s);
    expect(layer(s)).toEqual({ x: 0, y: -100 });
    expect(rangeOf(s)).not.toMatch(/^Apr 1923/);

    point(s.viewport, 'pointerdown', 200, 400, 'touch');
    point(s.viewport, 'pointermove', 120, 402, 'touch');
    expect(s.viewport.fire('touchmove').defaultPrevented).toBe(false);
    point(s.viewport, 'pointermove', 60, 500, 'touch');
    point(s.viewport, 'pointerup', 60, 500, 'touch');
    await settle(s);
    expect(layer(s)).toEqual({ x: 0, y: -100 });
    expect(openWindows()).toBe(0);
  });

  it('goes back to the wide layout when the pane grows, fitted afresh', async () => {
    const s = await open(new FakeHost(), PHONE);
    resize(s, WIDE);
    expect(one(s.pane, 'spellbook-timeline').hasClass('spellbook-is-vertical')).toBe(false);
    expect(laneNames(s)).toEqual(['Manuscript', 'Main plot', 'רקע', 'Other']);
    expect(boxOf(cardOf(s, 'Opening'))).toMatchObject({ x: 24, y: 8 });
    expect(boxOf(cardOf(s, 'Siege')).width).toBeCloseTo(61 * DAY, 1);
  });

  it('opens on the events of the lane on show, not on an empty stretch', async () => {
    // The backstory is fifty years before the manuscript: fitted together, either lane would open empty.
    const host = new FakeHost(
      sample({
        timelines: [{ name: 'Main plot', color: 'purple' }, { name: 'Backstory', color: 'orange' }],
        events: [
          note(`${EVENTS}The war begins.md`, { date: '1923-04-12', timelines: ['Main plot'] }),
          note(`${EVENTS}The old king dies.md`, { date: '1873-01-05', timelines: ['Backstory'] }),
          note(`${EVENTS}A treaty.md`, { date: '1890-06-01', timelines: ['Backstory'] }),
        ],
      }),
    );
    const s = await open(host, PHONE);
    const inView = (title: string): boolean => {
      const box = boxOf(cardOf(s, title));
      const top = box.y + layer(s).y;
      return top >= 0 && top + box.height <= PHONE.height;
    };
    expect(titles(s)).toEqual(['Opening', 'Ending']);
    expect(inView('Opening') && inView('Ending')).toBe(true);
    expect(boxOf(cardOf(s, 'Opening')).y).toBe(24); // the first one at the top, with a little air
    expect(rangeOf(s)).toMatch(/1923/);

    // The plot's one event is among the dates in view: the view stays put.
    click(tab(s, 1));
    expect(inView('The war begins')).toBe(true);
    expect(rangeOf(s)).toMatch(/1923/);

    // The backstory has nothing there: the view goes to where its events are.
    click(tab(s, 2));
    await settle(s);
    expect(titles(s)).toEqual(['The old king dies', 'A treaty']);
    expect(inView('The old king dies') && inView('A treaty')).toBe(true);
    expect(rangeOf(s)).toMatch(/^187\d/);

    // "Fit" fits the lane on show as well.
    drag(s.viewport, at(s, 150, 100), at(s, 150, 400), 'touch');
    await settle(s);
    click(button(s, 'Fit'));
    await settle(s);
    expect(inView('The old king dies') && inView('A treaty')).toBe(true);
  });

  it('gives every card the width of the pane, one under the other, also when they are at the same moment', async () => {
    const host = new FakeHost(
      sample({
        events: [
          ...[0, 1, 2, 3].map((index) => note(`${EVENTS}Same day ${index}.md`, { date: '1923-04-12', timelines: ['Main plot'] })),
          note(`${EVENTS}מכתב.md`, { date: '1923-04-12', timelines: ['Main plot'] }),
          note(`${EVENTS}All spring.md`, { date: '1923-04-12', end: '1923-06-20', timelines: ['Main plot'] }),
        ],
        scenes: [],
      }),
    );
    for (const size of [PHONE, { ...PHONE, pane: 200, width: 124 }]) {
      const s = await open(host, size);
      // No scene has a date, so the manuscript's lane is empty: the view opens on the first lane that has events.
      expect(s.pane.withClass('spellbook-timeline-lane-tab', 'is-active').map((active) => active.fullText)).toEqual(['Main plot']);
      expect(s.pane.withClass('spellbook-timeline-lane-tab')[0]?.fullText).toBe('Manuscript');
      // In time order; at the same moment the one that lasts first, then as they came.
      expect(titles(s)).toEqual(['All spring', 'Same day 0', 'Same day 1', 'Same day 2', 'Same day 3', 'מכתב']);
      const boxes = cards(s).map(boxOf);
      boxes.forEach((box, index) => {
        expect(box.x).toBe(8);
        expect(box.width).toBe(size.width - 16);
        expect(box.x + box.width).toBeLessThanOrEqual(size.width); // never past the pane
        expect(box.height).toBe(48);
        const above = boxes[index - 1];
        if (above) expect(box.y).toBe(above.y + above.height + 6);
      });
      // Nothing is wider than the pane, so there is nothing to scroll sideways.
      drag(s.viewport, at(s, 100, 300), at(s, 20, 300), 'touch');
      await settle(s);
      expect(layer(s).x).toBe(0);
      await s.shell.close();
    }
  });
});

describe('room at the bottom of a wide pane', () => {
  it('lets the last lane be scrolled clear of the status bar that floats over the bottom of the pane', async () => {
    const s = await open();
    const bands = s.pane.withClass('spellbook-timeline-band').map(boxOf);
    const last = bands[bands.length - 1];
    if (!last) throw new Error('no lanes');
    const lanesEnd = last.y + last.height;
    expect(lanesEnd).toBeLessThan(WIDE.height);

    // A pane exactly as tall as the lanes: the last lane ends at the bottom edge, under the bar.
    resize(s, { ...WIDE, height: lanesEnd });
    await settle(s);
    drag(s.viewport, at(s, 300, lanesEnd - 10), at(s, 300, lanesEnd - 210));
    await settle(s);
    expect(END_ROOM).toBeGreaterThanOrEqual(40); // taller than the bar
    expect(layer(s)).toEqual({ x: 0, y: -END_ROOM }); // that far, and no further
    // The lanes' names move with their lanes.
    expect(one(s.pane, 'spellbook-timeline-names-layer').style['transform']).toBe(`translate3d(0, ${-END_ROOM}px, 0)`);

    // With that much room to spare under the last lane, nothing needs to scroll.
    resize(s, { ...WIDE, height: lanesEnd + END_ROOM });
    await settle(s);
    drag(s.viewport, at(s, 300, lanesEnd - 10), at(s, 300, lanesEnd - 210));
    await settle(s);
    expect(layer(s)).toEqual({ x: 0, y: 0 });
  });
});

describe('a large book', () => {
  const big = (count: number, perDay: number) =>
    sample({
      events: Array.from({ length: count }, (_, index) => {
        const day = String(1 + (Math.floor(index / perDay) % 28)).padStart(2, '0');
        const month = String(1 + (Math.floor(index / perDay / 28) % 12)).padStart(2, '0');
        const year = 1900 + Math.floor(index / perDay / 336);
        return note(`${EVENTS}Event ${index}.md`, { date: `${year}-${month}-${day}`, timelines: ['Main plot'] });
      }),
      scenes: [],
    });

  it('only draws the cards near what can be seen, of 2,000 events', async () => {
    const s = await open(new FakeHost(big(2000, 1)));
    for (let press = 0; press < 12; press++) click(button(s, 'Zoom in'));
    await settle(s);
    expect(s.pane.withClass('spellbook-timeline-cluster')).toEqual([]);
    const near = cards(s).length;
    expect(near).toBeGreaterThan(3);
    expect(near).toBeLessThan(120);

    // Sliding a long way brings other cards, and lets go of the old ones.
    const first = titles(s);
    for (let step = 0; step < 6; step++) {
      drag(s.viewport, at(s, 700, 300), at(s, 100, 300));
      await settle(s);
    }
    expect(cards(s).length).toBeLessThan(120);
    expect(titles(s).some((title) => first.includes(title))).toBe(false);
    expect(titles(s).length).toBeGreaterThan(3);
  });

  it('makes new cards a batch per frame', async () => {
    const s = await open(new FakeHost(sample({ events: [], scenes: [] })), { ...WIDE, height: 3000 });
    s.host.set(big(900, 15));
    s.host.timers.advance(FRAME_MS);
    expect(cards(s).length).toBe(CARDS_PER_FRAME);
    s.host.timers.advance(FRAME_MS);
    expect(cards(s).length).toBe(2 * CARDS_PER_FRAME);
    await settle(s);
    expect(cards(s).length).toBeGreaterThan(2 * CARDS_PER_FRAME);
    expect(cards(s).length).toBeLessThanOrEqual(900);
    expect(new Set(cards(s)).size).toBe(cards(s).length);
  });
});
