// What this device remembers of the timeline's view, project by project,
// besides the hidden lanes and the world lanes (hiddenLanes.ts): the filter
// by tags, and the views the writer saved.
//
// Like the hidden lanes, these are choices about one screen: they are kept on
// the device (and for this vault), never in the project. Only text is saved,
// whatever comes back is checked before it is used, and a storage that fails
// is ignored: the choice then lasts until Obsidian closes.

import type { DeviceStorage } from '../../core/devicePrefs';
import { NO_TAG_FILTER, isTagFilterActive, readSavedViews, readTagFilter } from '../../core/timeline';
import type { SavedView, TagFilter } from '../../core/timeline';

export const VIEW_CHOICES_KEY = 'spellbook-timeline-views';

/** No more than this many projects have their view choices remembered. */
export const MAX_VIEW_PROJECTS = 40;

/** What one project's view choices are on this device. */
export interface ViewChoices {
  readonly filter: TagFilter;
  readonly views: readonly SavedView[];
}

const NOTHING: ViewChoices = Object.freeze({ filter: NO_TAG_FILTER, views: Object.freeze([]) as readonly SavedView[] });

/** One project's choices, checked. */
export function readViewChoices(value: unknown): ViewChoices {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return NOTHING;
  const record = value as Record<string, unknown>;
  const filter = readTagFilter(record['filter']);
  const views = readSavedViews(record['views']);
  return views.length === 0 && !isTagFilterActive(filter) ? NOTHING : { filter, views };
}

const isEmpty = (choices: ViewChoices): boolean => choices.views.length === 0 && !isTagFilterActive(choices.filter);

export class ViewChoiceStore {
  private readonly storage: DeviceStorage;
  private projects: Map<string, ViewChoices> | null = null;

  constructor(storage: DeviceStorage) {
    this.storage = storage;
  }

  /** A project's choices. The same object is handed out until they change. */
  of(indexPath: string): ViewChoices {
    return this.all().get(indexPath) ?? NOTHING;
  }

  /** Remember a project's filter. False when it was that already (nothing is saved then). */
  setFilter(indexPath: string, filter: TagFilter): boolean {
    return this.set(indexPath, { ...this.of(indexPath), filter: readTagFilter(filter) });
  }

  /** Remember a project's saved views. False when they were those already. */
  setViews(indexPath: string, views: readonly SavedView[]): boolean {
    return this.set(indexPath, { ...this.of(indexPath), views: readSavedViews(views) });
  }

  /** A project's index note is at another path now: its choices come along. */
  move(from: string, to: string): void {
    if (from === to) return;
    const all = this.all();
    const choices = all.get(from);
    if (!choices) return;
    all.delete(from);
    all.delete(to);
    all.set(to, choices);
    this.save(all);
  }

  private set(indexPath: string, next: ViewChoices): boolean {
    const all = this.all();
    const before = all.get(indexPath) ?? NOTHING;
    if (JSON.stringify(before) === JSON.stringify(next)) return false;
    // Taken out and put back, so that this project counts as the newest.
    all.delete(indexPath);
    if (!isEmpty(next)) {
      all.set(indexPath, next);
      for (const oldest of all.keys()) {
        if (all.size <= MAX_VIEW_PROJECTS) break;
        if (oldest !== indexPath) all.delete(oldest);
      }
    }
    this.save(all);
    return true;
  }

  private all(): Map<string, ViewChoices> {
    if (this.projects) return this.projects;
    const map = new Map<string, ViewChoices>();
    let stored: unknown = null;
    try {
      stored = this.storage.load(VIEW_CHOICES_KEY);
      if (typeof stored === 'string') stored = JSON.parse(stored) as unknown;
    } catch (error) {
      console.error('Spellbook: could not read the timeline views this device keeps', error);
      stored = null;
    }
    if (typeof stored === 'object' && stored !== null && !Array.isArray(stored)) {
      for (const [path, value] of Object.entries(stored)) {
        const choices = readViewChoices(value);
        if (!isEmpty(choices)) map.set(path, choices);
      }
    }
    this.projects = map;
    return map;
  }

  private save(all: Map<string, ViewChoices>): void {
    const plain = Object.create(null) as Record<string, ViewChoices>;
    for (const [path, choices] of all) plain[path] = choices;
    try {
      this.storage.save(VIEW_CHOICES_KEY, all.size === 0 ? null : JSON.stringify(plain));
    } catch (error) {
      console.error('Spellbook: could not save the timeline views this device keeps', error);
    }
  }
}
