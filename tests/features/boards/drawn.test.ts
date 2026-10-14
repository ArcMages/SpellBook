// Laying out boards, and the boards drawn for the writer.

import { describe, expect, it } from 'vitest';
import {
  CARDS_PER_ROW,
  ENTITY_CARD,
  SCENE_CARD,
  boardColor,
  boardProblems,
  chapterCards,
  circle,
  entityWeb,
  force,
  readBoard,
  relationMap,
  spread,
  writeBoard,
} from '../../../src/core/boards';
import type { MapEntity, NewBoard, NewCard, Size } from '../../../src/core/boards';

/** True when two cards of the board overlap. */
function overlaps(a: NewCard, b: NewCard): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

function expectValid(board: NewBoard): void {
  expect(boardProblems(board)).toEqual([]);
  for (const node of board.nodes) {
    for (const value of [node.x, node.y, node.width, node.height]) expect(Number.isInteger(value)).toBe(true);
  }
  // It goes through the writer and back.
  expect(readBoard(writeBoard(board))?.cards).toHaveLength(board.nodes.length);
}

function expectNoOverlap(cards: readonly NewCard[]): void {
  for (let i = 0; i < cards.length; i++) {
    for (let j = i + 1; j < cards.length; j++) {
      expect(overlaps(cards[i] as NewCard, cards[j] as NewCard), `${i} and ${j}`).toBe(false);
    }
  }
}

describe('layouts', () => {
  it('puts cards evenly round a circle, the first at the top', () => {
    const points = circle(4, 100);
    expect(points[0]?.x).toBeCloseTo(0);
    expect(points[0]?.y).toBeCloseTo(-100);
    expect(points[1]?.x).toBeCloseTo(100);
    expect(points[2]?.y).toBeCloseTo(100);
  });

  it('lays out by force the same way every time, with joined cards nearer each other', () => {
    const edges: Array<[number, number]> = [
      [0, 1],
      [1, 2],
      [3, 4],
    ];
    const first = force(6, edges, { length: 300 });
    expect(force(6, edges, { length: 300 })).toEqual(first);
    const distance = (a: number, b: number): number => Math.hypot((first[a]?.x ?? 0) - (first[b]?.x ?? 0), (first[a]?.y ?? 0) - (first[b]?.y ?? 0));
    expect(distance(0, 1)).toBeLessThan(distance(0, 4));
    for (const point of first) {
      expect(Number.isFinite(point.x) && Number.isFinite(point.y)).toBe(true);
    }
    expect(force(0, [], { length: 100 })).toEqual([]);
    expect(force(1, [[0, 5]], { length: 100 })).toHaveLength(1);
  });

  it('pushes overlapping cards apart until none overlap', () => {
    const size: Size = { width: 100, height: 50 };
    const points = spread(
      [
        { x: 0, y: 0 },
        { x: 0, y: 0 },
        { x: 10, y: 5 },
        { x: 20, y: 0 },
      ],
      size,
      10,
    );
    for (let i = 0; i < points.length; i++) {
      for (let j = i + 1; j < points.length; j++) {
        const a = points[i] ?? { x: 0, y: 0 };
        const b = points[j] ?? { x: 0, y: 0 };
        expect(Math.abs(a.x - b.x) >= 110 - 1e-6 || Math.abs(a.y - b.y) >= 60 - 1e-6).toBe(true);
      }
    }
  });

  it('gives each of the eight colours the nearest of Canvas\'s six', () => {
    expect(['red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'purple', 'pink'].map((color) => boardColor(color as never))).toEqual(['1', '2', '3', '4', '5', '5', '6', '6']);
    expect(boardColor(null)).toBeUndefined();
  });
});

describe('the relationship map', () => {
  const entity = (key: string, color: MapEntity['color'] = 'blue'): MapEntity => ({ key, file: `Novel/${key}`, color });
  const entities = [entity('World/Characters/Mara.md'), entity('World/Characters/Joss.md'), entity('World/Characters/מארה.md'), entity('World/Factions/Guild.md', 'red')];

  it('has a card for each entity, coloured by its type, and does not let them overlap', () => {
    const board = relationMap(entities, []);
    expectValid(board);
    expect(board.nodes.map((node) => (node.type === 'file' ? node.file : ''))).toEqual(entities.map((item) => item.file));
    expect(board.nodes.map((node) => node.color)).toEqual(['5', '5', '5', '1']);
    expect(board.nodes.every((node) => node.width === ENTITY_CARD.width && node.height === ENTITY_CARD.height)).toBe(true);
    expectNoOverlap(board.nodes);
  });

  it('draws a relation listed on both sides once, with both labels and no arrows', () => {
    const board = relationMap(entities, [
      { from: 'World/Characters/Mara.md', to: 'World/Characters/Joss.md', label: 'sister' },
      { from: 'World/Characters/Joss.md', to: 'World/Characters/Mara.md', label: 'brother' },
      { from: 'World/Characters/Mara.md', to: 'World/Characters/מארה.md', label: 'אחות' },
      { from: 'World/Characters/Mara.md', to: 'World/Characters/מארה.md', label: '' },
      { from: 'World/Factions/Guild.md', to: 'World/Characters/Joss.md', label: 'employs' },
      { from: 'World/Characters/Mara.md', to: 'World/Characters/Mara.md', label: 'self' },
      { from: 'World/Characters/Mara.md', to: 'World/Places/Elsewhere.md', label: 'lives in' },
    ]);
    expectValid(board);
    expect(board.edges).toHaveLength(3);
    const ids = new Map(board.nodes.map((node, index) => [node.id, entities[index]?.key]));
    const shown = board.edges.map((edge) => [ids.get(edge.fromNode), ids.get(edge.toNode), edge.label ?? '', edge.toEnd ?? 'arrow']);
    expect(shown).toEqual([
      ['World/Characters/Mara.md', 'World/Characters/Joss.md', 'sister / brother', 'none'],
      ['World/Characters/Mara.md', 'World/Characters/מארה.md', 'אחות', 'arrow'],
      ['World/Factions/Guild.md', 'World/Characters/Joss.md', 'employs', 'arrow'],
    ]);
  });

  it('says a label once when both sides give the same one', () => {
    const board = relationMap(entities.slice(0, 2), [
      { from: 'World/Characters/Mara.md', to: 'World/Characters/Joss.md', label: 'friend' },
      { from: 'World/Characters/Joss.md', to: 'World/Characters/Mara.md', label: 'friend' },
    ]);
    expect(board.edges.map((edge) => edge.label)).toEqual(['friend']);
  });

  it('is the same board every time for the same world', () => {
    const relations = [{ from: 'World/Characters/Mara.md', to: 'World/Characters/Joss.md', label: 'x' }];
    expect(relationMap(entities, relations)).toEqual(relationMap(entities, relations));
  });

  it('copes with many entities', () => {
    const many = Array.from({ length: 40 }, (_, index) => entity(`World/Characters/C${index}.md`));
    const relations = many.slice(1).map((item, index) => ({ from: many[index]?.key ?? '', to: item.key, label: '' }));
    const board = relationMap(many, relations);
    expectValid(board);
    expectNoOverlap(board.nodes);
  });
});

describe('a chapter as cards', () => {
  const scenes = (count: number, prefix: string): string[] => Array.from({ length: count }, (_, index) => `Novel/Manuscript/${prefix} ${index + 1}.md`);

  it('puts the scenes in reading order, a few to a row, with no box when they are not grouped', () => {
    const board = chapterCards([{ name: null, color: null, scenes: scenes(6, 'Scene') }]);
    expectValid(board);
    expect(board.nodes.every((node) => node.type === 'file')).toBe(true);
    expect(board.nodes.map((node) => (node.type === 'file' ? node.file : ''))).toEqual(scenes(6, 'Scene'));
    // The first row holds CARDS_PER_ROW cards, left to right in the board's own coordinates; then the next row.
    const ys = board.nodes.map((node) => node.y);
    expect(new Set(ys.slice(0, CARDS_PER_ROW)).size).toBe(1);
    expect(ys[CARDS_PER_ROW]).toBeGreaterThan(ys[0] ?? 0);
    expect(board.nodes[1]?.x).toBeGreaterThan(board.nodes[0]?.x ?? 0);
    expect(board.nodes[0]?.width).toBe(SCENE_CARD.width);
    expectNoOverlap(board.nodes);
  });

  it('gives each group a labelled box, in the order given, with its cards inside it in its colour', () => {
    const board = chapterCards([
      { name: 'To do', color: 'red', scenes: scenes(2, 'Todo') },
      { name: 'Empty', color: null, scenes: [] },
      { name: 'טיוטה ראשונה', color: 'green', scenes: scenes(5, 'Draft') },
    ]);
    expectValid(board);
    const groups = board.nodes.filter((node) => node.type === 'group');
    expect(groups.map((node) => (node.type === 'group' ? node.label : ''))).toEqual(['To do', 'טיוטה ראשונה']);
    expect(groups.map((node) => node.color)).toEqual(['1', '4']);
    const cards = board.nodes.filter((node) => node.type === 'file');
    expect(cards).toHaveLength(7);
    // Each card lies inside its group's box.
    for (const card of cards) {
      const box = (card.type === 'file' && card.file.includes('Todo') ? groups[0] : groups[1]) as NewCard;
      expect(card.x >= box.x && card.y >= box.y && card.x + card.width <= box.x + box.width && card.y + card.height <= box.y + box.height).toBe(true);
      expect(card.color).toBe(box.color);
    }
    // The boxes do not overlap.
    expect(overlaps(groups[0] as NewCard, groups[1] as NewCard)).toBe(false);
  });
});

describe('around one entity', () => {
  const web = {
    center: { file: 'Novel/World/Characters/Mara.md', color: 'blue' as const },
    related: [
      { file: 'Novel/World/Characters/Joss.md', color: 'blue' as const, label: 'brother', way: 'both' as const },
      { file: 'Novel/World/Places/Saltwick.md', color: 'green' as const, label: 'lives in', way: 'out' as const },
      { file: 'Novel/World/Factions/Guild.md', color: 'red' as const, label: '', way: 'in' as const },
    ],
    scenes: ['Novel/Manuscript/Opening.md', 'Novel/Manuscript/לילה בנמל.md', 'Novel/Manuscript/Closing.md'],
    events: ['Novel/Timeline/The storm.md'],
    sceneLabel: 'Scenes',
    eventLabel: 'Events',
  };

  it('puts the entity in the middle, the related ones round it, and boxes of scenes and events beside them', () => {
    const board = entityWeb(web);
    expectValid(board);
    const center = board.nodes[0] as NewCard;
    expect(center.type === 'file' && center.file).toBe(web.center.file);
    expect(center.x + center.width / 2).toBe(0);
    const groups = board.nodes.filter((node) => node.type === 'group');
    expect(groups.map((node) => (node.type === 'group' ? node.label : ''))).toEqual(['Scenes', 'Events']);
    // An edge to each related entity, with the relation's label and its way round, and one to each box.
    const center_edges = board.edges.filter((edge) => edge.fromNode === center.id || edge.toNode === center.id);
    expect(center_edges).toHaveLength(5);
    expect(board.edges.map((edge) => edge.label ?? '')).toEqual(['brother', 'lives in', '', '', '']);
    expect(board.edges[2]?.toNode).toBe(center.id); // the guild lists her
    expect(board.edges[0]?.toEnd).toBe('none');
    // Nothing overlaps but the cards in their own boxes.
    const loose = board.nodes.filter((node) => node.type !== 'group' && !groups.some((group) => overlaps(group, node)));
    expect(loose).toHaveLength(4);
    expectNoOverlap([...loose, ...groups]);
  });

  it('leaves out a box with nothing in it, and copes with an entity that has nothing at all', () => {
    const alone = entityWeb({ ...web, related: [], scenes: [], events: [] });
    expectValid(alone);
    expect(alone.nodes).toHaveLength(1);
    expect(alone.edges).toEqual([]);
    const scenesOnly = entityWeb({ ...web, related: [], events: [] });
    expectValid(scenesOnly);
    expect(scenesOnly.nodes.filter((node) => node.type === 'group')).toHaveLength(1);
  });
});
