// What this device remembers about how the writer left things: which project
// was open, and which folders of the binder were folded shut.
//
// This is kept per device (and per vault), not in the plugin's synced data:
// a phone and a desktop each keep their own. In Obsidian it is stored through
// src/obsidian/deviceStorage.ts; the tests use a stand-in.
//
// Only text is ever saved (a list is turned into JSON text first), so that it
// comes back the same however the storage keeps its values. Whatever comes
// back is still checked before it is used, because it can be anything: an
// older version's data, or something edited by hand. A storage that fails is
// ignored; the choices then last until Obsidian closes.

/** A small store of named values that belongs to this device and this vault. */
export interface DeviceStorage {
  /** The value saved under `key`, or null when there is none. */
  load(key: string): unknown;
  /** Save a piece of text; null removes it. */
  save(key: string, value: string | null): void;
}

export const ACTIVE_PROJECT_KEY = 'spellbook-active-project';
export const COLLAPSED_KEY = 'spellbook-binder-collapsed';

/** No more than this many projects have their folded folders remembered. */
const MAX_PROJECTS = 40;
/** No more than this many folded items are remembered per project. */
const MAX_ITEMS = 1000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export class DevicePrefs {
  private readonly storage: DeviceStorage;
  /** undefined until it has been read from the storage. */
  private active: string | null | undefined;
  /** Folded items by project index path; null until read from the storage. */
  private collapsed: Map<string, Set<string>> | null = null;

  constructor(storage: DeviceStorage) {
    this.storage = storage;
  }

  // ----------------------------------------------------------- active project

  /** The index path of the project the writer last chose on this device, or null. */
  getActiveProject(): string | null {
    if (this.active === undefined) {
      const stored = this.load(ACTIVE_PROJECT_KEY);
      this.active = typeof stored === 'string' && stored !== '' ? stored : null;
    }
    return this.active;
  }

  setActiveProject(indexPath: string | null): void {
    if (this.getActiveProject() === indexPath) return;
    this.active = indexPath;
    this.save(ACTIVE_PROJECT_KEY, indexPath);
  }

  // ------------------------------------------------------------ folded items

  /**
   * Whether an item of a project's binder is folded shut. `item` is a short
   * name chosen by the view, for example "folder:f-k3x9q2".
   */
  isCollapsed(indexPath: string, item: string): boolean {
    return this.collapsedMap().get(indexPath)?.has(item) === true;
  }

  setCollapsed(indexPath: string, item: string, collapsed: boolean): void {
    const all = this.collapsedMap();
    let items = all.get(indexPath);
    if (collapsed) {
      if (items?.has(item)) return;
      if (!items) {
        items = new Set();
        all.set(indexPath, items);
      }
      items.add(item);
      // Oldest out first, so the list cannot grow without end.
      for (const oldest of items) {
        if (items.size <= MAX_ITEMS) break;
        items.delete(oldest);
      }
      for (const oldest of all.keys()) {
        if (all.size <= MAX_PROJECTS) break;
        if (oldest !== indexPath) all.delete(oldest);
      }
    } else {
      if (!items?.delete(item)) return;
      if (items.size === 0) all.delete(indexPath);
    }
    // A bare object, so that no path can be mistaken for a built-in property name.
    const plain = Object.create(null) as Record<string, string[]>;
    for (const [path, set] of all) plain[path] = [...set];
    // Saved as text, so that it comes back the same whatever the storage does with objects.
    this.save(COLLAPSED_KEY, all.size === 0 ? null : JSON.stringify(plain));
  }

  private collapsedMap(): Map<string, Set<string>> {
    if (this.collapsed) return this.collapsed;
    const map = new Map<string, Set<string>>();
    let stored = this.load(COLLAPSED_KEY);
    if (typeof stored === 'string') {
      try {
        stored = JSON.parse(stored) as unknown;
      } catch {
        stored = null;
      }
    }
    if (isRecord(stored)) {
      for (const [path, items] of Object.entries(stored)) {
        if (!Array.isArray(items)) continue;
        const names = items.filter((item): item is string => typeof item === 'string');
        if (names.length > 0) map.set(path, new Set(names));
      }
    }
    this.collapsed = map;
    return map;
  }

  // ------------------------------------------------------------------ storage

  private load(key: string): unknown {
    try {
      return this.storage.load(key);
    } catch (error) {
      console.error('Spellbook: could not read what this device remembers', error);
      return null;
    }
  }

  private save(key: string, value: string | null): void {
    try {
      this.storage.save(key, value);
    } catch (error) {
      console.error('Spellbook: could not save what this device remembers', error);
    }
  }
}
