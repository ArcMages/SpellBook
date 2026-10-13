// Letter box and Typewriter in one editing pane.
//
// One of these belongs to each editor while either mode is on. It measures
// the pane, lays the two covers of the letter box over its top and bottom,
// gives the text the empty room it needs above its first line and under its
// last one, and scrolls the pane so that the line being written rests at its
// place. All sums are the engine's (src/core/modes/frame.ts).
//
// What it changes in the editor, and puts back when it is let go of:
//   - two elements of its own inside the editor (the covers);
//   - the top and bottom padding of the pane the text scrolls in, whose
//     earlier values are kept and restored exactly;
//   - the scroll position, which is the point of Typewriter.
// It never changes the text, the selection or a class it did not add.
//
// On an iPhone or iPad the pane is never scrolled in the same frame as an
// edit: the keyboard is told where the caret is together with the next
// drawing of the screen, and a scroll in that same drawing makes it see the
// caret a line off. While typing, the line is therefore only brought back
// to its place once typing has paused.

import { frameOf, sameFrame, typewriterTarget } from '../../core/modes/index';
import type { Frame } from '../../core/modes/index';
import type { FeatureClock } from '../registry';

/** How long typing must have paused on an iPhone or iPad before the line is brought back to its place. */
export const IOS_TYPING_PAUSE_MS = 400;

export const COVER_CLASS = 'spellbook-modes-cover';
export const COVER_TOP_CLASS = 'spellbook-modes-cover-top';
export const COVER_BOTTOM_CLASS = 'spellbook-modes-cover-bottom';

export interface FrameOptions {
  readonly letterBox: boolean;
  readonly typewriter: boolean;
  /** The band's height, in hundredths of the pane. */
  readonly bandPercent: number;
  /** Where the line rests, in hundredths of the pane from its top. */
  readonly anchorPercent: number;
  /** How solid the covers are: 1 hides the text under them. */
  readonly coverOpacity: number;
  /** An iPhone or iPad: see the note about typing above. */
  readonly ios: boolean;
}

/** What is asked of an editor. CodeMirror's EditorView is one. */
export interface FrameEditor {
  /** The editor's outermost element. */
  readonly dom: HTMLElement;
  /** The element the text scrolls in. */
  readonly scrollDOM: HTMLElement;
  /** The element that holds the text and takes the keyboard. */
  readonly contentDOM: HTMLElement;
  readonly root: { readonly activeElement: Element | null };
  readonly defaultLineHeight: number;
  /** Whether a text is being composed (a dictation, an accent being chosen). */
  readonly composing: boolean;
  readonly hasFocus: boolean;
  readonly state: { readonly selection: { readonly main: { readonly head: number; readonly empty: boolean } } };
  coordsAtPos(position: number): { top: number; bottom: number } | null;
}

/** What happened in the editor, as far as Typewriter cares. */
export interface FrameChange {
  /** The text changed. */
  readonly docChanged: boolean;
  /** The writer typed or deleted (rather than, say, the note being loaded again). */
  readonly edit: boolean;
  /** The caret was moved with the mouse or a finger that may still be down. */
  readonly pointer: boolean;
}

export class EditorFrame {
  private readonly editor: FrameEditor;
  private readonly options: FrameOptions;
  private readonly clock: FeatureClock;
  private frame: Frame | null = null;
  private coverTop: HTMLElement | null = null;
  private coverBottom: HTMLElement | null = null;
  /** The pane's own top and bottom padding, as it was set on the element before this frame touched it. */
  private readonly ownPadding: { top: string; bottom: string };
  private observer: ResizeObserver | null = null;
  private viewport: VisualViewport | null = null;
  private cancelMeasure: (() => void) | null = null;
  private cancelSettle: (() => void) | null = null;
  private cancelPause: (() => void) | null = null;
  /** The caret was moved with a pointer that is still down: wait for it to be lifted. */
  private awaitingPointer = false;
  private released = false;

  constructor(editor: FrameEditor, options: FrameOptions, clock: FeatureClock) {
    this.editor = editor;
    this.options = options;
    this.clock = clock;
    const scroller = editor.scrollDOM;
    this.ownPadding = { top: scroller.style.paddingTop, bottom: scroller.style.paddingBottom };

    if (options.letterBox) {
      this.coverTop = editor.dom.createDiv({ cls: [COVER_CLASS, COVER_TOP_CLASS] });
      this.coverBottom = editor.dom.createDiv({ cls: [COVER_CLASS, COVER_BOTTOM_CLASS] });
      for (const cover of [this.coverTop, this.coverBottom]) {
        cover.setAttr('aria-hidden', 'true');
        cover.style.opacity = String(options.coverOpacity);
        cover.style.height = '0px';
      }
    }

    // The pane changes size when the window does, when a sidebar opens, and
    // when the on-screen keyboard comes and goes.
    if (typeof ResizeObserver === 'function') {
      this.observer = new ResizeObserver(this.scheduleMeasure);
      this.observer.observe(scroller);
    }
    this.viewport = editor.dom.ownerDocument.defaultView?.visualViewport ?? null;
    this.viewport?.addEventListener('resize', this.scheduleMeasure);
    scroller.addEventListener('pointerup', this.pointerLifted);
    scroller.addEventListener('pointercancel', this.pointerLifted);
    // Not now: the editor is in the middle of being put together or updated.
    this.scheduleMeasure();
  }

  /**
   * How much of the top and bottom of the pane is covered: the editor keeps
   * the caret clear of it when it scrolls the caret into view by itself.
   */
  get margins(): { top: number; bottom: number } | null {
    if (!this.frame || !this.options.letterBox) return null;
    return { top: this.frame.coverTop, bottom: this.frame.coverBottom };
  }

  /** The editor says that the text or the caret changed. Called from inside its update: nothing is measured or moved here. */
  changed(change: FrameChange): void {
    if (this.released || !this.options.typewriter) return;
    if (!this.focused()) return;
    if (!change.docChanged && change.pointer) {
      // Dragging to select must not have the page move under the pointer.
      this.awaitingPointer = true;
      return;
    }
    this.request(change.edit ? 'edit' : 'move');
  }

  /** Take everything away again and put the pane back as it was. */
  release(): void {
    if (this.released) return;
    this.released = true;
    this.cancelMeasure?.();
    this.cancelSettle?.();
    this.cancelPause?.();
    this.cancelMeasure = this.cancelSettle = this.cancelPause = null;
    this.observer?.disconnect();
    this.observer = null;
    this.viewport?.removeEventListener('resize', this.scheduleMeasure);
    this.viewport = null;
    const scroller = this.editor.scrollDOM;
    scroller.removeEventListener('pointerup', this.pointerLifted);
    scroller.removeEventListener('pointercancel', this.pointerLifted);
    this.coverTop?.remove();
    this.coverBottom?.remove();
    this.coverTop = this.coverBottom = null;
    scroller.style.paddingTop = this.ownPadding.top;
    scroller.style.paddingBottom = this.ownPadding.bottom;
    this.frame = null;
  }

  // ---------------------------------------------------------------- measuring

  private readonly scheduleMeasure = (): void => {
    if (this.released || this.cancelMeasure) return;
    this.cancelMeasure = this.clock.nextFrame(() => {
      this.cancelMeasure = null;
      this.measure();
    });
  };

  private measure(): void {
    if (this.released) return;
    const scroller = this.editor.scrollDOM;
    const rect = scroller.getBoundingClientRect();
    const height = rect.bottom - rect.top;
    // A pane that is not on show (a tab behind another) has no size: leave it be.
    if (!(height > 0)) return;
    // The keyboard of a phone lies over the lower part of the window without making it any smaller.
    const floor = this.viewport ? this.viewport.offsetTop + this.viewport.height : rect.bottom;
    const frame = frameOf({
      height,
      visible: Math.min(rect.bottom, floor) - rect.top,
      lineHeight: this.editor.defaultLineHeight,
      letterBox: this.options.letterBox,
      typewriter: this.options.typewriter,
      bandPercent: this.options.bandPercent,
      anchorPercent: this.options.anchorPercent,
    });
    if (!sameFrame(frame, this.frame)) {
      this.frame = frame;
      if (this.coverTop) this.coverTop.style.height = `${frame.coverTop}px`;
      if (this.coverBottom) this.coverBottom.style.height = `${frame.coverBottom}px`;
      scroller.style.paddingTop = frame.padTop > 0 ? `${frame.padTop}px` : this.ownPadding.top;
      scroller.style.paddingBottom = frame.padBottom > 0 ? `${frame.padBottom}px` : this.ownPadding.bottom;
    }
    if (this.options.typewriter) this.request('move');
  }

  // ---------------------------------------------------------------- scrolling

  /** On an iPhone or iPad `hasFocus` reads false for a moment during every edit made with the on-screen keyboard. */
  private focused(): boolean {
    return this.options.ios ? this.editor.root.activeElement === this.editor.contentDOM : this.editor.hasFocus;
  }

  private readonly pointerLifted = (): void => {
    if (!this.awaitingPointer) return;
    this.awaitingPointer = false;
    this.request('move');
  };

  private request(cause: 'edit' | 'move'): void {
    if (this.released || !this.options.typewriter) return;
    if (cause === 'edit' && this.options.ios) {
      this.pause();
      return;
    }
    // While typing goes on, on an iPhone or iPad, the pause decides.
    if (this.cancelPause || this.cancelSettle) return;
    this.cancelSettle = this.clock.nextFrame(() => {
      this.cancelSettle = null;
      this.settle();
    });
  }

  /** Wait until typing has paused, starting the wait anew with every keystroke. */
  private pause(): void {
    this.cancelPause?.();
    this.cancelPause = this.clock.setTimer(() => {
      this.cancelPause = null;
      this.request('move');
    }, IOS_TYPING_PAUSE_MS);
  }

  /** Bring the line with the caret to its resting place. */
  private settle(): void {
    if (this.released || !this.frame) return;
    const { editor } = this;
    if (editor.composing) {
      this.pause();
      return;
    }
    const caret = editor.state.selection.main;
    // With text selected the writer may be dragging its ends about: the page stays put.
    if (!caret.empty) return;
    const line = editor.coordsAtPos(caret.head);
    if (!line) return;
    const scroller = editor.scrollDOM;
    const target = typewriterTarget({
      lineTop: line.top,
      lineBottom: line.bottom,
      paneTop: scroller.getBoundingClientRect().top,
      scrollTop: scroller.scrollTop,
      maxScroll: scroller.scrollHeight - scroller.clientHeight,
      anchor: this.frame.anchor,
    });
    if (target !== null) scroller.scrollTop = target;
  }
}
