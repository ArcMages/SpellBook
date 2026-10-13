// What the writing modes offer the other screens: the one place where the
// service is declared.
//
// A screen that wants to show which modes are on, or to switch one (a button
// in a bar, say), looks the service up at the moment it uses it, never while
// registering:
//
//   const modes = context.services.get<ModesService>(MODES_SERVICE);
//
// It gives undefined while the writing modes are not running. The commands
// (see MODES in modes.ts) do the same as `toggle`.
//
// Nothing here does anything: a name and shapes only.

import type { ModeId } from './modes';

/** The name the modes are offered under. */
export const MODES_SERVICE = 'modes.state';

/** One mode as a screen can show it. */
export interface ModeState {
  readonly id: ModeId;
  /** For the screen, in English: "Zen mode". */
  readonly name: string;
  /** The id of the command that switches it, without the plugin's own id in front. */
  readonly commandId: string;
  readonly on: boolean;
}

export interface ModesService {
  /** The four modes as they stand now, in a fixed order. */
  modes(): ModeState[];
  isOn(id: ModeId): boolean;
  /** Switch a mode on when it is off, and off when it is on. */
  toggle(id: ModeId): void;
  /** Switch a mode on or off. */
  set(id: ModeId, on: boolean): void;
  /** Have `listener` called whenever a mode is switched. Returns a function that stops it. */
  onChange(listener: () => void): () => void;
}
