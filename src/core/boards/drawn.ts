// Boards drawn for the writer: what is on them and where.
//
//   relationMap  the world's characters (and places, factions...) as cards
//                coloured by their type, an edge for each relation
//   chapterCards the scenes of a part of the binder in reading order, in
//                rows, grouped by status or label
//   entityWeb    one entity in the middle, the entities it has to do with
//                round it, its scenes and its events in two boxes beside it
//
// Each builder takes plain values (vault paths, names, colours) and returns
// a whole new board; writeBoard turns it into the file's text. Nothing here
// reads the project: the plugin hands in what it found.

import type { CardColor } from '../cards/colors';
import { boardId } from './canvas';
import type { BoardColor, NewBoard, NewCard, NewEdge } from './canvas';
import { rows, spread, toCorner, web } from './layout';
import type { Point, Size } from './layout';

/** The size of a card that stands for an entity. */
export const ENTITY_CARD: Size = { width: 280, height: 120 };
/** The size of a card that stands for a scene: room for the start of its text. */
export const SCENE_CARD: Size = { width: 320, height: 200 };
/** The room between two cards. */
export const CARD_GAP = 60;
/** The room between two cards on a relationship map: enough for an edge's label. */
export const MAP_GAP = 140;
/** How many scene cards stand in one row. */
export const CARDS_PER_ROW = 4;
/** The room between a group's box and the cards in it. */
export const GROUP_PADDING = 40;

/**
 * The Canvas colour nearest to one of the eight colours of a status, a label
 * or an entity type. Canvas has six that follow the theme (red, orange,
 * yellow, green, cyan, purple): blue is drawn as cyan, and pink as purple.
 */
export function boardColor(color: CardColor | null | undefined): BoardColor | undefined {
  switch (color) {
    case 'red':
      return '1';
    case 'orange':
      return '2';
    case 'yellow':
      return '3';
    case 'green':
      return '4';
    case 'cyan':
    case 'blue':
      return '5';
    case 'purple':
    case 'pink':
      return '6';
    default:
      return undefined;
  }
}

const withColor = (color: CardColor | null | undefined): { color?: BoardColor } => {
  const found = boardColor(color);
  return found === undefined ? {} : { color: found };
};

// ------------------------------------------------------------ relation map

/** An entity on a relationship map. */
export interface MapEntity {
  /** What relations name it by: its path in the project. */
  readonly key: string;
  /** Its note's vault path: what the card shows. */
  readonly file: string;
  /** Its type's colour; null for none. */
  readonly color: CardColor | null;
}

/** One relation, as the entity `from` lists it. */
export interface MapRelation {
  readonly from: string;
  readonly to: string;
  /** The writer's label; "" for none. */
  readonly label: string;
}

/**
 * A relationship map: a card for each entity, and one edge for each pair
 * that has to do with each other, however many times and from whichever
 * side it is written. An edge one side lists points from it to the other;
 * one both sides list has no arrows, and both labels when they differ
 * ("sister / brother"). Relations with an entity that is not on the map,
 * and an entity's relation with itself, are left out. Laid out by a force
 * layout: related cards near each other, the ones related to nothing in a
 * row under them.
 */
export function relationMap(entities: readonly MapEntity[], relations: readonly MapRelation[]): NewBoard {
  const indexOf = new Map(entities.map((entity, index) => [entity.key, index]));
  interface Pair {
    a: number;
    b: number;
    ab: string | null;
    ba: string | null;
  }
  const pairs = new Map<string, Pair>();
  for (const relation of relations) {
    const from = indexOf.get(relation.from);
    const to = indexOf.get(relation.to);
    if (from === undefined || to === undefined || from === to) continue;
    const a = Math.min(from, to);
    const b = Math.max(from, to);
    const key = `${a}:${b}`;
    const pair = pairs.get(key) ?? { a, b, ab: null, ba: null };
    const label = relation.label.trim();
    if (from === a) pair.ab = pair.ab === null || pair.ab === '' ? label : pair.ab;
    else pair.ba = pair.ba === null || pair.ba === '' ? label : pair.ba;
    pairs.set(key, pair);
  }

  const joined = [...pairs.values()].map((pair): [number, number] => [pair.a, pair.b]);
  const middles = web(entities.length, joined, ENTITY_CARD, MAP_GAP);
  const taken = new Set<string>();
  const nodes: NewCard[] = entities.map((entity, index) => ({
    id: boardId(`entity:${entity.key}`, taken),
    type: 'file',
    file: entity.file,
    ...toCorner(middles[index] as Point, ENTITY_CARD),
    width: ENTITY_CARD.width,
    height: ENTITY_CARD.height,
    ...withColor(entity.color),
  }));

  const edges: NewEdge[] = [];
  for (const pair of pairs.values()) {
    const first = nodes[pair.a] as NewCard;
    const second = nodes[pair.b] as NewCard;
    const both = pair.ab !== null && pair.ba !== null;
    // An edge one side lists runs from that side to the other.
    const [from, to] = pair.ab !== null ? [first, second] : [second, first];
    const labels = [pair.ab, pair.ba].filter((label): label is string => label !== null && label !== '');
    const label = labels.length === 2 && labels[0] === labels[1] ? labels[0] : labels.join(' / ');
    edges.push({
      id: boardId(`relation:${entities[pair.a]?.key ?? ''}:${entities[pair.b]?.key ?? ''}`, taken),
      fromNode: from.id,
      toNode: to.id,
      ...(both ? { fromEnd: 'none' as const, toEnd: 'none' as const } : {}),
      ...(label !== undefined && label !== '' ? { label } : {}),
    });
  }
  return { nodes, edges };
}

// ---------------------------------------------------------- chapter cards

/** A group of scenes on a chapter board: those that share a status or a label. */
export interface SceneGroup {
  /** The status or label; null for the scenes without one, or for no grouping at all. */
  readonly name: string | null;
  readonly color: CardColor | null;
  /** The scenes' vault paths, in reading order. */
  readonly scenes: readonly string[];
}

/**
 * A chapter as cards: each scene a card, in reading order, a few to a row.
 * With more than one group (or one with a name), each group is a labelled
 * box of its own, one under the other, in the order given; the cards take
 * the group's colour.
 */
export function chapterCards(groups: readonly SceneGroup[]): NewBoard {
  const used = groups.filter((group) => group.scenes.length > 0);
  const boxed = used.length > 1 || used.some((group) => group.name !== null);
  const taken = new Set<string>();
  const nodes: NewCard[] = [];
  let top = 0;
  for (const [number, group] of used.entries()) {
    const middles = rows(group.scenes.length, CARDS_PER_ROW, SCENE_CARD, CARD_GAP);
    const across = Math.min(group.scenes.length, CARDS_PER_ROW);
    const down = Math.ceil(group.scenes.length / CARDS_PER_ROW);
    const pad = boxed ? GROUP_PADDING : 0;
    if (boxed) {
      nodes.push({
        id: boardId(`group:${number}:${group.name ?? ''}`, taken),
        type: 'group',
        x: 0,
        y: top,
        width: across * SCENE_CARD.width + (across - 1) * CARD_GAP + 2 * pad,
        height: down * SCENE_CARD.height + (down - 1) * CARD_GAP + 2 * pad,
        ...(group.name !== null ? { label: group.name } : {}),
        ...withColor(group.color),
      });
    }
    for (const [index, file] of group.scenes.entries()) {
      const middle = middles[index] as Point;
      nodes.push({
        id: boardId(`scene:${file}`, taken),
        type: 'file',
        file,
        x: Math.round(middle.x + pad),
        y: Math.round(middle.y + top + pad),
        width: SCENE_CARD.width,
        height: SCENE_CARD.height,
        ...withColor(group.color),
      });
    }
    // The next group starts below this one, with room for its label.
    top += down * SCENE_CARD.height + (down - 1) * CARD_GAP + 2 * pad + CARD_GAP * 2;
  }
  return { nodes, edges: [] };
}

// --------------------------------------------------------------- entity web

/** How wide the arcs above and below the middle card reach, in radians: they leave its sides free. */
const ARC_SPAN = (140 * Math.PI) / 180;

/**
 * The middles of `count` entity cards round one at (0, 0): the first half
 * (rounded up) on an arc above it, left to right, the rest on an arc below
 * it, so that the sides stay free for the edges to the boxes. The arcs are
 * as wide as the cards need, and the cards never overlap.
 */
function arcs(count: number): Point[] {
  if (count === 0) return [];
  const above = Math.ceil(count / 2);
  const below = count - above;
  const most = Math.max(above, below);
  // Neighbours on an arc stand a card's width and a gap apart, at least.
  const step = most > 1 ? ARC_SPAN / (most - 1) : ARC_SPAN;
  const apart = ENTITY_CARD.width + CARD_GAP;
  const radius = Math.max(ENTITY_CARD.height * 2 + CARD_GAP * 2, most > 1 ? apart / (2 * Math.sin(step / 2)) : 0);
  const arc = (many: number, middle: number): Point[] => {
    const points: Point[] = [];
    for (let i = 0; i < many; i++) {
      const angle = many === 1 ? middle : middle - ARC_SPAN / 2 + (ARC_SPAN * i) / (many - 1);
      points.push({ x: radius * Math.cos(angle), y: radius * Math.sin(angle) });
    }
    return points;
  };
  // Above: left to right (from -160 degrees to -20); below: left to right as well.
  const top = arc(above, -Math.PI / 2);
  const bottom = arc(below, Math.PI / 2).reverse();
  // Make sure of it: nothing overlaps the middle card or each other.
  const all = spread([{ x: 0, y: 0 }, ...top, ...bottom], ENTITY_CARD, CARD_GAP);
  const middle = all[0] as Point;
  return all.slice(1).map((point) => ({ x: point.x - middle.x, y: point.y - middle.y }));
}

/** How many cards stand in a row in a box of scenes or events: near a square, at most CARDS_PER_ROW. */
function boxColumns(count: number): number {
  return Math.max(1, Math.min(CARDS_PER_ROW, Math.round(Math.sqrt(count))));
}

/** An entity the one in the middle has to do with. */
export interface WebEntity {
  readonly file: string;
  readonly color: CardColor | null;
  /** The relation's label; "" for none. */
  readonly label: string;
  /** "out": the middle one lists it; "in": it lists the middle one; "both". */
  readonly way: 'out' | 'in' | 'both';
}

/** What an entity web is drawn from. */
export interface EntityWeb {
  /** The entity in the middle. */
  readonly center: { readonly file: string; readonly color: CardColor | null };
  readonly related: readonly WebEntity[];
  /** The vault paths of the scenes it is in, in reading order. */
  readonly scenes: readonly string[];
  /** The vault paths of the timeline events it is in. */
  readonly events: readonly string[];
  /** What the two boxes are called ("Scenes", "Events"). */
  readonly sceneLabel: string;
  readonly eventLabel: string;
}

/**
 * Around one entity: it in the middle, the entities it has to do with in two
 * arcs above and below it (an edge to each, with the relation's label), and,
 * to either side, a box of its scenes in reading order and a box of its
 * events, each joined to it by one edge. A box with nothing in it is left
 * out.
 */
export function entityWeb(web: EntityWeb): NewBoard {
  const taken = new Set<string>();
  const nodes: NewCard[] = [];
  const edges: NewEdge[] = [];
  const center: NewCard = {
    id: boardId(`center:${web.center.file}`, taken),
    type: 'file',
    file: web.center.file,
    ...toCorner({ x: 0, y: 0 }, ENTITY_CARD),
    width: ENTITY_CARD.width,
    height: ENTITY_CARD.height,
    ...withColor(web.center.color),
  };
  nodes.push(center);

  const ring = arcs(web.related.length);
  for (const [index, entity] of web.related.entries()) {
    const card: NewCard = {
      id: boardId(`related:${entity.file}`, taken),
      type: 'file',
      file: entity.file,
      ...toCorner(ring[index] as Point, ENTITY_CARD),
      width: ENTITY_CARD.width,
      height: ENTITY_CARD.height,
      ...withColor(entity.color),
    };
    nodes.push(card);
    const [fromNode, toNode] = entity.way === 'in' ? [card.id, center.id] : [center.id, card.id];
    edges.push({
      id: boardId(`edge:${entity.file}`, taken),
      fromNode,
      toNode,
      ...(entity.way === 'both' ? { fromEnd: 'none' as const, toEnd: 'none' as const } : {}),
      ...(entity.label.trim() !== '' ? { label: entity.label.trim() } : {}),
    });
  }

  // The two boxes stand to either side of the arcs, level with the entity,
  // so that the edges to them run straight out sideways between the arcs.
  const reach = Math.max(ENTITY_CARD.width / 2, ...ring.map((point) => Math.abs(point.x) + ENTITY_CARD.width / 2));
  const box = (files: readonly string[], label: string, side: 1 | -1, kind: string): void => {
    if (files.length === 0) return;
    const perRow = boxColumns(files.length);
    const across = Math.min(files.length, perRow);
    const down = Math.ceil(files.length / perRow);
    const width = across * SCENE_CARD.width + (across - 1) * CARD_GAP + 2 * GROUP_PADDING;
    const height = down * SCENE_CARD.height + (down - 1) * CARD_GAP + 2 * GROUP_PADDING;
    const x = side === 1 ? reach + CARD_GAP * 2 : -reach - CARD_GAP * 2 - width;
    const top = -height / 2;
    const group: NewCard = {
      id: boardId(`box:${kind}`, taken),
      type: 'group',
      x: Math.round(x),
      y: Math.round(top),
      width,
      height,
      label,
    };
    nodes.push(group);
    const middles = rows(files.length, perRow, SCENE_CARD, CARD_GAP);
    for (const [index, file] of files.entries()) {
      const middle = middles[index] as Point;
      nodes.push({
        id: boardId(`${kind}:${file}`, taken),
        type: 'file',
        file,
        x: Math.round(x + GROUP_PADDING + middle.x),
        y: Math.round(top + GROUP_PADDING + middle.y),
        width: SCENE_CARD.width,
        height: SCENE_CARD.height,
      });
    }
    edges.push({ id: boardId(`edge:${kind}`, taken), fromNode: center.id, toNode: group.id });
  };
  box(web.scenes, web.sceneLabel, 1, 'scene');
  box(web.events, web.eventLabel, -1, 'event');
  return { nodes, edges };
}
