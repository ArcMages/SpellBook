// The outliner's one doorway to the plugin's shared word-count cache
// (src/core/wordCountCache.ts).
//
// Everything the outliner needs from the cache is asked through this file and
// nothing else, so that when the cache changes, this is the only file of the
// outliner that has to change with it.
//
// As the cache stands, it counts for one asker at a time: each `track` names
// everything that is wanted and the counts of all other notes are forgotten.
// The binder asks too. So the outliner asks for exactly the notes the binder
// asks for (the scenes of the binder, then the other notes of the manuscript
// folder), and nobody's counts are lost whoever asked last.

import type { WordCountCache } from '../../core/wordCountCache';

/** What the outliner asks of the word counts. All paths are vault paths. */
export interface OutlinerWordCounts {
  /** The words of a note: a number once counted, null when it cannot be read, undefined while it waits. */
  get(vaultPath: string): number | null | undefined;
  /**
   * Ask for notes to be counted, and kept up to date, from now on.
   *
   * @param scenes the scenes the table shows, in manuscript order: these are counted first
   * @param others the other notes the binder shows a count for; the table shows none of
   *               them, but as long as the cache counts for one asker at a time they
   *               have to be asked for too, or the binder would lose them
   */
  want(scenes: readonly string[], others: readonly string[]): void;
  /** Be told which notes have a new count. Returns a function that stops it. */
  onChange(listener: (vaultPaths: readonly string[]) => void): () => void;
  /** The outliner no longer shows any counts. */
  release(): void;
}

export function outlinerWordCounts(cache: WordCountCache): OutlinerWordCounts {
  return {
    get: (vaultPath) => cache.get(vaultPath),
    want: (scenes, others) => {
      cache.track([...scenes, ...others]);
    },
    onChange: (listener) => cache.onChange(listener),
    // The cache has no way to take one asker's request back: the notes stay
    // tracked for the binder, which asks for the very same ones.
    release: () => undefined,
  };
}
