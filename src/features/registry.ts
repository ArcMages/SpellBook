// The feature registry: how the screens of Spellbook plug into the plugin.
//
// Each screen (the corkboard and inspector, the writing progress, the
// planner, the timeline, the outliner) is a "feature" that lives in a folder of its own
// under src/features. The plugin knows nothing about what a feature does: once
// the project store is ready it hands every feature in FEATURES the same
// FeatureContext, and the feature registers its views, commands and settings
// through it.
//
// The rules that keep features apart (checked by tests/sourceRules.test.ts):
//   - a feature only changes files inside its own folder (and its own
//     stylesheet, src/styles/<feature>.css);
//   - it imports from src/core, src/obsidian, src/ui and this file, never
//     from another feature's folder;
//   - what one feature offers another goes through `services`: a named value
//     that is looked up at the moment it is used, so that it does not matter
//     which feature was registered first.
//
// To add a feature: make its folder, export a Feature from its index.ts and
// add it to FEATURES below.

import type { App, PaneType, Plugin } from 'obsidian';
import type { DeviceStorage } from '../core/devicePrefs';
import type { ProjectStore } from '../core/projectStore';
import type { VaultPort } from '../core/vaultPort';
import type { WordCountCache } from '../core/wordCountCache';
import { aihelperFeature } from './aihelper/index';
import { boardsFeature } from './boards/index';
import { corkboardFeature } from './corkboard/index';
import { modesFeature } from './modes/index';
import { exportFeature } from './export/index';
import { outlinerFeature } from './outliner/index';
import { plannerFeature } from './planner/index';
import { progressFeature } from './progress/index';
import { schemesFeature } from './schemes/index';
import { reportFeature } from './report/index';
import { proseFeature } from './prose/index';
import { snapshotsFeature } from './snapshots/index';
import { timelineFeature } from './timeline/index';
import { scriveningsFeature } from './scrivenings/index';
import { worldFeature } from './world/index';

/** The device's clock and timers. Features never read the clock themselves. */
export interface FeatureClock {
  /** Today's date on this device, as YYYY-MM-DD in the local time zone. */
  today(): string;
  /** This moment, in milliseconds since 1970. */
  now(): number;
  /** Call `callback` once after `ms` milliseconds. Returns a function that cancels it. */
  setTimer(callback: () => void, ms: number): () => void;
  /** Call `callback` once, just before the screen is next drawn. Returns a function that cancels it. */
  nextFrame(callback: (time: number) => void): () => void;
  /**
   * How long it is until the date changes on this device (the next midnight
   * on its own calendar), in milliseconds. A feature that shows "today" sets
   * a timer by it, so that the figure starts again at midnight also when
   * nothing else happens. Where a clock cannot tell, the feature looks at
   * `today()` now and then instead.
   */
  readonly untilTomorrow?: (() => number) | undefined;
}

/** A part of the plugin's settings tab that belongs to one feature. */
export interface SettingsSection {
  /** A name for the section that no other section has, for example "progress". */
  readonly id: string;
  /** The heading shown above the section. */
  readonly title: string;
  /**
   * Draw the section's rows into `containerEl`, which is empty and belongs to
   * this section alone. It is called each time the settings tab is shown or
   * drawn again. It may return a function that is called when the rows are
   * taken away again (the tab closes, or is about to be drawn anew).
   */
  render(containerEl: HTMLElement): void | (() => void);
}

/**
 * Named values that features offer each other. A value is looked up when it
 * is needed, not when the features are registered, so the order in which
 * features register does not matter: `get` simply gives undefined until
 * someone has provided the value.
 */
export interface FeatureServices {
  /** Offer a value under a name. A value given earlier under the same name is replaced. */
  provide<T>(name: string, value: T): void;
  /** The value offered under a name, or undefined when nobody offers one (yet). Ask each time; do not keep it. */
  get<T>(name: string): T | undefined;
}

/** Everything a feature is given to work with. */
export interface FeatureContext {
  /** The plugin, for registering views, commands, events and so on. Whatever is registered through it is removed by Obsidian when the plugin unloads. */
  readonly plugin: Plugin;
  readonly app: App;
  /** The projects of the vault and the open one; the only way to change a project. */
  readonly store: ProjectStore;
  /** The doorway to the vault: for listing notes, reading them and listening to changes. Writing goes through the store. */
  readonly vault: VaultPort;
  /** What this device keeps for itself (never synced). Use keys that start with "spellbook-". */
  readonly storage: DeviceStorage;
  /**
   * A short id of this device that stays the same: lower-case letters and
   * digits only, safe in a file name. It is made, and saved in the device's
   * storage, the first time it is asked for: ask when it is needed, not
   * while registering.
   */
  readonly deviceId: string;
  readonly clock: FeatureClock;
  /**
   * The word counts of notes, shared by every screen. A feature that wants
   * notes counted asks under a name of its own (`track(name, paths)`) and
   * lets go when it stops (`release(name)`); what the binder or another
   * feature asks for is not its concern.
   */
  readonly wordCounts: WordCountCache;
  /**
   * Show a note in the main area.
   *
   * @param path the note's vault path (see ProjectStore.vaultPathOf)
   * @param where false: in the pane in use; true or 'tab': a new tab; 'split', 'window': as Obsidian names them
   * @returns whether the note was shown
   */
  openNote(path: string, where?: PaneType | boolean): Promise<boolean>;
  /** Add a section of this feature's own to the plugin's settings tab. */
  addSettingsSection(section: SettingsSection): void;
  readonly services: FeatureServices;
  /**
   * Have `callback` called when the plugin unloads, for whatever was not
   * registered through `plugin`. Callbacks run last in, first out, before the
   * project store is closed.
   */
  onUnload(callback: () => void): void;
}

/** One screen (or group of screens) of the plugin. */
export interface Feature {
  /** A short name that no other feature has, for example "corkboard". */
  readonly id: string;
  /** Called once, when the project store is ready. Register views, commands and settings here. */
  register(context: FeatureContext): void;
}

/**
 * The features of the plugin, in the order they are registered. (The order
 * must not matter to a feature: see FeatureServices.)
 */
export const FEATURES: readonly Feature[] = [
  corkboardFeature,
  progressFeature,
  plannerFeature,
  timelineFeature,
  outlinerFeature,
  schemesFeature,
  modesFeature,
  reportFeature,
  exportFeature,
  proseFeature,
  scriveningsFeature,
  snapshotsFeature,
  worldFeature,
  aihelperFeature,
  boardsFeature,
];

/** What registerFeatures needs: a FeatureContext without the parts the registry makes itself. */
export type FeatureHost = Omit<FeatureContext, 'services' | 'addSettingsSection' | 'onUnload' | 'deviceId'> & {
  /** Gives this device's id; called only when a feature asks for it. */
  readonly deviceId: () => string;
};

/** The features that were registered, and what belongs to them. */
export interface RegisteredFeatures {
  /** The ids of the features whose register() finished, in order. */
  readonly ids: readonly string[];
  /** The sections the features added to the settings tab, in the order they were added. */
  readonly settingsSections: readonly SettingsSection[];
  readonly services: FeatureServices;
  /**
   * Let go of everything: the unload callbacks are called (last in, first
   * out), and the services and settings sections are forgotten. Calling it
   * again does nothing.
   */
  release(): void;
}

class ServiceBoard implements FeatureServices {
  private readonly values = new Map<string, unknown>();

  provide<T>(name: string, value: T): void {
    this.values.set(name, value);
  }

  get<T>(name: string): T | undefined {
    return this.values.get(name) as T | undefined;
  }

  clear(): void {
    this.values.clear();
  }
}

/**
 * Register a list of features. A feature that fails to register is reported
 * in the console and left out; the others are registered all the same. Two
 * features with the same id are a mistake in the list: the second is left out.
 */
export function registerFeatures(features: readonly Feature[], host: FeatureHost): RegisteredFeatures {
  const services = new ServiceBoard();
  const settingsSections: SettingsSection[] = [];
  const cleanups: Array<() => void> = [];
  const ids: string[] = [];
  let released = false;

  const context: FeatureContext = {
    plugin: host.plugin,
    app: host.app,
    store: host.store,
    vault: host.vault,
    storage: host.storage,
    get deviceId(): string {
      return host.deviceId();
    },
    clock: host.clock,
    wordCounts: host.wordCounts,
    openNote: (path, where) => host.openNote(path, where),
    services,
    addSettingsSection: (section) => {
      if (released) return;
      const at = settingsSections.findIndex((other) => other.id === section.id);
      if (at >= 0) settingsSections[at] = section;
      else settingsSections.push(section);
    },
    onUnload: (callback) => {
      // Too late to wait for an unload that has already happened.
      if (released) callback();
      else cleanups.push(callback);
    },
  };

  for (const feature of features) {
    if (ids.includes(feature.id)) {
      console.error(`Spellbook: two features are called "${feature.id}"; the second was left out`);
      continue;
    }
    try {
      feature.register(context);
      ids.push(feature.id);
    } catch (error) {
      console.error(`Spellbook: the feature "${feature.id}" could not start`, error);
    }
  }

  return {
    ids,
    settingsSections,
    services,
    release: () => {
      if (released) return;
      released = true;
      for (const cleanup of cleanups.splice(0).reverse()) {
        try {
          cleanup();
        } catch (error) {
          console.error('Spellbook: a feature could not be closed cleanly', error);
        }
      }
      settingsSections.length = 0;
      services.clear();
    },
  };
}
