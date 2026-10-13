// Dragging in the binder: scenes and folders to another place, unfiled notes
// into the binder. Driven through the stand-ins: the rows get places on the
// "screen" from layOut(), and the pointer is moved as a browser would report
// it. How a drag looks and feels can only be judged in Obsidian; these tests
// check what it changes.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ORDER_DEBOUNCE_MS } from '../src/core/projectStore';
import { SPRING_OPEN_MS, TOUCH_HOLD_MS } from '../src/ui/dragDrop';
import { MISSING_LABEL } from '../src/views/binderView';
import {
  LIST_TOP,
  ROW_HEIGHT,
  carry,
  gripOf,
  inRow,
  layOut,
  letGo,
  moreOf,
  one,
  partOf,
  picture,
  point,
  rowOf,
  scroller,
  selectedTitle,
  tap,
} from './binderScreen';
import { FRAME_MS, INDEX, clearScreen, novel, rest, stage } from './binderStage';
import type { Stage, StageOptions } from './binderStage';
import { MemoryVault } from './memoryVault';
import { Menu as StubMenu, fakeDocument, fakeWindow, resetPlatform } from './obsidianStub';
import type { FakeElement } from './obsidianStub';
import { binderOnDisk, foldedIn, seedProject } from './storeHarness';

beforeEach(() => {
  clearScreen();
});

afterEach(() => {
  resetPlatform();
  vi.restoreAllMocks();
});

/** The binder panel on a vault, with its rows laid out on the stand-in screen. */
async function laid(vault: MemoryVault = novel(), options: StageOptions = {}): Promise<Stage> {
  const s = await stage(vault, options);
  layOut(s.pane);
  return s;
}

/** Let everything come to rest, then lay the rows out again where they now are. */
async function settled(s: Stage): Promise<void> {
  await rest(s);
  layOut(s.pane);
}

/** The Manuscript section as a reader sees it, without the section's own line. */
function manuscript(pane: FakeElement): string[] {
  const lines = picture(pane);
  const end = lines.findIndex((line, index) => index > 0 && !line.startsWith(' '));
  return lines.slice(1, end < 0 ? undefined : end).map((line) => line.slice(2));
}

const ghosts = (): FakeElement[] => fakeDocument.body.withClass('spellbook-drag-ghost');
const line = (): FakeElement => one(fakeDocument.body, 'spellbook-drop-line');
const lineShown = (): boolean => line().style['display'] !== 'none';
const targets = (pane: FakeElement): string[] =>
  pane.withClass('spellbook-is-drop-target').map((row) => partOf(row, 'spellbook-title')?.text ?? '');
const indexWrite = { op: 'updateFrontmatter', path: INDEX };
/** Somewhere inside the list, sideways. */
const X = 60;

const GHOST_ROW = `! Ghost -- ${MISSING_LABEL}`;

// The novel of tests/binderStage.ts, laid out:
//   Manuscript
//     Opening
//     Part one
//       The Letter
//       חלק פנימי
//         מכתב לאחותי
//     Ghost (missing)
//   Unfiled
//     Loose
//   Research ...

describe('dragging a scene', () => {
  it('moves it to below the scene it is dropped on the lower half of, in one write of the index', async () => {
    const s = await laid();
    const opening = rowOf(s.pane, 'Opening');
    const letter = rowOf(s.pane, 'The Letter');
    carry(opening, X, inRow(letter, 0.75));

    // While it is carried: a ghost, the row dimmed, and a line under "The Letter", set in like it.
    expect(ghosts()).toHaveLength(1);
    expect(opening.hasClass('spellbook-is-dragged')).toBe(true);
    expect(lineShown()).toBe(true);
    expect(line().style['transform']).toBe(`translate(${letter.rect.left}px, ${letter.rect.bottom}px)`);
    expect(line().style['width']).toBe(`${letter.rect.width}px`);
    expect(targets(s.pane)).toEqual([]);
    expect(s.vault.writes).toEqual([]); // nothing is changed until it is dropped

    letGo(opening, X, inRow(letter, 0.75));
    await rest(s);
    expect(manuscript(s.pane)).toEqual([
      'v Part one 11',
      '  The Letter 4',
      '  Opening 3',
      '  v חלק פנימי 4',
      '    מכתב לאחותי 4',
      GHOST_ROW,
    ]);
    expect(s.vault.writes).toEqual([indexWrite]);
    expect(selectedTitle(s.pane)).toBe('Opening');
    expect(ghosts()).toEqual([]);
    expect(s.host.opened).toEqual([]); // a drag opens nothing
    // No file was moved: binder folders are not folders on disk.
    expect(s.vault.has('Novel/Manuscript/Opening.md')).toBe(true);
  });

  it('moves it to above the scene it is dropped on the upper half of', async () => {
    const s = await laid();
    const hebrew = rowOf(s.pane, 'מכתב לאחותי');
    const opening = rowOf(s.pane, 'Opening');
    carry(hebrew, X, inRow(opening, 0.2));
    expect(line().style['transform']).toBe(`translate(${opening.rect.left}px, ${opening.rect.top}px)`);
    letGo(hebrew, X, inRow(opening, 0.2));
    await rest(s);
    expect(manuscript(s.pane).slice(0, 3)).toEqual(['מכתב לאחותי 4', 'Opening 3', 'v Part one 4']);
  });

  it('shows the title on the ghost, in the title\'s own direction', async () => {
    const s = await laid();
    const hebrew = rowOf(s.pane, 'מכתב לאחותי');
    carry(hebrew, X, inRow(hebrew, 0.5) + 80);
    const title = one(fakeDocument.body, 'spellbook-drag-ghost-title');
    expect(title.text).toBe('מכתב לאחותי');
    expect(title.attrs['dir']).toBe('auto');
  });

  it('writes one scene note\'s order key afterwards, and no other note', async () => {
    const s = await laid();
    const opening = rowOf(s.pane, 'Opening');
    carry(opening, X, inRow(rowOf(s.pane, 'The Letter'), 0.75));
    letGo(opening, X, inRow(rowOf(s.pane, 'The Letter'), 0.75));
    await rest(s);
    s.vault.clearWrites();
    s.timers.advance(ORDER_DEBOUNCE_MS);
    await rest(s);
    expect(s.vault.writes).toEqual([{ op: 'updateFrontmatter', path: 'Novel/Manuscript/Opening.md' }]);
  });
});

describe('dropping on a folder', () => {
  it('puts the scene inside, at the end, when dropped on the middle of the folder\'s row', async () => {
    const s = await laid();
    const opening = rowOf(s.pane, 'Opening');
    const folder = rowOf(s.pane, 'Part one');
    carry(opening, X, inRow(folder, 0.5));
    // The folder is highlighted, and there is no line.
    expect(targets(s.pane)).toEqual(['Part one']);
    expect(lineShown()).toBe(false);

    letGo(opening, X, inRow(folder, 0.5));
    await rest(s);
    expect(manuscript(s.pane)).toEqual([
      'v Part one 11',
      '  The Letter 4',
      '  v חלק פנימי 4',
      '    מכתב לאחותי 4',
      '  Opening 3',
      GHOST_ROW,
    ]);
    expect(targets(s.pane)).toEqual([]);
  });

  it('puts it before the folder when dropped on the upper quarter', async () => {
    const s = await laid();
    const letter = rowOf(s.pane, 'The Letter');
    const folder = rowOf(s.pane, 'Part one');
    carry(letter, X, inRow(folder, 0.1));
    expect(targets(s.pane)).toEqual([]);
    expect(line().style['transform']).toBe(`translate(${folder.rect.left}px, ${folder.rect.top}px)`);
    letGo(letter, X, inRow(folder, 0.1));
    await rest(s);
    expect(manuscript(s.pane).slice(0, 3)).toEqual(['Opening 3', 'The Letter 4', 'v Part one 4']);
  });

  it('puts it after a folded folder when dropped on the lower quarter', async () => {
    const s = await laid();
    tap(rowOf(s.pane, 'חלק פנימי'));
    layOut(s.pane);
    const opening = rowOf(s.pane, 'Opening');
    const inner = rowOf(s.pane, 'חלק פנימי');
    carry(opening, X, inRow(inner, 0.9));
    expect(line().style['transform']).toBe(`translate(${inner.rect.left}px, ${inner.rect.bottom}px)`);
    letGo(opening, X, inRow(inner, 0.9));
    await rest(s);
    expect(manuscript(s.pane)).toEqual(['v Part one 11', '  The Letter 4', '  > חלק פנימי 4', '  Opening 3', GHOST_ROW]);
  });

  it('puts it first in an open folder when dropped on the lower quarter: the line is set in like the rows inside', async () => {
    const s = await laid();
    const opening = rowOf(s.pane, 'Opening');
    const folder = rowOf(s.pane, 'Part one');
    const letter = rowOf(s.pane, 'The Letter');
    carry(opening, X, inRow(folder, 0.9));
    expect(line().style['transform']).toBe(`translate(${letter.rect.left}px, ${folder.rect.bottom}px)`);
    expect(line().style['width']).toBe(`${letter.rect.width}px`);
    letGo(opening, X, inRow(folder, 0.9));
    await rest(s);
    expect(manuscript(s.pane).slice(0, 3)).toEqual(['v Part one 11', '  Opening 3', '  The Letter 4']);
  });

  it('opens a folded folder when the pointer rests on it, and remembers it as open', async () => {
    const s = await laid();
    const folder = rowOf(s.pane, 'Part one');
    tap(folder);
    layOut(s.pane);
    expect(foldedIn(s.storage)).toEqual({ [INDEX]: ['folder:f-one'] });
    // As in a browser: when the folder opens, its rows have places at once.
    const item = folder.parent as FakeElement;
    const toggle = item.toggleClass.bind(item);
    item.toggleClass = (classes: string | string[], value: boolean): void => {
      toggle(classes, value);
      layOut(s.pane);
    };

    const opening = rowOf(s.pane, 'Opening');
    carry(opening, X, inRow(folder, 0.5));
    expect(targets(s.pane)).toEqual(['Part one']);
    s.timers.advance(SPRING_OPEN_MS - 1);
    expect(picture(s.pane)).toContain('  > Part one 8');
    s.timers.advance(1);
    expect(picture(s.pane)).toContain('  v Part one 8');
    expect(foldedIn(s.storage)).toBeNull();
    expect(ghosts()).toHaveLength(1); // still being carried

    // The rows that came into view can be dropped on.
    const letter = rowOf(s.pane, 'The Letter');
    point(gripOf(opening).target, 'pointermove', X, inRow(letter, 0.75));
    expect(line().style['transform']).toBe(`translate(${letter.rect.left}px, ${letter.rect.bottom}px)`);
    letGo(opening, X, inRow(letter, 0.75));
    await rest(s);
    expect(manuscript(s.pane).slice(0, 3)).toEqual(['v Part one 11', '  The Letter 4', '  Opening 3']);
  });

  it('does not open a folded folder that the pointer only passes over', async () => {
    const s = await laid();
    const folder = rowOf(s.pane, 'Part one');
    tap(folder);
    layOut(s.pane);
    const opening = rowOf(s.pane, 'Opening');
    carry(opening, X, inRow(folder, 0.5));
    s.timers.advance(SPRING_OPEN_MS - 100);
    point(gripOf(opening).target, 'pointermove', X, inRow(rowOf(s.pane, 'Ghost'), 0.75));
    s.timers.advance(SPRING_OPEN_MS);
    expect(picture(s.pane)).toContain('  > Part one 8');
  });
});

describe('dragging a folder', () => {
  it('moves it with everything in it', async () => {
    const s = await laid();
    const inner = rowOf(s.pane, 'חלק פנימי');
    const opening = rowOf(s.pane, 'Opening');
    carry(inner, X, inRow(opening, 0.2));
    letGo(inner, X, inRow(opening, 0.2));
    await rest(s);
    expect(manuscript(s.pane)).toEqual([
      'v חלק פנימי 4',
      '  מכתב לאחותי 4',
      'Opening 3',
      'v Part one 4',
      '  The Letter 4',
      GHOST_ROW,
    ]);
    expect(s.vault.writes).toEqual([indexWrite]);
    expect(selectedTitle(s.pane)).toBe('חלק פנימי');
  });

  it('cannot be dropped into itself or into anything inside it: nothing is shown, nothing happens', async () => {
    const s = await laid();
    const folder = rowOf(s.pane, 'Part one');
    const places: Array<[string, number]> = [
      ['Part one', 0.5], // on itself
      ['The Letter', 0.2], // next to a scene inside it
      ['The Letter', 0.8],
      ['חלק פנימי', 0.5], // into a folder inside it
      ['חלק פנימי', 0.1],
      ['מכתב לאחותי', 0.8], // next to a scene two levels down
    ];
    for (const [title, part] of places) {
      const y = inRow(rowOf(s.pane, title), part);
      carry(folder, X, y);
      expect(lineShown(), `${title} ${part}`).toBe(false);
      expect(targets(s.pane), `${title} ${part}`).toEqual([]);
      letGo(folder, X, y);
      await rest(s);
    }
    expect(s.vault.writes).toEqual([]);
    expect(manuscript(s.pane)[1]).toBe('v Part one 8');
  });

  it('can be dropped out of the folder it is in', async () => {
    const s = await laid();
    const inner = rowOf(s.pane, 'חלק פנימי');
    const ghost = rowOf(s.pane, 'Ghost');
    carry(inner, X, inRow(ghost, 0.8));
    letGo(inner, X, inRow(ghost, 0.8));
    await rest(s);
    expect(manuscript(s.pane)).toEqual([
      'Opening 3',
      'v Part one 4',
      '  The Letter 4',
      GHOST_ROW,
      'v חלק פנימי 4',
      '  מכתב לאחותי 4',
    ]);
  });
});

describe('a drop that would change nothing', () => {
  it('shows no line and writes nothing', async () => {
    const s = await laid();
    const opening = rowOf(s.pane, 'Opening');
    const places: Array<[string, number]> = [
      ['Opening', 0.2], // above itself
      ['Opening', 0.8], // below itself
      ['Part one', 0.1], // above the row that already follows it
      ['Manuscript', 0.5], // the start of the binder, where it already is
    ];
    for (const [title, part] of places) {
      const y = inRow(rowOf(s.pane, title), part);
      carry(opening, X, y);
      expect(lineShown(), `${title} ${part}`).toBe(false);
      letGo(opening, X, y);
      await rest(s);
    }
    expect(s.vault.writes).toEqual([]);
    expect(manuscript(s.pane)[0]).toBe('Opening 3');
  });

  it('does nothing when the row is let go beside the list, or far below the binder', async () => {
    const s = await laid();
    const opening = rowOf(s.pane, 'Opening');
    const letter = rowOf(s.pane, 'The Letter');
    for (const [x, y] of [
      [400, inRow(letter, 0.8)], // beside the list
      [-5, inRow(letter, 0.8)],
      [X, inRow(rowOf(s.pane, 'Trains'), 0.5)], // on the research notes
      [X, LIST_TOP - 30], // above the list, on the header
    ] as const) {
      carry(opening, x, y);
      expect(lineShown(), `${x},${y}`).toBe(false);
      expect(targets(s.pane)).toEqual([]);
      letGo(opening, x, y);
      await rest(s);
    }
    expect(s.vault.writes).toEqual([]);
  });
});

describe('the ends of the binder', () => {
  it('takes a drop just below the last row as the end of the top level', async () => {
    const s = await laid();
    const letter = rowOf(s.pane, 'The Letter');
    const last = rowOf(s.pane, 'Ghost');
    carry(letter, X, last.rect.bottom + 5);
    // The line sits under the last row, set in like a row of the top level.
    const opening = rowOf(s.pane, 'Opening');
    expect(line().style['transform']).toBe(`translate(${opening.rect.left}px, ${last.rect.bottom}px)`);
    letGo(letter, X, last.rect.bottom + 5);
    await rest(s);
    expect(manuscript(s.pane)).toEqual(['Opening 3', 'v Part one 4', '  v חלק פנימי 4', '    מכתב לאחותי 4', GHOST_ROW, 'The Letter 4']);
  });

  it('takes a drop on the Manuscript heading as the start', async () => {
    const s = await laid();
    const letter = rowOf(s.pane, 'The Letter');
    const heading = rowOf(s.pane, 'Manuscript');
    carry(letter, X, inRow(heading, 0.5));
    expect(line().style['transform']).toBe(`translate(${rowOf(s.pane, 'Opening').rect.left}px, ${heading.rect.bottom}px)`);
    letGo(letter, X, inRow(heading, 0.5));
    await rest(s);
    expect(manuscript(s.pane).slice(0, 3)).toEqual(['The Letter 4', 'Opening 3', 'v Part one 4']);
  });

  it('lets rows be dropped next to an entry whose note is missing', async () => {
    const s = await laid();
    const letter = rowOf(s.pane, 'The Letter');
    const missing = rowOf(s.pane, 'Ghost');
    carry(letter, X, inRow(missing, 0.2));
    expect(lineShown()).toBe(true);
    letGo(letter, X, inRow(missing, 0.2));
    await rest(s);
    expect(manuscript(s.pane).slice(-2)).toEqual(['The Letter 4', GHOST_ROW]);
  });
});

describe('dragging an unfiled note into the binder', () => {
  it('lists it at the place it is dropped, in one write of the index', async () => {
    const s = await laid();
    const filed = vi.spyOn(s.store, 'addUnfiledToBinder');
    const moved = vi.spyOn(s.store, 'moveNode');
    const loose = rowOf(s.pane, 'Loose');
    const letter = rowOf(s.pane, 'The Letter');
    carry(loose, X, inRow(letter, 0.2));
    expect(lineShown()).toBe(true);
    letGo(loose, X, inRow(letter, 0.2));
    await rest(s);

    expect(manuscript(s.pane)).toEqual([
      'Opening 3',
      'v Part one 10',
      '  Loose 2',
      '  The Letter 4',
      '  v חלק פנימי 4',
      '    מכתב לאחותי 4',
      GHOST_ROW,
    ]);
    expect(picture(s.pane)).not.toContain('v Unfiled'); // nothing is left unfiled
    expect(s.vault.writes).toEqual([indexWrite]);
    expect(filed).toHaveBeenCalledTimes(1);
    expect(moved).not.toHaveBeenCalled();
    expect(selectedTitle(s.pane)).toBe('Loose');
    // The note itself was not touched.
    expect(s.vault.bodyOf('Novel/Manuscript/Loose.md')).toBe('Two words');
  });

  it('can be dropped into a folder, and into a binder that is still empty', async () => {
    const s = await laid();
    const loose = rowOf(s.pane, 'Loose');
    carry(loose, X, inRow(rowOf(s.pane, 'חלק פנימי'), 0.5));
    expect(targets(s.pane)).toEqual(['חלק פנימי']);
    letGo(loose, X, inRow(rowOf(s.pane, 'חלק פנימי'), 0.5));
    await rest(s);
    expect(manuscript(s.pane).slice(3, 6)).toEqual(['  v חלק פנימי 6', '    מכתב לאחותי 4', '    Loose 2']);

    const vault = new MemoryVault();
    seedProject(vault, { binder: [] });
    vault.seed('Novel/Manuscript/First.md', { body: 'Just three words' });
    const empty = await laid(vault);
    expect(picture(empty.pane).slice(0, 4)).toEqual(['v Manuscript 0', '  (No scenes yet.)', 'v Unfiled', '  First 3']);
    const first = rowOf(empty.pane, 'First');
    carry(first, X, LIST_TOP + ROW_HEIGHT * 1.5); // on "No scenes yet."
    expect(targets(empty.pane)).toEqual(['Manuscript']); // the binder as a whole takes it
    letGo(first, X, LIST_TOP + ROW_HEIGHT * 1.5);
    await rest(empty);
    expect(picture(empty.pane).slice(0, 2)).toEqual(['v Manuscript 3', '  First 3']);
    expect(binderOnDisk(vault, INDEX)).toEqual(['Manuscript/First.md']);
  });

  it('can be dropped on the Manuscript heading while the manuscript is folded shut: it goes to the end, and the manuscript opens', async () => {
    const s = await laid();
    tap(rowOf(s.pane, 'Manuscript'));
    layOut(s.pane);
    expect(picture(s.pane)[0]).toBe('> Manuscript 11');
    const loose = rowOf(s.pane, 'Loose');
    const heading = rowOf(s.pane, 'Manuscript');
    carry(loose, X, inRow(heading, 0.5));
    expect(targets(s.pane)).toEqual(['Manuscript']);
    expect(lineShown()).toBe(false);
    letGo(loose, X, inRow(heading, 0.5));
    await rest(s);
    expect(manuscript(s.pane).slice(-2)).toEqual([GHOST_ROW, 'Loose 2']);
    expect(picture(s.pane)[0]).toBe('v Manuscript 13'); // unfolded, to show where the note went
    expect(s.vault.writes).toEqual([indexWrite]);
  });

  it('opens the folded manuscript when an unfiled note is held over its heading', async () => {
    const s = await laid();
    tap(rowOf(s.pane, 'Manuscript'));
    layOut(s.pane);
    const loose = rowOf(s.pane, 'Loose');
    carry(loose, X, inRow(rowOf(s.pane, 'Manuscript'), 0.5));
    s.timers.advance(SPRING_OPEN_MS);
    expect(picture(s.pane)[0]).toBe('v Manuscript 11');
    letGo(loose, X, -50); // carried off the panel: nothing is filed
    await rest(s);
    expect(s.vault.writes).toEqual([]);
  });

  it('stays unfiled when it is let go in its own place', async () => {
    const s = await laid();
    const loose = rowOf(s.pane, 'Loose');
    carry(loose, X, inRow(loose, 0.5));
    expect(lineShown()).toBe(false);
    letGo(loose, X, inRow(loose, 0.5));
    await rest(s);
    expect(s.vault.writes).toEqual([]);
    expect(picture(s.pane)).toContain('  Loose 2');
  });
});

describe('what cannot be dragged', () => {
  it('leaves research notes, missing entries, headings and research folders where they are', async () => {
    const s = await laid();
    for (const title of ['Trains', 'City', 'Maps', 'Ghost', 'Manuscript', 'Unfiled', 'Research']) {
      const row = rowOf(s.pane, title);
      carry(row, X, inRow(rowOf(s.pane, 'The Letter'), 0.8));
      expect(ghosts(), title).toEqual([]);
      expect(fakeDocument.listenerCount(), title).toBe(0); // the press was not even followed
      letGo(row, X, inRow(rowOf(s.pane, 'The Letter'), 0.8));
    }
    await rest(s);
    expect(s.vault.writes).toEqual([]);
  });

  it('does not take a press on a row\'s "more" button for the start of a drag', async () => {
    const s = await laid();
    const button = moreOf(s.pane, 'Opening') as FakeElement;
    const y = inRow(rowOf(s.pane, 'Opening'), 0.5);
    point(button, 'pointerdown', 280, y);
    point(button, 'pointermove', 280, y + 40);
    expect(ghosts()).toEqual([]);
    point(button, 'pointerup', 280, y + 40);
    // The button still does what it does.
    tap(button);
    expect(StubMenu.shown).toHaveLength(1);
  });

  it('lets nothing be dragged in a project that cannot be changed', async () => {
    const vault = new MemoryVault();
    seedProject(vault, { binder: { not: 'a list' }, scenes: { A: 1024 } });
    const s = await laid(vault);
    expect(picture(s.pane)).toContain('  A 9'); // shown as unfiled
    const row = rowOf(s.pane, 'A');
    carry(row, X, inRow(row, 0.5) - 40);
    expect(ghosts()).toEqual([]);
    letGo(row, X, inRow(row, 0.5) - 40);
    await rest(s);
    expect(s.vault.writes).toEqual([]);
  });
});

describe('one drop, one change', () => {
  it('asks the store for exactly one thing', async () => {
    const s = await laid();
    const intents = (['moveNode', 'stepNode', 'addScene', 'addFolder', 'addUnfiledToBinder', 'removeFolder', 'deleteScene'] as const).map(
      (name) => vi.spyOn(s.store, name),
    );
    const opening = rowOf(s.pane, 'Opening');
    carry(opening, X, inRow(rowOf(s.pane, 'מכתב לאחותי'), 0.8));
    // The pointer wanders about before the row is let go.
    for (const title of ['The Letter', 'Part one', 'Ghost', 'חלק פנימי']) {
      point(gripOf(opening).target, 'pointermove', X, inRow(rowOf(s.pane, title), 0.5));
    }
    expect(intents.map((spy) => spy.mock.calls.length)).toEqual([0, 0, 0, 0, 0, 0, 0]);
    letGo(opening, X, inRow(rowOf(s.pane, 'חלק פנימי'), 0.5));
    await rest(s);
    expect(intents.map((spy) => spy.mock.calls.length)).toEqual([1, 0, 0, 0, 0, 0, 0]);
    expect(intents[0]?.mock.calls[0]).toEqual([{ kind: 'scene', path: 'Manuscript/Opening.md' }, { at: 'end', parentId: 'f-inner' }, INDEX]);
    expect(s.vault.writes).toEqual([indexWrite]);
  });

  it('is decided against the index as it is on disk: a row that has gone in the meantime is not moved', async () => {
    const s = await laid();
    const opening = rowOf(s.pane, 'Opening');
    carry(opening, X, inRow(rowOf(s.pane, 'The Letter'), 0.8));
    // Another device takes "Opening" out of the binder; this one has not heard yet.
    s.vault.external.editFrontmatter(INDEX, (frontmatter) => {
      frontmatter['binder'] = (frontmatter['binder'] as unknown[]).slice(1);
    }, { silent: true });
    letGo(opening, X, inRow(rowOf(s.pane, 'The Letter'), 0.8));
    await rest(s);
    expect(s.vault.writes).toEqual([]);
    expect(manuscript(s.pane)[0]).toBe('v Part one 8');
  });
});

describe('a drag that is cut short', () => {
  it('is cancelled by Escape', async () => {
    const s = await laid();
    const opening = rowOf(s.pane, 'Opening');
    const y = inRow(rowOf(s.pane, 'The Letter'), 0.8);
    carry(opening, X, y);
    expect(opening.fire('keydown', { key: 'Escape' }).defaultPrevented).toBe(true);
    expect(ghosts()).toEqual([]);
    expect(opening.hasClass('spellbook-is-dragged')).toBe(false);
    letGo(opening, X, y);
    opening.fire('click'); // the click of that release opens nothing
    await rest(s);
    expect(s.vault.writes).toEqual([]);
    expect(s.host.opened).toEqual([]);
  });

  it('is cancelled when the list is drawn again under it', async () => {
    const s = await laid();
    const opening = rowOf(s.pane, 'Opening');
    const y = inRow(rowOf(s.pane, 'The Letter'), 0.8);
    carry(opening, X, y);
    s.vault.external.create('Novel/Research/Bridges.md');
    await settled(s);
    expect(picture(s.pane)).toContain('  Bridges');
    expect(ghosts()).toEqual([]);
    expect(rowOf(s.pane, 'Opening').hasClass('spellbook-is-dragged')).toBe(false);
    letGo(opening, X, y);
    await rest(s);
    expect(s.vault.writes).toEqual([]);
  });

  it('leaves nothing behind when the binder is closed in the middle of it', async () => {
    const s = await laid();
    const opening = rowOf(s.pane, 'Opening');
    carry(opening, X, inRow(rowOf(s.pane, 'The Letter'), 0.8));
    expect(fakeDocument.body.children.length).toBeGreaterThan(0);
    await s.shell.close();
    expect(fakeDocument.body.children).toEqual([]);
    expect(fakeDocument.listenerCount()).toBe(0);
    expect(fakeWindow.listenerCount()).toBe(0);
    expect(s.timers.pending).toBe(0);
  });

  it('leaves nothing listening or waiting after an ordinary drop either', async () => {
    const s = await laid();
    const opening = rowOf(s.pane, 'Opening');
    const y = inRow(rowOf(s.pane, 'The Letter'), 0.8);
    carry(opening, X, y);
    letGo(opening, X, y);
    await rest(s);
    expect(fakeDocument.body.children).toEqual([]);
    expect(fakeDocument.listenerCount()).toBe(0);
    expect(fakeWindow.listenerCount()).toBe(0);
    // Every class the drag put on the panel is gone again.
    const classes = new Set(s.pane.all().flatMap((element) => [...element.classes]));
    for (const cls of ['spellbook-is-dragged', 'spellbook-is-drop-target', 'spellbook-drag-active']) {
      expect(classes.has(cls), cls).toBe(false);
    }
  });
});

describe('dragging with a finger', () => {
  it('picks a row up after a long press and drops it where the finger is lifted', async () => {
    const s = await laid();
    const opening = rowOf(s.pane, 'Opening');
    const grip = gripOf(opening);
    const y = inRow(rowOf(s.pane, 'The Letter'), 0.8);
    point(grip.target, 'pointerdown', grip.x, grip.y, 'touch');
    expect(ghosts()).toEqual([]);
    s.timers.advance(TOUCH_HOLD_MS);
    expect(ghosts()).toHaveLength(1);
    // The list is held still under the finger.
    expect(grip.target.fire('touchmove').defaultPrevented).toBe(true);

    point(grip.target, 'pointermove', X, y, 'touch');
    point(grip.target, 'pointerup', X, y, 'touch');
    await rest(s);
    expect(manuscript(s.pane).slice(0, 3)).toEqual(['v Part one 11', '  The Letter 4', '  Opening 3']);
    expect(s.vault.writes).toEqual([indexWrite]);
  });

  it('scrolls the list as usual when the finger moves straight away', async () => {
    const s = await laid();
    const opening = rowOf(s.pane, 'Opening');
    const grip = gripOf(opening);
    point(grip.target, 'pointerdown', grip.x, grip.y, 'touch');
    point(grip.target, 'pointermove', grip.x, grip.y + 30, 'touch');
    expect(grip.target.fire('touchmove').defaultPrevented).toBe(false);
    s.timers.advance(TOUCH_HOLD_MS * 2);
    expect(ghosts()).toEqual([]);
    point(grip.target, 'pointerup', grip.x, grip.y + 30, 'touch');
    await rest(s);
    expect(s.vault.writes).toEqual([]);
  });

  it('opens neither the note nor the row\'s menu when a long press is let go', async () => {
    const s = await laid();
    const opening = rowOf(s.pane, 'Opening');
    const grip = gripOf(opening);
    point(grip.target, 'pointerdown', grip.x, grip.y, 'touch');
    s.timers.advance(TOUCH_HOLD_MS);
    // What a phone may send for a long press, during it and after it.
    grip.target.fire('contextmenu');
    point(grip.target, 'pointerup', grip.x, grip.y, 'touch');
    grip.target.fire('contextmenu');
    grip.target.fire('click');
    await rest(s);
    expect(StubMenu.shown).toEqual([]);
    expect(s.host.opened).toEqual([]);
    expect(s.vault.writes).toEqual([]);

    // The next tap is an ordinary tap again.
    point(grip.target, 'pointerdown', grip.x, grip.y, 'touch');
    point(grip.target, 'pointerup', grip.x, grip.y, 'touch');
    opening.fire('click', { button: 0 });
    await rest(s);
    expect(s.host.opened.map((entry) => entry.path)).toEqual(['Novel/Manuscript/Opening.md']);
  });

  it('still opens the menu on a right-click with a mouse', async () => {
    const s = await laid();
    const opening = rowOf(s.pane, 'Opening');
    const grip = gripOf(opening);
    point(grip.target, 'pointerdown', grip.x, grip.y, 'mouse', { button: 2, buttons: 2 });
    opening.fire('contextmenu', { button: 2 });
    expect(StubMenu.shown).toHaveLength(1);
  });
});

describe('dragging in a list that is scrolled', () => {
  it('drops on the row that is under the pointer, however far the list has scrolled', async () => {
    const s = await laid();
    scroller(s.pane).scrollTop = 20;
    layOut(s.pane);
    const opening = rowOf(s.pane, 'Opening');
    const letter = rowOf(s.pane, 'The Letter');
    const y = inRow(letter, 0.75);
    carry(opening, X, y);
    expect(line().style['transform']).toBe(`translate(${letter.rect.left}px, ${letter.rect.bottom}px)`);

    // The list scrolls on while the row is carried (as it does near an edge):
    // now the folder below is under the pointer, which has not moved.
    scroller(s.pane).scrollTop = 50;
    layOut(s.pane);
    const inner = rowOf(s.pane, 'חלק פנימי');
    expect(inRow(inner, 0.75)).toBe(y);
    point(gripOf(opening).target, 'pointermove', X, y - 5);
    expect(targets(s.pane)).toEqual(['חלק פנימי']);
    letGo(opening, X, y - 5);
    await rest(s);
    expect(manuscript(s.pane).slice(2, 5)).toEqual(['  v חלק פנימי 7', '    מכתב לאחותי 4', '    Opening 3']);
  });

  it('scrolls by itself while a row is held near the bottom edge, and measures the rows only once', async () => {
    const s = await laid(novel(), {});
    layOut(s.pane, 240); // a short list: its bottom edge is at 340
    const opening = rowOf(s.pane, 'Opening');
    const measured = vi.spyOn(rowOf(s.pane, 'The Letter'), 'getBoundingClientRect');
    carry(opening, X, 335);
    expect(measured).toHaveBeenCalledTimes(1);
    const before = scroller(s.pane).scrollTop;
    s.timers.advance(FRAME_MS * 5);
    expect(scroller(s.pane).scrollTop).toBeGreaterThan(before);
    // Moving and scrolling ask where a drop would land again and again, but the rows are not measured again.
    point(gripOf(opening).target, 'pointermove', X, 330);
    s.timers.advance(FRAME_MS * 5);
    expect(measured).toHaveBeenCalledTimes(1);
    letGo(opening, X, 200);
  });
});
