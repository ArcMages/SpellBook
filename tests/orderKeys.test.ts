import { describe, expect, it } from 'vitest';
import {
  MAX_ORDER_KEY,
  ORDER_STEP,
  isStrictlyIncreasing,
  planLocalOrderKeys,
  planOrderKeys,
  readOrder,
} from '../src/core/orderKeys';
import type { OrderChange, OrderedScene } from '../src/core/orderKeys';

/** Scenes named a, b, c ... with the given keys. */
function scenes(...orders: Array<number | null>): OrderedScene[] {
  return orders.map((order, index) => ({ path: String.fromCharCode(97 + index), order }));
}

/** The keys after a plan has been carried out. */
function apply(list: readonly OrderedScene[], changes: readonly OrderChange[]): Array<number | null> {
  const next = new Map(changes.map((change) => [change.path, change.order]));
  return list.map((scene) => next.get(scene.path) ?? scene.order);
}

/** Move the scene at `from` to position `to`, keeping its key. */
function move(list: readonly OrderedScene[], from: number, to: number): OrderedScene[] {
  const copy = [...list];
  const [item] = copy.splice(from, 1);
  copy.splice(to, 0, item as OrderedScene);
  return copy;
}

/** The largest number of scenes that could keep their key, found by trying every choice. */
function bruteForceMaxKept(list: readonly OrderedScene[]): number {
  const n = list.length;
  let best = 0;
  for (let mask = 0; mask < 1 << n; mask++) {
    let ok = true;
    let lastIndex = -1;
    let lastKey = 0;
    let count = 0;
    for (let i = 0; i < n && ok; i++) {
      if (!(mask & (1 << i))) continue;
      const key = readOrder((list[i] as OrderedScene).order);
      // between the previous kept scene and this one, i - lastIndex - 1 new keys must fit
      if (key === null || key - lastKey < i - lastIndex) ok = false;
      else {
        lastIndex = i;
        lastKey = key;
        count++;
      }
    }
    if (ok && count > best) best = count;
  }
  return best;
}

function randomSource(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('readOrder', () => {
  it('accepts positive whole numbers only', () => {
    expect(readOrder(1)).toBe(1);
    expect(readOrder(1024)).toBe(1024);
    expect(readOrder(MAX_ORDER_KEY)).toBe(MAX_ORDER_KEY);
    for (const bad of [0, -5, 1.5, NaN, Infinity, MAX_ORDER_KEY + 1, '1024', null, undefined, true, [1], {}]) {
      expect(readOrder(bad)).toBeNull();
    }
  });
});

describe('planOrderKeys', () => {
  it('gives new scenes keys 1024 apart', () => {
    const list = scenes(null, null, null);
    expect(planOrderKeys(list)).toEqual([
      { path: 'a', order: ORDER_STEP },
      { path: 'b', order: 2 * ORDER_STEP },
      { path: 'c', order: 3 * ORDER_STEP },
    ]);
  });

  it('changes nothing when the keys already rise', () => {
    expect(planOrderKeys(scenes(1024, 2048, 3072))).toEqual([]);
    expect(planOrderKeys(scenes(1, 2, 3))).toEqual([]);
    expect(planOrderKeys(scenes(5, 900, 901, 100000))).toEqual([]);
    expect(planOrderKeys([])).toEqual([]);
  });

  it('continues 1024 after the last key for a scene added at the end', () => {
    expect(planOrderKeys(scenes(1024, 2048, null))).toEqual([{ path: 'c', order: 3072 }]);
    expect(planOrderKeys(scenes(7, 1000, null, null))).toEqual([
      { path: 'c', order: 1000 + ORDER_STEP },
      { path: 'd', order: 1000 + 2 * ORDER_STEP },
    ]);
  });

  it('puts a scene added in the middle half-way between its neighbours', () => {
    expect(planOrderKeys(scenes(1024, null, 2048))).toEqual([{ path: 'b', order: 1536 }]);
  });

  it('puts a scene added at the front between zero and the first key', () => {
    expect(planOrderKeys(scenes(null, 1024, 2048))).toEqual([{ path: 'a', order: 512 }]);
  });

  describe('a single move, when there is a gap', () => {
    const start = scenes(1024, 2048, 3072, 4096, 5120);

    it('changes exactly one key, the moved scene, for every possible move', () => {
      for (let from = 0; from < start.length; from++) {
        for (let to = 0; to < start.length; to++) {
          if (from === to) continue;
          const after = move(start, from, to);
          const movedPath = (start[from] as OrderedScene).path;
          const changes = planOrderKeys(after, new Set([movedPath]));
          expect(changes, `move ${from} -> ${to}`).toHaveLength(1);
          expect(changes[0]?.path, `move ${from} -> ${to}`).toBe(movedPath);
          expect(isStrictlyIncreasing(apply(after, changes)), `move ${from} -> ${to}`).toBe(true);
        }
      }
    });

    it('gives the moved scene a whole number between its new neighbours', () => {
      // e moves between a and b
      const after = move(start, 4, 1);
      expect(planOrderKeys(after, new Set(['e']))).toEqual([{ path: 'e', order: 1536 }]);
      // a moves between c and d
      const forward = move(start, 0, 2);
      expect(planOrderKeys(forward, new Set(['a']))).toEqual([{ path: 'a', order: 3584 }]);
    });

    it('still changes only one key when it is not told which scene moved', () => {
      for (let from = 0; from < start.length; from++) {
        for (let to = 0; to < start.length; to++) {
          if (from === to) continue;
          const after = move(start, from, to);
          const changes = planOrderKeys(after);
          expect(changes, `move ${from} -> ${to}`).toHaveLength(1);
          expect(isStrictlyIncreasing(apply(after, changes))).toBe(true);
        }
      }
    });

    it('rewrites the moved scene rather than its neighbour when either would do', () => {
      // After swapping b and c, rewriting b or c would both work.
      const swapped = move(scenes(1024, 2048, 3072, 4096), 2, 1); // a c b d
      expect(planOrderKeys(swapped, new Set(['c']))).toEqual([{ path: 'c', order: 1536 }]);
      expect(planOrderKeys(swapped, new Set(['b']))).toEqual([{ path: 'b', order: 3584 }]);
    });

    it('keeps working for many moves in a row before any renumbering is needed', () => {
      let list = scenes(1024, 2048, 3072, 4096);
      let total = 0;
      // Keep moving the last scene to just after the first: the gap halves each time.
      for (let round = 0; round < 9; round++) {
        list = move(list, 3, 1);
        const changes = planOrderKeys(list, new Set([(list[1] as OrderedScene).path]));
        expect(changes, `round ${round}`).toHaveLength(1);
        list = list.map((scene, index) => ({ path: scene.path, order: apply(list, changes)[index] ?? null }));
        expect(isStrictlyIncreasing(list.map((scene) => scene.order))).toBe(true);
        total += changes.length;
      }
      expect(total).toBe(9);
    });
  });

  describe('when no whole number fits', () => {
    it('renumbers as few neighbours as possible', () => {
      // b must go between 1024 and 1025: impossible, so one neighbour moves too.
      const list = scenes(1024, null, 1025, 2048, 3072);
      const changes = planOrderKeys(list, new Set(['b']));
      expect(changes).toHaveLength(2);
      expect(changes.map((change) => change.path)).toContain('b');
      const result = apply(list, changes);
      expect(isStrictlyIncreasing(result)).toBe(true);
      // the far end of the manuscript is left alone
      expect(result.slice(3)).toEqual([2048, 3072]);
    });

    it('only reports scenes whose value really changes', () => {
      const list = scenes(10, 11, 12, null, 13, 5000, 6000);
      const changes = planOrderKeys(list, new Set(['d']));
      const result = apply(list, changes);
      expect(isStrictlyIncreasing(result)).toBe(true);
      for (const change of changes) {
        const before = list.find((scene) => scene.path === change.path)?.order;
        expect(change.order).not.toBe(before);
      }
      expect(changes).toHaveLength(list.length - bruteForceMaxKept(list));
      expect(changes.map((change) => change.path)).not.toContain('f');
      expect(changes.map((change) => change.path)).not.toContain('g');
    });

    it('renumbers everything from 1024 when the keys are packed against zero', () => {
      const list = scenes(null, 1, 2);
      const changes = planOrderKeys(list);
      const result = apply(list, changes);
      expect(isStrictlyIncreasing(result)).toBe(true);
      expect(changes).toHaveLength(list.length - bruteForceMaxKept(list));
    });
  });

  it('does not renumber when a gap exists, however small', () => {
    // exactly one whole number fits between 10 and 12
    expect(planOrderKeys(scenes(10, null, 12), new Set(['b']))).toEqual([{ path: 'b', order: 11 }]);
    // exactly two fit between 10 and 13
    expect(planOrderKeys(scenes(10, null, null, 13))).toEqual([
      { path: 'b', order: 11 },
      { path: 'c', order: 12 },
    ]);
  });

  it('replaces keys that are not usable', () => {
    const list: OrderedScene[] = [
      { path: 'a', order: 1024 },
      { path: 'b', order: 1500.5 },
      { path: 'c', order: -3 },
      { path: 'd', order: 0 },
      { path: 'e', order: 4096 },
      { path: 'f', order: MAX_ORDER_KEY * 4 },
    ];
    const changes = planOrderKeys(list);
    expect(changes.map((change) => change.path)).toEqual(['b', 'c', 'd', 'f']);
    expect(isStrictlyIncreasing(apply(list, changes))).toBe(true);
  });

  it('separates two scenes that share a key', () => {
    const list = scenes(1024, 2048, 2048, 3072);
    const changes = planOrderKeys(list);
    expect(changes).toHaveLength(1);
    expect(isStrictlyIncreasing(apply(list, changes))).toBe(true);
  });

  it('fixes a completely reversed manuscript by keeping one key', () => {
    const list = scenes(5000, 4000, 3000, 2000, 1000);
    const changes = planOrderKeys(list);
    expect(changes).toHaveLength(4);
    expect(isStrictlyIncreasing(apply(list, changes))).toBe(true);
  });

  it('has nothing more to do once its plan has been carried out', () => {
    const list = scenes(3072, null, 1024, 1024, 7, 99999, 2048);
    const changes = planOrderKeys(list);
    const settled = list.map((scene, index) => ({ path: scene.path, order: apply(list, changes)[index] ?? null }));
    expect(isStrictlyIncreasing(settled.map((scene) => scene.order))).toBe(true);
    expect(planOrderKeys(settled)).toEqual([]);
  });

  it('for random manuscripts: rises strictly, changes the fewest scenes possible, and then settles', () => {
    const random = randomSource(20261013);
    for (let trial = 0; trial < 400; trial++) {
      const length = 1 + Math.floor(random() * 9);
      const list: OrderedScene[] = [];
      for (let i = 0; i < length; i++) {
        const roll = random();
        // a mix of missing keys, tightly packed keys and well spaced ones
        const order =
          roll < 0.15 ? null : roll < 0.6 ? 1 + Math.floor(random() * 12) : ORDER_STEP * (1 + Math.floor(random() * 8));
        list.push({ path: `s${i}`, order });
      }
      const picture = JSON.stringify(list.map((scene) => scene.order));
      const changes = planOrderKeys(list);
      const result = apply(list, changes);

      expect(isStrictlyIncreasing(result), picture).toBe(true);
      expect(changes.length, picture).toBe(length - bruteForceMaxKept(list));
      for (const change of changes) {
        expect(Number.isInteger(change.order) && change.order >= 1, picture).toBe(true);
        expect(change.order, picture).not.toBe(list.find((scene) => scene.path === change.path)?.order);
      }
      const settled = list.map((scene, index) => ({ path: scene.path, order: result[index] ?? null }));
      expect(planOrderKeys(settled), picture).toEqual([]);
    }
  });

  it('copes with a long manuscript', () => {
    const list: OrderedScene[] = Array.from({ length: 3000 }, (_, index) => ({
      path: `s${index}`,
      order: (index + 1) * ORDER_STEP,
    }));
    const after = move(list, 2999, 0);
    const changes = planOrderKeys(after, new Set(['s2999']));
    expect(changes).toEqual([{ path: 's2999', order: 512 }]);
  });
});

describe('planLocalOrderKeys', () => {
  /** Scenes with the given names and keys, in manuscript order. */
  const named = (list: Record<string, number | null>): OrderedScene[] =>
    Object.entries(list).map(([path, order]) => ({ path, order }));
  const touched = (...paths: string[]): Set<string> => new Set(paths);
  const paths = (changes: readonly OrderChange[]): string[] => changes.map((change) => change.path).sort();

  it('is the usual plan when the scenes not touched here are in order', () => {
    // one move, with a gap to move into
    const afterMove = named({ a: 1024, e: 5120, b: 2048, c: 3072, d: 4096 });
    expect(planLocalOrderKeys(afterMove, touched('e'))).toEqual([{ path: 'e', order: 1536 }]);
    // no whole number fits: a neighbour is renumbered as well
    const packed = named({ a: 10, d: 5000, b: 11, c: 12, e: 6000 });
    expect(planLocalOrderKeys(packed, touched('d'))).toEqual(planOrderKeys(packed, touched('d')));
    expect(paths(planLocalOrderKeys(packed, touched('d')))).toEqual(['a', 'd']);
    // scenes that never had a key all get one
    const keyless = named({ c: null, a: null, b: null });
    expect(planLocalOrderKeys(keyless, touched('c'))).toEqual(planOrderKeys(keyless, touched('c')));
    expect(planLocalOrderKeys(keyless, touched('c'))).toHaveLength(3);
  });

  it('leaves a scene that was not touched here alone, even when its key does not fit', () => {
    // e was moved to the front on another device and its new key has not arrived; d was moved here.
    const list = named({ e: 5120, a: 1024, d: 4096, b: 2048, c: 3072 });
    expect(paths(planOrderKeys(list, touched('d')))).toEqual(['d', 'e']); // the full repair would write both
    expect(planLocalOrderKeys(list, touched('d'))).toEqual([{ path: 'd', order: 1536 }]);
  });

  it('writes nothing when nothing was touched here and every scene has a key', () => {
    expect(planLocalOrderKeys(named({ e: 5120, a: 1024, b: 2048 }), touched())).toEqual([]);
    expect(planLocalOrderKeys(named({ a: 3, b: 2, c: 1 }), touched())).toEqual([]);
    expect(planLocalOrderKeys(named({ a: 7, b: 7 }), touched())).toEqual([]);
    expect(planLocalOrderKeys([], touched())).toEqual([]);
  });

  it('gives a key to a scene that has none, without repairing the others', () => {
    const list = named({ e: 5120, a: 1024, k: null, b: 2048 });
    expect(planLocalOrderKeys(list, touched())).toEqual([{ path: 'k', order: 1536 }]);
  });

  it('does not measure from a key that is out of place, and leaves room for the one on its way', () => {
    // d goes between e and a. Whatever e holds now, d must fit in front of a;
    // and e will get a key in that same gap, so d does not take the middle of it.
    const list = named({ e: 5120, d: 4096, a: 1024, b: 2048, c: 3072 });
    expect(planLocalOrderKeys(list, touched('d'))).toEqual([{ path: 'd', order: 682 }]);
  });

  it('does not renumber a neighbour just to leave that room', () => {
    // s is out of place between p and q; x is added here, and one number is free between p and q.
    const list = named({ p: 10, s: 9000, x: null, q: 12, r: 13, t: 14 });
    expect(planLocalOrderKeys(list, touched('x'))).toEqual([{ path: 'x', order: 11 }]);
  });

  it('for random manuscripts: never writes an out-of-place key it did not touch, and puts the rest in order', () => {
    const random = randomSource(20261014);
    for (let trial = 0; trial < 600; trial++) {
      const length = 1 + Math.floor(random() * 9);
      const list: OrderedScene[] = [];
      const touchedHere = new Set<string>();
      for (let i = 0; i < length; i++) {
        const roll = random();
        const order =
          roll < 0.15 ? null : roll < 0.6 ? 1 + Math.floor(random() * 12) : ORDER_STEP * (1 + Math.floor(random() * 8));
        list.push({ path: `s${i}`, order });
        if (random() < 0.25) touchedHere.add(`s${i}`);
      }
      const picture = `${JSON.stringify(list.map((scene) => scene.order))} touched ${[...touchedHere].join(',')}`;

      // The scenes another device may still be sending keys for.
      const others = list.filter((scene) => !touchedHere.has(scene.path) && scene.order !== null);
      const awaited = new Set(planOrderKeys(others).map((change) => change.path));

      const changes = planLocalOrderKeys(list, touchedHere);
      for (const change of changes) {
        expect(awaited.has(change.path), picture).toBe(false);
        expect(Number.isInteger(change.order) && change.order >= 1, picture).toBe(true);
        expect(change.order, picture).not.toBe(list.find((scene) => scene.path === change.path)?.order);
      }
      if (awaited.size === 0) expect(changes, picture).toEqual(planOrderKeys(list, touchedHere));
      if (touchedHere.size === 0 && list.every((scene) => scene.order !== null)) expect(changes, picture).toEqual([]);

      // Everything except the awaited scenes now rises in manuscript order.
      const result = apply(list, changes);
      const settled = list.map((scene, index) => ({ path: scene.path, order: result[index] ?? null }));
      const expected = settled.filter((scene) => !awaited.has(scene.path)).map((scene) => scene.order);
      expect(isStrictlyIncreasing(expected), picture).toBe(true);
      // ... and carrying the plan out leaves nothing more to do.
      expect(planLocalOrderKeys(settled, new Set()), picture).toEqual([]);
    }
  });
});

describe('isStrictlyIncreasing', () => {
  it('tells rising keys from everything else', () => {
    expect(isStrictlyIncreasing([])).toBe(true);
    expect(isStrictlyIncreasing([1, 2, 3])).toBe(true);
    expect(isStrictlyIncreasing([1, 1])).toBe(false);
    expect(isStrictlyIncreasing([2, 1])).toBe(false);
    expect(isStrictlyIncreasing([1, null, 3])).toBe(false);
    expect(isStrictlyIncreasing([0, 1])).toBe(false);
  });
});
