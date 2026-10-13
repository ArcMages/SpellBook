// Word counts for the notes a view is showing.
//
// A view says which notes it wants counted (track). Each one is read through
// the vault doorway and counted once; the number is kept until the note
// changes. Counting a whole novel takes a while, so it is done a little at a
// time, with a pause after each piece of work in which Obsidian can draw the
// screen and answer taps. When a note is saved, only that note is counted
// again, a moment after the last save.
//
// Nothing here writes to the vault.

import { isInside } from './paths';
import type { VaultEvent, VaultPort } from './vaultPort';
import { countPlainWords, countableText, splitAtLineBreaks } from './wordCount';

/** How long to wait after a note was last saved before counting it again. */
export const WORD_COUNT_DEBOUNCE_MS = 750;

/**
 * At most this many characters are counted in one go before pausing (a single
 * line longer than this is the one exception). That much text is counted in a
 * few thousandths of a second, even on a phone.
 */
export const WORD_COUNT_SLICE_CHARS = 20000;

/** At most this many notes are read in one go, however short they are. */
export const WORD_COUNT_SLICE_NOTES = 40;

export interface WordCountDeps {
  readonly vault: Pick<VaultPort, 'readText' | 'on'>;
  /** Call `callback` once after `ms` milliseconds. Returns a function that cancels it. */
  readonly setTimer: (callback: () => void, ms: number) => () => void;
  /** Counts the words of text that holds no properties and no comments. Default: countPlainWords. */
  readonly countPlain?: (text: string) => number;
}

/** Told which notes (vault paths) have a new count. */
export type WordCountListener = (paths: readonly string[]) => void;

export class WordCountCache {
  private readonly vault: Pick<VaultPort, 'readText' | 'on'>;
  private readonly setTimer: WordCountDeps['setTimer'];
  private readonly countPlain: (text: string) => number;

  /** A note's count by vault path; null when the note could not be read. */
  private readonly counts = new Map<string, number | null>();
  /** The notes whose counts are wanted. */
  private tracked = new Set<string>();
  /** Notes waiting to be counted, in the order they will be. */
  private readonly queue = new Set<string>();
  /** The note being read and counted right now, if any. */
  private inHand: string | null = null;
  /** Notes that were just saved, each with the function that cancels its timer. */
  private readonly settling = new Map<string, () => void>();
  private readonly listeners = new Set<WordCountListener>();

  private stopListening: (() => void) | null = null;
  private cancelPause: (() => void) | null = null;
  private working = false;
  private disposed = false;
  private idleWaiters: Array<() => void> = [];

  constructor(deps: WordCountDeps) {
    this.vault = deps.vault;
    this.setTimer = deps.setTimer;
    this.countPlain = deps.countPlain ?? ((text) => countPlainWords(text));
  }

  // ---------------------------------------------------------------- lifecycle

  /** Begin following the vault, so that counts stay right when notes change. */
  start(): void {
    if (this.stopListening || this.disposed) return;
    this.stopListening = this.vault.on((event) => this.onVaultEvent(event));
  }

  /** Stop everything: no more reading, counting or timers. */
  dispose(): void {
    this.disposed = true;
    this.stopListening?.();
    this.stopListening = null;
    this.cancelPause?.();
    this.cancelPause = null;
    for (const cancel of this.settling.values()) cancel();
    this.settling.clear();
    this.queue.clear();
    this.counts.clear();
    this.tracked = new Set();
    this.listeners.clear();
    this.releaseIdleWaiters();
  }

  /** Be told when counts change. Returns a function that stops it. */
  onChange(listener: WordCountListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Resolves when nothing is being counted or waiting to be (notes that were just saved aside). */
  idle(): Promise<void> {
    if (this.disposed || (!this.working && this.queue.size === 0)) return Promise.resolve();
    return new Promise((resolve) => {
      this.idleWaiters.push(resolve);
    });
  }

  // ------------------------------------------------------------------ reading

  /**
   * The words in the note at a vault path: a number once it has been counted,
   * null when the note could not be read, undefined while it is still waiting
   * (or is not tracked).
   */
  get(path: string): number | null | undefined {
    return this.counts.get(path);
  }

  /**
   * Say which notes are wanted from now on, as vault paths, in the order they
   * should be counted. Counts of other notes are forgotten; notes counted
   * before are not read again.
   */
  track(paths: Iterable<string>): void {
    if (this.disposed) return;
    const wanted = new Set(paths);
    for (const path of [...this.counts.keys()]) {
      if (!wanted.has(path)) this.counts.delete(path);
    }
    for (const path of [...this.queue]) {
      if (!wanted.has(path)) this.queue.delete(path);
    }
    for (const [path, cancel] of [...this.settling]) {
      if (wanted.has(path)) continue;
      cancel();
      this.settling.delete(path);
    }
    this.tracked = wanted;
    for (const path of wanted) {
      // The note in hand is on its way already: asking again must not make it start over.
      if (!this.counts.has(path) && path !== this.inHand) this.queue.add(path);
    }
    this.pump();
  }

  // ------------------------------------------------------------- vault events

  private onVaultEvent(event: VaultEvent): void {
    if (this.disposed) return;
    switch (event.type) {
      case 'modify':
        if (this.tracked.has(event.path)) this.countSoon(event.path);
        return;
      case 'create':
        // A note that was wanted but not there yet (still syncing) has arrived.
        if (!event.folder && this.tracked.has(event.path)) {
          this.queue.add(event.path);
          this.pump();
        }
        return;
      case 'delete':
        if (event.folder) {
          for (const path of [...this.counts.keys()]) {
            if (isInside(event.path, path)) this.forget(path);
          }
        } else {
          this.forget(event.path);
        }
        return;
      case 'rename':
        // A renamed folder reports every note inside it as well.
        if (!event.folder) this.moved(event.oldPath, event.path);
        return;
      default:
        return;
    }
  }

  /** Count a note again once it has stopped being saved for a moment. */
  private countSoon(path: string): void {
    this.settling.get(path)?.();
    this.settling.set(
      path,
      this.setTimer(() => {
        this.settling.delete(path);
        if (this.disposed || !this.tracked.has(path)) return;
        this.queue.add(path);
        this.pump();
      }, WORD_COUNT_DEBOUNCE_MS),
    );
  }

  private forget(path: string): void {
    this.counts.delete(path);
    this.queue.delete(path);
    this.settling.get(path)?.();
    this.settling.delete(path);
  }

  /** A note was renamed: its count is still right, under its new path. */
  private moved(from: string, to: string): void {
    const count = this.counts.get(from);
    const wasQueued = this.queue.has(from);
    const wasSettling = this.settling.has(from);
    const wasTracked = this.tracked.delete(from);
    this.forget(from);
    if (wasTracked) this.tracked.add(to);
    // Not wanted under either name: nothing to keep.
    if (!this.tracked.has(to)) return;

    if (wasTracked && typeof count === 'number') {
      this.counts.set(to, count);
      if (wasSettling) this.countSoon(to);
      if (!wasQueued) return;
    } else {
      // Never counted, or a note was renamed onto a path that was wanted but
      // had no note until now: count it.
      this.counts.delete(to);
    }
    this.queue.add(to);
    this.pump();
  }

  // ----------------------------------------------------------------- counting

  private pump(): void {
    if (this.working || this.disposed) return;
    if (this.queue.size === 0) {
      this.releaseIdleWaiters();
      return;
    }
    this.working = true;
    void this.work();
  }

  /** Take the next note that is still wanted off the queue. */
  private nextQueued(): string | undefined {
    for (const path of this.queue) {
      this.queue.delete(path);
      if (this.tracked.has(path)) return path;
    }
    return undefined;
  }

  /** Let Obsidian draw and answer taps before going on. */
  private pause(): Promise<void> {
    return new Promise((resolve) => {
      this.cancelPause = this.setTimer(() => {
        this.cancelPause = null;
        resolve();
      }, 0);
    });
  }

  private async work(): Promise<void> {
    let changed: string[] = [];
    const announce = (): void => {
      if (changed.length === 0) return;
      const paths = changed;
      changed = [];
      this.emit(paths);
    };

    try {
      // What this go has done so far: characters counted and notes read.
      let chars = 0;
      let notes = 0;
      while (!this.disposed) {
        this.inHand = null; // the last note is done with
        if (this.queue.size === 0) break;
        if (notes >= WORD_COUNT_SLICE_NOTES) {
          announce();
          await this.pause();
          if (this.disposed) return;
          chars = 0;
          notes = 0;
          continue;
        }
        const path = this.nextQueued();
        if (path === undefined) break;
        notes++;
        this.inHand = path;

        let text: string;
        try {
          text = await this.vault.readText(path);
        } catch {
          // The note is gone or cannot be read. Say so once; it is tried
          // again when the vault reports it as created or changed.
          if (!this.disposed && this.tracked.has(path) && !this.queue.has(path) && this.counts.get(path) !== null) {
            this.counts.set(path, null);
            changed.push(path);
          }
          continue;
        }
        if (this.disposed) return;

        let words = 0;
        for (const piece of splitAtLineBreaks(countableText(text), WORD_COUNT_SLICE_CHARS)) {
          // Would this piece make the go too long? Then pause first.
          if (chars > 0 && chars + piece.length > WORD_COUNT_SLICE_CHARS) {
            announce();
            await this.pause();
            if (this.disposed) return;
            chars = 0;
            notes = 1; // the note in hand
          }
          words += this.countPlain(piece);
          chars += piece.length;
        }

        // The note may have been dropped, or saved again, while it was being
        // counted. Then this number is out of date: leave it out.
        if (!this.tracked.has(path) || this.queue.has(path)) continue;
        if (this.counts.get(path) !== words) {
          this.counts.set(path, words);
          changed.push(path);
        }
      }
    } catch (error) {
      console.error('Spellbook: counting words failed', error);
    } finally {
      this.working = false;
      this.inHand = null;
      if (!this.disposed) {
        announce();
        // A listener may have asked for more in the meantime.
        this.pump();
      }
    }
  }

  private emit(paths: readonly string[]): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(paths);
      } catch (error) {
        console.error('Spellbook: a word count listener failed', error);
      }
    }
  }

  private releaseIdleWaiters(): void {
    const waiters = this.idleWaiters;
    this.idleWaiters = [];
    for (const resolve of waiters) resolve();
  }
}
