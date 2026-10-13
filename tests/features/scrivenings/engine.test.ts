// What the continuous manuscript works out with no screen and no vault
// (src/core/scrivenings): where the scenes stand, which are drawn, how the
// writer's line is kept, which scenes are on show, a scene's text, and what
// a device remembers.

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SCENE_HEIGHT,
  DEFAULT_VIEW,
  MAX_REMEMBERED_PROJECTS,
  MIN_SCENE_HEIGHT,
  carryOver,
  estimateHeight,
  hasText,
  lineOfSnippet,
  moveRemembered,
  offsetsOf,
  placeAt,
  planWindow,
  plainParagraphs,
  readMemory,
  remember,
  sameScriveningsScope,
  sceneAt,
  sceneText,
  scenesOfScope,
  scrollTopOf,
  totalHeight,
  writeMemory,
} from '../../../src/core/scrivenings';
import type { RememberedView, ShownScene } from '../../../src/core/scrivenings';
import { pathKey } from '../../../src/core/paths';
import type { TreeNode } from '../../../src/core/types';

describe('a guess at how tall a scene is', () => {
  it('grows with the words, and is taller in a narrow pane', () => {
    expect(estimateHeight(null, 900)).toBe(DEFAULT_SCENE_HEIGHT);
    expect(estimateHeight(0, 900)).toBe(MIN_SCENE_HEIGHT);
    const short = estimateHeight(200, 900);
    const long = estimateHeight(2000, 900);
    expect(short).toBeGreaterThan(MIN_SCENE_HEIGHT);
    expect(long).toBeGreaterThan(short * 5);
    expect(estimateHeight(2000, 360)).toBeGreaterThan(long);
  });

  it('holds the text to a readable width however wide the pane, and takes a width that is not known as wide', () => {
    expect(estimateHeight(2000, 3000)).toBe(estimateHeight(2000, 1200));
    expect(estimateHeight(2000, 0)).toBe(estimateHeight(2000, 1200));
    // Never a figure that is not a height.
    for (const words of [Number.NaN, Number.POSITIVE_INFINITY, -5]) {
      const height = estimateHeight(words, 10);
      expect(Number.isFinite(height) && height >= MIN_SCENE_HEIGHT, String(words)).toBe(true);
    }
  });
});

describe('where the scenes stand', () => {
  const offsets = offsetsOf([100, 300, 50, 200]);

  it('adds the heights up', () => {
    expect(offsets).toEqual([0, 100, 400, 450, 650]);
    expect(totalHeight(offsets)).toBe(650);
    expect(offsetsOf([])).toEqual([0]);
    expect(totalHeight(offsetsOf([]))).toBe(0);
  });

  it('finds the scene a point lies in', () => {
    expect(sceneAt(offsets, 0)).toBe(0);
    expect(sceneAt(offsets, 99)).toBe(0);
    expect(sceneAt(offsets, 100)).toBe(1);
    expect(sceneAt(offsets, 399)).toBe(1);
    expect(sceneAt(offsets, 425)).toBe(2);
    expect(sceneAt(offsets, 649)).toBe(3);
    // Above the top and below the end.
    expect(sceneAt(offsets, -40)).toBe(0);
    expect(sceneAt(offsets, 5000)).toBe(3);
    expect(sceneAt(offsetsOf([]), 10)).toBe(-1);
  });

  it('finds the scene among a great many', () => {
    const many = offsetsOf(Array.from({ length: 1000 }, () => 10));
    for (const index of [0, 1, 499, 998, 999]) expect(sceneAt(many, index * 10 + 5)).toBe(index);
  });
});

describe('keeping the writer on the same line', () => {
  it('says how far into which scene the top of the screen is, and finds that place again', () => {
    const offsets = offsetsOf([100, 300, 50, 200]);
    expect(placeAt(offsets, 0)).toEqual({ index: 0, fraction: 0 });
    expect(placeAt(offsets, 250)).toEqual({ index: 1, fraction: 0.5 });
    expect(scrollTopOf(offsets, { index: 1, fraction: 0.5 })).toBe(250);
    expect(placeAt(offsetsOf([]), 30)).toBeNull();
    expect(scrollTopOf(offsetsOf([]), { index: 2, fraction: 0.5 })).toBe(0);
  });

  it('stays in the same scene when a scene above it turns out taller or shorter', () => {
    const before = offsetsOf([100, 300, 50, 200]);
    const place = placeAt(before, 420);
    expect(place).toEqual({ index: 2, fraction: 0.4 });
    // The first scene was drawn and is 640 tall, not 100.
    const after = offsetsOf([640, 300, 50, 200]);
    expect(scrollTopOf(after, place as { index: number; fraction: number })).toBe(960);
    // And when the scene itself grows, the writer is as far into it as before.
    const grown = offsetsOf([640, 300, 500, 200]);
    expect(scrollTopOf(grown, place as { index: number; fraction: number })).toBe(940 + 200);
  });

  it('takes a place that is out of bounds as the nearest one that is not', () => {
    const offsets = offsetsOf([100, 300]);
    expect(scrollTopOf(offsets, { index: 9, fraction: 0 })).toBe(100);
    expect(scrollTopOf(offsets, { index: -3, fraction: 0.5 })).toBe(50);
    expect(scrollTopOf(offsets, { index: 1, fraction: 7 })).toBe(400);
    expect(scrollTopOf(offsets, { index: 1, fraction: Number.NaN })).toBe(100);
    // Scenes with no height at all are passed over.
    expect(placeAt(offsetsOf([0, 0, 100]), 0)).toEqual({ index: 2, fraction: 0 });
  });
});

describe('which scenes are drawn', () => {
  // A hundred scenes of 1,000 each, on a screen of 800.
  const offsets = offsetsOf(Array.from({ length: 100 }, () => 1000));
  const none = Array.from({ length: 100 }, () => false);
  const room = { draw: 1, keep: 3 };

  it('draws what is on the screen and a screen either way, the nearest first', () => {
    // The screen shows 10,000 to 10,800: scene 10. A screen above reaches into scene 9, a screen below into scene 11.
    expect(planWindow(offsets, 10_000, 800, none, room)).toEqual({ draw: [10, 9, 11], drop: [] });
    // At the very top there is nothing above.
    expect(planWindow(offsets, 0, 800, none, room)).toEqual({ draw: [0, 1], drop: [] });
    // And at the very end nothing below.
    expect(planWindow(offsets, 99_200, 800, none, room).draw).toEqual([99, 98]);
  });

  it('leaves alone what is drawn already', () => {
    const drawn = none.map((_, at) => at === 10 || at === 11);
    expect(planWindow(offsets, 10_000, 800, drawn, room)).toEqual({ draw: [9], drop: [] });
  });

  it('lets go of what is far away, and keeps what is only a little way off', () => {
    const drawn = none.map((_, at) => at >= 2 && at <= 14);
    const plan = planWindow(offsets, 10_000, 800, drawn, room);
    expect(plan.draw).toEqual([]);
    // Kept from 3 screens above (7,600: scene 7) to 3 screens below (13,200: scene 13).
    expect(plan.drop).toEqual([2, 3, 4, 5, 6, 14]);
  });

  it('never draws more than a few scenes at once, however long the manuscript', () => {
    for (const scrollTop of [0, 12_345, 50_000, 99_999]) {
      const plan = planWindow(offsets, scrollTop, 800, none);
      expect(plan.draw.length).toBeLessThanOrEqual(5);
    }
    // Many tiny scenes: as many as fit, and no more.
    const tiny = offsetsOf(Array.from({ length: 500 }, () => 100));
    expect(planWindow(tiny, 20_000, 800, [], room).draw.length).toBe(24);
  });

  it('does nothing for a manuscript with no scenes, and copes with a screen that is not measured', () => {
    expect(planWindow(offsetsOf([]), 0, 800, [])).toEqual({ draw: [], drop: [] });
    expect(planWindow(offsets, 0, 0, none, room).draw).toEqual([0]);
    expect(planWindow(offsets, -50, 800, none, room).draw).toEqual([0, 1]);
  });
});

describe('which scenes are on show', () => {
  const scene = (path: string, missing = false): TreeNode => ({ kind: 'scene', path, title: path.replace(/^.*\//, '').replace(/\.md$/, ''), missing });
  const tree: TreeNode[] = [
    scene('Manuscript/Opening.md'),
    {
      kind: 'folder',
      id: 'f-one',
      name: 'Part one',
      children: [scene('Manuscript/Letter.md'), { kind: 'folder', id: 'f-inner', name: 'Inner', children: [scene('Manuscript/Night.md')] }],
    },
    scene('Manuscript/Ghost.md', true),
  ];

  it('lists the whole manuscript, or one folder with the folders inside it, in binder order', () => {
    expect(scenesOfScope(tree, { kind: 'manuscript' })?.map((found) => found.title)).toEqual(['Opening', 'Letter', 'Night', 'Ghost']);
    expect(scenesOfScope(tree, { kind: 'folder', id: 'f-one' })?.map((found) => found.title)).toEqual(['Letter', 'Night']);
    expect(scenesOfScope(tree, { kind: 'folder', id: 'f-inner' })?.map((found) => found.title)).toEqual(['Night']);
    expect(scenesOfScope(tree, { kind: 'manuscript' })?.[3]?.missing).toBe(true);
    expect(scenesOfScope(tree, { kind: 'folder', id: 'f-gone' })).toBeNull();
  });

  it('tells two scopes apart', () => {
    expect(sameScriveningsScope({ kind: 'manuscript' }, { kind: 'manuscript' })).toBe(true);
    expect(sameScriveningsScope({ kind: 'folder', id: 'a' }, { kind: 'folder', id: 'a' })).toBe(true);
    expect(sameScriveningsScope({ kind: 'folder', id: 'a' }, { kind: 'folder', id: 'b' })).toBe(false);
    expect(sameScriveningsScope({ kind: 'folder', id: 'a' }, { kind: 'manuscript' })).toBe(false);
  });
});

describe('carrying the scenes on show over to a changed binder', () => {
  const shown = (...names: string[]): ShownScene[] => names.map((name) => ({ path: `Manuscript/${name}.md`, vaultPath: `Novel/Manuscript/${name}.md` }));
  const nobody = new Map<string, string>();

  it('knows every scene again by its path, wherever it went', () => {
    expect(carryOver(shown('A', 'B', 'C'), shown('A', 'B', 'C'), nobody)).toEqual([0, 1, 2]);
    expect(carryOver(shown('A', 'B', 'C'), shown('C', 'A', 'B'), nobody)).toEqual([2, 0, 1]);
    expect(carryOver(shown('A', 'B', 'C'), shown('A', 'C'), nobody)).toEqual([0, 2]);
    expect(carryOver(shown('A', 'C'), shown('A', 'B', 'C'), nobody)).toEqual([0, -1, 1]);
    expect(carryOver([], shown('A'), nobody)).toEqual([-1]);
    expect(carryOver(shown('A'), [], nobody)).toEqual([]);
  });

  it('knows a renamed scene again by what the vault said of it', () => {
    const renamed = new Map([[pathKey('Novel/Manuscript/B.md'), 'Novel/Manuscript/Bee.md']]);
    // Renamed and moved at once: only the vault's word tells.
    expect(carryOver(shown('A', 'B', 'C'), shown('Bee', 'A', 'C'), renamed)).toEqual([1, 0, 2]);
  });

  it('knows a renamed scene again when the vault has not said so yet: one left, one came, in the same place', () => {
    expect(carryOver(shown('A', 'B', 'C'), shown('A', 'Bee', 'C'), nobody)).toEqual([0, 1, 2]);
    // Not in the same place, or more than one: they are new scenes.
    expect(carryOver(shown('A', 'B', 'C'), shown('Bee', 'A', 'C'), nobody)).toEqual([-1, 0, 2]);
    expect(carryOver(shown('A', 'B', 'C'), shown('X', 'Y', 'C'), nobody)).toEqual([-1, -1, 2]);
    // One was removed and another added elsewhere: the list is as long, but they are not one scene.
    expect(carryOver(shown('A', 'B', 'C'), shown('A', 'C', 'D'), nobody)).toEqual([0, 2, -1]);
  });

  it('never hands one scene on show to two scenes of the binder', () => {
    const renamed = new Map([[pathKey('Novel/Manuscript/B.md'), 'Novel/Manuscript/Bee.md']]);
    const from = carryOver(shown('A', 'B'), shown('Bee', 'Bee', 'A'), renamed);
    expect(from.filter((at) => at === 1)).toHaveLength(1);
  });
});

describe('the text of a scene', () => {
  it('leaves the properties out and knows the line the text starts on', () => {
    const note = ['---', 'synopsis: Anna arrives', 'status: Draft', '---', '# One', '', 'It was a dark night.'].join('\n');
    expect(sceneText(note)).toEqual({ body: '# One\n\nIt was a dark night.', startLine: 4 });
    expect(sceneText('No properties here.\nTwo lines.')).toEqual({ body: 'No properties here.\nTwo lines.', startLine: 0 });
    expect(sceneText('---\nstatus: Draft\n---\n')).toEqual({ body: '', startLine: 3 });
    // A block that is never closed is ordinary text.
    expect(sceneText('---\nnot closed\ntext').startLine).toBe(0);
    expect(sceneText('').body).toBe('');
  });

  it('says whether there is anything to read', () => {
    expect(hasText('One word.')).toBe(true);
    expect(hasText('')).toBe(false);
    expect(hasText('  \n\n\t')).toBe(false);
    expect(hasText('%% only a note to myself %%\n')).toBe(false);
    expect(hasText('שלום')).toBe(true);
  });

  it('gives plain paragraphs when the text cannot be drawn as formatted text', () => {
    expect(plainParagraphs('First line.\nSame paragraph.  \n\n\nSecond.\n\n%% hidden %%\n\nשלום לך.\n')).toEqual([
      'First line.\nSame paragraph.',
      'Second.',
      'שלום לך.',
    ]);
    expect(plainParagraphs('')).toEqual([]);
  });
});

describe('the line a tapped paragraph comes from', () => {
  const body = [
    '# Chapter One', // 0
    '', // 1
    'It was a dark night. The harbour was empty,', // 2
    'and Anna walked alone.', // 3
    '', // 4
    '"Who is there?" she **asked**. [Nobody](https://example.com/nobody) answered!', // 5
    '', // 6
    '- a list item about the dog', // 7
    '- another item, about the cat', // 8
    '', // 9
    'שלום לך אחותי היקרה. מה שלומך?', // 10
    '', // 11
    'It was a dark day, though.', // 12
  ].join('\n');

  it('finds a paragraph by the words it begins with, marks aside', () => {
    expect(lineOfSnippet(body, 'Chapter One')).toBe(0);
    expect(lineOfSnippet(body, 'It was a dark night. The harbour was empty, and Anna walked alone.')).toBe(2);
    expect(lineOfSnippet(body, '"Who is there?" she asked. Nobody answered!')).toBe(5);
    expect(lineOfSnippet(body, 'another item, about the cat')).toBe(8);
    expect(lineOfSnippet(body, 'It was a dark day, though.')).toBe(12);
  });

  it('finds a Hebrew paragraph', () => {
    expect(lineOfSnippet(body, 'שלום לך אחותי היקרה. מה שלומך?')).toBe(10);
  });

  it('goes by fewer words when a link stands between them in the note', () => {
    // As shown: "see Nobody answered the door at once"; in the note the link's address comes in between.
    const linked = 'Intro.\n\nSee [Nobody](https://example.com/who) answered the door at once.';
    expect(lineOfSnippet(linked, 'See Nobody answered the door at once.')).toBe(2);
  });

  it('says so when the words are not there', () => {
    expect(lineOfSnippet(body, 'Nothing of the kind was written')).toBeNull();
    expect(lineOfSnippet(body, '')).toBeNull();
    expect(lineOfSnippet(body, '  ... !')).toBeNull();
    expect(lineOfSnippet('', 'Anything')).toBeNull();
    // A paragraph of one word is found by that word.
    expect(lineOfSnippet('One.\n\nEnd.', 'End.')).toBe(2);
  });
});

describe('what a device remembers', () => {
  const view = (path: string | null, fraction = 0.25): RememberedView => ({
    scope: { kind: 'folder', id: 'f-one' },
    place: path === null ? null : { path, fraction },
  });

  it('comes back as it was saved', () => {
    const memory = remember(new Map(), 'Novel/Novel.md', view('Manuscript/Night.md', 0.123456));
    const text = writeMemory(memory);
    expect(typeof text).toBe('string');
    expect(readMemory(text)).toEqual(new Map([['Novel/Novel.md', view('Manuscript/Night.md', 0.123)]]));
    // The storage may hand the value back as what the text stands for.
    expect(readMemory(JSON.parse(text as string))).toEqual(readMemory(text));
  });

  it('saves nothing for a project that is at its top with the whole manuscript on show', () => {
    expect(writeMemory(new Map())).toBeNull();
    expect(writeMemory(remember(new Map(), 'Novel/Novel.md', DEFAULT_VIEW))).toBeNull();
    const two = remember(remember(new Map(), 'A/A.md', DEFAULT_VIEW), 'B/B.md', view(null));
    expect(Object.keys(JSON.parse(writeMemory(two) as string) as object)).toEqual(['B/B.md']);
  });

  it('takes anything that is not what it saved as nothing, piece by piece', () => {
    for (const junk of [null, undefined, 7, 'not json', '[1,2]', [], '"text"']) expect(readMemory(junk).size, String(junk)).toBe(0);
    const odd = readMemory({
      'A/A.md': { scope: { kind: 'folder', id: 5 }, place: { path: 'Manuscript/X.md', fraction: 'far' } },
      'B/B.md': { scope: 'all', place: { path: '', fraction: 0.5 } },
      'C/C.md': { scope: { kind: 'folder', id: 'f-1' }, place: { path: 'Manuscript/Y.md', fraction: 9 } },
      'D/D.md': 'nothing',
      '': { scope: { kind: 'manuscript' }, place: null },
    });
    expect([...odd.keys()]).toEqual(['A/A.md', 'B/B.md', 'C/C.md']);
    expect(odd.get('A/A.md')).toEqual({ scope: { kind: 'manuscript' }, place: { path: 'Manuscript/X.md', fraction: 0 } });
    expect(odd.get('B/B.md')).toEqual(DEFAULT_VIEW);
    expect(odd.get('C/C.md')).toEqual({ scope: { kind: 'folder', id: 'f-1' }, place: { path: 'Manuscript/Y.md', fraction: 1 } });
  });

  it('keeps the projects looked at last, and forgets the oldest when there are too many', () => {
    let memory = new Map<string, RememberedView>();
    for (let at = 0; at < MAX_REMEMBERED_PROJECTS + 5; at++) memory = remember(memory, `P${at}/P${at}.md`, view('Manuscript/S.md'));
    expect(memory.size).toBe(MAX_REMEMBERED_PROJECTS);
    expect(memory.has('P0/P0.md')).toBe(false);
    expect(memory.has('P5/P5.md')).toBe(true);
    // Looking at an old one again makes it the newest.
    memory = remember(memory, 'P5/P5.md', view(null));
    expect([...memory.keys()].pop()).toBe('P5/P5.md');
    expect(readMemory(writeMemory(memory)).size).toBe(MAX_REMEMBERED_PROJECTS);
  });

  it('goes with a project whose index note was renamed', () => {
    const memory = remember(new Map(), 'Novel/Novel.md', view('Manuscript/Night.md'));
    const moved = moveRemembered(memory, 'Novel/Novel.md', 'Saga/Saga.md');
    expect([...moved.keys()]).toEqual(['Saga/Saga.md']);
    expect(moved.get('Saga/Saga.md')).toEqual(view('Manuscript/Night.md'));
    expect([...moveRemembered(memory, 'Other/Other.md', 'X/X.md').keys()]).toEqual(['Novel/Novel.md']);
  });
});
