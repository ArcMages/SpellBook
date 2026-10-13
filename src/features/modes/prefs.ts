// What this device remembers about the writing modes: which are on, and how
// the writer tuned them. Both are kept on the device only, never in the
// synced plugin data: a phone does not come up in Zen because the desktop
// was left in it.

import { NO_MODES, defaultModeSettings, formatModeSettings, formatModes, parseModeSettings, parseModes } from '../../core/modes/index';
import type { ModeSet, ModeSettings } from '../../core/modes/index';
import type { DeviceStorage } from '../../core/devicePrefs';

/** Where the modes that are on are kept in the device's own storage. */
export const MODES_ON_KEY = 'spellbook-modes-on';

/** Where the settings of the modes are kept in the device's own storage. */
export const MODES_SETTINGS_KEY = 'spellbook-modes-settings';

export class ModesPrefs {
  private readonly storage: DeviceStorage;
  private readonly phone: boolean;

  constructor(storage: DeviceStorage, phone: boolean) {
    this.storage = storage;
    this.phone = phone;
  }

  loadModes(): ModeSet {
    try {
      return parseModes(this.storage.load(MODES_ON_KEY));
    } catch (error) {
      console.error('Spellbook: the writing modes of this device could not be read', error);
      return NO_MODES;
    }
  }

  saveModes(modes: ModeSet): void {
    this.save(MODES_ON_KEY, formatModes(modes));
  }

  loadSettings(): ModeSettings {
    try {
      return parseModeSettings(this.storage.load(MODES_SETTINGS_KEY), this.phone);
    } catch (error) {
      console.error('Spellbook: the settings of the writing modes could not be read', error);
      return defaultModeSettings(this.phone);
    }
  }

  saveSettings(settings: ModeSettings): void {
    this.save(MODES_SETTINGS_KEY, formatModeSettings(settings));
  }

  private save(key: string, value: string | null): void {
    try {
      this.storage.save(key, value);
    } catch (error) {
      // The choice then lasts until Obsidian closes.
      console.error('Spellbook: the writing modes could not be saved on this device', error);
    }
  }
}
