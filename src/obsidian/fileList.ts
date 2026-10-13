// Showing an exported file in Obsidian's own file list (the file explorer in
// the sidebar).
//
// Obsidian promises plugins no way of showing a file in the device's own file
// manager (Finder, Explorer), and the plugin may not reach for the device
// itself. What it can do is bring Obsidian's file list to the front and ask
// it to point at the file. Bringing the list to the front is part of what
// Obsidian promises; pointing at a file is not, so nothing here takes it for
// granted: a list that cannot point is still brought to the front, and
// nothing ever throws.
//
// Nothing here changes a file.

import type { App, TAbstractFile } from 'obsidian';

/** The name Obsidian gives its file list among the panes. */
const FILE_LIST_VIEW_TYPE = 'file-explorer';

/** Ask the file list to point at a file or a folder. */
function pointAt(view: unknown, file: TAbstractFile): boolean {
  if (typeof view !== 'object' || view === null) return false;
  const reveal = (view as Record<string, unknown>)['revealInFolder'];
  if (typeof reveal !== 'function') return false;
  try {
    (reveal as (this: unknown, file: TAbstractFile) => unknown).call(view, file);
    return true;
  } catch {
    return false;
  }
}

/**
 * Bring Obsidian's file list to the front and point at the file there. A
 * file the list does not show (a Word file or a web page, while "Detect all
 * file extensions" is off) cannot be pointed at: then its folder is.
 *
 * @param path the file's vault path
 * @returns whether the file list was brought to the front
 */
export async function showInFileList(app: App, path: string): Promise<boolean> {
  try {
    const leaf = app.workspace.getLeavesOfType(FILE_LIST_VIEW_TYPE)[0];
    if (!leaf) return false;
    await app.workspace.revealLeaf(leaf);
    const file = app.vault.getAbstractFileByPath(path);
    if (file === null) return true;
    if (!pointAt(leaf.view, file) && file.parent) pointAt(leaf.view, file.parent);
    return true;
  } catch (error) {
    console.error('Spellbook: the file list could not be shown', error);
    return false;
  }
}
