// Editing the binder from the panel: the toolbar, the "more" button and menu
// of every row, the small windows that ask for a name, and what each action
// does to the project. Driven through the stand-ins (tests/binderStage.ts);
// these tests check what the panel does, not how it looks.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { folderRef, sceneRef } from '../src/core/binderTree';
import { ORDER_DEBOUNCE_MS, RENAME_SETTLE_MS } from '../src/core/projectStore';
import { SNAPSHOT_ACTIONS } from '../src/views/binderActions';
import type { SnapshotActions } from '../src/views/binderActions';
import { MISSING_LABEL, MORE_LABEL } from '../src/views/binderView';
import {
  last,
  moreOf,
  one,
  partOf,
  picture,
  press,
  rightClick,
  rowOf,
  scroller,
  selectedTitle,
  tap,
  toolbarButton,
  toolbarLabels,
} from './binderScreen';
import {
  HEBREW,
  INDEX,
  LETTER,
  OPENING,
  clearScreen,
  fileAt,
  lastMenu,
  menuOf,
  notices,
  novel,
  openWindows,
  picker,
  prompt,
  question,
  rest,
  stage,
  toolbarMenu,
} from './binderStage';
import type { Stage } from './binderStage';
import { MemoryVault } from './memoryVault';
import { Menu as StubMenu, Platform as StubPlatform, resetPlatform } from './obsidianStub';
import type { FakeElement } from './obsidianStub';
import { TODAY, binderOnDisk, foldedIn, seedProject } from './storeHarness';

beforeEach(() => {
  clearScreen();
});

afterEach(() => {
  resetPlatform();
  vi.restoreAllMocks();
});

/** The Manuscript section as a reader sees it, without the section's own line. */
function manuscript(pane: FakeElement): string[] {
  const lines = picture(pane);
  const end = lines.findIndex((line, index) => index > 0 && !line.startsWith(' '));
  return lines.slice(1, end < 0 ? undefined : end).map((line) => line.slice(2));
}

/** Pick an item of a row's menu, then let everything come to rest. */
async function choose(s: Stage, row: string, item: string): Promise<void> {
  menuOf(s.pane, row).item(item).click();
  await rest(s);
}

const HEBREW_REL = 'Manuscript/מכתב לאחותי.md';

// ------------------------------------------------------------------ toolbar

describe('the toolbar', () => {
  it('offers New scene, New folder and a menu, as buttons that say what they are', async () => {
    const s = await stage(novel());
    expect(toolbarLabels(s.pane)).toEqual(['New scene', 'New folder', 'More options']);
    for (const button of one(s.pane, 'spellbook-binder-toolbar').children) {
      expect(button.attrs['role']).toBe('button');
      expect(button.attrs['tabindex']).toBe(0); // reachable with the Tab key
      expect(button.icon).not.toBeNull();
      expect(button.hasClass('clickable-icon')).toBe(true); // Obsidian's own look for icon buttons
      expect(button.hasClass('spellbook-toolbar-button')).toBe(true);
    }
    expect(toolbarButton(s.pane, 'More options').attrs['aria-haspopup']).toBe('menu');
    expect(MORE_LABEL).toBe('More options');
    expect(s.vault.writes).toEqual([]);
  });

  it('has only the menu when there is no project to add to', async () => {
    const empty = await stage(new MemoryVault().seed('Notes/Plain.md'));
    expect(toolbarLabels(empty.pane)).toEqual(['More options']);

    const vault = new MemoryVault();
    seedProject(vault, { binder: { not: 'a list' }, scenes: { A: 1024 } });
    const readOnly = await stage(vault);
    expect(toolbarLabels(readOnly.pane)).toEqual(['More options']); // nothing may be added to a read-only project
  });

  it('is empty while Spellbook is still starting', async () => {
    const s = await stage(novel(), { started: false });
    expect(toolbarLabels(s.pane)).toEqual([]);
    s.host.start(s.services);
    await rest(s);
    expect(toolbarLabels(s.pane)).toEqual(['New scene', 'New folder', 'More options']);
  });

  it('can be worked with the keyboard: Enter and Space press a button, other keys do not', async () => {
    const s = await stage(novel());
    const button = toolbarButton(s.pane, 'New scene');
    press(button, 'a');
    press(button, 'Tab');
    expect(openWindows()).toBe(0);

    let prevented = 0;
    press(button, 'Enter', { preventDefault: () => prevented++ });
    expect(openWindows()).toBe(1);
    expect(prevented).toBe(1);
    prompt(s).cancel.click();

    press(button, ' ', { preventDefault: () => prevented++ }); // Space must not scroll the list
    expect(openWindows()).toBe(1);
    expect(prevented).toBe(2);
  });
});

describe('the toolbar\'s menu', () => {
  it('offers folding and the two ways to make a project', async () => {
    const s = await stage(novel());
    const button = toolbarButton(s.pane, 'More options');
    button.rect = { top: 8, bottom: 36, left: 260, right: 288, width: 28, height: 28 };
    const menu = toolbarMenu(s.pane);
    expect(menu.outline).toEqual(['Collapse all', 'Expand all', '---', 'Create project', 'Create sample project']);
    expect(menu.position).toEqual({ x: 260, y: 36, width: 28 }); // under the button
    expect(menu.items.every((item) => item.icon !== null)).toBe(true);
  });

  it('offers only the two ways to make a project when none is open', async () => {
    const s = await stage(new MemoryVault().seed('Notes/Plain.md'));
    expect(toolbarMenu(s.pane).outline).toEqual(['Create project', 'Create sample project']);
  });

  it('opens the window for a new project, and asks for the sample project', async () => {
    const s = await stage(novel());
    toolbarMenu(s.pane).item('Create project').click();
    expect(s.host.asked).toBe(1);
    toolbarMenu(s.pane).item('Create sample project').click();
    expect(s.host.samples).toBe(1);
    expect(s.vault.writes).toEqual([]); // the panel itself creates nothing
  });

  it('folds every folder shut with "Collapse all", leaving the three sections open', async () => {
    const s = await stage(novel());
    toolbarMenu(s.pane).item('Collapse all').click();
    expect(picture(s.pane)).toEqual([
      'v Manuscript 11',
      '  Opening 3',
      '  > Part one 8',
      `  ! Ghost -- ${MISSING_LABEL}`,
      'v Unfiled',
      '  Loose 2',
      'v Research',
      '  > Maps',
      '  Trains',
    ]);
    // Remembered on this device, in one save; nothing goes into the vault.
    expect(foldedIn(s.storage)).toEqual({ [INDEX]: ['folder:f-one', 'folder:f-inner', 'research:Research/Maps'] });
    expect(s.storage.saves).toHaveLength(1);
    expect(s.vault.writes).toEqual([]);
    // The folder inside the folded folder was folded too.
    tap(rowOf(s.pane, 'Part one'));
    expect(manuscript(s.pane)).toEqual(['Opening 3', 'v Part one 8', '  The Letter 4', '  > חלק פנימי 4', `! Ghost -- ${MISSING_LABEL}`]);
  });

  it('opens everything with "Expand all", sections included', async () => {
    const s = await stage(novel());
    tap(rowOf(s.pane, 'Unfiled'));
    toolbarMenu(s.pane).item('Collapse all').click();
    expect(picture(s.pane)).toContain('> Unfiled'); // a folded section stays as the writer left it
    expect(foldedIn(s.storage)?.[INDEX]).toContain('section:unfiled');

    toolbarMenu(s.pane).item('Expand all').click();
    expect(picture(s.pane).some((line) => line.trimStart().startsWith('>'))).toBe(false);
    expect(picture(s.pane)).toContain('      מכתב לאחותי 4');
    expect(foldedIn(s.storage)).toBeNull();
  });

  it('keeps the place in the list and the word counts when folding', async () => {
    const s = await stage(novel());
    const reads = s.vault.reads.readText;
    scroller(s.pane).scrollTop = 40;
    toolbarMenu(s.pane).item('Collapse all').click();
    await rest(s);
    expect(scroller(s.pane).scrollTop).toBe(40);
    expect(picture(s.pane)[0]).toBe('v Manuscript 11');
    expect(s.vault.reads.readText).toBe(reads);
  });
});

// ---------------------------------------------------------------- new scene

describe('New scene, from the toolbar', () => {
  it('asks for a name in a small window', async () => {
    const s = await stage(novel());
    tap(toolbarButton(s.pane, 'New scene'));
    const window = prompt(s);
    expect(window.title).toBe('New scene');
    expect(window.input.value).toBe('');
    expect(window.input.attrs['dir']).toBe('auto');
    expect(window.input.focused).toBe(true);
    expect(window.confirm.buttonEl.text).toBe('Create');
    expect(s.vault.writes).toEqual([]); // nothing yet
  });

  it('creates the scene at the end of the binder when no row is selected, and opens it for writing', async () => {
    const s = await stage(novel());
    tap(toolbarButton(s.pane, 'New scene'));
    await prompt(s).answer('Night Train');

    expect(openWindows()).toBe(0);
    expect(manuscript(s.pane)).toEqual([
      'Opening 3',
      'v Part one 8',
      '  The Letter 4',
      '  v חלק פנימי 4',
      '    מכתב לאחותי 4',
      `! Ghost -- ${MISSING_LABEL}`,
      'Night Train 0 *',
    ]);
    // The note, with the agreed properties and no text.
    expect(s.vault.frontmatterOf('Novel/Manuscript/Night Train.md')).toEqual({
      synopsis: '',
      status: 'To do',
      label: '',
      compile: true,
      order: 4096,
      created: TODAY,
    });
    expect(s.vault.bodyOf('Novel/Manuscript/Night Train.md')).toBe('');
    // Two writes: the note, and one write of the index.
    expect(s.vault.writes).toEqual([
      { op: 'createFile', path: 'Novel/Manuscript/Night Train.md' },
      { op: 'updateFrontmatter', path: INDEX },
    ]);
    // Opened in the tab the writer was working in.
    expect(s.host.opened).toEqual([{ path: 'Novel/Manuscript/Night Train.md', where: false }]);
    expect(selectedTitle(s.pane)).toBe('Night Train');
    expect(notices()).toEqual([]);
  });

  it('puts the scene below the selected scene', async () => {
    const s = await stage(novel());
    tap(rowOf(s.pane, 'The Letter'));
    await rest(s);
    tap(toolbarButton(s.pane, 'New scene'));
    await prompt(s).answer('The Reply');
    expect(manuscript(s.pane).slice(1, 5)).toEqual(['v Part one 8', '  The Letter 4', '  The Reply 0 *', '  v חלק פנימי 4']);
    expect(s.vault.frontmatterOf('Novel/Manuscript/The Reply.md')?.['order']).toBe(2560); // between its neighbours
  });

  it('puts the scene inside the selected folder, and unfolds the folder to show it', async () => {
    const s = await stage(novel());
    tap(rowOf(s.pane, 'Part one')); // selects the folder (and folds it shut)
    expect(selectedTitle(s.pane)).toBe('Part one');
    tap(toolbarButton(s.pane, 'New scene'));
    await prompt(s).answer('Last of part one');
    expect(manuscript(s.pane)).toEqual([
      'Opening 3',
      'v Part one 8',
      '  The Letter 4',
      '  v חלק פנימי 4',
      '    מכתב לאחותי 4',
      '  Last of part one 0 *',
      `! Ghost -- ${MISSING_LABEL}`,
    ]);
    expect(foldedIn(s.storage)).toBeNull(); // the folder was unfolded
  });

  it('puts the scene below the note being worked on when no row was tapped', async () => {
    const s = await stage(novel(), { active: HEBREW });
    tap(toolbarButton(s.pane, 'New scene'));
    await prompt(s).answer('אחרי המכתב');
    expect(manuscript(s.pane).slice(3, 6)).toEqual(['  v חלק פנימי 4', '    מכתב לאחותי 4', '    אחרי המכתב 0 *']);
  });

  it('goes to the end of the binder when the selected row is not in the binder', async () => {
    const s = await stage(novel());
    tap(rowOf(s.pane, 'Trains')); // a research note
    await rest(s);
    tap(toolbarButton(s.pane, 'New scene'));
    await prompt(s).answer('Night Train');
    expect(last(manuscript(s.pane))).toBe('Night Train 0 *');
  });

  it('keeps a Hebrew name as it was typed', async () => {
    const s = await stage(novel());
    tap(toolbarButton(s.pane, 'New scene'));
    await prompt(s).answer('רכבת לילה');
    expect(s.vault.has('Novel/Manuscript/רכבת לילה.md')).toBe(true);
    expect(last(manuscript(s.pane))).toBe('רכבת לילה 0 *');
    expect(partOf(rowOf(s.pane, 'רכבת לילה'), 'spellbook-title')?.attrs['dir']).toBe('auto');
    expect(notices()).toEqual([]);
  });

  it('turns down an empty name in the window itself, and creates nothing', async () => {
    const s = await stage(novel());
    tap(toolbarButton(s.pane, 'New scene'));
    const window = prompt(s);
    await window.answer('   ');
    expect(window.modal.isOpen).toBe(true);
    expect(window.message()).toBe('Give the scene a name.');
    expect(s.vault.writes).toEqual([]);
    expect(notices()).toEqual([]);

    // The same window takes the next try.
    await window.answer('The Reply');
    expect(window.modal.isOpen).toBe(false);
    expect(s.vault.has('Novel/Manuscript/The Reply.md')).toBe(true);
  });

  it('turns down a name of which nothing can be used', async () => {
    const s = await stage(novel());
    tap(toolbarButton(s.pane, 'New scene'));
    const window = prompt(s);
    await window.answer('???');
    expect(window.modal.isOpen).toBe(true);
    expect(window.message()).toMatch(/no characters that can be used in a file name/);
    expect(s.vault.writes).toEqual([]);
  });

  it('takes out what a file name cannot hold, and says what the scene was named', async () => {
    const s = await stage(novel());
    tap(toolbarButton(s.pane, 'New scene'));
    await prompt(s).answer('Chapter 1: "Fire"?');
    expect(s.vault.has('Novel/Manuscript/Chapter 1 Fire.md')).toBe(true);
    expect(notices()).toEqual(['The scene was named "Chapter 1 Fire".']);
  });

  it('adds a number when the name is taken, and says so', async () => {
    const s = await stage(novel());
    tap(toolbarButton(s.pane, 'New scene'));
    await prompt(s).answer('opening'); // "Opening" exists; capitals do not make it another file
    expect(s.vault.has('Novel/Manuscript/opening 2.md')).toBe(true);
    expect(notices()).toEqual(['The scene was named "opening 2".']);
    expect(s.vault.bodyOf(OPENING)).toBe('One two three.'); // the scene that was there is untouched
  });

  it('creates nothing when the window is cancelled', async () => {
    const s = await stage(novel());
    tap(toolbarButton(s.pane, 'New scene'));
    const window = prompt(s);
    window.type('Night Train');
    window.cancel.click();
    await rest(s);
    expect(s.vault.writes).toEqual([]);
    expect(s.host.opened).toEqual([]);
  });

  it('says so, and closes, when the scene cannot be created', async () => {
    const s = await stage(novel());
    s.vault.failNext('createFile');
    tap(toolbarButton(s.pane, 'New scene'));
    await prompt(s).answer('Night Train');
    expect(openWindows()).toBe(0);
    expect(notices()).toEqual(['The disk is not available']);
    expect(s.host.opened).toEqual([]);
  });

  it('says so when the new scene cannot be opened, but keeps it', async () => {
    const s = await stage(novel());
    s.host.canOpen = false;
    tap(toolbarButton(s.pane, 'New scene'));
    await prompt(s).answer('Night Train');
    expect(last(manuscript(s.pane))).toBe('Night Train 0');
    expect(notices()).toEqual(['"Night Train" could not be opened.']);
    expect(selectedTitle(s.pane)).toBe('Night Train');
  });
});

describe('New folder, from the toolbar', () => {
  it('asks for a name and adds the folder at the end of the binder when no row is selected', async () => {
    const s = await stage(novel());
    tap(toolbarButton(s.pane, 'New folder'));
    const window = prompt(s);
    expect(window.title).toBe('New folder');
    await window.answer('Part two');
    expect(manuscript(s.pane).slice(-2)).toEqual([`! Ghost -- ${MISSING_LABEL}`, 'v Part two 0']);
    expect(selectedTitle(s.pane)).toBe('Part two');
    // A binder folder is an entry in the index, not a folder on disk.
    expect(s.vault.writes).toEqual([{ op: 'updateFrontmatter', path: INDEX }]);
    expect(s.vault.hasFolder('Novel/Manuscript/Part two')).toBe(false);
    const binder = binderOnDisk(s.vault, INDEX) as unknown[];
    expect(last(binder)).toMatchObject({ folder: 'Part two', children: [] });
    expect((last(binder) as { id: string }).id).toMatch(/^f-[a-z0-9]{6}$/);
    expect(s.host.opened).toEqual([]); // there is no note to open
  });

  it('puts the folder straight below the selected row, at the same level', async () => {
    const s = await stage(novel());
    tap(rowOf(s.pane, 'Part one')); // a folder: the new one goes after it, not inside it
    tap(toolbarButton(s.pane, 'New folder'));
    await prompt(s).answer('חלק שני');
    expect(manuscript(s.pane).slice(1)).toEqual(['> Part one 8', 'v חלק שני 0', `! Ghost -- ${MISSING_LABEL}`]);

    tap(rowOf(s.pane, 'Part one')); // unfold it again
    tap(rowOf(s.pane, 'The Letter'));
    await rest(s);
    tap(toolbarButton(s.pane, 'New folder'));
    await prompt(s).answer('Letters');
    expect(manuscript(s.pane).slice(1, 4)).toEqual(['v Part one 8', '  The Letter 4 *', '  v Letters 0']);
  });

  it('accepts any text as a name, and turns down an empty one in the window', async () => {
    const s = await stage(novel());
    tap(toolbarButton(s.pane, 'New folder'));
    const window = prompt(s);
    await window.answer('  ');
    expect(window.message()).toBe('Give the folder a name.');
    expect(s.vault.writes).toEqual([]);
    await window.answer('Act 1: "Fire"?');
    expect(window.modal.isOpen).toBe(false);
    expect(last(manuscript(s.pane))).toBe('v Act 1: "Fire"? 0');
    expect(notices()).toEqual([]);
  });
});

// ---------------------------------------------------------------- row menus

describe('the "more" button of a row', () => {
  it('is on every scene, folder, missing entry, unfiled note and research note', async () => {
    const s = await stage(novel());
    for (const title of ['Opening', 'Part one', 'The Letter', 'חלק פנימי', 'מכתב לאחותי', 'Ghost', 'Loose', 'Trains', 'City']) {
      const button = moreOf(s.pane, title);
      expect(button, title).toBeDefined();
      expect(button?.attrs['aria-label'], title).toBe('More options');
      expect(button?.attrs['role'], title).toBe('button');
      // Reached with the Tab key from its own row, once the keyboard is on
      // that row (tests/binderKeys.test.ts): a long binder is one Tab stop.
      expect(button?.attrs['tabindex'], title).toBe(-1);
      expect(button?.attrs['aria-haspopup'], title).toBe('menu');
      expect(button?.icon, title).toBe('ellipsis');
      expect(button?.hasClass('clickable-icon'), title).toBe(true);
    }
  });

  it('is not on the three sections or on the folders of Research, which have nothing to offer', async () => {
    const s = await stage(novel());
    for (const title of ['Manuscript', 'Unfiled', 'Research', 'Maps']) expect(moreOf(s.pane, title), title).toBeUndefined();
    // The Manuscript row leaves the button's room empty, so that its count lines up with the counts below it.
    expect(last(rowOf(s.pane, 'Manuscript').children)?.hasClass('spellbook-row-more-space')).toBe(true);
    for (const title of ['Unfiled', 'Research', 'Maps', 'Opening', 'Part one']) {
      expect(partOf(rowOf(s.pane, title), 'spellbook-row-more-space'), title).toBeUndefined();
    }
  });

  it('comes last in its row, after the title and the count, and takes no direction from the title', async () => {
    const s = await stage(novel());
    const row = rowOf(s.pane, 'מכתב לאחותי');
    expect(last(row.children)).toBe(moreOf(s.pane, 'מכתב לאחותי'));
    expect(row.children.map((child) => [...child.classes].find((cls) => cls.startsWith('spellbook-row-')))).toEqual([
      'spellbook-row-slot',
      'spellbook-row-main',
      'spellbook-row-more',
    ]);
    expect(moreOf(s.pane, 'מכתב לאחותי')?.attrs['dir']).toBeUndefined();
  });

  it('opens the row\'s menu under the button, and selects the row', async () => {
    const s = await stage(novel());
    const button = moreOf(s.pane, 'The Letter') as FakeElement;
    button.rect = { top: 90, bottom: 114, left: 250, right: 274, width: 24, height: 24 };
    tap(button);
    expect(StubMenu.shown).toHaveLength(1);
    expect(lastMenu().position).toEqual({ x: 250, y: 114, width: 24 });
    expect(selectedTitle(s.pane)).toBe('The Letter');
  });

  it('does not open the note or fold the folder it sits on', async () => {
    const s = await stage(novel());
    let stopped = 0;
    tap(moreOf(s.pane, 'Opening') as FakeElement, { stopPropagation: () => stopped++ });
    tap(moreOf(s.pane, 'Part one') as FakeElement, { stopPropagation: () => stopped++ });
    await rest(s);
    expect(stopped).toBe(2); // the tap stays with the button
    expect(s.host.opened).toEqual([]);
    expect(picture(s.pane)).toContain('  v Part one 8');
  });

  it('opens the menu from the keyboard, with Enter or Space', async () => {
    const s = await stage(novel());
    const button = moreOf(s.pane, 'Opening') as FakeElement;
    press(button, 'Enter');
    press(button, ' ');
    press(button, 'x');
    expect(StubMenu.shown).toHaveLength(2);
  });

  it('is there on a phone too', async () => {
    StubPlatform.isMobile = true;
    StubPlatform.isPhone = true;
    const s = await stage(novel());
    expect(one(s.pane, 'spellbook-binder').hasClass('spellbook-is-mobile')).toBe(true); // the stylesheet keeps the buttons in view there
    expect(moreOf(s.pane, 'Opening')).toBeDefined();
    expect(menuOf(s.pane, 'Opening').items.length).toBeGreaterThan(0);
  });
});

describe('a right-click on a row', () => {
  it('opens the same menu at the pointer, in place of the browser\'s own', async () => {
    const s = await stage(novel());
    const fromButton = menuOf(s.pane, 'The Letter').outline;
    let prevented = 0;
    const event = { button: 2, clientX: 120, clientY: 300, preventDefault: () => prevented++, stopPropagation: () => {} };
    rowOf(s.pane, 'The Letter').dispatch('contextmenu', event);
    expect(prevented).toBe(1);
    expect(lastMenu().outline).toEqual(fromButton);
    expect(lastMenu().mouseEvent).toBe(event);
    expect(lastMenu().position).toBeNull();
  });

  it('works on folders, missing entries, unfiled notes and research notes', async () => {
    const s = await stage(novel());
    for (const title of ['Part one', 'Ghost', 'Loose', 'Trains']) {
      rightClick(rowOf(s.pane, title));
      expect(lastMenu().outline, title).toEqual(menuOf(s.pane, title).outline);
      expect(selectedTitle(s.pane), title).toBe(title);
    }
    expect(s.host.opened).toEqual([]);
  });

  it('does nothing on a section', async () => {
    const s = await stage(novel());
    rightClick(rowOf(s.pane, 'Manuscript'));
    expect(StubMenu.shown).toEqual([]);
  });
});

describe('the menus', () => {
  it('of a scene', async () => {
    const s = await stage(novel());
    const menu = menuOf(s.pane, 'The Letter');
    expect(menu.outline).toEqual([
      'Open in new tab',
      'New scene below',
      '---',
      'Rename',
      'Move up',
      'Move down',
      'Move to folder',
      '---',
      'Delete scene',
    ]);
    expect(menu.item('Delete scene').warning).toBe(true);
    expect(menu.items.filter((item) => item.warning).map((item) => item.title)).toEqual(['Delete scene']);
    expect(menu.items.every((item) => item.icon !== null)).toBe(true);
  });

  it('of a scene, when the snapshots are there: "Take snapshot" and "Snapshots", for that scene', async () => {
    const s = await stage(novel());
    const asked: string[] = [];
    const offered = new Map<string, unknown>();
    s.host.features = { services: { get: <T>(name: string) => offered.get(name) as T | undefined } };
    const snapshots: SnapshotActions = {
      take: (path) => asked.push(`take ${path}`),
      show: (path) => asked.push(`show ${path}`),
    };

    // Nobody offers them yet: the menu is as it was.
    expect(menuOf(s.pane, 'The Letter').outline).not.toContain('Take snapshot');
    expect(menuOf(s.pane, 'The Letter').outline).not.toContain('Snapshots');

    // They are asked for when the menu opens, so one that arrives later is found.
    offered.set(SNAPSHOT_ACTIONS, snapshots);
    const menu = menuOf(s.pane, 'The Letter');
    expect(menu.outline).toEqual([
      'Open in new tab',
      'New scene below',
      '---',
      'Rename',
      'Move up',
      'Move down',
      'Move to folder',
      '---',
      'Take snapshot',
      'Snapshots',
      '---',
      'Delete scene',
    ]);
    expect(menu.item('Take snapshot').icon).toBe('camera');
    expect(menu.item('Snapshots').icon).toBe('history');
    expect(menu.items.filter((item) => item.warning).map((item) => item.title)).toEqual(['Delete scene']);
    expect(asked).toEqual([]); // nothing until one is chosen

    menu.item('Take snapshot').click();
    menu.item('Snapshots').click();
    menuOf(s.pane, 'מכתב לאחותי').item('Take snapshot').click();
    expect(asked).toEqual(['take Manuscript/The Letter.md', 'show Manuscript/The Letter.md', `take ${HEBREW_REL}`]);
    // Choosing one changes nothing in the vault by itself.
    await rest(s);
    expect(s.vault.writes).toEqual([]);

    // Only a scene with a note has them: not a folder, a missing entry, an unfiled note or a research note.
    for (const row of ['Part one', 'Ghost', 'Loose', 'Trains']) {
      expect(menuOf(s.pane, row).outline, row).not.toContain('Take snapshot');
      expect(menuOf(s.pane, row).outline, row).not.toContain('Snapshots');
    }

    // And they go again with the snapshots.
    offered.delete(SNAPSHOT_ACTIONS);
    expect(menuOf(s.pane, 'The Letter').outline).not.toContain('Take snapshot');
  });

  it('of a folder', async () => {
    const s = await stage(novel());
    expect(menuOf(s.pane, 'Part one').outline).toEqual([
      'New scene inside',
      'New folder inside',
      '---',
      'Rename',
      'Move up',
      'Move down',
      'Move to folder',
      '---',
      'Remove folder (keeps scenes)',
    ]);
  });

  it('of a missing entry, an unfiled note and a research note', async () => {
    const s = await stage(novel());
    expect(menuOf(s.pane, 'Ghost').outline).toEqual(['Remove from binder']);
    expect(menuOf(s.pane, 'Loose').outline).toEqual(['Add to manuscript', 'Open', 'Open in new tab']);
    expect(menuOf(s.pane, 'Trains').outline).toEqual(['Open', 'Open in new tab']);
  });

  it('switch off Move up for the first entry of the top level, and Move down for the last', async () => {
    const vault = new MemoryVault();
    seedProject(vault, { binder: ['Manuscript/A.md', { folder: 'Part', id: 'f-part', children: ['Manuscript/B.md'] }], scenes: { A: 1024, B: 2048 } });
    const s = await stage(vault);
    expect(menuOf(s.pane, 'A').outline.slice(3, 6)).toEqual(['Rename', 'Move up (off)', 'Move down']);
    expect(menuOf(s.pane, 'Part').outline.slice(3, 6)).toEqual(['Rename', 'Move up', 'Move down (off)']);
    // The only scene of a folder can still go both ways: out of the folder.
    expect(menuOf(s.pane, 'B').outline.slice(3, 6)).toEqual(['Rename', 'Move up', 'Move down']);
    // Picking an item that is switched off does nothing.
    menuOf(s.pane, 'A').item('Move up').click();
    await rest(s);
    expect(s.vault.writes).toEqual([]);
  });

  it('do not offer to file a note while the project is read-only', async () => {
    const vault = new MemoryVault();
    seedProject(vault, { binder: { not: 'a list' }, scenes: { A: 1024 } });
    const s = await stage(vault);
    expect(menuOf(s.pane, 'A').outline).toEqual(['Open', 'Open in new tab']);
  });

  it('are made for the project as it is when they are opened', async () => {
    const s = await stage(novel());
    expect(menuOf(s.pane, 'Opening').item('Move up').disabled).toBe(true);
    await s.store.moveNode(sceneRef('Manuscript/Opening.md'), { at: 'end', parentId: null });
    await rest(s);
    expect(menuOf(s.pane, 'Opening').item('Move up').disabled).toBe(false);
    expect(menuOf(s.pane, 'Opening').item('Move down').disabled).toBe(true);
  });
});

// ------------------------------------------------------------ scene actions

describe('a scene\'s menu', () => {
  it('opens the scene in a new tab', async () => {
    const s = await stage(novel());
    await choose(s, 'The Letter', 'Open in new tab');
    expect(s.host.opened).toEqual([{ path: LETTER, where: 'tab' }]);
    expect(s.vault.writes).toEqual([]);
  });

  it('adds a new scene straight below, and opens it', async () => {
    const s = await stage(novel());
    menuOf(s.pane, 'Opening').item('New scene below').click();
    await prompt(s).answer('Second');
    expect(manuscript(s.pane).slice(0, 3)).toEqual(['Opening 3', 'Second 0 *', 'v Part one 8']);
    expect(s.vault.frontmatterOf('Novel/Manuscript/Second.md')?.['order']).toBe(1536);
    expect(s.host.opened).toEqual([{ path: 'Novel/Manuscript/Second.md', where: false }]);
    expect(selectedTitle(s.pane)).toBe('Second');
  });

  it('renames the scene: the note is renamed and the binder follows', async () => {
    const s = await stage(novel());
    menuOf(s.pane, 'Opening').item('Rename').click();
    const window = prompt(s);
    expect(window.title).toBe('Rename scene');
    expect(window.input.value).toBe('Opening');
    expect(window.input.selected).toBe(true);
    expect(window.confirm.buttonEl.text).toBe('Rename');

    await window.answer('Prologue');
    expect(window.modal.isOpen).toBe(false);
    expect(manuscript(s.pane)[0]).toBe('Prologue 3');
    expect(selectedTitle(s.pane)).toBe('Prologue');
    expect(s.vault.has(OPENING)).toBe(false);
    expect(s.vault.bodyOf('Novel/Manuscript/Prologue.md')).toBe('One two three.'); // the text is the same text
    expect(s.vault.writes).toEqual([
      { op: 'moveFile', path: OPENING, to: 'Novel/Manuscript/Prologue.md' },
      { op: 'updateFrontmatter', path: INDEX },
    ]);
    expect((binderOnDisk(s.vault, INDEX) as unknown[])[0]).toBe('Manuscript/Prologue.md');
    expect(notices()).toEqual([]);
  });

  it('renames to a Hebrew name, and from one', async () => {
    const s = await stage(novel());
    menuOf(s.pane, 'מכתב לאחותי').item('Rename').click();
    expect(prompt(s).input.value).toBe('מכתב לאחותי');
    await prompt(s).answer('מכתב שני');
    expect(manuscript(s.pane)).toContain('    מכתב שני 4');
    expect(s.vault.has('Novel/Manuscript/מכתב שני.md')).toBe(true);
  });

  it('changes nothing when the name is confirmed as it was', async () => {
    const s = await stage(novel());
    menuOf(s.pane, 'Opening').item('Rename').click();
    const window = prompt(s);
    window.enter();
    await rest(s);
    expect(window.modal.isOpen).toBe(false);
    expect(s.vault.writes).toEqual([]);
    expect(notices()).toEqual([]);
  });

  it('turns down an empty new name in the window, and keeps the old one', async () => {
    const s = await stage(novel());
    menuOf(s.pane, 'Opening').item('Rename').click();
    const window = prompt(s);
    await window.answer('');
    expect(window.modal.isOpen).toBe(true);
    expect(window.message()).toBe('Give the scene a name.');
    expect(s.vault.writes).toEqual([]);
    expect(manuscript(s.pane)[0]).toBe('Opening 3');
  });

  it('adds a number when the new name is taken, and says what the scene was named', async () => {
    const s = await stage(novel());
    menuOf(s.pane, 'Opening').item('Rename').click();
    await prompt(s).answer('The Letter');
    expect(manuscript(s.pane)[0]).toBe('The Letter 2 3');
    expect(notices()).toEqual(['The scene was named "The Letter 2".']);
    expect(s.vault.bodyOf(LETTER)).toBe('Dear sister, I write.'); // the other scene is untouched
  });

  it('moves the scene up and down among its siblings', async () => {
    const vault = new MemoryVault();
    seedProject(vault, { scenes: { A: 1024, B: 2048, C: 3072 } });
    const s = await stage(vault);
    await choose(s, 'C', 'Move up');
    expect(manuscript(s.pane).map((line) => line.split(' ')[0])).toEqual(['A', 'C', 'B']);
    expect(selectedTitle(s.pane)).toBe('C');
    await choose(s, 'C', 'Move up');
    expect(manuscript(s.pane).map((line) => line.split(' ')[0])).toEqual(['C', 'A', 'B']);
    await choose(s, 'C', 'Move down');
    await choose(s, 'C', 'Move down');
    expect(manuscript(s.pane).map((line) => line.split(' ')[0])).toEqual(['A', 'B', 'C']);
    expect(selectedTitle(s.pane)).toBe('C');
    // Only the index was written so far; no note was moved or changed.
    expect(s.vault.writes.every((write) => write.op === 'updateFrontmatter' && write.path === INDEX)).toBe(true);
    expect(s.vault.writes).toHaveLength(4);
  });

  it('moves the scene out of its folder at the folder\'s edge: up to before it, down to after it', async () => {
    const s = await stage(novel());
    await choose(s, 'The Letter', 'Move up');
    expect(manuscript(s.pane).slice(0, 3)).toEqual(['Opening 3', 'The Letter 4', 'v Part one 4']);
    expect(selectedTitle(s.pane)).toBe('The Letter');

    await choose(s, 'מכתב לאחותי', 'Move down'); // out of the inner folder, still inside the outer one
    expect(manuscript(s.pane).slice(2, 5)).toEqual(['v Part one 4', '  v חלק פנימי 0', '  מכתב לאחותי 4']);
    await choose(s, 'מכתב לאחותי', 'Move down'); // and out of the outer one
    expect(manuscript(s.pane).slice(2)).toEqual(['v Part one 0', '  v חלק פנימי 0', 'מכתב לאחותי 4', `! Ghost -- ${MISSING_LABEL}`]);
    // No file moved on disk: binder folders are not folders in the vault.
    expect(s.vault.writes.every((write) => write.op === 'updateFrontmatter' && write.path === INDEX)).toBe(true);
  });

  it('writes the moved scene\'s order key a moment later, into that one note, and then rests', async () => {
    const s = await stage(novel());
    await choose(s, 'Opening', 'Move down'); // past the folder: now after both of its scenes
    expect(manuscript(s.pane).slice(0, 5)).toEqual(['v Part one 8', '  The Letter 4', '  v חלק פנימי 4', '    מכתב לאחותי 4', 'Opening 3']);
    expect(s.vault.writes).toEqual([{ op: 'updateFrontmatter', path: INDEX }]); // not yet

    s.timers.advance(ORDER_DEBOUNCE_MS);
    await rest(s);
    expect(s.vault.writes).toEqual([
      { op: 'updateFrontmatter', path: INDEX },
      { op: 'updateFrontmatter', path: OPENING },
    ]);
    expect(s.vault.frontmatterOf(OPENING)?.['order']).toBe(4096);
    expect(s.vault.bodyOf(OPENING)).toBe('One two three.');

    // Its own write does not set it off again.
    s.timers.advance(ORDER_DEBOUNCE_MS * 4);
    await rest(s);
    expect(s.vault.writes).toHaveLength(2);
    expect(selectedTitle(s.pane)).toBe('Opening');
  });

  it('writes no order key when a move leaves the manuscript in the same order', async () => {
    const s = await stage(novel());
    await choose(s, 'The Letter', 'Move up'); // out of the folder, but still after Opening and before the Hebrew scene
    s.timers.advance(ORDER_DEBOUNCE_MS);
    await rest(s);
    expect(s.vault.writes).toEqual([{ op: 'updateFrontmatter', path: INDEX }]);
  });

  it('moves the scene to a folder picked from a list', async () => {
    const s = await stage(novel());
    menuOf(s.pane, 'Opening').item('Move to folder').click();
    const list = picker();
    expect(list.inputEl.attrs['placeholder']).toBe('Move "Opening" to...');
    // The folders, each with the folders around it, plus "Top level".
    expect(list.shownFor('').map((row) => row.text)).toEqual(['Top level', 'Part one', 'Part one / חלק פנימי']);
    list.pick('Part one');
    await rest(s);
    expect(manuscript(s.pane).slice(0, 5)).toEqual(['v Part one 11', '  The Letter 4', '  v חלק פנימי 4', '    מכתב לאחותי 4', '  Opening 3']);
    expect(selectedTitle(s.pane)).toBe('Opening');
    expect(s.vault.writes).toEqual([{ op: 'updateFrontmatter', path: INDEX }]);
  });

  it('moves a scene out of its folders to the top level', async () => {
    const s = await stage(novel());
    menuOf(s.pane, 'מכתב לאחותי').item('Move to folder').click();
    expect(picker().shownFor('').map((row) => row.text)).toEqual(['Top level', 'Part one', 'Part one / חלק פנימי']);
    picker().pick('Top level');
    await rest(s);
    expect(last(manuscript(s.pane))).toBe('מכתב לאחותי 4'); // at the end of the top level
  });

  it('unfolds the folder a scene was moved into, so that the scene can be seen', async () => {
    const s = await stage(novel());
    tap(rowOf(s.pane, 'חלק פנימי'));
    tap(rowOf(s.pane, 'Part one'));
    expect(manuscript(s.pane)).toEqual(['Opening 3', '> Part one 8', `! Ghost -- ${MISSING_LABEL}`]);

    menuOf(s.pane, 'Opening').item('Move to folder').click();
    picker().pick('Part one / חלק פנימי');
    await rest(s);
    expect(manuscript(s.pane)).toEqual([
      'v Part one 11',
      '  The Letter 4',
      '  v חלק פנימי 7',
      '    מכתב לאחותי 4',
      '    Opening 3',
      `! Ghost -- ${MISSING_LABEL}`,
    ]);
    expect(selectedTitle(s.pane)).toBe('Opening');
    expect(foldedIn(s.storage)).toBeNull();
  });

  it('moves nothing when the list is closed without a choice', async () => {
    const s = await stage(novel());
    menuOf(s.pane, 'Opening').item('Move to folder').click();
    picker().close();
    await rest(s);
    expect(s.vault.writes).toEqual([]);
  });

  it('sends the scene to the end of the place it is already in, when that place is picked', async () => {
    const vault = new MemoryVault();
    seedProject(vault, { scenes: { A: 1024, B: 2048, C: 3072 } });
    const s = await stage(vault);
    menuOf(s.pane, 'A').item('Move to folder').click();
    expect(picker().shownFor('').map((row) => row.text)).toEqual(['Top level']); // a binder without folders
    picker().pick('Top level');
    await rest(s);
    expect(manuscript(s.pane).map((line) => line.split(' ')[0])).toEqual(['B', 'C', 'A']);
    expect(selectedTitle(s.pane)).toBe('A');

    // Already the last one there: nothing to do, and it says so.
    s.vault.clearWrites();
    menuOf(s.pane, 'A').item('Move to folder').click();
    picker().pick('Top level');
    await rest(s);
    expect(notices()).toEqual(['It is already there.']);
    expect(s.vault.writes).toEqual([]);
    expect(selectedTitle(s.pane)).toBe('A');
  });
});

describe('Delete scene', () => {
  it('asks first, naming the scene', async () => {
    const s = await stage(novel());
    menuOf(s.pane, 'מכתב לאחותי').item('Delete scene').click();
    const asked = question();
    expect(asked.title).toBe('Delete "מכתב לאחותי"?');
    expect(asked.message).toMatch(/taken out of the binder/);
    expect(asked.message).toMatch(/moved to the trash/);
    expect(asked.confirm.buttonEl.text).toBe('Delete');
    expect(asked.cancel.buttonEl.focused).toBe(true);
    expect(s.vault.writes).toEqual([]); // nothing happens before the answer
  });

  it('deletes nothing on Cancel', async () => {
    const s = await stage(novel());
    menuOf(s.pane, 'Opening').item('Delete scene').click();
    question().cancel.click();
    await rest(s);
    expect(s.vault.writes).toEqual([]);
    expect(s.vault.trashed).toEqual([]);
    expect(manuscript(s.pane)[0]).toBe('Opening 3');
  });

  it('moves the note to the trash and takes the entry out of the binder when confirmed', async () => {
    const s = await stage(novel());
    menuOf(s.pane, 'The Letter').item('Delete scene').click();
    question().confirm.click();
    await rest(s);

    expect(openWindows()).toBe(0);
    expect(s.vault.trashed).toEqual([LETTER]);
    // The index first, then the note: a note is only trashed once the binder no longer lists it.
    expect(s.vault.writes).toEqual([
      { op: 'updateFrontmatter', path: INDEX },
      { op: 'trash', path: LETTER },
    ]);
    expect(manuscript(s.pane)).toEqual(['Opening 3', 'v Part one 4', '  v חלק פנימי 4', '    מכתב לאחותי 4', `! Ghost -- ${MISSING_LABEL}`]);
    expect(notices()).toEqual(['Moved "The Letter" to the trash.']);
    expect(selectedTitle(s.pane)).toBeNull(); // the row is gone
    // Nothing else was touched.
    expect(s.vault.has(OPENING)).toBe(true);
    expect(s.vault.has(HEBREW)).toBe(true);
    expect(picture(s.pane)).toContain('  Loose 2');
  });

  it('does not say a note went to the trash when the note had left the project while the question was open', async () => {
    const s = await stage(novel());
    menuOf(s.pane, 'The Letter').item('Delete scene').click();
    // While the window is up, another device moves the note out of the project.
    s.vault.external.rename(LETTER, 'Archive/The Letter.md');
    question().confirm.click();
    await rest(s);

    expect(s.vault.trashed).toEqual([]);
    expect(s.vault.has('Archive/The Letter.md')).toBe(true);
    expect(notices()).toEqual([
      'Removed "The Letter" from the binder. Its note was no longer in the project, so nothing was moved to the trash.',
    ]);
    expect(picture(s.pane).some((line) => line.includes('The Letter'))).toBe(false);
  });

  it('keeps the scene in the binder, and says so, when the note cannot be moved to the trash', async () => {
    const s = await stage(novel());
    s.vault.failNext('trash');
    menuOf(s.pane, 'Opening').item('Delete scene').click();
    question().confirm.click();
    await rest(s);
    expect(s.vault.has(OPENING)).toBe(true);
    expect(manuscript(s.pane)[0]).toBe('Opening 3');
    expect(notices()).toHaveLength(1);
    expect(notices()[0]).toMatch(/was not deleted/);
    expect(notices()[0]).toMatch(/still in the binder/);
  });

  it('is the only thing in the binder that ever puts a note in the trash', async () => {
    const s = await stage(novel());
    await choose(s, 'Part one', 'Remove folder (keeps scenes)');
    await choose(s, 'Ghost', 'Remove from binder');
    await choose(s, 'Loose', 'Add to manuscript');
    await choose(s, 'Opening', 'Move down');
    menuOf(s.pane, 'Opening').item('Rename').click();
    await prompt(s).answer('Prologue');
    expect(s.vault.trashed).toEqual([]);
    expect(s.vault.writes.some((write) => write.op === 'trash')).toBe(false);
  });
});

// ----------------------------------------------------------- folder actions

describe('a folder\'s menu', () => {
  it('adds a new scene inside the folder, at its end, and opens it', async () => {
    const s = await stage(novel());
    menuOf(s.pane, 'חלק פנימי').item('New scene inside').click();
    await prompt(s).answer('תשובה');
    expect(manuscript(s.pane).slice(3, 6)).toEqual(['  v חלק פנימי 4', '    מכתב לאחותי 4', '    תשובה 0 *']);
    expect(s.host.opened).toEqual([{ path: 'Novel/Manuscript/תשובה.md', where: false }]);
    // The note itself is in the Manuscript folder: binder folders are not folders on disk.
    expect(s.vault.has('Novel/Manuscript/תשובה.md')).toBe(true);
  });

  it('adds a new folder inside the folder', async () => {
    const s = await stage(novel());
    menuOf(s.pane, 'Part one').item('New folder inside').click();
    await prompt(s).answer('Chapter two');
    expect(manuscript(s.pane).slice(1, 6)).toEqual(['v Part one 8', '  The Letter 4', '  v חלק פנימי 4', '    מכתב לאחותי 4', '  v Chapter two 0']);
    expect(selectedTitle(s.pane)).toBe('Chapter two');
  });

  it('renames the folder, which stays where it is and keeps what is in it', async () => {
    const s = await stage(novel());
    menuOf(s.pane, 'Part one').item('Rename').click();
    const window = prompt(s);
    expect(window.title).toBe('Rename folder');
    expect(window.input.value).toBe('Part one');
    await window.answer('חלק ראשון');
    expect(manuscript(s.pane).slice(1, 3)).toEqual(['v חלק ראשון 8', '  The Letter 4']);
    expect(selectedTitle(s.pane)).toBe('חלק ראשון');
    expect(s.vault.writes).toEqual([{ op: 'updateFrontmatter', path: INDEX }]);
    expect((binderOnDisk(s.vault, INDEX) as Array<{ id?: string }>)[1]?.id).toBe('f-one'); // the same folder
  });

  it('changes nothing when the folder\'s name is confirmed as it was, and turns down an empty one', async () => {
    const s = await stage(novel());
    menuOf(s.pane, 'Part one').item('Rename').click();
    const window = prompt(s);
    await window.answer(' ');
    expect(window.message()).toBe('Give the folder a name.');
    await window.answer('Part one');
    expect(window.modal.isOpen).toBe(false);
    expect(s.vault.writes).toEqual([]);
  });

  it('moves the folder up and down with everything in it', async () => {
    const s = await stage(novel());
    await choose(s, 'Part one', 'Move up');
    expect(manuscript(s.pane)).toEqual(['v Part one 8', '  The Letter 4', '  v חלק פנימי 4', '    מכתב לאחותי 4', 'Opening 3', `! Ghost -- ${MISSING_LABEL}`]);
    expect(selectedTitle(s.pane)).toBe('Part one');
    await choose(s, 'Part one', 'Move down');
    await choose(s, 'Part one', 'Move down');
    expect(manuscript(s.pane).slice(0, 3)).toEqual(['Opening 3', `! Ghost -- ${MISSING_LABEL}`, 'v Part one 8']);
    // An inner folder at the edge of its folder moves out of it.
    await choose(s, 'חלק פנימי', 'Move down');
    expect(manuscript(s.pane).slice(2)).toEqual(['v Part one 4', '  The Letter 4', 'v חלק פנימי 4', '  מכתב לאחותי 4']);
  });

  it('moves the folder into another folder, never into itself or what is inside it', async () => {
    const vault = novel();
    vault.external.editFrontmatter('Novel/Novel.md', (frontmatter) => {
      (frontmatter['binder'] as unknown[]).push({ folder: 'Part two', id: 'f-two', children: [] });
    });
    const s = await stage(vault);
    menuOf(s.pane, 'Part one').item('Move to folder').click();
    // Not "Part one" itself, and not the folder inside it.
    expect(picker().shownFor('').map((row) => row.text)).toEqual(['Top level', 'Part two']);
    picker().pick('Part two');
    await rest(s);
    expect(manuscript(s.pane)).toEqual([
      'Opening 3',
      `! Ghost -- ${MISSING_LABEL}`,
      'v Part two 8',
      '  v Part one 8',
      '    The Letter 4',
      '    v חלק פנימי 4',
      '      מכתב לאחותי 4',
    ]);
    expect(selectedTitle(s.pane)).toBe('Part one');
  });

  it('removes the folder and keeps its scenes, which move up to where the folder was', async () => {
    const s = await stage(novel());
    await choose(s, 'Part one', 'Remove folder (keeps scenes)');
    expect(manuscript(s.pane)).toEqual(['Opening 3', 'The Letter 4', 'v חלק פנימי 4', '  מכתב לאחותי 4', `! Ghost -- ${MISSING_LABEL}`]);
    expect(notices()).toEqual(['Removed the folder "Part one". Its 2 scenes were kept.']);
    expect(s.vault.writes).toEqual([{ op: 'updateFrontmatter', path: INDEX }]);
    expect(s.vault.trashed).toEqual([]);
    expect(s.vault.has(LETTER)).toBe(true);
    expect(openWindows()).toBe(0); // nothing is lost, so nothing is asked

    await choose(s, 'חלק פנימי', 'Remove folder (keeps scenes)');
    expect(last(notices())).toBe('Removed the folder "חלק פנימי". Its scene was kept.');
    expect(manuscript(s.pane)).toEqual(['Opening 3', 'The Letter 4', 'מכתב לאחותי 4', `! Ghost -- ${MISSING_LABEL}`]);

    // The manuscript is in the same order as before, so no order key needs writing.
    s.timers.advance(ORDER_DEBOUNCE_MS);
    await rest(s);
    expect(s.vault.writes.every((write) => write.path === INDEX)).toBe(true);
  });

  it('removes an empty folder without a word about scenes', async () => {
    const s = await stage(novel());
    tap(toolbarButton(s.pane, 'New folder'));
    await prompt(s).answer('Empty');
    await choose(s, 'Empty', 'Remove folder (keeps scenes)');
    expect(notices()).toEqual(['Removed the folder "Empty".']);
    expect(selectedTitle(s.pane)).toBeNull();
  });
});

// ------------------------------------------------- missing and unfiled rows

describe('a missing entry\'s menu', () => {
  it('takes the entry out of the binder, touching no note', async () => {
    const s = await stage(novel());
    await choose(s, 'Ghost', 'Remove from binder');
    expect(last(manuscript(s.pane))).toBe('    מכתב לאחותי 4');
    expect(picture(s.pane).some((line) => line.includes('Ghost'))).toBe(false);
    expect(s.vault.writes).toEqual([{ op: 'updateFrontmatter', path: INDEX }]);
    expect(s.vault.trashed).toEqual([]);
    expect(notices()).toEqual([]);
  });

  it('keeps the entry, and says why, when the note has arrived in the meantime', async () => {
    const s = await stage(novel());
    const menu = menuOf(s.pane, 'Ghost');
    // The note arrives from another device while the menu is open.
    s.vault.external.create('Novel/Manuscript/Ghost.md', { body: 'Here I am.' }, { silent: true });
    menu.item('Remove from binder').click();
    await rest(s);
    expect(notices()).toEqual(['The note for this scene is in the vault now, so the entry was kept.']);
    expect(s.vault.writes).toEqual([]);
    expect(last(manuscript(s.pane))).toBe('Ghost 3');
  });
});

describe('an unfiled note\'s menu', () => {
  it('adds the note to the manuscript, at the end of the top level', async () => {
    const s = await stage(novel());
    await choose(s, 'Loose', 'Add to manuscript');
    expect(manuscript(s.pane).slice(-2)).toEqual([`! Ghost -- ${MISSING_LABEL}`, 'Loose 2']);
    expect(picture(s.pane)).not.toContain('v Unfiled'); // nothing is unfiled any more
    expect(picture(s.pane)[0]).toBe('v Manuscript 13');
    expect(selectedTitle(s.pane)).toBe('Loose');
    expect(s.vault.writes).toEqual([{ op: 'updateFrontmatter', path: INDEX }]);
    expect(s.vault.bodyOf('Novel/Manuscript/Loose.md')).toBe('Two words');

    // Its order key follows a moment later: the note had none.
    s.timers.advance(ORDER_DEBOUNCE_MS);
    await rest(s);
    expect(s.vault.frontmatterOf('Novel/Manuscript/Loose.md')).toEqual({ order: 4096 });
  });

  it('opens the note, in the same tab or a new one', async () => {
    const s = await stage(novel());
    await choose(s, 'Loose', 'Open');
    await choose(s, 'Loose', 'Open in new tab');
    expect(s.host.opened).toEqual([
      { path: 'Novel/Manuscript/Loose.md', where: false },
      { path: 'Novel/Manuscript/Loose.md', where: 'tab' },
    ]);
  });
});

describe('a research note\'s menu', () => {
  it('opens the note, which is how a new tab is reached by touch', async () => {
    const s = await stage(novel());
    await choose(s, 'City', 'Open in new tab');
    await choose(s, 'Trains', 'Open');
    expect(s.host.opened).toEqual([
      { path: 'Novel/Research/Maps/City.md', where: 'tab' },
      { path: 'Novel/Research/Trains.md', where: false },
    ]);
    expect(s.vault.writes).toEqual([]);
  });
});

// ---------------------------------------------------------------- selection

describe('the selected row', () => {
  it('is the row that was tapped: a scene, a folder, a missing entry, a note', async () => {
    const s = await stage(novel());
    expect(selectedTitle(s.pane)).toBeNull();
    for (const title of ['Opening', 'Part one', 'Ghost', 'Loose', 'City']) {
      tap(rowOf(s.pane, title));
      await rest(s);
      expect(selectedTitle(s.pane), title).toBe(title);
    }
  });

  it('is not changed by tapping a section or a folder of Research', async () => {
    const s = await stage(novel());
    tap(rowOf(s.pane, 'Part one'));
    tap(rowOf(s.pane, 'Research'));
    tap(rowOf(s.pane, 'Research'));
    tap(rowOf(s.pane, 'Maps'));
    expect(selectedTitle(s.pane)).toBe('Part one');
  });

  it('follows the writer to the note they move to', async () => {
    const s = await stage(novel());
    tap(rowOf(s.pane, 'Part one'));
    s.fake.workspace.setActiveFile(fileAt(HEBREW)); // through the quick switcher, say
    expect(selectedTitle(s.pane)).toBe('מכתב לאחותי');
    // A note that has no row in the binder leaves the selection where it was.
    s.fake.workspace.setActiveFile(fileAt('Elsewhere/Note.md'));
    s.fake.workspace.setActiveFile(fileAt('Novel/To-do.md'));
    expect(selectedTitle(s.pane)).toBe('מכתב לאחותי');
  });

  it('stays selected when the list is drawn again', async () => {
    const s = await stage(novel());
    tap(rowOf(s.pane, 'Part one'));
    s.vault.external.create('Novel/Research/Bridges.md');
    await rest(s);
    expect(picture(s.pane)).toContain('  Bridges');
    expect(selectedTitle(s.pane)).toBe('Part one');
    expect(picture(s.pane)).toContain('  > Part one 8'); // and nothing was unfolded just for being drawn again
  });

  it('belongs to its project: another project starts with nothing selected', async () => {
    const vault = novel();
    seedProject(vault, { folder: 'Other', title: 'Other Book', scenes: { Opening: 1024 } });
    const s = await stage(vault);
    tap(rowOf(s.pane, 'Opening'));
    await rest(s);
    expect(selectedTitle(s.pane)).toBe('Opening');

    await s.services.session.choose('Other/Other.md');
    await rest(s);
    expect(one(s.pane, 'spellbook-project-name').text).toBe('Other Book');
    expect(selectedTitle(s.pane)).toBeNull(); // it has an "Opening" too, but that is another scene
  });

  it('is scrolled into view after an action, without drawing the list again when nothing changed', async () => {
    const s = await stage(novel());
    const list = scroller(s.pane);
    list.rect = { top: 100, bottom: 400, left: 0, right: 300, width: 300, height: 300 };
    list.scrollTop = 250;
    rowOf(s.pane, 'Opening').rect = { top: 40, bottom: 70, left: 0, right: 300, width: 300, height: 30 };
    const rowsBefore = s.pane.withClass('spellbook-row-self');

    await s.host.actions.step(INDEX, sceneRef('Manuscript/Opening.md'), 'up'); // it is already at the top
    expect(notices()).toEqual(['It is already at the top.']);
    expect(selectedTitle(s.pane)).toBe('Opening');
    expect(list.scrollTop).toBe(190); // up, just far enough
    const rowsAfter = s.pane.withClass('spellbook-row-self');
    expect(rowsAfter).toHaveLength(rowsBefore.length);
    expect(rowsAfter.every((row, index) => row === rowsBefore[index])).toBe(true); // the very same rows
  });

  it('is scrolled into view once the panel can be measured, when it could not be at the time', async () => {
    const s = await stage(novel());
    const list = scroller(s.pane);
    list.scrollTop = 0;
    // The panel is hidden (a closed sidebar): nothing has a size.
    await choose(s, 'Opening', 'Move down');
    expect(selectedTitle(s.pane)).toBe('Opening');
    expect(list.scrollTop).toBe(0);

    // The sidebar opens: Obsidian tells the panel that its size changed.
    list.rect = { top: 100, bottom: 400, left: 0, right: 300, width: 300, height: 300 };
    rowOf(s.pane, 'Opening').rect = { top: 520, bottom: 550, left: 0, right: 300, width: 300, height: 30 };
    s.view.onResize();
    expect(list.scrollTop).toBe(150); // down, just far enough
    // Once is enough: the list is not pulled back when the writer scrolls away and the size changes again.
    list.scrollTop = 0;
    s.view.onResize();
    expect(list.scrollTop).toBe(0);
  });

  it('can be set from outside the panel, and is shown once the row exists', async () => {
    const s = await stage(novel());
    tap(rowOf(s.pane, 'Part one')); // folded shut
    s.host.actions.select(INDEX, sceneRef(HEBREW_REL));
    expect(selectedTitle(s.pane)).toBe('מכתב לאחותי');
    expect(manuscript(s.pane)).toContain('    מכתב לאחותי 4'); // both folders around it are open now
    expect(foldedIn(s.storage)).toBeNull();

    // A row that is not there yet is selected as soon as it is.
    s.host.actions.select(INDEX, sceneRef('Manuscript/Late.md'));
    expect(selectedTitle(s.pane)).toBeNull();
    s.vault.external.create('Novel/Manuscript/Late.md', { body: 'Sorry.' });
    await rest(s);
    expect(selectedTitle(s.pane)).toBe('Late');
  });
});

// --------------------------------------------- changes made outside the binder

describe('changes made outside the binder show up without a reload', () => {
  it('a note renamed in the file explorer keeps its place under its new name', async () => {
    const s = await stage(novel());
    s.vault.external.rename(LETTER, 'Novel/Manuscript/The Reply.md');
    await rest(s);
    expect(manuscript(s.pane).slice(1, 3)).toEqual(['v Part one 8', '  The Reply 4']);
    // It is the same scene under a new name: not a missing entry plus an unfiled note.
    expect(picture(s.pane).filter((line) => line.includes('The Letter'))).toEqual([]);
    expect(picture(s.pane).filter((line) => line.includes('The Reply'))).toHaveLength(1);
    expect(s.vault.reads.readText).toBe(4); // and its words were not counted again

    // The index follows a moment later, in one write.
    s.timers.advance(RENAME_SETTLE_MS);
    await rest(s);
    expect(s.vault.writes).toEqual([{ op: 'updateFrontmatter', path: INDEX }]);
    expect(JSON.stringify(binderOnDisk(s.vault, INDEX))).toContain('Manuscript/The Reply.md');
    expect(JSON.stringify(binderOnDisk(s.vault, INDEX))).not.toContain('The Letter');
  });

  it('the menu of a renamed note acts on the note under its new name', async () => {
    const s = await stage(novel());
    s.vault.external.rename(OPENING, 'Novel/Manuscript/Prologue.md');
    await rest(s);
    menuOf(s.pane, 'Prologue').item('Delete scene').click();
    expect(question().title).toBe('Delete "Prologue"?');
    question().confirm.click();
    await rest(s);
    expect(s.vault.trashed).toEqual(['Novel/Manuscript/Prologue.md']);
    expect(manuscript(s.pane)[0]).toBe('v Part one 8');
  });

  it('a note moved to another folder of the project stays in the binder', async () => {
    const s = await stage(novel());
    s.vault.external.rename(OPENING, 'Novel/Manuscript/Drafts/Opening.md');
    await rest(s);
    expect(manuscript(s.pane)[0]).toBe('Opening 3');
    tap(rowOf(s.pane, 'Opening'));
    await rest(s);
    expect(s.host.opened).toEqual([{ path: 'Novel/Manuscript/Drafts/Opening.md', where: false }]);
  });

  it('a note deleted in the file explorer is shown as missing, and can be removed from the binder', async () => {
    const s = await stage(novel());
    s.vault.external.delete(LETTER);
    await rest(s);
    expect(manuscript(s.pane).slice(1, 3)).toEqual(['v Part one 4', `  ! The Letter -- ${MISSING_LABEL}`]);
    expect(menuOf(s.pane, 'The Letter').outline).toEqual(['Remove from binder']);
    expect(s.vault.writes).toEqual([]); // the binder is not "repaired" behind the writer's back
  });

  it('a note added to the Manuscript folder appears under Unfiled, ready to be filed', async () => {
    const s = await stage(novel());
    s.vault.external.create('Novel/Manuscript/From my phone.md', { body: 'Typed on the train.' });
    await rest(s);
    expect(picture(s.pane)).toContain('  From my phone 4');
    await choose(s, 'From my phone', 'Add to manuscript');
    expect(last(manuscript(s.pane))).toBe('From my phone 4');
  });

  it('an index changed by another device is followed: order, folders, names', async () => {
    const s = await stage(novel());
    tap(rowOf(s.pane, 'Opening'));
    await rest(s);
    s.vault.clearWrites();
    s.vault.external.editFrontmatter(INDEX, (frontmatter) => {
      frontmatter['binder'] = [
        { folder: 'Act one', id: 'f-one', children: ['Manuscript/The Letter.md'] },
        'Manuscript/מכתב לאחותי.md',
        { folder: 'New on the other device', id: 'f-new', children: ['Manuscript/Opening.md'] },
      ];
    });
    await rest(s);
    expect(manuscript(s.pane)).toEqual([
      'v Act one 4',
      '  The Letter 4',
      'מכתב לאחותי 4',
      'v New on the other device 3',
      '  Opening 3 *',
    ]);
    expect(selectedTitle(s.pane)).toBe('Opening'); // the same scene, in its new place
    // Nothing is written in answer to a change that came from elsewhere: no index, no order keys.
    s.timers.advance(ORDER_DEBOUNCE_MS * 2);
    await rest(s);
    expect(s.vault.writes).toEqual([]);
  });

  it('a renamed project folder changes nothing in the binder, and actions keep working', async () => {
    const s = await stage(novel());
    s.vault.external.rename('Novel', 'My Novel');
    await rest(s);
    expect(manuscript(s.pane)[0]).toBe('Opening 3');
    tap(toolbarButton(s.pane, 'New scene'));
    await prompt(s).answer('Night Train');
    expect(s.vault.has('My Novel/Manuscript/Night Train.md')).toBe(true);
    expect(last(manuscript(s.pane))).toBe('Night Train 0 *');
  });

  for (const [what, from, to, movedIndex] of [
    ['project folder', 'Novel', 'My Novel', 'My Novel/Novel.md'],
    ['index note', INDEX, 'Novel/Book.md', 'Novel/Book.md'],
  ] as const) {
    it(`a renamed ${what} keeps what was folded shut, the selected row and the place in the list`, async () => {
      const s = await stage(novel());
      tap(rowOf(s.pane, 'Research')); // folds it shut
      tap(rowOf(s.pane, 'Part one')); // folds it shut, and makes it the selected row
      await rest(s);
      const folded = foldedIn(s.storage)?.[INDEX];
      expect(folded).toEqual(expect.arrayContaining(['folder:f-one', 'section:research']));
      scroller(s.pane).scrollTop = 64;
      const rowBefore = rowOf(s.pane, 'Part one');

      s.vault.external.rename(from, to);
      await rest(s);

      expect(s.store.project?.indexPath).toBe(movedIndex);
      // Everything is as it was: it is the same project.
      expect(manuscript(s.pane).slice(0, 2)).toEqual(['Opening 3', '> Part one 8']);
      expect(picture(s.pane)).toContain('> Research');
      expect(selectedTitle(s.pane)).toBe('Part one');
      expect(scroller(s.pane).scrollTop).toBe(64);
      expect(rowOf(s.pane, 'Part one')).toBe(rowBefore); // the very same row, not a new list
      // What this device remembers is kept under the new path, and nothing is left under the old one.
      expect(foldedIn(s.storage)).toEqual({ [movedIndex]: folded });

      // Folding goes on working, under the new path.
      tap(rowOf(s.pane, 'Part one'));
      expect(manuscript(s.pane)[1]).toBe('v Part one 8');
      expect(foldedIn(s.storage)).toEqual({ [movedIndex]: ['section:research'] });
      expect(s.vault.writes).toEqual([]);
    });
  }
});

// ----------------------------------------------------- never the wrong project

describe('an action started in one project', () => {
  function twoNovels(): MemoryVault {
    const vault = novel();
    seedProject(vault, { folder: 'Other', title: 'Other Book', scenes: { Opening: 1024, Second: 2048 } });
    return vault;
  }

  it('is not carried out in another project that was opened in the meantime', async () => {
    const s = await stage(twoNovels());
    const menu = menuOf(s.pane, 'Opening'); // made for "My Novel"
    await s.services.session.choose('Other/Other.md');
    await rest(s);
    s.vault.clearWrites();

    menu.item('Delete scene').click();
    menu.item('Rename').click();
    menu.item('Move down').click();
    menu.item('New scene below').click();
    menu.item('Move to folder').click();
    await rest(s);
    expect(openWindows()).toBe(0);
    expect(notices()).toEqual(Array(5).fill('That project is no longer the open one. Nothing was changed.'));
    expect(s.vault.writes).toEqual([]);
    expect(manuscript(s.pane)).toEqual(['Opening 9', 'Second 9']); // the other book, as it was
  });

  it('is not carried out when the project changes while a confirmation is open', async () => {
    const s = await stage(twoNovels());
    menuOf(s.pane, 'Opening').item('Delete scene').click();
    const asked = question();
    await s.services.session.choose('Other/Other.md'); // it has an "Opening" too
    await rest(s);

    asked.confirm.click();
    await rest(s);
    expect(s.vault.trashed).toEqual([]);
    expect(s.vault.has('Other/Manuscript/Opening.md')).toBe(true);
    expect(s.vault.has(OPENING)).toBe(true);
    expect(notices()).toEqual(['That project is no longer the open one. Nothing was changed.']);
  });

  it('is not carried out when the project changes while a name is being typed', async () => {
    const s = await stage(twoNovels());
    tap(toolbarButton(s.pane, 'New scene'));
    const window = prompt(s);
    await s.services.session.choose('Other/Other.md');
    await rest(s);
    s.vault.clearWrites();

    await window.answer('Night Train');
    expect(window.modal.isOpen).toBe(false);
    expect(s.vault.writes).toEqual([]);
    expect(s.vault.has('Other/Manuscript/Night Train.md')).toBe(false);
    expect(notices()).toHaveLength(1);
    expect(notices()[0]).toMatch(/Another project was opened/);
  });
});

// -------------------------------------------------------------------- phones

describe('on a phone', () => {
  beforeEach(() => {
    StubPlatform.isMobile = true;
    StubPlatform.isPhone = true;
    StubPlatform.isDesktop = false;
  });

  it('slides the drawer away once a new scene has been opened for writing', async () => {
    const s = await stage(novel());
    s.fake.workspace.leftSplit.expand();
    tap(toolbarButton(s.pane, 'New scene'));
    await prompt(s).answer('Night Train');
    expect(s.host.opened).toHaveLength(1);
    expect(s.fake.workspace.leftSplit.collapsed).toBe(true);
    expect(s.fake.workspace.leftSplit.collapses).toBe(1);
  });

  it('slides the drawer away for "Open in new tab" as well', async () => {
    const s = await stage(novel());
    s.fake.workspace.leftSplit.expand();
    await choose(s, 'Opening', 'Open in new tab');
    expect(s.fake.workspace.leftSplit.collapses).toBe(1);
  });

  it('keeps the drawer open for everything that opens no note', async () => {
    const s = await stage(novel());
    s.fake.workspace.leftSplit.expand();
    await choose(s, 'Opening', 'Move down');
    await choose(s, 'Part one', 'Remove folder (keeps scenes)');
    menuOf(s.pane, 'Opening').item('Rename').click();
    await prompt(s).answer('Prologue');
    tap(toolbarButton(s.pane, 'New folder'));
    await prompt(s).answer('Part two');
    toolbarMenu(s.pane).item('Collapse all').click();
    expect(s.fake.workspace.leftSplit.collapses).toBe(0);
    expect(s.fake.workspace.leftSplit.collapsed).toBe(false);
  });
});

// ------------------------------------------------------------------- closing

describe('a closed binder', () => {
  it('stops following the selection and the actions', async () => {
    const s = await stage(novel());
    await s.shell.close();
    s.host.actions.select(INDEX, folderRef('f-one'));
    await s.host.actions.openNote(INDEX, 'Manuscript/Opening.md', false);
    await rest(s);
    expect(s.pane.children).toEqual([]);
    expect(s.host.opened).toEqual([{ path: OPENING, where: false }]); // the action itself still works
    expect(s.fake.workspace.leftSplit.collapses).toBe(0);
  });

  it('shows what was selected in the meantime when it is opened again', async () => {
    const s = await stage(novel());
    await s.shell.close();
    s.host.actions.select(INDEX, folderRef('f-inner'));
    await s.shell.open();
    await rest(s);
    expect(selectedTitle(s.pane)).toBe('חלק פנימי');
  });
});
