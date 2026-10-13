// The settings of the writing progress: one switch, kept on this device only
// (a phone and a desktop may well want it set differently).

import { Setting } from 'obsidian';
import type { DeviceStorage } from '../../core/devicePrefs';
import type { SettingsSection } from '../registry';

/** Where the "Count pasted text" switch is kept in the device's own storage. */
export const COUNT_PASTED_KEY = 'spellbook-progress-count-pasted';

/** What is stored when the switch is on. Nothing is stored while it is off. */
const ON = 'on';

/** The choices of the writing progress that belong to this device. */
export class ProgressPrefs {
  private readonly storage: DeviceStorage;
  /** Null until it has been read from the storage. */
  private pasted: boolean | null = null;

  constructor(storage: DeviceStorage) {
    this.storage = storage;
  }

  /** Whether pasted, dropped and cut text counts as written and deleted words. Off unless the writer switched it on. */
  get countPasted(): boolean {
    if (this.pasted === null) {
      try {
        this.pasted = this.storage.load(COUNT_PASTED_KEY) === ON;
      } catch (error) {
        console.error('Spellbook: the settings of this device could not be read', error);
        this.pasted = false;
      }
    }
    return this.pasted;
  }

  set countPasted(on: boolean) {
    if (this.countPasted === on) return;
    this.pasted = on;
    try {
      this.storage.save(COUNT_PASTED_KEY, on ? ON : null);
    } catch (error) {
      // The choice then lasts until Obsidian closes.
      console.error('Spellbook: the setting could not be saved on this device', error);
    }
  }
}

/** The "Writing progress" part of the plugin's settings tab. */
export function progressSettings(prefs: ProgressPrefs): SettingsSection {
  return {
    id: 'progress',
    title: 'Writing progress',
    render(containerEl: HTMLElement): void {
      new Setting(containerEl)
        .setName('Count pasted text')
        .setDesc(
          'When this is on, words you paste or drop into a note count as written, and words you cut count as deleted. ' +
            'When it is off, only what you type counts. This choice is kept on this device only.',
        )
        .addToggle((toggle) => {
          toggle.setValue(prefs.countPasted).onChange((value) => {
            prefs.countPasted = value;
          });
        });
    },
  };
}
