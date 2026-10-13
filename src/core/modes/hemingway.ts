// Hemingway mode: what counts as deleting, and is therefore refused.
//
// A draft only moves forward. Taking text away is refused in every way an
// editor offers: the Backspace and Delete keys, undo and redo, cutting,
// typing or pasting over a selection, and dragging text elsewhere. Adding
// text is always allowed.
//
// The decisions are made here, in three forms, because the editor is asked
// in three places (see src/features/modes/hemingwayGuard.ts):
//   - the keys of a keyboard (blockedKeys);
//   - what the keyboard or the system says it is about to do, which is all
//     an iPhone or iPad tells (blockedInput);
//   - the change itself, just before it is made, which catches whatever came
//     another way, such as the undo button of the phone's toolbar
//     (blockedChange).

/** What was refused. */
export type Blocked = 'delete' | 'undo' | 'cut' | 'replace' | 'move';

/** A key that is refused. `key` is for every keyboard; `mac` only for a Mac's. */
export interface BlockedKey {
  readonly key?: string;
  readonly mac?: string;
  readonly what: Blocked;
}

const MODIFIERS = ['', 'Shift-', 'Alt-', 'Mod-', 'Ctrl-', 'Alt-Shift-', 'Mod-Shift-', 'Ctrl-Shift-', 'Mod-Alt-', 'Ctrl-Alt-'];

/**
 * The keys that take text away, as the editor names them ("Mod" is Command
 * on a Mac and Control elsewhere). Backspace and Delete are refused with any
 * modifier held, since each only deletes more.
 */
export function blockedKeys(): BlockedKey[] {
  const keys: BlockedKey[] = [];
  for (const modifier of MODIFIERS) {
    // Shift-Delete is the old key for "cut".
    keys.push({ key: `${modifier}Backspace`, what: 'delete' });
    keys.push({ key: `${modifier}Delete`, what: modifier === 'Shift-' ? 'cut' : 'delete' });
  }
  for (const key of ['Mod-z', 'Mod-Shift-z', 'Mod-y']) keys.push({ key, what: 'undo' });
  keys.push({ key: 'Mod-x', what: 'cut' });
  // A Mac's own text keys: delete backward, delete forward, delete to the end of the line.
  for (const mac of ['Ctrl-h', 'Ctrl-d', 'Ctrl-k']) keys.push({ mac, what: 'delete' });
  return keys;
}

/**
 * What a keyboard or the system is about to do, by the name the browser
 * gives it ("deleteContentBackward", "historyUndo", "insertText" ...).
 *
 * @param selectionEmpty whether nothing is selected in the editor
 * @returns what is refused, or null when it may go ahead
 */
export function blockedInput(inputType: string, selectionEmpty: boolean): Blocked | null {
  // Text that is still being composed (a dictation, an accent being chosen)
  // is rewritten by the keyboard as it goes: that is typing, not deleting.
  if (/Composition/i.test(inputType)) return null;
  if (inputType === 'historyUndo' || inputType === 'historyRedo') return 'undo';
  if (inputType === 'deleteByCut') return 'cut';
  if (inputType === 'deleteByDrag') return 'move';
  if (inputType.startsWith('delete')) return 'delete';
  // Typing, pasting or dropping onto a selection wipes what was selected.
  // (A correction the keyboard makes by itself comes with nothing selected, and goes ahead.)
  if (inputType.startsWith('insert') && !selectionEmpty) return 'replace';
  return null;
}

/** What is known about a change that is about to be made to the text. */
export interface ChangeFacts {
  /** What the editor says caused it ("input.type", "delete.backward", "undo" ...); undefined when no writer did. */
  readonly userEvent: string | undefined;
  /** Whether it takes any text away. */
  readonly removes: boolean;
  /** Whether nothing was selected before it. */
  readonly selectionEmpty: boolean;
}

/** True when a cause is `kind` itself or a finer kind of it ("delete.cut" is a "delete"). */
function isKind(userEvent: string, kind: string): boolean {
  return userEvent === kind || userEvent.startsWith(`${kind}.`);
}

/**
 * Whether a change is refused, or null when it may be made.
 *
 * A change with no cause at all was not made by the writer in this editor:
 * the note was loaded again after a sync, or a command changed it. It is
 * never refused, or a note could stop following its own file.
 */
export function blockedChange(facts: ChangeFacts): Blocked | null {
  const cause = facts.userEvent;
  if (cause === undefined) return null;
  if (isKind(cause, 'undo') || isKind(cause, 'redo')) return 'undo';
  if (isKind(cause, 'delete.cut')) return 'cut';
  if (isKind(cause, 'delete')) return 'delete';
  if (isKind(cause, 'move')) return 'move';
  if (isKind(cause, 'input.type.compose')) return null;
  if (isKind(cause, 'input') && facts.removes && !facts.selectionEmpty) return 'replace';
  return null;
}

/** What the writer is told the first time something is refused. */
export function blockedText(what: Blocked): string {
  const refused: Record<Blocked, string> = {
    delete: 'Deleting is switched off',
    undo: 'Undo and redo are switched off',
    cut: 'Cutting is switched off',
    replace: 'Writing over selected text is switched off',
    move: 'Dragging text away is switched off',
  };
  return `${refused[what]} while Hemingway mode is on: the draft only moves forward.`;
}
