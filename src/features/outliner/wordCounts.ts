// The outliner's one doorway to the plugin's shared word-count cache
// (src/core/wordCountCache.ts).
//
// Everything the outliner needs from the cache is asked through this file and
// nothing else, so that when the cache changes, this is the only file of the
// outliner that has to change with it.
//
// The cache keeps what each asker wants apart, by the asker's name. The
// outliner asks under a name of its own, for the scenes its table shows and
// nothing more, and lets go when its last pane closes: what the binder or
// another screen asks for is neither lost nor kept by it.

import type { WordCountCache } from '../../core/wordCountCache';

/** The name the outliner asks the shared word counts under. No other asker uses it. */
export const WORD_COUNT_ASKER = 'outliner';

/** What the outliner asks of the word counts. All paths are vault paths. */
export interface OutlinerWordCounts {
  /** The words of a note: a number once counted, null when it cannot be read, undefined while it waits. */
  get(vaultPath: string): number | null | undefined;
  /**
   * Ask for notes to be counted, and kept up to date, from now on. It
   * replaces what the outliner asked for before.
   *
   * @param scenes the scenes the table shows, in manuscript order: they are counted in that order
   */
  want(scenes: readonly string[]): void;
  /** Be told which notes have a new count. Returns a function that stops it. */
  onChange(listener: (vaultPaths: readonly string[]) => void): () => void;
  /** The outliner no longer shows any counts: the notes only it wanted are forgotten. */
  release(): void;
}

export function outlinerWordCounts(cache: WordCountCache): OutlinerWordCounts {
  return {
    get: (vaultPath) => cache.get(vaultPath),
    want: (scenes) => {
      cache.track(WORD_COUNT_ASKER, scenes);
    },
    onChange: (listener) => cache.onChange(listener),
    release: () => {
      cache.release(WORD_COUNT_ASKER);
    },
  };
}
