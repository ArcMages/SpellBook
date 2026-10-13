// The writing report as it is plugged into the plugin: the real feature on a
// project store that sits on the tests' memory vault. What the pane shows is
// read from the stand-in screen; the figures are checked against hand counts
// (written out in stage.ts and engine.test.ts).

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NARROW_BELOW, WIDE_FROM } from '../../../src/core/report';
import { READ_BATCH } from '../../../src/features/report/host';
import { REPORT_RIBBON_TITLE } from '../../../src/features/report/index';
import {
  COMMON_SWITCH_TEXT,
  GRADE_ENGLISH_NOTE,
  GRADE_HEBREW_LABEL,
  NO_FOLDER_TEXT,
  NO_PROJECT_TEXT,
  NO_SCENES_TEXT,
  NO_SCENE_TEXT,
  OTHER_SCENE_TEXT,
  REPORT_VIEW_TYPE,
  SCOPE_MANUSCRIPT_TEXT,
  SCOPE_SCENE_TEXT,
  STALE_TEXT,
  WORDS_STEP,
} from '../../../src/features/report/reportView';
import { ReportPrefs, WORDS_PER_PAGE_KEY, WORDS_PER_PAGE_NAME, reportSettings } from '../../../src/features/report/settings';
import { MemoryVault } from '../../memoryVault';
import { Menu as StubMenu, Notice as StubNotice, Platform, FakeElement, resetFakeDocument, resetPlatform } from '../../obsidianStub';
import { INDEX_BODY, MemoryDeviceStorage } from '../../storeHarness';
import {
  CLOSING,
  INNER_NAME,
  LETTER,
  NIGHT,
  NIGHT_TITLE,
  NOVEL_INDEX,
  OPENING,
  breathe,
  calm,
  choose,
  counts,
  figure,
  inNovel,
  longVault,
  messageOf,
  noteOf,
  novelVault,
  one,
  openReport,
  paneOf,
  pressRefresh,
  scopeMenu,
  statusOf,
  wire,
  wordsOf,
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
});

afterEach(() => {
  for (const wired of stages.splice(0)) wired.switchOff();
  resetPlatform();
});

// The hand counts of the four scenes (see stage.ts).
const OPENING_COUNTS = { words: '28', characters: '152', charactersNoSpaces: '128', sentences: '5', paragraphs: '3' };
const NIGHT_COUNTS = { words: '18', characters: '86', charactersNoSpaces: '71', sentences: '4', paragraphs: '2' };
// The Letter (10, 48, 39, 1, 1) and the Hebrew scene together.
const PART_ONE_COUNTS = { words: '28', characters: '134', charactersNoSpaces: '110', sentences: '5', paragraphs: '3' };
// All four: 28 + 10 + 18 + 4 words, and so on.
const MANUSCRIPT_COUNTS = { words: '60', characters: '307', charactersNoSpaces: '256', sentences: '11', paragraphs: '7' };

const setChecked = (box: FakeElement, checked: boolean): void => {
  (box as unknown as { checked: boolean }).checked = checked;
  box.fire('change');
};
const isChecked = (box: FakeElement): unknown => (box as unknown as { checked?: unknown }).checked;

describe('plugging in', () => {
  it('adds a command and a ribbon button, and does nothing until the pane is opened', async () => {
    const s = await stage();
    expect(s.plugin.viewTypes).toEqual([REPORT_VIEW_TYPE]);
    expect(s.plugin.commands.map((command) => [command.id, command.name])).toEqual([['open-writing-report', 'Open writing report']]);
    expect(s.plugin.ribbonIcons.map((icon) => [icon.icon, icon.title])).toEqual([['chart-column', REPORT_RIBBON_TITLE]]);
    expect(s.features.settingsSections).toEqual([]);
    await calm(s);
    // No note was read, nothing was saved on the device, and nothing is followed.
    expect(s.vault.reads.readText).toBe(0);
    expect(s.storage.saves).toEqual([]);
    expect(s.workspace.listenerCount('file-open')).toBe(0);
    expect(s.workspace.leaves).toEqual([]);
  });

  it('opens one pane, from the command and from the ribbon, and brings it to the front the second time', async () => {
    const s = await stage();
    const { leaf, view } = await openReport(s);
    s.plugin.ribbonIcons[0]?.callback({});
    s.command('open-writing-report').callback?.();
    await calm(s);
    expect(s.workspace.getLeavesOfType(REPORT_VIEW_TYPE)).toEqual([leaf]);
    expect(s.workspace.revealed.length).toBeGreaterThanOrEqual(2);
    expect(view.getDisplayText()).toBe('Writing report');
    expect(view.getIcon()).toBe('chart-column');
  });

  it('lets go of everything when the pane closes, and when the plugin is switched off', async () => {
    const s = await stage(novelVault(), { front: inNovel(OPENING) });
    const { leaf, pane } = await openReport(s);
    expect(s.workspace.listenerCount('file-open')).toBe(1);
    leaf.detach();
    await calm(s);
    expect(s.workspace.listenerCount('file-open')).toBe(0);
    expect(pane.children).toEqual([]);
    expect(pane.hasClass('spellbook-report-pane')).toBe(false);

    // Open again; then the plugin is switched off under the open pane.
    const again = await openReport(s);
    expect(figure(again.pane, 'words')).toBe('28');
    const reads = s.vault.reads.readText;
    s.switchOff();
    await calm(s);
    expect(s.workspace.listenerCount('file-open')).toBe(0);
    expect(s.vault.reads.readText).toBe(reads);
    const revealed = s.workspace.revealed.length;
    s.command('open-writing-report').callback?.(); // does nothing any more
    await calm(s);
    expect(s.workspace.revealed).toHaveLength(revealed);
    expect(s.workspace.getLeavesOfType(REPORT_VIEW_TYPE).map((left) => left.view)).toEqual([null]);
  });
});

describe('the scene that is open', () => {
  it('shows its figures, which match the hand count', async () => {
    const s = await stage(novelVault(), { front: inNovel(OPENING) });
    const { pane } = await openReport(s);
    expect(counts(pane)).toEqual(OPENING_COUNTS);
    expect(figure(pane, 'pages')).toBe('1');
    expect(figure(pane, 'read-time')).toBe('1 min');
    // English: the Flesch-Kincaid grade, named in the pane. 0.39 x 26/5 + 11.8 x 35/26 - 15.59 = 2.32
    expect(figure(pane, 'grade')).toBe('Grade 2.3');
    expect(noteOf(pane, 'grade')).toBe(GRADE_ENGLISH_NOTE);
    expect(noteOf(pane, 'grade')).toMatch(/Flesch-Kincaid/);
    expect(noteOf(pane, 'sentences')).toBe('5.2 words in an average sentence.');
    // What it is about: the scene's title, which is the writer's own text.
    expect(one(pane, 'spellbook-report-subject-kind').text).toBe('Scene');
    const title = one(pane, 'spellbook-report-subject-title');
    expect([title.text, title.getAttr('dir')]).toEqual(['Opening', 'auto']);
    expect(one(pane, 'spellbook-report-scope').text).toBe(SCOPE_SCENE_TEXT);
    // One scene: one note read, and nothing left on the line above the figures.
    expect(s.vault.reads.readText).toBe(1);
    expect(statusOf(pane)).toBe('');
    expect(s.vault.writes).toEqual([]);
  });

  it('gives a Hebrew scene its own figures, and a measure that is plainly called approximate', async () => {
    const s = await stage(novelVault(), { front: inNovel(NIGHT) });
    const { pane } = await openReport(s);
    expect(counts(pane)).toEqual(NIGHT_COUNTS);
    const title = one(pane, 'spellbook-report-subject-title');
    expect([title.text, title.getAttr('dir')]).toEqual([NIGHT_TITLE, 'auto']);
    // 16 words in 4 sentences and no long word: LIX 4. Not the English formula.
    const grade = one(pane, 'spellbook-report-tile-grade');
    expect(one(grade, 'spellbook-report-tile-label').text).toBe(GRADE_HEBREW_LABEL);
    expect(GRADE_HEBREW_LABEL).toMatch(/approximate/);
    expect(figure(pane, 'grade')).toBe('LIX 4');
    expect(noteOf(pane, 'grade')).toMatch(/^Approximate\. Hebrew has no standard reading-grade formula/);
    expect(noteOf(pane, 'grade')).toMatch(/not a school year/);
    expect(noteOf(pane, 'grade')).not.toMatch(/Flesch/);
    // The most used words are Hebrew words, each free to run its own way.
    const words = pane.withClass('spellbook-report-word');
    expect(words.length).toBeGreaterThan(0);
    for (const word of words) expect(word.getAttr('dir')).toBe('auto');
    expect(wordsOf(pane).map(([word]) => word)).toContain('אחותי');
    expect(wordsOf(pane).map(([word]) => word)).not.toContain('לך'); // a common word
  });

  it('says so when the open note is not a scene, and shows the figures once one is opened', async () => {
    const s = await stage();
    const { pane } = await openReport(s);
    expect(messageOf(pane)).toBe(NO_SCENE_TEXT);
    expect(pane.withClass('spellbook-report-tile')).toEqual([]);
    expect(s.vault.reads.readText).toBe(0);

    // A note outside the binder is not a scene either.
    s.front('Novel/Research/Harbours.md');
    await calm(s);
    expect(messageOf(pane)).toBe(NO_SCENE_TEXT);
    expect(s.vault.reads.readText).toBe(0);

    s.front(inNovel(LETTER));
    await calm(s);
    expect(messageOf(pane)).toBe('');
    expect(counts(pane)).toEqual({ words: '10', characters: '48', charactersNoSpaces: '39', sentences: '1', paragraphs: '1' });
  });

  it('keeps its figures when another note is opened, says that they are of the other one, and reads again when asked', async () => {
    const s = await stage(novelVault(), { front: inNovel(OPENING) });
    const { pane } = await openReport(s);
    s.front(inNovel(CLOSING));
    await calm(s);
    expect(statusOf(pane)).toBe(OTHER_SCENE_TEXT);
    expect(counts(pane)).toEqual(OPENING_COUNTS);
    expect(s.vault.reads.readText).toBe(1);

    await pressRefresh(s, pane);
    expect(statusOf(pane)).toBe('');
    expect(one(pane, 'spellbook-report-subject-title').text).toBe('Closing');
    expect(counts(pane)).toEqual({ words: '4', characters: '21', charactersNoSpaces: '18', sentences: '1', paragraphs: '1' });
    expect(s.vault.reads.readText).toBe(2);
  });
});

describe('a folder and the whole manuscript', () => {
  it('offers the open scene, the whole manuscript and every folder of the binder', async () => {
    const s = await stage(novelVault(), { front: inNovel(OPENING) });
    const { pane } = await openReport(s);
    const menu = scopeMenu(pane);
    expect(menu.outline).toEqual([SCOPE_SCENE_TEXT, SCOPE_MANUSCRIPT_TEXT, '---', 'Part one', INNER_NAME]);
    expect(menu.items.map((item) => item.checked)).toEqual([true, false, false, false]);
    // A folder's name is the writer's own text; a folder inside another is set in.
    const inner = menu.item(INNER_NAME).titleEl?.withClass('spellbook-report-menu-name')[0];
    expect(inner?.getAttr('dir')).toBe('auto');
    expect(inner?.hasClass('spellbook-report-menu-depth-1')).toBe(true);
    expect(menu.item('Part one').titleEl?.withClass('spellbook-report-menu-depth-0')).toHaveLength(1);
    expect(one(pane, 'spellbook-report-scope').getAttr('aria-haspopup')).toBe('menu');
  });

  it('adds up the whole manuscript in binder order, and matches the hand count', async () => {
    const s = await stage(novelVault(), { front: inNovel(OPENING) });
    const { pane } = await openReport(s);
    s.vault.reads.readText = 0;
    await choose(s, pane, SCOPE_MANUSCRIPT_TEXT);
    expect(counts(pane)).toEqual(MANUSCRIPT_COUNTS);
    expect(figure(pane, 'pages')).toBe('1');
    expect(figure(pane, 'read-time')).toBe('1 min');
    expect(one(pane, 'spellbook-report-scope').text).toBe(SCOPE_MANUSCRIPT_TEXT);
    expect(one(pane, 'spellbook-report-subject-kind').text).toBe('Manuscript');
    expect(one(pane, 'spellbook-report-subject-title').text).toBe('My Novel');
    expect(one(pane, 'spellbook-report-subject-scenes').text).toBe('4 scenes');
    // Each scene was read once. The scene whose note is missing is named, not counted.
    expect(s.vault.reads.readText).toBe(4);
    const unread = one(pane, 'spellbook-report-unread');
    expect(unread.fullText).toBe('1 scene could not be read and is not in these figures: Ghost');
    expect(one(unread, 'spellbook-report-unread-title').getAttr('dir')).toBe('auto');
    // Most of the text is English: it is judged as English, and the pane says so.
    expect(figure(pane, 'grade')).toMatch(/^Grade \d+\.\d$/);
    expect(noteOf(pane, 'grade')).toMatch(/Most of this text is in English, so it is judged as English\.$/);
    expect(scopeMenu(pane).items.map((item) => item.checked)).toEqual([false, true, false, false]);
  });

  it('adds up a folder with the folders inside it', async () => {
    const s = await stage();
    const { pane } = await openReport(s);
    await choose(s, pane, 'Part one');
    expect(counts(pane)).toEqual(PART_ONE_COUNTS);
    expect(one(pane, 'spellbook-report-subject-kind').text).toBe('Folder');
    expect(one(pane, 'spellbook-report-subject-title').text).toBe('Part one');
    expect(one(pane, 'spellbook-report-subject-scenes').text).toBe('2 scenes');
    expect(s.vault.reads.readText).toBe(2);
    // Most of it is Hebrew: the approximate measure, and the pane says how it was judged.
    expect(figure(pane, 'grade')).toMatch(/^LIX \d+$/);
    expect(noteOf(pane, 'grade')).toMatch(/Most of this text is in Hebrew, so it is judged as Hebrew\.$/);

    await choose(s, pane, INNER_NAME);
    expect(counts(pane)).toEqual(NIGHT_COUNTS);
    const button = one(pane, 'spellbook-report-scope');
    expect([button.text, button.getAttr('dir')]).toEqual([INNER_NAME, 'auto']);
    expect(one(pane, 'spellbook-report-subject-scenes').text).toBe('1 scene');
  });

  it('says so when the folder is empty, when it has left the binder, and when no project is open', async () => {
    const vault = new MemoryVault();
    vault.seed(NOVEL_INDEX, {
      frontmatter: { spellbook: 'project', version: 1, title: 'Empty', binder: [{ folder: 'Part one', id: 'f-one', children: [] }] },
      body: INDEX_BODY,
    });
    const s = await stage(vault);
    const { pane } = await openReport(s);
    await choose(s, pane, 'Part one');
    expect(messageOf(pane)).toBe(NO_SCENES_TEXT);
    expect(pane.withClass('spellbook-report-tile')).toEqual([]);

    await s.store.removeFolder('f-one');
    await calm(s);
    await pressRefresh(s, pane);
    expect(messageOf(pane)).toBe(NO_FOLDER_TEXT);

    await s.store.closeProject();
    await calm(s);
    expect(messageOf(pane)).toBe(NO_PROJECT_TEXT);
    await choose(s, pane, SCOPE_MANUSCRIPT_TEXT);
    expect(messageOf(pane)).toBe(NO_PROJECT_TEXT);
  });

  it('shows the figures of a project that is opened after the pane', async () => {
    const s = await stage(novelVault(), { open: null, front: inNovel(OPENING) });
    const { pane } = await openReport(s);
    expect(messageOf(pane)).toBe(NO_PROJECT_TEXT);
    await s.store.openProject(NOVEL_INDEX);
    await calm(s);
    expect(counts(pane)).toEqual(OPENING_COUNTS);
  });
});

describe('reading when asked', () => {
  it('does not read again when a scene is saved: it says the figures are out of date, until Refresh', async () => {
    const s = await stage();
    const { pane } = await openReport(s);
    await choose(s, pane, SCOPE_MANUSCRIPT_TEXT);
    const reads = s.vault.reads.readText;

    // A note that is not in the report: nothing to say.
    s.vault.external.write('Novel/Research/Harbours.md', { body: 'More notes.\n' });
    await calm(s);
    expect(statusOf(pane)).toBe('');

    // Typing in a scene, save after save.
    s.vault.external.write(inNovel(CLOSING), { body: 'The end came quietly. Nobody spoke.\n' });
    s.vault.external.write(inNovel(CLOSING), { body: 'The end came quietly. Nobody spoke again.\n' });
    await calm(s);
    expect(statusOf(pane)).toBe(STALE_TEXT);
    expect(counts(pane)).toEqual(MANUSCRIPT_COUNTS);
    expect(s.vault.reads.readText).toBe(reads);

    await pressRefresh(s, pane);
    expect(statusOf(pane)).toBe('');
    // Three words and a sentence more.
    expect(counts(pane).words).toBe('63');
    expect(counts(pane).sentences).toBe('12');
    expect(s.vault.reads.readText).toBe(reads + 4);
  });

  it('says the figures are out of date when a scene comes into the scope, and not for a change of name', async () => {
    const s = await stage();
    const { pane } = await openReport(s);
    await choose(s, pane, 'Part one');
    await s.store.renameFolder('f-one', 'Part 1');
    await calm(s);
    expect(statusOf(pane)).toBe('');
    expect(one(pane, 'spellbook-report-scope').text).toBe('Part 1');

    await s.store.moveNode({ kind: 'scene', path: CLOSING }, { at: 'start', parentId: 'f-one' });
    await calm(s);
    expect(statusOf(pane)).toBe(STALE_TEXT);
    expect(counts(pane)).toEqual(PART_ONE_COUNTS);
    await pressRefresh(s, pane);
    expect(counts(pane).words).toBe('32');
    expect(one(pane, 'spellbook-report-subject-scenes').text).toBe('3 scenes');
  });

  it('reads a long manuscript a few scenes at a time, and shows how far it is', async () => {
    const s = await stage(longVault(23));
    s.command('open-writing-report').callback?.();
    await breathe(s);
    const { pane } = paneOf(s);
    expect(messageOf(pane)).toBe(NO_SCENE_TEXT);

    scopeMenu(pane).item(SCOPE_MANUSCRIPT_TEXT).click();
    const seen: Array<[number, string]> = [];
    for (let go = 0; go < 10 && s.vault.reads.readText < 23; go++) {
      await breathe(s);
      // No timer was hurried: the report stopped by itself to give the screen a moment.
      seen.push([s.vault.reads.readText, statusOf(pane)]);
      s.timers.advance(0);
    }
    await calm(s);
    expect(READ_BATCH).toBe(5);
    expect(seen).toEqual([
      [5, 'Reading scene 6 of 23...'],
      [10, 'Reading scene 11 of 23...'],
      [15, 'Reading scene 16 of 23...'],
      [20, 'Reading scene 21 of 23...'],
      [23, ''],
    ]);
    expect(counts(pane)).toEqual({ words: '69', characters: '345', charactersNoSpaces: '299', sentences: '23', paragraphs: '23' });
    expect(one(pane, 'spellbook-report-subject-scenes').text).toBe('23 scenes');
  });

  it('shows a bar while it reads, which is read out as a progress bar', async () => {
    const s = await stage(longVault(12));
    const { pane } = await openReport(s);
    scopeMenu(pane).item(SCOPE_MANUSCRIPT_TEXT).click();
    await breathe(s);
    const bar = one(pane, 'spellbook-report-progress');
    expect(bar.getAttr('role')).toBe('progressbar');
    expect(bar.getAttr('aria-valuenow')).toBe('42'); // 5 of 12
    expect(one(bar, 'spellbook-report-progress-fill').style['width']).toBe('42%');
    expect(one(pane, 'spellbook-report-status').getAttr('aria-live')).toBe('polite');
    expect(one(pane, 'spellbook-report').hasClass('spellbook-report-is-reading')).toBe(true);
    await calm(s);
    expect(pane.withClass('spellbook-report-progress')).toEqual([]);
    expect(one(pane, 'spellbook-report').hasClass('spellbook-report-is-reading')).toBe(false);
  });

  it('stops a reading that is no longer wanted: another scope was chosen, or the pane was closed', async () => {
    const s = await stage(longVault(23), { front: 'Novel/Manuscript/Scene 2.md' });
    const { leaf, pane } = await openReport(s);
    expect(counts(pane).words).toBe('3');
    s.vault.reads.readText = 0;

    scopeMenu(pane).item(SCOPE_MANUSCRIPT_TEXT).click();
    await breathe(s);
    expect(s.vault.reads.readText).toBe(5);
    // The writer changes her mind: the open scene after all.
    scopeMenu(pane).item(SCOPE_SCENE_TEXT).click();
    await calm(s);
    expect(s.vault.reads.readText).toBe(6); // the one scene, and no more of the manuscript
    expect(one(pane, 'spellbook-report-subject-kind').text).toBe('Scene');
    expect(counts(pane).words).toBe('3');

    scopeMenu(pane).item(SCOPE_MANUSCRIPT_TEXT).click();
    await breathe(s);
    expect(s.vault.reads.readText).toBe(11);
    leaf.detach();
    await calm(s);
    expect(s.vault.reads.readText).toBe(11);
    expect(s.timers.pending).toBe(0);
  });

  it('goes on when a scene cannot be read, and names it', async () => {
    const s = await stage();
    const { pane } = await openReport(s);
    // The note is deleted behind the store's back, between the binder being read and the note.
    s.vault.external.delete(inNovel(LETTER), { silent: true });
    await choose(s, pane, SCOPE_MANUSCRIPT_TEXT);
    expect(counts(pane).words).toBe('50');
    expect(one(pane, 'spellbook-report-unread').fullText).toBe('2 scenes could not be read and are not in these figures: The Letter Ghost');
    expect(one(pane, 'spellbook-report-subject-scenes').text).toBe('3 scenes');
  });
});

describe('the most used words', () => {
  it('leaves out the common words until the switch is flipped', async () => {
    const s = await stage(novelVault(), { front: inNovel(OPENING) });
    const { pane } = await openReport(s);
    const box = (): FakeElement => one(pane, 'spellbook-report-common-box');
    expect(one(pane, 'spellbook-report-common').fullText).toBe(COMMON_SWITCH_TEXT);
    expect(isChecked(box())).toBe(true);
    const listed = wordsOf(pane).map(([word]) => word);
    expect(listed).toContain('anna');
    expect(listed).toContain('harbour');
    for (const common of ['was', 'the', 'a', 'and', 'it']) expect(listed, common).not.toContain(common);
    expect(pane.withClass('spellbook-report-word-head').map((head) => head.text)).toEqual(['Word', 'Times', 'Share']);

    setChecked(box(), false);
    // "was" is used twice among the 28 words; everything else once.
    expect(wordsOf(pane)[0]).toEqual(['was', '2']);
    expect(one(pane.withClass('spellbook-report-word-row')[0] as FakeElement, 'spellbook-report-word-share').text).toBe('7.1%');
    expect(isChecked(box())).toBe(false);
    expect(box().focused).toBe(true); // the keyboard stays on the switch
    // Only the list was drawn again: nothing was read, and the figures are the same elements.
    expect(s.vault.reads.readText).toBe(1);
    setChecked(box(), true);
    expect(wordsOf(pane).map(([word]) => word)).not.toContain('was');
  });

  it('lists the first of them, and more when asked', async () => {
    const vault = novelVault();
    const many = Array.from({ length: 60 }, (_, at) => `word${String.fromCharCode(97 + (at % 26))}${String.fromCharCode(97 + Math.floor(at / 26))}`);
    vault.external.write(inNovel(CLOSING), { body: `${many.join(' ')} ${many[0]}.\n` }, { silent: true });
    const s = await stage(vault, { front: inNovel(CLOSING) });
    const { pane } = await openReport(s);
    expect(figure(pane, 'words')).toBe('61');
    expect(wordsOf(pane)).toHaveLength(WORDS_STEP);
    expect(wordsOf(pane)[0]).toEqual([many[0], '2']);
    const more = (): FakeElement => one(pane, 'spellbook-report-more');
    expect(more().text).toBe('Show more words (35 left)');
    more().fire('click');
    expect(wordsOf(pane)).toHaveLength(2 * WORDS_STEP);
    expect(more().text).toBe('Show more words (10 left)');
    expect(more().focused).toBe(true);
    more().fire('click');
    expect(wordsOf(pane)).toHaveLength(60);
    expect(pane.withClass('spellbook-report-more')).toEqual([]);
  });
});

describe('the words on a page', () => {
  it('are 250 until the writer says otherwise, in the pane, and are kept on this device', async () => {
    const vault = novelVault();
    vault.external.write(inNovel(CLOSING), { body: `${'word '.repeat(600)}\n` }, { silent: true });
    const s = await stage(vault, { front: inNovel(CLOSING) });
    const { pane } = await openReport(s);
    const field = (): FakeElement => one(pane, 'spellbook-report-per-page-field');
    expect(figure(pane, 'words')).toBe('600');
    expect(figure(pane, 'pages')).toBe('3');
    expect(figure(pane, 'read-time')).toBe('3 min');
    expect(field().value).toBe('250');
    expect(one(pane, 'spellbook-report-per-page').fullText).toBe('Words on a page');
    expect(s.storage.saves).toEqual([]);

    field().value = '300';
    field().fire('change');
    expect(figure(pane, 'pages')).toBe('2');
    expect(field().value).toBe('300');
    expect(s.storage.saves).toEqual([[WORDS_PER_PAGE_KEY, '300']]);
    expect(s.vault.reads.readText).toBe(1); // worked out anew from what was read

    // Not a number that can be a page: the field shows again what is in use.
    for (const odd of ['', 'many', '5', '99999']) {
      field().value = odd;
      field().fire('change');
      expect(field().value, odd).toBe('300');
      expect(figure(pane, 'pages')).toBe('2');
    }
    // Back to the usual figure: nothing is stored for it.
    field().value = '250';
    field().fire('change');
    expect(figure(pane, 'pages')).toBe('3');
    expect(s.storage.saves[s.storage.saves.length - 1]).toEqual([WORDS_PER_PAGE_KEY, null]);
  });

  it('are what the device remembers', async () => {
    const storage = new MemoryDeviceStorage();
    storage.save(WORDS_PER_PAGE_KEY, '100');
    storage.saves.length = 0;
    const vault = novelVault();
    vault.external.write(inNovel(CLOSING), { body: `${'word '.repeat(600)}\n` }, { silent: true });
    const s = await stage(vault, { front: inNovel(CLOSING), storage });
    const { pane } = await openReport(s);
    expect(figure(pane, 'pages')).toBe('6');

    // A storage that fails, or holds something else, gives the 250.
    const broken = new MemoryDeviceStorage();
    broken.broken = true;
    const prefs = new ReportPrefs(broken);
    expect(prefs.wordsPerPage).toBe(250);
    prefs.wordsPerPage = 400; // cannot be saved: it lasts until Obsidian closes
    expect(prefs.wordsPerPage).toBe(400);
    const odd = new MemoryDeviceStorage();
    odd.save(WORDS_PER_PAGE_KEY, 'lots');
    expect(new ReportPrefs(odd).wordsPerPage).toBe(250);
  });

  it('can be a row of the settings tab as well (not switched on yet)', () => {
    const storage = new MemoryDeviceStorage();
    const prefs = new ReportPrefs(storage);
    const told: number[] = [];
    prefs.onChange(() => told.push(prefs.wordsPerPage));
    const section = reportSettings(prefs);
    expect([section.id, section.title]).toEqual(['report', 'Writing report']);
    const container = new FakeElement();
    section.render(container as unknown as HTMLElement);
    const row = container.settings[0];
    expect(row?.nameEl.text).toBe(WORDS_PER_PAGE_NAME);
    const text = row?.components[0] as { type(value: string): void; getValue(): string };
    expect(text.getValue()).toBe('250');
    // Typed key by key: "3" and "30" cannot be a page, "300" can.
    for (const typed of ['3', '30', '300']) text.type(typed);
    expect(told).toEqual([300]);
    expect(storage.saves).toEqual([[WORDS_PER_PAGE_KEY, '300']]);
  });
});

describe('a narrow pane', () => {
  it('puts the figures in a single column, going by the measured width of the pane', async () => {
    const s = await stage(novelVault(), { front: inNovel(OPENING) });
    const { view, pane } = await openReport(s);
    const root = one(pane, 'spellbook-report');
    expect(root.hasClass('spellbook-is-narrow')).toBe(false);
    pane.clientWidth = NARROW_BELOW - 100;
    view.onResize();
    expect(root.hasClass('spellbook-is-narrow')).toBe(true);
    // The same figures, all of them.
    expect(counts(pane)).toEqual(OPENING_COUNTS);
    expect(pane.withClass('spellbook-report-tile')).toHaveLength(8);
    // In the gap it stays as it was; from there on it is wide again.
    pane.clientWidth = WIDE_FROM - 10;
    view.onResize();
    expect(root.hasClass('spellbook-is-narrow')).toBe(true);
    pane.clientWidth = 900;
    view.onResize();
    expect(root.hasClass('spellbook-is-narrow')).toBe(false);
    expect(s.vault.reads.readText).toBe(1); // measuring reads nothing
  });

  it('takes a phone to be narrow until the pane is measured, and slides its drawers away', async () => {
    Object.assign(Platform, { isDesktop: false, isMobile: true, isPhone: true });
    const s = await stage(novelVault(), { front: inNovel(NIGHT) });
    s.workspace.leftSplit.expand();
    const { pane } = await openReport(s);
    const root = one(pane, 'spellbook-report');
    expect(root.hasClass('spellbook-is-narrow')).toBe(true);
    expect(root.hasClass('spellbook-is-mobile')).toBe(true);
    expect(root.hasClass('spellbook-is-phone')).toBe(true);
    expect(s.workspace.leftSplit.collapsed).toBe(true);
    expect(counts(pane)).toEqual(NIGHT_COUNTS);
  });
});
