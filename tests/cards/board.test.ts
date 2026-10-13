// The corkboard: the cards of the manuscript or of one binder folder.

import { describe, expect, it } from 'vitest';
import { MANUSCRIPT_SCOPE, buildBoard, folderScope, sameScope } from '../../src/core/cards';
import type { Board, BoardCard, BoardScope, FolderCard, SceneCard, SceneData } from '../../src/core/cards';
import type { Binder } from '../../src/core/types';
import { HEBREW, deepFreeze, folderNode, sampleLists, sceneNode, treeOf } from './helpers';

const lists = sampleLists();

// Manuscript
//   Opening
//   Part one            (folder)
//     Letter
//     Chapter 2         (folder)
//       Harbour
//       Storm
//     Gone              (its note is missing)
//   <Hebrew: Part two>  (folder)
//     <Hebrew: Opening>
//   Ending
//   Empty               (folder)
const binder: Binder = [
  sceneNode('Opening'),
  folderNode('Part one', [
    sceneNode('Letter'),
    folderNode('Chapter 2', [sceneNode('Harbour'), sceneNode('Storm')]),
    sceneNode('Gone'),
  ]),
  folderNode(HEBREW.partTwo, [sceneNode(HEBREW.opening)]),
  sceneNode('Ending'),
  folderNode('Empty', []),
];

const data: Record<string, SceneData> = {
  'Manuscript/Opening.md': { frontmatter: { synopsis: 'Anna arrives.', status: 'To do', label: 'Anna' }, words: 100 },
  'Manuscript/Letter.md': { frontmatter: { synopsis: '', status: 'First draft' }, text: 'She read the letter twice.', words: 200 },
  'Manuscript/Harbour.md': { frontmatter: { status: 'Abandoned' }, words: 300 },
  'Manuscript/Storm.md': { frontmatter: {}, words: 400 },
  [`Manuscript/${HEBREW.opening}.md`]: { frontmatter: { synopsis: HEBREW.synopsis, label: HEBREW.daniel }, words: 50 },
  'Manuscript/Ending.md': { frontmatter: { compile: false }, words: 7 },
};

function board(scope?: BoardScope, overrides: Record<string, SceneData | undefined> = {}): Board {
  const known: Record<string, SceneData | undefined> = { ...data, ...overrides };
  return buildBoard({ tree: treeOf(binder, ['Gone']), scope, sceneOf: (path) => known[path], lists });
}

/** A short picture of the cards: scene titles, and folder names in brackets. */
function draw(cards: readonly BoardCard[]): string[] {
  return cards.map((card) => (card.kind === 'scene' ? card.title : `[${card.name}]`));
}

function folderCard(cards: readonly BoardCard[], name: string): FolderCard {
  const card = cards.find((candidate) => candidate.kind === 'folder' && candidate.name === name);
  if (!card || card.kind !== 'folder') throw new Error(`no folder card called ${name}`);
  return card;
}

function sceneCard(cards: readonly BoardCard[], title: string): SceneCard {
  const card = cards.find((candidate) => candidate.kind === 'scene' && candidate.title === title);
  if (!card || card.kind !== 'scene') throw new Error(`no scene card called ${title}`);
  return card;
}

describe('buildBoard: the whole manuscript', () => {
  it('shows the top level of the binder in binder order: scenes as cards, folders as folder cards', () => {
    const top = board();
    expect(draw(top.cards)).toEqual(['Opening', '[Part one]', `[${HEBREW.partTwo}]`, 'Ending', '[Empty]']);
    expect(top.scope).toEqual({ kind: 'manuscript' });
    expect(top.scopeFound).toBe(true);
    expect(top.parentId).toBeNull();
  });

  it('is what you get when no scope is given', () => {
    expect(board(undefined)).toEqual(board(MANUSCRIPT_SCOPE));
  });

  it('builds each scene card from the scene\'s properties, text and word count', () => {
    const top = board();
    expect(sceneCard(top.cards, 'Opening')).toEqual({
      kind: 'scene',
      path: 'Manuscript/Opening.md',
      title: 'Opening',
      synopsis: 'Anna arrives.',
      synopsisDerived: false,
      status: { name: 'To do', color: 'red', listed: true },
      label: { name: 'Anna', color: 'purple', listed: true },
      words: 100,
      target: null,
      progress: null,
      missing: false,
      compile: true,
    });
    expect(sceneCard(top.cards, 'Ending').compile).toBe(false);
  });

  it('gives a folder card the folder\'s name, the scenes inside at any depth, and their summed words', () => {
    const top = board();
    expect(folderCard(top.cards, 'Part one')).toEqual({
      kind: 'folder',
      id: 'f-Part one',
      name: 'Part one',
      sceneCount: 4,
      missingCount: 1,
      words: 900,
      opens: { kind: 'folder', id: 'f-Part one' },
    });
    expect(folderCard(top.cards, 'Empty')).toMatchObject({ sceneCount: 0, missingCount: 0, words: 0 });
  });

  it('shows a Hebrew folder name unchanged', () => {
    const card = folderCard(board().cards, HEBREW.partTwo);
    expect(card.name).toBe(HEBREW.partTwo);
    expect(card.sceneCount).toBe(1);
    expect(card.words).toBe(50);
  });

  it('counts every scene of the manuscript and sums their words', () => {
    const top = board();
    expect(top.sceneCount).toBe(7);
    expect(top.words).toBe(100 + 200 + 300 + 400 + 0 + 50 + 7);
  });

  it('has a breadcrumb of one step', () => {
    expect(board().breadcrumb).toEqual([{ name: 'Manuscript', scope: { kind: 'manuscript' }, current: true }]);
  });

  it('is empty for an empty binder', () => {
    const empty = buildBoard({ tree: [], sceneOf: () => undefined, lists });
    expect(empty.cards).toEqual([]);
    expect(empty.sceneCount).toBe(0);
    expect(empty.words).toBe(0);
    expect(empty.breadcrumb).toHaveLength(1);
  });
});

describe('buildBoard: one folder', () => {
  it('shows the direct contents of the folder, in order', () => {
    const partOne = board(folderScope('f-Part one'));
    expect(draw(partOne.cards)).toEqual(['Letter', '[Chapter 2]', 'Gone']);
    expect(partOne.scope).toEqual({ kind: 'folder', id: 'f-Part one' });
    expect(partOne.scopeFound).toBe(true);
    expect(partOne.parentId).toBe('f-Part one');
    expect(partOne.sceneCount).toBe(4);
    expect(partOne.words).toBe(900);
  });

  it('opens a folder card as the new scope', () => {
    const top = board();
    const partOne = board(folderCard(top.cards, 'Part one').opens);
    expect(draw(partOne.cards)).toEqual(['Letter', '[Chapter 2]', 'Gone']);
    const chapter = board(folderCard(partOne.cards, 'Chapter 2').opens);
    expect(draw(chapter.cards)).toEqual(['Harbour', 'Storm']);
    expect(chapter.parentId).toBe('f-Chapter 2');
    expect(chapter.sceneCount).toBe(2);
    expect(chapter.words).toBe(700);
  });

  it('gives the breadcrumb from the manuscript down to the folder shown', () => {
    expect(board(folderScope('f-Chapter 2')).breadcrumb).toEqual([
      { name: 'Manuscript', scope: { kind: 'manuscript' }, current: false },
      { name: 'Part one', scope: { kind: 'folder', id: 'f-Part one' }, current: false },
      { name: 'Chapter 2', scope: { kind: 'folder', id: 'f-Chapter 2' }, current: true },
    ]);
  });

  it('leads back up: every step of the breadcrumb opens the board it names', () => {
    const chapter = board(folderScope('f-Chapter 2'));
    const boards = chapter.breadcrumb.map((step) => board(step.scope));
    expect(boards.map((each) => draw(each.cards)[0])).toEqual(['Opening', 'Letter', 'Harbour']);
    expect(boards.map((each) => each.breadcrumb.length)).toEqual([1, 2, 3]);
  });

  it('shows a Hebrew folder and names it in the breadcrumb', () => {
    const partTwo = board(folderScope(`f-${HEBREW.partTwo}`));
    expect(draw(partTwo.cards)).toEqual([HEBREW.opening]);
    expect(partTwo.breadcrumb.map((step) => step.name)).toEqual(['Manuscript', HEBREW.partTwo]);
    expect(sceneCard(partTwo.cards, HEBREW.opening).synopsis).toBe(HEBREW.synopsis);
    expect(sceneCard(partTwo.cards, HEBREW.opening).label).toEqual({ name: HEBREW.daniel, color: 'cyan', listed: true });
  });

  it('shows an empty folder as a board with no cards', () => {
    const empty = board(folderScope('f-Empty'));
    expect(empty.cards).toEqual([]);
    expect(empty.scopeFound).toBe(true);
    expect(empty.parentId).toBe('f-Empty');
    expect(empty.breadcrumb.map((step) => step.name)).toEqual(['Manuscript', 'Empty']);
  });

  it('falls back to the whole manuscript when the folder is no longer in the binder', () => {
    const gone = board(folderScope('f-removed-on-another-device'));
    expect(gone.scopeFound).toBe(false);
    expect(gone.scope).toEqual({ kind: 'manuscript' });
    expect(gone.parentId).toBeNull();
    expect(draw(gone.cards)).toEqual(draw(board().cards));
    expect(gone.breadcrumb).toEqual([{ name: 'Manuscript', scope: { kind: 'manuscript' }, current: true }]);
  });
});

describe('buildBoard: scenes that are missing, unread or still being counted', () => {
  it('keeps a missing scene on the board, marked', () => {
    const partOne = board(folderScope('f-Part one'));
    const gone = sceneCard(partOne.cards, 'Gone');
    expect(gone.missing).toBe(true);
    expect(gone.words).toBeNull();
    expect(gone.path).toBe('Manuscript/Gone.md');
    expect(sceneCard(partOne.cards, 'Letter').missing).toBe(false);
  });

  it('counts a missing scene among the scenes, and adds nothing for it to the words', () => {
    const partOne = folderCard(board().cards, 'Part one');
    expect(partOne.sceneCount).toBe(4);
    expect(partOne.missingCount).toBe(1);
    expect(partOne.words).toBe(200 + 300 + 400);
  });

  it('shows no total while a scene inside is still being counted, here and in every folder above it', () => {
    const counting = board(undefined, { 'Manuscript/Storm.md': { frontmatter: {} } });
    expect(folderCard(counting.cards, 'Part one').words).toBeNull();
    expect(folderCard(counting.cards, HEBREW.partTwo).words).toBe(50);
    expect(counting.words).toBeNull();
    const partOne = board(folderScope('f-Part one'), { 'Manuscript/Storm.md': { frontmatter: {} } });
    expect(folderCard(partOne.cards, 'Chapter 2').words).toBeNull();
    expect(sceneCard(partOne.cards, 'Letter').words).toBe(200);
    expect(partOne.words).toBeNull();
  });

  it('adds nothing for a scene that cannot be read, and still gives a total', () => {
    const unreadable = board(undefined, { 'Manuscript/Storm.md': { frontmatter: {}, words: null } });
    expect(folderCard(unreadable.cards, 'Part one').words).toBe(500);
    expect(unreadable.words).toBe(100 + 200 + 300 + 50 + 7);
  });

  it('makes a card for a scene nothing is known about yet', () => {
    const fresh = board(undefined, { 'Manuscript/Opening.md': undefined });
    const opening = sceneCard(fresh.cards, 'Opening');
    expect(opening).toMatchObject({ title: 'Opening', synopsis: '', status: null, label: null, words: null, missing: false });
    expect(fresh.words).toBeNull();
  });

  it('takes the synopsis from the text of a scene that has none', () => {
    const letter = sceneCard(board(folderScope('f-Part one')).cards, 'Letter');
    expect(letter.synopsis).toBe('She read the letter twice.');
    expect(letter.synopsisDerived).toBe(true);
  });

  it('shows a status the project does not list without a colour', () => {
    const harbour = sceneCard(board(folderScope('f-Chapter 2')).cards, 'Harbour');
    expect(harbour.status).toEqual({ name: 'Abandoned', color: null, listed: false });
  });

  it('passes the preview length on to the cards', () => {
    const short = buildBoard({
      tree: treeOf([sceneNode('A')]),
      sceneOf: () => ({ text: 'one two three four five' }),
      lists,
      previewLength: 8,
    });
    expect(sceneCard(short.cards, 'A').synopsis).toBe('one two…');
  });
});

describe('buildBoard: care with its input', () => {
  it('never changes the tree or the data it is given', () => {
    const tree = deepFreeze(treeOf(binder, ['Gone']));
    const frozen = deepFreeze({ ...data });
    expect(() => buildBoard({ tree, scope: folderScope('f-Part one'), sceneOf: (path) => frozen[path], lists })).not.toThrow();
  });

  it('gives the same board for the same input', () => {
    expect(board(folderScope('f-Part one'))).toEqual(board(folderScope('f-Part one')));
  });
});

describe('scopes', () => {
  it('compares scopes by what they show', () => {
    expect(sameScope(MANUSCRIPT_SCOPE, { kind: 'manuscript' })).toBe(true);
    expect(sameScope(folderScope('f-1'), { kind: 'folder', id: 'f-1' })).toBe(true);
    expect(sameScope(folderScope('f-1'), folderScope('f-2'))).toBe(false);
    expect(sameScope(folderScope('f-1'), MANUSCRIPT_SCOPE)).toBe(false);
    expect(sameScope(MANUSCRIPT_SCOPE, folderScope('f-1'))).toBe(false);
  });
});
