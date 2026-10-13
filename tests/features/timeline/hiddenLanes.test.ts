// Which lanes a device hides, project by project, kept in the device's own
// storage (a stand-in here) and never in a project.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { HIDDEN_LANES_KEY, HiddenLanes, MAX_LANES, MAX_PROJECTS } from '../../../src/features/timeline/hiddenLanes';
import { MemoryDeviceStorage } from '../../storeHarness';

const NOVEL = 'Novel/Novel.md';
const OTHER = 'Other/Other.md';

/** What the storage holds, read back the way a new session would read it. */
function stored(storage: MemoryDeviceStorage): unknown {
  const value = storage.load(HIDDEN_LANES_KEY);
  return typeof value === 'string' ? (JSON.parse(value) as unknown) : value;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the lanes a device hides', () => {
  it('are none to begin with, and reading them saves nothing', () => {
    const storage = new MemoryDeviceStorage();
    const hidden = new HiddenLanes(storage);
    expect(hidden.of(NOVEL)).toEqual([]);
    expect(storage.saves).toEqual([]);
  });

  it('are remembered for each project on its own, under a key that is the plugin\'s', () => {
    const storage = new MemoryDeviceStorage();
    const hidden = new HiddenLanes(storage);
    expect(hidden.set(NOVEL, ['Main plot', 'רקע'])).toBe(true);
    expect(hidden.set(OTHER, ['Manuscript'])).toBe(true);
    expect(hidden.of(NOVEL)).toEqual(['Main plot', 'רקע']);
    expect(hidden.of(OTHER)).toEqual(['Manuscript']);
    expect(HIDDEN_LANES_KEY).toMatch(/^spellbook-/);
    expect(stored(storage)).toEqual({ [NOVEL]: ['Main plot', 'רקע'], [OTHER]: ['Manuscript'] });
    // Only text is ever handed to the storage.
    expect(storage.saves.every(([key, value]) => key === HIDDEN_LANES_KEY && typeof value === 'string')).toBe(true);
  });

  it('come back after a restart', () => {
    const storage = new MemoryDeviceStorage();
    new HiddenLanes(storage).set(NOVEL, ['Main plot']);
    expect(new HiddenLanes(storage).of(NOVEL)).toEqual(['Main plot']);
  });

  it('hand out the same list until it changes, and save nothing when told what they already know', () => {
    const storage = new MemoryDeviceStorage();
    const hidden = new HiddenLanes(storage);
    hidden.set(NOVEL, ['Main plot']);
    const first = hidden.of(NOVEL);
    expect(hidden.of(NOVEL)).toBe(first);
    expect(hidden.set(NOVEL, ['Main plot'])).toBe(false);
    expect(storage.saves).toHaveLength(1);
    expect(hidden.set(NOVEL, ['Main plot', 'Side'])).toBe(true);
    expect(hidden.of(NOVEL)).not.toBe(first);
    expect(Object.isFrozen(hidden.of(NOVEL))).toBe(true);
  });

  it('forget a project that hides nothing, and the key itself when no project hides anything', () => {
    const storage = new MemoryDeviceStorage();
    const hidden = new HiddenLanes(storage);
    hidden.set(NOVEL, ['Main plot']);
    hidden.set(OTHER, ['Side']);
    hidden.set(NOVEL, []);
    expect(stored(storage)).toEqual({ [OTHER]: ['Side'] });
    hidden.set(OTHER, []);
    expect(storage.values.has(HIDDEN_LANES_KEY)).toBe(false);
    expect(hidden.set(OTHER, [])).toBe(false); // nothing was hidden, nothing is
  });

  it('keep a name once, drop what is not a name, and never grow without end', () => {
    const storage = new MemoryDeviceStorage();
    const hidden = new HiddenLanes(storage);
    hidden.set(NOVEL, ['A', 'B', 'A', '', 7 as unknown as string]);
    expect(hidden.of(NOVEL)).toEqual(['A', 'B']);

    hidden.set(NOVEL, Array.from({ length: MAX_LANES + 5 }, (_, index) => `Lane ${index}`));
    expect(hidden.of(NOVEL)).toHaveLength(MAX_LANES);
    expect(hidden.of(NOVEL)[MAX_LANES - 1]).toBe(`Lane ${MAX_LANES + 4}`); // the newest stay

    for (let index = 0; index < MAX_PROJECTS + 3; index++) hidden.set(`P${index}/P${index}.md`, ['x']);
    const projects = Object.keys(stored(storage) as Record<string, unknown>);
    expect(projects).toHaveLength(MAX_PROJECTS);
    expect(projects).toContain(`P${MAX_PROJECTS + 2}/P${MAX_PROJECTS + 2}.md`);
    expect(projects).not.toContain(NOVEL); // the oldest went first
  });

  it('follow a project to its new path, leaving nothing under the old one', () => {
    const storage = new MemoryDeviceStorage();
    const hidden = new HiddenLanes(storage);
    hidden.set(NOVEL, ['Main plot']);
    hidden.set('Book/Novel.md', ['Stale']);
    hidden.move(NOVEL, 'Book/Novel.md');
    expect(hidden.of('Book/Novel.md')).toEqual(['Main plot']);
    expect(hidden.of(NOVEL)).toEqual([]);
    expect(stored(storage)).toEqual({ 'Book/Novel.md': ['Main plot'] });

    const saves = storage.saves.length;
    hidden.move('Nowhere/Nowhere.md', 'Elsewhere/Elsewhere.md'); // nothing was remembered: nothing to move
    hidden.move('Book/Novel.md', 'Book/Novel.md');
    expect(storage.saves).toHaveLength(saves);
  });

  it('take whatever the storage holds without failing, and use only what makes sense', () => {
    for (const junk of [42, 'not json', '[1,2]', 'null', JSON.stringify({ [NOVEL]: 'Main plot' }), { [NOVEL]: 7 }]) {
      const storage = new MemoryDeviceStorage();
      storage.values.set(HIDDEN_LANES_KEY, JSON.stringify(junk));
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      expect(new HiddenLanes(storage).of(NOVEL), JSON.stringify(junk)).toEqual([]);
    }
    // An older shape that kept the object itself is still read.
    const storage = new MemoryDeviceStorage();
    storage.values.set(HIDDEN_LANES_KEY, JSON.stringify({ [NOVEL]: ['Main plot', 3, ''], 'x/x.md': [] }));
    expect(new HiddenLanes(storage).of(NOVEL)).toEqual(['Main plot']);
  });

  it('go on working for the session when the storage does not work at all', () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const storage = new MemoryDeviceStorage();
    storage.broken = true;
    const hidden = new HiddenLanes(storage);
    expect(hidden.of(NOVEL)).toEqual([]);
    expect(hidden.set(NOVEL, ['Main plot'])).toBe(true);
    expect(hidden.of(NOVEL)).toEqual(['Main plot']);
    expect(logged).toHaveBeenCalled();
  });
});
