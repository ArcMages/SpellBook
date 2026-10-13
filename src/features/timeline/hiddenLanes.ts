// Which lanes of the timeline this device has hidden, project by project.
//
// Hiding a lane is a choice about what one screen shows, so it is kept on the
// device (and for this vault) and never in the project: a phone and a desktop
// each hide their own. It goes through the device storage the plugin hands
// out (in Obsidian: src/obsidian/deviceStorage.ts).
//
// As in src/core/devicePrefs.ts, only text is saved, whatever comes back is
// checked before it is used, and a storage that fails is ignored: the choice
// then lasts until Obsidian closes.

import type { DeviceStorage } from '../../core/devicePrefs';

export const HIDDEN_LANES_KEY = 'spellbook-timeline-hidden-lanes';

/** No more than this many projects have their hidden lanes remembered. */
export const MAX_PROJECTS = 40;
/** No more than this many hidden lanes are remembered per project. */
export const MAX_LANES = 200;

const NONE: readonly string[] = Object.freeze([]);

function sameNames(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((name, index) => name === b[index]);
}

/** A list of lane names as it may be kept: text only, no name twice, not too many (the newest stay). */
function tidy(names: readonly unknown[]): readonly string[] {
  const kept: string[] = [];
  for (const name of names) {
    if (typeof name === 'string' && name !== '' && !kept.includes(name)) kept.push(name);
  }
  return Object.freeze(kept.slice(-MAX_LANES));
}

export class HiddenLanes {
  private readonly storage: DeviceStorage;
  /** Hidden lane names by project index path; null until read from the storage. */
  private projects: Map<string, readonly string[]> | null = null;

  constructor(storage: DeviceStorage) {
    this.storage = storage;
  }

  /** The names of the lanes hidden in a project. The same list is handed out until it changes. */
  of(indexPath: string): readonly string[] {
    return this.all().get(indexPath) ?? NONE;
  }

  /**
   * Remember which lanes are hidden in a project; what was remembered for it
   * before is replaced.
   *
   * @returns false when that was what was remembered already (nothing is saved then)
   */
  set(indexPath: string, names: readonly string[]): boolean {
    const all = this.all();
    const wanted = tidy(names);
    if (sameNames(wanted, all.get(indexPath) ?? NONE)) return false;
    // Taken out and put back, so that this project counts as the newest.
    all.delete(indexPath);
    if (wanted.length > 0) {
      all.set(indexPath, wanted);
      for (const oldest of all.keys()) {
        if (all.size <= MAX_PROJECTS) break;
        if (oldest !== indexPath) all.delete(oldest);
      }
    }
    this.save(all);
    return true;
  }

  /**
   * A project's index note is at another path now (the note or its folder
   * was renamed or moved): its hidden lanes are remembered under the new
   * path, and nothing is left behind under the old one.
   */
  move(from: string, to: string): void {
    if (from === to) return;
    const all = this.all();
    const names = all.get(from);
    if (!names) return;
    all.delete(from);
    // Whatever was remembered under the new path was for a project that is no longer there.
    all.delete(to);
    all.set(to, names);
    this.save(all);
  }

  private all(): Map<string, readonly string[]> {
    if (this.projects) return this.projects;
    const map = new Map<string, readonly string[]>();
    let stored: unknown = null;
    try {
      stored = this.storage.load(HIDDEN_LANES_KEY);
      if (typeof stored === 'string') stored = JSON.parse(stored) as unknown;
    } catch (error) {
      console.error('Spellbook: could not read which timeline lanes this device hides', error);
      stored = null;
    }
    if (typeof stored === 'object' && stored !== null && !Array.isArray(stored)) {
      for (const [path, names] of Object.entries(stored)) {
        if (!Array.isArray(names)) continue;
        const kept = tidy(names);
        if (kept.length > 0) map.set(path, kept);
      }
    }
    this.projects = map;
    return map;
  }

  private save(all: Map<string, readonly string[]>): void {
    // A bare object, so that no path can be mistaken for a built-in property name.
    const plain = Object.create(null) as Record<string, readonly string[]>;
    for (const [path, names] of all) plain[path] = names;
    try {
      // Saved as text, so that it comes back the same whatever the storage does with objects.
      this.storage.save(HIDDEN_LANES_KEY, all.size === 0 ? null : JSON.stringify(plain));
    } catch (error) {
      console.error('Spellbook: could not save which timeline lanes this device hides', error);
    }
  }
}
