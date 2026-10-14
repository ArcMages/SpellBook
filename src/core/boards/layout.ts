// Laying cards out on a board: plain sums, no screen.
//
//   circle  cards evenly round a ring, the first at the top
//   force   cards that pull along their edges, push each other away and
//           are pulled a little to the middle, started on a circle, so
//           that the same cards always come out in the same places
//   web     a force layout for each set of joined cards, the sets and the
//           lone cards packed close under the biggest one
//   spread  cards that overlap are pushed apart until none do
//   rows    cards in reading order, a few to a row
//
// Positions are of the middle of a card until `toCorners` turns them into
// what a board stores: the top corner where a line of text starts in a
// left-to-right language (Canvas's own x and y), in whole numbers.

/** A point: the middle of a card. */
export interface Point {
  readonly x: number;
  readonly y: number;
}

/** How big a card is. */
export interface Size {
  readonly width: number;
  readonly height: number;
}

/** The middles of `count` cards evenly round a ring of radius `radius` about (0, 0), the first at the top, going clockwise. */
export function circle(count: number, radius: number): Point[] {
  const points: Point[] = [];
  for (let i = 0; i < count; i++) {
    const angle = -Math.PI / 2 + (2 * Math.PI * i) / Math.max(count, 1);
    points.push({ x: radius * Math.cos(angle), y: radius * Math.sin(angle) });
  }
  return points;
}

/** The radius a ring needs for `count` cards of a size to sit round it without touching, and never less than `least`. */
export function ringRadius(count: number, size: Size, gap: number, least: number): number {
  if (count <= 1) return count === 1 ? least : 0;
  const along = Math.max(size.width, size.height) + gap;
  return Math.max(least, (count * along) / (2 * Math.PI));
}

/** How a force layout behaves. */
export interface ForceOptions {
  /**
   * How far apart two joined cards would like to stand: the empty room
   * between their edges when `size` is given, else between their middles.
   */
  readonly length: number;
  /** How big each card is; none for points. */
  readonly size?: Size;
  /** How many rounds of pulling and pushing. */
  readonly rounds?: number;
  /** How hard every card is pulled towards the middle, (0, 0). */
  readonly gravity?: number;
}

/** How far a card's edge is from its middle, along the way (ux, uy) (of length 1). */
function reach(size: Size, ux: number, uy: number): number {
  const across = Math.abs(ux) < 1e-9 ? Infinity : size.width / 2 / Math.abs(ux);
  const down = Math.abs(uy) < 1e-9 ? Infinity : size.height / 2 / Math.abs(uy);
  const found = Math.min(across, down);
  return Number.isFinite(found) ? found : 0;
}

/**
 * The order to start cards round the circle in: a walk out from the card
 * with the most edges (the first such), each card followed by the ones it
 * is joined to, so that joined cards start side by side and the web does
 * not have to untangle itself. Cards not reached come after, in the order
 * given.
 */
function walkOrder(count: number, edges: ReadonlyArray<readonly [number, number]>): number[] {
  const near: number[][] = Array.from({ length: count }, () => []);
  for (const [a, b] of edges) {
    near[a]?.push(b);
    near[b]?.push(a);
  }
  for (const list of near) list.sort((p, q) => p - q);
  const order: number[] = [];
  const seen = new Set<number>();
  const byEdges = Array.from({ length: count }, (_, i) => i).sort((p, q) => (near[q]?.length ?? 0) - (near[p]?.length ?? 0) || p - q);
  for (const root of byEdges) {
    if (seen.has(root)) continue;
    const queue = [root];
    seen.add(root);
    while (queue.length > 0) {
      const card = queue.shift() as number;
      order.push(card);
      for (const next of near[card] ?? []) {
        if (seen.has(next)) continue;
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return order;
}

/**
 * A force layout: cards joined by an edge pull together, all cards push each
 * other apart (Fruchterman and Reingold's way), and every card is pulled a
 * little towards the middle so that nothing drifts off. With a `size`, the
 * push and pull are measured between the cards' edges, not their middles,
 * so wide cards keep their room. The moves cool round by round until the
 * cards settle. It starts with the cards on a small circle, joined cards
 * side by side, so it is the same every time for the same cards and edges
 * (nothing random).
 *
 * @param count how many cards
 * @param edges pairs of card numbers (0 to count - 1); a pair with a number out of range is ignored
 */
export function force(count: number, edges: ReadonlyArray<readonly [number, number]>, options: ForceOptions): Point[] {
  const k = Math.max(options.length, 1);
  const size = options.size ?? { width: 0, height: 0 };
  const rounds = options.rounds ?? 500;
  const gravity = options.gravity ?? 0.8;
  const joined = edges.filter(([a, b]) => a !== b && a >= 0 && b >= 0 && a < count && b < count);
  const big = Math.max(size.width, size.height);
  const start = circle(count, ringRadius(count, { width: big + k / 2, height: big + k / 2 }, 0, 0));
  const x = new Array<number>(count).fill(0);
  const y = new Array<number>(count).fill(0);
  for (const [place, card] of walkOrder(count, joined).entries()) {
    x[card] = start[place]?.x ?? 0;
    y[card] = start[place]?.y ?? 0;
  }
  const hottest = k + big;
  for (let round = 0; round < rounds; round++) {
    const heat = hottest * (1 - round / rounds) ** 2 + 0.5;
    const dx = new Array<number>(count).fill(0);
    const dy = new Array<number>(count).fill(0);
    for (let i = 0; i < count; i++) {
      for (let j = i + 1; j < count; j++) {
        let ex = (x[i] as number) - (x[j] as number);
        let ey = (y[i] as number) - (y[j] as number);
        let distance = Math.hypot(ex, ey);
        if (distance < 0.01) {
          // Two cards on the same spot: part them along a direction that depends on who they are.
          ex = Math.cos(i + j);
          ey = Math.sin(i + j);
          distance = 1;
        }
        const ux = ex / distance;
        const uy = ey / distance;
        const room = distance - 2 * reach(size, ux, uy);
        const push = (k * k) / Math.max(room, k * 0.05);
        dx[i] = (dx[i] as number) + ux * push;
        dy[i] = (dy[i] as number) + uy * push;
        dx[j] = (dx[j] as number) - ux * push;
        dy[j] = (dy[j] as number) - uy * push;
      }
    }
    for (const [a, b] of joined) {
      const ex = (x[a] as number) - (x[b] as number);
      const ey = (y[a] as number) - (y[b] as number);
      const distance = Math.hypot(ex, ey);
      if (distance < 0.01) continue;
      const ux = ex / distance;
      const uy = ey / distance;
      const room = Math.max(distance - 2 * reach(size, ux, uy), 0);
      const pull = (room * room) / k;
      dx[a] = (dx[a] as number) - ux * pull;
      dy[a] = (dy[a] as number) - uy * pull;
      dx[b] = (dx[b] as number) + ux * pull;
      dy[b] = (dy[b] as number) + uy * pull;
    }
    for (let i = 0; i < count; i++) {
      dx[i] = (dx[i] as number) - gravity * (x[i] as number);
      dy[i] = (dy[i] as number) - 2 * gravity * (y[i] as number);
      const length = Math.hypot(dx[i] as number, dy[i] as number);
      if (length < 1e-9) continue;
      const step = Math.min(length, heat);
      x[i] = (x[i] as number) + ((dx[i] as number) / length) * step;
      y[i] = (y[i] as number) + ((dy[i] as number) / length) * step;
    }
  }
  return x.map((value, i) => ({ x: value, y: y[i] as number }));
}

/** The box round cards of one size whose middles are `points`. */
function bounds(points: readonly Point[], size: Size): { left: number; top: number; right: number; bottom: number } {
  if (points.length === 0) return { left: 0, top: 0, right: 0, bottom: 0 };
  return {
    left: Math.min(...points.map((point) => point.x)) - size.width / 2,
    top: Math.min(...points.map((point) => point.y)) - size.height / 2,
    right: Math.max(...points.map((point) => point.x)) + size.width / 2,
    bottom: Math.max(...points.map((point) => point.y)) + size.height / 2,
  };
}

/**
 * A web of cards (all of one size) joined by edges, laid out to be read:
 * each set of cards joined to each other is laid out by force, with
 * `gap` of room at least between any two cards; the biggest set stands on
 * top, and the smaller sets and the cards joined to nothing stand in tidy
 * rows under it, no wider than it (or than a square of all the cards).
 * The whole is centred on (0, 0). Middles of the cards, in the order given.
 */
export function web(count: number, edges: ReadonlyArray<readonly [number, number]>, size: Size, gap: number): Point[] {
  const joined = edges.filter(([a, b]) => a !== b && a >= 0 && b >= 0 && a < count && b < count);
  // The sets of cards joined to each other.
  const head = Array.from({ length: count }, (_, i) => i);
  const find = (i: number): number => {
    let root = i;
    while (head[root] !== root) root = head[root] as number;
    return root;
  };
  for (const [a, b] of joined) {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) head[Math.max(ra, rb)] = Math.min(ra, rb);
  }
  const sets = new Map<number, number[]>();
  for (let i = 0; i < count; i++) {
    const root = find(i);
    const set = sets.get(root) ?? [];
    set.push(i);
    sets.set(root, set);
  }
  // Biggest first; of the same size, the one with the first card first.
  const ordered = [...sets.values()].sort((p, q) => q.length - p.length || (p[0] as number) - (q[0] as number));

  interface Piece {
    readonly cards: readonly number[];
    readonly middles: Point[];
    readonly width: number;
    readonly height: number;
  }
  const pieces: Piece[] = ordered.map((cards) => {
    let middles: Point[] = [{ x: 0, y: 0 }];
    if (cards.length > 1) {
      const local = new Map(cards.map((card, index) => [card, index]));
      const inside = joined
        .filter(([a]) => local.has(a))
        .map(([a, b]): [number, number] => [local.get(a) as number, local.get(b) as number]);
      middles = spread(force(cards.length, inside, { length: gap * 1.5, size }), size, gap);
    }
    const box = bounds(middles, size);
    return {
      cards,
      middles: middles.map((point) => ({ x: point.x - box.left, y: point.y - box.top })),
      width: box.right - box.left,
      height: box.bottom - box.top,
    };
  });

  const placed = new Array<Point>(count).fill({ x: 0, y: 0 });
  const put = (piece: Piece, left: number, top: number): void => {
    for (const [index, card] of piece.cards.entries()) {
      const middle = piece.middles[index] as Point;
      placed[card] = { x: middle.x + left, y: middle.y + top };
    }
  };
  const first = pieces[0];
  if (!first) return [];
  put(first, 0, 0);
  // The rest in rows under the first, each row centred under it.
  const square = Math.ceil(Math.sqrt(count)) * (size.width + gap) - gap;
  const widest = Math.max(first.width, square);
  let top = first.height + gap;
  let row: Piece[] = [];
  let rowWidth = 0;
  const lay = (): void => {
    if (row.length === 0) return;
    let left = (first.width - rowWidth) / 2;
    let tallest = 0;
    for (const piece of row) {
      put(piece, left, top);
      left += piece.width + gap;
      tallest = Math.max(tallest, piece.height);
    }
    top += tallest + gap;
    row = [];
    rowWidth = 0;
  };
  for (const piece of pieces.slice(1)) {
    const wider = row.length === 0 ? piece.width : rowWidth + gap + piece.width;
    if (row.length > 0 && wider > widest) lay();
    rowWidth = row.length === 0 ? piece.width : rowWidth + gap + piece.width;
    row.push(piece);
  }
  lay();
  const box = bounds(placed, size);
  const midX = (box.left + box.right) / 2;
  const midY = (box.top + box.bottom) / 2;
  return placed.map((point) => ({ x: point.x - midX, y: point.y - midY }));
}

/**
 * Push apart cards (all of one size) that overlap or stand closer than
 * `gap`, a little at a time, until none do (or enough rounds have gone).
 */
export function spread(points: readonly Point[], size: Size, gap: number, rounds = 1000): Point[] {
  const x = points.map((point) => point.x);
  const y = points.map((point) => point.y);
  const wide = size.width + gap;
  const high = size.height + gap;
  for (let round = 0; round < rounds; round++) {
    let moved = false;
    for (let i = 0; i < x.length; i++) {
      for (let j = i + 1; j < x.length; j++) {
        const ex = (x[j] as number) - (x[i] as number);
        const ey = (y[j] as number) - (y[i] as number);
        const overX = wide - Math.abs(ex);
        const overY = high - Math.abs(ey);
        if (overX <= 0 || overY <= 0) continue;
        moved = true;
        // Out along the way that needs the shorter push.
        if (overX / wide < overY / high) {
          const sign = ex > 0 || (ex === 0 && i < j) ? 1 : -1;
          x[i] = (x[i] as number) - (sign * overX) / 2;
          x[j] = (x[j] as number) + (sign * overX) / 2;
        } else {
          const sign = ey > 0 || (ey === 0 && i < j) ? 1 : -1;
          y[i] = (y[i] as number) - (sign * overY) / 2;
          y[j] = (y[j] as number) + (sign * overY) / 2;
        }
      }
    }
    if (!moved) break;
  }
  return x.map((value, i) => ({ x: value, y: y[i] as number }));
}

/** Where cards go when they stand in rows: `perRow` to a row, in reading order. Middles, the first row's first card at (0, 0). */
export function rows(count: number, perRow: number, size: Size, gap: number): Point[] {
  const across = Math.max(1, Math.floor(perRow));
  const points: Point[] = [];
  for (let i = 0; i < count; i++) {
    points.push({ x: (i % across) * (size.width + gap), y: Math.floor(i / across) * (size.height + gap) });
  }
  return points;
}

/** The corner a board stores for a card whose middle is at `point`, on whole numbers. */
export function toCorner(point: Point, size: Size): { x: number; y: number } {
  return { x: Math.round(point.x - size.width / 2), y: Math.round(point.y - size.height / 2) };
}
