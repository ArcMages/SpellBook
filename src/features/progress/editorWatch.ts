// Watching the editor: one CodeMirror extension that reports every change of
// a note's text, with the kind of change read from the transaction.
//
// It only looks. It never changes the text, the selection or the scroll
// position, and it draws nothing: on an iPhone or iPad anything else would
// disturb the line being typed. The work done here, inside the editor's own
// update, is a handful of comparisons; counting words is left to the
// listener, which does it later (see wordLedger.ts).

import { Transaction } from '@codemirror/state';
import type { Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import type { ViewUpdate } from '@codemirror/view';
import { editorInfoField } from 'obsidian';
import type { EditKind } from '../../core/progress/index';
import { isMarkdownPath } from '../../core/paths';
import type { EditorEdit } from './wordLedger';

/**
 * The kind of a change, from the "user event" the editor attached to it.
 * A change with no user event at all was not made by the writer in this
 * editor: the note was loaded again after a sync, or a program changed it.
 */
export function kindOfChange(transaction: Transaction): EditKind {
  if (transaction.isUserEvent('undo')) return 'undo';
  if (transaction.isUserEvent('redo')) return 'redo';
  if (transaction.isUserEvent('input.paste')) return 'paste';
  if (transaction.isUserEvent('input.drop') || transaction.isUserEvent('move')) return 'drop';
  if (transaction.isUserEvent('delete.cut')) return 'cut';
  return transaction.annotation(Transaction.userEvent) === undefined ? 'external' : 'typed';
}

/** Read one change of the text out of a transaction. */
function editOf(path: string, transaction: Transaction): EditorEdit {
  const kind = kindOfChange(transaction);
  let inserted = 0;
  let removed = 0;
  // The size of the change is only of use for telling a paste's undo from
  // typing; for typing itself it is not worked out.
  if (kind !== 'typed' && kind !== 'external') {
    transaction.changes.iterChanges((fromA, toA, fromB, toB) => {
      removed += toA - fromA;
      inserted += toB - fromB;
    });
  }
  return {
    path,
    kind,
    before: transaction.startState.doc,
    after: transaction.newDoc,
    inserted,
    removed,
    undoable: transaction.annotation(Transaction.addToHistory) !== false,
  };
}

/**
 * The editor extension. `onEdit` is called for every change of the text of a
 * markdown note, in the order the changes were made, from inside the editor's
 * update: it must do next to nothing there.
 */
export function editorWatch(onEdit: (edit: EditorEdit) => void): Extension {
  return EditorView.updateListener.of((update: ViewUpdate) => {
    if (!update.docChanged) return;
    try {
      const path = update.state.field(editorInfoField, false)?.file?.path;
      if (typeof path !== 'string' || !isMarkdownPath(path)) return;
      for (const transaction of update.transactions) {
        if (transaction.docChanged) onEdit(editOf(path, transaction));
      }
    } catch (error) {
      // Counting words must never get in the way of writing them.
      console.error('Spellbook: an edit could not be counted', error);
    }
  });
}
