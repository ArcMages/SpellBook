// Showing a note in the workspace.

import { normalizePath } from 'obsidian';
import type { App } from 'obsidian';

/**
 * Open the note at a vault path in the current tab (or a new one when the
 * current tab is pinned). Only opens notes that exist: it never creates one.
 *
 * @returns false when there is no file at that path
 */
export async function openNote(app: App, path: string): Promise<boolean> {
  const file = app.vault.getFileByPath(path) ?? app.vault.getFileByPath(normalizePath(path));
  if (!file) return false;
  await app.workspace.getLeaf(false).openFile(file);
  return true;
}
