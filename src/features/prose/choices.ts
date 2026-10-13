// The writer's choices for the prose checks, kept on this device (a phone and
// a desktop may well want them set differently). What the choices are, and
// how they are read and written, is the engine's (src/core/prose/prefs.ts);
// this file only puts them in the device's storage and tells whoever listens.

import type { DeviceStorage } from '../../core/devicePrefs';
import { NO_PROSE_PREFS, PROSE_PREFS_KEY, parseProsePrefs, serializeProsePrefs } from '../../core/prose/index';
import type { ProsePrefs } from '../../core/prose/index';

export class ProseChoices {
  private readonly storage: DeviceStorage;
  /** Null until it has been read from the storage. */
  private current: ProsePrefs | null = null;
  private readonly listeners = new Set<() => void>();

  constructor(storage: DeviceStorage) {
    this.storage = storage;
  }

  get prefs(): ProsePrefs {
    if (this.current === null) {
      try {
        this.current = parseProsePrefs(this.storage.load(PROSE_PREFS_KEY));
      } catch (error) {
        console.error('Spellbook: the settings of this device could not be read', error);
        this.current = NO_PROSE_PREFS;
      }
    }
    return this.current;
  }

  /** Take new choices: they are saved on this device, and everyone who listens is told. */
  set(prefs: ProsePrefs): void {
    const text = serializeProsePrefs(prefs);
    if (text === serializeProsePrefs(this.prefs)) return;
    this.current = prefs;
    try {
      this.storage.save(PROSE_PREFS_KEY, text);
    } catch (error) {
      // The choice then lasts until Obsidian closes.
      console.error('Spellbook: the setting could not be saved on this device', error);
    }
    for (const listener of [...this.listeners]) listener();
  }

  /** Have `listener` called after every change. Returns a function that stops it. */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Nobody is told anything from here on. */
  release(): void {
    this.listeners.clear();
  }
}
