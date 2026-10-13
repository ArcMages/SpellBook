// Project store: what happens when the vault changes underneath it (sync from
// another device, or the writer renaming and deleting notes by hand).

import { describe, expect, it } from 'vitest';
import { sceneRef } from '../src/core/binderTree';
import { RENAME_SETTLE_MS } from '../src/core/projectStore';
import { MemoryVault } from './memoryVault';
import {
  binderOnDisk,
  makeStore,
  openSeeded,
  picture,
  project,
  sceneBody,
  seedProject,
  settle,
  valueOf,
} from './storeHarness';

const threeScenes = { scenes: { A: 1024, B: 2048, C: 3072 } };

describe('reconciliation', () => {
  it('lists as Unfiled only notes under Manuscript/ that the binder does not list', async () => {
    const vault = new MemoryVault();
    vault.seed('Novel/Manuscript/Loose.md');
    vault.seed('Novel/Manuscript/Sub/Deeper/Loose too.md');
    vault.seed('Novel/Research/Trains.md');
    vault.seed('Novel/Timeline/Event.md');
    vault.seed('Novel/Stats/2026-10.md');
    vault.seed('Novel/To-do.md');
    vault.seed('Novel/Manuscript/picture.png');
    vault.seed('Manuscript/Not in the project.md');
    const { store } = await openSeeded({ binder: ['Manuscript/A.md', 'Research/Filed research.md'], scenes: { A: 1024 } }, vault);

    expect(project(store).unfiled).toEqual(['Manuscript/Loose.md', 'Manuscript/Sub/Deeper/Loose too.md']);
    // A binder entry may point anywhere inside the project.
    expect(project(store).missing).toEqual(['Research/Filed research.md']);
    expect(vault.writes).toEqual([]);
  });

  it('a note that appears under Manuscript/ becomes Unfiled, and nothing is written', async () => {
    const { store, vault, timers, changes } = await openSeeded(threeScenes);
    vault.external.create('Novel/Manuscript/Surprise.md', { body: 'hello' });
    await settle(store);
    expect(project(store).unfiled).toEqual(['Manuscript/Surprise.md']);
    expect(picture(store)).toBe('A B C');
    expect(changes).toEqual([{ type: 'project' }]);

    timers.advance(60_000);
    await settle(store);
    expect(vault.writes).toEqual([]);
  });

  it('a Missing scene stops being missing when its note arrives later', async () => {
    const { store, vault, timers, indexPath } = await openSeeded({
      binder: ['Manuscript/A.md', 'Manuscript/Late.md'],
      scenes: { A: 1024 },
    });
    expect(picture(store)).toBe('A Late?');
    expect(project(store).missing).toEqual(['Manuscript/Late.md']);

    vault.external.create('Novel/Manuscript/Late.md', { frontmatter: { order: 2048 }, body: 'arrived' });
    await settle(store);

    expect(picture(store)).toBe('A Late');
    expect(project(store).missing).toEqual([]);
    timers.advance(60_000);
    await settle(store);
    expect(vault.writes).toEqual([]);
    expect(binderOnDisk(vault, indexPath)).toEqual(['Manuscript/A.md', 'Manuscript/Late.md']);
  });

  it('notices new notes as soon as they are created, before Obsidian has indexed them', async () => {
    const { store, vault } = await openSeeded({ binder: ['Manuscript/A.md', 'Manuscript/Late.md'], scenes: { A: 1024 } });
    vault.holdMetadata();
    vault.external.create('Novel/Manuscript/Late.md', { body: 'arrived' });
    vault.external.create('Novel/Manuscript/Extra.md', { body: 'extra' });
    await settle(store);
    expect(picture(store)).toBe('A Late');
    expect(project(store).unfiled).toEqual(['Manuscript/Extra.md']);
    expect(vault.writes).toEqual([]);
  });

  it('matches a note to its entry even when the two use different Unicode spellings', async () => {
    const composed = 'Café'.normalize('NFC');
    const decomposed = composed.normalize('NFD');
    const vault = new MemoryVault();
    const indexPath = seedProject(vault, { binder: [`Manuscript/${composed}.md`] });
    vault.seed(`Novel/Manuscript/${decomposed}.md`, { body: 'x' });
    const { store } = makeStore(vault);
    await store.openProject(indexPath);

    expect(project(store).missing).toEqual([]);
    expect(project(store).unfiled).toEqual([]);
  });

  describe('an out-of-order sync: the index arrives before its scene notes', () => {
    it('keeps every entry, shows them as Missing until their notes arrive, and writes nothing', async () => {
      const { store, vault, timers } = makeStore();
      const binder = [
        'Manuscript/One.md',
        { folder: 'Part', id: 'f-part', children: ['Manuscript/Two.md'] },
        'Manuscript/Three.md',
      ];
      const deliver = vault.sync([
        { path: 'Novel/Novel.md', frontmatter: { spellbook: 'project', version: 1, title: 'Synced Novel', binder } },
        { path: 'Novel/Manuscript/Two.md', frontmatter: { order: 2048 }, body: 'two' },
        { path: 'Novel/Manuscript/Three.md', frontmatter: { order: 3072 }, body: 'three' },
        { path: 'Novel/Manuscript/One.md', frontmatter: { order: 1024 }, body: 'one' },
      ]);

      deliver(); // only the index is here
      expect(store.listProjects().map((p) => p.title)).toEqual(['Synced Novel']);
      valueOf(await store.openProject('Novel/Novel.md'));
      expect(picture(store)).toBe('One? Part[Two?] Three?');
      expect(project(store).missing).toEqual(['Manuscript/One.md', 'Manuscript/Two.md', 'Manuscript/Three.md']);
      expect(project(store).readOnly).toBe(false);

      // Plenty of time passes before the first note arrives: nothing is "tidied away".
      timers.advance(600_000);
      await settle(store);
      expect(binderOnDisk(vault, 'Novel/Novel.md')).toEqual(binder);

      deliver();
      await settle(store);
      expect(picture(store)).toBe('One? Part[Two] Three?');
      deliver();
      deliver();
      await settle(store);
      expect(picture(store)).toBe('One Part[Two] Three');
      expect(project(store).missing).toEqual([]);
      expect(project(store).unfiled).toEqual([]);

      timers.advance(600_000);
      await settle(store);
      expect(vault.writes).toEqual([]);
      expect(binderOnDisk(vault, 'Novel/Novel.md')).toEqual(binder);
    });

    it('shows notes that arrive before their index entry as Unfiled, then files them when the index arrives', async () => {
      const { store, vault, indexPath } = await openSeeded({ scenes: { A: 1024 } });
      vault.external.create('Novel/Manuscript/B.md', { body: 'b' });
      await settle(store);
      expect(project(store).unfiled).toEqual(['Manuscript/B.md']);

      vault.external.editFrontmatter(indexPath, (fm) => {
        fm['binder'] = ['Manuscript/B.md', 'Manuscript/A.md'];
      });
      await settle(store);
      expect(picture(store)).toBe('B A');
      expect(project(store).unfiled).toEqual([]);
      expect(vault.writes).toEqual([]);
    });
  });
});

describe('the index changes on another device', () => {
  it('reloads the binder and the title, announces it, and writes nothing', async () => {
    const { store, vault, timers, indexPath, changes } = await openSeeded(threeScenes);

    vault.external.editFrontmatter(indexPath, (fm) => {
      fm['binder'] = [{ folder: 'New part', id: 'f-new', children: ['Manuscript/C.md'] }, 'Manuscript/A.md'];
      fm['title'] = 'A Better Title';
    });
    await settle(store);

    expect(picture(store)).toBe('New part[C] A');
    expect(project(store).title).toBe('A Better Title');
    expect(project(store).unfiled).toEqual(['Manuscript/B.md']);
    expect(changes).toContainEqual({ type: 'project' });
    expect(changes).toContainEqual({ type: 'projects' }); // the title in the project list changed too

    timers.advance(60_000);
    await settle(store);
    expect(vault.writes).toEqual([]); // in particular: no order keys were rewritten
  });

  it('reloads as soon as the file changes, without waiting for Obsidian to index it', async () => {
    const { store, vault, indexPath } = await openSeeded(threeScenes);
    vault.holdMetadata(); // the vault reports "modified" but its index lags behind
    vault.external.editFrontmatter(indexPath, (fm) => {
      fm['binder'] = ['Manuscript/B.md'];
    });
    await settle(store);
    expect(picture(store)).toBe('B');
    expect(project(store).unfiled).toEqual(['Manuscript/A.md', 'Manuscript/C.md']);
  });

  it('announces nothing when the index is saved again without a change', async () => {
    const { store, vault, indexPath, changes } = await openSeeded(threeScenes);
    vault.external.write(indexPath, { body: 'The writer typed some notes into the index.' });
    vault.external.editFrontmatter(indexPath, (fm) => {
      fm['wordcount goal'] = 500; // a property the plugin does not know
    });
    await settle(store);
    expect(changes).toEqual([]);
    expect(picture(store)).toBe('A B C');
  });

  it('gives a new snapshot object with a higher revision each time something changes', async () => {
    const { store, vault, indexPath } = await openSeeded(threeScenes);
    const first = project(store);
    vault.external.editFrontmatter(indexPath, (fm) => {
      fm['binder'] = ['Manuscript/A.md'];
    });
    await settle(store);
    const second = project(store);
    expect(second).not.toBe(first);
    expect(second.revision).toBeGreaterThan(first.revision);
    expect(first.tree).toHaveLength(3); // the old snapshot was not changed underneath its reader
  });

  it('follows the vault when it says "look at everything again"', async () => {
    const { store, vault, indexPath } = await openSeeded(threeScenes);
    vault.external.editFrontmatter(
      indexPath,
      (fm) => {
        fm['binder'] = ['Manuscript/C.md'];
      },
      { silent: true },
    );
    expect(picture(store)).toBe('A B C');
    vault.refresh();
    await settle(store);
    expect(picture(store)).toBe('C');
  });
});

describe('a scene note is renamed or moved outside the plugin', () => {
  it('updates the index path with exactly one write, and never shows the scene as missing', async () => {
    const { store, vault, timers, indexPath } = await openSeeded(threeScenes);

    vault.external.rename('Novel/Manuscript/B.md', 'Novel/Manuscript/The Letter.md');
    await settle(store);

    expect(picture(store)).toBe('A The Letter C');
    expect(project(store).missing).toEqual([]);
    expect(project(store).unfiled).toEqual([]);

    timers.advance(RENAME_SETTLE_MS);
    await settle(store);
    expect(binderOnDisk(vault, indexPath)).toEqual(['Manuscript/A.md', 'Manuscript/The Letter.md', 'Manuscript/C.md']);
    expect(vault.writes).toEqual([{ op: 'updateFrontmatter', path: indexPath }]);
    expect(vault.bodyOf('Novel/Manuscript/The Letter.md')).toBe(sceneBody('B'));

    timers.advance(60_000);
    await settle(store);
    expect(vault.writes).toHaveLength(1);
    expect(picture(store)).toBe('A The Letter C');
  });

  it('follows a note moved into a subfolder or another project folder', async () => {
    const { store, vault, timers, indexPath } = await openSeeded(threeScenes);
    vault.external.rename('Novel/Manuscript/A.md', 'Novel/Manuscript/Act 1/A.md');
    vault.external.rename('Novel/Manuscript/C.md', 'Novel/Research/C.md');
    timers.advance(RENAME_SETTLE_MS);
    await settle(store);

    expect(binderOnDisk(vault, indexPath)).toEqual(['Manuscript/Act 1/A.md', 'Manuscript/B.md', 'Research/C.md']);
    expect(vault.writes).toEqual([{ op: 'updateFrontmatter', path: indexPath }]); // both in one write
    expect(project(store).missing).toEqual([]);
  });

  it('follows a note renamed twice in quick succession with one write', async () => {
    const { store, vault, timers, indexPath } = await openSeeded(threeScenes);
    vault.external.rename('Novel/Manuscript/B.md', 'Novel/Manuscript/Draft.md');
    vault.external.rename('Novel/Manuscript/Draft.md', 'Novel/Manuscript/Final.md');
    timers.advance(RENAME_SETTLE_MS);
    await settle(store);
    expect(binderOnDisk(vault, indexPath)).toEqual(['Manuscript/A.md', 'Manuscript/Final.md', 'Manuscript/C.md']);
    expect(vault.writes).toHaveLength(1);
  });

  it('collects renames that arrive a moment apart into one write', async () => {
    // A renamed folder can report its notes over several moments, not all at once.
    const { store, vault, timers, indexPath } = await openSeeded(threeScenes);
    for (const name of ['A', 'B', 'C']) {
      vault.external.rename(`Novel/Manuscript/${name}.md`, `Novel/Manuscript/Act/${name}.md`);
      timers.advance(RENAME_SETTLE_MS - 50);
      await settle(store);
    }
    expect(vault.writes).toEqual([]); // still waiting for the reports to stop
    expect(picture(store)).toBe('A B C');
    expect(project(store).missing).toEqual([]);

    timers.advance(50);
    await settle(store);
    expect(vault.writes).toEqual([{ op: 'updateFrontmatter', path: indexPath }]);
    expect(binderOnDisk(vault, indexPath)).toEqual(['Manuscript/Act/A.md', 'Manuscript/Act/B.md', 'Manuscript/Act/C.md']);
  });

  it('writes nothing when a note is renamed and then renamed back', async () => {
    const { store, vault, timers, indexPath } = await openSeeded(threeScenes);
    vault.external.rename('Novel/Manuscript/B.md', 'Novel/Manuscript/Temp.md');
    vault.external.rename('Novel/Manuscript/Temp.md', 'Novel/Manuscript/B.md');
    timers.advance(RENAME_SETTLE_MS);
    await settle(store);
    expect(vault.writes).toEqual([]);
    expect(binderOnDisk(vault, indexPath)).toEqual(['Manuscript/A.md', 'Manuscript/B.md', 'Manuscript/C.md']);
    expect(picture(store)).toBe('A B C');
  });

  it('follows two notes that swap names, so each entry stays with its own text', async () => {
    const { store, vault, timers, indexPath } = await openSeeded(threeScenes);
    // A script (or a sync) swaps the names of A and B by way of a spare name.
    vault.external.rename('Novel/Manuscript/A.md', 'Novel/Manuscript/Spare.md');
    vault.external.rename('Novel/Manuscript/B.md', 'Novel/Manuscript/A.md');
    vault.external.rename('Novel/Manuscript/Spare.md', 'Novel/Manuscript/B.md');
    await settle(store);

    // Shown correctly at once, before anything is saved: the first scene is now called B.
    expect(picture(store)).toBe('B A C');
    expect(project(store).missing).toEqual([]);
    expect(project(store).unfiled).toEqual([]);

    timers.advance(RENAME_SETTLE_MS);
    await settle(store);
    expect(binderOnDisk(vault, indexPath)).toEqual(['Manuscript/B.md', 'Manuscript/A.md', 'Manuscript/C.md']);
    expect(vault.writes).toEqual([{ op: 'updateFrontmatter', path: indexPath }]);
    // The manuscript still reads in the same order: the text that came first comes first.
    expect(vault.bodyOf('Novel/Manuscript/B.md')).toBe(sceneBody('A'));
    expect(vault.bodyOf('Novel/Manuscript/A.md')).toBe(sceneBody('B'));
    expect(['B', 'A', 'C'].map((name) => vault.frontmatterOf(`Novel/Manuscript/${name}.md`)?.['order'])).toEqual([1024, 2048, 3072]);

    timers.advance(60_000);
    await settle(store);
    expect(vault.writes).toHaveLength(1);
    expect(picture(store)).toBe('B A C');
  });

  it('follows a note into a name that another scene has only just left', async () => {
    const { store, vault, timers, indexPath } = await openSeeded(threeScenes);
    vault.external.rename('Novel/Manuscript/A.md', 'Novel/Manuscript/Spare.md');
    vault.external.rename('Novel/Manuscript/B.md', 'Novel/Manuscript/Bee.md');
    vault.external.rename('Novel/Manuscript/Spare.md', 'Novel/Manuscript/B.md');
    timers.advance(RENAME_SETTLE_MS);
    await settle(store);

    expect(binderOnDisk(vault, indexPath)).toEqual(['Manuscript/B.md', 'Manuscript/Bee.md', 'Manuscript/C.md']);
    expect(vault.writes).toEqual([{ op: 'updateFrontmatter', path: indexPath }]);
    expect(project(store).missing).toEqual([]);
    expect(project(store).unfiled).toEqual([]);
  });

  for (const order of ['folder-first', 'files-first'] as const) {
    it(`follows every note of a renamed folder with one write (events ${order})`, async () => {
      const vault = new MemoryVault();
      vault.folderRenameOrder = order;
      for (const name of ['B', 'C', 'D']) vault.seed(`Novel/Manuscript/Draft/${name}.md`, { body: sceneBody(name) });
      const { store, timers, indexPath } = await openSeeded(
        {
          binder: ['Manuscript/A.md', 'Manuscript/Draft/B.md', 'Manuscript/Draft/C.md', 'Manuscript/Draft/D.md'],
          scenes: { A: 1024 },
        },
        vault,
      );

      vault.external.rename('Novel/Manuscript/Draft', 'Novel/Manuscript/Act One');
      await settle(store);
      expect(project(store).missing).toEqual([]);
      timers.advance(RENAME_SETTLE_MS);
      await settle(store);

      expect(binderOnDisk(vault, indexPath)).toEqual([
        'Manuscript/A.md',
        'Manuscript/Act One/B.md',
        'Manuscript/Act One/C.md',
        'Manuscript/Act One/D.md',
      ]);
      expect(vault.writes).toEqual([{ op: 'updateFrontmatter', path: indexPath }]);
      expect(project(store).unfiled).toEqual([]);
    });
  }

  it('shows a note moved out of the project as Missing and keeps its entry', async () => {
    const vault = new MemoryVault().seedFolder('Elsewhere');
    const { store, timers, indexPath } = await openSeeded(threeScenes, vault);

    vault.external.rename('Novel/Manuscript/B.md', 'Elsewhere/B.md');
    timers.advance(RENAME_SETTLE_MS);
    await settle(store);
    expect(picture(store)).toBe('A B? C');
    expect(vault.writes).toEqual([]);
    expect(binderOnDisk(vault, indexPath)).toEqual(['Manuscript/A.md', 'Manuscript/B.md', 'Manuscript/C.md']);

    // and it is simply back when the note is moved back
    vault.external.rename('Elsewhere/B.md', 'Novel/Manuscript/B.md');
    timers.advance(RENAME_SETTLE_MS);
    await settle(store);
    expect(picture(store)).toBe('A B C');
    expect(vault.writes).toEqual([]);
  });

  it('takes no interest in files that are not notes', async () => {
    const vault = new MemoryVault().seed('Novel/Manuscript/cover.png');
    const { store, timers } = await openSeeded(threeScenes, vault);
    vault.external.rename('Novel/Manuscript/cover.png', 'Novel/Manuscript/art.png');
    expect(timers.pending).toBe(0); // no index update was even scheduled
    await settle(store);
    expect(vault.writes).toEqual([]);
    expect(picture(store)).toBe('A B C');
  });

  it('does not touch the index when an unfiled note is renamed', async () => {
    const { store, vault, timers } = await openSeeded({ binder: ['Manuscript/A.md'], scenes: { A: 1024, Loose: null } });
    vault.external.rename('Novel/Manuscript/Loose.md', 'Novel/Manuscript/Still loose.md');
    timers.advance(RENAME_SETTLE_MS);
    await settle(store);
    expect(vault.writes).toEqual([]);
    expect(project(store).unfiled).toEqual(['Manuscript/Still loose.md']);
  });

  it('does not list a path twice when a note is renamed onto a name the binder already lists', async () => {
    const { store, vault, timers, indexPath } = await openSeeded({
      binder: ['Manuscript/A.md', 'Manuscript/Ghost.md'],
      scenes: { A: 1024 },
    });
    vault.external.rename('Novel/Manuscript/A.md', 'Novel/Manuscript/Ghost.md');
    timers.advance(RENAME_SETTLE_MS);
    await settle(store);
    expect(binderOnDisk(vault, indexPath)).toEqual(['Manuscript/A.md', 'Manuscript/Ghost.md']);
    expect(picture(store)).toBe('A? Ghost');
    expect(vault.writes).toEqual([]);
  });
});

describe('a scene note is deleted outside the plugin', () => {
  it('shows the entry as Missing and keeps it', async () => {
    const { store, vault, timers, indexPath, changes } = await openSeeded(threeScenes);

    vault.external.delete('Novel/Manuscript/B.md');
    await settle(store);

    expect(picture(store)).toBe('A B? C');
    expect(project(store).missing).toEqual(['Manuscript/B.md']);
    expect(changes).toEqual([{ type: 'project' }]);
    timers.advance(60_000);
    await settle(store);
    expect(vault.writes).toEqual([]);
    expect(binderOnDisk(vault, indexPath)).toEqual(['Manuscript/A.md', 'Manuscript/B.md', 'Manuscript/C.md']);
  });

  it('shows every scene as Missing when the Manuscript folder is deleted', async () => {
    const { store, vault } = await openSeeded(threeScenes);
    vault.external.delete('Novel/Manuscript');
    await settle(store);
    expect(picture(store)).toBe('A? B? C?');
    expect(vault.writes).toEqual([]);
  });
});

describe('the index note or the project folder is renamed', () => {
  it('tells listeners that the open project moved, and where it was', async () => {
    const { store, vault, changes } = await openSeeded(threeScenes);
    vault.external.rename('Novel', 'Saga');
    await settle(store);
    expect(project(store).indexPath).toBe('Saga/Novel.md');
    expect(changes.filter((change) => change.type === 'project')).toEqual([
      { type: 'project', movedFrom: 'Novel/Novel.md' },
    ]);

    changes.length = 0;
    vault.external.rename('Saga/Novel.md', 'Saga/Saga.md');
    await settle(store);
    expect(changes.filter((change) => change.type === 'project')).toEqual([
      { type: 'project', movedFrom: 'Saga/Novel.md' },
    ]);

    // An ordinary change to the same project says nothing of the kind ...
    changes.length = 0;
    valueOf(await store.addFolder('Part'));
    expect(changes).toEqual([{ type: 'project' }]);
  });

  it('does not take another project that is opened for the old one moved', async () => {
    const vault = new MemoryVault();
    seedProject(vault, { folder: 'Other', title: 'Other Book', scenes: { Elsewhere: 1024 } });
    const { store, changes } = await openSeeded(threeScenes, vault);
    valueOf(await store.openProject('Other/Other.md'));
    expect(changes.filter((change) => change.type === 'project')).toEqual([{ type: 'project' }]);
  });

  it('follows a renamed index note and keeps working', async () => {
    const { store, vault, timers } = await openSeeded(threeScenes);

    vault.external.rename('Novel/Novel.md', 'Novel/Book index.md');
    timers.advance(RENAME_SETTLE_MS);
    await settle(store);

    expect(project(store)).toMatchObject({ indexPath: 'Novel/Book index.md', folder: 'Novel', title: 'My Novel' });
    expect(picture(store)).toBe('A B C');
    expect(vault.writes).toEqual([]);

    valueOf(await store.addFolder('Part'));
    expect(vault.writes).toEqual([{ op: 'updateFrontmatter', path: 'Novel/Book index.md' }]);
    expect(picture(store)).toBe('A B C Part[]');
  });

  it('takes the new file name as the title when the index has no title property', async () => {
    const { store, vault } = await openSeeded({ title: null, scenes: { A: 1024 } });
    expect(project(store).title).toBe('Novel');
    vault.external.rename('Novel/Novel.md', 'Novel/The Long Night.md');
    await settle(store);
    expect(project(store).title).toBe('The Long Night');
    expect(store.listProjects().map((p) => p.title)).toEqual(['The Long Night']);
  });

  for (const order of ['folder-first', 'files-first'] as const) {
    it(`keeps relative paths working when the project folder is renamed (events ${order})`, async () => {
      const vault = new MemoryVault();
      vault.folderRenameOrder = order;
      const { store, timers } = await openSeeded(
        {
          binder: ['Manuscript/A.md', { folder: 'Part', id: 'f-part', children: ['Manuscript/B.md'] }, 'Manuscript/Ghost.md'],
          scenes: { A: 1024, B: 2048, Loose: null },
        },
        vault,
      );
      const binderBefore = binderOnDisk(vault, 'Novel/Novel.md');

      vault.external.rename('Novel', 'Saga');
      await settle(store);
      timers.advance(RENAME_SETTLE_MS * 4);
      await settle(store);

      expect(project(store)).toMatchObject({ indexPath: 'Saga/Novel.md', folder: 'Saga', title: 'My Novel' });
      expect(picture(store)).toBe('A Part[B] Ghost?');
      expect(project(store).unfiled).toEqual(['Manuscript/Loose.md']);
      // The index needed no change at all: its paths are relative to the folder.
      expect(vault.writes).toEqual([]);
      expect(binderOnDisk(vault, 'Saga/Novel.md')).toEqual(binderBefore);
      expect(store.listProjects()).toEqual([{ indexPath: 'Saga/Novel.md', folder: 'Saga', title: 'My Novel' }]);

      // and everything keeps working in the new place
      expect(valueOf(await store.addScene('New')).path).toBe('Manuscript/New.md');
      expect(vault.has('Saga/Manuscript/New.md')).toBe(true);
      expect(valueOf(await store.renameScene('Manuscript/B.md', 'Bee')).path).toBe('Manuscript/Bee.md');
      expect(vault.has('Saga/Manuscript/Bee.md')).toBe(true);
      expect(picture(store)).toBe('A Part[Bee] Ghost? New');
    });

    it(`keeps working when a folder above the project is renamed (events ${order})`, async () => {
      const vault = new MemoryVault();
      vault.folderRenameOrder = order;
      const { store, timers } = await openSeeded({ folder: 'Writing/Novel', scenes: { A: 1024, B: 2048 } }, vault);

      vault.external.rename('Writing', 'Books');
      timers.advance(RENAME_SETTLE_MS * 4);
      await settle(store);

      expect(project(store)).toMatchObject({ indexPath: 'Books/Novel/Novel.md', folder: 'Books/Novel' });
      expect(picture(store)).toBe('A B');
      expect(vault.writes).toEqual([]);
      valueOf(await store.moveNode(sceneRef('Manuscript/B.md'), { at: 'start', parentId: null }));
      expect(binderOnDisk(vault, 'Books/Novel/Novel.md')).toEqual(['Manuscript/B.md', 'Manuscript/A.md']);
    });
  }

  it('copes when the notes of a renamed project folder are reported before its index', async () => {
    // Seed the scenes first, so that with "files-first" they are reported before the index note.
    const vault = new MemoryVault();
    vault.folderRenameOrder = 'files-first';
    vault.seed('Novel/Manuscript/A.md', { frontmatter: { order: 1024 } });
    vault.seed('Novel/Manuscript/B.md', { frontmatter: { order: 2048 } });
    vault.seed('Novel/Novel.md', {
      frontmatter: { spellbook: 'project', version: 1, binder: ['Manuscript/A.md', 'Manuscript/B.md'] },
    });
    const { store, timers } = makeStore(vault);
    valueOf(await store.openProject('Novel/Novel.md'));
    vault.clearWrites();

    vault.external.rename('Novel', 'Saga');
    timers.advance(RENAME_SETTLE_MS * 4);
    await settle(store);

    expect(project(store)).toMatchObject({ indexPath: 'Saga/Novel.md', folder: 'Saga' });
    expect(picture(store)).toBe('A B');
    expect(vault.writes).toEqual([]);
    expect(binderOnDisk(vault, 'Saga/Novel.md')).toEqual(['Manuscript/A.md', 'Manuscript/B.md']);
  });

  it('follows the index note when only it is moved to another folder', async () => {
    const vault = new MemoryVault().seedFolder('Archive');
    const { store } = await openSeeded(threeScenes, vault);

    vault.external.rename('Novel/Novel.md', 'Archive/Novel.md');
    await settle(store);
    // The project is wherever its index is; the scenes did not come along.
    expect(project(store)).toMatchObject({ indexPath: 'Archive/Novel.md', folder: 'Archive' });
    expect(picture(store)).toBe('A? B? C?');
    expect(vault.writes).toEqual([]);

    vault.external.rename('Archive/Novel.md', 'Novel/Novel.md');
    await settle(store);
    expect(picture(store)).toBe('A B C');
    expect(vault.writes).toEqual([]);
  });
});

describe('the project goes away', () => {
  it('closes the project when its index note is deleted', async () => {
    const { store, vault, changes } = await openSeeded(threeScenes);
    vault.external.delete('Novel/Novel.md');
    await settle(store);
    expect(store.project).toBeNull();
    expect(store.listProjects()).toEqual([]);
    expect(changes).toContainEqual({ type: 'project' });
    expect(changes).toContainEqual({ type: 'projects' });
    expect(vault.writes).toEqual([]);
  });

  it('closes the project when its whole folder is deleted', async () => {
    const { store, vault } = await openSeeded(threeScenes);
    vault.external.delete('Novel');
    await settle(store);
    expect(store.project).toBeNull();
    expect(await store.addFolder('X')).toMatchObject({ status: 'refused', reason: 'no-project' });
  });

  it('closes the project when the index note stops being a project index', async () => {
    const { store, vault, indexPath } = await openSeeded(threeScenes);
    vault.external.editFrontmatter(indexPath, (fm) => {
      delete fm['spellbook'];
    });
    await settle(store);
    expect(store.project).toBeNull();
    expect(store.listProjects()).toEqual([]);
    expect(vault.writes).toEqual([]);
  });
});

describe('dispose', () => {
  it('stops listening, cancels what was scheduled, and writes nothing afterwards', async () => {
    const { store, vault, timers, changes } = await openSeeded(threeScenes);
    valueOf(await store.moveNode(sceneRef('Manuscript/C.md'), { at: 'start', parentId: null })); // schedules order keys
    vault.external.rename('Novel/Manuscript/B.md', 'Novel/Manuscript/Bee.md'); // schedules an index update
    expect(timers.pending).toBeGreaterThan(0);
    vault.clearWrites();
    changes.length = 0;

    store.dispose();

    expect(timers.pending).toBe(0);
    vault.external.delete('Novel/Manuscript/A.md');
    vault.external.create('Other/Other.md', { frontmatter: { spellbook: 'project' } });
    timers.advance(60_000);
    await settle(store);
    expect(vault.writes).toEqual([]);
    expect(changes).toEqual([]);
  });
});
