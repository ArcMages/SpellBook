// What the Help pane lists: the tutorial's steps in short, and every
// Spellbook command with what it does.
//
// The list of commands is made from the commands the plugin registered, so
// that it is always complete. What each one does comes from the table of
// commands in the user guide (docs/guide.md, "All commands"), which the
// plugin ships (see src/features/welcome/bundledText.ts); a command the table does not describe
// is listed with its name alone.

import { plainText } from './changelog';

/** A command as the plugin registered it: its own id and name, without the plugin's in front. */
export interface CommandName {
  readonly id: string;
  readonly name: string;
}

/** One line of the Help pane's list of commands. */
export interface CommandHelp extends CommandName {
  /** What the command does, or null when the guide does not say. */
  readonly description: string | null;
}

/** One step of the tutorial. */
export interface TutorialStep {
  readonly number: number;
  readonly title: string;
}

/** The cells of a Markdown table row, or null when the line is not one. */
function cellsOf(line: string): string[] | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('|') || !trimmed.endsWith('|') || trimmed.length < 2) return null;
  return trimmed
    .slice(1, -1)
    .split('|')
    .map((cell) => cell.trim());
}

/**
 * What each command does, by its name, from a Markdown table whose first
 * column is the command's name and whose second says what it does. The
 * header row and the line under it are passed over.
 */
export function parseCommandTable(markdown: string): Map<string, string> {
  const found = new Map<string, string>();
  let rows = 0;
  for (const line of markdown.replace(/\r\n?/g, '\n').split('\n')) {
    const cells = cellsOf(line);
    if (!cells) {
      rows = 0;
      continue;
    }
    rows++;
    if (rows === 1) continue; // the header
    if (cells.every((cell) => /^:?-{3,}:?$/.test(cell))) continue;
    const [name, description] = cells;
    if (name === undefined || description === undefined) continue;
    const key = plainText(name);
    if (key !== '' && !found.has(key)) found.set(key, plainText(description));
  }
  return found;
}

/** The numbered steps of a list of contents: lines such as "3. [Create your own project](#3-create-your-own-project)". */
export function parseTutorialSteps(markdown: string): TutorialStep[] {
  const steps: TutorialStep[] = [];
  for (const line of markdown.replace(/\r\n?/g, '\n').split('\n')) {
    const match = /^\s*(\d+)\.\s+(.+)$/.exec(line);
    if (!match) continue;
    const title = plainText(match[2] ?? '');
    if (title !== '') steps.push({ number: Number(match[1]), title });
  }
  return steps;
}

/**
 * The list of commands for the Help pane: every command given, once, in the
 * order given, with what the guide says it does.
 */
export function commandHelp(commands: readonly CommandName[], descriptions: ReadonlyMap<string, string>): CommandHelp[] {
  const seen = new Set<string>();
  const out: CommandHelp[] = [];
  for (const command of commands) {
    if (seen.has(command.id)) continue;
    seen.add(command.id);
    out.push({ id: command.id, name: command.name, description: descriptions.get(command.name) ?? null });
  }
  return out;
}
