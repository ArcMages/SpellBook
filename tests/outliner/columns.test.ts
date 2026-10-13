import { describe, expect, it } from 'vitest';
import {
  BUILT_IN_COLUMNS,
  NARROW_BELOW,
  WIDE_FROM,
  addPropertyColumn,
  canMoveColumn,
  columnTitle,
  defaultLayout,
  isBuiltInColumn,
  isColumnId,
  isNumberColumn,
  isOwnTextTitle,
  isShown,
  moveColumn,
  paneWidthFor,
  parseStored,
  propertyColumn,
  propertyKeyOf,
  propertyKeysIn,
  readColumnPrefs,
  readLayout,
  sameLayout,
  setColumnShown,
  shownColumns,
  writeColumnPrefs,
} from '../../src/core/outliner';
import type { ColumnLayout } from '../../src/core/outliner';
import { HEBREW } from './helpers';

const ids = (layout: ColumnLayout): string[] => layout.map((column) => column.id);

describe('the columns there are', () => {
  it('lists the built-in columns in their usual order', () => {
    expect([...BUILT_IN_COLUMNS]).toEqual([
      'number',
      'name',
      'status',
      'label',
      'target',
      'words',
      'synopsis',
      'tags',
      'tasks',
      'readTime',
      'compile',
      'created',
      'edited',
    ]);
    expect(BUILT_IN_COLUMNS.map(columnTitle)).toEqual([
      '#',
      'Name',
      'Status',
      'Label',
      'Target',
      'Words',
      'Synopsis',
      'Tags',
      'Tasks',
      'Read time',
      'Compile',
      'Created',
      'Edited',
    ]);
  });

  it('knows a column for another property by its key', () => {
    const id = propertyColumn('pov');
    expect(id).toBe('prop:pov');
    expect(propertyKeyOf(id)).toBe('pov');
    expect(columnTitle(id)).toBe('pov');
    expect(columnTitle(propertyColumn(HEBREW.house))).toBe(HEBREW.house);
    // Only such a header is the writer's own text.
    expect(isOwnTextTitle(id)).toBe(true);
    expect(isOwnTextTitle('name')).toBe(false);
    expect(propertyKeyOf('name')).toBeNull();
    expect(isBuiltInColumn('name')).toBe(true);
    expect(isBuiltInColumn(id)).toBe(false);
    // A property that is called like a built-in column is still a property.
    expect(propertyKeyOf(propertyColumn('name'))).toBe('name');
  });

  it('tells what can be the id of a column', () => {
    for (const id of ['name', 'readTime', 'prop:pov', `prop:${HEBREW.house}`, 'prop:a:b']) expect(isColumnId(id), id).toBe(true);
    for (const id of ['', 'Name', 'prop:', 'prop:   ', 'nonsense', 7, null, undefined, {}, `prop:${'x'.repeat(201)}`]) {
      expect(isColumnId(id), String(id)).toBe(false);
    }
  });

  it('knows which columns hold numbers', () => {
    expect(BUILT_IN_COLUMNS.filter(isNumberColumn)).toEqual(['number', 'target', 'words', 'tasks', 'readTime']);
    expect(isNumberColumn('prop:chapter')).toBe(false);
  });
});

describe('a layout', () => {
  it('shows everything but the two dates in a pane with room', () => {
    const layout = defaultLayout('wide');
    expect(ids(layout)).toEqual([...BUILT_IN_COLUMNS]);
    expect(shownColumns(layout)).toEqual([
      'number',
      'name',
      'status',
      'label',
      'target',
      'words',
      'synopsis',
      'tags',
      'tasks',
      'readTime',
      'compile',
    ]);
    expect(isShown(layout, 'created')).toBe(false);
    expect(isShown(layout, 'edited')).toBe(false);
  });

  it('shows only Name, Status, Target and Words in a narrow one', () => {
    const layout = defaultLayout('narrow');
    expect(ids(layout)).toEqual([...BUILT_IN_COLUMNS]);
    expect(shownColumns(layout)).toEqual(['name', 'status', 'target', 'words']);
  });

  it('shows and hides a column, but never hides the Name', () => {
    const wide = defaultLayout('wide');
    const without = setColumnShown(wide, 'tags', false);
    expect(isShown(without, 'tags')).toBe(false);
    expect(ids(without)).toEqual(ids(wide));
    expect(isShown(setColumnShown(without, 'created', true), 'created')).toBe(true);
    expect(setColumnShown(wide, 'name', false)).toBe(wide);
    // Nothing it was given is changed.
    expect(isShown(wide, 'tags')).toBe(true);
    expect(sameLayout(setColumnShown(without, 'tags', true), wide)).toBe(true);
  });

  it('adds a column for another property at the end, once', () => {
    const wide = defaultLayout('wide');
    const added = addPropertyColumn(wide, 'pov');
    expect(ids(added).slice(-1)).toEqual(['prop:pov']);
    expect(isShown(added, 'prop:pov')).toBe(true);
    expect(addPropertyColumn(added, 'pov')).toEqual(added);
    expect(propertyKeysIn(addPropertyColumn(added, HEBREW.house))).toEqual(['pov', HEBREW.house]);
    // A key that is no key adds nothing.
    expect(addPropertyColumn(wide, '  ')).toBe(wide);
    // Hiding such a column takes it out of the layout.
    expect(ids(setColumnShown(added, 'prop:pov', false))).toEqual(ids(wide));
  });

  it('adds no more than forty property columns', () => {
    let layout = defaultLayout('wide');
    for (let n = 0; n < 60; n++) layout = addPropertyColumn(layout, `key ${n}`);
    expect(propertyKeysIn(layout)).toHaveLength(40);
  });

  it('moves a shown column past the next shown one, skipping what is hidden', () => {
    const layout: ColumnLayout = [
      { id: 'name', shown: true },
      { id: 'created', shown: false },
      { id: 'status', shown: true },
      { id: 'words', shown: true },
    ];
    expect(shownColumns(moveColumn(layout, 'name', 1))).toEqual(['status', 'name', 'words']);
    expect(shownColumns(moveColumn(layout, 'words', -1))).toEqual(['name', 'words', 'status']);
    expect(shownColumns(moveColumn(layout, 'status', -1))).toEqual(['status', 'name', 'words']);
    // Every column is still there, the hidden one too.
    expect(ids(moveColumn(layout, 'status', -1)).sort()).toEqual(ids(layout).sort());
    // At the edge, hidden, or not there: nothing moves.
    expect(moveColumn(layout, 'name', -1)).toBe(layout);
    expect(moveColumn(layout, 'words', 1)).toBe(layout);
    expect(moveColumn(layout, 'created', 1)).toBe(layout);
    expect(moveColumn(layout, 'tags', 1)).toBe(layout);
    expect(canMoveColumn(layout, 'name', -1)).toBe(false);
    expect(canMoveColumn(layout, 'name', 1)).toBe(true);
    expect(canMoveColumn(layout, 'words', 1)).toBe(false);
    expect(canMoveColumn(layout, 'created', 1)).toBe(false);
  });

  it('moves a column all the way, one place at a time', () => {
    let layout = defaultLayout('narrow');
    for (let step = 0; step < 5; step++) layout = moveColumn(layout, 'name', 1);
    expect(shownColumns(layout)).toEqual(['status', 'target', 'words', 'name']);
    expect(ids(layout)).toHaveLength(BUILT_IN_COLUMNS.length);
  });
});

describe('which layout a pane gets', () => {
  it('goes by the measured width, with a gap so that it does not flicker at the edge', () => {
    expect(NARROW_BELOW).toBeLessThan(WIDE_FROM);
    expect(paneWidthFor(375, 'wide')).toBe('narrow');
    expect(paneWidthFor(NARROW_BELOW - 1, 'wide')).toBe('narrow');
    expect(paneWidthFor(NARROW_BELOW, 'wide')).toBe('wide');
    expect(paneWidthFor(1200, 'narrow')).toBe('wide');
    // Between the two marks a pane stays what it was.
    expect(paneWidthFor(NARROW_BELOW + 10, 'narrow')).toBe('narrow');
    expect(paneWidthFor(NARROW_BELOW + 10, 'wide')).toBe('wide');
    expect(paneWidthFor(WIDE_FROM, 'narrow')).toBe('wide');
  });

  it('keeps what it had while the pane is hidden', () => {
    for (const width of [0, -1, Number.NaN]) {
      expect(paneWidthFor(width, 'narrow')).toBe('narrow');
      expect(paneWidthFor(width, 'wide')).toBe('wide');
    }
  });
});

describe('the saved columns', () => {
  it('saves nothing while both layouts are the usual ones', () => {
    expect(writeColumnPrefs({ wide: defaultLayout('wide'), narrow: defaultLayout('narrow') })).toBeNull();
    expect(readColumnPrefs(null)).toEqual({ wide: defaultLayout('wide'), narrow: defaultLayout('narrow') });
  });

  it('comes back as it was saved: the choice, the order and the property columns', () => {
    const wide = addPropertyColumn(moveColumn(setColumnShown(defaultLayout('wide'), 'tags', false), 'words', -1), HEBREW.house);
    const narrow = setColumnShown(defaultLayout('narrow'), 'synopsis', true);
    const text = writeColumnPrefs({ wide, narrow });
    expect(typeof text).toBe('string');
    const back = readColumnPrefs(text);
    expect(back).toEqual({ wide, narrow });
    expect(shownColumns(back.wide).slice(3, 6)).toEqual(['label', 'words', 'target']);
    expect(shownColumns(back.narrow)).toEqual(['name', 'status', 'target', 'words', 'synopsis']);
    // The storage may hand the saved text back already read.
    expect(readColumnPrefs(JSON.parse(text ?? ''))).toEqual({ wide, narrow });
  });

  it('gives the usual layouts for anything it cannot read', () => {
    const usual = { wide: defaultLayout('wide'), narrow: defaultLayout('narrow') };
    for (const stored of [undefined, '', 'not json', '{"wide":', 7, true, [], {}, { wide: 'all', narrow: 3 }, '{"v":1}', 'null']) {
      expect(readColumnPrefs(stored), JSON.stringify(stored)).toEqual(usual);
    }
    expect(parseStored('{"a":1}')).toEqual({ a: 1 });
    expect(parseStored('{oops')).toBeUndefined();
    expect(parseStored(null)).toBeUndefined();
    expect(parseStored({ a: 1 })).toEqual({ a: 1 });
  });

  it('leaves out what it does not understand, and puts back what is missing', () => {
    const layout = readLayout(
      [
        { id: 'words', shown: true },
        { id: 'name', shown: false },
        { id: 'prop:pov', shown: true },
        { id: 'nonsense', shown: true },
        { id: 'words', shown: false },
        'status',
        42,
        null,
        { id: 'prop:', shown: true },
        { shown: true },
      ],
      'wide',
    );
    // What was saved keeps its order; each missing column comes in after the one it usually follows.
    expect(ids(layout)).toEqual([
      'number',
      'words',
      'synopsis',
      'tags',
      'tasks',
      'readTime',
      'compile',
      'created',
      'edited',
      'name',
      'prop:pov',
      'status',
      'label',
      'target',
    ]);
    // The Name is always shown; a column that was put back is shown or hidden as it usually is.
    expect(isShown(layout, 'name')).toBe(true);
    expect(isShown(layout, 'words')).toBe(true);
    expect(isShown(layout, 'status')).toBe(true);
    expect(isShown(layout, 'label')).toBe(true);
    expect(isShown(layout, 'created')).toBe(false);
  });

  it('puts a missing column back hidden in a narrow pane, when that is how it usually is there', () => {
    const layout = readLayout([{ id: 'name', shown: true }, { id: 'words', shown: true }], 'narrow');
    expect(shownColumns(layout)).toEqual(['name', 'status', 'target', 'words']);
    expect(ids(layout)).toHaveLength(BUILT_IN_COLUMNS.length);
  });

  it('takes a column whose "shown" is not yes or no the way it usually is', () => {
    const layout = readLayout([{ id: 'created', shown: 'maybe' }, { id: 'tags' }, { id: 'prop:pov', shown: false }], 'wide');
    expect(isShown(layout, 'created')).toBe(false);
    expect(isShown(layout, 'tags')).toBe(true);
    // A property column that was hidden is one that was taken away.
    expect(propertyKeysIn(layout)).toEqual([]);
  });

  it('reads no more than forty property columns', () => {
    const saved = Array.from({ length: 70 }, (_, n) => ({ id: `prop:key ${n}`, shown: true }));
    expect(propertyKeysIn(readLayout(saved, 'wide'))).toHaveLength(40);
  });
});
