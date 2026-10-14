// What this device remembers about how the writer left things: which project
// was open, which folders of the binder were folded shut, and where the links
// to a renamed note are brought up to date.
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

import type { LinkScope } from './links';

/** A small store of named values that belongs to this device and this vault. */
export interface DeviceStorage {
  /** The value saved under `key`, or null when there is none. */
  load(key: string): unknown;
  /** Save a piece of text; null removes it. */
  save(key: string, value: string | null): void;
}

export const ACTIVE_PROJECT_KEY = 'spellbook-active-project';
export const COLLAPSED_KEY = 'spellbook-binder-collapsed';
export const LINK_SCOPE_KEY = 'spellbook-link-scope';

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
  private scope: LinkScope | undefined;
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

  // ------------------------------------------------------------ link scope

  /**
   * Where the links to a note that Spellbook renames are brought up to date:
   * "project" (the open project only, as it comes) or "vault" (every note).
   */
  getLinkScope(): LinkScope {
    if (this.scope === undefined) this.scope = this.load(LINK_SCOPE_KEY) === 'vault' ? 'vault' : 'project';
    return this.scope;
  }

  setLinkScope(scope: LinkScope): void {
    const wanted: LinkScope = scope === 'vault' ? 'vault' : 'project';
    if (this.getLinkScope() === wanted) return;
    this.scope = wanted;
    // Nothing is stored while it is as it comes.
    this.save(LINK_SCOPE_KEY, wanted === 'vault' ? 'vault' : null);
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
    this.saveCollapsed(all);
  }

  /**
   * Say in one go everything that is folded shut in a project ("Collapse
   * all", "Expand all"): what was remembered for it before is replaced, and
   * the storage is written once.
   */
  setCollapsedItems(indexPath: string, items: Iterable<string>): void {
    const all = this.collapsedMap();
    const wanted = new Set([...items].slice(-MAX_ITEMS));
    const before = all.get(indexPath) ?? new Set<string>();
    if (wanted.size === before.size && [...wanted].every((item) => before.has(item))) return;
    // Taken out and put back, so that this project counts as the newest.
    all.delete(indexPath);
    if (wanted.size > 0) {
      all.set(indexPath, wanted);
      for (const oldest of all.keys()) {
        if (all.size <= MAX_PROJECTS) break;
        if (oldest !== indexPath) all.delete(oldest);
      }
    }
    this.saveCollapsed(all);
  }

  /**
   * A project's index note is at another path now (the note or its folder
   * was renamed or moved): what was folded shut in the project is remembered
   * under the new path, and nothing is left behind under the old one.
   * Folders are known by their ids, which a rename does not change.
   */
  moveCollapsed(from: string, to: string): void {
    if (from === to) return;
    const all = this.collapsedMap();
    const items = all.get(from);
    if (!items) return;
    all.delete(from);
    // Whatever was remembered under the new path was for a project that is no longer there.
    all.delete(to);
    all.set(to, items);
    this.saveCollapsed(all);
  }

  private saveCollapsed(all: Map<string, Set<string>>): void {
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
