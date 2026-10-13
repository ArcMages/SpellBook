// Project store: the one note it writes for AI assistants.
//
// updateHelperNote takes no path. It writes "AI helper/Spellbook for AI
// assistants.md" in the open project and nothing else, and the caller's
// `change` decides, against the note as it is on disk, whether to write.

import { describe, expect, it } from 'vitest';
import { AI_HELPER_FILE, AI_HELPER_FOLDER } from '../src/core/projectLayout';
import { MemoryVault } from './memoryVault';
import { makeStore, openSeeded, picture, sceneBody, seedProject, settle, valueOf } from './storeHarness';

const NOTE = `Novel/${AI_HELPER_FOLDER}/${AI_HELPER_FILE}`;
const scenes = { scenes: { A: 1024, B: 2048 } };

describe('updateHelperNote', () => {
  it('makes the folder and the note when they are missing, and says that it was created', async () => {
    const { store, vault } = await openSeeded(scenes);
    const seen: Array<string | null> = [];
    const result = await store.updateHelperNote((current) => {
      seen.push(current);
      return 'The reference.\n';
    });
    expect(valueOf(result)).toEqual({ created: true });
    expect(seen).toEqual([null]);
    expect(vault.textOf(NOTE)).toBe('The reference.\n');
    expect(vault.writes).toEqual([
      { op: 'createFolder', path: `Novel/${AI_HELPER_FOLDER}` },
      { op: 'updateText', path: NOTE },
    ]);
  });

  it('hands over the note as it is on disk, and writes nothing when the answer is null or the same text', async () => {
    const vault = new MemoryVault().seed(NOTE, { body: 'What is there.\n' });
    const { store } = await openSeeded(scenes, vault);
    const seen: Array<string | null> = [];
    const kept = await store.updateHelperNote((current) => {
      seen.push(current);
      return null;
    });
    expect(kept).toMatchObject({ status: 'noop', reason: 'unchanged' });
    expect(await store.updateHelperNote((current) => current)).toMatchObject({ status: 'noop' });
    expect(seen).toEqual(['What is there.\n']);
    expect(vault.writes).toEqual([]);

    expect(valueOf(await store.updateHelperNote(() => 'New.\n'))).toEqual({ created: false });
    expect(vault.textOf(NOTE)).toBe('New.\n');
  });

  it('changes no scene, no binder and no other note', async () => {
    const { store, vault, indexPath } = await openSeeded(scenes);
    const before = vault.paths().map((path) => [path, vault.textOf(path)]);
    valueOf(await store.updateHelperNote(() => 'The reference.\n'));
    await settle(store);
    expect(vault.paths().filter((path) => path !== NOTE).map((path) => [path, vault.textOf(path)])).toEqual(before);
    expect(vault.bodyOf('Novel/Manuscript/A.md')).toBe(sceneBody('A'));
    expect(picture(store)).toBe('A B');
    expect(store.project?.unfiled).toEqual([]);
    expect(store.project?.indexPath).toBe(indexPath);
  });

  it('is refused when no project is open, for another project than the one meant, and for a read-only project', async () => {
    const empty = makeStore(new MemoryVault());
    expect(await empty.store.updateHelperNote(() => 'x')).toMatchObject({ status: 'refused', reason: 'no-project' });

    const { store, vault } = await openSeeded(scenes);
    expect(await store.updateHelperNote(() => 'x', 'Other/Other.md')).toMatchObject({ status: 'refused', reason: 'other-project' });
    expect(vault.writes).toEqual([]);

    const broken = new MemoryVault();
    const index = seedProject(broken, { binder: 'not a list' });
    const second = makeStore(broken);
    await second.store.openProject(index);
    expect(await second.store.updateHelperNote(() => 'x')).toMatchObject({ status: 'refused', reason: 'read-only' });
    expect(broken.has(NOTE)).toBe(false);
  });

  it('is refused when the binder lists that note as a scene, whatever its capitals', async () => {
    const vault = new MemoryVault().seed(NOTE, { body: 'A scene.\n' });
    const { store } = await openSeeded({ binder: ['Manuscript/A.md', `${AI_HELPER_FOLDER.toUpperCase()}/${AI_HELPER_FILE}`], scenes: { A: 1024 } }, vault);
    expect(await store.updateHelperNote(() => 'x')).toMatchObject({ status: 'refused', reason: 'invalid-path' });
    expect(vault.textOf(NOTE)).toBe('A scene.\n');
    expect(vault.writes).toEqual([]);
  });

  it('says so when the save fails, and leaves nothing behind', async () => {
    const { store, vault } = await openSeeded(scenes);
    vault.failNext('updateText', NOTE);
    const result = await store.updateHelperNote(() => 'The reference.\n');
    expect(result.status).toBe('failed');
    expect(vault.has(NOTE)).toBe(false);
  });
});
