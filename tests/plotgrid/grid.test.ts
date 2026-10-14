// The plot grid engine: the columns, whether a scene is in one, the rows,
// each column's count, bar and gaps, and what the device remembers.

import { describe, expect, it } from 'vitest';
import { parseTagList } from '../../src/core/cards';
import {
  DEFAULT_GAP_LENGTH,
  DEFAULT_PREFS,
  barSegments,
  buildPlotGrid,
  chosenOf,
  entityColumns,
  findGaps,
  foldedOf,
  labelColumns,
  laneColumns,
  lanePatch,
  movePrefs,
  projectFirstResolver,
  readGapLength,
  readPrefs,
  renameChosen,
  sceneHasEntity,
  sceneHasLabel,
  sceneInLane,
  withChosen,
  withFolded,
  writePrefs,
} from '../../src/core/plotgrid';
import type { PlotColumn } from '../../src/core/plotgrid';
import { readLanes } from '../../src/core/timeline';
import type { TreeNode } from '../../src/core/types';
import { BUILT_IN_TYPES, buildWorldLinks } from '../../src/core/world';
import type { Entity } from '../../src/core/world';

const MAIN = 'Main plot';
/** "Revenge": a lane with a Hebrew name. */
const REVENGE = 'נקמה';
const STORED_LANES = [
  { name: 'Manuscript', color: 'blue' },
  { name: MAIN, color: 'purple' },
  { name: REVENGE },
  { name: 'Other', color: 'red' },
];
const lanes = readLanes(STORED_LANES).lanes;

describe('timeline lanes as columns', () => {
  it('has a column per lane of the writer, but none for Manuscript or Other', () => {
    expect(laneColumns(STORED_LANES).map((column) => [column.name, column.color])).toEqual([
      [MAIN, 'purple'],
      [REVENGE, null],
    ]);
    expect(laneColumns(undefined)).toEqual([]);
    expect(laneColumns(42)).toEqual([]);
    // One name on its own is a list of one, as the timeline reads it.
    expect(laneColumns(MAIN).map((column) => column.name)).toEqual([MAIN]);
  });

  it('puts a scene in a lane when its "timelines" names it, as the timeline reads it', () => {
    expect(sceneInLane({ timelines: ['main plot '] }, MAIN, lanes)).toBe(true);
    expect(sceneInLane({ timelines: MAIN }, MAIN, lanes)).toBe(true);
    expect(sceneInLane({ timelines: [REVENGE] }, MAIN, lanes)).toBe(false);
    expect(sceneInLane({ timelines: [REVENGE] }, REVENGE, lanes)).toBe(true);
    expect(sceneInLane({}, MAIN, lanes)).toBe(false);
    expect(sceneInLane(null, MAIN, lanes)).toBe(false);
  });

  it('adds and removes only that lane, keeping every other entry as it is written', () => {
    const before = { timelines: [REVENGE, 'Unknown thing', 42], date: '1923-04-12', title: 'x' };
    expect(lanePatch(before, MAIN, lanes, true)).toEqual({ timelines: [REVENGE, 'Unknown thing', 42, MAIN] });
    expect(lanePatch(before, REVENGE, lanes, false)).toEqual({ timelines: ['Unknown thing', 42] });
    // Already as asked: nothing to write.
    expect(lanePatch(before, MAIN, lanes, false)).toEqual({});
    expect(lanePatch(before, REVENGE, lanes, true)).toEqual({});
    // Written as the project spells the lane.
    expect(lanePatch({}, 'MAIN PLOT', lanes, true)).toEqual({ timelines: [MAIN] });
  });
});

describe('labels as columns', () => {
  const list = parseTagList('label', [{ name: 'Anna', color: 'purple' }, { name: 'דניאל', color: 'cyan' }]);

  it('has the project\'s labels, then the ones scenes name that the list lacks', () => {
    const columns = labelColumns(list, ['anna', null, 'Subplot', 'subplot ', 'דניאל']);
    expect(columns.map((column) => [column.name, column.color, column.listed])).toEqual([
      ['Anna', 'purple', true],
      ['דניאל', 'cyan', true],
      ['Subplot', null, false],
    ]);
  });

  it('puts a scene in its label\'s column, whatever its capitals', () => {
    expect(sceneHasLabel({ label: 'anna' }, 'Anna')).toBe(true);
    expect(sceneHasLabel({ label: 'Anna' }, 'דניאל')).toBe(false);
    expect(sceneHasLabel({}, 'Anna')).toBe(false);
    expect(sceneHasLabel(null, 'Anna')).toBe(false);
  });
});

describe('entities as columns', () => {
  const entity = (path: string, name: string, typeId: string | null): Entity => ({ path, name, typeId, summary: '', aliases: [], frontmatter: null });
  const mara = entity('World/Characters/Mara.md', 'Mara', 'character');
  const yosef = entity('World/Characters/יוסף.md', 'יוסף', 'character');
  const harbour = entity('World/Places/Harbour.md', 'Harbour', 'place');
  const sword = entity('World/Items/Sword.md', 'Sword', 'item');
  const all = [harbour, mara, sword, yosef];

  it('has every character, every place, or the chosen ones in the order they were chosen', () => {
    expect(entityColumns('characters', all, BUILT_IN_TYPES).map((column) => [column.name, column.color, column.icon])).toEqual([
      ['Mara', 'blue', 'user'],
      ['יוסף', 'blue', 'user'],
    ]);
    expect(entityColumns('places', all, BUILT_IN_TYPES).map((column) => column.name)).toEqual(['Harbour']);
    const chosen = entityColumns('chosen', all, BUILT_IN_TYPES, [sword.path, 'World/Gone.md', mara.path, sword.path]);
    expect(chosen.map((column) => column.key)).toEqual([sword.path, mara.path]);
  });

  it('puts a scene in an entity\'s column when its "entities" leads to the entity\'s note', () => {
    const vaultPathOf = (path: string): string => `Novel/${path}`;
    const resolve = projectFirstResolver(all.map((one) => vaultPathOf(one.path)), () => null);
    const links = buildWorldLinks({
      entities: all,
      entityVaultPath: vaultPathOf,
      scenes: [
        { path: 'Manuscript/One.md', title: 'One', vaultPath: 'Novel/Manuscript/One.md', frontmatter: { entities: ['[[Mara]]', '[[World/Places/Harbour|the harbour]]'] } },
        { path: 'Manuscript/Two.md', title: 'Two', vaultPath: 'Novel/Manuscript/Two.md', frontmatter: { entities: '[[יוסף]]' } },
      ],
      events: [],
      resolve: (target, from) => resolve(target, from) ?? (target.includes('/') ? `Novel/${target}.md` : null),
    });
    expect(sceneHasEntity(links, 'Manuscript/One.md', mara.path)).toBe(true);
    expect(sceneHasEntity(links, 'Manuscript/One.md', harbour.path)).toBe(true);
    expect(sceneHasEntity(links, 'Manuscript/One.md', yosef.path)).toBe(false);
    expect(sceneHasEntity(links, 'Manuscript/Two.md', yosef.path)).toBe(true);
  });

  it('follows a bare name to the project\'s own note first, and leaves the rest to the vault', () => {
    const vault = (target: string): string => `elsewhere/${target}.md`;
    const resolve = projectFirstResolver(['Novel/World/Characters/Mara.md', 'Novel/World/A/Twin.md', 'Novel/World/B/Twin.md'], vault);
    expect(resolve('mara', 'Novel/Manuscript/One.md')).toBe('Novel/World/Characters/Mara.md');
    expect(resolve('Twin', 'Novel/Manuscript/One.md')).toBe('elsewhere/Twin.md'); // twice in the project: the vault decides
    expect(resolve('World/Characters/Mara', 'x')).toBe('elsewhere/World/Characters/Mara.md');
  });
});

describe('the grid', () => {
  const scene = (name: string): TreeNode => ({ kind: 'scene', path: `Manuscript/${name}.md`, title: name, missing: false });
  const tree: TreeNode[] = [
    scene('A'),
    { kind: 'folder', id: 'f1', name: 'חלק א', children: [scene('B'), scene('C'), { kind: 'folder', id: 'f2', name: 'Inner', children: [scene('D')] }] },
    { kind: 'scene', path: 'Manuscript/Gone.md', title: 'Gone', missing: true },
    scene('E'),
  ];
  const columns: PlotColumn[] = [
    { key: 'x', name: 'X', color: 'red', icon: null, listed: true },
    { key: 'y', name: 'Y', color: null, icon: null, listed: true },
  ];
  const inX = new Set(['A', 'D', 'E', 'Gone']);
  const inY = new Set(['C']);
  const isIn = (path: string, column: PlotColumn): boolean => {
    const name = path.replace(/^Manuscript\//, '').replace(/\.md$/, '');
    return (column.key === 'x' ? inX : inY).has(name);
  };

  it('has a row per scene in binder order, under rows for the folders, with a cell per column', () => {
    const grid = buildPlotGrid({ tree, columns, isIn, gapLength: 0 });
    expect(grid.sceneCount).toBe(6);
    expect(grid.rows.map((row) => (row.kind === 'folder' ? `[${row.name}]` : row.title))).toEqual(['A', '[חלק א]', 'B', 'C', '[Inner]', 'D', 'Gone', 'E']);
    const cells = Object.fromEntries(grid.rows.flatMap((row) => (row.kind === 'scene' ? [[row.title, row.cells]] : [])));
    expect(cells).toEqual({
      A: [true, false],
      B: [false, false],
      C: [false, true],
      D: [true, false],
      Gone: [false, false], // a scene without a note is in no column
      E: [true, false],
    });
    const folder = grid.rows[1];
    expect(folder?.kind === 'folder' && [folder.depth, folder.sceneCount, folder.counts]).toEqual([0, 3, [1, 1]]);
    const d = grid.rows[5];
    expect(d?.kind === 'scene' && [d.depth, d.index]).toEqual([2, 3]);
  });

  it('counts each column, and draws where in the book it is', () => {
    const grid = buildPlotGrid({ tree, columns, isIn, gapLength: 0 });
    expect(grid.columns.map((column) => column.count)).toEqual([3, 1]);
    expect(grid.columns[0]?.segments).toEqual([
      { start: 0, end: 1 / 6 },
      { start: 3 / 6, end: 4 / 6 },
      { start: 5 / 6, end: 1 },
    ]);
    expect(grid.columns[1]?.segments).toEqual([{ start: 2 / 6, end: 3 / 6 }]);
  });

  it('leaves out the scenes of a folded folder, and still counts them', () => {
    const grid = buildPlotGrid({ tree, columns, isIn, folded: new Set(['f1']), gapLength: 0 });
    expect(grid.rows.map((row) => (row.kind === 'folder' ? `[${row.name}]` : row.title))).toEqual(['A', '[חלק א]', 'Gone', 'E']);
    expect(grid.columns.map((column) => column.count)).toEqual([3, 1]);
    const inner = buildPlotGrid({ tree, columns, isIn, folded: new Set(['f2']), gapLength: 0 });
    expect(inner.rows.map((row) => (row.kind === 'folder' ? `[${row.name}]` : row.title))).toEqual(['A', '[חלק א]', 'B', 'C', '[Inner]', 'Gone', 'E']);
  });

  it('marks the long stretches between two scenes of a column', () => {
    const grid = buildPlotGrid({ tree, columns, isIn, gapLength: 2 });
    expect(grid.columns[0]?.gaps).toEqual([{ from: 1, to: 2 }]);
    expect(grid.columns[1]?.gaps).toEqual([]);
    const gaps = Object.fromEntries(grid.rows.flatMap((row) => (row.kind === 'scene' ? [[row.title, row.gaps[0]]] : [])));
    expect(gaps).toEqual({ A: false, B: true, C: true, D: false, Gone: false, E: false });
    // The missing scene breaks no stretch shorter than two.
    expect(buildPlotGrid({ tree, columns, isIn, gapLength: 3 }).columns[0]?.gaps).toEqual([]);
  });

  it('finds gaps only between two filled places, of at least the length asked for', () => {
    const f = false;
    const t = true;
    expect(findGaps([f, f, f, t, f, f, f, t, f, f, f, f], 3)).toEqual([{ from: 4, to: 6 }]);
    expect(findGaps([t, f, f, t], 3)).toEqual([]);
    expect(findGaps([t, f, f, f, f, t, f, t], 2)).toEqual([{ from: 1, to: 4 }]);
    expect(findGaps([t, f, f, f, t], 0)).toEqual([]);
    expect(findGaps([], 3)).toEqual([]);
    expect(barSegments([])).toEqual([]);
    expect(barSegments([t, t, f, t])).toEqual([
      { start: 0, end: 0.5 },
      { start: 0.75, end: 1 },
    ]);
  });

  it('takes a gap length that is a whole number in bounds, 0 for none, and the usual one for anything else', () => {
    expect(readGapLength(3)).toBe(3);
    expect(readGapLength('12')).toBe(12);
    expect(readGapLength(0)).toBe(0);
    expect(readGapLength(1)).toBe(DEFAULT_GAP_LENGTH);
    expect(readGapLength(2.5)).toBe(DEFAULT_GAP_LENGTH);
    expect(readGapLength('many')).toBe(DEFAULT_GAP_LENGTH);
    expect(readGapLength(1000)).toBe(DEFAULT_GAP_LENGTH);
  });
});

describe('what the device remembers', () => {
  it('reads back what it wrote, and the defaults for anything it cannot read', () => {
    let prefs = { ...DEFAULT_PREFS, kind: 'chosen' as const, synopsisLine: true, gapLength: 8 };
    prefs = withChosen(prefs, 'Novel/Novel.md', ['World/Characters/Mara.md', 'World/Characters/Mara.md', 'World/Places/Harbour.md']);
    prefs = withFolded(prefs, 'Novel/Novel.md', ['f1']);
    const back = readPrefs(writePrefs(prefs));
    expect(back).toEqual(prefs);
    expect(chosenOf(back, 'Novel/Novel.md')).toEqual(['World/Characters/Mara.md', 'World/Places/Harbour.md']);
    expect([...foldedOf(back, 'Novel/Novel.md')]).toEqual(['f1']);
    expect(chosenOf(back, 'Other/Other.md')).toEqual([]);
    for (const odd of [null, '', '{not json', '[1,2]', 42]) expect(readPrefs(odd)).toEqual(DEFAULT_PREFS);
    expect(readPrefs(JSON.stringify({ kind: 'nonsense', synopsisLine: 'yes', gapLength: -1, chosen: { a: [1, 'x'] }, folded: 'no' }))).toEqual({
      ...DEFAULT_PREFS,
      chosen: { a: ['x'] },
      folded: {},
    });
  });

  it('forgets a project\'s list when it is emptied, and moves it with the project', () => {
    let prefs = withChosen(DEFAULT_PREFS, 'A/A.md', ['World/x.md']);
    prefs = withFolded(prefs, 'A/A.md', ['f1']);
    const moved = movePrefs(prefs, 'A/A.md', 'B/B.md');
    expect(moved.chosen).toEqual({ 'B/B.md': ['World/x.md'] });
    expect(moved.folded).toEqual({ 'B/B.md': ['f1'] });
    expect(withChosen(moved, 'B/B.md', []).chosen).toEqual({});
    expect(renameChosen(moved, 'B/B.md', 'World/x.md', 'World/y.md').chosen).toEqual({ 'B/B.md': ['World/y.md'] });
    expect(renameChosen(moved, 'B/B.md', 'World/z.md', 'World/y.md')).toBe(moved);
  });
});
