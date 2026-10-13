// Planning the "order" property of scene notes.
//
// Every scene carries a whole number that sorts it in manuscript order, so
// that other tools (and Obsidian's own sorting) can follow the binder. The
// numbers are sparse, 1024 apart when new, so that moving one scene normally
// means rewriting one file: the moved scene takes a number between its new
// neighbours. Only when no number fits are neighbours renumbered too.
//
// This file only plans; it never writes.

/** Distance between new keys. */
export const ORDER_STEP = 1024;

/** Keys above this are treated as broken and replaced (keeps all arithmetic exact). */
export const MAX_ORDER_KEY = 2 ** 40;

export interface OrderedScene {
  readonly path: string;
  /** The scene's current key, or null when it has none (or an unusable one). */
  readonly order: number | null;
}

export interface OrderChange {
  readonly path: string;
  readonly order: number;
}

/** Read an "order" value from frontmatter. Anything but a positive whole number is ignored. */
export function readOrder(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= MAX_ORDER_KEY
    ? value
    : null;
}

/**
 * Pick the scenes that keep their key: the largest group whose keys already
 * rise in manuscript order with enough whole numbers left between them for
 * the scenes in between. Among equally large groups, one that leaves the
 * `preferToChange` scenes out wins, so a moved scene is the one rewritten.
 *
 * For scenes i < j to both keep their keys there must be room for the j-i-1
 * scenes between them: key[j] - key[i] >= j - i, that is key[j]-j >= key[i]-i.
 * So this is a heaviest non-decreasing subsequence over key[i] - i.
 */
function chooseKept(scenes: readonly OrderedScene[], preferToChange: ReadonlySet<string>): boolean[] {
  const n = scenes.length;
  const kept = new Array<boolean>(n).fill(false);

  // Shifted value per candidate; null = cannot be kept.
  const shifted: (number | null)[] = scenes.map((scene, i) => {
    const key = readOrder(scene.order);
    // Keys start at 1, so position i needs a key of at least i + 1.
    return key !== null && key >= i + 1 ? key - i : null;
  });
  const distinct = [...new Set(shifted.filter((v): v is number => v !== null))].sort((a, b) => a - b);
  if (distinct.length === 0) return kept;
  const rankOf = new Map(distinct.map((value, rank) => [value, rank + 1] as const));

  // Fenwick tree over ranks holding the best (weight, index) for each prefix.
  const size = distinct.length;
  const bestWeight = new Array<number>(size + 1).fill(0);
  const bestIndex = new Array<number>(size + 1).fill(-1);
  const weight = new Array<number>(n).fill(0);
  const previous = new Array<number>(n).fill(-1);
  // Counting a scene always outweighs any number of preferences.
  const countUnit = n + 1;

  let top = -1;
  for (let i = 0; i < n; i++) {
    const value = shifted[i];
    if (value === null || value === undefined) continue;
    const rank = rankOf.get(value) as number;

    let before = 0;
    let beforeIndex = -1;
    for (let r = rank; r > 0; r -= r & -r) {
      if ((bestWeight[r] as number) > before) {
        before = bestWeight[r] as number;
        beforeIndex = bestIndex[r] as number;
      }
    }
    const scene = scenes[i] as OrderedScene;
    const own = countUnit + (preferToChange.has(scene.path) ? 0 : 1);
    weight[i] = before + own;
    previous[i] = beforeIndex;
    for (let r = rank; r <= size; r += r & -r) {
      if ((weight[i] as number) > (bestWeight[r] as number)) {
        bestWeight[r] = weight[i] as number;
        bestIndex[r] = i;
      }
    }
    if (top < 0 || (weight[i] as number) > (weight[top] as number)) top = i;
  }

  for (let i = top; i >= 0; i = previous[i] as number) kept[i] = true;
  return kept;
}

/** `count` whole numbers strictly between `low` and `high`, evenly spread and rising. */
function spreadBetween(low: number, high: number, count: number): number[] {
  const gap = high - low;
  const slots = count + 1;
  const whole = Math.floor(gap / slots);
  const rest = gap % slots;
  const out: number[] = [];
  for (let t = 1; t <= count; t++) {
    out.push(low + whole * t + Math.floor((rest * t) / slots));
  }
  return out;
}

/**
 * Work out which scenes need a new order key so that the keys rise strictly
 * in manuscript order, changing as few scenes as possible.
 *
 * @param scenes         the scenes in manuscript order with their current keys
 * @param preferToChange scenes that were just moved or added: when there is a
 *                       choice of which scene to rewrite, these are chosen
 * @returns only the scenes whose key must change, with their new key
 */
export function planOrderKeys(
  scenes: readonly OrderedScene[],
  preferToChange: ReadonlySet<string> = new Set(),
): OrderChange[] {
  const n = scenes.length;
  const kept = chooseKept(scenes, preferToChange);
  const next = new Array<number>(n).fill(0);

  let i = 0;
  let low = 0; // key of the last kept scene before the current run (0 = start of the manuscript)
  while (i < n) {
    if (kept[i]) {
      low = (scenes[i] as OrderedScene).order as number;
      next[i] = low;
      i++;
      continue;
    }
    // A run of scenes that need new keys: from i up to (not including) j.
    let j = i;
    while (j < n && !kept[j]) j++;
    const count = j - i;
    let values: number[];
    if (j < n) {
      values = spreadBetween(low, (scenes[j] as OrderedScene).order as number, count);
    } else {
      values = Array.from({ length: count }, (_, t) => low + ORDER_STEP * (t + 1));
    }
    for (let t = 0; t < count; t++) next[i + t] = values[t] as number;
    i = j;
  }

  const changes: OrderChange[] = [];
  for (let k = 0; k < n; k++) {
    const scene = scenes[k] as OrderedScene;
    if (scene.order !== next[k]) changes.push({ path: scene.path, order: next[k] as number });
  }
  return changes;
}

/**
 * The part of the plan that one device may carry out after the writer changed
 * the binder on it.
 *
 * planOrderKeys() repairs every key that disagrees with the manuscript order.
 * A device must not do that for scenes it did not touch. When the binder is
 * reordered on another device, the index can arrive here before the scene
 * notes that carry the new keys; "repairing" those notes would make two
 * devices write the same note at the same time.
 *
 * So the scenes that were not touched here, and whose keys are out of order
 * among themselves, are left to the device that moved them: they are never
 * given a key here and never measured from. Everything else is planned as
 * usual: the touched scenes, scenes that have no key at all, and neighbours
 * that must be renumbered because no whole number fits.
 *
 * @param scenes      the scenes in manuscript order with their current keys
 * @param touchedHere scenes moved, added or filed on this device since the
 *                    last plan
 * @returns the scenes this device should write, with their new key
 */
export function planLocalOrderKeys(
  scenes: readonly OrderedScene[],
  touchedHere: ReadonlySet<string>,
): OrderChange[] {
  // "Awaited" scenes: not touched here, yet out of order among the other
  // untouched scenes. Their key is expected from the device that moved them.
  const others = scenes.filter((scene) => !touchedHere.has(scene.path) && readOrder(scene.order) !== null);
  const awaited = new Set(planOrderKeys(others).map((change) => change.path));
  if (awaited.size === 0) return planOrderKeys(scenes, touchedHere);

  // Plan as if the awaited scenes were not there at all ...
  const tight = planOrderKeys(
    scenes.filter((scene) => !awaited.has(scene.path)),
    touchedHere,
  );
  // ... and again leaving room where they sit, so that a key on its way from
  // another device does not land on a key chosen here. Room is only left when
  // it costs no extra note.
  const roomy = planOrderKeys(
    scenes.map((scene) => (awaited.has(scene.path) ? { path: scene.path, order: null } : scene)),
    touchedHere,
  ).filter((change) => !awaited.has(change.path));
  return roomy.length <= tight.length ? roomy : tight;
}

/** True when the keys rise strictly from one scene to the next and all are usable. */
export function isStrictlyIncreasing(orders: readonly (number | null)[]): boolean {
  let last = 0;
  for (const order of orders) {
    const key = readOrder(order);
    if (key === null || key <= last) return false;
    last = key;
  }
  return true;
}
