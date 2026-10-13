// The planner view as a whole, driven through a stand-in host
// (tests/features/planner/plannerStage.ts): what it is, which layout it
// chooses, how it follows the host, and what it leaves behind when it closes.
// How it looks can only be checked in Obsidian.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SIDE_BY_SIDE_FROM, TABS_BELOW } from '../../../src/features/planner/plannerModel';
import {
  NO_PROJECT_MESSAGE,
  PLANNER_VIEW_NAME,
  PLANNER_VIEW_TYPE,
  PlannerView,
  createPlannerView,
} from '../../../src/features/planner/plannerView';
import { FakeObsidian } from '../../fakeObsidianApp';
import { ManualTimers } from '../../memoryVault';
import { FakeElement, Platform as StubPlatform, fakeDocument, fakeWindow, resetPlatform } from '../../obsidianStub';
import {
  FakeHost,
  FakeWords,
  clearScreen,
  click,
  headButton,
  listPicture,
  monthName,
  notices,
  one,
  resize,
  settle,
  stagePlanner,
} from './plannerStage';

beforeEach(() => {
  clearScreen();
});

afterEach(() => {
  resetPlatform();
  vi.restoreAllMocks();
});

const TODO = ['- [ ] Send chapter one \u{1F4C5} 2026-10-20', '- [x] Choose a name for the ferry', '- [ ] Call the printer'].join('\n');

describe('the view itself', () => {
  it('is the Planner, with an icon, and stays where it is put', async () => {
    const { view } = await stagePlanner();
    expect(PLANNER_VIEW_TYPE).toBe('spellbook-planner');
    expect(view.getViewType()).toBe('spellbook-planner');
    expect(view.getDisplayText()).toBe(PLANNER_VIEW_NAME);
    expect(view.getIcon()).toBe('calendar-check');
    expect(view.navigation).toBe(false);
    expect(view).toBeInstanceOf(PlannerView);
  });

  it('has both parts: a calendar and a to-do list', async () => {
    const { pane } = await stagePlanner({ todo: TODO });
    expect(one(pane, 'spellbook-planner').hasClass('spellbook-has-no-project')).toBe(false);
    expect(monthName(pane)).toBe('October 2026');
    expect(listPicture(pane, 'open')).toEqual(['[ ] Send chapter one {20 Oct}', '[ ] Call the printer']);
  });

  it('marks its pane with its own class only, and gives every class it adds its prefix', async () => {
    const { pane } = await stagePlanner({ todo: TODO, marks: { '2026-10-20': { color: 'red', label: 'Deadline' } } });
    expect(pane.hasClass('spellbook-planner-pane')).toBe(true);
    // Obsidian's own classes that the view borrows on purpose, for a native look.
    const borrowed = new Set(['view-content', 'clickable-icon', 'svg-icon']);
    for (const element of pane.all()) {
      for (const cls of element.classes) {
        expect(borrowed.has(cls) || cls.startsWith('spellbook-'), cls).toBe(true);
      }
    }
  });
});

describe('with no project', () => {
  it('says what to do, and shows neither part', async () => {
    const { pane } = await stagePlanner({
      setup: (host) => {
        host.key = null;
      },
    });
    expect(one(pane, 'spellbook-planner').hasClass('spellbook-has-no-project')).toBe(true);
    expect(one(pane, 'spellbook-planner-message').text).toBe(NO_PROJECT_MESSAGE);
  });

  it('fills in as soon as a project is open, and empties again when it is closed', async () => {
    const s = await stagePlanner({
      todo: TODO,
      setup: (host) => {
        host.key = null;
      },
    });
    s.host.key = 'Novel/Novel.md';
    s.host.sync();
    await settle(s);
    expect(one(s.pane, 'spellbook-planner').hasClass('spellbook-has-no-project')).toBe(false);
    expect(one(s.pane, 'spellbook-planner-message').text).toBe('');
    expect(listPicture(s.pane, 'open')).toHaveLength(2);

    s.host.key = null;
    s.host.sync();
    await settle(s);
    expect(one(s.pane, 'spellbook-planner').hasClass('spellbook-has-no-project')).toBe(true);
    expect(listPicture(s.pane, 'open')).toEqual([]);
  });
});

describe('a wide pane and a narrow pane', () => {
  const narrow = (pane: FakeElement): boolean => one(pane, 'spellbook-planner').hasClass('spellbook-is-narrow');

  it('shows two tabs on a narrow pane, with the calendar in front', async () => {
    const s = await stagePlanner({ width: 375 });
    const root = one(s.pane, 'spellbook-planner');
    expect(narrow(s.pane)).toBe(true);
    expect(root.hasClass('spellbook-shows-calendar')).toBe(true);
    expect(root.hasClass('spellbook-shows-todos')).toBe(false);
    const tabs = s.pane.withClass('spellbook-planner-tab');
    expect(tabs.map((tab) => tab.text)).toEqual(['Calendar', 'To-dos']);
    expect(tabs.map((tab) => tab.attrs['aria-selected'])).toEqual(['true', 'false']);
    expect(tabs.every((tab) => tab.tag === 'button' && tab.attrs['role'] === 'tab')).toBe(true);
  });

  it('brings the other part to the front when its tab is tapped', async () => {
    const s = await stagePlanner({ width: 375 });
    const [calendarTab, todosTab] = s.pane.withClass('spellbook-planner-tab');
    if (!calendarTab || !todosTab) throw new Error('two tabs were expected');
    click(todosTab);
    const root = one(s.pane, 'spellbook-planner');
    expect(root.hasClass('spellbook-shows-todos')).toBe(true);
    expect(root.hasClass('spellbook-shows-calendar')).toBe(false);
    expect(todosTab.attrs['aria-selected']).toBe('true');
    expect(calendarTab.attrs['aria-selected']).toBe('false');
    click(calendarTab);
    expect(root.hasClass('spellbook-shows-calendar')).toBe(true);
  });

  it('puts the two parts side by side on a wide pane, going by the measured width', async () => {
    const s = await stagePlanner({ width: 1100 });
    expect(narrow(s.pane)).toBe(false);
    resize(s, 375);
    expect(narrow(s.pane)).toBe(true);
    resize(s, 1100);
    expect(narrow(s.pane)).toBe(false);
  });

  it('does not flicker at the edge, and keeps its layout while it cannot be measured', async () => {
    const s = await stagePlanner({ width: SIDE_BY_SIDE_FROM });
    expect(narrow(s.pane)).toBe(false);
    resize(s, TABS_BELOW);
    expect(narrow(s.pane)).toBe(false);
    resize(s, TABS_BELOW - 1);
    expect(narrow(s.pane)).toBe(true);
    resize(s, SIDE_BY_SIDE_FROM - 1);
    expect(narrow(s.pane)).toBe(true);
    resize(s, SIDE_BY_SIDE_FROM);
    expect(narrow(s.pane)).toBe(false);
    // A hidden pane has no width: nothing changes.
    resize(s, 0);
    expect(narrow(s.pane)).toBe(false);
  });

  it('is narrow on a pane that was never measured: the layout that works everywhere', async () => {
    const s = await stagePlanner();
    expect(narrow(s.pane)).toBe(true);
  });

  it('does not go by the kind of device: a phone with a wide pane gets the wide layout', async () => {
    StubPlatform.isMobile = true;
    StubPlatform.isPhone = true;
    const s = await stagePlanner({ width: 900 });
    const root = one(s.pane, 'spellbook-planner');
    expect(narrow(s.pane)).toBe(false);
    // What the device is only decides the size of what is tapped, and the room for the phone's bar.
    expect(root.hasClass('spellbook-is-mobile')).toBe(true);
    expect(root.hasClass('spellbook-is-phone')).toBe(true);
  });

  it('marks neither a phone nor a tablet on a computer', async () => {
    const s = await stagePlanner({ width: 375 });
    const root = one(s.pane, 'spellbook-planner');
    expect(root.hasClass('spellbook-is-mobile')).toBe(false);
    expect(root.hasClass('spellbook-is-phone')).toBe(false);
  });

  it('knows when Obsidian itself reads right to left', async () => {
    const s = await stagePlanner({ width: 900 });
    const root = one(s.pane, 'spellbook-planner');
    expect(root.hasClass('spellbook-is-rtl')).toBe(false);
    s.pane.setAttr('dir', 'rtl');
    s.view.onResize();
    expect(root.hasClass('spellbook-is-rtl')).toBe(true);
  });
});

describe('what the pane remembers', () => {
  it('hands Obsidian the tab in front and whether "Done" is folded shut', async () => {
    const s = await stagePlanner({ width: 375, todo: TODO });
    expect(s.view.getState()).toEqual({ tab: 'calendar', doneCollapsed: true });
    click(s.pane.withClass('spellbook-planner-tab')[1] as FakeElement);
    click(one(s.pane, 'spellbook-todos-done-toggle'));
    expect(s.view.getState()).toEqual({ tab: 'todos', doneCollapsed: false });
  });

  it('takes them back from Obsidian, before or after it opens', async () => {
    const fake = new FakeObsidian();
    const timers = new ManualTimers();
    const host = new FakeHost(timers);
    host.file = TODO;
    host.sync();
    const view = createPlannerView(fake.workspace.addLeaf(fake.workspace.rootSplit) as never, host);
    await view.setState({ tab: 'todos', doneCollapsed: false }, { history: false });
    await (view as unknown as { open(): Promise<void> }).open();
    const pane = view.contentEl as unknown as FakeElement;
    expect(one(pane, 'spellbook-planner').hasClass('spellbook-shows-todos')).toBe(true);
    expect(listPicture(pane, 'done')).toEqual(['[x] Choose a name for the ferry']);

    await view.setState({ tab: 'calendar', doneCollapsed: true }, { history: false });
    expect(one(pane, 'spellbook-planner').hasClass('spellbook-shows-calendar')).toBe(true);
    expect(listPicture(pane, 'done')).toEqual([]);
  });

  it('ignores a state it does not understand', async () => {
    const s = await stagePlanner({ width: 375 });
    await s.view.setState({ tab: 'elsewhere', doneCollapsed: 'yes' }, { history: false });
    await s.view.setState(null, { history: false });
    expect(s.view.getState()).toEqual({ tab: 'calendar', doneCollapsed: true });
  });
});

describe('following the host', () => {
  it('draws several changes in a row in one go', async () => {
    const s = await stagePlanner({ todo: TODO });
    const drawn = vi.spyOn(FakeElement.prototype, 'appendChild');
    s.host.file = `${TODO}\n- [ ] One more`;
    s.host.sync();
    s.host.sync();
    s.host.sync();
    // Nothing is drawn until the moment the view asked for has come.
    expect(listPicture(s.pane, 'open')).toHaveLength(2);
    expect(s.timers.pending).toBe(1);
    await settle(s);
    expect(listPicture(s.pane, 'open')).toHaveLength(3);
    // One row was added to the list; the two that were there were not touched.
    expect(drawn).toHaveBeenCalledTimes(1);
  });

  it('shows what another device wrote into To-do.md', async () => {
    const s = await stagePlanner({ todo: TODO });
    s.host.file = '- [ ] Entirely new';
    s.host.sync();
    await settle(s);
    expect(listPicture(s.pane, 'open')).toEqual(['[ ] Entirely new']);
  });

  it('asks for the words again when the host says they changed, and only then', async () => {
    const words = new FakeWords().set('2026-10-13', 300);
    const s = await stagePlanner({
      setup: (host) => {
        host.words = words;
      },
    });
    expect(words.asked).toHaveLength(1);
    s.host.emit('data');
    await settle(s);
    expect(words.asked).toHaveLength(1);
    s.host.emit('words');
    await settle(s);
    expect(words.asked).toHaveLength(2);
  });

  it('starts afresh for another project: this month, and nothing left of the old list', async () => {
    const s = await stagePlanner({ todo: TODO });
    click(headButton(s.pane, 'Next month'));
    expect(monthName(s.pane)).toBe('November 2026');
    s.host.key = 'Other/Other.md';
    s.host.file = '- [ ] Of the other book';
    s.host.sync();
    await settle(s);
    expect(monthName(s.pane)).toBe('October 2026');
    expect(listPicture(s.pane, 'open')).toEqual(['[ ] Of the other book']);
  });
});

describe('closing', () => {
  it('lets go of everything: the host, its timers, and whatever it listened to on the page', async () => {
    const s = await stagePlanner({ todo: TODO, width: 900 });
    expect(s.host.listening).toBe(1);
    s.host.sync(); // a drawing is about to happen
    expect(s.timers.pending).toBe(1);
    await s.shell.close();
    expect(s.host.listening).toBe(0);
    expect(s.timers.pending).toBe(0);
    expect(fakeDocument.listenerCount()).toBe(0);
    expect(fakeWindow.listenerCount()).toBe(0);
    expect(s.pane.children).toHaveLength(0);
    expect(s.pane.hasClass('spellbook-planner-pane')).toBe(false);
  });

  it('stops watching the size of its pane', async () => {
    const watched: unknown[] = [];
    let disconnected = 0;
    class Watcher {
      observe(element: unknown): void {
        watched.push(element);
      }
      disconnect(): void {
        disconnected++;
      }
    }
    vi.stubGlobal('ResizeObserver', Watcher);
    try {
      const s = await stagePlanner();
      // The pane, the calendar and the month in it: every layout goes by a measured width.
      expect(watched).toHaveLength(3);
      expect(watched[0]).toBe(s.pane);
      await s.shell.close();
      expect(disconnected).toBe(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('does nothing with what the host says, or answers, after it closed', async () => {
    const words = new FakeWords().set('2026-10-13', 300);
    words.hold = true;
    const s = await stagePlanner({
      todo: TODO,
      setup: (host) => {
        host.words = words;
      },
    });
    await s.shell.close();
    words.release();
    s.host.emit('data');
    s.host.emit('words');
    await settle(s);
    expect(s.pane.children).toHaveLength(0);
    expect(s.timers.pending).toBe(0);
    expect(notices()).toEqual([]);
  });

  it('can be opened again after it was closed', async () => {
    const s = await stagePlanner({ todo: TODO });
    await s.shell.close();
    await s.shell.open();
    await settle(s);
    expect(s.host.listening).toBe(1);
    expect(listPicture(s.pane, 'open')).toHaveLength(2);
  });
});
