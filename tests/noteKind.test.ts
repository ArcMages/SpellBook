// Chapters and scenes: the kind of a note, kept in the project index.

import { describe, expect, it } from 'vitest';
import {
  CHAPTERS_KEY,
  WRITES_IN_KEY,
  describeKinds,
  readChapterList,
  readWritesIn,
  renamedChapterList,
  withKind,
} from '../src/core/noteKind';
import type { TreeNode } from '../src/core/types';
import { MemoryVault } from './memoryVault';
import { makeStore, openSeeded, project, settle, valueOf } from './storeHarness';

function chapterTitles(tree: readonly TreeNode[]): string[] {
  const out: string[] = [];
  const walk = (nodes: readonly TreeNode[]): void => {
    for (const node of nodes) {
      if (node.kind === 'folder') walk(node.children);
      else if (node.chapter === true) out.push(node.title);
    }
  };
  walk(tree);
  return out;
}

describe('the chapters list', () => {
  it('reads paths and leaves out what is not one', () => {
    expect(readChapterList(['Manuscript/A.md', 3, '../x.md', 'Manuscript/A.md', 'Manuscript/פרק.md'])).toEqual([
      'Manuscript/A.md',
      'Manuscript/פרק.md',
    ]);
    expect(readChapterList('Manuscript/A.md')).toEqual([]);
  });

  it('sets and clears one note, and leaves no key when it is empty', () => {
    expect(withKind(undefined, 'Manuscript/A.md', 'chapter')).toEqual(['Manuscript/A.md']);
    expect(withKind(['Manuscript/A.md', 7], 'Manuscript/B.md', 'chapter')).toEqual(['Manuscript/A.md', 7, 'Manuscript/B.md']);
    expect(withKind(['Manuscript/A.md'], 'Manuscript/A.md', 'scene')).toBeUndefined();
  });

  it('follows renames and drops a doubled entry', () => {
    expect(renamedChapterList(['Manuscript/A.md', 'Manuscript/B.md'], [['Manuscript/A.md', 'Manuscript/C.md']])).toEqual([
      'Manuscript/C.md',
      'Manuscript/B.md',
    ]);
    expect(renamedChapterList(['Manuscript/A.md'], [['Manuscript/X.md', 'Manuscript/Y.md']])).toBeNull();
    expect(renamedChapterList(undefined, [['Manuscript/X.md', 'Manuscript/Y.md']])).toBeNull();
  });

  it('reads what the writer usually writes in, scenes unless it says chapters', () => {
    expect(readWritesIn(undefined)).toBe('scene');
    expect(readWritesIn('Chapters')).toBe('chapter');
    expect(readWritesIn('novels')).toBe('scene');
  });

  it('says counts naturally', () => {
    expect(describeKinds(3, 2)).toBe('3 chapters and 2 scenes');
    expect(describeKinds(1, 0)).toBe('1 chapter');
    expect(describeKinds(0, 1)).toBe('1 scene');
    expect(describeKinds(0, 0)).toBe('0 scenes');
    expect(describeKinds(0, 1234)).toBe('1,234 scenes');
  });
});

describe('the store and note kinds', () => {
  it('shows marked notes as chapters and every other note as a scene', async () => {
    const { store } = await openSeeded({
      scenes: { Opening: 1024, Spark: 2048 },
      extra: { [CHAPTERS_KEY]: ['Manuscript/Spark.md'] },
    });
    expect(chapterTitles(project(store).tree)).toEqual(['Spark']);
    expect(project(store).writesIn).toBe('scene');
  });

  it('marks a note as a chapter and back, in the index only', async () => {
    const { store, vault, indexPath } = await openSeeded({ scenes: { Opening: 1024, Spark: 2048 } });
    valueOf(await store.setNoteKind('Manuscript/Spark.md', 'chapter'));
    await settle(store);
    expect(vault.frontmatterOf(indexPath)?.[CHAPTERS_KEY]).toEqual(['Manuscript/Spark.md']);
    expect(vault.frontmatterOf('Novel/Manuscript/Spark.md')).toEqual({ status: 'To do', order: 2048 });
    expect(chapterTitles(project(store).tree)).toEqual(['Spark']);

    const again = await store.setNoteKind('Manuscript/Spark.md', 'chapter');
    expect(again.status).toBe('noop');

    valueOf(await store.setNoteKind('Manuscript/Spark.md', 'scene'));
    await settle(store);
    expect(vault.frontmatterOf(indexPath)).not.toHaveProperty(CHAPTERS_KEY);
    expect(chapterTitles(project(store).tree)).toEqual([]);
  });

  it('refuses a note that is not in the binder', async () => {
    const { store } = await openSeeded({ scenes: { Opening: 1024 } });
    expect((await store.setNoteKind('Manuscript/Nowhere.md', 'chapter')).status).toBe('noop');
  });

  it('keeps the mark when the note is renamed', async () => {
    const { store, vault, indexPath } = await openSeeded({
      scenes: { Opening: 1024, Spark: 2048 },
      extra: { [CHAPTERS_KEY]: ['Manuscript/Spark.md'] },
    });
    valueOf(await store.renameScene('Manuscript/Spark.md', 'The Spark'));
    await settle(store);
    expect(vault.frontmatterOf(indexPath)?.[CHAPTERS_KEY]).toEqual(['Manuscript/The Spark.md']);
    expect(chapterTitles(project(store).tree)).toEqual(['The Spark']);
  });

  it('forgets the mark of a chapter that goes to the trash', async () => {
    const { store, vault, indexPath } = await openSeeded({
      scenes: { Opening: 1024, Spark: 2048 },
      extra: { [CHAPTERS_KEY]: ['Manuscript/Spark.md'] },
    });
    valueOf(await store.deleteScene('Manuscript/Spark.md'));
    await settle(store);
    expect(vault.frontmatterOf(indexPath)).not.toHaveProperty(CHAPTERS_KEY);
  });

  it('makes new notes of the kind the project usually writes in', async () => {
    const { store, vault, indexPath } = await openSeeded({ scenes: { Opening: 1024 } });
    valueOf(await store.setWritesIn('chapter'));
    await settle(store);
    expect(vault.frontmatterOf(indexPath)?.[WRITES_IN_KEY]).toBe('chapters');
    expect(project(store).writesIn).toBe('chapter');
    const made = valueOf(await store.addScene(''));
    await settle(store);
    expect(made.path).toBe('Manuscript/Untitled chapter.md');
    expect(chapterTitles(project(store).tree)).toEqual(['Untitled chapter']);
    // A scene can still be asked for.
    valueOf(await store.addScene('Interlude', undefined, undefined, undefined, 'scene'));
    await settle(store);
    expect(chapterTitles(project(store).tree)).toEqual(['Untitled chapter']);

    valueOf(await store.setWritesIn('scene'));
    await settle(store);
    expect(vault.frontmatterOf(indexPath)).not.toHaveProperty(WRITES_IN_KEY);
  });

  it('creates a project written in chapters with its first notes as chapters', async () => {
    const { store, vault } = makeStore(new MemoryVault());
    const made = valueOf(
      await store.createProject('Book', '', { seed: { binder: [{ title: 'Chapter 1' }] }, writesIn: 'chapter' }),
    );
    expect(vault.frontmatterOf(made.indexPath)?.[WRITES_IN_KEY]).toBe('chapters');
    expect(vault.frontmatterOf(made.indexPath)?.[CHAPTERS_KEY]).toEqual(['Manuscript/Chapter 1.md']);
  });
});
