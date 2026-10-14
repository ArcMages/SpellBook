// The revision notes in the editor: the passages that have an open note are
// underlined lightly, and resting the pointer on one (or tapping it) shows
// the note in a small bubble.
//
// It only decorates. It never changes the text, the selection or the scroll
// position. The notes are read from the properties at the top of the note
// being edited, so a note that was just added shows at once.
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
import { passageMarks, propertiesOf, readNotes } from '../../core/revision/index';
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
  /** The properties in a block of YAML, as Obsidian reads them; null when they cannot be read. */
  parseProperties(yaml: string): unknown;
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

/** The notes the properties at the top of a text hold, read anew only when the properties change. */
export class NotesReader {
  private yaml: string | null = null;
  private notes: RevisionNote[] = [];

  constructor(private readonly parse: (yaml: string) => unknown) {}

  read(text: string): RevisionNote[] {
    const yaml = propertiesOf(text);
    if (yaml === this.yaml) return this.notes;
    this.yaml = yaml;
    let parsed: unknown = null;
    if (yaml !== null && yaml.includes('revision-notes')) {
      try {
        parsed = this.parse(yaml);
      } catch {
        parsed = null; // properties being typed by hand may be half written
      }
    }
    this.notes = parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? readNotes(parsed as Record<string, unknown>) : [];
    return this.notes;
  }
}

/** The marks of one editor. (Exported for the tests; the plugin reaches it through revisionEditor.) */
export class RevisionMarksView {
  decorations: DecorationSet = Decoration.none;
  readonly tip = new RevisionTip();
  private readonly reader: NotesReader;
  /** On a touch screen: the number of the line being typed, whose marks are left as they are; 0 for none. */
  private held = 0;
  private cancelRefresh: (() => void) | null = null;

  constructor(
    private readonly view: EditorView,
    private readonly host: RevisionEditorHost,
  ) {
    this.reader = new NotesReader((yaml) => host.parseProperties(yaml));
    this.decorations = this.build(0);
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
    const marks = passageMarks(text, this.reader.read(text));
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
    this.tip.show(this.view.dom.ownerDocument, notes, event.clientX, event.clientY);
  }

  destroy(): void {
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

export const TIP_CLASS = 'spellbook-revision-tip';
const BELOW = 22;
const EDGE = 8;

/** The bubble that shows a passage's note. One element at the end of the page, which never takes a tap or the keyboard. */
export class RevisionTip {
  private element: HTMLElement | null = null;
  private showing = '';

  get shown(): boolean {
    return this.element !== null;
  }

  show(page: Document, notes: readonly string[], x: number, y: number): void {
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
    const width = tip.offsetWidth || 0;
    const height = tip.offsetHeight || 0;
    const roomAcross = (view?.innerWidth ?? 0) - width - EDGE;
    const roomDown = (view?.innerHeight ?? 0) - height - EDGE;
    const across = Math.max(EDGE, roomAcross > EDGE ? Math.min(x, roomAcross) : EDGE);
    const down = roomDown > 0 && y + BELOW > roomDown ? Math.max(EDGE, y - BELOW - height) : y + BELOW;
    tip.style.left = `${Math.round(across)}px`;
    tip.style.top = `${Math.round(down)}px`;
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
