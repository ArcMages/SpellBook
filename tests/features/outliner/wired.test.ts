// The outliner as it is plugged into the plugin: the real feature on a
// project store that sits on the tests' memory vault. What the table shows is
// read from the stand-in screen; what it changes is read from the vault.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { describeCount, formatCount } from '../../../src/core/binderModel';
import { defaultLayout, readColumnPrefs, readViewPrefs, setColumnShown, viewOf, writeColumnPrefs } from '../../../src/core/outliner';
import { countWords } from '../../../src/core/wordCount';
import { COLUMNS_KEY, TASKS_SETTLE_MS, TASKS_SLICE, VIEW_KEY } from '../../../src/features/outliner/host';
import {
  DRAGGING_CLASS,
  EDITING_CLASS,
  EMPTY_TEXT,
  NO_MATCH_TEXT,
  NO_PROJECT_TEXT,
  OUTLINER_VIEW_TYPE,
  SEARCH_DELAY_MS,
} from '../../../src/features/outliner/outlinerView';
import { MemoryVault } from '../../memoryVault';
import {
  Menu as StubMenu,
  Notice as StubNotice,
  Platform,
  fakeDocument,
  fakeWindow,
  resetFakeDocument,
  resetPlatform,
} from '../../obsidianStub';
import type { FakeElement } from '../../obsidianStub';
import { INDEX_BODY, MemoryDeviceStorage, binderOnDisk, picture, tick } from '../../storeHarness';
import {
  CLOSING,
  CLOSING_BODY,
  DANIEL,
  GHOST,
  INNER_NAME,
  LETTER,
  LETTER_BODY,
  LOOSE,
  NIGHT,
  NIGHT_SYNOPSIS,
  NIGHT_TITLE,
  NOVEL_INDEX,
  OPENING,
  OPENING_BODY,
  SECOND_INDEX,
  WORDS,
  calm,
  cellOf,
  chipsOf,
  fieldIn,
  headerButton,
  headersOf,
  inNovel,
  lastMenu,
  nameOf,
  namesOf,
  novelVault,
  one,
  openOutliner,
  rowNamed,
  rowsOf,
  textOf,
  totalRow,
  wire,
} from './stage';
import type { WireOptions, Wired } from './stage';

const stages: Wired[] = [];

async function stage(vault?: MemoryVault, options?: WireOptions): Promise<Wired> {
  const wired = await wire(vault, options);
  stages.push(wired);
  return wired;
}

beforeEach(() => {
  StubMenu.shown.length = 0;
  StubNotice.shown.length = 0;
  resetFakeDocument();
  resetPlatform();
});

afterEach(() => {
  for (const wired of stages.splice(0)) wired.switchOff();
  resetPlatform();
});

const TOTAL_WORDS = WORDS.opening + WORDS.letter + WORDS.night + WORDS.closing;
const TREE_NAMES = ['Manuscript', 'Opening', 'Part one', 'The Letter', INNER_NAME, NIGHT_TITLE, 'Ghost', 'Closing'];
const WIDE_HEADERS = ['#', 'Name', 'Status', 'Label', 'Target', 'Words', 'Synopsis', 'Tags', 'Tasks', 'Read time', 'Compile'];

const percentOf = (words: number, target: number): string => `${Math.floor((words * 100) / target)}%`;
const notices = (): string[] => StubNotice.shown.map((notice) => notice.message);
const writesTo = (s: Wired, path: string): string[] => s.vault.writesTo(inNovel(path)).map((write) => write.op);
const checked = (box: FakeElement): unknown => (box as unknown as { checked?: unknown }).checked;

/** Tap the "more" button of a row and give its menu. */
function moreMenu(pane: FakeElement, name: string): StubMenu {
  one(rowNamed(pane, name), 'spellbook-outliner-more').fire('click');
  return lastMenu();
}

/** Tap one of the buttons above the table and give its menu. */
function barMenu(pane: FakeElement, text: 'Status' | 'Label' | 'Columns'): StubMenu {
  const cls = text === 'Columns' ? 'spellbook-outliner-columns' : 'spellbook-outliner-filter';
  const button = pane.withClass(cls).find((candidate) => candidate.text.startsWith(text));
  if (!button) throw new Error(`no "${text}" button`);
  button.fire('click');
  return lastMenu();
}

/** Type into the filter box and let the moment pass after which the table is filtered. */
function typeFilter(s: Wired, pane: FakeElement, text: string): void {
  const search = one(pane, 'spellbook-outliner-search');
  search.value = text;
  search.fire('input');
  s.timers.advance(SEARCH_DELAY_MS);
}

describe('plugging the outliner in', () => {
  it('registers the kind of pane, the command and the ribbon button, and does no work until a pane is open', async () => {
    const s = await stage();
    expect(s.features.ids).toEqual(['outliner']);
    expect(OUTLINER_VIEW_TYPE).toBe('spellbook-outliner');
    expect(s.plugin.viewTypes).toEqual([OUTLINER_VIEW_TYPE]);
    expect(s.plugin.commands.map((command) => [command.id, command.name])).toEqual([['open-outliner', 'Open outliner']]);
    expect(s.plugin.ribbonIcons.map((icon) => [icon.icon, icon.title])).toEqual([['table', 'Open Spellbook outliner']]);
    await calm(s);
    expect(s.vault.reads.readText).toBe(0);
    expect(s.vault.writes).toEqual([]);
    expect(s.workspace.leaves).toHaveLength(0);
  });

  it('opens as a tab in the main area, and brings the same pane back however often it is asked for', async () => {
    const s = await stage();
    const first = await openOutliner(s);
    expect(first.leaf.split).toBe(s.workspace.rootSplit);
    expect(first.view.getViewType()).toBe(OUTLINER_VIEW_TYPE);
    expect(first.view.getDisplayText()).toBe('Outliner');
    expect(first.view.getIcon()).toBe('table');
    s.plugin.ribbonIcons[0]?.callback({});
    s.command('open-outliner').callback?.();
    s.command('open-outliner').callback?.();
    await calm(s);
    expect(s.workspace.getLeavesOfType(OUTLINER_VIEW_TYPE)).toEqual([first.leaf]);
    expect(s.workspace.revealed.length).toBeGreaterThanOrEqual(2);
    // Two requests at once do not open two panes either.
    first.leaf.detach();
    s.command('open-outliner').callback?.();
    s.command('open-outliner').callback?.();
    await calm(s);
    expect(s.workspace.getLeavesOfType(OUTLINER_VIEW_TYPE)).toHaveLength(1);
  });

  it('says so when no project is open, and fills when one is opened', async () => {
    const s = await stage(novelVault(), { open: null });
    const { pane } = await openOutliner(s);
    expect(one(pane, 'spellbook-outliner-message').text).toBe(NO_PROJECT_TEXT);
    expect(rowsOf(pane)).toEqual([]);
    expect(one(pane, 'spellbook-outliner-search').disabled).toBe(true);
    await s.store.openProject(NOVEL_INDEX);
    await calm(s);
    expect(namesOf(pane)).toEqual(TREE_NAMES);
    expect(one(pane, 'spellbook-outliner-message').text).toBe('');
    expect(one(pane, 'spellbook-outliner-search').disabled).toBe(false);
  });
});

describe('the rows', () => {
  it('match the binder: the manuscript first, folders with their scenes under them, and a Total row at the foot', async () => {
    const s = await stage();
    const { pane } = await openOutliner(s);
    expect(namesOf(pane)).toEqual(TREE_NAMES);
    expect(nameOf(totalRow(pane))).toBe('Total');
    expect(headersOf(pane)).toEqual(WIDE_HEADERS);
    // Every scene has its number in the manuscript; rows of sums have none.
    expect(rowsOf(pane).map((row) => cellOf(row, 'number').text)).toEqual(['', '1', '', '2', '', '3', '4', '5']);
    // The kinds of row can be told apart, and an entry whose note is missing is greyed.
    expect(rowNamed(pane, 'Manuscript').hasClass('spellbook-outliner-manuscript')).toBe(true);
    expect(rowNamed(pane, 'Part one').hasClass('spellbook-outliner-folder')).toBe(true);
    expect(rowNamed(pane, 'Opening').hasClass('spellbook-outliner-scene')).toBe(true);
    expect(rowsOf(pane).filter((row) => row.hasClass('spellbook-is-missing')).map(nameOf)).toEqual(['Ghost']);
    // Rows inside a folder are set in, one step for each level.
    const insetOf = (name: string): string => one(rowNamed(pane, name), 'spellbook-outliner-name').style['paddingInlineStart'] ?? '';
    expect(insetOf('Opening')).toBe('calc(1 * var(--spellbook-outliner-indent))');
    expect(insetOf('The Letter')).toBe('calc(2 * var(--spellbook-outliner-indent))');
    expect(insetOf(NIGHT_TITLE)).toBe('calc(3 * var(--spellbook-outliner-indent))');
    // The table lives in the body, the Total row in the foot.
    expect(totalRow(pane).parent?.tag).toBe('tfoot');
    expect(rowNamed(pane, 'Opening').parent?.tag).toBe('tbody');
  });

  it('say the project\'s name, its words and its scenes above the table', async () => {
    const s = await stage();
    const { pane } = await openOutliner(s);
    const heading = one(pane, 'spellbook-outliner-heading');
    expect(heading.text).toBe('My Novel');
    expect(heading.getAttr('dir')).toBe('auto');
    expect(one(pane, 'spellbook-outliner-summary').text).toBe(`${describeCount(TOTAL_WORDS)} · 5 scenes`);
  });

  it('show what each scene says, with the writer\'s own text choosing its direction', async () => {
    const s = await stage();
    const { pane } = await openOutliner(s);
    const opening = rowNamed(pane, 'Opening');

    const title = one(opening, 'spellbook-outliner-title');
    expect(title.getAttr('dir')).toBe('auto');
    const status = one(opening, 'spellbook-outliner-status');
    expect(status.text).toBe('To do');
    expect(status.getAttr('dir')).toBe('auto');
    expect(status.hasClass('spellbook-outliner-color-red')).toBe(true);
    expect(one(cellOf(opening, 'label'), 'spellbook-outliner-dot').hasClass('spellbook-outliner-color-purple')).toBe(true);
    expect(one(opening, 'spellbook-outliner-label-name').text).toBe('Anna');

    expect(textOf(pane, 'Opening', 'words')).toBe(String(WORDS.opening));
    expect(textOf(pane, 'Opening', 'synopsis')).toBe('Anna arrives in the old town.');
    expect(one(cellOf(opening, 'synopsis'), 'spellbook-outliner-text').getAttr('dir')).toBe('auto');
    expect(cellOf(opening, 'tags').withClass('spellbook-outliner-tag').map((tag) => tag.text)).toEqual(['#draft', '#act-one']);
    expect(textOf(pane, 'Opening', 'tasks')).toBe('1/2');
    expect(textOf(pane, 'Opening', 'readTime')).toBe('1 min');
    expect(checked(one(opening, 'spellbook-outliner-compile'))).toBe(true);
    expect(checked(one(rowNamed(pane, 'Closing'), 'spellbook-outliner-compile'))).toBe(false);

    // The Hebrew scene: its title, its label and its synopsis are shown as they were written.
    const night = rowNamed(pane, NIGHT_TITLE);
    expect(one(night, 'spellbook-outliner-label-name').text).toBe(DANIEL);
    expect(one(cellOf(night, 'label'), 'spellbook-outliner-dot').hasClass('spellbook-outliner-color-cyan')).toBe(true);
    expect(textOf(pane, NIGHT_TITLE, 'synopsis')).toBe(NIGHT_SYNOPSIS);
    expect(textOf(pane, NIGHT_TITLE, 'tasks')).toBe('1/1');
    // A status the project's list lacks is shown, without a colour.
    expect(one(rowNamed(pane, 'Closing'), 'spellbook-outliner-status').hasClass('spellbook-outliner-no-color')).toBe(true);
    // Nothing where there is nothing: no label, no target, no to-do lines.
    expect(textOf(pane, 'The Letter', 'label')).toBe('');
    expect(textOf(pane, 'Closing', 'target')).toBe('');
    expect(textOf(pane, 'The Letter', 'tasks')).toBe('');
    // Number cells carry no direction of their own, so that their digits stay in line.
    for (const column of ['number', 'words', 'tasks', 'readTime']) expect(cellOf(opening, column).getAttr('dir')).toBeNull();
  });

  it('show progress toward the target as a percentage, with a bar filled that far and coloured by its band', async () => {
    const s = await stage();
    const { pane } = await openOutliner(s);
    const low = one(cellOf(rowNamed(pane, 'Opening'), 'target'), 'spellbook-outliner-target');
    expect(one(low, 'spellbook-outliner-percent').text).toBe(percentOf(WORDS.opening, 1000));
    expect(one(low, 'spellbook-outliner-bar').style['width']).toBe(`${Math.round((WORDS.opening / 1000) * 100)}%`);
    expect(low.hasClass('spellbook-outliner-band-low')).toBe(true);
    // Past the target: the number goes on, the bar is full, the band is "done".
    const done = one(cellOf(rowNamed(pane, 'The Letter'), 'target'), 'spellbook-outliner-target');
    expect(one(done, 'spellbook-outliner-percent').text).toBe(percentOf(WORDS.letter, 4));
    expect(one(done, 'spellbook-outliner-bar').style['width']).toBe('100%');
    expect(done.hasClass('spellbook-outliner-band-done')).toBe(true);
    expect(done.hasClass('spellbook-outliner-band-low')).toBe(false);
  });

  it('leave a missing scene without anything to edit', async () => {
    const s = await stage();
    const { pane } = await openOutliner(s);
    const ghost = rowNamed(pane, 'Ghost');
    expect(ghost.withClass('spellbook-outliner-editable')).toEqual([]);
    expect(ghost.withClass('spellbook-outliner-compile')).toEqual([]);
    expect(textOf(pane, 'Ghost', 'words')).toBe('');
    cellOf(ghost, 'synopsis').fire('click');
    expect(ghost.withClass('spellbook-outliner-input')).toEqual([]);
    expect(notices().join(' ')).toContain('Ghost');
    expect(s.vault.writes).toEqual([]);
  });
});

describe('the sums', () => {
  it('add up each folder, the manuscript and the Total row', async () => {
    const s = await stage();
    const { pane } = await openOutliner(s);
    const inPart = WORDS.letter + WORDS.night;
    expect(textOf(pane, 'Part one', 'words')).toBe(formatCount(inPart));
    expect(textOf(pane, INNER_NAME, 'words')).toBe(formatCount(WORDS.night));
    expect(textOf(pane, 'Manuscript', 'words')).toBe(formatCount(TOTAL_WORDS));
    expect(textOf(pane, 'Total', 'words')).toBe(formatCount(TOTAL_WORDS));
    // The number of scenes stands under Name.
    expect(one(rowNamed(pane, 'Part one'), 'spellbook-outliner-count').text).toBe('2 scenes');
    expect(one(rowNamed(pane, INNER_NAME), 'spellbook-outliner-count').text).toBe('1 scene');
    expect(one(totalRow(pane), 'spellbook-outliner-count').text).toBe('5 scenes');
    // To-do lines and reading time.
    expect(textOf(pane, 'Part one', 'tasks')).toBe('1/1');
    expect(textOf(pane, 'Total', 'tasks')).toBe('2/3');
    expect(textOf(pane, 'Total', 'readTime')).toBe('1 min');
    // The other cells of a row of sums stay empty.
    for (const column of ['number', 'status', 'label', 'synopsis', 'tags', 'compile']) {
      expect(textOf(pane, 'Part one', column), column).toBe('');
      expect(textOf(pane, 'Total', column), column).toBe('');
    }
  });

  it('sum the targets, and measure them against the words of the scenes that have one', async () => {
    const s = await stage();
    const { pane } = await openOutliner(s);
    // In the folder only The Letter has a target (4 words).
    expect(textOf(pane, 'Part one', 'target')).toBe(`${percentOf(WORDS.letter, 4)} of 4`);
    // The folder inside it has none: nothing is shown.
    expect(textOf(pane, INNER_NAME, 'target')).toBe('');
    const written = WORDS.opening + WORDS.letter;
    expect(textOf(pane, 'Total', 'target')).toBe(`${percentOf(written, 1004)} of 1,004`);
    expect(textOf(pane, 'Manuscript', 'target')).toBe(`${percentOf(written, 1004)} of 1,004`);
  });

  it('follow a scene that is written in: its row, the rows of sums above it and the line above the table', async () => {
    const s = await stage();
    const { pane } = await openOutliner(s);
    const body = 'One two three four five six seven.\n';
    s.vault.external.write(inNovel(LETTER), { body });
    await calm(s);
    // Not at once: the note may still be being saved.
    expect(textOf(pane, 'The Letter', 'words')).toBe(String(WORDS.letter));
    s.timers.advance(TASKS_SETTLE_MS);
    await calm(s);
    const now = countWords(body);
    expect(textOf(pane, 'The Letter', 'words')).toBe(String(now));
    expect(textOf(pane, 'Part one', 'words')).toBe(formatCount(now + WORDS.night));
    expect(textOf(pane, 'Total', 'words')).toBe(formatCount(TOTAL_WORDS - WORDS.letter + now));
    expect(one(pane, 'spellbook-outliner-summary').text).toBe(`${describeCount(TOTAL_WORDS - WORDS.letter + now)} · 5 scenes`);
  });
});

describe('opening a scene', () => {
  it('opens the scene when its name is tapped; with Cmd or Ctrl, in a new tab', async () => {
    const s = await stage();
    const { pane } = await openOutliner(s);
    const title = (): FakeElement => one(rowNamed(pane, 'Opening'), 'spellbook-outliner-title');
    title().fire('click');
    title().fire('click', { metaKey: true });
    title().fire('click', { ctrlKey: true });
    // The wheel opens a new tab too, and so does Enter with the keyboard on the name.
    title().fire('auxclick', { button: 1 });
    title().fire('keydown', { key: 'Enter' });
    await calm(s);
    expect(s.opened).toEqual([
      { path: inNovel(OPENING), where: false },
      { path: inNovel(OPENING), where: 'tab' },
      { path: inNovel(OPENING), where: 'tab' },
      { path: inNovel(OPENING), where: 'tab' },
      { path: inNovel(OPENING), where: false },
    ]);
    // The table stays where it is.
    expect(namesOf(pane)).toEqual(TREE_NAMES);
  });

  it('opens from the "more" menu of a row', async () => {
    const s = await stage();
    const { pane } = await openOutliner(s);
    const menu = moreMenu(pane, NIGHT_TITLE);
    expect(menu.outline).toEqual(['Open', 'Open in new tab', '---', 'Move up', 'Move down']);
    menu.item('Open').click();
    moreMenu(pane, NIGHT_TITLE).item('Open in new tab').click();
    await calm(s);
    expect(s.opened).toEqual([
      { path: inNovel(NIGHT), where: false },
      { path: inNovel(NIGHT), where: 'tab' },
    ]);
  });

  it('says that a missing scene has no note, and offers nothing to open', async () => {
    const s = await stage();
    const { pane } = await openOutliner(s);
    one(rowNamed(pane, 'Ghost'), 'spellbook-outliner-title').fire('click');
    await calm(s);
    expect(s.opened).toEqual([]);
    expect(notices()).toHaveLength(1);
    expect(notices()[0]).toContain('Ghost');
    expect(moreMenu(pane, 'Ghost').outline.slice(0, 2)).toEqual(['Open (off)', 'Open in new tab (off)']);
  });
});

describe('editing a cell', () => {
  it('changes the status from a menu of the project\'s statuses, through the store, and draws that one row again', async () => {
    const s = await stage();
    const { pane } = await openOutliner(s);
    // What the other rows are made of, to see that they are left alone.
    const letterPill = one(rowNamed(pane, 'The Letter'), 'spellbook-outliner-status');
    const folderName = one(rowNamed(pane, 'Part one'), 'spellbook-outliner-folder-name');
    const openingRow = rowNamed(pane, 'Opening');
    const openingPill = one(openingRow, 'spellbook-outliner-status');

    cellOf(openingRow, 'status').fire('click');
    const menu = lastMenu();
    expect(menu.outline).toEqual(['To do', 'First draft', 'Done', '---', 'No status']);
    expect(menu.item('To do').checked).toBe(true);
    expect(menu.item('Done').checked).toBe(false);
    menu.item('Done').click();
    await calm(s);

    // One note was written, and only the key that changed.
    expect(s.vault.writes).toEqual([{ op: 'updateFrontmatter', path: inNovel(OPENING) }]);
    const saved = s.vault.frontmatterOf(inNovel(OPENING));
    expect(saved).toMatchObject({ status: 'Done', label: 'Anna', target: 1000, synopsis: 'Anna arrives in the old town.', pov: 'Anna' });
    expect(Object.keys(saved ?? {})).toHaveLength(10);
    expect(s.vault.bodyOf(inNovel(OPENING))).toBe(OPENING_BODY);

    // The same row, drawn again; the other rows are the very elements they were.
    expect(rowNamed(pane, 'Opening')).toBe(openingRow);
    const pill = one(openingRow, 'spellbook-outliner-status');
    expect(pill).not.toBe(openingPill);
    expect(pill.text).toBe('Done');
    expect(pill.hasClass('spellbook-outliner-color-green')).toBe(true);
    expect(one(rowNamed(pane, 'The Letter'), 'spellbook-outliner-status')).toBe(letterPill);
    expect(one(rowNamed(pane, 'Part one'), 'spellbook-outliner-folder-name')).toBe(folderName);
  });

  it('offers a status the list lacks while the scene has it, and can take the status away', async () => {
    const s = await stage();
    const { pane } = await openOutliner(s);
    cellOf(rowNamed(pane, 'Closing'), 'status').fire('click');
    expect(lastMenu().outline).toEqual(['To do', 'First draft', 'Done', 'Sent off', '---', 'No status']);
    expect(lastMenu().item('Sent off').checked).toBe(true);
    lastMenu().item('No status').click();
    await calm(s);
    expect(s.vault.frontmatterOf(inNovel(CLOSING))).toEqual({ status: '', compile: false, order: 4096 });
    expect(textOf(pane, 'Closing', 'status')).toBe('');
  });

  it('changes the label from a menu of the project\'s labels', async () => {
    const s = await stage();
    const { pane } = await openOutliner(s);
    cellOf(rowNamed(pane, 'The Letter'), 'label').fire('click');
    expect(lastMenu().outline).toEqual(['Anna', DANIEL, '---', 'No label']);
    expect(lastMenu().item('No label').checked).toBe(true);
    // A label's name is the writer's own text: it chooses its own direction in the menu too.
    expect(lastMenu().item(DANIEL).titleEl?.withClass('spellbook-outliner-menu-name')[0]?.getAttr('dir')).toBe('auto');
    lastMenu().item(DANIEL).click();
    await calm(s);
    expect(s.vault.frontmatterOf(inNovel(LETTER))).toEqual({ status: 'First draft', target: 4, order: 2048, pov: 'Daniel', label: DANIEL });
    expect(one(rowNamed(pane, 'The Letter'), 'spellbook-outliner-label-name').text).toBe(DANIEL);
    // Choosing what the scene already has writes nothing.
    s.vault.clearWrites();
    cellOf(rowNamed(pane, 'The Letter'), 'label').fire('click');
    lastMenu().item(DANIEL).click();
    await calm(s);
    expect(s.vault.writes).toEqual([]);
  });

  it('edits the target in a number field: Enter saves it, an empty field removes it', async () => {
    const s = await stage();
    const { pane } = await openOutliner(s);
    const cell = cellOf(rowNamed(pane, 'Opening'), 'target');
    cell.fire('click');
    const field = fieldIn(cell);
    expect(field.tag).toBe('input');
    expect(field.getAttr('type')).toBe('number');
    expect(field.value).toBe('1000');
    expect(field.focused).toBe(true);
    expect(field.selected).toBe(true);
    expect(cell.hasClass(EDITING_CLASS)).toBe(true);

    field.value = '2000';
    field.fire('keydown', { key: 'Enter' });
    expect(cell.withClass('spellbook-outliner-input')).toEqual([]);
    expect(cell.hasClass(EDITING_CLASS)).toBe(false);
    await calm(s);
    expect(s.vault.frontmatterOf(inNovel(OPENING))?.['target']).toBe(2000);
    expect(writesTo(s, OPENING)).toEqual(['updateFrontmatter']);
    expect(one(cell, 'spellbook-outliner-percent').text).toBe(percentOf(WORDS.opening, 2000));
    // The Total row follows.
    expect(textOf(pane, 'Total', 'target')).toBe(`${percentOf(WORDS.opening + WORDS.letter, 2004)} of 2,004`);

    cell.fire('click');
    fieldIn(cell).value = '';
    fieldIn(cell).fire('keydown', { key: 'Enter' });
    await calm(s);
    const saved = s.vault.frontmatterOf(inNovel(OPENING)) ?? {};
    expect('target' in saved).toBe(false);
    expect(saved['status']).toBe('To do');
    expect(textOf(pane, 'Opening', 'target')).toBe('');
    expect(s.vault.bodyOf(inNovel(OPENING))).toBe(OPENING_BODY);
  });

  it('gives a scene without a target one, and refuses what is not a whole number', async () => {
    const s = await stage();
    const { pane } = await openOutliner(s);
    const cell = cellOf(rowNamed(pane, 'Closing'), 'target');
    cell.fire('click');
    expect(fieldIn(cell).value).toBe('');
    fieldIn(cell).value = '12.5';
    fieldIn(cell).fire('keydown', { key: 'Enter' });
    await calm(s);
    expect(s.vault.writes).toEqual([]);
    expect(notices()).toEqual(['A target is a whole number of words.']);

    cell.fire('click');
    fieldIn(cell).value = '8';
    fieldIn(cell).fire('blur');
    await calm(s);
    expect(s.vault.frontmatterOf(inNovel(CLOSING))).toEqual({ status: 'Sent off', compile: false, order: 4096, target: 8 });
    expect(one(cell, 'spellbook-outliner-percent').text).toBe(percentOf(WORDS.closing, 8));
  });

  it('edits the synopsis in place: tapping elsewhere saves it, exactly as typed', async () => {
    const s = await stage();
    const { pane } = await openOutliner(s);
    const cell = cellOf(rowNamed(pane, NIGHT_TITLE), 'synopsis');
    cell.fire('click');
    const field = fieldIn(cell);
    expect(field.tag).toBe('textarea');
    expect(field.getAttr('dir')).toBe('auto');
    expect(field.value).toBe(NIGHT_SYNOPSIS);
    const typed = `${NIGHT_SYNOPSIS}\nAnd a second line, in English.`;
    field.value = typed;
    field.fire('blur');
    await calm(s);
    expect(s.vault.frontmatterOf(inNovel(NIGHT))).toEqual({ synopsis: typed, status: 'Done', label: DANIEL, order: 3072 });
    expect(textOf(pane, NIGHT_TITLE, 'synopsis')).toBe(typed);
    expect(cell.withClass('spellbook-outliner-input')).toEqual([]);
  });

  it('saves nothing when Escape is pressed, or when nothing was changed', async () => {
    const s = await stage();
    const { pane } = await openOutliner(s);
    const cell = cellOf(rowNamed(pane, 'Opening'), 'synopsis');
    cell.fire('click');
    fieldIn(cell).value = 'Something else entirely.';
    const escape = fieldIn(cell).fire('keydown', { key: 'Escape' });
    expect(escape.defaultPrevented).toBe(true);
    await calm(s);
    expect(cell.withClass('spellbook-outliner-input')).toEqual([]);
    expect(textOf(pane, 'Opening', 'synopsis')).toBe('Anna arrives in the old town.');
    // The keyboard is handed back to the cell.
    expect(fakeDocument.activeElement).toBe(cell);

    cell.fire('click');
    fieldIn(cell).fire('keydown', { key: 'Enter' });
    cell.fire('click');
    fieldIn(cell).fire('blur');
    // Shift+Enter starts a new line in the synopsis: the field stays open.
    cell.fire('click');
    fieldIn(cell).fire('keydown', { key: 'Enter', shiftKey: true });
    expect(cell.withClass('spellbook-outliner-input')).toHaveLength(1);
    fieldIn(cell).fire('keydown', { key: 'Escape' });
    await calm(s);
    expect(s.vault.writes).toEqual([]);
    expect(notices()).toEqual([]);
  });

  it('opens a field with the keyboard as well: Enter on the cell', async () => {
    const s = await stage();
    const { pane } = await openOutliner(s);
    const cell = cellOf(rowNamed(pane, 'Opening'), 'target');
    expect(cell.getAttr('tabindex')).toBe('0');
    expect(cell.getAttr('role')).toBe('button');
    cell.fire('keydown', { key: 'Enter' });
    expect(fieldIn(cell).value).toBe('1000');
    // Enter inside the field saves; it does not open a second one.
    fieldIn(cell).value = '900';
    fieldIn(cell).fire('keydown', { key: 'Enter' });
    await calm(s);
    expect(cell.withClass('spellbook-outliner-input')).toEqual([]);
    expect(s.vault.frontmatterOf(inNovel(OPENING))?.['target']).toBe(900);
  });

  it('ticks and unticks "include in compile"', async () => {
    const s = await stage();
    const { pane } = await openOutliner(s);
    const box = one(rowNamed(pane, 'Opening'), 'spellbook-outliner-compile');
    expect(box.getAttr('type')).toBe('checkbox');
    (box as unknown as { checked: boolean }).checked = false;
    box.fire('change');
    await calm(s);
    expect(s.vault.frontmatterOf(inNovel(OPENING))?.['compile']).toBe(false);
    expect(checked(one(rowNamed(pane, 'Opening'), 'spellbook-outliner-compile'))).toBe(false);

    const other = one(rowNamed(pane, 'Closing'), 'spellbook-outliner-compile');
    (other as unknown as { checked: boolean }).checked = true;
    other.fire('change');
    await calm(s);
    expect(s.vault.frontmatterOf(inNovel(CLOSING))).toEqual({ status: 'Sent off', compile: true, order: 4096 });
  });

  it('puts the tick back and says why when the note could not be saved', async () => {
    const s = await stage();
    const { pane } = await openOutliner(s);
    s.vault.failNext('updateFrontmatter', inNovel(OPENING));
    const box = one(rowNamed(pane, 'Opening'), 'spellbook-outliner-compile');
    (box as unknown as { checked: boolean }).checked = false;
    box.fire('change');
    await calm(s);
    expect(checked(box)).toBe(true);
    expect(notices()).toHaveLength(1);
    expect(notices()[0]).toContain('could not be saved');
    expect(s.vault.frontmatterOf(inNovel(OPENING))?.['compile']).toBe(true);
  });

  it('works the change out against the note as it is on disk, so that another device\'s change is not undone', async () => {
    const s = await stage();
    const { pane } = await openOutliner(s);
    // The index has not caught up with what another device wrote.
    s.vault.holdMetadata();
    s.vault.external.editFrontmatter(inNovel(OPENING), (frontmatter) => {
      frontmatter['label'] = DANIEL;
      frontmatter['mood'] = 'tense';
    });
    cellOf(rowNamed(pane, 'Opening'), 'status').fire('click');
    lastMenu().item('First draft').click();
    await calm(s);
    expect(s.vault.frontmatterOf(inNovel(OPENING))).toMatchObject({ status: 'First draft', label: DANIEL, mood: 'tense' });
    // What was saved is shown at once, before the index knows of it.
    expect(textOf(pane, 'Opening', 'status')).toBe('First draft');
    s.vault.releaseMetadata();
    await calm(s);
    expect(one(rowNamed(pane, 'Opening'), 'spellbook-outliner-label-name').text).toBe(DANIEL);
  });
});

describe('while a field is open', () => {
  it('draws nothing again, whatever arrives, and takes it all in when the field closes', async () => {
    const s = await stage();
    const { pane } = await openOutliner(s);
    const cell = cellOf(rowNamed(pane, 'Opening'), 'synopsis');
    cell.fire('click');
    const field = fieldIn(cell);
    field.value = 'Half a sentence';
    const letterRow = rowNamed(pane, 'The Letter');

    // Another device changes a scene, and moves a scene in the binder.
    s.vault.external.editFrontmatter(inNovel(LETTER), (frontmatter) => {
      frontmatter['status'] = 'Done';
    });
    await s.store.moveNode({ kind: 'scene', path: CLOSING }, { at: 'start', parentId: null });
    await calm(s);
    s.timers.advance(TASKS_SETTLE_MS);
    await calm(s);

    // The table is as it was, and the field is untouched.
    expect(namesOf(pane)).toEqual(TREE_NAMES);
    expect(textOf(pane, 'The Letter', 'status')).toBe('First draft');
    expect(fieldIn(cell)).toBe(field);
    expect(field.value).toBe('Half a sentence');
    expect(field.focused).toBe(true);

    field.fire('keydown', { key: 'Escape' });
    await calm(s);
    expect(namesOf(pane)).toEqual(['Manuscript', 'Closing', 'Opening', 'Part one', 'The Letter', INNER_NAME, NIGHT_TITLE, 'Ghost']);
    expect(textOf(pane, 'The Letter', 'status')).toBe('Done');
    // The rows were moved, not built anew.
    expect(rowNamed(pane, 'The Letter')).toBe(letterRow);
  });

  it('takes a tap in the field for the field, and a tap on another cell first closes it', async () => {
    const s = await stage();
    const { pane } = await openOutliner(s);
    const cell = cellOf(rowNamed(pane, 'Opening'), 'synopsis');
    cell.fire('click');
    const field = fieldIn(cell);
    field.fire('click');
    cellOf(rowNamed(pane, 'The Letter'), 'status').fire('click');
    expect(fieldIn(cell)).toBe(field);
    expect(StubMenu.shown).toEqual([]);
    // A browser takes the keyboard from the field before the tap arrives.
    field.fire('blur');
    cellOf(rowNamed(pane, 'The Letter'), 'status').fire('click');
    expect(StubMenu.shown).toHaveLength(1);
    await calm(s);
    expect(s.vault.writes).toEqual([]);
  });
});

describe('sorting', () => {
  const byWords = (): string[] =>
    (
      [
        ['Opening', WORDS.opening],
        ['The Letter', WORDS.letter],
        [NIGHT_TITLE, WORDS.night],
        ['Closing', WORDS.closing],
      ] as Array<[string, number]>
    )
      .sort((a, b) => a[1] - b[1])
      .map(([name]) => name);

  it('sorts by a column when its header is tapped: ascending, descending, off', async () => {
    const s = await stage();
    const { pane } = await openOutliner(s);
    const head = (): FakeElement | null => headerButton(pane, 'Words').parent;
    expect(head()?.getAttr('aria-sort')).toBe('none');
    expect(chipsOf(pane)).toEqual([]);

    headerButton(pane, 'Words').fire('click');
    // A flat list of scenes: no folder rows, no manuscript row. The scene without words comes last.
    expect(namesOf(pane)).toEqual([...byWords(), 'Ghost']);
    expect(rowsOf(pane).every((row) => row.hasClass('spellbook-outliner-scene'))).toBe(true);
    expect(head()?.getAttr('aria-sort')).toBe('ascending');
    expect(chipsOf(pane)).toEqual(['Sorted by Words, ascending (clear)']);
    expect(one(pane, 'spellbook-outliner-table').hasClass('spellbook-is-flat')).toBe(true);
    // In a flat list nothing is set in.
    expect(one(rowNamed(pane, NIGHT_TITLE), 'spellbook-outliner-name').style['paddingInlineStart']).toBe('');
    // The Total row is still there, and still the whole manuscript.
    expect(textOf(pane, 'Total', 'words')).toBe(formatCount(TOTAL_WORDS));

    headerButton(pane, 'Words').fire('click');
    expect(namesOf(pane)).toEqual([...byWords().reverse(), 'Ghost']);
    expect(head()?.getAttr('aria-sort')).toBe('descending');
    expect(chipsOf(pane)).toEqual(['Sorted by Words, descending (clear)']);

    headerButton(pane, 'Words').fire('click');
    expect(namesOf(pane)).toEqual(TREE_NAMES);
    expect(chipsOf(pane)).toEqual([]);
    expect(one(pane, 'spellbook-outliner-table').hasClass('spellbook-is-flat')).toBe(false);
    expect(one(rowNamed(pane, NIGHT_TITLE), 'spellbook-outliner-name').style['paddingInlineStart']).not.toBe('');
  });

  it('is cleared from its chip, and keeps the rows it had', async () => {
    const s = await stage();
    const { pane } = await openOutliner(s);
    const letterRow = rowNamed(pane, 'The Letter');
    const folderRow = rowNamed(pane, 'Part one');
    headerButton(pane, 'Name').fire('click');
    expect(namesOf(pane)).toEqual(['Closing', 'Ghost', 'Opening', 'The Letter', NIGHT_TITLE]);
    expect(rowNamed(pane, 'The Letter')).toBe(letterRow);
    one(pane, 'spellbook-outliner-chip').fire('click');
    expect(namesOf(pane)).toEqual(TREE_NAMES);
    expect(rowNamed(pane, 'The Letter')).toBe(letterRow);
    // The folder's row was off show while the table was sorted: it comes back, not a new one.
    expect(rowNamed(pane, 'Part one')).toBe(folderRow);
  });

  it('keeps the rows that a filter or a fold takes off show, for when they come back', async () => {
    const s = await stage();
    const { pane } = await openOutliner(s);
    const letterRow = rowNamed(pane, 'The Letter');
    const letterPill = one(letterRow, 'spellbook-outliner-status');
    typeFilter(s, pane, 'anna');
    expect(namesOf(pane)).toEqual(['Manuscript', 'Opening']);
    expect(letterRow.parent).toBeNull();
    typeFilter(s, pane, '');
    one(rowNamed(pane, 'Part one'), 'spellbook-outliner-fold').fire('click');
    one(rowNamed(pane, 'Part one'), 'spellbook-outliner-fold').fire('click');
    expect(namesOf(pane)).toEqual(TREE_NAMES);
    expect(rowNamed(pane, 'The Letter')).toBe(letterRow);
    expect(one(letterRow, 'spellbook-outliner-status')).toBe(letterPill);
    // A scene that changed while it was off show is drawn again when it comes back.
    typeFilter(s, pane, 'anna');
    s.vault.external.editFrontmatter(inNovel(LETTER), (frontmatter) => {
      frontmatter['status'] = 'Done';
    });
    await calm(s);
    typeFilter(s, pane, '');
    expect(rowNamed(pane, 'The Letter')).toBe(letterRow);
    expect(textOf(pane, 'The Letter', 'status')).toBe('Done');
    // A scene that leaves the binder takes its row with it.
    await s.store.removeMissingEntry(GHOST);
    await calm(s);
    expect(namesOf(pane)).toEqual(TREE_NAMES.filter((name) => name !== 'Ghost'));
  });

  it('sorts statuses the way the project lists them, with the keyboard too', async () => {
    const s = await stage();
    const { pane } = await openOutliner(s);
    headerButton(pane, 'Status').fire('keydown', { key: 'Enter' });
    // To do, First draft, Done, then the status the list lacks, then none.
    expect(namesOf(pane)).toEqual(['Opening', 'The Letter', NIGHT_TITLE, 'Closing', 'Ghost']);
  });

  it('stays sorted when a scene changes', async () => {
    const s = await stage();
    const { pane } = await openOutliner(s);
    headerButton(pane, 'Status').fire('click');
    cellOf(rowNamed(pane, 'Opening'), 'status').fire('click');
    lastMenu().item('Done').click();
    await calm(s);
    expect(namesOf(pane)).toEqual(['The Letter', 'Opening', NIGHT_TITLE, 'Closing', 'Ghost']);
  });
});

describe('filtering', () => {
  it('shows the scenes whose title or synopsis holds what is typed, a moment after the typing stops', async () => {
    const s = await stage();
    const { pane } = await openOutliner(s);
    const search = one(pane, 'spellbook-outliner-search');
    expect(search.getAttr('dir')).toBe('auto');
    search.value = 'ANNA';
    search.fire('input');
    expect(namesOf(pane)).toEqual(TREE_NAMES);
    s.timers.advance(SEARCH_DELAY_MS);
    expect(namesOf(pane)).toEqual(['Manuscript', 'Opening']);
    expect(chipsOf(pane)).toEqual(['1 of 5 scenes shown (clear)']);
    // The rows of sums add up what is shown; the line above the table is still the whole manuscript.
    expect(textOf(pane, 'Total', 'words')).toBe(formatCount(WORDS.opening));
    expect(one(totalRow(pane), 'spellbook-outliner-count').text).toBe('1 scene');
    expect(one(pane, 'spellbook-outliner-summary').text).toBe(`${describeCount(TOTAL_WORDS)} · 5 scenes`);

    // A Hebrew word from a synopsis; the folders above the scene stay.
    typeFilter(s, pane, 'מכתב');
    expect(namesOf(pane)).toEqual(['Manuscript', 'Part one', INNER_NAME, NIGHT_TITLE]);
    // In a title.
    typeFilter(s, pane, 'letter');
    expect(namesOf(pane)).toEqual(['Manuscript', 'Part one', 'The Letter']);

    typeFilter(s, pane, 'no such words anywhere');
    expect(namesOf(pane)).toEqual(['Manuscript']);
    expect(one(pane, 'spellbook-outliner-message').text).toBe(NO_MATCH_TEXT);
    typeFilter(s, pane, '');
    expect(namesOf(pane)).toEqual(TREE_NAMES);
    expect(chipsOf(pane)).toEqual([]);
    expect(one(pane, 'spellbook-outliner-message').text).toBe('');
  });

  it('shows only the chosen statuses, from a menu in which each can be ticked and unticked', async () => {
    const s = await stage();
    const { pane } = await openOutliner(s);
    const menu = barMenu(pane, 'Status');
    // The project's list, then the status a scene uses that the list lacks.
    expect(menu.outline).toEqual(['To do', 'First draft', 'Done', 'Sent off', '---', 'No status', '---', 'Show all (off)']);
    expect(menu.items.map((item) => item.checked)).toEqual([false, false, false, false, false, null]);
    menu.item('Done').click();
    expect(namesOf(pane)).toEqual(['Manuscript', 'Part one', INNER_NAME, NIGHT_TITLE]);
    expect(pane.withClass('spellbook-outliner-filter').map((button) => button.text)).toEqual(['Status (1)', 'Label']);
    expect(pane.withClass('spellbook-outliner-filter')[0]?.hasClass('spellbook-is-active')).toBe(true);

    const again = barMenu(pane, 'Status');
    expect(again.item('Done').checked).toBe(true);
    again.item('First draft').click();
    expect(namesOf(pane)).toEqual(['Manuscript', 'Part one', 'The Letter', INNER_NAME, NIGHT_TITLE]);
    expect(chipsOf(pane)).toEqual(['2 of 5 scenes shown (clear)']);
    expect(textOf(pane, 'Total', 'words')).toBe(formatCount(WORDS.letter + WORDS.night));

    barMenu(pane, 'Status').item('Done').click();
    expect(namesOf(pane)).toEqual(['Manuscript', 'Part one', 'The Letter']);
    // The scenes that have no status at all.
    barMenu(pane, 'Status').item('First draft').click();
    barMenu(pane, 'Status').item('No status').click();
    expect(namesOf(pane)).toEqual(['Manuscript', 'Ghost']);
    barMenu(pane, 'Status').item('Show all').click();
    expect(namesOf(pane)).toEqual(TREE_NAMES);
    expect(pane.withClass('spellbook-outliner-filter').map((button) => button.text)).toEqual(['Status', 'Label']);
  });

  it('shows only the chosen labels, together with the other parts of the filter', async () => {
    const s = await stage();
    const { pane } = await openOutliner(s);
    expect(barMenu(pane, 'Label').outline).toEqual(['Anna', DANIEL, '---', 'No label', '---', 'Show all (off)']);
    lastMenu().item(DANIEL).click();
    expect(namesOf(pane)).toEqual(['Manuscript', 'Part one', INNER_NAME, NIGHT_TITLE]);
    barMenu(pane, 'Label').item('Anna').click();
    expect(namesOf(pane)).toEqual(['Manuscript', 'Opening', 'Part one', INNER_NAME, NIGHT_TITLE]);
    // Every part that is set must be met.
    barMenu(pane, 'Status').item('To do').click();
    expect(namesOf(pane)).toEqual(['Manuscript', 'Opening']);
    typeFilter(s, pane, 'harbour');
    expect(namesOf(pane)).toEqual(['Manuscript']);
    // The chip clears all of it, and empties the box.
    one(pane, 'spellbook-outliner-chip').fire('click');
    expect(namesOf(pane)).toEqual(TREE_NAMES);
    expect(one(pane, 'spellbook-outliner-search').value).toBe('');
  });

  it('works together with a sort: a flat, sorted list of what passes', async () => {
    const s = await stage();
    const { pane } = await openOutliner(s);
    barMenu(pane, 'Status').item('To do').click();
    barMenu(pane, 'Status').item('Sent off').click();
    headerButton(pane, 'Name').fire('click');
    expect(namesOf(pane)).toEqual(['Closing', 'Opening']);
    expect(chipsOf(pane)).toEqual(['Sorted by Name, ascending (clear)', '2 of 5 scenes shown (clear)']);
  });
});

describe('folded folders', () => {
  it('fold shut and open again from the arrow, from the name and from the menu', async () => {
    const s = await stage();
    const { pane } = await openOutliner(s);
    const arrow = (name: string): FakeElement => one(rowNamed(pane, name), 'spellbook-outliner-fold');
    expect(arrow('Part one').getAttr('aria-expanded')).toBe('true');
    arrow('Part one').fire('click');
    expect(namesOf(pane)).toEqual(['Manuscript', 'Opening', 'Part one', 'Ghost', 'Closing']);
    expect(arrow('Part one').getAttr('aria-expanded')).toBe('false');
    // The sums are the same, shut or open.
    expect(textOf(pane, 'Part one', 'words')).toBe(formatCount(WORDS.letter + WORDS.night));
    expect(textOf(pane, 'Total', 'words')).toBe(formatCount(TOTAL_WORDS));

    one(rowNamed(pane, 'Part one'), 'spellbook-outliner-folder-name').fire('click');
    expect(namesOf(pane)).toEqual(TREE_NAMES);
    const menu = moreMenu(pane, INNER_NAME);
    expect(menu.outline).toEqual(['Collapse', '---', 'Move up', 'Move down']);
    menu.item('Collapse').click();
    expect(namesOf(pane)).toEqual(['Manuscript', 'Opening', 'Part one', 'The Letter', INNER_NAME, 'Ghost', 'Closing']);
    expect(moreMenu(pane, INNER_NAME).outline[0]).toBe('Expand');
  });
});

describe('what the device remembers', () => {
  it('remembers the sort, the filter and the folded folders of a project', async () => {
    const storage = new MemoryDeviceStorage();
    const first = await stage(novelVault(), { storage });
    const shown = await openOutliner(first);
    one(rowNamed(shown.pane, 'Part one'), 'spellbook-outliner-fold').fire('click');
    barMenu(shown.pane, 'Status').item('To do').click();
    barMenu(shown.pane, 'Status').item('Done').click();
    typeFilter(first, shown.pane, 'a');
    headerButton(shown.pane, 'Words').fire('click');
    headerButton(shown.pane, 'Words').fire('click');
    const before = namesOf(shown.pane);
    expect(viewOf(readViewPrefs(storage.load(VIEW_KEY)), NOVEL_INDEX)).toEqual({
      sort: { column: 'words', direction: 'desc' },
      filter: { text: 'a', statuses: ['To do', 'Done'], labels: [] },
      collapsed: ['f-one'],
    });
    first.switchOff();

    // Obsidian is started again, on the same device.
    const second = await stage(novelVault(), { storage });
    const { pane } = await openOutliner(second);
    expect(namesOf(pane)).toEqual(before);
    // (Of the two scenes with those statuses, only the Opening has an "a" in its title or synopsis.)
    expect(before).toEqual(['Opening']);
    expect(chipsOf(pane)).toEqual(['Sorted by Words, descending (clear)', '1 of 5 scenes shown (clear)']);
    expect(one(pane, 'spellbook-outliner-search').value).toBe('a');
    expect(pane.withClass('spellbook-outliner-filter').map((button) => button.text)).toEqual(['Status (2)', 'Label']);
    // With the sort and the filter off (a tap on each chip), the folder is still folded shut.
    pane.withClass('spellbook-outliner-chip')[0]?.fire('click');
    one(pane, 'spellbook-outliner-chip').fire('click');
    expect(namesOf(pane)).toEqual(['Manuscript', 'Opening', 'Part one', 'Ghost', 'Closing']);
    // Left as it usually is, nothing is kept.
    one(rowNamed(pane, 'Part one'), 'spellbook-outliner-fold').fire('click');
    expect(storage.load(VIEW_KEY)).toBeNull();
  });

  it('shows and hides columns from the Columns menu, and remembers the choice', async () => {
    const storage = new MemoryDeviceStorage();
    const first = await stage(novelVault(), { storage });
    const shown = await openOutliner(first);
    const menu = barMenu(shown.pane, 'Columns');
    expect(menu.outline).toEqual([
      'Row number (#)',
      'Name (off)',
      'Status',
      'Label',
      'Target',
      'Words',
      'Synopsis',
      'Tags',
      'Tasks',
      'Read time',
      'Compile',
      'Created',
      'Edited',
      '---',
      'Add property column',
      'Reorder columns',
      'Reset columns (off)',
    ]);
    expect(menu.items.slice(0, 13).map((item) => item.checked)).toEqual([
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      false,
      false,
    ]);
    menu.item('Tags').click();
    await calm(first);
    barMenu(shown.pane, 'Columns').item('Created').click();
    await calm(first);
    expect(headersOf(shown.pane)).toEqual(['#', 'Name', 'Status', 'Label', 'Target', 'Words', 'Synopsis', 'Tasks', 'Read time', 'Compile', 'Created']);
    // Dates read "1 Oct 2026".
    expect(textOf(shown.pane, 'Opening', 'created')).toBe('1 Oct 2026');
    expect(textOf(shown.pane, 'The Letter', 'created')).toBe('');
    // Every row has the new cells, the Total row too.
    expect(rowsOf(shown.pane).every((row) => row.children.length === 11)).toBe(true);
    expect(totalRow(shown.pane).children).toHaveLength(11);
    first.switchOff();

    const second = await stage(novelVault(), { storage });
    const { pane } = await openOutliner(second);
    expect(headersOf(pane)).toEqual(['#', 'Name', 'Status', 'Label', 'Target', 'Words', 'Synopsis', 'Tasks', 'Read time', 'Compile', 'Created']);
    barMenu(pane, 'Columns').item('Reset columns').click();
    await calm(second);
    expect(headersOf(pane)).toEqual(WIDE_HEADERS);
    expect(storage.load(COLUMNS_KEY)).toBeNull();
  });

  it('puts the columns in another order, from the Columns menu or from a header', async () => {
    const storage = new MemoryDeviceStorage();
    const s = await stage(novelVault(), { storage });
    const { pane } = await openOutliner(s);
    barMenu(pane, 'Columns').item('Reorder columns').click();
    expect(lastMenu().outline).toEqual(['Row number (#)', 'Name', 'Status', 'Label', 'Target', 'Words', 'Synopsis', 'Tags', 'Tasks', 'Read time', 'Compile']);
    lastMenu().item('Words').click();
    expect(lastMenu().outline).toEqual(['Move earlier', 'Move later']);
    lastMenu().item('Move earlier').click();
    await calm(s);
    expect(headersOf(pane).slice(3, 7)).toEqual(['Label', 'Words', 'Target', 'Synopsis']);

    // With a mouse: a right-click on the header.
    headerButton(pane, 'Words').parent?.fire('contextmenu', { clientX: 5, clientY: 6 });
    expect(lastMenu().outline).toEqual(['Sort ascending', 'Sort descending', 'Clear sort (off)', '---', 'Move earlier', 'Move later', 'Hide column']);
    lastMenu().item('Move later').click();
    await calm(s);
    expect(headersOf(pane)).toEqual(WIDE_HEADERS);
    headerButton(pane, '#').parent?.fire('contextmenu', { clientX: 5, clientY: 6 });
    expect(lastMenu().item('Move earlier').disabled).toBe(true);
    lastMenu().item('Hide column').click();
    await calm(s);
    expect(headersOf(pane)).toEqual(WIDE_HEADERS.slice(1));
    headerButton(pane, 'Name').parent?.fire('contextmenu', { clientX: 5, clientY: 6 });
    expect(lastMenu().item('Hide column').disabled).toBe(true);
    lastMenu().item('Sort descending').click();
    expect(namesOf(pane)).toEqual([NIGHT_TITLE, 'The Letter', 'Opening', 'Ghost', 'Closing']);
    expect(readColumnPrefs(storage.load(COLUMNS_KEY)).wide[0]).toEqual({ id: 'number', shown: false });
  });

  it('adds a column for another property found in the scenes, read only', async () => {
    const storage = new MemoryDeviceStorage();
    const first = await stage(novelVault(), { storage });
    const shown = await openOutliner(first);
    barMenu(shown.pane, 'Columns').item('Add property column').click();
    // Not the properties the outliner has columns for, nor the plugin's own "order".
    expect(lastMenu().outline).toEqual(['pov']);
    lastMenu().item('pov').click();
    await calm(first);
    expect(headersOf(shown.pane)).toEqual([...WIDE_HEADERS, 'pov']);
    // The header and the values are the writer's own text.
    expect(shown.pane.withClass('spellbook-outliner-head-title').slice(-1)[0]?.getAttr('dir')).toBe('auto');
    expect(textOf(shown.pane, 'Opening', 'property')).toBe('Anna');
    expect(textOf(shown.pane, 'The Letter', 'property')).toBe('Daniel');
    expect(textOf(shown.pane, 'Closing', 'property')).toBe('');
    expect(textOf(shown.pane, 'Total', 'property')).toBe('');
    expect(one(cellOf(rowNamed(shown.pane, 'Opening'), 'property'), 'spellbook-outliner-text').getAttr('dir')).toBe('auto');
    // Read only: a tap does nothing.
    cellOf(rowNamed(shown.pane, 'Opening'), 'property').fire('click');
    expect(shown.pane.withClass('spellbook-outliner-input')).toEqual([]);
    // Nothing is left to add; the column can be sorted by, and unticked again.
    const menu = barMenu(shown.pane, 'Columns');
    expect(menu.outline).toContain('Add property column (off)');
    expect(menu.item('pov').checked).toBe(true);
    headerButton(shown.pane, 'pov').fire('click');
    expect(namesOf(shown.pane)).toEqual(['Opening', 'The Letter', NIGHT_TITLE, 'Ghost', 'Closing']);
    expect(chipsOf(shown.pane)).toEqual(['Sorted by pov, ascending (clear)']);
    first.switchOff();

    const second = await stage(novelVault(), { storage });
    const { pane } = await openOutliner(second);
    expect(headersOf(pane)).toEqual([...WIDE_HEADERS, 'pov']);
    barMenu(pane, 'Columns').item('pov').click();
    await calm(second);
    expect(headersOf(pane)).toEqual(WIDE_HEADERS);
    expect(barMenu(pane, 'Columns').outline).toContain('Add property column');
  });

  it('copes with a device whose storage does not work, and with what it cannot read', async () => {
    const storage = new MemoryDeviceStorage();
    storage.save(COLUMNS_KEY, '{"wide": "everything"');
    storage.save(VIEW_KEY, 'not json at all');
    const s = await stage(novelVault(), { storage });
    const { pane } = await openOutliner(s);
    expect(headersOf(pane)).toEqual(WIDE_HEADERS);
    expect(namesOf(pane)).toEqual(TREE_NAMES);
    storage.broken = true;
    headerButton(pane, 'Words').fire('click');
    barMenu(pane, 'Columns').item('Tags').click();
    await calm(s);
    // The choice then lasts until Obsidian closes.
    expect(headersOf(pane)).not.toContain('Tags');
    expect(chipsOf(pane)).toEqual(['Sorted by Words, ascending (clear)']);
  });
});

describe('a narrow pane', () => {
  it('shows only Name, Status, Target and Words, going by the measured width', async () => {
    const s = await stage();
    const { pane, view } = await openOutliner(s);
    const root = one(pane, 'spellbook-outliner');
    expect(root.hasClass('spellbook-is-narrow')).toBe(false);
    pane.clientWidth = 380;
    view.onResize();
    expect(root.hasClass('spellbook-is-narrow')).toBe(true);
    expect(headersOf(pane)).toEqual(['Name', 'Status', 'Target', 'Words']);
    expect(namesOf(pane)).toEqual(TREE_NAMES);
    expect(rowsOf(pane).every((row) => row.children.length === 4)).toBe(true);
    // A little wider is not wide yet; wide is wide.
    pane.clientWidth = 540;
    view.onResize();
    expect(headersOf(pane)).toEqual(['Name', 'Status', 'Target', 'Words']);
    pane.clientWidth = 900;
    view.onResize();
    expect(root.hasClass('spellbook-is-narrow')).toBe(false);
    expect(headersOf(pane)).toEqual(WIDE_HEADERS);
    // A pane that is hidden has no width: it keeps what it had.
    pane.clientWidth = 0;
    view.onResize();
    expect(headersOf(pane)).toEqual(WIDE_HEADERS);
  });

  it('keeps its own choice of columns, apart from the wide one', async () => {
    const storage = new MemoryDeviceStorage();
    const s = await stage(novelVault(), { storage });
    const { pane, view } = await openOutliner(s);
    pane.clientWidth = 380;
    view.onResize();
    const menu = barMenu(pane, 'Columns');
    expect(menu.item('Synopsis').checked).toBe(false);
    expect(menu.item('Words').checked).toBe(true);
    menu.item('Synopsis').click();
    await calm(s);
    expect(headersOf(pane)).toEqual(['Name', 'Status', 'Target', 'Words', 'Synopsis']);
    pane.clientWidth = 900;
    view.onResize();
    expect(headersOf(pane)).toEqual(WIDE_HEADERS);
    pane.clientWidth = 380;
    view.onResize();
    expect(headersOf(pane)).toEqual(['Name', 'Status', 'Target', 'Words', 'Synopsis']);
  });

  it('is what a phone starts with, before the pane is measured', async () => {
    Object.assign(Platform, { isDesktop: false, isMobile: true, isPhone: true });
    const s = await stage();
    const { pane } = await openOutliner(s);
    const root = one(pane, 'spellbook-outliner');
    expect(root.hasClass('spellbook-is-phone')).toBe(true);
    expect(root.hasClass('spellbook-is-mobile')).toBe(true);
    expect(root.hasClass('spellbook-is-narrow')).toBe(true);
    expect(headersOf(pane)).toEqual(['Name', 'Status', 'Target', 'Words']);
    // The drawers lie over the main area on a phone: they were slid away.
    expect(s.workspace.leftSplit.collapses).toBe(1);
    expect(s.workspace.rightSplit.collapses).toBe(1);
  });
});

describe('the to-do lines', () => {
  it('are read from the scenes only while the Tasks column is on show', async () => {
    const storage = new MemoryDeviceStorage();
    storage.save(COLUMNS_KEY, writeColumnPrefs({ wide: setColumnShown(defaultLayout('wide'), 'tasks', false), narrow: defaultLayout('narrow') }));
    const s = await stage(novelVault(), { storage });
    const { pane } = await openOutliner(s);
    expect(headersOf(pane)).not.toContain('Tasks');
    // Each note was read once, for its words: the four scenes and the note that is not in the binder.
    expect(s.vault.reads.readText).toBe(5);

    barMenu(pane, 'Columns').item('Tasks').click();
    await calm(s);
    expect(s.vault.reads.readText).toBe(9);
    expect(textOf(pane, 'Opening', 'tasks')).toBe('1/2');
    expect(textOf(pane, 'Total', 'tasks')).toBe('2/3');

    // Hidden again: a scene that is saved is read once (for its words), not twice.
    barMenu(pane, 'Columns').item('Tasks').click();
    await calm(s);
    s.vault.external.write(inNovel(OPENING), { body: `${OPENING_BODY}- [ ] one more\n` });
    s.timers.advance(TASKS_SETTLE_MS);
    await calm(s);
    expect(s.vault.reads.readText).toBe(10);
  });

  it('follow a scene whose text changes, a moment after it was saved', async () => {
    const s = await stage();
    const { pane } = await openOutliner(s);
    expect(s.vault.reads.readText).toBe(9);
    s.vault.external.write(inNovel(OPENING), { body: `${OPENING_BODY}- [x] one more\n- [ ] and another\n` });
    await calm(s);
    expect(textOf(pane, 'Opening', 'tasks')).toBe('1/2');
    s.timers.advance(TASKS_SETTLE_MS);
    await calm(s);
    expect(textOf(pane, 'Opening', 'tasks')).toBe('2/4');
    expect(textOf(pane, 'Total', 'tasks')).toBe('3/5');
    // Read once more for its words and once more for its to-do lines.
    expect(s.vault.reads.readText).toBe(11);
  });

  it('are read a slice of scenes at a time, with a pause in between', async () => {
    const vault = new MemoryVault();
    const names = Array.from({ length: 45 }, (_, n) => `Scene ${n + 1}`);
    vault.seed('Big/Big.md', {
      frontmatter: { spellbook: 'project', version: 1, title: 'Big', binder: names.map((name) => `Manuscript/${name}.md`) },
      body: INDEX_BODY,
    });
    for (const name of names) vault.seed(`Big/Manuscript/${name}.md`, { frontmatter: { status: 'To do' }, body: `Text of ${name}.\n- [ ] check\n` });
    const s = await stage(vault, { open: 'Big/Big.md' });
    s.command('open-outliner').callback?.();
    // No timer is let through: everything that pauses stays paused.
    for (let turn = 0; turn < 6; turn++) await tick();
    expect(TASKS_SLICE).toBe(20);
    // At most one slice for the to-do lines, and the word counter's own first slice of 40.
    expect(s.vault.reads.readText).toBe(TASKS_SLICE + 40);
    await calm(s);
    expect(s.vault.reads.readText).toBe(90);
    const leaf = s.workspace.getLeavesOfType(OUTLINER_VIEW_TYPE)[0];
    const pane = (leaf?.view as unknown as { contentEl: FakeElement }).contentEl;
    expect(rowsOf(pane)).toHaveLength(46);
    expect(textOf(pane, 'Total', 'tasks')).toBe('0/45');
    expect(textOf(pane, 'Scene 45', 'tasks')).toBe('0/1');
  });
});

describe('putting rows in another order', () => {
  it('moves a row from its "more" menu; the store does the move, and the rows are moved, not built anew', async () => {
    const s = await stage();
    const { pane } = await openOutliner(s);
    expect(one(pane, 'spellbook-outliner').hasClass('spellbook-is-reorderable')).toBe(true);
    const letterRow = rowNamed(pane, 'The Letter');
    const menu = moreMenu(pane, 'Opening');
    expect(menu.outline).toEqual(['Open', 'Open in new tab', '---', 'Move up (off)', 'Move down']);
    menu.item('Move down').click();
    await calm(s);
    expect(picture(s.store)).toBe(`Part one[The Letter ${INNER_NAME}[${NIGHT_TITLE}]] Opening Ghost? Closing`);
    expect(binderOnDisk(s.vault, NOVEL_INDEX)).toEqual([
      { folder: 'Part one', id: 'f-one', children: [LETTER, { folder: INNER_NAME, id: 'f-inner', children: [NIGHT] }] },
      OPENING,
      GHOST,
      CLOSING,
    ]);
    expect(namesOf(pane)).toEqual(['Manuscript', 'Part one', 'The Letter', INNER_NAME, NIGHT_TITLE, 'Opening', 'Ghost', 'Closing']);
    expect(rowNamed(pane, 'The Letter')).toBe(letterRow);
    // The numbers follow the new order.
    expect(textOf(pane, 'The Letter', 'number')).toBe('1');
    expect(textOf(pane, 'Opening', 'number')).toBe('3');
  });

  it('steps a row out of its folder at the folder\'s edge, and moves folders too', async () => {
    const s = await stage();
    const { pane } = await openOutliner(s);
    moreMenu(pane, 'The Letter').item('Move up').click();
    await calm(s);
    expect(picture(s.store)).toBe(`Opening The Letter Part one[${INNER_NAME}[${NIGHT_TITLE}]] Ghost? Closing`);
    moreMenu(pane, 'Part one').item('Move down').click();
    await calm(s);
    expect(picture(s.store)).toBe(`Opening The Letter Ghost? Part one[${INNER_NAME}[${NIGHT_TITLE}]] Closing`);
    expect(namesOf(pane)).toEqual(['Manuscript', 'Opening', 'The Letter', 'Ghost', 'Part one', INNER_NAME, NIGHT_TITLE, 'Closing']);
    // An entry whose note is missing can be moved from its menu as well.
    moreMenu(pane, 'Ghost').item('Move down').click();
    await calm(s);
    expect(picture(s.store)).toBe(`Opening The Letter Part one[${INNER_NAME}[${NIGHT_TITLE}]] Ghost? Closing`);
  });

  it('only in manuscript order: not while the table is sorted or filtered', async () => {
    const s = await stage();
    const { pane } = await openOutliner(s);
    headerButton(pane, 'Words').fire('click');
    expect(one(pane, 'spellbook-outliner').hasClass('spellbook-is-reorderable')).toBe(false);
    expect(moreMenu(pane, 'Opening').outline).toEqual(['Open', 'Open in new tab', '---', 'Move up (off)', 'Move down (off)']);
    one(pane, 'spellbook-outliner-chip').fire('click');
    typeFilter(s, pane, 'e');
    expect(one(pane, 'spellbook-outliner').hasClass('spellbook-is-reorderable')).toBe(false);
    expect(moreMenu(pane, 'Opening').outline.slice(3)).toEqual(['Move up (off)', 'Move down (off)']);
    typeFilter(s, pane, '');
    expect(one(pane, 'spellbook-outliner').hasClass('spellbook-is-reorderable')).toBe(true);
    expect(moreMenu(pane, 'Opening').outline.slice(3)).toEqual(['Move up (off)', 'Move down']);
    expect(s.vault.writes).toEqual([]);
  });

  /** Give the table a place on the stand-in screen: rows of 30 pixels under a header of 40. */
  function layOut(pane: FakeElement): void {
    one(pane, 'spellbook-outliner-scroll').rect = { top: 0, bottom: 400, left: 0, right: 800, width: 800, height: 400 };
    rowsOf(pane).forEach((row, position) => {
      const top = 40 + position * 30;
      row.rect = { top, bottom: top + 30, left: 0, right: 800, width: 800, height: 30 };
    });
  }

  /** Press on a row's name, drag to a height, and let go there. */
  function dragTo(pane: FakeElement, name: string, y: number): void {
    const row = rowNamed(pane, name);
    const from = row.rect.top + 15;
    const grip = row.withClass('spellbook-outliner-title')[0] ?? one(row, 'spellbook-outliner-folder-name');
    grip.fire('pointerdown', { isPrimary: true, button: 0, pointerId: 1, pointerType: 'mouse', clientX: 50, clientY: from });
    fakeDocument.dispatch('pointermove', { pointerId: 1, buttons: 1, clientX: 50, clientY: from + 10 });
    fakeDocument.dispatch('pointermove', { pointerId: 1, buttons: 1, clientX: 50, clientY: y });
    fakeDocument.dispatch('pointerup', { pointerId: 1, clientX: 50, clientY: y });
  }

  it('moves a row that is dragged to another place: the store does the move', async () => {
    const s = await stage();
    const { pane } = await openOutliner(s);
    layOut(pane);
    // Rows on the screen: Manuscript 40, Opening 70, Part one 100, The Letter 130, (inner) 160, (night) 190, Ghost 220, Closing 250.
    dragTo(pane, 'Closing', 75);
    await calm(s);
    expect(picture(s.store)).toBe(`Closing Opening Part one[The Letter ${INNER_NAME}[${NIGHT_TITLE}]] Ghost?`);
    expect(namesOf(pane)).toEqual(['Manuscript', 'Closing', 'Opening', 'Part one', 'The Letter', INNER_NAME, NIGHT_TITLE, 'Ghost']);
    // Nothing of the drag is left on the screen.
    expect(fakeDocument.body.children).toEqual([]);
    expect(pane.withClass(DRAGGING_CLASS)).toEqual([]);
  });

  it('drops a row into a folder when it is let go on the middle of the folder\'s row', async () => {
    const s = await stage();
    const { pane } = await openOutliner(s);
    layOut(pane);
    dragTo(pane, 'Closing', 115);
    await calm(s);
    expect(picture(s.store)).toBe(`Opening Part one[The Letter ${INNER_NAME}[${NIGHT_TITLE}] Closing] Ghost?`);
    // A folder is dragged with everything in it.
    layOut(pane);
    dragTo(pane, INNER_NAME, 45);
    await calm(s);
    expect(picture(s.store)).toBe(`${INNER_NAME}[${NIGHT_TITLE}] Opening Part one[The Letter Closing] Ghost?`);
  });

  it('shows where a drop would go while a row is dragged, and dims the row', async () => {
    const s = await stage();
    const { pane } = await openOutliner(s);
    layOut(pane);
    const row = rowNamed(pane, 'Closing');
    one(row, 'spellbook-outliner-title').fire('pointerdown', { isPrimary: true, button: 0, pointerId: 1, pointerType: 'mouse', clientX: 50, clientY: 265 });
    fakeDocument.dispatch('pointermove', { pointerId: 1, buttons: 1, clientX: 50, clientY: 255 });
    expect(row.hasClass(DRAGGING_CLASS)).toBe(true);
    // The ghost says what is dragged, in the title's own direction.
    const ghost = one(fakeDocument.body, 'spellbook-drag-ghost-title');
    expect(ghost.text).toBe('Closing');
    expect(ghost.getAttr('dir')).toBe('auto');
    // Over the upper half of the Opening: a line above it, across the table.
    fakeDocument.dispatch('pointermove', { pointerId: 1, buttons: 1, clientX: 50, clientY: 75 });
    const line = one(fakeDocument.body, 'spellbook-drop-line');
    expect(line.style['transform']).toBe('translate(0px, 70px)');
    expect(line.style['width']).toBe('800px');
    // Over the middle of a folder: the folder is marked.
    fakeDocument.dispatch('pointermove', { pointerId: 1, buttons: 1, clientX: 50, clientY: 115 });
    expect(rowNamed(pane, 'Part one').hasClass('spellbook-is-drop-target')).toBe(true);
    expect(line.style['display']).toBe('none');
    // Escape drops nothing.
    fakeDocument.dispatch('keydown', { key: 'Escape', preventDefault: () => undefined, stopPropagation: () => undefined });
    fakeDocument.dispatch('pointerup', { pointerId: 1, clientX: 50, clientY: 115 });
    await calm(s);
    expect(row.hasClass(DRAGGING_CLASS)).toBe(false);
    expect(rowNamed(pane, 'Part one').hasClass('spellbook-is-drop-target')).toBe(false);
    expect(s.vault.writes).toEqual([]);
    expect(namesOf(pane)).toEqual(TREE_NAMES);
  });

  it('picks nothing up from a button, a tick box, a missing entry, or while the table is sorted', async () => {
    const s = await stage();
    const { pane } = await openOutliner(s);
    layOut(pane);
    const press = (target: FakeElement): void => {
      target.fire('pointerdown', { isPrimary: true, button: 0, pointerId: 1, pointerType: 'mouse', clientX: 50, clientY: 265 });
      fakeDocument.dispatch('pointermove', { pointerId: 1, buttons: 1, clientX: 50, clientY: 200 });
      fakeDocument.dispatch('pointermove', { pointerId: 1, buttons: 1, clientX: 50, clientY: 75 });
      fakeDocument.dispatch('pointerup', { pointerId: 1, clientX: 50, clientY: 75 });
    };
    press(one(rowNamed(pane, 'Closing'), 'spellbook-outliner-more'));
    press(one(rowNamed(pane, 'Closing'), 'spellbook-outliner-compile'));
    press(one(rowNamed(pane, 'Ghost'), 'spellbook-outliner-title'));
    press(one(rowNamed(pane, 'Manuscript'), 'spellbook-outliner-folder-name'));
    headerButton(pane, 'Words').fire('click');
    layOut(pane);
    press(one(rowNamed(pane, 'Closing'), 'spellbook-outliner-title'));
    await calm(s);
    expect(s.vault.writes).toEqual([]);
    expect(fakeDocument.body.children).toEqual([]);
  });
});

describe('following the project', () => {
  it('draws one row again when another device changes a scene', async () => {
    const s = await stage();
    const { pane } = await openOutliner(s);
    const openingPill = one(rowNamed(pane, 'Opening'), 'spellbook-outliner-status');
    s.vault.external.editFrontmatter(inNovel(LETTER), (frontmatter) => {
      frontmatter['status'] = 'Done';
      frontmatter['synopsis'] = 'A letter from the harbour.';
    });
    await calm(s);
    expect(textOf(pane, 'The Letter', 'status')).toBe('Done');
    expect(textOf(pane, 'The Letter', 'synopsis')).toBe('A letter from the harbour.');
    expect(one(rowNamed(pane, 'Opening'), 'spellbook-outliner-status')).toBe(openingPill);
    expect(s.vault.writes).toEqual([]);
  });

  it('follows the binder: a scene that is added, a folder that is renamed, a note that arrives', async () => {
    const s = await stage();
    const { pane } = await openOutliner(s);
    await s.store.addScene('Epilogue', { at: 'end', parentId: null });
    await s.store.renameFolder('f-one', 'Part 1');
    s.vault.external.create(inNovel(GHOST), { frontmatter: { status: 'To do' }, body: 'Here at last.\n' });
    await calm(s);
    expect(namesOf(pane)).toEqual(['Manuscript', 'Opening', 'Part 1', 'The Letter', INNER_NAME, NIGHT_TITLE, 'Ghost', 'Closing', 'Epilogue']);
    expect(rowNamed(pane, 'Ghost').hasClass('spellbook-is-missing')).toBe(false);
    expect(textOf(pane, 'Ghost', 'status')).toBe('To do');
    expect(textOf(pane, 'Ghost', 'words')).toBe('3');
    expect(one(totalRow(pane), 'spellbook-outliner-count').text).toBe('6 scenes');
  });

  it('follows the project\'s lists: a status that gets another colour', async () => {
    const s = await stage();
    const { pane } = await openOutliner(s);
    await s.store.updateProjectData('statuses', () => [
      { name: 'To do', color: 'blue' },
      { name: 'First draft', color: 'orange' },
      { name: 'Done', color: 'green' },
    ]);
    await calm(s);
    const pill = one(rowNamed(pane, 'Opening'), 'spellbook-outliner-status');
    expect(pill.hasClass('spellbook-outliner-color-blue')).toBe(true);
    expect(pill.hasClass('spellbook-outliner-color-red')).toBe(false);
  });

  it('switches to another project: its scenes, its statuses, and its own sort and filter', async () => {
    const storage = new MemoryDeviceStorage();
    const s = await stage(novelVault(), { storage });
    const { pane } = await openOutliner(s);
    headerButton(pane, 'Words').fire('click');
    typeFilter(s, pane, 'e');
    expect(chipsOf(pane)).toHaveLength(2);

    await s.store.openProject(SECOND_INDEX);
    await calm(s);
    expect(one(pane, 'spellbook-outliner-heading').text).toBe('Second Book');
    expect(namesOf(pane)).toEqual(['Manuscript', 'Prologue', 'Opening']);
    expect(one(pane, 'spellbook-outliner-summary').text).toBe('5 words · 2 scenes');
    // The other project is in manuscript order, unfiltered: the sort and the filter belong to the novel.
    expect(chipsOf(pane)).toEqual([]);
    expect(one(pane, 'spellbook-outliner-search').value).toBe('');
    const idea = one(rowNamed(pane, 'Prologue'), 'spellbook-outliner-status');
    expect(idea.text).toBe('Idea');
    expect(idea.hasClass('spellbook-outliner-color-blue')).toBe(true);
    cellOf(rowNamed(pane, 'Opening'), 'status').fire('click');
    expect(lastMenu().outline).toEqual(['Idea', '---', 'No status']);
    lastMenu().item('Idea').click();
    await calm(s);
    expect(s.vault.frontmatterOf('Second/Manuscript/Opening.md')).toEqual({ synopsis: 'Another opening altogether.', status: 'Idea' });
    // The novel's own scene of the same name was not touched.
    expect(s.vault.writesTo(inNovel(OPENING))).toEqual([]);

    await s.store.openProject(NOVEL_INDEX);
    await calm(s);
    expect(one(pane, 'spellbook-outliner-heading').text).toBe('My Novel');
    expect(chipsOf(pane)).toHaveLength(2);
    expect(one(pane, 'spellbook-outliner-search').value).toBe('e');

    await s.store.closeProject();
    await calm(s);
    expect(rowsOf(pane)).toEqual([]);
    expect(one(pane, 'spellbook-outliner-message').text).toBe(NO_PROJECT_TEXT);
  });

  it('says so when the manuscript is empty', async () => {
    const vault = new MemoryVault();
    vault.seed('Empty/Empty.md', { frontmatter: { spellbook: 'project', version: 1, title: 'Empty', binder: [] }, body: INDEX_BODY });
    const s = await stage(vault, { open: 'Empty/Empty.md' });
    const { pane } = await openOutliner(s);
    expect(namesOf(pane)).toEqual(['Manuscript']);
    expect(one(pane, 'spellbook-outliner-message').text).toBe(EMPTY_TEXT);
    expect(one(pane, 'spellbook-outliner-summary').text).toBe('0 words · 0 scenes');
  });

  it('keeps two panes of the outliner in step', async () => {
    const s = await stage();
    const first = await openOutliner(s);
    // Obsidian can put a second pane of the same kind back from a saved layout.
    const leaf = s.workspace.addLeaf(s.workspace.rootSplit);
    await leaf.setViewState({ type: OUTLINER_VIEW_TYPE });
    await calm(s);
    const second = (leaf.view as unknown as { contentEl: FakeElement }).contentEl;
    expect(namesOf(second)).toEqual(TREE_NAMES);
    barMenu(first.pane, 'Columns').item('Tags').click();
    cellOf(rowNamed(first.pane, 'Opening'), 'status').fire('click');
    lastMenu().item('Done').click();
    await calm(s);
    expect(headersOf(second)).not.toContain('Tags');
    expect(textOf(second, 'Opening', 'status')).toBe('Done');
    // Notes are still read once each for their to-do lines, however many panes show them.
    expect(s.vault.reads.readText).toBe(9);
  });
});

describe('letting go', () => {
  it('stops reading the scenes when the pane is closed', async () => {
    const s = await stage();
    const { leaf, pane } = await openOutliner(s);
    leaf.detach();
    await calm(s);
    expect(pane.children).toEqual([]);
    expect(pane.hasClass('spellbook-outliner-pane')).toBe(false);
    const reads = s.vault.reads.readText;
    s.vault.external.write(inNovel(CLOSING), { body: `${CLOSING_BODY}- [ ] after the pane was closed\n` });
    s.vault.external.editFrontmatter(inNovel(LETTER), (frontmatter) => {
      frontmatter['status'] = 'Done';
    });
    s.timers.advance(10_000);
    await calm(s);
    // The shared word counter still follows the two notes that were saved (one read each);
    // the outliner reads nothing. (With the pane open, each would have been read twice.)
    expect(s.vault.reads.readText).toBe(reads + 2);
    // The pane comes back as it should.
    const again = await openOutliner(s);
    expect(namesOf(again.pane)).toEqual(TREE_NAMES);
    expect(textOf(again.pane, 'The Letter', 'status')).toBe('Done');
    expect(textOf(again.pane, 'Closing', 'tasks')).toBe('0/1');
  });

  it('lets go of everything when the plugin is switched off', async () => {
    const s = await stage();
    const { leaf, pane } = await openOutliner(s);
    // In the middle of things: a field is open, and a row is being dragged in a second pane's absence.
    cellOf(rowNamed(pane, 'Opening'), 'synopsis').fire('click');
    fieldIn(cellOf(rowNamed(pane, 'Opening'), 'synopsis')).value = 'Never saved';
    typeFilter(s, pane, '');
    one(pane, 'spellbook-outliner-search').value = 'half typed';
    one(pane, 'spellbook-outliner-search').fire('input');

    s.switchOff();
    await tick();
    // The pane keeps its place for when the plugin comes back, emptied.
    expect(leaf.detached).toBe(false);
    expect(leaf.view).toBeNull();
    expect(pane.children).toEqual([]);
    expect(pane.hasClass('spellbook-outliner-pane')).toBe(false);
    expect(s.plugin.viewTypes).toEqual([]);
    expect(s.plugin.ribbonIcons.every((icon) => !icon.shown)).toBe(true);
    expect(fakeDocument.listenerCount()).toBe(0);
    expect(fakeWindow.listenerCount()).toBe(0);
    expect(fakeDocument.body.children).toEqual([]);

    // Nothing is followed, read, written or opened any more, and nothing is waiting to happen.
    const reads = s.vault.reads.readText;
    s.vault.clearWrites();
    s.vault.external.write(inNovel(CLOSING), { body: 'After the plugin was switched off.\n' });
    s.vault.external.editFrontmatter(inNovel(LETTER), (frontmatter) => {
      frontmatter['status'] = 'Done';
    });
    s.timers.advance(10_000);
    s.command('open-outliner').callback?.();
    s.plugin.ribbonIcons[0]?.callback({});
    await tick();
    s.timers.advance(10_000);
    await tick();
    expect(s.vault.reads.readText).toBe(reads);
    expect(s.vault.writes).toEqual([]);
    expect(leaf.view).toBeNull();
    expect(s.workspace.getLeavesOfType(OUTLINER_VIEW_TYPE)).toEqual([leaf]);
    expect(notices()).toEqual([]);
  });

  it('lets go of a drag that is on when the pane is closed', async () => {
    const s = await stage();
    const { leaf, pane } = await openOutliner(s);
    one(pane, 'spellbook-outliner-scroll').rect = { top: 0, bottom: 400, left: 0, right: 800, width: 800, height: 400 };
    one(rowNamed(pane, 'Closing'), 'spellbook-outliner-title').fire('pointerdown', {
      isPrimary: true,
      button: 0,
      pointerId: 1,
      pointerType: 'mouse',
      clientX: 50,
      clientY: 265,
    });
    fakeDocument.dispatch('pointermove', { pointerId: 1, buttons: 1, clientX: 50, clientY: 200 });
    expect(fakeDocument.body.children.length).toBeGreaterThan(0);
    leaf.detach();
    await calm(s);
    expect(fakeDocument.body.children).toEqual([]);
    expect(fakeDocument.listenerCount()).toBe(0);
    expect(fakeWindow.listenerCount()).toBe(0);
    expect(s.vault.writes).toEqual([]);
  });
});

// The texts this file leans on are what the stage says they are.
describe('the stage', () => {
  it('counts the words of the scenes the way the plugin does', () => {
    expect(WORDS).toEqual({
      opening: countWords(OPENING_BODY),
      letter: countWords(LETTER_BODY),
      night: countWords('שלום לך אחותי היקרה.\n\n- [x] לבדוק את הרכבות\n'),
      closing: countWords(CLOSING_BODY),
    });
    expect(WORDS.letter).toBe(10);
    expect(WORDS.closing).toBe(4);
    expect(new Set(Object.values(WORDS)).size).toBe(4);
    expect(inNovel(LOOSE)).toBe('Novel/Manuscript/Loose.md');
  });
});
