// The writing modes inside an editor: Hemingway on real CodeMirror states
// (without a screen), and the frame of Letter box and Typewriter on a
// stand-in editor whose sizes the test sets.

import { EditorSelection, EditorState } from '@codemirror/state';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NO_MODES, defaultModeSettings, withMode } from '../../../src/core/modes/index';
import type { Blocked } from '../../../src/core/modes/index';
import { COVER_BOTTOM_CLASS, COVER_CLASS, COVER_TOP_CLASS, EditorFrame, IOS_TYPING_PAUSE_MS } from '../../../src/features/modes/editorFrame';
import type { FrameEditor, FrameOptions } from '../../../src/features/modes/editorFrame';
import { modeExtensions } from '../../../src/features/modes/extensions';
import { blockedTransaction, guardInput, hemingwayGuard } from '../../../src/features/modes/hemingwayGuard';
import { ManualTimers } from '../../memoryVault';
import { FakeElement, fakeDocument, fakeWindow, resetFakeDocument } from '../../obsidianStub';
import { FRAME_MS, clockOn } from './stage';

afterEach(() => {
  vi.unstubAllGlobals();
  delete (fakeWindow as { visualViewport?: unknown }).visualViewport;
  resetFakeDocument();
});

// ----------------------------------------------------------------- Hemingway

describe('Hemingway in the editor', () => {
  /** "Hello, sister": a Hebrew line, which runs the other way. */
  const HEBREW = 'שלום לך אחותי';

  function guarded(doc: string, selection?: { anchor: number; head: number }) {
    const refused: Blocked[] = [];
    const state = EditorState.create({
      doc,
      selection: selection ? EditorSelection.single(selection.anchor, selection.head) : undefined,
      extensions: [hemingwayGuard((what) => refused.push(what))],
    });
    return { state, refused };
  }

  it('lets the writer add text, in English and in Hebrew', () => {
    const { state, refused } = guarded(HEBREW);
    const typed = state.update({ changes: { from: HEBREW.length, insert: ' היקרה' }, userEvent: 'input.type' });
    expect(typed.state.doc.toString()).toBe(`${HEBREW} היקרה`);
    const pasted = typed.state.update({ changes: { from: 0, insert: 'Dear Anna. ' }, userEvent: 'input.paste' });
    expect(pasted.state.doc.toString()).toBe(`Dear Anna. ${HEBREW} היקרה`);
    expect(refused).toEqual([]);
  });

  it('refuses deleting, however it is asked for, and leaves the text as it was', () => {
    for (const [userEvent, what] of [
      ['delete.backward', 'delete'],
      ['delete.forward', 'delete'],
      ['delete.cut', 'cut'],
      ['undo', 'undo'],
      ['redo', 'undo'],
      ['move.drop', 'move'],
    ] as const) {
      const { state, refused } = guarded(HEBREW);
      const attempt = state.update({ changes: { from: 0, to: 4 }, userEvent });
      expect(attempt.docChanged, userEvent).toBe(false);
      expect(attempt.state.doc.toString(), userEvent).toBe(HEBREW);
      expect(refused, userEvent).toEqual([what]);
    }
  });

  it('refuses typing over a selection, but not a correction made with nothing selected', () => {
    const selected = guarded('Hello world', { anchor: 0, head: 5 });
    const over = selected.state.update({ changes: { from: 0, to: 5, insert: 'X' }, userEvent: 'input.type' });
    expect(over.state.doc.toString()).toBe('Hello world');
    expect(selected.refused).toEqual(['replace']);

    const plain = guarded('Helo world');
    const corrected = plain.state.update({ changes: { from: 0, to: 4, insert: 'Hello' }, userEvent: 'input.type' });
    expect(corrected.state.doc.toString()).toBe('Hello world');
    expect(plain.refused).toEqual([]);
  });

  it('never stands in the way of a note that is loaded again after a sync', () => {
    const { state, refused } = guarded('Hello world', { anchor: 0, head: 5 });
    const reloaded = state.update({ changes: { from: 0, to: 11, insert: 'Hi' } });
    expect(reloaded.state.doc.toString()).toBe('Hi');
    expect(refused).toEqual([]);
  });

  it('leaves moving the caret and selecting alone', () => {
    const { state, refused } = guarded('Hello world');
    const moved = state.update({ selection: { anchor: 0, head: 5 }, userEvent: 'select' });
    expect(moved.state.selection.main.to).toBe(5);
    expect(blockedTransaction(moved)).toBeNull();
    expect(refused).toEqual([]);
  });

  it('answers the keyboard of a phone before it has changed anything', () => {
    const { state } = guarded('Hello world');
    expect(guardInput({ inputType: 'deleteContentBackward' }, state)).toBe('delete');
    expect(guardInput({ inputType: 'historyUndo' }, state)).toBe('undo');
    expect(guardInput({ inputType: 'insertText' }, state)).toBeNull();
    expect(guardInput({}, state)).toBeNull(); // an event that says nothing
    const selected = guarded('Hello world', { anchor: 2, head: 4 });
    expect(guardInput({ inputType: 'insertText' }, selected.state)).toBe('replace');
  });

  it('is gone when the mode is off: an editor without it deletes as ever', () => {
    const needs = { clock: clockOn(new ManualTimers()), ios: false, blocked: () => undefined };
    const settings = defaultModeSettings(false);
    expect(modeExtensions(NO_MODES, settings, needs)).toEqual([]);
    expect(modeExtensions(withMode(NO_MODES, 'zen', true), settings, needs)).toEqual([]); // Zen changes nothing in an editor
    expect(modeExtensions(withMode(NO_MODES, 'hemingway', true), settings, needs)).toHaveLength(1);
    expect(modeExtensions(withMode(withMode(NO_MODES, 'typewriter', true), 'letter-box', true), settings, needs)).toHaveLength(1); // one frame for both
    const plain = EditorState.create({ doc: 'Hello', extensions: modeExtensions(NO_MODES, settings, needs) });
    expect(plain.update({ changes: { from: 0, to: 5 }, userEvent: 'delete.backward' }).state.doc.toString()).toBe('');
    // And every list is made of new extensions, or the editors would not notice the change.
    const on = withMode(NO_MODES, 'hemingway', true);
    expect(modeExtensions(on, settings, needs)[0]).not.toBe(modeExtensions(on, settings, needs)[0]);
  });
});

// ------------------------------------------------- Letter box and Typewriter

/** A stand-in editor: a pane 600 high whose top is 100 below the top of the window, with 3000 of text in it. */
function fakeEditor() {
  const dom = new FakeElement('div');
  const scroller = dom.createDiv({ cls: 'cm-scroller' });
  const content = scroller.createDiv({ cls: 'cm-content' });
  scroller.rect = { top: 100, bottom: 700, left: 0, right: 400, width: 400, height: 600 };
  scroller.style['paddingTop'] = '';
  scroller.style['paddingBottom'] = '12px';
  const sizes = { clientHeight: 600, scrollHeight: 3000 };
  Object.assign(scroller, sizes);
  const live = {
    /** How far below the top of the text the line with the caret is. */
    lineAt: 1000,
    head: 0,
    empty: true,
    composing: false,
    hasFocus: true,
    lineHeight: 24,
  };
  const editor = {
    dom,
    scrollDOM: scroller,
    contentDOM: content,
    root: fakeDocument,
    get defaultLineHeight() {
      return live.lineHeight;
    },
    get composing() {
      return live.composing;
    },
    get hasFocus() {
      return live.hasFocus;
    },
    get state() {
      return { selection: { main: { head: live.head, empty: live.empty } } };
    },
    coordsAtPos: () => {
      const top = scroller.rect.top + live.lineAt - scroller.scrollTop;
      return { top, bottom: top + live.lineHeight };
    },
  } as unknown as FrameEditor;
  return { editor, dom, scroller, content, live };
}

const OPTIONS: FrameOptions = { letterBox: false, typewriter: false, bandPercent: 40, anchorPercent: 50, coverOpacity: 0.9, ios: false };
const TYPED = { docChanged: true, edit: true, pointer: false };
const MOVED = { docChanged: false, edit: false, pointer: false };

function framed(options: Partial<FrameOptions>) {
  const timers = new ManualTimers();
  const fake = fakeEditor();
  const frame = new EditorFrame(fake.editor, { ...OPTIONS, ...options }, clockOn(timers));
  return { ...fake, timers, frame, draw: () => timers.advance(FRAME_MS) };
}

describe('Letter box in an editor', () => {
  it('lays two covers of its own over the top and bottom, and leaves the band between them', () => {
    const { dom, frame, draw } = framed({ letterBox: true });
    const covers = dom.withClass(COVER_CLASS);
    expect(covers).toHaveLength(2);
    expect(frame.margins).toBeNull(); // nothing is measured while the editor is being put together
    draw();
    const [top] = dom.withClass(COVER_TOP_CLASS);
    const [bottom] = dom.withClass(COVER_BOTTOM_CLASS);
    expect(top?.style['height']).toBe('180px');
    expect(bottom?.style['height']).toBe('180px');
    expect(top?.style['opacity']).toBe('0.9');
    expect(top?.attrs['aria-hidden']).toBe('true');
    // The editor keeps the caret clear of the covers when it scrolls by itself.
    expect(frame.margins).toEqual({ top: 180, bottom: 180 });
  });

  it('gives the text room to bring its first and last line into the band, and never moves the page', () => {
    const { scroller, frame, draw } = framed({ letterBox: true });
    scroller.scrollTop = 500;
    draw();
    expect(scroller.style['paddingTop']).toBe('180px');
    expect(scroller.style['paddingBottom']).toBe('180px');
    frame.changed(TYPED);
    draw();
    expect(scroller.scrollTop).toBe(500);
  });

  it('follows the pane when it changes size', () => {
    let resized: (() => void) | null = null;
    const watched: unknown[] = [];
    let disconnected = 0;
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: () => void) {
          resized = callback;
        }
        observe(element: unknown): void {
          watched.push(element);
        }
        disconnect(): void {
          disconnected++;
        }
      },
    );
    const { dom, scroller, frame, draw } = framed({ letterBox: true });
    draw();
    expect(watched).toEqual([scroller]);
    scroller.rect = { ...scroller.rect, bottom: 400, height: 300 };
    (resized as unknown as () => void)();
    draw();
    expect(dom.withClass(COVER_TOP_CLASS)[0]?.style['height']).toBe('90px');
    expect(frame.margins).toEqual({ top: 90, bottom: 90 });
    frame.release();
    expect(disconnected).toBe(1);
  });

  it('counts only what an on-screen keyboard leaves to be seen', () => {
    const listeners = new Map<string, () => void>();
    (fakeWindow as { visualViewport?: unknown }).visualViewport = {
      offsetTop: 0,
      height: 400, // the keyboard covers everything below 400
      addEventListener: (type: string, listener: () => void) => listeners.set(type, listener),
      removeEventListener: (type: string) => listeners.delete(type),
    };
    const { dom, frame, draw } = framed({ letterBox: true });
    draw();
    // 300 of the pane can be seen: the band is 120, with 90 covered above it.
    expect(dom.withClass(COVER_TOP_CLASS)[0]?.style['height']).toBe('90px');
    expect(dom.withClass(COVER_BOTTOM_CLASS)[0]?.style['height']).toBe('390px');
    // The keyboard goes away: the frame follows.
    (fakeWindow as unknown as { visualViewport: { height: number } }).visualViewport.height = 900;
    listeners.get('resize')?.();
    draw();
    expect(dom.withClass(COVER_BOTTOM_CLASS)[0]?.style['height']).toBe('180px');
    frame.release();
    expect(listeners.size).toBe(0);
  });

  it('leaves a pane alone that is not on show', () => {
    const { scroller, frame, draw } = framed({ letterBox: true });
    scroller.rect = { ...scroller.rect, bottom: 100, height: 0 };
    draw();
    expect(frame.margins).toBeNull();
    expect(scroller.style['paddingBottom']).toBe('12px');
  });
});

describe('Typewriter in an editor', () => {
  it('brings the line being written to its resting place, in the frame after the edit and not during it', () => {
    const { scroller, frame, draw, live } = framed({ typewriter: true });
    draw(); // measured
    draw(); // and settled for the first time
    expect(scroller.scrollTop).toBe(712); // the line's middle (1012) at half of 600
    live.lineAt = 1024; // the writer went on to the next line
    frame.changed(TYPED);
    expect(scroller.scrollTop).toBe(712); // nothing moves inside the editor's own update
    draw();
    expect(scroller.scrollTop).toBe(736);
  });

  it('rests the line where the writer chose, and lets the first line of a note get there', () => {
    const { scroller, draw, live } = framed({ typewriter: true, anchorPercent: 30 });
    live.lineAt = 0;
    draw();
    expect(scroller.style['paddingTop']).toBe('168px');
    expect(scroller.style['paddingBottom']).toBe('408px');
    draw();
    expect(scroller.scrollTop).toBe(0); // as far as it goes; the room above does the rest
  });

  it('follows the caret when it is moved with the keyboard', () => {
    const { scroller, frame, draw, live } = framed({ typewriter: true });
    draw();
    draw();
    live.lineAt = 400;
    frame.changed(MOVED);
    draw();
    expect(scroller.scrollTop).toBe(112);
  });

  it('keeps the page still while a pointer is dragging, and settles when it is lifted', () => {
    const { scroller, frame, draw, live } = framed({ typewriter: true });
    draw();
    draw();
    live.lineAt = 1500;
    frame.changed({ docChanged: false, edit: false, pointer: true });
    draw();
    expect(scroller.scrollTop).toBe(712);
    scroller.dispatch('pointerup');
    draw();
    expect(scroller.scrollTop).toBe(1212);
  });

  it('keeps the page still while text is selected, so that it does not move under the handles of a touch selection', () => {
    const { scroller, frame, draw, live } = framed({ typewriter: true });
    draw();
    draw();
    live.lineAt = 1500;
    live.empty = false;
    frame.changed(MOVED);
    draw();
    expect(scroller.scrollTop).toBe(712);
  });

  it('does nothing in a pane the writer is not in', () => {
    const { scroller, frame, draw, live } = framed({ typewriter: true });
    draw();
    draw();
    live.hasFocus = false;
    live.lineAt = 1500;
    frame.changed(TYPED);
    draw();
    expect(scroller.scrollTop).toBe(712);
  });

  it('on an iPhone or iPad, waits for typing to pause before it moves the page', () => {
    const { scroller, content, frame, draw, live, timers } = framed({ typewriter: true, ios: true });
    content.focus(); // there, "has focus" flickers during an edit: the element with the keyboard is asked instead
    live.hasFocus = false;
    draw();
    draw();
    expect(scroller.scrollTop).toBe(712);
    live.lineAt = 1024;
    frame.changed(TYPED);
    draw();
    expect(scroller.scrollTop).toBe(712); // not in the frame after the edit
    timers.advance(IOS_TYPING_PAUSE_MS - 100);
    frame.changed(TYPED); // another key: the wait starts again
    timers.advance(IOS_TYPING_PAUSE_MS - 100);
    expect(scroller.scrollTop).toBe(712);
    timers.advance(100 + FRAME_MS);
    expect(scroller.scrollTop).toBe(736);
    // A caret moved without typing is followed at once, there too.
    live.lineAt = 400;
    frame.changed(MOVED);
    draw();
    expect(scroller.scrollTop).toBe(112);
  });

  it('waits while a text is being composed', () => {
    const { scroller, frame, draw, live, timers } = framed({ typewriter: true });
    draw();
    draw();
    live.lineAt = 1024;
    live.composing = true;
    frame.changed(TYPED);
    draw();
    expect(scroller.scrollTop).toBe(712);
    live.composing = false;
    timers.advance(IOS_TYPING_PAUSE_MS + FRAME_MS);
    expect(scroller.scrollTop).toBe(736);
  });

  it('puts the band of the letter box around the resting line when both are on', () => {
    const { dom, draw } = framed({ typewriter: true, letterBox: true, anchorPercent: 30 });
    draw();
    expect(dom.withClass(COVER_TOP_CLASS)[0]?.style['height']).toBe('60px');
    expect(dom.withClass(COVER_BOTTOM_CLASS)[0]?.style['height']).toBe('300px');
  });
});

describe('letting go of an editor', () => {
  it('takes the covers away, puts the padding back exactly, and stops listening and waiting', () => {
    const { dom, scroller, frame, draw, live, timers } = framed({ typewriter: true, letterBox: true, ios: true });
    dom.addClass('cm-editor', 'theme-own-class');
    draw();
    expect(scroller.style['paddingBottom']).not.toBe('12px');
    frame.changed(TYPED); // a wait is under way
    expect(scroller.listenerCount()).toBe(2);

    frame.release();
    expect(dom.withClass(COVER_CLASS)).toEqual([]);
    expect(scroller.style['paddingTop']).toBe('');
    expect(scroller.style['paddingBottom']).toBe('12px');
    expect(scroller.listenerCount()).toBe(0);
    expect(timers.pending).toBe(0);
    expect(frame.margins).toBeNull();
    expect([...dom.classes].sort()).toEqual(['cm-editor', 'theme-own-class']); // classes that are not the plugin's are untouched
    expect(dom.children).toEqual([scroller]);

    // Whatever still arrives afterwards does nothing.
    const before = scroller.scrollTop;
    live.lineAt = 2000;
    frame.changed(TYPED);
    scroller.dispatch('pointerup');
    timers.advance(1000);
    expect(scroller.scrollTop).toBe(before);
    frame.release(); // again: nothing more happens
  });

  it('leaves no trace of a frame that was let go of before it ever measured', () => {
    const { dom, scroller, frame, timers } = framed({ letterBox: true });
    frame.release();
    timers.advance(1000);
    expect(dom.children).toEqual([scroller]);
    expect(scroller.style['paddingBottom']).toBe('12px');
  });
});
