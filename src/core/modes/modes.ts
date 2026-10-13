// The four writing modes, and which of them are switched on.
//
// A mode is either on or off for the whole device: Zen hides the interface
// around the note, Letter box covers everything but a band of lines,
// Typewriter keeps the line being written at one height, and Hemingway stops
// anything from being deleted. Which are on is kept on the device, as a
// short piece of text (see parseModes and formatModes).

export const MODE_IDS = ['zen', 'letter-box', 'typewriter', 'hemingway'] as const;

export type ModeId = (typeof MODE_IDS)[number];

/** Which modes are on. */
export type ModeSet = Readonly<Record<ModeId, boolean>>;

/** A mode's name, and the command that switches it on and off. Obsidian puts the plugin's name in front of a command's name. */
export interface ModeInfo {
  readonly name: string;
  readonly command: { readonly id: string; readonly name: string };
}

export const MODES: Readonly<Record<ModeId, ModeInfo>> = {
  zen: { name: 'Zen mode', command: { id: 'toggle-zen-mode', name: 'Toggle Zen mode' } },
  'letter-box': { name: 'Letter box mode', command: { id: 'toggle-letter-box-mode', name: 'Toggle letter box mode' } },
  typewriter: { name: 'Typewriter mode', command: { id: 'toggle-typewriter-mode', name: 'Toggle typewriter mode' } },
  hemingway: { name: 'Hemingway mode', command: { id: 'toggle-hemingway-mode', name: 'Toggle Hemingway mode' } },
};

/** Every mode off. */
export const NO_MODES: ModeSet = Object.freeze({ zen: false, 'letter-box': false, typewriter: false, hemingway: false });

export function isModeId(value: unknown): value is ModeId {
  return typeof value === 'string' && (MODE_IDS as readonly string[]).includes(value);
}

/** The same set with one mode switched on or off. */
export function withMode(modes: ModeSet, id: ModeId, on: boolean): ModeSet {
  return modes[id] === on ? modes : Object.freeze({ ...modes, [id]: on });
}

/** Whether any mode is on. */
export function anyMode(modes: ModeSet): boolean {
  return MODE_IDS.some((id) => modes[id]);
}

/**
 * Which modes are on, read from what the device kept: the ids of the modes
 * that are on, with commas between them. Whatever comes back can be
 * anything, so what is not the id of a mode is passed over.
 */
export function parseModes(stored: unknown): ModeSet {
  if (typeof stored !== 'string') return NO_MODES;
  let modes = NO_MODES;
  for (const part of stored.split(',')) {
    const id = part.trim();
    if (isModeId(id)) modes = withMode(modes, id, true);
  }
  return modes;
}

/** What the device keeps: the ids of the modes that are on, or null (nothing is kept) when none is. */
export function formatModes(modes: ModeSet): string | null {
  const on = MODE_IDS.filter((id) => modes[id]);
  return on.length === 0 ? null : on.join(',');
}
