// What Spellbook shows by itself when it starts: the welcome page the first
// time it runs on a device, and the "What is new" note once after an update.
// Both are decided here, from a few facts the plugin gathers; nothing here
// looks at the screen, the clock or the vault.

import { notesBetween } from './changelog';
import type { ChangelogEntry } from './changelog';
import { compareVersions } from './versions';

/** What the plugin knows when it decides. */
export interface StartFacts {
  /** Whether this device has had the welcome page (or decided it needed none) before. */
  readonly welcomeSeen: boolean;
  /** Whether the vault holds a Spellbook project, or something that looks like one. */
  readonly hasProjects: boolean;
  /** The version this device last ran, or null when it has never said. */
  readonly storedVersion: string | null;
  /** The version running now, from the manifest. */
  readonly currentVersion: string;
  /** Whether the writer wants the "What is new" note after an update. */
  readonly whatsNewOn: boolean;
}

/** What to do. */
export interface StartPlan {
  /**
   * "show": open the welcome page now (and remember it was shown);
   * "mark-seen": this is not a first run for the writer, so remember that it
   * never needs showing; "none": nothing.
   */
  readonly welcome: 'show' | 'mark-seen' | 'none';
  /** The changelog entries to show in the "What is new" note, newest first. Empty: no note. */
  readonly whatsNew: readonly ChangelogEntry[];
  /** The version to remember on this device, or null when nothing needs saving. */
  readonly saveVersion: string | null;
}

/**
 * Decide what to show when Spellbook starts.
 *
 * The welcome page is for a writer meeting Spellbook for the first time: it
 * opens once per device, and never on a device whose vault already holds a
 * project. The "What is new" note follows an update: it shows the notes of
 * every version after the one this device last ran. A device that ran a
 * version from before this was remembered, and already has projects, is
 * shown the notes of the version running now.
 */
export function planStart(facts: StartFacts, changelog: readonly ChangelogEntry[]): StartPlan {
  const welcome: StartPlan['welcome'] = facts.welcomeSeen ? 'none' : facts.hasProjects ? 'mark-seen' : 'show';
  const saveVersion = facts.storedVersion === facts.currentVersion ? null : facts.currentVersion;

  let whatsNew: ChangelogEntry[] = [];
  if (facts.whatsNewOn && welcome !== 'show' && saveVersion !== null) {
    if (facts.storedVersion === null) {
      whatsNew = notesBetween(changelog, null, facts.currentVersion);
    } else if (compareVersions(facts.storedVersion, facts.currentVersion) === -1) {
      whatsNew = notesBetween(changelog, facts.storedVersion, facts.currentVersion);
    }
    // A version that is older than the one stored (going back), or that
    // cannot be read, gets no note: it is simply remembered.
  }
  return { welcome, whatsNew, saveVersion };
}

/**
 * Whether the vault holds what looks like a Spellbook project, judged by its
 * folders alone: a folder with a note of its own name and a Manuscript folder
 * inside it. This works before Obsidian has finished reading the notes'
 * properties, which is what the project store needs to know a project.
 *
 * @param folders every folder of the vault, as vault paths
 * @param filesIn the files directly inside a folder, as vault paths
 */
export function hasProjectShape(folders: readonly string[], filesIn: (folder: string) => readonly string[]): boolean {
  const known = new Set(folders.map((folder) => folder.toLowerCase()));
  for (const folder of folders) {
    if (!known.has(`${folder}/manuscript`.toLowerCase())) continue;
    const name = folder.split('/').pop() ?? '';
    const index = `${folder}/${name}.md`.toLowerCase();
    if (filesIn(folder).some((file) => file.toLowerCase() === index)) return true;
  }
  return false;
}

/**
 * How long the vault must have been quiet (no file listed, changed or
 * indexed) before the plugin decides, in milliseconds. A phone or tablet
 * reads its vault more slowly, so it waits longer.
 */
export function quietBeforeDeciding(isMobile: boolean): number {
  return isMobile ? 5000 : 1500;
}

/** The longest the plugin waits for a quiet vault before it decides all the same, in milliseconds. */
export const LONGEST_WAIT_MS = 60000;
