// The corkboard, driven through a fake host and the stand-in screen
// (tests/obsidianStub.ts). These tests check what the board shows and what it
// asks of the host; how it looks can only be checked in Obsidian.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildBoard, folderScope, gridLayout, moveEarlier, moveLater } from '../../../src/core/cards';
import type { TreeNode } from '../../../src/core/types';
import {
  ACTIVE_CLASS,
  CORKBOARD_VIEW_TYPE,
  CorkboardView,
  EMPTY_BOARD_TEXT,
  FILL_CHUNK,
  NO_PROJECT_TEXT,
  STARTING_TEXT,
  createCorkboardView,
} from '../../../src/features/corkboard/corkboardView';
import { SynopsisModal } from '../../../src/features/corkboard/synopsisModal';
import { TagListsModal } from '../../../src/features/corkboard/tagListsModal';
import { MISSING_LABEL } from '../../../src/views/binderView';
import { HIDES_WORD_COUNTS_CLASS, setShowWordCounts, stopWordFigures } from '../../../src/ui/wordFigures';
import { Modal as StubModal, Platform as StubPlatform, fakeDocument, resetPlatform } from '../../obsidianStub';
import type { FakeElement } from '../../obsidianStub';
import {
  CLOSING,
  DANIEL,
  FakeHost,
  FakeWorkbench,
  GHOST,
  HEBREW_SCENE,
  HEBREW_SYNOPSIS,
  INNER_NAME,
  LETTER,
  LETTER_TEXT,
  OPENING,
  cardOf,
  cardsOf,
  choose,
  clearScreen,
  colorOf,
  crumbs,
  lastMenu,
  menuFrom,
  menuOf,
  notices,
  novelHost,
  novelIndex,
  novelTree,
  one,
  openBoard,
  openWindow,
  openWindows,
  rest,
  seen,
  submenu,
  tap,
  ticked,
  titles,
  type,
  typeInto,
  windowButtons,
} from './stage';

beforeEach(() => {
  clearScreen();
});

afterEach(() => {
  resetPlatform();
});

const grid = (pane: FakeElement): FakeElement => one(pane, 'spellbook-board-grid');
const message = (pane: FakeElement): string => seen(pane, 'spellbook-board-message');

/** Give the board a width, as a browser's layout would, and let it measure itself. */
function widen(board: { view: CorkboardView; pane: FakeElement }, width: number): void {
  grid(board.pane).clientWidth = width;
  board.view.onResize();
}

describe('the view itself', () => {
  it('is the Corkboard, with an icon, and is made from a host', async () => {
    const host = novelHost();
    const view = createCorkboardView(new FakeWorkbench().leaf, host);
    expect(view).toBeInstanceOf(CorkboardView);
    expect(view.getViewType()).toBe('spellbook-corkboard');
    expect(CORKBOARD_VIEW_TYPE).toBe('spellbook-corkboard');
    expect(view.getDisplayText()).toBe('Corkboard');
    expect(view.getIcon()).not.toBe('');
    // Opening a scene from a card must not replace the board in its own tab.
    expect(view.navigation).toBe(false);
  });
});

describe('with no project', () => {
  it('says that Spellbook is starting until it has started, then fills in', async () => {
    const host = novelHost();
    host.ready = false;
    const { pane } = await openBoard(host);
    expect(message(pane)).toBe(STARTING_TEXT);
    expect(cardsOf(pane)).toEqual([]);

    host.ready = true;
    host.emit({ type: 'project' });
    await rest(host);
    expect(message(pane)).toBe('');
    expect(titles(pane)).toEqual(['Opening', 'Part one', 'Ghost', 'Closing']);
  });

  it('says so when no project is open, and offers nothing to change', async () => {
    const host = new FakeHost();
    const { pane } = await openBoard(host);
    expect(message(pane)).toBe(NO_PROJECT_TEXT);
    expect(crumbs(pane)).toEqual([]);
    expect(one(pane, 'spellbook-board-size').disabled).toBe(true);
  });

  it('says that a part of the binder with nothing in it is empty', async () => {
    const host = new FakeHost();
    host.open([]);
    const { pane } = await openBoard(host);
    expect(message(pane)).toBe(EMPTY_BOARD_TEXT);
    expect(crumbs(pane).map((crumb) => crumb.text)).toEqual(['Manuscript']);
  });
});

describe('the cards', () => {
  it('shows the top of the binder in binder order, with a line that sums it up', async () => {
    const host = novelHost();
    const { pane } = await openBoard(host);
    expect(titles(pane)).toEqual(['Opening', 'Part one', 'Ghost', 'Closing']);
    // Five scenes at any depth; the missing one adds no words.
    expect(one(pane, 'spellbook-board-summary').text).toBe('5 scenes, 311 words');
  });

  it('leaves the sum of words out while a scene is still being counted', async () => {
    const host = novelHost();
    host.scenes.set(CLOSING, { frontmatter: {} });
    const { pane } = await openBoard(host);
    expect(one(pane, 'spellbook-board-summary').text).toBe('5 scenes');
  });

  it('shows a scene with its title, synopsis, status, label, word count and target bar', async () => {
    const { pane } = await openBoard(novelHost());
    const card = cardOf(pane, 'Opening');
    expect(seen(card, 'spellbook-card-synopsis')).toBe('Anna arrives in the old town.');
    expect(one(card, 'spellbook-card-synopsis').hasClass('spellbook-is-derived')).toBe(false);

    // The status is a pill in the status's colour.
    expect(seen(card, 'spellbook-card-status')).toBe('To do');
    expect(colorOf(one(card, 'spellbook-card-status'))).toBe('red');
    // The label is the card's coloured edge, and is named at its foot.
    expect(card.hasClass('spellbook-has-label')).toBe(true);
    expect(colorOf(card)).toBe('purple');
    expect(seen(card, 'spellbook-card-label-name')).toBe('Anna');
    expect(colorOf(one(card, 'spellbook-card-label').withClass('spellbook-swatch')[0])).toBe('purple');

    expect(seen(card, 'spellbook-card-words')).toBe('250 / 1,000 words');
    const bar = one(card, 'spellbook-card-target');
    expect(bar.hasClass('spellbook-is-off')).toBe(false);
    expect(one(card, 'spellbook-card-target-fill').style['width']).toBe('25%');
    expect(bar.attrs['aria-valuenow']).toBe(250);
    expect(bar.attrs['aria-valuemax']).toBe(1000);
    expect(seen(card, 'spellbook-card-warning')).toBe('');
  });

  it('shows no target bar without a target, and marks a target that was reached', async () => {
    const host = novelHost();
    const { pane } = await openBoard(host);
    expect(one(cardOf(pane, 'Closing'), 'spellbook-card-target').hasClass('spellbook-is-off')).toBe(true);
    expect(seen(cardOf(pane, 'Closing'), 'spellbook-card-words')).toBe('40 words');

    host.setScene(OPENING, { frontmatter: { target: 200 }, words: 250 });
    await rest(host);
    const card = cardOf(pane, 'Opening');
    expect(one(card, 'spellbook-card-target').hasClass('spellbook-is-reached')).toBe(true);
    expect(one(card, 'spellbook-card-target-fill').style['width']).toBe('100%');
  });

  it("shows the opening of a scene's text, in a quieter style, when it has no synopsis", async () => {
    const host = novelHost();
    const { pane, view } = await openBoard(host);
    view.showScope(folderScope('f-one'));
    const card = cardOf(pane, 'The Letter');
    expect(seen(card, 'spellbook-card-synopsis')).toBe(LETTER_TEXT);
    expect(one(card, 'spellbook-card-synopsis').hasClass('spellbook-is-derived')).toBe(true);
    // No label: the card's edge has no colour of its own, and no label is named.
    expect(card.hasClass('spellbook-has-label')).toBe(false);
    expect(colorOf(card)).toBeNull();
    expect(seen(card, 'spellbook-card-label')).toBe('');
  });

  it('shows a status that the list does not have by its name, without a colour', async () => {
    const { pane } = await openBoard(novelHost());
    const status = one(cardOf(pane, 'Closing'), 'spellbook-card-status');
    expect(status.fullText).toBe('Sent off');
    expect(colorOf(status)).toBeNull();
    expect(status.hasClass('spellbook-is-unlisted')).toBe(true);
    // Its lack of colour is its own: it does not take the colour of the card around it.
    expect(status.hasClass('spellbook-no-color')).toBe(true);
  });

  it('shows a scene whose note is missing greyed, with the warning the binder uses', async () => {
    const host = novelHost();
    const { pane } = await openBoard(host);
    const card = cardOf(pane, 'Ghost');
    expect(card.hasClass('spellbook-is-missing')).toBe(true);
    expect(card.attrs['aria-disabled']).toBe('true');
    expect(seen(card, 'spellbook-card-warning-text')).toBe(MISSING_LABEL);
    expect(seen(card, 'spellbook-card-synopsis')).toBe('');

    // There is nothing to open, but a tap does not go unanswered.
    tap(card);
    expect(host.opened).toEqual([]);
    expect(notices()).toEqual([`"Ghost": ${MISSING_LABEL}.`]);
  });

  it('shows a folder as one card: its name, the scenes inside it at any depth, and their words', async () => {
    const { pane } = await openBoard(novelHost());
    const card = cardOf(pane, 'Part one');
    expect(card.hasClass('spellbook-card-folder')).toBe(true);
    expect(seen(card, 'spellbook-card-scenes')).toBe('2 scenes');
    expect(seen(card, 'spellbook-card-words')).toBe('21 words');
    expect(seen(card, 'spellbook-card-folder-missing')).toBe('');
  });

  it("lets only the writer's own text choose its direction, and keeps numbers left to right", async () => {
    const host = novelHost();
    const { pane, view } = await openBoard(host);
    view.showScope(folderScope('f-inner'));
    const card = cardOf(pane, 'מכתב לאחותי');
    expect(seen(card, 'spellbook-card-synopsis')).toBe(HEBREW_SYNOPSIS);
    expect(seen(card, 'spellbook-card-label-name')).toBe(DANIEL);

    const withDir = card.all().filter((element) => element.attrs['dir'] !== undefined);
    expect(withDir.map((element) => [[...element.classes][0], element.attrs['dir']])).toEqual([
      ['spellbook-card-title', 'auto'],
      ['spellbook-card-synopsis', 'auto'],
      ['spellbook-card-label-name', 'auto'],
      ['spellbook-card-status-name', 'auto'],
      ['spellbook-card-words', 'ltr'],
    ]);
    // The card itself, and the board, follow the direction of the app.
    expect(card.attrs['dir']).toBeUndefined();
    expect(grid(pane).attrs['dir']).toBeUndefined();
    // The same on a folder card: only its name.
    view.showScope(folderScope('f-one'));
    const folder = cardOf(pane, INNER_NAME);
    expect(folder.all().filter((element) => element.attrs['dir'] === 'auto').map((element) => element.text)).toEqual([
      INNER_NAME,
    ]);
  });

  it('marks the card of the scene that is open in the editor', async () => {
    const host = novelHost();
    host.activeScenePath = CLOSING;
    const { pane } = await openBoard(host);
    const marked = (): string[] => pane.withClass(ACTIVE_CLASS).map((card) => card.withClass('spellbook-card-title')[0]?.text ?? '');
    expect(marked()).toEqual(['Closing']);
    expect(cardOf(pane, 'Closing').attrs['aria-current']).toBe('true');

    host.setActive(OPENING);
    expect(marked()).toEqual(['Opening']);
    expect(cardOf(pane, 'Closing').attrs['aria-current']).toBeUndefined();
    // A scene that is not on this board: no card is marked.
    host.setActive(LETTER);
    expect(marked()).toEqual([]);
  });
});

describe('with "Show word counts" switched off on this device', () => {
  afterEach(() => {
    stopWordFigures();
  });

  it('hides the counts on the cards and the words in the summary at once, and brings them back', async () => {
    const host = novelHost();
    const { pane } = await openBoard(host);
    const board = one(pane, 'spellbook-board');
    expect(board.hasClass(HIDES_WORD_COUNTS_CLASS)).toBe(false);

    setShowWordCounts(false);
    // The stylesheet hides the cards' counts and target bars under this class.
    expect(board.hasClass(HIDES_WORD_COUNTS_CLASS)).toBe(true);
    expect(one(pane, 'spellbook-board-summary').text).toBe('5 scenes');
    // Counting goes on: the card still knows its count, for when they come back.
    expect(seen(cardOf(pane, 'Closing'), 'spellbook-card-words')).toBe('40 words');

    setShowWordCounts(true);
    expect(board.hasClass(HIDES_WORD_COUNTS_CLASS)).toBe(false);
    expect(one(pane, 'spellbook-board-summary').text).toBe('5 scenes, 311 words');
  });

  it('opens without the words when they were switched off before', async () => {
    setShowWordCounts(false);
    const { pane } = await openBoard(novelHost());
    expect(one(pane, 'spellbook-board').hasClass(HIDES_WORD_COUNTS_CLASS)).toBe(true);
    expect(one(pane, 'spellbook-board-summary').text).toBe('5 scenes');
  });
});

describe('the trail and the scope', () => {
  it('makes a folder the scope when its card is tapped, and leads back by the trail', async () => {
    const host = novelHost();
    const { pane, view, bench } = await openBoard(host);
    expect(crumbs(pane).map((crumb) => crumb.text)).toEqual(['Manuscript']);

    tap(cardOf(pane, 'Part one'));
    expect(view.shownScope).toEqual(folderScope('f-one'));
    expect(titles(pane)).toEqual(['The Letter', INNER_NAME]);
    expect(crumbs(pane).map((crumb) => crumb.text)).toEqual(['Manuscript', 'Part one']);
    expect(one(pane, 'spellbook-board-summary').text).toBe('2 scenes, 21 words');
    expect(bench.layoutSaves).toBe(1);

    tap(cardOf(pane, INNER_NAME));
    const steps = crumbs(pane);
    expect(steps.map((crumb) => crumb.text)).toEqual(['Manuscript', 'Part one', INNER_NAME]);
    // Every step is a button; the last is the board on show.
    expect(steps.every((crumb) => crumb.tag === 'button')).toBe(true);
    expect(steps.map((crumb) => crumb.attrs['aria-current'])).toEqual([undefined, undefined, 'page']);
    // A folder's name is the writer's own text; "Manuscript" is the app's.
    expect(steps.map((crumb) => crumb.attrs['dir'])).toEqual([undefined, 'auto', 'auto']);

    tap(steps[1] as FakeElement);
    expect(titles(pane)).toEqual(['The Letter', INNER_NAME]);
    tap(crumbs(pane)[0] as FakeElement);
    expect(titles(pane)).toEqual(['Opening', 'Part one', 'Ghost', 'Closing']);
    expect(bench.layoutSaves).toBe(4);
  });

  it('tells the host which scenes it shows, and again when that changes', async () => {
    const host = novelHost();
    const { view } = await openBoard(host);
    // The scene whose note is missing has nothing to read.
    expect(host.watched).toEqual([[OPENING, CLOSING]]);
    view.showScope(folderScope('f-one'));
    expect(host.watched).toEqual([[OPENING, CLOSING], [LETTER]]);
    // Drawing again with the same scenes says nothing new.
    host.emit({ type: 'project' });
    await rest(host);
    expect(host.watched).toHaveLength(2);
  });

  it('comes back on the folder it was showing, and shows the manuscript when that folder is gone', async () => {
    const host = novelHost();
    const { pane, view } = await openBoard(host);
    view.showScope(folderScope('f-inner'));
    const state = view.getState();
    expect(state['scope']).toEqual({ kind: 'folder', id: 'f-inner' });

    const again = await openBoard(host);
    await again.view.setState(JSON.parse(JSON.stringify(state)), { history: false });
    expect(titles(again.pane)).toEqual(['מכתב לאחותי']);

    // The folder is taken out of the binder (on another device, say).
    host.setTree(novelTree().filter((node) => node.kind === 'scene'));
    await rest(host);
    expect(titles(pane)).toEqual(['Opening', 'Ghost', 'Closing']);
    expect(view.shownScope).toEqual({ kind: 'manuscript' });
    expect(crumbs(pane).map((crumb) => crumb.text)).toEqual(['Manuscript']);

    // What Obsidian remembered may be anything: it is never taken on trust.
    for (const junk of [null, 'x', {}, { scope: 3 }, { scope: { kind: 'folder' } }, { scope: { kind: 'other' } }]) {
      await again.view.setState(junk, { history: false });
    }
    expect(again.view.shownScope).toEqual({ kind: 'manuscript' });
  });

  it('goes back to the whole manuscript when another project is opened', async () => {
    const host = novelHost();
    const { pane, view } = await openBoard(host);
    view.showScope(folderScope('f-one'));
    host.scenes.set('Manuscript/Other.md', { frontmatter: {}, words: 3 });
    host.open(
      [{ kind: 'folder', id: 'f-one', name: 'Same id, other book', children: [] }, { kind: 'scene', path: 'Manuscript/Other.md', title: 'Other', missing: false }],
      {},
      { id: 'Other/Other.md' },
    );
    await rest(host);
    expect(view.shownScope).toEqual({ kind: 'manuscript' });
    expect(titles(pane)).toEqual(['Same id, other book', 'Other']);
  });
});

describe('opening scenes', () => {
  it('opens the scene when its card is tapped, and in a new tab with Cmd or Ctrl or the middle button', async () => {
    const host = novelHost();
    const { pane } = await openBoard(host);
    const card = cardOf(pane, 'Opening');
    tap(card);
    tap(card, { metaKey: true });
    tap(card, { ctrlKey: true });
    card.dispatch('auxclick', { button: 1, preventDefault: () => {} });
    // Any other extra button does nothing.
    card.dispatch('auxclick', { button: 3, preventDefault: () => {} });
    expect(host.opened).toEqual([
      { path: OPENING, where: false },
      { path: OPENING, where: 'tab' },
      { path: OPENING, where: 'tab' },
      { path: OPENING, where: 'tab' },
    ]);
  });

  it('opens with Enter, and moves over the board with the arrow keys, one Tab stop at a time', async () => {
    const host = novelHost();
    const board = await openBoard(host);
    const { pane } = board;
    widen(board, 700);
    const stops = (): string[] => cardsOf(pane).filter((card) => card.attrs['tabindex'] === 0).map((card) => card.withClass('spellbook-card-title')[0]?.text ?? '');
    expect(stops()).toEqual(['Opening']);

    const first = cardOf(pane, 'Opening');
    first.focus();
    type(first, 'ArrowRight');
    expect(fakeDocument.activeElement).toBe(cardOf(pane, 'Part one'));
    expect(stops()).toEqual(['Part one']);
    // Three cards side by side: Down goes to the card below.
    type(cardOf(pane, 'Part one'), 'ArrowLeft');
    type(cardOf(pane, 'Opening'), 'ArrowDown');
    expect(fakeDocument.activeElement).toBe(cardOf(pane, 'Closing'));
    type(cardOf(pane, 'Closing'), 'Home');
    expect(fakeDocument.activeElement).toBe(cardOf(pane, 'Opening'));
    // Only the card the keyboard is on, and its "more" button, are Tab stops.
    expect(pane.withClass('spellbook-card-more').map((more) => more.attrs['tabindex'])).toEqual([0, -1, -1, -1]);

    type(cardOf(pane, 'Opening'), 'Enter');
    type(cardOf(pane, 'Opening'), 'Enter', { ctrlKey: true });
    expect(host.opened).toEqual([
      { path: OPENING, where: false },
      { path: OPENING, where: 'tab' },
    ]);
    // On the "more" button the keys are the button's: Enter opens its menu, not the scene.
    type(one(cardOf(pane, 'Opening'), 'spellbook-card-more'), 'Enter');
    expect(host.opened).toHaveLength(2);
    expect(lastMenu().outline[0]).toBe('Open');
  });

  it('reads right to left when Obsidian does: the Left key goes on to the next card', async () => {
    const host = novelHost();
    const board = await openBoard(host);
    board.pane.setAttr('dir', 'rtl');
    const first = cardOf(board.pane, 'Opening');
    first.focus();
    type(first, 'ArrowLeft');
    expect(fakeDocument.activeElement).toBe(cardOf(board.pane, 'Part one'));
  });
});

describe("a card's menu", () => {
  it('offers everything a scene card can do, and switches off what cannot be done here', async () => {
    const { pane } = await openBoard(novelHost());
    const more = one(cardOf(pane, 'Opening'), 'spellbook-card-more');
    expect(more.attrs['aria-label']).toBe('More options');
    expect(menuOf(pane, 'Opening').outline).toEqual([
      'Open',
      'Open in new tab',
      '---',
      'Move earlier (off)',
      'Move later',
      '---',
      'Set status',
      'Set label',
      'Edit synopsis',
    ]);
    expect(menuOf(pane, 'Closing').outline.slice(3, 5)).toEqual(['Move earlier', 'Move later (off)']);
    // A right-click opens the same menu.
    cardOf(pane, 'Opening').dispatch('contextmenu', { clientX: 5, clientY: 6, preventDefault: () => {} });
    expect(lastMenu().outline).toHaveLength(9);
    expect(lastMenu().position).toEqual({ x: 5, y: 6 });
  });

  it('opens from the menu, here or in a new tab', async () => {
    const host = novelHost();
    const { pane } = await openBoard(host);
    menuOf(pane, 'Opening').item('Open').click();
    menuOf(pane, 'Opening').item('Open in new tab').click();
    expect(host.opened).toEqual([
      { path: OPENING, where: false },
      { path: OPENING, where: 'tab' },
    ]);
  });

  it('can still move a scene whose note is missing, and nothing else', async () => {
    const { pane } = await openBoard(novelHost());
    expect(menuOf(pane, 'Ghost').outline).toEqual([
      'Open (off)',
      'Open in new tab (off)',
      '---',
      'Move earlier',
      'Move later',
      '---',
      'Set status (off)',
      'Set label (off)',
      'Edit synopsis (off)',
    ]);
  });

  it('opens and moves a folder card', async () => {
    const host = novelHost();
    const { pane, view } = await openBoard(host);
    const menu = menuOf(pane, 'Part one');
    expect(menu.outline).toEqual(['Open', '---', 'Move earlier', 'Move later']);
    menu.item('Open').click();
    expect(view.shownScope).toEqual(folderScope('f-one'));
  });

  it('moves a card earlier and later through the host, with the move the engine works out', async () => {
    const host = novelHost();
    const { pane } = await openBoard(host);
    const before = cardsOf(pane);
    const board = buildBoard({ tree: novelTree(), sceneOf: () => null, lists: host.project!.lists });

    menuOf(pane, 'Opening').item('Move later').click();
    expect(host.moves).toEqual([moveLater(board, { kind: 'scene', path: OPENING })]);
    await rest(host);
    expect(titles(pane)).toEqual(['Part one', 'Opening', 'Ghost', 'Closing']);
    // The cards changed places; none was built anew.
    expect(new Set(cardsOf(pane))).toEqual(new Set(before));
    expect(cardOf(pane, 'Opening')).toBe(before[0]);

    menuOf(pane, 'Closing').item('Move earlier').click();
    await rest(host);
    expect(titles(pane)).toEqual(['Part one', 'Opening', 'Closing', 'Ghost']);
    expect(host.moves[1]).toEqual(
      moveEarlier(buildBoard({ tree: moveInTreeOnce(novelTree()), sceneOf: () => null, lists: host.project!.lists }), {
        kind: 'scene',
        path: CLOSING,
      }),
    );
  });

  it('tells the writer when the host could not move the card', async () => {
    const host = novelHost();
    host.refusal = 'This project is read-only.';
    const { pane } = await openBoard(host);
    menuOf(pane, 'Opening').item('Move later').click();
    await rest(host);
    expect(notices()).toEqual(['This project is read-only.']);
    expect(titles(pane)[0]).toBe('Opening');
  });

  it("sets a scene's status from a list of the project's statuses", async () => {
    const host = novelHost();
    const { pane } = await openBoard(host);
    const list = submenu(menuOf(pane, 'Opening'), 'Set status');
    expect(list.outline).toEqual(['To do', 'First draft', 'Done', '---', 'No status', '---', 'Edit statuses and labels']);
    expect(ticked(list)).toEqual(['To do']);
    // Each name is the writer's own text, and comes with a patch of its colour.
    const title = list.item('Done').titleEl as FakeElement;
    expect(colorOf(title.withClass('spellbook-swatch')[0])).toBe('green');
    expect(title.all().filter((element) => element.attrs['dir'] === 'auto').map((element) => element.text)).toEqual(['Done']);

    list.item('Done').click();
    await rest(host);
    // Only the key that changed is written.
    expect(host.patches).toEqual([{ path: OPENING, patch: { set: { status: 'Done' }, remove: [] } }]);
    expect(seen(cardOf(pane, 'Opening'), 'spellbook-card-status')).toBe('Done');
    expect(colorOf(one(cardOf(pane, 'Opening'), 'spellbook-card-status'))).toBe('green');

    // Choosing the one it already has writes nothing.
    submenu(menuOf(pane, 'Opening'), 'Set status').item('Done').click();
    await rest(host);
    expect(host.patches).toHaveLength(1);

    submenu(menuOf(pane, 'Opening'), 'Set status').item('No status').click();
    await rest(host);
    expect(host.patches[1]).toEqual({ path: OPENING, patch: { set: { status: '' }, remove: [] } });
    expect(seen(cardOf(pane, 'Opening'), 'spellbook-card-status')).toBe('');
  });

  it("keeps a scene's own status in the list when the project's list does not have it", async () => {
    const { pane } = await openBoard(novelHost());
    const list = submenu(menuOf(pane, 'Closing'), 'Set status');
    expect(list.outline.slice(0, 4)).toEqual(['To do', 'First draft', 'Done', 'Sent off']);
    expect(ticked(list)).toEqual(['Sent off']);
  });

  it("sets a scene's label, or takes it away", async () => {
    const host = novelHost();
    const { pane } = await openBoard(host);
    const list = submenu(menuOf(pane, 'Closing'), 'Set label');
    expect(list.outline).toEqual(['Anna', DANIEL, '---', 'No label', '---', 'Edit statuses and labels']);
    expect(ticked(list)).toEqual(['No label']);
    list.item(DANIEL).click();
    await rest(host);
    expect(host.patches).toEqual([{ path: CLOSING, patch: { set: { label: DANIEL }, remove: [] } }]);
    expect(colorOf(cardOf(pane, 'Closing'))).toBe('cyan');
    expect(seen(cardOf(pane, 'Closing'), 'spellbook-card-label-name')).toBe(DANIEL);
  });

  it('opens the statuses-and-labels window from the list, and from the menu of the header', async () => {
    const host = novelHost();
    const { pane } = await openBoard(host);
    submenu(menuOf(pane, 'Opening'), 'Set label').item('Edit statuses and labels').click();
    expect(openWindow()).toBeInstanceOf(TagListsModal as unknown as typeof StubModal);
    openWindow().close();

    const header = menuFrom(one(pane, 'spellbook-board-more'));
    expect(header.outline).toEqual(['Statuses and labels']);
    header.item('Statuses and labels').click();
    expect(openWindow()).toBeInstanceOf(TagListsModal as unknown as typeof StubModal);
  });

  it('switches off everything that changes the project while the project is read-only', async () => {
    const host = novelHost();
    host.open(novelTree(), novelIndex(), { readOnly: true });
    const { pane } = await openBoard(host);
    expect(menuOf(pane, 'Closing').outline).toEqual([
      'Open',
      'Open in new tab',
      '---',
      'Move earlier (off)',
      'Move later (off)',
      '---',
      'Set status (off)',
      'Set label (off)',
      'Edit synopsis (off)',
    ]);
  });
});

/** The small novel after its first scene was moved one place later. */
function moveInTreeOnce(tree: TreeNode[]): TreeNode[] {
  const [first, second, ...others] = tree;
  return [second as TreeNode, first as TreeNode, ...others];
}

describe('editing a synopsis', () => {
  it('opens a small window with a field of several lines, and saves through the host', async () => {
    const host = novelHost();
    const { pane } = await openBoard(host);
    menuOf(pane, 'Opening').item('Edit synopsis').click();
    const modal = openWindow();
    expect(modal).toBeInstanceOf(SynopsisModal as unknown as typeof StubModal);
    expect(modal.titleEl.text).toBe('Synopsis: Opening');
    expect(modal.titleEl.attrs['dir']).toBe('auto');
    const field = one(modal.contentEl, 'spellbook-synopsis-input');
    expect(field.tag).toBe('textarea');
    expect(field.attrs['dir']).toBe('auto');
    expect(field.value).toBe('Anna arrives in the old town.');
    expect(field.focused).toBe(true);

    typeInto(field, 'Anna arrives.\nNobody meets her.');
    // Enter alone is a new line, not "save".
    field.dispatch('keydown', { key: 'Enter', preventDefault: () => {} });
    expect(host.patches).toEqual([]);
    windowButtons(modal).confirm.click();
    await rest(host);
    expect(host.patches).toEqual([
      { path: OPENING, patch: { set: { synopsis: 'Anna arrives.\nNobody meets her.' }, remove: [] } },
    ]);
    expect(modal.isOpen).toBe(false);
    expect(seen(cardOf(pane, 'Opening'), 'spellbook-card-synopsis')).toBe('Anna arrives.\nNobody meets her.');
  });

  it('starts empty for a scene without one, with the preview as a hint, and saves with Cmd or Ctrl and Enter', async () => {
    const host = novelHost();
    const { pane, view } = await openBoard(host);
    view.showScope(folderScope('f-one'));
    menuOf(pane, 'The Letter').item('Edit synopsis').click();
    const modal = openWindow();
    const field = one(modal.contentEl, 'spellbook-synopsis-input');
    expect(field.value).toBe('');
    expect(field.attrs['placeholder']).toBe(LETTER_TEXT);

    typeInto(field, 'A letter home.');
    field.dispatch('keydown', { key: 'Enter', metaKey: true, preventDefault: () => {} });
    await rest(host);
    expect(host.patches).toEqual([{ path: LETTER, patch: { set: { synopsis: 'A letter home.' }, remove: [] } }]);
    const synopsis = one(cardOf(pane, 'The Letter'), 'spellbook-card-synopsis');
    expect(synopsis.text).toBe('A letter home.');
    expect(synopsis.hasClass('spellbook-is-derived')).toBe(false);
  });

  it('stays open with the reason when the host could not save, and closes on Cancel and on Escape', async () => {
    const host = novelHost();
    host.refusal = 'The note could not be written.';
    const { pane } = await openBoard(host);
    menuOf(pane, 'Opening').item('Edit synopsis').click();
    const modal = openWindow();
    typeInto(one(modal.contentEl, 'spellbook-synopsis-input'), 'Another one.');
    windowButtons(modal).confirm.click();
    await rest(host);
    expect(modal.isOpen).toBe(true);
    expect(one(modal.contentEl, 'spellbook-synopsis-message').text).toBe('The note could not be written.');
    windowButtons(modal).cancel.click();
    expect(modal.isOpen).toBe(false);

    menuOf(pane, 'Opening').item('Edit synopsis').click();
    openWindow().contentEl.dispatch('keydown', { key: 'Escape', preventDefault: () => {} });
    expect(openWindows()).toBe(0);
    // Saving what is already there writes nothing.
    host.refusal = null;
    menuOf(pane, 'Opening').item('Edit synopsis').click();
    windowButtons(openWindow()).confirm.click();
    await rest(host);
    expect(host.patches).toHaveLength(1);
    expect(openWindows()).toBe(0);
  });
});

describe('the card size and the columns', () => {
  it('offers three sizes, shows the one remembered on this device, and remembers another through the host', async () => {
    const host = novelHost();
    host.cardSize = 'small';
    const { pane } = await openBoard(host);
    const size = one(pane, 'spellbook-board-size');
    expect(size.tag).toBe('select');
    expect(size.attrs['aria-label']).toBe('Card size');
    expect(size.children.map((option) => [option.value, option.text])).toEqual([
      ['small', 'Small'],
      ['medium', 'Medium'],
      ['large', 'Large'],
    ]);
    expect(size.value).toBe('small');
    expect(grid(pane).hasClass('spellbook-size-small')).toBe(true);

    choose(size, 'large');
    expect(host.sizes).toEqual(['large']);
    expect(grid(pane).hasClass('spellbook-size-large')).toBe(true);
    expect(grid(pane).hasClass('spellbook-size-small')).toBe(false);
  });

  it('follows a size chosen on another board', async () => {
    const host = novelHost();
    const first = await openBoard(host);
    const second = await openBoard(host);
    choose(one(first.pane, 'spellbook-board-size'), 'small');
    expect(one(second.pane, 'spellbook-board-size').value).toBe('small');
    expect(grid(second.pane).hasClass('spellbook-size-small')).toBe(true);
    // A size the device never stored reads as the usual one.
    (host as { cardSize: unknown }).cardSize = 'huge';
    host.emit({ type: 'cardSize' });
    expect(one(second.pane, 'spellbook-board-size').value).toBe('medium');
  });

  it('sets as many columns as the engine says fit the measured width, and one at phone width', async () => {
    const host = novelHost();
    const board = await openBoard(host);
    const { pane } = board;
    const root = one(pane, 'spellbook-board');
    // Not measured yet: the stylesheet's single column stands.
    expect(grid(pane).style['gridTemplateColumns']).toBeUndefined();

    for (const width of [1200, 700, 500]) {
      widen(board, width);
      const layout = gridLayout(width, 'medium');
      expect(layout.columns).toBeGreaterThan(1);
      expect(grid(pane).style['gridTemplateColumns']).toBe(`repeat(${layout.columns}, minmax(0, 1fr))`);
      expect(grid(pane).style['gap']).toBe(`${layout.gap}px`);
      expect(root.hasClass('spellbook-is-single')).toBe(false);
    }

    // A phone held upright, whatever the kind of device: one column.
    widen(board, 343);
    expect(grid(pane).style['gridTemplateColumns']).toBe('repeat(1, minmax(0, 1fr))');
    expect(root.hasClass('spellbook-is-single')).toBe(true);

    // A hidden pane has no width: the columns stay as they were.
    widen(board, 0);
    expect(grid(pane).style['gridTemplateColumns']).toBe('repeat(1, minmax(0, 1fr))');

    // Larger cards: fewer of them fit side by side.
    widen(board, 700);
    const medium = gridLayout(700, 'medium').columns;
    choose(one(pane, 'spellbook-board-size'), 'large');
    const large = gridLayout(700, 'large').columns;
    expect(large).toBeLessThan(medium);
    expect(grid(pane).style['gridTemplateColumns']).toBe(`repeat(${large}, minmax(0, 1fr))`);
  });

  it('marks phones and tablets for larger buttons, by what Obsidian says the device is', async () => {
    const plain = await openBoard(novelHost());
    expect(one(plain.pane, 'spellbook-board').hasClass('spellbook-is-mobile')).toBe(false);
    Object.assign(StubPlatform, { isDesktop: false, isMobile: true, isPhone: true });
    const phone = await openBoard(novelHost());
    expect(one(phone.pane, 'spellbook-board').hasClass('spellbook-is-mobile')).toBe(true);
    expect(one(phone.pane, 'spellbook-board').hasClass('spellbook-is-phone')).toBe(true);
  });
});

describe('small changes and large books', () => {
  it('draws only the card of a scene that changed', async () => {
    const host = novelHost();
    const { pane } = await openBoard(host);
    const before = cardsOf(pane);
    const partsBefore = before.map((card) => card.all());
    host.asked.clear();

    host.setScene(CLOSING, { frontmatter: { status: 'Done', synopsis: 'The end.' }, words: 41 });
    await rest(host);
    const closing = cardOf(pane, 'Closing');
    expect(seen(closing, 'spellbook-card-synopsis')).toBe('The end.');
    expect(seen(closing, 'spellbook-card-status')).toBe('Done');
    expect(seen(closing, 'spellbook-card-words')).toBe('41 words');
    expect(one(pane, 'spellbook-board-summary').text).toBe('5 scenes, 312 words');
    // Every card is the element it was, with the same elements inside it.
    expect(cardsOf(pane)).toEqual(before);
    expect(cardsOf(pane).map((card) => card.all())).toEqual(partsBefore);
    // Only the changed scene was worked out again: the others were asked for once, for the sums.
    expect(host.asked.get(CLOSING)).toBe(2);
    expect(host.asked.get(OPENING)).toBe(1);
  });

  it("brings a folder card's sums up to date when a scene inside it changes", async () => {
    const host = novelHost();
    const { pane } = await openBoard(host);
    host.setScene(HEBREW_SCENE, { frontmatter: {}, words: 105 });
    await rest(host);
    expect(seen(cardOf(pane, 'Part one'), 'spellbook-card-words')).toBe('121 words');
  });

  it('takes several changes in a row in at once', async () => {
    const host = novelHost();
    const { pane } = await openBoard(host);
    host.asked.clear();
    host.setScene(OPENING, { frontmatter: { synopsis: 'One.' }, words: 1 });
    host.setScene(OPENING, { frontmatter: { synopsis: 'Two.' }, words: 2 });
    host.setScene(CLOSING, { frontmatter: { synopsis: 'Three.' }, words: 3 });
    // Nothing is drawn until the changes have all arrived.
    expect(seen(cardOf(pane, 'Opening'), 'spellbook-card-synopsis')).toBe('Anna arrives in the old town.');
    expect(host.timers.pending).toBe(1);
    await rest(host);
    expect(seen(cardOf(pane, 'Opening'), 'spellbook-card-synopsis')).toBe('Two.');
    expect(seen(cardOf(pane, 'Closing'), 'spellbook-card-synopsis')).toBe('Three.');
    expect(host.asked.get(OPENING)).toBe(2);
  });

  it('gives new colours to every card when a list changes', async () => {
    const host = novelHost();
    const { pane } = await openBoard(host);
    const index = novelIndex();
    host.open(novelTree(), { ...index, statuses: [{ name: 'To do', color: 'blue' }] });
    await rest(host);
    expect(colorOf(one(cardOf(pane, 'Opening'), 'spellbook-card-status'))).toBe('blue');
  });

  it('shows the first cards of a long board at once and fills in the rest a handful at a time', async () => {
    const host = new FakeHost();
    const tree: TreeNode[] = [];
    for (let number = 1; number <= 500; number++) {
      const path = `Manuscript/Scene ${number}.md`;
      tree.push({ kind: 'scene', path, title: `Scene ${number}`, missing: false });
      host.scenes.set(path, { frontmatter: { status: 'To do' }, text: `Text of scene ${number}.`, words: number });
    }
    host.open(tree, novelIndex());
    const { pane } = await openBoard(host);
    const filled = (): number => cardsOf(pane).filter((card) => card.children.length > 0).length;

    // Every card has its place from the start; only a handful are filled in.
    expect(cardsOf(pane)).toHaveLength(500);
    expect(filled()).toBe(FILL_CHUNK);
    expect(titles(pane).slice(0, 2)).toEqual(['Scene 1', 'Scene 2']);
    host.timers.advance(0);
    expect(filled()).toBe(500);
    expect(seen(cardOf(pane, 'Scene 500'), 'spellbook-card-synopsis')).toBe('Text of scene 500.');
    expect(one(pane, 'spellbook-board-summary').text).toBe('500 scenes, 125,250 words');

    // A change of order moves the cards; none is built or worked out again.
    const before = cardsOf(pane);
    host.asked.clear();
    host.setTree([...tree.slice(1), tree[0] as TreeNode]);
    await rest(host);
    expect(titles(pane).slice(-2)).toEqual(['Scene 500', 'Scene 1']);
    expect(new Set(cardsOf(pane))).toEqual(new Set(before));
    expect(cardsOf(pane)[499]).toBe(before[0]);
    // Each scene was looked at for the sums and to see that nothing changed, with no text read.
    expect(Math.max(...host.asked.values())).toBe(2);

    // One scene changes: one card is drawn.
    const untouched = cardOf(pane, 'Scene 250').all();
    host.setScene('Manuscript/Scene 7.md', { frontmatter: { synopsis: 'Seven.' }, words: 7 });
    await rest(host);
    expect(seen(cardOf(pane, 'Scene 7'), 'spellbook-card-synopsis')).toBe('Seven.');
    expect(cardOf(pane, 'Scene 250').all()).toEqual(untouched);
  });
});

describe('closing', () => {
  it('releases everything: listeners, timers, the drag engine, and what it watched', async () => {
    const host = new FakeHost();
    const tree: TreeNode[] = [];
    for (let number = 1; number <= 100; number++) {
      const path = `Manuscript/Scene ${number}.md`;
      tree.push({ kind: 'scene', path, title: `Scene ${number}`, missing: false });
      host.scenes.set(path, { frontmatter: {}, words: number });
    }
    host.open(tree);
    const { pane, shell } = await openBoard(host);
    const scroll = one(pane, 'spellbook-board-scroll');
    host.setScene('Manuscript/Scene 1.md', { frontmatter: {}, words: 2 });
    expect(host.listenerCount).toBe(1);
    // A drawing and the rest of the board are still waiting.
    expect(host.timers.pending).toBeGreaterThan(0);
    expect(scroll.listenerCount()).toBeGreaterThan(0);

    await shell.close();
    expect(host.listenerCount).toBe(0);
    expect(host.timers.pending).toBe(0);
    expect(scroll.listenerCount()).toBe(0);
    expect(fakeDocument.listenerCount()).toBe(0);
    expect(host.watched[host.watched.length - 1]).toEqual([]);
    expect(pane.children).toEqual([]);
    expect(pane.hasClass('spellbook-board-pane')).toBe(false);

    // What the host says afterwards falls on deaf ears.
    host.emit({ type: 'project' });
    host.timers.advance(1000);
    expect(pane.children).toEqual([]);
  });

  it('can be opened again after it was closed', async () => {
    const host = novelHost();
    const { pane, shell } = await openBoard(host);
    await shell.close();
    await shell.open();
    expect(titles(pane)).toEqual(['Opening', 'Part one', 'Ghost', 'Closing']);
    expect(host.listenerCount).toBe(1);
  });
});
