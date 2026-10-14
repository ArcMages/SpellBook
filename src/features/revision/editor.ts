// The revision notes in the editor: the passages that have an open note are
// underlined lightly, and resting the pointer on one (or tapping it) shows
// the note in a small bubble.
//
// It only decorates. It never changes the text, the selection or the scroll
// position. The notes come from the project's revision notes file (through
// the host), and the marks are worked out again a moment after they change,
// so a note that was just added shows straight away.
//
// The marks are moved along with the text at every key and worked out again
// a moment after the typing pauses. On a phone or a tablet the line that is
// being typed keeps the marks it had until the caret leaves it: redrawing
// the words under the caret makes the on-screen keyboard of an iPhone or
// iPad lose its place.

import { StateEffect } from '@codemirror/state';
import type { Extension, Range } from '@codemirror/state';
import { Decoration, ViewPlugin } from '@codemirror/view';
import type { DecorationSet, EditorView, ViewUpdate } from '@codemirror/view';
import { editorInfoField } from 'obsidian';
import { passageMarks } from '../../core/revision/index';
import type { PassageMark, RevisionNote } from '../../core/revision/index';

/** The class of an underlined passage, and the attribute that holds its note. */
export const PASSAGE_CLASS = 'spellbook-revision-mark';
export const PASSAGE_NOTE = 'data-spellbook-revision';
/** What the bubble says for a note with no words (only the passage was marked). */
export const EMPTY_NOTE_TEXT = 'Revision note';

/** How long after the last key the marks are worked out again, in milliseconds. */
export const PAUSE_MS = 400;

/** What the extension asks of the feature. */
export interface RevisionEditorHost {
  /** Whether the note at this vault path is a note of a Spellbook project. */
  covers(path: string | null): boolean;
  /** The revision notes of the note at this vault path. */
  notesOf(path: string): readonly RevisionNote[];
  /** Be told when the revision notes change. Returns a function that stops it. */
  onNotesChange(listener: () => void): () => void;
  /** Whether this is a phone or a tablet. */
  readonly touch: boolean;
  /** Call `callback` once after `ms` milliseconds. Returns a function that cancels it. */
  setTimer(callback: () => void, ms: number): () => void;
}

/** Asks an editor to bring its marks up to date. */
const refresh = StateEffect.define<null>();

/** Decorations are made once for each note's words, and used again: an unchanged mark is then not redrawn. */
const made = new Map<string, Decoration>();
const MOST_MADE = 500;

function decorationOf(note: RevisionNote): Decoration {
  const message = note.note.trim() === '' ? EMPTY_NOTE_TEXT : note.note.trim();
  let decoration = made.get(message);
  if (!decoration) {
    if (made.size >= MOST_MADE) made.clear();
    decoration = Decoration.mark({ class: PASSAGE_CLASS, attributes: { [PASSAGE_NOTE]: message } });
    made.set(message, decoration);
  }
  return decoration;
}

/** The marks as CodeMirror ranges. */
export function rangesOf(marks: readonly PassageMark[], length: number): Array<Range<Decoration>> {
  const ranges: Array<Range<Decoration>> = [];
  for (const mark of marks) {
    if (mark.from < mark.to && mark.from >= 0 && mark.to <= length) ranges.push(decorationOf(mark.note).range(mark.from, mark.to));
  }
  return ranges;
}

/** The marks of one editor. (Exported for the tests; the plugin reaches it through revisionEditor.) */
export class RevisionMarksView {
  decorations: DecorationSet = Decoration.none;
  readonly tip = new RevisionTip();
  private readonly stopFollowing: () => void;
  /** On a touch screen: the number of the line being typed, whose marks are left as they are; 0 for none. */
  private held = 0;
  private cancelRefresh: (() => void) | null = null;

  constructor(
    private readonly view: EditorView,
    private readonly host: RevisionEditorHost,
  ) {
    this.decorations = this.build(0);
    // Notes added, changed or ticked elsewhere (or on another device) show a moment later.
    this.stopFollowing = host.onNotesChange(() => {
      this.refreshSoon();
    });
  }

  update(update: ViewUpdate): void {
    try {
      this.follow(update);
    } catch (error) {
      // A mistake here must never get in the way of writing.
      console.error('Spellbook: the revision notes could not be drawn', error);
      this.decorations = Decoration.none;
    }
  }

  private follow(update: ViewUpdate): void {
    const asked = update.transactions.some((transaction) => transaction.effects.some((effect) => effect.is(refresh)));
    if (update.docChanged) {
      this.tip.hide();
      // Nothing is worked out on the frame of a key: the marks move with the text.
      this.decorations = this.decorations.map(update.changes);
      if (this.host.touch) this.held = update.state.doc.lineAt(update.state.selection.main.head).number;
      this.refreshSoon();
      return;
    }
    if (this.held !== 0) {
      const line = update.state.doc.lineAt(update.state.selection.main.head).number;
      if ((update.selectionSet && line !== this.held) || (update.focusChanged && !update.view.hasFocus)) {
        this.held = 0;
        this.decorations = this.build(0);
        return;
      }
    }
    if (asked) this.decorations = this.build(this.held);
  }

  /**
   * Work the marks out for the whole note.
   *
   * @param keep the number of a line whose present marks stay as they are, or 0
   */
  private build(keep: number): DecorationSet {
    const { state } = this.view;
    const path = state.field(editorInfoField, false)?.file?.path ?? null;
    if (!this.host.covers(path)) return Decoration.none;
    const text = state.doc.toString();
    const marks = passageMarks(text, path === null ? [] : this.host.notesOf(path));
    if (keep < 1 || keep > state.doc.lines) return Decoration.set(rangesOf(marks, state.doc.length), true);
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
    }, PAUSE_MS);
  }

  /** Show the notes under the pointer or the finger; nothing there takes the bubble away. */
  explain(event: MouseEvent): void {
    const notes = notesAt(event.target, this.view.contentDOM);
    const line = markLineAt(event.target, this.view.contentDOM, event.clientY);
    this.tip.show(this.view.dom.ownerDocument, notes, event.clientX, event.clientY, line);
  }

  destroy(): void {
    this.stopFollowing();
    this.cancelRefresh?.();
    this.cancelRefresh = null;
    this.tip.hide();
  }
}

/** The part of an element this file asks for (so that the tests can stand in for one). */
interface Markable {
  getAttr(name: string): string | null;
  readonly parentElement: Markable | null;
}

/** The notes of the marks at an element: its own and those around it, up to (and not including) `within`. */
export function notesAt(target: unknown, within: unknown): string[] {
  const notes: string[] = [];
  let element = target as Markable | null;
  for (let steps = 0; element && element !== within && steps < 12; steps++) {
    if (typeof element.getAttr !== 'function') break;
    const note = element.getAttr(PASSAGE_NOTE);
    if (note !== null && note !== '' && !notes.includes(note)) notes.push(note);
    element = element.parentElement;
  }
  return notes;
}

/**
 * The top and bottom, on the screen, of the line of a marked passage under
 * the pointer: the line of the mark at `target` (or around it) that holds
 * `y`. Null when there is no mark there.
 */
export function markLineAt(target: unknown, within: unknown, y: number): { readonly top: number; readonly bottom: number } | null {
  let element = target as (Markable & { getClientRects?: () => ArrayLike<{ top: number; bottom: number }> }) | null;
  for (let steps = 0; element && element !== within && steps < 12; steps++) {
    if (typeof element.getAttr !== 'function') return null;
    if (element.getAttr(PASSAGE_NOTE) !== null && typeof element.getClientRects === 'function') {
      const rects = Array.from(element.getClientRects());
      const line = rects.find((rect) => y >= rect.top && y <= rect.bottom) ?? rects[0];
      return line ? { top: line.top, bottom: line.bottom } : null;
    }
    element = element.parentElement as typeof element;
  }
  return null;
}

export const TIP_CLASS = 'spellbook-revision-tip';
/** The room between the bubble and the line it is about. */
const GAP = 6;
/** Below the pointer, when the line it points at is not known. */
const BELOW = 22;
const EDGE = 8;

/**
 * Where the bubble goes: above the line of the passage, so that it covers
 * neither the passage nor the line after it, or, with no room above, below
 * the line. Across, it starts at the pointer and stays on the screen.
 */
export function tipPlace(
  tip: { readonly width: number; readonly height: number },
  screen: { readonly width: number; readonly height: number },
  x: number,
  y: number,
  line: { readonly top: number; readonly bottom: number } | null,
): { readonly left: number; readonly top: number } {
  const roomAcross = screen.width - tip.width - EDGE;
  const left = Math.max(EDGE, roomAcross > EDGE ? Math.min(x, roomAcross) : EDGE);
  if (line) {
    const above = line.top - GAP - tip.height;
    if (above >= EDGE) return { left, top: above };
    return { left, top: line.bottom + GAP };
  }
  const roomDown = screen.height - tip.height - EDGE;
  const top = roomDown > 0 && y + BELOW > roomDown ? Math.max(EDGE, y - BELOW - tip.height) : y + BELOW;
  return { left, top };
}

/** The bubble that shows a passage's note. One element at the end of the page, which never takes a tap or the keyboard. */
export class RevisionTip {
  private element: HTMLElement | null = null;
  private showing = '';

  get shown(): boolean {
    return this.element !== null;
  }

  /**
   * @param line the top and bottom of the passage's line under the pointer, when known
   */
  show(page: Document, notes: readonly string[], x: number, y: number, line: { readonly top: number; readonly bottom: number } | null = null): void {
    if (notes.length === 0) {
      this.hide();
      return;
    }
    const text = notes.join('\n');
    if (this.element && this.showing === text) return;
    this.hide();
    const tip = page.body.createDiv({ cls: TIP_CLASS, attr: { role: 'tooltip' } });
    // The writer's own words, in either language.
    for (const note of notes) tip.createDiv({ cls: `${TIP_CLASS}-line`, text: note, attr: { dir: 'auto' } });
    const view = page.defaultView;
    const place = tipPlace(
      { width: tip.offsetWidth || 0, height: tip.offsetHeight || 0 },
      { width: view?.innerWidth ?? 0, height: view?.innerHeight ?? 0 },
      x,
      y,
      line,
    );
    tip.style.left = `${Math.round(place.left)}px`;
    tip.style.top = `${Math.round(place.top)}px`;
    this.element = tip;
    this.showing = text;
  }

  hide(): void {
    this.element?.remove();
    this.element = null;
    this.showing = '';
  }
}

/** The editor extension of the revision notes. */
export function revisionEditor(host: RevisionEditorHost): Extension {
  return ViewPlugin.define((view) => new RevisionMarksView(view, host), {
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
}
