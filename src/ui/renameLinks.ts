// What a rename window and the notice after a rename say about the links to
// the renamed note. Spellbook brings those links up to date itself (see
// relocate in src/core/projectStore.ts), in the open project only or in the
// whole vault, as the writer chose under "When a note is renamed, update
// links in" in the plugin's settings.

import { formatCount } from '../core/binderModel';
import type { LinkScope } from '../core/links';
import type { MovedLinks } from '../core/projectStore';

/** Where the setting is, for the texts that point at it. */
export const LINK_SETTING_HINT = 'To change them too, choose "The whole vault" under "When a note is renamed, update links in" in Spellbook\'s settings.';

/** What happens to the links to a note that is renamed, as the setting has it now. */
export function linkScopeText(scope: LinkScope): string {
  return scope === 'vault'
    ? 'Every link to it in the vault is changed to the new name.'
    : 'Every link to it in this project is changed to the new name.';
}

/** Why links from notes outside the project keep the old name. */
export function outsideText(count: number): string {
  return (
    `${formatCount(count)} ${count === 1 ? 'note' : 'notes'} outside the project ${count === 1 ? 'links' : 'link'} to it, ` +
    `and ${count === 1 ? 'that link keeps' : 'those links keep'} the old name: links are changed in this project only. ${LINK_SETTING_HINT}`
  );
}

/**
 * The line a rename window shows under the name: where the links are
 * changed, and how many notes outside the project keep the old name.
 *
 * @param outside how many notes outside the project link to it (counted for the scope "project")
 */
export function renameWindowText(scope: LinkScope, outside: number): string {
  const lines = [linkScopeText(scope)];
  if (scope === 'project' && outside > 0) lines.push(outsideText(outside));
  return lines.join(' ');
}

/**
 * What the writer is told after a rename about its links, when there is
 * something to tell: notes outside the project that keep the old name, and
 * notes whose links could not be changed. Null otherwise.
 */
export function renamedLinksNotice(name: string, links: MovedLinks): string | null {
  const parts: string[] = [];
  if (links.missed.length > 0) parts.push(`The links to "${name}" in these notes could not be changed: ${links.missed.join(', ')}.`);
  if (links.outside.length > 0) {
    const count = links.outside.length;
    parts.push(
      `${formatCount(count)} ${count === 1 ? 'note' : 'notes'} outside the project still ${count === 1 ? 'links' : 'link'} to the old name of "${name}". ${LINK_SETTING_HINT}`,
    );
  }
  return parts.length === 0 ? null : parts.join('\n');
}
