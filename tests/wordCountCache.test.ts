// Word counts for the notes on show: counted once, a little at a time, and
// again only for a note that was saved.

import { describe, expect, it } from 'vitest';
import { countPlainWords, countWords } from '../src/core/wordCount';
import {
  WORD_COUNT_DEBOUNCE_MS,
  WORD_COUNT_SLICE_CHARS,
  WORD_COUNT_SLICE_NOTES,
  WordCountCache,
} from '../src/core/wordCountCache';
import { ManualTimers, MemoryVault } from './memoryVault';
import { tick } from './storeHarness';

interface Stage {
  vault: MemoryVault;
  timers: ManualTimers;
  cache: WordCountCache;
  /** Every announcement of new counts, in order. */
  changes: string[][];
  /** How many characters were counted in each go; a new go starts after every pause. */
  goes: number[];
  /** The length of every piece of text handed to the counter. */
  pieces: number[];
}

function stage(vault: MemoryVault = new MemoryVault()): Stage {
  const timers = new ManualTimers();
  const goes: number[] = [0];
  const pieces: number[] = [];
  const cache = new WordCountCache({
    vault,
    setTimer: (callback, ms) => {
      if (ms === 0) goes.push(0); // a pause: what follows is the next go
      return timers.set(callback, ms);
    },
    countPlain: (text) => {
      goes[goes.length - 1] = (goes[goes.length - 1] ?? 0) + text.length;
      pieces.push(text.length);
      return countPlainWords(text);
    },
  });
  const changes: string[][] = [];
  cache.onChange((paths) => changes.push([...paths]));
  cache.start();
  return { vault, timers, cache, changes, goes, pieces };
}

/** Let the cache finish its queue: its pauses are let through, the wait after a save is not. */
async function drain({ cache, timers }: Pick<Stage, 'cache' | 'timers'>): Promise<void> {
  let done = false;
  void cache.idle().then(() => {
    done = true;
  });
  for (let turn = 0; turn < 5000 && !done; turn++) {
    await tick();
    timers.advance(0);
  }
  if (!done) throw new Error('the word counts never finished');
  await tick();
}

const A = 'Novel/Manuscript/A.md';
const B = 'Novel/Manuscript/B.md';
const C = 'Novel/Manuscript/C.md';

function threeNotes(): MemoryVault {
  return new MemoryVault()
    .seed(A, { frontmatter: { status: 'To do', synopsis: 'four words not counted' }, body: 'One two three.\n\n%%a hidden note%%\n' })
    .seed(B, { body: 'שלום עולם, מה שלומך?\n' })
    .seed(C, { body: '' });
}

describe('counting the notes that are wanted', () => {
  it('counts each tracked note, leaving out its properties and its comments', async () => {
    const s = stage(threeNotes());
    s.cache.track([A, B, C]);
    expect(s.cache.get(A)).toBeUndefined(); // not counted yet
    await drain(s);

    expect(s.cache.get(A)).toBe(3);
    expect(s.cache.get(B)).toBe(4);
    expect(s.cache.get(C)).toBe(0);
    expect(s.changes.flat()).toEqual([A, B, C]); // announced in the order asked for
  });

  it('gives the same number as counting the note in one go', async () => {
    const s = stage(threeNotes());
    s.cache.track([A, B]);
    await drain(s);
    expect(s.cache.get(A)).toBe(countWords(await s.vault.readText(A)));
    expect(s.cache.get(B)).toBe(countWords(await s.vault.readText(B)));
  });

  it('reads a note only once, however often it is asked for', async () => {
    const s = stage(threeNotes());
    s.cache.track([A, B]);
    await drain(s);
    expect(s.vault.reads.readText).toBe(2);

    s.cache.track([A, B]);
    s.cache.track([B, A, C]);
    await drain(s);
    expect(s.vault.reads.readText).toBe(3); // only C was new
    expect(s.changes).toEqual([[A, B], [C]]);
  });

  it('does not start a note over when the list is asked for again while it is being counted', async () => {
    const big = `${'word '.repeat(4000)}\n`.repeat(4); // long enough to pause in the middle of it
    const vault = threeNotes().seed('Novel/Manuscript/Big.md', { body: big });
    const s = stage(vault);
    const BIG = 'Novel/Manuscript/Big.md';
    s.cache.track([BIG, A, B]);
    await tick(); // the big note is in hand, half counted

    // The view draws itself again and asks for the same notes, several times.
    s.cache.track([BIG, A, B]);
    s.cache.track([A, BIG, B]);
    await tick();
    s.timers.advance(0);
    s.cache.track([BIG, A, B]);
    await drain(s);

    expect(s.cache.get(BIG)).toBe(16000);
    expect(s.cache.get(A)).toBe(3);
    expect(s.vault.reads.readText).toBe(3); // each note read exactly once
  });

  it('counts a note that was dropped and asked for again while it was in hand', async () => {
    const big = `${'word '.repeat(4000)}\n`.repeat(4);
    const vault = threeNotes().seed('Novel/Manuscript/Big.md', { body: big });
    const s = stage(vault);
    const BIG = 'Novel/Manuscript/Big.md';
    s.cache.track([BIG, A]);
    await tick();
    s.cache.track([A]); // another project is shown for a moment...
    s.cache.track([BIG, A]); // ...and then this one again
    await drain(s);
    expect(s.cache.get(BIG)).toBe(16000);
    expect(s.cache.get(A)).toBe(3);

    // The same, but the note in hand is finished before it is asked for again.
    const t = stage(threeNotes().seed('Novel/Manuscript/Big.md', { body: big }));
    t.cache.track([BIG, A]);
    await tick();
    t.cache.track([A]);
    await drain(t);
    expect(t.cache.get(BIG)).toBeUndefined();
    t.cache.track([BIG, A]);
    await drain(t);
    expect(t.cache.get(BIG)).toBe(16000);
  });

  it('knows nothing about notes it was not asked for, and forgets those no longer wanted', async () => {
    const s = stage(threeNotes());
    s.cache.track([A, B]);
    await drain(s);
    expect(s.cache.get(C)).toBeUndefined();

    s.cache.track([B]);
    expect(s.cache.get(A)).toBeUndefined();
    expect(s.cache.get(B)).toBe(4);
    s.cache.track([]);
    expect(s.cache.get(B)).toBeUndefined();
    await drain(s);
    expect(s.vault.reads.readText).toBe(2);
  });

  it('writes nothing', async () => {
    const s = stage(threeNotes());
    s.cache.track([A, B, C]);
    await drain(s);
    s.vault.external.write(A, { body: 'changed' });
    s.timers.advance(WORD_COUNT_DEBOUNCE_MS);
    await drain(s);
    expect(s.vault.writes).toEqual([]);
  });
});

describe('not holding up the app', () => {
  it('counts a big project a little at a time, pausing in between', async () => {
    const vault = new MemoryVault();
    const paths: string[] = [];
    const body = `${'word '.repeat(600)}\n`; // about 3000 characters
    for (let n = 1; n <= 500; n++) {
      const path = `Novel/Manuscript/Scene ${n}.md`;
      vault.seed(path, { frontmatter: { order: n * 1024 }, body });
      paths.push(path);
    }
    const s = stage(vault);
    s.cache.track(paths);

    // The first go stops well before the end, and waits for its pause to pass.
    await tick();
    expect(s.cache.get(paths[0] as string)).toBe(600);
    expect(s.cache.get(paths[499] as string)).toBeUndefined();
    expect(s.timers.pending).toBe(1);
    const countedSoFar = s.pieces.length;
    await tick();
    await tick();
    expect(s.pieces.length).toBe(countedSoFar); // nothing more until the pause is over

    await drain(s);
    expect(paths.every((path) => s.cache.get(path) === 600)).toBe(true);
    expect(s.vault.reads.readText).toBe(500);

    // Many short goes, none of them long.
    expect(s.goes.length).toBeGreaterThan(50);
    expect(Math.max(...s.goes)).toBeLessThanOrEqual(WORD_COUNT_SLICE_CHARS);
    // Each go is announced once, so the rows on screen fill in as it goes.
    expect(s.changes.length).toBeGreaterThan(50);
    expect(s.changes.flat()).toEqual(paths);
  });

  it('counts one very long note in pieces, and still gets the total right', async () => {
    const line = 'היא כתבה a long line of words, both עברית and English, again and again.\n';
    const body = line.repeat(2500); // about 175,000 characters
    const vault = new MemoryVault().seed(A, { frontmatter: { order: 1024 }, body });
    const s = stage(vault);
    s.cache.track([A]);
    await drain(s);

    expect(s.cache.get(A)).toBe(countWords(body));
    expect(s.cache.get(A)).toBe(2500 * countWords(line));
    expect(s.pieces.length).toBeGreaterThanOrEqual(8);
    expect(Math.max(...s.pieces)).toBeLessThanOrEqual(WORD_COUNT_SLICE_CHARS);
    expect(s.goes.filter((chars) => chars > 0).length).toBe(s.pieces.length); // one piece, then a pause
    // Half-finished sums are never announced: the count appears once, complete.
    expect(s.changes).toEqual([[A]]);
  });

  it('reads only so many notes in one go, so that hundreds of empty ones do not go in one breath', async () => {
    const vault = new MemoryVault();
    const paths: string[] = [];
    for (let n = 1; n <= 300; n++) {
      paths.push(`Novel/Manuscript/Empty ${n}.md`);
      vault.seed(paths[paths.length - 1] as string, { body: '' });
    }
    const s = stage(vault);
    s.cache.track(paths);
    await drain(s);
    expect(paths.every((path) => s.cache.get(path) === 0)).toBe(true);
    expect(s.changes.length).toBeGreaterThan(3);
    expect(Math.max(...s.changes.map((paths) => paths.length))).toBeLessThanOrEqual(WORD_COUNT_SLICE_NOTES);
  });
});

describe('when a note is saved', () => {
  it('counts just that note again, a moment after the last save', async () => {
    const s = stage(threeNotes());
    s.cache.track([A, B, C]);
    await drain(s);
    const readsBefore = s.vault.reads.readText;
    s.changes.length = 0;

    s.vault.external.write(A, { body: 'One two three four five.' });
    await tick();
    expect(s.cache.get(A)).toBe(3); // still the old number
    s.timers.advance(WORD_COUNT_DEBOUNCE_MS - 1);
    await tick();
    expect(s.vault.reads.readText).toBe(readsBefore);

    // Saved again before the wait is over: the wait starts afresh.
    s.vault.external.write(A, { body: 'One two three four five six.' });
    s.timers.advance(WORD_COUNT_DEBOUNCE_MS - 1);
    await tick();
    expect(s.vault.reads.readText).toBe(readsBefore);

    s.timers.advance(1);
    await drain(s);
    expect(s.cache.get(A)).toBe(6);
    expect(s.vault.reads.readText).toBe(readsBefore + 1); // B and C were left alone
    expect(s.changes).toEqual([[A]]);
  });

  it('says nothing when the number did not change (a change to the properties, for example)', async () => {
    const s = stage(threeNotes());
    s.cache.track([A]);
    await drain(s);
    s.changes.length = 0;

    s.vault.external.editFrontmatter(A, (frontmatter) => {
      frontmatter['order'] = 2048;
    });
    s.timers.advance(WORD_COUNT_DEBOUNCE_MS);
    await drain(s);
    expect(s.cache.get(A)).toBe(3);
    expect(s.changes).toEqual([]);
  });

  it('ignores saves of notes nobody asked about', async () => {
    const s = stage(threeNotes());
    s.cache.track([A]);
    await drain(s);
    const readsBefore = s.vault.reads.readText;

    s.vault.external.write(B, { body: 'something else entirely' });
    expect(s.timers.pending).toBe(0);
    await drain(s);
    expect(s.vault.reads.readText).toBe(readsBefore);
  });

  it('throws away a count that was overtaken by a save, and counts again', async () => {
    const big = `${'word '.repeat(4000)}\n`.repeat(4); // four lines of 20,000 characters
    const vault = new MemoryVault().seed(A, { body: big });
    const s = stage(vault);
    const seen: Array<number | null | undefined> = [];
    s.cache.onChange(() => seen.push(s.cache.get(A)));
    s.cache.track([A]);
    await tick(); // the first piece is counted; the cache is pausing

    s.vault.external.write(A, { body: 'Only three words.' });
    s.timers.advance(WORD_COUNT_DEBOUNCE_MS);
    await drain(s);

    expect(s.cache.get(A)).toBe(3);
    expect(seen).toEqual([3]); // the old text's 16,000 was never shown
  });
});

describe('when notes come, go and move', () => {
  it('keeps the count of a renamed note without reading it again', async () => {
    const s = stage(threeNotes());
    s.cache.track([A, B]);
    await drain(s);
    const readsBefore = s.vault.reads.readText;

    const renamed = 'Novel/Manuscript/Opening.md';
    s.vault.external.rename(A, renamed);
    expect(s.cache.get(renamed)).toBe(3);
    expect(s.cache.get(A)).toBeUndefined();

    // The view then asks for the new list; nothing needs counting.
    s.cache.track([renamed, B]);
    await drain(s);
    expect(s.vault.reads.readText).toBe(readsBefore);

    // And the renamed note is still followed.
    s.vault.external.write(renamed, { body: 'Now there are five words.' });
    s.timers.advance(WORD_COUNT_DEBOUNCE_MS);
    await drain(s);
    expect(s.cache.get(renamed)).toBe(5);
  });

  it('follows a note that is renamed while it waits to be counted again', async () => {
    const s = stage(threeNotes());
    s.cache.track([A]);
    await drain(s);

    s.vault.external.write(A, { body: 'One two.' });
    const renamed = 'Novel/Manuscript/Opening.md';
    s.vault.external.rename(A, renamed);
    s.timers.advance(WORD_COUNT_DEBOUNCE_MS);
    await drain(s);
    expect(s.cache.get(renamed)).toBe(2);
  });

  it('follows the notes of a renamed folder', async () => {
    const s = stage(threeNotes());
    s.cache.track([A, B]);
    await drain(s);
    const readsBefore = s.vault.reads.readText;

    s.vault.external.rename('Novel', 'Saga');
    expect(s.cache.get('Saga/Manuscript/A.md')).toBe(3);
    expect(s.cache.get('Saga/Manuscript/B.md')).toBe(4);
    expect(s.vault.reads.readText).toBe(readsBefore);
  });

  it('forgets a deleted note, and counts it when it comes back', async () => {
    const s = stage(threeNotes());
    s.cache.track([A, B]);
    await drain(s);

    s.vault.external.delete(A);
    expect(s.cache.get(A)).toBeUndefined();
    expect(s.cache.get(B)).toBe(4);

    s.vault.external.create(A, { body: 'Back again with five words.' });
    await drain(s);
    expect(s.cache.get(A)).toBe(5);
  });

  it('forgets everything inside a deleted folder', async () => {
    const s = stage(threeNotes());
    s.cache.track([A, B]);
    await drain(s);
    s.vault.external.delete('Novel/Manuscript');
    expect(s.cache.get(A)).toBeUndefined();
    expect(s.cache.get(B)).toBeUndefined();
  });

  it('marks a note it cannot read, tries no further, and counts it once it arrives', async () => {
    const s = stage(threeNotes());
    const late = 'Novel/Manuscript/Late.md';
    s.cache.track([A, late]);
    await drain(s);
    expect(s.cache.get(late)).toBeNull();
    expect(s.changes.flat()).toEqual([A, late]);
    const readsBefore = s.vault.reads.readText;

    s.cache.track([A, late]);
    s.cache.track([late, A]);
    await drain(s);
    expect(s.vault.reads.readText).toBe(readsBefore); // not tried over and over

    s.vault.external.create(late, { body: 'Here at last.' });
    await drain(s);
    expect(s.cache.get(late)).toBe(3);
  });

  it('counts a note that is renamed onto a path that was waiting for one', async () => {
    const s = stage(threeNotes());
    const wanted = 'Novel/Manuscript/Wanted.md';
    s.cache.track([wanted]);
    await drain(s);
    expect(s.cache.get(wanted)).toBeNull();

    s.vault.external.rename(B, wanted);
    await drain(s);
    expect(s.cache.get(wanted)).toBe(4);
  });
});

describe('stopping', () => {
  it('drops queued work when the list is emptied', async () => {
    const vault = new MemoryVault();
    const paths: string[] = [];
    for (let n = 1; n <= 200; n++) {
      paths.push(`Novel/Manuscript/Scene ${n}.md`);
      vault.seed(paths[paths.length - 1] as string, { body: `${'word '.repeat(600)}\n` });
    }
    const s = stage(vault);
    s.cache.track(paths);
    await tick();
    const readsSoFar = s.vault.reads.readText;
    expect(readsSoFar).toBeLessThan(200);

    s.cache.track([]);
    await drain(s);
    expect(s.vault.reads.readText).toBe(readsSoFar);
    expect(s.cache.get(paths[0] as string)).toBeUndefined();
  });

  it('does nothing more once disposed: no reading, no timers, no announcements', async () => {
    const vault = new MemoryVault();
    const paths: string[] = [];
    for (let n = 1; n <= 200; n++) {
      paths.push(`Novel/Manuscript/Scene ${n}.md`);
      vault.seed(paths[paths.length - 1] as string, { body: `${'word '.repeat(600)}\n` });
    }
    const s = stage(vault);
    s.cache.track(paths);
    await tick();
    s.vault.external.write(paths[0] as string, { body: 'changed' }); // a save is waiting too
    expect(s.timers.pending).toBe(2);
    const readsSoFar = s.vault.reads.readText;
    const announced = s.changes.length;

    s.cache.dispose();
    expect(s.timers.pending).toBe(0);
    await s.cache.idle(); // nobody is left waiting
    s.timers.advance(60_000);
    await tick();
    s.vault.external.write(paths[1] as string, { body: 'changed' });
    s.cache.track(paths);
    await tick();

    expect(s.vault.reads.readText).toBe(readsSoFar);
    expect(s.changes.length).toBe(announced);
    expect(s.timers.pending).toBe(0);
    expect(s.cache.get(paths[0] as string)).toBeUndefined();
  });

  it('keeps going when a listener fails', async () => {
    const s = stage(threeNotes());
    const logged: unknown[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => {
      logged.push(args);
    };
    try {
      s.cache.onChange(() => {
        throw new Error('a view fell over');
      });
      s.cache.track([A, B]);
      await drain(s);
    } finally {
      console.error = original;
    }
    expect(s.cache.get(B)).toBe(4);
    expect(logged).toHaveLength(1);
  });
});
