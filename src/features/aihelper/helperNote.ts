// Writing the reference for AI assistants into the open project.
//
// The text is the plugin's own (referenceText.ts, generated from the file in
// the repository). It goes into one fixed note of the project, through the
// project store, which writes that note and no other. A copy that is already
// there is never written over without the writer saying so:
//
//   no note yet                     the note is made
//   the note says exactly this      nothing is written
//   the note says something else    the writer is asked; "Replace" writes it
//                                   only if the note still says what it said
//                                   when the question was asked
//
// Nothing here touches the screen: index.ts shows what comes of it.

import { joinPath } from '../../core/paths';
import { AI_HELPER_FILE, AI_HELPER_FOLDER } from '../../core/projectLayout';
import type { ProjectStore } from '../../core/projectStore';
import { HELPER_TEXT } from './referenceText';

/** The note's path inside a project folder. */
export const HELPER_NOTE_PATH = `${AI_HELPER_FOLDER}/${AI_HELPER_FILE}`;

/** What asking for the note came to. */
export type HelperOutcome =
  /** The note is in the project and says what this version ships. `created`: it was made just now. */
  | { readonly status: 'ready'; readonly path: string; readonly created: boolean }
  /** A note is there that says something else: it was changed, or made by another version. Nothing was written. */
  | { readonly status: 'differs'; readonly path: string; readonly found: string }
  /** Nothing was written, and `message` says why. */
  | { readonly status: 'problem'; readonly message: string };

/** What replacing a note that differs came to. */
export type ReplaceOutcome =
  | { readonly status: 'replaced'; readonly path: string }
  /** The note is no longer what the writer was asked about, so it was left as it is. */
  | { readonly status: 'changed-again'; readonly path: string }
  | { readonly status: 'problem'; readonly message: string };

export const NO_PROJECT_TEXT = 'Open a Spellbook project first: the AI helper note is made inside a project.';

/** Two texts as they are compared: line breaks of either kind, and space at the end, do not count. */
function comparable(text: string): string {
  const plain = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  return plain.replace(/\r\n?/g, '\n').replace(/\s+$/, '');
}

/** True when a note says what this version of the plugin ships. */
export function isShippedText(text: string): boolean {
  return comparable(text) === comparable(HELPER_TEXT);
}

/**
 * Make the note in the open project, or leave the one that is there.
 *
 * @param inProject the index path of the project the writer asked for
 */
export async function ensureHelperNote(store: ProjectStore, inProject: string): Promise<HelperOutcome> {
  const project = store.project;
  if (!project || project.indexPath !== inProject) return { status: 'problem', message: NO_PROJECT_TEXT };
  const path = joinPath(project.folder, HELPER_NOTE_PATH);
  let found: string | null = null;
  const result = await store.updateHelperNote((current) => {
    found = current;
    return current === null ? HELPER_TEXT : null;
  }, inProject);
  if (result.status === 'done') return { status: 'ready', path, created: true };
  if (result.status !== 'noop') return { status: 'problem', message: result.message };
  const there = found as string | null;
  if (there === null) return { status: 'problem', message: result.message };
  return isShippedText(there) ? { status: 'ready', path, created: false } : { status: 'differs', path, found: there };
}

/**
 * Put this version's text in the place of a note that differs, after the
 * writer said so. It is written only when the note still says `found`: a
 * note that another device changed in the meantime is left alone.
 *
 * @param found the text the note held when the writer was asked
 */
export async function replaceHelperNote(store: ProjectStore, inProject: string, found: string): Promise<ReplaceOutcome> {
  const project = store.project;
  if (!project || project.indexPath !== inProject) return { status: 'problem', message: NO_PROJECT_TEXT };
  const path = joinPath(project.folder, HELPER_NOTE_PATH);
  const result = await store.updateHelperNote((current) => (current === found ? HELPER_TEXT : null), inProject);
  if (result.status === 'done') return { status: 'replaced', path };
  if (result.status === 'noop') return { status: 'changed-again', path };
  return { status: 'problem', message: result.message };
}
