// What the welcome remembers on this device (never synced): whether the
// welcome page has been shown, the version that last ran, and whether the
// writer wants the "What is new" note.

import type { DeviceStorage } from '../../core/devicePrefs';
import { parseVersion } from '../../core/welcome/index';

export const WELCOME_SEEN_KEY = 'spellbook-welcome-seen';
export const LAST_VERSION_KEY = 'spellbook-last-version';
export const WHATS_NEW_KEY = 'spellbook-whats-new';

export class WelcomePrefs {
  private readonly storage: DeviceStorage;
  private readonly listening = new Set<() => void>();

  constructor(storage: DeviceStorage) {
    this.storage = storage;
  }

  private load(key: string): unknown {
    try {
      return this.storage.load(key);
    } catch (error) {
      console.error('Spellbook: the settings of this device could not be read', error);
      return null;
    }
  }

  private save(key: string, value: string | null): void {
    try {
      this.storage.save(key, value);
    } catch (error) {
      // The choice then lasts until Obsidian closes, at most.
      console.error('Spellbook: a setting could not be saved on this device', error);
    }
  }

  /** Whether this device has had the welcome page, or was found not to need it. */
  get welcomeSeen(): boolean {
    return this.load(WELCOME_SEEN_KEY) === 'yes';
  }

  markWelcomeSeen(): void {
    if (!this.welcomeSeen) this.save(WELCOME_SEEN_KEY, 'yes');
  }

  /** The version that last ran on this device, or null. Anything that is not a version counts as none. */
  get lastVersion(): string | null {
    const stored = this.load(LAST_VERSION_KEY);
    return typeof stored === 'string' && parseVersion(stored) !== null ? stored : null;
  }

  set lastVersion(version: string | null) {
    this.save(LAST_VERSION_KEY, version);
  }

  /** Whether to show "What is new" after an update. On unless the writer turned it off. */
  get whatsNewOn(): boolean {
    return this.load(WHATS_NEW_KEY) !== 'off';
  }

  set whatsNewOn(on: boolean) {
    if (this.whatsNewOn === on) return;
    // Nothing is stored for the default.
    this.save(WHATS_NEW_KEY, on ? null : 'off');
    for (const listener of [...this.listening]) listener();
  }

  /** Be told when a choice changes. Returns a function that stops it. */
  onChange(listener: () => void): () => void {
    this.listening.add(listener);
    return () => {
      this.listening.delete(listener);
    };
  }

  release(): void {
    this.listening.clear();
  }
}
