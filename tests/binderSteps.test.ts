// "Move up" and "Move down": the step itself (a calculation on the tree), the
// store intent that carries it out against the index on disk, and the guard
// that keeps an intent from landing in a project it was not meant for.

import { describe, expect, it } from 'vitest';
import { folderRef, moveNode, sceneRef, stepPlacement } from '../src/core/binderTree';
import type { StepDirection } from '../src/core/binderTree';
import { ORDER_DEBOUNCE_MS } from '../src/core/projectStore';
import type { Binder, BinderNode, FolderNode, NodeRef } from '../src/core/types';
import { MemoryVault } from './memoryVault';
import { binderOnDisk, makeStore, openSeeded, picture, seedProject, settle, valueOf } from './storeHarness';

const scene = (path: string): BinderNode => ({ kind: 'scene', path });
const folder = (id: string, children: BinderNode[] = []): FolderNode => ({ kind: 'folder', id, name: id, children });

/**
 * a
 * p1 [ b, p1a [ c ], d ]
 * e
 * p2 [ ]
 */
function sample(): Binder {
  return [scene('a.md'), folder('p1', [scene('b.md'), folder('p1a', [scene('c.md')]), scene('d.md')]), scene('e.md'), folder('p2')];
}

/** A compact picture of a tree, e.g. "a p1[b p1a[c] d] e p2[]". */
function draw(binder: Binder): string {
  return binder
    .map((node) => (node.kind === 'scene' ? node.path.replace(/\.md$/, '') : `${node.id}[${draw(node.children)}]`))
    .join(' ');
}

/** The tree after one step, or "stays" when there is nowhere to go. */
function step(binder: Binder, ref: NodeRef, direction: StepDirection): string {
  const placement = stepPlacement(binder, ref, direction);
  if (!placement) return 'stays';
  const result = moveNode(binder, ref, placement);
  if (!result.ok) throw new Error(`the step could not be made: ${result.reason}`);
  return draw(result.binder);
}

describe('stepPlacement', () => {
  it('moves a scene past the sibling next to it', () => {
    expect(step(sample(), sceneRef('e.md'), 'up')).toBe('a e p1[b p1a[c] d] p2[]');
    expect(step(sample(), sceneRef('a.md'), 'down')).toBe('p1[b p1a[c] d] a e p2[]');
    expect(step(sample(), sceneRef('d.md'), 'up')).toBe('a p1[b d p1a[c]] e p2[]');
    expect(step(sample(), sceneRef('b.md'), 'down')).toBe('a p1[p1a[c] b d] e p2[]');
  });

  it('steps over a folder next to it, not into it', () => {
    expect(step(sample(), sceneRef('e.md'), 'down')).toBe('a p1[b p1a[c] d] p2[] e');
    expect(step(sample(), sceneRef('a.md'), 'down')).not.toContain('p1[a');
  });

  it('moves a scene at the top edge of its folder out, to just before the folder', () => {
    expect(step(sample(), sceneRef('b.md'), 'up')).toBe('a b p1[p1a[c] d] e p2[]');
    expect(step(sample(), sceneRef('c.md'), 'up')).toBe('a p1[b c p1a[] d] e p2[]');
  });

  it('moves a scene at the bottom edge of its folder out, to just after the folder', () => {
    expect(step(sample(), sceneRef('d.md'), 'down')).toBe('a p1[b p1a[c]] d e p2[]');
    expect(step(sample(), sceneRef('c.md'), 'down')).toBe('a p1[b p1a[] c d] e p2[]');
  });

  it('moves folders the same way, with everything in them', () => {
    expect(step(sample(), folderRef('p1'), 'up')).toBe('p1[b p1a[c] d] a e p2[]');
    expect(step(sample(), folderRef('p1'), 'down')).toBe('a e p1[b p1a[c] d] p2[]');
    expect(step(sample(), folderRef('p1a'), 'up')).toBe('a p1[p1a[c] b d] e p2[]');
    // At the edge of the folder it is in, it moves out of it.
    const tree: Binder = [folder('outer', [folder('inner', [scene('x.md')])]), scene('y.md')];
    expect(step(tree, folderRef('inner'), 'up')).toBe('inner[x] outer[] y');
    expect(step(tree, folderRef('inner'), 'down')).toBe('outer[] inner[x] y');
  });

  it('has nowhere to go from the first place of the top level, or from the last', () => {
    expect(step(sample(), sceneRef('a.md'), 'up')).toBe('stays');
    expect(step(sample(), folderRef('p2'), 'down')).toBe('stays');
    expect(step([scene('only.md')], sceneRef('only.md'), 'up')).toBe('stays');
    expect(step([scene('only.md')], sceneRef('only.md'), 'down')).toBe('stays');
  });

  it('gives nothing for something that is not in the tree', () => {
    expect(stepPlacement(sample(), sceneRef('nope.md'), 'up')).toBeNull();
    expect(stepPlacement(sample(), folderRef('nope'), 'down')).toBeNull();
    expect(stepPlacement([], sceneRef('a.md'), 'down')).toBeNull();
  });

  it('never changes the tree it is given', () => {
    const tree = sample();
    const before = JSON.stringify(tree);
    stepPlacement(tree, sceneRef('b.md'), 'up');
    stepPlacement(tree, folderRef('p1'), 'down');
    expect(JSON.stringify(tree)).toBe(before);
  });

  it('repeated steps walk a scene from the end of the manuscript to its start, and back', () => {
    let tree = sample();
    const seen: string[] = [];
    for (let turn = 0; turn < 20; turn++) {
      const placement = stepPlacement(tree, sceneRef('e.md'), 'up');
      if (!placement) break;
      const result = moveNode(tree, sceneRef('e.md'), placement);
      if (!result.ok) throw new Error(result.reason);
      tree = result.binder;
      seen.push(draw(tree));
    }
    expect(seen).toEqual(['a e p1[b p1a[c] d] p2[]', 'e a p1[b p1a[c] d] p2[]']);
    for (let turn = 0; turn < 20; turn++) {
      const placement = stepPlacement(tree, sceneRef('e.md'), 'down');
      if (!placement) break;
      const result = moveNode(tree, sceneRef('e.md'), placement);
      if (!result.ok) throw new Error(result.reason);
      tree = result.binder;
    }
    expect(draw(tree)).toBe('a p1[b p1a[c] d] p2[] e');
  });
});

/** A project with scenes A B C D, B and C inside the folder "Part" (f-part). */
const withFolder = {
  binder: ['Manuscript/A.md', { folder: 'Part', id: 'f-part', children: ['Manuscript/B.md', 'Manuscript/C.md'] }, 'Manuscript/D.md'],
  scenes: { A: 1024, B: 2048, C: 3072, D: 4096 },
};

describe('stepNode', () => {
  it('moves a scene one step, in one write of the index', async () => {
    const { store, vault, indexPath, changes } = await openSeeded(withFolder);
    expect(await store.stepNode(sceneRef('Manuscript/C.md'), 'up')).toEqual({ status: 'done', value: undefined });
    expect(picture(store)).toBe('A Part[C B] D');
    expect(vault.writes).toEqual([{ op: 'updateFrontmatter', path: indexPath }]);
    expect(changes).toEqual([{ type: 'project' }]);
  });

  it('moves a scene out of its folder at the edge, and a folder past its neighbours', async () => {
    const { store } = await openSeeded(withFolder);
    valueOf(await store.stepNode(sceneRef('Manuscript/B.md'), 'up'));
    expect(picture(store)).toBe('A B Part[C] D');
    valueOf(await store.stepNode(sceneRef('Manuscript/C.md'), 'down'));
    expect(picture(store)).toBe('A B Part[] C D');
    valueOf(await store.stepNode(folderRef('f-part'), 'up'));
    expect(picture(store)).toBe('A Part[] B C D');
    valueOf(await store.stepNode(folderRef('f-part'), 'down'));
    valueOf(await store.stepNode(folderRef('f-part'), 'down'));
    expect(picture(store)).toBe('A B C Part[] D');
  });

  it('changes nothing, and says so, at the top and at the end', async () => {
    const { store, vault } = await openSeeded(withFolder);
    expect(await store.stepNode(sceneRef('Manuscript/A.md'), 'up')).toEqual({
      status: 'noop',
      reason: 'unchanged',
      message: 'It is already at the top.',
    });
    expect(await store.stepNode(sceneRef('Manuscript/D.md'), 'down')).toEqual({
      status: 'noop',
      reason: 'unchanged',
      message: 'It is already at the end.',
    });
    expect(vault.writes).toEqual([]);
  });

  it('reports a scene that is no longer in the binder', async () => {
    const { store, vault } = await openSeeded(withFolder);
    const result = await store.stepNode(sceneRef('Manuscript/Gone.md'), 'up');
    expect(result).toMatchObject({ status: 'noop', reason: 'not-found' });
    expect(vault.writes).toEqual([]);
  });

  it('works the step out against the index as it is on disk, not as it was last read', async () => {
    const { store, vault, indexPath } = await openSeeded(withFolder);
    // Another device moved C to the top; this device has not noticed yet.
    vault.external.editFrontmatter(
      indexPath,
      (frontmatter) => {
        frontmatter['binder'] = ['Manuscript/C.md', 'Manuscript/A.md', { folder: 'Part', id: 'f-part', children: ['Manuscript/B.md'] }, 'Manuscript/D.md'];
      },
      { silent: true },
    );
    // "Move C down" means one step from where C really is: past A, not past the end of the folder.
    valueOf(await store.stepNode(sceneRef('Manuscript/C.md'), 'down'));
    expect(binderOnDisk(vault, indexPath)).toEqual([
      'Manuscript/A.md',
      'Manuscript/C.md',
      { folder: 'Part', id: 'f-part', children: ['Manuscript/B.md'] },
      'Manuscript/D.md',
    ]);
    expect(picture(store)).toBe('A C Part[B] D');
  });

  it('gives the moved scene, and only that one, a new order key', async () => {
    const { store, vault, timers } = await openSeeded(withFolder);
    valueOf(await store.stepNode(sceneRef('Manuscript/D.md'), 'up'));
    expect(picture(store)).toBe('A D Part[B C]');
    vault.clearWrites();
    timers.advance(ORDER_DEBOUNCE_MS);
    await settle(store);
    expect(vault.writes).toEqual([{ op: 'updateFrontmatter', path: 'Novel/Manuscript/D.md' }]);
    expect(vault.frontmatterOf('Novel/Manuscript/D.md')?.['order']).toBe(1536); // between A (1024) and B (2048)
  });

  it('gives a new key to every scene of a folder that was moved, when they no longer fit', async () => {
    const { store, vault, timers } = await openSeeded(withFolder);
    valueOf(await store.stepNode(folderRef('f-part'), 'up'));
    expect(picture(store)).toBe('Part[B C] A D');
    vault.clearWrites();
    timers.advance(ORDER_DEBOUNCE_MS);
    await settle(store);
    const orders = ['B', 'C', 'A', 'D'].map((name) => vault.frontmatterOf(`Novel/Manuscript/${name}.md`)?.['order'] as number);
    expect([...orders].sort((a, b) => a - b)).toEqual(orders); // rising in manuscript order
    expect(new Set(orders).size).toBe(4);
    // The scenes that did not move kept their keys.
    expect(vault.frontmatterOf('Novel/Manuscript/D.md')?.['order']).toBe(4096);
    expect(vault.writesTo('Novel/Manuscript/D.md')).toEqual([]);
  });

  it('is refused in a read-only project', async () => {
    const { store, vault } = await openSeeded({ binder: { not: 'a list' }, scenes: { A: 1024 } });
    const result = await store.stepNode(sceneRef('Manuscript/A.md'), 'down');
    expect(result).toMatchObject({ status: 'refused', reason: 'read-only' });
    expect(vault.writes).toEqual([]);
  });
});

describe('an intent meant for one project', () => {
  /** Two projects that both have a scene "Opening"; the first is open. */
  async function twoProjects() {
    const vault = new MemoryVault();
    const first = seedProject(vault, { folder: 'First', title: 'First', scenes: { Opening: 1024, Second: 2048 } });
    const other = seedProject(vault, { folder: 'Other', title: 'Other', scenes: { Opening: 1024, Second: 2048 } });
    const harness = makeStore(vault);
    valueOf(await harness.store.openProject(first));
    vault.clearWrites();
    return { ...harness, first, other };
  }

  it('is carried out while that project is the open one', async () => {
    const { store, first } = await twoProjects();
    valueOf(await store.stepNode(sceneRef('Manuscript/Second.md'), 'up', first));
    expect(picture(store)).toBe('Second Opening');
    valueOf(await store.renameScene('Manuscript/Opening.md', 'Prologue', first));
    valueOf(await store.addFolder('Part', undefined, first));
    valueOf(await store.addScene('New', undefined, first));
    expect(picture(store)).toBe('Second Prologue Part[] New');
  });

  it('is refused, and writes nothing, when another project has been opened since', async () => {
    const { store, vault, first, other } = await twoProjects();
    valueOf(await store.openProject(other));
    vault.clearWrites();

    const refusal = { status: 'refused', reason: 'other-project' };
    expect(await store.deleteScene('Manuscript/Opening.md', first)).toMatchObject(refusal);
    expect(await store.renameScene('Manuscript/Opening.md', 'Prologue', first)).toMatchObject(refusal);
    expect(await store.addScene('New', undefined, first)).toMatchObject(refusal);
    expect(await store.addFolder('Part', undefined, first)).toMatchObject(refusal);
    expect(await store.renameFolder('f-x', 'Part', first)).toMatchObject(refusal);
    expect(await store.moveNode(sceneRef('Manuscript/Second.md'), { at: 'start', parentId: null }, first)).toMatchObject(refusal);
    expect(await store.stepNode(sceneRef('Manuscript/Second.md'), 'up', first)).toMatchObject(refusal);
    expect(await store.removeFolder('f-x', first)).toMatchObject(refusal);
    expect(await store.removeMissingEntry('Manuscript/Opening.md', first)).toMatchObject(refusal);
    expect(await store.addUnfiledToBinder('Manuscript/Opening.md', undefined, first)).toMatchObject(refusal);

    expect(vault.writes).toEqual([]);
    expect(vault.trashed).toEqual([]);
    expect(vault.has('Other/Manuscript/Opening.md')).toBe(true);
    expect(picture(store)).toBe('Opening Second'); // the other project, untouched
  });

  it('is refused even when the other project was opened after the intent was asked for but before its turn', async () => {
    const { store, vault, first, other } = await twoProjects();
    // Both are asked for in the same instant; the store takes them one at a time, in order.
    const opening = store.openProject(other);
    const deleting = store.deleteScene('Manuscript/Opening.md', first);
    valueOf(await opening);
    expect(await deleting).toMatchObject({ status: 'refused', reason: 'other-project' });
    expect(vault.trashed).toEqual([]);
    expect(vault.has('First/Manuscript/Opening.md')).toBe(true);
    expect(vault.has('Other/Manuscript/Opening.md')).toBe(true);
  });

  it('says in plain words what happened', async () => {
    const { store, first, other } = await twoProjects();
    valueOf(await store.openProject(other));
    const result = await store.deleteScene('Manuscript/Opening.md', first);
    expect(result.status === 'refused' && result.message).toMatch(/Another project was opened/);
    expect(result.status === 'refused' && result.message).toMatch(/nothing was changed/);
  });

  it('is refused when no project is open at all', async () => {
    const { store, vault, first } = await twoProjects();
    await store.closeProject();
    expect(await store.deleteScene('Manuscript/Opening.md', first)).toMatchObject({ status: 'refused', reason: 'other-project' });
    expect(vault.trashed).toEqual([]);
  });
});
