// The world lanes of the timeline, driven through a stand-in host: the
// switch, the rows drawn to scale, a tap that shows the sheet, the menu, a
// drag that re-dates an entity like an event (writing only what changed),
// the lanes window, the world's history, the filter, and the phone layout.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyFrontmatterPatch } from '../../../src/core/timeline';
import type { TimelineNote } from '../../../src/core/timeline';
import { readContent } from '../../../src/features/timeline/timelineScene';
import type { NoteChange, TimelineData, WorldLaneChoice } from '../../../src/features/timeline/timelineHost';
import { TOUCH_HOLD_MS } from '../../../src/ui/dragDrop';
import { point } from '../../binderScreen';
import { resetPlatform } from '../../obsidianStub';
import type { FakeElement } from '../../obsidianStub';
import { FakeHost, note, sample } from './fakeHost';
import { PHONE, at, boxOf, button, cardOf, clearScreen, drag, grip, laneNames, lastMenu, open, openWindow, openWindows, settle, tapAt } from './screen';
import type { Stage } from './screen';

const MARA = 'World/Characters/Mara.md';
const MARA_HE = 'World/Characters/מארה.md';
const SALTWICK = 'World/Places/Saltwick.md';

// Paths of the World folder are written from the project's folder on, as the plugin's host hands them out.
/** Three entities in 1923, near the sample's events: a span with a moment, a point, and a point with a Hebrew name. */
const WORLD: TimelineNote[] = [
  note(MARA, { type: 'character', date: '1923-03-01', end: '1923-09-01', moments: ['1923-05-15 | sails'] }),
  note(MARA_HE, { type: 'character', date: '1923-04-20' }),
  note(SALTWICK, { type: 'place', date: '1923-06-10' }),
  note('World/Items/Lamp.md', { type: 'item' }),
];

/** A host that also knows the world: its notes, the device's choice, and the sheets it was asked to show. */
class WorldHost extends FakeHost {
  readonly choices: WorldLaneChoice[] = [];
  readonly sheets: string[] = [];
  offersSheets = true;

  override setWorldLanes(choice: WorldLaneChoice): void {
    this.choices.push(choice);
    this.set({ worldLanes: choice });
  }

  override showEntity(path: string): boolean {
    if (!this.offersSheets) return false;
    this.sheets.push(path);
    return true;
  }

  override async applyNoteChanges(changes: readonly NoteChange[]): Promise<void> {
    this.changes.push([...changes]);
    const rewrite = (entry: TimelineNote): TimelineNote => {
      const change = changes.find((candidate) => candidate.path === entry.path);
      if (!change) return entry;
      const frontmatter = { ...(entry.frontmatter as Record<string, unknown>) };
      applyFrontmatterPatch(frontmatter, change.remake(frontmatter));
      return { path: entry.path, frontmatter };
    };
    const data = this.data as TimelineData;
    this.set({ worldNotes: (data.worldNotes ?? []).map(rewrite), events: data.events.map(rewrite) });
  }
}

function worldData(on = true): TimelineData {
  return sample({ worldNotes: WORLD, world: WORLD.map((entry) => entry.path), folder: 'Novel', worldLanes: { on, hidden: [] } });
}

async function stage(on = true): Promise<Stage & { host: WorldHost }> {
  const s = await open(new WorldHost(worldData(on)));
  return s as Stage & { host: WorldHost };
}

/** The size of a day on the screen, read from where the two points of the sample world stand. */
function dayWidth(s: Stage): number {
  const he = boxOf(cardOf(s, 'מארה')).x;
  const town = boxOf(cardOf(s, 'Saltwick')).x;
  return (town - he) / 51; // 20 April to 10 June
}

beforeEach(() => {
  clearScreen();
});

afterEach(() => {
  resetPlatform();
});

describe('the World switch', () => {
  it('adds one lane per type that has dated entities after the other lanes, and takes them away again', async () => {
    const s = await stage(false);
    expect(laneNames(s)).toEqual(['Manuscript', 'Main plot', 'רקע', 'Other']);
    const world = button(s, 'World');
    expect(world.getAttr('aria-pressed')).toBe('false');
    world.fire('click');
    await settle(s);
    expect(s.host.choices).toEqual([{ on: true, hidden: [] }]);
    expect(laneNames(s)).toEqual(['Manuscript', 'Main plot', 'רקע', 'Other', 'Characters', 'Places']);
    expect(button(s, 'World').getAttr('aria-pressed')).toBe('true');
    button(s, 'World').fire('click');
    await settle(s);
    expect(laneNames(s)).toEqual(['Manuscript', 'Main plot', 'רקע', 'Other']);
    // A choice of this device: nothing is written into a note.
    expect(s.host.changes).toEqual([]);
  });

  it('shows the world by date only: story order has no world lanes', async () => {
    const s = await stage();
    button(s, 'By story order').fire('click');
    await settle(s);
    expect(laneNames(s)).not.toContain('Characters');
  });
});

describe('an entity on its lane', () => {
  it('is a bar from its date to its end, with its moments as small points and its name on it', async () => {
    const s = await stage();
    const mara = cardOf(s, 'Mara');
    const day = dayWidth(s);
    expect(mara.hasClass('spellbook-timeline-world')).toBe(true);
    expect(mara.hasClass('spellbook-is-span')).toBe(true);
    const bar = mara.withClass('spellbook-timeline-world-bar')[0] as FakeElement;
    expect(Number.parseFloat(bar.style['inlineSize'] ?? '')).toBeCloseTo(184 * day, 0);
    const dot = mara.withClass('spellbook-timeline-world-dot')[0] as FakeElement;
    expect(Number.parseFloat(dot.style['insetInlineStart'] ?? '')).toBeCloseTo(75 * day, 0);
    expect(dot.getAttr('title')).toBe('15 May 1923: sails');
    expect(mara.getAttr('aria-label')).toBe('Mara, Character, Born 1 Mar 1923, Died 1 Sep 1923, 1 moment');
    // A point, with a Hebrew name that takes its own direction.
    const he = cardOf(s, 'מארה');
    expect(he.hasClass('spellbook-is-point')).toBe(true);
    expect(he.withClass('spellbook-timeline-world-mark')).toHaveLength(1);
    expect(he.withClass('spellbook-timeline-card-title')[0]?.getAttr('dir')).toBe('auto');
  });

  it('shows the sheet on a tap, or the note when nobody offers a sheet', async () => {
    const s = await stage();
    tapAt(cardOf(s, 'Saltwick'), grip(s, cardOf(s, 'Saltwick')));
    expect(s.host.sheets).toEqual([SALTWICK]);
    expect(s.host.opened).toEqual([]);
    s.host.offersSheets = false;
    tapAt(cardOf(s, 'Saltwick'), grip(s, cardOf(s, 'Saltwick')));
    expect(s.host.opened).toEqual([{ path: SALTWICK, where: false }]);
  });

  it('has a menu with "Open note", and the ways to move it without dragging', async () => {
    const s = await stage();
    const town = cardOf(s, 'Saltwick');
    const from = grip(s, town);
    point(town, 'pointerdown', from.x, from.y, 'touch');
    s.host.timers.advance(TOUCH_HOLD_MS);
    point(town, 'pointerup', from.x, from.y, 'touch');
    expect(lastMenu().outline).toEqual(['Open sheet', 'Open note', 'Open note in new tab', '---', 'Move earlier', 'Move later']);
    lastMenu().item('Open note').click();
    expect(s.host.opened).toEqual([{ path: SALTWICK, where: false }]);
    lastMenu().item('Move later').click();
    await settle(s);
    expect(s.host.changes[0]?.map((change) => [change.path, change.patch])).toEqual([[SALTWICK, { date: '1923-06-11' }]]);
  });

  it('is re-dated by a drag like an event, writing only the property that changed', async () => {
    const s = await stage();
    const day = dayWidth(s);
    const town = cardOf(s, 'Saltwick');
    drag(town, grip(s, town), { x: grip(s, town).x + 10 * day, y: grip(s, town).y + 200 });
    await settle(s);
    // Only "date": a point has no end, and the entity stays in the lane of its type.
    expect(s.host.changes[0]?.map((change) => [change.path, change.patch])).toEqual([[SALTWICK, { date: '1923-06-20' }]]);
    // A span keeps its length; its moments stay where they are.
    const mara = cardOf(s, 'Mara');
    drag(mara, grip(s, mara), { x: grip(s, mara).x - 31 * day, y: grip(s, mara).y });
    await settle(s);
    expect(s.host.changes[1]?.[0]?.patch).toEqual({ date: '1923-01-29', end: '1923-08-01' });
    expect(s.host.data?.worldNotes?.find((entry) => entry.path === MARA)?.frontmatter).toEqual({
      type: 'character',
      date: '1923-01-29',
      end: '1923-08-01',
      moments: ['1923-05-15 | sails'],
    });
  });

  it('takes no new event on the ground of a world lane', async () => {
    const s = await stage();
    const bands = s.pane.withClass('spellbook-timeline-band');
    const places = bands[bands.length - 1] as FakeElement;
    const y = Number.parseFloat(places.style['insetBlockStart'] ?? '') + Number.parseFloat(places.style['blockSize'] ?? '') - 3;
    tapAt(s.viewport, at(s, 5, y));
    expect(openWindows()).toBe(0);
  });
});

describe('the lanes window and the world\'s history', () => {
  it('lists the world lanes per type, each to hide or show on this device', async () => {
    const s = await stage();
    button(s, 'Lanes').fire('click');
    const rows = (): FakeElement[] => openWindow().contentEl.withClass('spellbook-timeline-world-row');
    expect(rows().map((row) => row.withClass('spellbook-timeline-world-name')[0]?.text)).toEqual(['World', 'Characters', 'Places']);
    (rows()[2]?.withClass('spellbook-timeline-world-toggle')[0] as FakeElement).fire('click');
    await settle(s);
    expect(s.host.choices.at(-1)).toEqual({ on: true, hidden: ['place'] });
    expect(laneNames(s)).not.toContain('Places');
  });

  it('opens with the world on and the scenes\' lane off, fitted to the world\'s dates', async () => {
    const s = await stage(false);
    s.view.showWorldHistory();
    await settle(s);
    expect(s.host.choices).toEqual([{ on: true, hidden: [] }]);
    expect(s.host.hidden).toEqual([['Manuscript']]);
    expect(laneNames(s)).toEqual(['Main plot', 'רקע', 'Other', 'Characters', 'Places']);
    // Mara's bar starts at the start of the view, with the usual room before it.
    expect(boxOf(cardOf(s, 'Mara')).x).toBeCloseTo(24, 0);
  });
});

describe('the filter and the phone', () => {
  it('narrows the world lanes with "Only events with"', () => {
    const content = readContent(worldData(), ['note:world/characters/mara.md']);
    expect(content.world.shown.map((lane) => [lane.name, lane.rows.map((row) => row.entity.name)])).toEqual([['Characters', ['Mara']]]);
  });

  it('shows a world lane as a tab of its own at phone width, with each entity a card that has its dates', async () => {
    const s = await open(new WorldHost(worldData()), PHONE);
    const tabs = s.pane.withClass('spellbook-timeline-lane-tab');
    expect(tabs.map((tab) => tab.fullText)).toEqual(['Manuscript', 'Main plot', 'רקע', 'Other', 'Characters', 'Places']);
    (tabs[4] as FakeElement).fire('click');
    await settle(s);
    const mara = cardOf(s, 'Mara');
    expect(mara.withClass('spellbook-timeline-card-meta')[0]?.fullText).toBe(`1 Mar 1923 ${String.fromCharCode(0x2013)} 1 Sep 1923 1 moment`);
    expect(mara.withClass('spellbook-timeline-card-more')).toHaveLength(1);
  });
});
