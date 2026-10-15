// What the writer reads follows what a note is: a chapter or a scene.

import { describe, expect, it } from 'vitest';
import { kindForNewNote, kindOfNote, notesHeading } from '../src/core/binderModel';
import { buildBoard } from '../src/core/cards/board';
import { buildStatusLine } from '../src/core/progress/statusLine';
import type { TreeNode } from '../src/core/types';
import { describeScenes } from '../src/features/corkboard/cardElements';
import { countText } from '../src/features/revision/revisionView';
import { TickedResults, changesText } from '../src/features/revision/results';
import { pickerTitle } from '../src/features/world/pickerModal';

const scene = (title: string): TreeNode => ({ kind: 'scene', path: `Manuscript/${title}.md`, title, missing: false });
const chapter = (title: string): TreeNode => ({ kind: 'scene', path: `Manuscript/${title}.md`, title, missing: false, chapter: true });
const MIXED: TreeNode[] = [chapter('One'), { kind: 'folder', id: 'f', name: 'Two', children: [scene('a'), scene('b')] }, { kind: 'folder', id: 'e', name: 'Empty', children: [] }];

describe('the kind of a new note', () => {
  it('follows the note next to it, the last note of the folder, or the project', () => {
    expect(kindForNewNote(MIXED, { at: 'after', sibling: { kind: 'scene', path: 'Manuscript/One.md' } }, 'scene')).toBe('chapter');
    expect(kindForNewNote(MIXED, { at: 'after', sibling: { kind: 'scene', path: 'Manuscript/a.md' } }, 'chapter')).toBe('scene');
    expect(kindForNewNote(MIXED, { at: 'end', parentId: 'f' }, 'chapter')).toBe('scene');
    expect(kindForNewNote(MIXED, { at: 'end', parentId: 'e' }, 'chapter')).toBe('chapter');
    expect(kindForNewNote(MIXED, { at: 'end', parentId: null }, 'scene')).toBe('scene');
    expect(kindOfNote(MIXED, 'Manuscript/One.md')).toBe('chapter');
    expect(kindOfNote(MIXED, 'Manuscript/a.md')).toBe('scene');
  });
});

describe('wording', () => {
  it('heads the plot grid by what its rows are', () => {
    expect(notesHeading([scene('a')])).toBe('Scene');
    expect(notesHeading([chapter('a')])).toBe('Chapter');
    expect(notesHeading(MIXED)).toBe('Chapter / scene');
  });

  it('labels the title in the bottom bar Chapter for a chapter note', () => {
    expect(buildStatusLine({ sceneTitle: 'One', chapter: true }, ['title'])[0]?.label).toBe('Chapter');
    expect(buildStatusLine({ sceneTitle: 'a' }, ['title'])[0]?.label).toBe('Scene');
  });

  it('names the inspector part and the picker by the note', () => {
    expect(pickerTitle('One', true)).toBe('In this chapter: One');
    expect(pickerTitle('a')).toBe('In this scene: a');
  });

  it('counts chapter notes and scenes apart on the corkboard', () => {
    const board = buildBoard({ tree: MIXED, sceneOf: () => null, lists: { statuses: { kind: 'status', tags: [], problems: [] }, labels: { kind: 'label', tags: [], problems: [] } } as never });
    expect(describeScenes(board.sceneCount, board.chapterCount ?? 0)).toBe('1 chapter and 2 scenes');
    expect(board.cards[0]).toMatchObject({ kind: 'scene', chapter: true });
    expect(describeScenes(4)).toBe('4 scenes');
  });

  it('says where revision tools found or changed things', () => {
    expect(changesText(5, 3, 1)).toBe('5 changes in 1 chapter and 2 scenes');
    expect(changesText(5, 3)).toBe('5 changes in 3 scenes');
    expect(countText(4, 2, 'open', 2)).toBe('4 open notes in 2 chapters');
    const groups = [
      { scene: { path: 'Manuscript/One.md', title: 'One' }, body: 'x', matches: [{ from: 0, to: 1, text: 'x' }] },
      { scene: { path: 'Manuscript/a.md', title: 'a' }, body: 'x', matches: [{ from: 0, to: 1, text: 'x' }] },
    ];
    const ticked = new TickedResults(groups as never, () => true, (path) => path === 'Manuscript/One.md');
    expect(ticked.found).toEqual({ places: 2, scenes: 2, chapters: 1 });
  });
});
