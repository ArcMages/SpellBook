// The writer's layout of the bottom bar, as this device remembers it.
//
// It is kept in the device's own storage, never in the plugin's synced data:
// a phone and a desktop each have their own bar. What comes back from the
// storage is read by the engine (parseBarLayout), which makes a layout that
// can be shown out of anything.

import type { DeviceStorage } from '../../core/devicePrefs';
import { DEFAULT_BAR_LAYOUT, parseBarLayout, sameBarLayout, serializeBarLayout } from '../../core/progress/index';
import type { BarLayout } from '../../core/progress/index';

/** Where the layout is kept in the device's own storage. */
export const BAR_LAYOUT_KEY = 'spellbook-progress-bar-layout';

export class BarPrefs {
  private readonly storage: DeviceStorage;
  /** Null until it has been read from the storage. */
  private current: BarLayout | null = null;
  private readonly listeners = new Set<() => void>();

  constructor(storage: DeviceStorage) {
    this.storage = storage;
  }

  /** What the bar holds, in order. The layout a device starts with until the writer chose another. */
  get layout(): BarLayout {
    if (this.current === null) {
      try {
        this.current = parseBarLayout(this.storage.load(BAR_LAYOUT_KEY));
      } catch (error) {
        console.error('Spellbook: the layout of the bottom bar could not be read on this device', error);
        this.current = DEFAULT_BAR_LAYOUT;
      }
    }
    return this.current;
  }

  /** Whether the bar is as a device starts with it. */
  get isDefault(): boolean {
    return sameBarLayout(this.layout, DEFAULT_BAR_LAYOUT);
  }

  /** Choose another layout. The default layout is not stored: nothing is kept for it. */
  set(layout: BarLayout): void {
    if (sameBarLayout(this.layout, layout)) return;
    this.current = layout;
    try {
      this.storage.save(BAR_LAYOUT_KEY, sameBarLayout(layout, DEFAULT_BAR_LAYOUT) ? null : serializeBarLayout(layout));
    } catch (error) {
      // The layout then lasts until Obsidian closes.
      console.error('Spellbook: the layout of the bottom bar could not be saved on this device', error);
    }
    for (const listener of [...this.listeners]) {
      try {
        listener();
      } catch (error) {
        console.error('Spellbook: the bottom bar could not follow its settings', error);
      }
    }
  }

  /**
   * Be told when the layout has changed.
   *
   * @returns a function that stops the listening
   */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Stop telling anyone. */
  close(): void {
    this.listeners.clear();
  }
}
