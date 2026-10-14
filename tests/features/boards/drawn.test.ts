// Laying out boards, and the boards drawn for the writer.

import { describe, expect, it } from 'vitest';
import {
  CARDS_PER_ROW,
  ENTITY_CARD,
  LABEL_HEIGHT,
  SCENE_CARD,
  boardColor,
  boardProblems,
  chapterCards,
  circle,
  entityWeb,
  force,
  labelWidth,
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

describe('boards that can be read at a glance', () => {
  /** The sample novel's world: fourteen entities, twelve relations, a pair joined only to each other. */
  const names = ['Ellen', 'Mara', 'Noa', 'Saltwick', 'Archive', 'Bell', 'Drowned', 'HarbourMaster', 'HarbourOffice', 'Keeper', 'Legend', 'Lighthouse', 'Tobias', 'Sea'];
  const sample = names.map((name): MapEntity => ({ key: name, file: `Novel/World/${name}.md`, color: 'blue' }));
  const pairs: Array<[string, string]> = [
    ['Mara', 'HarbourMaster'],
    ['Mara', 'Tobias'],
    ['Noa', 'Ellen'],
    ['Noa', 'Archive'],
    ['Archive', 'Saltwick'],
    ['Bell', 'Tobias'],
    ['Bell', 'Saltwick'],
    ['HarbourMaster', 'HarbourOffice'],
    ['Keeper', 'Lighthouse'],
    ['Legend', 'Drowned'],
    ['Lighthouse', 'Saltwick'],
    ['Sea', 'Keeper'],
  ];
  const relate = (list: Array<[string, string]>) => list.map(([from, to]) => ({ from, to, label: 'knows' }));
  const many = (count: number): MapEntity[] => Array.from({ length: count }, (_, index) => ({ key: `C${index}`, file: `Novel/World/C${index}.md`, color: null }));
  const chain = (count: number): Array<[string, string]> => Array.from({ length: count - 1 }, (_, index) => [`C${index}`, `C${index + 1}`]);
  // Some joined in small knots, some alone.
  const knots = (count: number): Array<[string, string]> =>
    Array.from({ length: count - 1 }, (_, index): [string, string] => [`C${(index * 7) % (index + 1)}`, `C${index + 1}`]).filter((_, index) => index % 3 !== 0);

  function size(board: NewBoard): { width: number; height: number } {
    const left = Math.min(...board.nodes.map((node) => node.x));
    const top = Math.min(...board.nodes.map((node) => node.y));
    const right = Math.max(...board.nodes.map((node) => node.x + node.width));
    const bottom = Math.max(...board.nodes.map((node) => node.y + node.height));
    return { width: right - left, height: bottom - top };
  }

  function longestEdge(board: NewBoard): number {
    const byId = new Map(board.nodes.map((node) => [node.id, node]));
    return Math.max(
      0,
      ...board.edges.map((edge) => {
        const a = byId.get(edge.fromNode) as NewCard;
        const b = byId.get(edge.toNode) as NewCard;
        return Math.hypot(a.x + a.width / 2 - (b.x + b.width / 2), a.y + a.height / 2 - (b.y + b.height / 2));
      }),
    );
  }

  /** At most three card widths per side for each square root of the number of cards. */
  function expectCompact(board: NewBoard): void {
    const bound = 3 * Math.sqrt(board.nodes.length) * ENTITY_CARD.width;
    const { width, height } = size(board);
    expect(width).toBeLessThanOrEqual(bound);
    expect(height).toBeLessThanOrEqual(bound);
  }

  const cases: Array<[string, MapEntity[], Array<[string, string]>]> = [
    ['the sample novel', sample, pairs],
    ['a chain of forty', many(40), chain(40)],
    ['forty in knots and alone', many(40), knots(40)],
    ['forty joined to nothing', many(40), []],
  ];

  it.each(cases)('draws %s small, with no card overlapping or crowding another, on whole numbers', (_, entities, list) => {
    const board = relationMap(entities, relate(list));
    expectValid(board);
    expectCompact(board);
    expectNoOverlap(board.nodes.map((node) => ({ ...node, x: node.x - 30, y: node.y - 30, width: node.width + 60, height: node.height + 60 })));
  });

  it.each(cases.slice(0, 3))('keeps every edge of %s short', (_, entities, list) => {
    expect(longestEdge(relationMap(entities, relate(list)))).toBeLessThan(ENTITY_CARD.width * 2.5);
  });

  it('keeps a card joined to the others near them, and one joined to nothing close by', () => {
    const board = relationMap([...sample, { key: 'Lonely', file: 'Novel/World/Lonely.md', color: null }], relate(pairs));
    expectCompact(board);
    const lonely = board.nodes[board.nodes.length - 1] as NewCard;
    const others = board.nodes.slice(0, -1);
    const nearest = Math.min(...others.map((node) => Math.hypot(node.x - lonely.x, node.y - lonely.y)));
    expect(nearest).toBeLessThan(ENTITY_CARD.width * 2.5);
  });

  it('draws the same sample the same way every time', () => {
    expect(relationMap(sample, relate(pairs))).toEqual(relationMap(sample, relate(pairs)));
  });

  it('keeps the sides of the entity free for the edges to its boxes, and the boxes near square', () => {
    const related = Array.from({ length: 7 }, (_, index) => ({ file: `Novel/World/R${index}.md`, color: null, label: 'knows', way: 'out' as const }));
    const board = entityWeb({
      center: { file: 'Novel/World/Noa.md', color: 'blue' },
      related,
      scenes: Array.from({ length: 11 }, (_, index) => `Novel/Manuscript/S${index}.md`),
      events: ['Novel/Timeline/E.md'],
      sceneLabel: 'Scenes',
      eventLabel: 'Events',
    });
    expectValid(board);
    const center = board.nodes[0] as NewCard;
    const ring = board.nodes.slice(1, 8);
    // No related card stands level with the entity, where the edges to the boxes run.
    for (const card of ring) expect(card.y + card.height <= center.y || card.y >= center.y + center.height).toBe(true);
    expectNoOverlap([center, ...ring, ...board.nodes.filter((node) => node.type === 'group')]);
    const scenes = board.nodes.find((node) => node.type === 'group' && node.label === 'Scenes') as NewCard;
    expect(scenes.width / scenes.height).toBeGreaterThan(0.8);
    expect(scenes.width / scenes.height).toBeLessThan(2);
    expect(longestEdge({ nodes: [center, ...ring], edges: board.edges.slice(0, 7) })).toBeLessThan(ENTITY_CARD.width * 3);
    const { width, height } = size(board);
    expect(width).toBeLessThan(4000);
    expect(height).toBeLessThan(1500);
  });
});

describe('room for the labels of edges', () => {
  // The sample novel's relations, with the labels it gives them: on 0.10.0 a long one was
  // squeezed between two cards ("kept it for thirty years" between the lighthouse and its keeper).
  const relations: Array<[string, string, string]> = [
    ['Mara', 'HarbourMaster', 'hired by'],
    ['Mara', 'Tobias', 'surveys the bay with'],
    ['Noa', 'Ellen', 'sister'],
    ['Noa', 'Archive', 'keeps'],
    ['Archive', 'Saltwick', 'in'],
    ['Bay', 'Saltwick', 'live in'],
    ['Bell', 'Bay', 'told by'],
    ['Bell', 'Saltwick', 'told in'],
    ['HarbourMaster', 'HarbourOffice', 'runs'],
    ['Keeper', 'Lighthouse', 'kept it for thirty years'],
    ['Keeper', 'Logbook', 'wrote'],
    ['Legend', 'Drowned', 'is about'],
    ['Legend', 'Bay', 'told by'],
    ['Logbook', 'Archive', 'kept in'],
    ['Chart', 'HarbourOffice', 'belongs to'],
    ['Lighthouse', 'Saltwick', 'on the point by'],
    ['Hound', 'Bay', 'feared by'],
    ['Tobias', 'Bay', 'born among'],
    ['Sea', 'Keeper', 'written by'],
    ['Sea', 'Logbook', 'written on the last page of'],
  ];
  const names = [...new Set(relations.flatMap(([a, b]) => [a, b]))];
  const entities = names.map((name): MapEntity => ({ key: name, file: `Novel/World/${name}.md`, color: null }));

  /** The cards, and the other labels, that a label, drawn in the middle between its two cards, would lie on. */
  function underLabels(board: NewBoard): string[] {
    const byId = new Map(board.nodes.map((node) => [node.id, node]));
    const found: string[] = [];
    const boxes: Array<[string, NewCard]> = [];
    for (const edge of board.edges) {
      if (!edge.label) continue;
      const a = byId.get(edge.fromNode) as NewCard;
      const b = byId.get(edge.toNode) as NewCard;
      const cx = (a.x + a.width / 2 + b.x + b.width / 2) / 2;
      const cy = (a.y + a.height / 2 + b.y + b.height / 2) / 2;
      const width = labelWidth(edge.label);
      const box = { x: cx - width / 2, y: cy - LABEL_HEIGHT / 2, width, height: LABEL_HEIGHT } as NewCard;
      for (const node of board.nodes) if (node.type !== 'group' && overlaps(box, node)) found.push(`${edge.label} on ${node.type === 'file' ? node.file : node.id}`);
      for (const [other, otherBox] of boxes) if (overlaps(box, otherBox)) found.push(`${edge.label} on the label ${other}`);
      boxes.push([edge.label, box]);
    }
    return found;
  }

  it('takes a label to be as wide as Canvas draws it, and a little more', () => {
    // Measured in Canvas: 151 units for "hired by", 358 for "kept it for thirty years", 436 for "written on the last page of".
    expect(labelWidth('hired by')).toBeGreaterThanOrEqual(151);
    expect(labelWidth('kept it for thirty years')).toBeGreaterThanOrEqual(358);
    expect(labelWidth('written on the last page of')).toBeGreaterThanOrEqual(436);
    expect(labelWidth('  ')).toBe(0);
  });

  it('leaves no label of the relationship map lying on a card or on another label', () => {
    const board = relationMap(entities, relations.map(([from, to, label]) => ({ from, to, label })));
    expectValid(board);
    expect(underLabels(board)).toEqual([]);
    expectNoOverlap(board.nodes);
  });

  it('leaves no label of the web around one entity lying on a card or on another label', () => {
    const related = ['kept it for thirty years', 'wrote', 'written by', 'the one who rang the fog bell', 'lives in', 'sister'].map((label, index) => ({
      file: `Novel/World/R${index}.md`,
      color: null,
      label,
      way: 'out' as const,
    }));
    const board = entityWeb({ center: { file: 'Novel/World/Keeper.md', color: null }, related, scenes: [], events: [], sceneLabel: 'Scenes', eventLabel: 'Events' });
    expectValid(board);
    expect(underLabels(board)).toEqual([]);
    expectNoOverlap(board.nodes);
  });
});
