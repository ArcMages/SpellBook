// Where the plugin keeps what belongs to this device only: Obsidian's own
// per-vault storage on the device. Nothing saved here is synced to other
// devices, and nothing here touches a note.

import type { App } from 'obsidian';
import type { DeviceStorage } from '../core/devicePrefs';

export class ObsidianDeviceStorage implements DeviceStorage {
  private readonly app: App;

  constructor(app: App) {
    this.app = app;
  }

  load(key: string): unknown {
    return this.app.loadLocalStorage(key) as unknown;
  }

  save(key: string, value: string | null): void {
    this.app.saveLocalStorage(key, value);
  }
}
