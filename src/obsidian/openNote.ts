// Showing a note in the workspace.

import { normalizePath } from 'obsidian';
import type { App, PaneType } from 'obsidian';

/**
 * Open the note at a vault path. Only opens notes that exist: it never
 * creates one.
 *
 * @param where false (the default) shows it in the tab the writer was last
 *              working in (or a new one when that tab is pinned); true or
 *              'tab' opens a new tab, 'split' a new pane next to it, 'window'
 *              a new window.
 * @returns false when there is no file at that path
 */
export async function openNote(app: App, path: string, where: PaneType | boolean = false): Promise<boolean> {
  const file = app.vault.getFileByPath(path) ?? app.vault.getFileByPath(normalizePath(path));
  if (!file) return false;
  const leaf = app.workspace.getLeaf(where);
  // In the current tab the note becomes the one being worked on. A new tab
  // is focused or not as the writer has set it in Obsidian's own options.
  if (where === false) await leaf.openFile(file, { active: true });
  else await leaf.openFile(file);
  return true;
}
