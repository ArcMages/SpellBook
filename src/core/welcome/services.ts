// What the plugin offers the welcome and help screens through the feature
// services (see src/features/registry.ts): the commands it registered, to
// list and to run. The plugin entry point provides it; a screen asks for it
// each time it needs it.

import type { CommandName } from './help';

/** The name the commands are offered under. */
export const COMMANDS_SERVICE = 'spellbook.commands';

export interface CommandsService {
  /** Every command the plugin registered, in the order it registered them. */
  list(): CommandName[];
  /**
   * Run one of them by its own id ("create-project"), as the command palette
   * would. False when there is no such command, or it cannot run now.
   */
  run(id: string): boolean;
}
