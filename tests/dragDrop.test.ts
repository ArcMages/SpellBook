// The drag engine, driven through the stand-in elements: presses, moves and
// releases as a browser would send them, with the test keeping the time.
// What the engine draws can only be judged in Obsidian; these tests check
// when a drag starts, what it asks and tells the view, and what it leaves
// behind.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AUTO_SCROLL_MAX } from '../src/core/dropTarget';
import {
  DRAGGED_CLASS,
  DRAG_ACTIVE_CLASS,
  DROP_LINE_CLASS,
  DROP_TARGET_CLASS,
  DragDrop,
  GHOST_CLASS,
  MOUSE_DRAG_DISTANCE,
  SPRING_OPEN_MS,
  SWALLOW_MS,
  TOUCH_HOLD_MS,
  TOUCH_HOLD_SLOP,
} from '../src/ui/dragDrop';
import type { DragClock, DropHint } from '../src/ui/dragDrop';
import { ManualTimers } from './memoryVault';
import { FakeElement, fakeDocument, fakeWindow, resetFakeDocument } from './obsidianStub';
import type { FakeEvent } from './obsidianStub';

const FRAME = 16;

interface Bench {
  engine: DragDrop<string>;
  timers: ManualTimers;
  /** The list: it scrolls, and presses in it are looked at. */
  list: FakeElement;
  /** Three rows, "A", "B" and "C", each 40 high, from 100 down. "C" cannot be picked up. */
  rows: FakeElement[];
  /** What the engine told the view, in order. */
  log: string[];
  /** Every place the view was asked about. */
  asked: Array<{ x: number; y: number }>;
  /** What the view answers when it is asked; a test changes it. */
  answer: { hint: DropHint | null };
  /** Set `onDrop` to have something happen when the view is handed a drop (before it is logged). */
  hooks: { onDrop: (() => void) | null };
}

function bench(): Bench {
  const timers = new ManualTimers();
  let time = 0;
  const clock: DragClock = {
    setTimer: timers.set,
    nextFrame: (callback) =>
      timers.set(() => {
        time += FRAME;
        callback(time);
      }, FRAME),
  };
  const list = new FakeElement();
  list.rect = { top: 100, bottom: 500, left: 0, right: 300, width: 300, height: 400 };
  const rows = ['A', 'B', 'C'].map((name, index) => {
    const row = list.createDiv({ cls: 'row', text: name });
    row.rect = { top: 100 + index * 40, bottom: 140 + index * 40, left: 10, right: 290, width: 280, height: 40 };
    // Something inside the row, as a title is: presses usually land on it.
    row.createSpan({ cls: 'title', text: name });
    return row;
  });
  (rows[2] as FakeElement).addClass('fixed');

  const log: string[] = [];
  const asked: Array<{ x: number; y: number }> = [];
  const answer: { hint: DropHint | null } = { hint: null };
  const hooks: Bench['hooks'] = { onDrop: null };
  const engine = new DragDrop<string>({
    container: list as unknown as HTMLElement,
    scroller: list as unknown as HTMLElement,
    clock,
    pick: (target) => {
      const row = (target as unknown as FakeElement | null)?.closest('row') ?? null;
      return row && !row.hasClass('fixed') ? { el: row as unknown as HTMLElement, data: row.text } : null;
    },
    ghost: (ghost, picked) => {
      ghost.setText(picked.data);
    },
    start: (picked) => {
      log.push(`start ${picked.data}`);
    },
    hover: (_picked, point) => {
      asked.push({ x: point.x, y: point.y });
      return answer.hint;
    },
    drop: (picked, point) => {
      hooks.onDrop?.();
      log.push(`drop ${picked.data} at ${point.x},${point.y}`);
    },
    end: (picked) => {
      log.push(`end ${picked.data}`);
    },
  });
  return { engine, timers, list, rows, log, asked, answer, hooks };
}

type Kind = 'mouse' | 'touch' | 'pen';

/** A pointer event as a browser sends it, fired on an element so that it travels up to the document. */
function send(
  target: FakeElement,
  type: string,
  x: number,
  y: number,
  kind: Kind = 'mouse',
  extra: Record<string, unknown> = {},
): FakeEvent {
  return target.fire(type, {
    pointerId: 1,
    pointerType: kind,
    isPrimary: true,
    button: 0,
    buttons: type === 'pointerup' || type === 'pointercancel' ? 0 : 1,
    clientX: x,
    clientY: y,
    ...extra,
  });
}

const title = (row: FakeElement): FakeElement => row.children[0] as FakeElement;
const ghosts = (): FakeElement[] => fakeDocument.body.withClass(GHOST_CLASS);
const lines = (): FakeElement[] => fakeDocument.body.withClass(DROP_LINE_CLASS);

/**
 * Press on row "A" with the mouse and move far enough for a drag to start:
 * by default to the middle of the list, away from the edges where it scrolls.
 */
function mouseDrag(b: Bench, toY = 300): FakeElement {
  const row = b.rows[0] as FakeElement;
  send(title(row), 'pointerdown', 50, 120);
  send(title(row), 'pointermove', 50, toY);
  return row;
}

/** Rest a finger on row "A" until it is picked up. */
function touchDrag(b: Bench): FakeElement {
  const row = b.rows[0] as FakeElement;
  send(title(row), 'pointerdown', 50, 120, 'touch');
  b.timers.advance(TOUCH_HOLD_MS);
  return row;
}

beforeEach(() => {
  resetFakeDocument();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ----------------------------------------------------------------- the mouse

describe('picking up with a mouse', () => {
  it('is not a drag while the pointer has hardly moved: a click stays a click', () => {
    const b = bench();
    const row = b.rows[0] as FakeElement;
    let clicks = 0;
    row.addEventListener('click', () => clicks++);

    send(title(row), 'pointerdown', 50, 120);
    send(title(row), 'pointermove', 50 + MOUSE_DRAG_DISTANCE - 1, 120);
    expect(b.engine.active).toBe(false);
    send(title(row), 'pointerup', 50 + MOUSE_DRAG_DISTANCE - 1, 120);
    expect(title(row).fire('click').defaultPrevented).toBe(false);

    expect(clicks).toBe(1);
    expect(b.log).toEqual([]);
    expect(ghosts()).toEqual([]);
    expect(fakeDocument.listenerCount()).toBe(0);
  });

  it('starts a drag once the pointer has moved 4 pixels, in any direction', () => {
    for (const [dx, dy] of [[MOUSE_DRAG_DISTANCE, 0], [0, -MOUSE_DRAG_DISTANCE], [3, 3]] as const) {
      resetFakeDocument();
      const b = bench();
      const row = b.rows[0] as FakeElement;
      send(title(row), 'pointerdown', 50, 120);
      send(title(row), 'pointermove', 50 + dx, 120 + dy);
      expect(b.engine.active, `${dx},${dy}`).toBe(true);
      expect(b.log).toEqual(['start A']);
      b.engine.destroy();
    }
    expect(MOUSE_DRAG_DISTANCE).toBe(4);
  });

  it('shows a ghost of the row, dims the row, and marks the list', () => {
    const b = bench();
    const row = mouseDrag(b);
    expect(ghosts()).toHaveLength(1);
    const ghost = ghosts()[0] as FakeElement;
    expect(ghost.parent).toBe(fakeDocument.body); // on top of everything, not inside the list
    expect(ghost.text).toBe('A');
    expect(ghost.attrs['aria-hidden']).toBe('true');
    // As wide as the row, at least as high.
    expect(ghost.style['width']).toBe('280px');
    expect(ghost.style['minHeight']).toBe('40px');
    expect(row.hasClass(DRAGGED_CLASS)).toBe(true);
    expect(b.list.hasClass(DRAG_ACTIVE_CLASS)).toBe(true);
    // From now on the pointer is heard wherever it goes.
    expect(title(row).hasPointerCapture(1)).toBe(true);
  });

  it('keeps the ghost under the pointer, held where the row was taken hold of', () => {
    const b = bench();
    const row = mouseDrag(b, 130);
    const ghost = ghosts()[0] as FakeElement;
    // Pressed at 50,120 on a row whose corner is at 10,100: held 40 in and 20 down.
    expect(ghost.style['transform']).toBe('translate(10px, 110px)');
    send(title(row), 'pointermove', 200, 300);
    expect(ghost.style['transform']).toBe('translate(160px, 280px)');
  });

  it('ignores a press that is not the main button, not the first finger, or not on something that can be dragged', () => {
    const b = bench();
    const row = b.rows[0] as FakeElement;
    const tries: Array<[FakeElement, Record<string, unknown>]> = [
      [title(row), { button: 2 }],
      [title(row), { button: 1 }],
      [title(row), { isPrimary: false }],
      [title(b.rows[2] as FakeElement), {}], // "C" cannot be picked up
      [b.list, {}], // the list itself, between the rows
    ];
    for (const [target, extra] of tries) {
      send(target, 'pointerdown', 50, 120, 'mouse', extra);
      send(target, 'pointermove', 50, 160, 'mouse', extra);
      expect(b.engine.active).toBe(false);
      send(target, 'pointerup', 50, 160, 'mouse', extra);
    }
    expect(b.log).toEqual([]);
    expect(fakeDocument.listenerCount()).toBe(0);
  });

  it('gives up when the button turns out to be up without a release having been heard', () => {
    const b = bench();
    const row = b.rows[0] as FakeElement;
    send(title(row), 'pointerdown', 50, 120);
    send(title(row), 'pointermove', 50, 160, 'mouse', { buttons: 0 });
    expect(b.engine.active).toBe(false);
    expect(fakeDocument.listenerCount()).toBe(0);

    mouseDrag(b);
    send(title(row), 'pointermove', 50, 200, 'mouse', { buttons: 0 });
    expect(b.engine.active).toBe(false);
    expect(ghosts()).toEqual([]);
    expect(b.log).toEqual(['start A', 'end A']); // no drop
  });

  it('follows only the pointer that started the drag', () => {
    const b = bench();
    const row = mouseDrag(b);
    b.asked.length = 0;
    send(title(row), 'pointermove', 50, 300, 'mouse', { pointerId: 7 });
    send(title(row), 'pointerup', 50, 300, 'mouse', { pointerId: 7 });
    expect(b.asked).toEqual([]);
    expect(b.engine.active).toBe(true);
  });
});

// ------------------------------------------------------------------ feedback

describe('showing where a drop would land', () => {
  it('asks the view at every move, and draws the line it answers with', () => {
    const b = bench();
    b.answer.hint = { line: { x: 24, y: 180, width: 260 } };
    const row = mouseDrag(b, 130);
    expect(b.asked).toEqual([{ x: 50, y: 130 }]);
    const line = lines()[0] as FakeElement;
    expect(line.parent).toBe(fakeDocument.body);
    expect(line.style['transform']).toBe('translate(24px, 180px)');
    expect(line.style['width']).toBe('260px');
    expect(line.style['display']).toBe('');

    b.answer.hint = { line: { x: 10, y: 220, width: 280 } };
    send(title(row), 'pointermove', 60, 215);
    expect(b.asked[1]).toEqual({ x: 60, y: 215 });
    expect(line.style['transform']).toBe('translate(10px, 220px)');
    expect(line.style['width']).toBe('280px');
  });

  it('hides the line where a drop would do nothing', () => {
    const b = bench();
    b.answer.hint = { line: { x: 24, y: 180, width: 260 } };
    const row = mouseDrag(b);
    b.answer.hint = null;
    send(title(row), 'pointermove', 60, 215);
    expect((lines()[0] as FakeElement).style['display']).toBe('none');
  });

  it('highlights what a drop would go into, and only that', () => {
    const b = bench();
    const [, second, third] = b.rows as [FakeElement, FakeElement, FakeElement];
    b.answer.hint = { into: second as unknown as HTMLElement };
    const row = mouseDrag(b);
    expect(second.hasClass(DROP_TARGET_CLASS)).toBe(true);
    expect((lines()[0] as FakeElement).style['display']).toBe('none');

    b.answer.hint = { into: third as unknown as HTMLElement };
    send(title(row), 'pointermove', 60, 215);
    expect(second.hasClass(DROP_TARGET_CLASS)).toBe(false);
    expect(third.hasClass(DROP_TARGET_CLASS)).toBe(true);

    b.answer.hint = {};
    send(title(row), 'pointermove', 60, 216);
    expect(third.hasClass(DROP_TARGET_CLASS)).toBe(false);
  });

  it('carries on when the view fails to answer', () => {
    const b = bench();
    const complaints = vi.spyOn(console, 'error').mockImplementation(() => {});
    const row = mouseDrag(b);
    b.answer.hint = { line: { x: 1, y: 2, width: 3 } };
    Object.defineProperty(b.answer, 'hint', {
      get: () => {
        throw new Error('no idea');
      },
    });
    send(title(row), 'pointermove', 60, 215);
    expect(b.engine.active).toBe(true);
    expect((lines()[0] as FakeElement).style['display']).toBe('none');
    expect(complaints).toHaveBeenCalled();
    send(title(row), 'pointerup', 60, 215);
    expect(b.log).toEqual(['start A', 'drop A at 60,215', 'end A']);
  });
});

// ------------------------------------------------------------------- the end

describe('dropping', () => {
  it('hands the drop to the view once its own traces are gone, then says the drag is over', () => {
    const b = bench();
    const [, second] = b.rows as [FakeElement, FakeElement];
    b.answer.hint = { line: { x: 24, y: 180, width: 260 }, into: second as unknown as HTMLElement };
    const row = mouseDrag(b);
    const seen: string[] = [];
    b.hooks.onDrop = (): void => {
      seen.push(`ghosts ${ghosts().length}, lines ${lines().length}, dimmed ${row.hasClass(DRAGGED_CLASS)}`);
    };
    send(title(row), 'pointerup', 80, 260);

    expect(b.log).toEqual(['start A', 'drop A at 80,260', 'end A']);
    expect(seen).toEqual(['ghosts 0, lines 0, dimmed false']);
    expect(b.engine.active).toBe(false);
    expect(second.hasClass(DROP_TARGET_CLASS)).toBe(false);
    expect(b.list.hasClass(DRAG_ACTIVE_CLASS)).toBe(false);
    expect(title(row).hasPointerCapture(1)).toBe(false);
    expect(fakeDocument.body.children).toEqual([]);
    // Nothing is left listening outside the list.
    expect(fakeDocument.listenerCount()).toBe(0);
    expect(fakeWindow.listenerCount()).toBe(0);
  });

  it('still says the drag is over when the view fails to take the drop', () => {
    const b = bench();
    const complaints = vi.spyOn(console, 'error').mockImplementation(() => {});
    const row = b.rows[1] as FakeElement;
    send(title(row), 'pointerdown', 50, 160);
    send(title(row), 'pointermove', 50, 200);
    b.hooks.onDrop = (): void => {
      throw new Error('could not');
    };
    send(title(row), 'pointerup', 50, 200);
    expect(b.log).toEqual(['start B', 'end B']);
    expect(complaints).toHaveBeenCalled();
    expect(b.engine.active).toBe(false);
  });

  it('keeps the click that follows the drag from the list, and only that one', () => {
    const b = bench();
    const row = mouseDrag(b);
    let clicks = 0;
    row.addEventListener('click', () => clicks++);
    send(title(row), 'pointerup', 80, 260);

    const swallowed = title(row).fire('click');
    expect(swallowed.defaultPrevented).toBe(true);
    expect(clicks).toBe(0);
    // The next click is an ordinary one.
    title(row).fire('click');
    expect(clicks).toBe(1);
  });

  it('lets a click through that comes after a new press, however soon', () => {
    const b = bench();
    const row = mouseDrag(b);
    let clicks = 0;
    row.addEventListener('click', () => clicks++);
    send(title(row), 'pointerup', 80, 260);
    // No click came from the drag itself. The writer taps again at once.
    send(title(row), 'pointerdown', 50, 120);
    send(title(row), 'pointerup', 50, 120);
    title(row).fire('click');
    expect(clicks).toBe(1);
  });

  it('stops holding clicks back after a short while, whatever happens', () => {
    const b = bench();
    const row = mouseDrag(b);
    let clicks = 0;
    row.addEventListener('click', () => clicks++);
    send(title(row), 'pointerup', 80, 260);
    b.timers.advance(SWALLOW_MS);
    title(row).fire('click');
    expect(clicks).toBe(1);
    expect(b.timers.pending).toBe(0);
  });
});

describe('cancelling', () => {
  it('cancels on Escape: nothing is dropped, and the key goes no further', () => {
    const b = bench();
    const row = mouseDrag(b);
    let heard = 0;
    row.addEventListener('keydown', () => heard++);
    const key = row.fire('keydown', { key: 'Escape' });

    expect(key.defaultPrevented).toBe(true);
    expect(heard).toBe(0);
    expect(b.engine.active).toBe(false);
    expect(b.log).toEqual(['start A', 'end A']);
    expect(ghosts()).toEqual([]);
    expect(lines()).toEqual([]);
    expect(row.hasClass(DRAGGED_CLASS)).toBe(false);

    // Letting go of the button afterwards drops nothing, and its click is not the list's.
    let clicks = 0;
    row.addEventListener('click', () => clicks++);
    send(title(row), 'pointerup', 80, 260);
    title(row).fire('click');
    expect(b.log).toEqual(['start A', 'end A']);
    expect(clicks).toBe(0);
    expect(fakeDocument.listenerCount()).toBe(0);
  });

  it('leaves other keys alone, and Escape too while nothing is dragged', () => {
    const b = bench();
    const row = mouseDrag(b);
    expect(row.fire('keydown', { key: 'a' }).defaultPrevented).toBe(false);
    expect(b.engine.active).toBe(true);
    send(title(row), 'pointerup', 80, 260);
    expect(row.fire('keydown', { key: 'Escape' }).defaultPrevented).toBe(false);
  });

  it('cancels when the window loses focus', () => {
    const b = bench();
    mouseDrag(b);
    fakeWindow.dispatch('blur');
    expect(b.engine.active).toBe(false);
    expect(b.log).toEqual(['start A', 'end A']);
    expect(ghosts()).toEqual([]);
  });

  it('cancels when the device takes the pointer away', () => {
    const b = bench();
    const row = mouseDrag(b);
    send(title(row), 'pointercancel', 80, 260);
    expect(b.engine.active).toBe(false);
    expect(b.log).toEqual(['start A', 'end A']);
    expect(fakeDocument.listenerCount()).toBe(0);
  });

  it('cancels when the pointer can no longer be followed', () => {
    const b = bench();
    const row = mouseDrag(b);
    send(title(row), 'lostpointercapture', 80, 260);
    expect(b.engine.active).toBe(false);
    expect(b.log).toEqual(['start A', 'end A']);
    // The release that comes later drops nothing.
    send(title(row), 'pointerup', 80, 260);
    expect(b.log).toEqual(['start A', 'end A']);
  });

  it('can be cancelled by the view, when the rows change under the pointer', () => {
    const b = bench();
    const row = mouseDrag(b);
    b.engine.cancel();
    b.engine.cancel(); // and again: nothing more happens
    expect(b.log).toEqual(['start A', 'end A']);
    send(title(row), 'pointermove', 50, 300);
    send(title(row), 'pointerup', 50, 300);
    expect(b.log).toEqual(['start A', 'end A']);
    expect(fakeDocument.listenerCount()).toBe(0);
  });

  it('starts afresh on a new press, even if the end of the last one was never heard', () => {
    const b = bench();
    mouseDrag(b);
    const other = b.rows[1] as FakeElement;
    send(title(other), 'pointerdown', 50, 160);
    expect(b.engine.active).toBe(false);
    expect(ghosts()).toEqual([]);
    send(title(other), 'pointermove', 50, 200);
    expect(b.log).toEqual(['start A', 'end A', 'start B']);
    expect(ghosts()).toHaveLength(1);
  });
});

// ----------------------------------------------------------- a finger, a pen

describe('picking up with a finger', () => {
  it('picks the row up after a long press, without the finger having to move', () => {
    const b = bench();
    const row = b.rows[0] as FakeElement;
    send(title(row), 'pointerdown', 50, 120, 'touch');
    b.timers.advance(TOUCH_HOLD_MS - 1);
    expect(b.engine.active).toBe(false);
    b.timers.advance(1);
    expect(b.engine.active).toBe(true);
    expect(b.log).toEqual(['start A']);
    expect(ghosts()).toHaveLength(1);
    expect(b.asked).toEqual([{ x: 50, y: 120 }]);
    expect(TOUCH_HOLD_MS).toBe(350);
  });

  it('allows the finger to tremble a little while it rests', () => {
    const b = bench();
    const row = b.rows[0] as FakeElement;
    send(title(row), 'pointerdown', 50, 120, 'touch');
    send(title(row), 'pointermove', 50 + TOUCH_HOLD_SLOP, 120, 'touch');
    b.timers.advance(TOUCH_HOLD_MS);
    expect(b.engine.active).toBe(true);
    expect(TOUCH_HOLD_SLOP).toBe(8);
  });

  it('takes a finger that moves before that for scrolling: nothing is picked up, then or later', () => {
    const b = bench();
    const row = b.rows[0] as FakeElement;
    send(title(row), 'pointerdown', 50, 120, 'touch');
    b.timers.advance(100);
    send(title(row), 'pointermove', 50, 120 + TOUCH_HOLD_SLOP + 1, 'touch');
    b.timers.advance(TOUCH_HOLD_MS * 3);
    send(title(row), 'pointermove', 50, 300, 'touch');
    expect(b.engine.active).toBe(false);
    expect(b.log).toEqual([]);
    expect(b.timers.pending).toBe(0);
    expect(fakeDocument.listenerCount()).toBe(0);
  });

  it('does not pick up when the finger is lifted in time: a tap stays a tap', () => {
    const b = bench();
    const row = b.rows[0] as FakeElement;
    let clicks = 0;
    row.addEventListener('click', () => clicks++);
    send(title(row), 'pointerdown', 50, 120, 'touch');
    b.timers.advance(TOUCH_HOLD_MS - 50);
    send(title(row), 'pointerup', 50, 120, 'touch');
    title(row).fire('click');
    b.timers.advance(TOUCH_HOLD_MS);
    expect(clicks).toBe(1);
    expect(b.log).toEqual([]);
  });

  it('does not pick up when the device starts scrolling first', () => {
    const b = bench();
    const row = b.rows[0] as FakeElement;
    send(title(row), 'pointerdown', 50, 120, 'touch');
    send(title(row), 'pointercancel', 50, 120, 'touch');
    b.timers.advance(TOUCH_HOLD_MS);
    expect(b.engine.active).toBe(false);
    expect(b.log).toEqual([]);
  });

  it('drops where the finger is lifted', () => {
    const b = bench();
    const row = touchDrag(b);
    send(title(row), 'pointermove', 60, 230, 'touch');
    send(title(row), 'pointerup', 60, 230, 'touch');
    expect(b.log).toEqual(['start A', 'drop A at 60,230', 'end A']);
  });

  it('keeps the click and the menu of a long press from the list', () => {
    const b = bench();
    const row = touchDrag(b);
    let clicks = 0;
    let menus = 0;
    row.addEventListener('click', () => clicks++);
    row.addEventListener('contextmenu', () => menus++);

    // Some devices send a menu request while the finger is still resting.
    expect(title(row).fire('contextmenu').defaultPrevented).toBe(true);
    send(title(row), 'pointerup', 50, 120, 'touch');
    // And some send one, or a click, when it is lifted.
    title(row).fire('contextmenu');
    title(row).fire('click');
    expect(menus).toBe(0);
    expect(clicks).toBe(0);
  });

  it('holds back a menu request that a device sends early, before the row was picked up, and still picks it up', () => {
    const b = bench();
    const row = b.rows[0] as FakeElement;
    let menus = 0;
    row.addEventListener('contextmenu', () => menus++);
    send(title(row), 'pointerdown', 50, 120, 'touch');
    b.timers.advance(200);
    expect(title(row).fire('contextmenu').defaultPrevented).toBe(true);
    expect(menus).toBe(0);
    b.timers.advance(TOUCH_HOLD_MS - 200);
    expect(b.engine.active).toBe(true);
  });

  it('leaves a right-click alone, and a Ctrl-click that asks for the menu', () => {
    const b = bench();
    const row = b.rows[0] as FakeElement;
    let menus = 0;
    row.addEventListener('contextmenu', () => menus++);
    send(title(row), 'pointerdown', 50, 120, 'mouse', { button: 2, buttons: 2 });
    expect(title(row).fire('contextmenu').defaultPrevented).toBe(false);
    expect(menus).toBe(1);

    // On a Mac, Ctrl with the main button asks for the menu as the button goes down.
    send(title(row), 'pointerdown', 50, 120, 'mouse', { ctrlKey: true });
    expect(title(row).fire('contextmenu').defaultPrevented).toBe(false);
    expect(menus).toBe(2);
    // The press is over as far as dragging goes: moving the mouse now drags nothing.
    send(title(row), 'pointermove', 50, 160);
    expect(b.engine.active).toBe(false);
    expect(fakeDocument.listenerCount()).toBe(0);
  });

  it('works the same with a pen', () => {
    const b = bench();
    const row = b.rows[0] as FakeElement;
    send(title(row), 'pointerdown', 50, 120, 'pen');
    send(title(row), 'pointermove', 50, 124, 'pen'); // a mouse would have started a drag here
    expect(b.engine.active).toBe(false);
    b.timers.advance(TOUCH_HOLD_MS);
    expect(b.engine.active).toBe(true);
  });
});

describe('keeping the list still under a dragging finger', () => {
  it('listens for the finger\'s moves in a way that may refuse the scroll, from the start', () => {
    const b = bench();
    expect(b.list.listenerOptions('touchmove')).toEqual([{ passive: false }]);
  });

  it('lets the list scroll until a row is picked up, and holds it still from then on', () => {
    const b = bench();
    const row = b.rows[0] as FakeElement;
    // Nothing pressed: an ordinary scroll.
    expect(title(row).fire('touchmove').defaultPrevented).toBe(false);
    // Resting, not picked up yet.
    send(title(row), 'pointerdown', 50, 120, 'touch');
    expect(title(row).fire('touchmove').defaultPrevented).toBe(false);
    // Picked up.
    b.timers.advance(TOUCH_HOLD_MS);
    expect(title(row).fire('touchmove').defaultPrevented).toBe(true);
    // Dropped.
    send(title(row), 'pointerup', 50, 120, 'touch');
    expect(title(row).fire('touchmove').defaultPrevented).toBe(false);
  });

  it('does not try to refuse a scroll that can no longer be refused', () => {
    const b = bench();
    const row = touchDrag(b);
    let refused = 0;
    title(row).fire('touchmove', { cancelable: false, preventDefault: () => refused++ });
    expect(refused).toBe(0);
  });

  it('has no say over touches while a mouse drags', () => {
    const b = bench();
    const row = mouseDrag(b);
    expect(title(row).fire('touchmove').defaultPrevented).toBe(false);
  });
});

// ---------------------------------------------------- what opens, what scrolls

describe('something folded shut under the pointer', () => {
  function folded(b: Bench, key = 'folder'): { opened: () => number } {
    let opened = 0;
    b.answer.hint = {
      spring: {
        key,
        open: () => {
          opened++;
          b.answer.hint = {}; // it is open now
        },
      },
    };
    return { opened: () => opened };
  }

  it('opens once the pointer has rested on it for a moment, and the view is asked again', () => {
    const b = bench();
    const { opened } = folded(b);
    mouseDrag(b);
    b.timers.advance(SPRING_OPEN_MS - 1);
    expect(opened()).toBe(0);
    const before = b.asked.length;
    b.timers.advance(1);
    expect(opened()).toBe(1);
    expect(b.asked.length).toBe(before + 1); // the rows are somewhere else now
    b.timers.advance(SPRING_OPEN_MS * 3);
    expect(opened()).toBe(1);
    expect(SPRING_OPEN_MS).toBe(700);
  });

  it('keeps counting while the pointer moves about on the same thing', () => {
    const b = bench();
    const { opened } = folded(b);
    const row = mouseDrag(b);
    b.timers.advance(400);
    send(title(row), 'pointermove', 52, 302);
    b.timers.advance(300);
    expect(opened()).toBe(1);
  });

  it('does not open when the pointer leaves before that, and starts over for another one', () => {
    const b = bench();
    const first = folded(b, 'one');
    const row = mouseDrag(b);
    b.timers.advance(SPRING_OPEN_MS - 100);
    const second = folded(b, 'two');
    send(title(row), 'pointermove', 52, 180);
    b.timers.advance(100);
    expect(first.opened()).toBe(0);
    expect(second.opened()).toBe(0);
    b.timers.advance(SPRING_OPEN_MS - 100);
    expect(second.opened()).toBe(1);
  });

  it('does not open after the drag has ended', () => {
    const b = bench();
    const { opened } = folded(b);
    const row = mouseDrag(b);
    send(title(row), 'pointerup', 50, 130);
    b.timers.advance(SPRING_OPEN_MS * 2);
    expect(opened()).toBe(0);
  });
});

describe('scrolling by itself near the edges', () => {
  it('scrolls down while the pointer is near the bottom edge, and asks the view again each time', () => {
    const b = bench();
    const row = mouseDrag(b);
    b.list.scrollTop = 200;
    send(title(row), 'pointermove', 150, 500); // on the bottom edge: as fast as it gets
    const asked = b.asked.length;
    b.timers.advance(FRAME);
    const step = Math.trunc((AUTO_SCROLL_MAX * FRAME) / 1000);
    expect(b.list.scrollTop).toBe(200 + step);
    expect(b.asked.length).toBe(asked + 1);
    b.timers.advance(FRAME * 4);
    expect(b.list.scrollTop).toBeGreaterThan(200 + step * 4);
    expect(b.asked.length).toBe(asked + 5);
  });

  it('scrolls up near the top edge, slower when the pointer is less near', () => {
    const b = bench();
    const row = mouseDrag(b);
    b.list.scrollTop = 1000;
    send(title(row), 'pointermove', 150, 100);
    b.timers.advance(FRAME * 10);
    const fast = 1000 - b.list.scrollTop;
    expect(fast).toBeGreaterThan(100);

    b.list.scrollTop = 1000;
    send(title(row), 'pointermove', 150, 130);
    b.timers.advance(FRAME * 10);
    const slow = 1000 - b.list.scrollTop;
    expect(slow).toBeGreaterThan(0);
    expect(slow).toBeLessThan(fast);
  });

  it('stops when the pointer goes back to the middle, when it leaves the list sideways, and when the drag ends', () => {
    const b = bench();
    const row = mouseDrag(b);
    send(title(row), 'pointermove', 150, 495);
    b.timers.advance(FRAME * 3);
    expect(b.list.scrollTop).toBeGreaterThan(0);

    send(title(row), 'pointermove', 150, 300);
    let at = b.list.scrollTop;
    b.timers.advance(FRAME * 5);
    expect(b.list.scrollTop).toBe(at);

    send(title(row), 'pointermove', 400, 495); // beside the list
    b.timers.advance(FRAME * 5);
    expect(b.list.scrollTop).toBe(at);

    send(title(row), 'pointermove', 150, 495);
    b.timers.advance(FRAME * 2);
    expect(b.list.scrollTop).toBeGreaterThan(at);
    at = b.list.scrollTop;
    send(title(row), 'pointerup', 150, 495);
    b.timers.advance(FRAME * 5);
    expect(b.list.scrollTop).toBe(at);
  });

  it('rests when the list is at its end, until the pointer moves again', () => {
    const b = bench();
    const row = mouseDrag(b);
    // A list that cannot scroll any further, as a browser has it.
    Object.defineProperty(b.list, 'scrollTop', { get: () => 0, set: () => {}, configurable: true });
    send(title(row), 'pointermove', 150, 500);
    b.timers.advance(FRAME * 3);
    expect(b.timers.pending).toBe(0); // not trying again and again
    send(title(row), 'pointermove', 151, 500);
    expect(b.timers.pending).toBe(1);
  });

  it('does not start by itself when a finger has only just picked a row up at an edge', () => {
    const b = bench();
    const row = b.rows[0] as FakeElement;
    b.list.scrollTop = 300;
    send(title(row), 'pointerdown', 50, 105, 'touch'); // right at the top edge of the list
    b.timers.advance(TOUCH_HOLD_MS);
    b.timers.advance(FRAME * 5);
    expect(b.list.scrollTop).toBe(300);
    // Once the finger moves, it does.
    send(title(row), 'pointermove', 50, 104, 'touch');
    b.timers.advance(FRAME * 5);
    expect(b.list.scrollTop).toBeLessThan(300);
  });
});

// ------------------------------------------------------------------ the end

describe('destroying the engine', () => {
  it('takes away every listener, and whatever a drag had put on the screen', () => {
    const b = bench();
    expect(b.list.listenerCount()).toBe(4);
    const row = mouseDrag(b);
    b.engine.destroy();
    b.engine.destroy();

    expect(b.list.listenerCount()).toBe(0);
    expect(fakeDocument.listenerCount()).toBe(0);
    expect(fakeWindow.listenerCount()).toBe(0);
    expect(fakeDocument.body.children).toEqual([]);
    expect(row.hasClass(DRAGGED_CLASS)).toBe(false);
    expect(b.list.hasClass(DRAG_ACTIVE_CLASS)).toBe(false);
    expect(b.log).toEqual(['start A', 'end A']);
    expect(b.timers.pending).toBe(0);
  });

  it('leaves the list as it found it: every class it added is gone', () => {
    const b = bench();
    const before = b.list.all().map((element) => [...element.classes].join(' '));
    const row = mouseDrag(b);
    b.answer.hint = { into: b.rows[1] as unknown as HTMLElement };
    send(title(row), 'pointermove', 60, 170);
    send(title(row), 'pointerup', 60, 170);
    b.engine.destroy();
    expect(b.list.all().map((element) => [...element.classes].join(' '))).toEqual(before);
  });

  it('gives everything it adds to the page the plugin\'s prefix', () => {
    const b = bench();
    b.answer.hint = { into: b.rows[1] as unknown as HTMLElement };
    mouseDrag(b);
    const added = [
      ...fakeDocument.body.all().flatMap((element) => [...element.classes]),
      ...b.list.all().flatMap((element) => [...element.classes].filter((cls) => !['row', 'title', 'fixed'].includes(cls))),
    ];
    expect(added.length).toBeGreaterThanOrEqual(5);
    for (const cls of added) expect(cls.startsWith('spellbook-'), cls).toBe(true);
  });
});
