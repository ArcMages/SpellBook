// Running what a button or a menu item does, without letting a failure in it
// reach Obsidian (where it would show up as an error of the app itself) or
// stop the plugin's other buttons from working.

import { Notice } from 'obsidian';

function tell(what: string, error: unknown): void {
  console.error(`Spellbook: "${what}" failed`, error);
  new Notice(`"${what}" did not work: ${error instanceof Error ? error.message : String(error)}`, 10000);
}

/**
 * Run `action` now, in the same turn as the tap or key press that asked for
 * it (a window that is opened later than that may not get the keyboard on a
 * phone). If it fails, at once or later, the writer is told in a notice.
 *
 * @param what the name of the button or menu item, for the notice
 */
export function safely(what: string, action: () => unknown): void {
  try {
    const outcome = action();
    if (outcome instanceof Promise) {
      outcome.catch((error: unknown) => {
        tell(what, error);
      });
    }
  } catch (error) {
    tell(what, error);
  }
}
