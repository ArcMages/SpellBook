// The commands of Obsidian and of every plugin, for the shortcut buttons of
// the bottom bar: which there are, what they are called, and running one.
//
// Obsidian keeps its commands in a place that is not part of what it promises
// plugins, so nothing here takes its shape for granted: a list that is not
// there is an empty list, a command that is not there cannot be run, and
// nothing ever throws. A button for a command that does not exist (its plugin
// is switched off, or was never installed) then simply does nothing.

import type { App } from 'obsidian';

/** A command as the settings and the bar need it. */
export interface CommandInfo {
  /** The command's full id, for example "editor:toggle-bold". */
  readonly id: string;
  /** Its name as the command palette shows it. */
  readonly name: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** The place where Obsidian keeps its commands, or null when it is not there. */
function registry(app: App): Record<string, unknown> | null {
  const commands: unknown = (app as unknown as { commands?: unknown } | null | undefined)?.commands;
  return isRecord(commands) ? commands : null;
}

function known(app: App): Record<string, unknown> | null {
  const byId = registry(app)?.['commands'];
  return isRecord(byId) ? byId : null;
}

function infoOf(id: string, command: unknown): CommandInfo | null {
  if (!isRecord(command)) return null;
  const name = command['name'];
  return { id, name: typeof name === 'string' && name.trim() !== '' ? name : id };
}

/** Every command there is right now, by name. Empty when they cannot be listed. */
export function listCommands(app: App): CommandInfo[] {
  try {
    const byId = known(app);
    if (byId === null) return [];
    const found: CommandInfo[] = [];
    for (const id of Object.keys(byId)) {
      const info = infoOf(id, byId[id]);
      if (info !== null) found.push(info);
    }
    return found.sort((a, b) => a.name.localeCompare(b.name));
  } catch (error) {
    console.error('Spellbook: the commands could not be listed', error);
    return [];
  }
}

/** The command with this id, or null when there is none right now. */
export function findCommand(app: App, id: string): CommandInfo | null {
  try {
    const byId = known(app);
    if (byId === null || !Object.prototype.hasOwnProperty.call(byId, id)) return null;
    return infoOf(id, byId[id]);
  } catch {
    return null;
  }
}

/**
 * Run a command.
 *
 * @returns whether there was such a command to run
 */
export function runCommand(app: App, id: string): boolean {
  try {
    if (findCommand(app, id) === null) return false;
    const commands = registry(app);
    const run = commands?.['executeCommandById'];
    if (typeof run !== 'function') return false;
    return (run as (this: unknown, id: string) => unknown).call(commands, id) !== false;
  } catch (error) {
    console.error(`Spellbook: the command "${id}" could not be run`, error);
    return false;
  }
}
