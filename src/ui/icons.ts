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
  const id = ids.find(exists) ?? ids[ids.length - 1];
  if (id !== undefined) setIcon(parent, id);
}

/** The view's own icon, in the tab header and on the ribbon. */
export const BINDER_ICON = 'book-open';
/** Points down; the stylesheet turns it sideways for something folded shut. */
export const FOLD_ICON = ['chevron-down'] as const;
export const WARNING_ICON = ['triangle-alert', 'alert-triangle'] as const;
export const SWITCH_ICON = ['chevrons-up-down', 'chevron-down'] as const;
