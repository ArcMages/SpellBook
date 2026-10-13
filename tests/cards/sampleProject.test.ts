// The corkboard of the sample novel: the engine run on the same scenes,
// English and Hebrew, that the "Create sample project" command writes.

import { describe, expect, it } from 'vitest';
import { addTag, buildBoard, buildInspector, readTagLists, unlistedTags } from '../../src/core/cards';
import type { BoardCard, SceneCard, SceneData, SceneProperties } from '../../src/core/cards';
import { isFolderSeed } from '../../src/core/projectSeed';
import type { BinderSeed, SceneSeed } from '../../src/core/projectSeed';
import { sampleProject } from '../../src/core/sampleProject';
import { ROUGH_NOTES_COMMENT, SAMPLE_CHARACTERS } from '../../src/core/sampleText';
import { newSceneFrontmatter } from '../../src/core/scene';
import type { TreeNode } from '../../src/core/types';
import { countWords } from '../../src/core/wordCount';

const ELLIPSIS = '\u{2026}';
const HEBREW_LETTER = /[\u{5D0}-\u{5EA}]/u;

const seed = sampleProject('2026-10-13');
const scenes: SceneSeed[] = [];
const data = new Map<string, SceneData>();
const withoutSynopsis = new Map<string, SceneData>();

function pathOf(scene: SceneSeed): string {
  return `Manuscript/${scene.title}.md`;
}

/** The tree the views would be given for the sample project. */
function plant(seeds: readonly BinderSeed[], trail: string): TreeNode[] {
  return seeds.map((item, position): TreeNode => {
    if (isFolderSeed(item)) {
      return { kind: 'folder', id: `f${trail}-${position}`, name: item.folder, children: plant(item.children, `${trail}-${position}`) };
    }
    scenes.push(item);
    const body = item.body ?? '';
    const details = { synopsis: item.synopsis, status: item.status, label: item.label };
    const frontmatter = newSceneFrontmatter(scenes.length, '2026-10-01', details);
    // The note as stored: a properties block, then the scene.
    const text = `---\nstatus: ${item.status ?? ''}\nlabel: ${item.label ?? ''}\n---\n${body}`;
    data.set(pathOf(item), { frontmatter, text, words: countWords(text) });
    withoutSynopsis.set(pathOf(item), { frontmatter: { ...frontmatter, synopsis: '' }, text, words: countWords(text) });
    return { kind: 'scene', path: pathOf(item), title: item.title, missing: false };
  });
}

const tree = plant(seed.binder, '');
const lists = readTagLists({ spellbook: 'project', version: 1, binder: [] });

/** Every scene card of the project, by walking into each folder card. */
function allSceneCards(known: Map<string, SceneData>): SceneCard[] {
  const out: SceneCard[] = [];
  const visit = (cards: readonly BoardCard[]): void => {
    for (const card of cards) {
      if (card.kind === 'scene') out.push(card);
      else visit(buildBoard({ tree, scope: card.opens, sceneOf: (path) => known.get(path), lists }).cards);
    }
  };
  visit(buildBoard({ tree, sceneOf: (path) => known.get(path), lists }).cards);
  return out;
}

/** The prose of a scene, worked out the plain way: no comments, lines joined by single spaces. */
function proseOf(scene: SceneSeed): string {
  return (scene.body ?? '')
    .split(ROUGH_NOTES_COMMENT)
    .join('')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .join(' ');
}

describe('the corkboard of the sample novel', () => {
  it('has scenes in both languages to work with', () => {
    expect(scenes.length).toBeGreaterThan(20);
    expect(scenes.filter((scene) => HEBREW_LETTER.test(scene.body ?? '')).length).toBeGreaterThanOrEqual(2);
    expect(scenes.filter((scene) => (scene.body ?? '').startsWith(ROUGH_NOTES_COMMENT)).length).toBeGreaterThan(0);
  });

  it('shows the top level as the binder has it: a scene, the folders, a scene', () => {
    const top = buildBoard({ tree, sceneOf: (path) => data.get(path), lists });
    const kinds = top.cards.map((card) => card.kind);
    expect(kinds[0]).toBe('scene');
    expect(kinds[kinds.length - 1]).toBe('scene');
    expect(kinds.slice(1, -1).every((kind) => kind === 'folder')).toBe(true);
    expect(top.cards.map((card) => (card.kind === 'scene' ? card.title : card.name))).toEqual(
      seed.binder.map((item) => (isFolderSeed(item) ? item.folder : item.title)),
    );
  });

  it('counts the scenes and the words of every folder, and of the whole manuscript', () => {
    const top = buildBoard({ tree, sceneOf: (path) => data.get(path), lists });
    const wordsOf = (items: readonly BinderSeed[]): number =>
      items.reduce((sum, item) => sum + (isFolderSeed(item) ? wordsOf(item.children) : (data.get(pathOf(item))?.words ?? 0)), 0);
    seed.binder.forEach((item, position) => {
      const card = top.cards[position];
      if (!isFolderSeed(item) || card?.kind !== 'folder') return;
      expect(card.sceneCount, item.folder).toBe(item.children.length);
      expect(card.words, item.folder).toBe(wordsOf(item.children));
      expect(card.missingCount).toBe(0);
    });
    expect(top.sceneCount).toBe(scenes.length);
    expect(top.words).toBe(wordsOf(seed.binder));
    expect(top.words).toBeGreaterThan(10000);
  });

  it('reaches every scene by opening folder cards, in manuscript order', () => {
    expect(allSceneCards(data).map((card) => card.title)).toEqual(scenes.map((scene) => scene.title));
  });

  it('shows each scene with its own synopsis, word count and status colour', () => {
    const cards = allSceneCards(data);
    cards.forEach((card, position) => {
      const scene = scenes[position] as SceneSeed;
      expect(card.synopsis, scene.title).toBe(scene.synopsis);
      expect(card.synopsisDerived).toBe(false);
      expect(card.words).toBe(data.get(card.path)?.words);
      expect(card.status?.listed, scene.title).toBe(true);
      expect(card.status?.color, scene.title).not.toBeNull();
      expect(card.missing).toBe(false);
      expect(card.compile).toBe(true);
    });
    // The four built-in statuses are all in use, each with its own colour.
    expect(new Set(cards.map((card) => card.status?.color)).size).toBe(4);
  });

  it('makes a preview for every scene when the synopses are taken away', () => {
    const cards = allSceneCards(withoutSynopsis);
    cards.forEach((card, position) => {
      const scene = scenes[position] as SceneSeed;
      const prose = proseOf(scene);
      expect(card.synopsisDerived, scene.title).toBe(true);
      // The rough-notes comment and the properties block never show.
      expect(card.synopsis, scene.title).not.toContain('Rough notes');
      expect(card.synopsis).not.toContain('%%');
      expect(card.synopsis).not.toContain('---');
      if (prose.length <= 200) {
        expect(card.synopsis, scene.title).toBe(prose);
        return;
      }
      expect(card.synopsis.endsWith(ELLIPSIS), scene.title).toBe(true);
      const body = card.synopsis.slice(0, -1);
      expect(prose.startsWith(body), scene.title).toBe(true);
      expect(body.length, scene.title).toBeLessThanOrEqual(200);
      expect(body.length, scene.title).toBeGreaterThan(150);
      // It stops at the end of a word: what follows is a space, perhaps after a dropped comma.
      expect(prose.slice(body.length), scene.title).toMatch(/^[,;:-]* /);
    });
  });

  it('cuts the Hebrew scenes between words like the English ones', () => {
    const hebrew = allSceneCards(withoutSynopsis).filter((card) => HEBREW_LETTER.test(card.synopsis));
    expect(hebrew.length).toBeGreaterThanOrEqual(2);
    for (const card of hebrew) {
      const scene = scenes.find((candidate) => pathOf(candidate) === card.path) as SceneSeed;
      const prose = proseOf(scene);
      expect(prose.length).toBeGreaterThan(200);
      const body = card.synopsis.slice(0, -1);
      expect(card.synopsis.endsWith(ELLIPSIS)).toBe(true);
      expect(prose.startsWith(body)).toBe(true);
      expect(prose.slice(body.length)).toMatch(/^[,;:-]* /);
      expect(HEBREW_LETTER.test(body.charAt(body.length - 1)) || /[.!?"']/.test(body.charAt(body.length - 1))).toBe(true);
    }
  });

  it('reports the three characters as labels the project has not listed yet, and colours them once added', () => {
    const properties: SceneProperties[] = scenes.map((scene) => ({ path: pathOf(scene), frontmatter: data.get(pathOf(scene))?.frontmatter }));
    const unlisted = unlistedTags(lists.labels, properties);
    expect(unlisted.map((entry) => entry.name).sort()).toEqual([...SAMPLE_CHARACTERS].sort());
    expect(unlisted.reduce((sum, entry) => sum + entry.paths.length, 0)).toBe(scenes.length);
    expect(unlistedTags(lists.statuses, properties)).toEqual([]);
    expect(allSceneCards(data).every((card) => card.label?.listed === false && card.label.color === null)).toBe(true);

    let labels = lists.labels;
    const colors = ['purple', 'cyan', 'pink'] as const;
    unlisted.forEach((entry, position) => {
      const added = addTag(labels, entry.name, colors[position % colors.length]);
      if (!added.ok) throw new Error(added.message);
      labels = added.list;
    });
    const coloured = { statuses: lists.statuses, labels };
    const top = buildBoard({ tree, sceneOf: (path) => data.get(path), lists: coloured });
    const first = top.cards[0];
    expect(first?.kind === 'scene' && first.label?.listed).toBe(true);
    expect(first?.kind === 'scene' && first.label?.color).not.toBeNull();
    expect(unlistedTags(labels, properties)).toEqual([]);
  });

  it('opens every scene in the inspector without a complaint', () => {
    for (const scene of scenes) {
      const model = buildInspector({ path: pathOf(scene), frontmatter: data.get(pathOf(scene))?.frontmatter }, lists);
      expect(model.problems, scene.title).toEqual([]);
      expect(model.title).toBe(scene.title);
      expect(model.synopsis).toBe(scene.synopsis);
      expect(model.statusOptions.filter((option) => option.selected), scene.title).toHaveLength(1);
      expect(model.createdText).toBe('1 Oct 2026');
    }
  });
});
