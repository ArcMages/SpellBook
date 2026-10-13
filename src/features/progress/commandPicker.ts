// The window in which the writer picks the command a new shortcut button
// runs: every command of Obsidian and of the plugins that are switched on,
// with a field to search them by name.

import { FuzzySuggestModal } from 'obsidian';
import type { App } from 'obsidian';
import { listCommands } from './commands';
import type { CommandInfo } from './commands';

export class CommandPicker extends FuzzySuggestModal<CommandInfo> {
  private readonly commands: CommandInfo[];
  private readonly onPick: (command: CommandInfo) => void;

  /**
   * @param onPick called with the command the writer chose; not called when the window is closed without choosing
   */
  constructor(app: App, onPick: (command: CommandInfo) => void) {
    super(app);
    this.commands = listCommands(app);
    this.onPick = onPick;
    this.setPlaceholder('Search for a command...');
    this.emptyStateText = 'No command by that name.';
  }

  getItems(): CommandInfo[] {
    return this.commands;
  }

  getItemText(command: CommandInfo): string {
    return command.name;
  }

  onChooseItem(command: CommandInfo): void {
    this.onPick(command);
  }
}
