// Project store: the "order" property of scene notes.

import { describe, expect, it } from 'vitest';
import { flattenScenes, folderRef, sceneRef } from '../src/core/binderTree';
import { isStrictlyIncreasing } from '../src/core/orderKeys';
import { parseProjectIndex } from '../src/core/projectIndex';
import { ORDER_DEBOUNCE_MS } from '../src/core/projectStore';
import type { Frontmatter } from '../src/core/types';
import type { MemoryVault } from './memoryVault';
import { openSeeded, picture, sceneBody, settle, valueOf } from './storeHarness';

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
});
