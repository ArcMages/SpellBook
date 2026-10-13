// The prose checks in the editor: one CodeMirror extension that draws the
// marks and shows the bubble that explains them.
//
// It only decorates. It never changes the text, the selection or the scroll
// position.
//
// On a desktop the marks are worked out again at every change of the text and
// every scroll: only the lines on the screen are looked at, and a line that
// has not changed is remembered, so that is one line's work for a key.
//
// On a phone or a tablet nothing is worked out while a key is being handled.
// The marks that are there are moved along with the text, and a moment after
// the typing pauses the other lines are brought up to date. The line that is
// being typed keeps the marks it had until the caret leaves it: redrawing
// the words under the caret makes the on-screen keyboard of an iPhone or iPad
// lose its place (it jumps to capitals in the middle of a word).

import { StateEffect } from '@codemirror/state';
import type { Extension } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin } from '@codemirror/view';
import type { DecorationSet, ViewUpdate } from '@codemirror/view';
import { editorInfoField } from 'obsidian';
import type { ProseAnalyser } from '../../core/prose/index';
import { decorate, marksInView, rangesOf } from './marks';
import { ProseTip, messagesAt } from './tip';

/** The class the editor carries while the checks are drawn in it; the colours of the marks hang on it. */
export const EDITOR_CLASS = 'spellbook-prose';

/** How long after the last key the other lines are brought up to date on a touch screen, in milliseconds. */
export const TOUCH_PAUSE_MS = 400;

/** What the extension asks of the feature. */
export interface ProseEditorHost {
  /** The analysis under the writer's present choices. */
  readonly analyser: ProseAnalyser;
  /** Whether the note at this vault path is checked. */
  covers(path: string | null): boolean;
  /** Whether this is a phone or a tablet. */
  readonly touch: boolean;
  /** Call `callback` once after `ms` milliseconds. Returns a function that cancels it. */
  setTimer(callback: () => void, ms: number): () => void;
}

/** Asks an editor to bring its marks up to date. */
const refresh = StateEffect.define<null>();

/** A change of the text that is the writer typing or deleting a letter, and nothing bigger. */
export function isTyping(update: Pick<ViewUpdate, 'transactions'>): boolean {
  let typed = false;
  for (const transaction of update.transactions) {
    if (!transaction.docChanged) continue;
    const key = transaction.isUserEvent('input.type') || (transaction.isUserEvent('delete') && !transaction.isUserEvent('delete.cut'));
    if (!key) return false;
    typed = true;
  }
  return typed;
}

/** The marks of one editor. (Exported for the tests; the plugin reaches it through proseEditor.) */
export class ProseMarksView {
  decorations: DecorationSet = Decoration.none;
  readonly tip = new ProseTip();
  /** On a touch screen: the number of the line that is being typed, whose marks are left as they are; 0 for none. */
  private held = 0;
  private cancelRefresh: (() => void) | null = null;

  constructor(
    private readonly view: EditorView,
    private readonly host: ProseEditorHost,
  ) {
    this.decorations = this.build(0);
  }

  update(update: ViewUpdate): void {
    try {
      this.follow(update);
    } catch (error) {
      // A mistake in a check must never get in the way of writing.
      console.error('Spellbook: the prose checks could not be drawn', error);
      this.decorations = Decoration.none;
    }
  }

  private follow(update: ViewUpdate): void {
    const asked = update.transactions.some((transaction) => transaction.effects.some((effect) => effect.is(refresh)));
    if (update.docChanged) this.tip.hide();
    if (!this.host.touch) {
      if (update.docChanged || update.viewportChanged || asked) this.decorations = this.build(0);
      return;
    }
    if (update.docChanged) {
      if (isTyping(update)) {
        // Nothing is worked out on the frame of a key.
        this.decorations = this.decorations.map(update.changes);
        this.held = update.state.doc.lineAt(update.state.selection.main.head).number;
        this.refreshSoon();
        return;
      }
      // A paste, an undo, a sync: everything is new.
      this.held = 0;
      this.decorations = this.build(0);
      return;
    }
    if (this.held !== 0) {
      const line = update.state.doc.lineAt(update.state.selection.main.head).number;
      if ((update.selectionSet && line !== this.held) || (update.focusChanged && !update.view.hasFocus)) {
        // The caret left the line: it may be drawn afresh now.
        this.held = 0;
        this.decorations = this.build(0);
        return;
      }
    }
    if (asked || update.viewportChanged) this.decorations = this.build(this.held);
  }

  /**
   * Work the marks out for what is on the screen.
   *
   * @param keep the number of a line whose present marks stay as they are, or 0
   */
  private build(keep: number): DecorationSet {
    const { state } = this.view;
    const path = state.field(editorInfoField, false)?.file?.path ?? null;
    if (this.host.analyser.idle || !this.host.covers(path)) return Decoration.none;
    const marks = marksInView(state.doc, this.view.visibleRanges, this.host.analyser);
    if (keep < 1 || keep > state.doc.lines) return decorate(marks, state.doc.length);
    // The marks of the kept line are left in the set as they are, not made
    // again: made again they would be the same marks in another order, and
    // the editor would redraw the line after all.
    const line = state.doc.line(keep);
    const kept = this.decorations.update({ filter: (from, to) => from >= line.from && to <= line.to });
    const others = marks.filter((mark) => mark.to < line.from || mark.from > line.to);
    return kept.update({ add: rangesOf(others, state.doc.length), sort: true });
  }

  private refreshSoon(): void {
    this.cancelRefresh?.();
    this.cancelRefresh = this.host.setTimer(() => {
      this.cancelRefresh = null;
      this.view.dispatch({ effects: refresh.of(null) });
    }, TOUCH_PAUSE_MS);
  }

  /** Show what the marks under the pointer or the finger say; nothing there takes the bubble away. */
  explain(event: MouseEvent): void {
    const messages = messagesAt(event.target, this.view.contentDOM);
    this.tip.show(this.view.dom.ownerDocument, messages, event.clientX, event.clientY);
  }

  destroy(): void {
    this.cancelRefresh?.();
    this.cancelRefresh = null;
    this.tip.hide();
  }
}

/** The editor extension of the prose checks. Make a new one whenever the writer's choices change. */
export function proseEditor(host: ProseEditorHost): Extension {
  const marks = ViewPlugin.define((view) => new ProseMarksView(view, host), {
    decorations: (plugin) => plugin.decorations,
    eventHandlers: {
      // None of these keeps the event from the editor: they only look.
      mouseover(event) {
        if (!host.touch) this.explain(event);
        return false;
      },
      mouseleave() {
        this.tip.hide();
        return false;
      },
      // A tap ends in a click on a touch screen too.
      click(event) {
        this.explain(event);
        return false;
      },
      keydown() {
        this.tip.hide();
        return false;
      },
      scroll() {
        this.tip.hide();
        return false;
      },
      blur() {
        this.tip.hide();
        return false;
      },
    },
  });
  return [marks, EditorView.editorAttributes.of({ class: EDITOR_CLASS })];
}
