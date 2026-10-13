// A long binder: 500 scenes in ten folders. These tests do not measure time
// (that depends on the machine); they count the work the panel does, which
// is what makes it quick or slow: how much of the list is built anew, and
// how often the rows are measured.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sceneRef } from '../src/core/binderTree';
import { ORDER_DEBOUNCE_MS } from '../src/core/projectStore';
import { WORD_COUNT_DEBOUNCE_MS } from '../src/core/wordCountCache';
import { carry, countOf, gripOf, inRow, layOut, letGo, one, picture, point, rowOf, scroller, tap, type } from './binderScreen';
import { FRAME_MS, INDEX, clearScreen, rest, stage } from './binderStage';
import type { Stage } from './binderStage';
import { MemoryVault } from './memoryVault';
import { FakeElement, fakeDocument, resetPlatform } from './obsidianStub';
import { seedProject } from './storeHarness';

beforeEach(() => {
  clearScreen();
});

afterEach(() => {
  resetPlatform();
  vi.restoreAllMocks();
});

const PARTS = 10;
const SCENES_IN_PART = 50;
const sceneName = (index: number): string => `Scene ${String(index).padStart(3, '0')}`;
const scenePath = (index: number): string => `Manuscript/${sceneName(index)}.md`;

/** A novel of 500 scenes, 50 to a part. Every scene has ten words. */
function longNovel(): MemoryVault {
  const vault = new MemoryVault();
  const scenes: Record<string, number> = {};
  const binder: unknown[] = [];
  for (let part = 0; part < PARTS; part++) {
    const children: string[] = [];
    for (let at = 1; at <= SCENES_IN_PART; at++) {
      const index = part * SCENES_IN_PART + at;
      scenes[sceneName(index)] = index * 1024;
      children.push(scenePath(index));
    }
    binder.push({ folder: `Part ${part + 1}`, id: `f-${part + 1}`, children });
  }
  seedProject(vault, { binder, scenes });
  return vault;
}

async function long(): Promise<Stage> {
  return stage(longNovel());
}

/** Count how many elements are built while `work` runs. */
async function built(work: () => Promise<void> | void): Promise<number> {
  const spy = vi.spyOn(FakeElement.prototype, 'createEl');
  const before = spy.mock.calls.length;
  await work();
  const count = spy.mock.calls.length - before;
  spy.mockRestore();
  return count;
}

/** Count how often the list is emptied to be drawn again. */
function drawings(pane: FakeElement): () => number {
  const body = one(pane, 'spellbook-binder-body');
  const empty = body.empty.bind(body);
  let draws = 0;
  body.empty = (): void => {
    empty();
    draws++;
  };
  return () => draws;
}

describe('a binder of 500 scenes', () => {
  it('shows every scene, counted, with the sums of its parts', async () => {
    const s = await long();
    const lines = picture(s.pane);
    expect(lines[0]).toBe('v Manuscript 5,000');
    expect(lines[1]).toBe('  v Part 1 500');
    expect(lines[2]).toBe('    Scene 001 10');
    expect(lines.filter((line) => line.startsWith('    Scene '))).toHaveLength(500);
    expect(s.vault.writes).toEqual([]);
  });

  it('brings one row and the sums above it up to date when a scene is saved: nothing is drawn again', async () => {
    const s = await long();
    const draws = drawings(s.pane);
    const made = await built(async () => {
      s.vault.external.write(`Novel/${scenePath(250)}`, { body: 'One two three four five.' });
      s.timers.advance(WORD_COUNT_DEBOUNCE_MS);
      await rest(s);
    });
    expect(countOf(s.pane, 'Scene 250')).toBe('5');
    expect(countOf(s.pane, 'Part 5')).toBe('495');
    expect(countOf(s.pane, 'Manuscript')).toBe('4,995');
    expect(countOf(s.pane, 'Scene 251')).toBe('10');
    expect(draws()).toBe(0);
    expect(made).toBe(0);
  });

  it('folds and unfolds a part of 50 scenes without drawing or building anything', async () => {
    const s = await long();
    const draws = drawings(s.pane);
    const made = await built(() => {
      tap(rowOf(s.pane, 'Part 3'));
      tap(rowOf(s.pane, 'Part 3'));
      tap(rowOf(s.pane, 'Part 7'));
    });
    expect(picture(s.pane).filter((line) => line.startsWith('    Scene '))).toHaveLength(450);
    expect(draws()).toBe(0);
    expect(made).toBe(0);
  });

  it('moves the rows it has when the order changes, and builds none anew', async () => {
    const s = await long();
    const before = new Map(s.pane.withClass('spellbook-row-self').map((row) => [row, true]));
    expect(before.size).toBe(512); // 500 scenes, 10 parts, Manuscript and Research

    const made = await built(async () => {
      await s.store.moveNode(sceneRef(scenePath(1)), { at: 'end', parentId: 'f-10' });
      await rest(s);
    });
    const lines = picture(s.pane);
    expect(lines[lines.indexOf('v Research') - 1]).toBe('    Scene 001 10');
    expect(lines[2]).toBe('    Scene 002 10');

    const after = s.pane.withClass('spellbook-row-self');
    expect(after).toHaveLength(512);
    for (const row of after) expect(before.has(row)).toBe(true); // the very same rows
    // Only the header and its three buttons were made again: nothing that grows with the binder.
    expect(made).toBeLessThan(40);
  });

  it('builds a row only for what is new when a scene is added', async () => {
    const s = await long();
    const before = new Set(s.pane.withClass('spellbook-row-self'));
    const made = await built(async () => {
      await s.store.addScene('Brand new', { at: 'start', parentId: 'f-4' });
      await rest(s);
    });
    const after = s.pane.withClass('spellbook-row-self');
    expect(after).toHaveLength(513);
    expect(after.filter((row) => !before.has(row))).toEqual([rowOf(s.pane, 'Brand new')]);
    expect(made).toBeLessThan(100);
  });

  it('gives a folder that was renamed a new row and keeps the rows inside it', async () => {
    const s = await long();
    const scene = rowOf(s.pane, 'Scene 120');
    const folder = rowOf(s.pane, 'Part 3');
    await s.store.renameFolder('f-3', 'The third part');
    await rest(s);
    expect(rowOf(s.pane, 'The third part')).not.toBe(folder);
    expect(rowOf(s.pane, 'Scene 120')).toBe(scene);
    expect(countOf(s.pane, 'The third part')).toBe('500');
  });

  it('starts from fresh rows for another project', async () => {
    const vault = longNovel();
    seedProject(vault, { folder: 'Other', title: 'Other Book', scenes: { 'Scene 001': 1024 } });
    const s = await stage(vault);
    const before = rowOf(s.pane, 'Scene 001');
    await s.services.session.choose('Other/Other.md');
    await rest(s);
    expect(picture(s.pane).slice(0, 2)).toEqual(['v Manuscript 10', '  Scene 001 10']);
    expect(rowOf(s.pane, 'Scene 001')).not.toBe(before);
  });

  it('measures the rows once for a whole drag, however much the pointer moves and the list scrolls', async () => {
    const s = await long();
    layOut(s.pane, 400);
    const scene = rowOf(s.pane, 'Scene 003');
    const measured = vi.spyOn(FakeElement.prototype, 'getBoundingClientRect');

    carry(scene, 60, inRow(rowOf(s.pane, 'Scene 006'), 0.8));
    const atStart = measured.mock.calls.length;
    expect(atStart).toBeGreaterThan(500); // every row, once

    const grip = gripOf(scene).target;
    for (let step = 0; step < 40; step++) point(grip, 'pointermove', 60, 200 + step * 7);
    s.timers.advance(FRAME_MS * 20); // near the bottom edge by now: the list scrolls by itself
    expect(scroller(s.pane).scrollTop).toBeGreaterThan(0);
    // Each move and each step of scrolling looks at the list's own box, never at the rows.
    expect(measured.mock.calls.length - atStart).toBeLessThan(200);

    measured.mockRestore();
    letGo(scene, 60, 300);
    await rest(s);
    expect(s.vault.writesTo(INDEX)).toHaveLength(1);
  });

  it('writes one scene note after a move, not five hundred', async () => {
    const s = await long();
    await s.store.moveNode(sceneRef(scenePath(400)), { at: 'after', sibling: sceneRef(scenePath(10)) });
    await rest(s);
    s.vault.clearWrites();
    s.timers.advance(ORDER_DEBOUNCE_MS);
    await rest(s);
    expect(s.vault.writes).toEqual([{ op: 'updateFrontmatter', path: `Novel/${scenePath(400)}` }]);
  });

  it('goes from row to row with the keyboard without drawing anything again', async () => {
    const s = await long();
    const draws = drawings(s.pane);
    rowOf(s.pane, 'Part 1').focus();
    for (let step = 0; step < 60; step++) type(fakeDocument.activeElement as FakeElement, 'ArrowDown');
    // Fifty scenes, then the next part and its scenes.
    expect(fakeDocument.activeElement).toBe(rowOf(s.pane, 'Scene 059'));
    expect(draws()).toBe(0);
  });
});
