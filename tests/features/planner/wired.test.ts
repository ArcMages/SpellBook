// The planner plugged into the plugin: the real feature, registered as the
// plugin registers it, on the real project store over the memory vault (see
// wiredStage.ts). From the command to the notes and back to the screen.
// How it looks, and how the real app behaves, can only be checked in Obsidian.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { addTask } from '../../../src/core/planner';
import { OPEN_PLANNER_COMMAND, OPEN_TODO_NOTE_COMMAND, PLANNER_RIBBON_TITLE, plannerFeature } from '../../../src/features/planner/index';
import type { PlannerChange } from '../../../src/features/planner/plannerHost';
import { PROGRESS_STATS_SERVICE } from '../../../src/features/planner/plannerNumbers';
import { NO_PROJECT_MESSAGE, PLANNER_VIEW_TYPE, TODO_CHANGED_NOTICE } from '../../../src/features/planner/plannerView';
import { DAY_CHECK_MS } from '../../../src/features/planner/plannerWiring';
import type { Feature } from '../../../src/features/registry';
import { RENAME_SETTLE_MS } from '../../../src/core/projectStore';
import { INDEX_BODY } from '../../storeHarness';
import {
  addForm,
  boxOf,
  cellOf,
  cellPicture,
  clearScreen,
  click,
  detail,
  flip,
  key,
  listPicture,
  monthName,
  notices,
  one,
  part,
  statPicture,
  todoRow,
  unused,
} from './plannerStage';
import {
  FakeProgress,
  NOVEL,
  NOVEL_TODO,
  TODAY,
  hostOf,
  openPlanner,
  paneOf,
  planners,
  rest,
  restorePlanner,
  viewOf,
  wire,
} from './wiredStage';

beforeEach(() => {
  clearScreen();
});

afterEach(() => {
  vi.restoreAllMocks();
});

const DUE = '\u{1F4C5}';
const TODO = [`- [ ] Send chapter one ${DUE} 2026-10-20`, '- [x] Choose a name for the ferry', '- [ ] Call the printer'].join('\n');
const OPEN_TODOS = ['[ ] Send chapter one {20 Oct}', '[ ] Call the printer'];
const MARKS = { '2026-10-20': { color: 'red', label: 'Deadline' } };

/** Word counts as the writing-progress screen would offer them. */
const counted = (): FakeProgress => new FakeProgress().set('2026-10-10', 1200, 1500).set('2026-10-12', 100).set('2026-10-13', 300, 650);

/** A screen that offers word counts to the others, as the writing-progress screen does. */
const offering = (counts: FakeProgress): Feature => ({
  id: 'progress',
  register: (context) => context.services.provide(PROGRESS_STATS_SERVICE, counts),
});

describe('plugging the planner in', () => {
  it('registers the view, a ribbon button and two commands, and leaves no trace', async () => {
    const w = await wire({ todo: TODO, marks: MARKS });
    expect(w.registered.ids).toEqual(['planner']);
    expect(w.plugin.viewTypes).toEqual([PLANNER_VIEW_TYPE]);
    expect(PLANNER_VIEW_TYPE).toBe('spellbook-planner');
    // Obsidian puts "Spellbook: " in front of the names itself.
    expect(w.plugin.commands.map((command) => [command.id, command.name])).toEqual([
      ['open-planner', 'Open planner'],
      ['open-todo-note', 'Open to-do note'],
    ]);
    expect([OPEN_PLANNER_COMMAND.id, OPEN_TODO_NOTE_COMMAND.id]).toEqual(['open-planner', 'open-todo-note']);
    expect(w.plugin.ribbonIcons.map((icon) => [icon.icon, icon.title, icon.shown])).toEqual([['calendar-check', PLANNER_RIBBON_TITLE, true]]);
    expect(PLANNER_RIBBON_TITLE).toBe('Open Spellbook planner');

    // Nothing opens by itself, nothing is written, nothing is kept on the device.
    expect(w.fake.workspace.leaves).toEqual([]);
    expect(w.vault.writes).toEqual([]);
    expect(w.storage.saves).toEqual([]);
    expect(w.registered.settingsSections).toEqual([]);
    expect(w.timers.pending).toBe(0);
    expect(notices()).toEqual([]);
  });

  it('opens one planner as a tab in the main area, and brings that one back when asked again', async () => {
    const w = await wire({ todo: TODO });
    const leaf = await openPlanner(w);
    expect(leaf.split).toBe(w.fake.workspace.rootSplit);
    expect(w.leavesAskedFor).toEqual(['tab']);
    expect(viewOf(leaf).getViewType()).toBe(PLANNER_VIEW_TYPE);
    expect(w.fake.workspace.revealed).toEqual([leaf]);

    // The command and the ribbon button, one straight after the other.
    w.command('open-planner').callback?.();
    w.plugin.ribbonIcons[0]?.callback({});
    await rest(w);
    expect(planners(w)).toEqual([leaf]);
    expect(w.fake.workspace.leaves).toEqual([leaf]);
    expect(w.leavesAskedFor).toEqual(['tab']); // no second tab was asked for
    expect(w.fake.workspace.revealed).toEqual([leaf, leaf]);
  });

  it('opens one planner when it is asked for twice at the same moment', async () => {
    const w = await wire({ todo: TODO });
    w.command('open-planner').callback?.();
    w.command('open-planner').callback?.();
    w.plugin.ribbonIcons[0]?.callback({});
    await rest(w);
    expect(planners(w)).toHaveLength(1);
    expect(w.leavesAskedFor).toEqual(['tab']);
  });

  it('brings a planner to the front that is open somewhere else, instead of opening a second one', async () => {
    const w = await wire({ todo: TODO });
    const restored = await restorePlanner(w, 'right');
    expect(w.fake.workspace.rightSplit.collapsed).toBe(true);

    w.command('open-planner').callback?.();
    await rest(w);
    expect(planners(w)).toEqual([restored]);
    expect(w.leavesAskedFor).toEqual([]);
    expect(w.fake.workspace.revealed).toEqual([restored]);
    expect(w.fake.workspace.rightSplit.collapsed).toBe(false);
  });

  it('says so when Obsidian cannot open it', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const w = await wire({ todo: TODO });
    (w.fake.workspace as unknown as { getLeaf: () => never }).getLeaf = () => {
      throw new Error('no room');
    };
    w.command('open-planner').callback?.();
    await rest(w);
    expect(notices()).toEqual(['The planner could not be opened.']);
    expect(planners(w)).toEqual([]);
    expect(logged).toHaveBeenCalledTimes(1);
  });
});

describe('before a project is open', () => {
  it('shows no project in a planner that Obsidian put back while starting up, and fills it in when one opens', async () => {
    const w = await wire({ todo: TODO, marks: MARKS, open: false });
    const leaf = await restorePlanner(w);
    const pane = paneOf(leaf);
    expect(hostOf(leaf).project).toBeNull();
    expect(one(pane, 'spellbook-planner').hasClass('spellbook-has-no-project')).toBe(true);
    expect(one(pane, 'spellbook-planner-message').text).toBe(NO_PROJECT_MESSAGE);

    await w.store.openProject(NOVEL);
    await rest(w);
    expect(one(pane, 'spellbook-planner').hasClass('spellbook-has-no-project')).toBe(false);
    expect(one(pane, 'spellbook-planner-message').text).toBe('');
    expect(listPicture(pane, 'open')).toEqual(OPEN_TODOS);
    expect(cellOf(pane, '2026-10-20').hasClass('spellbook-mark-red')).toBe(true);

    await w.store.closeProject();
    await rest(w);
    expect(hostOf(leaf).project).toBeNull();
    expect(one(pane, 'spellbook-planner-message').text).toBe(NO_PROJECT_MESSAGE);
    expect(w.vault.writes).toEqual([]);
  });
});

describe('what the planner shows', () => {
  it('is the project as the store has it: its to-dos, its marks, today, and whether it may be changed', async () => {
    const w = await wire({ todo: TODO, marks: MARKS });
    const leaf = await openPlanner(w);
    const host = hostOf(leaf);
    expect(host.project).toEqual({ key: NOVEL, todoText: TODO, marks: MARKS, readOnly: false });
    expect(host.today).toBe(TODAY);
    // The stand-in for Obsidian has no language setting: weeks start on Sunday.
    expect(host.firstDayOfWeek).toBe(0);

    const pane = paneOf(leaf);
    expect(monthName(pane)).toBe('October 2026');
    expect(pane.withClass('spellbook-calendar-weekday').map((heading) => heading.text)[0]).toBe('Sun');
    expect(listPicture(pane, 'open')).toEqual(OPEN_TODOS);
    const day = cellOf(pane, '2026-10-20');
    expect(cellPicture(day)).toMatchObject({ dots: 1, label: 'Deadline' });
    expect(day.hasClass('spellbook-mark-red')).toBe(true);
    expect(cellOf(pane, TODAY).hasClass('spellbook-is-today')).toBe(true);
    expect(w.vault.writes).toEqual([]); // looking changes nothing
  });

  it('is an empty list for a project that has no To-do.md, and no file is made for it', async () => {
    const w = await wire({ todo: null, marks: MARKS });
    const leaf = await openPlanner(w);
    expect(hostOf(leaf).project).toEqual({ key: NOVEL, todoText: '', marks: MARKS, readOnly: false });
    expect(listPicture(paneOf(leaf), 'open')).toEqual([]);
    expect(w.vault.has(NOVEL_TODO)).toBe(false);
  });

  it('can be read but not changed while the project index cannot be understood', async () => {
    const w = await wire({ todo: TODO, marks: MARKS, binder: { not: 'a list' } });
    const leaf = await openPlanner(w);
    const pane = paneOf(leaf);
    const host = hostOf(leaf);
    expect(host.project?.readOnly).toBe(true);
    expect(listPicture(pane, 'open')).toEqual(OPEN_TODOS);
    expect(cellOf(pane, '2026-10-20').hasClass('spellbook-mark-red')).toBe(true);
    expect(unused(one(pane, 'spellbook-todo-add'))).toBe(true);

    // Even asked directly, the store lets nothing through.
    await expect(host.applyTodoEdit((text) => addTask(text, { title: 'Slipped in' }))).rejects.toThrow(/read-only/);
    await expect(host.applyMarksEdit((marks) => ({ status: 'done', marks: { ...(marks as object), '2026-10-21': { color: 'blue' } } }))).rejects.toThrow(/read-only/);
    expect(w.vault.writes).toEqual([]);
    expect(w.vault.textOf(NOVEL_TODO)).toBe(TODO);
  });
});

describe('changes that arrive from disk', () => {
  it('follows To-do.md whoever changed it: edited, deleted, and made again', async () => {
    const w = await wire({ todo: TODO });
    const leaf = await openPlanner(w);
    const pane = paneOf(leaf);

    // Another device ticked one to-do and added one.
    w.vault.external.write(NOVEL_TODO, { body: `${TODO.replace('- [ ] Call', '- [x] Call')}\n- [ ] Book the launch ${DUE} 2026-10-27` });
    await rest(w);
    expect(listPicture(pane, 'open')).toEqual(['[ ] Send chapter one {20 Oct}', '[ ] Book the launch {27 Oct}']);
    expect(cellPicture(cellOf(pane, '2026-10-27')).dots).toBe(1);

    w.vault.external.delete(NOVEL_TODO);
    await rest(w);
    expect(hostOf(leaf).project?.todoText).toBe('');
    expect(listPicture(pane, 'open')).toEqual([]);
    expect(cellPicture(cellOf(pane, '2026-10-27')).dots).toBe(0);

    w.vault.external.create(NOVEL_TODO, { body: '- [ ] Start again' });
    await rest(w);
    expect(listPicture(pane, 'open')).toEqual(['[ ] Start again']);
    expect(w.vault.writes).toEqual([]);
  });

  it('follows the marks when the project index changes on another device', async () => {
    const w = await wire({ todo: TODO, marks: MARKS });
    const leaf = await openPlanner(w);
    const pane = paneOf(leaf);
    w.vault.external.editFrontmatter(NOVEL, (frontmatter) => {
      frontmatter['marks'] = { '2026-10-22': { color: 'blue', label: 'Signing' } };
    });
    await rest(w);
    expect(cellOf(pane, '2026-10-22').hasClass('spellbook-mark-blue')).toBe(true);
    expect(cellPicture(cellOf(pane, '2026-10-22')).label).toBe('Signing');
    expect(cellOf(pane, '2026-10-20').hasClass('spellbook-has-mark')).toBe(false);
    expect(w.vault.writes).toEqual([]);
  });

  it('says nothing when what arrived is what it already showed, or is none of its business', async () => {
    const w = await wire({ todo: TODO, marks: MARKS });
    const leaf = await openPlanner(w);
    const heard: PlannerChange[] = [];
    hostOf(leaf).onChange((change) => heard.push(change));

    // A sync that brings the same text again.
    w.vault.external.write(NOVEL_TODO, { body: TODO });
    await rest(w);
    expect(heard).toEqual([]);

    // A scene is written in: the planner does not read To-do.md again for that.
    const reads = w.vault.reads.readText;
    w.vault.external.write('Novel/Manuscript/Opening.md', { body: 'More words.' });
    await rest(w);
    expect(w.vault.reads.readText).toBe(reads);
    expect(heard).toEqual([]);
  });

  it('reads everything again when Obsidian says the vault may have changed wholesale', async () => {
    const w = await wire({ todo: TODO });
    const leaf = await openPlanner(w);
    w.vault.external.write(NOVEL_TODO, { body: '- [ ] Arrived quietly' }, { silent: true });
    w.vault.refresh();
    await rest(w);
    expect(listPicture(paneOf(leaf), 'open')).toEqual(['[ ] Arrived quietly']);
  });
});

describe('changing to-dos', () => {
  it('ticks a to-do through the store, in To-do.md and nowhere else', async () => {
    const w = await wire({ todo: TODO, marks: MARKS });
    const leaf = await openPlanner(w);
    const pane = paneOf(leaf);
    const heard: PlannerChange[] = [];
    hostOf(leaf).onChange((change) => heard.push(change));

    flip(boxOf(todoRow(pane, 'Call the printer')));
    await rest(w);
    expect(w.vault.textOf(NOVEL_TODO)).toBe(TODO.replace('- [ ] Call', '- [x] Call'));
    // One write, of the plugin's own file, by the store's own doorway for such files.
    expect(w.vault.writes).toEqual([{ op: 'updateText', path: NOVEL_TODO }]);
    expect(listPicture(pane, 'open')).toEqual(['[ ] Send chapter one {20 Oct}']);
    expect(hostOf(leaf).project?.todoText).toBe(w.vault.textOf(NOVEL_TODO));
    // The plugin's own write comes back from the vault as a change: it is not announced a second time.
    expect(heard).toEqual(['data']);
    expect(notices()).toEqual([]);
  });

  it('adds a to-do with its date, which shows on the calendar too', async () => {
    const w = await wire({ todo: TODO });
    const leaf = await openPlanner(w);
    const pane = paneOf(leaf);
    const form = addForm(pane);
    form.text.value = 'Book the launch';
    form.date.value = '2026-10-27';
    key(form.text, 'Enter');
    await rest(w);

    const text = w.vault.textOf(NOVEL_TODO);
    expect(text.startsWith(TODO)).toBe(true);
    expect(text.split('\n')).toContain(`- [ ] Book the launch ${DUE} 2026-10-27`);
    expect(listPicture(pane, 'open')).toEqual([...OPEN_TODOS, '[ ] Book the launch {27 Oct}']);
    expect(cellPicture(cellOf(pane, '2026-10-27')).dots).toBe(1);
  });

  it('makes To-do.md when the project has none yet', async () => {
    const w = await wire({ todo: null });
    const leaf = await openPlanner(w);
    const pane = paneOf(leaf);
    const form = addForm(pane);
    form.text.value = 'The very first';
    key(form.text, 'Enter');
    await rest(w);
    expect(w.vault.textOf(NOVEL_TODO).split('\n')).toContain('- [ ] The very first');
    expect(w.vault.writes).toEqual([{ op: 'updateText', path: NOVEL_TODO }]);
    expect(listPicture(pane, 'open')).toEqual(['[ ] The very first']);
  });

  it('works a change out on the file as it is on disk, not as the screen last saw it', async () => {
    const w = await wire({ todo: TODO });
    const leaf = await openPlanner(w);
    const pane = paneOf(leaf);
    // Another device added a line, and this one has not heard of it yet.
    w.vault.external.write(NOVEL_TODO, { body: `- [ ] Came from the phone\n${TODO}` }, { silent: true });
    expect(listPicture(pane, 'open')).toEqual(OPEN_TODOS);

    flip(boxOf(todoRow(pane, 'Call the printer')));
    await rest(w);
    expect(w.vault.textOf(NOVEL_TODO)).toBe(`- [ ] Came from the phone\n${TODO.replace('- [ ] Call', '- [x] Call')}`);
    expect(listPicture(pane, 'open')).toEqual(['[ ] Came from the phone', '[ ] Send chapter one {20 Oct}']);
  });

  it('writes nothing, says so and shows the file as it is when the to-do is no longer there', async () => {
    const w = await wire({ todo: TODO, marks: MARKS });
    const leaf = await openPlanner(w);
    const pane = paneOf(leaf);
    w.vault.external.write(NOVEL_TODO, { body: '- [ ] Something else entirely' }, { silent: true });
    w.vault.external.editFrontmatter(NOVEL, (frontmatter) => {
      frontmatter['marks'] = { '2026-10-22': { color: 'blue' } };
    }, { silent: true });

    flip(boxOf(todoRow(pane, 'Call the printer')));
    await rest(w);
    expect(notices()).toEqual([TODO_CHANGED_NOTICE]);
    expect(w.vault.textOf(NOVEL_TODO)).toBe('- [ ] Something else entirely');
    expect(w.vault.writes).toEqual([]);
    expect(listPicture(pane, 'open')).toEqual(['[ ] Something else entirely']);
    // Bringing the screen up to date read the marks from the index note again, too.
    expect(cellOf(pane, '2026-10-22').hasClass('spellbook-mark-blue')).toBe(true);
    expect(cellOf(pane, '2026-10-20').hasClass('spellbook-has-mark')).toBe(false);
  });

  it('tells the writer when the file could not be saved, and leaves everything as it was', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const w = await wire({ todo: TODO });
    const leaf = await openPlanner(w);
    const pane = paneOf(leaf);
    w.vault.failNext('updateText', NOVEL_TODO);
    flip(boxOf(todoRow(pane, 'Call the printer')));
    await rest(w);
    expect(notices()).toHaveLength(1);
    expect(notices()[0]).toMatch(/did not work/);
    expect(notices()[0]).toMatch(/The disk is not available/);
    expect(w.vault.textOf(NOVEL_TODO)).toBe(TODO);
    expect(listPicture(pane, 'open')).toEqual(OPEN_TODOS);
  });
});

describe('marking days', () => {
  it('stores a mark through the store, under the "marks" key of the index and nothing else', async () => {
    const w = await wire({ todo: TODO });
    const before = w.vault.frontmatterOf(NOVEL);
    const leaf = await openPlanner(w);
    const pane = paneOf(leaf);
    click(cellOf(pane, '2026-10-20'));
    await rest(w);
    const panel = detail(pane);

    click(part(panel, 'spellbook-mark-green'));
    await rest(w);
    expect(w.vault.frontmatterOf(NOVEL)).toEqual({ ...before, marks: { '2026-10-20': { color: 'green' } } });
    expect(w.vault.bodyOf(NOVEL)).toBe(INDEX_BODY); // the writer's own text in the index note is untouched
    expect(w.vault.writes).toEqual([{ op: 'updateFrontmatter', path: NOVEL }]);
    expect(hostOf(leaf).project?.marks).toEqual({ '2026-10-20': { color: 'green' } });
    expect(cellOf(pane, '2026-10-20').hasClass('spellbook-mark-green')).toBe(true);

    const label = part(panel, 'spellbook-mark-label');
    label.value = 'Deadline';
    label.fire('change');
    await rest(w);
    expect(w.vault.frontmatterOf(NOVEL)?.['marks']).toEqual({ '2026-10-20': { color: 'green', label: 'Deadline' } });
    expect(cellPicture(cellOf(pane, '2026-10-20')).label).toBe('Deadline');

    // The last mark goes: the key goes with it, and the index is as it was before the first one.
    click(part(panel, 'spellbook-mark-remove'));
    await rest(w);
    expect(w.vault.frontmatterOf(NOVEL)).toEqual(before);
    expect(cellOf(pane, '2026-10-20').hasClass('spellbook-has-mark')).toBe(false);
    expect(notices()).toEqual([]);
  });

  it('works a mark out on the index as it is on disk, so a mark from another device is kept', async () => {
    const w = await wire({ todo: TODO, marks: MARKS });
    const leaf = await openPlanner(w);
    const pane = paneOf(leaf);
    w.vault.external.editFrontmatter(NOVEL, (frontmatter) => {
      frontmatter['marks'] = { ...MARKS, '2026-11-02': { color: 'pink' } };
    }, { silent: true });

    click(cellOf(pane, '2026-10-21'));
    await rest(w);
    click(part(detail(pane), 'spellbook-mark-blue'));
    await rest(w);
    expect(w.vault.frontmatterOf(NOVEL)?.['marks']).toEqual({
      ...MARKS,
      '2026-10-21': { color: 'blue' },
      '2026-11-02': { color: 'pink' },
    });
  });

  it('tells the writer when the index could not be saved', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const w = await wire({ todo: TODO, marks: MARKS });
    const leaf = await openPlanner(w);
    const pane = paneOf(leaf);
    click(cellOf(pane, '2026-10-21'));
    await rest(w);
    w.vault.failNext('updateFrontmatter', NOVEL);
    click(part(detail(pane), 'spellbook-mark-blue'));
    await rest(w);
    expect(notices()).toHaveLength(1);
    expect(notices()[0]).toMatch(/did not work/);
    expect(w.vault.frontmatterOf(NOVEL)?.['marks']).toEqual(MARKS);
    expect(cellOf(pane, '2026-10-21').hasClass('spellbook-has-mark')).toBe(false);
  });
});

describe('another project', () => {
  const SECOND = { folder: 'Second', todo: '- [ ] Outline the sequel', marks: { '2026-10-15': { color: 'blue', label: 'Pitch' } } };

  it('is shown when the store opens it, and is the one that is changed from then on', async () => {
    const w = await wire({ todo: TODO, marks: MARKS, others: [SECOND] });
    const leaf = await openPlanner(w);
    const pane = paneOf(leaf);

    await w.store.openProject('Second/Second.md');
    await rest(w);
    expect(hostOf(leaf).project).toEqual({ key: 'Second/Second.md', todoText: SECOND.todo, marks: SECOND.marks, readOnly: false });
    expect(listPicture(pane, 'open')).toEqual(['[ ] Outline the sequel']);
    expect(cellOf(pane, '2026-10-15').hasClass('spellbook-mark-blue')).toBe(true);
    expect(cellOf(pane, '2026-10-20').hasClass('spellbook-has-mark')).toBe(false);

    flip(boxOf(todoRow(pane, 'Outline the sequel')));
    await rest(w);
    expect(w.vault.textOf('Second/To-do.md')).toBe('- [x] Outline the sequel');
    expect(w.vault.textOf(NOVEL_TODO)).toBe(TODO);
    expect(w.vault.frontmatterOf(NOVEL)?.['marks']).toEqual(MARKS);

    // The first project's file changes on disk: that is no longer this planner's business.
    const reads = w.vault.reads.readText;
    w.vault.external.write(NOVEL_TODO, { body: '- [ ] Elsewhere' });
    await rest(w);
    expect(w.vault.reads.readText).toBe(reads);
    expect(listPicture(pane, 'open')).toEqual([]);
  });

  it('keeps showing a project whose folder was renamed, and changes it where it is now', async () => {
    const w = await wire({ todo: TODO, marks: MARKS });
    const leaf = await openPlanner(w);
    const pane = paneOf(leaf);
    w.vault.external.rename('Novel', 'Night Train');
    await rest(w);
    w.timers.advance(RENAME_SETTLE_MS * 4);
    await rest(w);
    expect(hostOf(leaf).project).toEqual({ key: 'Night Train/Novel.md', todoText: TODO, marks: MARKS, readOnly: false });
    expect(listPicture(pane, 'open')).toEqual(OPEN_TODOS);

    flip(boxOf(todoRow(pane, 'Call the printer')));
    await rest(w);
    expect(w.vault.textOf('Night Train/To-do.md')).toBe(TODO.replace('- [ ] Call', '- [x] Call'));
    expect(w.vault.has(NOVEL_TODO)).toBe(false);
  });
});

describe('the words of each day', () => {
  it('are left out while nobody offers them: the calendar shows to-dos and marks only', async () => {
    const w = await wire({ todo: TODO, marks: MARKS, targets: { daily: 500 } });
    const leaf = await openPlanner(w);
    const pane = paneOf(leaf);
    const host = hostOf(leaf);
    expect(host.words).toBeNull();
    expect(await host.stats?.({ year: 2026, month: 10 })).toBeNull();
    expect(statPicture(pane)).toEqual([]);
    expect(cellPicture(cellOf(pane, '2026-10-20'))).toMatchObject({ manuscript: '', all: '', dots: 1, label: 'Deadline' });
  });

  it('come from the writing-progress screen, whichever of the two screens was plugged in first', async () => {
    for (const order of ['planner first', 'progress first'] as const) {
      const counts = counted();
      const features = order === 'planner first' ? [plannerFeature, offering(counts)] : [offering(counts), plannerFeature];
      const w = await wire({ todo: TODO, targets: { daily: 500 }, features });
      const leaf = await openPlanner(w);
      const pane = paneOf(leaf);

      // The weeks on show, both ends included: October 2026 starts on a Thursday.
      expect(counts.asked, order).toContain('2026-09-27..2026-10-31');
      expect(cellPicture(cellOf(pane, '2026-10-10')), order).toMatchObject({ manuscript: '1.2k', all: '1.5k' });
      expect(cellPicture(cellOf(pane, '2026-10-11')), order).toMatchObject({ manuscript: '', all: '' });
      expect(statPicture(pane), order).toEqual([
        'October 2026: 1,600 (2,250 in all notes)',
        'This week: 1,500',
        'Streak: 3 days',
        'Daily average: 420 (words a day)',
        "Today's target: 300 of 500 (Not met yet)",
      ]);
      expect(counts.summaries, order).toContain(TODAY);
      expect(counts.listening, order).toBe(1);
    }
  });

  it('are found when they are offered later, and another offer takes the place of the first', async () => {
    const w = await wire({ todo: TODO });
    const leaf = await openPlanner(w);
    const pane = paneOf(leaf);
    expect(cellPicture(cellOf(pane, '2026-10-10')).manuscript).toBe('');

    // Nobody tells the planner. The next thing that makes it draw finds the counts.
    const counts = counted();
    w.registered.services.provide(PROGRESS_STATS_SERVICE, counts);
    w.vault.external.write(NOVEL_TODO, { body: `${TODO}\n- [ ] One more` });
    await rest(w);
    expect(cellPicture(cellOf(pane, '2026-10-10')).manuscript).toBe('1.2k');
    expect(counts.listening).toBe(1);

    const others = new FakeProgress().set('2026-10-10', 50);
    w.registered.services.provide(PROGRESS_STATS_SERVICE, others);
    w.vault.external.write(NOVEL_TODO, { body: TODO });
    await rest(w);
    expect(cellPicture(cellOf(pane, '2026-10-10')).manuscript).toBe('50');
    expect([counts.listening, counts.stopped]).toEqual([0, 1]);
    expect(others.listening).toBe(1);

    // And taken away again: back to to-dos and marks only.
    w.registered.services.provide(PROGRESS_STATS_SERVICE, undefined);
    w.vault.external.write(NOVEL_TODO, { body: `${TODO}\n- [ ] One more` });
    await rest(w);
    expect(cellPicture(cellOf(pane, '2026-10-10')).manuscript).toBe('');
    expect(statPicture(pane)).toEqual([]);
    expect(others.listening).toBe(0);
  });

  it('are asked for again when the writing-progress screen says they changed', async () => {
    const counts = counted();
    const w = await wire({ todo: TODO, targets: { daily: 500 }, features: [offering(counts), plannerFeature] });
    const leaf = await openPlanner(w);
    const pane = paneOf(leaf);
    const asked = counts.asked.length;

    counts.set('2026-10-13', 520, 700);
    counts.numbers = { ...counts.numbers, dailyTargetMet: true };
    counts.changed();
    await rest(w);
    expect(counts.asked.length).toBeGreaterThan(asked);
    expect(cellPicture(cellOf(pane, TODAY))).toMatchObject({ manuscript: '520', all: '700' });
    expect(statPicture(pane)).toContain("Today's target: 520 of 500 (Met)");
    expect(statPicture(pane)).toContain('October 2026: 1,820 (2,300 in all notes)');
  });

  it("measure today against the daily target in the project index, and follow it when it changes", async () => {
    const counts = counted();
    counts.numbers = { streak: 1, dailyTarget: 250 };
    const w = await wire({ todo: TODO, targets: { project: 80000, daily: '1,000' }, features: [offering(counts), plannerFeature] });
    const leaf = await openPlanner(w);
    const pane = paneOf(leaf);
    // The index's own target; whether it is met is worked out when the summary does not say.
    expect(statPicture(pane)).toEqual(['October 2026: 1,600 (2,250 in all notes)', 'Streak: 1 day', "Today's target: 300 of 1,000 (Not met yet)"]);

    w.vault.external.editFrontmatter(NOVEL, (frontmatter) => {
      frontmatter['targets'] = { project: 80000, daily: 300 };
    });
    await rest(w);
    expect(statPicture(pane)).toContain("Today's target: 300 of 300 (Met)");

    // No daily target in the index: the summary's own is the one left.
    w.vault.external.editFrontmatter(NOVEL, (frontmatter) => {
      frontmatter['targets'] = { project: 80000 };
    });
    await rest(w);
    expect(statPicture(pane)).toContain("Today's target: 300 of 250 (Met)");
  });

  it('leave the to-dos and the marks on show when they cannot be read', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const counts = counted();
    counts.broken = true;
    const w = await wire({ todo: TODO, marks: MARKS, targets: { daily: 500 }, features: [offering(counts), plannerFeature] });
    const leaf = await openPlanner(w);
    const pane = paneOf(leaf);
    expect(counts.asked.length).toBeGreaterThan(0);
    expect(statPicture(pane)).toEqual([]);
    expect(cellPicture(cellOf(pane, '2026-10-20'))).toMatchObject({ manuscript: '', dots: 1, label: 'Deadline' });
    expect(listPicture(pane, 'open')).toEqual(OPEN_TODOS);
    expect(logged).toHaveBeenCalled();
  });
});

describe('midnight', () => {
  it('moves the planner on to the next day, and the clock is only watched while a planner is open', async () => {
    const counts = counted();
    const w = await wire({ todo: TODO, features: [offering(counts), plannerFeature] });
    expect(w.timers.pending).toBe(0);
    const leaf = await openPlanner(w);
    const pane = paneOf(leaf);
    expect(w.timers.pending).toBe(1);
    expect(cellOf(pane, '2026-10-13').hasClass('spellbook-is-today')).toBe(true);

    // The same day still: nothing happens.
    const heard: PlannerChange[] = [];
    const stop = hostOf(leaf).onChange((change) => heard.push(change));
    w.timers.advance(DAY_CHECK_MS);
    await rest(w);
    expect(heard).toEqual([]);

    w.clock.day = '2026-10-14';
    w.timers.advance(DAY_CHECK_MS);
    await rest(w);
    expect(heard).toEqual(['data', 'words']);
    expect(hostOf(leaf).today).toBe('2026-10-14');
    expect(cellOf(pane, '2026-10-14').hasClass('spellbook-is-today')).toBe(true);
    expect(cellOf(pane, '2026-10-13').hasClass('spellbook-is-today')).toBe(false);
    expect(counts.summaries).toContain('2026-10-14'); // the numbers that count from today were asked for again
    stop();

    leaf.detach();
    await rest(w);
    expect(w.timers.pending).toBe(0);
  });
});

describe('the command "Open to-do note"', () => {
  it("shows the open project's To-do.md, and so does the button above the list", async () => {
    const w = await wire({ todo: TODO });
    const command = w.command('open-todo-note');
    expect(command.checkCallback?.(true)).toBe(true);
    expect(w.shown).toEqual([]); // asking whether it can run shows nothing

    command.checkCallback?.(false);
    await rest(w);
    expect(w.shown.map((note) => note.path)).toEqual([NOVEL_TODO]);

    const leaf = await openPlanner(w);
    click(one(paneOf(leaf), 'spellbook-todos-open'));
    await rest(w);
    expect(w.shown.map((note) => note.path)).toEqual([NOVEL_TODO, NOVEL_TODO]);
    expect(w.vault.writes).toEqual([]);
    expect(notices()).toEqual([]);
  });

  it('is not offered while no project is open', async () => {
    const w = await wire({ todo: TODO, open: false });
    const command = w.command('open-todo-note');
    expect(command.checkCallback?.(true)).toBe(false);
    expect(command.checkCallback?.(false)).toBe(false);
    await rest(w);
    expect(w.shown).toEqual([]);

    await w.store.openProject(NOVEL);
    await rest(w);
    expect(command.checkCallback?.(true)).toBe(true);
  });

  it('gives a project that has no To-do.md an empty one first, through the store', async () => {
    const w = await wire({ todo: null });
    w.command('open-todo-note').checkCallback?.(false);
    await rest(w);
    expect(w.vault.textOf(NOVEL_TODO)).toBe('');
    expect(w.vault.writes).toEqual([{ op: 'updateText', path: NOVEL_TODO }]);
    expect(w.shown.map((note) => note.path)).toEqual([NOVEL_TODO]);
    expect(notices()).toEqual([]);
  });

  it('says why when there is no To-do.md and the project may not be changed', async () => {
    const w = await wire({ todo: null, binder: { not: 'a list' } });
    w.command('open-todo-note').checkCallback?.(false);
    await rest(w);
    expect(notices()).toHaveLength(1);
    expect(notices()[0]).toMatch(/^This project has no To-do\.md yet, and it could not be created: /);
    expect(w.vault.has(NOVEL_TODO)).toBe(false);
    expect(w.shown).toEqual([]);
  });
});

describe('switching the plugin off', () => {
  it('lets go of everything: the pane is emptied, and nothing is listened to or left running', async () => {
    const counts = counted();
    const w = await wire({ todo: TODO, marks: MARKS, features: [offering(counts), plannerFeature] });
    const leaf = await openPlanner(w);
    const pane = paneOf(leaf);
    const host = hostOf(leaf);
    expect(counts.listening).toBe(1);
    expect(w.timers.pending).toBe(1);

    w.plugin.unload();
    await rest(w);
    expect(leaf.view).toBeNull();
    expect(leaf.detached).toBe(false); // its tab is kept for when the plugin comes back
    expect(pane.children).toHaveLength(0);
    expect([...pane.classes]).toEqual(['view-content']);
    expect(w.plugin.ribbonIcons.every((icon) => !icon.shown)).toBe(true);
    expect([counts.listening, counts.stopped]).toEqual([0, 1]);
    expect(w.timers.pending).toBe(0);
    expect(host.project).toBeNull();
    expect(host.words).toBeNull();

    // Whatever happens in the vault now, the planner neither reads nor speaks.
    const reads = w.vault.reads.readText;
    const heard: PlannerChange[] = [];
    host.onChange((change) => heard.push(change));
    w.vault.external.write(NOVEL_TODO, { body: '- [ ] After the end' });
    w.vault.external.editFrontmatter(NOVEL, (frontmatter) => {
      frontmatter['marks'] = {};
    });
    w.vault.refresh();
    counts.changed();
    w.clock.day = '2026-10-14';
    w.timers.advance(DAY_CHECK_MS * 2);
    await rest(w);
    expect(w.vault.reads.readText).toBe(reads);
    expect(heard).toEqual([]);
    expect(w.timers.pending).toBe(0);

    // And a plugin that is off opens nothing and changes nothing.
    w.command('open-planner').callback?.();
    expect(w.command('open-todo-note').checkCallback?.(true)).toBe(false);
    await rest(w);
    expect(w.fake.workspace.leaves).toEqual([leaf]);
    expect(w.leavesAskedFor).toEqual(['tab']);
    await expect(host.applyTodoEdit((text) => addTask(text, { title: 'Too late' }))).rejects.toThrow('No project is open.');
    expect(w.vault.writes).toEqual([]);
  });

  it('takes down what it had set up when registering was cut short', async () => {
    // Obsidian refuses the view: the feature is left out, but its host was already following the vault.
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const w = await wire({ todo: TODO, refuseViews: true });
    expect(w.registered.ids).toEqual([]);
    expect(w.plugin.commands).toEqual([]);
    expect(logged).toHaveBeenCalledTimes(1);

    w.plugin.unload();
    await rest(w);
    const reads = w.vault.reads.readText;
    w.vault.external.write(NOVEL_TODO, { body: '- [ ] After the end' });
    await rest(w);
    expect(w.vault.reads.readText).toBe(reads);
    expect(w.timers.pending).toBe(0);
  });
});
