// The choices of the snapshots: whether a snapshot is taken by itself before
// the first edit of a scene each day, and how many of those are kept for a
// scene. They are kept on this device only, like the other choices of the
// plugin's screens, and nothing is stored while they are as they come.

import { Setting } from 'obsidian';
import type { DeviceStorage } from '../../core/devicePrefs';
import type { SettingsSection } from '../registry';

/** Where the choices are kept in the device's own storage. */
export const AUTOMATIC_KEY = 'spellbook-snapshots-automatic';
export const KEEP_KEY = 'spellbook-snapshots-keep';

export const DEFAULT_KEEP = 10;
export const MIN_KEEP = 1;
export const MAX_KEEP = 100;

export const SECTION_TITLE = 'Snapshots';
export const AUTOMATIC_NAME_TEXT = 'Take a snapshot before the first edit of the day';
export const AUTOMATIC_DESC_TEXT =
  'When this is on, the first time you change a scene on a day, Spellbook first saves the scene as it was, as an automatic snapshot. ' +
  'Off unless you switch it on. This choice is kept on this device only.';
export const KEEP_NAME_TEXT = 'Automatic snapshots to keep for a scene';
export const KEEP_DESC_TEXT =
  `When a scene has more automatic snapshots than this, the oldest go to the trash. Any whole number from ${MIN_KEEP} to ${MAX_KEEP}; ${DEFAULT_KEEP} as it comes. ` +
  'Snapshots you took yourself are never removed for you.';

/** A whole number within bounds, from what was typed or stored; null for anything else. */
export function parseKeep(value: unknown): number | null {
  const text = typeof value === 'number' ? String(value) : typeof value === 'string' ? value.trim() : '';
  if (!/^\d{1,4}$/.test(text)) return null;
  const number = Number(text);
  return number >= MIN_KEEP && number <= MAX_KEEP ? number : null;
}

export class SnapshotPrefs {
  private readonly storage: DeviceStorage;
  /** Null until read from the storage. */
  private on: boolean | null = null;
  private kept: number | null = null;
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
      // The choice then lasts until Obsidian closes.
      console.error('Spellbook: the setting could not be saved on this device', error);
    }
  }

  /** Whether a snapshot is taken by itself before the first edit of a scene each day. Off as it comes. */
  get automatic(): boolean {
    if (this.on === null) {
      const stored = this.load(AUTOMATIC_KEY);
      this.on = stored === true || stored === 'true' || stored === 'on';
    }
    return this.on;
  }

  set automatic(value: boolean) {
    if (this.automatic === value) return;
    this.on = value;
    this.save(AUTOMATIC_KEY, value ? 'on' : null);
    for (const listener of [...this.listening]) listener();
  }

  /** How many automatic snapshots a scene keeps. */
  get keep(): number {
    if (this.kept === null) this.kept = parseKeep(this.load(KEEP_KEY)) ?? DEFAULT_KEEP;
    return this.kept;
  }

  set keep(value: number) {
    const wanted = parseKeep(value) ?? DEFAULT_KEEP;
    if (this.keep === wanted) return;
    this.kept = wanted;
    this.save(KEEP_KEY, wanted === DEFAULT_KEEP ? null : String(wanted));
    for (const listener of [...this.listening]) listener();
  }

  /** Be told when a choice changes. Returns a function that stops it. */
  onChange(listener: () => void): () => void {
    this.listening.add(listener);
    return () => {
      this.listening.delete(listener);
    };
  }

  /** The plugin is being switched off: nobody is told anything any more. */
  release(): void {
    this.listening.clear();
  }
}

/** The "Snapshots" part of the plugin's settings tab. */
export function snapshotSettings(prefs: SnapshotPrefs): SettingsSection {
  return {
    id: 'snapshots',
    title: SECTION_TITLE,
    render(containerEl: HTMLElement): void {
      new Setting(containerEl)
        .setName(AUTOMATIC_NAME_TEXT)
        .setDesc(AUTOMATIC_DESC_TEXT)
        .addToggle((toggle) => {
          toggle.setValue(prefs.automatic).onChange((value) => {
            prefs.automatic = value;
          });
        });
      new Setting(containerEl)
        .setName(KEEP_NAME_TEXT)
        .setDesc(KEEP_DESC_TEXT)
        .addText((text) => {
          text.inputEl.setAttr('inputmode', 'numeric');
          text
            .setPlaceholder(String(DEFAULT_KEEP))
            .setValue(String(prefs.keep))
            .onChange((value) => {
              // While a number is being typed it may be out of bounds for a moment: it is taken once it is not.
              const wanted = parseKeep(value);
              if (wanted !== null) prefs.keep = wanted;
            });
        });
    },
  };
}
