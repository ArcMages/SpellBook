// An idea board on disk: an Obsidian Canvas file (".canvas"), written in the
// open JSON Canvas format, so that it opens in Obsidian's own Canvas on a
// Mac, an iPhone and an iPad, and stays usable without the plugin.
//
//   {
//     "nodes":[
//       {"id":"5f0c...","type":"text","text":"An idea","x":0,"y":0,"width":260,"height":120},
//       {"id":"9a1e...","type":"file","file":"Novel/Manuscript/Opening.md","x":300,"y":0,"width":260,"height":120}
//     ],
//     "edges":[
//       {"id":"c2d4...","fromNode":"5f0c...","toNode":"9a1e...","label":"leads to"}
//     ]
//   }
//
// A node is a card: a text card, a file card (a note of the vault, by its
// vault path), a link card (a web address) or a group (a box with a label
// around other cards). An edge joins two cards, with an optional label.
//
// Reading is forgiving: a board the writer (or another app) wrote is read as
// far as it can be, and what is not understood is skipped, never "fixed".
// Changing a board touches only the cards it is asked to change: everything
// else in the file, keys this version does not know included, is written
// back exactly as it was read.

/** The ending of a board's file name. */
export const BOARD_EXTENSION = 'canvas';

/** The colours a card can have in Canvas, by the numbers Canvas itself uses: they follow the theme. */
export type BoardColor = '1' | '2' | '3' | '4' | '5' | '6';

/** Which side of a card an edge leaves or reaches. (Canvas's own words: they are no direction on the screen of a right-to-left app.) */
export type BoardSide = 'top' | 'right' | 'bottom' | 'left';

/** A card of a new board: what the plugin writes. Positions and sizes are whole numbers. */
export type NewCard =
  | (CardPlace & { readonly type: 'text'; readonly text: string })
  | (CardPlace & { readonly type: 'file'; readonly file: string })
  | (CardPlace & { readonly type: 'group'; readonly label?: string });

/** Where a card is and how big, and its colour. */
export interface CardPlace {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly color?: BoardColor;
}

/** An edge of a new board. */
export interface NewEdge {
  readonly id: string;
  readonly fromNode: string;
  readonly toNode: string;
  readonly fromSide?: BoardSide;
  readonly toSide?: BoardSide;
  /** "none" or "arrow"; Canvas draws no arrow at the start and one at the end when nothing is said. */
  readonly fromEnd?: 'none' | 'arrow';
  readonly toEnd?: 'none' | 'arrow';
  readonly label?: string;
  readonly color?: BoardColor;
}

/** A whole new board. */
export interface NewBoard {
  readonly nodes: readonly NewCard[];
  readonly edges: readonly NewEdge[];
}

/** One card of a board as it was read. */
export interface ReadCard {
  readonly id: string;
  /** "text", "file", "link", "group", or whatever a newer Canvas writes. */
  readonly type: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /** A text card's text: the writer's own; "" for other cards. */
  readonly text: string;
  /** A file card's vault path; "" for other cards. */
  readonly file: string;
}

/** One edge of a board as it was read. */
export interface ReadEdge {
  readonly id: string;
  readonly fromNode: string;
  readonly toNode: string;
  readonly label: string;
}

/** What a board holds, as far as it could be read. */
export interface BoardReading {
  readonly cards: readonly ReadCard[];
  readonly edges: readonly ReadEdge[];
}

/** An empty board, as a new file holds it. */
export const EMPTY_BOARD_TEXT = '{\n\t"nodes":[],\n\t"edges":[]\n}\n';

type Json = Record<string, unknown>;

function isRecord(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * The whole of a board file as JSON, or null when it is not a board: text
 * that is not JSON, or JSON that is not an object. An empty file (Canvas
 * itself sometimes leaves one) is an empty board.
 */
function parseRaw(text: string): Json | null {
  if (text.trim() === '') return {};
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  return isRecord(value) ? value : null;
}

/**
 * Read a board file. Null when the file is not a board at all; otherwise the
 * cards and edges that could be read (a card without an id, a type or a
 * place is skipped, and so is an edge that does not name two cards).
 */
export function readBoard(text: string): BoardReading | null {
  const raw = parseRaw(text);
  if (raw === null) return null;
  const cards: ReadCard[] = [];
  const nodes = Array.isArray(raw['nodes']) ? raw['nodes'] : [];
  for (const node of nodes) {
    if (!isRecord(node)) continue;
    const id = node['id'];
    const type = node['type'];
    const x = finite(node['x']);
    const y = finite(node['y']);
    const width = finite(node['width']);
    const height = finite(node['height']);
    if (typeof id !== 'string' || id === '' || typeof type !== 'string') continue;
    if (x === null || y === null || width === null || height === null) continue;
    const text = type === 'text' && typeof node['text'] === 'string' ? node['text'] : '';
    const file = type === 'file' && typeof node['file'] === 'string' ? node['file'] : '';
    cards.push({ id, type, x, y, width, height, text, file });
  }
  const edges: ReadEdge[] = [];
  const list = Array.isArray(raw['edges']) ? raw['edges'] : [];
  for (const edge of list) {
    if (!isRecord(edge)) continue;
    const { id, fromNode, toNode, label } = edge;
    if (typeof id !== 'string' || typeof fromNode !== 'string' || typeof toNode !== 'string') continue;
    edges.push({ id, fromNode, toNode, label: typeof label === 'string' ? label : '' });
  }
  return { cards, edges };
}

/** How many cards a board has: every card but the group boxes. */
export function countCards(board: BoardReading): number {
  return board.cards.filter((card) => card.type !== 'group').length;
}

/** The text cards of a board, top to bottom and then along the row, as they are read on the board. */
export function textCards(board: BoardReading): ReadCard[] {
  return board.cards
    .filter((card) => card.type === 'text' && card.text.trim() !== '')
    .sort((a, b) => a.y - b.y || a.x - b.x || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** What a text card becomes: a file card pointing at a note (by its vault path). */
export interface CardSwap {
  /** The text card's id. */
  readonly id: string;
  /** The new note's vault path. */
  readonly file: string;
}

/** What swapping cards did. */
export interface SwapResult {
  /** The board's new text; null when nothing changed (no card could be swapped). */
  readonly text: string | null;
  /** The ids of the cards that were swapped (their ids before the swap). */
  readonly swapped: readonly string[];
  /** The id each swapped card has now, by its old id. */
  readonly ids: ReadonlyMap<string, string>;
  /** The ids that were asked for and are not text cards of the board (any more). */
  readonly missing: readonly string[];
}

/**
 * Turn text cards into file cards, in a board's text as it is now. Each card
 * keeps its place, its size and its colour; its type changes, its text gives
 * way to the note's path, and it gets a new id, with every edge that joined
 * the old card joined to the new one. The new id matters when the board is
 * open: Canvas follows a change of the file card by card, by id, and cannot
 * turn a text card it is showing into a file card, so a card under the same
 * id stayed a text card on screen, and Canvas's next save undid the swap.
 * Every other card, every edge and every key of the file is written back as
 * it was read. A card that is no longer there, or no longer a text card, is
 * left alone and reported.
 */
export function swapCards(text: string, swaps: readonly CardSwap[]): SwapResult {
  const raw = parseRaw(text);
  const wanted = new Map(swaps.map((swap) => [swap.id, swap.file]));
  if (raw === null || !Array.isArray(raw['nodes'])) {
    return { text: null, swapped: [], ids: new Map(), missing: [...wanted.keys()] };
  }
  const taken = new Set<string>();
  for (const item of [...raw['nodes'], ...(Array.isArray(raw['edges']) ? raw['edges'] : [])]) {
    if (isRecord(item) && typeof item['id'] === 'string') taken.add(item['id']);
  }
  const swapped: string[] = [];
  const ids = new Map<string, string>();
  const nodes = raw['nodes'].map((node: unknown): unknown => {
    if (!isRecord(node) || node['type'] !== 'text' || typeof node['id'] !== 'string') return node;
    const id = node['id'];
    const file = wanted.get(id);
    if (file === undefined || swapped.includes(id)) return node;
    swapped.push(id);
    const card: Json = {};
    for (const [key, value] of Object.entries(node)) {
      if (key === 'text') continue;
      if (key === 'id') card['id'] = boardId(`${id}\n${file}`, taken);
      else if (key === 'type') card['type'] = 'file';
      else if (key === 'x' || key === 'y' || key === 'width' || key === 'height') card[key] = Math.round(finite(value) ?? 0);
      else card[key] = value;
    }
    card['file'] = file;
    ids.set(id, card['id'] as string);
    return card;
  });
  const missing = [...wanted.keys()].filter((id) => !swapped.includes(id));
  if (swapped.length === 0) return { text: null, swapped, ids, missing };
  const edges = Array.isArray(raw['edges'])
    ? raw['edges'].map((edge: unknown): unknown => {
        if (!isRecord(edge)) return edge;
        const from = typeof edge['fromNode'] === 'string' ? ids.get(edge['fromNode']) : undefined;
        const to = typeof edge['toNode'] === 'string' ? ids.get(edge['toNode']) : undefined;
        if (from === undefined && to === undefined) return edge;
        return { ...edge, ...(from !== undefined ? { fromNode: from } : {}), ...(to !== undefined ? { toNode: to } : {}) };
      })
    : raw['edges'];
  return { text: writeRaw({ ...raw, nodes, edges }), swapped, ids, missing };
}

/**
 * Write a board's JSON the way Canvas itself does: the two lists first, one
 * card or edge to a line, tabs before them. Keys the board has besides the
 * two lists follow, as they were.
 */
function writeRaw(raw: Json): string {
  const list = (value: unknown): string => {
    const items = Array.isArray(value) ? value : [];
    if (items.length === 0) return '[]';
    return `[\n${items.map((item) => `\t\t${JSON.stringify(item)}`).join(',\n')}\n\t]`;
  };
  const lines = [`\t"nodes":${list(raw['nodes'])}`, `\t"edges":${list(raw['edges'])}`];
  for (const [key, value] of Object.entries(raw)) {
    if (key === 'nodes' || key === 'edges' || value === undefined) continue;
    lines.push(`\t${JSON.stringify(key)}:${JSON.stringify(value)}`);
  }
  return `{\n${lines.join(',\n')}\n}\n`;
}

/** What is wrong with a new board; empty when it is valid JSON Canvas. */
export function boardProblems(board: NewBoard): string[] {
  const problems: string[] = [];
  const ids = new Set<string>();
  const whole = (value: number): boolean => Number.isInteger(value);
  for (const node of board.nodes) {
    if (node.id === '' || ids.has(node.id)) problems.push(`The id "${node.id}" is used twice or is empty.`);
    ids.add(node.id);
    if (![node.x, node.y, node.width, node.height].every(whole)) problems.push(`The card "${node.id}" is not placed on whole numbers.`);
    if (node.width <= 0 || node.height <= 0) problems.push(`The card "${node.id}" has no size.`);
  }
  for (const edge of board.edges) {
    if (edge.id === '' || ids.has(edge.id)) problems.push(`The id "${edge.id}" is used twice or is empty.`);
    ids.add(edge.id);
    const cards = new Set(board.nodes.map((node) => node.id));
    if (!cards.has(edge.fromNode) || !cards.has(edge.toNode)) problems.push(`The edge "${edge.id}" does not join two cards of the board.`);
  }
  return problems;
}

/**
 * The text of a new board. Throws when the board is not valid JSON Canvas
 * (an id used twice, a place that is not a whole number): that is a mistake
 * in the plugin, and nothing broken is ever written.
 */
export function writeBoard(board: NewBoard): string {
  const problems = boardProblems(board);
  if (problems.length > 0) throw new Error(`Spellbook made a board that is not valid: ${problems.join(' ')}`);
  return writeRaw({ nodes: board.nodes.map((node) => ({ ...node })), edges: board.edges.map((edge) => ({ ...edge })) });
}

/**
 * An id for a card or an edge: sixteen hexadecimal digits, as Canvas makes
 * them, worked out from `seed` (so the same board is drawn the same way every
 * time) and different from every id in `taken`, which it is added to.
 */
export function boardId(seed: string, taken: Set<string>): string {
  for (let attempt = 0; ; attempt++) {
    const id = hex(`${seed}#${attempt}`);
    if (!taken.has(id)) {
      taken.add(id);
      return id;
    }
  }
}

/** Sixteen hexadecimal digits from a text: two 32-bit FNV-1a hashes side by side. */
function hex(text: string): string {
  let a = 0x811c9dc5;
  let b = 0x01000193 ^ 0x5bd1e995;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    a = Math.imul(a ^ code, 0x01000193) >>> 0;
    b = Math.imul(b ^ code ^ (i & 0xff), 0x5bd1e995) >>> 0;
  }
  return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
}
