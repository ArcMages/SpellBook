// Writing progress, as the writer and the other screens see it: the bottom
// bar, the line of figures and the word log offered as services, the targets
// window and the settings. Run through a stand-in context (see stand.ts).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MEASURE_AFTER_MS, WRITE_AFTER_QUIET_MS, updateStatsText } from '../../../src/core/progress/index';
import type { StatsChange } from '../../../src/core/progress/index';
import { COUNT_PASTED_KEY } from '../../../src/features/progress/settings';
import { TargetsModal } from '../../../src/features/progress/targetsModal';
import { FakeElement, Modal, Notice, Platform, momentLocale, resetFakeDocument, resetPlatform } from '../../obsidianStub';
import type { ButtonComponent, Setting } from '../../obsidianStub';
import type { MemoryVault } from '../../memoryVault';
import type { SettingWithToggles } from './obsidianExtras';
import { AFTER_MIDNIGHT_MS, DAY_CHECK_MS } from '../../../src/features/progress/writingProgress';
import { DAY, SIX_HOURS, asText, makeStand, setHidden } from './stand';
import type { Stand } from './stand';

vi.mock('obsidian', async (importOriginal) => {
  const { withProgressExtras } = await import('./obsidianExtras');
  return withProgressExtras(await importOriginal<typeof import('../../obsidianStub')>());
});

const OPENING = 'Novel/Manuscript/Opening.md';
const LETTER = 'Novel/Manuscript/The Letter.md';
const CASTLE = 'Novel/Research/Castle.md';
const DIARY = 'Elsewhere/Diary.md';

const PAUSE = MEASURE_AFTER_MS + 100;
const QUIET = WRITE_AFTER_QUIET_MS;
/** Long enough for the screen to be drawn again. */
const FRAME = 20;

const stands: Stand[] = [];

async function standUp(options?: Parameters<typeof makeStand>[0]): Promise<Stand> {
  const stand = await makeStand(options);
  stands.push(stand);
  return stand;
}

/**
 * Let the screen catch up: what was asked for is read, and the line is drawn
 * again (once for what was known at once, once more for what had to be read).
 */
async function drawn(stand: Stand): Promise<void> {
  await stand.pass(FRAME);
  await stand.pass(FRAME);
}

/**
 * Let the manuscript's words be counted. The writing progress asks for them
 * itself, under its own name; no binder needs to be open.
 */
async function countManuscript(stand: Stand): Promise<void> {
  await drawn(stand);
}

const isOpen = (modal: TargetsModal): boolean => (modal as unknown as Modal).isOpen;

/** Put another device's log file for a month into the vault before the project is opened. */
function otherDevice(device: string, month: string, days: readonly StatsChange[]): (vault: MemoryVault) => void {
  return (vault) => {
    const made = updateStatsText(null, { device, deviceName: 'Phone', month }, days);
    if (made.status !== 'write') throw new Error('could not make the other device\'s log');
    vault.seed(`Novel/Stats/${month} ${device}.md`, { body: made.text });
  };
}

function command(stand: Stand, id: string): NonNullable<Stand['plugin']['commands'][number]> {
  const found = stand.plugin.commands.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`no command "${id}"`);
  return found;
}

/** The targets window that is open, or a failed test. */
function targetsWindow(): TargetsModal {
  const open = Modal.opened.filter((modal) => modal.isOpen);
  if (open.length !== 1 || !(open[0] instanceof TargetsModal)) throw new Error(`expected the targets window, found ${open.length} windows`);
  return open[0];
}

function field(modal: TargetsModal, name: string): FakeElement {
  const content = modal.contentEl as unknown as FakeElement;
  const found = content.withClass('spellbook-targets-input').filter((input) => input.attrs['id'] === `spellbook-targets-${name}`);
  if (found.length !== 1) throw new Error(`expected one field "${name}", found ${found.length}`);
  return found[0] as FakeElement;
}

function fill(modal: TargetsModal, name: string, value: string): void {
  const input = field(modal, name);
  input.value = value;
  input.dispatch('input');
}

function button(modal: TargetsModal, text: string): ButtonComponent {
  const content = modal.contentEl as unknown as FakeElement;
  const buttons = content.settings.flatMap((row: Setting) => row.components) as ButtonComponent[];
  const found = buttons.filter((candidate) => candidate.buttonEl.text === text);
  if (found.length !== 1) throw new Error(`expected one button "${text}", found ${found.length}`);
  return found[0] as ButtonComponent;
}

const messages = (modal: TargetsModal): string[] =>
  (modal.contentEl as unknown as FakeElement)
    .all()
    .filter((element) => element.attrs['role'] === 'alert' && element.text !== '')
    .map((element) => element.text);

beforeEach(() => {
  Notice.shown.length = 0;
  Modal.opened.length = 0;
  resetFakeDocument();
});

afterEach(async () => {
  for (const stand of stands.splice(0)) await stand.unload();
  resetPlatform();
  vi.restoreAllMocks();
});

describe('the line of figures', () => {
  it('shows the open scene, the session, the project and today, each against its target', async () => {
    const stand = await standUp({ extra: { targets: { project: 80000, daily: 5, deadline: '2026-12-31' } } });
    stand.vault.setCreatedDay(OPENING, '2026-09-01');
    stand.vault.external.editFrontmatter(OPENING, (frontmatter) => {
      frontmatter['target'] = 15;
      frontmatter['edited'] = '2026-10-02';
    });
    await countManuscript(stand);
    stand.workspace.show(OPENING);
    await drawn(stand);
    expect(stand.line()).toEqual([
      'Words 9 / 15',
      'Started 1 Sep 2026',
      'Edited 2 Oct 2026',
      'Session 0',
      'Project 19 / 80,000',
      'Today 0 / 5',
    ]);

    stand.editor(OPENING).type('Six more words for the scene. ');
    await stand.pass(PAUSE);
    expect(stand.line()).toEqual([
      'Words 15 / 15 (met)',
      'Started 1 Sep 2026',
      'Edited 13 Oct 2026', // typed in today, though the note does not say so yet
      'Session 6',
      'Project 19 / 80,000', // the manuscript's total follows the saved files
      'Today 6 / 5 (met)',
    ]);
  });

  it('follows the note in front: no scene pieces for a note outside the project, nothing without a project', async () => {
    const stand = await standUp();
    await countManuscript(stand);
    stand.workspace.show(LETTER);
    await drawn(stand);
    expect(stand.line()).toEqual(['Words 10', 'Session 0', 'Project 19', 'Today 0']);

    stand.workspace.show(CASTLE);
    await drawn(stand);
    expect(stand.line()).toEqual(['Words 4', 'Session 0', 'Project 19', 'Today 0']);

    stand.workspace.show(DIARY);
    await drawn(stand);
    expect(stand.line()).toEqual(['Session 0', 'Project 19', 'Today 0']);

    stand.workspace.show(null);
    await drawn(stand);
    expect(stand.line()).toEqual(['Session 0', 'Project 19', 'Today 0']);

    await stand.store.closeProject();
    await drawn(stand);
    expect(stand.line()).toEqual([]);
  });

  it('shows the project total with the binder closed', async () => {
    const stand = await standUp();
    // No binder, no corkboard: the writing progress asks for the manuscript's words under its own name.
    expect(stand.wordCounts.askers()).toEqual(['progress']);
    stand.workspace.show(OPENING);
    await drawn(stand);
    expect(stand.line()).toEqual(['Words 9', 'Session 0', 'Project 19', 'Today 0']);
  });

  it('keeps the project total when the binder opens and closes, and follows the manuscript', async () => {
    const stand = await standUp();
    stand.workspace.show(OPENING);
    await drawn(stand);
    const reads = stand.vault.reads.readText;

    // The binder opens (it also wants the research note) and closes: it lets go of its own request only.
    stand.wordCounts.track('binder', [OPENING, LETTER, CASTLE]);
    await drawn(stand);
    expect(stand.vault.reads.readText).toBe(reads + 1); // only the research note was new
    stand.wordCounts.release('binder');
    await drawn(stand);
    expect(stand.wordCounts.askers()).toEqual(['progress']);
    expect(stand.wordCounts.get(CASTLE)).toBeUndefined();
    expect(stand.line()).toEqual(['Words 9', 'Session 0', 'Project 19', 'Today 0']);
    expect(stand.vault.reads.readText).toBe(reads + 1); // the scenes were not read again

    // A scene is added to the manuscript: its words join the total.
    const added = await stand.store.addScene('Ending');
    expect(added.status).toBe('done');
    await drawn(stand);
    expect(stand.wordCounts.get('Novel/Manuscript/Ending.md')).toBe(0);
    stand.vault.external.write('Novel/Manuscript/Ending.md', { body: 'Three more words.\n' });
    await stand.pass(1100); // the note has stopped being saved: it is counted again
    await drawn(stand);
    expect(stand.line()).toContain('Project 22');

    // With no project open there is nothing to count.
    await stand.store.closeProject();
    await drawn(stand);
    expect(stand.wordCounts.askers()).toEqual([]);
  });

  it('counts the open note again when it changes on disk without being typed in', async () => {
    const stand = await standUp();
    stand.workspace.show(OPENING);
    await drawn(stand);
    expect(stand.line()).toContain('Words 9');
    stand.vault.external.write(OPENING, { body: 'Only four words now.\n' });
    await stand.pass(1100);
    expect(stand.line()).toContain('Words 4');
  });

  it('tells its listeners when typing pauses, when another note opens and when the targets change', async () => {
    const stand = await standUp();
    stand.workspace.show(OPENING);
    await drawn(stand);
    let told = 0;
    const stop = stand.sceneLine().onChange(() => told++);

    const editor = stand.editor(OPENING);
    editor.type('One two. ');
    await stand.pass(500);
    expect(told).toBe(0); // not while typing
    await stand.pass(PAUSE);
    expect(told).toBe(1);

    let before = told;
    stand.workspace.show(LETTER);
    await drawn(stand);
    expect(told).toBeGreaterThan(before);
    expect(stand.line()).toContain('Words 10');

    before = told;
    await stand.store.updateProjectData('targets', () => ({ daily: 500 }));
    await drawn(stand);
    expect(told).toBe(before + 1);
    expect(stand.line()).toContain('Today 2 / 500');

    // Nothing changed: nobody is told.
    before = told;
    await stand.pass(60_000);
    expect(told).toBe(before);

    stop();
    stand.workspace.show(OPENING);
    await drawn(stand);
    expect(told).toBe(before);
  });
});

describe('the bottom bar', () => {
  it('draws the line in the status bar, and draws it again when the figures change', async () => {
    const stand = await standUp({ extra: { targets: { daily: 2 } } });
    stand.workspace.show(OPENING);
    await drawn(stand);
    const bar = stand.bar();
    if (!bar) throw new Error('no status bar item');
    expect(bar.hasClass('spellbook-status')).toBe(true);
    // The project total is there although no binder is open.
    expect(bar.fullText).toBe('Words 9 Session 0 Project 19 Today 0 / 2');
    expect(bar.hasClass('spellbook-is-empty')).toBe(false);

    stand.editor(OPENING).type('One two three. ');
    await stand.pass(500);
    expect(bar.fullText).toBe('Words 9 Session 0 Project 19 Today 0 / 2'); // nothing is drawn while the writer types
    await stand.pass(PAUSE);
    // (The project total is counted from the saved notes: it follows when the editor saves.)
    expect(bar.fullText).toBe('Words 12 Edited 13 Oct 2026 Session 3 Project 19 Today 3 / 2');
    const today = bar.withClass('spellbook-status-today')[0];
    expect(today?.hasClass('spellbook-is-met')).toBe(true);
    // Figures read left to right, also in an app that runs right to left.
    for (const value of bar.withClass('spellbook-status-value')) expect(value.attrs['dir']).toBe('ltr');

    await stand.store.closeProject();
    await drawn(stand);
    expect(bar.fullText).toBe('');
    expect(bar.hasClass('spellbook-is-empty')).toBe(true);
  });

  it('opens the targets window when it is clicked', async () => {
    const stand = await standUp();
    await drawn(stand);
    stand.bar()?.dispatch('click');
    expect(targetsWindow()).toBeInstanceOf(TargetsModal);
  });

  it('starts "Today" again at midnight, also when nothing is typed and nothing else happens', async () => {
    const stand = await standUp({ extra: { targets: { daily: 2 } } });
    stand.workspace.show(OPENING);
    stand.editor(OPENING).type('One two three. ');
    await stand.pass(PAUSE);
    await stand.pass(QUIET);
    const bar = stand.bar();
    if (!bar) throw new Error('no status bar item');
    expect(bar.fullText).toContain('Today 3 / 2');
    expect(bar.withClass('spellbook-status-today')[0]?.hasClass('spellbook-is-met')).toBe(true);
    expect(stand.logDays('2026-10')).toEqual([{ date: DAY, manuscriptAdded: 3, manuscriptDeleted: 0, otherAdded: 0, otherDeleted: 0 }]);

    await stand.pass(10 * 60_000); // the save and everything that follows it have come to rest
    let lineTold = 0;
    let statsTold = 0;
    stand.sceneLine().onChange(() => lineTold++);
    stand.stats().onChange(() => statsTold++);
    // A long evening in which nothing is typed: nothing changes, nobody is told.
    await stand.pass(SIX_HOURS - 11 * 60_000);
    expect(bar.fullText).toContain('Today 3 / 2');
    expect([lineTold, statsTold]).toEqual([0, 0]);

    // Midnight. Nobody touches the keyboard.
    stand.clock.date = '2026-10-14';
    await stand.pass(60_000 + AFTER_MIDNIGHT_MS + FRAME);
    expect(bar.fullText).toContain('Today 0 / 2');
    expect(bar.fullText).toContain('Session 3'); // the session goes on
    expect(bar.withClass('spellbook-status-today')[0]?.hasClass('spellbook-is-met')).toBe(false);
    // The inspector's line and the planner's figures are told, so they roll over too.
    expect(lineTold).toBe(1);
    expect(statsTold).toBe(1);
    expect(asText(stand.sceneLine().current())).toContain('Today 0 / 2');
    expect((await stand.stats().summary('2026-10-14')).dailyTargetMet).toBe(false);
    expect((await stand.stats().summary('2026-10-14')).streak).toBe(1); // yesterday still counts

    // Yesterday's words stay yesterday's, and the wait starts again for the next midnight.
    expect(stand.logDays('2026-10')).toEqual([{ date: DAY, manuscriptAdded: 3, manuscriptDeleted: 0, otherAdded: 0, otherDeleted: 0 }]);
    expect(stand.clock.pending).toBe(1);
    stand.clock.date = '2026-10-15';
    await stand.pass(SIX_HOURS + AFTER_MIDNIGHT_MS + FRAME);
    expect(statsTold).toBe(2);
  });

  it('looks at the date once a minute when the clock cannot say how long it is until midnight', async () => {
    const stand = await standUp({ toMidnight: null, extra: { targets: { daily: 2 } } });
    stand.workspace.show(OPENING);
    stand.editor(OPENING).type('One two three. ');
    await stand.pass(PAUSE);
    await stand.pass(QUIET);
    const bar = stand.bar();
    if (!bar) throw new Error('no status bar item');
    expect(bar.fullText).toContain('Today 3 / 2');
    await stand.pass(10 * DAY_CHECK_MS);
    expect(bar.fullText).toContain('Today 3 / 2');

    stand.clock.date = '2026-10-14';
    await stand.pass(DAY_CHECK_MS + FRAME);
    expect(bar.fullText).toContain('Today 0 / 2');
  });

  it('rolls over when the app comes back into view after a night out of sight', async () => {
    const stand = await standUp({ extra: { targets: { daily: 2 } } });
    stand.workspace.show(OPENING);
    stand.editor(OPENING).type('One two three. ');
    await stand.pass(PAUSE);
    await stand.pass(QUIET);
    const bar = stand.bar();
    if (!bar) throw new Error('no status bar item');
    setHidden(true);
    await stand.rest();
    // A phone asleep runs no timers: the date changes and nothing fires.
    stand.clock.date = '2026-10-14';
    setHidden(false);
    await drawn(stand);
    expect(bar.fullText).toContain('Today 0 / 2');
  });

  it('is not there on a phone, where the inspector shows the line instead', async () => {
    Object.assign(Platform, { isDesktop: false, isMobile: true, isPhone: true });
    const stand = await standUp({
      prepare: otherDevice('tablet0001', '2026-10', [{ date: DAY, counts: { manuscriptAdded: 7 } }]),
    });
    stand.workspace.show(OPENING);
    await drawn(stand);
    expect(stand.bar()).toBeNull();
    // Nobody is looking at the line yet: the two scenes were counted (each read once), and no log file was read.
    expect(stand.vault.reads.readText).toBe(2);
    // The inspector asks for it: today's words follow once the logs are read.
    let told = 0;
    stand.sceneLine().onChange(() => told++);
    expect(stand.line()).toEqual(['Words 9', 'Session 0', 'Project 19']);
    await drawn(stand);
    expect(told).toBeGreaterThan(0);
    expect(stand.line()).toEqual(['Words 9', 'Session 0', 'Project 19', 'Today 7']);
  });
});

describe('the word log, for the calendar', () => {
  const phone = otherDevice('phone00001', '2026-10', [
    { date: '2026-10-09', counts: { manuscriptAdded: 300 } },
    { date: '2026-10-12', counts: { manuscriptAdded: 100, otherAdded: 20 } },
    { date: DAY, counts: { manuscriptAdded: 40, manuscriptDeleted: 10 } },
  ]);
  const lastMonth = otherDevice('phone00001', '2026-09', [{ date: '2026-09-30', counts: { manuscriptAdded: 1000 } }]);

  it('adds up the files of every device, and this device\'s unsaved words, each word once', async () => {
    const stand = await standUp({
      extra: { targets: { daily: 40 } },
      prepare: (vault) => {
        phone(vault);
        lastMonth(vault);
      },
    });
    const stats = stand.stats();
    expect([...(await stats.wordsByDay('2026-10-01', '2026-10-31'))]).toEqual([
      ['2026-10-09', { manuscript: 300, all: 300 }],
      ['2026-10-12', { manuscript: 100, all: 120 }],
      [DAY, { manuscript: 30, all: 30 }],
    ]);
    // Both ends are included, and days outside are not.
    expect([...(await stats.wordsByDay('2026-09-30', '2026-10-09')).keys()]).toEqual(['2026-09-30', '2026-10-09']);
    expect([...(await stats.wordsByDay('2026-10-10', '2026-10-11'))]).toEqual([]);

    // Words typed here count at once, before they are saved...
    stand.editor(OPENING).type('Five words typed over here. ');
    stand.editor(CASTLE).type('And two. ');
    await stand.pass(PAUSE);
    const unsaved = await stats.wordsByDay(DAY, DAY);
    expect(unsaved.get(DAY)).toEqual({ manuscript: 35, all: 37 });
    // ...and no more after they are.
    await stand.pass(QUIET);
    expect(stand.logDays('2026-10')).toHaveLength(1);
    const saved = await stats.wordsByDay(DAY, DAY);
    expect(saved.get(DAY)).toEqual({ manuscript: 35, all: 37 });

    expect(await stats.summary(DAY)).toEqual({
      streak: 2, // the 12th and the 13th; the 9th is further back
      average: 359, // 1,000 + 300 + 100 + 35 over four days of writing
      weekTotal: 135, // Monday the 12th and Tuesday the 13th
      monthTotal: 435,
      dailyTarget: 40,
      dailyTargetMet: false,
    });
  });

  it('counts "this week" from the same first day of the week as the calendar grid', async () => {
    // Sunday the 11th and Tuesday the 13th (today).
    const week = otherDevice('phone00001', '2026-10', [
      { date: '2026-10-11', counts: { manuscriptAdded: 50 } },
      { date: DAY, counts: { manuscriptAdded: 7 } },
    ]);
    const stand = await standUp({ prepare: week });
    const stats = stand.stats();
    try {
      momentLocale.firstDayOfWeek = 0; // a language whose weeks start on Sunday
      expect((await stats.summary(DAY)).weekTotal).toBe(57);
      momentLocale.firstDayOfWeek = 1; // and one whose weeks start on Monday
      expect((await stats.summary(DAY)).weekTotal).toBe(7);
    } finally {
      momentLocale.firstDayOfWeek = 0;
    }
  });

  it('says whether today\'s target is met, and gives zeros for a project nobody has written in', async () => {
    const stand = await standUp({ extra: { targets: { daily: 3 } } });
    const stats = stand.stats();
    expect(await stats.summary(DAY)).toEqual({
      streak: 0,
      average: 0,
      weekTotal: 0,
      monthTotal: 0,
      dailyTarget: 3,
      dailyTargetMet: false,
    });
    expect((await stats.wordsByDay('2026-01-01', '2026-12-31')).size).toBe(0);
    expect((await stats.wordsByDay('not a date', DAY)).size).toBe(0);

    stand.editor(OPENING).type('One two three. ');
    await stand.pass(PAUSE);
    expect(await stats.summary(DAY)).toMatchObject({ streak: 1, weekTotal: 3, dailyTarget: 3, dailyTargetMet: true });
  });

  it('reads a log file again when it arrives from another device, and tells its listeners', async () => {
    const stand = await standUp();
    const stats = stand.stats();
    expect((await stats.wordsByDay(DAY, DAY)).size).toBe(0);
    let told = 0;
    stats.onChange(() => told++);

    const made = updateStatsText(null, { device: 'tablet0001', deviceName: 'Tablet', month: '2026-10' }, [
      { date: DAY, counts: { manuscriptAdded: 70 } },
    ]);
    if (made.status !== 'write') throw new Error('could not make the log');
    stand.vault.seedFolder('Novel/Stats');
    await stand.vault.updateText('Novel/Stats/2026-10 tablet0001.md', () => made.text);
    await drawn(stand);
    expect(told).toBeGreaterThan(0);
    expect((await stats.wordsByDay(DAY, DAY)).get(DAY)).toEqual({ manuscript: 70, all: 70 });

    // A copy of the same file left by a sync conflict is not counted twice.
    await stand.vault.updateText('Novel/Stats/2026-10 tablet0001 2.md', () => made.text);
    await drawn(stand);
    expect((await stats.wordsByDay(DAY, DAY)).get(DAY)).toEqual({ manuscript: 70, all: 70 });
  });

  it('reads each log file once, not every time it is asked', async () => {
    const stand = await standUp({ prepare: phone });
    const stats = stand.stats();
    await stats.wordsByDay(DAY, DAY);
    const reads = stand.vault.reads.readText;
    await stats.wordsByDay('2026-10-01', '2026-10-31');
    await stats.summary(DAY);
    stand.editor(OPENING).type('One. ');
    await stand.pass(PAUSE);
    await stand.pass(QUIET); // this device's own file is saved, and known without reading it back
    await stats.summary(DAY);
    expect(stand.vault.reads.readText).toBe(reads);
  });
});

describe('the targets window', () => {
  it('is opened by the command "Set writing targets", which is only offered while a project is open', async () => {
    const stand = await standUp();
    const set = command(stand, 'set-writing-targets');
    expect(set.name).toBe('Set writing targets');
    expect(set.checkCallback?.(true)).toBe(true);
    expect(Modal.opened).toEqual([]); // asking is not running

    set.checkCallback?.(false);
    const modal = targetsWindow();
    expect((modal.titleEl as unknown as FakeElement).text).toBe('Writing targets');
    expect((modal.modalEl as unknown as FakeElement).hasClass('spellbook-targets')).toBe(true);

    modal.close();
    await stand.store.closeProject();
    expect(set.checkCallback?.(true)).toBe(false);
  });

  it('stores the project\'s targets and the open scene\'s target, and nothing else', async () => {
    const stand = await standUp({ title: 'הרומן שלי' });
    stand.workspace.show(OPENING);
    await drawn(stand);
    command(stand, 'set-writing-targets').checkCallback?.(false);
    const modal = targetsWindow();
    const content = modal.contentEl as unknown as FakeElement;

    // The writer's own text takes its own direction.
    const title = content.withClass('spellbook-targets-project')[0];
    expect(title?.text).toBe('הרומן שלי');
    expect(title?.attrs['dir']).toBe('auto');
    const about = content.withClass('spellbook-targets-about')[0];
    expect(about?.text).toBe('Opening');
    expect(about?.attrs['dir']).toBe('auto');
    // Fields a phone's keyboard can fill: a number pad for words, the device's date picker for the day.
    expect(field(modal, 'project').attrs).toMatchObject({ type: 'text', inputmode: 'numeric' });
    expect(field(modal, 'deadline').attrs).toMatchObject({ type: 'date' });
    expect(['project', 'daily', 'deadline', 'scene'].map((name) => field(modal, name).value)).toEqual(['', '', '', '']);

    fill(modal, 'project', '80,000');
    fill(modal, 'daily', '500');
    fill(modal, 'deadline', '2026-12-31');
    fill(modal, 'scene', '1500');
    stand.vault.clearWrites();
    button(modal, 'Save').click();
    await stand.rest();

    expect(isOpen(modal)).toBe(false);
    expect(stand.vault.frontmatterOf(stand.indexPath)?.['targets']).toEqual({ project: 80000, daily: 500, deadline: '2026-12-31' });
    expect(stand.vault.frontmatterOf(OPENING)).toEqual({ status: 'To do', order: 1024, target: 1500 });
    expect(stand.vault.writes).toEqual([
      { op: 'updateFrontmatter', path: stand.indexPath },
      { op: 'updateFrontmatter', path: OPENING },
    ]);
    await drawn(stand);
    expect(stand.line()).toEqual(expect.arrayContaining(['Words 9 / 1,500', 'Today 0 / 500']));
  });

  it('shows what is stored, removes a target whose field is emptied, and leaves alone what was not changed', async () => {
    const stand = await standUp({ extra: { targets: { project: 80000, daily: 500, deadline: '2026-12-31', pace: 'steady' } } });
    stand.vault.external.editFrontmatter(OPENING, (frontmatter) => {
      frontmatter['target'] = 1500;
    });
    await countManuscript(stand);
    stand.workspace.show(OPENING);
    await drawn(stand);
    command(stand, 'set-writing-targets').checkCallback?.(false);
    const modal = targetsWindow();
    expect(['project', 'daily', 'deadline', 'scene'].map((name) => field(modal, name).value)).toEqual([
      '80000',
      '500',
      '2026-12-31',
      '1500',
    ]);
    const standing = (modal.contentEl as unknown as FakeElement).withClass('spellbook-targets-standing').map((line) => line.text);
    expect(standing).toEqual([
      'The manuscript has 19 of 80,000 words (0%).',
      '80 days of writing left until the deadline, 31 Dec 2026, counting today. That takes 1,000 words a day.',
    ]);

    fill(modal, 'daily', '');
    stand.vault.clearWrites();
    button(modal, 'Save').click();
    await stand.rest();
    expect(isOpen(modal)).toBe(false);
    // A part this version does not know stays where it is.
    expect(stand.vault.frontmatterOf(stand.indexPath)?.['targets']).toEqual({ project: 80000, deadline: '2026-12-31', pace: 'steady' });
    // The scene's field was not touched: its note is not written.
    expect(stand.vault.writes).toEqual([{ op: 'updateFrontmatter', path: stand.indexPath }]);

    command(stand, 'set-writing-targets').checkCallback?.(false);
    const again = targetsWindow();
    fill(again, 'scene', '');
    button(again, 'Save').click();
    await stand.rest();
    expect(stand.vault.frontmatterOf(OPENING)).toEqual({ status: 'To do', order: 1024 });
  });

  it('says what is wrong with a field, writes nothing, and stays open', async () => {
    const stand = await standUp();
    stand.workspace.show(OPENING);
    await drawn(stand);
    command(stand, 'set-writing-targets').checkCallback?.(false);
    const modal = targetsWindow();
    fill(modal, 'project', 'a lot');
    fill(modal, 'daily', '0');
    fill(modal, 'scene', '-5');
    stand.vault.clearWrites();
    button(modal, 'Save').click();
    await stand.rest();

    expect(isOpen(modal)).toBe(true);
    expect(stand.vault.writes).toEqual([]);
    expect(messages(modal)).toEqual([
      'Enter a whole number of words above zero, for example 80000.',
      'Enter a whole number of words above zero, for example 500.',
      'Enter a whole number of words above zero, for example 1500.',
    ]);
    expect(field(modal, 'project').hasClass('spellbook-is-invalid')).toBe(true);
    expect(field(modal, 'deadline').hasClass('spellbook-is-invalid')).toBe(false);

    // Putting it right takes the complaint away, and then it saves.
    fill(modal, 'project', '90000');
    expect(field(modal, 'project').hasClass('spellbook-is-invalid')).toBe(false);
    fill(modal, 'daily', '');
    fill(modal, 'scene', '');
    button(modal, 'Save').click();
    await stand.rest();
    expect(isOpen(modal)).toBe(false);
    expect(stand.vault.frontmatterOf(stand.indexPath)?.['targets']).toEqual({ project: 90000 });
  });

  it('has no scene field when the note in front is not a scene, and Cancel changes nothing', async () => {
    const stand = await standUp();
    stand.workspace.show(CASTLE);
    await drawn(stand);
    command(stand, 'set-writing-targets').checkCallback?.(false);
    const modal = targetsWindow();
    expect((modal.contentEl as unknown as FakeElement).withClass('spellbook-targets-input')).toHaveLength(3);
    fill(modal, 'project', '1000');
    stand.vault.clearWrites();
    button(modal, 'Cancel').click();
    await stand.rest();
    expect(isOpen(modal)).toBe(false);
    expect(stand.vault.writes).toEqual([]);
  });

  it('shows the message and stays open when the targets cannot be saved', async () => {
    const stand = await standUp();
    command(stand, 'set-writing-targets').checkCallback?.(false);
    const modal = targetsWindow();
    fill(modal, 'project', '1000');
    stand.vault.failNext('updateFrontmatter', stand.indexPath);
    button(modal, 'Save').click();
    await stand.rest();
    expect(isOpen(modal)).toBe(true);
    expect(messages(modal)).toEqual([expect.stringContaining('could not be saved')]);
  });
});

describe('the settings', () => {
  it('adds a "Writing progress" section whose switch is off by default and kept on this device', async () => {
    const stand = await standUp();
    expect(stand.features.settingsSections.map((section) => [section.id, section.title])).toEqual([['progress', 'Writing progress']]);
    const place = new FakeElement();
    stand.features.settingsSections[0]?.render(place as never);
    // (The rows of the bottom bar come after it, in a part of their own: see bar.test.ts.)
    expect(place.settings.map((row) => row.nameEl.text)).toEqual(['Count pasted text']);
    expect(place.withClass('spellbook-bar-settings')).toHaveLength(1);
    const toggle = (place.settings[0] as unknown as SettingWithToggles).toggles[0];
    if (!toggle) throw new Error('no switch');
    expect(toggle.getValue()).toBe(false);
    expect(stand.storage.saves).toEqual([]); // looking at the settings stores nothing

    toggle.flip();
    expect(stand.storage.saves).toEqual([[COUNT_PASTED_KEY, 'on']]);
    stand.editor(OPENING).paste('Three pasted words. ');
    await stand.pass(PAUSE);
    expect(stand.line()).toContain('Session 3');

    // Switched off again, nothing is kept on the device, and a paste counts for nothing.
    toggle.flip();
    expect(stand.storage.values.has(COUNT_PASTED_KEY)).toBe(false);
    stand.editor(LETTER).paste('More pasted words here. ');
    await stand.pass(PAUSE);
    expect(stand.line()).toContain('Session 3');
  });
});
