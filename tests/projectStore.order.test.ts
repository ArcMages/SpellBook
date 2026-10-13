// Project store: the "order" property of scene notes.

import { describe, expect, it } from 'vitest';
import { flattenScenes, folderRef, sceneRef } from '../src/core/binderTree';
import { isStrictlyIncreasing } from '../src/core/orderKeys';
import { parseProjectIndex } from '../src/core/projectIndex';
import { ORDER_DEBOUNCE_MS } from '../src/core/projectStore';
import type { Frontmatter } from '../src/core/types';
import { MemoryVault } from './memoryVault';
import { openSeeded, picture, sceneBody, seedProject, settle, valueOf } from './storeHarness';

const five = { scenes: { A: 1024, B: 2048, C: 3072, D: 4096, E: 5120 } };

function orderOf(vault: MemoryVault, name: string, folder = 'Novel'): unknown {
  return vault.frontmatterOf(`${folder}/Manuscript/${name}.md`)?.['order'];
}

/** The scene notes that were written to, by name, in the order they were written. */
function sceneWrites(vault: MemoryVault): string[] {
  return vault.writes
    .filter((write) => write.op === 'updateFrontmatter' && write.path.includes('/Manuscript/'))
    .map((write) => write.path.replace(/^.*\/Manuscript\//, '').replace(/\.md$/, ''));
}

/** The order keys on disk of the scenes that exist, in the manuscript order stored in the index. */
function keysInManuscriptOrder(vault: MemoryVault, indexPath: string): unknown[] {
  const parsed = parseProjectIndex(vault.frontmatterOf(indexPath) as Frontmatter);
  if (!parsed.ok) throw new Error(parsed.error);
  const folder = indexPath.slice(0, indexPath.lastIndexOf('/'));
  return flattenScenes(parsed.binder)
    .filter((path) => vault.has(`${folder}/${path}`))
    .map((path) => vault.frontmatterOf(`${folder}/${path}`)?.['order']);
}

function expectRisingKeys(vault: MemoryVault, indexPath: string): void {
  const keys = keysInManuscriptOrder(vault, indexPath);
  expect(isStrictlyIncreasing(keys as Array<number | null>), JSON.stringify(keys)).toBe(true);
}

describe('order keys of new scenes', () => {
  it('are written when the scene is created, 1024 apart, and need no second write', async () => {
    const { store, vault, timers, indexPath } = await openSeeded();
    for (const title of ['One', 'Two', 'Three']) valueOf(await store.addScene(title));

    expect(['One', 'Two', 'Three'].map((name) => orderOf(vault, name))).toEqual([1024, 2048, 3072]);
    vault.clearWrites();
    timers.advance(ORDER_DEBOUNCE_MS);
    await settle(store);
    expect(vault.writes).toEqual([]);
    expectRisingKeys(vault, indexPath);
  });

  it('take a number between the neighbours for a scene added in the middle or at the front', async () => {
    const { store, vault, timers, indexPath } = await openSeeded(five);
    valueOf(await store.addScene('Mid', { at: 'after', sibling: sceneRef('Manuscript/B.md') }));
    valueOf(await store.addScene('Front', { at: 'start', parentId: null }));

    expect(orderOf(vault, 'Mid')).toBe(2560);
    expect(orderOf(vault, 'Front')).toBe(512);
    timers.advance(ORDER_DEBOUNCE_MS);
    await settle(store);
    expect(sceneWrites(vault)).toEqual([]); // no other note needed a new key
    expectRisingKeys(vault, indexPath);
  });
});

describe('order keys after a move', () => {
  it('rewrites exactly one scene note, after a delay, with a key between its new neighbours', async () => {
    const { store, vault, timers, indexPath } = await openSeeded(five);

    valueOf(await store.moveNode(sceneRef('Manuscript/E.md'), { at: 'after', sibling: sceneRef('Manuscript/A.md') }));

    // Straight after the move only the index has been written.
    expect(vault.writes).toEqual([{ op: 'updateFrontmatter', path: indexPath }]);
    timers.advance(ORDER_DEBOUNCE_MS - 1);
    await settle(store);
    expect(vault.writes).toHaveLength(1);

    timers.advance(1);
    await settle(store);
    expect(vault.writes).toEqual([
      { op: 'updateFrontmatter', path: indexPath },
      { op: 'updateFrontmatter', path: 'Novel/Manuscript/E.md' },
    ]);
    expect(orderOf(vault, 'E')).toBe(1536);
    expect(['A', 'B', 'C', 'D'].map((name) => orderOf(vault, name))).toEqual([1024, 2048, 3072, 4096]);
    expectRisingKeys(vault, indexPath);
  });

  it('changes only the order property: other properties and the text stay as they were', async () => {
    const { store, vault, timers } = await openSeeded(five);
    vault.external.editFrontmatter('Novel/Manuscript/E.md', (fm) => {
      fm['synopsis'] = 'Anna finds the letter.';
      fm['custom'] = { anything: [1, 2, 3] };
    });
    await settle(store);

    valueOf(await store.moveNode(sceneRef('Manuscript/E.md'), { at: 'start', parentId: null }));
    timers.advance(ORDER_DEBOUNCE_MS);
    await settle(store);

    expect(vault.frontmatterOf('Novel/Manuscript/E.md')).toEqual({
      status: 'To do',
      order: 512,
      synopsis: 'Anna finds the letter.',
      custom: { anything: [1, 2, 3] },
    });
    for (const name of ['A', 'B', 'C', 'D', 'E']) {
      expect(vault.bodyOf(`Novel/Manuscript/${name}.md`), name).toBe(sceneBody(name));
    }
  });

  it('waits until the writer has stopped moving things, then writes once', async () => {
    const { store, vault, timers, indexPath } = await openSeeded(five);

    valueOf(await store.moveNode(sceneRef('Manuscript/E.md'), { at: 'after', sibling: sceneRef('Manuscript/A.md') }));
    timers.advance(1000);
    await settle(store);
    valueOf(await store.moveNode(sceneRef('Manuscript/D.md'), { at: 'after', sibling: sceneRef('Manuscript/A.md') }));
    timers.advance(1000);
    await settle(store);
    expect(sceneWrites(vault)).toEqual([]); // 2 seconds after the first move, but only 1 after the last

    timers.advance(ORDER_DEBOUNCE_MS - 1000);
    await settle(store);
    expect(picture(store)).toBe('A D E B C');
    expect(sceneWrites(vault).sort()).toEqual(['D', 'E']);
    expect(['A', 'B', 'C'].map((name) => orderOf(vault, name))).toEqual([1024, 2048, 3072]);
    expectRisingKeys(vault, indexPath);
  });

  it('gives every scene of a moved folder a key in its new place, and leaves the others alone', async () => {
    const { store, vault, timers, indexPath } = await openSeeded({
      binder: ['Manuscript/A.md', 'Manuscript/B.md', { folder: 'Part', id: 'f-part', children: ['Manuscript/C.md', 'Manuscript/D.md'] }, 'Manuscript/E.md'],
      scenes: five.scenes,
    });
    valueOf(await store.moveNode(folderRef('f-part'), { at: 'start', parentId: null }));
    timers.advance(ORDER_DEBOUNCE_MS);
    await settle(store);

    expect(picture(store)).toBe('Part[C D] A B E');
    expect(sceneWrites(vault).sort()).toEqual(['C', 'D']);
    expectRisingKeys(vault, indexPath);
  });

  it('does not cause a feedback loop: its own writes lead to no further writes', async () => {
    const { store, vault, timers, changes } = await openSeeded(five);
    valueOf(await store.moveNode(sceneRef('Manuscript/E.md'), { at: 'start', parentId: null }));
    timers.advance(ORDER_DEBOUNCE_MS);
    await settle(store);
    expect(sceneWrites(vault)).toEqual(['E']);

    // The vault has reported the write (modify + metadata events). Nothing may follow from it.
    const writesAfterSync = vault.writes.length;
    const readsAfterSync = vault.reads.readFrontmatter;
    changes.length = 0;
    expect(timers.pending).toBe(0);
    for (let round = 0; round < 5; round++) {
      timers.advance(ORDER_DEBOUNCE_MS * 10);
      await settle(store);
    }
    expect(vault.writes).toHaveLength(writesAfterSync);
    expect(vault.reads.readFrontmatter).toBe(readsAfterSync);
    expect(timers.pending).toBe(0);
    expect(changes).toEqual([]);
  });

  it('settles even when the vault reports each scene write late', async () => {
    const { store, vault, timers, indexPath } = await openSeeded(five);
    vault.holdMetadata(); // from now on the vault's index lags behind the disk

    valueOf(await store.moveNode(sceneRef('Manuscript/E.md'), { at: 'after', sibling: sceneRef('Manuscript/A.md') }));
    timers.advance(ORDER_DEBOUNCE_MS);
    await settle(store);
    expect(sceneWrites(vault)).toEqual(['E']);
    expect(orderOf(vault, 'E')).toBe(1536);

    // E moves back to the end while the vault still reports its old key (5120).
    // The store must remember what it wrote, or it would think E is fine as it is.
    valueOf(await store.moveNode(sceneRef('Manuscript/E.md'), { at: 'end', parentId: null }));
    timers.advance(ORDER_DEBOUNCE_MS);
    await settle(store);
    expect(sceneWrites(vault)).toEqual(['E', 'E']);
    expect(orderOf(vault, 'E')).toBe(5120);
    expectRisingKeys(vault, indexPath);

    // The late reports arrive. Nothing more happens.
    const writes = vault.writes.length;
    vault.releaseMetadata();
    await settle(store);
    timers.advance(ORDER_DEBOUNCE_MS * 10);
    await settle(store);
    expect(vault.writes).toHaveLength(writes);
    expect(timers.pending).toBe(0);
    expectRisingKeys(vault, indexPath);
  });

  it('skips Missing scenes: they are neither written nor created', async () => {
    const { store, vault, timers, indexPath } = await openSeeded({
      binder: ['Manuscript/A.md', 'Manuscript/Ghost.md', 'Manuscript/B.md', 'Manuscript/C.md'],
      scenes: { A: 1024, B: 2048, C: 3072 },
    });
    valueOf(await store.moveNode(sceneRef('Manuscript/C.md'), { at: 'after', sibling: sceneRef('Manuscript/Ghost.md') }));
    timers.advance(ORDER_DEBOUNCE_MS);
    await settle(store);

    expect(picture(store)).toBe('A Ghost? C B');
    expect(sceneWrites(vault)).toEqual(['C']);
    expect(vault.has('Novel/Manuscript/Ghost.md')).toBe(false);
    expect(orderOf(vault, 'C')).toBe(1536);
    expectRisingKeys(vault, indexPath);
  });

  it('renumbers only when no whole number fits, and then only the notes whose key changes', async () => {
    // Keys packed tightly, as after a hand edit: nothing fits between 10 and 11.
    const { store, vault, timers, indexPath } = await openSeeded({ scenes: { A: 10, B: 11, C: 12, D: 5000, E: 6000 } });

    valueOf(await store.moveNode(sceneRef('Manuscript/D.md'), { at: 'after', sibling: sceneRef('Manuscript/A.md') }));
    timers.advance(ORDER_DEBOUNCE_MS);
    await settle(store);

    expect(picture(store)).toBe('A D B C E');
    // Two notes had to change instead of one; the other three were not written at all.
    expect(sceneWrites(vault).sort()).toEqual(['A', 'D']);
    expect([orderOf(vault, 'B'), orderOf(vault, 'C'), orderOf(vault, 'E')]).toEqual([11, 12, 6000]);
    expectRisingKeys(vault, indexPath);
  });

  it('does not renumber when a gap exists, however small', async () => {
    const { store, vault, timers, indexPath } = await openSeeded({ scenes: { A: 10, B: 12, C: 13, D: 5000 } });
    valueOf(await store.moveNode(sceneRef('Manuscript/D.md'), { at: 'after', sibling: sceneRef('Manuscript/A.md') }));
    timers.advance(ORDER_DEBOUNCE_MS);
    await settle(store);
    expect(sceneWrites(vault)).toEqual(['D']);
    expect(orderOf(vault, 'D')).toBe(11);
    expectRisingKeys(vault, indexPath);
  });

  it('gives keys to a project whose notes never had any, on the first change and not before', async () => {
    const { store, vault, timers, indexPath } = await openSeeded({ scenes: { A: null, B: null, C: null } });
    timers.advance(600_000);
    await settle(store);
    expect(vault.writes).toEqual([]); // opening a project never writes

    valueOf(await store.moveNode(sceneRef('Manuscript/C.md'), { at: 'start', parentId: null }));
    timers.advance(ORDER_DEBOUNCE_MS);
    await settle(store);
    expect(sceneWrites(vault).sort()).toEqual(['A', 'B', 'C']);
    expect(['C', 'A', 'B'].map((name) => orderOf(vault, name))).toEqual([1024, 2048, 3072]);
    expectRisingKeys(vault, indexPath);
  });

  it('gives a key to an unfiled note when it is filed', async () => {
    const { store, vault, timers, indexPath } = await openSeeded({
      binder: ['Manuscript/A.md', 'Manuscript/B.md'],
      scenes: { A: 1024, B: 2048, Loose: null },
    });
    valueOf(await store.addUnfiledToBinder('Manuscript/Loose.md', { at: 'after', sibling: sceneRef('Manuscript/A.md') }));
    expect(orderOf(vault, 'Loose')).toBeUndefined(); // not yet
    timers.advance(ORDER_DEBOUNCE_MS);
    await settle(store);
    expect(sceneWrites(vault)).toEqual(['Loose']);
    expect(orderOf(vault, 'Loose')).toBe(1536);
    expectRisingKeys(vault, indexPath);
  });

  it('writes nothing for changes that keep the manuscript order', async () => {
    const { store, vault, timers } = await openSeeded({
      binder: ['Manuscript/A.md', { folder: 'Part', id: 'f-part', children: ['Manuscript/B.md'] }, 'Manuscript/C.md'],
      scenes: { A: 1024, B: 2048, C: 3072 },
    });
    valueOf(await store.removeFolder('f-part'));
    valueOf(await store.addFolder('Another'));
    valueOf(await store.moveNode(sceneRef('Manuscript/C.md'), { at: 'end', parentId: valueOf(await store.addFolder('Third')).id }));
    timers.advance(ORDER_DEBOUNCE_MS);
    await settle(store);
    expect(sceneWrites(vault)).toEqual([]);
  });
});

describe('order keys and other devices', () => {
  it('are not rewritten because the binder was reordered on another device', async () => {
    const { store, vault, timers, indexPath } = await openSeeded(five);
    vault.external.editFrontmatter(indexPath, (fm) => {
      fm['binder'] = ['Manuscript/E.md', 'Manuscript/D.md', 'Manuscript/C.md', 'Manuscript/B.md', 'Manuscript/A.md'];
    });
    await settle(store);
    expect(picture(store)).toBe('E D C B A');
    timers.advance(600_000);
    await settle(store);
    // The other device writes the keys for its own move; they arrive by sync.
    expect(vault.writes).toEqual([]);
  });

  it('rewrites only the scene moved here while a reorder from another device is still arriving', async () => {
    const { store, vault, timers, indexPath } = await openSeeded(five);
    // Another device moved E to the front. Its index has arrived; E.md, with its new key, has not.
    vault.external.editFrontmatter(indexPath, (fm) => {
      fm['binder'] = ['E', 'A', 'B', 'C', 'D'].map((name) => `Manuscript/${name}.md`);
    });
    await settle(store);

    valueOf(await store.moveNode(sceneRef('Manuscript/D.md'), { at: 'after', sibling: sceneRef('Manuscript/A.md') }));
    timers.advance(ORDER_DEBOUNCE_MS);
    await settle(store);

    expect(picture(store)).toBe('E A D B C');
    // E was not moved on this device, so its note is left to the device that moved it.
    expect(sceneWrites(vault)).toEqual(['D']);
    expect(orderOf(vault, 'D')).toBe(1536);
    expect(orderOf(vault, 'E')).toBe(5120);

    // E.md arrives with the key the other device gave it. Everything fits, and nothing more is written.
    vault.external.editFrontmatter('Novel/Manuscript/E.md', (fm) => {
      fm['order'] = 512;
    });
    await settle(store);
    timers.advance(ORDER_DEBOUNCE_MS * 10);
    await settle(store);
    expect(sceneWrites(vault)).toEqual(['D']);
    expectRisingKeys(vault, indexPath);
  });

  it('leaves room beside a scene whose key is still arriving, so the two keys cannot collide', async () => {
    const { store, vault, timers, indexPath } = await openSeeded(five);
    vault.external.editFrontmatter(indexPath, (fm) => {
      fm['binder'] = ['E', 'A', 'B', 'C', 'D'].map((name) => `Manuscript/${name}.md`);
    });
    await settle(store);

    // D goes straight after E, into the very gap E's new key (512) will land in.
    valueOf(await store.moveNode(sceneRef('Manuscript/D.md'), { at: 'after', sibling: sceneRef('Manuscript/E.md') }));
    timers.advance(ORDER_DEBOUNCE_MS);
    await settle(store);
    expect(sceneWrites(vault)).toEqual(['D']);
    expect(orderOf(vault, 'D')).toBe(682); // two thirds of the way to A, not the middle

    vault.external.editFrontmatter('Novel/Manuscript/E.md', (fm) => {
      fm['order'] = 512;
    });
    await settle(store);
    expectRisingKeys(vault, indexPath);
  });

  it('does not repair a key that only looks wrong, whatever else is moved here', async () => {
    // C carries a key that does not fit its place (a hand edit, or a reorder still arriving).
    const { store, vault, timers } = await openSeeded({ scenes: { A: 1024, B: 2048, C: 100, D: 4096, E: 5120 } });
    valueOf(await store.moveNode(sceneRef('Manuscript/E.md'), { at: 'start', parentId: null }));
    valueOf(await store.addScene('New'));
    timers.advance(ORDER_DEBOUNCE_MS);
    await settle(store);
    expect(sceneWrites(vault)).toEqual(['E']);
    expect(orderOf(vault, 'C')).toBe(100);

    // Moving C itself is what gives it a fitting key.
    valueOf(await store.moveNode(sceneRef('Manuscript/C.md'), { at: 'after', sibling: sceneRef('Manuscript/A.md') }));
    timers.advance(ORDER_DEBOUNCE_MS);
    await settle(store);
    expect(sceneWrites(vault)).toEqual(['E', 'C']);
    expect(orderOf(vault, 'C')).toBe(1536);
  });

  it('leaves a note alone when it already holds the planned key by the time of writing', async () => {
    const { store, vault, timers } = await openSeeded(five);
    valueOf(await store.moveNode(sceneRef('Manuscript/E.md'), { at: 'after', sibling: sceneRef('Manuscript/A.md') }));
    // The same key arrives from elsewhere before the delay is over, unnoticed.
    vault.external.editFrontmatter('Novel/Manuscript/E.md', (fm) => {
      fm['order'] = 1536;
    }, { silent: true });
    timers.advance(ORDER_DEBOUNCE_MS);
    await settle(store);
    expect(sceneWrites(vault)).toEqual([]);
  });

  it('plans against the binder on disk at the time of writing', async () => {
    const { store, vault, timers, indexPath } = await openSeeded(five);
    valueOf(await store.moveNode(sceneRef('Manuscript/E.md'), { at: 'after', sibling: sceneRef('Manuscript/A.md') }));
    // Before the delay is over the move is undone elsewhere, unnoticed by this device.
    vault.external.editFrontmatter(indexPath, (fm) => {
      fm['binder'] = ['A', 'B', 'C', 'D', 'E'].map((name) => `Manuscript/${name}.md`);
    }, { silent: true });
    timers.advance(ORDER_DEBOUNCE_MS);
    await settle(store);
    expect(sceneWrites(vault)).toEqual([]); // the keys already fit the binder as it now is
    expect(picture(store)).toBe('A B C D E');
  });

  it('writes no keys once the index has become unreadable', async () => {
    const { store, vault, timers, indexPath } = await openSeeded(five);
    valueOf(await store.moveNode(sceneRef('Manuscript/E.md'), { at: 'start', parentId: null }));
    vault.external.editFrontmatter(indexPath, (fm) => {
      fm['binder'] = 'broken by a merge';
    }, { silent: true });
    timers.advance(ORDER_DEBOUNCE_MS);
    await settle(store);
    expect(sceneWrites(vault)).toEqual([]);
    expect(store.project?.readOnly).toBe(true);
  });

  it('skips a note whose properties cannot be read, and never rewrites it', async () => {
    const { store, vault, timers } = await openSeeded(five);
    vault.external.corrupt('Novel/Manuscript/E.md', { silent: true });
    valueOf(await store.moveNode(sceneRef('Manuscript/E.md'), { at: 'start', parentId: null }));
    timers.advance(ORDER_DEBOUNCE_MS);
    await settle(store);
    expect(sceneWrites(vault)).toEqual([]);
    expect(await vault.readText('Novel/Manuscript/E.md')).toContain(sceneBody('E'));
  });
});

describe('a key that could not be written', () => {
  it('is tried again the next time the binder is changed here', async () => {
    const { store, vault, timers, indexPath } = await openSeeded(five);
    vault.failNext('updateFrontmatter', 'Novel/Manuscript/E.md');
    valueOf(await store.moveNode(sceneRef('Manuscript/E.md'), { at: 'start', parentId: null }));
    timers.advance(ORDER_DEBOUNCE_MS);
    await settle(store);
    expect(sceneWrites(vault)).toEqual([]);
    expect(orderOf(vault, 'E')).toBe(5120);
    expect(timers.pending).toBe(0); // no retry loop: it waits for the writer's next change

    valueOf(await store.moveNode(sceneRef('Manuscript/B.md'), { at: 'end', parentId: null }));
    timers.advance(ORDER_DEBOUNCE_MS);
    await settle(store);
    expect(picture(store)).toBe('E A C D B');
    expect(sceneWrites(vault).sort()).toEqual(['B', 'E']);
    expect(orderOf(vault, 'E')).toBe(512);
    expectRisingKeys(vault, indexPath);
  });
});

describe('a scene that was moved while its note was missing', () => {
  it('gets its key with the next change made here, once the note has arrived', async () => {
    const { store, vault, timers, indexPath } = await openSeeded({
      binder: ['Manuscript/A.md', 'Manuscript/Ghost.md', 'Manuscript/B.md', 'Manuscript/C.md'],
      scenes: { A: 1024, B: 2048, C: 3072 },
    });
    valueOf(await store.moveNode(sceneRef('Manuscript/Ghost.md'), { at: 'end', parentId: null }));
    timers.advance(ORDER_DEBOUNCE_MS);
    await settle(store);
    expect(sceneWrites(vault)).toEqual([]); // there is no note to write to yet

    // The note arrives, still carrying the key of its old place between A and B.
    vault.external.create('Novel/Manuscript/Ghost.md', { frontmatter: { order: 1536 }, body: sceneBody('Ghost') });
    await settle(store);
    timers.advance(ORDER_DEBOUNCE_MS * 10);
    await settle(store);
    expect(vault.writes.filter((write) => write.op === 'updateFrontmatter' && write.path !== indexPath)).toEqual([]);

    valueOf(await store.moveNode(sceneRef('Manuscript/C.md'), { at: 'start', parentId: null }));
    timers.advance(ORDER_DEBOUNCE_MS);
    await settle(store);
    expect(picture(store)).toBe('C A B Ghost');
    expect(sceneWrites(vault).sort()).toEqual(['C', 'Ghost']);
    expectRisingKeys(vault, indexPath);
  });
});

describe('order keys of notes the vault has not indexed yet', () => {
  it('reads the keys from the notes themselves, and still rewrites one note for one move', async () => {
    const { store, vault, timers, indexPath } = await openSeeded(five);
    vault.forgetIndex(); // as while Obsidian is still filling its index after starting

    valueOf(await store.moveNode(sceneRef('Manuscript/E.md'), { at: 'after', sibling: sceneRef('Manuscript/A.md') }));
    timers.advance(ORDER_DEBOUNCE_MS);
    await settle(store);

    expect(sceneWrites(vault)).toEqual(['E']);
    expect(orderOf(vault, 'E')).toBe(1536);
    expect(['A', 'B', 'C', 'D'].map((name) => orderOf(vault, name))).toEqual([1024, 2048, 3072, 4096]);
    expectRisingKeys(vault, indexPath);
  });

  it('gives a new scene a key that fits the keys on disk', async () => {
    const { store, vault, timers, indexPath } = await openSeeded({ scenes: { A: 100, B: 200, C: 300 } });
    vault.forgetIndex();

    valueOf(await store.addScene('Mid', { at: 'after', sibling: sceneRef('Manuscript/A.md') }));
    valueOf(await store.addScene('Last'));
    expect(orderOf(vault, 'Mid')).toBe(150);
    expect(orderOf(vault, 'Last')).toBe(1324);
    timers.advance(ORDER_DEBOUNCE_MS);
    await settle(store);

    expect(sceneWrites(vault)).toEqual([]);
    expect(['A', 'B', 'C'].map((name) => orderOf(vault, name))).toEqual([100, 200, 300]);
    expectRisingKeys(vault, indexPath);
  });

  it('copes with a single note that arrived a moment ago', async () => {
    const { store, vault, timers, indexPath } = await openSeeded(five);
    vault.holdMetadata(); // the vault lists new notes but has not read their properties
    vault.external.create('Novel/Manuscript/F.md', { frontmatter: { order: 9000 }, body: sceneBody('F') });
    vault.external.editFrontmatter(indexPath, (fm) => {
      fm['binder'] = ['A', 'B', 'C', 'D', 'E', 'F'].map((name) => `Manuscript/${name}.md`);
    });
    await settle(store);

    valueOf(await store.moveNode(sceneRef('Manuscript/A.md'), { at: 'after', sibling: sceneRef('Manuscript/B.md') }));
    timers.advance(ORDER_DEBOUNCE_MS);
    await settle(store);

    expect(sceneWrites(vault)).toEqual(['A']);
    expect(orderOf(vault, 'F')).toBe(9000); // its own key was read and found to fit
    expectRisingKeys(vault, indexPath);
  });

  it('still gives a key to a note that really has no properties', async () => {
    const vault = new MemoryVault().seed('Novel/Manuscript/Bare.md', { body: 'no properties at all' });
    const { store, timers, indexPath } = await openSeeded(
      { binder: ['Manuscript/A.md', 'Manuscript/Bare.md', 'Manuscript/B.md'], scenes: { A: 1024, B: 2048 } },
      vault,
    );
    valueOf(await store.moveNode(sceneRef('Manuscript/B.md'), { at: 'start', parentId: null }));
    timers.advance(ORDER_DEBOUNCE_MS);
    await settle(store);

    expect(sceneWrites(vault).sort()).toEqual(['B', 'Bare']);
    expect(vault.frontmatterOf('Novel/Manuscript/Bare.md')).toEqual({ order: 2048 });
    expect(vault.bodyOf('Novel/Manuscript/Bare.md')).toBe('no properties at all');
    expectRisingKeys(vault, indexPath);
  });

  it('plans around a note whose properties cannot be read at all', async () => {
    const { store, vault, timers } = await openSeeded(five);
    vault.external.corrupt('Novel/Manuscript/C.md', { silent: true });
    vault.forgetIndex();

    valueOf(await store.moveNode(sceneRef('Manuscript/E.md'), { at: 'after', sibling: sceneRef('Manuscript/A.md') }));
    timers.advance(ORDER_DEBOUNCE_MS);
    await settle(store);

    expect(sceneWrites(vault)).toEqual(['E']);
    expect(orderOf(vault, 'E')).toBe(1536);
    expect(await vault.readText('Novel/Manuscript/C.md')).toContain(sceneBody('C'));
  });
});

describe('order keys that are still waiting when the project is left', () => {
  it('are written before another project is opened', async () => {
    const vault = new MemoryVault();
    const other = seedProject(vault, { folder: 'Other', title: 'Other', scenes: { X: 1024 } });
    const { store, timers } = await openSeeded(five, vault);

    valueOf(await store.moveNode(sceneRef('Manuscript/E.md'), { at: 'start', parentId: null }));
    expect(orderOf(vault, 'E')).toBe(5120); // still waiting for its delay
    valueOf(await store.openProject(other));

    expect(store.project?.title).toBe('Other');
    expect(sceneWrites(vault)).toEqual(['E']);
    expect(orderOf(vault, 'E')).toBe(512);
    expect(timers.pending).toBe(0);
    timers.advance(ORDER_DEBOUNCE_MS * 10);
    await settle(store);
    expect(sceneWrites(vault)).toEqual(['E']); // and nothing lands in the project that is open now
    expect(orderOf(vault, 'X', 'Other')).toBe(1024);
  });

  it('are written before the project is closed', async () => {
    const { store, vault, timers, indexPath } = await openSeeded(five);
    valueOf(await store.moveNode(sceneRef('Manuscript/E.md'), { at: 'start', parentId: null }));

    await store.closeProject();

    expect(store.project).toBeNull();
    expect(sceneWrites(vault)).toEqual(['E']);
    expect(orderOf(vault, 'E')).toBe(512);
    expect(timers.pending).toBe(0);
    expectRisingKeys(vault, indexPath);
  });

  it('closing or switching writes nothing when no key is waiting', async () => {
    const vault = new MemoryVault();
    const other = seedProject(vault, { folder: 'Other', title: 'Other', scenes: { X: 1024 } });
    // A project whose keys do not fit its binder: opening and leaving it must not "repair" them.
    const { store } = await openSeeded({ scenes: { A: 3072, B: 2048, C: null } }, vault);
    const readsBefore = vault.reads.readFrontmatter;

    valueOf(await store.openProject(other));
    await store.closeProject();

    expect(vault.writes).toEqual([]);
    expect(vault.reads.readFrontmatter).toBe(readsBefore + 1); // only the index of the project being opened
  });

  it('are planned once an index that became unreadable has been repaired', async () => {
    const { store, vault, timers, indexPath } = await openSeeded(five);
    valueOf(await store.moveNode(sceneRef('Manuscript/E.md'), { at: 'start', parentId: null }));
    const moved = vault.frontmatterOf(indexPath)?.['binder'];
    vault.external.editFrontmatter(indexPath, (fm) => {
      fm['binder'] = 'broken by a merge';
    });
    await settle(store);
    timers.advance(ORDER_DEBOUNCE_MS * 10);
    await settle(store);
    expect(store.project?.readOnly).toBe(true);
    expect(sceneWrites(vault)).toEqual([]);

    vault.external.editFrontmatter(indexPath, (fm) => {
      fm['binder'] = moved;
    });
    await settle(store);
    expect(store.project?.readOnly).toBe(false);
    expect(sceneWrites(vault)).toEqual([]); // after the usual delay, not at once
    timers.advance(ORDER_DEBOUNCE_MS);
    await settle(store);

    expect(sceneWrites(vault)).toEqual(['E']);
    expect(orderOf(vault, 'E')).toBe(512);
    expect(timers.pending).toBe(0);
    expectRisingKeys(vault, indexPath);
  });

  it('follow a scene that is renamed before its key was written', async () => {
    const { store, vault, timers, indexPath } = await openSeeded(five);
    valueOf(await store.moveNode(sceneRef('Manuscript/E.md'), { at: 'start', parentId: null }));
    valueOf(await store.renameScene('Manuscript/E.md', 'Epilogue'));
    // ... and D is moved, then renamed in the file explorer.
    valueOf(await store.moveNode(sceneRef('Manuscript/D.md'), { at: 'after', sibling: sceneRef('Manuscript/A.md') }));
    vault.external.rename('Novel/Manuscript/D.md', 'Novel/Manuscript/Dawn.md');
    timers.advance(ORDER_DEBOUNCE_MS);
    await settle(store);

    expect(picture(store)).toBe('Epilogue A Dawn B C');
    expect(sceneWrites(vault).sort()).toEqual(['Dawn', 'Epilogue']);
    expect(orderOf(vault, 'Epilogue')).toBe(512);
    expect(orderOf(vault, 'Dawn')).toBe(1536);
    expectRisingKeys(vault, indexPath);
  });
});

describe('syncOrderKeysNow', () => {
  it('writes outstanding keys without waiting, and the later timer then has nothing to do', async () => {
    const { store, vault, timers } = await openSeeded(five);
    valueOf(await store.moveNode(sceneRef('Manuscript/E.md'), { at: 'start', parentId: null }));
    await store.syncOrderKeysNow();
    expect(sceneWrites(vault)).toEqual(['E']);
    expect(timers.pending).toBe(0);
    timers.advance(ORDER_DEBOUNCE_MS * 2);
    await settle(store);
    expect(sceneWrites(vault)).toEqual(['E']);
  });

  it('writes nothing when no key is waiting, even if the keys on disk do not fit the binder', async () => {
    const { store, vault } = await openSeeded({ scenes: { A: 3072, B: 2048, C: null } });
    await store.syncOrderKeysNow();
    expect(vault.writes).toEqual([]);
  });
});
