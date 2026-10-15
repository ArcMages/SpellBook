// Icons for the plugin's views. Obsidian's icon set has renamed a few icons
// over the years, so an icon is asked for by every name it has had and the
// first one this version of Obsidian knows is used.

import { getIcon, setIcon } from 'obsidian';

const known = new Map<string, boolean>();

function exists(id: string): boolean {
  let found = known.get(id);
  if (found === undefined) {
    found = getIcon(id) !== null;
    known.set(id, found);
  }
  return found;
}

/**
 * Put an icon into an element.
 *
 * @param ids the icon's names, the preferred one first; the last one is used
 *            when Obsidian knows none of them (it then simply shows nothing)
 */
export function showIcon(parent: HTMLElement, ...ids: string[]): void {
  const id = iconName(...ids);
  if (id !== null) setIcon(parent, id);
}

/**
 * The name to give to something that takes an icon by name (a menu item,
 * say): the first of `ids` this version of Obsidian knows, or the last one
 * when it knows none. Null when no names are given.
 */
export function iconName(...ids: string[]): string | null {
  return ids.find(exists) ?? ids[ids.length - 1] ?? null;
}

/** The view's own icon, in the tab header and on the ribbon. */
export const BINDER_ICON = 'book-open';
/** Points down; the stylesheet turns it sideways for something folded shut. */
export const FOLD_ICON = ['chevron-down'] as const;
export const WARNING_ICON = ['triangle-alert', 'alert-triangle'] as const;
/** The small mark of a note that is a whole chapter. */
export const CHAPTER_ICON = ['bookmark'] as const;
export const SWITCH_ICON = ['chevrons-up-down', 'chevron-down'] as const;

/** The "more" button of a row (three dots side by side) and of the toolbar (three dots, one above the other). */
export const ROW_MORE_ICON = ['ellipsis', 'more-horizontal'] as const;
export const TOOLBAR_MORE_ICON = ['ellipsis-vertical', 'more-vertical'] as const;

/** What the binder's buttons and menu items show. */
export const ACTION_ICONS = {
  newScene: ['file-plus-2', 'file-plus'],
  newFolder: ['folder-plus'],
  open: ['file-text', 'file'],
  openInNewTab: ['file-plus', 'file'],
  rename: ['pencil', 'edit-3'],
  moveUp: ['arrow-up'],
  moveDown: ['arrow-down'],
  moveToFolder: ['folder-input', 'folder-open', 'folder'],
  deleteScene: ['trash-2', 'trash'],
  treatAsChapter: ['bookmark-plus', 'bookmark'],
  treatAsScene: ['bookmark-minus', 'bookmark'],
  removeFolder: ['folder-minus', 'folder-x', 'folder'],
  removeEntry: ['list-x', 'x'],
  addToManuscript: ['list-plus', 'plus'],
  collapseAll: ['chevrons-down-up', 'fold-vertical', 'minimize-2'],
  expandAll: ['chevrons-up-down', 'unfold-vertical', 'maximize-2'],
  createProject: ['book-plus', 'book', 'plus'],
  sampleProject: ['book-copy', 'book-open', 'book'],
} as const satisfies Record<string, readonly string[]>;
