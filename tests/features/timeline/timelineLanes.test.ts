// The window that lists the timeline's lanes, driven through the stand-ins:
// add, rename, recolour, reorder and remove a lane, and hide or show it on
// this device. Every change must reach the host as the engine made it.

import { beforeEach, describe, expect, it } from 'vitest';
import { LANES_WINDOW_TITLE } from '../../../src/features/timeline/lanesModal';
import type { FakeElement, Modal as StubModal } from '../../obsidianStub';
import { EVENTS, FakeHost, sample } from './fakeHost';
import {
  boxOf,
  button,
  cardOf,
  clearScreen,
  click,
  laneNames,
  lastMenu,
  notices,
  one,
  open,
  openWindow,
  openWindows,
  settle,
  windowParts,
} from './screen';
import type { Stage } from './screen';

interface LanesWindow {
  s: Stage;
  modal: StubModal;
  names: () => string[];
  row: (name: string) => FakeElement;
  /** Tap a lane's "more" button and give the menu that opens. */
  menu: (name: string) => ReturnType<typeof lastMenu>;
}

async function lanesWindow(host: FakeHost = new FakeHost()): Promise<LanesWindow> {
  const s = await open(host);
  click(button(s, 'Lanes'));
  const modal = openWindow();
  const rows = (): FakeElement[] => modal.contentEl.withClass('spellbook-timeline-lane-row');
  const nameOf = (row: FakeElement): string => one(row, 'spellbook-timeline-lane-title').text;
  const row = (name: string): FakeElement => {
    const found = rows().find((candidate) => nameOf(candidate) === name);
    if (!found) throw new Error(`no lane called "${name}" in the window`);
    return found;
  };
  return {
    s,
    modal,
    names: () => rows().map(nameOf),
    row,
    menu: (name) => {
      click(one(row(name), 'spellbook-timeline-lane-more'));
      return lastMenu();
    },
  };
}

const lanesOf = (host: FakeHost): unknown => host.data?.timelines;

beforeEach(() => {
  clearScreen();
});

describe('the lanes window', () => {
  it('lists every lane in order, the built-in ones with a word of explanation', async () => {
    const w = await lanesWindow();
    expect(w.modal.titleEl.text).toBe(LANES_WINDOW_TITLE);
    expect(w.names()).toEqual(['Manuscript', 'Main plot', 'רקע', 'Other']);
    expect(w.modal.contentEl.withClass('spellbook-timeline-lane-note').map((note) => note.text)).toEqual([
      'Scenes that have a date',
      'Events that name no listed lane',
    ]);
    // Only the lanes the writer named hold the writer's own text.
    const titles = w.modal.contentEl.withClass('spellbook-timeline-lane-title');
    expect(titles.map((title) => title.attrs['dir'] ?? null)).toEqual([null, 'auto', 'auto', null]);
    expect(one(w.row('Main plot'), 'spellbook-timeline-swatch').hasClass('spellbook-color-purple')).toBe(true);
    expect(one(w.row('Main plot'), 'spellbook-timeline-lane-more').attrs['aria-label']).toBe('More options');
  });

  it('adds a lane, and says why a name will not do', async () => {
    const w = await lanesWindow();
    click(one(w.modal.contentEl, 'spellbook-timeline-lane-add'));
    const prompt = windowParts();
    expect(prompt.modal.titleEl.text).toBe('New lane');
    prompt.type('spellbook-prompt-input', 'main PLOT');
    prompt.confirm.click();
    await settle(w.s);
    expect(prompt.message()).toMatch(/already a lane named/);
    expect(openWindows()).toBe(2);

    prompt.type('spellbook-prompt-input', '  Subplot ');
    prompt.confirm.click();
    await settle(w.s);
    expect(openWindows()).toBe(1);
    expect(lanesOf(w.s.host)).toEqual([{ name: 'Main plot', color: 'purple' }, { name: 'רקע', color: 'green' }, { name: 'Subplot' }]);
    // The window and the timeline behind it both show the new lane.
    expect(w.names()).toEqual(['Manuscript', 'Main plot', 'רקע', 'Subplot', 'Other']);
    expect(laneNames(w.s)).toEqual(['Manuscript', 'Main plot', 'רקע', 'Subplot', 'Other']);
  });

  it('renames a lane, and hands the host the change for every event that names it', async () => {
    const w = await lanesWindow();
    w.menu('Main plot').item('Rename').click();
    const prompt = windowParts();
    expect(prompt.field('spellbook-prompt-input').value).toBe('Main plot');
    prompt.type('spellbook-prompt-input', 'רקע');
    prompt.confirm.click();
    await settle(w.s);
    expect(prompt.message()).toMatch(/already a lane named/);
    expect(w.s.host.laneSaves).toEqual([]); // refused before the host was asked

    prompt.type('spellbook-prompt-input', 'Plot A');
    prompt.confirm.click();
    await settle(w.s);
    const saved = w.s.host.laneSaves[0];
    expect(saved?.result.ok).toBe(true);
    expect(saved?.noteChanges.map((change) => [change.path, change.patch])).toEqual([
      [`${EVENTS}The war begins.md`, { timelines: ['Plot A'] }],
      [`${EVENTS}Siege.md`, { timelines: ['Plot A'] }],
      [`${EVENTS}Loose end.md`, { timelines: ['Plot A'] }],
    ]);
    // Made again from a note as another device left it, the change keeps what it did not ask about.
    expect(saved?.noteChanges[0]?.remake({ timelines: ['main plot', 'Side'] })).toEqual({ timelines: ['Plot A', 'Side'] });
    expect(saved?.noteChanges[0]?.remake({ timelines: ['Side'] })).toEqual({});

    expect(lanesOf(w.s.host)).toEqual([{ name: 'Plot A', color: 'purple' }, { name: 'רקע', color: 'green' }]);
    expect(w.s.host.frontmatterOf(`${EVENTS}Siege.md`)['timelines']).toEqual(['Plot A']);
    expect(laneNames(w.s)).toEqual(['Manuscript', 'Plot A', 'רקע', 'Other']);
    expect(boxOf(cardOf(w.s, 'Siege')).y).toBe(68); // still in its lane, not in Other
  });

  it('gives a lane another colour, or none', async () => {
    const w = await lanesWindow();
    const first = w.menu('Main plot');
    first.item('Colour').click();
    await settle(w.s);
    const colours = lastMenu();
    expect(colours).not.toBe(first);
    expect(colours.outline).toEqual(['No colour', 'Red', 'Orange', 'Yellow', 'Green', 'Cyan', 'Blue', 'Purple', 'Pink']);
    expect(colours.items.filter((item) => item.checked).map((item) => item.title)).toEqual(['Purple']);
    colours.item('Red').click();
    await settle(w.s);
    expect(lanesOf(w.s.host)).toEqual([{ name: 'Main plot', color: 'red' }, { name: 'רקע', color: 'green' }]);
    expect(one(w.row('Main plot'), 'spellbook-timeline-swatch').hasClass('spellbook-color-red')).toBe(true);
    expect(cardOf(w.s, 'Siege').hasClass('spellbook-color-red')).toBe(true);
    expect(cardOf(w.s, 'Siege').hasClass('spellbook-color-purple')).toBe(false);

    w.menu('Main plot').item('Colour').click();
    await settle(w.s);
    lastMenu().item('No colour').click();
    await settle(w.s);
    expect(lanesOf(w.s.host)).toEqual([{ name: 'Main plot' }, { name: 'רקע', color: 'green' }]);
  });

  it('moves a lane up and down, and offers no move that would change nothing', async () => {
    const w = await lanesWindow();
    expect(w.menu('Manuscript').outline).toContain('Move up (off)');
    expect(w.menu('רקע').outline).toContain('Move down (off)'); // the last of the listed lanes
    w.menu('Main plot').item('Move down').click();
    await settle(w.s);
    expect(w.names()).toEqual(['Manuscript', 'רקע', 'Main plot', 'Other']);
    expect(laneNames(w.s)).toEqual(['Manuscript', 'רקע', 'Main plot', 'Other']);
    w.menu('Main plot').item('Move up').click();
    await settle(w.s);
    expect(lanesOf(w.s.host)).toEqual([{ name: 'Main plot', color: 'purple' }, { name: 'רקע', color: 'green' }]);
  });

  it('removes a lane after asking, and keeps its events: they show in Other', async () => {
    const w = await lanesWindow();
    expect(w.menu('Manuscript').outline).toEqual(['Rename (off)', 'Colour', '---', 'Move up (off)', 'Move down', '---', 'Remove (off)']);
    w.menu('Main plot').item('Remove').click();
    const question = windowParts();
    expect(question.modal.titleEl.text).toBe('Remove the lane "Main plot"?');
    question.cancel.click();
    await settle(w.s);
    expect(w.s.host.laneSaves).toEqual([]);

    w.menu('Main plot').item('Remove').click();
    windowParts().confirm.click();
    await settle(w.s);
    expect(lanesOf(w.s.host)).toEqual([{ name: 'רקע', color: 'green' }]);
    expect(w.names()).toEqual(['Manuscript', 'רקע', 'Other']);
    expect(w.s.host.frontmatterOf(`${EVENTS}Siege.md`)['timelines']).toEqual(['Main plot']);
    expect(boxOf(cardOf(w.s, 'Siege')).y).toBeGreaterThanOrEqual(120); // in Other now
  });

  it('hides a lane on this device and shows it again', async () => {
    const w = await lanesWindow();
    const toggle = (): FakeElement => one(w.row('רקע'), 'spellbook-timeline-lane-toggle');
    expect([toggle().text, toggle().attrs['aria-pressed']]).toEqual(['Hide', 'false']);
    click(toggle());
    await settle(w.s);
    expect(w.s.host.hidden).toEqual([['רקע']]);
    expect(lanesOf(w.s.host)).toEqual(sample().timelines); // nothing was stored in the project
    expect([toggle().text, toggle().attrs['aria-pressed']]).toEqual(['Show', 'true']);
    expect(w.row('רקע').hasClass('spellbook-is-hidden-lane')).toBe(true);
    expect(w.row('רקע').fullText).toMatch(/Hidden on this device/);
    expect(w.names()).toEqual(['Manuscript', 'Main plot', 'רקע', 'Other']); // still listed, to be shown again
    expect(laneNames(w.s)).toEqual(['Manuscript', 'Main plot', 'Other']);

    click(toggle());
    await settle(w.s);
    expect(w.s.host.hidden).toEqual([['רקע'], []]);
    expect(laneNames(w.s)).toEqual(['Manuscript', 'Main plot', 'רקע', 'Other']);
  });

  it('says so, and writes nothing, when the stored lanes cannot be read', async () => {
    const w = await lanesWindow(new FakeHost(sample({ timelines: 7 })));
    expect(w.modal.contentEl.withClass('spellbook-timeline-alert').map((alert) => alert.text)).toEqual([
      'The "timelines" property of the project is not a list of lanes, so it was left as it is.',
    ]);
    w.menu('Manuscript').item('Colour').click();
    await settle(w.s);
    lastMenu().item('Blue').click();
    await settle(w.s);
    expect(lanesOf(w.s.host)).toBe(7);
    expect(notices().join(' ')).toMatch(/not a list of lanes/);
  });

  it('stops following the timeline when it closes', async () => {
    const w = await lanesWindow();
    expect(w.s.host.listening).toBe(1); // the timeline alone listens to the host; the window follows the timeline
    w.modal.close();
    expect(w.modal.contentEl.children).toEqual([]);
    w.s.host.set({ timelines: [{ name: 'Only' }] });
    await settle(w.s);
    expect(w.modal.contentEl.children).toEqual([]);
    expect(laneNames(w.s)).toEqual(['Manuscript', 'Only', 'Other']);
  });

  it('is left with nothing to follow when the timeline closes first', async () => {
    const w = await lanesWindow();
    await w.s.shell.close();
    expect(w.s.host.listening).toBe(0);
    w.s.host.set({ timelines: [{ name: 'Only' }] });
    await settle(w.s);
    expect(w.s.host.timers.pending).toBe(0);
    w.modal.close();
  });
});
