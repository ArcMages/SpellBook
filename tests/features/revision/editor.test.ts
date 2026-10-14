// The underlined passages in the editor: which words are marked, that they
// follow the text, and that the line being typed on a phone keeps its marks.

import { EditorState } from '@codemirror/state';
import type { TransactionSpec } from '@codemirror/state';
import type { DecorationSet, EditorView, ViewUpdate } from '@codemirror/view';
import { editorInfoField } from 'obsidian';
import { describe, expect, it } from 'vitest';
import { NotesReader, PASSAGE_NOTE, RevisionMarksView, notesAt } from '../../../src/features/revision/index';
import { markLineAt, tipPlace } from '../../../src/features/revision/editor';
import type { RevisionEditorHost } from '../../../src/features/revision/editor';
import { ManualTimers } from '../../memoryVault';
import { FakeElement } from '../../obsidianStub';

/** The properties as the memory vault writes them: one "key: JSON" line each. */
function parse(yaml: string): unknown {
  const out: Record<string, unknown> = {};
  for (const line of yaml.split('\n')) {
    const colon = line.indexOf(':');
    if (colon > 0) out[line.slice(0, colon).trim()] = JSON.parse(line.slice(colon + 1).trim()) as unknown;
  }
  return out;
}

const notes = (list: unknown[]): string => `---\norder: 1\nrevision-notes: ${JSON.stringify(list)}\n---\n`;

function marked(decorations: DecorationSet, state: EditorState): string[] {
  const found: string[] = [];
  for (const cursor = decorations.iter(); cursor.value !== null; cursor.next()) {
    const spec = cursor.value.spec as { attributes: Record<string, string> };
    found.push(`${state.doc.sliceString(cursor.from, cursor.to)} = ${spec.attributes[PASSAGE_NOTE] ?? ''}`);
  }
  return found;
}

class FakeEditor {
  state: EditorState;
  hasFocus = true;
  readonly dom = new FakeElement('div');
  readonly contentDOM = new FakeElement('div');
  readonly marks: RevisionMarksView;

  constructor(path: string, text: string, host: RevisionEditorHost) {
    this.state = EditorState.create({ doc: text, extensions: [editorInfoField.init(() => ({ file: { path } }) as never)] });
    this.marks = new RevisionMarksView(this as unknown as EditorView, host);
  }

  get picture(): string[] {
    return marked(this.marks.decorations, this.state);
  }

  dispatch(spec: TransactionSpec): void {
    const before = this.state;
    const transaction = before.update(spec);
    this.state = transaction.state;
    this.marks.update({
      docChanged: transaction.docChanged,
      selectionSet: !before.selection.eq(transaction.state.selection),
      viewportChanged: false,
      focusChanged: false,
      transactions: [transaction],
      changes: transaction.changes,
      startState: before,
      state: transaction.state,
      view: this,
    } as unknown as ViewUpdate);
  }
}

function hostOf(timers: ManualTimers, touch = false): RevisionEditorHost {
  return { covers: (path) => path !== null && path.startsWith('Novel/'), parseProperties: parse, touch, setTimer: timers.set };
}

describe('the underlined passages', () => {
  const body = 'The harbour was empty.\nהנמל היה ריק, והים שקט.\n';
  const list = [
    { passage: 'harbour was empty', note: 'Say what she hears.', created: '2026-10-14', done: false },
    { passage: 'הים שקט', note: 'למה?', created: '2026-10-14', done: false },
    { passage: 'empty', note: 'done already', created: '2026-10-14', done: true },
    { passage: 'gone words', note: 'changed', created: '2026-10-14', done: false },
  ];

  it('mark the open notes whose words are in the text, in English and Hebrew, with their notes', () => {
    const editor = new FakeEditor('Novel/Manuscript/Opening.md', notes(list) + body, hostOf(new ManualTimers()));
    expect(editor.picture).toEqual(['harbour was empty = Say what she hears.', 'הים שקט = למה?']);
  });

  it('mark nothing outside a Spellbook project, and nothing in a note without notes', () => {
    expect(new FakeEditor('Elsewhere/Note.md', notes(list) + body, hostOf(new ManualTimers())).picture).toEqual([]);
    expect(new FakeEditor('Novel/Manuscript/Opening.md', body, hostOf(new ManualTimers())).picture).toEqual([]);
  });

  it('move with the text at once, and are worked out again after a pause', () => {
    const timers = new ManualTimers();
    const editor = new FakeEditor('Novel/Manuscript/Opening.md', notes(list) + body, hostOf(timers));
    const start = editor.state.doc.toString().indexOf('The harbour');
    editor.dispatch({ changes: { from: start, insert: 'Look. ' }, userEvent: 'input.type' });
    expect(editor.picture[0]).toBe('harbour was empty = Say what she hears.');
    // A word of the passage is changed: the mark stays until the pause, then goes.
    const at = editor.state.doc.toString().indexOf('empty.');
    editor.dispatch({ changes: { from: at, to: at + 5, insert: 'full' }, userEvent: 'input.type' });
    timers.advance(1000);
    expect(editor.picture).toEqual(['הים שקט = למה?']);
  });

  it('show a note added to the properties straight away, without waiting for the vault', () => {
    const timers = new ManualTimers();
    const editor = new FakeEditor('Novel/Manuscript/Opening.md', notes([]) + body, hostOf(timers));
    expect(editor.picture).toEqual([]);
    const text = editor.state.doc.toString();
    const head = text.indexOf('revision-notes: []') + 'revision-notes: '.length;
    editor.dispatch({ changes: { from: head, to: head + 2, insert: JSON.stringify(list.slice(0, 1)) } });
    timers.advance(1000);
    expect(editor.picture).toEqual(['harbour was empty = Say what she hears.']);
  });

  it('on a touch screen leave the marks of the line being typed alone until the caret leaves it', () => {
    const timers = new ManualTimers();
    const editor = new FakeEditor('Novel/Manuscript/Opening.md', notes(list) + body, hostOf(timers, true));
    const at = editor.state.doc.toString().indexOf('empty.');
    editor.dispatch({ changes: { from: at, to: at + 5, insert: 'full' }, selection: { anchor: at + 4 }, userEvent: 'input.type' });
    timers.advance(1000);
    expect(editor.picture[0]).toBe('harbour was full = Say what she hears.'); // kept, moved with the text
    editor.dispatch({ selection: { anchor: editor.state.doc.length } });
    expect(editor.picture).toEqual(['הים שקט = למה?']);
  });

  it('read the properties only when they change, and survive properties that cannot be read', () => {
    let parsed = 0;
    const reader = new NotesReader((yaml) => {
      parsed++;
      return parse(yaml);
    });
    const text = notes(list) + body;
    expect(reader.read(text)).toHaveLength(4);
    reader.read(`${text}more`);
    expect(parsed).toBe(1);
    expect(new NotesReader(() => {
      throw new Error('bad yaml');
    }).read(text)).toEqual([]);
  });

  it('give the bubble the notes of the marks under the pointer, the innermost first', () => {
    const outer = new FakeElement('span');
    outer.setAttr(PASSAGE_NOTE, 'outer');
    const inner = outer.createSpan({});
    inner.setAttr(PASSAGE_NOTE, 'inner');
    const word = inner.createSpan({});
    expect(notesAt(word, null)).toEqual(['inner', 'outer']);
    expect(notesAt(word, outer)).toEqual(['inner']);
  });
});

describe('where the bubble of a note goes', () => {
  const tip = { width: 200, height: 40 };
  const screen = { width: 1000, height: 800 };

  it('stands above the line of the passage, so that it covers neither the passage nor the line after it', () => {
    const line = { top: 300, bottom: 320 };
    const place = tipPlace(tip, screen, 120, 310, line);
    expect(place.top + tip.height).toBeLessThanOrEqual(line.top);
    expect(place.left).toBe(120);
  });

  it('goes below the line only when there is no room above it, and stays on the screen across', () => {
    const line = { top: 20, bottom: 40 };
    const place = tipPlace(tip, screen, 950, 30, line);
    expect(place.top).toBeGreaterThanOrEqual(line.bottom);
    expect(place.left + tip.width).toBeLessThanOrEqual(screen.width);
  });

  it('finds the line of the mark under the pointer, among the lines a passage runs over', () => {
    const within = new FakeElement('div');
    const mark = within.createSpan({ attr: { [PASSAGE_NOTE]: 'Colder.' } });
    const word = mark.createSpan({ text: 'night' });
    (mark as unknown as { getClientRects: () => Array<{ top: number; bottom: number }> }).getClientRects = () => [
      { top: 100, bottom: 120 },
      { top: 120, bottom: 140 },
    ];
    expect(markLineAt(word, within, 130)).toEqual({ top: 120, bottom: 140 });
    expect(markLineAt(within, within, 130)).toBeNull();
  });
});
