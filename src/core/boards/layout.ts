// Laying cards out on a board: plain sums, no screen.
//
//   circle  cards evenly round a ring, the first at the top
//   force   cards that pull along their edges and push each other away,
//           started on a circle, so that the same cards always come out in
//           the same places (nothing random)
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
  /** How long an edge would like to be, between the middles of its two cards. */
  readonly length: number;
  /** How many rounds of pulling and pushing. */
  readonly rounds?: number;
}

/**
 * A force layout: cards joined by an edge pull together, all cards push each
 * other apart (Fruchterman and Reingold's way, cooling as it goes). It starts
 * with the cards on a circle in the order given, so it is the same every
 * time for the same cards and edges. Cards that are joined to nothing drift
 * out to the edge, where they can be found.
 *
 * @param count how many cards
 * @param edges pairs of card numbers (0 to count - 1); a pair with a number out of range is ignored
 */
export function force(count: number, edges: ReadonlyArray<readonly [number, number]>, options: ForceOptions): Point[] {
  const k = options.length;
  const rounds = options.rounds ?? 300;
  const start = circle(count, ringRadius(count, { width: k * 0.6, height: k * 0.6 }, k * 0.4, k));
  const x = start.map((point) => point.x);
  const y = start.map((point) => point.y);
  const joined = edges.filter(([a, b]) => a !== b && a >= 0 && b >= 0 && a < count && b < count);
  let heat = k;
  for (let round = 0; round < rounds; round++) {
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
          distance = 0.01;
        }
        const push = (k * k) / distance;
        const ux = ex / distance;
        const uy = ey / distance;
        dx[i] = (dx[i] as number) + ux * push;
        dy[i] = (dy[i] as number) + uy * push;
        dx[j] = (dx[j] as number) - ux * push;
        dy[j] = (dy[j] as number) - uy * push;
      }
    }
    for (const [a, b] of joined) {
      const ex = (x[a] as number) - (x[b] as number);
      const ey = (y[a] as number) - (y[b] as number);
      const distance = Math.max(Math.hypot(ex, ey), 0.01);
      const pull = (distance * distance) / k;
      const ux = ex / distance;
      const uy = ey / distance;
      dx[a] = (dx[a] as number) - ux * pull;
      dy[a] = (dy[a] as number) - uy * pull;
      dx[b] = (dx[b] as number) + ux * pull;
      dy[b] = (dy[b] as number) + uy * pull;
    }
    for (let i = 0; i < count; i++) {
      const length = Math.hypot(dx[i] as number, dy[i] as number);
      if (length < 1e-9) continue;
      const step = Math.min(length, heat);
      x[i] = (x[i] as number) + ((dx[i] as number) / length) * step;
      y[i] = (y[i] as number) + ((dy[i] as number) / length) * step;
    }
    heat = Math.max(k * 0.01, heat * 0.98);
  }
  return x.map((value, i) => ({ x: value, y: y[i] as number }));
}

/**
 * Push apart cards (all of one size) that overlap or stand closer than
 * `gap`, a little at a time, until none do (or enough rounds have gone).
 */
export function spread(points: readonly Point[], size: Size, gap: number, rounds = 200): Point[] {
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
