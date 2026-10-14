// Hemingway mode in the editor: one extension that refuses whatever takes
// text away. What is refused is the engine's decision
// (src/core/modes/hemingway.ts); this file only asks it, in three places:
//
//   1. the keys of a keyboard, before any other key binding sees them;
//   2. what the keyboard or the system announces it is about to do. An
//      iPhone or iPad sends no key for its Backspace: this is where its
//      deleting is stopped, before the keyboard has changed anything;
//   3. the change itself, just before the editor makes it. This catches
//      what came another way: the undo button of the phone's toolbar, the
//      Edit menu, a command.
//
// What the writer chose to let through (undo, on a phone, by default) is
// left alone in all three places.
//
// A change that no writer made (the note loaded again after a sync) is
// never refused. Nothing here changes the text, the selection or the scroll
// position, and nothing is drawn in the editor.

import { EditorState, Prec, Transaction } from '@codemirror/state';
import type { Extension } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import type { KeyBinding } from '@codemirror/view';
import { blockedChange, blockedInput, blockedKeys } from '../../core/modes/index';
import type { Blocked } from '../../core/modes/index';

/**
 * Told each time something was refused.
 *
 * @param editorEl the editor it happened in, when that is known
 */
export type BlockedReport = (what: Blocked, editorEl: HTMLElement | null) => void;

/** Whether nothing is selected in any of the editor's selections. */
function nothingSelected(state: EditorState): boolean {
  return state.selection.ranges.every((range) => range.empty);
}

const NOTHING_ALLOWED: ReadonlySet<Blocked> = new Set();

/** What is refused, unless the writer let it through. */
function unlessAllowed(what: Blocked | null, allowed: ReadonlySet<Blocked>): Blocked | null {
  return what !== null && allowed.has(what) ? null : what;
}

/** Whether a change that is about to be made is refused. */
export function blockedTransaction(transaction: Transaction, allowed: ReadonlySet<Blocked> = NOTHING_ALLOWED): Blocked | null {
  if (!transaction.docChanged) return null;
  let removes = false;
  transaction.changes.iterChangedRanges((fromA, toA) => {
    if (toA > fromA) removes = true;
  });
  const what = blockedChange({
    userEvent: transaction.annotation(Transaction.userEvent),
    removes,
    selectionEmpty: nothingSelected(transaction.startState),
  });
  return unlessAllowed(what, allowed);
}

/** What the keyboard or the system is about to do: true when it was refused (and must not happen). */
export function guardInput(event: { inputType?: unknown }, state: EditorState, allowed: ReadonlySet<Blocked> = NOTHING_ALLOWED): Blocked | null {
  return typeof event.inputType === 'string' ? unlessAllowed(blockedInput(event.inputType, nothingSelected(state)), allowed) : null;
}

/**
 * The editor extension. A new one is made each time Hemingway is switched on.
 *
 * @param allowed what the writer lets through on this device
 */
export function hemingwayGuard(report: BlockedReport, allowed: ReadonlySet<Blocked> = NOTHING_ALLOWED): Extension {
  const refuse = (what: Blocked) => (view: EditorView): boolean => {
    report(what, view.dom);
    return true;
  };
  const keys: KeyBinding[] = [];
  for (const entry of blockedKeys()) {
    if (allowed.has(entry.what)) continue;
    const binding: KeyBinding = { run: refuse(entry.what), preventDefault: true };
    if (entry.key !== undefined) binding.key = entry.key;
    if (entry.mac !== undefined) binding.mac = entry.mac;
    keys.push(binding);
  }
  const stop = (what: Blocked | null, view: EditorView): boolean => {
    if (what === null) return false;
    report(what, view.dom);
    // Returning true has the editor call preventDefault on the event.
    return true;
  };

  return Prec.highest([
    keymap.of(keys),
    EditorView.domEventHandlers({
      beforeinput: (event, view) => stop(guardInput(event, view.state, allowed), view),
      cut: (_event, view) => stop('cut', view),
      // Dragging text out of the editor would take it away from where it was.
      dragstart: (_event, view) => stop('move', view),
    }),
    EditorState.transactionFilter.of((transaction) => {
      const what = blockedTransaction(transaction, allowed);
      if (what === null) return transaction;
      report(what, null);
      return [];
    }),
  ]);
}
