// The binder with the keyboard: rows that can take the keyboard, the arrow
// keys, Enter, and the one row at a time that the Tab key stops at. Driven
// through the stand-ins; key presses travel from the row up to the list, as
// they do in a browser.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sceneRef } from '../src/core/binderTree';
import { MISSING_LABEL } from '../src/views/binderView';
import {
  layOut,
  moreOf,
  picture,
  rowOf,
  scroller,
  selectedTitle,
  tap,
  titleOf,
  type,
} from './binderScreen';
import { HEBREW, LETTER, OPENING, clearScreen, fileAt, notices, novel, rest, stage, toolbarMenu } from './binderStage';
import type { Stage } from './binderStage';
import { FakeElement, Menu as StubMenu, fakeDocument, resetPlatform } from './obsidianStub';

beforeEach(() => {
  clearScreen();
});

afterEach(() => {
  resetPlatform();
  vi.restoreAllMocks();
});

/** The titles of the rows the Tab key stops at (there should be one). */
function tabStops(pane: FakeElement): string[] {
  return pane
    .withClass('spellbook-row-self')
    .filter((row) => row.attrs['tabindex'] === 0)
    .map(titleOf);
}

/** The title of the row the keyboard is on, or null when it is not on a row. */
function keyboardOn(): string | null {
  const active = fakeDocument.activeElement;
  return active?.hasClass('spellbook-row-self') ? titleOf(active) : null;
}

/** Put the keyboard on a row, as the Tab key or a click would. */
function focus(s: Stage, title: string): FakeElement {
  const row = rowOf(s.pane, title);
  row.focus();
  return row;
}

/** Press a key on the row the keyboard is on. */
function press(key: string, event: Record<string, unknown> = {}): ReturnType<typeof type> {
  const active = fakeDocument.activeElement;
  if (!active) throw new Error('the keyboard is nowhere');
  return type(active, key, event);
}

const ALL_ROWS = [
  'Manuscript',
  'Opening',
  'Part one',
  'The Letter',
  'חלק פנימי',
  'מכתב לאחותי',
  'Ghost',
  'Unfiled',
  'Loose',
  'Research',
  'Maps',
  'City',
  'Trains',
];

describe('the Tab key', () => {
  it('can reach every row, but stops at one of them only: the first, when nothing is selected', async () => {
    const s = await stage(novel());
    for (const row of s.pane.withClass('spellbook-row-self')) {
      expect([0, -1], titleOf(row)).toContain(row.attrs['tabindex']);
    }
    expect(tabStops(s.pane)).toEqual(['Manuscript']);
  });

  it('stops at the selected row, and at its "more" button after it', async () => {
    const s = await stage(novel());
    tap(rowOf(s.pane, 'The Letter'));
    await rest(s);
    expect(tabStops(s.pane)).toEqual(['The Letter']);
    expect(moreOf(s.pane, 'The Letter')?.attrs['tabindex']).toBe(0);
    for (const title of ['Opening', 'Part one', 'Loose', 'Trains']) {
      expect(moreOf(s.pane, title)?.attrs['tabindex'], title).toBe(-1);
    }

    // The note the writer moves to takes the stop along.
    s.fake.workspace.setActiveFile(fileAt(HEBREW));
    expect(tabStops(s.pane)).toEqual(['מכתב לאחותי']);
    expect(moreOf(s.pane, 'The Letter')?.attrs['tabindex']).toBe(-1);
  });

  it('stops where the keyboard was put, by whatever means', async () => {
    const s = await stage(novel());
    focus(s, 'Research'); // a row that cannot be selected
    expect(tabStops(s.pane)).toEqual(['Research']);
    (moreOf(s.pane, 'Loose') as FakeElement).focus(); // straight on a button
    expect(tabStops(s.pane)).toEqual(['Loose']);
    expect(moreOf(s.pane, 'Loose')?.attrs['tabindex']).toBe(0);
  });

  it('still has one stop after the list was drawn again', async () => {
    const s = await stage(novel());
    focus(s, 'Research');
    s.vault.external.create('Novel/Research/Bridges.md');
    await rest(s);
    expect(tabStops(s.pane)).toEqual(['Research']);

    // A click on a row selects it and, in a browser, puts the keyboard on it too.
    tap(rowOf(s.pane, 'The Letter'));
    focus(s, 'The Letter');
    await s.store.stepNode(sceneRef('Manuscript/The Letter.md'), 'down');
    await rest(s);
    expect(tabStops(s.pane)).toEqual(['The Letter']);
  });

  it('stops at the selected row after a new drawing when the keyboard was not in the list', async () => {
    const s = await stage(novel());
    tap(rowOf(s.pane, 'The Letter'));
    await s.store.stepNode(sceneRef('Manuscript/The Letter.md'), 'down');
    await rest(s);
    expect(tabStops(s.pane)).toEqual(['The Letter']);
    expect(keyboardOn()).toBeNull(); // and the keyboard was not pulled into the list
  });

  it('stops at the folder when the row it would stop at is folded away', async () => {
    const s = await stage(novel());
    tap(rowOf(s.pane, 'מכתב לאחותי'));
    await rest(s);
    toolbarMenu(s.pane).item('Collapse all').click();
    expect(picture(s.pane)).toContain('  > Part one 8');
    expect(tabStops(s.pane)).toEqual(['Part one']);

    // Folding by hand does the same.
    toolbarMenu(s.pane).item('Expand all').click();
    focus(s, 'מכתב לאחותי');
    expect(tabStops(s.pane)).toEqual(['מכתב לאחותי']);
    tap(rowOf(s.pane, 'Research')); // folds another part of the list: no matter
    expect(tabStops(s.pane)).toEqual(['מכתב לאחותי']);
    tap(rowOf(s.pane, 'Manuscript'));
    expect(tabStops(s.pane)).toEqual(['Manuscript']);
  });
});

describe('Up and Down', () => {
  it('go from row to row through the whole list, and stop at its ends', async () => {
    const s = await stage(novel());
    focus(s, 'Manuscript');
    const walked: string[] = ['Manuscript'];
    for (let step = 1; step < ALL_ROWS.length; step++) {
      expect(press('ArrowDown').defaultPrevented).toBe(true); // the list itself must not scroll
      walked.push(keyboardOn() ?? '?');
    }
    expect(walked).toEqual(ALL_ROWS);
    press('ArrowDown');
    expect(keyboardOn()).toBe('Trains');

    const back: string[] = [];
    for (let step = 1; step < ALL_ROWS.length; step++) {
      press('ArrowUp');
      back.push(keyboardOn() ?? '?');
    }
    expect(back).toEqual([...ALL_ROWS].reverse().slice(1));
    press('ArrowUp');
    expect(keyboardOn()).toBe('Manuscript');
    expect(s.vault.writes).toEqual([]);
  });

  it('skip what is folded away', async () => {
    const s = await stage(novel());
    tap(rowOf(s.pane, 'Part one'));
    tap(rowOf(s.pane, 'Unfiled'));
    focus(s, 'Opening');
    press('ArrowDown');
    expect(keyboardOn()).toBe('Part one');
    press('ArrowDown');
    expect(keyboardOn()).toBe('Ghost');
    press('ArrowDown');
    expect(keyboardOn()).toBe('Unfiled');
    press('ArrowDown');
    expect(keyboardOn()).toBe('Research');
    press('ArrowUp');
    press('ArrowUp');
    press('ArrowUp');
    expect(keyboardOn()).toBe('Part one');
  });

  it('select the row they arrive at, and move the Tab stop along', async () => {
    const s = await stage(novel());
    focus(s, 'Opening');
    press('ArrowDown');
    press('ArrowDown');
    expect(selectedTitle(s.pane)).toBe('The Letter');
    expect(tabStops(s.pane)).toEqual(['The Letter']);
    // A heading cannot be selected: the selection stays, the keyboard goes on.
    focus(s, 'Ghost');
    press('ArrowDown');
    expect(keyboardOn()).toBe('Unfiled');
    expect(tabStops(s.pane)).toEqual(['Unfiled']);
    expect(s.host.opened).toEqual([]); // moving about opens nothing
  });

  it('scroll the list just far enough to show the row', async () => {
    const s = await stage(novel());
    layOut(s.pane, 90); // room for three rows: the list ends at 190
    focus(s, 'Opening');
    press('ArrowDown'); // "Part one" ends exactly at the edge
    expect(scroller(s.pane).scrollTop).toBe(0);
    press('ArrowDown'); // "The Letter" is one row further down
    expect(scroller(s.pane).scrollTop).toBe(30);
  });

  it('work from a row\'s "more" button as well', async () => {
    const s = await stage(novel());
    (moreOf(s.pane, 'Opening') as FakeElement).focus();
    type(moreOf(s.pane, 'Opening') as FakeElement, 'ArrowDown');
    expect(keyboardOn()).toBe('Part one');
  });
});

describe('Left and Right', () => {
  it('fold and unfold a folder, without drawing anything again', async () => {
    const s = await stage(novel());
    focus(s, 'Part one');
    expect(press('ArrowLeft').defaultPrevented).toBe(true);
    expect(picture(s.pane)).toContain('  > Part one 8');
    expect(keyboardOn()).toBe('Part one');
    press('ArrowRight');
    expect(picture(s.pane)).toContain('  v Part one 8');
    expect(keyboardOn()).toBe('Part one');
    expect(s.vault.writes).toEqual([]);
  });

  it('step out to the folder around a row, and in to a folder\'s first row', async () => {
    const s = await stage(novel());
    focus(s, 'מכתב לאחותי');
    press('ArrowLeft'); // a scene has nothing to fold: out to its folder
    expect(keyboardOn()).toBe('חלק פנימי');
    press('ArrowLeft'); // folds it
    expect(picture(s.pane)).toContain('    > חלק פנימי 4');
    press('ArrowLeft'); // already folded: out again
    expect(keyboardOn()).toBe('Part one');
    press('ArrowLeft');
    press('ArrowLeft');
    expect(keyboardOn()).toBe('Manuscript');

    press('ArrowRight'); // open already: in to its first row
    expect(keyboardOn()).toBe('Opening');
    press('ArrowRight'); // a scene: nowhere to go
    expect(keyboardOn()).toBe('Opening');
    focus(s, 'Part one');
    press('ArrowRight'); // unfolds
    press('ArrowRight'); // steps in
    expect(keyboardOn()).toBe('The Letter');
  });

  it('do nothing at the outermost level, and nothing for a folder with nothing in it', async () => {
    const s = await stage(novel());
    await s.store.addFolder('Empty');
    await rest(s);
    focus(s, 'Empty');
    press('ArrowRight');
    expect(keyboardOn()).toBe('Empty');
    focus(s, 'Research');
    press('ArrowLeft'); // folds the section
    press('ArrowLeft'); // nothing is around a section
    expect(keyboardOn()).toBe('Research');
  });

  it('swap when Obsidian itself reads from right to left', async () => {
    const s = await stage(novel());
    s.pane.setAttr('dir', 'rtl');
    focus(s, 'Part one');
    press('ArrowRight'); // "back" in a right-to-left app
    expect(picture(s.pane)).toContain('  > Part one 8');
    press('ArrowLeft'); // "forward"
    expect(picture(s.pane)).toContain('  v Part one 8');
    press('ArrowLeft');
    expect(keyboardOn()).toBe('The Letter');
    press('ArrowRight');
    expect(keyboardOn()).toBe('Part one');
  });
});

describe('Enter', () => {
  it('opens a scene in the tab the writer was working in, and in a new tab with Cmd or Ctrl', async () => {
    const s = await stage(novel());
    focus(s, 'Opening');
    expect(press('Enter').defaultPrevented).toBe(true);
    await rest(s);
    expect(s.host.opened).toEqual([{ path: OPENING, where: false }]);

    focus(s, 'The Letter');
    press('Enter', { metaKey: true });
    press('Enter', { ctrlKey: true });
    await rest(s);
    expect(s.host.opened.slice(1)).toEqual([
      { path: LETTER, where: 'tab' },
      { path: LETTER, where: 'tab' },
    ]);
  });

  it('opens unfiled notes and research notes too', async () => {
    const s = await stage(novel());
    focus(s, 'Loose');
    press('Enter');
    focus(s, 'City');
    press('Enter');
    await rest(s);
    expect(s.host.opened.map((entry) => entry.path)).toEqual(['Novel/Manuscript/Loose.md', 'Novel/Research/Maps/City.md']);
  });

  it('folds and unfolds a folder, and says why a missing entry cannot be opened', async () => {
    const s = await stage(novel());
    focus(s, 'Part one');
    press('Enter');
    expect(picture(s.pane)).toContain('  > Part one 8');
    press('Enter');
    expect(picture(s.pane)).toContain('  v Part one 8');

    focus(s, 'Ghost');
    press('Enter');
    await rest(s);
    expect(notices()).toEqual([`"Ghost": ${MISSING_LABEL}.`]);
    expect(s.host.opened).toEqual([]);
  });

  it('on a row\'s "more" button opens the menu, not the note', async () => {
    const s = await stage(novel());
    const button = moreOf(s.pane, 'Opening') as FakeElement;
    button.focus();
    type(button, 'Enter');
    await rest(s);
    expect(StubMenu.shown).toHaveLength(1);
    expect(s.host.opened).toEqual([]);
  });
});

describe('other keys', () => {
  it('are left alone', async () => {
    const s = await stage(novel());
    focus(s, 'Opening');
    for (const key of ['a', ' ', 'Tab', 'Escape', 'Home', 'F2']) {
      expect(press(key).defaultPrevented, key).toBe(false);
    }
    // The arrows with Alt or Shift are someone else's shortcuts; so are Cmd and Ctrl with an arrow.
    expect(press('ArrowDown', { altKey: true }).defaultPrevented).toBe(false);
    expect(press('ArrowDown', { shiftKey: true }).defaultPrevented).toBe(false);
    expect(press('ArrowDown', { metaKey: true }).defaultPrevented).toBe(false);
    expect(press('ArrowLeft', { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(keyboardOn()).toBe('Opening');
    await rest(s);
    expect(s.host.opened).toEqual([]);
  });

  it('pressed elsewhere in the panel are not the list\'s', async () => {
    const s = await stage(novel());
    const heading = s.pane.withClass('spellbook-binder-heading')[0] as FakeElement;
    expect(type(heading, 'ArrowDown').defaultPrevented).toBe(false);
    expect(keyboardOn()).toBeNull();
  });
});

describe('where the keyboard is when the list is drawn again', () => {
  it('stays on the row it was on, wherever that row has moved to', async () => {
    const s = await stage(novel());
    const before = focus(s, 'The Letter');
    await s.store.stepNode(sceneRef('Manuscript/The Letter.md'), 'down');
    await rest(s);
    expect(picture(s.pane).slice(2, 6)).toEqual(['  v Part one 8', '    v חלק פנימי 4', '      מכתב לאחותי 4', '    The Letter 4']);
    expect(keyboardOn()).toBe('The Letter');
    // It is the very same row, not a new one that looks the same.
    expect(rowOf(s.pane, 'The Letter')).toBe(before);
    press('ArrowUp');
    expect(keyboardOn()).toBe('מכתב לאחותי');
  });

  it('stays on a row\'s button', async () => {
    const s = await stage(novel());
    const button = moreOf(s.pane, 'Opening') as FakeElement;
    button.focus();
    s.vault.external.create('Novel/Research/Bridges.md');
    await rest(s);
    expect(fakeDocument.activeElement).toBe(moreOf(s.pane, 'Opening'));
  });

  it('is not pulled into the list from somewhere else', async () => {
    const s = await stage(novel());
    const elsewhere = new FakeElement('textarea'); // the note being written, say
    elsewhere.focus();
    s.vault.external.create('Novel/Research/Bridges.md');
    await s.store.stepNode(sceneRef('Manuscript/The Letter.md'), 'down');
    await rest(s);
    expect(fakeDocument.activeElement).toBe(elsewhere);
  });

  it('is left where it is when the row it was on is gone', async () => {
    const s = await stage(novel());
    focus(s, 'Loose');
    s.vault.external.delete('Novel/Manuscript/Loose.md');
    await rest(s);
    expect(picture(s.pane)).not.toContain('  Loose 2');
    expect(keyboardOn()).toBeNull();
    // The Tab key still has a row to come back to.
    expect(tabStops(s.pane)).toHaveLength(1);
  });
});
