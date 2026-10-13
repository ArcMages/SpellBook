// Reading the daily word logs of the open project: every device's files in
// its Stats folder, added up.
//
// The files are read through the project store and kept in memory. A file is
// read again only after the vault said it changed (a save on this device, or
// a sync from another one), so asking for the totals is cheap. Nothing here
// writes anything.

import { isMarkdownPath } from '../../core/paths';
import { parseStatsFile, sumDeviceLogs } from '../../core/progress/index';
import type { DailyTotals, StatsFile } from '../../core/progress/index';
import type { ProjectStore } from '../../core/projectStore';

const NOTHING: DailyTotals = new Map();

export class StatsLog {
  private readonly store: ProjectStore;
  /** The index path of the project the files below belong to. */
  private project: string | null = null;
  /** The log files as last read, by their path relative to the project folder. */
  private readonly files = new Map<string, StatsFile>();
  /** Files known to have changed since they were read. */
  private readonly stale = new Set<string>();
  /** False until the Stats folder has been looked through. */
  private listed = false;
  /** Goes up with every change, so that a read that was overtaken is done again. */
  private generation = 0;
  private reading: Promise<void> | null = null;
  private sum: DailyTotals | null = null;

  constructor(store: ProjectStore) {
    this.store = store;
  }

  /**
   * The open project is `indexPath` now (null for none). Another project
   * means other files; the same project at a new path keeps what was read.
   */
  follow(indexPath: string | null, sameProjectMoved: boolean): void {
    if (indexPath === this.project) return;
    this.project = indexPath;
    if (!sameProjectMoved) this.reset();
  }

  /** Forget everything that was read: the Stats folder is looked through again. */
  reset(): void {
    this.files.clear();
    this.stale.clear();
    this.listed = false;
    this.changed();
  }

  /** A file in the Stats folder was created or changed (`path` is relative to the project folder). */
  touch(path: string): void {
    if (!isMarkdownPath(path)) return;
    this.files.delete(path);
    this.stale.add(path);
    this.changed();
  }

  /** A file in the Stats folder is gone. */
  gone(path: string): void {
    this.files.delete(path);
    this.stale.delete(path);
    this.changed();
  }

  /** This device's file was just saved with exactly this content: no need to read it back. */
  saved(indexPath: string, path: string, file: StatsFile): void {
    if (indexPath !== this.project) return;
    this.files.set(path, file);
    this.stale.delete(path);
    this.changed();
  }

  /**
   * The saved words of every device, per day, when every file has been
   * read; null when something still has to be read (ask `totals()` then).
   */
  peek(): DailyTotals | null {
    if (this.store.project === null) return NOTHING;
    if (this.store.project.indexPath !== this.project || !this.listed || this.stale.size > 0) return null;
    // A note in the Stats folder that says it is something else is not a word log.
    this.sum ??= sumDeviceLogs(
      [...this.files.values()].filter((file) => !file.problems.some((problem) => problem.kind === 'not-stats')),
    );
    return this.sum;
  }

  /** The saved words of every device, per day, reading whatever has not been read yet. */
  async totals(): Promise<DailyTotals> {
    for (;;) {
      const known = this.peek();
      if (known !== null) return known;
      this.reading ??= this.read().finally(() => {
        this.reading = null;
      });
      await this.reading;
    }
  }

  private changed(): void {
    this.generation++;
    this.sum = null;
  }

  /** Read the files that are missing or stale. Never rejects. */
  private async read(): Promise<void> {
    try {
      for (;;) {
        const open = this.store.project;
        if (open === null) return;
        // Whoever follows the store may not have been told yet.
        if (open.indexPath !== this.project) this.follow(open.indexPath, false);

        if (!this.listed) {
          const present = new Set(this.store.statsFiles().filter(isMarkdownPath));
          for (const path of [...this.files.keys()]) {
            if (!present.has(path)) this.files.delete(path);
          }
          this.stale.clear();
          for (const path of present) {
            if (!this.files.has(path)) this.stale.add(path);
          }
        }
        const generation = this.generation;
        const wanted = [...this.stale];
        const read = await Promise.all(
          wanted.map(async (path) => ({ path, result: await this.store.readDataFile(path) })),
        );
        // Something changed while the files were being read: look again.
        if (generation !== this.generation || this.store.project?.indexPath !== open.indexPath) continue;

        for (const { path, result } of read) {
          this.stale.delete(path);
          if (result.status === 'done' && result.value !== null) {
            this.files.set(path, parseStatsFile(result.value, path));
          } else if (result.status !== 'done') {
            console.error(`Spellbook: the word log "${path}" could not be read: ${result.message}`);
          }
        }
        this.listed = true;
        this.sum = null;
        return;
      }
    } catch (error) {
      console.error('Spellbook: the word logs could not be read', error);
      // Go on with what is known rather than ask for ever.
      this.stale.clear();
      this.listed = true;
      this.sum = null;
    }
  }
}
