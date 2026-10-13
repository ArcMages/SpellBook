// The corkboard feature as it is plugged into the plugin: registered through
// the feature registry, on the real project store over the tests' memory
// vault, with the stand-in plugin, workspace and screen. These tests check
// that what the screens show comes from the notes, that what they change
// reaches the notes through the store, and that nothing is left behind. How
// it looks, and how the real app behaves, can only be checked in Obsidian.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ACTIVE_CLASS,
  CORKBOARD_ICON,
  CORKBOARD_VIEW_TYPE,
  CorkboardView,
  NO_PROJECT_TEXT,
} from '../../../src/features/corkboard/corkboardView';
import {
  CORKBOARD_COMMANDS,
  CORKBOARD_RIBBON_TITLE,
  OTHER_PROJECT_TEXT,
  SHOW_FOLDER_SERVICE,
  StoreCardsHost,
} from '../../../src/features/corkboard/index';
import type { ShowFolder } from '../../../src/features/corkboard/index';
import {
  INSPECTOR_NO_PROJECT_TEXT,
  INSPECTOR_VIEW_TYPE,
  InspectorView,
  NO_SCENE_TEXT,
  SUMMARY_SLOT_CLASS,
} from '../../../src/features/corkboard/inspectorView';
import { NO_ROOM_FOR_INSPECTOR } from '../../../src/features/corkboard/panes';
import { CARD_SIZE_KEY, TEXT_SETTLE_MS, TEXT_SLICE } from '../../../src/features/corkboard/storeHost';
import { SCENE_LINE_SERVICE } from '../../../src/features/corkboard/summaryLine';
import type { SceneLine, SceneLineSegment } from '../../../src/features/corkboard/summaryLine';
import { TagListsModal } from '../../../src/features/corkboard/tagListsModal';
import { WORD_COUNT_SLICE_NOTES } from '../../../src/core/wordCountCache';
import { SHOW_ON_CORKBOARD } from '../../../src/views/binderActions';
import { MemoryVault } from '../../memoryVault';
import { Platform as StubPlatform, resetPlatform } from '../../obsidianStub';
import type { FakeElement } from '../../obsidianStub';
import { INDEX_BODY, binderOnDisk, seedProject, tick } from '../../storeHarness';
import {
  CLOSING,
  DANIEL,
  HEBREW_SCENE,
  HEBREW_SYNOPSIS,
  INNER_NAME,
  LETTER,
  LETTER_TEXT,
  OPENING,
  answerPrompt,
  cardOf,
  choose,
  clearScreen,
  colorOf,
  crumbs,
  menuFrom,
  menuOf,
  notices,
  one,
  openWindow,
  seen,
  submenu,
  tap,
  titles,
  typeInto,
} from './stage';
import {
  LABELS,
  NOVEL_INDEX,
  SECOND_INDEX,
  STATUSES,
  calm,
  leavesOf,
  novelVault,
  openCorkboard,
  openInspectorPane,
  paneOf,
  wire,
} from './wiringStage';
import type { Wired } from './wiringStage';

const inNovel = (path: string): string => `Novel/${path}`;

/** Everything a test wired up, so that it can be switched off when the test is over. */
const stages: Wired[] = [];

async function stage(...args: Parameters<typeof wire>): Promise<Wired> {
  const wired = await wire(...args);
  stages.push(wired);
  return wired;
}

beforeEach(() => {
  clearScreen();
});

afterEach(() => {
  for (const wired of stages.splice(0)) wired.switchOff();
  resetPlatform();
});

/** The fields of the inspector's form. */
function fieldsOf(pane: FakeElement): { synopsis: FakeElement; status: FakeElement; label: FakeElement; target: FakeElement } {
  return {
    synopsis: one(pane, 'spellbook-inspector-synopsis'),
    status: one(pane, 'spellbook-inspector-status'),
    label: one(pane, 'spellbook-inspector-label'),
    target: one(pane, 'spellbook-inspector-target'),
  };
}

const optionsOf = (select: FakeElement): string[] => select.children.map((option) => option.text);
const marked = (pane: FakeElement): string[] =>
  pane.withClass(ACTIVE_CLASS).map((card) => card.withClass('spellbook-card-title')[0]?.text ?? '');

describe('plugging the corkboard and the inspector in', () => {
  it('registers the two kinds of pane, the commands and the ribbon button, and does nothing else yet', async () => {
    const s = await stage();
    expect(s.features.ids).toEqual(['corkboard']);
    expect(s.plugin.viewTypes).toEqual([CORKBOARD_VIEW_TYPE, INSPECTOR_VIEW_TYPE]);
    expect(s.plugin.viewTypes).toEqual(['spellbook-corkboard', 'spellbook-inspector']);
    // Obsidian puts "Spellbook: " in front of the names itself.
    expect(s.plugin.commands.map((command) => [command.id, command.name])).toEqual([
      ['open-corkboard', 'Open corkboard'],
      ['open-inspector', 'Open inspector'],
      ['manage-statuses-and-labels', 'Manage statuses and labels'],
    ]);
    expect(Object.values(CORKBOARD_COMMANDS).map((command) => command.id)).toEqual(s.plugin.commands.map((command) => command.id));
    expect(s.plugin.ribbonIcons.map((icon) => [icon.icon, icon.title, icon.shown])).toEqual([
      [CORKBOARD_ICON, CORKBOARD_RIBBON_TITLE, true],
    ]);
    expect(s.features.settingsSections).toEqual([]);

    // Registering opens nothing, reads no note, remembers nothing on the device and listens to nothing.
    await calm(s);
    expect(s.workspace.leaves).toEqual([]);
    expect(s.workspace.listenerCount()).toBe(0);
    expect(s.vault.reads).toEqual({ readFrontmatter: 0, readText: 0 });
    expect(s.vault.writes).toEqual([]);
    expect(s.storage.saves).toEqual([]);
    expect(notices()).toEqual([]);
  });

  it('opens the corkboard as a tab in the main area, and only ever once', async () => {
    const s = await stage();
    // Twice in the same instant, as from a double tap.
    s.command('open-corkboard').callback?.();
    s.command('open-corkboard').callback?.();
    await calm(s);
    const leaves = leavesOf(s, CORKBOARD_VIEW_TYPE);
    expect(leaves).toHaveLength(1);
    const leaf = leaves[0];
    expect(leaf?.view).toBeInstanceOf(CorkboardView);
    expect(leaf?.getRoot()).toBe(s.workspace.rootSplit);
    expect(s.workspace.revealed).toEqual([leaf]);
    expect(titles(paneOf(leaf))).toEqual(['Opening', 'Part one', 'Ghost', 'Closing']);

    // Asked for again, from the command and from the ribbon: the same pane is brought to the front.
    s.command('open-corkboard').callback?.();
    await calm(s);
    s.plugin.ribbonIcons[0]?.callback({});
    await calm(s);
    expect(leavesOf(s, CORKBOARD_VIEW_TYPE)).toEqual([leaf]);
    expect(s.workspace.revealed).toEqual([leaf, leaf, leaf]);
    expect(s.workspace.leaves).toHaveLength(1);
  });

  it('brings a corkboard to the front where it is, when the writer has moved it', async () => {
    const s = await stage();
    const moved = s.workspace.addLeaf(s.workspace.leftSplit);
    await moved.setViewState({ type: CORKBOARD_VIEW_TYPE });
    s.command('open-corkboard').callback?.();
    await calm(s);
    expect(leavesOf(s, CORKBOARD_VIEW_TYPE)).toEqual([moved]);
    expect(s.workspace.leftSplit.collapsed).toBe(false);
    expect(s.workspace.leaves).toHaveLength(1);
  });

  it('slides the drawers away on a phone, so that the board can be seen', async () => {
    StubPlatform.isMobile = true;
    StubPlatform.isPhone = true;
    const s = await stage();
    s.workspace.leftSplit.expand();
    await openCorkboard(s);
    expect(s.workspace.leftSplit.collapsed).toBe(true);
    expect(s.workspace.rightSplit.collapsed).toBe(true);
  });

  it('opens the inspector in the right sidebar, and only ever once', async () => {
    const s = await stage();
    s.command('open-inspector').callback?.();
    s.command('open-inspector').callback?.();
    await calm(s);
    const leaves = leavesOf(s, INSPECTOR_VIEW_TYPE);
    expect(leaves).toHaveLength(1);
    expect(leaves[0]?.view).toBeInstanceOf(InspectorView);
    expect(leaves[0]?.getRoot()).toBe(s.workspace.rightSplit);
    expect(s.workspace.rightSplit.collapsed).toBe(false); // the sidebar was opened to show it

    s.workspace.rightSplit.collapse();
    s.command('open-inspector').callback?.();
    await calm(s);
    expect(leavesOf(s, INSPECTOR_VIEW_TYPE)).toEqual(leaves);
    expect(s.workspace.rightSplit.collapsed).toBe(false);
    expect(s.workspace.leaves).toHaveLength(1);
  });

  it('says so when Obsidian has no room for the inspector', async () => {
    const s = await stage();
    s.room.noRoomOnTheRight = true;
    s.command('open-inspector').callback?.();
    await calm(s);
    expect(leavesOf(s, INSPECTOR_VIEW_TYPE)).toEqual([]);
    expect(notices()).toEqual([NO_ROOM_FOR_INSPECTOR]);
  });

  it('fills in panes that were there before a project was open', async () => {
    // Obsidian puts the panes of the last session back while no project is open yet.
    const s = await stage(novelVault(), { open: null });
    const board = s.workspace.addLeaf(s.workspace.rootSplit);
    await board.setViewState({ type: CORKBOARD_VIEW_TYPE });
    const inspector = s.workspace.addLeaf(s.workspace.rightSplit);
    await inspector.setViewState({ type: INSPECTOR_VIEW_TYPE });
    await calm(s);
    expect(seen(paneOf(board), 'spellbook-board-message')).toBe(NO_PROJECT_TEXT);
    expect(seen(paneOf(inspector), 'spellbook-inspector-message')).toBe(INSPECTOR_NO_PROJECT_TEXT);
    expect(s.command('manage-statuses-and-labels').checkCallback?.(true)).toBe(false);

    s.workOn(inNovel(OPENING));
    await s.store.openProject(NOVEL_INDEX);
    await calm(s);
    expect(titles(paneOf(board))).toEqual(['Opening', 'Part one', 'Ghost', 'Closing']);
    expect(one(paneOf(inspector), 'spellbook-inspector-title').text).toBe('Opening');
    expect(s.command('manage-statuses-and-labels').checkCallback?.(true)).toBe(true);
  });
});

describe('what the corkboard shows comes from the notes', () => {
  it('shows each scene with its properties, its words and, without a synopsis, the start of its text', async () => {
    const s = await stage();
    const { pane } = await openCorkboard(s);

    const opening = cardOf(pane, 'Opening');
    expect(seen(opening, 'spellbook-card-synopsis')).toBe('Anna arrives in the old town.');
    expect(seen(opening, 'spellbook-card-status')).toBe('To do');
    expect(colorOf(one(opening, 'spellbook-card-status'))).toBe('red');
    expect(seen(opening, 'spellbook-card-label-name')).toBe('Anna');
    // Counted by the cache the binder uses too.
    expect(seen(opening, 'spellbook-card-words')).toBe('5 / 1,000 words');

    // A status the project's list does not have is shown all the same.
    expect(seen(cardOf(pane, 'Closing'), 'spellbook-card-status')).toBe('Sent off');
    expect(seen(cardOf(pane, 'Closing'), 'spellbook-card-words')).toBe('4 words');
    // The folder sums the scenes inside it, at any depth.
    expect(seen(cardOf(pane, 'Part one'), 'spellbook-card-words')).toBe('20 words');
    expect(seen(cardOf(pane, 'Part one'), 'spellbook-card-scenes')).toBe('2 scenes');
    expect(cardOf(pane, 'Ghost').hasClass('spellbook-is-missing')).toBe(true);

    // Inside the folder: a scene without a synopsis gets the start of its text.
    tap(cardOf(pane, 'Part one'));
    await calm(s);
    expect(titles(pane)).toEqual(['The Letter', INNER_NAME]);
    const letter = cardOf(pane, 'The Letter');
    expect(seen(letter, 'spellbook-card-synopsis')).toBe(LETTER_TEXT);
    expect(one(letter, 'spellbook-card-synopsis').hasClass('spellbook-is-derived')).toBe(true);
    expect(seen(letter, 'spellbook-card-words')).toBe('16 words');

    tap(cardOf(pane, INNER_NAME));
    await calm(s);
    const hebrew = cardOf(pane, 'מכתב לאחותי');
    expect(seen(hebrew, 'spellbook-card-synopsis')).toBe(HEBREW_SYNOPSIS);
    expect(seen(hebrew, 'spellbook-card-label-name')).toBe(DANIEL);
    // Showing the board writes nothing.
    expect(s.vault.writes).toEqual([]);
  });

  it('reads only the text of scenes on show that have no synopsis of their own', async () => {
    const s = await stage();
    const { pane } = await openCorkboard(s);
    // Counted: the four scenes that have a note. On the first board only "Closing" has no synopsis.
    expect(s.vault.reads.readText).toBe(5);

    tap(cardOf(pane, 'Part one'));
    await calm(s);
    expect(s.vault.reads.readText).toBe(6); // "The Letter" came on show
    // Going back and forth reads nothing again: what was read is kept while it is still right.
    tap(crumbs(pane)[0] as FakeElement);
    await calm(s);
    tap(cardOf(pane, 'Part one'));
    await calm(s);
    expect(s.vault.reads.readText).toBe(6);

    // A scene that is saved while it is off show is read again when it comes back on show.
    tap(crumbs(pane)[0] as FakeElement);
    await calm(s);
    s.vault.external.write(inNovel(LETTER), { body: 'Rewritten while the board showed something else.\n' });
    s.timers.advance(TEXT_SETTLE_MS);
    await calm(s);
    expect(s.vault.reads.readText).toBe(7); // counted again; no preview was wanted
    tap(cardOf(pane, 'Part one'));
    await calm(s);
    expect(s.vault.reads.readText).toBe(8);
    expect(seen(cardOf(pane, 'The Letter'), 'spellbook-card-synopsis')).toBe('Rewritten while the board showed something else.');
  });

  it('reads a long board a slice at a time, and shows every preview in the end', async () => {
    const vault = new MemoryVault();
    const scenes: Record<string, number> = {};
    for (let number = 1; number <= 45; number++) scenes[`Scene ${number}`] = number * 1024;
    const s = await stage(vault, { open: seedProject(vault, { scenes }) });
    s.command('open-corkboard').callback?.();
    // Without letting any timer fire: one slice of texts was read, one slice of notes counted, and both wait.
    for (let turn = 0; turn < 5; turn++) await tick();
    expect(s.vault.reads.readText).toBe(TEXT_SLICE + WORD_COUNT_SLICE_NOTES);

    await calm(s);
    const pane = paneOf(leavesOf(s, CORKBOARD_VIEW_TYPE)[0]);
    expect(titles(pane)).toHaveLength(45);
    for (const number of [1, 20, 21, 45]) {
      const card = cardOf(pane, `Scene ${number}`);
      // The opening prose, without the comment the writer left for themselves.
      expect(seen(card, 'spellbook-card-synopsis')).toBe(`It was a dark and stormy night in Scene ${number}.`);
      expect(seen(card, 'spellbook-card-words')).toBe('10 words');
    }
    expect(s.vault.reads.readText).toBe(90); // every note once for its words, once for its preview
  });

  it('counts no words and reads no text for an inspector alone', async () => {
    const s = await stage();
    s.workOn(inNovel(LETTER));
    const { pane } = await openInspectorPane(s);
    expect(one(pane, 'spellbook-inspector-title').text).toBe('The Letter');
    expect(s.vault.reads).toEqual({ readFrontmatter: 0, readText: 0 });
  });

  it('marks the scene being worked on, and keeps it while no note is in front', async () => {
    const s = await stage();
    s.workOn(inNovel(OPENING));
    const { pane } = await openCorkboard(s);
    expect(marked(pane)).toEqual(['Opening']);

    s.workOn(inNovel(CLOSING));
    await calm(s);
    expect(marked(pane)).toEqual(['Closing']);
    // A graph, say, comes to the front: Obsidian still knows the note that was worked on last.
    s.workspace.trigger('file-open', null);
    await calm(s);
    expect(marked(pane)).toEqual(['Closing']);
    // A note that is not a scene of the binder: nothing is marked.
    s.workOn('Novel/Research/Trains.md');
    await calm(s);
    expect(marked(pane)).toEqual([]);
    s.workOn('Notes/Plain.md');
    await calm(s);
    expect(marked(pane)).toEqual([]);
  });

  it('shows the scene being worked on in the inspector, with the choices of the project', async () => {
    const s = await stage();
    const { pane } = await openInspectorPane(s);
    expect(seen(pane, 'spellbook-inspector-message')).toBe(NO_SCENE_TEXT);

    s.workOn(inNovel(OPENING));
    await calm(s);
    const fields = fieldsOf(pane);
    expect(one(pane, 'spellbook-inspector-title').text).toBe('Opening');
    expect(fields.synopsis.value).toBe('Anna arrives in the old town.');
    expect(fields.status.value).toBe('To do');
    expect(optionsOf(fields.status)).toEqual(['No status', 'To do', 'First draft', 'Done']);
    expect(fields.label.value).toBe('Anna');
    expect(optionsOf(fields.label)).toEqual(['No label', 'Anna', DANIEL]);
    expect(fields.target.value).toBe('1000');

    s.workOn(inNovel(HEBREW_SCENE));
    await calm(s);
    expect(one(pane, 'spellbook-inspector-title').text).toBe('מכתב לאחותי');
    expect(fields.synopsis.value).toBe(HEBREW_SYNOPSIS);
    s.workOn('Notes/Plain.md');
    await calm(s);
    expect(seen(pane, 'spellbook-inspector-message')).toBe(NO_SCENE_TEXT);
  });
});

describe('what is changed on the screens reaches the notes through the store', () => {
  it('sets a status from a card: only that property of that note is written, and the card follows', async () => {
    const s = await stage();
    const { pane } = await openCorkboard(s);
    const before = s.vault.frontmatterOf(inNovel(OPENING));
    const body = s.vault.bodyOf(inNovel(OPENING));

    submenu(menuOf(pane, 'Opening'), 'Set status').item('Done').click();
    await calm(s);
    expect(s.vault.writes).toEqual([{ op: 'updateFrontmatter', path: inNovel(OPENING) }]);
    expect(s.vault.frontmatterOf(inNovel(OPENING))).toEqual({ ...before, status: 'Done' });
    expect(s.vault.bodyOf(inNovel(OPENING))).toBe(body);
    expect(seen(cardOf(pane, 'Opening'), 'spellbook-card-status')).toBe('Done');
    expect(colorOf(one(cardOf(pane, 'Opening'), 'spellbook-card-status'))).toBe('green');
    expect(notices()).toEqual([]);
  });

  it('saves what is typed in the inspector, and an open corkboard follows', async () => {
    const s = await stage();
    s.workOn(inNovel(LETTER));
    const board = await openCorkboard(s);
    tap(cardOf(board.pane, 'Part one'));
    await calm(s);
    const inspector = await openInspectorPane(s);
    const fields = fieldsOf(inspector.pane);
    expect(fields.synopsis.value).toBe('');
    const reads = s.vault.reads.readText;

    typeInto(fields.synopsis, 'A letter arrives.');
    fields.synopsis.dispatch('blur', {});
    choose(fields.label, 'Anna');
    await calm(s);
    expect(s.vault.frontmatterOf(inNovel(LETTER))).toEqual({
      status: 'First draft',
      order: 2048,
      synopsis: 'A letter arrives.',
      label: 'Anna',
    });
    expect(s.vault.bodyOf(inNovel(LETTER))).toBe(`${LETTER_TEXT}\n`);
    expect(s.vault.writesTo(inNovel(LETTER)).map((write) => write.op)).toEqual(['updateFrontmatter', 'updateFrontmatter']);
    expect(fields.synopsis.value).toBe('A letter arrives.');

    const card = cardOf(board.pane, 'The Letter');
    expect(seen(card, 'spellbook-card-synopsis')).toBe('A letter arrives.');
    expect(one(card, 'spellbook-card-synopsis').hasClass('spellbook-is-derived')).toBe(false);
    expect(seen(card, 'spellbook-card-label-name')).toBe('Anna');

    // The scene has a synopsis of its own now: saving its text again makes nobody read it for a preview.
    s.vault.external.write(inNovel(LETTER), { body: 'Rewritten.\n' });
    s.timers.advance(TEXT_SETTLE_MS);
    await calm(s);
    expect(s.vault.reads.readText).toBe(reads + 1); // once, to count its words
    expect(seen(cardOf(board.pane, 'The Letter'), 'spellbook-card-words')).toBe('1 word');
  });

  it('moves a card: the binder in the index note changes, and the board follows', async () => {
    const s = await stage();
    const { pane } = await openCorkboard(s);
    menuOf(pane, 'Opening').item('Move later').click();
    await calm(s);
    expect(titles(pane)).toEqual(['Part one', 'Opening', 'Ghost', 'Closing']);
    const binder = binderOnDisk(s.vault, NOVEL_INDEX) as unknown[];
    expect(binder.map((entry) => (typeof entry === 'string' ? entry : 'folder'))).toEqual(['folder', OPENING, 'Manuscript/Ghost.md', CLOSING]);
    expect(s.vault.bodyOf(NOVEL_INDEX)).toBe(INDEX_BODY);
    expect(notices()).toEqual([]);
  });

  it('opens the note of a tapped card, which becomes the scene being worked on', async () => {
    const s = await stage();
    const { pane } = await openCorkboard(s);
    tap(cardOf(pane, 'Closing'));
    await calm(s);
    expect(s.opened).toEqual([{ path: inNovel(CLOSING), where: false }]);
    expect(marked(pane)).toEqual(['Closing']);

    menuOf(pane, 'Opening').item('Open in new tab').click();
    await calm(s);
    expect(s.opened[1]).toEqual({ path: inNovel(OPENING), where: 'tab' });
    // A card whose note is not in the vault opens nothing.
    tap(cardOf(pane, 'Ghost'));
    await calm(s);
    expect(s.opened).toHaveLength(2);
  });

  it('remembers the card size on this device, and nowhere else', async () => {
    const s = await stage();
    const first = await openCorkboard(s);
    expect(one(first.pane, 'spellbook-board-size').value).toBe('medium');
    choose(one(first.pane, 'spellbook-board-size'), 'large');
    await calm(s);
    expect(s.storage.saves).toEqual([[CARD_SIZE_KEY, 'large']]);
    expect(CARD_SIZE_KEY).toBe('spellbook-card-size');
    expect(s.vault.writes).toEqual([]);

    // A board that is opened later starts with it.
    first.leaf.detach();
    await calm(s);
    const second = await openCorkboard(s);
    expect(one(second.pane, 'spellbook-board-size').value).toBe('large');
    expect(s.storage.saves).toHaveLength(1);
  });

  it('tells the writer when a change could not be saved, and shows what the note still says', async () => {
    const s = await stage();
    const { pane } = await openCorkboard(s);
    s.vault.failNext('updateFrontmatter', inNovel(OPENING));
    submenu(menuOf(pane, 'Opening'), 'Set status').item('Done').click();
    await calm(s);
    expect(notices()).toEqual(['The properties of "Opening" could not be saved: The disk is not available']);
    expect(s.vault.frontmatterOf(inNovel(OPENING))?.['status']).toBe('To do');
    expect(seen(cardOf(pane, 'Opening'), 'spellbook-card-status')).toBe('To do');
  });

  it('shows what was saved at once, even while the vault\'s own index lags behind', async () => {
    const s = await stage();
    const { pane } = await openCorkboard(s);
    s.vault.holdMetadata();
    submenu(menuOf(pane, 'Opening'), 'Set status').item('Done').click();
    await calm(s);
    expect(s.vault.frontmatterOf(inNovel(OPENING))?.['status']).toBe('Done');
    expect(s.vault.listMarkdownFiles('Novel').find((file) => file.path === inNovel(OPENING))?.frontmatter?.['status']).toBe('To do');
    expect(seen(cardOf(pane, 'Opening'), 'spellbook-card-status')).toBe('Done');

    // Something else changes the project meanwhile: the card is not thrown back to what the index says.
    await s.store.renameFolder('f-one', 'Part 1');
    await calm(s);
    expect(titles(pane)).toEqual(['Opening', 'Part 1', 'Ghost', 'Closing']);
    expect(seen(cardOf(pane, 'Opening'), 'spellbook-card-status')).toBe('Done');

    s.vault.releaseMetadata();
    await calm(s);
    expect(seen(cardOf(pane, 'Opening'), 'spellbook-card-status')).toBe('Done');
    // From here on the index is believed again.
    s.vault.external.editFrontmatter(inNovel(OPENING), (frontmatter) => {
      frontmatter['status'] = 'First draft';
    });
    await calm(s);
    expect(seen(cardOf(pane, 'Opening'), 'spellbook-card-status')).toBe('First draft');
  });
});

describe('the statuses and labels', () => {
  const rowsOf = (content: FakeElement, kind: 'status' | 'label'): FakeElement[] =>
    one(one(content, `spellbook-tags-${kind}`), 'spellbook-tags-list').children;
  const namesOf = (content: FakeElement, kind: 'status' | 'label'): string[] =>
    rowsOf(content, kind).map((row) => one(row, 'spellbook-tag-name').text);
  const rowOf = (content: FakeElement, kind: 'status' | 'label', name: string): FakeElement => {
    const found = rowsOf(content, kind).find((row) => one(row, 'spellbook-tag-name').text === name);
    if (!found) throw new Error(`no ${kind} called "${name}"`);
    return found;
  };

  /** Run "Manage statuses and labels" and give what the window shows. */
  function manage(s: Wired): FakeElement {
    const command = s.command('manage-statuses-and-labels');
    expect(command.checkCallback?.(true)).toBe(true);
    command.checkCallback?.(false);
    const modal = openWindow();
    expect(modal).toBeInstanceOf(TagListsModal);
    return modal.contentEl;
  }

  it('are shown from the index note by the command "Manage statuses and labels"', async () => {
    const s = await stage();
    const content = manage(s);
    expect(namesOf(content, 'status')).toEqual(['To do', 'First draft', 'Done']);
    expect(namesOf(content, 'label')).toEqual(['Anna', DANIEL]);
    // Nothing was written, counted or read by looking.
    await calm(s);
    expect(s.vault.writes).toEqual([]);
    expect(s.vault.reads).toEqual({ readFrontmatter: 0, readText: 0 });
  });

  it('renames a status in the index note and in every scene that uses it, and the screens follow', async () => {
    const s = await stage();
    s.vault.external.editFrontmatter(inNovel(CLOSING), (frontmatter) => {
      frontmatter['status'] = 'to do';
    });
    const { pane } = await openCorkboard(s);
    const content = manage(s);
    const index = s.vault.frontmatterOf(NOVEL_INDEX);
    s.vault.clearWrites();

    menuFrom(one(rowOf(content, 'status', 'To do'), 'spellbook-tag-more')).item('Rename').click();
    answerPrompt('Planned');
    await calm(s);

    // The list, under its key in the index note; every other key and the note's text are as they were.
    expect(s.vault.frontmatterOf(NOVEL_INDEX)).toEqual({
      ...index,
      statuses: [{ name: 'Planned', color: 'red' }, STATUSES[1], STATUSES[2]],
    });
    expect(s.vault.frontmatterOf(NOVEL_INDEX)?.['labels']).toEqual(LABELS);
    expect(s.vault.bodyOf(NOVEL_INDEX)).toBe(INDEX_BODY);
    // The scenes that used the old name, however they spelled it; no other scene is written.
    expect(s.vault.frontmatterOf(inNovel(OPENING))?.['status']).toBe('Planned');
    expect(s.vault.frontmatterOf(inNovel(CLOSING))?.['status']).toBe('Planned');
    expect(s.vault.frontmatterOf(inNovel(LETTER))?.['status']).toBe('First draft');
    expect(s.vault.writes).toEqual([
      { op: 'updateFrontmatter', path: NOVEL_INDEX },
      { op: 'updateFrontmatter', path: inNovel(OPENING) },
      { op: 'updateFrontmatter', path: inNovel(CLOSING) },
    ]);

    expect(namesOf(content, 'status')).toEqual(['Planned', 'First draft', 'Done']);
    expect(seen(cardOf(pane, 'Opening'), 'spellbook-card-status')).toBe('Planned');
    expect(colorOf(one(cardOf(pane, 'Opening'), 'spellbook-card-status'))).toBe('red');
    expect(seen(cardOf(pane, 'Closing'), 'spellbook-card-status')).toBe('Planned');
    expect(notices()).toEqual([]);
  });

  it('works a rename out again from each scene as it is on disk when it is written', async () => {
    const s = await stage();
    const content = manage(s);
    // The scene is changed on another device, and this device's index has not caught up.
    s.vault.external.editFrontmatter(inNovel(OPENING), (frontmatter) => {
      frontmatter['status'] = 'Done';
      frontmatter['target'] = 2000;
    }, { silent: true });

    menuFrom(one(rowOf(content, 'status', 'To do'), 'spellbook-tag-more')).item('Rename').click();
    answerPrompt('Planned');
    await calm(s);
    expect((s.vault.frontmatterOf(NOVEL_INDEX)?.['statuses'] as Array<{ name: string }>)[0]?.name).toBe('Planned');
    // It no longer uses the old name: it is left exactly as the other device wrote it.
    expect(s.vault.frontmatterOf(inNovel(OPENING))?.['status']).toBe('Done');
    expect(s.vault.frontmatterOf(inNovel(OPENING))?.['target']).toBe(2000);
    expect(s.vault.writesTo(inNovel(OPENING))).toEqual([]);
    expect(notices()).toEqual([]);
  });

  it('adds a label to the index note', async () => {
    const s = await stage();
    const content = manage(s);
    tap(one(one(content, 'spellbook-tags-label'), 'spellbook-tags-add'));
    answerPrompt('Night train');
    await calm(s);
    const labels = s.vault.frontmatterOf(NOVEL_INDEX)?.['labels'] as Array<{ name: string }>;
    expect(labels).toHaveLength(3);
    expect(labels.slice(0, 2)).toEqual(LABELS);
    expect(labels[2]?.name).toBe('Night train');
    expect(s.vault.frontmatterOf(NOVEL_INDEX)?.['statuses']).toEqual(STATUSES);
    expect(s.vault.writes).toEqual([{ op: 'updateFrontmatter', path: NOVEL_INDEX }]);
    expect(namesOf(content, 'label')).toEqual(['Anna', DANIEL, 'Night train']);
  });

  it('says in the window that asks why a list could not be saved', async () => {
    const s = await stage();
    const content = manage(s);
    s.vault.failNext('updateFrontmatter', NOVEL_INDEX);
    tap(one(one(content, 'spellbook-tags-label'), 'spellbook-tags-add'));
    const prompt = answerPrompt('Night train');
    await calm(s);
    expect(prompt.contentEl.withClass('spellbook-prompt-message')[0]?.text).toBe(
      'The project index could not be saved: The disk is not available',
    );
    expect(s.vault.frontmatterOf(NOVEL_INDEX)?.['labels']).toEqual(LABELS);
  });
});

describe('changes on disk, from this device or another', () => {
  it('follows a scene whose properties change', async () => {
    const s = await stage();
    s.workOn(inNovel(CLOSING));
    const board = await openCorkboard(s);
    const inspector = await openInspectorPane(s);
    s.vault.external.editFrontmatter(inNovel(CLOSING), (frontmatter) => {
      frontmatter['status'] = 'Done';
      frontmatter['synopsis'] = 'Everything ends.';
    });
    await calm(s);
    const card = cardOf(board.pane, 'Closing');
    expect(seen(card, 'spellbook-card-status')).toBe('Done');
    expect(seen(card, 'spellbook-card-synopsis')).toBe('Everything ends.');
    expect(fieldsOf(inspector.pane).status.value).toBe('Done');
    expect(fieldsOf(inspector.pane).synopsis.value).toBe('Everything ends.');
  });

  it('follows a scene whose text changes: its words, and the preview taken from it', async () => {
    const s = await stage();
    const { pane } = await openCorkboard(s);
    expect(seen(cardOf(pane, 'Closing'), 'spellbook-card-synopsis')).toBe('The end came quietly.');
    s.vault.external.write(inNovel(CLOSING), { body: 'Nobody saw the last train leave.\n' });
    await calm(s);
    // Not at once: a note that is being typed in is saved every few seconds.
    expect(seen(cardOf(pane, 'Closing'), 'spellbook-card-synopsis')).toBe('The end came quietly.');
    s.timers.advance(TEXT_SETTLE_MS);
    await calm(s);
    expect(seen(cardOf(pane, 'Closing'), 'spellbook-card-synopsis')).toBe('Nobody saw the last train leave.');
    expect(seen(cardOf(pane, 'Closing'), 'spellbook-card-words')).toBe('6 words');
  });

  it('follows the lists and the binder in the index note', async () => {
    const s = await stage();
    const { pane } = await openCorkboard(s);
    s.vault.external.create(inNovel('Manuscript/Epilogue.md'), { frontmatter: { status: 'Done' }, body: 'Years later.\n' });
    s.vault.external.editFrontmatter(NOVEL_INDEX, (frontmatter) => {
      frontmatter['statuses'] = [{ name: 'To do', color: 'blue' }, { name: 'Done', color: 'pink' }];
      (frontmatter['binder'] as unknown[]).push('Manuscript/Epilogue.md');
    });
    await calm(s);
    expect(titles(pane)).toEqual(['Opening', 'Part one', 'Ghost', 'Closing', 'Epilogue']);
    expect(colorOf(one(cardOf(pane, 'Opening'), 'spellbook-card-status'))).toBe('blue');
    expect(colorOf(one(cardOf(pane, 'Epilogue'), 'spellbook-card-status'))).toBe('pink');
    expect(seen(cardOf(pane, 'Epilogue'), 'spellbook-card-words')).toBe('2 words');

    // A note that was missing arrives.
    s.vault.external.create(inNovel('Manuscript/Ghost.md'), { frontmatter: { synopsis: 'Here after all.' }, body: 'Boo.\n' });
    await calm(s);
    expect(cardOf(pane, 'Ghost').hasClass('spellbook-is-missing')).toBe(false);
    expect(seen(cardOf(pane, 'Ghost'), 'spellbook-card-synopsis')).toBe('Here after all.');
    expect(s.vault.writesTo(NOVEL_INDEX)).toEqual([]);
  });

  it('asks for the words to be counted again when the binder, on closing, took its own request back', async () => {
    const s = await stage();
    const { pane } = await openCorkboard(s);
    expect(seen(cardOf(pane, 'Opening'), 'spellbook-card-words')).toBe('5 / 1,000 words');
    // What the binder does when it closes: nobody of its own is looking at word counts any more.
    s.wordCounts.track([]);
    s.vault.external.write(inNovel(CLOSING), { body: 'Five words are here now.\n' });
    await calm(s);
    expect(seen(cardOf(pane, 'Closing'), 'spellbook-card-words')).toBe('5 words');
    expect(seen(cardOf(pane, 'Opening'), 'spellbook-card-words')).toBe('5 / 1,000 words');
    expect(seen(cardOf(pane, 'Part one'), 'spellbook-card-words')).toBe('20 words');
  });
});

describe('another project', () => {
  it('switches everything the screens show, and nothing of the last project stays', async () => {
    const s = await stage();
    s.workOn(inNovel(OPENING));
    const board = await openCorkboard(s);
    const inspector = await openInspectorPane(s);
    tap(cardOf(board.pane, 'Part one'));
    await calm(s);
    expect(titles(board.pane)).toEqual(['The Letter', INNER_NAME]);

    await s.store.openProject(SECOND_INDEX);
    await calm(s);
    // The folder of the first project is not the second one's: the board is back at the top.
    expect(titles(board.pane)).toEqual(['Prologue', 'Opening']);
    // The same path inside the project, another note altogether.
    expect(seen(cardOf(board.pane, 'Opening'), 'spellbook-card-synopsis')).toBe('Another opening altogether.');
    expect(seen(cardOf(board.pane, 'Opening'), 'spellbook-card-status')).toBe('');
    expect(seen(cardOf(board.pane, 'Opening'), 'spellbook-card-words')).toBe('3 words');
    expect(colorOf(one(cardOf(board.pane, 'Prologue'), 'spellbook-card-status'))).toBe('blue');
    // The note in front belongs to the first project.
    expect(marked(board.pane)).toEqual([]);
    expect(seen(inspector.pane, 'spellbook-inspector-message')).toBe(NO_SCENE_TEXT);

    s.workOn('Second/Manuscript/Prologue.md');
    await calm(s);
    expect(one(inspector.pane, 'spellbook-inspector-title').text).toBe('Prologue');
    expect(optionsOf(fieldsOf(inspector.pane).status)).toEqual(['No status', 'Idea']);
    expect(optionsOf(fieldsOf(inspector.pane).label)).toEqual(['No label']);

    // A change is written to the project that is open now.
    choose(fieldsOf(inspector.pane).status, '');
    await calm(s);
    // (The engine keeps the property and empties it, so that the note keeps its shape.)
    expect(s.vault.frontmatterOf('Second/Manuscript/Prologue.md')).toEqual({ status: '', synopsis: 'Before it all began.' });
    expect(s.vault.writes).toEqual([{ op: 'updateFrontmatter', path: 'Second/Manuscript/Prologue.md' }]);

    await s.store.closeProject();
    await calm(s);
    expect(seen(board.pane, 'spellbook-board-message')).toBe(NO_PROJECT_TEXT);
    expect(seen(inspector.pane, 'spellbook-inspector-message')).toBe(INSPECTOR_NO_PROJECT_TEXT);
  });
});

describe('showing a binder folder on the corkboard', () => {
  it('is offered to the other screens under the name the binder asks for', async () => {
    const s = await stage();
    expect(SHOW_FOLDER_SERVICE).toBe('corkboard.showFolder');
    expect(SHOW_ON_CORKBOARD).toBe(SHOW_FOLDER_SERVICE);
    const show = s.features.services.get<ShowFolder>(SHOW_FOLDER_SERVICE);
    if (!show) throw new Error('the corkboard does not offer to show a folder');

    await show(NOVEL_INDEX, 'f-one');
    await calm(s);
    const leaves = leavesOf(s, CORKBOARD_VIEW_TYPE);
    expect(leaves).toHaveLength(1);
    expect(leaves[0]?.getRoot()).toBe(s.workspace.rootSplit);
    const pane = paneOf(leaves[0]);
    expect(titles(pane)).toEqual(['The Letter', INNER_NAME]);
    expect(crumbs(pane).map((crumb) => crumb.text)).toEqual(['Manuscript', 'Part one']);

    // A board that is open already is used again, wherever it was.
    await show(NOVEL_INDEX, 'f-inner');
    await calm(s);
    expect(leavesOf(s, CORKBOARD_VIEW_TYPE)).toEqual(leaves);
    expect(titles(pane)).toEqual(['מכתב לאחותי']);
    expect(s.room.layoutSaves).toBe(2); // Obsidian is told, so that the board comes back on this folder

    // A menu that was left open while another project was opened does nothing.
    await show(SECOND_INDEX, 'f-one');
    await calm(s);
    expect(notices()).toEqual([OTHER_PROJECT_TEXT]);
    expect(titles(pane)).toEqual(['מכתב לאחותי']);
  });
});

describe('the line at the top of the inspector', () => {
  /** A stand-in for what the writing progress screen offers. */
  class FakeLine implements SceneLine {
    segments: SceneLineSegment[] = [
      { label: 'Words', value: '1,204' },
      { label: 'Session', value: '+300' },
    ];
    readonly listeners = new Set<() => void>();
    current = (): readonly SceneLineSegment[] => this.segments;
    onChange = (listener: () => void): (() => void) => {
      this.listeners.add(listener);
      return () => {
        this.listeners.delete(listener);
      };
    };
    set(segments: SceneLineSegment[]): void {
      this.segments = segments;
      for (const listener of [...this.listeners]) listener();
    }
  }

  const shown = (pane: FakeElement): string[][] =>
    one(pane, SUMMARY_SLOT_CLASS)
      .withClass('spellbook-summary-item')
      .map((item) => [one(item, 'spellbook-summary-label').text, one(item, 'spellbook-summary-value').text]);

  it('is shown on a phone or tablet, from what the writing progress screen offers, and kept up to date', async () => {
    StubPlatform.isMobile = true;
    const s = await stage();
    const line = new FakeLine();
    expect(SCENE_LINE_SERVICE).toBe('progress.sceneLine');
    s.features.services.provide(SCENE_LINE_SERVICE, line);
    const { pane, leaf } = await openInspectorPane(s);
    expect(shown(pane)).toEqual([
      ['Words', '1,204'],
      ['Session', '+300'],
    ]);
    // Numbers and dates read left to right in every language.
    expect(one(pane, SUMMARY_SLOT_CLASS).withClass('spellbook-summary-item')[0]?.attrs['dir']).toBe('ltr');

    line.set([{ label: 'Words', value: '1,250' }]);
    expect(shown(pane)).toEqual([['Words', '1,250']]);

    // Closing the inspector stops it listening.
    leaf.detach();
    await calm(s);
    expect(line.listeners.size).toBe(0);
  });

  it('is not shown on a desktop, where Obsidian has a bottom bar for it', async () => {
    const s = await stage();
    const line = new FakeLine();
    s.features.services.provide(SCENE_LINE_SERVICE, line);
    const { pane } = await openInspectorPane(s);
    expect(one(pane, SUMMARY_SLOT_CLASS).children).toEqual([]);
    expect(line.listeners.size).toBe(0);
  });

  it('shows nothing when no line is offered, or something else is offered under its name', async () => {
    StubPlatform.isMobile = true;
    const s = await stage();
    const first = await openInspectorPane(s);
    expect(one(first.pane, SUMMARY_SLOT_CLASS).children).toEqual([]);
    first.leaf.detach();
    await calm(s);

    s.features.services.provide(SCENE_LINE_SERVICE, { current: 'not a function' });
    const second = await openInspectorPane(s);
    expect(one(second.pane, SUMMARY_SLOT_CLASS).children).toEqual([]);
    expect(s.timers.pending).toBe(0);
  });

  it('finds a line that is offered a moment after the inspector opened, as when Obsidian starts', async () => {
    StubPlatform.isMobile = true;
    const s = await stage();
    s.command('open-inspector').callback?.();
    await tick();
    const pane = paneOf(leavesOf(s, INSPECTOR_VIEW_TYPE)[0]);
    expect(one(pane, SUMMARY_SLOT_CLASS).children).toEqual([]);
    s.features.services.provide(SCENE_LINE_SERVICE, new FakeLine());
    await calm(s);
    expect(shown(pane)).toHaveLength(2);
  });
});

describe('letting go', () => {
  it('stops following the vault and the workspace when the last screen closes', async () => {
    const s = await stage();
    const board = await openCorkboard(s);
    const inspector = await openInspectorPane(s);
    expect(s.workspace.listenerCount()).toBe(1); // which note is being worked on
    expect(s.workspace.listenerCount('file-open')).toBe(1);

    board.leaf.detach();
    await calm(s);
    expect(s.workspace.listenerCount()).toBe(1); // the inspector still wants to know
    inspector.leaf.detach();
    await calm(s);
    expect(s.workspace.listenerCount()).toBe(0);

    // Nothing is read for a board that is not there.
    s.wordCounts.track([]);
    const reads = s.vault.reads.readText;
    s.vault.external.write(inNovel(CLOSING), { body: 'Changed while nobody looked.\n' });
    s.vault.external.editFrontmatter(NOVEL_INDEX, (frontmatter) => {
      frontmatter['statuses'] = [];
    });
    s.timers.advance(TEXT_SETTLE_MS);
    await calm(s);
    expect(s.vault.reads.readText).toBe(reads);

    // Opened again, the board shows the notes as they are now.
    const again = await openCorkboard(s);
    expect(seen(cardOf(again.pane, 'Closing'), 'spellbook-card-synopsis')).toBe('Changed while nobody looked.');
    expect(colorOf(one(cardOf(again.pane, 'Opening'), 'spellbook-card-status'))).toBeNull();
  });

  it('lets go of everything when the plugin is switched off', async () => {
    const s = await stage();
    s.workOn(inNovel(OPENING));
    const board = await openCorkboard(s);
    const inspector = await openInspectorPane(s);
    const show = s.features.services.get<ShowFolder>(SHOW_FOLDER_SERVICE);
    const host = (board.view as unknown as { host: StoreCardsHost }).host;
    expect(host).toBeInstanceOf(StoreCardsHost);
    expect(host.ready).toBe(true);

    s.switchOff();
    await tick();
    expect(host.ready).toBe(false);
    expect(host.project).toBeNull();
    // The panes keep their places for when the plugin comes back, emptied.
    expect(board.leaf.detached).toBe(false);
    expect(board.leaf.view).toBeNull();
    expect(inspector.leaf.view).toBeNull();
    expect(board.pane.children).toEqual([]);
    expect(inspector.pane.children).toEqual([]);
    expect(s.plugin.viewTypes).toEqual([]);
    expect(s.plugin.ribbonIcons.every((icon) => !icon.shown)).toBe(true);
    expect(s.workspace.listenerCount()).toBe(0);
    expect(s.features.services.get(SHOW_FOLDER_SERVICE)).toBeUndefined();

    // Nothing is followed, read or opened any more, and nothing is waiting to happen.
    const reads = s.vault.reads.readText;
    s.vault.external.write(inNovel(CLOSING), { body: 'After the plugin was switched off.\n' });
    s.timers.advance(10_000);
    s.command('open-corkboard').callback?.();
    await show?.(NOVEL_INDEX, 'f-one');
    await tick();
    expect(s.vault.reads.readText).toBe(reads);
    expect(s.workspace.leaves).toEqual([board.leaf, inspector.leaf]);
    expect(s.timers.pending).toBe(0);
    expect(s.vault.writes).toEqual([]);
    // A change that a window left open still asks for is refused in plain words.
    expect(await host.applyScenePatch(OPENING, { set: { status: 'Done' }, remove: [] })).toBe(
      'Spellbook has been switched off. Nothing was changed.',
    );
    expect(s.vault.writes).toEqual([]);
  });
});
